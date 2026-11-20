import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { Menu, MenuItem } from "./Menu";
import type { Cleared, Finding } from "../../agent/pipeline";
import { useLive } from "../../connectors/live";
import { formatAUD } from "../../lib/money";
import { useScan, type ScanState } from "../../lib/scan-store";
import { fromSaved, mixedReplay, SavedTag } from "../replay";
import { KIND_LABEL, SOON_DAYS, daysText, daysUntil, headlineAmount, isUnsure, plural, shortDate } from "../format";
import { ApproveIcon, DismissIcon, SnoozeIcon } from "../icons";
import { Kbd } from "../Kbd";
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
      .filter((f) => match(f.merchant, f.title, KIND_LABEL[f.kind]))
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
    if (matches.length === 0) words.push("Try a business, like Skylink, or a problem, like price rise. Esc clears the search");
    else {
      words.push(`${hits.length} of the ${open.length} that need you`);
      if (fine) words.push(`${fine} checked and left alone`);
      if (hitBack > 0) words.push(`up to ${formatAUD(hitBack)} to save or get back`);
      if (hitMonthly > 0) words.push(`${formatAUD(hitMonthly)} a month`);
    }
    return (
      <ViewHeading
        view="list"
        title={matches.length ? `${plural(matches.length, "match", "matches")} for "${q}"` : `No matches for "${q}"`}
        search={search}
      >
        {words.join(", ")}.
      </ViewHeading>
    );
  }

  let title: string;
  if (findings.length === 0) title = scanning ? "Nothing needs you so far" : "All clear this month";
  else if (open.length === 0) title = "You've dealt with everything";
  // Kept short on purpose: just how many need attention (deadlines and money are on each row).
  else title = `${plural(open.length, "thing")} need${open.length === 1 ? "s" : ""} attention`;

  let line: string | undefined;
  if (findings.length === 0) line = scanning ? "Findings appear here as soon as each one is checked." : "Nothing looks wrong or unwanted. The ones below were checked and look fine.";
  else if (open.length === 0) line = "Approved drafts are waiting in your mailbox. Nothing was sent.";

  return (
    <ViewHeading view="list" title={title} search={search}>
      {line}
      {scanning && <span className="text-faint">{line ? " " : ""}Still checking the rest.</span>}
    </ViewHeading>
  );
}

// ---------- First-run hint ----------

export function FirstRunHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mx-3 mb-2 flex items-start justify-between gap-3 rounded-lg border border-amber/25 bg-amber-glow/40 px-3.5 py-2.5 text-[12.5px]">
      <div className="leading-[1.6] text-muted">
        <p>
          Move with <Kbd keys={["J"]} /> <Kbd keys={["K"]} />, open one with <Kbd keys={["↵"]} /> to see the evidence and the draft.
        </p>
        <p>
          <Kbd keys={["A"]} /> approves: it saves the draft to your Drafts folder. Nothing is ever sent.
        </p>
        <p>
          <Kbd keys={["⌘", "Z"]} /> undoes, <Kbd keys={["?"]} /> shows every key.
        </p>
      </div>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded-md px-2 py-1 text-[12px] text-amber hover:bg-amber-glow">
        Got it
      </button>
    </div>
  );
}

// ---------- Rows ----------

const STATUS_CHIP: Record<Exclude<Finding["status"], "new">, { text: string; className: string }> = {
  approved: { text: "Draft saved", className: "text-positive border-positive/30" },
  snoozed: { text: "Snoozed", className: "text-faint border-hairline" },
  dismissed: { text: "Not a leak", className: "text-faint border-hairline" },
};

export function DeadlineChip({ date }: { date: string }) {
  const days = daysUntil(date);
  const soon = days <= SOON_DAYS;
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 font-mono text-[10.5px] tabular ${
        soon ? "bg-amber-glow text-amber" : "text-faint"
      }`}
      title={daysText(days)}
    >
      {shortDate(date)}
    </span>
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
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const button = useRef<HTMLButtonElement>(null);
  const approve = finding.draft ? "Approve" : finding.action.kind === "none" ? "Mark handled" : "Approve";
  const choose = (action: RowAction) => () => {
    setOpen(false);
    onAct(action);
  };
  return (
    // Clicks here act on the row; they must not also open it.
    <span className="relative flex w-7 shrink-0 justify-end" onClick={(e) => e.stopPropagation()}>
      <button
        ref={button}
        type="button"
        tabIndex={-1}
        data-menu-button
        data-coach="row-menu"
        aria-label={`Quick actions for ${finding.merchant}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Quick actions"
        // Keep keyboard focus on the palette, so the keys keep working after a click.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // Open upwards when the row sits in the lower half of its list.
          const list = button.current?.closest("[data-row-list]");
          const r = button.current?.getBoundingClientRect();
          const l = list?.getBoundingClientRect();
          if (r && l) setPlacement(r.top > l.top + l.height / 2 ? "above" : "below");
          setOpen((o) => !o);
        }}
        className={`grid size-6 cursor-pointer place-items-center rounded-md transition-colors duration-(--duration-fast) hover:bg-hairline hover:text-text ${open ? "bg-hairline text-text" : "text-muted"}`}
      >
        <Ellipsis size={15} strokeWidth={1.75} aria-hidden="true" className="block" />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} align="right" placement={placement} label="Quick actions" coach="row-menu-list">
        <MenuItem icon={<ApproveIcon />} label={approve} keys={<Kbd keys={["A"]} />} onSelect={choose("approve")} />
        <MenuItem icon={<SnoozeIcon />} label="Snooze" keys={<Kbd keys={["S"]} />} onSelect={choose("snooze")} />
        <MenuItem icon={<DismissIcon />} label="Not a leak" keys={<Kbd keys={["D"]} />} onSelect={choose("dismiss")} />
      </Menu>
    </span>
  );
}

