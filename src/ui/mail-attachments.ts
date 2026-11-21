import type { Corpus } from "../agent/corpus.ts";
import type { EvidenceRef } from "../agent/detectors.ts";
import { copy } from "../copy.ts";

// A mailto link can only carry the recipient, subject and body, so files never
// reach Mail. This works out, in plain code, what Maya has to add herself: the
// files chosen for the draft, and anything the draft says is attached that
// isn't one of those files (Kestrel's receipts are emails, not documents).

export type MailAttachments = {
  /** Real filenames to add in Mail. */
  files: string[];
  /** What the draft says is attached with no file behind it, and any reference numbers for it. */
  notFiles: { what: string; refs: string[] }[];
};

// The kinds of document a draft can say it attaches, in the singular.
const DOCUMENT_WORDS = ["receipt", "invoice", "photo", "statement", "bill", "term", "agreement", "quote", "notice", "contract", "letter"];
const SAYS_ATTACHED = /\b(?:attach(?:ed|ing|ments?)?|enclosed)\b/i;
// "I haven't attached it" is not a claim that something is attached.
const NEGATED = /\b(?:not|nothing|without|cannot|(?:have|has|is|are|did|do|does|can|could|wo)n['’]t)\b/i;

const wordIn = (word: string) => new RegExp(`\\b${word}s?\\b`, "i");

/** The reference numbers quoted next to this word in the finding's emails, like "Receipt: R-77311". */
function refsFor(word: string, evidence: Pick<EvidenceRef, "kind" | "id">[], corpus: Pick<Corpus, "emails"> | undefined): string[] {
  const label = new RegExp(`\\b${word}s?\\b[^A-Za-z0-9\\n]{0,4}(?:(?:no\\.?|number|#)\\s*)?([A-Z]{1,5}-\\d{3,})`, "gi");
  const refs = new Set<string>();
  for (const item of evidence) {
    if (item.kind !== "email") continue;
    const email = corpus?.emails.find((m) => m.id === item.id);
    for (const match of email?.body.matchAll(label) ?? []) refs.add(match[1]);
  }
  return [...refs].sort();
}

/** What Maya must add in Mail for this draft. Read from the text on screen, so her edits count. */
export function mailAttachments(
  draft: { body: string; attachDocumentIds: string[] },
  evidence: Pick<EvidenceRef, "kind" | "id">[],
  corpus: Pick<Corpus, "documents" | "emails"> | undefined,
): MailAttachments {
  const documents = draft.attachDocumentIds.map((id) => corpus?.documents.find((d) => d.id === id));
  const files = documents.map((d) => d?.filename ?? copy.next.attachments.unnamed);
  const covered = documents.map((d) => `${d?.filename ?? ""} ${d?.title ?? ""}`).join(" ");
  const claims = draft.body.split(/(?<=[.!?])\s+|\n+/).filter((s) => SAYS_ATTACHED.test(s) && !NEGATED.test(s));

  const notFiles: MailAttachments["notFiles"] = [];
  for (const word of DOCUMENT_WORDS) {
    const said = claims.map((s) => s.match(wordIn(word))?.[0]).find(Boolean);
    if (said && !wordIn(word).test(covered)) notFiles.push({ what: said.toLowerCase(), refs: refsFor(word, evidence, corpus) });
  }
  // It says something is attached, names no kind of document, and there are no files at all.
  if (claims.length > 0 && files.length === 0 && notFiles.length === 0) notFiles.push({ what: copy.next.attachments.genericFiles, refs: [] });
  return { files, notFiles };
}

/** Is there anything for Maya to add before she sends? */
export const hasAttachmentWork = (a: MailAttachments): boolean => a.files.length > 0 || a.notFiles.length > 0;

/** One sentence for each thing the draft claims but can't attach. */
export const notFileLines = (a: MailAttachments): string[] =>
  a.notFiles.map((n) => copy.next.attachments.notAttached(n.what, n.refs, a.files.length > 0));

/** The body Mail opens with: a short note to Maya above the draft when she has something to add. */
export function mailBody(body: string, a: MailAttachments): string {
  return hasAttachmentWork(a) ? `${copy.next.attachments.mailNote(a.files, notFileLines(a))}\n\n${body}` : body;
}
