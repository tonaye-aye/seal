// Stage 5 of the scan: plain code works out every number a finding will show.
// It reads only bank rows and *grounded* extracted facts (values confirmed in
// their source), computes differences, totals and deadlines, and writes each
// result down with where it came from and how it was worked out.
//
// The models never do sums. The judge reads these figures as given facts, and
// drafts may only use numbers that appear here (the claim check enforces it).

import { now } from "../lib/clock.ts";
import { addDays, addMonths, daysBetween, formatDate, localDate } from "../lib/dates.ts";
import { formatAUD } from "../lib/money.ts";
import type { Corpus } from "./corpus.ts";
import type { Candidate, Signal } from "./detectors.ts";
import type { ExtractionResult, SourceFacts } from "./extract.ts";
import { amountIn, numberIn } from "./grounding.ts";
import { distinctiveTokens, merchantKey } from "./merchants.ts";
import type { CaseEvidence } from "./retrieval.ts";
import type { Series } from "./series.ts";

// ---------- Shapes ----------

export type Figure = {
  /** Stable name, e.g. "overcharged_so_far", so the UI and eval can find it. */
  id: string;
  label: string;
  value: number | string | boolean;
  unit: "cents" | "date" | "days" | "kwh" | "count" | "percent" | "cents_per_kwh" | "text" | "yes_no";
  /** Evidence keys it was worked out from, e.g. ["txn:JE-00051", "doc:doc_001"]. */
  sources: string[];
  /** The working, in words, e.g. "($99.00 - $79.00) x 2 charges". */
  how?: string;
};

export type VerifiedCase = {
  candidateId: string;
  names: string[];
  figures: Figure[];
  /** Plain sentences of checked facts, written for the judge. */
  notes: string[];
  /** Things that didn't add up, shown as "check this" rather than hidden. */
  warnings: string[];
  /**
   * Hard facts, checked by code, that point one way. If the judge's verdict
   * goes against them, the case is shown as "Not sure" instead of being
   * decided by the model alone.
   */
  pointsToProblem: string[];
  pointsToFine: string[];
  /** The headline numbers (all optional), mirroring Finding.amounts. */
  atStakeCents?: number;
  recoverableCents?: number;
  perMonthCents?: number;
  deadline?: { date: string; label: string };
};

// ---------- Fact lookup ----------

type Hit<T> = T & { source: string; facts: SourceFacts };

/** The grounded facts of one case, with helpers to find them by label. */
class CaseFacts {
  readonly sources: SourceFacts[];
  private readonly ownKeys: Set<string>;
  private readonly corpus: Corpus;

  constructor(evidence: CaseEvidence, extraction: ExtractionResult, candidate: Candidate, corpus: Corpus) {
    this.corpus = corpus;
    this.sources = evidence.items
      .map((i) => extraction.facts.get(`${i.kind}:${i.id}`))
      .filter((f): f is SourceFacts => !!f);
    this.ownKeys = new Set(candidate.keys);
  }

  /** The business a source comes from, or null for the household's own mail. */
  businessOf(f: SourceFacts): string | null {
    if (f.kind === "email") {
      const m = this.corpus.emails.find((e) => e.id === f.id);
      if (!m || m.labels.includes("SENT") || /whitlock/i.test(m.from.name)) return null;
      return distinctiveTokens(m.from.name)[0] ?? null;
    }
    const d = this.corpus.documents.find((x) => x.id === f.id);
    return d ? merchantKey(d.filename.replace(/[-_.]/g, " ")) : null;
  }

  /** Is this source from another provider (e.g. a competitor's quote)? */
  isOther(f: SourceFacts): boolean {
    const business = this.businessOf(f);
    return business !== null && !this.ownKeys.has(business) && f.docType !== "meter photo";
  }

  amounts(label: RegExp, from = this.sources): Hit<{ cents: number; label: string }>[] {
    return from.flatMap((f) =>
      f.amounts.filter((a) => a.grounded && label.test(a.label)).map((a) => ({ ...a, source: f.key, facts: f })),
    );
  }

  quantities(unit: RegExp, label: RegExp, from = this.sources): Hit<{ value: number; unit: string; label: string }>[] {
    return from.flatMap((f) =>
      f.quantities
        .filter((q) => q.grounded && unit.test(q.unit) && label.test(q.label))
        .map((q) => ({ ...q, source: f.key, facts: f })),
    );
  }

  dates(label: RegExp, from = this.sources): Hit<{ date: string; label: string }>[] {
    return from.flatMap((f) =>
      f.dates.filter((d) => d.grounded && label.test(d.label)).map((d) => ({ ...d, source: f.key, facts: f })),
    );
  }

