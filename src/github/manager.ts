import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { getConfig } from "../config.js";
import { upsertRepo } from "../db.js";
import { createChildLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createChildLogger("github");

export async function commitAll(
  repoPath: string,
  message: string,
): Promise<boolean> {
  if (!(await hasChanges(repoPath))) {
    log.warn("No changes to commit");
    return false;
  }

  await git(repoPath, "add", "-A");
  await git(repoPath, "commit", "-m", message);
  log.info("Changes committed");
  return true;
}

export async function createBranch(
  repoPath: string,
  clickupId: string,
  taskName: string,
): Promise<string> {
  const slug = taskName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const branchName = `claude/${clickupId}-${slug}`;
  try {
    await git(repoPath, "checkout", "-b", branchName);
    log.info({ branchName }, "Created branch");
  } catch {
    // Branch already exists — delete local copy and recreate from current HEAD
    log.info({ branchName }, "Branch exists, recreating from develop");
    await git(repoPath, "branch", "-D", branchName);
    await git(repoPath, "checkout", "-b", branchName);
  }
  return branchName;
}

export async function ensureRepo(repoUrl: string): Promise<string> {
  const dir = repoDir(repoUrl);
  const httpsUrl = toHttpsUrl(repoUrl);

  if (existsSync(join(dir, ".git"))) {
    log.info({ dir }, "Repo exists, fetching latest");
    await git(dir, "fetch", "origin");
    await git(dir, "checkout", "develop");
    await git(dir, "reset", "--hard", "origin/develop");
    await git(dir, "clean", "-fd");
  } else {
    log.info({ dir, repoUrl: httpsUrl }, "Cloning repo");
    const parentDir = join(dir, "..");
    await execFileAsync("mkdir", ["-p", parentDir]);
    await git(parentDir, "clone", httpsUrl, dir);
    await git(dir, "checkout", "develop");
  }

  // Track the cloned repo in DB
  const sizeBytes = await getDirSize(dir);
  upsertRepo(repoUrl, dir, sizeBytes);

  return dir;
}

export async function ensureRepoForReview(
  repoFullName: string,
  prBranch: string,
): Promise<string> {
  const config = getConfig();
  const dir = join(config.WORK_DIR, "reviews", repoFullName);
  const httpsUrl = `https://github.com/${repoFullName}.git`;

  if (existsSync(join(dir, ".git"))) {
    log.info({ dir }, "Review repo exists, fetching latest");
    await git(dir, "fetch", "origin");
  } else {
    log.info({ dir, repoUrl: httpsUrl }, "Cloning repo for review");
    const parentDir = join(dir, "..");
    await execFileAsync("mkdir", ["-p", parentDir]);
    await git(parentDir, "clone", httpsUrl, dir);
  }

  await git(dir, "checkout", prBranch);
  await git(dir, "reset", "--hard", `origin/${prBranch}`);
  await git(dir, "clean", "-fd");

  // Track the cloned repo in DB so it appears in Cloned Repos panel
  const sizeBytes = await getDirSize(dir);
  upsertRepo(httpsUrl, dir, sizeBytes);

  return dir;
}

export async function hasChanges(repoPath: string): Promise<boolean> {
  const status = await git(repoPath, "status", "--porcelain");
  return status.length > 0;
}

export async function pushAndCreatePR(
  repoPath: string,
  branchName: string,
  title: string,
  body: string,
): Promise<string> {
  const config = getConfig();
  await git(repoPath, "push", "-u", "origin", branchName);
  log.info({ branchName }, "Pushed branch");

  const ghArgs = [
    "pr",
    "create",
    "--title",
    title,
    "--body",
    body,
    "--head",
    branchName,
    "--base",
    "develop",
  ];

  if (config.GITHUB_PR_ASSIGNEE) {
    ghArgs.push("--assignee", config.GITHUB_PR_ASSIGNEE);
  }

  const prUrl = await gh(repoPath, ...ghArgs);

  log.info({ prUrl }, "Created PR");
  return prUrl;
}

/**
 * Remove scripts/ralph/ directory and unstage it from git.
 * This is task runner scaffolding that shouldn't be committed to the project.
 */
export async function removeRalphScaffolding(repoPath: string): Promise<void> {
  const ralphDir = join(repoPath, "scripts", "ralph");
  if (!existsSync(ralphDir)) return;

  // Remove from git tracking (if staged/committed on this branch)
  try {
    await git(repoPath, "rm", "-rf", "--cached", "scripts/ralph");
  } catch {
    // Not tracked — that's fine
  }

  // Delete from disk
  const { rmSync } = await import("node:fs");
  rmSync(ralphDir, { force: true, recursive: true });

  log.info("Removed scripts/ralph/ scaffolding");
}

async function getDirSize(dirPath: string): Promise<null | number> {
  try {
    const result = await execFileAsync("du", ["-sk", dirPath]);
    const kb = Number(result.stdout.split("\t")[0]);
    return kb * 1024;
  } catch {
    return null;
  }
}

async function gh(cwd: string, ...args: string[]) {
  log.debug({ args, cwd }, "Running gh command");
  const result = await execFileAsync("gh", args, {
    cwd,
    env: { ...process.env, GH_TOKEN: getConfig().GITHUB_TOKEN },
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function git(cwd: string, ...args: string[]) {
  log.debug({ args, cwd }, "Running git command");
  const config = getConfig();
  const result = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_ASKPASS: "echo",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0:
        "url.https://x-access-token:" +
        config.GITHUB_TOKEN +
        "@github.com/.insteadOf",
      GIT_CONFIG_VALUE_0: "https://github.com/",
      GIT_TERMINAL_PROMPT: "0",
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout.trim();
}

function repoDir(repoUrl: string): string {
  // Extract org/repo from URL like https://github.com/owner/repo or git@github.com:owner/repo.git
  const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(repoUrl);
  if (!match) throw new Error(`Invalid GitHub repo URL: ${repoUrl}`);
  return join(getConfig().WORK_DIR, match[1]);
}

function toHttpsUrl(repoUrl: string): string {
  // Convert git@github.com:owner/repo.git → https://github.com/owner/repo.git
  const sshMatch = /^git@github\.com:(.+)$/.exec(repoUrl);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  return repoUrl;
}
