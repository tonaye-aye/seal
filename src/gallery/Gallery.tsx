import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Corpus } from "../agent/corpus";
import { formatAUD } from "../lib/money";
import { copy } from "../copy";
import { LivePreviewProvider } from "../connectors/live";
import { TOAST_MS, rankedFindings, ScanPreviewProvider, type ScanState } from "../lib/scan-store";
import { KeyButton } from "../ui/Kbd";
import { buildTimeline, filterTimeline, nowIndex } from "../ui/timeline";
import { SearchField } from "../ui/Palette/SearchField";
import { FilterButton } from "../ui/Palette/Filters";
import { applyFilters, filterOptions, type FilterId } from "../ui/filters";
import { ActionBar, FindingDetail, sidebarStops, type Pane } from "../ui/Palette/FindingDetail";
import {
  AllClear,
  CLEARED_GROUP,
  DeadlineChip,
  FindingsList,
  Headline,
  NotChecked,
  Scanning,
  ScanError,
  groupOpen,
  listItems,
  listStops,
  pickSelected,
} from "../ui/Palette/FindingsList";
import { ConnectorsButton, Footer } from "../ui/Palette/Footer";
import { Rail, SettingsButton, type RailItem } from "../ui/Palette/Rail";
import { Header } from "../ui/Palette/Header";
import { NowVisual } from "../ui/Palette/NowVisual";
import { PaletteShell } from "../ui/Palette/PaletteShell";
import { ScenariosSheet } from "../ui/Palette/ScenariosSheet";
import { ShortcutSheet } from "../ui/Palette/ShortcutSheet";
import { StatusStrip } from "../ui/Palette/StatusStrip";
import { Timeline } from "../ui/Palette/Timeline";
import { Toast } from "../ui/Palette/Toast";
import { TraceDrawer } from "../ui/Palette/Trace";
import { ViewHeading } from "../ui/Palette/ViewHeading";
import { FINDINGS, endpointSamples, liveSamples, nowSamples, onboardingSample, sampleCorpus, scanSamples, type LiveSample } from "./fixtures";
import { isSetupScreen, type OnboardingState } from "../lib/onboarding";
import { ListHint, TimelineHint } from "../ui/Palette/FooterHint";
import { ApproveIcon, CheckNowIcon, SnoozeIcon, TraceIcon } from "../ui/icons";
import { PrimaryButton, SetupScreen } from "../ui/Onboarding/SetupScreen";
import { replayNote } from "../ui/replay";
import { EndpointPreviewProvider, ModelDemoPreviewProvider, type EndpointStatus } from "../lib/endpoint";
import { ModelChip } from "../ui/Palette/ModelChip";
import { PreviewLayers, Tip } from "../ui/layers";
import { Settings } from "lucide-react";
import { MotionFreeze, type Freeze } from "../ui/motion";

// Dev only (#/gallery): every palette state drawn from fixed sample data, so
// the visual system can be reviewed without running a scan. It draws the real
// components. Frames are look-only: clicks, key presses and typing are
// stopped before they reach the components, so nothing starts a check,
// saves a decision or moves the window.

type LiveName = keyof ReturnType<typeof liveSamples>;
const noop = () => {};

// ---------- Look-only frames ----------

/** Stops clicks, keys and typing at the frame's edge. Hover still works. */
const block = (e: React.SyntheticEvent) => {
  e.preventDefault();
  e.stopPropagation();
};
const blockers = {
  onClickCapture: block,
  onMouseDownCapture: block,
  // Radix menus open on pointer down, so that is stopped too.
  onPointerDownCapture: block,
  onDoubleClickCapture: block,
  onKeyDownCapture: block,
  onBeforeInputCapture: block,
  onPasteCapture: block,
  onSubmitCapture: block,
};

/** The scrolling page, so frames know what "on screen" means. */
const Scroller = createContext<HTMLDivElement | null>(null);

/**
 * Draws its children only while near the screen. Each palette frame carries a
 * WebGL canvas, and browsers allow only about 16 at once, so frames far off
 * screen are taken down (which also stops their drawing).
 */
function LazyMount({ height, children }: { height: number; children: React.ReactNode }) {
  const root = useContext(Scroller);
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(([entry]) => setShown(entry.isIntersecting), { root, rootMargin: "200px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  return (
    <div ref={box} style={{ minHeight: height }}>
      {shown ? children : null}
    </div>
  );
}

// The components keep their selected row in view (scrollIntoView) and focus
// the draft when editing. Inside a frame, that would drag the whole gallery
// page along, so on this page only, both stay within the frame's own lists.
const FRAME = "[data-gallery-frame]";
const scrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
  if (!this.closest(FRAME)) return scrollIntoView.call(this, arg);
  for (let p = this.parentElement; p && !p.matches(FRAME); p = p.parentElement) {
    if (p.scrollHeight <= p.clientHeight || !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) continue;
    const box = this.getBoundingClientRect();
    const view = p.getBoundingClientRect();
    if (box.top < view.top) p.scrollTop -= view.top - box.top;
    else if (box.bottom > view.bottom) p.scrollTop += box.bottom - view.bottom;
    return;
  }
};
const focus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
  return focus.call(this, this.closest(FRAME) ? { ...options, preventScroll: true } : options);
};

/** Counts up every `ms` while `active`, to replay a timed state (the retry countdown, the toast's bar). */
function useLoop(ms: number, active: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return n;
}

/** Fixed connector state for one frame. The retry countdown restarts every 3 s. */
function useLiveSample(name: LiveName): LiveSample {
  const loop = useLoop(3000, name === "retrying");
  const [retryAt, setRetryAt] = useState(() => Date.now() + 3000);
  useEffect(() => setRetryAt(Date.now() + 3000), [loop]);
  return liveSamples(retryAt)[name];
}

type ModelDemo = { saved: boolean; drop: boolean; byFlag: boolean };
const DEMO_OFF: ModelDemo = { saved: false, drop: false, byFlag: false };

function Preview({
  scan,
  live,
  endpoint = endpointSamples.live,
  modelDemo = DEMO_OFF,
  children,
}: {
  scan: ScanState;
  live: LiveName;
  /** The model endpoint as the footer chip sees it. Live (no chip) unless set. */
  endpoint?: EndpointStatus;
  modelDemo?: ModelDemo;
  children: React.ReactNode;
}) {
  const sample = useLiveSample(live);
  return (
    <ScanPreviewProvider value={scan}>
      <LivePreviewProvider value={sample}>
        <EndpointPreviewProvider value={endpoint}>
          <ModelDemoPreviewProvider value={modelDemo}>{children}</ModelDemoPreviewProvider>
        </EndpointPreviewProvider>
      </LivePreviewProvider>
    </ScanPreviewProvider>
  );
}

