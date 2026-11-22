import { Fragment, useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import * as Accordion from "@radix-ui/react-accordion";
import { formatDay, now } from "../../lib/clock";
import { toZonedIso } from "../../lib/dates";
import { formatAUD } from "../../lib/money";
import type { ScanState } from "../../lib/scan-store";
import { EARLIER_GROUP, agenda, comingUp, isSoonDay, showsDate, type TimelineEntry, type TimelineTone } from "../timeline";
import { clockTime, daysUntil, shortDate } from "../format";
import { copy } from "../../copy";
import type { FilterId } from "../filters";
import { Kbd } from "../Kbd";
import { KeyText } from "../KeyText";
import { Tip } from "../layers";
import { useCountUp, useGlide, useScrollFade } from "../motion";
import { FilterChips } from "./Filters";
import { GroupLabel, ROW_BASE, ROW_SHAPE } from "./ListRow";
import { HeadingTotal, ViewHeading } from "./ViewHeading";

// The case view: an agenda on one vertical rail. Earlier folds away at the
// top, today's activity sits just above the violet Now, and what is coming
// follows in groups by time. Keyboard first (J/K, Enter, Esc); the Palette
// owns the keys, this only draws.

const MONTHS = copy.dates.months;
const WEEKDAYS = copy.dates.weekdays;

/** "Thu" for "2026-11-19" (also used by an open finding's Next timeline). */
export function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "just now", "4 min ago", "2 h ago": for today's activity, from the real clock. */
export function ago(at: number | undefined): string {
  if (!at) return "";
  return copy.dates.ago(Math.round((Date.now() - at) / 60_000));
}

/**
 * Each line's marker. Shared with an open finding's Next timeline (NextSteps.tsx),
 * so both read the same. Hollow marks take the selected row's fill, so the rail
 * never shows through them.
 */
export const DOT: Record<TimelineTone, string> = {
  soon: "size-2.5 rounded-full bg-amber",
  upcoming: "size-2 rounded-full border border-muted bg-bg group-aria-selected/row:bg-row-active",
  past: "size-1.5 rounded-full bg-faint",
  done: "size-2 rounded-full bg-positive",
  agent: "size-1.75 rotate-45 rounded-[2px] border border-info bg-bg group-aria-selected/row:bg-row-active",
};

/** The rail runs down this column; every dot is centred on it. */
export const RAIL = "w-5 shrink-0 flex justify-center";

/** A timeline line's shape. One that opens a finding adds `row-press cursor-pointer`. */
export const TIMELINE_ROW = `${ROW_BASE} min-h-10.5 gap-2 text-body`;

/** The empty date column, for rows with no date of their own (headers, Now's neighbours). */
const DATE_COLUMN = "w-8 shrink-0";

/**
 * One piece of the rail, inside the row's own marker column, so it always stays
 * centred on the markers. `first` and `last` stop it at the first and last marker.
 */
function RailCell({ first = false, last = false, children }: { first?: boolean; last?: boolean; children?: React.ReactNode }) {
  return (
    <span className={`${RAIL} relative items-center self-stretch`}>
      <span
        aria-hidden="true"
        className={`absolute left-1/2 w-px -translate-x-1/2 bg-hairline ${first ? "top-1/2" : "top-0"} ${last ? "bottom-1/2" : "bottom-0"}`}
      />
      {children}
    </span>
  );
}

/**
 * The cells of one line: date, marker, merchant, quiet "what", amount. A plain
 * fragment, so the line stays a direct child of its list (the highlight needs that).
 */
export function TimelineLine({
  entry,
  showDate,
  amberDate = false,
  first = false,
  last = false,
}: {
  entry: TimelineEntry;
  /** The first line of its day. */
  showDate: boolean;
  /** Any line on this day is urgent. */
  amberDate?: boolean;
  /** The first or last line on the rail. */
  first?: boolean;
  last?: boolean;
}) {
  const { tone } = entry;
  const faded = tone === "past";
  const quiet = faded || tone === "done";
  // Only these keep a second line: it says what happened, or what to expect.
  const detail = tone === "agent" || tone === "done" ? entry.detail : undefined;
  return (
    <>
      <span className={DATE_COLUMN}>
        {showDate && (
          <Tip content={copy.dates.days(daysUntil(entry.date))}>
            <span className="flex w-max flex-col">
              <span className={`figure text-body leading-5 ${amberDate ? "text-amber" : faded ? "text-faint" : "text-text"}`}>
                {Number(entry.date.slice(8, 10))}
              </span>
              <span className="font-mono text-label leading-3.5 text-faint">{weekdayOf(entry.date)}</span>
            </span>
          </Tip>
        )}
      </span>
      <RailCell first={first} last={last}>
        <span className={`relative ${DOT[tone]}`} aria-hidden="true" />
      </RailCell>
      <span className="min-w-0 flex-1">
        {/* One shared text baseline across the name, what, status and amount. */}
        <span className="flex items-baseline gap-3">
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className={`max-w-[60%] shrink-0 truncate ${quiet ? "font-medium text-muted" : "font-semibold text-text"}`}>{entry.who}</span>
            <span className="min-w-0 truncate text-meta text-faint">{entry.what}</span>
          </span>
          {tone === "done" && (
            <span className="shrink-0 text-meta text-positive">{entry.ready ?? (entry.handled ? copy.shared.decided.handled : copy.shared.decided.approved)}</span>
          )}
          <span className={`figure w-22 shrink-0 text-right ${tone === "agent" ? "text-label text-faint" : `text-body ${quiet ? "text-muted" : "text-text"}`}`}>
            {tone === "agent" ? ago(entry.at) : entry.amountCents !== undefined ? formatAUD(entry.amountCents) : ""}
          </span>
        </span>
        {detail && <span className="block truncate text-meta text-faint">{detail}</span>}
      </span>
    </>
  );
}

function Headline({
  entries,
  scan,
  query,
  filtered,
  chips,
}: {
  entries: TimelineEntry[];
  scan: ScanState;
  query: string;
  filtered: boolean;
  /** The filter chips, drawn under the heading. */
  chips: React.ReactNode;
}) {
  const q = query.trim();
  const narrowed = !!q || filtered;
  const next = comingUp(entries);
  // The total counts up the first time the timeline opens; while searching or filtering it just follows the matches.
  const counted = useCountUp(narrowed ? "timeline:search" : "timeline:total", next.totalCents);
  const total = narrowed ? next.totalCents : counted;
  let title = copy.timeline.title;
  if (q) title = entries.length ? copy.search.matches(entries.length, q) : copy.search.noMatches(q);
  else if (filtered && !entries.length) title = copy.filters.noMatches;
  // The dates that need Maya stay on the line under the title.
  let line: React.ReactNode;
  if (filtered && !entries.length) line = <KeyText text={q ? copy.filters.noMatchesSearchHelp : copy.filters.noMatchesHelp} />;
  else if (q && !entries.length) line = copy.timeline.searchHelp;
  else if (next.soon && next.lastSoon) line = copy.timeline.soonDates(next.soon, shortDate(next.lastSoon));
  else if (!q && scan.phase === "done") line = copy.timeline.noSoonDates;
  return (
    <ViewHeading
      divider
      title={title}
      reserveLine
      below={chips}
      action={next.totalCents > 0 ? <HeadingTotal cents={total} label={copy.timeline.inNextThirty} /> : undefined}
    >
      {line}
    </ViewHeading>
  );
}

/** Today on the rail: a solid violet dot, the word Now, and the day and time. */
function NowRow({ first, last }: { first: boolean; last: boolean }) {
  const today = now();
  return (
    // data-now: the view opens with this row about a third of the way down.
    <div data-now="" role="none" className={`${ROW_BASE} h-9 gap-2`}>
      <span className={`${DATE_COLUMN} text-meta font-semibold text-accent`}>{copy.timeline.now}</span>
      <RailCell first={first} last={last}>
        <span className="relative size-2.5 rounded-full bg-accent" aria-hidden="true" />
      </RailCell>
      <span className="figure text-label text-muted">
        {formatDay(today)}, {clockTime(toZonedIso(today))}
      </span>
    </div>
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
  earlierOpen,
  onToggleEarlier,
  mouse = false,
  filters = [],
  onRemoveFilter,
  onClearFilters,
}: {
  entries: TimelineEntry[];
  selectedKey?: string;
  /** Changes only when the keyboard moves the selection (or the view opens): scroll to follow it. */
  scrollKey: number;
  onHover: (key: string) => void;
  onOpen: (key: string) => void;
  scan: ScanState;
  /** The top bar's search, if any (the entries are already filtered by it). */
  query: string;
  /** Whether Earlier is open (earlierOpen in timeline.ts). */
  earlierOpen: boolean;
  onToggleEarlier: (open: boolean) => void;
  /** True while the mouse is in use: Earlier's header then drops its key hint. */
  mouse?: boolean;
  /** The filters that are on (the entries already pass them). */
  filters?: FilterId[];
  onRemoveFilter: (id: FilterId) => void;
  onClearFilters: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef);
  const linesRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  useGlide(linesRef, highlightRef);

  const scrollToSelected = () => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  };
  // Also when a search or filter changes: the selected line may have moved out of view.
  const filterKey = filters.join();
  useEffect(scrollToSelected, [scrollKey, query, filterKey]);

  // On opening, put Now about a third of the way down, then make sure the
  // selected line shows (it may be inside Earlier, coming back from a finding).
  // If the timeline opens while a check is still running, the lines below Now
  // aren't in yet, so it is placed once more when the check ends (and never
  // again, so it doesn't fight your scrolling).
  const checking = scan.phase === "scanning";
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current) return;
    const list = listRef.current;
    const marker = list?.querySelector<HTMLElement>("[data-now]");
    if (list && marker) list.scrollTop = Math.max(0, marker.offsetTop - list.clientHeight / 3);
    // A line out of view (inside Earlier) comes to the middle, clear of the faded edges.
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && selected) {
      const line = selected.getBoundingClientRect();
      const area = list.getBoundingClientRect();
      if (line.top < area.top || line.bottom > area.bottom) selected.scrollIntoView({ block: "center" });
    }
    placed.current = !checking;
  }, [checking]);

  const narrowed = !!query.trim() || filters.length > 0;
  const { earlier, today, groups } = agenda(entries);
  const position = new Map(entries.map((e, i) => [e.key, i]));
  const lastLine = groups.length ? groups[groups.length - 1].lines.slice(-1)[0] : undefined;
  const nowFirst = !earlier.length && !today.length;
  const nothingAhead = !groups.length && !narrowed && scan.phase === "done";
  const headerSelected = selectedKey === EARLIER_GROUP;

  // `leads` marks a group's first line: J/K scrolling then brings its header into view too.
  const line = (entry: TimelineEntry, leads = false, first = false) => {
    const opens = !!(entry.findingId || entry.clearedId);
    const at = position.get(entry.key)!;
    return (
      <div
        key={entry.key}
        role="option"
        aria-selected={entry.key === selectedKey}
        onClick={() => opens && onOpen(entry.key)}
        onMouseMove={(e) => {
          // Only real pointer movement counts, not the list scrolling under a still pointer.
          if (e.movementX !== 0 || e.movementY !== 0) onHover(entry.key);
        }}
        className={`${TIMELINE_ROW} ${opens ? "row-press cursor-pointer" : ""} ${leads ? "scroll-mt-11" : ""}`}
      >
        <TimelineLine entry={entry} showDate={showsDate(entries, at)} amberDate={isSoonDay(entries, entry.date)} first={first} last={entry === lastLine} />
      </div>
    );
  };

  // Month names inside Earlier, before each month's first line.
  const earlierLines: React.ReactNode[] = [];
  earlier.forEach((entry, i) => {
    const month = entry.date.slice(0, 7);
    if (month !== earlier[i - 1]?.date.slice(0, 7)) {
      earlierLines.push(
        <div key={`month:${month}`} role="none" className="relative flex h-7 items-end gap-2 px-2.5">
          <span className={DATE_COLUMN} />
          <RailCell />
          <span className="pb-1 text-meta text-faint">{MONTHS[Number(month.slice(5)) - 1]}</span>
        </div>,
      );
    }
    earlierLines.push(line(entry));
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned: the heading stays put while the timeline scrolls. */}
      <Headline
        entries={entries}
        scan={scan}
        query={query}
        filtered={filters.length > 0}
        chips={<FilterChips active={filters} mouse={mouse} onRemove={onRemoveFilter} onClear={onClearFilters} />}
      />
      <div ref={listRef} className="scroll-fade relative min-h-0 flex-1 overflow-y-auto pt-3 pb-4">
        <div ref={linesRef} role="listbox" aria-label={copy.timeline.label} className="relative flex flex-col px-1.5">
          <div ref={highlightRef} className="glide glide-soft inset-x-1.5" aria-hidden="true" />
          {/* Earlier folds away: none of it needs Maya. The palette owns the keys
              (J/K stop on the header, Enter or Space opens it). */}
          {earlier.length > 0 && (
            <Accordion.Root type="single" collapsible value={earlierOpen ? EARLIER_GROUP : ""} onValueChange={(value) => onToggleEarlier(value === EARLIER_GROUP)}>
              <Accordion.Item value={EARLIER_GROUP} data-glide-rows>
                <Accordion.Trigger asChild>
                  <div
                    role="option"
                    aria-selected={headerSelected}
                    onMouseMove={(e) => {
                      if (e.movementX !== 0 || e.movementY !== 0) onHover(EARLIER_GROUP);
                    }}
                    className={`${ROW_SHAPE} h-9 gap-2 text-meta font-medium`}
                  >
                    <span className={DATE_COLUMN} />
                    <RailCell first>
                      <span className={`relative ${DOT.past}`} aria-hidden="true" />
                    </RailCell>
                    {/* data-state: the chevron turns from its direct parent's state. */}
                    <span data-state={earlierOpen ? "open" : "closed"} className="flex items-center gap-1.5">
                      <GroupLabel label={copy.timeline.earlier} count={earlier.length} selected={headerSelected} />
                      <ChevronRight
                        size={12}
                        strokeWidth={2}
                        aria-hidden="true"
                        className={`accordion-chevron shrink-0 ${headerSelected ? "text-muted" : "text-faint"}`}
                      />
                    </span>
                    <span className="flex-1" />
                    {headerSelected && !mouse && <Kbd keys={["↵"]} />}
                  </div>
                </Accordion.Trigger>
                {/* While searching or filtering, it opens at once: a sliding open would leave the highlight behind. */}
                <Accordion.Content data-glide-rows className="accordion-content flex flex-col" style={narrowed ? { animation: "none" } : undefined}>
                  {earlierLines}
                </Accordion.Content>
              </Accordion.Item>
            </Accordion.Root>
          )}
          {today.map((entry, i) => line(entry, false, i === 0 && !earlier.length))}
          {!(narrowed && !entries.length) && <NowRow first={nowFirst} last={!groups.length} />}
          {nothingAhead && (
            <div role="none" className="flex h-9 items-center gap-2 px-2.5 text-meta text-faint">
              <span className={DATE_COLUMN} />
              <span className="w-5 shrink-0" />
              {copy.timeline.nothingAhead}
            </div>
          )}
          {groups.map((group) => (
            <Fragment key={group.key}>
              {/* A header is not a stop. It stays above the highlight as it slides past (relative). */}
              <h2 className="relative flex h-11 items-end gap-2 px-2.5 text-meta font-medium">
                <span className={DATE_COLUMN} />
                <RailCell />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 pb-1">
                  <GroupLabel label={group.label} count={group.lines.length} />
                  {group.cents > 0 && <span className="figure ml-auto text-label text-faint">{formatAUD(group.cents)}</span>}
                </span>
              </h2>
              {group.lines.map((entry, i) => line(entry, i === 0))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
