export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-t border-gray-800 px-6 py-3">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-800"
      >
        Prev
      </button>
      <span className="text-xs text-gray-500">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-800"
      >
        Next
      </button>
    </div>
  );
}
