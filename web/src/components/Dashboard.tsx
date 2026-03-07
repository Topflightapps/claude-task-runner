import { useEffect } from "react";

import { useLearnings } from "../hooks/useLearnings.ts";
import { useReviews } from "../hooks/useReviews.ts";
import { useTaskRuns } from "../hooks/useTaskRuns.ts";
import { useWebSocket } from "../hooks/useWebSocket.ts";
import { ActiveTask } from "./ActiveTask.tsx";
import { LearningsPanel } from "./LearningsPanel.tsx";
import { LogViewer } from "./LogViewer.tsx";
import { QueuePanel } from "./QueuePanel.tsx";
import { ReposPanel } from "./ReposPanel.tsx";
import { ReviewsPanel } from "./ReviewsPanel.tsx";
import { TaskHistory } from "./TaskHistory.tsx";

export function Dashboard({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const { runs, startPolling, cancelRun, retryRun, clearCompleted } =
    useTaskRuns(token);

  const { lines, connected, clearLines, reviewVersion } = useWebSocket(token);

  const {
    reviews,
    cancelReview,
    clearCompleted: clearCompletedReviews,
    dismissReview,
    retryReview,
    reviewsEnabled,
    syncReviews,
    syncing,
    toggleReviewsEnabled,
  } = useReviews(token, reviewVersion);

  const {
    learnings,
    stats: learningStats,
    total: learningsTotal,
    loading: learningsLoading,
    deleteLearning: deleteLearningItem,
    fetchLearnings,
  } = useLearnings(token);

  useEffect(() => startPolling(5000), [startPolling]);

  const activeRun =
    runs.find((r) => !["done", "failed"].includes(r.status)) ?? null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Claude Task Runner</h1>
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
              title={
                connected ? "WebSocket connected" : "WebSocket disconnected"
              }
            />
          </div>
          <button
            onClick={onLogout}
            className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          >
            Logout
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ActiveTask run={activeRun} onCancel={(id) => void cancelRun(id)} />
          </div>
          <QueuePanel runs={runs} />
        </div>
        <LogViewer lines={lines} onClear={clearLines} />
        <ReviewsPanel
          reviews={reviews}
          reviewsEnabled={reviewsEnabled}
          syncing={syncing}
          onCancel={(id) => void cancelReview(id)}
          onClear={() => void clearCompletedReviews()}
          onDismiss={(id) => void dismissReview(id)}
          onRetry={(id) => void retryReview(id)}
          onSync={() => void syncReviews()}
          onToggleEnabled={(enabled) => void toggleReviewsEnabled(enabled)}
        />
        <LearningsPanel
          learnings={learnings}
          stats={learningStats}
          total={learningsTotal}
          loading={learningsLoading}
          onDelete={(id) => void deleteLearningItem(id)}
          onFilter={(filters) => void fetchLearnings(filters)}
        />
        <ReposPanel token={token} />
        <TaskHistory
          runs={runs}
          onCancel={(id) => void cancelRun(id)}
          onRetry={(id) => void retryRun(id)}
          onClear={() => void clearCompleted()}
        />
      </main>
    </div>
  );
}
