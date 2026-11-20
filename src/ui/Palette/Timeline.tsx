import { useEffect, useRef } from "react";
import { formatDay, now } from "../../lib/clock";
import { toZonedIso } from "../../lib/dates";
import { formatAUD } from "../../lib/money";
import type { ScanState } from "../../lib/scan-store";
import { comingUp, nowIndex, type TimelineEntry, type TimelineTone } from "../timeline";
import { clockTime, daysUntil, shortDate } from "../format";
import { copy } from "../../copy";
import { ViewHeading } from "./ViewHeading";

// The case view: one vertical line through time. What already happened sits
// above the amber "now" marker, what is coming sits below it, and today's
// agent activity sits just above the marker. Keyboard first (J/K, Enter,
// Esc); the Palette owns the keys, this only draws.

const MONTHS = copy.dates.months;
const WEEKDAYS = copy.dates.weekdays;

function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "just now", "4 min ago", "2 h ago": for today's activity, from the real clock. */
export function ago(at: number | undefined): string {
  if (!at) return "";
  return copy.dates.ago(Math.round((Date.now() - at) / 60_000));
}

const DOT: Record<TimelineTone, string> = {
  soon: "size-2.5 bg-amber shadow-[0_0_0_4px_var(--color-amber-glow)]",
  upcoming: "size-2 border border-muted bg-bg",
  past: "size-1.5 bg-faint",
  done: "size-2 bg-positive",
  agent: "size-2 rotate-45 rounded-[2px] border border-amber/70 bg-bg",
};

/** The rail runs down this column; every dot is centred on it. */
const RAIL = "w-5 shrink-0 flex justify-center";

function Headline({
  entries,
  scan,
  search,
  query,
}: {
  entries: TimelineEntry[];
  scan: ScanState;
  search: React.ReactNode;
  /** While searching, the heading describes the matching lines (the totals already follow the filter). */
  query: string;
}) {
  const q = query.trim();
  const next = comingUp(entries);
  const parts = [copy.timeline.expected(next.totalCents)];
  if (next.soon && next.lastSoon) parts.push(copy.timeline.soonDates(next.soon, shortDate(next.lastSoon)));
  if (q && entries.length === 0) parts.splice(0, parts.length, copy.timeline.searchHelp);
  let title = copy.timeline.title;
  if (q) title = entries.length ? copy.search.matches(entries.length, q) : copy.search.noMatches(q);
  return (
    <ViewHeading
      view="timeline"
      title={title}
      search={search}
    >
      {parts.join(", and ")}.
      {scan.phase === "scanning" && <span className="text-faint"> {copy.timeline.stillChecking}</span>}
    </ViewHeading>
  );
}

function NowMarker() {
  const today = now();
  return (
    <li className="relative flex h-10 items-center gap-3 px-3" aria-label={copy.timeline.nowLabel(formatDay(today))}>
      <span className="w-12 shrink-0 text-right font-mono text-[10.5px] font-medium tracking-[0.08em] text-amber uppercase">{copy.timeline.now}</span>
      <span className={RAIL}>
        <span className="size-3 rounded-full bg-amber shadow-[0_0_0_5px_var(--color-amber-glow),0_0_18px_var(--color-amber-glow)]" />
      </span>
      <span className="h-px flex-1 bg-[linear-gradient(90deg,var(--color-amber),transparent)] opacity-60" aria-hidden="true" />
      <span className="shrink-0 font-mono text-[11px] text-amber tabular">
        {formatDay(today)}, {clockTime(toZonedIso(today))}
      </span>
    </li>
  );
}

