import { spawn } from "node:child_process";

import type { PendingReviewResponse, ReviewComment } from "./types.js";

import { getConfig } from "../config.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("review-api");

interface GHReview {
  id: number;
  state: string;
  user: { login: string };
}

/**
 * Create a pending review on a PR. Dismisses any existing pending reviews
 * first, then tries to submit all comments at once. If that fails (e.g. line
 * numbers outside the diff), falls back to adding comments individually.
 */
export async function createPendingReview(
  repoFullName: string,
  prNumber: number,
  comments: ReviewComment[],
): Promise<number> {
  const endpoint =
    "repos/" + repoFullName + "/pulls/" + String(prNumber) + "/reviews";

  log.info(
    { commentCount: comments.length, prNumber, repoFullName },
    "Creating pending review",
  );

  // Dismiss any orphaned pending reviews from previous attempts
  await dismissExistingPendingReviews(repoFullName, prNumber);

  // Try submitting all comments at once first
  try {
    const body = JSON.stringify({
      comments: comments.map((c) => ({
        body: c.body,
        line: c.line,
        path: c.path,
        side: c.side ?? "RIGHT",
      })),
      event: "PENDING",
    });

    const stdout = await ghApiPost(endpoint, body);
    const response = JSON.parse(stdout) as PendingReviewResponse;
    log.info(
      { reviewId: response.id },
      "Pending review created (all comments)",
    );
    return response.id;
  } catch (err) {
    log.warn(
      { error: String(err) },
      "Bulk review creation failed, falling back to individual comments",
    );
  }

  // Fallback: create empty pending review, then add comments one by one
  const emptyBody = JSON.stringify({ body: "", event: "PENDING" });
  const stdout = await ghApiPost(endpoint, emptyBody);
  const response = JSON.parse(stdout) as PendingReviewResponse;
  const reviewId = response.id;

  log.info(
    { reviewId },
    "Empty pending review created, adding comments individually",
  );

  let added = 0;
  const commentEndpoint =
    "repos/" + repoFullName + "/pulls/" + String(prNumber) + "/comments";
  const commitSha = await getLatestCommit(repoFullName, prNumber);

  for (const c of comments) {
    try {
      const commentBody = JSON.stringify({
        body: c.body,
        commit_id: commitSha,
        line: c.line,
        path: c.path,
        pull_request_review_id: reviewId,
        side: c.side ?? "RIGHT",
      });
      await ghApiPost(commentEndpoint, commentBody);
      added++;
    } catch (err) {
      log.warn(
        { error: String(err), line: c.line, path: c.path },
        "Skipping comment — line not in diff",
      );
    }
  }

  log.info(
    { added, reviewId, skipped: comments.length - added },
    "Pending review created with individual comments",
  );

  return reviewId;
}

async function dismissExistingPendingReviews(
  repoFullName: string,
  prNumber: number,
): Promise<void> {
  const endpoint =
    "repos/" + repoFullName + "/pulls/" + String(prNumber) + "/reviews";

  try {
    const stdout = await ghApiGet(endpoint);
    const reviews = JSON.parse(stdout) as GHReview[];

    // Find PENDING reviews authored by our token's user
    const pending = reviews.filter((r) => r.state === "PENDING");
    for (const review of pending) {
      log.info(
        { prNumber, repoFullName, reviewId: review.id },
        "Dismissing orphaned pending review",
      );
      try {
        // Delete the pending review (PUT with DISMISS event)
        await ghApiRequest(
          endpoint + "/" + String(review.id) + "/dismissals",
          "PUT",
          JSON.stringify({
            event: "DISMISS",
            message: "Replacing with new review",
          }),
        );
      } catch {
        // If dismiss fails, try deleting it instead
        try {
          await ghApiRequest(endpoint + "/" + String(review.id), "DELETE", "");
        } catch (deleteErr) {
          log.warn(
            { error: String(deleteErr), reviewId: review.id },
            "Could not remove orphaned pending review",
          );
        }
      }
    }
  } catch (err) {
    log.warn(
      { error: String(err) },
      "Could not check for existing pending reviews",
    );
  }
}

async function getLatestCommit(
  repoFullName: string,
  prNumber: number,
): Promise<string> {
  const endpoint = "repos/" + repoFullName + "/pulls/" + String(prNumber);

  const stdout = await ghApiGet(endpoint);
  const pr = JSON.parse(stdout) as { head: { sha: string } };
  return pr.head.sha;
}

function ghApiGet(endpoint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", ["api", endpoint], {
      env: ghEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error("gh api failed (exit " + String(code) + "): " + stderr),
        );
      } else {
        resolve(stdout);
      }
    });

    child.on("error", reject);
    child.stdin.end();
  });
}

function ghApiPost(endpoint: string, body: string): Promise<string> {
  return ghApiRequest(endpoint, "POST", body);
}

function ghApiRequest(
  endpoint: string,
  method: string,
  body: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["api", endpoint, "--method", method];
    if (body) args.push("--input", "-");

    const child = spawn("gh", args, {
      env: ghEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        // Include both stderr and stdout — GitHub puts error details in stdout
        const details = (stderr + " " + stdout).trim();
        reject(
          new Error("gh api failed (exit " + String(code) + "): " + details),
        );
      } else {
        resolve(stdout);
      }
    });

    child.on("error", reject);

    if (body) {
      child.stdin.write(body);
    }
    child.stdin.end();
  });
}

function ghEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GH_TOKEN: getConfig().GITHUB_TOKEN };
}
