import { getDb } from "../db.js";

export interface SearchResult {
  id: number;
  score: number;
}

/**
 * Search learnings by cosine similarity against a query embedding.
 * Returns the top `limit` results sorted by descending similarity score.
 */
export function search(
  queryEmbedding: Float32Array,
  limit = 10,
): SearchResult[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, embedding FROM learnings WHERE embedding IS NOT NULL AND superseded_by IS NULL`,
    )
    .all() as { embedding: Buffer; id: number }[];

  const scored: SearchResult[] = [];

  for (const row of rows) {
    const stored = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4,
    );
    const score = cosineSimilarity(queryEmbedding, stored);
    scored.push({ id: row.id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Store an embedding BLOB for a learning row that already exists.
 */
export function store(id: number, embedding: Float32Array): void {
  const db = getDb();
  const buffer = Buffer.from(embedding.buffer);
  db.prepare(`UPDATE learnings SET embedding = ? WHERE id = ?`).run(buffer, id);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
