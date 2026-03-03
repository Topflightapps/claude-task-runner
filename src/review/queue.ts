import { getReviewRun, insertReviewRun, updateReviewRun } from "../db.js";
import { activeReviewProcesses, taskEvents } from "../events.js";
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

/**
 * Kill all running review processes, clear the queue, and mark
 * any in-progress/queued reviews as failed.
 */
export function cancelAllReviews(): number {
  // Clear queued items
  const cancelled = queue.splice(0, queue.length);

  // Mark queued reviews as cancelled in DB
  for (const id of cancelled) {
    updateReviewRun(id, {
      error_message: "Cancelled by admin",
      status: "failed",
    });
    taskEvents.emit("review:status", { reviewId: id, status: "failed" });
  }

  // Kill the currently running review process
  if (runningReviewId !== null) {
    const proc = activeReviewProcesses.get(runningReviewId);
    if (proc) {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5_000);
    }
    updateReviewRun(runningReviewId, {
      error_message: "Cancelled by admin",
      status: "failed",
    });
    taskEvents.emit("review:status", {
      reviewId: runningReviewId,
      status: "failed",
    });
    cancelled.push(runningReviewId);
  }

  log.info({ cancelled: cancelled.length }, "All reviews cancelled");
  emitQueueState();
  return cancelled.length;
}

export function enqueueReviewById(id: number): void {
  log.info({ reviewId: id }, "Re-enqueuing existing review");

  queue.push(id);
  emitQueueState();

  if (!running) {
    running = true;
    void drainReviewQueue();
  }
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

    // Skip if already cancelled
    const review = getReviewRun(reviewId);
    if (!review || review.status === "failed") {
      log.warn({ reviewId }, "Review already cancelled or missing, skipping");
      continue;
    }

    runningReviewId = reviewId;
    emitQueueState();

    try {
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