  /** The full text of a source, for code-side checks like "does the quote mention $650?". */
  text(key: string): string {
    const [kind, id] = key.split(":");
    if (kind === "email") {
      const m = this.corpus.emails.find((e) => e.id === id);
      return m ? `${m.subject}\n${m.body}` : "";
    }
    return this.corpus.documents.find((d) => d.id === id)?.text ?? "";
  }

  /** When a source was sent or saved ("YYYY-MM-DD"). */
  dateOf(key: string): string | undefined {
    const [kind, id] = key.split(":");
    if (kind === "email") return this.corpus.emails.find((e) => e.id === id)?.date.slice(0, 10);
    return this.corpus.documents.find((d) => d.id === id)?.modifiedAt.slice(0, 10);
  }
}

/** The most common value in a list (several sources usually agree). */
function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const money = formatAUD;
const day = formatDate;
const txnKeys = (series: Series | undefined) => series?.charges.map((t) => `txn:${t.id}`) ?? [];

/** The business's own spelling ("StreamBox"), not one rebuilt from bank text. */
const nameOf = (candidate: Candidate, s: Series) => candidate.names[candidate.keys.indexOf(s.key)] ?? s.name;

/** "2026-06" to "June 2026". */
const monthName = (yearMonth: string) =>
  new Date(`${yearMonth}-01T00:00:00Z`).toLocaleString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });

// ---------- Builder ----------

class Builder {
  readonly out: VerifiedCase;
  constructor(candidate: Candidate) {
    this.out = {
      candidateId: candidate.id,
      names: candidate.names,
      figures: [],
      notes: [],
      warnings: [],
      pointsToProblem: [],
      pointsToFine: [],
    };
  }
  figure(f: Figure) {
    this.out.figures.push(f);
    return f.value;
  }
  note(text: string) {
    this.out.notes.push(text);
  }
  warn(text: string) {
    this.out.warnings.push(text);
  }
  /** Keep the earliest upcoming deadline as the case's headline deadline. */
  deadline(date: string, label: string) {
    if (!this.out.deadline || date < this.out.deadline.date) this.out.deadline = { date, label };
  }
}

// ---------- Rules ----------

/** A recurring charge went up: was it allowed, and what does it cost? */
function priceChange(b: Builder, signal: Signal, facts: CaseFacts, series: Series | undefined, today: string) {
  const f = signal.facts as Record<string, number | string>;
  const before = f.previousCents as number;
  const after = f.newCents as number;
  const changedOn = f.changedOn as string;
  const increase = after - before;
  const atNew = f.chargesAtNewPrice as number;
  const sources = txnKeys(series);

  b.figure({ id: "previous_price", label: "Price before", value: before, unit: "cents", sources });
  b.figure({ id: "new_price", label: "Price now", value: after, unit: "cents", sources });
  b.figure({ id: "price_changed_on", label: "First charge at the new price", value: changedOn, unit: "date", sources });
  const extra = b.figure({
    id: "overcharged_so_far",
    label: "Extra paid so far",
    value: increase * atNew,
    unit: "cents",
    sources,
    how: `(${money(after)} - ${money(before)}) x ${atNew} charge${atNew === 1 ? "" : "s"}`,
  }) as number;
  b.figure({ id: "increase_percent", label: "Increase", value: f.increasePercent as number, unit: "percent", sources });
  b.out.perMonthCents = increase;
  b.note(`The bank shows ${money(before)} until ${day(changedOn)}, then ${money(after)} (${atNew} charge${atNew === 1 ? "" : "s"} so far): ${money(extra)} more than before, ${money(increase)} a month ongoing.`);

  // A fixed-price term in the agreement: is the rise inside it?
  const term = facts.quantities(/month/i, /promo|term|first|saver|fixed|introductory|price/i).filter((q) => q.value >= 6);
  const start = facts.dates(/agreement|connect|start|commence|sign/i).filter((d) => d.date < changedOn);
  const promised = facts.amounts(/promo|first|saver|fixed|introductory|bonus/i).filter((a) => a.cents === before);
  const months = mostCommon(term.map((q) => q.value));
  const startDate = start.map((d) => d.date).sort()[0];
  if (months && startDate && promised.length) {
    const termEnd = addDays(addMonths(startDate, months), -1);
    const termSources = [...new Set([...term, ...start, ...promised].map((h) => h.source))];
    b.figure({ id: "term_months", label: "Promised price term", value: months, unit: "count", sources: termSources });
    b.figure({ id: "term_start", label: "Term started", value: startDate, unit: "date", sources: termSources });
    b.figure({ id: "term_end", label: "Term ends", value: termEnd, unit: "date", sources: termSources, how: `${day(startDate)} + ${months} months` });
    if (changedOn <= termEnd) {
      const month = Math.round(daysBetween(startDate, changedOn) / 30.44) + 1;
      // Charges still due inside the term, at the new price.
      let remaining = 0;
      for (let d = series?.nextExpected ?? addMonths(changedOn, atNew); d <= termEnd; d = addMonths(d, 1)) remaining++;
      const atStake = extra + remaining * increase;
      b.figure({ id: "charges_left_in_term", label: "Charges left in the term", value: remaining, unit: "count", sources });
      b.figure({
        id: "at_stake",
        label: "At stake over the term",
        value: atStake,
        unit: "cents",
        sources: [...sources, ...termSources],
        how: `${money(extra)} so far + ${remaining} x ${money(increase)}`,
      });
      b.out.atStakeCents = atStake;
      b.out.recoverableCents = extra;
      b.note(`The agreement promised ${money(before)} a month for ${months} months from ${day(startDate)} (until ${day(termEnd)}). The new price started in month ${month} of that term, with ${remaining} more charges due before it ends. So the rise came ${months - month + 1} months before the promised price was due to end.`);
      b.out.pointsToProblem.push(`The price rose in month ${month} of a ${months}-month fixed-price term.`);
    } else {
      b.note(`A ${months}-month price term from ${day(startDate)} ended on ${day(termEnd)}, before the price changed.`);
    }
  }

  // An announced change: does the new price match what was announced?
  const announced = facts.quantities(/%|percent/i, /cpi|increase|change|index|rise/i);
  for (const a of announced) {
    const expected = Math.round(before * (1 + a.value / 100));
    const matches = expected === after;
    b.figure({
      id: "matches_announced_change",
      label: `Matches the announced ${a.value}% change`,
      value: matches,
      unit: "yes_no",
      sources: [a.source, ...sources],
      how: `${money(before)} x ${1 + a.value / 100} = ${money(expected)}`,
    });
    const sent = facts.dateOf(a.source);
    if (matches) b.out.pointsToFine.push(`The new price is exactly the announced ${a.value}% change.`);
    b.note(
      matches
        ? `${sent ? `On ${day(sent)} the business announced` : "The business announced"} a ${a.value}% change; ${money(before)} plus ${a.value}% is exactly ${money(after)}.`
        : `An announced ${a.value}% change would give ${money(expected)}, not the ${money(after)} charged.`,
    );
  }
  const caps = facts.quantities(/%|percent/i, /cap|max|limit/i);
  for (const c of caps) {
    const within = (f.increasePercent as number) <= c.value;
    b.note(`The plan terms cap price changes at ${c.value}%; this ${f.increasePercent}% rise is ${within ? "within" : "over"} the cap.`);
  }

  if (series) b.deadline(series.nextExpected, `Next ${series.name} charge`);
  void today;
}

