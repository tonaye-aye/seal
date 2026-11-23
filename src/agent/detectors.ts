// Stage 2 of the scan: cheap, predictable rules (no model) that spot things
// worth a closer look. Each rule emits a "signal"; signals about the same
// business are grouped into one "candidate". A candidate is a question for
// the later stages ("is this a leak?"), never a verdict: a price rise the
// contract allows still shows up here, and the judge clears it with evidence.

import { now } from "../lib/clock.ts";
import { addDays, daysBetween, localDate } from "../lib/dates.ts";
import type { Transaction } from "../connectors/types.ts";
import type { Corpus } from "./corpus.ts";
import {
  categories,
  displayName,
  distinctiveTokens,
  isOpaqueDescriptor,
  merchantKey,
  references,
  serialNumbers,
} from "./merchants.ts";
import { findSeries, isInternalTransfer, type Series } from "./series.ts";

export type EvidenceRef = { kind: "txn" | "email" | "doc" | "event"; id: string };

export type SignalKind =
  | "price_change" // a recurring charge went up
  | "duplicate_charges" // two recurring charges for the same amount and rhythm
  | "duplicate_payment" // one-off payment of the same amount twice, close together
  | "opaque_descriptor" // the card text names a platform, not the seller
  | "trial" // a free trial started or is ending
  | "inactivity" // the service says it hasn't been used
  | "renewal_notice" // a renewal or annual fee is coming
  | "price_notice" // the business announced a price change
  | "competitor_quote" // a quote from another provider
  | "estimated_bill" // a bill based on an estimated reading
  | "warranty" // a business wrote about a product's warranty
  | "deadline_event"; // a calendar entry about cancelling or renewing

type Fact = string | number | boolean | string[];

export type Signal = {
  kind: SignalKind;
  /** One plain sentence for the trace, e.g. "Skylink went from $79.00 to $99.00". */
  summary: string;
  /** Merchant keys this signal is about (empty when only a category is known). */
  keys: string[];
  /** Kinds of business mentioned, used when no merchant name is present. */
  categories: string[];
  /** Exact figures worked out in code. Money in cents, dates as YYYY-MM-DD. */
  facts: Record<string, Fact>;
  evidence: EvidenceRef[];
};

export type Candidate = {
  id: string;
  /** Readable names of the businesses involved, e.g. ["Apple", "StreamBox"]. */
  names: string[];
  keys: string[];
  signals: Signal[];
  /** The recurring charges from these businesses, with their history. */
  series: Series[];
  evidence: EvidenceRef[];
};

/** How far back text signals count. Older mail is evidence, not news. */
const RECENT_DAYS = 120;
/** Ignore duplicate one-off payments under this many cents (coffee, parking). */
const DUPLICATE_MIN_CENTS = 2000;
const DUPLICATE_WINDOW_DAYS = 7;

const percent = (from: number, to: number) => Math.round(((to - from) * 1000) / from) / 10;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const txnRefs = (txns: Transaction[]): EvidenceRef[] => txns.map((t) => ({ kind: "txn", id: t.id }));

// ---------- Bank rules ----------

/** A recurring charge whose amount went up. */
function priceChanges(series: Series[]): Signal[] {
  const out: Signal[] = [];
  for (const s of series) {
    const amounts = s.charges.map((t) => -t.amountCents);
    // Find the most recent change of amount.
    let changeAt = -1;
    for (let i = 1; i < amounts.length; i++) if (amounts[i] !== amounts[i - 1]) changeAt = i;
    if (changeAt < 0 || amounts[changeAt] <= amounts[changeAt - 1]) continue;

    const before = amounts[changeAt - 1];
    const after = amounts[changeAt];
    const atNewPrice = s.charges.slice(changeAt).filter((t) => -t.amountCents === after);
    out.push({
      kind: "price_change",
      summary: `${s.name} went from ${dollars(before)} to ${dollars(after)} on ${s.charges[changeAt].date}`,
      keys: [s.key],
      categories: categories(s.description),
      facts: {
        merchant: s.name,
        cadence: s.cadence,
        previousCents: before,
        newCents: after,
        increaseCents: after - before,
        increasePercent: percent(before, after),
        changedOn: s.charges[changeAt].date,
        chargesAtNewPrice: atNewPrice.length,
        extraPaidSoFarCents: (after - before) * atNewPrice.length,
        nextExpected: s.nextExpected,
      },
      evidence: txnRefs(s.charges),
    });
  }
  return out;
}

