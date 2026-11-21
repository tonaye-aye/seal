// Sample states for the dev gallery. Hand written from the Whitlocks' seed
// records (bank rows, emails, documents): evidence ids point at real seed
// items so the evidence trail opens them. Nothing here is read from
// seed/eval, and nothing runs the agent or calls a model.

import type { Corpus } from "../agent/corpus";
import { copy } from "../copy";
import { draftKey, type DraftVersions } from "../lib/draft-versions";
import type { ProposedDraft } from "../agent/draft";
import { merchantKey } from "../agent/merchants";
import type { Cleared, Finding, ScanResult } from "../agent/pipeline";
import type { Escalation, FixPlan, FixRoute } from "../agent/routes";
import type { Figure } from "../agent/verify";
import { routePage } from "../ui/fix-route";
import { createConnectors, syncAll, type ConnectorStatus } from "../connectors/index";
import type { LiveState } from "../connectors/live";
import { viteSeedSource } from "../connectors/source.vite";
import { buildCorpus } from "../agent/corpus";
import { now } from "../lib/clock";
import { toZonedIso } from "../lib/dates";
import type { ScanState, TraceLine } from "../lib/scan-store";
import type { OnboardingState } from "../lib/onboarding";
import type { EndpointStatus } from "../lib/endpoint";

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

// Sample findings count as live answers; the replay samples below mark them saved.
const judged = { model: "sample", source: "live" as "live" | "cache", ms: 0 };

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
    source: "live",
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
    fig("previous_price", "Promised price", 7900, "cents", ["doc:doc_001"]),
    fig("new_price", "Charged since October", 9900, "cents", ["txn:JE-00051", "txn:JE-00077"]),
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
    fig("duplicate_amount", "Each subscription", 1799, "cents", ["txn:MC-00038", "txn:JE-00065"]),
    fig("platform_renews", "Apple renews", "2026-11-21", "date", ["email:msg_0052"]),
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
    fig("renewal_amount", "Annual fee", 8900, "cents", ["email:msg_0056"]),
    fig("renews_on", "Renews", "2026-11-28", "date", ["email:msg_0056"]),
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
  figures: [fig("monthly_price", "Monthly price", 1499, "cents", ["txn:MC-00052"]), fig("next_charge", "Next charge", "2026-12-18", "date", ["txn:MC-00052"])],
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
  figures: [fig("meter_reading", "Meter photo reading", 47006, "kwh", ["doc:doc_004"]), fig("overcharge_estimate", "Overcharged (approx.)", 17414, "cents", ["doc:doc_004"])],
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

// Only in the route samples below, so the other gallery frames keep their five rows.
const norvik: Finding = {
  id: "f-norvik",
  kind: "warranty_claim",
  merchant: "Norvik + Spinwell Repairs",
  keys: ["norvik", "spinwell"],
  title: "Cancel the paid repair and claim the Norvik warranty",
  why: "A repair is booked for 26 November, but the Norvik warranty runs until 6 December.",
  action: { kind: "claim_warranty", summary: "Claim the warranty and cancel the Spinwell booking." },
  amounts: { atStake: 26400 },
  deadline: { date: "2026-11-25", label: "Cancel Spinwell Repairs by 10:00 am" },
  confidence: "high",
  evidence: [ev("email", "msg_0078"), ev("email", "msg_0077"), ev("doc", "doc_012"), ev("doc", "doc_011"), ev("event", "evt_015", false), ev("email", "msg_0076", false)],
  figures: [
    fig("product_serial", "Serial number", "NVK-204417", "text", ["doc:doc_012"]),
    fig("purchase_date", "Bought on", "2024-12-06", "date", ["doc:doc_011"]),
    fig("warranty_ends", "Warranty ends", "2026-12-06", "date", ["doc:doc_012"]),
    fig("repair_reference", "Repair booking", "SR-5521", "text", ["email:msg_0077"]),
    fig("repair_visit", "Repair visit", "2026-11-26", "date", ["email:msg_0077"]),
    fig("repair_booked", "Repair price", 26400, "cents", ["email:msg_0077"]),
    fig("cancel_by", "Cancel the repair by", "10:00 am on 25 November 2026", "text", ["email:msg_0077"]),
  ],
  notes: [],
  doubts: [],
  status: "new",
  verified: true,
  judgedBy: judged,
  draft: draft(
    { name: "Norvik", address: "warranty@norvik.example" },
    "Warranty claim: Norvik WM-8, serial NVK-204417",
    "Hi Norvik team,\n\nWe'd like to lodge a warranty claim for our Norvik WM-8 washing machine (serial NVK-204417), bought on 6 December 2024. The fault is error E18; it stops mid-cycle.\n\nThe warranty ends on 6 December 2026. We have a repair booked with Spinwell Repairs for 26 November 2026, and it must be cancelled by 10:00 am on 25 November 2026, so a reply before then would help.\n\nThanks, Maya",
    { attachDocumentIds: ["doc_011", "doc_012"] },
  ),
};

