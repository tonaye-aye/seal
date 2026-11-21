// Stage 7 of the scan: write the message that fixes a finding, ready for
// Maya to approve. Flash writes it (thinking off: thinking made drafts 40-60 s
// slower with no accuracy gain in the spike). It is handed only:
//   - the figures code worked out (verify stage), and
//   - the evidence, written the way a person would read it: no internal ids
//     (msg_, doc_, JE-...) and dates as "14 October 2025".
//
// Then code checks every claim in the draft: each amount, date, reference,
// kWh reading, count and percentage must appear in those figures or that
// evidence. If anything doesn't, the 35B (thinking off) writes it once more.
// If that fails too, the draft is kept but marked "check before sending",
// with the exact problems listed. Nothing is ever sent: approving saves an
// email draft through the email connector, which has no send operation.

import { now } from "../lib/clock.ts";
import { localDate } from "../lib/dates.ts";
import { LlmError, type LlmClient, type ReplySchema } from "../lib/llm.ts";
import { formatAUD } from "../lib/money.ts";
import type { Connectors, Draft, Mailbox } from "../connectors/index.ts";
import type { Corpus } from "./corpus.ts";
import type { EvidenceRef } from "./detectors.ts";
import { amountIn, dateIn, numberIn, referenceIn } from "./grounding.ts";
import type { ActionKind, FindingKind } from "./judge.ts";
import type { Figure } from "./verify.ts";

// ---------- Shapes ----------

/** Who writes, and how. Read from seed/persona.json by the pipeline. */
export type Voice = {
  fromName: string;
  fromAddress: string;
  tone: string;
  signOff: string;
  /** Addresses that belong to the household (never a recipient). */
  householdAddresses: string[];
};

/** What drafting needs from a finding. */
export type DraftCase = {
  kind: FindingKind;
  merchant: string;
  title: string;
  why: string;
  action: { kind: ActionKind; summary: string };
  figures: Figure[];
  notes: string[];
  evidence: EvidenceRef[];
};

export type DraftAttempt = { model: string; source: "live" | "cache"; ms: number; problems: string[] };

export type ProposedDraft = {
  channel: "email";
  to: Mailbox;
  subject: string;
  body: string;
  /** Documents to attach, by id (the meter photo for a bill correction). */
  attachDocumentIds: string[];
  /** True when every claim in the draft was found in the figures or evidence. */
  grounded: boolean;
  /** What the claim check couldn't find (empty when grounded). */
  problems: string[];
  /** Each model try, in order: Flash first, the 35B only if Flash failed the check. */
  attempts: DraftAttempt[];
  model: string;
  source: "live" | "cache";
  ms: number;
};

// ---------- Writing for people ----------

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-11-28" to "28 November 2026". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Timestamps and ISO dates in free text ("2025-10-14T10:12+11:00") to "14 October 2025". */
export function humanDates(text: string): string {
  return text.replace(
    /\b(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
    (_, y, m, d) => `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`,
  );
}

/** Short month names in code-written notes ("3 Sept 2026") to long ones. */
function longMonths(text: string): string {
  return text.replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b/g, (_, d, mon: string) => {
    const index = MONTHS.findIndex((m) => m.slice(0, 3) === mon.slice(0, 3));
    return `${d} ${MONTHS[index]}`;
  });
}

/** Internal ids the household and the business should never see. */
const INTERNAL_ID = /\b(?:msg|doc|evt|draft)_\d+(?::\d{4}-\d{2}-\d{2})?\b|\b(?:JE|MC)-\d{5}\b/g;

function withoutIds(text: string): string {
  return text.replace(INTERNAL_ID, "").replace(/[ \t]{2,}/g, " ");
}

/** One figure's value as a person would read it. */
export function figureValue(f: Figure): string {
  const v = f.value;
  switch (f.unit) {
    case "cents": return formatAUD(v as number);
    case "date": return longDate(v as string);
    case "kwh": return `${(v as number).toLocaleString("en-AU")} kWh`;
    case "cents_per_kwh": return `$${((v as number) / 100).toFixed(3)} per kWh`;
    case "percent": return `${v}%`;
    case "days": return `${v} days`;
    case "yes_no": return v ? "yes" : "no";
    default: return String(v);
  }
}

