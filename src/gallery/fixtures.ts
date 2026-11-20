// Sample states for the dev gallery. Hand written from the Whitlocks' seed
// records (bank rows, emails, documents): evidence ids point at real seed
// items so the evidence trail opens them. Nothing here is read from
// seed/eval, and nothing runs the agent or calls a model.

import type { Corpus } from "../agent/corpus";
import type { ProposedDraft } from "../agent/draft";
import { merchantKey } from "../agent/merchants";
import type { Cleared, Finding, ScanResult } from "../agent/pipeline";
import type { Figure } from "../agent/verify";
import { createConnectors, syncAll, type ConnectorStatus } from "../connectors/index";
import type { LiveState } from "../connectors/live";
import { viteSeedSource } from "../connectors/source.vite";
import { buildCorpus } from "../agent/corpus";
import { now } from "../lib/clock";
import { toZonedIso } from "../lib/dates";
import type { ScanState, TraceLine } from "../lib/scan-store";

const CHECKED_AT = toZonedIso(now());

// ---------- The seed, read without delays or failures ----------

let corpus: Promise<Corpus> | undefined;

/** Everything the evidence trail can open, read once from the bundled seed (no model calls). */
export function sampleCorpus(): Promise<Corpus> {
  corpus ??= (async () => {
    // Its own connectors, so the real app's connector store is never touched.
    const c = await createConnectors({ source: viteSeedSource, scenarios: [], latencyScale: 0 });
    const snapshot = await syncAll(c, () => {});
    return buildCorpus(c, snapshot);
  })();
  return corpus;
}

// ---------- Findings ----------

const judged = { model: "sample", source: "cache" as const, ms: 0 };

function draft(to: { name: string; address: string }, subject: string, body: string, extra: Partial<ProposedDraft> = {}): ProposedDraft {
  return {
    channel: "email",
    to,
    subject,
    body,
    attachDocumentIds: [],
    grounded: true,
    problems: [],
    attempts: [],
    model: "sample",
    source: "cache",
    ms: 0,
    ...extra,
  };
}

function fig(id: string, label: string, value: Figure["value"], unit: Figure["unit"], sources: string[], how?: string): Figure {
  return { id, label, value, unit, sources, how };
}

const ev = (kind: Finding["evidence"][number]["kind"], id: string, cited = true) => ({ kind, id, cited });

const skylink: Finding = {
  id: "f-skylink",
  kind: "price_increase",
  merchant: "Skylink Internet",
  keys: [merchantKey("SKYLINK INTERNET P/L")],
  title: "Internet went from $79 to $99 inside the 24-month price",
  why: "The 2025 agreement fixes Fibre 100 at $79.00 a month for 24 months, but October and November were charged $99.00.",
  action: { kind: "dispute_price", summary: "Ask Skylink to restore $79.00 and credit the difference" },
  amounts: { atStake: 24000, recoverable: 4000, perMonth: 2000 },
  deadline: { date: "2026-12-14", label: "Next debit at $99.00" },
  confidence: "high",
  evidence: [
    ev("doc", "doc_001"),
    ev("email", "msg_0002"),
    ev("txn", "JE-00051"),
    ev("txn", "JE-00077"),
    ev("email", "msg_0024"),
    ev("txn", "JE-00024", false),
    ev("email", "msg_0072", false),
  ],
  figures: [
    fig("promised_price", "Promised price", 7900, "cents", ["doc:doc_001"]),
    fig("charged_price", "Charged since October", 9900, "cents", ["txn:JE-00051", "txn:JE-00077"]),
    fig("overcharged_so_far", "Overcharged so far", 4000, "cents", ["txn:JE-00051", "txn:JE-00077"], "($99.00 - $79.00) x 2 charges"),
    fig("next_charge", "Next debit", "2026-12-14", "date", ["txn:JE-00077"]),
  ],
  notes: [],
  doubts: [],
  status: "new",
  verified: true,
  judgedBy: judged,
  draft: draft(
    { name: "Skylink Internet", address: "support@skylink.example" },
    "Fibre 100 price: please restore $79.00",
    "Hi Skylink team,\n\nWhen we joined in October 2025, our agreement set Fibre 100 at $79.00 a month for 24 months. Our October and November debits were $99.00, so we've been overcharged $40.00 so far.\n\nCould you please put the plan back to $79.00 before the next debit on 14 December, and credit the $40.00?\n\nThanks, Maya",
  ),
};

