import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ClaudeReviewOutput } from "../github/types.js";

import { getConfig } from "../config.js";
import {
  activeReviewProcesses,
  appendReviewOutput,
  taskEvents,
} from "../events.js";
import { createChildLogger } from "../logger.js";
import { extractStreamLine } from "./runner.js";

const log = createChildLogger("review-runner");

export interface ReviewResult {
  costUsd?: number;
  output: ClaudeReviewOutput | null;
  success: boolean;
}

export async function runClaudeReview(
  repoPath: string,
  prBaseBranch: string,
  reviewId: number,
): Promise<ReviewResult> {
  const config = getConfig();

  // Let Claude Code explore the repo and diff directly using git — no need to
  // pipe the diff. The PR branch is already checked out; Claude can run
  // `git diff origin/main...HEAD` (or equivalent) to see the changes.
  const prompt =
    "You are reviewing a pull request. The PR branch is already checked out in this repo. " +
    "Run `git diff origin/" +
    prBaseBranch +
    "...HEAD` to see what changed. " +
    "Read the relevant source files for context.\n\n" +
    "Provide a code review as ONLY valid JSON (no markdown, no code fences):\n" +
    "{\n" +
    '  "summary": "Brief overall assessment of the PR",\n' +
    '  "comments": [\n' +
    "    {\n" +
    '      "path": "relative/file/path.ts",\n' +
    '      "line": 42,\n' +
    '      "body": "Your review comment here",\n' +
    '      "side": "RIGHT"\n' +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "Focus on:\n" +
    "- Bugs and logic errors\n" +
    "- Security issues\n" +
    "- Performance problems\n" +
    "- Missing error handling at system boundaries\n" +
    "- Unclear or misleading code\n\n" +
    "Do NOT comment on style, formatting, or trivial issues.\n" +
    "If the code looks good with no substantive issues, return an empty comments array.";

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

  ensureClaudeConfig();
  log.info({ repoPath, reviewId }, "Starting Claude Code review");

  return spawnReviewProcess(repoPath, args, config.REVIEW_TIMEOUT_MS, reviewId);
}

/**
 * Restore .claude.json from backup if missing. Concurrent Claude processes
 * (task runner + review runner) can corrupt/delete this file.
 */
function ensureClaudeConfig(): void {
  const home = homedir();
  const configPath = join(home, ".claude.json");
  if (existsSync(configPath)) return;

  const backupDir = join(home, ".claude", "backups");
  if (!existsSync(backupDir)) return;

  try {
    const backups = readdirSync(backupDir)
      .filter((f) => f.startsWith(".claude.json.backup."))
      .sort()
      .reverse();

    if (backups.length > 0) {
      const latest = join(backupDir, backups[0]);
      copyFileSync(latest, configPath);
      log.info({ from: latest }, "Restored .claude.json from backup");
    }
  } catch (err) {
    log.warn({ error: err }, "Failed to restore .claude.json from backup");
  }
}

function parseReviewOutput(text: string): ClaudeReviewOutput | null {
  // Strip markdown code fences if present
  const stripped = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");

  // Try parsing the full text as JSON first
  const result = tryParseReview(stripped);
  if (result) return result;

  // Try to find a JSON object containing "comments"
  // Use a balanced-brace approach instead of greedy regex
  const start = stripped.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") {
      depth--;
      if (depth === 0) {
        const candidate = stripped.slice(start, i + 1);
        const parsed = tryParseReview(candidate);
        if (parsed) return parsed;
        // Keep looking — there might be another JSON object
      }
    }
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

          const display = extractStreamLine(event);
          const evtType = typeof event.type === "string" ? event.type : "event";
          const evtSub =
            typeof event.subtype === "string" ? `:${event.subtype}` : "";
          const line = display ?? `[${evtType}${evtSub}]`;
          for (const l of line.split("\n").filter(Boolean)) {
            appendReviewOutput(reviewId, l);
            taskEvents.emit("review:output", {
              line: l,
              reviewId,
              stream: "stdout",
            });
          }
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
          {
            code,
            stderr: stderr.slice(0, 2000),
            stdout: stdout.slice(0, 2000),
          },
          "Review exited with error",
        );
        resolve({ output: null, success: false });
        return;
      }

      const text = resultText || stdout;
      const parsed = parseReviewOutput(text);

      if (!parsed) {
        log.error(
          {
            resultText: resultText.slice(0, 3000),
            stdoutTail: stdout.slice(-2000),
          },
          "Failed to parse review output",
        );
      }

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

function tryParseReview(text: string): ClaudeReviewOutput | null {
  try {
    const parsed = JSON.parse(text) as ClaudeReviewOutput;
    if (typeof parsed.summary === "string" && Array.isArray(parsed.comments)) {
      return parsed;
    }
  } catch {
    // Not valid JSON
  }
  return null;
}
