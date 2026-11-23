import type { Corpus } from "../agent/corpus.ts";
import type { ScanResult } from "../agent/pipeline.ts";
import type { ConnectorStatus } from "../connectors/index.ts";
import type { ConnectorId } from "../connectors/types.ts";
import type { TraceLine } from "./scan-store.ts";

// The last finished check, kept so the app can reopen on it instead of asking
// the models everything again at every launch. Only a complete, fully live
// check is kept: saved answers are quick to replay and carry their own label,
// and a partial check should never replace a good one.
//
// This file imports only types, so the crash screen can use it safely.

const KEY = "life.lastCheck";
// Raise this if the saved shape or what a check produces changes, so old saves are ignored.
const VERSION = 1;

export type ConnectorStatuses = Partial<Record<ConnectorId, ConnectorStatus>>;

export type LastCheck = {
  v: number;
  result: ScanResult;
  corpus: Corpus;
  startedAt: number;
  finishedAt: number;
  sources: ConnectorId[];
  statuses: ConnectorStatuses;
  trace: TraceLine[];
};

/** True when a check read every source, decided every case and used no saved answers. */
export function isCompleteLive(result: ScanResult, statuses: ConnectorStatuses, sources: ConnectorId[]): boolean {
  if (result.usedReplay || result.missing.length > 0 || result.undecided.length > 0) return false;
  if (!sources.every((id) => statuses[id]?.state === "ok")) return false;
  // A "Check X" finding (action none) has nothing to draft. Every other one needs its draft and routes.
  return result.findings.every((f) => f.action.kind === "none" || (!!f.draft && !!f.fix));
}

export function sameSources(a: ConnectorId[], b: ConnectorId[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function saveLastCheck(check: Omit<LastCheck, "v">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...check }));
  } catch {
    // Storage can be full or unavailable. The next launch then runs a normal check.
  }
}

/** The saved check, or undefined if there is none or it can't be trusted. */
export function loadLastCheck(): LastCheck | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as LastCheck | null;
    if (raw?.v !== VERSION) return undefined;
    const r = raw.result;
    const c = raw.corpus;
    const lists = [r?.findings, r?.cleared, r?.undecided, r?.upcoming, r?.missing, c?.accounts, c?.transactions, c?.emails, c?.documents, c?.events, raw.sources, raw.trace];
    if (!lists.every(Array.isArray) || typeof raw.finishedAt !== "number" || !raw.statuses) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export function forgetLastCheck(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