/** A Firmer rewrite of the Skylink draft, as the store keeps it. */
function firmerVersion(source: "live" | "cache"): DraftVersions {
  const draft = skylink.draft!;
  return {
    of: draftKey(draft),
    versions: { firmer: { subject: draft.subject, body: draft.body.replace("Could you please", "Please"), model: "basecompute/qwen3.8-flash-next", source } },
    active: "firmer",
    trail: [{ from: null, at: 1 }],
  };
}

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
  email: status("email", "ok", { count: 78 }),
  documents: status("documents", "ok", { count: 12 }),
  calendar: status("calendar", "ok", { count: 15 }),
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
      documents: status("documents", "ok", { count: 12 }),
      calendar: status("calendar", "connecting"),
    }),
    retrying: liveWith({ ...allOk, bank: status("bank", "retrying", { retryAt, detail: "The bank asked us to slow down" }) }, {}, ["bank_rate_limit"]),
    reconnect: liveWith({ ...allOk, calendar: status("calendar", "needs_reconnect", { detail: "Calendar sign-in expired" }) }, {}, ["calendar_reauth"]),
    error: liveWith({ ...allOk, email: status("email", "error", { detail: "Email didn't answer" }) }),
    slow: liveWith({ ...allOk, documents: status("documents", "syncing") }, { slowReads: { done: 3, total: 10 } }, ["slow_documents"]),
    pending: liveWith(allOk, { pending: ["calendar_reauth"] }, ["calendar_reauth"]),
    // Calendar switched off in Connectors or Settings, waiting for the next sync.
    sourceOff: liveWith({ bank: allOk.bank, email: allOk.email, documents: allOk.documents }),
    // Only the bank left on: its switch is locked, as a check needs something to read.
    lastSource: liveWith({ bank: allOk.bank }),
    // Onboarding's connect screen: two sources in, the third on its way; and all four with the calendar signed out.
    connecting: liveWith({ bank: allOk.bank, email: allOk.email, documents: status("documents", "syncing", { detail: "Reading documents" }) }),
    connectedReconnect: liveWith({ ...allOk, calendar: status("calendar", "needs_reconnect", { detail: "Calendar sign-in expired" }) }, {}, ["calendar_reauth"]),
  };
}

// ---------- Scan states ----------

const trace: TraceLine[] = [
  { id: 1, t: 120, text: "Synced bank, email, documents and calendar", tone: "good" },
  { id: 2, t: 410, text: "Read 78 emails and 12 documents", tone: "info" },
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
    reminders: {},
    routes: {},
    rewrites: {},
    rewriting: {},
    undo: [],
  };
}

// ---------- Ways to fix a finding ----------

const route = (r: Partial<FixRoute> & Pick<FixRoute, "id" | "kind" | "provider" | "label">): FixRoute => ({
  canDo: [],
  requiredFor: [],
  immediate: false,
  keepsRecord: false,
  acceptsFiles: false,
  needs: [],
  steps: [],
  sample: true,
  ...r,
});

const TIO: Escalation = {
  id: "tio",
  name: "Telecommunications Industry Ombudsman",
  shortName: "TIO",
  real: true,
  phone: "1800 062 058",
  hours: "Mon-Fri 8am-8pm AEST",
  href: "https://www.tio.com.au/complaints",
  afterDays: 14,
  whenToUse: "Free and independent. Use it if your provider hasn't fixed the problem after you've asked.",
};

