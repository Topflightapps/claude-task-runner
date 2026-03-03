import { describe, expect, it } from "vitest";

import type { ClaudeReviewOutput } from "../github/types.js";

/**
 * Tests for parsing Claude review output. The review runner expects
 * Claude to output JSON with { summary, comments: [{ path, line, body, side }] }.
 * Uses balanced-brace extraction to handle various output formats.
 */

// Mirrors the implementation in review-runner.ts
function parseReviewOutput(text: string): ClaudeReviewOutput | null {
  const stripped = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");

  const result = tryParseReview(stripped);
  if (result) return result;

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
      }
    }
  }

  return null;
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

describe("parseReviewOutput", () => {
  it("should parse clean JSON output", () => {
    const input = JSON.stringify({
      comments: [
        {
          body: "Consider using const",
          line: 10,
          path: "src/foo.ts",
          side: "RIGHT",
        },
      ],
      summary: "Looks good overall",
    });

    const result = parseReviewOutput(input);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe("Looks good overall");
    expect(result?.comments).toHaveLength(1);
    expect(result?.comments[0]?.path).toBe("src/foo.ts");
  });

  it("should extract JSON from surrounding text", () => {
    const input = `Here is my review:

${JSON.stringify({
  comments: [{ body: "Bug here", line: 5, path: "lib/utils.ts" }],
  summary: "Found a bug",
})}

That concludes my review.`;

    const result = parseReviewOutput(input);
    expect(result).not.toBeNull();
    expect(result?.comments).toHaveLength(1);
  });

  it("should handle empty comments array", () => {
    const input = JSON.stringify({
      comments: [],
      summary: "PR looks clean, no issues found",
    });

    const result = parseReviewOutput(input);
    expect(result).not.toBeNull();
    expect(result?.comments).toHaveLength(0);
    expect(result?.summary).toBe("PR looks clean, no issues found");
  });

  it("should return null for non-JSON input", () => {
    expect(parseReviewOutput("This is just plain text")).toBeNull();
  });

  it("should return null for JSON without comments field", () => {
    expect(parseReviewOutput('{"summary": "test"}')).toBeNull();
  });

  it("should return null for malformed JSON", () => {
    expect(parseReviewOutput('{"comments": [, "summary": "test"}')).toBeNull();
  });

  it("should handle multiple comments", () => {
    const input = JSON.stringify({
      comments: [
        { body: "Comment 1", line: 1, path: "a.ts", side: "RIGHT" },
        { body: "Comment 2", line: 20, path: "b.ts", side: "RIGHT" },
        { body: "Comment 3", line: 50, path: "c.ts", side: "LEFT" },
      ],
      summary: "Multiple issues",
    });

    const result = parseReviewOutput(input);
    expect(result).not.toBeNull();
    expect(result?.comments).toHaveLength(3);
  });

  it("should handle JSON wrapped in markdown code fences", () => {
    const json = JSON.stringify({
      comments: [{ body: "Issue", line: 1, path: "x.ts" }],
      summary: "Review",
    });
    const input = "```json\n" + json + "\n```";

    const result = parseReviewOutput(input);
    expect(result).not.toBeNull();
  });

  it("should handle JSON with triple backticks and language tag", () => {
    const input =
      "Here's the review:\n\n```json\n" +
      '{"summary": "Good PR", "comments": [{"path": "a.ts", "line": 1, "body": "nit"}]}' +
      "\n```\n\nDone.";

    const result = parseReviewOutput(input);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe("Good PR");
  });

  it("should handle JSON preceded by non-JSON braces", () => {
    // e.g. Claude says "The function foo() { ... } has issues" before the JSON
    const input =
      "I looked at the code.\n\n" +
      '{"summary": "Found issues", "comments": [{"path": "x.ts", "line": 5, "body": "Bug"}]}';

    const result = parseReviewOutput(input);
    expect(result).not.toBeNull();
    expect(result?.comments).toHaveLength(1);
  });
});
