import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getConfig } from "../config.js";
import { getReviewRunByPR } from "../db.js";
import { createChildLogger } from "../logger.js";
import { enqueueReview } from "./queue.js";

const execFileAsync = promisify(execFile);
const log = createChildLogger("review-sync");

interface GHSearchResult {
  headRefName: string;
  number: number;
  repository: { nameWithOwner: string };
  title: string;
  url: string;
}

export async function syncPendingReviews(): Promise<number> {
  const config = getConfig();
  if (!config.GITHUB_USERNAME) {
    log.warn("GITHUB_USERNAME not configured, cannot sync reviews");
    return 0;
  }

  const ghEnv = { ...process.env, GH_TOKEN: config.GITHUB_TOKEN };

  log.info("Syncing pending reviews from GitHub...");

  // Search for PRs where we're requested as reviewer
  let results: GHSearchResult[] = [];

  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "search",
        "prs",
        "--review-requested=" + config.GITHUB_USERNAME,
        "--state=open",
        "--json",
        "number,title,url,headRefName,repository",
      ],
      { env: ghEnv, maxBuffer: 10 * 1024 * 1024 },
    );
    results = JSON.parse(stdout) as GHSearchResult[];
  } catch (err) {
    log.error(err, "Failed to search GitHub for review-requested PRs");
  }

  // Also search for PRs where we're assigned
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "search",
        "prs",
        "--assignee=" + config.GITHUB_USERNAME,
        "--state=open",
        "--review=required",
        "--json",
        "number,title,url,headRefName,repository",
      ],
      { env: ghEnv, maxBuffer: 10 * 1024 * 1024 },
    );
    const assigned = JSON.parse(stdout) as GHSearchResult[];
    results = results.concat(assigned);
  } catch (err) {
    log.error(err, "Failed to search GitHub for assigned PRs");
  }

  // Deduplicate by (repo, pr_number)
  const seen = new Set<string>();
  const unique: GHSearchResult[] = [];
  for (const pr of results) {
    const key = pr.repository.nameWithOwner + "#" + String(pr.number);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(pr);
    }
  }

  // Enqueue any not already tracked
  let enqueued = 0;
  for (const pr of unique) {
    const existing = getReviewRunByPR(pr.repository.nameWithOwner, pr.number);
    if (existing && existing.status !== "failed") {
      continue;
    }

    enqueueReview({
      pr_branch: pr.headRefName,
      pr_number: pr.number,
      pr_title: pr.title,
      pr_url: pr.url,
      repo_full_name: pr.repository.nameWithOwner,
    });
    enqueued++;
  }

  log.info({ enqueued, total: unique.length }, "Review sync complete");

  return enqueued;
}