/** Two recurring charges for the same thing, one through a platform. */
function duplicateCharges(b: Builder, signal: Signal, facts: CaseFacts, candidate: Candidate, corpus: Corpus, today: string) {
  const f = signal.facts as Record<string, number | string | boolean>;
  const amount = f.amountCents as number;
  const [a, b2] = candidate.series.filter((s) => s.latestCents === amount);
  if (!a || !b2) return;
  const platform = isOpaque(a) ? a : isOpaque(b2) ? b2 : undefined;
  const direct = platform === a ? b2 : a;
  const platformName = platform ? nameOf(candidate, platform) : "";
  const directName = nameOf(candidate, direct);

  b.figure({ id: "duplicate_amount", label: "Charged twice each month", value: amount, unit: "cents", sources: [...txnKeys(a), ...txnKeys(b2)] });
  b.out.perMonthCents = amount;
  const inStatements = Math.min(a.charges.length, b2.charges.length);
  b.figure({ id: "duplicates_in_statements", label: "Months both appear in the statements", value: inStatements, unit: "count", sources: [...txnKeys(a), ...txnKeys(b2)] });

  if (platform) {
    // Receipts from the platform reveal what it's for and how long it's run.
    const receipts = facts.sources.filter(
      (s) => s.kind === "email" && facts.businessOf(s) === platform.key && s.amounts.some((x) => x.grounded && x.cents === amount),
    );
    const named = receipts.filter((r) => facts.text(r.key).toLowerCase().includes(directName.split(" ")[0].toLowerCase()));
    if (named.length) {
      b.out.pointsToProblem.push(`${platformName} receipts show the platform charge is for ${directName}, which is also paid directly.`);
      b.note(`${named.length} receipt email${named.length === 1 ? "" : "s"} from ${platformName} show the "${platform.description}" card charge is for ${directName}, the same service already paid by ${direct.accountId === platform.accountId ? "the same account" : "a different account"} directly.`);
    }
    const months = new Set([
      ...platform.charges.map((t) => t.date.slice(0, 7)),
      ...named.map((r) => facts.dateOf(r.key)!.slice(0, 7)),
    ]);
    const since = [...months].sort()[0];
    const total = months.size * amount;
    b.figure({
      id: "duplicate_charges_count",
      label: "Platform charges for it, from receipts and statements",
      value: months.size,
      unit: "count",
      sources: [...txnKeys(platform), ...named.map((r) => r.key)],
    });
    b.figure({
      id: "duplicated_total",
      label: `Paid twice since ${monthName(since)}`,
      value: total,
      unit: "cents",
      sources: [...txnKeys(platform), ...named.map((r) => r.key)],
      how: `${months.size} x ${money(amount)}`,
    });
    b.out.atStakeCents = total;
    b.out.recoverableCents = total;
    const cancelBy = addDays(platform.nextExpected, -1);
    b.figure({ id: "platform_renews", label: `${platformName} renews`, value: platform.nextExpected, unit: "date", sources: txnKeys(platform) });
    b.figure({ id: "cancel_by", label: "Cancel by", value: cancelBy, unit: "date", sources: txnKeys(platform), how: `the day before ${day(platform.nextExpected)}` });
    b.figure({ id: "direct_renews", label: `${directName} renews`, value: direct.nextExpected, unit: "date", sources: txnKeys(direct) });
    b.note(`Both charges are ${money(amount)} a month. Through ${platformName}: ${months.size} charges since ${monthName(since)} (${money(total)}). It next renews on ${day(platform.nextExpected)}; ${directName} direct next charges on ${day(direct.nextExpected)}.`);
    if (cancelBy >= today) b.deadline(cancelBy, `Cancel the ${platformName} one before it renews`);
  }
  void corpus;
}

