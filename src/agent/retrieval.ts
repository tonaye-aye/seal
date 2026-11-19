// Stage 3 of the scan: for each candidate, gather the evidence a person would
// look for. Exact links come first (who sent it, what it attached, reference
// numbers, the same amount near the same date). These are cheap, explainable
// and never wrong about *why* something was picked. Meaning-based search
// (embeddings) only adds items the exact links missed.

import { daysBetween } from "../lib/dates.ts";
import type { Corpus } from "./corpus.ts";
import type { Candidate, EvidenceRef } from "./detectors.ts";
import { categories, distinctiveTokens, merchantTokens, references } from "./merchants.ts";

/** Why an item was picked. Shown in the trace so the choice is never a mystery. */
export type MatchReason =
  | "detected" // part of the signal that raised the case
  | "sender" // sent by this business
  | "attachment" // attached to an email from this business
  | "named" // the text names the business
  | "reference" // shares a reference number with a charge
  | "amount" // mentions a charged amount near that charge's date
  | "household" // the family's own email about this kind of thing
  | "folder" // filed in the same folder as a matched document
  | "related"; // close in meaning (embeddings)

export type RetrievedItem = EvidenceRef & { reasons: MatchReason[]; score: number };

export type CaseEvidence = { candidateId: string; items: RetrievedItem[] };

/** How much each reason counts when ranking. Exact links outrank meaning. */
const WEIGHT: Record<MatchReason, number> = {
  detected: 5,
  reference: 4,
  sender: 3,
  attachment: 3,
  named: 2,
  amount: 2,
  household: 2,
  folder: 1,
  related: 1,
};

/** Amounts written in text, e.g. "$1,109.00" to 110900. */
export function amountsIn(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/g)].map(
    ([, dollars, cents]) => Number(dollars.replace(/,/g, "")) * 100 + Number(cents),
  );
}

/** An amount must appear within this many days of the charge to count. */
const AMOUNT_WINDOW_DAYS = 14;
/** Small amounts ($2.50) match too many unrelated things. */
const AMOUNT_MIN_CENTS = 500;

class Collector {
  private items = new Map<string, RetrievedItem>();

  add(kind: EvidenceRef["kind"], id: string, reason: MatchReason) {
    const key = `${kind}:${id}`;
    const item = this.items.get(key) ?? { kind, id, reasons: [], score: 0 };
    if (!item.reasons.includes(reason)) {
      item.reasons.push(reason);
      item.score += WEIGHT[reason];
    }
    this.items.set(key, item);
  }

  has(kind: EvidenceRef["kind"], id: string) {
    return this.items.has(`${kind}:${id}`);
  }

  list(): RetrievedItem[] {
    return [...this.items.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }
}

/** The kinds of business a case is about ("fitness", "energy"), for matching family emails. */
export function caseCategories(candidate: Candidate): string[] {
  const texts = [
    ...candidate.names,
    ...candidate.series.map((s) => s.description),
    ...candidate.signals.map((s) => s.summary),
  ];
  return [...new Set([...candidate.signals.flatMap((s) => s.categories), ...texts.flatMap(categories)])];
}

export function retrieveExact(candidate: Candidate, corpus: Corpus): CaseEvidence {
  const found = new Collector();
  const keys = new Set(candidate.keys);
  const names = (text: string) => distinctiveTokens(text).some((w) => keys.has(w));
  const own = new Set<string>();
  for (const m of corpus.emails) {
    if (m.labels.includes("SENT")) own.add(m.from.address);
    else for (const to of m.to) own.add(to.address);
  }

  // What raised the case.
  for (const e of candidate.evidence) found.add(e.kind, e.id, "detected");

  // Every charge from these businesses, not just the ones a rule flagged.
  const txns = corpus.transactions.filter((t) => names(t.description));
  for (const t of txns) found.add("txn", t.id, "named");
  const flagged = corpus.transactions.filter((t) => found.has("txn", t.id));

  // Reference numbers and amounts from the charges, for matching text.
  const refs = new Set(flagged.flatMap((t) => references(t.description)));
  const charges = flagged
    .filter((t) => -t.amountCents >= AMOUNT_MIN_CENTS)
    .map((t) => ({ cents: -t.amountCents, date: t.date }));
  const mentionsCharge = (text: string, date: string) =>
    amountsIn(text).some((cents) =>
      charges.some((c) => c.cents === cents && Math.abs(daysBetween(c.date, date)) <= AMOUNT_WINDOW_DAYS),
    );
  const sharesReference = (text: string) => references(text).some((r) => refs.has(r));

  // Emails.
  const wanted = new Set(caseCategories(candidate));
  for (const m of corpus.emails) {
    const text = `${m.subject}\n${m.body}`;
    const day = m.date.slice(0, 10);
    const fromBusiness = names(m.from.name) || names(m.from.address.split("@")[1] ?? "");
    if (fromBusiness) {
      found.add("email", m.id, "sender");
      for (const a of m.attachments) if (a.documentId) found.add("doc", a.documentId, "attachment");
    }
    if (names(text)) found.add("email", m.id, "named");
    if (sharesReference(text)) found.add("email", m.id, "reference");
    if (mentionsCharge(text, day)) found.add("email", m.id, "amount");
    // The family's own mail rarely names the business ("Plumber sorted").
    const mail = own.has(m.from.address);
    if (mail && categories(`${m.subject} ${m.body}`).some((c) => wanted.has(c))) {
      found.add("email", m.id, "household");
    }
  }

  // Documents.
  for (const d of corpus.documents) {
    const label = `${d.filename.replace(/[-_.]/g, " ")} ${d.title}`;
    if (names(label)) found.add("doc", d.id, "named");
    if (d.text && sharesReference(d.text)) found.add("doc", d.id, "reference");
    if (d.text && mentionsCharge(d.text, d.modifiedAt.slice(0, 10))) found.add("doc", d.id, "amount");
  }

  // Files sitting beside a matched document, e.g. the meter photo in the
  // same folder as the energy bills. Photos have no text to match otherwise.
  const folders = new Set(
    corpus.documents.filter((d) => found.has("doc", d.id)).map((d) => d.folder),
  );
  for (const d of corpus.documents) if (folders.has(d.folder)) found.add("doc", d.id, "folder");

  // Calendar.
  for (const e of corpus.events) {
    if (names(e.title) || merchantTokens(e.title).some((w) => keys.has(w))) found.add("event", e.id, "named");
  }

  return { candidateId: candidate.id, items: found.list() };
}