const streambox: Finding = {
  id: "f-streambox",
  kind: "duplicate_subscription",
  merchant: "StreamBox",
  keys: [merchantKey("STREAMBOX AU"), merchantKey("APPLE.COM/BILL")],
  title: "Paying for StreamBox twice: direct and through Apple",
  why: "Apple receipts show a StreamBox subscription on Maya's card, while the same plan is also debited directly from the joint account.",
  // Nothing to send: the fix is a step Maya takes herself.
  action: { kind: "none", summary: "Cancel the Apple-billed one in Settings before it renews" },
  amounts: { recoverable: 5397, perMonth: 1799 },
  deadline: { date: "2026-11-20", label: "Cancel the Apple one before it renews" },
  confidence: "high",
  evidence: [ev("email", "msg_0052"), ev("txn", "MC-00038"), ev("txn", "JE-00065"), ev("email", "msg_0062"), ev("txn", "MC-00024", false)],
  figures: [
    fig("monthly_price", "Each subscription", 1799, "cents", ["txn:MC-00038", "txn:JE-00065"]),
    fig("apple_renews", "Apple renews", "2026-11-21", "date", ["email:msg_0052"]),
  ],
  notes: [],
  doubts: [],
  status: "new",
  verified: true,
  judgedBy: judged,
};

const ironworks: Finding = {
  id: "f-ironworks",
  kind: "renewal_trap",
  merchant: "IronWorks Fitness",
  keys: [merchantKey("IRONWORKS FITNESS DD")],
  title: "Annual gym fee due 28 Nov, notice date already passed",
  why: "The membership needs 14 days' notice, which was 14 Nov. The last visit was in early September.",
  action: { kind: "cancel", summary: "Give notice and ask them to waive the annual fee" },
  amounts: { atStake: 8900, perMonth: 2995 },
  deadline: { date: "2026-11-28", label: "$89.00 annual fee charged" },
  confidence: "medium",
  evidence: [ev("doc", "doc_008"), ev("email", "msg_0056"), ev("email", "msg_0048"), ev("txn", "JE-00066", false)],
  figures: [
    fig("annual_fee", "Annual fee", 8900, "cents", ["email:msg_0056"]),
    fig("notice_by", "Notice was due", "2026-11-14", "date", ["doc:doc_008"], "14 days before 28 Nov"),
  ],
  notes: [],
  doubts: ["The notice date has passed, so a waiver is a goodwill ask, not a right."],
  status: "new",
  verified: true,
  judgedBy: judged,
  draft: draft(
    { name: "IronWorks Fitness", address: "members@ironworks.example" },
    "Cancelling our membership",
    "Hi IronWorks,\n\nPlease cancel Ben's membership. We know the 14-day notice date was 14 November and we missed it. As he hasn't visited since September, would you consider waiving the $89.00 annual fee due on 28 November?\n\nThanks, Maya",
  ),
};

const brightpage: Finding = {
  id: "f-brightpage",
  kind: "trial_converted",
  merchant: "BrightPage Kids",
  keys: [merchantKey("BRIGHTPAGE KIDS PTY LTD")],
  title: "Reading app trial turned into $14.99 a month",
  why: "Three monthly charges since the free trial ended, and no reading since September.",
  action: { kind: "cancel", summary: "Cancel and ask for last month back" },
  amounts: { recoverable: 1499, perMonth: 1499 },
  deadline: { date: "2026-12-18", label: "Next charge" },
  confidence: "high",
  evidence: [ev("txn", "MC-00052"), ev("txn", "MC-00034"), ev("txn", "MC-00021")],
  figures: [fig("monthly_price", "Monthly price", 1499, "cents", ["txn:MC-00052"])],
  notes: [],
  doubts: [],
  status: "new",
  verified: true,
  judgedBy: judged,
  // A draft the claim check couldn't fully match, to show "Check before sending".
  draft: draft(
    { name: "BrightPage Kids", address: "help@brightpage.example" },
    "Please cancel our subscription",
    "Hi BrightPage,\n\nPlease cancel our subscription. We've paid $29.98 since the trial ended and haven't used it since September. Could you refund the latest $14.99 charge?\n\nThanks, Maya",
    { grounded: false, problems: ['"$29.98" isn\'t in the checked figures or the evidence'] },
  ),
};

