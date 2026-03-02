import type { TaskRun } from "../types.ts";

import { StatusBadge } from "./StatusBadge.tsx";

export function ActiveTask({
  run,
  onCancel,
}: {
  run: TaskRun | null;
  onCancel: (id: number) => void;
}) {
  if (!run) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-2 text-lg font-semibold text-white">Active Task</h2>
        <p className="text-sm text-gray-500">No task currently running</p>
      </div>
    );
  }

  const clickupUrl = `https://app.clickup.com/t/${run.clickup_id}`;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Active Task</h2>
        <button
          onClick={() => onCancel(run.id)}
          className="rounded bg-red-900/50 px-3 py-1 text-sm text-red-300 hover:bg-red-900"
        >
          Cancel
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-500">Run ID: </span>
          <span className="text-gray-200">#{run.id}</span>
        </div>
        <div>
          <span className="text-gray-500">Status: </span>
          <StatusBadge status={run.status} />
        </div>
        <div>
          <span className="text-gray-500">ClickUp: </span>
          <a
            href={clickupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            {run.clickup_id}
          </a>
        </div>
        <div>
          <span className="text-gray-500">Branch: </span>
          <span className="text-gray-300">
            {run.branch_name ?? "pending..."}
          </span>
        </div>
      </div>
    </div>
  );
}
