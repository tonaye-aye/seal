import { useEffect, useRef, useState } from "react";
import type { Corpus } from "../../agent/corpus";
import type { Cleared, Finding } from "../../agent/pipeline";
import { getConnectors } from "../../connectors/live";
import { formatAUD } from "../../lib/money";
import { resetEdit, setEdit } from "../../lib/scan-store";
import { evidenceDate, lookupEvidence, type EvidenceView } from "../evidence";
import { daysUntil, figureValue, isUnsure, shortDate, urgency } from "../format";
import { copy } from "../../copy";
import { ApproveIcon, CheckNowIcon, DismissIcon, EditIcon, OpenIcon, PaneIcon, SnoozeIcon, UndoIcon } from "../icons";
import { Kbd, KeyButton, KeyHint } from "../Kbd";
import { ViewHeading } from "./ViewHeading";
import { DEADLINE_TONE } from "./FindingsList";
import { SavedNote } from "../replay";
import { Tip } from "../layers";

// One finding, opened: why it was flagged, the evidence trail (cited items
// first) on the left, and on the right the drafted fix with the figures code
// checked. The Palette owns the keys; this only draws.

export type Pane = "evidence" | "draft";

// ---------- Evidence trail ----------

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

/** A photo with no text layer, shown inline (the meter photo). */
function EvidenceImage({ docId, alt }: { docId: string; alt: string }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadImage(docId).then(setSrc, () => setFailed(true));
  }, [docId]);
  if (failed) return <p className="text-meta text-danger">{copy.detail.photoFailed}</p>;
  if (!src) return <div className="shimmer h-28 rounded-md" aria-label={copy.detail.loadingPhoto} />;
  return <img src={src} alt={alt} className="max-h-36 w-full rounded-md border border-hairline object-cover" />;
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

const SOURCE_ICON: Record<EvidenceView["kind"], string> = { txn: "$", email: "@", doc: "▤", event: "◷" };

