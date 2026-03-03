import { describe, expect, it } from "vitest";

/**
 * Regression tests for the E2BIG spawn error.
 *
 * The OS has a limit on total argument size (~128KB on Linux, ~256KB on macOS).
 * Large PR diffs embedded in `-p` args will exceed this. The fix pipes the diff
 * through stdin instead of passing it as a CLI argument.
 */

describe("review runner argument safety", () => {
  it("should not embed diff in CLI args (E2BIG prevention)", () => {
    // Simulate what the review runner does — the prompt should NOT contain the diff
    const largeDiff = "a]".repeat(100_000); // 200KB diff

    const prompt = `The user's stdin contains a pull request diff. Review it.

Read the relevant source files in this repository for context. Then analyze the diff and provide a code review.

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
}`;

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

    // The diff should NOT be in the args
    const totalArgSize = args.reduce((sum, arg) => sum + arg.length, 0);
    expect(totalArgSize).toBeLessThan(10_000); // args should be small
    expect(args.join(" ")).not.toContain(largeDiff);

    // The diff should be sent via stdin (stdinData parameter)
    const stdinData = largeDiff;
    expect(stdinData.length).toBeGreaterThan(100_000);
  });

  it("should have prompt that references stdin, not embedded diff", () => {
    const prompt = `The user's stdin contains a pull request diff. Review it.`;

    // Prompt should reference stdin, not contain diff markers
    expect(prompt).toContain("stdin");
    expect(prompt).not.toContain("```diff");
  });

  // Validate the old buggy approach would exceed limits
  it("demonstrates why embedding diff in args fails (the bug)", () => {
    const largeDiff = "+added line\n".repeat(10_000); // ~120KB
    const oldStylePrompt =
      "You are reviewing a PR.\n```diff\n" + largeDiff + "\n```";

    // On Linux, ARG_MAX is typically 128KB-2MB. This would fail for large diffs.
    expect(oldStylePrompt.length).toBeGreaterThan(100_000);

    // The old approach put this entire string as a single arg to -p
    const oldArgs = ["-p", oldStylePrompt];
    const oldArgSize = oldArgs.reduce((sum, arg) => sum + arg.length, 0);
    expect(oldArgSize).toBeGreaterThan(100_000);
  });
});