const skylinkPlan: FixPlan = {
  routes: [
    route({ id: "skylink_email", kind: "email", provider: "Skylink Internet", label: "Email billing", address: "billing@skylink.example", keepsRecord: true, replyDays: 3 }),
    route({ id: "skylink_chat", kind: "chat", provider: "Skylink Internet", label: "Chat with Skye", href: "https://skylink.example/help/chat", hours: "Every day, 7am-10pm", waitMinutes: 2, needs: ["Your account number"], note: "Chat can log a dispute but can't credit an account itself." }),
    route({ id: "skylink_call", kind: "call", provider: "Skylink Internet", label: "Call billing", phone: "1300 000 000", hours: "Mon-Fri 8am-8pm", waitMinutes: 18, needs: ["Your account number", "The name on the account"] }),
  ],
  recommendedId: "skylink_email",
  reason: "Billing disputes sent in writing are logged against the account.",
  chosenBy: "model",
  callScript: {
    opening: "Hi, I'm calling about the price on our Skylink internet plan.",
    points: ["Our 2025 agreement promised $79.00 a month for 24 months.", "We've been charged $99.00 since October.", "That's $40.00 overcharged so far."],
    ask: "Can you put the plan back to $79.00 and credit the $40.00?",
    ifNo: "Ask for a reference number, then send the written request by email.",
  },
  chatOpener: "Our 2025 agreement promised $79.00 a month for 24 months, but we've been charged $99.00 since October. Please put the plan back to $79.00 and credit the $40.00.",
  haveReady: [
    { label: "Promised price", value: "$79.00" },
    { label: "Price now", value: "$99.00" },
    { label: "Overcharged so far", value: "$40.00" },
  ],
  escalation: TIO,
  grounded: true,
  problems: [],
  attempts: [],
  ms: 4200,
};

const redgumPlan: FixPlan = {
  routes: [
    route({
      id: "redgum_read",
      kind: "online",
      provider: "Redgum Energy",
      label: "Submit a meter read",
      href: "https://redgumenergy.example/account/meter-read",
      acceptsFiles: true,
      needs: ["Your account number", "A photo of the meter"],
      steps: ["Sign in to your Redgum account.", "Choose Submit a meter read.", "Enter the reading and date, then add the photo.", "Submit, and keep the confirmation."],
      article: { title: "How we correct an estimated bill", body: "Send an actual reading with a photo and we review it first, then issue a corrected bill." },
    }),
    route({ id: "redgum_email", kind: "email", provider: "Redgum Energy", label: "Email billing", address: "bills@redgumenergy.example", acceptsFiles: true, replyDays: 5 }),
    route({ id: "redgum_call", kind: "call", provider: "Redgum Energy", label: "Call billing", phone: "1300 975 707", hours: "Mon-Fri 8am-6pm", waitMinutes: 12 }),
  ],
  recommendedId: "redgum_read",
  reason: "Reads with a photo are reviewed first and a corrected bill follows.",
  chosenBy: "model",
  haveReady: [
    { label: "Actual reading", value: "47,006 kWh" },
    { label: "Read on", value: "30 Oct 2026" },
    { label: "Estimated reading", value: "47,570 kWh" },
  ],
  grounded: true,
  problems: [],
  attempts: [],
  ms: 3800,
};

const CAV: Escalation = {
  id: "cav",
  name: "Consumer Affairs Victoria",
  shortName: "Consumer Affairs",
  real: true,
  phone: "1300 55 81 81",
  hours: "Mon-Fri 9am-5pm",
  href: "https://www.consumer.vic.gov.au/contact-us/resolve-your-problem/general-complaint",
  afterDays: 14,
  whenToUse: "Use it if you've tried to sort the problem out with the business and couldn't.",
};

