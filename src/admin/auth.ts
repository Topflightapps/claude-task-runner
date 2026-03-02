import type { IncomingMessage, ServerResponse } from "node:http";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getConfig } from "../config.js";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function handleLogin(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { password?: string };
      const config = getConfig();

      if (!config.ADMIN_PASSWORD) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Admin panel not configured" }));
        return;
      }

      if (body.password !== config.ADMIN_PASSWORD) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid password" }));
        return;
      }

      const token = signToken({ exp: Date.now() + TOKEN_TTL_MS });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid request body" }));
    }
  });
}

export function validateAuth(req: IncomingMessage): boolean {
  const config = getConfig();
  if (!config.ADMIN_PASSWORD) return false;

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;

  return verifyToken(auth.slice(7));
}

export function validateTokenString(token: string): boolean {
  const config = getConfig();
  if (!config.ADMIN_PASSWORD) return false;
  return verifyToken(token);
}

function getSecret(): string {
  const password = getConfig().ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD not configured");
  return password;
}

function signToken(payload: { exp: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyToken(token: string): boolean {
  const [data, sig] = token.split(".");
  if (!data || !sig) return false;

  const expected = createHmac("sha256", getSecret()).update(data).digest("base64url");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as { exp: number };
    return Date.now() < payload.exp;
  } catch {
    return false;
  }
}
