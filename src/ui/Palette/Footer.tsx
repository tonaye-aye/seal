import { formatDay, now } from "../../lib/clock";
import { useScan, type ScanState } from "../../lib/scan-store";
import { copy } from "../../copy";
import { clockTime } from "../format";
import { SimulatingChip } from "./ScenariosSheet";

// Bottom bar. On the left: the Settings cog, Sync, Trace, then what the agent
// is doing (or when it last checked) and the date. On the right: what the
// selected row's keys or clicks do. While a demo failure is switched on, a
// "Simulating" chip (info colour) shows too, so one is never left on by accident.
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
  return (
    <footer className="relative flex h-10 shrink-0 items-center justify-between gap-3 px-3 text-meta">
      <div className="flex min-w-0 items-center gap-1">
        {settings}
        {sync}
        {trace}
        <span className="ml-2 flex min-w-0 items-center gap-2">
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
  const s = status(scan);
  return (
    <span className="flex shrink-0 items-center gap-3 font-mono text-label whitespace-nowrap text-faint">
      <span className="flex items-center gap-1.5" aria-live="polite">
        <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
        <span className="tabular">{s.text}</span>
      </span>
      <span className="text-muted">{formatDay(now())}</span>
    </span>
  );
}
