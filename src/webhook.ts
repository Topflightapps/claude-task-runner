import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

import type { ClickUpWebhookPayload } from "./clickup/types.js";
import type {
  GitHubPullRequestEvent,
  GitHubPullRequestReviewEvent,
} from "./github/types.js";

import { handleAdminApi } from "./admin/api.js";
import { handleUpgrade, setupWebSocket } from "./admin/websocket.js";
import { addComment, getRepoUrl, getTask } from "./clickup/client.js";
import { getConfig } from "./config.js";
import {
  getReviewRunByPR,
  getSetting,
  hasActiveRun,
  hasCompletedRun,
  updateReviewRun,
} from "./db.js";
import { taskEvents } from "./events.js";
import { executeTask } from "./executor.js";
import { createChildLogger } from "./logger.js";
import { enqueueReview } from "./review/queue.js";

const log = createChildLogger("webhook");

let running = false;
let runningTaskId: null | string = null;
const queue: string[] = [];

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function enqueueTask(taskId: string): void {
  if (running) {
    log.info({ taskId }, "Task queued — another task is in progress");
    queue.push(taskId);
    taskEvents.emit("queue:changed", { queue: [...queue], runningTaskId });
    return;
  }

  running = true;
  queue.push(taskId);
  taskEvents.emit("queue:changed", { queue: [...queue], runningTaskId });
  void drainQueue();
}

export function getQueueStatus(): {
  queue: string[];
  runningTaskId: null | string;
} {
  return { queue: [...queue], runningTaskId };
}

export function startWebhookServer(): void {
  const config = getConfig();

  setupWebSocket();

  const webDistPath = resolve(import.meta.dirname, "..", "web", "dist");

  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    // Health check
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Admin API
    if (url.startsWith("/api/")) {
      handleAdminApi(req, res);
      return;
    }

    // Webhook endpoint
    if (req.method === "POST" && url === "/webhook") {
      void (async () => {
        try {
          const rawBody = await readBody(req);
          const signature = req.headers["x-signature"] as string | undefined;

          if (!signature || !verifySignature(rawBody, signature)) {
            log.warn("Webhook request with invalid signature");
            res.writeHead(401);
            res.end("Unauthorized");
            return;
          }

          const payload = JSON.parse(
            rawBody.toString(),
          ) as ClickUpWebhookPayload;

          // Respond 200 immediately — ClickUp requires <7s response
          res.writeHead(200);
          res.end("OK");

          if (payload.event !== "taskAssigneeUpdated") {
            log.debug({ event: payload.event }, "Ignoring non-assignee event");
            return;
          }

          const assigneeAdded = payload.history_items.find(
            (item) =>
              item.field === "assignee_add" &&
              String(item.after.id) === config.CLICKUP_CLAUDE_USER_ID,
          );

          if (!assigneeAdded) {
            log.debug(
              { taskId: payload.task_id },
              "Assignee change does not involve Claude user",
            );
            return;
          }

          log.info(
            { taskId: payload.task_id },
            "Claude user assigned — enqueuing task",
          );
          enqueueTask(payload.task_id);
        } catch (err) {
          log.error(err, "Error handling webhook request");
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal Server Error");
          }
        }
      })();
      return;
    }

    // GitHub webhook endpoint
    if (req.method === "POST" && url === "/github-webhook") {
      void (async () => {
        try {
          const rawBody = await readBody(req);

          if (
            !verifyGitHubSignature(
              rawBody,
              req.headers["x-hub-signature-256"] as string | undefined,
            )
          ) {
            log.warn("GitHub webhook request with invalid signature");
            res.writeHead(401);
            res.end("Unauthorized");
            return;
          }

          res.writeHead(200);
          res.end("OK");

          const event = req.headers["x-github-event"] as string | undefined;

          if (event === "pull_request_review") {
            const payload = JSON.parse(
              rawBody.toString(),
            ) as GitHubPullRequestReviewEvent;
            handleGitHubReviewEvent(payload);
            return;
          }

          if (event !== "pull_request") {
            log.debug({ event }, "Ignoring non-PR GitHub event");
            return;
          }

          const payload = JSON.parse(
            rawBody.toString(),
          ) as GitHubPullRequestEvent;
          handleGitHubPREvent(payload);
        } catch (err) {
          log.error(err, "Error handling GitHub webhook");
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal Server Error");
          }
        }
      })();
      return;
    }

    // Static file serving for the admin SPA
    if (req.method === "GET" && existsSync(webDistPath)) {
      const urlPath = url.split("?")[0] ?? "/";
      let filePath = join(webDistPath, urlPath);

      // Try the exact file path
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const ext = extname(filePath);
        const mime = MIME_TYPES[ext] ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        res.end(readFileSync(filePath));
        return;
      }

      // SPA fallback — serve index.html for non-file routes
      filePath = join(webDistPath, "index.html");
      if (existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(readFileSync(filePath));
        return;
      }
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  // WebSocket upgrade handler
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );
    if (url.pathname === "/ws") {
      handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(config.WEBHOOK_PORT, () => {
    log.info({ port: config.WEBHOOK_PORT }, "Webhook server listening");
  });
}