/** One figure as a line a person can read. */
function figureLine(f: Figure): string {
  return `- ${f.label}: ${figureValue(f)}`;
}

/** Everything the drafter may quote, ids removed and dates written out. */
export function draftEvidence(evidence: EvidenceRef[], corpus: Corpus): { text: string; recipients: Mailbox[]; attachable: { id: string; filename: string }[] } {
  const blocks: string[] = [];
  const recipients = new Map<string, Mailbox>();
  const attachable: { id: string; filename: string }[] = [];
  const txns: string[] = [];

  for (const ref of evidence.slice(0, 24)) {
    if (ref.kind === "txn") {
      const t = corpus.transactions.find((x) => x.id === ref.id);
      if (t) txns.push(`${longDate(t.date)} | ${t.description} | ${formatAUD(Math.abs(t.amountCents))} ${t.amountCents < 0 ? "paid" : "received"}`);
    } else if (ref.kind === "email") {
      const m = corpus.emails.find((x) => x.id === ref.id);
      if (!m) continue;
      const sent = m.labels.includes("SENT");
      for (const box of sent ? m.to : [m.from]) recipients.set(box.address.toLowerCase(), box);
      const who = sent ? `sent by ${m.from.name} to ${m.to.map((t) => t.name).join(", ")}` : `from ${m.from.name} <${m.from.address}>`;
      blocks.push(`## Email, ${longDate(m.date.slice(0, 10))}, ${who}\nSubject: ${m.subject}\n${m.body.slice(0, 2500)}`);
    } else if (ref.kind === "doc") {
      const d = corpus.documents.find((x) => x.id === ref.id);
      if (!d) continue;
      attachable.push({ id: d.id, filename: d.filename });
      blocks.push(
        d.text
          ? `## Document: ${d.title} (${d.filename})\n${d.text.slice(0, 3500)}`
          : `## Photo: ${d.title} (${d.filename}). Its reading is in the verified figures.`,
      );
    } else {
      const e = corpus.events.find((x) => x.id === ref.id);
      if (e) blocks.push(`## Calendar entry, ${longDate(e.start.slice(0, 10))}: ${e.title}`);
    }
  }
  if (txns.length) blocks.unshift(`## Bank and card statement lines\n${txns.join("\n")}`);
  return { text: humanDates(withoutIds(blocks.join("\n\n"))), recipients: [...recipients.values()], attachable };
}

/** The checked figures and notes, for the drafter and the claim check. */
export function draftFigures(c: DraftCase): string {
  return [...c.figures.map(figureLine), ...c.notes.map((n) => `- ${longMonths(n)}`)].join("\n");
}

// ---------- The claim check ----------

