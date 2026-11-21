// Draft verbs: Firmer and Shorter rewrite a finding's email without a chat
// box. They change tone and length only, never what is being asked for.
//
// Every rewrite starts from Seal's original draft, so verbs never stack. Flash
// writes it (thinking off), and the 35B tries once more if code rejects it.
// A rewrite only counts if it passes every check below. If neither model
// passes, the caller keeps the draft that is on screen and says so.
//
// This file is separate from draft.ts on purpose: the text of the original
// draft request is what finds its saved answer, so it must not change.

import { LlmError, type LlmClient, type ReplySchema } from "../lib/llm.ts";
import type { Corpus } from "./corpus.ts";
import {
  claimCheck,
  draftEvidence,
  draftFigures,
  figureValue,
  KIND_GUIDANCE,
  withSignOff,
  type DraftAttempt,
  type DraftCase,
  type ProposedDraft,
  type Voice,
} from "./draft.ts";
import { amountIn, dateIn, numberIn, referenceIn } from "./grounding.ts";
import type { FindingKind } from "./judge.ts";
import type { Figure } from "./verify.ts";

// ---------- Shapes ----------

export const VERBS = ["firmer", "shorter"] as const;
export type Verb = (typeof VERBS)[number];

/** A rewrite that passed every check. The recipient and attachments stay the original's. */
export type RewriteVersion = {
  subject: string;
  body: string;
  model: string;
  /** "cache" means a saved answer, and the UI has to say so. */
  source: "live" | "cache";
};

export type RewriteOutcome =
  | { ok: true; version: RewriteVersion; attempts: DraftAttempt[] }
  | {
      ok: false;
      /** "no_saved": on saved answers, and this rewrite was never saved. "failed": no version passed. */
      why: "no_saved" | "failed";
      problems: string[];
      attempts: DraftAttempt[];
    };

type Written = { subject: string; body: string };

/** What the checks need to know about the draft being rewritten. */
type Original = Pick<ProposedDraft, "subject" | "body" | "attachDocumentIds">;
type CaseFacts = Pick<DraftCase, "kind" | "figures">;

// ---------- What a rewrite must keep ----------

/** The figures each kind of problem depends on. Kept whenever the original quotes them. */
const KEY_FIGURES: Record<FindingKind, string[]> = {
  price_increase: ["previous_price", "new_price", "overcharged_so_far", "term_months", "term_end"],
  duplicate_subscription: ["duplicate_amount", "duplicated_total", "platform_renews"],
  duplicate_payment: ["payment_amount", "overpaid", "first_payment", "second_payment", "invoice_reference", "receipt_references"],
  trial_converted: ["paid_after_last_use", "next_charge", "last_used"],
  renewal_trap: ["renewal_amount", "renews_on", "notice_deadline", "last_used"],
  renewal_price_creep: ["renewal_amount", "competitor_quote", "quote_valid_until", "renews_on"],
  billing_error: ["estimated_reading", "actual_reading", "actual_reading_date", "bill_total", "overcharge_estimate"],
  warranty_claim: ["product_serial", "warranty_ends", "cancel_by", "repair_reference", "repair_visit"],
};

/** Figures a rewrite must carry even if the original left them out. */
const ALWAYS_KEEP: Partial<Record<FindingKind, string[]>> = {
  renewal_trap: ["notice_deadline"],
  warranty_claim: ["product_serial", "warranty_ends", "cancel_by"],
};

/** Business references: "KP-20418", "NVK-204417", the fault code "E18", account "7782-0145-3". */
const REFERENCE = /\b[A-Z]{1,4}-[A-Z0-9-]*\d[A-Z0-9-]*\b|\b[A-Z]{1,2}\d{2,}\b|\b\d{3,}-\d+(?:-\d+)*\b/g;

