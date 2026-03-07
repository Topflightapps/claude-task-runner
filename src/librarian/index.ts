import { getConfig } from "../config.js";
import { createChildLogger } from "../logger.js";
import { decideLearning } from "./decision.js";
import { embed } from "./embeddings.js";
import { extractLearnings } from "./extractor.js";
import {
  getLearning,
  insertLearning,
  type Learning,
  supersedeLearning,
  updateLearning,
} from "./learnings-db.js";
import { search, store } from "./vectorstore.js";

const log = createChildLogger("librarian");

const SIMILARITY_THRESHOLD = 0.7;
const DEFAULT_RESEARCH_LIMIT = 5;

export async function fileLearnings(params: {
  projectType?: null | string;
  rawText: string;
  repoUrl?: null | string;
  sourceAgent: string;
  taskId?: null | string;
}): Promise<void> {
  if (!getConfig().LIBRARIAN_ENABLED) return;

  try {
    const learnings = await extractLearnings(
      params.rawText,
      params.sourceAgent,
    );

    for (const content of learnings) {
      await processLearning(content, params);
    }
  } catch (error) {
    log.error(error, "fileLearnings error");
  }
}

export async function research(params: {
  limit?: number;
  projectType?: null | string;
  taskDescription: string;
}): Promise<Learning[]> {
  if (!getConfig().LIBRARIAN_ENABLED) return [];

  try {
    const queryEmbedding = await embed(params.taskDescription);
    if (!queryEmbedding) return [];

    const limit = params.limit ?? DEFAULT_RESEARCH_LIMIT;
    const results = search(queryEmbedding, limit);

    const learnings: Learning[] = [];
    for (const result of results) {
      if (result.score < SIMILARITY_THRESHOLD) continue;

      const learning = getLearning(result.id);
      if (!learning) continue;

      if (
        params.projectType &&
        learning.project_type &&
        learning.project_type !== params.projectType
      ) {
        continue;
      }

      learnings.push(learning);
    }

    return learnings;
  } catch (error) {
    log.error(error, "research error");
    return [];
  }
}

async function processLearning(
  content: string,
  params: {
    projectType?: null | string;
    repoUrl?: null | string;
    sourceAgent: string;
    taskId?: null | string;
  },
): Promise<void> {
  const embedding = await embed(content);
  if (!embedding) return;

  const similarResults = search(embedding, 5);
  const similarLearnings = similarResults
    .filter((r) => r.score >= SIMILARITY_THRESHOLD)
    .map((r) => {
      const learning = getLearning(r.id);
      return {
        content: learning?.content ?? "",
        id: r.id,
        score: r.score,
      };
    })
    .filter((l) => l.content.length > 0);

  const decision = await decideLearning(content, similarLearnings);

  switch (decision.type) {
    case "FILE_NEW": {
      const newId = insertLearning({
        category: decision.metadata.category,
        content,
        project_type: decision.metadata.project_type ?? params.projectType,
        source_agent: params.sourceAgent,
        source_repo: params.repoUrl,
        source_task_id: params.taskId,
        tags: decision.metadata.tags,
      });
      store(newId, embedding);
      break;
    }
    case "REPLACE": {
      const newId = insertLearning({
        category: decision.metadata.category,
        content,
        project_type: decision.metadata.project_type ?? params.projectType,
        source_agent: params.sourceAgent,
        source_repo: params.repoUrl,
        source_task_id: params.taskId,
        tags: decision.metadata.tags,
      });
      store(newId, embedding);
      supersedeLearning(decision.existingId, newId);
      break;
    }
    case "SKIP":
      break;
    case "UPDATE": {
      updateLearning(decision.existingId, {
        category: decision.metadata.category,
        content,
        tags: decision.metadata.tags as unknown as string,
      });
      store(decision.existingId, embedding);
      break;
    }
  }
}