function FindingRow({ finding, selected }: { finding: Finding; selected: boolean }) {
  const amount = headlineAmount(finding);
  const done = finding.status !== "new";
  // Only a check that is part live, part saved labels rows; otherwise the banner says it.
  const saved = mixedReplay(useScan()) && fromSaved(finding);
  return (
    <>
      <span
        className={`size-1.5 shrink-0 rounded-full ${done ? (finding.status === "approved" ? "bg-positive" : "bg-faint") : "bg-amber"}`}
        aria-hidden="true"
      />
      <span className={`w-[132px] shrink-0 truncate font-medium ${done ? "text-muted" : ""}`}>{finding.merchant}</span>
      <span className={`min-w-0 flex-1 truncate ${selected ? "text-muted" : "text-faint"}`}>{finding.title}</span>
      {done ? (
        <span className={`shrink-0 rounded-full border px-2 py-px text-[11px] ${STATUS_CHIP[finding.status as keyof typeof STATUS_CHIP].className}`}>
          {STATUS_CHIP[finding.status as keyof typeof STATUS_CHIP].text}
        </span>
      ) : (
        <>
          {saved && <SavedTag />}
          {isUnsure(finding) && <span className="shrink-0 rounded-full border border-amber/30 px-2 py-px text-[11px] text-amber">Not sure</span>}
          <span className="shrink-0 rounded-full border border-hairline px-2 py-px text-[11px] text-muted">{KIND_LABEL[finding.kind]}</span>
        </>
      )}
      <span className={`w-[78px] shrink-0 text-right font-mono text-[12px] tabular ${done ? "text-faint line-through decoration-faint/60" : ""}`}>
        {amount ? formatAUD(amount.cents) : ""}
      </span>
      <span className="flex w-[56px] shrink-0 justify-end">{finding.deadline && !done ? <DeadlineChip date={finding.deadline.date} /> : null}</span>
    </>
  );
}

function groupTitle(count: number, title: string) {
  if (!count) return null;
  return <h2 className="mt-3 mb-1 px-2.5 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">{title}</h2>;
}