const MONTH_WORD = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const monthIndex = (word: string) => MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === word.slice(0, 3).toLowerCase()) + 1;
const iso = (y: string | number, m: number, d: string | number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Every checkable claim in `draft` that is NOT in `allowed` (the figures,
 * the evidence and today's date). Deliberately strict: a false alarm costs
 * one rewrite, a missed invention costs Maya's trust.
 */
export function claimCheck(draft: string, allowed: string, today = localDate(now())): string[] {
  const text = draft;
  const pool = `${allowed}\n${longDate(today)}`;
  const bad: string[] = [];

  // Money: "$1,485.54", "$99".
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)) {
    const value = Number(m[1].replace(/,/g, ""));
    const decimals = m[1].split(".")[1]?.length ?? 0;
    // A rate like "$0.285 per kWh" has more than cents: check it as a plain number.
    const found = decimals > 2 ? numberIn(value, pool) : amountIn(Math.round(value * 100), pool);
    if (!found) bad.push(m[0].trim());
  }
  // Dates with a day: "14 November", "14th Nov 2026", "November 14".
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_WORD})\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi");
  const monthFirst = new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi");
  const datesSeen = (day: string, month: string, year?: string) =>
    (year ? [year] : ["2025", "2026", "2027"]).some((y) => dateIn(iso(y, monthIndex(month), day), pool));
  for (const m of text.matchAll(dayFirst)) if (!datesSeen(m[1], m[2], m[3])) bad.push(m[0]);
  for (const m of text.matchAll(monthFirst)) if (!datesSeen(m[2], m[1], m[3])) bad.push(m[0]);
  // A month and year with no day ("until October 2027"): that month must be mentioned somewhere.
  for (const m of text.matchAll(new RegExp(`(?<!\\d\\s)(?<![0-9])\\b(${MONTH_WORD})\\s+(\\d{4})\\b`, "g"))) {
    const mo = monthIndex(m[1]);
    const days = Array.from({ length: 31 }, (_, i) => iso(m[2], mo, i + 1));
    const named = new RegExp(`\\b(${MONTHS[mo - 1]}|${MONTHS[mo - 1].slice(0, 3)})\\s+${m[2]}\\b`, "i").test(pool);
    if (!named && !days.some((d) => dateIn(d, pool))) bad.push(m[0]);
  }
  // Business references: "KP-20418", "R-77311", "OH-Y3-0908".
  for (const m of text.matchAll(/\b[A-Z]{1,4}-[A-Z0-9-]*\d[A-Z0-9-]*\b/g)) {
    if (!referenceIn(m[0], pool)) bad.push(m[0]);
  }
  // Meter readings and usage: "47,006 kWh".
  for (const m of text.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s?kWh\b/gi)) {
    if (!numberIn(Number(m[1].replace(/,/g, "")), pool)) bad.push(m[0]);
  }
  // Counts, durations and percentages: "24 months", "14 days", "31%".
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s?(%|percent\b|months?\b|days?\b|weeks?\b|years?\b|charges?\b|payments?\b)/gi)) {
    if (!numberIn(Number(m[1]), pool)) bad.push(m[0]);
  }
  // Internal ids must never reach a business.
  for (const m of text.matchAll(INTERNAL_ID)) bad.push(`internal id ${m[0]}`);
  return [...new Set(bad)];
}

// ---------- Asking the model ----------

