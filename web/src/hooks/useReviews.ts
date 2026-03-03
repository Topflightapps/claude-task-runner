import { useCallback, useRef, useState } from "react";

import type { ReviewRun } from "../types.ts";

interface ReviewRunsResult {
  rows: ReviewRun[];
  total: number;
}

export function useReviews(token: string | null) {
  const [reviews, setReviews] = useState<ReviewRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchReviews = useCallback(
    async (status?: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "100" });
        if (status) params.set("status", status);
        const res = await fetch(`/api/reviews?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as ReviewRunsResult;
          setReviews(data.rows);
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
      void fetchReviews();
      intervalRef.current = setInterval(() => void fetchReviews(), intervalMs);
      return () => clearInterval(intervalRef.current);
    },
    [fetchReviews],
  );

  const cancelReview = useCallback(
    async (id: number) => {
      if (!token) return;
      await fetch(`/api/reviews/${id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchReviews();
    },
    [token, fetchReviews],
  );

  const clearCompleted = useCallback(async () => {
    if (!token) return;
    await fetch("/api/reviews/completed", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetchReviews();
  }, [token, fetchReviews]);

  const syncReviews = useCallback(async () => {
    if (!token) return;
    setSyncing(true);
    try {
      await fetch("/api/reviews/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchReviews();
    } finally {
      setSyncing(false);
    }
  }, [token, fetchReviews]);

  return {
    reviews,
    total,
    loading,
    syncing,
    fetchReviews,
    startPolling,
    cancelReview,
    clearCompleted,
    syncReviews,
  };
}
