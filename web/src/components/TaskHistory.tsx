import { useState } from "react";

import type { TaskRun } from "../types.ts";

import { Pagination } from "./Pagination.tsx";
import { TaskRow } from "./TaskRow.tsx";

const PAGE_SIZE = 10;

export function TaskHistory({
  runs,
  onCancel,
  onRetry,
  onClear,
}: {
  runs: TaskRun[];
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  onClear: () => void;
}) {
  const [page, setPage] = useState(1);
  const historyRuns = runs.filter((r) =>
    ["done", "failed"].includes(r.status),
  );
  const totalPages = Math.ceil(historyRuns.length / PAGE_SIZE);
  const paginated = historyRuns.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Task History</h2>
          {historyRuns.length > 0 && (
            <span className="text-xs text-gray-500">
              ({historyRuns.length})
            </span>
          )}
        </div>
        {historyRuns.length > 0 && (
          <button
            onClick={onClear}
            className="rounded bg-gray-800 px-3 py-1 text-sm text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          >
            Clear History
          </button>
        )}
      </div>
      {historyRuns.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-500">
          No completed tasks yet
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-800 text-xs uppercase text-gray-500">
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">ClickUp</th>
                <th className="px-4 py-3">PR / Branch</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((run) => (
                <TaskRow
                  key={run.id}
                  run={run}
                  onCancel={onCancel}
                  onRetry={onRetry}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}