// Two businesses, two jobs: the claim goes to Norvik, the call cancels Spinwell.
const norvikPlan: FixPlan = {
  routes: [
    route({
      id: "norvik_claim",
      kind: "online",
      provider: "Norvik",
      label: "Lodge a warranty claim",
      href: "https://norvik.example/warranty",
      immediate: true,
      keepsRecord: true,
      acceptsFiles: true,
      needs: ["Serial number", "Proof of purchase", "Description of the fault"],
      steps: ["Open the warranty claim form on the Norvik website.", "Enter the serial number and the purchase date.", "Describe the fault and upload your proof of purchase.", "Submit the form and keep the claim number it gives you."],
      note: "A claim is dated when you submit it, and you get a claim number straight away.",
    }),
    route({ id: "norvik_email", kind: "email", provider: "Norvik", label: "Email the warranty team", address: "warranty@norvik.example", keepsRecord: true, acceptsFiles: true, replyDays: 3 }),
    route({ id: "spinwell_call", kind: "call", provider: "Spinwell Repairs", label: "Call to cancel the booking", phone: "(03) 5550 0174", hours: "Mon-Sat 8am-5pm", waitMinutes: 2, immediate: true, needs: ["Booking number"] }),
  ],
  recommendedId: "norvik_claim",
  reason: "A claim is dated when you submit it, and you get a claim number straight away.",
  chosenBy: "model",
  callScript: {
    opening: "Hi, I'm calling to cancel a repair booking. It's in Ben's name.",
    points: ["Please cancel booking SR-5521.", "The visit is booked for Thursday 26 November 2026 at 10:00 am."],
    ask: "Can you please confirm the booking is cancelled?",
    ifNo: "Ask them to note it needs cancelling by 10:00 am on 25 November 2026.",
  },
  haveReady: [
    { label: "Serial number", value: "NVK-204417" },
    { label: "Bought on", value: "6 December 2024" },
    { label: "Warranty ends", value: "6 December 2026" },
    { label: "Repair booking", value: "SR-5521" },
    { label: "Cancel the repair by", value: "10:00 am on 25 November 2026" },
  ],
  escalation: CAV,
  grounded: true,
  problems: [],
  attempts: [],
  ms: 4300,
};

/** The route switcher's states: the same samples with fix plans added. */
export function routeSamples(done: ScanState) {
  const withPlans = (plans: Record<string, FixPlan>, change: Partial<ScanState> = {}): ScanState => {
    const add = (f: Finding) => (plans[f.id] ? { ...f, fix: plans[f.id] } : f);
    return { ...done, findings: done.findings.map(add), result: done.result && { ...done.result, findings: done.result.findings.map(add) }, ...change };
  };
  const plans = { "f-skylink": skylinkPlan, "f-redgum": redgumPlan };
  const approved = (id: string, routeId: string) => ({ decisions: { [id]: "approved" as const }, decidedAt: { [id]: Date.now() - 60_000 }, routes: { [id]: routeId } });
  const script = skylinkPlan.callScript!;
  const withWarranty = (change: Partial<ScanState> = {}): ScanState => {
    const planned = withPlans(plans);
    const f: Finding = { ...norvik, fix: norvikPlan };
    return { ...planned, findings: [...planned.findings, f], result: planned.result && { ...planned.result, findings: [...planned.result.findings, f] }, ...change };
  };
  return {
    warranty: withWarranty(),
    warrantyCall: withWarranty({ routes: { "f-norvik": "spinwell_call" } }),
    warrantyApproved: withWarranty(approved("f-norvik", "norvik_claim")),
    email: withPlans(plans),
    call: withPlans(plans, { routes: { "f-skylink": "skylink_call" } }),
    chat: withPlans(plans, { routes: { "f-skylink": "skylink_chat" } }),
    noScript: withPlans({ "f-skylink": { ...skylinkPlan, callScript: undefined, chatOpener: undefined, chosenBy: "default" } }, { routes: { "f-skylink": "skylink_call" } }),
    unchecked: withPlans(
      { "f-skylink": { ...skylinkPlan, callScript: { ...script, points: [...script.points, "We were promised a $20.00 credit."] }, grounded: false, problems: ["$20.00 isn't in the evidence"] } },
      { routes: { "f-skylink": "skylink_call" } },
    ),
    approvedEmail: withPlans(plans, approved("f-skylink", "skylink_email")),
    approvedCall: withPlans(plans, approved("f-skylink", "skylink_call")),
    approvedOnline: withPlans(plans, approved("f-redgum", "redgum_read")),
    approvedSampleBody: withPlans(
      { "f-skylink": { ...skylinkPlan, escalation: { ...TIO, id: "harbour_disputes", name: "Harbour Bank card disputes", shortName: "Harbour Bank", real: false, href: "https://harbourbank.example/help/card-disputes", whenToUse: "If a business won't return a duplicate card payment, your bank can look into disputing that charge." } } },
      approved("f-skylink", "skylink_call"),
    ),
    samplePage: routePage(redgumPlan.routes[0]),
  };
}

