// Turns an evidence id (a transaction, email, document or calendar entry) into
// what the evidence trail shows: a title, a line of detail and, when opened,
// the text itself. Everything comes from what the scan read.

import type { Corpus } from "../agent/corpus.ts";
import type { EvidenceRef } from "../agent/detectors.ts";
import { formatAUD } from "../lib/money.ts";
import { shortDate } from "./format.ts";
import { copy } from "../copy.ts";

export type EvidenceView = {
  id: string;
  kind: EvidenceRef["kind"];
  /** e.g. "Email", "Card", "Document". */
  source: string;
  title: string;
  meta: string;
  date?: string;
  amount?: string;
  /** The full text, shown when the item is opened. */
  body?: string;
  /** A photo with no text layer (the meter photo): shown as an image. */
  imageDocId?: string;
};

export function lookupEvidence(corpus: Corpus | undefined, id: string, kind?: EvidenceRef["kind"]): EvidenceView {
  const fallback: EvidenceView = { id, kind: kind ?? "doc", source: copy.evidence.item, title: id, meta: copy.evidence.notAvailable };
  if (!corpus) return fallback;

  const txn = corpus.transactions.find((t) => t.id === id);
  if (txn) {
    const account = corpus.accounts.find((a) => a.id === txn.accountId);
    return {
      id,
      kind: "txn",
      source: copy.evidence.bank,
      title: txn.description,
      meta: account?.name ?? copy.evidence.bankAccount,
      date: txn.date,
      amount: txn.amountCents < 0 ? formatAUD(-txn.amountCents) : `+${formatAUD(txn.amountCents)}`,
    };
  }
  const email = corpus.emails.find((m) => m.id === id);
  if (email) {
    const files = email.attachments.map((a) => a.filename).join(", ");
    return {
      id,
      kind: "email",
      source: copy.evidence.email,
      title: email.subject,
      meta: `${email.from.name}${email.unread ? ` · ${copy.evidence.unread}` : ""}${files ? ` · ${files}` : ""}`,
      date: email.date,
      body: email.body,
    };
  }
  const doc = corpus.documents.find((d) => d.id === id);
  if (doc) {
    const image = doc.mimeType.startsWith("image/");
    return {
      id,
      kind: "doc",
      source: image ? copy.evidence.photo : copy.evidence.document,
      title: doc.title,
      meta: doc.filename,
      date: doc.modifiedAt,
      body: doc.text ?? undefined,
      imageDocId: image ? doc.id : undefined,
    };
  }
  const event = corpus.events.find((e) => e.id === id) ?? corpus.events.find((e) => e.eventId === id);
  if (event) {
    return {
      id,
      kind: "event",
      source: copy.evidence.calendar,
      title: event.title,
      meta: [event.calendar, event.recurring ? copy.evidence.repeats : ""].filter(Boolean).join(" · "),
      date: event.start,
      body: event.notes || undefined,
    };
  }
  return fallback;
}

/** "14 Oct" for the trail's date column. */
export function evidenceDate(view: EvidenceView): string {
  return view.date ? shortDate(view.date) : "";
}
