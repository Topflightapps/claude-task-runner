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

export async function addComment(taskId: string, text: string): Promise<void> {
  await throttledRequest(`/task/${taskId}/comment`, {
    body: JSON.stringify({ comment_text: text }),
    method: "POST",
  });
  log.debug({ taskId }, "Added comment to task");
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
