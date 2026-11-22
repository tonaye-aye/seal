import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import * as Accordion from "@radix-ui/react-accordion";
import { Menu, MenuItem, Tip } from "../layers";
import type { Cleared, Finding } from "../../agent/pipeline";
import { useLive } from "../../connectors/live";
import { useScan, type ScanState } from "../../lib/scan-store";
import { fromSaved, mixedReplay } from "../replay";
import { headlineAmount, shortDate, urgency, type Urgency } from "../format";
import { copy } from "../../copy";
import { KeyText } from "../KeyText";
import { ApproveIcon, DismissIcon, SealIcon, RemindIcon } from "../icons";
import { sealTarget } from "../seal";
import { Kbd } from "../Kbd";
import { useCountUp, useFlip, useGlide, useScrollFade } from "../motion";
import { HeadingTotal, ViewHeading } from "./ViewHeading";
import { FilterChips } from "./Filters";
import { ClearedCells, FindingCells, GroupLabel, MENU_SLOT, ROW, ROW_SHAPE, UndecidedCells } from "./ListRow";
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
  const narrowed = !!q || filtered;
  const hits = matches.flatMap((i) => (i.type === "finding" && i.finding.status === "new" ? [i.finding] : []));
  // What the rows that still need Maya add up to. While searching or filtering, only the ones showing.
  const totalCents = (narrowed ? hits : open).reduce((n, f) => n + (headlineAmount(f)?.cents ?? 0), 0);
  const counted = useCountUp(narrowed ? "list:search" : "list:total", totalCents);
  const total = totalCents > 0 ? <HeadingTotal cents={narrowed ? totalCents : counted} label={copy.list.inTotal} /> : undefined;

  if (narrowed) {
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
      <ViewHeading title={title} below={chips} action={total}>
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
  else line = copy.list.needAttentionLine;

  return (
    <ViewHeading title={title} action={total}>
      {line}
    </ViewHeading>
  );
}

// ---------- First-run hint ----------

// Notes above the rows: the box matches the row highlight, and the words start at the tile's edge.
const NOTE = "mx-1.5 mb-2 rounded-md px-2.5 py-2 text-small text-muted";

export function FirstRunHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className={`${NOTE} flex items-start justify-between gap-3 bg-raised/60`}>
      <div>
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

/** An open finding's deadline chip colour: amber only when it is within a week. */
export const DEADLINE_TONE: Record<Urgency, string> = {
  soon: "bg-amber-glow text-amber",
  near: "text-text",
  later: "text-muted",
  none: "text-faint",
};

export type RowAction = "approve" | "seal" | "dismiss" | "remind";

/**
 * The selected row's quick menu: a ⋯ button that opens Approve and Not a
 * leak (or, once approved, Seal the leak), and Remind me, each with its key
 * (A, S, D, L still work without opening it). It
 * opens downwards, or upwards when the row is near the bottom of the list.
 * `startOpen` shows it open without a click (the dev gallery only).
 */
function RowMenu({ finding, onAct, startOpen = false }: { finding: Finding; onAct: (action: RowAction) => void; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const button = useRef<HTMLButtonElement>(null);
  const choose = (action: RowAction) => () => onAct(action);
  const scan = useScan();
  const open_ = finding.status === "new";
  // Approved: Seal the leak opens Mail, a call or Calendar for it.
  const canSeal = finding.status === "approved" && !!sealTarget(finding, scan.corpus, scan);
  // Remind me: greyed out with the reason when there's no calendar, or once one is set.
  const noCalendar = scan.result?.notConnected?.includes("calendar");
  const reminder = scan.reminders[finding.id];
  const remindLabel = noCalendar ? copy.actions.remindNoCalendar : reminder ? copy.actions.remindSet(shortDate(reminder.date)) : copy.actions.remind;
  return (
    // Clicks here act on the row; they must not also open it.
    <span className={MENU_SLOT} onClick={(e) => e.stopPropagation()}>
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
        // The rows' keys work with the menu open too.
        shortcuts={open_ ? { a: choose("approve"), d: choose("dismiss"), l: choose("remind") } : canSeal ? { s: choose("seal"), l: choose("remind") } : { l: choose("remind") }}
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
            <MenuItem icon={<ApproveIcon />} label={copy.actions.approve} keys={<Kbd keys={["A"]} />} onSelect={choose("approve")} />
            <MenuItem icon={<DismissIcon />} label={copy.actions.notALeak} keys={<Kbd keys={["D"]} />} onSelect={choose("dismiss")} />
          </>
        )}
        {canSeal && <MenuItem icon={<SealIcon />} label={copy.actions.seal} keys={<Kbd keys={["S"]} />} onSelect={choose("seal")} />}
        <MenuItem icon={<RemindIcon />} label={remindLabel} keys={<Kbd keys={["L"]} />} disabled={!!noCalendar || !!reminder} onSelect={choose("remind")} />
      </Menu>
    </span>
  );
}