const redgum: Finding = {
  id: "f-redgum",
  kind: "billing_error",
  merchant: "Redgum Energy",
  keys: [merchantKey("REDGUM ENERGY")],
  title: "Electricity bill used an estimate well above the meter",
  why: "The October bill estimated the reading; Ben's photo on 30 Oct shows a much lower one.",
  action: { kind: "correct_bill", summary: "Send the meter photo and ask for a corrected bill" },
  amounts: { recoverable: 17500 },
  confidence: "medium",
  evidence: [ev("doc", "doc_003"), ev("doc", "doc_004"), ev("email", "msg_0058"), ev("doc", "doc_002", false)],
  figures: [fig("meter_reading", "Meter photo reading", 47006, "kwh", ["doc:doc_004"])],
  notes: [],
  doubts: [],
  status: "new",
  verified: true,
  judgedBy: judged,
  draft: draft(
    { name: "Redgum Energy", address: "billing@redgum.example" },
    "Estimated reading on our October bill",
    "Hi Redgum,\n\nOur October bill used an estimated reading. Ben photographed the meter on 30 October and it read 47,006 kWh. The photo is attached. Could you please reissue the bill on the actual reading and credit the difference?\n\nThanks, Maya",
    { attachDocumentIds: ["doc_004"] },
  ),
};

export const FINDINGS = { skylink, streambox, ironworks, brightpage, redgum };

const kookaburra: Cleared = {
  id: "c-kookaburra",
  merchant: "Kookaburra Mobile",
  title: "Mobile went from $55.00 to $57.20",
  why: "The plan terms allow a yearly CPI rise, a 4.0% notice came on 15 Oct, and $55.00 x 1.04 is $57.20.",
  citedIds: ["doc_010", "msg_0050", "JE-00064"],
};

// ---------- Connectors ----------

function status(id: ConnectorStatus["id"], state: ConnectorStatus["state"], extra: Partial<ConnectorStatus> = {}): ConnectorStatus {
  const names = { bank: "Bank", email: "Email", documents: "Documents", calendar: "Calendar" };
  return { id, name: names[id], state, lastSyncedAt: CHECKED_AT, ...extra };
}

const allOk: LiveState["statuses"] = {
  bank: status("bank", "ok", { count: 134 }),
  email: status("email", "ok", { count: 75 }),
  documents: status("documents", "ok", { count: 10 }),
  calendar: status("calendar", "ok", { count: 14 }),
};

export type LiveSample = { live: LiveState; scenarios: import("../connectors/index").ScenarioId[] };

const liveWith = (statuses: LiveState["statuses"], extra: Partial<LiveState> = {}, scenarios: LiveSample["scenarios"] = []): LiveSample => ({
  live: { statuses, pending: [], ...extra },
  scenarios,
});

/** `retryAt` is filled in by the gallery so the countdown keeps running. */
export function liveSamples(retryAt: number) {
  return {
    none: liveWith({}),
    ok: liveWith(allOk),
    syncing: liveWith({
      bank: status("bank", "syncing", { detail: "Read 50 of 134 transactions" }),
      email: status("email", "connecting"),
      documents: status("documents", "ok", { count: 10 }),
      calendar: status("calendar", "connecting"),
    }),
    retrying: liveWith({ ...allOk, bank: status("bank", "retrying", { retryAt, detail: "The bank asked us to slow down" }) }, {}, ["bank_rate_limit"]),
    reconnect: liveWith({ ...allOk, calendar: status("calendar", "needs_reconnect", { detail: "Calendar sign-in expired" }) }, {}, ["calendar_reauth"]),
    error: liveWith({ ...allOk, email: status("email", "error", { detail: "Email didn't answer" }) }),
    slow: liveWith({ ...allOk, documents: status("documents", "syncing") }, { slowReads: { done: 3, total: 10 } }, ["slow_documents"]),
    pending: liveWith(allOk, { pending: ["calendar_reauth"] }, ["calendar_reauth"]),
  };
}

// ---------- Scan states ----------

const trace: TraceLine[] = [
  { id: 1, t: 120, text: "Synced bank, email, documents and calendar", tone: "good" },
  { id: 2, t: 410, text: "Read 75 emails and 10 documents", tone: "info" },
  { id: 3, t: 980, text: "9 charges worth a closer look", tone: "info" },
  { id: 4, t: 2300, text: "Matched APPLE.COM/BILL to StreamBox through Apple receipts", tone: "good" },
  { id: 5, t: 4100, text: "Read the meter photo: 47,006 kWh", tone: "good" },
  { id: 6, t: 9800, text: "Checked 14 days before 28 Nov: notice was due 14 Nov", tone: "warn" },
  { id: 7, t: 31000, text: "Kookaburra rise matches the CPI notice, left alone", tone: "good" },
];

