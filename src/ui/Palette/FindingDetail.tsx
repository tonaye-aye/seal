import { useEffect, useReducer, useRef, useState } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronRight } from "lucide-react";
import type { Corpus } from "../../agent/corpus";
import type { Cleared, Finding } from "../../agent/pipeline";
import { getConnectors } from "../../connectors/live";
import { formatAUD } from "../../lib/money";
import { cannotRemind, resetEdit, setEdit, useScan } from "../../lib/scan-store";
import { expectation } from "../next-steps";
import { evidenceDate, lookupEvidence, type EvidenceView } from "../evidence";
import { daysUntil, figureValue, isUnsure, shortDate, urgency } from "../format";
import { copy } from "../../copy";
import {
  ApproveIcon,
  BankIcon,
  CalendarIcon,
  CheckNowIcon,
  DismissIcon,
  DocumentIcon,
  EditIcon,
  EmailIcon,
  OpenIcon,
  PaneIcon,
  PhotoIcon,
  RemindIcon,
  SnoozeIcon,
  UndoIcon,
} from "../icons";
import { Kbd, KeyButton, KeyHint } from "../Kbd";
import { ViewHeading } from "./ViewHeading";
import { DEADLINE_TONE } from "./FindingsList";
import { SavedNote } from "../replay";
import { Tip } from "../layers";
import { CountUp } from "../CountUp";
import { useGlide } from "../motion";

// One finding, opened. The main column has the header (business, kind, the
// figures that matter, the deadline) and the drafted fix. The sidebar on the
// right belongs to this finding: the evidence as a list of one-line items
// (open one to read it), then the figures code checked, folded away. The
// Palette owns the keys; this only draws.

/** Which side J/K act on: the sidebar ("evidence") or the draft. */
export type Pane = "evidence" | "draft";

/** The value the "Checked by code" accordion uses for its one item. */
const FIGURES = "figures";

// ---------- Evidence ----------

const imageCache = new Map<string, Promise<string>>();
function loadImage(docId: string): Promise<string> {
  let p = imageCache.get(docId);
  if (!p) {
    p = getConnectors()
      .then((c) => c.documents.readImage(docId))
      .then((img) => `data:${img.mimeType};base64,${img.base64}`);
    imageCache.set(docId, p);
  }
  return p;
}

/** A photo with no text layer, shown inside its item (the meter photo). */
function EvidenceImage({ docId, alt }: { docId: string; alt: string }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadImage(docId).then(setSrc, () => setFailed(true));
  }, [docId]);
  if (failed) return <p className="text-meta text-danger">{copy.detail.photoFailed}</p>;
  if (!src) return <div className="shimmer h-40 rounded-md" aria-label={copy.detail.loadingPhoto} />;
  return <img src={src} alt={alt} className="max-h-48 w-full rounded-md border border-hairline object-cover" />;
}