// ---------- Groups ----------

type FindingItem = Extract<ListItem, { type: "finding" }>;

/** The three groups of findings that still need Maya, most pressing first. */
const OPEN_GROUPS = ["soon", "coming", "none"] as const;

function openGroup(f: Finding): (typeof OPEN_GROUPS)[number] {
  const due = urgency(f.deadline?.date);
  return due === "soon" ? "soon" : due === "none" ? "none" : "coming";
}

// Space above each group, except one that starts the list (right after the highlight).
const GROUP_GAP = "mt-3 [.glide+&]:mt-0";

function GroupTitle({ id, label, count }: { id: string; label: string; count: number }) {
  if (!count) return null;
  return (
    // A steady key, so a title whose count changes still slides rather than reappears.
    // `relative` keeps the words above the highlight as it slides past.
    <h2 data-flip-key={`group:${id}`} className={`${GROUP_GAP} relative flex h-6 items-center gap-1.5 px-2.5 text-meta font-medium`}>
      <GroupLabel label={label} count={count} />
    </h2>
  );
}

// The selected row is the only highlighted one: one soft block slides to it
// (useGlide). Moving the mouse moves it; so do J/K. There is no separate hover
// style, so the two can never point at different rows.

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
  useScrollFade(listRef);
  const rowsRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // Rows slide to their new places when one is decided or undone. Searching,
  // filtering, and opening or closing the group (it animates its own height), put rows
  // straight in their places instead.
  useFlip(rowsRef, `${query}|${filters.join()}|${groupIsOpen}`);
  useGlide(rowsRef, highlightRef);
  const main = items.filter((i): i is FindingItem => i.type === "finding" && !leftAlone(i) && !isApproved(i));
  // Already ranked by date, so each group is one unbroken run and J/K follow the order drawn.
  const open = main.filter((i) => i.finding.status === "new");
  // Only older saved decisions can be snoozed: they stay after the open groups.
  const snoozed = main.filter((i) => i.finding.status !== "new");
  const approved = items.filter(isApproved);
  const undecided = items.filter((i) => i.type === "undecided");
  const inside = items.filter(leftAlone);
  // Only a check that is part live, part saved labels rows; otherwise the banner says it.
  const labelSaved = mixedReplay(scan);
  const missing = Object.values(live.statuses).filter((s) => s && (s.state === "needs_reconnect" || s.state === "error"));
    const notConnected = (scan.result?.notConnected ?? []).map((id) => copy.shared.source[id]);

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

  // `leads` marks a group's first row: J/K scrolling then brings its header into view too.
  const row = (item: ListItem, leads = false): React.ReactNode => {
    const selected = item.key === selectedKey;
    const common = {
      ...rowProps(item.key, leftAlone(item) ? "cleared" : isApproved(item) ? "approved" : item.type === "finding" ? (item.finding.status === "new" ? "open" : "done") : item.type),
      onClick: () => onOpen(item.key),
    };
    const className = leads ? `${ROW} scroll-mt-9` : ROW;
    if (item.type === "finding")
      return (
        <div key={item.key} {...common} className={className}>
          <FindingCells finding={item.finding} saved={labelSaved && fromSaved(item.finding)} />
          {/* The quick menu on the selected row; the same width is kept on other rows so the columns line up. */}
          {selected && (item.finding.status === "new" || item.finding.status === "approved") ? (
            <RowMenu finding={item.finding} onAct={(action) => onAct(action, item.key)} startOpen={holdHover} />
          ) : (
            <span className={MENU_SLOT} aria-hidden="true" />
          )}
        </div>
      );
    if (item.type === "undecided")
      return (
        <Tip key={item.key} content={item.error}>
          <div {...common} className={className}>
            <UndecidedCells merchant={item.merchant} error={item.error} />
            <span className={MENU_SLOT} aria-hidden="true" />
          </div>
        </Tip>
      );
    if (item.type === "cleared")
      return (
        <div key={item.key} {...common} className={className}>
          <ClearedCells merchant={item.cleared.merchant} />
          <span className={MENU_SLOT} aria-hidden="true" />
        </div>
      );
    return null;
  };
  const groupRows = (rows: ListItem[]) => rows.map((item, i) => row(item, i === 0));

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
      <div ref={listRef} className="scroll-fade min-h-0 flex-1 overflow-y-auto pb-2">
        {showHint && main.length + approved.length > 0 && <FirstRunHint onDismiss={onDismissHint} />}
        {scan.phase === "error" && (
          <p className={`${NOTE} bg-danger/[0.07]`}>
            <KeyText text={copy.list.stoppedEarly} slots={{ error: scan.error }} />
          </p>
        )}
        {notConnected.length > 0 && (
          <p className={`${NOTE} bg-raised/60`}>
            {copy.list.notConnected(notConnected)}
          </p>
        )}
        {missing.length > 0 && (
          <p className={`${NOTE} bg-danger/[0.07]`}>
            <KeyText text={copy.list.couldntRead(missing.map((s) => s!.name))} />
          </p>
        )}
        <div ref={rowsRef} role="listbox" aria-label={copy.list.label} data-row-list className="relative flex flex-col px-1.5">
          <div ref={highlightRef} className="glide glide-soft inset-x-1.5" aria-hidden="true" />
          {/* Headers sit beside the rows, not around them: the highlight and the row motion need rows kept flat. */}
          {OPEN_GROUPS.map((id) => {
            const rows = open.filter((i) => openGroup(i.finding) === id);
            return (
              <Fragment key={id}>
                <GroupTitle id={id} label={copy.list.groups[id]} count={rows.length} />
                {groupRows(rows)}
              </Fragment>
            );
          })}
          {snoozed.map((i) => row(i))}
          {/* "Approved" stays open, like "Couldn't decide": a plain title, not a J/K stop. */}
          <GroupTitle id="approved" label={copy.list.groups.approved} count={approved.length} />
          {groupRows(approved)}
          {/* "Couldn't decide" stays open: it needs Maya. */}
          <GroupTitle id="undecided" label={copy.list.groups.undecided} count={undecided.length} />
          {groupRows(undecided)}
          {/* "Checked and left alone" folds away: nothing in it needs her. The
              palette owns the keys (J/K stop on the header, Enter or Space
              opens it), so the header never takes focus from the panel. */}
          {inside.length > 0 && (
            <Accordion.Root
              type="single"
              collapsible
              value={groupIsOpen ? CLEARED_GROUP : ""}
              onValueChange={(value) => onToggleGroup(value === CLEARED_GROUP)}
              // A little less than the other groups: this header is 4 px taller, so its words land the same distance down.
              className="mt-2.5 [.glide+&]:mt-0"
            >
              <Accordion.Item value={CLEARED_GROUP} data-glide-rows>
                <Accordion.Trigger asChild>
                  <div {...rowProps(CLEARED_GROUP, "header")} className={`${ROW_SHAPE} h-7 gap-1.5 text-meta font-medium`}>
                    <GroupLabel label={copy.list.clearedGroup} count={inside.length} selected={headerSelected} />
                    <ChevronRight
                      size={12}
                      strokeWidth={2}
                      aria-hidden="true"
                      className={`accordion-chevron shrink-0 ${headerSelected ? "text-muted" : "text-faint"}`}
                    />
                    <span className="flex-1" />
                    {headerSelected && !mouse && <Kbd keys={["↵"]} />}
                    <span className={MENU_SLOT} aria-hidden="true" />
                  </div>
                </Accordion.Trigger>
                <Accordion.Content data-glide-rows data-flip-off={groupIsOpen ? undefined : ""} className="accordion-content flex flex-col">
                  {groupRows(inside)}
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
