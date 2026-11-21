import { Check, CircleAlert } from "lucide-react";
import type { Finding } from "../../agent/pipeline";
import { copy } from "../../copy";
import { useScan } from "../../lib/scan-store";
import { readyLabel } from "../fix-route";
import { CountUp } from "../CountUp";
import { daysUntil, headlineAmount, isUnsure, shortDate, urgency } from "../format";
import { Tip } from "../layers";
import { SavedTag } from "../replay";

// One row of the findings list. Every kind of row draws through RowCells, so
// the date and amount columns always line up. The cells are a plain fragment:
// the list keeps each row a direct child, which its motion code relies on.

/** The shape and left edge every list and timeline row shares. */
export const ROW_BASE = "group/row relative flex items-center rounded-md px-2.5";
/** A row that can be clicked: the "Checked and left alone" header and every findings row. */
export const ROW_SHAPE = `row-press cursor-pointer ${ROW_BASE}`;
export const ROW = `${ROW_SHAPE} h-8.5 gap-2 text-body`;

/** A group header's words: a sentence-case name and a quiet count. The same in the findings list and the timeline. */
export function GroupLabel({ label, count, selected = false }: { label: string; count: number; selected?: boolean }) {
  return (
    <>
      <span className={selected ? "text-text" : "text-muted"}>{label}</span>
      <span className="text-faint tabular-nums">{count}</span>
    </>
  );
}

/** The space for the ⋯ button. Every row keeps it, so nothing moves when the button appears. */
export const MENU_SLOT = "flex w-6 shrink-0 justify-end";

/** A neutral square with the merchant's first letter. The name beside it says the same, so screen readers skip it. */
function Tile({ name }: { name: string }) {
  const letter = /[\p{L}\p{N}]/u.exec(name)?.[0].toUpperCase() ?? "";
  return (
    <span aria-hidden="true" className="grid size-5 place-items-center rounded-sm bg-hairline text-meta leading-none font-semibold text-muted">
      {letter}
    </span>
  );
}

/** A due date as plain text. Amber only when it is within 7 days. */
export function RowDate({ date }: { date: string }) {
  return (
    <Tip content={copy.dates.days(daysUntil(date))}>
      <span className={urgency(date) === "soon" ? "text-amber" : "text-text"}>{shortDate(date)}</span>
    </Tip>
  );
}

/** The agent isn't sure: its own status, so info, not amber. */
export function NotSureNote() {
  return <span className="shrink-0 text-meta text-info">{copy.shared.notSure}</span>;
}

function RowCells({
  mark,
  name,
  quiet = false,
  note,
  flags,
  date,
  amount,
}: {
  mark: React.ReactNode;
  name: string;
  /** Already dealt with: the name steps back. */
  quiet?: boolean;
  /** The quiet word right after the name: the kind, or what happened to it. */
  note?: string;
  /** Saved answer, Not sure. */
  flags?: React.ReactNode;
  date?: React.ReactNode;
  amount?: React.ReactNode;
}) {
  return (
    <>
      <span className="grid size-5 shrink-0 place-items-center">{mark}</span>
      {/* One shared text baseline across the name, note, date and amount. */}
      <span className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className={`min-w-0 truncate ${quiet ? "font-medium text-muted" : "font-semibold text-text"}`}>{name}</span>
          {note && <span className="shrink-0 text-meta text-faint">{note}</span>}
        </span>
        {flags}
        <span className="figure w-15 shrink-0 text-right text-meta whitespace-nowrap">{date}</span>
        <span className="figure w-22 shrink-0 text-right text-body">{amount}</span>
      </span>
    </>
  );
}

export function FindingCells({ finding, saved = false }: { finding: Finding; saved?: boolean }) {
  const amount = headlineAmount(finding);
  const done = finding.status !== "new";
  const approved = finding.status === "approved";
  const scan = useScan();
  // Approved on a call, chat or online route: Maya still has that step to do.
  const status =
    finding.status === "new"
      ? undefined
      : approved
        ? (readyLabel(finding, scan) ?? (finding.draft ? copy.shared.decided.approved : copy.shared.decided.handled))
        : copy.shared.decided[finding.status];
  const unsure = !done && isUnsure(finding);
  return (
    <RowCells
      mark={approved ? <Check size={15} strokeWidth={2.25} aria-hidden="true" className="text-positive" /> : <Tile name={finding.merchant} />}
      name={finding.merchant}
      quiet={done}
      note={status ?? copy.shared.kind[finding.kind]}
      flags={
        !done && (saved || unsure) ? (
          <span className="flex shrink-0 items-baseline gap-3">
            {saved && <SavedTag />}
            {unsure && <NotSureNote />}
          </span>
        ) : undefined
      }
      date={finding.deadline && !done ? <RowDate date={finding.deadline.date} /> : undefined}
      amount={amount ? <span className={done ? "text-muted" : "text-text"}><CountUp id={`row:${finding.id}`} cents={amount.cents} /></span> : undefined}
    />
  );
}

export function UndecidedCells({ merchant, error }: { merchant: string; error: string }) {
  return (
    <>
      <RowCells
        mark={<CircleAlert size={15} strokeWidth={2} aria-hidden="true" className="text-danger" />}
        name={merchant}
        flags={<NotSureNote />}
      />
      {/* The reason is in the row's tooltip; screen readers get it here. */}
      <span className="sr-only">{error}</span>
    </>
  );
}

export function ClearedCells({ merchant }: { merchant: string }) {
  return <RowCells mark={<Tile name={merchant} />} name={merchant} quiet note={copy.shared.looksFine} />;
}
