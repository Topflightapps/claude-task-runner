import { useEffect, useState } from "react";

import type { ClonedRepo } from "../types.ts";
import { useRepos } from "../hooks/useRepos.ts";

function formatSize(bytes: number | null): string {
  if (bytes == null) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "Z").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function repoName(repoUrl: string): string {
  const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(repoUrl);
  return match?.[1] ?? repoUrl;
}

export function ReposPanel({ token }: { token: string }) {
  const { repos, fetchRepos, deleteRepo } = useRepos(token);
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    void fetchRepos();
  }, [fetchRepos]);

  const totalSize = repos.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0);

  const handleDelete = async (repo: ClonedRepo) => {
    setDeleting(repo.id);
    await deleteRepo(repo.id);
    setDeleting(null);
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Cloned Repos</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {repos.length} repo{repos.length !== 1 ? "s" : ""} — {formatSize(totalSize)} total
          </p>
        </div>
      </div>
      {repos.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-500">
          No cloned repos tracked yet
        </p>
      ) : (
        <div className="divide-y divide-gray-800">
          {repos.map((repo) => (
            <div
              key={repo.id}
              className="flex items-center justify-between px-6 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200">
                    {repoName(repo.repo_url)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatSize(repo.size_bytes)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-gray-600">
                  {repo.disk_path}
                </div>
                <div className="mt-0.5 text-xs text-gray-600">
                  Last used {formatDate(repo.last_used_at)}
                </div>
              </div>
              <button
                onClick={() => void handleDelete(repo)}
                disabled={deleting === repo.id}
                className="ml-4 shrink-0 rounded bg-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900 disabled:opacity-50"
              >
                {deleting === repo.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