function isOpaque(s: Series): boolean {
  return /apple\.com|itunes|google|paypal|amazon/i.test(s.description);
}

/** The same one-off payment made twice. */
function duplicatePayment(b: Builder, signal: Signal, facts: CaseFacts, corpus: Corpus) {
  const f = signal.facts as Record<string, number | string | boolean | string[]>;
  const amount = f.amountCents as number;
  const txns = signal.evidence.filter((e) => e.kind === "txn").map((e) => `txn:${e.id}`);
  // "card" or "bank transfer", from the type of account each payment left.
  const accountName = (description: string) => {
    const accountId = corpus.transactions.find((t) => t.description === description)?.accountId;
    const type = corpus.accounts.find((a) => a.id === accountId)?.type;
    return type === "credit_card" ? "card" : "bank transfer";
  };
  b.figure({ id: "payment_amount", label: "Each payment", value: amount, unit: "cents", sources: txns });
  b.figure({ id: "first_payment", label: "First payment", value: f.firstDate as string, unit: "date", sources: txns });
  b.figure({ id: "second_payment", label: "Second payment", value: f.secondDate as string, unit: "date", sources: txns });

  if (f.differentReferences) {
    const refs = [...(f.referencesA as string[]), ...(f.referencesB as string[])];
    b.figure({ id: "different_references", label: "Payments carry different references", value: true, unit: "yes_no", sources: txns });
    b.out.pointsToFine.push("The two payments carry different references.");
    b.note(`The two ${money(amount)} payments carry different references (${refs.join(" and ")}), which usually means two separate bills.`);
    // Separate notices asking for this amount support that.
    const notices = facts.sources.filter(
      (s) => s.kind === "email" && s.amounts.some((x) => x.grounded && x.cents === amount && /cost|due|fee|price|per/i.test(x.label)),
    );
    if (notices.length >= 2) {
      const subjects = notices.map((n) => corpus.emails.find((e) => e.id === n.id)?.subject).filter(Boolean);
      b.note(`There are ${notices.length} separate requests for ${money(amount)}: ${subjects.map((s) => `"${s}"`).join(" and ")}.`);
    }
    return;
  }

  // One bill paid twice: find the invoice and the receipts.
  const invoices = facts.amounts(/total|invoice|amount due/i).filter((a) => a.cents === amount && a.facts.references.some((r) => r.grounded));
  const invoiceRef = mostCommon(invoices.flatMap((i) => i.facts.references.filter((r) => r.grounded).map((r) => r.value)));
  const receipts = facts.sources.filter(
    (s) => s.kind === "email" && facts.businessOf(s) !== null && !facts.isOther(s) && s.amounts.some((x) => x.grounded && x.cents === amount && /payment|paid|receipt|card|transfer/i.test(x.label)),
  );
  const receiptRefs = receipts.flatMap((r) => references(facts.text(r.key)).filter((x) => x !== invoiceRef));
  b.figure({ id: "total_paid", label: "Total paid", value: amount * 2, unit: "cents", sources: txns, how: `2 x ${money(amount)}` });
  b.figure({ id: "overpaid", label: "Paid twice", value: amount, unit: "cents", sources: [...txns, ...invoices.map((i) => i.source)] });
  if (invoiceRef) b.figure({ id: "invoice_reference", label: "Invoice", value: invoiceRef, unit: "text", sources: invoices.map((i) => i.source) });
  if (receiptRefs.length) b.figure({ id: "receipt_references", label: "Receipts", value: receiptRefs.join(", "), unit: "text", sources: receipts.map((r) => r.key) });
  b.out.recoverableCents = amount;
  b.out.atStakeCents = amount;
  if (invoiceRef) b.out.pointsToProblem.push(`Invoice ${invoiceRef} was paid twice.`);
  b.note(
    `${invoiceRef ? `Invoice ${invoiceRef} totals ${money(amount)}. ` : ""}It was paid twice: by ${accountName(f.firstDescription as string)} on ${day(f.firstDate as string)} and by ${accountName(f.secondDescription as string)} on ${day(f.secondDate as string)}, ${f.daysApart} days apart.${receipts.length >= 2 ? ` The business sent ${receipts.length} payment receipts${receiptRefs.length ? ` (${receiptRefs.join(", ")})` : ""}.` : ""}`,
  );
}

