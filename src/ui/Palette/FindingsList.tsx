import { useEffect, useRef, useState } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import * as Accordion from "@radix-ui/react-accordion";
import { Menu, MenuItem, Tip } from "../layers";
import type { Cleared, Finding } from "../../agent/pipeline";
import { useLive } from "../../connectors/live";
import { useScan, type ScanState } from "../../lib/scan-store";
import { fromSaved, mixedReplay, SavedTag } from "../replay";
import { daysUntil, headlineAmount, isUnsure, shortDate, urgency, type Urgency } from "../format";
import { copy } from "../../copy";
import { KeyText } from "../KeyText";
import { ApproveIcon, DismissIcon, RemindIcon, SnoozeIcon } from "../icons";
import { Kbd } from "../Kbd";
import { CountUp } from "../CountUp";
import { useFlip, useGlide } from "../motion";
import { TraceLines } from "./Trace";
import { ViewHeading } from "./ViewHeading";
import { FilterChips } from "./Filters";
import type { FilterId } from "../filters";

// The palette's main view: a plain-words headline, then one row per finding,
// most urgent first. Keyboard first (J/K/Enter/A/S/D); the Palette owns the
// keys, this only draws.

export type ListItem =
  | { type: "finding"; key: string; finding: Finding }
  | { type: "undecided"; key: string; merchant: string; error: string }
  | { type: "cleared"; key: string; cleared: Cleared }
  /** The "Checked and left alone" header: a stop of its own that opens and closes the group. */
  | { type: "group"; key: typeof CLEARED_GROUP; count: number; open: boolean };

export const CLEARED_GROUP = "group:cleared";

/**
 * Rows that belong in "Checked and left alone": the cases the agent cleared,
 * and findings Maya marked "Not a leak" (she has said they are fine too).
 */
export function leftAlone(item: ListItem): boolean {
  return item.type === "cleared" || (item.type === "finding" && item.finding.status === "dismissed");
}

/** Approved (ready to send, or handled): drawn in their own group after the main list. */
export function isApproved(item: ListItem): boolean {
  return item.type === "finding" && item.finding.status === "approved";
}

/**
 * Every row that matches the search, in the order the list draws them: the
 * findings (snoozed ones last), then "Approved", then "Couldn't decide", then "Checked and left alone" (cleared
 * cases first, then the ones marked "Not a leak"). The search also matches
 * words that are no longer shown on the rows (a finding's title, why a case
 * looks fine), so "price rise" still finds Skylink.
 */
export function listItems(findings: Finding[], scan: ScanState, query: string): ListItem[] {
  const q = query.trim().toLowerCase();
  const match = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  const found = findings
    .filter((f) => match(f.merchant, f.title, copy.shared.kind[f.kind]))
    .map((f): ListItem => ({ type: "finding", key: f.id, finding: f }));
  return [
    ...found.filter((i) => !leftAlone(i) && !isApproved(i)),
    ...found.filter(isApproved),
    ...scan.undecided
      .filter((u) => match(u.merchant))
      .map((u): ListItem => ({ type: "undecided", key: u.id, merchant: u.merchant, error: u.error })),
    ...scan.cleared
      .filter((c) => match(c.merchant, c.title, c.why))
      .map((c): ListItem => ({ type: "cleared", key: c.id, cleared: c })),
    ...found.filter(leftAlone),
  ];
}

/**
 * Whether "Checked and left alone" is open: as Maya left it, or open by itself
 * while a search or a filter (`narrowed`) matches a row inside it (unless she
 * closed it during that search or filter).
 */
export function groupOpen(items: ListItem[], narrowed: boolean, opened: boolean, closedInSearch: boolean): boolean {
  return opened || (narrowed && !closedInSearch && items.some(leftAlone));
}

/**
 * The stops J/K move through: every row, with the group's header in front of
 * its rows, and those rows left out while the group is closed.
 */
export function listStops(items: ListItem[], open: boolean): ListItem[] {
  const inside = items.filter(leftAlone);
  if (!inside.length) return items;
  const header: ListItem = { type: "group", key: CLEARED_GROUP, count: inside.length, open };
  return [...items.filter((i) => !leftAlone(i)), header, ...(open ? inside : [])];
}

