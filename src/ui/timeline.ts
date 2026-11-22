// Builds the case view's timeline: what has happened, what the agent has done
// today, and what is coming, in date order. Everything comes from the scan:
// expected charges worked out from the bank history, the dates code checked on
// each finding, money-related calendar entries, and Maya's decisions.

import type { Finding } from "../agent/pipeline.ts";
import { now } from "../lib/clock.ts";
import { addDays, localDate } from "../lib/dates.ts";
import { parseCents } from "../lib/money.ts";
import { withDecision, type ScanState } from "../lib/scan-store.ts";
import { SOON_DAYS, daysUntil, shortDate } from "./format.ts";
import { copy } from "../copy.ts";
import { chosenRoute, readyLabel } from "./fix-route.ts";
import { expectation, linkCharge, norm } from "./next-steps.ts";

export type TimelineTone =
  /** Linked to something that needs Maya, and soon: amber. */
  | "soon"
  /** Coming up, nothing urgent. */
  | "upcoming"
  /** Already happened. */
  | "past"
  /** Maya has dealt with the finding it belongs to. */
  | "done"
  /** Something the agent or Maya did today. */
  | "agent";

export type TimelineEntry = {
  key: string;
  /** "YYYY-MM-DD", Melbourne. */
  date: string;
  /** Which side of the present-moment marker it sits on. */
  side: "past" | "future";
  /** Bold first words, usually the business. */
  who: string;
  /** What happens, e.g. "Renews" or "Last day to give notice". */
  what: string;
  /** Extra words under the line, e.g. the finding's title (shown on one line per finding). */
  detail?: string;
  /** The finding's title, kept for search on every line of that finding, even where it isn't shown. */
  title?: string;
  amountCents?: number;
  /** Real time it happened (agent activity only), for "4 min ago". */
  at?: number;
  findingId?: string;
  clearedId?: string;
  /** An approved finding with nothing to send: its chip says "Handled". */
  handled?: boolean;
  /** Approved on a call, chat or online route: its chip, like "Ready to call". */
  ready?: string;
  tone: TimelineTone;
};

/** How far back and forward the timeline reaches. */
const BACK_DAYS = 90;
const AHEAD_DAYS = 45;

/** The money that goes with a date on a finding, by figure id (e.g. "Renews" goes with "Due at renewal"). */
const AMOUNT_FOR_DATE: Record<string, string> = {
  renews_on: "renewal_amount",
  platform_renews: "duplicate_amount",
  direct_renews: "duplicate_amount",
  first_payment: "payment_amount",
  second_payment: "payment_amount",
  bill_paid_on: "bill_total",
  price_changed_on: "new_price",
  repair_visit: "repair_booked",
};

/** Calendar entries worth showing even when no finding cites them. */
const MONEY_WORDS = /\$\d|\b(rates|renews?|renewal|bill|due|insurance|payment|invoice)\b/i;

/** "Saved a draft to Apple Support", or just "Saved a draft" when the line already names who it goes to. */
function draftedTo(to: string, merchant: string): string {
  const a = norm(to);
  const b = norm(merchant);
  return a && (a.includes(b) || b.includes(a)) ? copy.timeline.savedDraft : copy.timeline.savedDraftTo(to);
}

function toneFor(date: string, today: string, finding?: Finding): TimelineTone {
  if (finding && finding.status === "approved") return "done";
  if (date <= today) return "past";
  if (finding && finding.status === "new" && daysUntil(date) <= SOON_DAYS) return "soon";
  return "upcoming";
}