// ---------- A whole palette ----------

type FrameProps = {
  scan: ScanState;
  live?: LiveName;
  view?: "list" | "detail" | "timeline";
  /** The finding (or cleared case) selected or open. */
  selected?: string;
  query?: string;
  pane?: Pane;
  evidenceIndex?: number;
  /** The open evidence item in a finding's sidebar (-1: all folded). */
  openEvidence?: number;
  figuresOpen?: boolean;
  editing?: boolean;
  mouse?: boolean;
  hint?: boolean;
  trace?: boolean;
  sheet?: "keys" | "scenarios";
  /** Shows the selected row's click buttons as if the pointer were on it. */
  holdHover?: boolean;
  /** A first-run onboarding step: its setup screen, or the first check. */
  onboarding?: OnboardingState;
  /** Draw the setup screens as the desktop app would (the welcome's ⌘⇧Space link). */
  desktop?: boolean;
  endpoint?: EndpointStatus;
  modelDemo?: ModelDemo;
  /** Where an open finding was opened from (the rail shows that view as current). */
  detailFrom?: "list" | "timeline";
  /** The icon rail: one item held hovered or with its tooltip open, or the View or Settings menu open. */
  rail?: { hover?: RailItem; tip?: RailItem; view?: boolean; settings?: boolean };
  /** The top bar's search: drawn as if focused (open, typing), or closed with its tooltip held open. */
  search?: { focused?: boolean; tip?: boolean };
  /** "Checked and left alone" opened (it is closed by default, and opens by itself for a search that matches inside). */
  group?: boolean;
  /** The list's filters that are on. */
  filters?: FilterId[];
  /** The rail's Filter menu drawn open. */
  filterMenu?: boolean;
};

/**
 * The palette at its real size, in one fixed state. The choice of what fills
 * each slot follows Palette.tsx; the slots themselves are the real components.
 */
function PaletteFrame({
  scan,
  live = "ok",
  view = "list",
  selected,
  query = "",
  pane = "evidence",
  evidenceIndex = 0,
  openEvidence = 0,
  figuresOpen = false,
  editing = false,
  mouse = false,
  hint = false,
  trace = false,
  sheet,
  holdHover = false,
  onboarding,
  desktop = false,
  endpoint,
  modelDemo,
  detailFrom = "list",
  rail,
  search,
  group = false,
  filters = [],
  filterMenu = false,
}: FrameProps) {
  const setup = onboarding && isSetupScreen(onboarding.step);
  const shellRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  // Replays the toast so its bar keeps running.
  const toastLoop = useLoop(TOAST_MS, !!scan.toast);
  const shownScan = scan.toast ? { ...scan, toast: { ...scan.toast, id: toastLoop + 1 } } : scan;

  const findings = rankedFindings(shownScan);
  const everyRow = listItems(findings, shownScan, "");
  const rows = applyFilters(listItems(findings, shownScan, query), filters);
  const isGroupOpen = groupOpen(rows, !!query.trim() || filters.length > 0, group, false);
  const items = listStops(rows, isGroupOpen);
  const item = pickSelected(rows, items, selected, view === "list");
  const openItem = item?.type === "finding" ? item.finding : item?.type === "cleared" ? item.cleared : undefined;
  const entries = filterTimeline(buildTimeline(shownScan), query);
  const entry = entries[nowIndex(entries)] ?? entries[entries.length - 1];
  const nothingYet = items.length === 0 && !query && !filters.length;
  const inDetail = view === "detail" && !!openItem;

  let main: React.ReactNode;
  if (setup) {
    main = <SetupScreen onboarding={onboarding} hotkey={["⌥", "Space"]} onHotkey={noop} mouse={mouse} desktop={desktop} />;
  } else if (inDetail) {
    main = (
      <FindingDetail
        item={openItem}
        corpus={shownScan.corpus}
        edited={"evidence" in openItem && shownScan.edits[openItem.id] !== undefined}
        pane={pane}
        evidenceIndex={evidenceIndex}
        openEvidence={openEvidence}
        figuresOpen={figuresOpen}
        editing={editing}
        mouse={mouse}
        onStopEditing={noop}
        onFocusDraft={noop}
        onToggleEvidence={noop}
        onToggleFigures={noop}
        draftRef={draftRef}
        scanning={shownScan.phase === "scanning"}
      />
    );
  } else if (view === "timeline") {
    main = (
      <Timeline
        entries={entries}
        selectedKey={entry?.key}
        scrollKey={0}
        onHover={noop}
        onOpen={noop}
        scan={shownScan}
        query={query}
      />
    );
  } else if (nothingYet && shownScan.phase === "scanning") main = <Scanning scan={shownScan} />;
  else if (nothingYet && shownScan.phase === "error") main = <ScanError message={shownScan.error ?? "Something went wrong."} />;
  else if (nothingYet && shownScan.phase === "done") main = <AllClear checked={0} />;
  else if (nothingYet) main = <NotChecked />;
  else
    main = (
      <FindingsList
        items={rows}
        allFindings={findings}
        selectedKey={item?.key}
        scrollKey={0}
        mouse={mouse}
        onHover={noop}
        onOpen={noop}
        onAct={noop}
        scan={shownScan}
        showHint={hint}
        onDismissHint={noop}
        query={query}
        open={isGroupOpen}
        onToggleGroup={noop}
        filters={filters}
        onRemoveFilter={noop}
        onClearFilters={noop}
        holdHover={holdHover}
      />
    );

  const actionItem = item?.type === "undecided" ? { undecided: item.error } : openItem;
  const hintItem = item?.type === "group" ? { group: item.open } : actionItem;
  return (
    <Preview scan={shownScan} live={live} endpoint={endpoint} modelDemo={modelDemo}>
      {/* contain: layout makes the frame the box menus and tooltips are placed in, so a menu
          drawn as the frame scrolls into view lands beside its button straight away. */}
      <div data-gallery-frame style={{ width: 1000, height: 680, contain: "layout" }} {...blockers}>
        <PaletteShell
          ref={shellRef}
          // The same entrance as a summon: it plays as each frame scrolls into view.
          className="palette-enter"
          header={
            <Header
              crumbs={
                setup
                  ? []
                  : [
                      (inDetail ? detailFrom : view) === "timeline" ? copy.rail.timeline : copy.rail.list,
                      ...(inDetail ? [openItem.merchant] : []),
                    ]
              }
              search={
                setup ? undefined : (
                  <SearchField
                    value={query}
                    onChange={noop}
                    label={(inDetail ? detailFrom : view) === "timeline" ? copy.search.timelineLabel : copy.search.findingsLabel}
                    placeholder={
                      (inDetail ? detailFrom : view) === "timeline" ? copy.search.timelinePlaceholder : copy.search.findingsPlaceholder
                    }
                    mouse={mouse}
                    preview={search}
                  />
                )
              }
            />
          }
          rail={
            setup ? undefined : (
              <Rail
                view={inDetail ? "detail" : view === "timeline" ? "timeline" : "list"}
                from={detailFrom}
                traceOpen={trace}
                onList={noop}
                onTimeline={noop}
                onTrace={noop}
                viewOpen={rail?.view ?? false}
                onViewOpenChange={noop}
                mouse={mouse}
                preview={rail}
                filter={
                  <FilterButton
                    options={filterOptions(everyRow, filters)}
                    active={filters}
                    onToggle={noop}
                    onClear={noop}
                    open={filterMenu}
                    onOpenChange={noop}
                    mouse={mouse}
                    away={(inDetail ? detailFrom : view) === "timeline"}
                    preview={{ hover: rail?.hover === "filter", tip: rail?.tip === "filter" }}
                  />
                }
                settings={
                  <SettingsButton
                    hotkey={["⌥", "Space"]}
                    mouse={mouse}
                    onKeys={noop}
                    open={rail?.settings ?? false}
                    onOpenChange={noop}
                    hover={rail?.hover === "settings"}
                    tip={rail?.tip === "settings"}
                  />
                }
              />
            )
          }
          replay={replayNote(shownScan)}
          banner={
            onboarding?.step === "first-scan" ? (
              <>
                <span className="font-semibold text-text">Your first check.</span> It reads everything, so it takes a little while. You can hide me, I'll keep going.
              </>
            ) : undefined
          }
          bar={!setup && inDetail ? <ActionBar item={actionItem} detail pane={pane} stopOpen={openItem && evidenceIndex === sidebarStops(openItem, shownScan.corpus).evidence ? figuresOpen : evidenceIndex === openEvidence} mouse={mouse} onCommand={noop} /> : undefined}
          footer={
            <Footer
              onScenarios={noop}
              right={
                setup ? (
                  <PrimaryButton onboarding={onboarding} mouse={mouse} />
                ) : view === "timeline" ? (
                  <TimelineHint entry={entry} mouse={mouse} onOpen={noop} />
                ) : view === "list" && !nothingYet ? (
                  <ListHint item={hintItem} mouse={mouse} onOpen={noop} onRescan={noop} />
                ) : undefined
              }
            />
          }
          overlay={
            <>
              <Toast />
              <ShortcutSheet open={sheet === "keys"} onClose={noop} />
              <ScenariosSheet open={sheet === "scenarios"} onReset={noop} mouse={mouse} onClose={noop} onCheck={noop} />
            </>
          }
        >
          {main}
          {trace && <TraceDrawer lines={shownScan.trace} onClose={noop} />}
        </PaletteShell>
      </div>
    </Preview>
  );
}

