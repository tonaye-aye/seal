import { useEffect, useRef } from "react";
import type { TraceLine } from "../../lib/scan-store";
import type { FindingTraceLine } from "../finding-trace";
import { copy } from "../../copy";
import { KeyButton } from "../Kbd";
import { CloseIcon } from "../icons";

// The agent's log, in plain words: what it read, what it checked, what it
// found and what went wrong. It makes the wait legible and the agent
// accountable. `limit` shows only the latest lines (used while scanning).

const TONE: Record<TraceLine["tone"], string> = {
  info: "bg-faint",
  good: "bg-positive",
  warn: "bg-info",
  bad: "bg-danger",
};

export function TraceLines({ lines, limit }: { lines: FindingTraceLine[]; limit?: number }) {
  const shown = limit ? lines.slice(-limit) : lines;
  return (
    <ol className="flex flex-col gap-1">
      {shown.map((line) => (
        <li key={line.id} className="trace-in flex items-baseline gap-2.5 text-meta">
          {/* Seconds since the check started; a finding's own lines have no time column. */}
          {line.t !== undefined && (
            <span className="w-10 shrink-0 text-right figure text-label text-faint">
              {(line.t / 1000).toFixed(1)}s
            </span>
          )}
          <span className={`relative top-[-1px] size-1.5 shrink-0 rounded-full ${TONE[line.tone]}`} aria-hidden="true" />
          <span className={line.tone === "bad" ? "text-danger" : "text-muted"}>
            {line.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The trace as a drawer over the bottom of the palette (T opens and closes
 * it). Inside an open finding it starts on that finding's own trace, with a
 * switch to the whole check's.
 */
export function TraceDrawer({
  lines,
  finding,
  scope = "check",
  onScope,
  mouse = false,
  editing = false,
  onClose,
}: {
  lines: TraceLine[];
  /** The open finding's name and trace lines, when there is one. */
  finding?: { merchant: string; lines: FindingTraceLine[] };
  scope?: "finding" | "check";
  onScope?: (scope: "finding" | "check") => void;
  /** The mouse is driving: Close shows its X instead of the key. */
  mouse?: boolean;
  /** A draft is being edited: Esc ends that first, so Close shows its X (no single key closes the drawer then). */
  editing?: boolean;
  onClose: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const showFinding = scope === "finding" && !!finding;
  const shown = showFinding ? finding.lines : lines;
  // Follow new lines as they arrive (the whole check's, while it runs).
  useEffect(() => {
    if (showFinding) scroller.current?.scrollTo({ top: 0 });
    else scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines.length, showFinding]);
  return (
    <section
      aria-label={copy.trace.title}
      className="drawer-in absolute inset-x-0 bottom-0 z-10 flex h-(--trace-height) flex-col border-t border-hairline bg-surface/95 backdrop-blur"
    >
      <div className="flex h-9 shrink-0 items-center gap-3 px-4">
        <span className="text-meta font-medium">{copy.trace.title}</span>
        {finding && (
          // Which trace: this finding's, or the whole check's.
          <span role="group" className="flex items-center gap-0.5 rounded-md bg-raised p-0.5 text-meta">
            {(["finding", "check"] as const).map((s) => (
              <button
                key={s}
                type="button"
                tabIndex={-1}
                aria-pressed={scope === s}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onScope?.(s)}
                className={`press max-w-[220px] cursor-pointer truncate rounded-[5px] px-2 py-0.5 ${scope === s ? "bg-surface text-text shadow-(--shadow-menu)" : "text-faint hover:text-muted"}`}
              >
                {s === "finding" ? `${copy.trace.thisFinding}: ${finding.merchant}` : copy.trace.wholeCheck}
              </button>
            ))}
          </span>
        )}
        <span className="flex-1" />
        {/* Like every button: Esc's key cap in keyboard mode, an X with the mouse. */}
        <KeyButton keys={["Esc"]} label={copy.trace.close} icon={<CloseIcon />} mouse={mouse || editing} onClick={onClose} />
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {shown.length ? <TraceLines lines={shown} /> : <p className="text-faint">{copy.trace.nothingYet}</p>}
        <p className="mt-3 border-t border-hairline pt-2 text-meta text-faint">
          {showFinding ? copy.trace.finding.footnote : copy.trace.privacy}
        </p>
      </div>
    </section>
  );
}
