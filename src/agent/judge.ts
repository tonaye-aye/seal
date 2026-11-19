// Stage 6 of the scan: the 35B (thinking on) reads one case at a time and
// decides whether the household should act on it. It gets the facts code has
// already checked (verify stage) plus the evidence list, and must cite the
// evidence it relied on. It never states amounts: every number the user sees
// comes from verify.
//
// Code then checks the verdict: cited ids must exist in the case, and any
// amount the model wrote must match a verified figure. Problems lower the
// confidence ("Not sure: check the evidence") rather than being hidden.

import { formatDate } from "../lib/dates.ts";
import { LlmError, type LlmClient, type ReplySchema } from "../lib/llm.ts";
import { formatAUD } from "../lib/money.ts";
import type { Corpus } from "./corpus.ts";
import type { Candidate } from "./detectors.ts";
import type { ExtractionResult } from "./extract.ts";
import { amountsIn, type CaseEvidence } from "./retrieval.ts";
import type { VerifiedCase } from "./verify.ts";

export type FindingKind =
  | "price_increase"
  | "duplicate_subscription"
  | "duplicate_payment"
  | "trial_converted"
  | "renewal_trap"
  | "renewal_price_creep"
  | "billing_error";

export type ActionKind = "cancel" | "request_refund" | "dispute_price" | "negotiate" | "correct_bill" | "none";

export type Verdict = {
  isProblem: boolean;
  kind: FindingKind | "none";
  title: string;
  why: string;
  action: ActionKind;
  actionSummary: string;
  confidence: "high" | "medium" | "low";
  citedIds: string[];
  /** Problems code found with the model's answer. */
  issues: string[];
  model: string;
  source: "live" | "cache";
  ms: number;
};

const KINDS: FindingKind[] = [
  "price_increase",
  "duplicate_subscription",
  "duplicate_payment",
  "trial_converted",
  "renewal_trap",
  "renewal_price_creep",
  "billing_error",
];
const ACTIONS: ActionKind[] = ["cancel", "request_refund", "dispute_price", "negotiate", "correct_bill", "none"];

const VERDICT_SCHEMA: ReplySchema = {
  name: "verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["is_problem", "kind", "title", "why", "action", "action_summary", "confidence", "cited_ids"],
    properties: {
      is_problem: { type: "boolean" },
      kind: { type: "string", enum: [...KINDS, "none"] },
      title: { type: "string", description: "Up to 8 plain words for the household, e.g. 'StreamBox is paid twice'." },
      why: { type: "string", description: "One plain sentence, under 30 words: what is wrong (or why it is fine). No dollar amounts, no evidence ids." },
      action: { type: "string", enum: ACTIONS },
      action_summary: { type: "string", description: "One short sentence: what the household should do." },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      cited_ids: { type: "array", items: { type: "string" }, description: "2 to 6 evidence ids the decision rests on." },
    },
  },
};

type RawVerdict = {
  is_problem: boolean;
  kind: FindingKind | "none";
  title: string;
  why: string;
  action: ActionKind;
  action_summary: string;
  confidence: "high" | "medium" | "low";
  cited_ids: string[];
};

const SYSTEM = `You review a Melbourne household's money admin for the Whitlock family (Maya, Ben, kids Ollie and Pia). Today is Thursday 19 November 2026. Currency is AUD. Code has already checked the numbers and dates; treat the VERIFIED FACTS as correct and never redo the arithmetic.`;

const INSTRUCTIONS = `Decide whether the household should ACT on this case: is there a charge (past or about to happen) that is wrong, duplicated, unwanted or avoidable, so that a message, a cancellation or a decision would save money?

Count as problems:
- a price rise that breaks what was agreed (price_increase)
- the same service paid twice through two channels (duplicate_subscription)
- one bill paid twice (duplicate_payment)
- a free trial that became a paid plan nobody uses (trial_converted)
- a renewal or annual fee coming for something unused or unwanted, especially near or past a notice deadline (renewal_trap)
- a renewal that rose a lot while a cheaper like-for-like quote exists (renewal_price_creep)
- a bill based on an estimate or reading that looks wrong (billing_error)
It does not need to be a proven error: an unwanted upcoming charge with a deadline counts.

NOT problems: a rise the contract allows and that was announced in advance and matches exactly; payments that look alike but carry different references or match separate requests. For these, set is_problem false and kind "none", and say in "why" what makes it fine.

Rules: base the decision on the VERIFIED FACTS and the evidence. "title", "why" and "action_summary" are read by the household: plain words, no dollar amounts (the app shows the checked figures) and no evidence ids (put those only in "cited_ids"). Cite only ids from the EVIDENCE list. Use "low" confidence if the evidence is thin or contradictory.`;

/** Evidence ids look like "msg_0024", "doc_001", "evt_004", "JE-00051". */
const ID_PATTERN = /\b(?:msg|doc|evt)_\d+(?::\d{4}-\d{2}-\d{2})?\b|\b(?:JE|MC)-\d{5}\b/g;

/**
 * Removes evidence ids from text the household reads, e.g. "(MC-00027,
 * msg_0035)". Asking the model not to write them isn't enough on its own.
 */