/**
 * The selected row. A row that is hidden in the closed group is still found
 * (an open finding can be one, opened from the timeline), but in the list it
 * stands for the group's header, so the highlight stays on something visible.
 */
export function pickSelected(items: ListItem[], stops: ListItem[], key: string | undefined, inList: boolean): ListItem | undefined {
  const picked = stops.find((i) => i.key === key) ?? items.find((i) => i.key === key);
  if (picked && inList && !stops.includes(picked)) return stops.find((i) => i.type === "group");
  return picked ?? stops[0];
}

// ---------- Headline ----------

export function Headline({
  findings,
  scan,
  query = "",
  matches = [],
  filters = [],
  chips,
}: {
  findings: Finding[];
  scan: ScanState;
  /** While searching, the heading describes the matching rows instead of the month. */
  query?: string;
  matches?: ListItem[];
  /** The filters that are on (the rows in `matches` already pass them). */
  filters?: FilterId[];
  /** The filter chips, drawn under the heading. */
  chips?: React.ReactNode;
}) {
  const open = findings.filter((f) => f.status === "new");
  const scanning = scan.phase === "scanning";
  const q = query.trim();
  const filtered = filters.length > 0;

  if (q || filtered) {
    const hits = matches.flatMap((i) => (i.type === "finding" && i.finding.status === "new" ? [i.finding] : []));
    const fine = matches.filter(leftAlone).length;
    const hitBack = hits.reduce((n, f) => n + (f.amounts.recoverable ?? 0), 0);
    const hitMonthly = hits.reduce((n, f) => n + (f.amounts.perMonth ?? 0), 0);
    const words: string[] = [];
    if (matches.length > 0) {
      if (q) words.push(copy.list.searchOfOpen(hits.length, open.length));
      if (fine) words.push(copy.list.searchCleared(fine));
      if (hitBack > 0) words.push(copy.list.searchBack(hitBack));
      if (hitMonthly > 0) words.push(copy.list.searchMonthly(hitMonthly));
    }
    let title: string;
    if (q) title = matches.length ? copy.search.matches(matches.length, q) : copy.search.noMatches(q);
    else if (!matches.length) title = copy.filters.noMatches;
    else if (!open.length) title = copy.filters.showing(matches.length);
    else title = hits.length ? copy.filters.of(hits.length, open.length) : copy.filters.noneOpen;
    const sentence = words.join(", ");
    return (
      <ViewHeading title={title} below={chips}>
        {matches.length === 0 ? (
          // Nothing left: say how to get back. Filters are the likelier cause, so they come first.
          filtered ? (
            <KeyText text={q ? copy.filters.noMatchesSearchHelp : copy.filters.noMatchesHelp} />
          ) : (
            `${copy.list.searchHelp}.`
          )
        ) : sentence ? (
          `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
        ) : null}
      </ViewHeading>
    );
  }

  let title: string;
  if (findings.length === 0) title = scanning ? copy.list.nothingSoFar : copy.list.allClear;
  else if (open.length === 0) title = copy.list.allDealtWith;
  // Kept short on purpose: just how many need attention (deadlines and money are on each row).
  else title = copy.list.needAttention(open.length);

  let line: string | undefined;
  if (findings.length === 0) line = scanning ? copy.list.findingsAppear : copy.list.allClearLine;
  else if (open.length === 0) line = copy.list.allDealtWithLine;

  return (
    <ViewHeading title={title}>
      {line}
      {scanning && <span className="text-faint">{line ? " " : ""}{copy.list.stillChecking}</span>}
    </ViewHeading>
  );
}

// ---------- First-run hint ----------

export function FirstRunHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mx-3 mb-2 flex items-start justify-between gap-3 rounded-lg border border-hairline bg-raised/60 px-3.5 py-2.5 text-small">
      <div className="text-muted">
        {copy.list.hint.map((line) => (
          <p key={line}>
            <KeyText text={line} />
          </p>
        ))}
      </div>
      <button type="button" onClick={onDismiss} className="press shrink-0 cursor-pointer rounded-md px-2 py-1 text-meta text-text hover:bg-hairline">
        {copy.list.hintDismiss}
      </button>
    </div>
  );
}

// ---------- Rows ----------

const STATUS_CHIP: Record<Exclude<Finding["status"], "new">, { text: string; className: string }> = {
  approved: { text: copy.shared.decided.approved, className: "text-positive border-positive/30" },
  snoozed: { text: copy.shared.decided.snoozed, className: "text-faint border-hairline" },
  dismissed: { text: copy.shared.decided.dismissed, className: "text-faint border-hairline" },
};

/** A deadline's colour: amber only when it is within a week. */
export const DEADLINE_TONE: Record<Urgency, string> = {
  soon: "bg-amber-glow text-amber",
  near: "text-text",
  later: "text-muted",
  none: "text-faint",
};

/** The row's dot says how pressing it is: amber within a week, solid within two, a ring after that. */
const URGENCY_DOT: Record<Urgency, string> = {
  soon: "bg-amber",
  near: "bg-muted",
  later: "border border-muted",
  none: "border border-faint",
};

export function DeadlineChip({ date }: { date: string }) {
  const days = daysUntil(date);
  return (
    <Tip content={copy.dates.days(days)}>
      <span className={`inline-flex h-5 items-center rounded-full px-2 figure text-label ${DEADLINE_TONE[urgency(date)]}`}>{shortDate(date)}</span>
    </Tip>
  );
}

export type RowAction = "approve" | "snooze" | "dismiss" | "remind";

/**
 * The selected row's quick menu: a ⋯ button that opens Approve, Snooze and
 * Not a leak, each with its key (A, S, D still work without opening it). It
 * opens downwards, or upwards when the row is near the bottom of the list.
 * `startOpen` shows it open without a click (the dev gallery only).
 */
function RowMenu({ finding, onAct, startOpen = false }: { finding: Finding; onAct: (action: RowAction) => void; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const button = useRef<HTMLButtonElement>(null);
  const approve = finding.draft ? copy.actions.approve : finding.action.kind === "none" ? copy.actions.markHandled : copy.actions.approve;
  const choose = (action: RowAction) => () => onAct(action);
  const scan = useScan();
  const open_ = finding.status === "new";
  // Remind me: greyed out with the reason when there's no calendar, or once one is set.
  const noCalendar = scan.result?.notConnected?.includes("calendar");
  const reminder = scan.reminders[finding.id];
  const remindLabel = noCalendar ? copy.actions.remindNoCalendar : reminder ? copy.actions.remindSet(shortDate(reminder.date)) : copy.actions.remind;
  return (
    // Clicks here act on the row; they must not also open it.
    <span className="flex w-7 shrink-0 justify-end" onClick={(e) => e.stopPropagation()}>
      <Menu
        open={open}
        onOpenChange={(next) => {
          if (next) {
            // Open upwards when the row sits in the lower half of its list.
            const list = button.current?.closest("[data-row-list]");
            const r = button.current?.getBoundingClientRect();
            const l = list?.getBoundingClientRect();
            if (r && l) setSide(r.top > l.top + l.height / 2 ? "top" : "bottom");
          }
          setOpen(next);
        }}
        side={side}
        align="end"
        label={copy.list.quickActions}
        // A, S and D work with the menu open too, as its rows say.
        shortcuts={open_ ? { a: choose("approve"), s: choose("snooze"), d: choose("dismiss"), l: choose("remind") } : { l: choose("remind") }}
        trigger={
          <Tip content={copy.list.quickActions}>
            <button
              ref={button}
              type="button"
              tabIndex={-1}
              aria-label={copy.list.quickActionsFor(finding.merchant)}
              className={`press grid size-6 cursor-pointer place-items-center rounded-md hover:bg-hairline hover:text-text ${open ? "bg-hairline text-text" : "text-muted"}`}
            >
              <Ellipsis size={15} strokeWidth={1.75} aria-hidden="true" className="block" />
            </button>
          </Tip>
        }
      >
        {open_ && (
          <>
            <MenuItem icon={<ApproveIcon />} label={approve} keys={<Kbd keys={["A"]} />} onSelect={choose("approve")} />
            <MenuItem icon={<SnoozeIcon />} label={copy.actions.snooze} keys={<Kbd keys={["S"]} />} onSelect={choose("snooze")} />
            <MenuItem icon={<DismissIcon />} label={copy.actions.notALeak} keys={<Kbd keys={["D"]} />} onSelect={choose("dismiss")} />
          </>
        )}
        <MenuItem icon={<RemindIcon />} label={remindLabel} keys={<Kbd keys={["L"]} />} disabled={!!noCalendar || !!reminder} onSelect={choose("remind")} />
      </Menu>
    </span>
  );
}

// Column widths, shared by every kind of row so the columns line up. The
// name gets the room the description used to take; kind (or a row's status)
// is a fixed column, so every kind starts at the same place; amount and date
// stay on the right edge, where all the money in the app lines up.
const COL = {
  name: "w-[220px] shrink-0 truncate",
  kind: "flex w-[150px] shrink-0 items-center",
  amount: "w-[88px] shrink-0 text-right",
  date: "flex w-[60px] shrink-0 justify-end",
  menu: "w-7 shrink-0",
};

function FindingRow({ finding }: { finding: Finding }) {
  const amount = headlineAmount(finding);
  const done = finding.status !== "new";
  // Only a check that is part live, part saved labels rows; otherwise the banner says it.
  const saved = mixedReplay(useScan()) && fromSaved(finding);
  const dot = done ? (finding.status === "approved" ? "bg-positive" : "bg-faint") : URGENCY_DOT[urgency(finding.deadline?.date)];
  const status = done ? STATUS_CHIP[finding.status as keyof typeof STATUS_CHIP] : undefined;
  // Approved with nothing to send reads "Handled", not "Ready to send".
  const statusText = finding.status === "approved" && !finding.draft ? copy.shared.decided.handled : status?.text;
  return (
    <>
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className={`${COL.name} font-semibold ${done ? "font-normal text-muted" : ""}`}>{finding.merchant}</span>
      {/* The chips belong to the name's side of the gap, right up against the kind. */}
      <span className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {!done && saved && <SavedTag />}
        {!done && isUnsure(finding) && <NotSureChip />}
      </span>
      <span className={COL.kind}>
        {status ? (
          <span className={`rounded-full border px-2 py-px text-meta ${status.className}`}>{statusText}</span>
        ) : (
          // The kind is context, not news: quiet text, no pill.
          <span className="truncate text-meta text-faint">{copy.shared.kind[finding.kind]}</span>
        )}
      </span>
      {/* Amount and deadline lead the row: the brightest figures, in fixed columns. */}
      <span className={`${COL.amount} figure text-body ${done ? "text-faint line-through decoration-faint/60" : "text-text"}`}>
        {amount ? <CountUp id={`row:${finding.id}`} cents={amount.cents} /> : ""}
      </span>
      <span className={COL.date}>{finding.deadline && !done ? <DeadlineChip date={finding.deadline.date} /> : null}</span>
    </>
  );
}

/** The agent isn't sure: its own status, so info, not amber. */
export function NotSureChip() {
  return <span className="shrink-0 rounded-full border border-info/30 px-2 py-px text-meta text-info">{copy.shared.notSure}</span>;
}

function groupTitle(count: number, title: string, flipKey = title) {
  if (!count) return null;
  return (
    // A steady key, so a title whose count changes still slides rather than reappears.
    <h2 data-flip-key={`group:${flipKey}`} className="mt-3 mb-1 px-2.5 label text-faint">
      {title}
    </h2>
  );
}

// The selected row is the only highlighted one: one highlight (the raised
// block with the bar on its left) slides to it (useGlide). Moving the mouse
// moves it; so do J/K. There is no separate hover style, so the two can never
// point at different rows.
const ROW = "row-press group/row relative flex h-8 cursor-pointer items-center gap-3 rounded-md px-2.5 text-body";

export function FindingsList({
  items,
  allFindings,
  selectedKey,
  scrollKey,
  mouse,
  onHover,
  onOpen,
  onAct,
  scan,
  showHint,
  onDismissHint,
  query,
  open: groupIsOpen,
  onToggleGroup,
  filters = [],
  onRemoveFilter,
  onClearFilters,
  holdHover = false,
}: {
  /** Every row that matches the search (listItems), the closed group's rows included. */
  items: ListItem[];
  /** Every finding, before search filters the list (the headline counts these). */
  allFindings: Finding[];
  selectedKey?: string;
  /** Changes only when the keyboard moves the selection: the list scrolls to follow it then, never on hover. */
  scrollKey: number;
  /** True while the mouse is in use (until the next key press). */
  mouse: boolean;
  /** The pointer really moved over a row (not the list scrolling under a still pointer). */
  onHover: (key: string) => void;
  onOpen: (key: string) => void;
  onAct: (action: RowAction, key: string) => void;
  scan: ScanState;
  showHint: boolean;
  onDismissHint: () => void;
  /** The top bar's search (the rows are already filtered by it). */
  query: string;
  /** Whether "Checked and left alone" is open (groupOpen). */
  open: boolean;
  onToggleGroup: (open: boolean) => void;
  /** The filters that are on (the rows in `items` already pass them). */
  filters?: FilterId[];
  onRemoveFilter: (id: FilterId) => void;
  onClearFilters: () => void;
  /** Dev gallery only: show the selected row's quick menu open. */
  holdHover?: boolean;
}) {
  const live = useLive();
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // Rows slide to their new places when one is decided or undone. Searching,
  // filtering, and opening or closing the group (it animates its own height), put rows
  // straight in their places instead.
  useFlip(rowsRef, `${query}|${filters.join()}|${groupIsOpen}`);
  useGlide(rowsRef, highlightRef);
  const findings = items.flatMap((i) => (i.type === "finding" && !leftAlone(i) && !isApproved(i) ? [i.finding] : []));
  const approved = items.flatMap((i) => (isApproved(i) && i.type === "finding" ? [i.finding] : []));
  const undecided = items.filter((i) => i.type === "undecided");
  const inside = items.filter(leftAlone);
  const missing = Object.values(live.statuses).filter((s) => s && (s.state === "needs_reconnect" || s.state === "error"));
    const notConnected = (scan.result?.notConnected ?? []).map((id) => copy.shared.source[id]);
  const remaining =
    scan.phase === "scanning" && scan.stage === "judge" && scan.progress ? scan.progress.total - scan.progress.done : undefined;

  // Keep the selected row in view as J/K move.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [scrollKey]);

  const rowProps = (key: string, group: string) =>
    ({
      "data-flip-key": key,
      "data-flip-group": group,
      role: "option",
      "aria-selected": key === selectedKey,
      // Only real pointer movement counts: when the list scrolls under a still
      // pointer the browser can send a move event with no movement.
      onMouseMove: (e: React.MouseEvent) => {
        if (e.movementX !== 0 || e.movementY !== 0) onHover(key);
      },
    }) as const;

  const row = (item: ListItem): React.ReactNode => {
    const selected = item.key === selectedKey;
    const common = {
      ...rowProps(item.key, leftAlone(item) ? "cleared" : isApproved(item) ? "approved" : item.type === "finding" ? (item.finding.status === "new" ? "open" : "done") : item.type),
      onClick: () => onOpen(item.key),
    };
    if (item.type === "finding")
      return (
        <div key={item.key} {...common} className={ROW}>
          <FindingRow finding={item.finding} />
          {/* The quick menu on the selected row; the same width is kept on other rows so the columns line up. */}
          {selected && (item.finding.status === "new" || item.finding.status === "approved") ? (
            <RowMenu finding={item.finding} onAct={(action) => onAct(action, item.key)} startOpen={holdHover} />
          ) : (
            <span className={COL.menu} aria-hidden="true" />
          )}
        </div>
      );
    if (item.type === "undecided")
      return (
        <Tip key={item.key} content={item.error}>
          <div {...common} className={ROW}>
            <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />
            <span className={`${COL.name} font-semibold`}>{item.merchant}</span>
            {/* The reason is in the tooltip; screen readers get it with the row. */}
            <span className="sr-only">{item.error}</span>
            <span className="min-w-0 flex-1" aria-hidden="true" />
            {/* In the kind column, like a finding's chips and kinds; empty amount, date and menu columns. */}
            <span className={COL.kind}>
              <NotSureChip />
            </span>
            <span className={COL.amount} aria-hidden="true" />
            <span className={COL.date} aria-hidden="true" />
            <span className={COL.menu} aria-hidden="true" />
          </div>
        </Tip>
      );
    if (item.type === "cleared")
      return (
        <div key={item.key} {...common} className={ROW}>
          <span className="size-1.5 shrink-0 rounded-full border border-positive/70" aria-hidden="true" />
          <span className={`${COL.name} text-muted`}>{item.cleared.merchant}</span>
          <span className="min-w-0 flex-1" aria-hidden="true" />
          <span className={`${COL.kind} text-meta text-positive`}>{copy.shared.looksFine}</span>
          <span className={COL.amount} aria-hidden="true" />
          <span className={COL.date} aria-hidden="true" />
          <span className={COL.menu} aria-hidden="true" />
        </div>
      );
    return null;
  };

  const headerSelected = selectedKey === CLEARED_GROUP;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned: the heading stays put while the rows scroll. */}
      <Headline
        findings={allFindings}
        scan={scan}
        query={query}
        matches={items}
        filters={filters}
        chips={<FilterChips active={filters} mouse={mouse} onRemove={onRemoveFilter} onClear={onClearFilters} />}
      />
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {showHint && findings.length + approved.length > 0 && <FirstRunHint onDismiss={onDismissHint} />}
        {scan.phase === "error" && (
          <p className="mx-3 mb-2 rounded-lg border border-danger/25 bg-danger/[0.07] px-3.5 py-2 text-small text-muted">
            <KeyText text={copy.list.stoppedEarly} slots={{ error: scan.error }} />
          </p>
        )}
        {notConnected.length > 0 && (
          <p className="mx-3 mb-2 rounded-lg border border-hairline px-3.5 py-2 text-small text-muted">
            {copy.list.notConnected(notConnected)}
          </p>
        )}
        {missing.length > 0 && (
          <p className="mx-3 mb-2 rounded-lg border border-danger/25 bg-danger/[0.07] px-3.5 py-2 text-small text-muted">
            <KeyText text={copy.list.couldntRead(missing.map((s) => s!.name))} />
          </p>
        )}
        <div ref={rowsRef} role="listbox" aria-label={copy.list.label} data-row-list className="relative flex flex-col px-1.5">
          <div ref={highlightRef} className="glide inset-x-1.5" aria-hidden="true" />
          {findings.map((f) => row({ type: "finding", key: f.id, finding: f }))}
          {remaining !== undefined && remaining > 0 && (
            <div data-flip-key="pending" className="flex h-8 items-center gap-2.5 px-2.5 text-small text-faint">
              <span className="size-1.5 rounded-full bg-info/60 motion-safe:animate-pulse" aria-hidden="true" />
              {copy.list.stillDeciding(remaining)}
              <span className="shimmer ml-1 h-2 flex-1 rounded-full" aria-hidden="true" />
            </div>
          )}
          {/* "Approved" stays open, like "Couldn't decide": a plain title, not a J/K stop. */}
          {groupTitle(approved.length, copy.list.approvedGroup(approved.length), "approved")}
          {approved.map((f) => row({ type: "finding", key: f.id, finding: f }))}
          {/* "Couldn't decide" stays open: it needs Maya. */}
          {groupTitle(undecided.length, copy.list.undecidedGroup)}
          {undecided.map(row)}
          {/* "Checked and left alone" folds away: nothing in it needs her. The
              palette owns the keys (J/K stop on the header, Enter or Space
              opens it), so the header never takes focus from the panel. */}
          {inside.length > 0 && (
            <Accordion.Root
              type="single"
              collapsible
              value={groupIsOpen ? CLEARED_GROUP : ""}
              onValueChange={(value) => onToggleGroup(value === CLEARED_GROUP)}
              className="mt-2"
            >
              <Accordion.Item value={CLEARED_GROUP} data-glide-rows>
                <Accordion.Trigger asChild>
                  <div {...rowProps(CLEARED_GROUP, "header")} className={ROW}>
                    {/* Starts where the "Couldn't decide" title does, so the two group names line up. */}
                    <span className={`label ${headerSelected ? "text-muted" : "text-faint"}`}>{copy.list.clearedGroup}</span>
                    <span className="-ml-1.5 rounded-full border border-hairline px-1.5 figure text-label text-faint">{inside.length}</span>
                    <ChevronRight
                      size={12}
                      strokeWidth={2}
                      aria-hidden="true"
                      className={`accordion-chevron -ml-1.5 shrink-0 ${headerSelected ? "text-muted" : "text-faint"}`}
                    />
                    <span className="flex-1" />
                    {headerSelected && !mouse && <Kbd keys={["↵"]} />}
                    <span className={COL.menu} aria-hidden="true" />
                  </div>
                </Accordion.Trigger>
                <Accordion.Content data-glide-rows data-flip-off={groupIsOpen ? undefined : ""} className="accordion-content flex flex-col">
                  {inside.map(row)}
                </Accordion.Content>
              </Accordion.Item>
            </Accordion.Root>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Whole-area states ----------

function StateFrame({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      <div className="mb-4 grid size-10 place-items-center rounded-full border border-hairline bg-raised">{icon}</div>
      <h1 className="heading text-heading font-semibold">{title}</h1>
      <div className="mt-1.5 max-w-[48ch] text-muted">{children}</div>
    </section>
  );
}

/** While the check runs and nothing has been found yet: show the work. */
export function Scanning({ scan }: { scan: ScanState }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col px-4 pt-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="scan-ring size-8 rounded-full border border-info/30" aria-hidden="true" />
        <div>
          <h1 className="heading text-heading font-semibold">{copy.list.scanningTitle}</h1>
          <p className="text-small text-muted">{copy.list.scanningLine}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pl-1">
        <TraceLines lines={scan.trace} limit={9} />
        <SlowDocuments />
      </div>
    </section>
  );
}

/** A loading skeleton while document reads are taking a long time. */
function SlowDocuments() {
  const { slowReads } = useLive();
  if (!slowReads) return null;
  return (
    <div role="status" className="fade-in mt-3 max-w-[420px] rounded-lg border border-hairline px-3 py-2.5">
      <p className="text-meta text-muted">{copy.list.slowDocuments(slowReads.done)}</p>
      <div className="mt-2 flex flex-col gap-1.5" aria-hidden="true">
        <span className="shimmer h-2 w-3/4 rounded-full" />
        <span className="shimmer h-2 w-1/2 rounded-full" />
      </div>
    </div>
  );
}

export function AllClear({ checked }: { checked: number }) {
  return (
    <StateFrame
      title={copy.list.allClearTitle}
      icon={
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="text-positive">
          <path d="m5.5 10.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      }
    >
      <p>
        <KeyText text={copy.list.allClearBody(checked)} />
      </p>
    </StateFrame>
  );
}

export function ScanError({ message }: { message: string }) {
  return (
    <StateFrame
      title={copy.list.errorTitle}
      icon={
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="text-danger">
          <path d="M10 6v5M10 14v.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      }
    >
      <p>{message}</p>
      <p className="mt-2 text-faint">
        <KeyText text={copy.list.errorHint} />
      </p>
    </StateFrame>
  );
}

export function NotChecked() {
  return (
    <StateFrame title={copy.list.notCheckedTitle} icon={<span className="size-2 rounded-full bg-faint" />}>
      <p>
        <KeyText text={copy.list.notCheckedBody} />
      </p>
    </StateFrame>
  );
}