/** A clock time: "10:00 am", "10am". The claim check doesn't look at these. */
const CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/gi;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A clock time as minutes after midnight, so "10am" and "10:00 am" count as the same. */
function minutes(hour: string, minute: string | undefined, half: string): number {
  return (Number(hour) % 12 + (half.toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(minute ?? 0);
}

const clocksIn = (text: string) => [...text.matchAll(CLOCK)].map((m) => minutes(m[1], m[2], m[3]));

/** "10:00 am on 25 November 2026" to "2026-11-25". */
function isoIn(text: string): string | undefined {
  const m = new RegExp(`\\b(\\d{1,2}) (${MONTHS.join("|")}) (\\d{4})\\b`).exec(text);
  if (!m) return undefined;
  return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

const MONTH_WORD = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const monthNumber = (word: string) => MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === word.slice(0, 3).toLowerCase()) + 1;

type DateMention = { day: number; month: number; year?: number };

/** Every written date, with its year when it has one ("6 December 2026", "December 6"). */
function dateMentions(text: string): DateMention[] {
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_WORD})\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi");
  const monthFirst = new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi");
  const year = (y: string | undefined) => (y ? Number(y) : undefined);
  return [
    ...[...text.matchAll(dayFirst)].map((m) => ({ day: Number(m[1]), month: monthNumber(m[2]), year: year(m[3]) })),
    ...[...text.matchAll(monthFirst)].map((m) => ({ day: Number(m[2]), month: monthNumber(m[1]), year: year(m[3]) })),
  ];
}

/**
 * Is this exact date in the text? Stricter than `dateIn`, which ignores the
 * year: the washer was bought on 6 December 2024 and its warranty ends on
 * 6 December 2026, so one must not count as the other.
 */
function dateKept(iso: string, text: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const numeric = [`${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`, `${d}/${m}/${y}`, iso];
  return numeric.some((form) => text.includes(form)) || dateMentions(text).some((x) => x.day === d && x.month === m && (x.year === undefined || x.year === y));
}

/** A worded figure: a time with its date, or one or more references. */
function textIn(value: string, text: string): boolean {
  const clock = [...value.matchAll(CLOCK)][0];
  if (!clock) return value.split(/,\s*/).every((part) => referenceIn(part, text));
  // The same time has to sit next to the same date: both could otherwise
  // appear in the email, each attached to something else.
  const wanted = minutes(clock[1], clock[2], clock[3]);
  const date = isoIn(value);
  return [...text.matchAll(CLOCK)].some((m) => {
    if (minutes(m[1], m[2], m[3]) !== wanted) return false;
    const start = m.index ?? 0;
    return !date || dateKept(date, text.slice(Math.max(0, start - 40), start + m[0].length + 40));
  });
}

function figureIn(f: Figure, text: string): boolean {
  switch (f.unit) {
    case "cents": return amountIn(Math.abs(f.value as number), text);
    case "date": return dateKept(f.value as string, text);
    case "kwh":
    case "count":
    case "days":
    case "percent": return numberIn(f.value as number, text);
    case "text": return textIn(String(f.value), text);
    default: return true;
  }
}

export type KeepItem = { what: string; text: string; found: (rewrite: string) => boolean };

/** Everything this rewrite has to keep, worked out by code from the kind and the checked figures. */
export function mustKeep(c: CaseFacts, originalText: string, allowed: string): KeepItem[] {
  const always = ALWAYS_KEEP[c.kind] ?? [];
  const items: KeepItem[] = [];
  for (const id of KEY_FIGURES[c.kind]) {
    const f = c.figures.find((x) => x.id === id);
    if (!f || !(always.includes(id) || figureIn(f, originalText))) continue;
    const text = figureValue(f);
    if (!items.some((i) => i.text === text)) items.push({ what: f.label, text, found: (t) => figureIn(f, t) });
  }
  // Only real references: one the claim check can't find isn't worth protecting.
  for (const ref of new Set(originalText.match(REFERENCE) ?? [])) {
    if (!referenceIn(ref, allowed) || items.some((i) => i.text.includes(ref))) continue;
    items.push({ what: "Reference", text: ref, found: (t) => referenceIn(ref, t) });
  }
  return items;
}

// ---------- The checks ----------

const REFUND = /\b(refund\w*|credit\w*|reimburs\w*)\b/i;
const CANCEL = /\bcancel\w*\b/i;

/**
 * What each kind of email is asking for. If the original asks with one of
 * these, the rewrite must too. By kind, because the same word can be a plain
 * fact elsewhere ("these match the direct charges").
 */
