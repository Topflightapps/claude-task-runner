import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createChildLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createChildLogger("librarian:extractor");

const EXTRACTION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const EXTRACTION_PROMPT = `You are a learning extractor. Analyze the following agent output and extract specific, reusable learnings that would help future agents working on similar tasks.

Focus on:
- Codebase patterns and conventions discovered
- Gotchas and non-obvious requirements
- Useful debugging techniques
- Architecture decisions and their rationale
- Common mistakes to avoid

Return ONLY a JSON array of strings, where each string is a concise, actionable learning.
Example: ["Always use IF NOT EXISTS for SQLite migrations", "The config module requires .transform() for boolean env vars"]

If no useful learnings can be extracted, return an empty array: []

Source agent: {SOURCE_AGENT}

Agent output to analyze:
`;

export async function extractLearnings(
  rawText: string,
  sourceAgent: string,
): Promise<string[]> {
  const prompt =
    EXTRACTION_PROMPT.replace("{SOURCE_AGENT}", sourceAgent) + rawText;

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_SESSION;

  try {
    log.info(
      { promptLength: prompt.length, sourceAgent },
      "Extracting learnings",
    );
    const { stdout, stderr } = await execFileAsync("claude", ["-p", prompt], {
      env: cleanEnv,
      timeout: EXTRACTION_TIMEOUT_MS,
    });

    if (stderr) {
      log.warn({ stderr: stderr.slice(0, 500) }, "Claude stderr during extraction");
    }

    const trimmed = stdout.trim();
    log.debug({ outputLength: trimmed.length }, "Extraction output received");

    // Try to extract JSON array from the response
    const jsonMatch = /\[[\s\S]*\]/.exec(trimmed);
    if (!jsonMatch) {
      log.warn({ output: trimmed.slice(0, 500) }, "No JSON array found in extraction output");
      return [];
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      log.warn("Parsed extraction output is not an array");
      return [];
    }

    const learnings = parsed.filter((item): item is string => typeof item === "string");
    log.info({ count: learnings.length }, "Learnings extracted");
    return learnings;
  } catch (error) {
    log.error(error, "Failed to extract learnings");
    return [];
  }
}