export function buildTimeline(scan: ScanState): TimelineEntry[] {
  const today = localDate(now());
  const from = addDays(today, -BACK_DAYS);
  const until = addDays(today, AHEAD_DAYS);
  const inRange = (d: string) => d >= from && d <= until;
  const findings = scan.findings.map((f) => withDecision(f, scan));
  const entries: TimelineEntry[] = [];
  // One line per finding per day: the first one placed wins, later ones only add a missing amount.
  const byFindingDay = new Map<string, TimelineEntry>();

  function place(entry: Omit<TimelineEntry, "side" | "tone">, finding?: Finding) {
    const side = entry.date <= today ? "past" : "future";
    const tone = toneFor(entry.date, today, finding);
    if (finding) {
      const slot = `${finding.id}:${entry.date}`;
      const existing = byFindingDay.get(slot);
      if (existing) {
        existing.amountCents ??= entry.amountCents;
        return;
      }
      const full = { ...entry, side, tone, findingId: finding.id, title: finding.title } as TimelineEntry;
      if (finding.status === "approved") {
        full.ready = readyLabel(finding, scan);
        if (!finding.draft && !full.ready) full.handled = true;
      }
      byFindingDay.set(slot, full);
      entries.push(full);
      return;
    }
    entries.push({ ...entry, side, tone });
  }

  // 1. Dates code checked on each finding. The deadline's own label names the
  // day ("Cancel the Apple one before it renews"), unless it is only an amount
  // ("$89.00 charged"): then the figure's label ("Renews") reads better.
  for (const f of findings) {
    const deadline =
      f.deadline && inRange(f.deadline.date)
        ? { key: `${f.id}:deadline`, date: f.deadline.date, who: f.merchant, what: f.deadline.label, detail: f.title }
        : undefined;
    const deadlineFirst = deadline && !deadline.what.includes("$");
    if (deadline && deadlineFirst) place(deadline, f);
    for (const fig of f.figures) {
      if (fig.unit !== "date" || typeof fig.value !== "string" || !inRange(fig.value)) continue;
      const money = AMOUNT_FOR_DATE[fig.id] && f.figures.find((x) => x.id === AMOUNT_FOR_DATE[fig.id]);
      place(
        {
          key: `${f.id}:${fig.id}`,
          date: fig.value,
          who: f.merchant,
          what: fig.label,
          detail: f.title,
          amountCents: money && typeof money.value === "number" ? money.value : undefined,
        },
        f,
      );
    }
    if (deadline && !deadlineFirst) place(deadline, f);
  }

  // 2. Charges expected from the bank history.
  for (const u of scan.result?.upcoming ?? []) {
    if (!inRange(u.date)) continue;
    const { finding, name } = linkCharge(u.key, findings);
    const cleared = finding ? undefined : scan.cleared.find((c) => norm(c.merchant).includes(norm(u.key)));
    place(
      {
        key: `charge:${u.key}:${u.date}`,
        date: u.date,
        who: name ?? u.name,
        what: copy.timeline.expectedCharge,
        detail: finding?.title ?? (cleared ? copy.timeline.checked(cleared.why) : copy.timeline.sameAsLastTime),
        amountCents: u.amountCents,
        clearedId: cleared?.id,
      },
      finding,
    );
  }

  // 3. Calendar entries about money, or cited by a finding.
  for (const e of scan.corpus?.events ?? []) {
    const date = e.start.slice(0, 10);
    if (!inRange(date)) continue;
    const finding = findings.find((f) => f.evidence.some((ev) => ev.kind === "event" && ev.id === e.id));
    if (!finding && !MONEY_WORDS.test(e.title)) continue;
    const amount = /\$[\d,]+\.\d{2}/.exec(e.title);
    place(
      {
        key: `event:${e.id}`,
        date,
        who: finding?.merchant ?? copy.timeline.calendar,
        // The amount gets its own column, so it comes out of the words.
        what: amount ? e.title.replace(/[:\s-]*\$[\d,]+\.\d{2}/, "") : e.title,
        detail: finding ? copy.timeline.calendarFor(finding.title) : copy.timeline.fromCalendar,
        amountCents: amount ? (parseCents(amount[0]) ?? undefined) : undefined,
      },
      finding,
    );
  }

  // 4. Today: what the agent and Maya did.
  if (scan.phase === "scanning") {
    entries.push({ key: "agent:scanning", date: today, side: "past", who: copy.timeline.checkingNow, what: copy.timeline.checkingNowWhat, tone: "agent", at: scan.startedAt });
  } else if (scan.phase === "done" && scan.result) {
    const open = findings.filter((f) => f.status === "new").length;
    entries.push({
      key: "agent:scan",
      date: today,
      side: "past",
      who: copy.timeline.checkedEverything,
      what: copy.timeline.found(findings.length, scan.cleared.length),
      detail: open ? copy.timeline.stillNeedYou(open) : copy.timeline.nothingSent,
      at: scan.finishedAt,
      tone: "agent",
    });
  } else if (scan.phase === "error") {
    entries.push({ key: "agent:error", date: today, side: "past", who: copy.timeline.didntFinish, what: scan.error ?? copy.timeline.somethingWentWrong, at: scan.finishedAt, tone: "agent" });
  }
  const DID = copy.timeline.did;
  for (const f of findings) {
    if (f.status === "new") continue;
    const ready = readyLabel(f, scan);
    const route = chosenRoute(f, scan);
    entries.push({
      key: `decision:${f.id}`,
      date: today,
      side: "past",
      who: f.merchant,
      what: f.status !== "approved" ? DID[f.status] : ready ? route!.label : f.draft ? draftedTo(f.draft.to.name, f.merchant) : copy.next.handled,
      detail:
        f.status !== "approved"
          ? f.title
          : ready
            ? copy.timeline.readyRoute(ready, expectation(f, scan))
            : f.draft
              ? copy.timeline.readyToSend(expectation(f, scan))
              : handledDetail(f, scan),
      at: scan.decidedAt[f.id],
      findingId: f.id,
      tone: "agent",
    });
  }

  // 5. Reminders Maya asked for (L): a line on the day, and today's "Added a reminder".
  for (const [findingId, r] of Object.entries(scan.reminders)) {
    const f = findings.find((x) => x.id === findingId);
    if (!f) continue;
    if (inRange(r.date)) {
      entries.push({
        key: `reminder:${findingId}`,
        date: r.date,
        side: r.date <= today ? "past" : "future",
        who: f.merchant,
        what: copy.timeline.reminder,
        detail: r.title,
        findingId,
        tone: r.date <= today ? "past" : "upcoming",
      });
    }
    entries.push({
      key: `reminder-added:${findingId}`,
      date: today,
      side: "past",
      who: f.merchant,
      what: copy.timeline.addedReminder(shortDate(r.date)),
      detail: copy.timeline.addedReminderDetail,
      at: r.at,
      findingId,
      tone: "agent",
    });
  }

  // Oldest first. On the same day: dated items, then today's activity (in the order it happened).
  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(a.tone === "agent") - Number(b.tone === "agent") ||
      (a.at ?? 0) - (b.at ?? 0),
  );
  // An approved finding's coming line says what should happen once the draft is sent, instead of its title.
  const expected = new Map(findings.filter((f) => f.status === "approved").map((f) => [f.id, expectation(f, scan)]));
  return titleOnce(entries, expected);
}