const ASK_WORDS: Record<FindingKind, RegExp[]> = {
  price_increase: [REFUND],
  duplicate_subscription: [REFUND, CANCEL],
  duplicate_payment: [REFUND],
  trial_converted: [CANCEL, REFUND],
  renewal_trap: [CANCEL, /\bwaiv\w*\b/i],
  renewal_price_creep: [/\b(match\w*|beat)\b/i, /\bswitch\w*\b/i],
  billing_error: [/\b(reissu\w*|correct\w*|amend\w*)\b/i, REFUND],
  warranty_claim: [/\bwarranty\b/i, /\brepair\w*\b/i, CANCEL],
};

/** Wording a rewrite may not introduce. Each is only allowed if the original already had it. */
const NEW_WORDING: { name: string; pattern: RegExp }[] = [
  // The household's feelings about a business aren't in the evidence.
  {
    name: "a made-up feeling about the business",
    pattern: /\b(enjoy\w*|lov(?:e|ed|es|ing)|fond|fan of|long[- ]time|loyal (?:customer|member)s?|valued?\b(?= (?:customer|your|the work))|value your|always appreciate|appreciate the work|great service|friendly service|wonderful|fantastic|part of the community)\b/i,
  },
  { name: "an apology", pattern: /\b(sorry|apolog\w*|regret\w*|forgive|my fault|our fault|our mistake|our error|we should have)\b/i },
  {
    name: "a weaker request",
    pattern: /\b(no worries|no problem|no rush|no pressure|don't worry|at your convenience|whenever you|if possible|if at all possible|(?:totally|completely|fully) understand|we understand if|happy to pay|not a big deal|if it's not too much)\b/i,
  },
  { name: "a line excusing the business", pattern: /\b(not your fault|no fault|nothing wrong|these things happen|honest mistake|easy mistake|understandable)\b/i },
  {
    name: "blame",
    pattern: /\b(your (?:error|mistake|fault)|you (?:have )?made an? (?:error|mistake)|wrongly|wrongful\w*|unfair\w*|unacceptable|misled|misleading|negligen\w*|double[- ]?charg\w*)\b/i,
  },
  {
    name: "a threat",
    pattern: /\b(legal|lawyers?|solicitors?|sue|suing|court|tribunal|ombudsman|regulators?|accc|afca|tio|ewov|consumer affairs|chargeback|charge back|complaint|escalat\w*|breach\w*|unlawful|illegal|fraud\w*|scam\w*|report you)\b/i,
  },
];

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const plain = (text: string) => text.replace(/[’‘]/g, "'");
const squash = (text: string) => plain(text).toLowerCase().replace(/\s+/g, " ").trim();

/** Shorter has to be clearly shorter: no more than this share of the original's words. */
const SHORTER_SHARE = 0.85;
const MAX_WORDS = 180;
const MAX_SUBJECT_WORDS = 14;

/** The sentence naming the notice date has to admit that it was missed. */
function admitsMissedNotice(text: string, figures: Figure[]): boolean {
  const deadline = figures.find((f) => f.id === "notice_deadline");
  if (!deadline) return true;
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .some((s) => dateIn(deadline.value as string, s) && /\b(missed|passed|past|too late)\b/i.test(s));
}

/**
 * Is a figure's label sitting inside a sentence? "First payment: $385.00" at
 * the start of a line reads fine; "for Other provider's quote: $1,109.00" doesn't.
 */
function labelPasted(text: string, label: string): boolean {
  const needle = `${label}:`;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const before = text.slice(text.lastIndexOf("\n", at) + 1, at).trimEnd();
    if (before && !/[.!?]$/.test(before)) return true;
  }
  return false;
}

export type RewriteCheck = {
  verb: Verb;
  written: Written;
  original: Original;
  c: CaseFacts;
  /** The verified figures and evidence, the same pool the first draft is checked against. */
  allowed: string;
  signOff: string;
};

