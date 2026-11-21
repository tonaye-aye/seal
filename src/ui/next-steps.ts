// What Maya should expect once she has sent an approved draft, worked out by
// plain code from the figures the agent checked. It is guidance, not a check:
// the app doesn't watch for the reply, the refund or the new price. When a
// figure it needs is missing, it says nothing rather than guess.

import type { Finding } from "../agent/pipeline.ts";
import type { Figure } from "../agent/verify.ts";
import type { ScanState } from "../lib/scan-store.ts";
import { formatAUD } from "../lib/money.ts";
import { copy } from "../copy.ts";
import { shortDate } from "./format.ts";

/** Lower case, letters and digits only, for matching business names. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The finding a recurring charge belongs to, if any, and the business name as the finding spells it. */
export function linkCharge(key: string, findings: Finding[]): { finding?: Finding; name?: string } {
  const finding = findings.find((f) => f.keys.includes(key));
  if (!finding) return {};
  const name = finding.merchant.split(" + ").find((n) => norm(n).startsWith(norm(key)));
  return { finding, name };
}

const cents = (f: Finding, id: string): number | undefined => {
  const v = f.figures.find((x: Figure) => x.id === id)?.value;
  return typeof v === "number" ? v : undefined;
};
const date = (f: Finding, id: string): string | undefined => {
  const v = f.figures.find((x: Figure) => x.id === id)?.value;
  return typeof v === "string" ? v : undefined;
};

/** The finding's next expected charges from the bank history, soonest first, with the business named as the finding spells it. */
function nextCharges(finding: Finding, scan: Pick<ScanState, "result">) {
  return (scan.result?.upcoming ?? [])
    .filter((u) => finding.keys.includes(u.key))
    .map((u) => ({ ...u, name: linkCharge(u.key, [finding]).name ?? u.name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** One line: what should happen once the draft is sent and the business agrees. */
export function expectation(finding: Finding, scan: Pick<ScanState, "result">): string | undefined {
  const say = copy.next.expect;
  switch (finding.kind) {
    case "price_increase": {
      const back = cents(finding, "overcharged_so_far");
      const price = cents(finding, "previous_price");
      const next = nextCharges(finding, scan)[0];
      if (back === undefined || price === undefined) return undefined;
      return next ? say.priceRestored(formatAUD(back), formatAUD(price), shortDate(next.date)) : say.moneyBack(formatAUD(back));
    }
    case "duplicate_subscription": {
      const amount = cents(finding, "duplicate_amount");
      const renews = date(finding, "platform_renews");
      const platform = renews && nextCharges(finding, scan).find((u) => u.date === renews);
      if (amount === undefined || !renews || !platform) return undefined;
      return say.noChargeFrom(formatAUD(amount), platform.name, shortDate(renews));
    }
    case "duplicate_payment": {
      const overpaid = cents(finding, "overpaid");
      return overpaid === undefined ? undefined : say.refund(formatAUD(overpaid));
    }
    case "renewal_trap": {
      const fee = cents(finding, "renewal_amount");
      const renews = date(finding, "renews_on");
      return fee === undefined || !renews ? undefined : say.noCharge(formatAUD(fee), shortDate(renews));
    }
    case "trial_converted": {
      const next = date(finding, "next_charge");
      const amount = nextCharges(finding, scan).find((u) => u.date === next)?.amountCents;
      return !next || amount === undefined ? undefined : say.noCharge(formatAUD(amount), shortDate(next));
    }
    case "renewal_price_creep": {
      const until = date(finding, "quote_valid_until");
      return until ? say.replyBefore(shortDate(until)) : undefined;
    }
    case "billing_error": {
      const over = cents(finding, "overcharge_estimate");
      return over === undefined ? undefined : say.credit(formatAUD(over));
    }
    case "warranty_claim": {
      const repair = cents(finding, "repair_booked");
      const visit = date(finding, "repair_visit");
      return repair === undefined || !visit ? undefined : say.warranty(formatAUD(repair), shortDate(visit));
    }
  }
}
