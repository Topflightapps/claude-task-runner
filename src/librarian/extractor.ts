import { getConfig } from "../config.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("librarian:extractor");

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
  const config = getConfig();
  const apiKey = config.ANTHROPIC_API_KEY;

  if (!apiKey) {
    log.warn("No ANTHROPIC_API_KEY — skipping learning extraction");
    return [];
  }

  const userPrompt = `Source agent: ${sourceAgent}\n\nAgent output to analyze:\n${rawText}`;

  try {
    log.info(
      { promptLength: userPrompt.length, sourceAgent },
      "Extracting learnings",
    );

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      log.error(
        { status: response.status, body: body.slice(0, 500) },
        "Anthropic API error during extraction",
      );
      return [];
    }

    const json = (await response.json()) as {
      content: { text?: string; type: string }[];
    };

    const text = json.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("");

    const trimmed = text.trim();
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