/** Every reason this rewrite can't be shown. Empty means it passed. */
export function checkRewrite({ verb, written, original, c, allowed, signOff }: RewriteCheck): string[] {
  const text = `${written.subject}\n${written.body}`;
  const originalText = `${original.subject}\n${original.body}`;
  const keep = mustKeep(c, originalText, allowed);
  const bad: string[] = [];

  if (!written.subject.trim()) bad.push("the subject is empty");
  if (wordCount(written.subject) > MAX_SUBJECT_WORDS) bad.push(`the subject is over ${MAX_SUBJECT_WORDS} words`);
  if (!written.body.trim().endsWith(signOff)) bad.push(`no "${signOff}" sign-off`);
  if (squash(written.body) === squash(original.body)) bad.push("the body did not change");

  // True to the evidence, and nothing a tone change could have added.
  bad.push(...claimCheck(text, allowed));
  const known = `${originalText}\n${keep.map((k) => k.text).join("\n")}`;
  for (const claim of claimCheck(text, known)) bad.push(`new detail not in the original: ${claim}`);
  const clocks = clocksIn(known);
  for (const m of text.matchAll(CLOCK)) {
    if (!clocks.includes(minutes(m[1], m[2], m[3]))) bad.push(`new time not in the original: ${m[0]}`);
  }

  // The claim check ignores the year when the day and month match, so a wrong year is caught here.
  const knownDates = dateMentions(known);
  for (const x of dateMentions(text)) {
    if (x.year === undefined) continue;
    const same = knownDates.filter((k) => k.day === x.day && k.month === x.month);
    if (same.length && !same.some((k) => k.year === undefined || k.year === x.year)) bad.push(`wrong year: ${x.day}/${x.month}/${x.year}`);
  }

  for (const k of keep) if (!k.found(text)) bad.push(`dropped ${k.what}: ${k.text}`);
  if (c.kind === "renewal_trap" && !admitsMissedNotice(text, c.figures)) bad.push("no longer admits the notice deadline was missed");
  // "Goodwill" says we're asking a favour, on any kind of problem: losing it turns a request into a demand.
  for (const ask of [...ASK_WORDS[c.kind], /\bgoodwill\b/i]) {
    if (ask.test(originalText) && !ask.test(text)) bad.push(`no longer asks with: ${ask.source}`);
  }
  for (const { name, pattern } of NEW_WORDING) {
    const found = pattern.exec(plain(text));
    if (found && !pattern.test(plain(originalText))) bad.push(`adds ${name}: "${found[0]}"`);
  }

  // A goodwill request stays a request: we can't expect what we have no right to.
  for (const sentence of plain(written.body).split(/(?<=[.!?])\s+|\n+/)) {
    if (/\bgoodwill\b/i.test(sentence) && /\b(expect|require|demand|insist|must|entitled)\b/i.test(sentence)) bad.push("demands goodwill instead of asking for it");
  }
  // A figure's internal label pasted into a sentence ("for Other provider's quote: $1,109.00").
  for (const f of c.figures) {
    if (labelPasted(text, f.label) && !labelPasted(originalText, f.label)) bad.push(`copied a label: ${f.label}`);
  }
  const firstLine = (t: string) => t.trim().split("\n")[0].trim();
  if (firstLine(written.body) !== firstLine(original.body)) bad.push("changed the greeting");
  for (const ref of new Set(original.subject.match(REFERENCE) ?? [])) {
    if (!referenceIn(ref, written.subject)) bad.push(`the subject lost ${ref}`);
  }

  const mentionsAttached = (t: string) => /\battach(ed|ing|ment)?s?\b/i.test(t);
  if (mentionsAttached(written.body) && original.attachDocumentIds.length === 0) bad.push("mentions an attachment but there is none");
  if (mentionsAttached(original.body) && original.attachDocumentIds.length > 0 && !mentionsAttached(written.body)) bad.push("no longer says what is attached");

  const words = wordCount(written.body);
  if (words > MAX_WORDS) bad.push(`over ${MAX_WORDS} words (${words})`);
  if (verb === "shorter" && words > wordCount(original.body) * SHORTER_SHARE) {
    bad.push(`not clearly shorter (${words} words, was ${wordCount(original.body)})`);
  }
  return [...new Set(bad)];
}

// ---------- Asking the model ----------

const REWRITE_SCHEMA: ReplySchema = {
  name: "draft_rewrite",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "body"],
    properties: {
      subject: { type: "string", description: "A clear subject line, under 12 words." },
      body: { type: "string", description: "The rewritten email body, plain text, ending with the sign-off." },
    },
  },
};

const SYSTEM = `You edit household admin emails for the Whitlock family in Melbourne, Australia. You change only the tone and length. You never add, change or work out a fact, and you quote checked figures exactly.`;

