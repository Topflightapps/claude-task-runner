import { spawn } from "node:child_process";

import type { ClaudeReviewOutput } from "../github/types.js";

import { getConfig } from "../config.js";
import {
  activeReviewProcesses,
  appendReviewOutput,
  taskEvents,
} from "../events.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("review-runner");

export interface ReviewResult {
  costUsd?: number;
  output: ClaudeReviewOutput | null;
  success: boolean;
}

export async function runClaudeReview(
  repoPath: string,
  diff: string,
  reviewId: number,
): Promise<ReviewResult> {
  const config = getConfig();

  const prompt = `You are reviewing a pull request. Here is the diff:

\`\`\`diff
${diff}
\`\`\`

Read the relevant source files in this repository for context. Then analyze this diff and provide a code review.

Output ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "Brief overall assessment of the PR",
  "comments": [
    {
      "path": "relative/file/path.ts",
      "line": 42,
      "body": "Your review comment here",
      "side": "RIGHT"
    }
  ]
}

Focus on:
- Bugs and logic errors
- Security issues
- Performance problems
- Missing error handling at system boundaries
- Unclear or misleading code

Do NOT comment on style, formatting, or trivial issues.
If the code looks good with no substantive issues, return an empty comments array.`;

  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns",
    "10",
  ];

  log.info({ repoPath, reviewId }, "Starting Claude Code review");

  return spawnReviewProcess(repoPath, args, config.REVIEW_TIMEOUT_MS, reviewId);
}

function parseReviewOutput(text: string): ClaudeReviewOutput | null {
  // Try to extract JSON from the output — Claude may include extra text
  const jsonMatch = /\{[\s\S]*"comments"[\s\S]*\}/.exec(text);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ClaudeReviewOutput;
    if (typeof parsed.summary === "string" && Array.isArray(parsed.comments)) {
      return parsed;
    }
  } catch {
    // Failed to parse
  }

  return null;
}

function spawnReviewProcess(
  cwd: string,
  args: string[],
  timeoutMs: number,
  reviewId: number,
): Promise<ReviewResult> {
  return new Promise<ReviewResult>((resolve) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_SESSION;

    const child = spawn("claude", args, {
      cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.end();
    activeReviewProcesses.set(reviewId, child);

    let stdout = "";
    let stderr = "";
    let costUsd: number | undefined;
    let resultText = "";
    let lineBuf = "";

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      lineBuf += chunk;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";

      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;

          if (typeof event.cost_usd === "number") {
            costUsd = event.cost_usd;
          }
          if (event.type === "result" && typeof event.result === "string") {
            resultText = event.result;
          }

          const evtType = typeof event.type === "string" ? event.type : "event";
          const line = "[" + evtType + "]";
          appendReviewOutput(reviewId, line);
          taskEvents.emit("review:output", {
            line,
            reviewId,
            stream: "stdout",
          });
        } catch {
          if (trimmed) {
            appendReviewOutput(reviewId, trimmed);
            taskEvents.emit("review:output", {
              line: trimmed,
              reviewId,
              stream: "stdout",
            });
          }
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      for (const line of chunk.split("\n").filter(Boolean)) {
        appendReviewOutput(reviewId, line);
        taskEvents.emit("review:output", {
          line,
          reviewId,
          stream: "stderr",
        });
      }
    });

    const timeout = setTimeout(() => {
      log.error({ timeoutMs }, "Review timed out, killing process");
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      activeReviewProcesses.delete(reviewId);

      if (code !== 0) {
        log.error(
          { code, stderr: stderr.slice(0, 2000) },
          "Review exited with error",
        );
        resolve({ output: null, success: false });
        return;
      }

      const text = resultText || stdout;
      const parsed = parseReviewOutput(text);

      log.info(
        {
          commentCount: parsed?.comments.length ?? 0,
          costUsd,
          success: !!parsed,
        },
        "Review finished",
      );

      resolve({ costUsd, output: parsed, success: !!parsed });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      activeReviewProcesses.delete(reviewId);
      log.error(err, "Failed to spawn Claude for review");
      resolve({ output: null, success: false });
    });
  });
}
