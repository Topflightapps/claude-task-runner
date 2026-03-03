import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { type WebSocket, WebSocketServer } from "ws";

import { taskEvents } from "../events.js";
import { createChildLogger } from "../logger.js";
import { validateTokenString } from "./auth.js";

const log = createChildLogger("admin-ws");

let wss: null | WebSocketServer = null;

export function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  if (!wss) {
    socket.destroy();
    return;
  }

  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  const token = url.searchParams.get("token");

  if (!token || !validateTokenString(token)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss?.emit("connection", ws, req);
  });
}

export function setupWebSocket(): void {
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket) => {
    log.debug("Admin WebSocket client connected");
    ws.on("close", () => {
      log.debug("Admin WebSocket client disconnected");
    });
  });

  taskEvents.on("output", (data) => {
    broadcast({
      line: data.line,
      runId: data.runId,
      stream: data.stream,
      ts: new Date().toISOString(),
      type: "output",
    });
  });

  taskEvents.on("status:changed", (data) => {
    broadcast({ runId: data.runId, status: data.status, type: "status" });
  });

  taskEvents.on("queue:changed", (data) => {
    broadcast({
      queue: data.queue,
      running: data.runningTaskId,
      type: "queue",
    });
  });

  taskEvents.on("review:output", (data) => {
    broadcast({
      line: data.line,
      reviewId: data.reviewId,
      stream: data.stream,
      ts: new Date().toISOString(),
      type: "review:output",
    });
  });

  taskEvents.on("review:status", (data) => {
    broadcast({
      reviewId: data.reviewId,
      status: data.status,
      type: "review:status",
    });
  });

  taskEvents.on("review:queue", (data) => {
    broadcast({
      queue: data.queue,
      running: data.runningReviewId,
      type: "review:queue",
    });
  });
}

function broadcast(data: unknown): void {
  if (!wss) return;
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}