function verbAsk(verb: Verb, originalWords: number): string {
  switch (verb) {
    case "firmer":
      return "firmer: confident and direct, with short plain sentences that state clearly what we are asking for. It stays polite. Firm means clear, not angry: no threats, no new consequences and no blame. Anything asked as goodwill stays a request: never say we expect or require it.";
    case "shorter":
      return `much shorter: the original has ${originalWords} words and this must have at most ${Math.floor(originalWords * 0.7)}. Remove whole sentences, background and lists of dates, and merge what is left. Never remove an item under MUST KEEP.`;
  }
}

function rewritePrompt(verb: Verb, c: DraftCase, original: ProposedDraft, voice: Voice, figures: string, keep: KeepItem[], retry: string[]): string {
  const again = retry.length ? `\nAn earlier rewrite failed these checks: ${retry.join("; ")}. Fix every one.\n` : "";
  return `Rewrite the email below so it is ${verbAsk(verb, wordCount(original.body))}

It is from ${voice.fromName} to ${original.to.name}.
${KIND_GUIDANCE[c.kind] ?? ""}

Rules:
- Change the wording only. The request stays exactly the same, and so does everything it admits or concedes.
- Do not add any fact, amount, date, deadline, reference, consequence or promise that is not in the original email.
- Keep every item under MUST KEEP, written exactly as shown, inside natural sentences.
- Keep the first line (the greeting) exactly as it is.
- Keep the subject unless the new tone truly needs a small change, and keep any reference number in it.
- Dates that are still ahead stay ahead. Keep "by" where the original says "by".
- Do not apologise. Do not blame the business unless the original does. Never mention lawyers, regulators, complaints or chargebacks.
- ${original.attachDocumentIds.length ? "If the original says something is attached, keep saying so." : "Nothing is attached: never say anything is."}
- Plain text, no markdown. End with "${voice.signOff}".
${again}
MUST KEEP:
${keep.map((k) => `- ${k.text}`).join("\n")}

VERIFIED FIGURES (worked out and checked by code):
${figures}

ORIGINAL EMAIL
Subject: ${original.subject}

${original.body}`;
}

/**
 * Writes and checks one rewrite of Seal's original draft. Never throws for a
 * model failure, and never returns a version that failed a check.
 */
export async function rewriteDraft(
  llm: LlmClient,
  c: DraftCase,
  original: ProposedDraft,
  corpus: Corpus,
  voice: Voice,
  verb: Verb,
): Promise<RewriteOutcome> {
  const figures = draftFigures(c);
  const { text: evidence } = draftEvidence(c.evidence, corpus);
  // The evidence stays out of the prompt: a tone change doesn't need it, and a
  // model that can't see it can't pull in a new fact. Code still checks against it.
  const allowed = `${figures}\n${evidence}`;
  const keep = mustKeep(c, `${original.subject}\n${original.body}`, allowed);

  const attempts: DraftAttempt[] = [];
  let retry: string[] = [];
  let why: "no_saved" | "failed" = "failed";

  for (const model of ["flash", "judge"] as const) {
    try {
      const r = await llm.chat<Written>({
        model,
        think: false,
        maxTokens: 1500,
        temperature: 0.2,
        schema: REWRITE_SCHEMA,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: rewritePrompt(verb, c, original, voice, figures, keep, retry) },
        ],
      });
      const written = { subject: r.json.subject.trim(), body: withSignOff(r.json.body, voice.signOff) };
      const problems = checkRewrite({ verb, written, original, c, allowed, signOff: voice.signOff });
      attempts.push({ model: r.model, source: r.source, ms: r.ms, problems });
      if (problems.length === 0) {
        return { ok: true, version: { ...written, model: r.model, source: r.source }, attempts };
      }
      retry = problems;
    } catch (error) {
      attempts.push({ model, source: "live", ms: 0, problems: [error instanceof Error ? error.message : String(error)] });
      if (error instanceof LlmError && error.kind === "not_cached") why = "no_saved";
      // No point asking a second model when the endpoint itself can't be used.
      if (error instanceof LlmError && ["network", "not_configured", "not_cached"].includes(error.kind)) break;
    }
  }
  return { ok: false, why, problems: attempts[attempts.length - 1]?.problems ?? [], attempts };
}
