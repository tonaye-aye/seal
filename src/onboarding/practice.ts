// The onboarding's practice round: one made-up finding to learn the keys on.
// Moonbeam Music and Postbox are invented for practice only. They are not in
// the seed data and are not one of the household's real problems, so the
// practice round gives nothing away about the real check that follows.
// Nothing here runs the agent or calls a model.

import type { Corpus } from "../agent/corpus";
import type { ProposedDraft } from "../agent/draft";
import { merchantKey } from "../agent/merchants";
import type { Finding, ScanResult } from "../agent/pipeline";
import type { ScanState, TraceLine } from "../lib/scan-store";
import { now } from "../lib/clock";
import { toZonedIso } from "../lib/dates";

/** The pretend mail provider on the practice connect screen. */
export const PRACTICE_PROVIDER = "Postbox";
const PRACTICE_ADDRESS = "maya@whitlock.example";

const DESCRIPTOR = "MOONBEAM MUSIC MELBOURNE";

const corpus: Corpus = {
  accounts: [
    {
      id: "practice-card",
      code: "PR",
      name: "Practice card",
      type: "credit_card",
      currency: "AUD",
      owners: ["Maya"],
      currentBalanceCents: 0,
      currentBalanceDate: "2026-11-18",
    },
  ],
  transactions: [
    { id: "PR-001", accountId: "practice-card", date: "2026-11-03", description: DESCRIPTOR, amountCents: -1199, balanceCents: -1199 },
    { id: "PR-002", accountId: "practice-card", date: "2026-11-03", description: DESCRIPTOR, amountCents: -1199, balanceCents: -2398 },
  ],
  emails: [
    {
      id: "practice-msg-1",
      threadId: "practice-thread-1",
      date: "2026-11-03T08:12:00+11:00",
      from: { name: "Moonbeam Music", address: "receipts@moonbeam.example" },
      to: [{ name: "Maya", address: PRACTICE_ADDRESS }],
      subject: "Your Moonbeam Family receipt",
      snippet: "Thanks for listening. Moonbeam Family, 1 month, $11.99.",
      labels: ["INBOX"],
      unread: false,
      attachments: [],
      body:
        "Hi Maya,\n\nThanks for listening with Moonbeam.\n\nMoonbeam Family, 1 month: $11.99\nCharged to your card ending 4417 on 3 November 2026.\nReceipt MB-5521\n\nYour next payment is on 3 December 2026.\n\nThe Moonbeam team",
    },
  ],
  documents: [],
  events: [],
  missing: [],
};

const draft: ProposedDraft = {
  channel: "email",
  to: { name: "Moonbeam Music", address: "help@moonbeam.example" },
  subject: "Charged twice on 3 November: please refund $11.99",
  body:
    "Hi Moonbeam team,\n\nMy card was charged $11.99 twice on 3 November 2026 for one month of Moonbeam Family. Your receipt MB-5521 covers only one payment.\n\nCould you please refund the second $11.99 to the same card?\n\nThanks, Maya",
  attachDocumentIds: [],
  grounded: true,
  problems: [],
  attempts: [],
  model: "practice",
  source: "live",
  ms: 0,
};

export const PRACTICE_FINDING_ID = "practice-moonbeam";
const NEXT_CHARGE = "2026-12-03";

/** The practice timeline's lines, as the guided tour spotlights them (data-coach values from Timeline.tsx). */
export const PRACTICE_TARGETS = {
  charged: `timeline:${PRACTICE_FINDING_ID}:charged_on`,
  checked: "timeline:agent:scan",
  deadline: `timeline:${PRACTICE_FINDING_ID}:deadline`,
  charge: `timeline:charge:${merchantKey(DESCRIPTOR)}:${NEXT_CHARGE}`,
};

export const practiceFinding: Finding = {
  id: PRACTICE_FINDING_ID,
  kind: "duplicate_payment",
  merchant: "Moonbeam Music",
  keys: [merchantKey(DESCRIPTOR)],
  title: "Practice: charged twice for one month",
  why: "Two $11.99 card charges on 3 November, but the receipt covers one month.",
  action: { kind: "request_refund", summary: "Ask Moonbeam to refund the second $11.99" },
  amounts: { atStake: 1199, recoverable: 1199 },
  // The same day as the next charge, so the timeline shows them as one line.
  deadline: { date: "2026-12-03", label: "Ask for the refund before the next payment" },
  confidence: "high",
  evidence: [
    { kind: "txn", id: "PR-001", cited: true },
    { kind: "txn", id: "PR-002", cited: true },
    { kind: "email", id: "practice-msg-1", cited: true },
  ],
  figures: [
    { id: "charge", label: "Each charge", value: 1199, unit: "cents", sources: ["txn:PR-001", "txn:PR-002"] },
    { id: "charged_on", label: "Charged twice", value: "2026-11-03", unit: "date", sources: ["txn:PR-001", "txn:PR-002"] },
    { id: "to_get_back", label: "To get back", value: 1199, unit: "cents", sources: ["txn:PR-002", "email:practice-msg-1"], how: "2 charges, 1 receipt: one $11.99 too many" },
  ],
  notes: [],
  doubts: [],
  status: "new",
  verified: true,
  judgedBy: { model: "practice", source: "live", ms: 0 },
  draft,
};

/** The scripted practice check, line by line (shown over about three seconds). */
export const PRACTICE_TRACE: { text: string; tone: TraceLine["tone"]; coach?: "found" | "drafted" }[] = [
  { text: `Reading your ${PRACTICE_PROVIDER} inbox (practice)`, tone: "info" },
  { text: "Matched two $11.99 card charges to one Moonbeam receipt", tone: "info" },
  { text: "Checking the numbers and dates in code", tone: "info" },
  { text: "Found: charged twice for one month", tone: "warn", coach: "found" },
  { text: "Drafted a message to Moonbeam Music, every figure checked", tone: "good", coach: "drafted" },
];

/** The practice palette while its check runs. */
export function practiceScanning(): Partial<ScanState> {
  return { phase: "scanning", startedAt: Date.now(), stage: "read", corpus };
}

/** The practice palette once its check is done: one finding, ready to approve. */
export function practiceDone(trace: TraceLine[] = []): Partial<ScanState> {
  const result: ScanResult = {
    findings: [practiceFinding],
    cleared: [],
    undecided: [],
    upcoming: [{ date: NEXT_CHARGE, name: "Moonbeam Music", amountCents: 1199, key: merchantKey(DESCRIPTOR) }],
    missing: [],
    checkedAt: toZonedIso(now()),
    usedReplay: false,
  };
  return {
    phase: "done",
    finishedAt: Date.now(),
    stage: undefined,
    progress: undefined,
    findings: [practiceFinding],
    result,
    corpus,
    trace,
    practice: true,
  };
}
