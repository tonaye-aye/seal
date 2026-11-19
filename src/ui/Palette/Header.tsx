import { APP_NAME } from "../../lib/app";
import { formatDay, now } from "../../lib/clock";
import { useScan, type ScanState } from "../../lib/scan-store";
import { clockTime } from "../format";
import { Mark } from "./Mark";

// Top bar: who we are, what day it is, and what the agent is doing (or when
// it last checked).

const STAGE_SHORT = {
  sync: "Syncing",
  read: "Reading",
  detect: "Looking",
  retrieve: "Gathering evidence",
  extract: "Reading evidence",
  verify: "Checking figures",
  judge: "Deciding",
  draft: "Drafting",
} as const;

function status(scan: ScanState): { text: string; dot: string } {
  switch (scan.phase) {
    case "idle":
      return { text: "Not checked yet", dot: "bg-faint" };
    case "scanning": {
      const stage = scan.stage ? STAGE_SHORT[scan.stage] : "Starting";
      const p = scan.progress;
      return { text: p ? `${stage} ${p.done}/${p.total}` : stage, dot: "bg-amber motion-safe:animate-pulse" };
    }
    case "done":
      return { text: `Checked ${clockTime(scan.result?.checkedAt ?? "")}`, dot: "bg-positive" };
    case "error":
      return { text: "Check didn't finish", dot: "bg-danger" };
  }
}

export function Header() {
  const scan = useScan();
  const s = status(scan);
  return (
    <header className="flex h-12 shrink-0 items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <span className="text-amber">
          <Mark />
        </span>
        <span className="font-medium tracking-[-0.01em]">{APP_NAME}</span>
        <span className="text-faint">Household check</span>
      </div>
      <div className="flex items-center gap-3 font-mono text-[11px] text-faint">
        <span className="flex items-center gap-1.5" aria-live="polite">
          <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
          <span className="tabular">{s.text}</span>
        </span>
        <span className="text-muted">{formatDay(now())}</span>
      </div>
    </header>
  );
}
