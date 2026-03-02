import { useCallback, useState } from "react";

import type { ClonedRepo } from "../types.ts";

export function useRepos(token: string | null) {
  const [repos, setRepos] = useState<ClonedRepo[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRepos = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/repos", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { repos: ClonedRepo[] };
        setRepos(data.repos);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  const deleteRepo = useCallback(
    async (id: number) => {
      if (!token) return;
      await fetch(`/api/repos/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchRepos();
    },
    [token, fetchRepos],
  );

  return { repos, loading, fetchRepos, deleteRepo };
}