// Up to two extra name words after the sign-off on the same line, like the
// surname in "Thanks, Maya Whitlock". Each starts with a capital letter, so a
// sentence ("Thanks, Maya and Ben will call") never counts as a name.
const NAME_WORDS = /^(?:[ \t]+\p{Lu}[\p{L}'’.-]*){0,2}[ \t]*$/u;

/**
 * The sign-off is a preference, not a claim, so code makes it exact instead
 * of asking for a rewrite: "Thanks,\nMaya" and "Thanks, Maya Whitlock" become
 * "Thanks, Maya", extra sign-off lines stacked above it are removed, and a
 * missing one is added. Only the very end of the draft is touched.
 */
export function withSignOff(body: string, signOff: string): string {
  const text = body.trim();
  const [first, ...rest] = signOff.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // The sign-off words (any case, line breaks allowed between them), then
  // whatever is left on that line, which must be name words.
  const last = new RegExp(`${first}\\s*${rest.join("\\s+")}([^\\n]*)$`, "i");

  let cut = -1; // where the sign-off (or the top one of a stack) starts
  let search = text;
  for (;;) {
    const m = last.exec(search);
    if (!m || !NAME_WORDS.test(m[1])) break;
    // A second copy above the first only counts when it sits on its own line.
    if (cut >= 0 && !/(?:^|\n)[ \t]*$/.test(search.slice(0, m.index))) break;
    cut = m.index;
    search = search.slice(0, cut).trimEnd();
  }

  if (cut < 0) return `${text}\n\n${signOff}`;
  return text.slice(0, cut) + signOff;
}

const NO_REPLY = /no[-_.]?reply|do[-_.]?not[-_.]?reply/i;

type RawDraft = { to: string; subject: string; body: string; attach: string[] };

function draftSchema(recipients: Mailbox[], attachable: { filename: string }[]): ReplySchema {
  return {
    name: "draft",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["to", "subject", "body", "attach"],
      properties: {
        to: recipients.length
          ? { type: "string", enum: recipients.map((r) => r.address), description: "Who the email goes to." }
          : { type: "string" },
        subject: { type: "string", description: "A clear subject line, under 12 words." },
        body: { type: "string", description: "The email body, plain text, ending with the sign-off." },
        attach: {
          type: "array",
          items: attachable.length ? { type: "string", enum: attachable.map((a) => a.filename) } : { type: "string" },
          description: "Files to attach that back up the request (may be empty).",
        },
      },
    },
  };
}

const ACTION_WORDS: Record<ActionKind, string> = {
  cancel: "cancel it (and ask for a refund of charges that should not have happened, if the facts support one)",
  request_refund: "ask for a refund or credit",
  dispute_price: "dispute the price and ask for the agreed price to be restored and the difference credited",
  negotiate: "ask them to match or beat the cheaper offer, or say we will switch",
  correct_bill: "ask for the bill to be corrected and the difference credited",
  none: "ask them to look into it",
};

/**
 * What the email should and shouldn't ask, per kind of problem. The claim
 * check catches wrong facts, not wrong reasoning, so the reasoning that a
 * small model got wrong in testing is spelled out here.
 */
export const KIND_GUIDANCE: Partial<Record<FindingKind, string>> = {
  duplicate_subscription:
    "Only the household can cancel a subscription billed through a platform such as an app store: say we are cancelling that copy ourselves before it renews. Ask the business to refund the duplicate charges, or to say how to claim them. Don't call it their error.",
  renewal_trap:
    "If a notice deadline has passed, say so plainly and ask for goodwill; don't claim a right we don't have.",
  renewal_price_creep: "Ask them to match the cheaper like-for-like quote, and say we will switch if they can't.",
  billing_error: "Ask for the bill to be reissued on the actual reading and the difference credited or refunded.",
};

function prompt(c: DraftCase, voice: Voice, figures: string, evidence: string, retryProblems: string[], canAttach: boolean): string {
  const retry = retryProblems.length
    ? `\nAn earlier draft used things that are NOT in the figures or evidence: ${retryProblems.join("; ")}. Leave those out or use the exact listed value.\n`
    : "";
  return `Write a short email from ${voice.fromName} to ${c.merchant} about this problem: ${c.title}. ${c.why}
What we want: ${c.action.summary} In other words, ${ACTION_WORDS[c.action.kind]}.
${KIND_GUIDANCE[c.kind] ?? ""}

Rules:
- Use ONLY the VERIFIED FIGURES and the EVIDENCE below. Copy every amount, date, count and reference exactly as written there. Never calculate, add, subtract, round or estimate anything yourself. If a number you want is not listed, leave it out.
- Refer to emails and documents by their date or title, and quote the business's own reference numbers (account, invoice, receipt, policy numbers) when they appear.
- Quote the key amounts: the price of each charge and the total the request is about.
- Dates after today (19 November 2026) are still ahead; say "by" for those, never "was".
${canAttach ? `- Only say something is attached if it is in "attach". Emails can be referred to by date; only files in the evidence can be attached.` : `- There are no files to attach: never say anything is attached. Refer to emails and receipts by their date instead.`}
- Don't say the business made a mistake unless the figures show one.
- State exactly what you are asking for. Be honest about anything that weakens our case (for example a missed deadline) and ask for goodwill where that is all we can ask for.
- Tone: ${voice.tone}. Under 180 words. Plain text, no markdown. End with "${voice.signOff}".
- "to" is the business address to write to (prefer a support or accounts address over a no-reply one). "attach" lists files from the evidence that support the request.
${retry}
VERIFIED FIGURES (worked out and checked by code):
${figures}

EVIDENCE:
${evidence}`;
}

const SYSTEM = `You write household admin emails for the Whitlock family in Melbourne, Australia. Today is Thursday 19 November 2026. Currency is AUD. You never do arithmetic or date maths: you quote checked figures exactly.`;

/** Writes and checks one draft. Throws only if no model answered at all. */
export async function draftFinding(llm: LlmClient, c: DraftCase, corpus: Corpus, voice: Voice): Promise<ProposedDraft> {
  const { text: evidence, recipients: found, attachable } = draftEvidence(c.evidence, corpus);
  const household = new Set(voice.householdAddresses.map((a) => a.toLowerCase()));
  const business = found.filter((r) => !household.has(r.address.toLowerCase()));
  // Nobody reads a no-reply inbox: offer those only if there is nothing else.
  const replyable = business.filter((r) => !NO_REPLY.test(r.address));
  const recipients = replyable.length ? replyable : business;
  const figures = draftFigures(c);
  const allowed = `${figures}\n${evidence}`;
  const schema = draftSchema(recipients, attachable);

  const attempts: DraftAttempt[] = [];
  let best: { raw: RawDraft; attempt: DraftAttempt } | undefined;
  let lastError: unknown;

  // Flash first; the 35B (thinking off) once, only if Flash's draft failed the check.
  for (const model of ["flash", "judge"] as const) {
    try {
      const r = await llm.chat<RawDraft>({
        model,
        think: false,
        maxTokens: 1500,
        temperature: 0.2,
        schema,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt(c, voice, figures, evidence, best?.attempt.problems ?? [], attachable.length > 0) },
        ],
      });
      const raw = { ...r.json, body: withSignOff(r.json.body, voice.signOff) };
      const problems = claimCheck(`${raw.subject}\n${raw.body}`, allowed);
      if (recipients.length && !recipients.some((x) => x.address === raw.to)) problems.push(`recipient ${raw.to} is not in the evidence`);
      if (!raw.body.includes(voice.signOff)) problems.push(`no "${voice.signOff}" sign-off`);
      // "I have attached..." with nothing attached would embarrass Maya.
      // Only real files from the evidence count (when there are none, the schema can't stop made-up names).
      const realAttachments = raw.attach.filter((name) => attachable.some((a) => a.filename === name));
      if (/\battach(ed|ing|ment)?s?\b/i.test(raw.body) && realAttachments.length === 0) problems.push("mentions an attachment but attaches nothing");
      const attempt: DraftAttempt = { model: r.model, source: r.source, ms: r.ms, problems };
      attempts.push(attempt);
      if (!best || problems.length < best.attempt.problems.length) best = { raw, attempt };
      if (problems.length === 0) break;
    } catch (error) {
      lastError = error;
      attempts.push({ model, source: "live", ms: 0, problems: [error instanceof Error ? error.message : String(error)] });
      // No point asking a second model when the endpoint itself is unreachable.
      if (error instanceof LlmError && ["network", "not_configured", "not_cached"].includes(error.kind)) break;
    }
  }
  if (!best) throw lastError;

  const { raw, attempt } = best;
  const to = recipients.find((x) => x.address === raw.to) ?? { name: c.merchant, address: raw.to };
  return {
    channel: "email",
    to,
    subject: raw.subject.trim(),
    body: raw.body.trim(),
    attachDocumentIds: attachable.filter((a) => raw.attach.includes(a.filename)).map((a) => a.id),
    grounded: attempt.problems.length === 0,
    problems: attempt.problems,
    attempts,
    model: attempt.model,
    source: attempt.source,
    ms: attempts.reduce((n, a) => n + a.ms, 0),
  };
}

