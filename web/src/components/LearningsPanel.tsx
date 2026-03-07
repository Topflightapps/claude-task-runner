import { useRef, useState } from "react";

import type { Learning, LearningStats } from "../hooks/useLearnings.ts";
import { Pagination } from "./Pagination.tsx";

const PAGE_SIZE = 20;

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
  onFilter: (filters?: {
    category?: string;
    limit?: number;
    offset?: number;
    search?: string;
    sort?: string;
    source_agent?: string;
    tag?: string;
  }) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<number | null>(null);
  const [showTags, setShowTags] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const buildFilters = (overrides: {
    category?: string | null;
    agent?: string | null;
    tag?: string | null;
    search?: string;
    sort?: string;
    p?: number;
  } = {}) => {
    const cat =
      overrides.category !== undefined ? overrides.category : activeCategory;
    const agent =
      overrides.agent !== undefined ? overrides.agent : activeAgent;
    const tag = overrides.tag !== undefined ? overrides.tag : activeTag;
    const search =
      overrides.search !== undefined ? overrides.search : searchQuery;
    const sort = overrides.sort !== undefined ? overrides.sort : sortBy;
    const p = overrides.p !== undefined ? overrides.p : page;

    return {
      category: cat ?? undefined,
      limit: PAGE_SIZE,
      offset: (p - 1) * PAGE_SIZE,
      source_agent: agent ?? undefined,
      tag: tag ?? undefined,
      search: search || undefined,
      sort: sort === "newest" ? undefined : sort,
    };
  };

  const applyFilters = (overrides: {
    category?: string | null;
    agent?: string | null;
    tag?: string | null;
    search?: string;
    sort?: string;
    p?: number;
  } = {}) => {
    onFilter(buildFilters(overrides));
  };

  const handleFilter = (category: string | null, agent: string | null) => {
    setActiveCategory(category);
    setActiveAgent(agent);
    setPage(1);
    applyFilters({ category, agent, p: 1 });
  };

  const handleTagFilter = (tag: string | null) => {
    setActiveTag(tag);
    setPage(1);
    applyFilters({ tag, p: 1 });
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      applyFilters({ search: value, p: 1 });
    }, 300);
  };

  const handleSort = (value: string) => {
    setSortBy(value);
    setPage(1);
    applyFilters({ sort: value, p: 1 });
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    applyFilters({ p });
  };

  const clearAll = () => {
    setActiveCategory(null);
    setActiveAgent(null);
    setActiveTag(null);
    setSearchQuery("");
    setSortBy("newest");
    setPage(1);
    onFilter({ limit: PAGE_SIZE, offset: 0 });
  };

  const hasFilters = activeCategory || activeAgent || activeTag || searchQuery;

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

  const totalPages = Math.ceil(total / PAGE_SIZE);

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
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => handleSort(e.target.value)}
              className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-400 outline-none"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="category">By category</option>
            </select>
            {hasFilters && (
              <button
                onClick={clearAll}
                className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-700"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="mt-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search learnings..."
            className="w-full rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 outline-none ring-1 ring-gray-700 focus:ring-gray-600"
          />
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

        {/* Tag filter */}
        {stats && stats.allTags.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowTags(!showTags)}
              className="text-xs text-gray-500 hover:text-gray-400"
            >
              {showTags
                ? "Hide tags"
                : `Show tags (${String(stats.allTags.length)})`}
            </button>
            {showTags && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {stats.allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() =>
                      handleTagFilter(activeTag === tag ? null : tag)
                    }
                    className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                      activeTag === tag
                        ? "bg-gray-600 text-white ring-1 ring-white/30"
                        : "bg-gray-800/50 text-gray-500 hover:bg-gray-800 hover:text-gray-400"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {loading && learnings.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-500">
          Loading...
        </p>
      ) : learnings.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-500">
          {hasFilters
            ? "No learnings match your filters."
            : "No learnings yet. Learnings will appear here after tasks and reviews are processed."}
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
                        <button
                          key={tag}
                          onClick={() =>
                            handleTagFilter(activeTag === tag ? null : tag)
                          }
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            activeTag === tag
                              ? "bg-gray-600 text-white"
                              : "bg-gray-800/50 text-gray-500 hover:bg-gray-800"
                          }`}
                        >
                          {tag}
                        </button>
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
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={handlePageChange}
      />
    </div>
  );
}
