import { useRef } from "react";
import { useLive } from "../../connectors/live";
import { formatDay, now } from "../../lib/clock";
import { useScan, type ScanState } from "../../lib/scan-store";
import { copy } from "../../copy";
import { CheckBar } from "../CheckProgress";
import { clockTime } from "../format";
import { useFinishing, useSlideX } from "../motion";
import { SimulatingChip } from "./ScenariosSheet";
import { useTick } from "./StatusStrip";

// Bottom bar. On the left: the Settings cog, Trace, Sync, the loading bar while
// a check runs, then what the agent is doing (or when it last checked) and the
// date. On the right: what the selected row's keys or clicks do. While a demo
// failure is switched on, a "Simulating" chip (info colour) shows too, so one
// is never left on by accident.
export function Footer({
  onScenarios,
  settings,
  sync,
  trace,
  right,
}: {
  onScenarios: () => void;
  /** The Settings cog (SettingsButton in Controls.tsx). */
  settings: React.ReactNode;
  sync: React.ReactNode;
  trace: React.ReactNode;
  right?: React.ReactNode;
}) {
  const scan = useScan();
  // A background check keeps the phase "done", so it never shows the bar.
  const running = scan.phase === "scanning";
  const finishing = useFinishing(running, scan.phase === "done");
  // The status slides over as the bar comes and goes.
  const statusRef = useRef<HTMLSpanElement>(null);
  useSlideX(statusRef);
  return (
    // @container: an open finding leaves this bar narrower, and ScanStatus adapts to it.
    <footer className="@container relative flex h-10 shrink-0 items-center justify-between gap-3 px-3 text-meta">
      <div className="flex min-w-0 items-center gap-1">
        <span className="flex shrink-0 items-center gap-1">
          {settings}
          {trace}
          {sync}
        </span>
        {(running || finishing) && <CheckBar scan={scan} leaving={finishing} />}
        <span ref={statusRef} className="ml-2 flex min-w-0 items-center gap-2">
          <ScanStatus />
          <SimulatingChip onClick={onScenarios} />
        </span>
      </div>
      {right && <div className="flex shrink-0 items-center gap-3 pr-1">{right}</div>}
    </footer>
  );
}

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

/** What the agent is doing, or when it last checked, then today's date. */
export function ScanStatus() {
  const scan = useScan();
  const live = useLive();
  const waiting = scan.phase === "scanning" ? Object.values(live.statuses).find((c) => c?.state === "retrying") : undefined;
  // Counts down while a source has asked us to wait.
  useTick(!!waiting);
  const s = status(scan);
  if (waiting) s.text = copy.header.retrying(copy.shared.source[waiting.id], Math.max(1, Math.ceil(((waiting.retryAt ?? Date.now()) - Date.now()) / 1000)));
  else if (scan.phase === "scanning" && live.slowReads) s.text = copy.header.slowDocuments(live.slowReads.done);
  return (
    <span className="flex min-w-0 items-center gap-3 font-mono text-label whitespace-nowrap text-faint">
      <span className="flex min-w-0 items-center gap-1.5" aria-live="polite">
        <span className={`size-1.5 shrink-0 rounded-full ${s.dot}`} aria-hidden="true" />
        <span className="min-w-0 truncate tabular">{s.text}</span>
      </span>
      {/* In an open finding's narrower bar, the date steps aside while the loading bar needs the room. */}
      <span className={`shrink-0 text-muted ${scan.phase === "scanning" ? "@max-[720px]:hidden" : ""}`}>{formatDay(now())}</span>
    </span>
  );
}
