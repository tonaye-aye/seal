// Turns a remembered rule, or the reason a finding came back, into its words.
// The sentences are in copy.ts. This only picks one and fills in the figures,
// all of which come from bank rows.

import { copy } from "../copy.ts";
import { formatAUD } from "../lib/money.ts";
import type { CameBack, Rule } from "../lib/rules.ts";
import { shortDate } from "./format.ts";

/** What would bring this finding back. */
export function ruleUntil(rule: Rule): string {
  const until = copy.rules.until;
  const recurring = rule.baseline?.recurring ?? [];
  if (rule.reason === "wrong") return until.wrong;
  if (rule.reason === "wanted" && recurring.length) {
    const amounts = new Set(recurring.map((r) => r.cents));
    return amounts.size === 1 ? until.wantedAmount(formatAUD(recurring[0].cents)) : until.wantedSeveral;
  }
  if (rule.reason === "sorted" && rule.kind === "price_increase" && recurring.length) {
    return until.sortedPrice(formatAUD(Math.max(...recurring.map((r) => r.cents))));
  }
  if (rule.reason === "sorted" && rule.kind === "duplicate_subscription" && recurring.length >= 2) return until.sortedBoth;
  return until.chargesAgain;
}

/** The full reason a finding is showing again. */
export function cameBackLine(back: CameBack): string {
  const line = copy.rules.back;
  switch (back.why) {
    case "new_problem":
      return line.newProblem(copy.shared.kind[back.kind]);
    case "amount_changed":
      return line.amountChanged(formatAUD(back.from), formatAUD(back.to), shortDate(back.date));
    case "charged_again":
      return line.chargedAgain(formatAUD(back.cents), shortDate(back.date));
    case "bank_unread":
      return line.bankUnread;
    case "no_baseline":
      return line.noBaseline;
  }
}
