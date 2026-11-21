import type { Corpus } from "../agent/corpus";
import type { Finding } from "../agent/pipeline";
import { isTauri } from "@tauri-apps/api/core";
import { copy } from "../copy";
import { openExternal } from "../lib/native";
import { notify } from "../lib/scan-store";
import { lookupEvidence } from "./evidence";
import { shortDate } from "./format";

// "Seal the leak": where the approved fix goes next, worked out by code from
// the finding's own draft and evidence (no model). In order:
//   email     the draft has an address: Mail opens with it filled in
//   phone     no email, but the evidence it relied on gives the business's number
//   calendar  no email or number, and the evidence includes a calendar event: Calendar opens
//   bank      none of those, a payment made twice, and the evidence has the bank line: her bank can dispute it
// Anything else (a step in another app's settings, say) has no target, so no button.
// Nothing is sent or changed: each one only opens the app where Maya does it.

export type SealTarget =
  | { kind: "email"; href: string; to: string }
  | { kind: "phone"; href: string; number: string }
  | { kind: "calendar"; date?: string }
  | { kind: "bank"; account: string };

// Australian numbers as letters and bills write them: 1300 000 000,
// 1800 123 456, 13 22 11, 0412 345 678, (03) 9123 4567.
const PHONE = /\b(?:1[38]00[ ]?\d{3}[ ]?\d{3}|13[ ]?\d{2}[ ]?\d{2}|04\d{2}[ ]?\d{3}[ ]?\d{3}|\(0\d\)[ ]?\d{4}[ ]?\d{4})\b/;

export function sealTarget(finding: Finding, corpus: Corpus | undefined): SealTarget | undefined {
  const draft = finding.draft;
  if (draft?.to.address) {
    // A mailto link carries the recipient, subject and body; Mail opens a new message with them.
    const query = `subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
    return { kind: "email", href: `mailto:${draft.to.address}?${query}`, to: draft.to.name };
  }
  const relied = finding.evidence.filter((e) => e.cited).map((e) => lookupEvidence(corpus, e.id, e.kind));
  for (const view of relied) {
    const number = view.body?.match(PHONE)?.[0];
    if (number) return { kind: "phone", href: `tel:${number.replace(/\D/g, "")}`, number };
  }
  if (relied.some((v) => v.kind === "event")) return { kind: "calendar", date: finding.deadline?.date };
  const txn = relied.find((v) => v.kind === "txn");
  if (txn && finding.kind === "duplicate_payment") return { kind: "bank", account: txn.meta };
  return undefined;
}

/** The line in the Next block saying what Seal the leak does. */
export function sealNote(t: SealTarget): string {
  if (t.kind === "email") return copy.next.seal.email;
  if (t.kind === "phone") return copy.next.seal.phone(t.number);
  if (t.kind === "calendar") return copy.next.seal.calendar(t.date ? shortDate(t.date) : undefined);
  return copy.next.seal.bank(t.account);
}

/** The tooltip on the Seal the leak button. */
export function sealTip(t: SealTarget): string {
  if (t.kind === "email") return copy.actions.sealTip.email(t.to);
  if (t.kind === "phone") return copy.actions.sealTip.phone(t.number);
  if (t.kind === "calendar") return copy.actions.sealTip.calendar;
  return copy.actions.sealTip.bank(t.account);
}

/**
 * Seal the leak: opens Mail, a call or Calendar. A bank fix has no link to
 * open (there's no app to point at), so it says where to do it instead.
 */
export async function seal(t: SealTarget): Promise<void> {
  if (t.kind === "bank") return notify(copy.toasts.sealBank(t.account));
  const opened = await openExternal(t.kind === "calendar" ? "calendar" : t.href);
  if (!opened) notify(isTauri() ? copy.toasts.sealFailed : copy.toasts.sealPreview);
}