/** Reference codes like "R-77311" in free text. */
function references(text: string): string[] {
  return [...new Set(text.match(/\b[A-Z]{1,4}-\d{3,}\b/g) ?? [])];
}

/** A renewal or annual fee coming, possibly with a notice period. */
function renewal(b: Builder, facts: CaseFacts, candidate: Candidate, today: string) {
  const own = facts.sources.filter((s) => !facts.isOther(s));
  const renewals = facts
    .dates(/renew|charged on|anniversary|annual fee|fee date|start date|renewal period start/i, own)
    .filter((d) => d.date > today);
  const renewsOn = mostCommon(renewals.map((d) => d.date).sort());
  if (!renewsOn) return;
  const sources = [...new Set(renewals.filter((d) => d.date === renewsOn).map((d) => d.source))];
  b.figure({ id: "renews_on", label: "Renews", value: renewsOn, unit: "date", sources });
  const daysLeft = daysBetween(today, renewsOn);

  // A fee due at renewal (annual fee or new premium).
  const fees = facts.amounts(/annual|renewal|premium|fee/i, own).filter((a) => !/last|previous|monthly/i.test(a.label));
  const fee = mostCommon(fees.map((a) => a.cents));
  if (fee) {
    b.figure({ id: "renewal_amount", label: "Due at renewal", value: fee, unit: "cents", sources: fees.filter((a) => a.cents === fee).map((a) => a.source) });
    b.out.atStakeCents = Math.max(b.out.atStakeCents ?? 0, fee);
  }
  b.note(`${candidate.names.join(" / ")} renews on ${day(renewsOn)} (${daysLeft} days from today)${fee ? `, charging ${money(fee)}` : ""}.`);

  // A notice period: when was the last day to cancel?
  const notice = facts.quantities(/day/i, /notice period|cancel|notice required|avoid/i, own).filter((q) => q.value >= 7);
  const noticeDays = mostCommon(notice.map((q) => q.value));
  if (noticeDays) {
    const lastDay = addDays(renewsOn, -noticeDays);
    const passed = lastDay < today;
    b.figure({
      id: "notice_deadline",
      label: "Last day to give notice",
      value: lastDay,
      unit: "date",
      sources: [...new Set([...notice.map((q) => q.source), ...sources])],
      how: `${noticeDays} days before ${day(renewsOn)}`,
    });
    b.figure({ id: "notice_passed", label: "Notice deadline passed", value: passed, unit: "yes_no", sources: notice.map((q) => q.source) });
    if (passed && fee) b.out.pointsToProblem.push(`The notice deadline has passed and a fee is due on renewal.`);
    b.note(
      passed
        ? `The terms need ${noticeDays} days' notice, so the last day to cancel without the fee was ${day(lastDay)}. That was ${daysBetween(lastDay, today)} days ago.`
        : `The terms need ${noticeDays} days' notice: cancel by ${day(lastDay)} to avoid the fee.`,
    );
    if (!passed) b.deadline(lastDay, "Last day to give notice");
  }
  b.deadline(renewsOn, fee ? `${money(fee)} charged` : "Renews");

  // Last time it was used, if anything says so.
  const lastUse = facts.dates(/last (visit|session|use|read|login)/i).map((d) => d.date).sort().pop();
  if (lastUse) {
    b.figure({ id: "last_used", label: "Last used", value: lastUse, unit: "date", sources: facts.dates(/last (visit|session|use|read|login)/i).map((d) => d.source) });
    b.note(`Last used on ${day(lastUse)}, ${daysBetween(lastUse, today)} days ago.`);
  }
  // A monthly charge that also keeps going.
  for (const s of candidate.series.filter((x) => x.cadence === "monthly")) {
    b.out.perMonthCents = s.latestCents;
    b.note(`${nameOf(candidate, s)} also charges ${money(s.latestCents)} a month (next on ${day(s.nextExpected)}).`);
  }

  // A renewal price rise against last year.
  const lastYear = mostCommon(facts.amounts(/last year|previous|current|this year/i, own).map((a) => a.cents));
  if (fee && lastYear && lastYear < fee) {
    const rise = fee - lastYear;
    const pct = Math.round((rise * 1000) / lastYear) / 10;
    b.figure({ id: "renewal_increase", label: "More than last year", value: rise, unit: "cents", sources, how: `${money(fee)} - ${money(lastYear)}` });
    b.figure({ id: "renewal_increase_percent", label: "Increase", value: pct, unit: "percent", sources });
    b.note(`That is ${money(rise)} (${pct}%) more than last year's ${money(lastYear)}.`);
  }

  // A cheaper quote from another provider: how much it saves and whether it's like for like.
  const others = facts.sources.filter((s) => facts.isOther(s));
  const quotes = facts.amounts(/premium|annual|quote|price|year/i, others).filter((a) => !/excess|value/i.test(a.label));
  const quote = mostCommon(quotes.map((a) => a.cents));
  if (fee && quote && quote < fee) {
    const saving = fee - quote;
    const quoteSources = [...new Set(quotes.filter((q) => q.cents === quote).map((q) => q.source))];
    b.figure({ id: "competitor_quote", label: "Other provider's quote", value: quote, unit: "cents", sources: quoteSources });
    b.figure({ id: "saving", label: "Saving if matched", value: saving, unit: "cents", sources: [...sources, ...quoteSources], how: `${money(fee)} - ${money(quote)}` });
    b.out.atStakeCents = saving;
    b.out.recoverableCents = saving;
    const valid = facts.dates(/valid/i, others).map((d) => d.date).sort()[0];
    if (valid) {
      b.figure({ id: "quote_valid_until", label: "Quote valid until", value: valid, unit: "date", sources: quoteSources });
      if (valid >= today) b.deadline(valid, "Quote expires");
    }
    // Like for like: the quote's excess and agreed value also appear in the renewal.
    const terms = [
      ...facts.amounts(/excess|agreed value|sum insured/i, others).map((a) => ({ label: a.label, cents: a.cents })),
      ...facts.quantities(/\$|aud/i, /agreed value|sum insured/i, others).map((q) => ({ label: q.label, cents: Math.round(q.value * 100) })),
    ];
    const ownText = own.map((s) => facts.text(s.key)).join("\n");
    const unique = [...new Map(terms.map((t) => [t.cents, t])).values()];
    const same = unique.filter((t) => amountIn(t.cents, ownText) || numberIn(t.cents / 100, ownText));
    const comparable = unique.length > 0 && same.length === unique.length;
    b.figure({ id: "like_for_like", label: "Quote matches the policy's cover", value: comparable, unit: "yes_no", sources: [...quoteSources, ...sources] });
    b.note(
      `Another provider quoted ${money(quote)}${valid ? `, valid until ${day(valid)}` : ""}: ${money(saving)} less than the renewal. ` +
        (comparable
          ? `Its ${unique.map((t) => `${t.label.toLowerCase()} (${money(t.cents)})`).join(" and ")} match the current policy.`
          : unique.length
            ? `Not all of its terms appear in the current policy (${unique.filter((t) => !same.includes(t)).map((t) => t.label).join(", ")}): check before relying on it.`
            : "Its cover details couldn't be compared."),
    );
    if (!comparable) b.warn("The quote may not be like for like.");
    else b.out.pointsToProblem.push("A cheaper like-for-like quote exists for the renewal.");
  }
}