// ---------- Motion, stopped partway ----------

/** Every motion in the gallery shows its end state at once (the frames are pictures). */
const END: Freeze = { flip: 1, glide: 1, count: 1 };

/**
 * A palette frame that draws `before`, then switches to `after` on the next
 * frame, with the motion that switch starts stopped at `at` (src/ui/motion.ts,
 * MotionFreeze). It replays each time the frame scrolls back into view.
 */
function Midway({ at, before, after }: { at: Freeze; before: FrameProps; after: FrameProps }) {
  const [switched, setSwitched] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSwitched(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <MotionFreeze.Provider value={{ ...END, ...at }}>
      <PaletteFrame {...(switched ? after : before)} />
    </MotionFreeze.Provider>
  );
}

/** Shows its buttons held down (the press utility's data-pressed look). */
function Pressed({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelectorAll<HTMLElement>(".press").forEach((el) => (el.dataset.pressed = ""));
  }, []);
  return (
    <div ref={box} className="flex items-center gap-6">
      {children}
    </div>
  );
}

// ---------- Page layout ----------

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="mb-5 heading text-heading font-semibold text-text">{title}</h2>
      <div className="flex flex-col gap-10">{children}</div>
    </section>
  );
}

function Shot({ title, note, height = 680, children }: { title: string; note?: string; height?: number; children: React.ReactNode }) {
  return (
    <figure className="m-0">
      <figcaption className="mb-2.5 flex items-baseline gap-3">
        <span className="text-body font-medium text-text">{title}</span>
        {note && <span className="text-meta text-faint">{note}</span>}
      </figcaption>
      <LazyMount height={height}>{children}</LazyMount>
    </figure>
  );
}

/** A small strip of single components on the palette's own background. */
function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div data-gallery-frame className="flex w-[1000px] flex-col gap-3 rounded-[14px] border border-edge bg-panel p-4" {...blockers}>
      {children}
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-40 shrink-0 font-mono text-label text-faint">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const SECTIONS = [
  ["onboarding", "Onboarding"],
  ["list", "List"],
  ["search", "Search"],
  ["filters", "Filters"],
  ["finding", "Finding"],
  ["timeline", "Timeline"],
  ["rail", "Icon rail"],
  ["motion", "Motion"],
  ["states", "Scan states"],
  ["overlays", "Overlays"],
  ["model", "Model endpoint"],
  ["now", "Now mark"],
  ["connections", "Connections"],
  ["header", "Top bar"],
  ["parts", "Parts"],
] as const;

