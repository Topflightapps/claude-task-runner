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

export interface ReviewRun {
  comment_count: number;
  cost_usd: null | number;
  error_message: null | string;
  id: number;
  pr_branch: string;
  pr_number: number;
  pr_title: string;
  pr_url: string;
  re_review_count: number;
  repo_full_name: string;
  review_id: null | number;
  started_at: string;
  status: ReviewRunStatus;
  updated_at: string;
}

export type ReviewRunStatus =
  | "approved"
  | "changes_requested"
  | "cloning"
  | "failed"
  | "queued"
  | "ready"
  | "reviewing";

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

export function deleteCompletedReviews(): number {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM review_runs WHERE status = 'failed'`)
    .run();
  return result.changes;
}

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

export function deleteReviewRun(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM review_runs WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getDb(): Database.Database {
  if (!_db) throw new Error("Database not initialized. Call initDb() first.");
  return _db;
}

export function getReviewRun(id: number): ReviewRun | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM review_runs WHERE id = ?`).get(id) as
    | ReviewRun
    | undefined;
}

export function getReviewRunByPR(
  repoFullName: string,
  prNumber: number,
): ReviewRun | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM review_runs WHERE repo_full_name = ? AND pr_number = ?`,
    )
    .get(repoFullName, prNumber) as ReviewRun | undefined;
}

export function getRun(id: number): TaskRun | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM task_runs WHERE id = ?`).get(id) as
    | TaskRun
    | undefined;
}

export function getSetting(key: string, defaultValue: string): string {
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as undefined | { value: string };
  return row?.value ?? defaultValue;
}

export function hasActiveReview(
  repoFullName: string,
  prNumber: number,
): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id FROM review_runs WHERE repo_full_name = ? AND pr_number = ? AND status NOT IN ('ready', 'failed', 'approved', 'changes_requested') LIMIT 1`,
    )
    .get(repoFullName, prNumber);
  return !!row;
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

export function insertReviewRun(data: {
  pr_branch: string;
  pr_number: number;
  pr_title: string;
  pr_url: string;
  repo_full_name: string;
}): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO review_runs (repo_full_name, pr_number, pr_title, pr_url, pr_branch)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      data.repo_full_name,
      data.pr_number,
      data.pr_title,
      data.pr_url,
      data.pr_branch,
    );
  return Number(result.lastInsertRowid);
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

export function listReviewRuns(options?: {
  limit?: number;
  offset?: number;
  status?: string;
}): { rows: ReviewRun[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (
    db
      .prepare(`SELECT COUNT(*) as count FROM review_runs ${where}`)
      .get(...params) as { count: number }
  ).count;

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT * FROM review_runs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as ReviewRun[];

  return { rows, total };
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

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (
    db
      .prepare(`SELECT COUNT(*) as count FROM task_runs ${where}`)
      .get(...params) as {
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

export function markStaleReviewsAsFailed() {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE review_runs
       SET status = 'failed', error_message = 'Process restarted', updated_at = datetime('now')
       WHERE status NOT IN ('ready', 'failed', 'approved', 'changes_requested')`,
    )
    .run();

  if (result.changes > 0) {
    log.warn({ count: result.changes }, "Marked stale reviews as failed");
  }
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

export function resetReviewRun(id: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE review_runs
     SET status = 'queued', error_message = NULL, cost_usd = NULL, review_id = NULL, comment_count = 0, re_review_count = re_review_count + 1, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(id);
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function updateReviewRun(
  id: number,
  updates: Partial<
    Pick<
      ReviewRun,
      "comment_count" | "cost_usd" | "error_message" | "review_id" | "status"
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

  db.prepare(`UPDATE review_runs SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
  );
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

export function upsertRepo(
  repoUrl: string,
  diskPath: string,
  sizeBytes: null | number,
): void {
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

    CREATE TABLE IF NOT EXISTS review_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_full_name  TEXT NOT NULL,
      pr_number       INTEGER NOT NULL,
      pr_title        TEXT NOT NULL,
      pr_url          TEXT NOT NULL,
      pr_branch       TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'queued',
      error_message   TEXT,
      cost_usd        REAL,
      review_id       INTEGER,
      comment_count   INTEGER DEFAULT 0,
      started_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_review_runs_pr
      ON review_runs(repo_full_name, pr_number);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cloned_repos (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_url        TEXT NOT NULL,
      disk_path       TEXT NOT NULL UNIQUE,
      size_bytes      INTEGER,
      cloned_at       TEXT DEFAULT (datetime('now')),
      last_used_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS learnings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      content         TEXT NOT NULL,
      embedding       BLOB,
      category        TEXT,
      tags            TEXT DEFAULT '[]',
      project_type    TEXT,
      source_agent    TEXT,
      source_repo     TEXT,
      source_task_id  TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now')),
      superseded_by   INTEGER REFERENCES learnings(id)
    );
    CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);
    CREATE INDEX IF NOT EXISTS idx_learnings_project_type ON learnings(project_type);
  `);

  // Add re_review_count column (idempotent)
  try {
    db.exec(
      `ALTER TABLE review_runs ADD COLUMN re_review_count INTEGER DEFAULT 0`,
    );
  } catch {
    // Column already exists
  }
}
