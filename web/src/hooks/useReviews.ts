import { useCallback, useRef, useState } from "react";

import type { ReviewRun } from "../types.ts";

interface ReviewRunsResult {
  rows: ReviewRun[];
  total: number;
}

export function useReviews(token: string | null, wsVersion: number) {
  const [reviews, setReviews] = useState<ReviewRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reviewsEnabled, setReviewsEnabled] = useState(true);
  const lastVersionRef = useRef(-1);
  const settingsFetchedRef = useRef(false);

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

  // Fetch reviews-enabled setting once on mount
  if (!settingsFetchedRef.current && token) {
    settingsFetchedRef.current = true;
    void (async () => {
      const res = await fetch("/api/settings/reviews-enabled", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { enabled: boolean };
        setReviewsEnabled(data.enabled);
      }
    })();
  }

  // Refetch when WebSocket version changes (replaces interval polling)
  if (wsVersion !== lastVersionRef.current) {
    lastVersionRef.current = wsVersion;
    void fetchReviews();
  }

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

  const retryReview = useCallback(
    async (id: number) => {
      if (!token) return;
      await fetch(`/api/reviews/${id}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchReviews();
    },
    [token, fetchReviews],
  );

  const dismissReview = useCallback(
    async (id: number) => {
      if (!token) return;
      await fetch(`/api/reviews/${id}`, {
        method: "DELETE",
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

  const toggleReviewsEnabled = useCallback(
    async (enabled: boolean) => {
      if (!token) return;
      await fetch("/api/settings/reviews-enabled", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled }),
      });
      setReviewsEnabled(enabled);
    },
    [token],
  );

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
    cancelReview,
    clearCompleted,
    dismissReview,
    fetchReviews,
    loading,
    retryReview,
    reviews,
    reviewsEnabled,
    syncing,
    syncReviews,
    toggleReviewsEnabled,
    total,
  };
}
