import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runClaudeReview } from "../claude/review-runner.js";
import { getConfig } from "../config.js";
import { updateReviewRun } from "../db.js";
import { emitReviewSystemLine, taskEvents } from "../events.js";
import { ensureRepoForReview } from "../github/manager.js";
import { createPendingReview } from "../github/review-api.js";
import { createChildLogger } from "../logger.js";
import { notifySlack } from "../notifications/slack.js";

const execFileAsync = promisify(execFile);
const log = createChildLogger("review-executor");

export async function executeReview(
  reviewId: number,
  repoFullName: string,
  prNumber: number,
  prBranch: string,
  prTitle: string,
  prUrl: string,
): Promise<void> {
  try {
    // 1. Clone / fetch repo
    emitReviewSystemLine(reviewId, "Cloning repository...");
    updateReviewRun(reviewId, { status: "cloning" });
    taskEvents.emit("review:status", { reviewId, status: "cloning" });

    const repoPath = await ensureRepoForReview(repoFullName, prBranch);

    // 2. Get the PR base branch (e.g. main, develop) via gh pr view
    emitReviewSystemLine(reviewId, "Fetching PR details...");
    const baseBranch = await getBaseBranch(repoFullName, prNumber);

    // 3. Run Claude review — Claude will git diff against the base branch itself
    emitReviewSystemLine(reviewId, "Running Claude Code review...");
    updateReviewRun(reviewId, { status: "reviewing" });
    taskEvents.emit("review:status", { reviewId, status: "reviewing" });

    const result = await runClaudeReview(repoPath, baseBranch, reviewId);

    if (!result.success || !result.output) {
      updateReviewRun(reviewId, {
        cost_usd: result.costUsd,
        error_message: "Claude review failed to produce valid output",
        status: "failed",
      });
      taskEvents.emit("review:status", { reviewId, status: "failed" });
      return;
    }

    // 4. Create pending review on GitHub
    const comments = result.output.comments;
    let ghReviewId: number | undefined;

    if (comments.length > 0) {
      emitReviewSystemLine(
        reviewId,
        "Creating pending review with " +
          String(comments.length) +
          " comments...",
      );
      try {
        ghReviewId = await createPendingReview(
          repoFullName,
          prNumber,
          comments,
        );
      } catch (err) {
        log.error(err, "Failed to create pending review on GitHub");
        updateReviewRun(reviewId, {
          cost_usd: result.costUsd,
          error_message: "Failed to create GitHub review: " + String(err),
          status: "failed",
        });
        taskEvents.emit("review:status", { reviewId, status: "failed" });
        return;
      }
    } else {
      emitReviewSystemLine(reviewId, "No review comments — PR looks clean");
    }

    // 5. Mark as ready
    updateReviewRun(reviewId, {
      comment_count: comments.length,
      cost_usd: result.costUsd,
      review_id: ghReviewId,
      status: "ready",
    });
    taskEvents.emit("review:status", { reviewId, status: "ready" });
    emitReviewSystemLine(reviewId, "Review complete — pending your approval");

    // 6. Notify Slack
    await notifySlack(prTitle, prUrl, comments.length);

    log.info(
      { commentCount: comments.length, prNumber, repoFullName, reviewId },
      "Review complete",
    );
  } catch (err) {
    log.error(err, "Review execution failed");
    updateReviewRun(reviewId, {
      error_message: String(err),
      status: "failed",
    });
    taskEvents.emit("review:status", { reviewId, status: "failed" });
  }
}

async function getBaseBranch(
  repoFullName: string,
  prNumber: number,
): Promise<string> {
  const config = getConfig();
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "view",
        String(prNumber),
        "--repo",
        repoFullName,
        "--json",
        "baseRefName",
      ],
      {
        env: { ...process.env, GH_TOKEN: config.GITHUB_TOKEN },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const data = JSON.parse(stdout) as { baseRefName: string };
    return data.baseRefName;
  } catch (err) {
    log.warn(
      { error: err, prNumber, repoFullName },
      "Failed to get base branch, defaulting to main",
    );
    return "main";
  }
}
