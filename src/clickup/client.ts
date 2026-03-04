import mammoth from "mammoth";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pThrottle from "p-throttle";

import type { ClickUpTask } from "./types.js";

import { getConfig } from "../config.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("clickup");

const throttle = pThrottle({ interval: 60_000, limit: 90 });

function apiHeaders() {
  return {
    Authorization: getConfig().CLICKUP_API_TOKEN,
    "Content-Type": "application/json",
  };
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `https://api.clickup.com/api/v2${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...apiHeaders(),
      ...(options.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `ClickUp API error ${String(res.status)}: ${res.statusText} - ${body}`,
    );
  }

  return res.json() as Promise<T>;
}

const throttledRequest = throttle(apiRequest);

export interface DownloadedAttachment {
  extension: string;
  localPath: string;
  title: string;
}

export async function addComment(taskId: string, text: string): Promise<void> {
  await throttledRequest(`/task/${taskId}/comment`, {
    body: JSON.stringify({ comment_text: text }),
    method: "POST",
  });
  log.debug({ taskId }, "Added comment to task");
}

export async function downloadAttachments(
  task: ClickUpTask,
  destDir: string,
): Promise<DownloadedAttachment[]> {
  if (task.attachments.length === 0) return [];

  const attachDir = join(destDir, ".task-attachments");
  if (!existsSync(attachDir)) {
    mkdirSync(attachDir, { recursive: true });
  }

  const results: DownloadedAttachment[] = [];

  for (const attachment of task.attachments) {
    try {
      const filename = sanitizeFilename(attachment.title);
      const localPath = join(attachDir, filename);

      const res = await fetch(attachment.url, {
        headers: { Authorization: getConfig().CLICKUP_API_TOKEN },
      });

      if (!res.ok || !res.body) {
        log.warn(
          { status: res.status, title: attachment.title },
          "Failed to download attachment",
        );
        continue;
      }

      const nodeStream = Readable.fromWeb(res.body);
      await pipeline(nodeStream, createWriteStream(localPath));

      results.push({
        extension: attachment.extension,
        localPath,
        title: attachment.title,
      });

      log.debug(
        { localPath, title: attachment.title },
        "Downloaded attachment",
      );

      if (
        attachment.extension === "docx" ||
        attachment.title.endsWith(".docx")
      ) {
        try {
          const mdResult = await mammoth.extractRawText({ path: localPath });
          const mdPath = localPath.replace(/\.docx$/i, ".md");
          writeFileSync(mdPath, mdResult.value, "utf-8");
          results.push({
            extension: "md",
            localPath: mdPath,
            title: attachment.title.replace(/\.docx$/i, ".md"),
          });
          log.debug({ mdPath }, "Converted docx to text");
        } catch (convErr) {
          log.warn(
            { error: convErr, title: attachment.title },
            "Failed to convert docx to text",
          );
        }
      }
    } catch (err) {
      log.warn(
        { error: err, title: attachment.title },
        "Failed to download attachment",
      );
    }
  }

  log.info(
    { count: results.length, taskId: task.id },
    "Downloaded task attachments",
  );
  return results;
}

export function getRepoUrl(task: ClickUpTask): null | string {
  const config = getConfig();
  const field = task.custom_fields.find(
    (f) => f.id === config.CLICKUP_REPO_FIELD_ID,
  );
  if (!field?.value || typeof field.value !== "string") return null;
  return field.value;
}

export async function getTask(taskId: string): Promise<ClickUpTask> {
  const task = await throttledRequest<ClickUpTask>(
    `/task/${taskId}?include_subtasks=true`,
  );
  log.debug({ taskId }, "Fetched task");
  return task;
}

export async function removeAssignee(
  taskId: string,
  userId: string,
): Promise<void> {
  await throttledRequest(`/task/${taskId}`, {
    body: JSON.stringify({ assignees: { rem: [Number(userId)] } }),
    method: "PUT",
  });
  log.debug({ taskId, userId }, "Removed assignee from task");
}

export async function setCustomField(
  taskId: string,
  fieldId: string,
  value: unknown,
): Promise<void> {
  await throttledRequest(`/task/${taskId}/field/${fieldId}`, {
    body: JSON.stringify({ value }),
    method: "POST",
  });
  log.debug({ fieldId, taskId }, "Set custom field");
}

export async function updateTaskStatus(
  taskId: string,
  status: string,
): Promise<void> {
  await throttledRequest(`/task/${taskId}`, {
    body: JSON.stringify({ status }),
    method: "PUT",
  });
  log.info({ status, taskId }, "Updated task status");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").trim() || "attachment";
}
