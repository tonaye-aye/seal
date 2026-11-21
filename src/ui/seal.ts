import type { Corpus } from "../agent/corpus";
import type { Finding } from "../agent/pipeline";
import type { FixRoute } from "../agent/routes";
import { isTauri } from "@tauri-apps/api/core";
import { copy } from "../copy";
import { openExternal } from "../lib/native";
import { notify, type ScanState } from "../lib/scan-store";
import { lookupEvidence } from "./evidence";
import { chosenRoute } from "./fix-route";
import { shortDate } from "./format";

// "Seal the leak": where the approved fix goes next, worked out by code from
// the route Maya chose (no model). In order:
//   email     the Email route, or no routes and a draft with an address: Mail opens with it filled in
//   sample    a call, chat or online route: a labelled stand-in page, because the business is fictional
//   calendar  no routes, no email, and the evidence includes a calendar event: Calendar opens
//   bank      none of those, a payment made twice, and the evidence has the bank line: her bank can dispute it
// Anything else has no target, so no button. Nothing is sent, and no number is
// ever dialled: each one only opens the app or page where Maya does it.

export type SealTarget =
  | { kind: "email"; href: string; to: string }
  | { kind: "sample"; route: FixRoute }
  | { kind: "calendar"; date?: string }
  | { kind: "bank"; account: string };

export function sealTarget(finding: Finding, corpus: Corpus | undefined, scan: Pick<ScanState, "routes" | "decisions">): SealTarget | undefined {
  const route = chosenRoute(finding, scan);
  if (route && route.kind !== "email") return { kind: "sample", route };
  const draft = finding.draft;
  if (draft?.to.address) {
    // A mailto link carries the recipient, subject and body; Mail opens a new message with them.
    const query = `subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
    return { kind: "email", href: `mailto:${draft.to.address}?${query}`, to: draft.to.name };
  }
  const relied = finding.evidence.filter((e) => e.cited).map((e) => lookupEvidence(corpus, e.id, e.kind));
  if (relied.some((v) => v.kind === "event")) return { kind: "calendar", date: finding.deadline?.date };
  const txn = relied.find((v) => v.kind === "txn");
  if (txn && finding.kind === "duplicate_payment") return { kind: "bank", account: txn.meta };
  return undefined;
}

/** The line in the Next block saying what Seal the leak does. */
export function sealNote(t: SealTarget): string {
  if (t.kind === "email") return copy.next.seal.email;
  if (t.kind === "sample") return copy.next.seal.sample[t.route.kind];
  if (t.kind === "calendar") return copy.next.seal.calendar(t.date ? shortDate(t.date) : undefined);
  return copy.next.seal.bank(t.account);
}

/** The tooltip on the Seal the leak button. */
export function sealTip(t: SealTarget): string {
  if (t.kind === "email") return copy.actions.sealTip.email(t.to);
  if (t.kind === "sample") return copy.actions.sealTip.sample(t.route.provider);
  if (t.kind === "calendar") return copy.actions.sealTip.calendar;
  return copy.actions.sealTip.bank(t.account);
}

/**
 * Seal the leak: opens Mail or Calendar. A bank fix has no link to open, so it
 * says where to do it instead. A sample route is drawn by the palette.
 */
export async function seal(t: Exclude<SealTarget, { kind: "sample" }>): Promise<void> {
  if (t.kind === "bank") return notify(copy.toasts.sealBank(t.account));
  const opened = await openExternal(t.kind === "calendar" ? "calendar" : t.href);
  if (!opened) notify(isTauri() ? copy.toasts.sealFailed : copy.toasts.sealPreview);
}

/** Opens a real complaint body's form in the browser. */
export async function openComplaintBody(href: string): Promise<void> {
  const opened = await openExternal(href);
  if (!opened) notify(isTauri() ? copy.toasts.sealFailed : copy.toasts.sealPreview);
}