/** Marks the amounts code checked wherever they appear in the text (info: the agent's own check, not urgency). */
function Highlighted({ text, needles }: { text: string; needles: string[] }) {
  if (!needles.length) return <>{text}</>;
  const escaped = needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})(?![\\d.])`, "g"));
  return (
    <>
      {parts.map((part, i) =>
        needles.includes(part) ? (
          <mark key={i} className="rounded-[3px] bg-info/15 px-0.5 text-info">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The text of an opened item. Starts scrolled so the first checked amount is in view. */
function Excerpt({ text, needles }: { text: string; needles: string[] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const box = ref.current;
    const mark = box?.querySelector("mark");
    if (box && mark && mark.offsetTop > box.clientHeight * 0.6) box.scrollTop = mark.offsetTop - 32;
  }, [text]);
  // Documents line their columns up with runs of spaces, which wrap badly in a
  // narrow sidebar: a dot between the label and its value reads the same.
  const tidy = text.replace(/[ \t]{2,}:/g, ":").replace(/(\S)[ \t]{3,}(?=\S)/g, "$1 · ");
  return (
    <p ref={ref} className="relative mt-1 max-h-56 overflow-y-auto text-meta whitespace-pre-wrap text-muted">
      <Highlighted text={tidy} needles={needles} />
    </p>
  );
}

function SourceIcon({ view }: { view: EvidenceView }) {
  if (view.imageDocId) return <PhotoIcon />;
  if (view.kind === "txn") return <BankIcon />;
  if (view.kind === "email") return <EmailIcon />;
  if (view.kind === "event") return <CalendarIcon />;
  return <DocumentIcon />;
}

export function evidenceFor(item: Finding | Cleared, corpus: Corpus | undefined): { view: EvidenceView; cited: boolean }[] {
  if ("evidence" in item) return item.evidence.map((e) => ({ view: lookupEvidence(corpus, e.id, e.kind), cited: e.cited }));
  return item.citedIds.map((id) => ({ view: lookupEvidence(corpus, id), cited: true }));
}

/**
 * The stops J/K move through in the sidebar: one per piece of evidence, then
 * the "Checked by code" header when the finding has figures.
 */
export function sidebarStops(item: Finding | Cleared, corpus: Corpus | undefined): { evidence: number; figures: boolean } {
  return { evidence: evidenceFor(item, corpus).length, figures: "figures" in item && item.figures.length > 0 };
}

// Shared by every line in the sidebar, so evidence and the figures header line up.
const LINE = "row-press relative flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-meta";

function Sidebar({
  items,
  finding,
  selected,
  focused,
  openEvidence,
  figuresOpen,
  needles,
  mouse,
  onToggleEvidence,
  onToggleFigures,
}: {
  items: { view: EvidenceView; cited: boolean }[];
  finding?: Finding;
  /** The selected stop: an evidence index, or items.length for the figures header. */
  selected: number;
  focused: boolean;
  /** The open evidence item (-1: all folded). */
  openEvidence: number;
  figuresOpen: boolean;
  needles: string[];
  mouse: boolean;
  onToggleEvidence: (index: number) => void;
  onToggleFigures: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // The selected line has the same sliding highlight as the list and the timeline.
  useGlide(listRef, highlightRef);
  // Lines move while an item opens or closes (one opening can close another
  // above it). The highlight rides along with its line on every frame of that
  // animation, then is drawn once more when it settles.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const frame = useRef(0);
  const follow = () => {
    const list = listRef.current;
    const highlight = highlightRef.current;
    // Still opening or closing? (The accordion's animations are named accordion-open / accordion-close.)
    const busy = !!list?.getAnimations({ subtree: true }).some((a) => (a as CSSAnimation).animationName?.startsWith("accordion"));
    if (!busy) {
      frame.current = 0;
      if (highlight) highlight.style.transition = "";
      redraw();
      return;
    }
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (highlight && row) {
      highlight.style.transition = "none";
      highlight.style.height = `${row.offsetHeight}px`;
      highlight.style.transform = `translateY(${row.offsetTop}px)`;
    }
    frame.current = requestAnimationFrame(follow);
  };
  const onAnimationStart = () => {
    if (!frame.current) frame.current = requestAnimationFrame(follow);
  };
  // Leaving the finding mid-animation stops the ride.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const cited = items.filter((i) => i.cited);
  const rest = items.filter((i) => !i.cited);
  // Only the side J/K act on shows its selection (the bar marks where the keys go).
  const isSelected = (i: number) => focused && !mouse && i === selected;

  const evidenceItem = (item: (typeof items)[number], index: number) => {
    const { view } = item;
    const open = index === openEvidence;
    return (
      <Accordion.Item key={view.id} value={String(index)} data-glide-rows>
        {/* The palette owns the keys, so the line never takes focus (like "Checked and left alone"). */}
        <Accordion.Trigger asChild>
          <div aria-selected={isSelected(index)} className={`${LINE} ${open ? "text-text" : "text-muted"} hover:text-text`}>
            <span className={`shrink-0 ${open ? "text-muted" : "text-faint"}`}>
              <SourceIcon view={view} />
            </span>
            <span className={`min-w-0 flex-1 truncate ${view.kind === "txn" ? "font-mono" : ""}`}>{view.title}</span>
            {view.amount && <span className="shrink-0 figure text-meta text-text">{view.amount}</span>}
            <span className="min-w-11 shrink-0 text-right figure text-label whitespace-nowrap text-faint">{evidenceDate(view)}</span>
          </div>
        </Accordion.Trigger>
        <Accordion.Content className="accordion-content">
          <div className="pt-0.5 pr-2 pb-2.5 pl-8">
            <p className="truncate text-label text-faint">
              {view.source} · {view.meta}
            </p>
            {view.imageDocId && (
              <div className="mt-1.5">
                <EvidenceImage docId={view.imageDocId} alt={view.title} />
              </div>
            )}
            {view.body && <Excerpt text={view.body.trim()} needles={needles} />}
          </div>
        </Accordion.Content>
      </Accordion.Item>
    );
  };

  const group = (title: string, list: typeof items, offset: number) =>
    list.length > 0 && (
      <>
        <h3 className="mt-2 mb-1 px-2 label text-faint first:mt-0.5">{title}</h3>
        {list.map((item, i) => evidenceItem(item, offset + i))}
      </>
    );

  const figuresSelected = isSelected(items.length);
  return (
    <aside aria-label={copy.detail.sidebarLabel} className="flex w-84 shrink-0 flex-col border-l border-hairline">
      <div ref={listRef} onAnimationStart={onAnimationStart} onAnimationEnd={redraw} className="relative min-h-0 flex-1 overflow-y-auto p-2">
        {focused && !mouse && <div ref={highlightRef} className="glide inset-x-2" style={{ "--glide-bar-inset": "7px" } as React.CSSProperties} aria-hidden="true" />}
        <Accordion.Root
          type="single"
          collapsible
          value={openEvidence >= 0 ? String(openEvidence) : ""}
          onValueChange={(value) => onToggleEvidence(value === "" ? openEvidence : Number(value))}
        >
          {group(copy.detail.reliedOn(cited.length), cited, 0)}
          {group(copy.detail.alsoGathered(rest.length), rest, cited.length)}
        </Accordion.Root>

        {/* The figures code worked out: the only numbers the draft may use. Folded away, with a count. */}
        {finding && finding.figures.length > 0 && (
          <Accordion.Root
            type="single"
            collapsible
            value={figuresOpen ? FIGURES : ""}
            onValueChange={onToggleFigures}
            className="mt-2 border-t border-hairline pt-2"
          >
            <Accordion.Item value={FIGURES} data-glide-rows>
              <Accordion.Trigger asChild>
                <div aria-selected={figuresSelected} className={`${LINE} text-muted hover:text-text`}>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 text-positive">
                    <path d="m2.5 6.5 2.25 2.25L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className={`label ${figuresSelected || figuresOpen ? "text-muted" : "text-faint"}`}>{copy.detail.checkedByCode}</span>
                  <span className="rounded-full border border-hairline px-1.5 figure text-label text-faint">{finding.figures.length}</span>
                  <ChevronRight size={12} strokeWidth={2} aria-hidden="true" className="accordion-chevron shrink-0 text-faint" />
                  <span className="flex-1" />
                  {figuresSelected && <Kbd keys={["C"]} />}
                </div>
              </Accordion.Trigger>
              <Accordion.Content className="accordion-content">
                <dl className="flex flex-col px-2 pb-1">
                  {finding.figures.map((f) => (
                    <Tip key={f.id} content={f.how}>
                      <div className="flex items-baseline justify-between gap-3 border-b border-hairline/60 py-1.5 last:border-0">
                        <dt className="min-w-0 text-meta text-muted">
                          {f.label}
                          {f.how && <span className="mt-0.5 block truncate font-mono text-label text-faint">{f.how}</span>}
                        </dt>
                        <dd className="shrink-0 figure text-meta text-text">{figureValue(f)}</dd>
                      </div>
                    </Tip>
                  ))}
                </dl>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion.Root>
        )}
      </div>
    </aside>
  );
}

// ---------- After approve ----------

/**
 * What happens now that Maya has approved: the draft is in Drafts, she sends
 * it herself, and what should follow. Plain words from code; the app doesn't
 * check the outcome.
 */
export function NextSteps({ finding }: { finding: Finding }) {
  const scan = useScan();
  const expect = expectation(finding, scan);
  const handled = !finding.draft;
  const reminder = scan.reminders[finding.id];
  return (
    <div aria-label={copy.next.title} className="mb-3 rounded-md border border-hairline px-3 py-2.5 text-small">
      <h3 className="mb-1.5 label text-faint">{copy.next.title}</h3>
      <ul className="flex flex-col gap-1">
        <li className="flex items-center gap-2 text-text">
          <span className="flex w-3.5 shrink-0 justify-center text-positive">
            <ApproveIcon />
          </span>
          {handled ? copy.next.handled : copy.next.saved}
        </li>
        {/* Handled: the step Maya takes herself; otherwise, sending the draft. */}
        <li className="pl-5.5 text-muted">{handled ? finding.action.summary : copy.next.send}</li>
        {expect && <li className="pl-5.5 text-muted">{copy.next.thenExpect(expect)}</li>}
        {reminder && <li className="pl-5.5 text-muted">{copy.next.reminder(shortDate(reminder.date))}</li>}
      </ul>
    </div>
  );
}

// ---------- Draft ----------

function Draft({ finding, edited, editing, onStopEditing, scanning }: { finding: Finding; edited: boolean; editing: boolean; onStopEditing: () => void; scanning: boolean }) {
  const draft = finding.draft;
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      const t = textRef.current;
      t?.focus();
      t?.setSelectionRange(t.value.length, t.value.length);
    }
  }, [editing]);

  if (!draft) {
    // Once handled, the Next block above says the step instead.
    if (finding.action.kind === "none" && finding.status === "approved") return null;
    if (finding.action.kind === "none")
      return (
        <div className="rounded-md border border-hairline p-3 text-small text-muted">
          <p className="font-medium text-text">{copy.detail.nothingToSend}</p>
          <p className="mt-0.5">{finding.action.summary}</p>
        </div>
      );
    if (scanning)
      return (
        <div className="flex flex-col gap-2" aria-label={copy.detail.writingDraftLabel}>
          <p className="text-meta text-faint">{copy.detail.writingDraft}</p>
          <span className="shimmer h-3 w-3/4 rounded" />
          <span className="shimmer h-3 w-full rounded" />
          <span className="shimmer h-3 w-5/6 rounded" />
        </div>
      );
    return <p className="text-small text-danger">{copy.detail.couldntDraft}</p>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="label text-faint">{copy.detail.draftedEmail}</h3>
        {edited && <span className="rounded-full border border-hairline px-1.5 text-meta text-muted">{copy.detail.editedByYou}</span>}
      </div>
      {!draft.grounded && (
        <div className="mb-2.5 rounded-md border border-danger/30 bg-danger/8 px-2.5 py-2 text-meta">
          <p className="font-semibold text-danger">{copy.detail.checkBeforeSending}</p>
          <ul className="mt-0.5 list-disc pl-4 text-muted">
            {draft.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <dl className="mb-2 grid grid-cols-[52px_1fr] gap-x-2 gap-y-0.5 text-meta">
        <dt className="text-faint">{copy.detail.to}</dt>
        <dd className="truncate">
          {draft.to.name} <span className="text-faint">{draft.to.address}</span>
        </dd>
        <dt className="text-faint">{copy.detail.subject}</dt>
        <dd>{draft.subject}</dd>
        {draft.attachDocumentIds.length > 0 && (
          <>
            <dt className="text-faint">{copy.detail.attach}</dt>
            <dd className="text-muted">{copy.detail.attachments(draft.attachDocumentIds.length)}</dd>
          </>
        )}
      </dl>
      {editing ? (
        <>
          <textarea
            ref={textRef}
            aria-label={copy.detail.draftBody}
            value={draft.body}
            onChange={(e) => setEdit(finding.id, e.target.value)}
            className="h-72 w-full resize-none rounded-md border border-muted/50 bg-inset p-3 text-small text-text outline-none"
          />
          <div className="mt-1.5 flex items-center justify-between text-meta">
            <span className="text-faint">{copy.detail.editsNotChecked}</span>
            <span className="flex gap-3">
              {edited && (
                <button type="button" className="press -mx-1 cursor-pointer rounded-md px-1 text-faint hover:bg-raised hover:text-muted" onClick={() => resetEdit(finding.id)}>
                  {copy.detail.revert}
                </button>
              )}
              <button type="button" className="press -mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-1 text-accent hover:bg-raised" onClick={onStopEditing}>
                {copy.detail.doneEditing} <Kbd keys={["Esc"]} />
              </button>
            </span>
          </div>
        </>
      ) : (
        <p className="rounded-md border border-hairline bg-inset p-3 text-small whitespace-pre-wrap">{draft.body}</p>
      )}
    </div>
  );
}

// ---------- The whole view ----------

function Amounts({ finding }: { finding: Finding }) {
  const a = finding.amounts;
  const cells = [
    a.atStake !== undefined && [copy.detail.atStake, a.atStake],
    a.recoverable !== undefined && a.recoverable !== a.atStake && [copy.detail.canRecover, a.recoverable],
    a.perMonth !== undefined && [copy.detail.perMonth, a.perMonth],
  ].filter(Boolean) as [string, number][];
  return (
    // The first amount leads (largest); the others sit beside it, smaller.
    <div className="flex shrink-0 items-end gap-5">
      {cells.map(([label, value], i) => (
        <div key={label} className="text-right">
          <div className={`figure ${i === 0 ? "text-heading text-text" : "text-body text-muted"}`}>
            {/* Counts up the first time this finding is opened. */}
            <CountUp id={`detail:${finding.id}:${label}`} cents={value} />
          </div>
          <div className="mt-0.5 label text-faint">{label}</div>
        </div>
      ))}
    </div>
  );
}

export function FindingDetail({
  item,
  corpus,
  edited,
  pane,
  evidenceIndex,
  openEvidence,
  figuresOpen,
  editing,
  mouse,
  onStopEditing,
  onToggleEvidence,
  onToggleFigures,
  onFocusDraft,
  draftRef,
  scanning,
}: {
  item: Finding | Cleared;
  corpus: Corpus | undefined;
  edited: boolean;
  pane: Pane;
  /** The selected stop in the sidebar (see sidebarStops). */
  evidenceIndex: number;
  openEvidence: number;
  figuresOpen: boolean;
  editing: boolean;
  mouse: boolean;
  onStopEditing: () => void;
  onToggleEvidence: (index: number) => void;
  onToggleFigures: () => void;
  /** A click in the main column makes the draft the side J/K act on. */
  onFocusDraft: () => void;
  draftRef: React.RefObject<HTMLDivElement | null>;
  scanning: boolean;
}) {
  const finding = "evidence" in item ? item : undefined;
  const evidence = evidenceFor(item, corpus);
  const reminder = useScan().reminders[item.id];
  // Amounts code checked, written the ways a bill or email would show them.
  const needles = finding
    ? [...new Set(finding.figures.filter((f) => f.unit === "cents").flatMap((f) => {
        const s = formatAUD(Math.abs(Number(f.value)));
        return s.endsWith(".00") ? [s, s.slice(0, -3)] : [s];
      }))]
    : [];

  return (
    <section aria-label={copy.detail.label} className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Pinned, like the list's and the timeline's headings. */}
        <ViewHeading
          title={item.title}
          eyebrow={
            <>
              <span className="truncate font-semibold text-text">{item.merchant}</span>
              {finding ? (
                <>
                  {/* The kind is quiet context; the deadline is the news, coloured by how close it is. */}
                  <span className="shrink-0 text-faint">{copy.shared.kind[finding.kind]}</span>
                  {finding.deadline && (
                    <Tip content={finding.deadline.label}>
                      <span
                        className={`ml-1 inline-flex h-5 shrink-0 items-center rounded-full px-2 figure text-label whitespace-nowrap ${
                          urgency(finding.deadline.date) === "soon" ? "" : "border border-hairline"
                        } ${DEADLINE_TONE[urgency(finding.deadline.date)]}`}
                      >
                        {copy.detail.deadlineChip(shortDate(finding.deadline.date), copy.dates.days(daysUntil(finding.deadline.date)))}
                      </span>
                    </Tip>
                  )}
                </>
              ) : (
                <span className="shrink-0 text-positive">{copy.shared.looksFine}</span>
              )}
            </>
          }
          action={finding && <Amounts finding={finding} />}
        >
          {/* A case left alone gives its reason once, in the main column below, so the header leaves it out. */}
          {finding && (
            <>
              {/* Three lines: the model's longest reasons need them at the palette's width. */}
              <span className="line-clamp-3">{item.why}</span>
              {(finding.deadline || (reminder && finding.status === "new")) && (
                <span className="mt-0.5 block truncate text-meta text-faint">
                  {finding.deadline && copy.detail.nextDate(finding.deadline.label, shortDate(finding.deadline.date))}
                  {/* Approved ones say it in the Next block instead. */}
                  {finding.deadline && reminder && finding.status === "new" && " · "}
                  {reminder && finding.status === "new" && copy.next.reminderShort(shortDate(reminder.date))}
                </span>
              )}
            </>
          )}
        </ViewHeading>

        {finding && isUnsure(finding) && (
          <div className="mx-4 mt-2 rounded-md border border-info/25 bg-info/8 px-3 py-1.5 text-meta">
            <span className="font-semibold text-info">{copy.detail.notSure}</span>
            <span className="text-muted">{finding.doubts.join(" ") || copy.detail.lessConfident}</span>
          </div>
        )}

        <div ref={draftRef} onClick={finding ? onFocusDraft : undefined} className="min-h-0 flex-1 overflow-y-auto p-2">
          {finding ? (
            <div className={`rounded-lg p-3 ${pane === "draft" && !mouse ? "pane-focus" : ""}`}>
              {finding.status === "approved" && <NextSteps finding={finding} />}
              <Draft finding={finding} edited={edited} editing={editing} onStopEditing={onStopEditing} scanning={scanning} />
              <SavedNote finding={finding} />
            </div>
          ) : (
            <div className="p-3 text-small">
              <h3 className="mb-1.5 label text-faint">{copy.detail.whyLeftAlone}</h3>
              <p className="text-muted">{(item as Cleared).why}</p>
              <p className="mt-3 text-faint">{copy.detail.nothingToDo}</p>
            </div>
          )}
        </div>
      </div>

      <Sidebar
        items={evidence}
        finding={finding}
        selected={evidenceIndex}
        focused={pane === "evidence"}
        openEvidence={openEvidence}
        figuresOpen={figuresOpen}
        needles={needles}
        mouse={mouse}
        onToggleEvidence={onToggleEvidence}
        onToggleFigures={onToggleFigures}
      />
    </section>
  );
}


/** A small mouse, for the "click" hint (the mouse's version of a key cap). */
export function MouseIcon() {
  return (
    <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true" className="text-faint">
      <rect x="1" y="1" width="10" height="14" rx="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 1v5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.6 6h8.8" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
    </svg>
  );
}

/** Something the action bar (or its key) can do. */
export type Command = "approve" | "edit" | "snooze" | "dismiss" | "remind" | "undo" | "rescan" | "open" | "pane" | "toggle" | "figures";

/** The keys for what's selected, shown under the list or the open finding. Each one can also be clicked. */
export function ActionBar({
  item,
  detail,
  pane,
  stopOpen = false,
  mouse,
  onCommand,
}: {
  item?: Finding | Cleared | { undecided: string };
  detail: boolean;
  pane?: Pane;
  /** In an open finding: the selected sidebar line is open (so Enter closes it). */
  stopOpen?: boolean;
  /** The mouse is driving: say what a click does instead of listing keys. */
  mouse: boolean;
  onCommand: (command: Command) => void;
}) {
  const scan = useScan();
  // Remind me (L) shows while it can still be added: calendar connected, none set yet.
  const canRemind = !!item && "evidence" in item && !scan.reminders[item.id] && !cannotRemind(item.id, scan);
  const remindHint = { keys: ["L"], label: copy.actions.remind, command: "remind" as const, icon: <RemindIcon /> };
  if (mouse && !detail && item && !("undecided" in item)) {
    const hint = "evidence" in item ? copy.actions.clickForDetail : copy.actions.clickWhyFine;
    return (
      // The click hint sits on the right, where the keyboard's J/K hint would be.
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-hairline px-4 text-meta">
        <span className="max-w-[220px] truncate font-medium text-text">{item.merchant}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-muted">
          <MouseIcon />
          {hint}
        </span>
      </div>
    );
  }
  type Hint = { keys: string[]; label: string; command: Command; icon: React.ReactNode };
  let hints: Hint[] = [];
  if (item && "evidence" in item) {
    if (item.status === "new") {
      const approve = item.draft ? copy.actions.approveToDrafts : item.action.kind === "none" ? copy.actions.markHandled : copy.actions.approve;
      hints = [
        { keys: ["A"], label: approve, command: "approve", icon: <ApproveIcon /> },
        ...(item.draft ? [{ keys: ["E"], label: copy.actions.edit, command: "edit" as const, icon: <EditIcon /> }] : []),
        { keys: ["S"], label: copy.actions.snooze, command: "snooze", icon: <SnoozeIcon /> },
        { keys: ["D"], label: copy.actions.notALeak, command: "dismiss", icon: <DismissIcon /> },
        ...(canRemind ? [remindHint] : []),
      ];
    } else {
      hints = [
        { keys: ["⌘", "Z"], label: copy.actions.undo, command: "undo", icon: <UndoIcon /> },
        ...(canRemind && item.status === "approved" ? [remindHint] : []),
      ];
    }
  } else if (item && "undecided" in item) {
    hints = [{ keys: ["R"], label: copy.actions.checkAgain, command: "rescan", icon: <CheckNowIcon /> }];
  }
  const twoPanes = !!item && "evidence" in item;
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-t border-hairline px-4 text-meta">
      <div className="flex min-w-0 items-center gap-3">
        {/* Say which finding the actions apply to, in the list and in an open finding alike. */}
        {item && !("undecided" in item) && (detail || "evidence" in item) && (
          <Tip content={item.merchant}>
            <span className="max-w-[150px] truncate font-medium text-text">{item.merchant}</span>
          </Tip>
        )}
        {hints.map((h) => (
          <span key={h.label} className="inline-flex">
          <KeyButton
            keys={h.keys}
            label={h.label}
            icon={h.icon}
            tone={h.command === "approve" ? "primary" : "muted"}
            // In an open finding the actions stay, as plain buttons once the mouse moves.
            mouse={mouse && detail}
            onClick={() => onCommand(h.command)}
          />
          </span>
        ))}
        {item && "undecided" in item && <span className="truncate text-faint">{item.undecided}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {!detail && item && !("undecided" in item) && <KeyButton keys={["↵"]} label={copy.actions.open} icon={<OpenIcon />} tone="faint" onClick={() => onCommand("open")} />}
        {!detail && <KeyHint keys={["J", "K"]} label={copy.actions.move} />}
        {detail && !mouse && <KeyHint keys={["J", "K"]} label={pane === "draft" ? copy.actions.scroll : copy.actions.evidence} />}
        {detail && !mouse && pane !== "draft" && <KeyButton keys={["↵"]} label={stopOpen ? copy.actions.close : copy.actions.open} icon={<OpenIcon />} tone="faint" onClick={() => onCommand("toggle")} />}
        {detail && !mouse && twoPanes && (
          <KeyButton keys={["Tab"]} label={pane === "draft" ? copy.actions.toEvidence : copy.actions.toDraft} icon={<PaneIcon />} tone="faint" onClick={() => onCommand("pane")} />
        )}
        {/* With the mouse, the click hint takes the place of the navigation keys, as in the list. */}
        {detail && mouse && (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <MouseIcon />
            {copy.actions.clickEvidence}
          </span>
        )}
      </div>
    </div>
  );
}
