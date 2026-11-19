// What the "now" visual shows, worked out from the real scan state. Nothing
// here is animated or faked: it only reads the scan store's phase, its
// background check, the findings and Maya's decisions.
//
// - working: a scan is running, or the 30-minute background check is.
// - needs-you: at least one finding is still waiting for Maya.
// - idle: nothing is running and nothing is waiting (or no check has finished).
//
// urgency (0 to 1) says how pressing the waiting findings are: mostly how soon
// the nearest deadline is, partly how much money is at stake.

import { rankedFindings, type ScanState } from "../lib/scan-store";
import { daysUntil, headlineAmount } from "./format";

export type NowState = "idle" | "working" | "needs-you";

export type Now = { state: NowState; urgency: number; waiting: number };

/** A deadline this many days away or more adds nothing to urgency. */
const CALM_DAYS = 30;
/** Money at stake that counts as fully urgent, in dollars. */
const BIG_DOLLARS = 1000;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function nowFrom(scan: ScanState): Now {
  const waiting = scan.phase === "done" || scan.refreshing ? rankedFindings(scan).filter((f) => f.status === "new") : [];

  // Soonest deadline: today (or overdue) is 1, a month away is 0.
  const soonest = Math.min(...waiting.flatMap((f) => (f.deadline ? [daysUntil(f.deadline.date)] : [])));
  const deadline = Number.isFinite(soonest) ? clamp01(1 - soonest / CALM_DAYS) : 0;

  // Money on a log scale, so $40 still registers next to $376.
  const cents = waiting.reduce((sum, f) => sum + (headlineAmount(f)?.cents ?? 0), 0);
  const money = clamp01(Math.log10(1 + cents / 100) / Math.log10(1 + BIG_DOLLARS));

  const urgency = waiting.length ? Math.round((0.65 * deadline + 0.35 * money) * 100) / 100 : 0;

  const working = scan.phase === "scanning" || scan.refreshing;
  const state: NowState = working ? "working" : waiting.length ? "needs-you" : "idle";
  return { state, urgency, waiting: waiting.length };
}