/** A handled finding (nothing to send): what to expect, or its title when code can't say. */
function handledDetail(f: Finding, scan: ScanState): string {
  const expect = expectation(f, scan);
  return expect ? copy.next.thenExpect(expect) : f.title;
}

/**
 * A finding usually has several lines (a deadline, a renewal, the next charge).
 * Its title would repeat under each one, so it shows under one line only: the
 * next one still to come, or the latest one if they have all passed.
 */
function titleOnce(entries: TimelineEntry[], expected = new Map<string, string | undefined>()): TimelineEntry[] {
  // A reminder line keeps its own words (the event's title) and never carries the finding's title.
  const own = (e: TimelineEntry) => !e.findingId || e.tone === "agent" || e.key.startsWith("reminder:");
  const keeper = new Map<string, TimelineEntry>();
  for (const e of entries) {
    if (own(e)) continue;
    const kept = keeper.get(e.findingId!);
    if (!kept || kept.side === "past") keeper.set(e.findingId!, e);
  }
  for (const e of entries) {
    if (own(e)) continue;
    const kept = keeper.get(e.findingId!) === e;
    const expect = expected.get(e.findingId!);
    if (kept && e.side === "future" && expect) {
      e.detail = e.handled ? copy.next.thenExpect(expect) : e.ready ? copy.timeline.onceDone(expect) : copy.timeline.onceSent(expect);
      continue;
    }
    // A calendar line still says where it came from.
    const shown = kept ? e.detail : e.key.startsWith("event:") ? copy.timeline.fromCalendar : undefined;
    e.detail = shown;
  }
  return entries;
}

/** The lines that match a search: by business, what happens, the detail, or a date like "28 Nov". */
export function filterTimeline(entries: TimelineEntry[], query: string): TimelineEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => [e.who, e.what, e.detail ?? "", e.title ?? "", shortDate(e.date), e.date].some((t) => t.toLowerCase().includes(q)));
}

/**
 * The lines of the findings that pass the filters (`ids`; undefined means no
 * filter is on). Lines that belong to no finding, like an ordinary expected
 * charge, have nothing to match, so they step aside while a filter is on.
 */
export function onlyFindings(entries: TimelineEntry[], ids?: ReadonlySet<string>): TimelineEntry[] {
  return ids ? entries.filter((e) => !!e.findingId && ids.has(e.findingId)) : entries;
}

/** Where the present-moment marker goes: before the first entry after today. */
export function nowIndex(entries: TimelineEntry[]): number {
  const i = entries.findIndex((e) => e.side === "future");
  return i === -1 ? entries.length : i;
}

