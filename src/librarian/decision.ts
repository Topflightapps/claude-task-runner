import { getConfig } from "../config.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("librarian:decision");

export type Decision =
  | { existingId: number; metadata: LearningMetadata; type: "REPLACE" }
  | { existingId: number; metadata: LearningMetadata; type: "UPDATE" }
  | { metadata: LearningMetadata; type: "FILE_NEW" }
  | { type: "SKIP" };

export interface LearningMetadata {
  category: null | string;
  project_type: null | string;
  tags: string[];
}

interface SimilarLearning {
  content: string;
  id: number;
  score: number;
}

const SYSTEM_PROMPT = `You are a Librarian agent that manages a knowledge base of learnings. You must decide what to do with a new learning given the most similar existing learnings.

Possible decisions:
- SKIP: The new learning is already covered by an existing one, or is too vague/useless to store.
- UPDATE: The new learning adds useful detail to an existing one. Provide the existing learning's id.
- REPLACE: The new learning supersedes/corrects an existing one. Provide the existing learning's id.
- FILE_NEW: The new learning is novel and should be stored as a new entry.

Also extract metadata for the learning:
- category: One of "pattern", "gotcha", "architecture", "debugging", "testing", "tooling", "convention", or null if unclear.
- tags: An array of short keyword tags (e.g. ["sqlite", "migrations", "schema"]).
- project_type: The type of project this applies to (e.g. "nextjs", "node-cli", "react"), or null if general.

Return ONLY a JSON object in this exact format (no markdown, no explanation):
{"decision": "FILE_NEW", "metadata": {"category": "pattern", "tags": ["example"], "project_type": null}}

For UPDATE or REPLACE, include "existingId":
{"decision": "UPDATE", "existingId": 42, "metadata": {"category": "gotcha", "tags": ["config"], "project_type": null}}

For SKIP:
{"decision": "SKIP"}`;

export async function decideLearning(
  newLearning: string,
  similarLearnings: SimilarLearning[],
): Promise<Decision> {
  const config = getConfig();
  const apiKey = config.ANTHROPIC_API_KEY;

  if (!apiKey) {
    log.warn("No ANTHROPIC_API_KEY — defaulting to FILE_NEW");
    return defaultDecision();
  }

  const userPrompt = `New learning:\n${newLearning}\n\nSimilar existing learnings:\n${formatSimilarLearnings(similarLearnings)}`;

  try {
    log.info("Running Librarian decision");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      log.error(
        { status: response.status, body: body.slice(0, 500) },
        "Anthropic API error during decision",
      );
      return defaultDecision();
    }

    const json = (await response.json()) as {
      content: { text?: string; type: string }[];
    };

    const text = json.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("");

    const trimmed = text.trim();

    const jsonMatch = /\{[\s\S]*\}/.exec(trimmed);
    if (!jsonMatch) {
      log.warn(
        { output: trimmed.slice(0, 500) },
        "No JSON object found in decision output",
      );
      return defaultDecision();
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    const decision = parseDecision(parsed);
    log.info({ type: decision.type }, "Librarian decision made");
    return decision;
  } catch (error) {
    log.error(error, "Failed to run Librarian decision");
    return defaultDecision();
  }
}

function defaultDecision(): Decision {
  return {
    metadata: { category: null, project_type: null, tags: [] },
    type: "FILE_NEW",
  };
}

function formatSimilarLearnings(learnings: SimilarLearning[]): string {
  if (learnings.length === 0) {
    return "(none)";
  }
  return learnings
    .map(
      (l) =>
        `[ID: ${String(l.id)}, similarity: ${l.score.toFixed(3)}] ${l.content}`,
    )
    .join("\n");
}

function parseDecision(raw: unknown): Decision {
  if (!raw || typeof raw !== "object") {
    return {
      metadata: { category: null, project_type: null, tags: [] },
      type: "FILE_NEW",
    };
  }

  const obj = raw as Record<string, unknown>;
  const decision = obj.decision;
  const metadata = parseMetadata(obj.metadata);

  if (decision === "SKIP") {
    return { type: "SKIP" };
  }

  if (
    (decision === "UPDATE" || decision === "REPLACE") &&
    typeof obj.existingId === "number"
  ) {
    return { existingId: obj.existingId, metadata, type: decision };
  }

  return { metadata, type: "FILE_NEW" };
}

function parseMetadata(raw: unknown): LearningMetadata {
  if (!raw || typeof raw !== "object") {
    return { category: null, project_type: null, tags: [] };
  }

  const obj = raw as Record<string, unknown>;

  return {
    category: typeof obj.category === "string" ? obj.category : null,
    project_type:
      typeof obj.project_type === "string" ? obj.project_type : null,
    tags: Array.isArray(obj.tags)
      ? obj.tags.filter((t): t is string => typeof t === "string")
      : [],
  };
}