/** A free trial that turned into a paid subscription. */
function trial(b: Builder, facts: CaseFacts, candidate: Candidate, today: string) {
  const s = candidate.series.find((x) => x.cadence === "monthly");
  if (!s) return;
  const total = s.charges.reduce((sum, t) => sum - t.amountCents, 0);
  const sources = txnKeys(s);
  b.figure({ id: "converted_on", label: "First paid charge", value: s.firstDate, unit: "date", sources });
  b.figure({ id: "charges_since_trial", label: "Charges since the trial", value: s.charges.length, unit: "count", sources });
  b.figure({ id: "paid_since_trial", label: "Paid since the trial", value: total, unit: "cents", sources, how: `${s.charges.length} x ${money(s.latestCents)}` });
  b.out.perMonthCents = s.latestCents;
  b.out.atStakeCents = total;
  b.out.recoverableCents = s.latestCents; // a refund of the latest month is a reasonable ask
  b.figure({ id: "next_charge", label: "Next charge", value: s.nextExpected, unit: "date", sources });
  b.deadline(s.nextExpected, `${money(s.latestCents)} charged`);
  const started = facts.dates(/trial|start|sent/i).map((d) => d.date).filter((d) => d < s.firstDate).sort()[0];
  b.note(`${started ? `A free trial started on ${day(started)}; ` : ""}paid charges of ${money(s.latestCents)} began on ${day(s.firstDate)}: ${s.charges.length} so far (${money(total)}). The next is on ${day(s.nextExpected)}.`);
  const lastUse = facts.dates(/last (session|visit|use|read|login)/i).map((d) => d.date).sort().pop();
  if (lastUse) {
    b.figure({ id: "last_used", label: "Last used", value: lastUse, unit: "date", sources: facts.dates(/last (session|visit|use|read|login)/i).map((d) => d.source) });
    const unusedCharges = s.charges.filter((t) => t.date > lastUse).length;
    if (unusedCharges > 0) b.out.pointsToProblem.push(`${unusedCharges} paid charges came after it was last used.`);
    b.note(`It was last used on ${day(lastUse)} (${daysBetween(lastUse, today)} days ago); ${unusedCharges} of the charges came after that.`);
  }
}