/** Two different recurring charges for the same amount on the same rhythm. */
function duplicateCharges(series: Series[], today: string): Signal[] {
  const active = series.filter((s) => daysBetween(s.lastDate, today) <= 45);
  const out: Signal[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const [a, b] = [active[i], active[j]];
      if (a.key === b.key || a.cadence !== b.cadence || a.latestCents !== b.latestCents) continue;
      const overlapping = Math.min(a.charges.length, b.charges.length);
      out.push({
        kind: "duplicate_charges",
        summary: `${a.name} and ${b.name} both charge ${dollars(a.latestCents)} ${a.cadence}`,
        keys: [a.key, b.key],
        categories: [],
        facts: {
          amountCents: a.latestCents,
          cadence: a.cadence,
          chargeA: a.description,
          chargeB: b.description,
          accountA: a.accountId,
          accountB: b.accountId,
          opaqueA: isOpaqueDescriptor(a.description),
          opaqueB: isOpaqueDescriptor(b.description),
          // Only charges visible in the statements; older ones need receipts.
          overlappingChargesInStatements: overlapping,
          duplicatedInStatementsCents: overlapping * a.latestCents,
          nextA: a.nextExpected,
          nextB: b.nextExpected,
        },
        evidence: txnRefs([...a.charges, ...b.charges]),
      });
    }
  }
  return out;
}

/** The same amount paid to the same business twice within a week. */
function duplicatePayments(corpus: Corpus, series: Series[]): Signal[] {
  const inSeries = new Set(series.flatMap((s) => s.charges.map((t) => t.id)));
  const debits = corpus.transactions.filter(
    (t) =>
      -t.amountCents >= DUPLICATE_MIN_CENTS &&
      !inSeries.has(t.id) &&
      !isInternalTransfer(t, corpus.accounts),
  );
  const out: Signal[] = [];
  for (let i = 0; i < debits.length; i++) {
    for (let j = i + 1; j < debits.length; j++) {
      const [a, b] = [debits[i], debits[j]];
      if (a.amountCents !== b.amountCents) continue;
      if (Math.abs(daysBetween(a.date, b.date)) > DUPLICATE_WINDOW_DAYS) continue;
      if (merchantKey(a.description) !== merchantKey(b.description)) continue;
      const refsA = references(a.description);
      const refsB = references(b.description);
      out.push({
        kind: "duplicate_payment",
        summary: `${dollars(-a.amountCents)} paid to ${displayName(a.description)} twice (${a.date} and ${b.date})`,
        keys: [merchantKey(a.description)],
        categories: categories(`${a.description} ${b.description}`),
        facts: {
          amountCents: -a.amountCents,
          firstDate: a.date,
          secondDate: b.date,
          daysApart: Math.abs(daysBetween(a.date, b.date)),
          firstDescription: a.description,
          secondDescription: b.description,
          sameAccount: a.accountId === b.accountId,
          referencesA: refsA,
          referencesB: refsB,
          // Two different reference numbers usually mean two different bills.
          differentReferences: refsA.length > 0 && refsB.length > 0 && refsA.join() !== refsB.join(),
          totalPaidCents: -a.amountCents * 2,
        },
        evidence: txnRefs([a, b]),
      });
    }
  }
  return out;
}

/** Card charges that only name a platform (e.g. APPLE.COM/BILL). */
function opaqueDescriptors(series: Series[]): Signal[] {
  return series
    .filter((s) => isOpaqueDescriptor(s.description))
    .map((s) => ({
      kind: "opaque_descriptor" as const,
      summary: `"${s.description}" doesn't say what it's for`,
      keys: [s.key],
      categories: [],
      facts: { description: s.description, amountCents: s.latestCents, cadence: s.cadence, charges: s.charges.length },
      evidence: txnRefs(s.charges),
    }));
}

// ---------- Text rules (email, documents, calendar) ----------

