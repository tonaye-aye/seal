import { formatDay, now } from "../../lib/clock";
import { useScan, type ScanState } from "../../lib/scan-store";
import { clockTime } from "../format";
import { copy } from "../../copy";
import { centerWindow, startWindowDrag } from "../../lib/native";
import { NowVisual } from "./NowVisual";

// Top bar: who we are, where you are (the breadcrumb: "Life / Timeline /
// Skylink Internet"), what day it is, and what the agent is doing (or when
// it last checked). It is also the window's handle: drag it to move the
// palette, double-click it to put it back in the centre.

const STAGE_SHORT = copy.header.stage;

function status(scan: ScanState): { text: string; dot: string } {
  switch (scan.phase) {
    case "idle":
      return { text: copy.header.notChecked, dot: "bg-faint" };
    case "scanning": {
      const stage = scan.stage ? STAGE_SHORT[scan.stage] : copy.header.starting;
      const p = scan.progress;
      return { text: p ? copy.header.progress(stage, p.done, p.total) : stage, dot: "bg-info motion-safe:animate-pulse" };
    }
    case "done":
      // The timer's background check: the results shown are still the last ones.
      if (scan.refreshing) return { text: copy.header.checkingAgain, dot: "bg-info motion-safe:animate-pulse" };
      return { text: copy.header.checkedAt(clockTime(scan.result?.checkedAt ?? "")), dot: "bg-positive" };
    case "error":
      return { text: copy.header.didntFinish, dot: "bg-danger" };
  }
}

/**
 * `crumbs`: the view you're in, then an open finding's business. `search`: the
 * magnifier (SearchField.tsx), just left of the status. Both are left out on
 * the setup screens.
 */
export function Header({ crumbs = [], search }: { crumbs?: string[]; search?: React.ReactNode }) {
  const scan = useScan();
  const s = status(scan);
  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between gap-4 px-4"
      onMouseDown={(e) => {
        // Anything clickable in the bar (and the search) stays clickable.
        if (e.button !== 0 || (e.target as HTMLElement).closest("button, [role='search']")) return;
        if (e.detail === 2) centerWindow();
        else startWindowDrag();
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {/* The mark is the "now" visual: it shows what the agent is doing. */}
        <NowVisual />
        {/* relative: paints the name above the glow that spills behind it. */}
        <span className="heading relative text-body font-semibold">{copy.appName}</span>
        {crumbs.length > 0 && (
          <nav aria-label={copy.header.breadcrumb} className="flex min-w-0 items-center text-small">
            <ol className="flex min-w-0 items-center">
              {crumbs.map((crumb, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <li key={i} className="flex min-w-0 items-center">
                    <span className="px-2 text-faint" aria-hidden="true">
                      /
                    </span>
                    <span
                      aria-current={last ? "page" : undefined}
                      className={`max-w-[220px] truncate ${last ? "font-medium text-text" : "text-muted"}`}
                    >
                      {crumb}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </div>
      {/* Never shrinks: when room runs short, the breadcrumb is what gets cut. */}
      <div className="flex shrink-0 items-center gap-3">
        {search}
        <div className="flex items-center gap-3 font-mono text-label whitespace-nowrap text-faint">
          <span className="flex items-center gap-1.5" aria-live="polite">
            <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
            <span className="tabular">{s.text}</span>
          </span>
          <span className="text-muted">{formatDay(now())}</span>
        </div>
      </div>
    </header>
  );
}