function EvidenceItem({
  view,
  cited,
  open,
  needles,
  onOpen,
}: {
  view: EvidenceView;
  cited: boolean;
  open: boolean;
  needles: string[];
  onOpen: () => void;
}) {
  return (
    <li
      aria-selected={open}
      onClick={onOpen}
      className={`cursor-pointer rounded-md border px-2.5 py-2 ${open ? "border-hairline bg-raised" : "border-transparent hover:bg-surface"}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="w-3 shrink-0 text-center font-mono text-label text-faint" aria-hidden="true">
          {SOURCE_ICON[view.kind]}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-meta ${view.kind === "txn" ? "font-mono text-meta" : ""}`}>{view.title}</span>
          <span className="block truncate text-meta text-faint">
            {view.source} · {view.meta}
          </span>
        </span>
        <span className="shrink-0 text-right figure text-label text-faint">
          {view.amount && <span className="block text-meta text-text">{view.amount}</span>}
          {evidenceDate(view)}
        </span>
      </div>
      {cited && !open && <span className="sr-only">{copy.detail.cited}</span>}
      {/* A photo is always shown: it is the evidence, and there is no text to read instead. */}
      {view.imageDocId && (
        <div className="mt-2 ml-5">
          <EvidenceImage docId={view.imageDocId} alt={view.title} />
        </div>
      )}
      {open && view.body && (
        <div className="mt-2 ml-5">
          {view.body && (
            <p className="max-h-44 overflow-y-auto text-meta whitespace-pre-wrap text-muted">
              <Highlighted text={view.body.trim()} needles={needles} />
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function evidenceFor(item: Finding | Cleared, corpus: Corpus | undefined): { view: EvidenceView; cited: boolean }[] {
  if ("evidence" in item) return item.evidence.map((e) => ({ view: lookupEvidence(corpus, e.id, e.kind), cited: e.cited }));
  return item.citedIds.map((id) => ({ view: lookupEvidence(corpus, id), cited: true }));
}

function EvidenceTrail({
  items,
  selected,
  focused,
  needles,
  onSelect,
}: {
  items: { view: EvidenceView; cited: boolean }[];
  selected: number;
  focused: boolean;
  needles: string[];
  onSelect: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const cited = items.filter((i) => i.cited);
  const rest = items.filter((i) => !i.cited);
  const group = (title: string, list: typeof items, offset: number) =>
    list.length > 0 && (
      <>
        <h3 className="mt-1 mb-1 px-2.5 label text-faint">{title}</h3>
        <ul className="flex flex-col">
          {list.map((item, i) => (
            <EvidenceItem
              key={item.view.id}
              view={item.view}
              cited={item.cited}
              open={offset + i === selected}
              needles={needles}
              onOpen={() => onSelect(offset + i)}
            />
          ))}
        </ul>
      </>
    );
  return (
    <div ref={ref} className={`min-h-0 overflow-y-auto rounded-lg p-1.5 ${focused ? "pane-focus" : ""}`}>
      {group(copy.detail.reliedOn(cited.length), cited, 0)}
      {group(copy.detail.alsoGathered(rest.length), rest, cited.length)}
    </div>
  );
}

// ---------- Draft and figures ----------

function DraftPane({
  finding,
  edited,
  editing,
  onStopEditing,
  focused,
  paneRef,
  scanning,
  onFocus,
}: {
  finding: Finding;
  edited: boolean;
  editing: boolean;
  onStopEditing: () => void;
  focused: boolean;
  /** A click in the pane makes it the one J/K act on. */
  onFocus: () => void;
  paneRef: React.RefObject<HTMLDivElement | null>;
  scanning: boolean;
}) {
  const draft = finding.draft;
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      const t = textRef.current;
      t?.focus();
      t?.setSelectionRange(t.value.length, t.value.length);
    }
  }, [editing]);

  return (
    <div ref={paneRef} onClick={onFocus} className={`min-h-0 overflow-y-auto rounded-lg p-3 ${focused ? "pane-focus" : ""}`}>
      {draft ? (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="label text-faint">{copy.detail.draftedEmail}</h3>
            {edited && <span className="rounded-full border border-hairline px-1.5 text-meta text-muted">{copy.detail.editedByYou}</span>}
            {finding.status === "approved" && <span className="rounded-full border border-positive/30 px-1.5 text-meta text-positive">{copy.detail.inDrafts}</span>}
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
                className="h-56 w-full resize-none rounded-md border border-muted/50 bg-inset p-2.5 text-small text-text outline-none"
              />
              <div className="mt-1.5 flex items-center justify-between text-meta">
                <span className="text-faint">{copy.detail.editsNotChecked}</span>
                <span className="flex gap-3">
                  {edited && (
                    <button type="button" className="text-faint hover:text-muted" onClick={() => resetEdit(finding.id)}>
                      {copy.detail.revert}
                    </button>
                  )}
                  <button type="button" className="flex items-center gap-1.5 text-accent" onClick={onStopEditing}>
                    {copy.detail.doneEditing} <Kbd keys={["Esc"]} />
                  </button>
                </span>
              </div>
            </>
          ) : (
            <p className="rounded-md border border-hairline bg-inset p-2.5 text-small whitespace-pre-wrap">{draft.body}</p>
          )}
        </div>
      ) : finding.action.kind === "none" ? (
        <div className="rounded-md border border-hairline p-3 text-small text-muted">
          <p className="font-medium text-text">{copy.detail.nothingToSend}</p>
          <p className="mt-0.5">{finding.action.summary}</p>
        </div>
      ) : scanning ? (
        <div className="flex flex-col gap-2" aria-label={copy.detail.writingDraftLabel}>
          <p className="text-meta text-faint">{copy.detail.writingDraft}</p>
          <span className="shimmer h-3 w-3/4 rounded" />
          <span className="shimmer h-3 w-full rounded" />
          <span className="shimmer h-3 w-5/6 rounded" />
        </div>
      ) : (
        <p className="text-small text-danger">{copy.detail.couldntDraft}</p>
      )}

      {/* The figures code worked out: the only numbers the draft may use. A panel of its own, so it reads as the check it is. */}
      <section className="mt-4 rounded-lg border border-hairline bg-surface/60 px-3 pt-2.5 pb-1.5">
        <h3 className="mb-1 flex items-center gap-1.5 label text-faint">
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" className="text-positive">
            <path d="m2.5 6.5 2.25 2.25L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {copy.detail.checkedByCode}
        </h3>
        <dl className="flex flex-col">
          {finding.figures.map((f) => (
            <Tip key={f.id} content={f.how}>
              <div className="flex items-baseline justify-between gap-4 border-b border-hairline/60 py-1.5 last:border-0">
                <dt className="min-w-0 text-small text-muted">
                  {f.label}
                  {f.how && <span className="mt-0.5 block truncate font-mono text-label text-faint">{f.how}</span>}
                </dt>
                <dd className="shrink-0 figure text-small text-text">{figureValue(f)}</dd>
              </div>
            </Tip>
          ))}
        </dl>
      </section>
      <SavedNote finding={finding} />
    </div>
  );
}

// ---------- The whole view ----------

function Amounts({ finding }: { finding: Finding }) {
  const a = finding.amounts;
  const cells = [
    a.atStake !== undefined && [copy.detail.atStake, formatAUD(a.atStake)],
    a.recoverable !== undefined && a.recoverable !== a.atStake && [copy.detail.canRecover, formatAUD(a.recoverable)],
    a.perMonth !== undefined && [copy.detail.perMonth, formatAUD(a.perMonth)],
  ].filter(Boolean) as [string, string][];
  return (
    // The first amount leads (largest); the others sit beside it, smaller.
    <div className="flex shrink-0 items-end gap-5">
      {cells.map(([label, value], i) => (
        <div key={label} className="text-right">
          <div className={`figure ${i === 0 ? "text-heading text-text" : "text-body text-muted"}`}>{value}</div>
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
  editing,
  onStopEditing,
  onSelectEvidence,
  onFocusDraft,
  draftRef,
  scanning,
}: {
  item: Finding | Cleared;
  corpus: Corpus | undefined;
  edited: boolean;
  pane: Pane;
  evidenceIndex: number;
  editing: boolean;
  onStopEditing: () => void;
  onSelectEvidence: (index: number) => void;
  onFocusDraft: () => void;
  draftRef: React.RefObject<HTMLDivElement | null>;
  scanning: boolean;
}) {
  const finding = "evidence" in item ? item : undefined;
  const evidence = evidenceFor(item, corpus);
  // Amounts code checked, written the ways a bill or email would show them.
  const needles = finding
    ? [...new Set(finding.figures.filter((f) => f.unit === "cents").flatMap((f) => {
        const s = formatAUD(Math.abs(Number(f.value)));
        return s.endsWith(".00") ? [s, s.slice(0, -3)] : [s];
      }))]
    : [];

  return (
    <section aria-label={copy.detail.label} className="flex min-h-0 flex-1 flex-col">
      {/* Pinned, like the list's and the timeline's headings. */}
      <ViewHeading
        view="finding"
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
        <span className="line-clamp-2">{item.why}</span>
        {finding?.deadline && (
          <span className="mt-0.5 block truncate text-meta text-faint">
            {copy.detail.nextDate(finding.deadline.label, shortDate(finding.deadline.date))}
          </span>
        )}
      </ViewHeading>

      {finding && isUnsure(finding) && (
        <div className="mx-4 mt-2 rounded-md border border-info/25 bg-info/8 px-3 py-1.5 text-meta">
          <span className="font-semibold text-info">{copy.detail.notSure}</span>
          <span className="text-muted">{finding.doubts.join(" ") || copy.detail.lessConfident}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-2 px-2 pt-2">
        <EvidenceTrail items={evidence} selected={evidenceIndex} focused={pane === "evidence"} needles={needles} onSelect={onSelectEvidence} />
        {finding ? (
          <DraftPane finding={finding} edited={edited} editing={editing} onStopEditing={onStopEditing} focused={pane === "draft"} paneRef={draftRef} scanning={scanning} onFocus={onFocusDraft} />
        ) : (
          <div className="rounded-lg p-3 text-small">
            <h3 className="mb-1.5 label text-faint">{copy.detail.whyLeftAlone}</h3>
            <p className="text-muted">{(item as Cleared).why}</p>
            <p className="mt-3 text-faint">{copy.detail.nothingToDo}</p>
          </div>
        )}
      </div>
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
export type Command = "approve" | "edit" | "snooze" | "dismiss" | "undo" | "rescan" | "open" | "pane";

/** The keys for what's selected, shown under the list or the open finding. Each one can also be clicked. */
export function ActionBar({
  item,
  detail,
  pane,
  mouse,
  onCommand,
}: {
  item?: Finding | Cleared | { undecided: string };
  detail: boolean;
  pane?: Pane;
  /** The mouse is driving: say what a click does instead of listing keys. */
  mouse: boolean;
  onCommand: (command: Command) => void;
}) {
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
      ];
    } else {
      hints = [{ keys: ["⌘", "Z"], label: copy.actions.undo, command: "undo", icon: <UndoIcon /> }];
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
        {detail && !mouse && twoPanes && <KeyButton keys={["Tab"]} label={copy.actions.switchPane} icon={<PaneIcon />} tone="faint" onClick={() => onCommand("pane")} />}
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
