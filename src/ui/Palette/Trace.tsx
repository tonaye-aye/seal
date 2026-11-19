import { useEffect, useRef } from "react";
import type { TraceLine } from "../../lib/scan-store";

// The agent's log, in plain words: what it read, what it checked, what it
// found and what went wrong. It makes the wait legible and the agent
// accountable. `limit` shows only the latest lines (used while scanning).

const TONE: Record<TraceLine["tone"], string> = {
  info: "bg-faint",
  good: "bg-positive",
  warn: "bg-amber",
  bad: "bg-danger",
};

export function TraceLines({ lines, limit }: { lines: TraceLine[]; limit?: number }) {
  const shown = limit ? lines.slice(-limit) : lines;
  return (
    <ol className="flex flex-col gap-1">
      {shown.map((line) => (
        <li key={line.id} className="trace-in flex items-baseline gap-2.5 text-[12px] leading-[1.5]">
          <span className="w-10 shrink-0 text-right font-mono text-[10.5px] text-faint tabular">
            {(line.t / 1000).toFixed(1)}s
          </span>
          <span className={`relative top-[-1px] size-1.5 shrink-0 rounded-full ${TONE[line.tone]}`} aria-hidden="true" />
          <span className={line.tone === "bad" ? "text-danger" : "text-muted"}>{line.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** The trace as a drawer over the bottom of the palette (T opens and closes it). */
export function TraceDrawer({ lines, onClose }: { lines: TraceLine[]; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  // Follow new lines as they arrive.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines.length]);
  return (
    <section
      aria-label="What the agent did"
      className="drawer-in absolute inset-x-0 bottom-0 z-10 flex h-[230px] flex-col border-t border-hairline bg-surface/95 backdrop-blur"
    >
      <div className="flex h-9 shrink-0 items-center justify-between px-4">
        <span className="text-[12px] font-medium">What the agent did</span>
        <button type="button" onClick={onClose} className="text-[11.5px] text-faint hover:text-muted">
          Close <span className="font-mono">T</span>
        </button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {lines.length ? <TraceLines lines={lines} /> : <p className="text-faint">Nothing yet.</p>}
        <p className="mt-3 border-t border-hairline pt-2 text-[11.5px] text-faint">
          Connectors are read-only. Nothing is sent anywhere except to your model endpoint (on-device in production).
        </p>
      </div>
    </section>
  );
}
