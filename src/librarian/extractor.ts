import { spawn } from "node:child_process";

import { createChildLogger } from "../logger.js";

const log = createChildLogger("librarian:extractor");

const EXTRACTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const SYSTEM_PROMPT = `You are a learning extractor. Extract specific, reusable learnings from agent output.

Focus on:
- Codebase patterns and conventions discovered
- Gotchas and non-obvious requirements
- Useful debugging techniques
- Architecture decisions and their rationale
- Common mistakes to avoid

Return ONLY a JSON array of strings, where each string is a concise, actionable learning.
Example: ["Always use IF NOT EXISTS for SQLite migrations", "The config module requires .transform() for boolean env vars"]

If no useful learnings can be extracted, return an empty array: []`;

export async function extractLearnings(
  rawText: string,
  sourceAgent: string,
): Promise<string[]> {
  const userPrompt = `Source agent: ${sourceAgent}\n\nAgent output to analyze:\n${rawText}`;
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`;

  try {
    log.info(
      { promptLength: fullPrompt.length, sourceAgent },
      "Extracting learnings via claude -p",
    );

    const output = await runClaudePrompt(fullPrompt);

    const trimmed = output.trim();
    log.debug({ outputLength: trimmed.length }, "Extraction output received");

    const jsonMatch = /\[[\s\S]*\]/.exec(trimmed);
    if (!jsonMatch) {
      log.warn(
        { output: trimmed.slice(0, 500) },
        "No JSON array found in extraction output",
      );
      return [];
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      log.warn("Parsed extraction output is not an array");
      return [];
    }

    const learnings = parsed.filter(
      (item): item is string => typeof item === "string",
    );
    log.info({ count: learnings.length }, "Learnings extracted");
    return learnings;
  } catch (error) {
    log.error(error, "Failed to extract learnings");
    return [];
  }
}

function runClaudePrompt(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_SESSION;

    const child = spawn("claude", ["-p", prompt], {
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.end();

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude -p timed out after ${String(EXTRACTION_TIMEOUT_MS / 1000)}s`));
    }, EXTRACTION_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        log.error(
          { code, stderr: stderr.slice(0, 500) },
          "claude -p exited with non-zero code",
        );
        reject(new Error(`claude -p exited with code ${String(code)}`));
        return;
      }
      resolve(stdout);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
