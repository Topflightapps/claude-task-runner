import { useRef, useLayoutEffect } from "react";

interface LogLine {
  runId: number;
  stream: string;
  line: string;
  ts?: string;
}

function formatTs(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LogViewer({
  lines,
  onClear,
}: {
  lines: LogLine[];
  onClear: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  };

  useLayoutEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="flex flex-col rounded-lg border border-gray-800 bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
        <span className="text-sm font-medium text-gray-400">Live Output</span>
        <div className="flex gap-2">
          <span className="text-xs text-gray-600">{lines.length} lines</span>
          <button
            onClick={onClear}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Clear
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-96 overflow-auto p-4 font-mono text-xs leading-5"
      >
        {lines.length === 0 ? (
          <span className="text-gray-600">Waiting for output...</span>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className={
                line.stream === "stderr" ? "text-red-400" : "text-green-300"
              }
            >
              {line.ts && (
                <span className="mr-2 text-gray-600">{formatTs(line.ts)}</span>
              )}
              {line.line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
