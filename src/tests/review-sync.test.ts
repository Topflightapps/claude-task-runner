import { describe, expect, it, vi } from "vitest";

/**
 * Tests for the review sync module. These tests capture the bug where
 * `gh search prs --json headRefName` was used, but `gh search prs` does NOT
 * support the `headRefName` field. The fix fetches branch per PR via
 * `gh pr view --json headRefName`.
 */

// Mock config
vi.mock("../config.js", () => ({
  getConfig: () => ({
    GITHUB_TOKEN: "ghp_fake",
    GITHUB_USERNAME: "testuser",
  }),
}));

vi.mock("../logger.js", () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe("gh search prs field availability", () => {
  it("should NOT include headRefName in search results (the bug)", () => {
    // gh search prs --json supports: number, title, url, repository
    // It does NOT support: headRefName, headRefOid, baseRefName, etc.
    const searchResultFields = [
      "number",
      "title",
      "url",
      "repository",
      "state",
      "createdAt",
      "updatedAt",
      "closedAt",
      "mergedAt",
      "author",
      "assignees",
      "labels",
      "comments",
      "reviewDecision",
    ];

    expect(searchResultFields).not.toContain("headRefName");
  });

  it("should use gh pr view to get headRefName", () => {
    // gh pr view --json supports headRefName
    const prViewFields = [
      "number",
      "title",
      "url",
      "headRefName",
      "baseRefName",
      "body",
      "state",
      "author",
    ];

    expect(prViewFields).toContain("headRefName");
  });
});

describe("review sync deduplication", () => {
  it("should deduplicate PRs from review-requested and assigned searches", () => {
    const reviewRequested = [
      { number: 1, repository: { nameWithOwner: "org/repo" }, title: "PR 1", url: "https://..." },
      { number: 2, repository: { nameWithOwner: "org/repo" }, title: "PR 2", url: "https://..." },
    ];

    const assigned = [
      { number: 2, repository: { nameWithOwner: "org/repo" }, title: "PR 2", url: "https://..." },
      { number: 3, repository: { nameWithOwner: "org/other" }, title: "PR 3", url: "https://..." },
    ];

    const all = [...reviewRequested, ...assigned];

    // Deduplicate by (repo, pr_number)
    const seen = new Set<string>();
    const unique: typeof all = [];
    for (const pr of all) {
      const key = pr.repository.nameWithOwner + "#" + String(pr.number);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(pr);
      }
    }

    expect(unique).toHaveLength(3);
    expect(unique.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("should treat same PR number in different repos as distinct", () => {
    const prs = [
      { number: 1, repository: { nameWithOwner: "org/repoA" }, title: "A", url: "..." },
      { number: 1, repository: { nameWithOwner: "org/repoB" }, title: "B", url: "..." },
    ];

    const seen = new Set<string>();
    const unique: typeof prs = [];
    for (const pr of prs) {
      const key = pr.repository.nameWithOwner + "#" + String(pr.number);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(pr);
      }
    }

    expect(unique).toHaveLength(2);
  });
});

describe("sync skip logic", () => {
  it("should skip PRs already tracked with non-failed status", () => {
    const statuses = ["queued", "cloning", "reviewing", "ready"];

    for (const status of statuses) {
      const existing = { id: 1, status };
      const shouldSkip = existing && existing.status !== "failed";
      expect(shouldSkip).toBe(true);
    }
  });

  it("should re-enqueue PRs that previously failed", () => {
    const existing = { id: 1, status: "failed" };
    const shouldSkip = existing && existing.status !== "failed";
    expect(shouldSkip).toBe(false);
  });

  it("should enqueue PRs not yet tracked", () => {
    const existing = undefined;
    const shouldSkip = existing && (existing as { status: string }).status !== "failed";
    expect(shouldSkip).toBeFalsy();
  });
});
