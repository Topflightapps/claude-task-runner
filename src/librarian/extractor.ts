import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

  try {
    const { stdout } = await execFileAsync("claude", ["-p", prompt], {
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION: undefined,
        CLAUDECODE: undefined,
      },
      timeout: EXTRACTION_TIMEOUT_MS,
    });

    const trimmed = stdout.trim();

    // Try to extract JSON array from the response
    const jsonMatch = /\[[\s\S]*\]/.exec(trimmed);
    if (!jsonMatch) {
      return [];
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
