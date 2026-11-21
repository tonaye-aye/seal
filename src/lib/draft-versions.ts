// Which version of a finding's email is on screen: Seal's original, or a
// Firmer or Shorter rewrite of it. Plain functions over plain data, so
// a script can test them without the app.
//
// Rewrites are kept apart from Maya's own edits, because an edit is labelled
// "Edited by you" and warned as unchecked, and a rewrite has passed the checks.

import type { ProposedDraft } from "../agent/draft.ts";
import type { RewriteVersion, Verb } from "../agent/rewrite.ts";

export type DraftVersions = {
  /** The original draft these were written from. A new check can write a different one. */
  of: string;
  /** Each finished rewrite, so pressing a verb a second time is instant. */
  versions: Partial<Record<Verb, RewriteVersion>>;
  /** The one on screen. Null: Seal's original. */
  active: Verb | null;
  /** The versions shown before this one, oldest first, for going back. */
  trail: { from: Verb | null; at: number }[];
};

type Identity = Pick<ProposedDraft, "to" | "subject" | "body">;

/** What ties a rewrite to the exact draft it came from. */
export const draftKey = (draft: Identity): string => `${draft.to.address}\n${draft.subject}\n${draft.body}`;

/** These versions, if they were written from this draft. */
export function versionsFor(original: Identity | undefined, entry: DraftVersions | undefined): DraftVersions | undefined {
  return original && entry?.of === draftKey(original) ? entry : undefined;
}

/**
 * The draft to show, send and save. An approved version stays as it was
 * approved, even if a later check wrote a different original.
 */
export function shownDraft(original: ProposedDraft | undefined, entry: DraftVersions | undefined, approved: boolean): ProposedDraft | undefined {
  if (!original) return original;
  const current = approved ? entry : versionsFor(original, entry);
  const version = current?.active ? current.versions[current.active] : undefined;
  if (!version) return original;
  // Only the subject and body change: code keeps the recipient and attachments.
  return { ...original, subject: version.subject, body: version.body, grounded: true, problems: [], model: version.model, source: version.source };
}

/** Which verb is on screen, if any. */
export function activeVerb(original: Identity | undefined, entry: DraftVersions | undefined, approved = false): Verb | null {
  return (approved ? entry : versionsFor(original, entry))?.active ?? null;
}

/** Keeps a finished rewrite without changing what's on screen. */
export function keepVersion(entry: DraftVersions | undefined, original: Identity, verb: Verb, version: RewriteVersion): DraftVersions {
  const base = versionsFor(original, entry) ?? { of: draftKey(original), versions: {}, active: null, trail: [] };
  return { ...base, versions: { ...base.versions, [verb]: version } };
}

/** Puts a finished rewrite on screen, remembering what it replaced. */
export function showVerb(entry: DraftVersions, verb: Verb, at: number): DraftVersions {
  return { ...entry, active: verb, trail: [...entry.trail, { from: entry.active, at }] };
}

/** One step back: the version shown before this one. */
export function stepBack(entry: DraftVersions): DraftVersions {
  const last = entry.trail[entry.trail.length - 1];
  return { ...entry, active: last?.from ?? null, trail: entry.trail.slice(0, -1) };
}
