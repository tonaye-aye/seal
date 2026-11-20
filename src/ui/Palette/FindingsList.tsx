import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { Menu, MenuItem, Tip } from "../layers";
import type { Cleared, Finding } from "../../agent/pipeline";
import { useLive } from "../../connectors/live";
import { useScan, type ScanState } from "../../lib/scan-store";
import { fromSaved, mixedReplay, SavedTag } from "../replay";
import { daysUntil, headlineAmount, isUnsure, shortDate, urgency, type Urgency } from "../format";
import { copy } from "../../copy";
import { KeyText } from "../KeyText";
import { ApproveIcon, DismissIcon, SnoozeIcon } from "../icons";
import { Kbd } from "../Kbd";
import { CountUp } from "../CountUp";
import { useFlip, useGlide } from "../motion";
import { TraceLines } from "./Trace";
import { ViewHeading } from "./ViewHeading";

// The palette's main view: a plain-words headline, then one row per finding,
// most urgent first. Keyboard first (J/K/Enter/A/S/D); the Palette owns the
// keys, this only draws.

export type ListItem =
  | { type: "finding"; key: string; finding: Finding }
  | { type: "undecided"; key: string; merchant: string; error: string }
  | { type: "cleared"; key: string; cleared: Cleared };

export function listItems(findings: Finding[], scan: ScanState, query: string): ListItem[] {
  const q = query.trim().toLowerCase();
  const match = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  return [
    ...findings
      .filter((f) => match(f.merchant, f.title, copy.shared.kind[f.kind]))
      .map((f): ListItem => ({ type: "finding", key: f.id, finding: f })),
    ...scan.undecided
      .filter((u) => match(u.merchant))
      .map((u): ListItem => ({ type: "undecided", key: u.id, merchant: u.merchant, error: u.error })),
    ...scan.cleared
      .filter((c) => match(c.merchant, c.title))
      .map((c): ListItem => ({ type: "cleared", key: c.id, cleared: c })),
  ];
}

// ---------- Headline ----------