// The selected row (the amber mark) is the only highlighted one. Moving the
// mouse moves it; so do J/K. There is no separate hover style, so the two
// can never point at different rows.
function rowClass(selected: boolean): string {
  return `group/row relative flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px] ${
    selected ? "bg-raised before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-amber" : ""
  }`;
}

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
  const findings = items.flatMap((i) => (i.type === "finding" ? [i.finding] : []));
  const rest = items.filter((i) => i.type !== "finding");
  const missing = Object.values(live.statuses).filter((s) => s && (s.state === "needs_reconnect" || s.state === "error"));
  const SOURCE_NAMES = { bank: "Bank", email: "Email", documents: "Documents", calendar: "Calendar" } as const;
  const notConnected = (scan.result?.notConnected ?? []).map((id) => SOURCE_NAMES[id]);
  const remaining =
    scan.phase === "scanning" && scan.stage === "judge" && scan.progress ? scan.progress.total - scan.progress.done : undefined;

  // Keep the selected row in view as J/K move.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [scrollKey]);

  const row = (item: ListItem) => {
    const selected = item.key === selectedKey;
    const common = {
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
        <div key={item.key} {...common} data-coach="finding-row" className={rowClass(selected)}>
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
        <div key={item.key} {...common} className={rowClass(selected)} title={item.error}>
          <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />
          <span className="w-[132px] shrink-0 truncate font-medium">{item.merchant}</span>
          <span className="min-w-0 flex-1 truncate text-faint">Couldn't decide this one: the model didn't answer</span>
          <span className="shrink-0 rounded-full border border-amber/30 px-2 py-px text-[11px] text-amber">Not sure</span>
        </div>
      );
    return (
      <div key={item.key} {...common} className={rowClass(selected)}>
        <span className="size-1.5 shrink-0 rounded-full border border-positive/70" aria-hidden="true" />
        <span className="w-[132px] shrink-0 truncate text-muted">{item.cleared.merchant}</span>
        <span className="min-w-0 flex-1 truncate text-faint">{item.cleared.why}</span>
        <span className="shrink-0 rounded-full border border-hairline px-2 py-px text-[11px] text-positive/80">Looks fine</span>
      </div>
    );
  };

  return (
    <div data-coach="findings" className="flex min-h-0 flex-1 flex-col">
      {/* Pinned: the heading stays put while the rows scroll. */}
      <Headline findings={allFindings} scan={scan} search={search} query={query} matches={items} />
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {showHint && findings.length > 0 && <FirstRunHint onDismiss={onDismissHint} />}
        {scan.phase === "error" && (
          <p className="mx-3 mb-2 rounded-lg border border-danger/25 bg-danger/[0.07] px-3.5 py-2 text-[12.5px] text-muted">
            The check stopped early: {scan.error} Press <Kbd keys={["R"]} /> to try again.
          </p>
        )}
        {notConnected.length > 0 && (
          <p className="mx-3 mb-2 rounded-lg border border-hairline px-3.5 py-2 text-[12.5px] text-muted">
            {notConnected.join(" and ")} {notConnected.length === 1 ? "wasn't" : "weren't"} connected, so this check didn't look at{" "}
            {notConnected.length === 1 ? "it" : "them"}. Connect from Connectors at the bottom.
          </p>
        )}
        {missing.length > 0 && (
          <p className="mx-3 mb-2 rounded-lg border border-danger/25 bg-danger/[0.07] px-3.5 py-2 text-[12.5px] text-muted">
            {missing.map((s) => s!.name).join(" and ")} couldn't be read, so this check is missing what's in it. Press <Kbd keys={["R"]} /> to reconnect and check again.
          </p>
        )}
        <div role="listbox" aria-label="Findings" data-row-list className="flex flex-col px-1.5">
          {findings.length > 0 && findings.map((f) => row({ type: "finding", key: f.id, finding: f }))}
          {remaining !== undefined && remaining > 0 && (
            <div className="flex h-9 items-center gap-2.5 px-2.5 text-[12.5px] text-faint">
              <span className="size-1.5 rounded-full bg-amber/60 motion-safe:animate-pulse" aria-hidden="true" />
              Still deciding on {plural(remaining, "more")}
              <span className="shimmer ml-1 h-2 flex-1 rounded-full" aria-hidden="true" />
            </div>
          )}
          {groupTitle(rest.filter((i) => i.type === "undecided").length, "Couldn't decide: check these yourself")}
          {rest.filter((i) => i.type === "undecided").map(row)}
          {groupTitle(rest.filter((i) => i.type === "cleared").length, "Checked and left alone")}
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
      <h1 className="text-[17px] font-medium tracking-[-0.015em]">{title}</h1>
      <div className="mt-1.5 max-w-[48ch] text-muted">{children}</div>
    </section>
  );
}

/** While the check runs and nothing has been found yet: show the work. */
export function Scanning({ scan }: { scan: ScanState }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col px-4 pt-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="scan-ring size-8 rounded-full border border-amber/40" aria-hidden="true" />
        <div>
          <h1 className="text-[17px] font-medium tracking-[-0.015em]">Checking this month's money</h1>
          <p className="text-[12.5px] text-muted">
            Reading your bank, email, documents and calendar. Findings appear here as soon as each one is checked.
          </p>
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
      <p className="text-[12px] text-muted">
        Documents are slow to respond. {slowReads.done > 0 ? `${slowReads.done} read so far, ` : ""}still waiting on the rest.
      </p>
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
      title="All clear this month"
      icon={
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="text-positive">
          <path d="m5.5 10.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      }
    >
      <p>
        Looked closely at {plural(checked, "charge")} and nothing looks wrong or unwanted. It checks again next month, or press{" "}
        <Kbd keys={["R"]} /> to check now.
      </p>
    </StateFrame>
  );
}

export function ScanError({ message }: { message: string }) {
  return (
    <StateFrame
      title="The check didn't finish"
      icon={
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="text-danger">
          <path d="M10 6v5M10 14v.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      }
    >
      <p>{message}</p>
      <p className="mt-2 text-faint">
        Press <Kbd keys={["R"]} /> to try again. Nothing was sent or changed.
      </p>
    </StateFrame>
  );
}

export function NotChecked() {
  return (
    <StateFrame title="Not checked yet" icon={<span className="size-2 rounded-full bg-faint" />}>
      <p>
        Press <Kbd keys={["R"]} /> to check your bank, email, documents and calendar for charges that look wrong or unwanted.
      </p>
    </StateFrame>
  );
}
