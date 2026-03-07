import { useCallback, useRef, useState } from "react";

export interface Learning {
  category: string | null;
  content: string;
  created_at: string;
  id: number;
  project_type: string | null;
  source_agent: string | null;
  source_repo: string | null;
  source_task_id: string | null;
  superseded_by: number | null;
  tags: string;
  updated_at: string;
}

export interface LearningStats {
  byCategory: { category: string | null; count: number }[];
  bySourceAgent: { count: number; source_agent: string | null }[];
}

interface LearningsResult {
  rows: Learning[];
  total: number;
}

export function useLearnings(token: string | null) {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const fetchLearnings = useCallback(
    async (filters?: {
      category?: string;
      project_type?: string;
      source_agent?: string;
    }) => {
      if (!token) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "100" });
        if (filters?.category) params.set("category", filters.category);
        if (filters?.project_type)
          params.set("project_type", filters.project_type);
        if (filters?.source_agent)
          params.set("source_agent", filters.source_agent);
        const res = await fetch(`/api/learnings?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as LearningsResult;
          setLearnings(data.rows);
          setTotal(data.total);
        }
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const fetchStats = useCallback(async () => {
    if (!token) return;
    const res = await fetch("/api/learnings/stats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = (await res.json()) as LearningStats;
      setStats(data);
    }
  }, [token]);

  const deleteLearning = useCallback(
    async (id: number) => {
      if (!token) return;
      await fetch(`/api/learnings/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchLearnings();
      await fetchStats();
    },
    [token, fetchLearnings, fetchStats],
  );

  // Initial fetch
  if (!fetchedRef.current && token) {
    fetchedRef.current = true;
    void fetchLearnings();
    void fetchStats();
  }

  return {
    deleteLearning,
    fetchLearnings,
    fetchStats,
    learnings,
    loading,
    stats,
    total,
  };
}
