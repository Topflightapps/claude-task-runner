import type { ReviewRun } from "../types.ts";

import { StatusBadge } from "./StatusBadge.tsx";

export function ReviewsPanel({
  reviews,
  syncing,
  onCancel,
  onClear,
  onSync,
}: {
  reviews: ReviewRun[];
  syncing: boolean;
  onCancel: (id: number) => void;
  onClear: () => void;
  onSync: () => void;
}) {
  const pendingCount = reviews.filter((r) => r.status === "ready").length;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-300">PR Reviews</h2>
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-900 px-2 py-0.5 text-xs font-medium text-amber-300">
              {pendingCount} pending
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSync}
            disabled={syncing}
            className="rounded bg-blue-800 px-2.5 py-1 text-xs text-blue-200 hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync Reviews"}
          </button>
          {reviews.some(
            (r) => r.status === "ready" || r.status === "failed",
          ) && (
            <button
              onClick={onClear}
              className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-700"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {reviews.length === 0 ? (
        <p className="text-sm text-gray-500">
          No reviews yet. Click &quot;Sync Reviews&quot; to check GitHub.
        </p>
      ) : (
        <div className="space-y-2">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="flex items-center justify-between rounded border border-gray-800 bg-gray-950 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <a
                    href={review.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-medium text-blue-400 hover:text-blue-300"
                  >
                    {review.repo_full_name}#{review.pr_number}
                  </a>
                  <StatusBadge status={review.status} />
                </div>
                <p className="truncate text-xs text-gray-500">
                  {review.pr_title}
                </p>
                {review.status === "ready" && (
                  <p className="text-xs text-amber-400">
                    {review.comment_count} comment
                    {review.comment_count === 1 ? "" : "s"} — open PR to publish
                  </p>
                )}
                {review.error_message && (
                  <p className="truncate text-xs text-red-400">
                    {review.error_message}
                  </p>
                )}
              </div>
              {!["ready", "failed"].includes(review.status) && (
                <button
                  onClick={() => onCancel(review.id)}
                  className="ml-2 rounded bg-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-800"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
