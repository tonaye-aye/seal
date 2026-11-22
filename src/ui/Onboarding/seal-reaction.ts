import type { Step } from "../../lib/onboarding";
import { getScan, subscribeScan, type ScanState } from "../../lib/scan-store";

// What the onboarding seal should be doing, worked out from the step and the
// real check. The seal is drawn again on every summon, so whether it has
// already celebrated is kept here, outside it.

export type SealReaction = "rest" | "wave" | "lift" | "held" | "checking" | "found";

/** Whether the seal has the plug up on the connect step, and if it should lift it or already has it. */
export type SealPlug = "none" | "lift" | "held";

/** Waving on step 1 until the summon key is pressed, holding the plug once a source connects, holding up its props while a check runs, happy once it found something to look at. */
export function sealReaction(step: Step, summoned: boolean, phase: ScanState["phase"], findings: number, plug: SealPlug = "none"): SealReaction {
  if (step === "welcome") return summoned ? "rest" : "wave";
  if (step === "connect" && plug !== "none") return plug;
  if (step !== "first-scan") return "rest";
  if (phase === "scanning") return "checking";
  return phase === "done" && findings > 0 ? "found" : "rest";
}

let celebrated = false;

// Only a full check starts here: Try again, or onboarding run from the start.
// A background re-check stays "done", so it can't replay the celebration.
subscribeScan(() => {
  if (getScan().phase === "scanning") celebrated = false;
});

/** True the first time it's asked for each check, so the celebration plays once. */
export function takeCelebration(): boolean {
  if (celebrated) return false;
  celebrated = true;
  return true;
}