export function Headline({
  findings,
  scan,
  search,
  query = "",
  matches = [],
}: {
  findings: Finding[];
  scan: ScanState;
  search?: React.ReactNode;
  /** While searching, the heading describes the matching rows instead of the month. */
  query?: string;
  matches?: ListItem[];
}) {
  const open = findings.filter((f) => f.status === "new");
  const scanning = scan.phase === "scanning";
  const q = query.trim();

  if (q) {
    const hits = matches.flatMap((i) => (i.type === "finding" && i.finding.status === "new" ? [i.finding] : []));
    const fine = matches.filter((i) => i.type === "cleared").length;
    const hitBack = hits.reduce((n, f) => n + (f.amounts.recoverable ?? 0), 0);
    const hitMonthly = hits.reduce((n, f) => n + (f.amounts.perMonth ?? 0), 0);
    const words: string[] = [];
    if (matches.length === 0) words.push(copy.list.searchHelp);
    else {
      words.push(copy.list.searchOfOpen(hits.length, open.length));
      if (fine) words.push(copy.list.searchCleared(fine));
      if (hitBack > 0) words.push(copy.list.searchBack(hitBack));
      if (hitMonthly > 0) words.push(copy.list.searchMonthly(hitMonthly));
    }
    return (
      <ViewHeading
        view="list"
        title={matches.length ? copy.search.matches(matches.length, q) : copy.search.noMatches(q)}
        search={search}
      >
        {words.join(", ")}.
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
    <ViewHeading view="list" title={title} search={search}>
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

export type RowAction = "approve" | "snooze" | "dismiss";

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
        shortcuts={{ a: choose("approve"), s: choose("snooze"), d: choose("dismiss") }}
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
        <MenuItem icon={<ApproveIcon />} label={approve} keys={<Kbd keys={["A"]} />} onSelect={choose("approve")} />
        <MenuItem icon={<SnoozeIcon />} label={copy.actions.snooze} keys={<Kbd keys={["S"]} />} onSelect={choose("snooze")} />
        <MenuItem icon={<DismissIcon />} label={copy.actions.notALeak} keys={<Kbd keys={["D"]} />} onSelect={choose("dismiss")} />
      </Menu>
    </span>
  );
}

function FindingRow({ finding, selected }: { finding: Finding; selected: boolean }) {
  const amount = headlineAmount(finding);
  const done = finding.status !== "new";
  // Only a check that is part live, part saved labels rows; otherwise the banner says it.
  const saved = mixedReplay(useScan()) && fromSaved(finding);
  const dot = done ? (finding.status === "approved" ? "bg-positive" : "bg-faint") : URGENCY_DOT[urgency(finding.deadline?.date)];
  return (
    <>
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className={`w-[140px] shrink-0 truncate font-semibold ${done ? "font-normal text-muted" : ""}`}>{finding.merchant}</span>
      <span className={`min-w-0 flex-1 truncate ${selected ? "text-muted" : "text-faint"}`}>{finding.title}</span>
      {done ? (
        <span className={`shrink-0 rounded-full border px-2 py-px text-meta ${STATUS_CHIP[finding.status as keyof typeof STATUS_CHIP].className}`}>
          {STATUS_CHIP[finding.status as keyof typeof STATUS_CHIP].text}
        </span>
      ) : (
        <>
          {saved && <SavedTag />}
          {isUnsure(finding) && <NotSureChip />}
          {/* The kind is context, not news: quiet text, no pill. */}
          <span className="shrink-0 text-meta text-faint">{copy.shared.kind[finding.kind]}</span>
        </>
      )}
      {/* Amount and deadline lead the row: the brightest figures, in fixed columns. */}
      <span className={`w-[88px] shrink-0 text-right figure text-body ${done ? "text-faint line-through decoration-faint/60" : "text-text"}`}>
        {amount ? <CountUp id={`row:${finding.id}`} cents={amount.cents} /> : ""}
      </span>
      <span className="flex w-[60px] shrink-0 justify-end">{finding.deadline && !done ? <DeadlineChip date={finding.deadline.date} /> : null}</span>
    </>
  );
}

/** The agent isn't sure: its own status, so info, not amber. */
export function NotSureChip() {
  return <span className="shrink-0 rounded-full border border-info/30 px-2 py-px text-meta text-info">{copy.shared.notSure}</span>;
}

function groupTitle(count: number, title: string) {
  if (!count) return null;
  return (
    <h2 data-flip-key={`group:${title}`} className="mt-3 mb-1 px-2.5 label text-faint">
      {title}
    </h2>
  );
}

// The selected row is the only highlighted one: one highlight (the raised
// block with the bar on its left) slides to it (useGlide). Moving the mouse
// moves it; so do J/K. There is no separate hover style, so the two can never
// point at different rows.
const ROW = "row-press group/row relative flex h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 text-body";

export function FindingsList({
  items,
  allFindings,
  selectedKey,
  scrollKey,
  onHover,
  onOpen,
  onAct,
  scan,
  showHint,
  onDismissHint,
  query,
  search,
  holdHover = false,
}: {
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
  query: string;
  /** The search bar, pinned under the heading. */
  search: React.ReactNode;
  /** Dev gallery only: show the selected row's quick menu open. */
  holdHover?: boolean;
}) {
  const live = useLive();
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // Rows slide to their new places when one is decided or undone (not while searching).
  useFlip(rowsRef, query);
  useGlide(rowsRef, highlightRef);
  const findings = items.flatMap((i) => (i.type === "finding" ? [i.finding] : []));
  const rest = items.filter((i) => i.type !== "finding");
  const missing = Object.values(live.statuses).filter((s) => s && (s.state === "needs_reconnect" || s.state === "error"));
    const notConnected = (scan.result?.notConnected ?? []).map((id) => copy.shared.source[id]);
  const remaining =
    scan.phase === "scanning" && scan.stage === "judge" && scan.progress ? scan.progress.total - scan.progress.done : undefined;

  // Keep the selected row in view as J/K move.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [scrollKey]);

  const row = (item: ListItem): React.ReactNode => {
    const selected = item.key === selectedKey;
    const common = {
      "data-flip-key": item.key,
      "data-flip-group": item.type === "finding" ? (item.finding.status === "new" ? "open" : "done") : item.type,
      role: "option",
      "aria-selected": selected,
      onClick: () => onOpen(item.key),
      // Only real pointer movement counts: when the list scrolls under a still
      // pointer the browser can send a move event with no movement.
      onMouseMove: (e: React.MouseEvent) => {
        if (e.movementX !== 0 || e.movementY !== 0) onHover(item.key);
      },
    } as const;
    if (item.type === "finding")
      return (
        <div key={item.key} {...common} className={ROW}>
          <FindingRow finding={item.finding} selected={selected} />
          {/* The quick menu on the selected row; the same width is kept on other rows so the columns line up. */}
          {selected && item.finding.status === "new" ? (
            <RowMenu finding={item.finding} onAct={(action) => onAct(action, item.key)} startOpen={holdHover} />
          ) : (
            <span className="w-7 shrink-0" aria-hidden="true" />
          )}
        </div>
      );
    if (item.type === "undecided")
      return (
        <Tip key={item.key} content={item.error}>
          <div {...common} className={ROW}>
            <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />
            <span className="w-[140px] shrink-0 truncate font-semibold">{item.merchant}</span>
            <span className="min-w-0 flex-1 truncate text-faint">{copy.list.undecidedRow}</span>
            <NotSureChip />
            {/* Empty amount, deadline and menu columns, so the chip lines up with the finding rows' chips and kinds. */}
            <span className="w-[88px] shrink-0" aria-hidden="true" />
            <span className="w-[60px] shrink-0" aria-hidden="true" />
            <span className="w-7 shrink-0" aria-hidden="true" />
          </div>
        </Tip>
      );
    return (
      <div key={item.key} {...common} className={ROW}>
        <span className="size-1.5 shrink-0 rounded-full border border-positive/70" aria-hidden="true" />
        <span className="w-[140px] shrink-0 truncate text-muted">{item.cleared.merchant}</span>
        <span className="min-w-0 flex-1 truncate text-faint">{item.cleared.why}</span>
        <span className="shrink-0 text-meta text-positive">{copy.shared.looksFine}</span>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned: the heading stays put while the rows scroll. */}
      <Headline findings={allFindings} scan={scan} search={search} query={query} matches={items} />
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {showHint && findings.length > 0 && <FirstRunHint onDismiss={onDismissHint} />}
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
          {findings.length > 0 && findings.map((f) => row({ type: "finding", key: f.id, finding: f }))}
          {remaining !== undefined && remaining > 0 && (
            <div data-flip-key="pending" className="flex h-9 items-center gap-2.5 px-2.5 text-small text-faint">
              <span className="size-1.5 rounded-full bg-info/60 motion-safe:animate-pulse" aria-hidden="true" />
              {copy.list.stillDeciding(remaining)}
              <span className="shimmer ml-1 h-2 flex-1 rounded-full" aria-hidden="true" />
            </div>
          )}
          {groupTitle(rest.filter((i) => i.type === "undecided").length, copy.list.undecidedGroup)}
          {rest.filter((i) => i.type === "undecided").map(row)}
          {groupTitle(rest.filter((i) => i.type === "cleared").length, copy.list.clearedGroup)}
          {rest.filter((i) => i.type === "cleared").map(row)}
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
