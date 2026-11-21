import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronRight } from "lucide-react";
import type { Corpus } from "../../agent/corpus";
import type { Cleared, Finding } from "../../agent/pipeline";
import type { FixRoute } from "../../agent/routes";
import { getConnectors } from "../../connectors/live";
import { formatAUD } from "../../lib/money";
import { cannotRemind, resetEdit, setEdit, useScan, type ScanState } from "../../lib/scan-store";
import { evidenceDate, lookupEvidence, type EvidenceView } from "../evidence";
import { daysUntil, figureValue, isUnsure, shortDate, urgency } from "../format";
import { copy } from "../../copy";
import {
  ApproveIcon,
  BankIcon,
  CalendarIcon,
  DismissIcon,
  DocumentIcon,
  EditIcon,
  EmailIcon,
  OpenIcon,
  PhotoIcon,
  TraceIcon,
  RemindIcon,
  ResetIcon,
  SidebarIcon,
  AttachIcon,
  SubjectIcon,
  ToIcon,
  UndoIcon,
} from "../icons";
import { NextSteps } from "./NextSteps";
import { CopyIcon, RouteChooser, RoutePanel } from "./RoutePanel";
import { chosenRoute, usesEmail } from "../fix-route";
import { Kbd, KeyButton } from "../Kbd";
import { iconButton } from "./Controls";
import { dragByBar } from "./Header";
import { ShellAside } from "./PaletteShell";
import { ViewHeading } from "./ViewHeading";
import { DEADLINE_TONE } from "./FindingsList";
import { SavedNote } from "../replay";
import { Peek, Sheet, Tip } from "../layers";
import { CountUp } from "../CountUp";
import { useGlide, useSettleText } from "../motion";

// One finding, opened. The main column has the header (business, kind, the
// amount at stake, the deadline) and the drafted fix. The sidebar on the right
// belongs to this finding: one accordion with three panels (the evidence it
// relied on, open to start; what else it gathered; the figures code checked).
// A piece of evidence opens a small card with a preview, and the card opens
// the whole source in a sheet. The Palette owns the keys; this only draws.

/** Which side J/K act on: the sidebar ("evidence") or the draft. */
export type Pane = "evidence" | "draft";

/** The sidebar's three panels. */
export type PanelId = "cited" | "gathered" | "figures";

/** The panels open when a finding is opened: only the evidence it relied on. */
export const DEFAULT_PANELS: PanelId[] = ["cited"];

/** One place J/K can stop in the sidebar: a panel's header, or a piece of evidence (its place in sidebarEvidence). */
export type SideStop = { panel: PanelId } | { evidence: number };

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

/** A photo with no text layer (the meter photo): small in the card, large in the sheet. */
function EvidenceImage({ docId, alt, large = false }: { docId: string; alt: string; large?: boolean }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadImage(docId).then(setSrc, () => setFailed(true));
  }, [docId]);
  if (failed) return <p className="text-meta text-danger">{copy.detail.photoFailed}</p>;
  if (!src) return <div className={`shimmer rounded-md ${large ? "h-80" : "h-24"}`} aria-label={copy.detail.loadingPhoto} />;
  return (
    <img
      src={src}
      alt={alt}
      className={`w-full rounded-md border border-hairline ${large ? "max-h-[360px] object-contain" : "h-24 object-cover"}`}
    />
  );
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

// Documents line their columns up with runs of spaces, which wrap badly in a
// narrow box: a dot between the label and its value reads the same.
function tidy(text: string) {
  return text.trim().replace(/[ \t]{2,}:/g, ":").replace(/(\S)[ \t]{3,}(?=\S)/g, "$1 · ");
}

/** Longest preview in a piece of evidence's card. */
const PREVIEW_CHARS = 30;

/**
 * A few words from the source for its card: around the first amount code
 * checked when there is one (so the card shows why it matters), else the start.
 * At most PREVIEW_CHARS characters, with … where it was cut.
 */
