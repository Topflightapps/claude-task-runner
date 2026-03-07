import { getConfig } from "../config.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSION = 1536;

export async function embed(text: string): Promise<Float32Array | null> {
  const config = getConfig();
  const apiKey = config.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for embeddings");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI embeddings API error (${String(response.status)}): ${body}`,
    );
  }

  const json = (await response.json()) as {
    data: { embedding: number[] }[];
  };

  const values = json.data[0].embedding;
  if (values.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Unexpected embedding dimension: got ${String(values.length)}, expected ${String(EMBEDDING_DIMENSION)}`,
    );
  }

  return new Float32Array(values);
}