/** A bill on an estimated reading, checked against an actual reading. */
function estimatedBill(b: Builder, facts: CaseFacts, corpus: Corpus) {
  const kwh = /kwh/i;
  // The bill: the source with an estimated (or current) reading and a previous one.
  const bills = facts.sources.filter(
    (s) =>
      facts.quantities(kwh, /estimat|current.*reading/i, [s]).length > 0 &&
      facts.quantities(kwh, /previous.*reading/i, [s]).length > 0,
  );
  const bill = bills.sort((x, y) => (facts.dateOf(y.key) ?? "").localeCompare(facts.dateOf(x.key) ?? ""))[0];
  if (!bill) return;
  const estimate = facts.quantities(kwh, /estimat|current.*reading/i, [bill])[0].value;
  const previous = facts.quantities(kwh, /previous.*reading/i, [bill])[0].value;
  const billed = facts.quantities(kwh, /^usage$|usage$|consumption/i, [bill])[0]?.value ?? estimate - previous;
  const periodStart = facts.dates(/period start|from/i, [bill])[0]?.date;
  const periodEnd = facts.dates(/period end|current read|to$/i, [bill])[0]?.date ?? facts.dates(/end/i, [bill])[0]?.date;
  const usageCharge = facts.amounts(/usage/i, [bill])[0]?.cents;
  const total = facts.amounts(/total|amount due/i, [bill])[0]?.cents;
  const billSources = [bill.key];

  b.figure({ id: "estimated_reading", label: "Bill's estimated reading", value: estimate, unit: "kwh", sources: billSources });
  b.figure({ id: "previous_reading", label: "Previous actual reading", value: previous, unit: "kwh", sources: billSources });
  b.figure({ id: "billed_usage", label: "Usage billed", value: billed, unit: "kwh", sources: billSources });
  if (total) b.figure({ id: "bill_total", label: "Bill total", value: total, unit: "cents", sources: billSources });

  // Was it already paid?
  const paid = total ? corpus.transactions.find((t) => -t.amountCents === total) : undefined;
  if (paid) {
    b.figure({ id: "bill_paid_on", label: "Paid on", value: paid.date, unit: "date", sources: [`txn:${paid.id}`] });
  }

  // The actual reading from the photo, checked for sense.
  const photo = facts.sources.find((s) => s.reading?.value != null);
  if (!photo || !periodEnd || !periodStart) {
    b.note(`The bill uses an estimated reading of ${estimate.toLocaleString("en-AU")} kWh (${billed.toLocaleString("en-AU")} kWh billed).`);
    return;
  }
  let reading = photo.reading!.value!;
  const photoDate = facts.dateOf(photo.key)!;
  const plausible = (r: number) => r >= previous && r <= estimate * 1.2;
  if (!plausible(reading)) {
    // A common misread: the red tenths digit taken as a whole digit.
    if (plausible(reading / 10)) {
      b.warn(`The photo reading ${reading} looks like it includes the tenths digit; using ${reading / 10}.`);
      reading = reading / 10;
    } else {
      b.warn(`The photo reading ${reading} doesn't fit between the previous reading and the estimate. Check the photo.`);
      return;
    }
  }
  // Someone in the household also wrote the reading down?
  const confirmed = facts.sources.some((s) => s.kind === "email" && facts.businessOf(s) === null && numberIn(reading, facts.text(s.key)));

  const previousReadDate = addDays(periodStart, -1);
  const used = reading - previous;
  const daysToPhoto = daysBetween(previousReadDate, photoDate);
  const perDay = used / daysToPhoto;
  const daysAfterEnd = daysBetween(periodEnd, photoDate);
  const actualToEnd = Math.round(used - perDay * daysAfterEnd);
  const overKwh = billed - actualToEnd;
  const sources = [...billSources, photo.key];

  b.figure({ id: "actual_reading", label: "Actual reading (photo)", value: reading, unit: "kwh", sources: [photo.key] });
  b.figure({ id: "actual_reading_date", label: "Photo taken", value: photoDate, unit: "date", sources: [photo.key] });
  b.figure({ id: "actual_daily_use", label: "Actual use per day", value: Math.round(perDay * 10) / 10, unit: "kwh", sources, how: `${used} kWh over ${daysToPhoto} days` });
  b.figure({
    id: "actual_usage_in_period",
    label: "Actual usage in the bill period (approx.)",
    value: actualToEnd,
    unit: "kwh",
    sources,
    how: `${used} kWh to the photo, less ${daysAfterEnd} days at ${perDay.toFixed(1)} kWh/day`,
  });
  b.figure({ id: "overbilled_kwh", label: "Billed above actual (approx.)", value: overKwh, unit: "kwh", sources, how: `${billed} - ${actualToEnd}` });
  if (reading < estimate) b.out.pointsToProblem.push("An actual meter reading is lower than the bill's estimate.");
  b.note(`The bill estimated ${estimate.toLocaleString("en-AU")} kWh on ${day(periodEnd)}. A meter photo on ${day(photoDate)} reads ${reading.toLocaleString("en-AU")} kWh${confirmed ? " (the same number appears in the household's email)" : ""}, ${(estimate - reading).toLocaleString("en-AU")} kWh lower, ${daysAfterEnd} day${daysAfterEnd === 1 ? "" : "s"} later.`);
  b.note(`From the last actual reading (${previous.toLocaleString("en-AU")} kWh, ${day(previousReadDate)}) the household used about ${perDay.toFixed(1)} kWh a day, so roughly ${actualToEnd.toLocaleString("en-AU")} kWh in the bill period against ${billed.toLocaleString("en-AU")} kWh billed: about ${overKwh.toLocaleString("en-AU")} kWh too many.`);

  if (usageCharge && billed > 0) {
    const rate = usageCharge / billed; // cents per kWh, as charged (incl. GST)
    const over = Math.round(overKwh * rate);
    b.figure({ id: "rate_per_kwh", label: "Usage rate charged", value: Math.round(rate * 10) / 10, unit: "cents_per_kwh", sources: billSources, how: `${money(usageCharge)} / ${billed} kWh` });
    b.figure({ id: "overcharge_estimate", label: "Overcharged (approx.)", value: over, unit: "cents", sources, how: `${overKwh} kWh x $${(rate / 100).toFixed(3)}` });
    b.out.atStakeCents = over;
    b.out.recoverableCents = over;
    b.note(`At the $${(rate / 100).toFixed(3)} per kWh charged, that is about ${money(over)}${paid ? `, already paid on ${day(paid.date)}` : ""}.`);
  }
}

