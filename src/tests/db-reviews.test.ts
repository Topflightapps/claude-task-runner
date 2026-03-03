import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock config before importing db
vi.mock("../config.js", () => ({
  getConfig: () => ({ DB_PATH: ":memory:" }),
}));

// Mock logger
vi.mock("../logger.js", () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe("review_runs database operations", () => {
  let db: Database.Database;

  beforeEach(async () => {
    // We need to reset the module state for each test since db.ts caches the instance
    vi.resetModules();
    const dbMod = await import("../db.js");
    db = dbMod.initDb();
  });

  afterEach(() => {
    db?.close();
  });

  it("should insert and retrieve a review run", async () => {
    const { insertReviewRun, getReviewRun } = await import("../db.js");

    const id = insertReviewRun({
      pr_branch: "feature/test",
      pr_number: 42,
      pr_title: "Test PR",
      pr_url: "https://github.com/owner/repo/pull/42",
      repo_full_name: "owner/repo",
    });

    expect(id).toBeGreaterThan(0);

    const run = getReviewRun(id);
    expect(run).toBeDefined();
    expect(run!.pr_number).toBe(42);
    expect(run!.repo_full_name).toBe("owner/repo");
    expect(run!.pr_branch).toBe("feature/test");
    expect(run!.status).toBe("queued");
  });

  it("should enforce unique constraint on (repo_full_name, pr_number)", async () => {
    const { insertReviewRun } = await import("../db.js");

    insertReviewRun({
      pr_branch: "feature/test",
      pr_number: 42,
      pr_title: "Test PR",
      pr_url: "https://github.com/owner/repo/pull/42",
      repo_full_name: "owner/repo",
    });

    expect(() =>
      insertReviewRun({
        pr_branch: "feature/test-2",
        pr_number: 42,
        pr_title: "Duplicate PR",
        pr_url: "https://github.com/owner/repo/pull/42",
        repo_full_name: "owner/repo",
      }),
    ).toThrow();
  });

  it("should allow same PR number in different repos", async () => {
    const { insertReviewRun } = await import("../db.js");

    const id1 = insertReviewRun({
      pr_branch: "feature/a",
      pr_number: 1,
      pr_title: "PR in repo A",
      pr_url: "https://github.com/owner/repoA/pull/1",
      repo_full_name: "owner/repoA",
    });

    const id2 = insertReviewRun({
      pr_branch: "feature/b",
      pr_number: 1,
      pr_title: "PR in repo B",
      pr_url: "https://github.com/owner/repoB/pull/1",
      repo_full_name: "owner/repoB",
    });

    expect(id1).not.toBe(id2);
  });

  it("should look up review by PR", async () => {
    const { insertReviewRun, getReviewRunByPR } = await import("../db.js");

    insertReviewRun({
      pr_branch: "feature/test",
      pr_number: 10,
      pr_title: "Test",
      pr_url: "https://github.com/org/repo/pull/10",
      repo_full_name: "org/repo",
    });

    const found = getReviewRunByPR("org/repo", 10);
    expect(found).toBeDefined();
    expect(found!.pr_number).toBe(10);

    const notFound = getReviewRunByPR("org/repo", 999);
    expect(notFound).toBeUndefined();
  });

  it("should detect active reviews", async () => {
    const { insertReviewRun, hasActiveReview, updateReviewRun } = await import(
      "../db.js"
    );

    const id = insertReviewRun({
      pr_branch: "feature/test",
      pr_number: 5,
      pr_title: "Test",
      pr_url: "https://github.com/org/repo/pull/5",
      repo_full_name: "org/repo",
    });

    expect(hasActiveReview("org/repo", 5)).toBe(true);

    // Mark as ready — no longer "active"
    updateReviewRun(id, { status: "ready" });
    expect(hasActiveReview("org/repo", 5)).toBe(false);
  });

  it("should update review run fields", async () => {
    const { insertReviewRun, getReviewRun, updateReviewRun } = await import(
      "../db.js"
    );

    const id = insertReviewRun({
      pr_branch: "feature/test",
      pr_number: 7,
      pr_title: "Test",
      pr_url: "https://github.com/org/repo/pull/7",
      repo_full_name: "org/repo",
    });

    updateReviewRun(id, {
      comment_count: 3,
      cost_usd: 0.05,
      review_id: 12345,
      status: "ready",
    });

    const run = getReviewRun(id)!;
    expect(run.status).toBe("ready");
    expect(run.comment_count).toBe(3);
    expect(run.cost_usd).toBe(0.05);
    expect(run.review_id).toBe(12345);
  });

  it("should delete completed reviews", async () => {
    const { insertReviewRun, updateReviewRun, deleteCompletedReviews, listReviewRuns } =
      await import("../db.js");

    const id1 = insertReviewRun({
      pr_branch: "a",
      pr_number: 1,
      pr_title: "A",
      pr_url: "https://github.com/o/r/pull/1",
      repo_full_name: "o/r",
    });
    const id2 = insertReviewRun({
      pr_branch: "b",
      pr_number: 2,
      pr_title: "B",
      pr_url: "https://github.com/o/r/pull/2",
      repo_full_name: "o/r",
    });

    updateReviewRun(id1, { status: "ready" });
    // id2 stays as "queued" (active)

    const deleted = deleteCompletedReviews();
    expect(deleted).toBe(1);

    const { rows } = listReviewRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id2);
  });

  it("should mark stale reviews as failed on restart", async () => {
    const { insertReviewRun, updateReviewRun, markStaleReviewsAsFailed, getReviewRun } =
      await import("../db.js");

    const id1 = insertReviewRun({
      pr_branch: "a",
      pr_number: 1,
      pr_title: "A",
      pr_url: "https://github.com/o/r/pull/1",
      repo_full_name: "o/r",
    });
    const id2 = insertReviewRun({
      pr_branch: "b",
      pr_number: 2,
      pr_title: "B",
      pr_url: "https://github.com/o/r/pull/2",
      repo_full_name: "o/r",
    });
    const id3 = insertReviewRun({
      pr_branch: "c",
      pr_number: 3,
      pr_title: "C",
      pr_url: "https://github.com/o/r/pull/3",
      repo_full_name: "o/r",
    });

    updateReviewRun(id1, { status: "reviewing" });
    updateReviewRun(id2, { status: "ready" });
    // id3 stays "queued"

    markStaleReviewsAsFailed();

    // "reviewing" and "queued" should be marked failed
    expect(getReviewRun(id1)!.status).toBe("failed");
    expect(getReviewRun(id1)!.error_message).toBe("Process restarted");

    // "ready" should be untouched
    expect(getReviewRun(id2)!.status).toBe("ready");

    // "queued" should be marked failed
    expect(getReviewRun(id3)!.status).toBe("failed");
  });
});
