// What Seal remembers when Maya says "Not a leak" and tells it why.
//
// Plain code, with no model involved and nothing here reaches a prompt. After
// every check, each rule is tested again against that check's bank data. A rule
// is never changed or deleted by a check, so a bad sync can't lose what she said.
// When a match is uncertain, the finding is shown: a leak must never be hidden
// by accident.

import type { Corpus } from "../agent/corpus.ts";
import type { FindingKind } from "../agent/judge.ts";
import { merchantKey } from "../agent/merchants.ts";
import type { Finding } from "../agent/pipeline.ts";
import { findSeries, isInternalTransfer } from "../agent/series.ts";

/** The answers Maya can give, in the order of keys 1, 2 and 3. */
export const RULE_REASONS = ["wanted", "sorted", "wrong"] as const;
export type RuleReason = (typeof RULE_REASONS)[number];

/** A regular charge as it stood when Maya dismissed the finding. */
export type RuleCharge = { key: string; accountId: string; cents: number };

/** What the bank showed at the dismissal, so later checks can tell what is new. */
export type RuleBaseline = {
  recurring: RuleCharge[];
  /** Each business's newest charge date, and the charges on that day (a second one that day is still new). */
  seen: Record<string, { date: string; ids: string[] }>;
};

export type Rule = {
  findingId: string;
  /** Absent until Maya answers: the dismissal then works as it always has. */
  reason?: RuleReason;
  merchant: string;
  kind: FindingKind;
  keys: string[];
  /** Absent when the bank couldn't be read at the dismissal. */
  baseline?: RuleBaseline;
  /** Real time, only for listing rules newest first. Never used to decide anything. */
  at: number;
};

/** Why a finding Maya set aside is showing again. Every figure comes straight from a bank row. */
export type CameBack =
  | { why: "new_problem"; kind: FindingKind }
  | { why: "amount_changed"; from: number; to: number; date: string }
  | { why: "charged_again"; cents: number; date: string }
  | { why: "bank_unread" }
  | { why: "no_baseline" };

type Debit = { id: string; key: string; accountId: string; date: string; cents: number };

/** Did this check manage to read the bank? */
export function bankWasRead(corpus: Corpus): boolean {
  return !corpus.missing.includes("bank") && corpus.accounts.length > 0;
}

/** Money out to these businesses, oldest first. Refunds and transfers between own accounts don't count. */
function debitsFor(corpus: Corpus, keys: string[]): Debit[] {
  return corpus.transactions
    .filter((t) => t.amountCents < 0 && !isInternalTransfer(t, corpus.accounts) && keys.includes(merchantKey(t.description)))
    .map((t) => ({ id: t.id, key: merchantKey(t.description), accountId: t.accountId, date: t.date, cents: -t.amountCents }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function baselineFrom(keys: string[], corpus: Corpus): RuleBaseline | undefined {
  if (!bankWasRead(corpus)) return undefined;
  const recurring = findSeries(corpus.transactions, corpus.accounts)
    .filter((s) => keys.includes(s.key))
    .map((s) => ({ key: s.key, accountId: s.accountId, cents: s.latestCents }));
  const seen: RuleBaseline["seen"] = {};
  for (const d of debitsFor(corpus, keys)) {
    const last = seen[d.key];
    if (!last || d.date > last.date) seen[d.key] = { date: d.date, ids: [d.id] };
    else if (d.date === last.date) last.ids.push(d.id);
  }
  return { recurring, seen };
}

/** The record made at the moment of a dismissal. Maya's reason is added if she gives one. */
export function newRule(finding: Pick<Finding, "id" | "merchant" | "kind" | "keys">, corpus: Corpus | undefined, at: number): Rule {
  return {
    findingId: finding.id,
    merchant: finding.merchant,
    kind: finding.kind,
    keys: finding.keys,
    baseline: corpus ? baselineFrom(finding.keys, corpus) : undefined,
    at,
  };
}

function isNew(d: Debit, baseline: RuleBaseline): boolean {
  const seen = baseline.seen[d.key];
  return !seen || d.date > seen.date || (d.date === seen.date && !seen.ids.includes(d.id));
}

const charged = (d: Debit): CameBack => ({ why: "charged_again", cents: d.cents, date: d.date });

/** "We want this": any new charge that isn't the regular amount. Newest first, so the reason is current. */
function amountChange(recurring: RuleCharge[], fresh: Debit[]): CameBack | undefined {
  for (const d of [...fresh].reverse()) {
    const same = recurring.filter((r) => r.key === d.key);
    const expected = same.find((r) => r.accountId === d.accountId) ?? same[0];
    if (!expected) return charged(d);
    if (d.cents !== expected.cents) return { why: "amount_changed", from: expected.cents, to: d.cents, date: d.date };
  }
  return undefined;
}

/**
 * "Already sorted": is the problem still happening? A fixed price rise and a
 * cancelled double payment both leave a normal charge running, so those two
 * kinds need more than "it charged again".
 */
function stillHappening(kind: FindingKind, recurring: RuleCharge[], fresh: Debit[]): CameBack | undefined {
  const newest = fresh[fresh.length - 1];
  if (kind === "price_increase" && recurring.length) {
    const hit = [...fresh].reverse().find((d) => {
      const raised = recurring.filter((r) => r.key === d.key).map((r) => r.cents);
      return !raised.length || d.cents >= Math.max(...raised);
    });
    return hit ? charged(hit) : undefined;
  }
  if (kind === "duplicate_subscription" && recurring.length >= 2) {
    const all = recurring.every((r) => fresh.some((d) => d.key === r.key && d.accountId === r.accountId));
    return all ? charged(newest) : undefined;
  }
  return charged(newest);
}

/** Tests one rule against this check. Undefined: it holds, so the finding stays left alone. */
export function checkRule(rule: Rule, finding: Pick<Finding, "kind">, corpus: Corpus): CameBack | undefined {
  if (!rule.reason) return undefined;
  // The kind comes from a model and can vary. A different one is shown, never assumed to be the same case.
  if (finding.kind !== rule.kind) return { why: "new_problem", kind: finding.kind };
  if (rule.reason === "wrong") return undefined;

  const read = bankWasRead(corpus);
  // Answered while the bank was down: wait for it, then ask again rather than guess.
  if (!rule.baseline) return read ? { why: "no_baseline" } : undefined;
  if (!read) return { why: "bank_unread" };

  const { baseline } = rule;
  const fresh = debitsFor(corpus, rule.keys).filter((d) => isNew(d, baseline));
  if (!fresh.length) return undefined;
  // No regular charge to compare (a one-off, a bill, a warranty claim): the same test as "Already sorted".
  if (rule.reason === "wanted" && baseline.recurring.length) return amountChange(baseline.recurring, fresh);
  return stillHappening(rule.kind, baseline.recurring, fresh);
}

/** Every finding that should show again after this check, with the reason. */
export function returnedFindings(findings: Finding[], rules: Record<string, Rule>, corpus: Corpus | undefined): Record<string, CameBack> {
  const out: Record<string, CameBack> = {};
  if (!corpus) return out;
  for (const finding of findings) {
    const rule = rules[finding.id];
    const back = rule && checkRule(rule, finding, corpus);
    if (back) out[finding.id] = back;
  }
  return out;
}

/** The rules Maya gave a reason for, newest first (the Remembered tab). */
export function rememberedRules(rules: Record<string, Rule>): Rule[] {
  return Object.values(rules)
    .filter((r) => r.reason)
    .sort((a, b) => b.at - a.at);
}