// ---------- The agenda: Earlier, today, Now, then groups by time ----------

/** The key of Earlier's header, a J/K stop of its own. */
export const EARLIER_GROUP = "group:earlier";

/** Earlier's header, standing in the J/K stops for the lines folded under it. */
export type EarlierStop = { key: typeof EARLIER_GROUP; earlierCount: number; open: boolean };
export type TimelineStop = TimelineEntry | EarlierStop;

export function isEarlierStop(stop: TimelineStop | undefined): stop is EarlierStop {
  return stop?.key === EARLIER_GROUP;
}

/** Before today: these fold away under Earlier. */
export function isEarlier(entry: TimelineEntry): boolean {
  return entry.date < localDate(now());
}

/**
 * Whether Earlier is open: as Maya left it, or open by itself while a search
 * matches a line inside it (unless she closed it during that search).
 */
export function earlierOpen(entries: TimelineEntry[], searching: boolean, opened: boolean, closedInSearch: boolean): boolean {
  return opened || (searching && !closedInSearch && entries.some(isEarlier));
}

/** The stops J/K move through: Earlier's header, its lines while it is open, then today and everything to come. */
export function timelineStops(entries: TimelineEntry[], open: boolean): TimelineStop[] {
  const before = entries.filter(isEarlier);
  if (!before.length) return entries;
  const header: EarlierStop = { key: EARLIER_GROUP, earlierCount: before.length, open };
  return [header, ...(open ? before : []), ...entries.filter((e) => !isEarlier(e))];
}

/**
 * The selected stop. A line folded away inside Earlier stands for its header, so
 * the highlight stays on something visible. With nothing chosen, the first thing to come.
 */
export function pickTimelineStop(entries: TimelineEntry[], stops: TimelineStop[], key: string | undefined): TimelineStop | undefined {
  const found = stops.find((s) => s.key === key);
  if (found) return found;
  if (key && entries.some((e) => e.key === key)) return stops.find(isEarlierStop);
  return entries[nowIndex(entries)] ?? stops[stops.length - 1];
}

/** A group of lines still to come, with its own total. */
export type AgendaGroup = { key: string; label: string; lines: TimelineEntry[]; cents: number };

/**
 * The timeline split the way it is drawn: Earlier, today, then what's coming in
 * groups ("Next 7 days", "Later in November", then each later month). The order
 * inside is buildTimeline's; empty groups are left out.
 */
export function agenda(entries: TimelineEntry[]): { earlier: TimelineEntry[]; today: TimelineEntry[]; groups: AgendaGroup[] } {
  const today = localDate(now());
  const week = addDays(today, SOON_DAYS);
  const month = today.slice(0, 7);
  const groups: AgendaGroup[] = [];
  for (const entry of entries) {
    if (entry.date <= today) continue;
    const key = entry.date <= week ? "next" : entry.date.slice(0, 7) === month ? "later" : entry.date.slice(0, 7);
    let group = groups[groups.length - 1];
    if (group?.key !== key) {
      const name = copy.dates.months[Number((key === "later" ? month : key).slice(5, 7)) - 1];
      const label = key === "next" ? copy.timeline.groups.next : key === "later" ? copy.timeline.groups.laterIn(name) : name;
      group = { key, label, lines: [], cents: 0 };
      groups.push(group);
    }
    group.lines.push(entry);
    group.cents += entry.amountCents ?? 0;
  }
  return { earlier: entries.filter((e) => e.date < today), today: entries.filter((e) => e.date === today), groups };
}

/** A date shows once, on the first line of its day. Agent activity has none: the Now row just below it says the day. */
export function showsDate(entries: TimelineEntry[], index: number): boolean {
  const entry = entries[index];
  return entry.tone !== "agent" && entries[index - 1]?.date !== entry.date;
}

/** A day's date is amber if any of its lines is urgent, because the date only shows on the first one. */
export function isSoonDay(entries: TimelineEntry[], date: string): boolean {
  return entries.some((e) => e.date === date && e.tone === "soon");
}

/** Totals for the timeline's headline. */
export function comingUp(entries: TimelineEntry[], days = 30) {
  const until = addDays(localDate(now()), days);
  const ahead = entries.filter((e) => e.side === "future" && e.date <= until);
  return {
    totalCents: ahead.reduce((n, e) => n + (e.amountCents ?? 0), 0),
    count: ahead.length,
    soon: ahead.filter((e) => e.tone === "soon").length,
    lastSoon: ahead.filter((e) => e.tone === "soon").map((e) => e.date).pop(),
  };
}