const TEXT_RULES: { kind: SignalKind; pattern: RegExp }[] = [
  // Order matters: the first rule that matches decides the kind.
  { kind: "warranty", pattern: /\bwarrant(?:y|ies)\b/i },
  { kind: "competitor_quote", pattern: /\b(your|a) (\w+ )?quote\b|\bquote (number|valid)\b/i },
  {
    kind: "estimated_bill",
    pattern: /\bestimated\b.{0,25}\b(reading|read|usage)\b|\b(reading|read)\b.{0,30}\bestimated\b|\(estimated\)/i,
  },
  { kind: "trial", pattern: /\bfree trial\b|\btrial (has started|ends|will end|period)\b/i },
  { kind: "inactivity", pattern: /\bwe miss you\b|\bhaven'?t (seen|visited|been|read)\b|\bstreak has paused\b|\blast visit\b/i },
  { kind: "price_notice", pattern: /\bprice (is )?chang|\bchanges to your\b.*\bplan\b|\bprice (increase|rise)\b|\bnew (monthly )?price\b/i },
  { kind: "renewal_notice", pattern: /\brenew(al|s|ing)?\b|\bannual (membership )?fee\b/i },
];

function classify(text: string): SignalKind | undefined {
  return TEXT_RULES.find((rule) => rule.pattern.test(text))?.kind;
}

/** Addresses that belong to the household (their own mail is evidence, not news). */
function householdAddresses(corpus: Corpus): Set<string> {
  const own = new Set<string>();
  for (const m of corpus.emails) {
    if (m.labels.includes("SENT")) own.add(m.from.address);
    else for (const to of m.to) own.add(to.address);
  }
  return own;
}

/** The business an email is from, as a merchant key. */
const senderKey = (m: Corpus["emails"][number]) =>
  distinctiveTokens(m.from.name)[0] ?? merchantKey(m.from.address.split("@")[1] ?? "");

/**
 * A warranty notice and a repair booking come from two businesses, but both
 * quote the product's serial number, so they are one case.
 */
function joinBySerial(signals: Signal[], corpus: Corpus, today: string): Signal[] {
  const own = householdAddresses(corpus);
  const recent = corpus.emails.filter(
    (m) => !own.has(m.from.address) && daysBetween(m.date.slice(0, 10), today) <= RECENT_DAYS,
  );
  return signals.map((signal) => {
    if (signal.kind !== "warranty") return signal;
    const serials = new Set(
      signal.evidence.flatMap((e) => {
        const m = e.kind === "email" ? corpus.emails.find((x) => x.id === e.id) : undefined;
        const d = e.kind === "doc" ? corpus.documents.find((x) => x.id === e.id) : undefined;
        return serialNumbers(m ? `${m.subject}\n${m.body}` : (d?.text ?? ""));
      }),
    );
    const others = recent
      .filter((m) => serialNumbers(`${m.subject}\n${m.body}`).some((s) => serials.has(s)))
      .map(senderKey);
    return { ...signal, keys: [...new Set([...signal.keys, ...others])] };
  });
}

function emailSignals(corpus: Corpus, today: string): Signal[] {
  const own = householdAddresses(corpus);
  const out: Signal[] = [];
  for (const m of corpus.emails) {
    if (own.has(m.from.address) || daysBetween(m.date.slice(0, 10), today) > RECENT_DAYS) continue;
    const kind = classify(`${m.subject}\n${m.body}`);
    if (!kind) continue;
    const key = senderKey(m);
    out.push({
      kind,
      summary: `${m.from.name}: "${m.subject}"${m.unread ? " (unread)" : ""}`,
      keys: [key],
      // A quote is placed by kind of business alone, and its subject rarely
      // says what it's for ("Your Banksia Direct quote"), so read its opening.
      categories: categories(
        `${m.from.name} ${m.subject}${kind === "competitor_quote" ? ` ${m.body.slice(0, 300)}` : ""}`,
      ),
      facts: { from: m.from.name, subject: m.subject, date: m.date.slice(0, 10), unread: m.unread },
      evidence: [{ kind: "email", id: m.id }],
    });
  }
  return out;
}

function documentSignals(corpus: Corpus, today: string): Signal[] {
  const out: Signal[] = [];
  for (const d of corpus.documents) {
    if (!d.text || daysBetween(d.modifiedAt.slice(0, 10), today) > RECENT_DAYS) continue;
    const kind = classify(d.text);
    if (!kind) continue;
    const name = d.filename.replace(/\.[a-z]+$/i, "").replace(/-/g, " ");
    out.push({
      kind,
      summary: `${d.title} (${d.filename})`,
      keys: [merchantKey(name)],
      categories: categories(`${name} ${d.title}`),
      facts: { title: d.title, filename: d.filename, modified: d.modifiedAt.slice(0, 10) },
      evidence: [{ kind: "doc", id: d.id }],
    });
  }
  return out;
}

/**
 * Calendar titles are free text ("Car insurance renews (Wattle)"), so only
 * words that name a business Seal already knows from the bank or mail count.
 */
function calendarSignals(corpus: Corpus, today: string, known: Set<string>): Signal[] {
  const out: Signal[] = [];
  for (const e of corpus.events) {
    if (!/\b(cancel|renew\w*|deadline|expir\w*|trial)\b/i.test(e.title)) continue;
    const day = e.start.slice(0, 10);
    const offset = daysBetween(today, day);
    if (offset < -30 || offset > 60) continue;
    out.push({
      kind: "deadline_event",
      summary: `Calendar: "${e.title}" on ${day}${offset < 0 ? " (passed)" : ""}`,
      keys: distinctiveTokens(e.title).filter((w) => known.has(w)).slice(0, 1),
      categories: categories(e.title),
      facts: { title: e.title, date: day, passed: offset < 0, daysFromToday: offset, createdBy: e.createdBy },
      evidence: [{ kind: "event", id: e.id }],
    });
  }
  return out;
}

// ---------- Grouping ----------

/** Signal kinds that are context for a case but never a case on their own. */
const CONTEXT_ONLY = new Set<SignalKind>(["competitor_quote"]);

function groupSignals(signals: Signal[], series: Series[], names: Map<string, string>): Candidate[] {
  // Union-find over merchant keys: a signal naming two businesses (Apple and
  // StreamBox charging the same) joins their groups into one case.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  for (const s of signals) {
    if (CONTEXT_ONLY.has(s.kind)) continue;
    for (const k of s.keys.slice(1)) parent.set(find(k), find(s.keys[0]));
  }

  // Keys with a signal that can start a case, and what kind of business each is.
  const caseKeys = new Set(signals.filter((s) => !CONTEXT_ONLY.has(s.kind)).flatMap((s) => s.keys));
  const keyCategories = new Map<string, Set<string>>();
  const note = (key: string, cats: string[]) =>
    keyCategories.set(key, new Set([...(keyCategories.get(key) ?? []), ...cats]));
  for (const s of series) note(s.key, categories(s.description));
  for (const s of signals) for (const k of s.keys) note(k, s.categories);

  /** The single case a signal fits by kind of business, if exactly one fits. */
  const placeByCategory = (signal: Signal): string | undefined => {
    const fits = new Set(
      [...caseKeys]
        .filter((k) => !signal.keys.includes(k))
        .filter((k) => signal.categories.some((c) => keyCategories.get(k)?.has(c)))
        .map(find),
    );
    return fits.size === 1 ? [...fits][0] : undefined;
  };

  const groups = new Map<string, Signal[]>();
  for (const signal of signals) {
    // A named signal joins its business's case. A quote, or a calendar entry
    // that says "gym" but not the gym's name, joins the one case it fits.
    const root =
      !CONTEXT_ONLY.has(signal.kind) && signal.keys.length > 0
        ? find(signal.keys[0])
        : placeByCategory(signal);
    if (!root) continue;
    groups.set(root, [...(groups.get(root) ?? []), signal]);
  }

  return [...groups.values()]
    .map((group) => {
      const keys = [
        ...new Set(group.filter((s) => !CONTEXT_ONLY.has(s.kind)).flatMap((s) => s.keys)),
      ].sort();
      const evidence = new Map<string, EvidenceRef>();
      for (const s of group) for (const e of s.evidence) evidence.set(`${e.kind}:${e.id}`, e);
      return {
        id: `cand_${keys.join("+")}`,
        names: keys.map((k) => names.get(k) ?? k),
        keys,
        signals: group,
        series: series.filter((s) => keys.includes(s.key)),
        evidence: [...evidence.values()],
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every business Seal knows of, with the best readable name: the sender name
 * from email ("Skylink Internet") beats one built from bank text.
 */
function knownBusinesses(corpus: Corpus, series: Series[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const t of corpus.transactions) names.set(merchantKey(t.description), displayName(t.description));
  for (const s of series) names.set(s.key, s.name);
  const own = householdAddresses(corpus);
  for (const m of corpus.emails) {
    if (own.has(m.from.address)) continue;
    const key = distinctiveTokens(m.from.name)[0];
    if (key) names.set(key, m.from.name);
  }
  return names;
}

// ---------- Entry point ----------

export type DetectionResult = {
  candidates: Candidate[];
  /** Every recurring charge found, for the timeline and for the judge's context. */
  series: Series[];
  /** Signals that matched nothing (shown in the trace, not as findings). */
  unplaced: Signal[];
};

export function detect(corpus: Corpus, today = localDate(now())): DetectionResult {
  const series = findSeries(corpus.transactions, corpus.accounts);
  const names = knownBusinesses(corpus, series);
  const signals = joinBySerial(
    [
      ...priceChanges(series),
      ...duplicateCharges(series, today),
      ...duplicatePayments(corpus, series),
      ...opaqueDescriptors(series),
      ...emailSignals(corpus, today),
      ...documentSignals(corpus, today),
      ...calendarSignals(corpus, today, new Set(names.keys())),
    ],
    corpus,
    today,
  );
  const candidates = groupSignals(signals, series, names);
  const placed = new Set(candidates.flatMap((c) => c.signals));
  return { candidates, series, unplaced: signals.filter((s) => !placed.has(s)) };
}

/** Upcoming recurring charges in the next `days` days, for the timeline. */
export function upcomingCharges(series: Series[], days = 45, today = localDate(now())) {
  const until = addDays(today, days);
  return series
    .filter((s) => s.nextExpected > today && s.nextExpected <= until)
    .map((s) => ({ date: s.nextExpected, name: s.name, amountCents: s.latestCents, key: s.key }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