/** A finding whose judgment and draft came from saved answers. */
function saved(f: Finding): Finding {
  return { ...f, judgedBy: { ...f.judgedBy, source: "cache" }, draft: f.draft && { ...f.draft, source: "cache" } };
}

function endpointTrace(text: string, tone: TraceLine["tone"]): TraceLine[] {
  return [
    { id: -11, t: 0, text: "Checking the model endpoint", tone: "info" },
    { id: -12, t: 420, text, tone },
  ];
}

/** The model endpoint in each state the footer chip and the Connectors menu show. */
export const endpointSamples = {
  live: { state: "live", ms: 420, checkedAt: Date.now() - 60_000 },
  checking: { state: "checking" },
  slow: { state: "slow", ms: 6200, checkedAt: Date.now() - 60_000, detail: "A tiny test took 6.2 s, so this check may take a few minutes." },
  offline: { state: "offline", checkedAt: Date.now() - 60_000, detail: "Couldn't reach the endpoint. Check the network." },
  key_rejected: { state: "key_rejected", checkedAt: Date.now() - 60_000, detail: "The endpoint didn't accept the API key (it answered 401)." },
  not_set_up: { state: "not_set_up", checkedAt: Date.now() - 60_000, detail: "There's no API key. Add BC_API_KEY to .env, then restart the app." },
  unavailable: { state: "unavailable", checkedAt: Date.now() - 60_000, detail: "The endpoint answered with an error (503)." },
  forced: { state: "forced", checkedAt: Date.now() - 60_000, detail: "Chosen in the demo panel." },
  flag: { state: "forced", byFlag: true, checkedAt: Date.now() - 60_000, detail: "Started with LIFE_REPLAY=1." },
  browser: { state: "browser", checkedAt: Date.now() - 60_000, detail: "A browser tab has no model connection, only the answers saved by the scripts." },
} satisfies Record<string, EndpointStatus>;

