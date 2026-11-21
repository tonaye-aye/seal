import type { Stage } from "../agent/pipeline";
import type { ScanState } from "../lib/scan-store";

// How far through a check the agent is, as a percentage, for onboarding's last
// step. An estimate: each stage has a share of the work, and the stages that
// call the models get most of it. Drafting runs alongside judging, so it
// shares judging's slice. It only says 100 once the check has really finished.

const STAGES: Stage[] = ["sync", "read", "detect", "retrieve", "extract", "verify", "judge"];
const SHARE: Partial<Record<Stage, number>> = { sync: 8, read: 4, detect: 3, retrieve: 3, extract: 32, verify: 2, judge: 48 };

export function scanPercent(scan: ScanState): number {
  if (scan.phase === "done") return 100;
  if (scan.phase !== "scanning" || !scan.stage) return 0;
  const at = STAGES.indexOf(scan.stage);
  if (at < 0) return 0;
  const before = STAGES.slice(0, at).reduce((sum, stage) => sum + (SHARE[stage] ?? 0), 0);
  const p = scan.progress;
  const within = p && p.stage === scan.stage && p.total > 0 ? p.done / p.total : 0;
  return Math.min(99, Math.floor(before + (SHARE[scan.stage] ?? 0) * within));
}