export function previewText(view: EvidenceView, needles: string[]): string | undefined {
  const flat = (view.body ? tidy(view.body) : view.kind === "txn" ? view.title : "").replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  if (flat.length <= PREVIEW_CHARS) return flat;
  const hits = needles.map((n) => flat.indexOf(n)).filter((i) => i >= 0);
  let start = hits.length ? Math.max(0, Math.min(...hits) - 10) : 0;
  // Start on a whole word.
  if (start > 0) {
    const space = flat.lastIndexOf(" ", start);
    start = space < 0 ? 0 : space + 1;
  }
  const lead = start > 0 ? "…" : "";
  const room = PREVIEW_CHARS - lead.length - 1;
  const cut = flat.slice(start, start + room).trimEnd();
  return start + room >= flat.length ? lead + flat.slice(start) : `${lead}${cut}…`;
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

/** The sidebar's evidence in the order it is drawn: what it relied on, then what else it gathered. */
function sidebarGroups(item: Finding | Cleared, corpus: Corpus | undefined) {
  const all = evidenceFor(item, corpus);
  return {
    cited: all.filter((i) => i.cited).map((i) => i.view),
    gathered: all.filter((i) => !i.cited).map((i) => i.view),
    figures: "figures" in item ? item.figures.length : 0,
  };
}

/** Every piece of evidence in drawing order (a SideStop's evidence number points in here). */
export function sidebarEvidence(item: Finding | Cleared, corpus: Corpus | undefined): EvidenceView[] {
  const g = sidebarGroups(item, corpus);
  return [...g.cited, ...g.gathered];
}

/**
 * The stops J/K move through in the sidebar, top to bottom: each panel's
 * header, and the evidence inside the ones that are open. "Checked by code"
 * is the last stop (its figures are read, not stepped through).
 */
export function sidebarStops(item: Finding | Cleared, corpus: Corpus | undefined, panels: PanelId[]): SideStop[] {
  const g = sidebarGroups(item, corpus);
  const stops: SideStop[] = [];
  let at = 0;
  for (const [id, list] of [["cited", g.cited], ["gathered", g.gathered]] as const) {
    if (!list.length) continue;
    stops.push({ panel: id });
    if (panels.includes(id)) list.forEach((_, i) => stops.push({ evidence: at + i }));
    at += list.length;
  }
  if (g.figures) stops.push({ panel: "figures" });
  return stops;
}

/** Where the selection starts in a newly opened finding: its first piece of evidence (else the first header). */
export function firstStop(stops: SideStop[]): number {
  return Math.max(0, stops.findIndex((s) => "evidence" in s));
}

const isPanel = (s: SideStop | undefined, id: PanelId) => !!s && "panel" in s && s.panel === id;
const isEvidence = (s: SideStop | undefined, index: number) => !!s && "evidence" in s && s.evidence === index;

// Shared by every line in the sidebar, so the headers and the evidence line up.
const LINE = "row-press relative flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-meta";

/** A piece of evidence's card: where it's from, a few words of it (or the photo), and Open source. */
function PeekCard({ view, needles, onOpenSource }: { view: EvidenceView; needles: string[]; onOpenSource: () => void }) {
  const text = previewText(view, needles);
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1.5 px-2.5 pt-2 pb-2.5">
        <p className="flex min-w-0 items-center gap-1.5 text-label text-faint">
          <span className="shrink-0">
            <SourceIcon view={view} />
          </span>
          <span className="min-w-0 truncate">
            {view.source} · {view.meta}
          </span>
        </p>
        {view.imageDocId && <EvidenceImage docId={view.imageDocId} alt={view.title} />}
        {text && (
          <p className="text-small text-muted">
            <Highlighted text={text} needles={needles} />
          </p>
        )}
        {view.kind === "txn" && view.amount && (
          <p className="figure text-small text-text">
            {view.amount} <span className="text-faint">· {evidenceDate(view)}</span>
          </p>
        )}
      </div>
      <div className="mx-1.5 h-px bg-hairline" />
      {/* Focus starts here when the card opens, so Enter opens the source. Shown as a filled row, like a menu's. */}
      <button
        type="button"
        onClick={onOpenSource}
        className="peek-action press mt-1 flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-meta text-text hover:bg-raised focus-visible:bg-raised"
      >
        <span className="flex-1 text-left">{copy.detail.openSource}</span>
        <span className="text-muted">
          <OpenIcon />
        </span>
        <Kbd keys={["↵"]} />
      </button>
    </div>
  );
}

