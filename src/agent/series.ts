// Finds recurring charges in the bank history: the same merchant charged at a
// steady rhythm (weekly, fortnightly, monthly). These are the subscriptions,
// bills and direct debits the rest of the agent reasons about.

import { addDays, daysBetween } from "../lib/dates.ts";
import type { Account, Transaction } from "../connectors/types.ts";
import { displayName, merchantKey } from "./merchants.ts";

export type Cadence = "weekly" | "fortnightly" | "monthly";

export type Series = {
  key: string; // merchant key, e.g. "skylink"
  name: string; // readable, e.g. "Skylink Internet"
  description: string; // the bank text of the latest charge
  accountId: string;
  cadence: Cadence;
  charges: Transaction[]; // oldest first
  /** Amount of the latest charge, in cents (positive). */
  latestCents: number;
  firstDate: string;
  lastDate: string;
  /** When the next charge is expected if nothing changes. */
  nextExpected: string;
};

const CADENCES: { cadence: Cadence; days: number; tolerance: number }[] = [
  { cadence: "weekly", days: 7, tolerance: 1 },
  { cadence: "fortnightly", days: 14, tolerance: 2 },
  { cadence: "monthly", days: 30.4, tolerance: 4 },
];

/** Payments between the household's own accounts are not spending. */
export function isInternalTransfer(t: Transaction, accounts: Account[]): boolean {
  const text = t.description.toLowerCase();
  if (/savings goal|payment received/.test(text)) return true;
  return accounts.some((a) => text.includes(a.name.toLowerCase()));
}

/** Same day of the month, a month later (clamped for short months). */
function nextMonthly(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

export function findSeries(transactions: Transaction[], accounts: Account[]): Series[] {
  // Group money going out by merchant and account.
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amountCents >= 0 || isInternalTransfer(t, accounts)) continue;
    const id = `${t.accountId}|${merchantKey(t.description)}`;
    groups.set(id, [...(groups.get(id) ?? []), t]);
  }

  const out: Series[] = [];
  for (const charges of groups.values()) {
    if (charges.length < 2) continue;
    charges.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = charges.slice(1).map((t, i) => daysBetween(charges[i].date, t.date));
    const match = CADENCES.find((c) => gaps.every((g) => Math.abs(g - c.days) <= c.tolerance));
    if (!match) continue; // shopping at the same place often is not a subscription

    const last = charges[charges.length - 1];
    out.push({
      key: merchantKey(last.description),
      name: displayName(last.description),
      description: last.description,
      accountId: last.accountId,
      cadence: match.cadence,
      charges,
      latestCents: -last.amountCents,
      firstDate: charges[0].date,
      lastDate: last.date,
      nextExpected: match.cadence === "monthly" ? nextMonthly(last.date) : addDays(last.date, Math.round(match.days)),
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
