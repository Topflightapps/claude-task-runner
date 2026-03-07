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

export function getLearning(id: number): Learning | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM learnings WHERE id = ?`).get(id) as
    | Learning
    | undefined;
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
