import type { IncomingMessage, ServerResponse } from "node:http";

import { rmSync } from "node:fs";

import {
  deleteCompletedReviews,
  deleteCompletedRuns,
  deleteRepo,
  deleteReviewRun,
  getReviewRun,
  getRun,
  getSetting,
  listRepos,
  listReviewRuns,
  listRuns,
  resetReviewRun,
  setSetting,
  updateReviewRun,
  updateRun,
} from "../db.js";
import {
  activeProcesses,
  activeReviewProcesses,
  cancelledRuns,
  outputBuffer,
  reviewOutputBuffer,
  taskEvents,
} from "../events.js";
import {
  deleteLearning,
  getLearningStats,
  listLearnings,
} from "../librarian/learnings-db.js";
import { cancelAllReviews } from "../review/queue.js";
import { handleLogin, validateAuth } from "./auth.js";

export function handleAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  const path = url.pathname;
  const method = req.method ?? "GET";

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Login doesn't require auth
  if (path === "/api/auth/login" && method === "POST") {
    handleLogin(req, res);
    return;
  }

  // Auth check for everything else
  if (!validateAuth(req)) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  // GET /api/learnings
  if (path === "/api/learnings" && method === "GET") {
    const category = url.searchParams.get("category") ?? undefined;
    const project_type = url.searchParams.get("project_type") ?? undefined;
    const source_agent = url.searchParams.get("source_agent") ?? undefined;
    const search = url.searchParams.get("search") ?? undefined;
    const tag = url.searchParams.get("tag") ?? undefined;
    const sort = url.searchParams.get("sort") ?? undefined;
    const limit = Number(url.searchParams.get("limit")) || 50;
    const offset = Number(url.searchParams.get("offset")) || 0;
    const result = listLearnings({
      category,
      limit,
      offset,
      project_type,
      search,
      sort,
      source_agent,
      tag,
    });
    json(res, 200, result);
    return;
  }

  // GET /api/learnings/stats
  if (path === "/api/learnings/stats" && method === "GET") {
    const stats = getLearningStats();
    json(res, 200, stats);
    return;
  }

  // DELETE /api/learnings/:id
  const learningDeleteMatch = /^\/api\/learnings\/(\d+)$/.exec(path);
  if (learningDeleteMatch && method === "DELETE") {
    const id = Number(learningDeleteMatch[1]);
    const deleted = deleteLearning(id);
    if (!deleted) {
      json(res, 404, { error: "Learning not found" });
      return;
    }
    json(res, 200, { ok: true });
    return;
  }

  // GET /api/runs
  if (path === "/api/runs" && method === "GET") {
    const status = url.searchParams.get("status") ?? undefined;
    const limit = Number(url.searchParams.get("limit")) || 50;
    const offset = Number(url.searchParams.get("offset")) || 0;
    const result = listRuns({ limit, offset, status });
    json(res, 200, result);
    return;
  }

  // GET /api/runs/active
  if (path === "/api/runs/active" && method === "GET") {
    const { rows } = listRuns({ status: "running_claude" });
    const cloning = listRuns({ status: "cloning" }).rows;
    const claimed = listRuns({ status: "claimed" }).rows;
    const creatingPr = listRuns({ status: "creating_pr" }).rows;
    const active = [...rows, ...cloning, ...claimed, ...creatingPr];
    const currentRun = active.length > 0 ? active[0] : null;
    const buffer = currentRun ? (outputBuffer.get(currentRun.id) ?? []) : [];

    json(res, 200, {
      currentRun,
      output: buffer,
    });
    return;
  }

  // POST /api/runs/:id/cancel
  const cancelMatch = /^\/api\/runs\/(\d+)\/cancel$/.exec(path);
  if (cancelMatch && method === "POST") {
    const id = Number(cancelMatch[1]);
    const run = getRun(id);
    if (!run) {
      json(res, 404, { error: "Run not found" });
      return;
    }
    if (run.status === "done" || run.status === "failed") {
      json(res, 400, { error: "Run already finished" });
      return;
    }

    cancelledRuns.add(id);
    const proc = activeProcesses.get(id);
    if (proc) {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5_000);
    }

    updateRun(id, { error_message: "Cancelled by admin", status: "failed" });
    taskEvents.emit("status:changed", { runId: id, status: "failed" });

    json(res, 200, { ok: true });
    return;
  }

  // POST /api/runs/:id/retry
  const retryMatch = /^\/api\/runs\/(\d+)\/retry$/.exec(path);
  if (retryMatch && method === "POST") {
    const id = Number(retryMatch[1]);
    const run = getRun(id);
    if (!run) {
      json(res, 404, { error: "Run not found" });
      return;
    }
    if (run.status !== "failed") {
      json(res, 400, { error: "Only failed runs can be retried" });
      return;
    }

    // We need to get enqueueTask from webhook — use dynamic import to avoid circular deps
    void (async () => {
      try {
        const body = await readBody(req);
        void body; // unused but drain the stream
        const { enqueueTask } = await import("../webhook.js");
        enqueueTask(run.clickup_id);
        json(res, 200, { ok: true });
      } catch {
        json(res, 500, { error: "Failed to re-queue task" });
      }
    })();
    return;
  }

  // DELETE /api/runs/completed
  if (path === "/api/runs/completed" && method === "DELETE") {
    const count = deleteCompletedRuns();
    json(res, 200, { deleted: count });
    return;
  }

  // GET /api/repos
  if (path === "/api/repos" && method === "GET") {
    const repos = listRepos();
    json(res, 200, { repos });
    return;
  }

  // DELETE /api/repos/:id
  const repoDeleteMatch = /^\/api\/repos\/(\d+)$/.exec(path);
  if (repoDeleteMatch && method === "DELETE") {
    const id = Number(repoDeleteMatch[1]);
    const repo = deleteRepo(id);
    if (!repo) {
      json(res, 404, { error: "Repo not found" });
      return;
    }

    // Remove from disk
    try {
      rmSync(repo.disk_path, { force: true, recursive: true });
    } catch {
      // Directory may already be gone
    }

    json(res, 200, { deleted: true, disk_path: repo.disk_path });
    return;
  }

  // GET /api/reviews
  if (path === "/api/reviews" && method === "GET") {
    const status = url.searchParams.get("status") ?? undefined;
    const limit = Number(url.searchParams.get("limit")) || 50;
    const offset = Number(url.searchParams.get("offset")) || 0;
    const result = listReviewRuns({ limit, offset, status });
    json(res, 200, result);
    return;
  }

  // GET /api/reviews/active
  if (path === "/api/reviews/active" && method === "GET") {
    const reviewing = listReviewRuns({ status: "reviewing" }).rows;
    const cloning = listReviewRuns({ status: "cloning" }).rows;
    const queued = listReviewRuns({ status: "queued" }).rows;
    const active = [...reviewing, ...cloning, ...queued];
    const currentReview = active.length > 0 ? active[0] : null;
    const buffer = currentReview
      ? (reviewOutputBuffer.get(currentReview.id) ?? [])
      : [];

    json(res, 200, { currentReview, output: buffer });
    return;
  }

  // POST /api/reviews/:id/cancel
  const reviewCancelMatch = /^\/api\/reviews\/(\d+)\/cancel$/.exec(path);
  if (reviewCancelMatch && method === "POST") {
    const id = Number(reviewCancelMatch[1]);
    const review = getReviewRun(id);
    if (!review) {
      json(res, 404, { error: "Review not found" });
      return;
    }
    if (review.status === "ready" || review.status === "failed") {
      json(res, 400, { error: "Review already finished" });
      return;
    }

    const proc = activeReviewProcesses.get(id);
    if (proc) {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5_000);
    }

    updateReviewRun(id, {
      error_message: "Cancelled by admin",
      status: "failed",
    });
    taskEvents.emit("review:status", { reviewId: id, status: "failed" });

    json(res, 200, { ok: true });
    return;
  }

  // POST /api/reviews/:id/retry
  const reviewRetryMatch = /^\/api\/reviews\/(\d+)\/retry$/.exec(path);
  if (reviewRetryMatch && method === "POST") {
    const id = Number(reviewRetryMatch[1]);
    const review = getReviewRun(id);
    if (!review) {
      json(res, 404, { error: "Review not found" });
      return;
    }
    if (review.status !== "failed") {
      json(res, 400, { error: "Only failed reviews can be retried" });
      return;
    }

    void (async () => {
      try {
        const body = await readBody(req);
        void body;
        const { enqueueReviewById } = await import("../review/queue.js");
        resetReviewRun(id);
        enqueueReviewById(id);
        json(res, 200, { ok: true });
      } catch {
        json(res, 500, { error: "Failed to re-queue review" });
      }
    })();
    return;
  }

  // DELETE /api/reviews/:id — dismiss individual review
  const reviewDeleteMatch = /^\/api\/reviews\/(\d+)$/.exec(path);
  if (reviewDeleteMatch && method === "DELETE") {
    const id = Number(reviewDeleteMatch[1]);
    const review = getReviewRun(id);
    if (!review) {
      json(res, 404, { error: "Review not found" });
      return;
    }
    if (
      !["approved", "changes_requested", "failed", "ready"].includes(
        review.status,
      )
    ) {
      json(res, 400, { error: "Can only dismiss finished reviews" });
      return;
    }
    deleteReviewRun(id);
    json(res, 200, { ok: true });
    return;
  }

  // DELETE /api/reviews/completed — also kills running reviews and clears queue
  if (path === "/api/reviews/completed" && method === "DELETE") {
    const cancelled = cancelAllReviews();
    const deleted = deleteCompletedReviews();
    json(res, 200, { cancelled, deleted });
    return;
  }

  // POST /api/reviews/sync
  if (path === "/api/reviews/sync" && method === "POST") {
    void (async () => {
      try {
        const { syncPendingReviews } = await import("../review/sync.js");
        const enqueued = await syncPendingReviews();
        json(res, 200, { enqueued });
      } catch {
        json(res, 500, { error: "Failed to sync reviews" });
      }
    })();
    return;
  }

  // GET /api/settings/reviews-enabled
  if (path === "/api/settings/reviews-enabled" && method === "GET") {
    const enabled = getSetting("reviews_enabled", "true") === "true";
    json(res, 200, { enabled });
    return;
  }

  // PUT /api/settings/reviews-enabled
  if (path === "/api/settings/reviews-enabled" && method === "PUT") {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { enabled: boolean };
        setSetting("reviews_enabled", body.enabled ? "true" : "false");
        json(res, 200, { enabled: body.enabled });
      } catch {
        json(res, 400, { error: "Invalid request body" });
      }
    })();
    return;
  }

  json(res, 404, { error: "Not found" });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString());
    });
    req.on("error", reject);
  });
}
