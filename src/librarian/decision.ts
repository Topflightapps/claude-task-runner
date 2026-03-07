import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DECISION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

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

const DECISION_PROMPT = `You are a Librarian agent that manages a knowledge base of learnings. You must decide what to do with a new learning given the most similar existing learnings.

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
{"decision": "SKIP"}

New learning:
{NEW_LEARNING}

Similar existing learnings:
{SIMILAR_LEARNINGS}
`;

export async function decideLearning(
  newLearning: string,
  similarLearnings: SimilarLearning[],
): Promise<Decision> {
  const prompt = DECISION_PROMPT.replace("{NEW_LEARNING}", newLearning).replace(
    "{SIMILAR_LEARNINGS}",
    formatSimilarLearnings(similarLearnings),
  );

  try {
    const { stdout } = await execFileAsync("claude", ["-p", prompt], {
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION: undefined,
        CLAUDECODE: undefined,
      },
      timeout: DECISION_TIMEOUT_MS,
    });

    const trimmed = stdout.trim();

    // Extract JSON object from response
    const jsonMatch = /\{[\s\S]*\}/.exec(trimmed);
    if (!jsonMatch) {
      return defaultDecision();
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    return parseDecision(parsed);
  } catch {
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
