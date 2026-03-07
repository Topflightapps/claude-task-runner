import { useState } from "react";

import type { Learning, LearningStats } from "../hooks/useLearnings.ts";

function formatDate(dateStr: string): string {
  return new Date(dateStr + "Z").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseTags(tagsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tagsJson);
    if (Array.isArray(parsed))
      return parsed.filter((t): t is string => typeof t === "string");
  } catch {
    // ignore
  }
  return [];
}

const AGENT_COLORS: Record<string, string> = {
  kickoff: "bg-blue-900 text-blue-300",
  ralph: "bg-purple-900 text-purple-300",
  review: "bg-amber-900 text-amber-300",
  qa: "bg-green-900 text-green-300",
};

const CATEGORY_COLORS: Record<string, string> = {
  pattern: "bg-cyan-900 text-cyan-300",
  gotcha: "bg-red-900 text-red-300",
  architecture: "bg-indigo-900 text-indigo-300",
  debugging: "bg-orange-900 text-orange-300",
  testing: "bg-green-900 text-green-300",
  tooling: "bg-yellow-900 text-yellow-300",
  convention: "bg-pink-900 text-pink-300",
};

export function LearningsPanel({
  learnings,
  stats,
  total,
  loading,
  onDelete,
  onFilter,
}: {
  learnings: Learning[];
  stats: LearningStats | null;
  total: number;
  loading: boolean;
  onDelete: (id: number) => void;
  onFilter: (filters?: { category?: string; source_agent?: string }) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<number | null>(null);

  const handleFilter = (category: string | null, agent: string | null) => {
    setActiveCategory(category);
    setActiveAgent(agent);
    onFilter({
      category: category ?? undefined,
      source_agent: agent ?? undefined,
    });
  };

  const handleDelete = (id: number) => {
    setDeleting(id);
    onDelete(id);
    setDeleting(null);
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Librarian Learnings
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {total} learning{total !== 1 ? "s" : ""} stored
            </p>
          </div>
          {(activeCategory || activeAgent) && (
            <button
              onClick={() => handleFilter(null, null)}
              className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-700"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Stats bar */}
        {stats &&
          (stats.byCategory.length > 0 || stats.bySourceAgent.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {stats.byCategory.map((s) => (
                <button
                  key={s.category ?? "uncategorized"}
                  onClick={() =>
                    handleFilter(
                      activeCategory === (s.category ?? "uncategorized")
                        ? null
                        : s.category,
                      activeAgent,
                    )
                  }
                  className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                    activeCategory === s.category ? "ring-1 ring-white/30" : ""
                  } ${CATEGORY_COLORS[s.category ?? ""] ?? "bg-gray-800 text-gray-400"}`}
                >
                  {s.category ?? "uncategorized"} ({s.count})
                </button>
              ))}
              <span className="mx-1 text-gray-700">|</span>
              {stats.bySourceAgent.map((s) => (
                <button
                  key={s.source_agent ?? "unknown"}
                  onClick={() =>
                    handleFilter(
                      activeCategory,
                      activeAgent === (s.source_agent ?? "unknown")
                        ? null
                        : s.source_agent,
                    )
                  }
                  className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                    activeAgent === s.source_agent ? "ring-1 ring-white/30" : ""
                  } ${AGENT_COLORS[s.source_agent ?? ""] ?? "bg-gray-800 text-gray-400"}`}
                >
                  {s.source_agent ?? "unknown"} ({s.count})
                </button>
              ))}
            </div>
          )}
      </div>

      {loading && learnings.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-500">
          Loading...
        </p>
      ) : learnings.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-500">
          No learnings yet. Learnings will appear here after tasks and reviews are processed.
        </p>
      ) : (
        <div className="divide-y divide-gray-800">
          {learnings.map((learning) => {
            const tags = parseTags(learning.tags);
            const isExpanded = expanded.has(learning.id);

            return (
              <div key={learning.id} className="px-6 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => toggleExpand(learning.id)}
                      className="text-left"
                    >
                      <p
                        className={`text-sm text-gray-200 ${
                          isExpanded ? "" : "line-clamp-2"
                        }`}
                      >
                        {learning.content}
                      </p>
                    </button>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {learning.category && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            CATEGORY_COLORS[learning.category] ??
                            "bg-gray-800 text-gray-400"
                          }`}
                        >
                          {learning.category}
                        </span>
                      )}
                      {learning.source_agent && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            AGENT_COLORS[learning.source_agent] ??
                            "bg-gray-800 text-gray-400"
                          }`}
                        >
                          {learning.source_agent}
                        </span>
                      )}
                      {learning.project_type && (
                        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                          {learning.project_type}
                        </span>
                      )}
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-gray-800/50 px-1.5 py-0.5 text-xs text-gray-500"
                        >
                          {tag}
                        </span>
                      ))}
                      <span className="text-xs text-gray-600">
                        {formatDate(learning.created_at)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(learning.id)}
                    disabled={deleting === learning.id}
                    className="shrink-0 rounded bg-red-900/50 px-2 py-1 text-xs text-red-300 hover:bg-red-900 disabled:opacity-50"
                  >
                    {deleting === learning.id ? "..." : "Delete"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