// ---------- Approving (drafts only) ----------

/**
 * What "Approve" does: saves the message as a draft in Maya's mailbox. The
 * email connector has no send operation, so this can never send anything.
 * Returns the saved draft; pass its id to `discardSaved` to undo.
 */
export function saveDraft(connectors: Connectors, draft: ProposedDraft): Promise<Draft> {
  return connectors.email.createDraft({
    to: [draft.to],
    subject: draft.subject,
    body: draft.body,
    attachDocumentIds: draft.attachDocumentIds,
  });
}

/** Undo for `saveDraft`. */
export function discardSaved(connectors: Connectors, draftId: string): Promise<void> {
  return connectors.email.discardDraft(draftId);
}

/** The household's voice from seed/persona.json. */
export async function loadVoice(connectors: Connectors): Promise<Voice> {
  const persona = JSON.parse(await connectors.runtime.source.readText("persona.json")) as {
    people: { name: string; email?: string }[];
    sharedMailbox?: string;
    agentPreferences: { tone: string; signOff: string; sendFrom: string };
  };
  const from = persona.people.find((p) => p.email === persona.agentPreferences.sendFrom) ?? persona.people[0];
  return {
    fromName: from.name,
    fromAddress: persona.agentPreferences.sendFrom,
    tone: persona.agentPreferences.tone,
    signOff: persona.agentPreferences.signOff,
    householdAddresses: [
      ...persona.people.map((p) => p.email).filter((e): e is string => !!e),
      ...(persona.sharedMailbox ? [persona.sharedMailbox] : []),
    ],
  };
}
