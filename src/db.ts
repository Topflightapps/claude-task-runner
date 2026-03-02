import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { getConfig } from "./config.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("db");

let _db: Database.Database | null = null;

export interface ClonedRepo {
  cloned_at: string;
  disk_path: string;
  id: number;
  last_used_at: string;
  repo_url: string;
  size_bytes: null | number;
}

export interface TaskRun {
  branch_name: null | string;
  clickup_id: string;
  cost_usd: null | number;
  error_message: null | string;
  id: number;
  pr_url: null | string;
  repo_url: null | string;
  started_at: string;
  status: TaskRunStatus;
  updated_at: string;
}

export type TaskRunStatus =
  | "claimed"
  | "cloning"
  | "creating_pr"
  | "done"
  | "failed"
  | "running_claude";

export function deleteCompletedRuns(): number {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM task_runs WHERE status IN ('done', 'failed')`)
    .run();
  return result.changes;
}

export function deleteRepo(id: number): ClonedRepo | undefined {
  const db = getDb();
  const repo = db.prepare(`SELECT * FROM cloned_repos WHERE id = ?`).get(id) as
    | ClonedRepo
    | undefined;
  if (repo) {
    db.prepare(`DELETE FROM cloned_repos WHERE id = ?`).run(id);
  }
  return repo;
}

export function getDb(): Database.Database {
  if (!_db) throw new Error("Database not initialized. Call initDb() first.");
  return _db;
}

export function getRun(id: number): TaskRun | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM task_runs WHERE id = ?`).get(id) as
    | TaskRun
    | undefined;
}

export function hasActiveRun(clickupId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id FROM task_runs WHERE clickup_id = ? AND status NOT IN ('done', 'failed') LIMIT 1`,
    )
    .get(clickupId);
  return !!row;
}

export function hasCompletedRun(clickupId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id FROM task_runs WHERE clickup_id = ? AND status = 'done' LIMIT 1`,
    )
    .get(clickupId);
  return !!row;
}

export function initDb(): Database.Database {
  if (_db) return _db;

  const dbPath = getConfig().DB_PATH;
  mkdirSync(dirname(dbPath), { recursive: true });

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  migrate(_db);
  log.info({ path: dbPath }, "Database initialized");
  return _db;
}

export function insertRun(clickupId: string, repoUrl: string): number {
  const db = getDb();
  const result = db
    .prepare(`INSERT INTO task_runs (clickup_id, repo_url) VALUES (?, ?)`)
    .run(clickupId, repoUrl);
  return Number(result.lastInsertRowid);
}

export function listRepos(): ClonedRepo[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM cloned_repos ORDER BY last_used_at DESC`)
    .all() as ClonedRepo[];
}

export function listRuns(options?: {
  limit?: number;
  offset?: number;
  status?: string;
}): { rows: TaskRun[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM task_runs ${where}`).get(...params) as {
      count: number;
    }
  ).count;

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT * FROM task_runs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as TaskRun[];

  return { rows, total };
}

export function markStaleRunsAsFailed() {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE task_runs
       SET status = 'failed', error_message = 'Process restarted', updated_at = datetime('now')
       WHERE status NOT IN ('done', 'failed')`,
    )
    .run();

  if (result.changes > 0) {
    log.warn({ count: result.changes }, "Marked stale runs as failed");
  }
}

export function updateRun(
  id: number,
  updates: Partial<
    Pick<
      TaskRun,
      "branch_name" | "cost_usd" | "error_message" | "pr_url" | "status"
    >
  >,
) {
  const db = getDb();
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  values.push(id);

  db.prepare(`UPDATE task_runs SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}

export function upsertRepo(repoUrl: string, diskPath: string, sizeBytes: null | number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO cloned_repos (repo_url, disk_path, size_bytes)
     VALUES (?, ?, ?)
     ON CONFLICT(disk_path) DO UPDATE SET
       last_used_at = datetime('now'),
       size_bytes = excluded.size_bytes`,
  ).run(repoUrl, diskPath, sizeBytes);
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      clickup_id      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'claimed',
      repo_url        TEXT,
      branch_name     TEXT,
      pr_url          TEXT,
      error_message   TEXT,
      cost_usd        REAL,
      started_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_runs_clickup_id ON task_runs(clickup_id);
    CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);

    CREATE TABLE IF NOT EXISTS cloned_repos (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_url        TEXT NOT NULL,
      disk_path       TEXT NOT NULL UNIQUE,
      size_bytes      INTEGER,
      cloned_at       TEXT DEFAULT (datetime('now')),
      last_used_at    TEXT DEFAULT (datetime('now'))
    );
  `);
}