// ---------- Entry point ----------

export function verifyCase(
  candidate: Candidate,
  evidence: CaseEvidence,
  extraction: ExtractionResult,
  corpus: Corpus,
  today = localDate(now()),
): VerifiedCase {
  const b = new Builder(candidate);
  const facts = new CaseFacts(evidence, extraction, candidate, corpus);
  const kinds = new Set(candidate.signals.map((s) => s.kind));

  for (const s of candidate.signals.filter((x) => x.kind === "price_change")) {
    priceChange(b, s, facts, candidate.series.find((x) => s.keys.includes(x.key)), today);
  }
  const dup = candidate.signals.find((s) => s.kind === "duplicate_charges");
  if (dup) duplicateCharges(b, dup, facts, candidate, corpus, today);
  for (const s of candidate.signals.filter((x) => x.kind === "duplicate_payment")) duplicatePayment(b, s, facts, corpus);
  if (kinds.has("trial")) trial(b, facts, candidate, today);
  else if (kinds.has("renewal_notice") || kinds.has("deadline_event")) {
    if (!dup) renewal(b, facts, candidate, today);
  }
  if (kinds.has("estimated_bill")) estimatedBill(b, facts, corpus);

  // Calendar reminders that already passed.
  for (const s of candidate.signals.filter((x) => x.kind === "deadline_event" && x.facts.passed)) {
    b.note(`A calendar reminder "${s.facts.title}" was set for ${day(s.facts.date as string)} and has passed.`);
  }
  if (b.out.figures.length === 0) b.warn("No figures could be checked for this case.");
  return b.out;
}