/** The whole source, over a dimmed palette: the full text with checked amounts marked, or the photo, or the bank line. */
function SourceSheet({ view, needles, onClose }: { view?: EvidenceView; needles: string[]; onClose: () => void }) {
  // Keep showing the last source while the sheet fades out.
  const last = useRef(view);
  if (view) last.current = view;
  const shown = view ?? last.current;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Start scrolled so the first checked amount is in view.
    const box = body.current;
    const mark = box?.querySelector("mark");
    if (box && mark && mark.offsetTop > box.clientHeight * 0.6) box.scrollTop = mark.offsetTop - box.clientHeight / 3;
  }, [view]);
  return (
    <Sheet
      open={!!view}
      onClose={onClose}
      title={shown?.title}
      // J/K (and the arrows) scroll the source, as they scroll the draft.
      onKeyDown={(e) => {
        const down = e.key === "j" || e.key === "ArrowDown";
        const up = e.key === "k" || e.key === "ArrowUp";
        if (!down && !up) return;
        e.preventDefault();
        body.current?.scrollBy({ top: down ? 64 : -64 });
      }}
      className="flex max-h-[calc(100%-64px)] w-[560px] flex-col rounded-xl border border-hairline bg-surface shadow-(--shadow-sheet)"
    >
      {shown && (
        <>
          <header className="flex shrink-0 items-start gap-3 border-b border-hairline px-5 py-4">
            <span className="mt-1 shrink-0 text-faint">
              <SourceIcon view={shown} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="label text-faint">
                {shown.source}
                {shown.date && ` · ${evidenceDate(shown)}`}
              </p>
              <h2 className={`mt-0.5 heading text-body text-text ${shown.kind === "txn" ? "font-mono" : ""}`}>{shown.title}</h2>
              <p className="mt-0.5 truncate text-meta text-faint">{shown.meta}</p>
            </div>
            <Kbd keys={["Esc"]} />
          </header>
          <div ref={body} className="relative min-h-0 overflow-y-auto px-5 py-4">
            {shown.imageDocId && <EvidenceImage docId={shown.imageDocId} alt={shown.title} large />}
            {shown.body ? (
              <p className="text-small whitespace-pre-wrap text-muted">
                <Highlighted text={tidy(shown.body)} needles={needles} />
              </p>
            ) : shown.kind === "txn" ? (
              // The title above is the bank's description, so this adds the rest.
              <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-small">
                <dt className="text-faint">{copy.detail.sourceAccount}</dt>
                <dd className="text-muted">{shown.meta}</dd>
                <dt className="text-faint">{copy.detail.sourceDate}</dt>
                <dd className="figure text-muted">{evidenceDate(shown)}</dd>
                <dt className="text-faint">{copy.detail.sourceAmount}</dt>
                <dd className="figure text-text">{shown.amount}</dd>
              </dl>
            ) : (
              !shown.imageDocId && <p className="text-small text-faint">{copy.detail.noText}</p>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

/** A small square button with an icon and a tooltip that names it and its key (the sidebar's buttons). */
function IconButton({
  label,
  keys,
  pressed,
  expanded,
  onClick,
  children,
}: {
  label: string;
  keys: string[];
  pressed?: boolean;
  expanded?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tip content={label} keys={keys} side="bottom">
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        // Keep keyboard focus where it is (the palette, or the draft being edited), so the keys keep working.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={iconButton(pressed ? "on" : "off", false)}
      >
        {children}
      </button>
    </Tip>
  );
}

function Sidebar({
  asideRef,
  open,
  onToggleOpen,
  traceOpen,
  onTrace,
  onNotALeak,
  item,
  corpus,
  finding,
  stops,
  selected,
  focused,
  panels,
  peek,
  source,
  needles,
  mouse,
  onTogglePanel,
  onPeek,
  onOpenSource,
}: {
  /** The sliding column, so the draft can tell how wide it will end up. */
  asideRef: React.RefObject<HTMLElement | null>;
  /** Slid away (the icon at the window's top right, or ]), so the rest of the app takes the full width. */
  open: boolean;
  onToggleOpen: () => void;
  /** The trace drawer is open on this finding (the trace icon shows as pressed). */
  traceOpen: boolean;
  /** The trace icon (or T): opens this finding's trace, or closes it. */
  onTrace: () => void;
  /** Not a leak (or D), while the finding still needs a decision. */
  onNotALeak?: () => void;
  item: Finding | Cleared;
  corpus: Corpus | undefined;
  finding?: Finding;
  stops: SideStop[];
  /** The selected stop (its place in stops). */
  selected: number;
  focused: boolean;
  panels: PanelId[];
  /** The piece of evidence whose card is open (-1: none). */
  peek: number;
  /** The piece of evidence open in the sheet (-1: none). */
  source: number;
  needles: string[];
  mouse: boolean;
  onTogglePanel: (id: PanelId) => void;
  onPeek: (index: number) => void;
  onOpenSource: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // The selected line has the same sliding highlight as the list and the timeline.
  useGlide(listRef, highlightRef);
  // Lines move while a panel opens or closes. The highlight rides along with
  // its line on every frame of that animation, then is drawn once more when it settles.
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

  const groups = sidebarGroups(item, corpus);
  const all = [...groups.cited, ...groups.gathered];
  // Only the side J/K act on shows its selection (the bar marks where the keys go).
  const at = focused && !mouse ? stops[selected] : undefined;

  const evidenceLine = (view: EvidenceView, index: number) => {
    const open = index === peek;
    return (
      <Peek
        key={view.id}
        open={open}
        onOpenChange={(o) => onPeek(o ? index : -1)}
        label={view.title}
        trigger={
          // The palette owns the keys, so the line never takes focus (like "Checked and left alone").
          <div aria-selected={isEvidence(at, index)} className={`${LINE} ${open ? "text-text" : "text-muted"} hover:text-text`}>
            <span className={`shrink-0 ${open ? "text-muted" : "text-faint"}`}>
              <SourceIcon view={view} />
            </span>
            <span className={`min-w-0 flex-1 truncate ${view.kind === "txn" ? "font-mono" : ""}`}>{view.title}</span>
            {view.amount && <span className="shrink-0 figure text-meta text-text">{view.amount}</span>}
            <span className="min-w-11 shrink-0 text-right figure text-label whitespace-nowrap text-faint">{evidenceDate(view)}</span>
          </div>
        }
      >
        <PeekCard view={view} needles={needles} onOpenSource={() => onOpenSource(index)} />
      </Peek>
    );
  };

  const panel = (id: PanelId, title: string, count: number, body: React.ReactNode) => {
    const selectedHere = isPanel(at, id);
    const open = panels.includes(id);
    return (
      <Accordion.Item key={id} value={id} data-glide-rows className="[&+&]:mt-1">
        <Accordion.Trigger asChild>
          <div aria-selected={selectedHere} className={`${LINE} text-muted hover:text-text`}>
            <span className={`label ${selectedHere || open ? "text-muted" : "text-faint"}`}>{title}</span>
            {/* The count in a circle, the same in all three panels. */}
            <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full border border-hairline px-1 figure text-label text-faint">{count}</span>
            <ChevronRight size={12} strokeWidth={2} aria-hidden="true" className="accordion-chevron shrink-0 text-faint" />
            <span className="flex-1" />
            {id === "figures" && selectedHere && <Kbd keys={["C"]} />}
          </div>
        </Accordion.Trigger>
        <Accordion.Content className="accordion-content">
          <div data-glide-rows className="pb-1">
            {body}
          </div>
        </Accordion.Content>
      </Accordion.Item>
    );
  };

  // What the agent did for this finding: the trace drawer, opened on it (T does the same; a second press closes it).
  const trace = (
    <IconButton label={finding ? copy.actions.traceTip : copy.actions.traceClearedTip} keys={["T"]} pressed={traceOpen} onClick={onTrace}>
      <TraceIcon />
    </IconButton>
  );

  const notALeak = onNotALeak && (
    <IconButton label={copy.actions.notALeak} keys={["D"]} onClick={onNotALeak}>
      <DismissIcon />
    </IconButton>
  );

  return (
    <>
    {/* The column's width slides between the sidebar and nothing. Its contents keep their full width and
        ride its left edge, so they glide out past the window's side instead of being squeezed. */}
    <aside
      ref={asideRef}
      aria-label={copy.detail.sidebarLabel}
      className={`relative flex h-full shrink-0 flex-col overflow-clip transition-[width] duration-(--duration-panel) ease-(--ease-panel) ${open ? "w-84" : "w-0"}`}
    >
      {/* Stays in the page while closed so it can slide back; inert keeps clicks and screen readers out of it. */}
      <div
        inert={!open}
        className={`relative flex h-full w-84 shrink-0 flex-col transition-opacity duration-(--duration-panel) ease-(--ease-panel) ${open ? "opacity-100" : "opacity-0"}`}
      >
      {/* The open sidebar's edge: a dotted zig-zag line down its whole height. */}
      <div className="stitch-y pointer-events-none absolute inset-y-0 left-0 z-1" aria-hidden="true" />
      {/* The sidebar's own heading, pinned like the main one. It runs up beside the top bar, so like the
          top bar it also moves the window. The right padding leaves room for the collapse icon. */}
      <div onMouseDown={dragByBar} className="flex h-12 w-84 shrink-0 items-center gap-1 pr-12 pl-4">
        <h2 className="min-w-0 flex-1 truncate heading text-small font-semibold">{finding ? copy.detail.sidebarTitle : copy.detail.sidebarTitleCleared}</h2>
        {notALeak}
        {trace}
      </div>
      <div ref={listRef} onAnimationStart={onAnimationStart} onAnimationEnd={redraw} className="relative min-h-0 w-84 flex-1 overflow-y-auto p-2">
        {focused && !mouse && <div ref={highlightRef} className="glide inset-x-2" style={{ "--glide-bar-inset": "7px" } as React.CSSProperties} aria-hidden="true" />}
        <Accordion.Root
          type="multiple"
          value={panels}
          // Radix hands over the new set of open panels: pass on the one that changed.
          onValueChange={(value) => {
            const changed = [...value, ...panels].find((id) => value.includes(id) !== panels.includes(id as PanelId));
            if (changed) onTogglePanel(changed as PanelId);
          }}
        >
          {groups.cited.length > 0 && panel("cited", copy.detail.reliedOn, groups.cited.length, groups.cited.map((v, i) => evidenceLine(v, i)))}
          {groups.gathered.length > 0 &&
            panel("gathered", copy.detail.alsoGathered, groups.gathered.length, groups.gathered.map((v, i) => evidenceLine(v, groups.cited.length + i)))}
          {/* The figures code worked out: the only numbers the draft may use. */}
          {finding &&
            finding.figures.length > 0 &&
            panel(
              "figures",
              copy.detail.checkedByCode,
              finding.figures.length,
              <dl className="flex flex-col px-2">
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
              </dl>,
            )}
        </Accordion.Root>
      </div>
      </div>
      <SourceSheet view={source >= 0 ? all[source] : undefined} needles={needles} onClose={() => onOpenSource(-1)} />
    </aside>
    {/* One icon that never moves: pinned to the window's top right, while the sidebar slides beneath it.
        Closed, it is simply the last icon in the top bar. */}
    <div className="absolute top-2.5 right-4 z-5">
      <IconButton label={open ? copy.detail.hideSidebar : copy.detail.showSidebar} keys={["]"]} expanded={open} onClick={onToggleOpen}>
        <SidebarIcon open={open} />
      </IconButton>
    </div>
    </>
  );
}

// ---------- Draft ----------

/**
 * The draft's text, read or edited: the same type, spacing and line height in
 * both, so nothing moves when editing starts. Its box spans the same width as
 * the "Drafted email" block above (its soft wash on hover and while editing
 * stays inside that column). The line height is a whole number of pixels
 * (22), so the text and the editor measure exactly the same.
 */
const DRAFT_TEXT = "w-full rounded-lg px-3 py-2.5 text-small leading-5.5 whitespace-pre-wrap";

/** The row under the draft: Edit on hover, or Revert and Done while editing. One height for both, so it never shifts. */
const UNDER_DRAFT = "mt-3 flex h-7 items-center text-meta";

/** Revert your edits while editing: ⌘⇧⌫ (letters would type into the draft). */
export const REVERT_KEYS = ["⌘", "⇧", "⌫"];

/** The value the Details accordion (To, Subject, Attach) uses for its one item. */
const DETAILS = "details";

/**
 * Whether the finding shows the draft panel at all. Once approved it doesn't:
 * the Next timeline's first line says what was saved, and Edit takes it back.
 */
export function hasDraftPanel(finding: Finding): boolean {
  return finding.status !== "approved";
}

/** One line of the draft's Details: an icon for its label (the name is its tooltip and what a screen reader says), then the value. */
function DetailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="flex h-5 items-center text-faint">
        <Tip content={label}>
          <span className="grid size-4 place-items-center [&>svg]:block">
            {icon}
            <span className="sr-only">{label}</span>
          </span>
        </Tip>
      </dt>
      <dd className="flex min-h-5 min-w-0 items-center">{children}</dd>
    </>
  );
}

function Draft({
  finding,
  edited,
  editing,
  mouse,
  detailsOpen,
  onToggleDetails,
  onEdit,
  onStopEditing,
  onCopy,
  scanning,
}: {
  finding: Finding;
  edited: boolean;
  editing: boolean;
  mouse: boolean;
  /** To, Subject and Attach are unfolded (open to start; Enter on the draft side, or a click, folds them). */
  detailsOpen: boolean;
  onToggleDetails: () => void;
  /** Start editing (a click in the draft, or its hover Edit): the same as E. */
  onEdit: () => void;
  onStopEditing: () => void;
  /** Y: copy the draft (only when the finding has routes). */
  onCopy?: () => void;
  scanning: boolean;
}) {
  const draft = finding.draft;
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Where in the text a click landed, so the editor opens with the caret there (else at the end).
  const caretAt = useRef<number | undefined>(undefined);


  // The editor grows with the text (no box that scrolls inside the page), so reading and editing take
  // the same room and nothing jumps when editing starts.
  // To size itself the editor collapses for a moment; that would make the page shorter and the browser
  // would pull the scroll position up (a jump). So it's created at the read text's exact height, and puts
  // the scroll position back after each measure.
  const readRef = useRef<HTMLParagraphElement>(null);
  const readHeight = useRef(0);
  useLayoutEffect(() => {
    if (!editing && readRef.current) readHeight.current = readRef.current.offsetHeight;
  });
  useLayoutEffect(() => {
    const t = textRef.current;
    if (!editing || !t) return;
    const scroller = t.closest<HTMLElement>(".overflow-y-auto");
    const keep = scroller?.scrollTop;
    t.style.height = "0px";
    t.style.height = `${t.scrollHeight}px`;
    if (scroller && keep !== undefined) scroller.scrollTop = keep;
  }, [editing, draft?.body]);
  // The sidebar sliding changes the editor's width, so its lines rewrap: keep it the height of its text.
  useEffect(() => {
    const t = textRef.current;
    if (!editing || !t) return;
    let width = t.offsetWidth;
    const watch = new ResizeObserver(() => {
      if (t.offsetWidth === width) return;
      width = t.offsetWidth;
      const scroller = t.closest<HTMLElement>(".overflow-y-auto");
      const keep = scroller?.scrollTop;
      t.style.height = "0px";
      t.style.height = `${t.scrollHeight}px`;
      if (scroller && keep !== undefined) scroller.scrollTop = keep;
    });
    watch.observe(t);
    return () => watch.disconnect();
  }, [editing]);

  useEffect(() => {
    if (editing) {
      const t = textRef.current;
      if (!t) return;
      const clicked = caretAt.current !== undefined;
      const at = Math.min(caretAt.current ?? t.value.length, t.value.length);
      caretAt.current = undefined;
      t.setSelectionRange(at, at);
      // After a click the caret is already in view, so the page stays put; with E (caret at the end) it may scroll to it.
      t.focus({ preventScroll: clicked });
    }
  }, [editing]);

  // A click in the draft's text: note which character it landed on, then start editing.
  const editAt = (e: React.MouseEvent) => {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
    caretAt.current = pos ? pos.offset : doc.caretRangeFromPoint?.(e.clientX, e.clientY)?.startOffset;
    onEdit();
  };
  // Only a draft that still needs approving can be edited in place.
  const canEdit = !!draft && finding.status === "new";

  // Once approved there's no panel: the Next timeline says what was saved (or the step), and Edit takes it back.
  if (!hasDraftPanel(finding)) return null;
  const stepOnly = !draft && finding.action.kind === "none";

  let body: React.ReactNode;
  if (!draft) {
    if (stepOnly)
      body = (
        <div className="rounded-md border border-hairline p-3 text-small text-muted">
          <p className="font-medium text-text">{copy.detail.nothingToSend}</p>
          <p className="mt-0.5">{finding.action.summary}</p>
        </div>
      );
    else if (scanning)
      body = (
        <div className="flex flex-col gap-2" aria-label={copy.detail.writingDraftLabel}>
          <p className="text-meta text-faint">{copy.detail.writingDraft}</p>
          <span className="shimmer h-3 w-3/4 rounded" />
          <span className="shimmer h-3 w-full rounded" />
          <span className="shimmer h-3 w-5/6 rounded" />
        </div>
      );
    else body = <p className="text-small text-danger">{copy.detail.couldntDraft}</p>;
  } else {
    body = (
      <>
        {/* The title is the fold: who it's to, what it's about and what's attached sit inside, until wanted.
            Drawn like the sidebar's panel headers (same line, type and chevron), so the two read as one system. */}
        <Accordion.Root type="single" collapsible value={detailsOpen ? DETAILS : ""} onValueChange={onToggleDetails} className="mb-3">
          <Accordion.Item value={DETAILS}>
            <div className="flex items-center gap-2">
              <Accordion.Trigger asChild>
                <div
                  className={`${LINE} -mx-2 w-fit text-muted hover:text-text`}
                  // Folding it mid-edit keeps the caret in the editor, so typing carries on.
                  onMouseDown={(e) => {
                    if (editing) e.preventDefault();
                  }}
                >
                  <span className={`label ${detailsOpen ? "text-muted" : "text-faint"}`}>{copy.detail.draftedEmail}</span>
                  <ChevronRight size={12} strokeWidth={2} aria-hidden="true" className="accordion-chevron shrink-0 text-faint" />
                </div>
              </Accordion.Trigger>
              {edited && <span className="shrink-0 rounded-full border border-hairline px-1.5 text-meta text-muted">{copy.detail.editedByYou}</span>}
            </div>
            <Accordion.Content className="accordion-content">
              <dl className="grid grid-cols-[16px_1fr] gap-x-2.5 gap-y-1 pt-0.5 pb-1 text-meta">
                <DetailRow icon={<ToIcon />} label={copy.detail.to}>
                  <span className="truncate">
                    {draft.to.name} <span className="text-faint">{draft.to.address}</span>
                  </span>
                </DetailRow>
                <DetailRow icon={<SubjectIcon />} label={copy.detail.subject}>
                  {draft.subject}
                </DetailRow>
                {draft.attachDocumentIds.length > 0 && (
                  <DetailRow icon={<AttachIcon />} label={copy.detail.attach}>
                    <span className="text-muted">{copy.detail.attachments(draft.attachDocumentIds.length)}</span>
                  </DetailRow>
                )}
              </dl>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
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
        {editing ? (
          <>
            <textarea
              ref={textRef}
              // Created at the read text's exact height. It has to be there from the start: the "Drafted email" fold
              // above measures itself while the switch happens, and a moment of a shorter page would pull the scroll
              // up. (While editing this value doesn't change, so it never undoes the growing below.)
              style={readHeight.current ? { height: `${readHeight.current}px` } : undefined}
              aria-label={copy.detail.draftBody}
              value={draft.body}
              onChange={(e) => setEdit(finding.id, e.target.value)}
              className={`draft-editor ${DRAFT_TEXT} block resize-none overflow-hidden bg-raised/60 text-text shadow-[0_0_0_1px_var(--color-hairline)] outline-none`}
            />
            <div className={`${UNDER_DRAFT} justify-between`}>
              <span className="text-faint">{copy.detail.editsNotChecked}</span>
              {/* Like every button: the key in keyboard mode, an icon with the mouse. They keep focus in the editor.
                  The right padding cancels the button's own negative margin, so its edge lines up with the text box's. */}
              <span className="flex shrink-0 items-center gap-3 pr-1.5">
                {/* One step: the agent's draft back, and editing done. */}
                {edited && (
                  <KeyButton
                    keys={REVERT_KEYS}
                    label={copy.detail.revert}
                    icon={<ResetIcon />}
                    mouse={mouse}
                    onClick={() => {
                      resetEdit(finding.id);
                      onStopEditing();
                    }}
                  />
                )}
                <KeyButton keys={["Esc"]} label={copy.detail.doneEditing} icon={<ApproveIcon />} mouse={mouse} onClick={onStopEditing} />
              </span>
            </div>
          </>
        ) : canEdit ? (
          // Click anywhere in the text to edit it there. Edit shows on hover in the row under it, where Done
          // sits while editing, so nothing moves when editing starts.
          <div className="group">
            <p
              ref={readRef}
              onClick={editAt}
              className={`${DRAFT_TEXT} cursor-text overflow-hidden bg-raised/60 transition-shadow duration-(--duration-fast) group-hover:shadow-[0_0_0_1px_var(--color-hairline)]`}
            >
              {/* The inner line keeps its wrap while the sidebar slides; the box clips it. */}
              <span data-settle className="block">
                {draft.body}
              </span>
            </p>
            <div className={`${UNDER_DRAFT} justify-end`}>
              <span className="flex items-center gap-3 pr-1.5 opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100">
                {onCopy && <KeyButton keys={["Y"]} label={copy.routes.copy} icon={<CopyIcon />} mouse={mouse} onClick={onCopy} />}
                <KeyButton keys={["E"]} label={copy.actions.edit} icon={<EditIcon />} mouse={mouse} onClick={onEdit} />
              </span>
            </div>
          </div>
        ) : (
          <p className={`${DRAFT_TEXT} overflow-hidden bg-raised/60`}>
            <span data-settle className="block">
              {draft.body}
            </span>
          </p>
        )}
      </>
    );
  }

  return (
    // What the agent prepared, then the content. With a draft, its "Drafted email" fold is the title;
    // without one (a step to take, or still writing), a plain title in the same style.
    <div>
      {!draft && <h3 className="mb-1.5 flex h-7 items-center label text-faint">{stepOnly ? copy.detail.whatToDo : copy.detail.draftedEmail}</h3>}
      {body}
    </div>
  );
}

// ---------- The whole view ----------

function Amounts({ finding }: { finding: Finding }) {
  const a = finding.amounts;
  const cells = [
    a.atStake !== undefined && [copy.detail.atStake, a.atStake],
    a.recoverable !== undefined && a.recoverable !== a.atStake && [copy.detail.canRecover, a.recoverable],
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
  stops,
  stop,
  panels,
  peek,
  source,
  editing,
  detailsOpen,
  mouse,
  onStopEditing,
  onToggleDetails,
  onTogglePanel,
  onPeek,
  onOpenSource,
  onFocusDraft,
  onCommand,
  onPickRoute,
  onSample,
  sidebarOpen,
  onToggleSidebar,
  traceOpen,
  tracePressed,
  draftRef,
  scanning,
}: {
  item: Finding | Cleared;
  corpus: Corpus | undefined;
  edited: boolean;
  pane: Pane;
  /** The sidebar's stops (see sidebarStops) and the selected one's place in them. */
  stops: SideStop[];
  stop: number;
  panels: PanelId[];
  /** The evidence whose card is open, and the one open in the sheet (-1: none). */
  peek: number;
  source: number;
  editing: boolean;
  /** The draft's Details (To, Subject, Attach) are unfolded. */
  detailsOpen: boolean;
  mouse: boolean;
  onStopEditing: () => void;
  onToggleDetails: () => void;
  onTogglePanel: (id: PanelId) => void;
  onPeek: (index: number) => void;
  onOpenSource: (index: number) => void;
  /** A click in the main column makes the draft the side J/K act on. */
  onFocusDraft: () => void;
  /** The action row's buttons (Approve, Seal the leak, Edit, ...). */
  onCommand: (command: Command) => void;
  /** Keys 1-4, or a click on a route. */
  onPickRoute: (index: number) => void;
  /** Show the labelled stand-in for this route's page. */
  onSample: (route: FixRoute) => void;
  /** The sidebar is showing (] or the icon at the window's top right slides it away). */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** The trace drawer is open over the bottom: the draft keeps room to scroll above it, and the trace icon shows pressed. */
  traceOpen: boolean;
  /** The drawer shows this finding's trace (its icon shows pressed). */
  tracePressed: boolean;
  draftRef: React.RefObject<HTMLDivElement | null>;
  scanning: boolean;
}) {
  const finding = "evidence" in item ? item : undefined;
  const scan = useScan();
  const reminder = scan.reminders[item.id];
  const route = finding && chosenRoute(finding, scan);
  // Amounts code checked, written the ways a bill or email would show them.
  const needles = finding
    ? [...new Set(finding.figures.filter((f) => f.unit === "cents").flatMap((f) => {
        const s = formatAUD(Math.abs(Number(f.value)));
        return s.endsWith(".00") ? [s, s.slice(0, -3)] : [s];
      }))]
    : [];
  // While the sidebar slides, the heading and draft text wrap once rather than on every frame.
  const areaRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  useSettleText(areaRef, asideRef, sidebarOpen);

  return (
    <section ref={areaRef} aria-label={copy.detail.label} className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Pinned, like the list's and the timeline's headings. */}
        <ViewHeading
          divider
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
              {/* The date is in the chip above, and a reminder in the notice below. */}
              <span className="block overflow-hidden">
                <span data-settle className="line-clamp-3">
                  {item.why}
                </span>
              </span>
            </>
          )}
        </ViewHeading>

        {finding && isUnsure(finding) && (
          <div className="mx-4 mt-2 rounded-md border border-info/25 bg-info/8 px-3 py-1.5 text-meta">
            <span className="font-semibold text-info">{copy.detail.notSure}</span>
            <span className="text-muted">{finding.doubts.join(" ") || copy.detail.lessConfident}</span>
          </div>
        )}

        {/* With the trace drawer open over the bottom, the draft gets the same room underneath (and the
            editor scrolls clear of it when focused), so nothing is stuck behind the drawer. */}
        <div
          ref={draftRef}
          onClick={finding ? onFocusDraft : undefined}
          className={`min-h-0 flex-1 overflow-y-auto p-2 ${traceOpen ? "pb-(--trace-height) [scroll-padding-bottom:var(--trace-height)]" : ""}`}
        >
          {finding ? (
            <div className={`rounded-lg p-3 ${pane === "draft" && !mouse ? "pane-focus" : ""}`}>
              {/* Approved, or put off with a reminder: what happens next, as a small timeline. */}
              {(finding.status === "approved" || reminder) && <NextSteps
                  finding={finding}
                  mouse={mouse}
                  onSeal={() => onCommand("seal")}
                  onEdit={() => onCommand("edit")}
                  onRemoveReminder={() => onCommand("remind")}
                  onEscalate={() => onCommand("escalate")}
                />}
              {/* Still to approve: the best way and the others. Once approved the route is fixed (⌘Z to change it). */}
              {route && finding.status === "new" && !editing && <RouteChooser finding={finding} route={route} mouse={mouse} onPick={onPickRoute} />}
              {route && route.kind !== "email" ? (
                <RoutePanel finding={finding} route={route} mouse={mouse} onCopy={() => onCommand("copy")} onSample={() => onSample(route)} />
              ) : (
                <Draft
                  finding={finding}
                  edited={edited}
                  editing={editing}
                  mouse={mouse}
                  detailsOpen={detailsOpen}
                  onToggleDetails={onToggleDetails}
                  onEdit={() => onCommand("edit")}
                  onStopEditing={onStopEditing}
                  onCopy={route ? () => onCommand("copy") : undefined}
                  scanning={scanning}
                />
              )}
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

      {/* Drawn in the window's full-height column, beside the top and bottom bars. */}
      <ShellAside>
      <Sidebar
        asideRef={asideRef}
        open={sidebarOpen}
        onToggleOpen={onToggleSidebar}
        traceOpen={tracePressed}
        onTrace={() => onCommand("trace")}
        onNotALeak={finding?.status === "new" ? () => onCommand("dismiss") : undefined}
        item={item}
        corpus={corpus}
        finding={finding}
        stops={stops}
        selected={stop}
        focused={pane === "evidence" && sidebarOpen}
        panels={panels}
        peek={peek}
        source={source}
        needles={needles}
        mouse={mouse}
        onTogglePanel={onTogglePanel}
        onPeek={onPeek}
        onOpenSource={onOpenSource}
      />
      </ShellAside>
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
export type Command = "copy" | "escalate" | "approve" | "seal" | "details" | "trace" | "edit" | "done" | "dismiss" | "remind" | "undo" | "rescan" | "open" | "pane" | "toggle" | "figures";

/**
 * An open finding's buttons, in the top bar where Search, Filter and View
 * sit on the other pages. Approve (the main action) keeps its word; Edit and
 * Remind me are icons with tooltips. Done stands in for Approve and Edit while
 * editing. Not a leak is in the sidebar's heading. Once approved, Seal the leak is on the Next
 * timeline, not here.
 */
export function findingActions(finding: Finding, scan: ScanState, editing: boolean): Action[] {
  // Remind me (L) shows while it can still be added: calendar connected, none set yet.
  const canRemind = !scan.reminders[finding.id] && !cannotRemind(finding.id, scan);
  const remind: Action = {
    keys: ["L"],
    label: copy.actions.remind,
    command: "remind",
    icon: <RemindIcon />,
    iconOnly: true,
  };
  if (editing) {
    // Mid-edit, Approve and Edit give way to Done (Esc): finish the wording first. Not primary, since
    // approving is still the main step after.
    return [
      { keys: ["Esc"], label: copy.detail.doneEditingCta, command: "done", icon: <ApproveIcon /> },
      ...(canRemind ? [remind] : []),
    ];
  }
  // Only the Email route has words to edit here; a call or online step doesn't.
  const editable = !!finding.draft && usesEmail(finding, scan);
  const route = chosenRoute(finding, scan);
  if (finding.status === "new") {
    return [
      {
        keys: ["A"],
        label: copy.actions.approve,
        command: "approve",
        icon: <ApproveIcon />,
        primary: true,
        tip: route ? copy.routes.approveTip[route.kind] : finding.draft ? copy.actions.approveTip : copy.actions.approveHandledTip,
      },
      // Change the wording first, then approve it.
      ...(editable ? [{ keys: ["E"], label: copy.actions.edit, command: "edit" as const, icon: <EditIcon />, iconOnly: true }] : []),
      ...(canRemind ? [remind] : []),
    ];
  }
  if (finding.status === "approved") {
    return [
      // Edit takes the approval back to change the draft; with no draft in use there's nothing to edit, so it's plain Undo.
      editable
        ? { keys: ["E"], label: copy.actions.edit, command: "edit" as const, icon: <EditIcon />, iconOnly: true }
        : { keys: ["⌘", "Z"], label: copy.actions.undo, command: "undo" as const, icon: <UndoIcon /> },
      ...(canRemind ? [remind] : []),
    ];
  }
  // Not a leak (or snoozed, from before Snooze was retired): only Undo.
  return [{ keys: ["⌘", "Z"], label: copy.actions.undo, command: "undo", icon: <UndoIcon /> }];
}

export function FindingActions({
  actions,
  mouse,
  sidebarOpen = true,
  onCommand,
}: {
  actions: Action[];
  mouse: boolean;
  /** Closed, the sidebar's icon joins the end of this row, so the row leaves it room. */
  sidebarOpen?: boolean;
  onCommand: (command: Command) => void;
}) {
  return (
    <div
      role="group"
      aria-label={copy.detail.actionsLabel}
      className={`flex h-7 items-center gap-1 transition-[margin-right] duration-(--duration-panel) ease-(--ease-panel) ${sidebarOpen ? "" : "mr-8"}`}
    >
      {actions.map((a) =>
        a.iconOnly ? (
          <Tip key={a.label} content={a.label} keys={a.keys} side="bottom">
            <button
              type="button"
              tabIndex={-1}
              aria-label={a.label}
              // Keep keyboard focus where it is (the palette, or the draft being edited).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCommand(a.command)}
              className={iconButton("off", false)}
            >
              {a.icon}
            </button>
          </Tip>
        ) : (
          <Tip key={a.label} content={a.tip ?? a.label} keys={a.keys} side="bottom">
            <span className="mr-1.5 inline-flex text-small">
              <KeyButton
                keys={a.keys}
                label={a.label}
                icon={a.icon}
                tone={a.primary ? "primary" : "muted"}
                // The actions stay, as plain buttons once the mouse moves.
                mouse={mouse}
                onClick={() => onCommand(a.command)}
              />
            </span>
          </Tip>
        ),
      )}
    </div>
  );
}

export type Action = {
  keys: string[];
  label: string;
  command: Command;
  icon: React.ReactNode;
  primary?: boolean;
  /** Just the icon, with its name in the tooltip (Edit, Remind me). */
  iconOnly?: boolean;
  tip?: string;
};
