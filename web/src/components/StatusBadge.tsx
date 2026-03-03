const STATUS_COLORS: Record<string, string> = {
  approved: "bg-green-900 text-green-300",
  claimed: "bg-yellow-900 text-yellow-300",
  cloning: "bg-blue-900 text-blue-300",
  creating_pr: "bg-purple-900 text-purple-300",
  done: "bg-green-900 text-green-300",
  failed: "bg-red-900 text-red-300",
  queued: "bg-yellow-900 text-yellow-300",
  ready: "bg-amber-900 text-amber-300",
  reviewing: "bg-cyan-900 text-cyan-300",
  running_claude: "bg-cyan-900 text-cyan-300",
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-gray-800 text-gray-300";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