function Row({ entry, showDate }: { entry: TimelineEntry; showDate: boolean }) {
  const future = entry.side === "future";
  const days = future ? daysUntil(entry.date) : undefined;
  const faded = entry.tone === "past";
  const right = entry.tone === "agent" ? ago(entry.at) : days !== undefined ? copy.dates.days(days) : "";
  return (
    <>
      <span className="flex w-12 shrink-0 flex-col items-end leading-none">
        {showDate && entry.tone !== "agent" && (
          <>
            <span className={`font-mono text-[14px] tabular ${entry.tone === "soon" ? "text-amber" : faded ? "text-faint" : "text-text"}`}>
              {Number(entry.date.slice(8, 10))}
            </span>
            <span className="mt-1 font-mono text-[10px] text-faint uppercase">{weekdayOf(entry.date)}</span>
          </>
        )}
      </span>
      <span className={RAIL}>
        <span className={`relative z-10 rounded-full ${DOT[entry.tone]}`} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`shrink-0 truncate font-medium ${faded ? "text-muted" : ""}`}>{entry.who}</span>
          <span className={`truncate ${faded ? "text-faint" : "text-muted"}`}>{entry.what}</span>
        </span>
        {entry.detail && <span className="mt-0.5 block truncate text-[12px] text-faint">{entry.detail}</span>}
      </span>
      {entry.tone === "done" && <span className="shrink-0 rounded-full border border-positive/30 px-2 py-px text-[11px] text-positive">{copy.shared.decided.approved}</span>}
      <span className={`w-[84px] shrink-0 text-right font-mono text-[12px] tabular ${faded ? "text-faint" : ""}`}>
        {entry.amountCents !== undefined ? formatAUD(entry.amountCents) : ""}
      </span>
      <span className="flex w-[84px] shrink-0 justify-end">
        {right && (
          <span
            className={`inline-flex h-5 items-center rounded-full px-2 font-mono text-[10.5px] tabular ${
              entry.tone === "soon" ? "bg-amber-glow text-amber" : "text-faint"
            }`}
          >
            {right}
          </span>
        )}
      </span>
    </>
  );
}

export function Timeline({
  entries,
  selectedKey,
  scrollKey,
  onHover,
  onOpen,
  scan,
  query,
  search,
}: {
  entries: TimelineEntry[];
  selectedKey?: string;
  /** Changes only when the keyboard moves the selection (or the view opens): scroll to follow it. */
  scrollKey: number;
  onHover: (key: string) => void;
  onOpen: (key: string) => void;
  scan: ScanState;
  /** The search, if any (the entries are already filtered by it). */
  query: string;
  /** The search bar, pinned under the heading. */
  search: React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const split = nowIndex(entries);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [scrollKey]);

  // On opening, put the present moment about a third of the way down.
  useEffect(() => {
    const list = listRef.current;
    const marker = list?.querySelector<HTMLElement>("[data-now]");
    if (list && marker) list.scrollTop = Math.max(0, marker.offsetTop - list.clientHeight / 3);
  }, []);

  let lastDate = "";
  let lastMonth = "";
  const rows: React.ReactNode[] = [];
  entries.forEach((entry, i) => {
    if (i === split) rows.push(<div key="now" data-now="" />, <NowMarker key="now-marker" />);
    const month = entry.date.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      rows.push(
        <li key={`month:${month}`} className="flex h-8 items-end gap-3 px-3 pb-1.5" aria-hidden="true">
          <span className="w-12 shrink-0" />
          <span className={RAIL} />
          <span className="font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">{MONTHS[Number(month.slice(5)) - 1]}</span>
        </li>,
      );
    }
    const showDate = entry.date !== lastDate;
    lastDate = entry.date;
    const selected = entry.key === selectedKey;
    const opens = !!(entry.findingId || entry.clearedId);
    rows.push(
      <li
        key={entry.key}
        role="option"
        aria-selected={selected}
        onClick={() => opens && onOpen(entry.key)}
        onMouseMove={(e) => {
          if (e.movementX !== 0 || e.movementY !== 0) onHover(entry.key);
        }}
        className={`relative flex min-h-11 items-center gap-3 rounded-md px-3 py-1.5 text-[13px] ${opens ? "cursor-pointer" : ""} ${
          selected ? "bg-raised before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-amber" : ""
        }`}
      >
        <Row entry={entry} showDate={showDate} />
      </li>,
    );
  });
  if (split === entries.length) rows.push(<div key="now" data-now="" />, <NowMarker key="now-marker" />);

  return (
    <div className="timeline-in flex min-h-0 flex-1 flex-col">
      {/* Pinned: the heading stays put while the timeline scrolls. */}
      <Headline entries={entries} scan={scan} search={search} query={query} />
      <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="relative px-2">
          {/* The rail: one hairline behind every dot. It sits at the centre of the
              dot column: 8px outer padding + 12px row padding + 48px date + 12px gap + 10px. */}
          <span className="pointer-events-none absolute inset-y-0 left-[89.5px] w-px bg-hairline" aria-hidden="true" />
          <ol role="listbox" aria-label={copy.timeline.label} className="relative flex flex-col">
            {rows}
          </ol>
        </div>
      </div>
    </div>
  );
}
