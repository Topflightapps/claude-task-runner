import { getReviewRun, insertReviewRun } from "../db.js";
import { taskEvents } from "../events.js";
import { createChildLogger } from "../logger.js";
import { executeReview } from "./executor.js";

const log = createChildLogger("review-queue");

let running = false;
let runningReviewId: null | number = null;
const queue: number[] = [];

interface ReviewQueueItem {
  pr_branch: string;
  pr_number: number;
  pr_title: string;
  pr_url: string;
  repo_full_name: string;
}

export function enqueueReview(item: ReviewQueueItem): number {
  const id = insertReviewRun(item);

  log.info(
    { prNumber: item.pr_number, repo: item.repo_full_name, reviewId: id },
    "Review enqueued",
  );

  queue.push(id);
  emitQueueState();

  if (!running) {
    running = true;
    void drainReviewQueue();
  }

  return id;
}

export function getReviewQueueStatus(): {
  queue: number[];
  runningReviewId: null | number;
} {
  return { queue: [...queue], runningReviewId };
}

async function drainReviewQueue(): Promise<void> {
  while (queue.length > 0) {
    const reviewId = queue.shift();
    if (reviewId === undefined) break;

    runningReviewId = reviewId;
    emitQueueState();

    try {
      const review = getReviewRun(reviewId);
      if (!review) {
        log.warn({ reviewId }, "Review run not found in DB, skipping");
        continue;
      }

      await executeReview(
        reviewId,
        review.repo_full_name,
        review.pr_number,
        review.pr_branch,
        review.pr_title,
        review.pr_url,
      );
    } catch (err) {
      log.error({ error: err, reviewId }, "Error processing review");
    }
  }

  running = false;
  runningReviewId = null;
  emitQueueState();
}

function emitQueueState(): void {
  taskEvents.emit("review:queue", {
    queue: [...queue],
    runningReviewId,
  });
}
