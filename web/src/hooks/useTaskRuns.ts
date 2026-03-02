import { useCallback, useRef, useState } from "react";

import type { TaskRun } from "../types.ts";

interface TaskRunsResult {
  rows: TaskRun[];
  total: number;
}

export function useTaskRuns(token: string | null) {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchRuns = useCallback(
    async (status?: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "100" });
        if (status) params.set("status", status);
        const res = await fetch(`/api/runs?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as TaskRunsResult;
          setRuns(data.rows);
          setTotal(data.total);
        }
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const startPolling = useCallback(
    (intervalMs = 5000) => {
      void fetchRuns();
      intervalRef.current = setInterval(() => void fetchRuns(), intervalMs);
      return () => clearInterval(intervalRef.current);
    },
    [fetchRuns],
  );

  const cancelRun = useCallback(
    async (id: number) => {
      if (!token) return;
      await fetch(`/api/runs/${id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchRuns();
    },
    [token, fetchRuns],
  );

  const retryRun = useCallback(
    async (id: number) => {
      if (!token) return;
      await fetch(`/api/runs/${id}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchRuns();
    },
    [token, fetchRuns],
  );

  const clearCompleted = useCallback(async () => {
    if (!token) return;
    await fetch("/api/runs/completed", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetchRuns();
  }, [token, fetchRuns]);

  return {
    runs,
    total,
    loading,
    fetchRuns,
    startPolling,
    cancelRun,
    retryRun,
    clearCompleted,
  };
}