const upcoming: ScanResult["upcoming"] = [
  { date: "2026-11-21", name: "Apple (StreamBox)", amountCents: 1799, key: merchantKey("APPLE.COM/BILL") },
  { date: "2026-12-03", name: "StreamBox", amountCents: 1799, key: merchantKey("STREAMBOX AU") },
  { date: "2026-12-05", name: "IronWorks Fitness", amountCents: 2995, key: merchantKey("IRONWORKS FITNESS DD") },
  { date: "2026-12-14", name: "Skylink Internet", amountCents: 9900, key: merchantKey("SKYLINK INTERNET P/L") },
  { date: "2026-12-18", name: "BrightPage Kids", amountCents: 1499, key: merchantKey("BRIGHTPAGE KIDS PTY LTD") },
];

const findings = [streambox, ironworks, skylink, brightpage, redgum];
const undecided = [{ id: "u-council", merchant: "Moreland Council", error: "The model's answer didn't fit the expected shape twice." }];

function base(corpus: Corpus | undefined): ScanState {
  return {
    phase: "done",
    refreshing: false,
    startedAt: Date.now() - 40_000,
    finishedAt: Date.now() - 6 * 60_000,
    findings,
    cleared: [kookaburra],
    undecided,
    result: { findings, cleared: [kookaburra], undecided, upcoming, missing: [], checkedAt: CHECKED_AT, usedReplay: false },
    corpus,
    usedReplay: false,
    trace,
    decisions: {},
    saved: {},
    edits: {},
    decidedAt: {},
    undo: [],
  };
}

/** Every scan state the gallery draws, by name. */
export function scanSamples(corpus: Corpus | undefined) {
  const done = base(corpus);
  const mins = (n: number) => Date.now() - n * 60_000;
  return {
    done,
    decided: {
      ...done,
      decisions: { "f-skylink": "approved", "f-brightpage": "snoozed" },
      decidedAt: { "f-skylink": mins(4), "f-brightpage": mins(2) },
    } satisfies ScanState,
    edited: { ...done, edits: { "f-skylink": skylink.draft!.body.replace("Could you please", "Can you") } } satisfies ScanState,
    scanning: {
      ...done,
      phase: "scanning",
      stage: "judge",
      progress: { stage: "judge", done: 3, total: 9 },
      finishedAt: undefined,
      findings: [streambox, { ...redgum, draft: undefined }],
      cleared: [],
      undecided: [],
      result: undefined,
      trace: trace.slice(0, 5),
    } satisfies ScanState,
    scanningEmpty: {
      ...done,
      phase: "scanning",
      stage: "read",
      progress: { stage: "read", done: 30, total: 85 },
      findings: [],
      cleared: [],
      undecided: [],
      result: undefined,
      trace: trace.slice(0, 2),
    } satisfies ScanState,
    refreshing: { ...done, refreshing: true } satisfies ScanState,
    allClear: {
      ...done,
      findings: [],
      cleared: [],
      undecided: [],
      result: { ...done.result!, findings: [], cleared: [], undecided: [] },
    } satisfies ScanState,
    error: {
      ...done,
      phase: "error",
      findings: [],
      cleared: [],
      undecided: [],
      result: undefined,
      error: "The model endpoint didn't answer. Check the connection, then press R to try again.",
    } satisfies ScanState,
    idle: { ...done, phase: "idle", findings: [], cleared: [], undecided: [], result: undefined, trace: [] } satisfies ScanState,
    replay: { ...done, usedReplay: true } satisfies ScanState,
    handled: {
      ...done,
      decisions: Object.fromEntries(findings.map((f, i) => [f.id, i % 2 ? "snoozed" : "approved"])),
      decidedAt: Object.fromEntries(findings.map((f, i) => [f.id, mins(i + 1)])),
    } satisfies ScanState,
    toastNoUndo: { ...done, toast: { id: 1, text: "The draft is still being written. Try again in a moment.", undoable: false } } satisfies ScanState,
    toast: {
      ...done,
      decisions: { "f-skylink": "approved" },
      decidedAt: { "f-skylink": mins(0) },
      toast: { id: 1, text: "Saved to Drafts for Skylink Internet. Nothing was sent.", undoable: true },
    } satisfies ScanState,
  };
}

/** A whole-palette state for the now mark: urgency comes from the soonest deadline and the money. */
export function nowSamples(corpus: Corpus | undefined) {
  const s = scanSamples(corpus);
  const later = (f: Finding, date: string): Finding => ({ ...f, deadline: f.deadline && { ...f.deadline, date } });
  return {
    idle: s.allClear,
    working: s.scanningEmpty,
    low: { ...s.done, findings: [later(brightpage, "2026-12-18")] } satisfies ScanState,
    mid: { ...s.done, findings: [later(ironworks, "2026-11-28")] } satisfies ScanState,
    high: s.done,
  };
}

