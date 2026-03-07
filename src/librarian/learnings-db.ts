import { getDb } from "../db.js";

export interface Learning {
  category: null | string;
  content: string;
  created_at: string;
  id: number;
  project_type: null | string;
  source_agent: null | string;
  source_repo: null | string;
  source_task_id: null | string;
  superseded_by: null | number;
  tags: string;
  updated_at: string;
}

export function deleteLearning(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM learnings WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getLearning(id: number): Learning | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM learnings WHERE id = ?`).get(id) as
    | Learning
    | undefined;
}

export function getLearningStats(): {
  allTags: string[];
  byCategory: { category: null | string; count: number }[];
  bySourceAgent: { count: number; source_agent: null | string }[];
} {
  const db = getDb();
  const byCategory = db
    .prepare(
      `SELECT category, COUNT(*) as count FROM learnings WHERE superseded_by IS NULL GROUP BY category ORDER BY count DESC`,
    )
    .all() as { category: null | string; count: number }[];
  const bySourceAgent = db
    .prepare(
      `SELECT source_agent, COUNT(*) as count FROM learnings WHERE superseded_by IS NULL GROUP BY source_agent ORDER BY count DESC`,
    )
    .all() as { count: number; source_agent: null | string }[];

  const tagRows = db
    .prepare(
      `SELECT tags FROM learnings WHERE superseded_by IS NULL AND tags != '[]'`,
    )
    .all() as { tags: string }[];
  const tagSet = new Set<string>();
  for (const row of tagRows) {
    try {
      const parsed: unknown = JSON.parse(row.tags);
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          if (typeof t === "string") tagSet.add(t);
        }
      }
    } catch {
      // ignore
    }
  }
  const allTags = [...tagSet].sort();

  return { allTags, byCategory, bySourceAgent };
}

export function insertLearning(data: {
  category?: null | string;
  content: string;
  project_type?: null | string;
  source_agent?: null | string;
  source_repo?: null | string;
  source_task_id?: null | string;
  tags?: string[];
}): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO learnings (content, category, tags, project_type, source_agent, source_repo, source_task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.content,
      data.category ?? null,
      JSON.stringify(data.tags ?? []),
      data.project_type ?? null,
      data.source_agent ?? null,
      data.source_repo ?? null,
      data.source_task_id ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function listLearnings(options?: {
  category?: string;
  limit?: number;
  offset?: number;
  project_type?: string;
  search?: string;
  sort?: string;
  source_agent?: string;
  tag?: string;
}): { rows: Learning[]; total: number } {
  const db = getDb();
  const conditions: string[] = ["superseded_by IS NULL"];
  const params: unknown[] = [];

  if (options?.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }
  if (options?.project_type) {
    conditions.push("project_type = ?");
    params.push(options.project_type);
  }
  if (options?.source_agent) {
    conditions.push("source_agent = ?");
    params.push(options.source_agent);
  }
  if (options?.search) {
    conditions.push("content LIKE ?");
    params.push(`%${options.search}%`);
  }
  if (options?.tag) {
    conditions.push("tags LIKE ?");
    params.push(`%"${options.tag}"%`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  let orderBy = "created_at DESC";
  if (options?.sort === "oldest") orderBy = "created_at ASC";
  else if (options?.sort === "category")
    orderBy = "category ASC, created_at DESC";

  const total = (
    db
      .prepare(`SELECT COUNT(*) as count FROM learnings ${where}`)
      .get(...params) as { count: number }
  ).count;

  const rows = db
    .prepare(
      `SELECT * FROM learnings ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Learning[];

  return { rows, total };
}

export function searchLearnings(filters?: {
  category?: string;
  project_type?: string;
  source_agent?: string;
}): Learning[] {
  const db = getDb();
  const conditions: string[] = ["superseded_by IS NULL"];
  const params: unknown[] = [];

  if (filters?.category) {
    conditions.push("category = ?");
    params.push(filters.category);
  }
  if (filters?.project_type) {
    conditions.push("project_type = ?");
    params.push(filters.project_type);
  }
  if (filters?.source_agent) {
    conditions.push("source_agent = ?");
    params.push(filters.source_agent);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  return db
    .prepare(`SELECT * FROM learnings ${where} ORDER BY created_at DESC`)
    .all(...params) as Learning[];
}

export function supersedeLearning(oldId: number, newId: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE learnings SET superseded_by = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(newId, oldId);
}

export function updateLearning(
  id: number,
  updates: Partial<
    Pick<
      Learning,
      "category" | "content" | "project_type" | "source_agent" | "tags"
    >
  >,
): void {
  const db = getDb();
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = ?`);
    values.push(
      key === "tags" && Array.isArray(value) ? JSON.stringify(value) : value,
    );
  }
  values.push(id);

  db.prepare(`UPDATE learnings SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}
