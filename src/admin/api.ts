import type { IncomingMessage, ServerResponse } from "node:http";

import { rmSync } from "node:fs";

import { deleteCompletedRuns, deleteRepo, getRun, listRepos, listRuns, updateRun } from "../db.js";
import { activeProcesses, cancelledRuns, outputBuffer, taskEvents } from "../events.js";
import { handleLogin, validateAuth } from "./auth.js";

export function handleAdminApi(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
    req.on("end", () => { resolve(Buffer.concat(chunks).toString()); });
    req.on("error", reject);
  });
}