/** Every scan state the gallery draws, by name. */
export function scanSamples(corpus: Corpus | undefined) {
  const done = base(corpus);
  // A whole check on saved answers (the reason is added per sample).
  const savedCheck: ScanState = { ...done, findings: findings.map(saved), usedReplay: true };
  const mins = (n: number) => Date.now() - n * 60_000;
  return {
    done,
    decided: {
      ...done,
      decisions: { "f-skylink": "approved", "f-brightpage": "dismissed" },
      decidedAt: { "f-skylink": mins(4), "f-brightpage": mins(2) },
    } satisfies ScanState,
    /** Every finding approved: the Next block on each, "Ready to send" and "Handled" chips, expectation lines on the timeline. */
    approved: {
      ...done,
      decisions: Object.fromEntries(findings.map((f) => [f.id, "approved"])),
      decidedAt: Object.fromEntries(findings.map((f, i) => [f.id, mins(i + 1)])),
    } satisfies ScanState,
    /** Remind me (L): Skylink approved with a reminder to check for a reply; StreamBox still open, reminded before its deadline. */
    reminded: {
      ...done,
      decisions: { "f-skylink": "approved" },
      decidedAt: { "f-skylink": mins(6) },
      reminders: {
        "f-skylink": { eventId: "evt_new_001", date: "2026-12-12", title: "Check Skylink Internet replied (Seal)", at: mins(5) },
        "f-streambox": { eventId: "evt_new_002", date: "2026-11-20", title: "StreamBox: Cancel the Apple one before it renews, 20 Nov (Seal)", at: mins(2) },
      },
    } satisfies ScanState,
    reminderFailed: {
      ...done,
      toast: { id: 1, text: "Couldn't add the reminder: Calendar needs reconnecting. Press R to reconnect.", undoable: false },
    } satisfies ScanState,
    edited: { ...done, edits: { "f-skylink": skylink.draft!.body.replace("Could you please", "Can you") } } satisfies ScanState,
    rewriting: { ...done, rewriting: { "f-skylink": "firmer" } } satisfies ScanState,
    rewritten: { ...done, rewrites: { "f-skylink": firmerVersion("live") } } satisfies ScanState,
    rewrittenSaved: { ...done, rewrites: { "f-skylink": firmerVersion("cache") } } satisfies ScanState,
    rewriteFailed: { ...done, toast: { id: 1, text: copy.verbs.failed("Firmer"), undoable: false } } satisfies ScanState,
    rewriteOffline: { ...done, toast: { id: 1, text: copy.verbs.notOffline("Shorter"), undoable: false } } satisfies ScanState,
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
    // Replay: a single call fell back on its own, with no reason for the whole check.
    replay: { ...done, findings: findings.map((f, i) => (i === 1 ? saved(f) : f)), usedReplay: true } satisfies ScanState,
    replayForced: { ...savedCheck, replay: { why: "forced", detail: "Chosen in the demo panel." } } satisfies ScanState,
    replayFlag: { ...savedCheck, replay: { why: "forced", detail: "Started with LIFE_REPLAY=1." } } satisfies ScanState,
    replayOffline: { ...savedCheck, replay: { why: "offline", detail: "Couldn't reach the endpoint. Check the network." } } satisfies ScanState,
    replayKey: { ...savedCheck, replay: { why: "key_rejected", detail: "The endpoint didn't accept the API key (it answered 401)." } } satisfies ScanState,
    replayLost: { ...savedCheck, replay: { why: "lost", detail: "the endpoint stopped answering", stage: "extract" } } satisfies ScanState,
    /** The checking screen after the endpoint check failed: the trace says why. */
    checkingOffline: {
      ...done,
      phase: "scanning",
      stage: "read",
      progress: undefined,
      findings: [],
      cleared: [],
      undecided: [],
      result: undefined,
      usedReplay: false,
      replay: { why: "offline", detail: "Couldn't reach the endpoint. Check the network." },
      trace: endpointTrace("Couldn't reach the endpoint. Check the network. Using saved answers from an earlier run.", "warn"),
    } satisfies ScanState,
    checkingLost: {
      ...done,
      phase: "scanning",
      stage: "sync",
      progress: undefined,
      findings: [],
      cleared: [],
      undecided: [],
      result: undefined,
      usedReplay: false,
      replay: { why: "lost", detail: "the endpoint stopped answering", stage: "extract" },
      trace: [
        ...endpointTrace("Model endpoint answered in 0.4 s", "good"),
        { id: -13, t: 900, text: "Syncing bank, email, documents and calendar", tone: "info" },
        { id: -14, t: 2400, text: "Reading the facts out of each piece of evidence", tone: "info" },
        { id: -15, t: 7800, text: "Lost the model endpoint while reading the evidence: the endpoint stopped answering. Starting the check again from saved answers.", tone: "warn" },
      ],
    } satisfies ScanState,
    /** On saved answers with none saved: the check can't finish. */
    noSaved: {
      ...done,
      phase: "error",
      findings: [],
      cleared: [],
      undecided: [],
      result: undefined,
      replay: { why: "offline", detail: "Couldn't reach the endpoint. Check the network." },
      error: "Couldn't reach the model endpoint, and there are no saved answers yet. Check the network, then press R.",
    } satisfies ScanState,
    handled: {
      ...done,
      decisions: Object.fromEntries(findings.map((f, i) => [f.id, i % 2 ? "dismissed" : "approved"])),
      decidedAt: Object.fromEntries(findings.map((f, i) => [f.id, mins(i + 1)])),
    } satisfies ScanState,
    toastNoUndo: { ...done, toast: { id: 1, text: "The draft is still being written. Try again in a moment.", undoable: false } } satisfies ScanState,
    toast: {
      ...done,
      decisions: { "f-skylink": "approved" },
      decidedAt: { "f-skylink": mins(0) },
      toast: { id: 1, text: "Saved to Drafts for Skylink Internet. Send it from your mail app when you're ready.", undoable: true },
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

// ---------- Onboarding ----------

/** A step of first-run onboarding, as the store would hold it. */
export function onboardingSample(change: Partial<OnboardingState>): OnboardingState {
  return { step: "welcome", connected: [], ...change };
}