async function drainQueue(): Promise<void> {
  while (queue.length > 0) {
    const taskId = queue.shift();
    if (!taskId) break;
    runningTaskId = taskId;
    taskEvents.emit("queue:changed", { queue: [...queue], runningTaskId });
    try {
      await processTask(taskId);
    } catch (err) {
      log.error({ error: err, taskId }, "Error processing queued task");
    }
  }
  running = false;
  runningTaskId = null;
  taskEvents.emit("queue:changed", { queue: [], runningTaskId: null });
}

function handleGitHubPREvent(payload: GitHubPullRequestEvent): void {
  if (getSetting("reviews_enabled", "true") !== "true") {
    log.debug("Reviews disabled via settings, ignoring GitHub PR event");
    return;
  }

  const config = getConfig();
  if (!config.GITHUB_USERNAME) {
    log.debug("GITHUB_USERNAME not configured, ignoring GitHub PR event");
    return;
  }

  const action = payload.action;
  const pr = payload.pull_request;
  const repo = payload.repository.full_name;

  // Match review_requested where the requested reviewer is us
  if (action === "review_requested") {
    if (payload.requested_reviewer?.login !== config.GITHUB_USERNAME) {
      log.debug({ action, repo }, "Review request not for us");
      return;
    }
  } else if (action === "assigned") {
    // Match assigned where the PR assignee is us — but we only care if
    // there's a review to do. We'll let it through and dedup below.
  } else {
    log.debug({ action }, "Ignoring non-review PR action");
    return;
  }

  // Dedup: skip if already tracked and not failed
  const existing = getReviewRunByPR(repo, pr.number);
  if (existing && existing.status !== "failed") {
    log.debug({ prNumber: pr.number, repo }, "Review already tracked");
    return;
  }

  log.info({ prNumber: pr.number, repo }, "Enqueuing PR review");
  enqueueReview({
    pr_branch: pr.head.ref,
    pr_number: pr.number,
    pr_title: pr.title,
    pr_url: pr.html_url,
    repo_full_name: repo,
  });
}

function handleGitHubReviewEvent(payload: GitHubPullRequestReviewEvent): void {
  if (payload.action !== "submitted") {
    log.debug(
      { action: payload.action },
      "Ignoring non-submitted review event",
    );
    return;
  }

  const repo = payload.repository.full_name;
  const prNumber = payload.pull_request.number;

  const existing = getReviewRunByPR(repo, prNumber);
  if (!existing || existing.status !== "ready") {
    log.debug({ prNumber, repo }, "No ready review to mark as approved");
    return;
  }

  log.info(
    { prNumber, repo, reviewId: existing.id },
    "Marking review as approved",
  );
  updateReviewRun(existing.id, { status: "approved" });
  taskEvents.emit("review:status", {
    reviewId: existing.id,
    status: "approved",
  });
}

async function processTask(taskId: string): Promise<void> {
  if (hasActiveRun(taskId) || hasCompletedRun(taskId)) {
    log.debug({ taskId }, "Skipping task — already processed");
    return;
  }

  const task = await getTask(taskId);

  const repoUrl = getRepoUrl(task);
  if (!repoUrl) {
    log.warn({ taskId, taskName: task.name }, "Task missing GitHub Repo field");
    await addComment(
      taskId,
      "⚠️ Claude Task Runner: This task is missing a GitHub Repo URL in the custom field. Please add it so I can work on this task.",
    );
    return;
  }

  log.info({ repoUrl, taskId, taskName: task.name }, "Processing task");
  await executeTask(task, repoUrl);
}

function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function verifyGitHubSignature(
  rawBody: Buffer,
  signature: string | undefined,
): boolean {
  const config = getConfig();
  if (!config.GITHUB_WEBHOOK_SECRET) {
    // If no secret configured, skip verification (allow manual testing)
    return true;
  }
  if (!signature) return false;

  const hmac = createHmac("sha256", config.GITHUB_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const expected = "sha256=" + hmac.digest("hex");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

function verifySignature(rawBody: Buffer, signature: string): boolean {
  const config = getConfig();
  const hmac = createHmac("sha256", config.WEBHOOK_SECRET);
  hmac.update(rawBody);
  const expected = hmac.digest("hex");
  return signature === expected;
}
