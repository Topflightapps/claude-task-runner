import type { TaskRun } from "../types.ts";

export function QueuePanel({ runs }: { runs: TaskRun[] }) {
  const queued = runs.filter((r) => r.status === "claimed");

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="mb-3 text-lg font-semibold text-white">Queue</h2>
      {queued.length === 0 ? (
        <p className="text-sm text-gray-500">No tasks in queue</p>
      ) : (
        <ul className="space-y-2">
          {queued.map((run) => (
            <li
              key={run.id}
              className="rounded border border-gray-800 bg-gray-950 px-3 py-2 text-sm"
            >
              <span className="text-gray-400">#{run.id}</span>
              <span className="mx-2 text-gray-600">|</span>
              <a
                href={`https://app.clickup.com/t/${run.clickup_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300"
              >
                {run.clickup_id}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