export function stripIds(text: string): string {
  return text
    .replace(/\s*\((?:[^()]*?(?:\b(?:msg|doc|evt)_\d+|\b(?:JE|MC)-\d{5})[^()]*?)\)/g, "")
    .replace(ID_PATTERN, "")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The case as the judge sees it: checked facts first, then the evidence list. */
export function judgeBrief(
  candidate: Candidate,
  verified: VerifiedCase,
  evidence: CaseEvidence,
  extraction: ExtractionResult,
  corpus: Corpus,
): string {
  const lines: string[] = [];
  lines.push(`CASE: ${candidate.names.join(" + ")}`);
  lines.push(`Raised because: ${[...new Set(candidate.signals.map((s) => s.summary))].slice(0, 6).join("; ")}`);
  lines.push("", "VERIFIED FACTS (worked out by code from the bank, emails and documents):");
  for (const n of verified.notes) lines.push(`- ${n}`);
  for (const w of verified.warnings) lines.push(`- CHECK: ${w}`);

  lines.push("", "EVIDENCE (cite these ids):");
  for (const item of evidence.items.slice(0, 28)) {
    if (item.kind === "txn") {
      const t = corpus.transactions.find((x) => x.id === item.id);
      if (t) lines.push(`${t.id} | bank ${formatDate(t.date)} | ${t.description} | ${formatAUD(t.amountCents)}`);
    } else if (item.kind === "event") {
      const e = corpus.events.find((x) => x.id === item.id);
      if (e) lines.push(`${e.id} | calendar ${formatDate(e.start.slice(0, 10))} | ${e.title}`);
    } else {
      const facts = extraction.facts.get(`${item.kind}:${item.id}`);
      const clauses = facts?.clauses.filter((c) => c.grounded).slice(0, 3).map((c) => `"${c.text}"`) ?? [];
      if (item.kind === "email") {
        const m = corpus.emails.find((x) => x.id === item.id);
        if (m) {
          const sender = m.labels.includes("SENT") ? `sent by ${m.from.name}` : `from ${m.from.name}`;
          lines.push(`${m.id} | email ${formatDate(m.date.slice(0, 10))} ${sender}${m.unread ? " (unread)" : ""} | ${m.subject}${clauses.length ? ` | ${clauses.join(" ")}` : ""}`);
        }
      } else {
        const d = corpus.documents.find((x) => x.id === item.id);
        if (d) {
          const reading = facts?.reading?.value != null ? ` | photo reads ${facts.reading.value} ${facts.reading.unit}` : "";
          lines.push(`${d.id} | document ${d.title} (${d.filename})${reading}${clauses.length ? ` | ${clauses.join(" ")}` : ""}`);
        }
      }
    }
  }
  return lines.join("\n");
}

/**
 * The first sentence of a reply, for the one line the list shows. The model
 * is asked for one sentence but often writes three or four.
 */
export function firstSentence(text: string): string {
  // A full stop followed by a space and a capital ends a sentence; "4.0%" or
  // "Sept." mid-sentence don't.
  const match = /^(.+?[.!?])\s+(?=[A-Z])/.exec(text);
  return match ? match[1] : text;
}

/** Code checks on the model's answer. */
function check(raw: RawVerdict, evidence: CaseEvidence, verified: VerifiedCase): { cited: string[]; issues: string[] } {
  const issues: string[] = [];
  const known = new Set(evidence.items.map((i) => i.id));
  const cited = [...new Set(raw.cited_ids)].filter((id) => known.has(id));
  const unknown = raw.cited_ids.filter((id) => !known.has(id));
  if (unknown.length) issues.push(`Cited ids not in the evidence: ${unknown.join(", ")}`);
  if (raw.is_problem && cited.length === 0) issues.push("No valid evidence cited.");
  // Any amount in the text must be one code already verified.
  const allowed = new Set([
    ...verified.figures.filter((f) => f.unit === "cents").map((f) => f.value as number),
    ...verified.notes.flatMap(amountsIn),
  ]);
  const stray = amountsIn(`${raw.title} ${raw.why} ${raw.action_summary}`).filter((c) => !allowed.has(c));
  if (stray.length) issues.push(`Amounts not in the verified figures: ${stray.map(formatAUD).join(", ")}`);
  if (raw.is_problem && raw.kind === "none") issues.push("Called a problem but given no kind.");
  return { cited, issues };
}

export async function judgeCase(
  llm: LlmClient,
  candidate: Candidate,
  verified: VerifiedCase,
  evidence: CaseEvidence,
  extraction: ExtractionResult,
  corpus: Corpus,
): Promise<Verdict> {
  const brief = judgeBrief(candidate, verified, evidence, extraction, corpus);
  let lastError: unknown;
  // Thinking can use a lot of tokens; a second try gets a larger budget
  // automatically (see llm.ts). One more try covers a bad JSON reply.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await llm.chat<RawVerdict>({
        model: "judge",
        think: true,
        maxTokens: 8000,
        temperature: attempt === 0 ? 0.1 : 0.3,
        schema: VERDICT_SCHEMA,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${INSTRUCTIONS}\n\n${brief}` },
        ],
      });
      const raw = r.json;
      const { cited, issues } = check(raw, evidence, verified);
      // Doubts lower confidence; they never raise it.
      let confidence = raw.confidence;
      if (issues.length || verified.warnings.length) confidence = confidence === "high" ? "medium" : confidence;
      if (raw.is_problem && cited.length === 0) confidence = "low";
      return {
        isProblem: raw.is_problem,
        kind: raw.is_problem ? raw.kind : "none",
        title: stripIds(raw.title),
        why: firstSentence(stripIds(raw.why)),
        action: raw.action,
        actionSummary: stripIds(raw.action_summary),
        confidence,
        citedIds: cited,
        issues,
        model: r.model,
        source: r.source,
        ms: r.ms,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof LlmError && ["network", "not_configured", "not_cached"].includes(error.kind)) break;
    }
  }
  throw lastError;
}
