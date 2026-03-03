import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import type { PendingReviewResponse, ReviewComment } from "./types.js";

import { getConfig } from "../config.js";
import { createChildLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createChildLogger("review-api");

export async function createPendingReview(
  repoFullName: string,
  prNumber: number,
  comments: ReviewComment[],
): Promise<number> {
  const body = JSON.stringify({
    comments: comments.map((c) => ({
      body: c.body,
      line: c.line,
      path: c.path,
      side: c.side ?? "RIGHT",
    })),
    event: "PENDING",
  });

  log.info(
    { commentCount: comments.length, prNumber, repoFullName },
    "Creating pending review",
  );

  const endpoint =
    "repos/" + repoFullName + "/pulls/" + String(prNumber) + "/reviews";

  const stdout = await spawnWithStdin(
    "gh",
    ["api", endpoint, "--method", "POST", "--input", "-"],
    body,
  );

  const response = JSON.parse(stdout) as PendingReviewResponse;
  log.info({ reviewId: response.id }, "Pending review created");
  return response.id;
}

export async function getPRDiff(
  repoFullName: string,
  prNumber: number,
): Promise<string> {
  const endpoint = "repos/" + repoFullName + "/pulls/" + String(prNumber);

  const result = await execFileAsync(
    "gh",
    ["api", endpoint, "-H", "Accept: application/vnd.github.v3.diff"],
    {
      env: ghEnv(),
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return result.stdout;
}

function ghEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GH_TOKEN: getConfig().GITHUB_TOKEN };
}

function spawnWithStdin(
  cmd: string,
  args: string[],
  input: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
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

    child.stdin.write(input);
    child.stdin.end();
  });
}