export function Gallery() {
  // State, not a ref, so the frames see the page once it exists.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [corpus, setCorpus] = useState<Corpus>();
  useEffect(() => {
    void sampleCorpus().then(setCorpus);
  }, []);

  const s = scanSamples(corpus);
  // The top finding, and the list once it is approved (for the motion stills).
  const [top, second] = rankedFindings(s.done);
  const approvedTop: ScanState = { ...s.done, decisions: { ...s.done.decisions, [top.id]: "approved" } };
  // The top finding marked "Not a leak": it goes into "Checked and left alone".
  const dismissedTop: ScanState = { ...s.done, decisions: { ...s.done.decisions, [top.id]: "dismissed" } };
  const now = nowSamples(corpus);
  const o = onboardingSample;

  return (
    // Menus, tooltips and sheets are drawn as still pictures here: open, non-modal, never taking focus.
    <PreviewLayers>
    <MotionFreeze.Provider value={END}>
    <Scroller.Provider value={scroller}>
      <div ref={setScroller} className="h-full overflow-y-auto bg-bg text-text">
        <div className="mx-auto flex max-w-[1240px] gap-10 px-8 py-10">
          <nav className="sticky top-10 h-max w-40 shrink-0">
            <p className="mb-1 heading text-title font-semibold">Gallery</p>
            <p className="mb-5 text-meta leading-snug text-faint">
              Dev only. Sample data from the seed household, look only. {corpus ? "" : "Loading evidence…"}
            </p>
            <ul className="flex flex-col gap-1.5 text-small text-muted">
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a href={`#/gallery`} onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="hover:text-text"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <main className="flex min-w-0 flex-col gap-16">
            <Section id="onboarding" title="Onboarding">
              <Shot title="1. Welcome" note="What Life does and the key that opens it; Enter gets started">
                <PaletteFrame scan={s.idle} live="none" onboarding={o({ step: "welcome" })} />
              </Shot>
              <Shot title="1. Welcome, desktop app" note="The quiet link for when another app already has ⌥Space">
                <PaletteFrame scan={s.idle} live="none" desktop onboarding={o({ step: "welcome" })} />
              </Shot>
              <Shot title="2. Connect your data, nothing yet" note="Four demo connectors, four more not in this demo; Enter connects the next">
                <PaletteFrame scan={s.idle} live="none" onboarding={o({ step: "connect" })} />
              </Shot>
              <Shot title="2. Connect your data, part way" note="Bank and Email in, Documents reading; mouse mode">
                <PaletteFrame scan={s.idle} live="connecting" mouse onboarding={o({ step: "connect", connected: ["bank", "email"], connecting: "documents" })} />
              </Shot>
              <Shot title="2. Connect your data, calendar signed out" note="All four in, calendar sign-in expiry switched on; ⌘↵ runs the check">
                <PaletteFrame scan={s.idle} live="connectedReconnect" onboarding={o({ step: "connect", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. First check" note="The real checking screen, with the first-check note">
                <PaletteFrame scan={s.scanningEmpty} live="syncing" onboarding={o({ step: "first-scan" })} />
              </Shot>
              <Shot title="4. First palette, with the hint" note="Shows once (life.hintSeen); Got it or the first approve dismisses it">
                <PaletteFrame scan={s.done} hint />
              </Shot>
            </Section>

            <Section id="list" title="List">
              <Shot title="Findings, first run" note="Compact rows: name, kind, amount, date. Couldn't decide stays open; Checked and left alone is closed (the first-run hint is under Onboarding)">
                <PaletteFrame scan={s.done} />
              </Shot>
              <Shot title="Approved group, selected" note="Approved rows leave the main list for an open Approved · n group (a title, not a J/K stop); snoozed rows stay at the end of the main list. ⋯ on an approved row has Remind me">
                <PaletteFrame scan={s.decided} selected="f-skylink" />
              </Shot>
              <Shot title="After some decisions" note="Approved and snoozed rows, mouse mode">
                <PaletteFrame scan={s.decided} mouse selected="f-ironworks" />
              </Shot>
              <Shot title="Row quick menu open" note="The selected row's ⋯ menu: Approve, Snooze, Not a leak, Remind me (L)">
                <PaletteFrame scan={s.done} mouse holdHover selected="f-ironworks" />
              </Shot>
              <Shot title="Quick menu, reminder already set" note="Remind me is greyed out and says the date, so L can't add a second one">
                <PaletteFrame scan={s.reminded} mouse holdHover selected="f-streambox" />
              </Shot>
              <Shot title="Quick menu on an approved row" note="Only Remind me: to check for a reply">
                <PaletteFrame scan={s.decided} mouse holdHover selected="f-skylink" />
              </Shot>
              <Shot title="Couldn't decide, selected" note="The action bar for a case the model couldn't settle">
                <PaletteFrame scan={s.done} selected="u-council" />
              </Shot>
              <Shot title="Checked and left alone, header selected" note="Closed by default, with a count. J/K stop on its header; Enter or Space opens it">
                <PaletteFrame scan={s.done} selected={CLEARED_GROUP} />
              </Shot>
              <Shot title="Checked and left alone, open, a row selected" note="J carries on into its rows; Enter on the header (or Space) closes it again">
                <PaletteFrame scan={s.done} group selected="c-kookaburra" />
              </Shot>
              <Shot title="Checked and left alone, mouse mode" note="A click on the header opens or closes it">
                <PaletteFrame scan={s.done} group mouse selected={CLEARED_GROUP} />
              </Shot>
              <Shot title="Not a leak goes in the group" note="D: Maya says it's fine, so it joins the cases the agent left alone (⌘Z brings it back)">
                <PaletteFrame scan={dismissedTop} group selected={top.id} />
              </Shot>
              <Shot title="All approved" note="Ready to send on drafted ones, Handled when there's nothing to send">
                <PaletteFrame scan={s.approved} />
              </Shot>
              <Shot title="Everything dealt with" note="Every finding approved or snoozed">
                <PaletteFrame scan={s.handled} />
              </Shot>
            </Section>

            <Section id="search" title="Search">
              <Shot title="Closed, with its tooltip" note="A magnifier in the top bar, left of the status. / or a click opens it">
                <PaletteFrame scan={s.done} search={{ tip: true }} />
              </Shot>
              <Shot title="Open and empty" note="Just after /: the field slides open to the left, Esc closes it again">
                <PaletteFrame scan={s.done} search={{ focused: true }} />
              </Shot>
              <Shot title="Typing, with matches" note='"sky": the heading counts the matches; Down or Enter goes to the rows'>
                <PaletteFrame scan={s.done} query="sky" search={{ focused: true }} />
              </Shot>
              <Shot title="Down in the results" note="The field stays open while it holds a search, quieter (no fill); / goes back to it, Esc clears it">
                <PaletteFrame scan={s.done} query="sky" selected="f-skylink" />
              </Shot>
              <Shot title="No matches">
                <PaletteFrame scan={s.done} query="plumber" search={{ focused: true }} />
              </Shot>
              <Shot title="Matching a row that was left alone" note='"cpi" is only in why Kookaburra looks fine (no longer on the row): the group opens by itself while the search holds'>
                <PaletteFrame scan={s.done} query="cpi" selected="c-kookaburra" />
              </Shot>
              <Shot title="Mouse mode" note="A × clears the search instead of the key caps">
                <PaletteFrame scan={s.done} query="sky" mouse search={{ focused: true }} />
              </Shot>
              <Shot title="Timeline, open and empty" note="Searches the timeline: business or date">
                <PaletteFrame scan={s.done} view="timeline" search={{ focused: true }} />
              </Shot>
              <Shot title="Timeline, with matches" note='"ironworks", carried over from the list with ⌘↵'>
                <PaletteFrame scan={s.done} view="timeline" query="ironworks" />
              </Shot>
              <Shot title="Timeline, no matches">
                <PaletteFrame scan={s.done} view="timeline" query="plumber" search={{ focused: true }} />
              </Shot>
              <Shot title="Finding, with a search held" note="Life / Timeline / IronWorks Fitness beside the open field; / or a click goes back to the timeline">
                <PaletteFrame scan={s.done} view="detail" selected="f-ironworks" detailFrom="timeline" query="iron" />
              </Shot>
            </Section>

            <Section id="filters" title="Filters">
              <Shot title="Filter icon, with its tooltip" note="Under View on the rail. F or a click opens the menu">
                <PaletteFrame scan={s.done} rail={{ tip: "filter" }} />
              </Shot>
              <Shot title="Hovering Filter" note="Hover lifts it, like every rail icon">
                <PaletteFrame scan={s.done} mouse rail={{ hover: "filter" }} />
              </Shot>
              <Shot title="Filter menu, keyboard" note="Only filters that match something here. 1 to 9 tick a row (the menu stays open), ⌫ clears, F or Esc closes. The grey number is how many rows each one matches on its own">
                <PaletteFrame scan={s.done} filterMenu filters={["kind:price_increase"]} />
              </Shot>
              <Shot title="Filter menu, mouse mode" note="A click ticks a row and leaves the menu open; a click outside closes it">
                <PaletteFrame scan={s.done} mouse filterMenu filters={["kind:price_increase", "kind:trial_converted"]} />
              </Shot>
              <Shot title="One filter" note="Not sure: the findings the agent isn't sure of and the cases it couldn't decide. The heading counts what's left; ⌫ takes the filter off">
                <PaletteFrame scan={s.done} filters={["unsure"]} />
              </Shot>
              <Shot title="Two filters" note="Two kinds show rows of either kind. The rail's Filter icon carries the count">
                <PaletteFrame scan={s.done} filters={["kind:price_increase", "kind:trial_converted"]} />
              </Shot>
              <Shot title="Two filters, mouse mode" note="Each chip's × takes it off; Clear all takes them all off">
                <PaletteFrame scan={s.done} mouse filters={["kind:price_increase", "kind:trial_converted"]} />
              </Shot>
              <Shot title="No matches" note="Due within 7 days and Bill error: no row is both. The line says how to get back">
                <PaletteFrame scan={s.done} filters={["soon", "kind:billing_error"]} />
              </Shot>
              <Shot title="Filter and search" note='"iron" within Not sure: both narrow the list; the search title leads, the chips stay under it'>
                <PaletteFrame scan={s.done} query="iron" filters={["unsure"]} />
              </Shot>
              <Shot title="Filter and search, no matches" note="Esc clears the search first, so the line says that">
                <PaletteFrame scan={s.done} query="sky" filters={["kind:billing_error"]} search={{ focused: true }} />
              </Shot>
              <Shot title="A filter matching a row left alone" note="Paying twice, after Not a leak on StreamBox: the group opens by itself while the filter is on">
                <PaletteFrame scan={dismissedTop} filters={["kind:duplicate_subscription"]} selected={top.id} />
              </Shot>
              <Shot title="On the timeline" note="Filters are for the findings list: the icon is dimmed here, and F or a click goes back to the list with the menu open">
                <PaletteFrame scan={s.done} view="timeline" filters={["unsure"]} rail={{ tip: "filter" }} />
              </Shot>
            </Section>

            <Section id="finding" title="Finding">
              <Shot title="Evidence and draft" note="Main column: header, figures, deadline, then the draft. Sidebar: the first cited item open, amounts checked by code highlighted; Checked by code folded with a count">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" />
              </Shot>
              <Shot title="All evidence folded" note="Enter or Space on the open item closes it: one line each (icon, name, date; bank lines add the amount)">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" openEvidence={-1} evidenceIndex={2} />
              </Shot>
              <Shot title="Another item open" note="J moved to the second line, Enter opened it (one open at a time)">
                <PaletteFrame scan={s.done} view="detail" selected="f-ironworks" evidenceIndex={1} openEvidence={1} />
              </Shot>
              <Shot title="Checked by code open" note="C from either side, or J to its header and Enter. The header is the sidebar's last stop">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" openEvidence={-1} evidenceIndex={7} figuresOpen />
              </Shot>
              <Shot title="Keys on the draft" note="Tab: J/K scroll the draft, the sidebar's highlight goes away, the footer says Tab Evidence">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Not sure: check evidence" note="Medium confidence with a doubt; the notice stays above the draft">
                <PaletteFrame scan={s.done} view="detail" selected="f-ironworks" pane="draft" />
              </Shot>
              <Shot title="Check before sending" note="Draft the claim check couldn't fully match">
                <PaletteFrame scan={s.done} view="detail" selected="f-brightpage" pane="draft" />
              </Shot>
              <Shot title="Meter photo" note="Evidence with no text layer: the photo shows inside its item">
                <PaletteFrame scan={s.done} view="detail" selected="f-redgum" evidenceIndex={1} openEvidence={1} />
              </Shot>
              <Shot title="Editing the draft" note="Typing is blocked here">
                <PaletteFrame scan={s.edited} view="detail" selected="f-skylink" pane="draft" editing />
              </Shot>
              <Shot title="Nothing to send" note="The fix is a step Maya takes herself">
                <PaletteFrame scan={s.done} view="detail" selected="f-streambox" />
              </Shot>
              <Shot title="Approved: what happens next" note="The Next block above the draft: saved in Drafts, send it from your mail app, then what to expect (written by code from the checked figures)">
                <PaletteFrame scan={s.approved} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Approved, with a reminder" note="L added an all-day reminder to check for a reply; the Next block says when. The L key leaves the action bar once it's set">
                <PaletteFrame scan={s.reminded} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Reminder on an open finding" note="Two days before the deadline, never before tomorrow: here 20 Nov. The header's next-date line says it">
                <PaletteFrame scan={s.reminded} view="detail" selected="f-streambox" />
              </Shot>
              <Shot title="Approved, a refund to expect" note="Redgum: the credit is an estimate, so it says about">
                <PaletteFrame scan={s.approved} view="detail" selected="f-redgum" pane="draft" />
              </Shot>
              <Shot title="Approved, nothing to send" note="Marked as handled, and what to expect once Maya cancels it herself">
                <PaletteFrame scan={s.approved} view="detail" selected="f-streambox" />
              </Shot>
              <Shot title="Finding, mouse mode" note="Plain action buttons, no selection highlight; click any evidence line to open it">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" mouse />
              </Shot>
              <Shot title="Checked and left alone" note="Why the mobile rise was fine; the sidebar has the evidence it relied on and no figures">
                <PaletteFrame scan={s.done} view="detail" selected="c-kookaburra" />
              </Shot>
              <Shot title="Still drafting" note="A finding whose draft hasn't arrived during a check">
                <PaletteFrame scan={s.scanning} view="detail" selected="f-redgum" pane="draft" />
              </Shot>
            </Section>

            <Section id="timeline" title="Timeline">
              <Shot title="Timeline" note="Past dates, today's activity, NOW, upcoming with amber deadlines (within 7 days)">
                <PaletteFrame scan={s.decided} view="timeline" />
              </Shot>
              <Shot title="Timeline, all approved" note="Today's lines say Ready to send and what to expect; each finding's next line says what should happen once it's sent">
                <PaletteFrame scan={s.approved} view="timeline" />
              </Shot>
              <Shot title="Timeline, with reminders" note="Today: Added a reminder; each one also sits on its own date as Reminder in your calendar">
                <PaletteFrame scan={s.reminded} view="timeline" />
              </Shot>
              <Shot title="Timeline, mouse mode">
                <PaletteFrame scan={s.done} view="timeline" mouse />
              </Shot>
            </Section>

            <Section id="rail" title="Icon rail">
              <Shot title="View button and breadcrumb" note="The View button shows the current view's icon; the top bar says it in words (Life / Findings). Tooltip: V">
                <PaletteFrame scan={s.done} rail={{ tip: "view" }} />
              </Shot>
              <Shot title="View menu, on the list" note="V or a click. The current view is ticked, the other shows its key (⌘↵); arrows and Enter pick, V or Esc closes">
                <PaletteFrame scan={s.done} rail={{ view: true }} />
              </Shot>
              <Shot title="View menu on the timeline, mouse mode" note="Life / Timeline in the top bar; no key caps in mouse mode">
                <PaletteFrame scan={s.done} view="timeline" mouse rail={{ view: true }} />
              </Shot>
              <Shot title="Finding opened from the timeline" note="Life / Timeline / Skylink Internet; in the View menu, Timeline is ticked and Esc goes back to it">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" detailFrom="timeline" rail={{ view: true }} />
              </Shot>
              <Shot title="Hovering View" note="Hover lifts a rail icon">
                <PaletteFrame scan={s.done} view="timeline" mouse rail={{ hover: "view" }} />
              </Shot>
              <Shot title="Trace open" note="T or the Trace icon; the icon stays lit while the drawer is open, and the drawer never covers the rail">
                <PaletteFrame scan={s.done} trace rail={{ tip: "trace" }} />
              </Shot>
              <Shot title="Settings menu" note="The cog or ⌘,; ? works with it open, ⌘, or Esc closes it">
                <PaletteFrame scan={s.done} rail={{ settings: true }} />
              </Shot>
              <Shot title="Settings menu, mouse mode" note="No key caps on the rows">
                <PaletteFrame scan={s.done} mouse rail={{ settings: true }} />
              </Shot>
            </Section>

            <Section id="motion" title="Motion">
              <Shot title="Approving a row, halfway" note="A: the row fades out where it was, the rows below slide up, it fades in with the decided rows (also S and D)">
                <Midway at={{ flip: 0.5 }} before={{ scan: s.done, selected: top.id }} after={{ scan: approvedTop, selected: second.id }} />
              </Shot>
              <Shot title="Undo, halfway" note="⌘Z: the rows below make room and the row fades back into its place">
                <Midway at={{ flip: 0.5 }} before={{ scan: approvedTop, selected: second.id }} after={{ scan: s.done, selected: second.id }} />
              </Shot>
              <Shot title="Not a leak, into the closed group, halfway" note="D: the row fades out where it was, the rows below slide up, and the group's count goes up">
                <Midway at={{ flip: 0.5 }} before={{ scan: s.done, selected: top.id }} after={{ scan: dismissedTop, selected: second.id }} />
              </Shot>
              <Shot title="Not a leak, into the open group, halfway" note="With the group open, the row fades in among its rows">
                <Midway at={{ flip: 0.5 }} before={{ scan: s.done, group: true, selected: top.id }} after={{ scan: dismissedTop, group: true, selected: second.id }} />
              </Shot>
              <Shot title="Undo, out of the closed group, halfway" note="⌘Z: the rows make room and the row fades back into its place">
                <Midway at={{ flip: 0.5 }} before={{ scan: dismissedTop, selected: second.id }} after={{ scan: s.done, selected: second.id }} />
              </Shot>
              <Shot title="Selection gliding, halfway" note="J from the first row: the highlight slides; a quick run of J keeps up">
                <Midway at={{ glide: 0.5 }} before={{ scan: s.done, selected: top.id }} after={{ scan: s.done, selected: second.id }} />
              </Shot>
              <Shot title="Amounts counting up" note="The first time a finding opens; also list rows and the timeline total. Stopped at 30%">
                <Midway at={{ count: 0.3 }} before={{ scan: s.done, view: "detail", selected: top.id }} after={{ scan: s.done, view: "detail", selected: top.id }} />
              </Shot>
              <Shot title="Pressed" note="Buttons give a little while held down; rows dim instead. Changing view crossfades (no still)" height={110}>
                <Strip>
                  <Pressed>
                    <KeyButton keys={["A"]} label={copy.actions.approveToDrafts} icon={<ApproveIcon />} tone="primary" onClick={noop} />
                    <KeyButton keys={["S"]} label={copy.actions.snooze} icon={<SnoozeIcon />} onClick={noop} />
                  </Pressed>
                </Strip>
              </Shot>
            </Section>

            <Section id="states" title="Scan states">
              <Shot title="Checking, nothing yet" note="Trace lines and the slow documents skeleton">
                <PaletteFrame scan={s.scanningEmpty} live="slow" />
              </Shot>
              <Shot title="Checking, first findings in">
                <PaletteFrame scan={s.scanning} live="syncing" />
              </Shot>
              <Shot title="All clear">
                <PaletteFrame scan={s.allClear} />
              </Shot>
              <Shot title="Check didn't finish">
                <PaletteFrame scan={s.error} live="error" />
              </Shot>
              <Shot title="Not checked yet">
                <PaletteFrame scan={s.idle} live="none" />
              </Shot>
            </Section>

            <Section id="overlays" title="Overlays">
              <Shot title="Replay mode banner, one answer saved" note="A single call fell back on its own; that row is labelled. More in Model endpoint">
                <PaletteFrame scan={s.replay} />
              </Shot>
              <Shot title="Toast with undo" note="Replays every 5 s">
                <PaletteFrame scan={s.toast} selected="f-ironworks" />
              </Shot>
              <Shot title="Reminder couldn't be added" note="Calendar signed out (⌘⇧D, 1): nothing is stored, and R signs it back in">
                <PaletteFrame scan={s.reminderFailed} />
              </Shot>
              <Shot title="Toast without undo">
                <PaletteFrame scan={s.toastNoUndo} />
              </Shot>
              <Shot title="Trace drawer">
                <PaletteFrame scan={s.done} trace />
              </Shot>
              <Shot title="Shortcut sheet">
                <PaletteFrame scan={s.done} sheet="keys" />
              </Shot>
              <Shot title="Scenarios panel, all off">
                <PaletteFrame scan={s.done} sheet="scenarios" />
              </Shot>
              <Shot title="Scenarios panel, check running" note="Check now is disabled until it finishes">
                <PaletteFrame scan={s.scanning} live="syncing" sheet="scenarios" />
              </Shot>
              <Shot title="Scenarios panel, one switched on" note="Calendar on, waiting for the next check; Simulating chip behind">
                <PaletteFrame scan={s.done} live="pending" sheet="scenarios" />
              </Shot>
              <Shot title="Calendar needs reconnecting" note="List banner and the Reconnect chip">
                <PaletteFrame scan={s.done} live="reconnect" />
              </Shot>
            </Section>

            <Section id="model" title="Model endpoint">
              <Shot title="Saved answers chosen" note="Demo panel M; the footer chip says so too">
                <PaletteFrame scan={s.replayForced} endpoint={endpointSamples.forced} />
              </Shot>
              <Shot title="Saved answers, launch flag" note="LIFE_REPLAY=1 pnpm tauri dev">
                <PaletteFrame scan={s.replayFlag} endpoint={endpointSamples.flag} />
              </Shot>
              <Shot title="Checking, endpoint unreachable" note="The endpoint check failed, so the check runs on saved answers from the start">
                <PaletteFrame scan={s.checkingOffline} endpoint={endpointSamples.offline} live="syncing" />
              </Shot>
              <Shot title="Done on saved answers, endpoint unreachable">
                <PaletteFrame scan={s.replayOffline} endpoint={endpointSamples.offline} />
              </Shot>
              <Shot title="Done on saved answers, key not accepted">
                <PaletteFrame scan={s.replayKey} endpoint={endpointSamples.key_rejected} />
              </Shot>
              <Shot title="Checking, endpoint lost partway" note="Demo panel 4, or the network dropping mid-check: the check starts again on saved answers">
                <PaletteFrame scan={s.checkingLost} endpoint={endpointSamples.offline} live="syncing" />
              </Shot>
              <Shot title="Redone from saved answers after losing the endpoint">
                <PaletteFrame scan={s.replayLost} endpoint={endpointSamples.offline} />
              </Shot>
              <Shot title="A finding from saved answers" note="Under the figures checked by code">
                <PaletteFrame scan={s.replayForced} endpoint={endpointSamples.forced} view="detail" selected="f-skylink" />
              </Shot>
              <Shot title="No saved answers to fall back on">
                <PaletteFrame scan={s.noSaved} endpoint={endpointSamples.offline} />
              </Shot>
              <Shot title="Model chip (footer)" note="Hidden while live; click it for the menu" height={380}>
                <Strip>
                  {(
                    [
                      ["Live: no chip", endpointSamples.live],
                      ["Slow", endpointSamples.slow],
                      ["Offline", endpointSamples.offline],
                      ["Key not accepted", endpointSamples.key_rejected],
                      ["Not set up", endpointSamples.not_set_up],
                      ["Endpoint error", endpointSamples.unavailable],
                      ["Saved answers chosen", endpointSamples.forced],
                      ["Browser preview", endpointSamples.browser],
                    ] as const
                  ).map(([label, endpoint]) => (
                    <Preview key={label} scan={s.done} live="ok" endpoint={endpoint}>
                      <Labelled label={label}>
                        <div className="flex h-7 items-center">
                          <ModelChip />
                        </div>
                      </Labelled>
                    </Preview>
                  ))}
                </Strip>
              </Shot>
              <Shot title="Model chip menu" note="Offline (Try live again, Use saved answers only), saved answers chosen, launch flag" height={780}>
                <Strip>
                  <div className="flex flex-col">
                    {(
                      [
                        [endpointSamples.offline, DEMO_OFF],
                        [endpointSamples.forced, { ...DEMO_OFF, saved: true }],
                        [endpointSamples.flag, { ...DEMO_OFF, byFlag: true }],
                      ] as const
                    ).map(([endpoint, demo], i) => (
                      <Preview key={i} scan={s.done} live="ok" endpoint={endpoint} modelDemo={demo}>
                        <div className="relative mt-[210px] h-8 w-[300px]">
                          <ModelChip defaultOpen />
                        </div>
                      </Preview>
                    ))}
                  </div>
                </Strip>
              </Shot>
              <Shot title="Connectors menu with the model endpoint" note="Live, and offline" height={300}>
                <Strip>
                  <div className="flex gap-8">
                    {[endpointSamples.live, endpointSamples.offline].map((endpoint, i) => (
                      <Preview key={i} scan={s.done} live="ok" endpoint={endpoint}>
                        <div className="relative mt-[230px] h-8 w-[320px]">
                          <ConnectorsButton defaultOpen />
                        </div>
                      </Preview>
                    ))}
                  </div>
                </Strip>
              </Shot>
              <Shot title="Demo panel, saved answers on">
                <PaletteFrame scan={s.replayForced} endpoint={endpointSamples.forced} modelDemo={{ ...DEMO_OFF, saved: true }} sheet="scenarios" />
              </Shot>
              <Shot title="Demo panel, endpoint drops partway on" note="Simulating chip behind">
                <PaletteFrame scan={s.done} modelDemo={{ ...DEMO_OFF, drop: true }} sheet="scenarios" />
              </Shot>
              <Shot title="Demo panel, launch flag holds saved answers on">
                <PaletteFrame scan={s.replayFlag} endpoint={endpointSamples.flag} modelDemo={{ ...DEMO_OFF, byFlag: true }} sheet="scenarios" />
              </Shot>
            </Section>

            <Section id="now" title="Now mark">
              <Shot title="States" note="Animated, reduced motion (one still frame), and the CSS fallback" height={220}>
                <Strip>
                  {(
                    [
                      ["Idle", now.idle],
                      ["Working", now.working],
                      ["Needs you, low", now.low],
                      ["Needs you, mid", now.mid],
                      ["Needs you, high", now.high],
                    ] as const
                  ).map(([label, scan]) => (
                    <Preview key={label} scan={scan} live="ok">
                      <Labelled label={label}>
                        <div className="flex items-center gap-16">
                          <NowVisual />
                          <NowVisual still />
                          <NowVisual fallback />
                        </div>
                      </Labelled>
                    </Preview>
                  ))}
                </Strip>
              </Shot>
            </Section>

            <Section id="connections" title="Connections">
              <Shot title="Status strip" height={330}>
                <Strip>
                  {(
                    [
                      ["Not connected", "none"],
                      ["Connecting, syncing", "syncing"],
                      ["All up to date", "ok"],
                      ["Bank retrying", "retrying"],
                      ["Calendar reconnect", "reconnect"],
                      ["Email error", "error"],
                      ["Documents slow", "slow"],
                    ] as const
                  ).map(([label, live]) => (
                    <Preview key={label} scan={s.done} live={live}>
                      <Labelled label={label}>
                        <StatusStrip />
                      </Labelled>
                    </Preview>
                  ))}
                </Strip>
              </Shot>
              <Shot title="Connectors button (footer)" note="Count, info colour while busy or retrying, red with a number when a source needs attention" height={330}>
                <Strip>
                  {(
                    [
                      ["Not connected", "none"],
                      ["Connecting, syncing", "syncing"],
                      ["All up to date", "ok"],
                      ["Bank retrying", "retrying"],
                      ["Calendar reconnect", "reconnect"],
                      ["Email error", "error"],
                      ["Documents slow", "slow"],
                    ] as const
                  ).map(([label, live]) => (
                    <Preview key={label} scan={s.done} live={live}>
                      <Labelled label={label}>
                        <ConnectorsButton />
                      </Labelled>
                    </Preview>
                  ))}
                </Strip>
              </Shot>
              <Shot title="Connectors menu, calendar signed out" height={290}>
                <Strip>
                  <Preview scan={s.done} live="reconnect">
                    <div className="relative mt-[230px] h-8">
                      <ConnectorsButton defaultOpen />
                    </div>
                  </Preview>
                </Strip>
              </Shot>
            </Section>

            <Section id="header" title="Top bar">
              <Shot title="Status in the top bar" height={300}>
                <Strip>
                  {(
                    [
                      ["Not checked", s.idle],
                      ["Checking", s.scanning],
                      ["Checked", s.done],
                      ["Checking again", s.refreshing],
                      ["Didn't finish", s.error],
                    ] as const
                  ).map(([label, scan]) => (
                    <Preview key={label} scan={scan} live="ok">
                      <Labelled label={label}>
                        <Header />
                      </Labelled>
                    </Preview>
                  ))}
                </Strip>
              </Shot>
            </Section>
            <Section id="parts" title="Parts">
              <Shot title="Tooltips" note="On hover (and keyboard focus where a control takes it), with the control's key when it has one" height={150}>
                <Strip>
                  <div className="flex h-[100px] items-end gap-48 px-12">
                    <Tip open content={copy.footer.settings} keys={["⌘", ","]}>
                      <span className="grid size-7 place-items-center rounded-md bg-raised text-text">
                        <Settings size={15} strokeWidth={1.75} aria-hidden="true" className="block" />
                      </span>
                    </Tip>
                    <Tip open content={copy.demo.simulatingTitle([copy.demo.scenarios.calendar_reauth.short])} keys={["⌘", "⇧", "D"]}>
                      <span className="flex h-6 items-center gap-1.5 rounded-full border border-info/30 px-2.5 text-meta text-info">
                        <span className="size-1.5 rounded-full bg-info" aria-hidden="true" />
                        {copy.demo.simulating(copy.demo.scenarios.calendar_reauth.short, 0)}
                      </span>
                    </Tip>
                    <Tip open content={copy.dates.days(9)}>
                      <span className="inline-flex h-5 items-center rounded-full px-2 figure text-label text-text">28 Nov</span>
                    </Tip>
                  </div>
                </Strip>
              </Shot>
              <Shot title="Key buttons" note="Keyboard (key caps before the label), mouse (an icon instead) and disabled" height={150}>
                <Strip>
                  <Labelled label="Keyboard">
                    <div className="flex items-center gap-6 text-meta">
                      <KeyButton keys={["A"]} label={copy.actions.approve} icon={<ApproveIcon />} tone="primary" onClick={noop} />
                      <KeyButton keys={["S"]} label={copy.actions.snooze} icon={<SnoozeIcon />} onClick={noop} />
                      <KeyButton keys={["T"]} label="Trace" icon={<TraceIcon />} tone="faint" onClick={noop} />
                      <KeyButton keys={["R"]} label={copy.demo.checkInProgress} icon={<CheckNowIcon />} onClick={noop} disabled />
                    </div>
                  </Labelled>
                  <Labelled label="Mouse">
                    <div className="flex items-center gap-6 text-meta">
                      <KeyButton keys={["A"]} label={copy.actions.approve} icon={<ApproveIcon />} tone="primary" onClick={noop} mouse />
                      <KeyButton keys={["S"]} label={copy.actions.snooze} icon={<SnoozeIcon />} onClick={noop} mouse />
                      <KeyButton keys={["T"]} label="Trace" icon={<TraceIcon />} tone="faint" onClick={noop} mouse />
                      <KeyButton keys={["R"]} label={copy.demo.checkInProgress} icon={<CheckNowIcon />} onClick={noop} mouse disabled />
                    </div>
                  </Labelled>
                </Strip>
              </Shot>
              <Shot title="Deadline chips" note="Past or within 7 days is amber, within 14 bright, later muted" height={110}>
                <Strip>
                  <Labelled label="14 Nov, 21 Nov, 18 Dec">
                    <div className="flex items-center gap-4">
                      <DeadlineChip date="2026-11-14" />
                      <DeadlineChip date="2026-11-21" />
                      <DeadlineChip date="2026-11-28" />
                      <DeadlineChip date="2026-12-18" />
                    </div>
                  </Labelled>
                </Strip>
              </Shot>
              <Shot title="View headings" note="List, timeline and an open finding, on their own" height={330}>
                <Strip>
                  <Headline findings={rankedFindings(s.done)} scan={s.done} />
                  <ViewHeading title="What's coming">
                    Expected charges and deadlines, with today marked.
                  </ViewHeading>
                  <ViewHeading
                    eyebrow={<span className="font-medium text-text">{FINDINGS.skylink.merchant}</span>}
                    title={FINDINGS.skylink.title}
                    action={<span className="figure text-small">{formatAUD(FINDINGS.skylink.amounts.atStake!)}</span>}
                  >
                    {FINDINGS.skylink.why}
                  </ViewHeading>
                </Strip>
              </Shot>
            </Section>
          </main>
        </div>
      </div>
    </Scroller.Provider>
    </MotionFreeze.Provider>
    </PreviewLayers>
  );
}
