import type { TaskRun } from "../types.ts";

import { StatusBadge } from "./StatusBadge.tsx";

function deriveBranchUrl(repoUrl: string | null, branchName: string | null): string | null {
  if (!repoUrl || !branchName) return null;
  // repoUrl might be like https://github.com/owner/repo.git or https://github.com/owner/repo
  const clean = repoUrl.replace(/\.git$/, "");
  return `${clean}/tree/${branchName}`;
}

function formatDuration(startedAt: string, updatedAt: string): string {
  const ms = new Date(updatedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return "-";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function TaskRow({
  run,
  onCancel,
  onRetry,
}: {
  run: TaskRun;
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  const clickupUrl = `https://app.clickup.com/t/${run.clickup_id}`;
  const branchUrl = deriveBranchUrl(run.repo_url, run.branch_name);
  const isActive = !["done", "failed"].includes(run.status);

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-900/50">
      <td className="px-4 py-3 text-sm text-gray-300">#{run.id}</td>
      <td className="px-4 py-3">
        <StatusBadge status={run.status} />
      </td>
      <td className="px-4 py-3">
        <a
          href={clickupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          {run.clickup_id}
        </a>
      </td>
      <td className="px-4 py-3 text-sm text-gray-400">
        {run.pr_url ? (
          <a
            href={run.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            PR
          </a>
        ) : branchUrl ? (
          <a
            href={branchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-gray-300"
          >
            {run.branch_name}
          </a>
        ) : (
          "-"
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-400">
        {run.cost_usd != null ? `$${run.cost_usd.toFixed(2)}` : "-"}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500">
        {formatDuration(run.started_at, run.updated_at)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500">
        {run.error_message ? (
          <span className="text-red-400" title={run.error_message}>
            {run.error_message.slice(0, 60)}
            {run.error_message.length > 60 ? "..." : ""}
          </span>
        ) : (
          "-"
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          {isActive && (
            <button
              onClick={() => onCancel(run.id)}
              className="rounded bg-red-900/50 px-2 py-1 text-xs text-red-300 hover:bg-red-900"
            >
              Cancel
            </button>
          )}
          {run.status === "failed" && (
            <button
              onClick={() => onRetry(run.id)}
              className="rounded bg-yellow-900/50 px-2 py-1 text-xs text-yellow-300 hover:bg-yellow-900"
            >
              Retry
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
