import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Corpus } from "../agent/corpus";
import { formatAUD } from "../lib/money";
import { copy } from "../copy";
import { LivePreviewProvider } from "../connectors/live";
import { TOAST_MS, isEdited, rankedFindings, ScanPreviewProvider, type ScanState, type ToastTone } from "../lib/scan-store";
import { KeyButton } from "../ui/Kbd";
import { EARLIER_GROUP, buildTimeline, earlierOpen, filterTimeline, isSoonDay, onlyFindings, pickTimelineStop, showsDate, timelineStops, type TimelineEntry } from "../ui/timeline";
import { SearchField } from "../ui/Palette/SearchField";
import { FilterButton } from "../ui/Palette/Filters";
import { applyFilters, filterOptions, passingFindings, type FilterId } from "../ui/filters";
import type { Finding } from "../agent/pipeline";
import { findingTrace } from "../ui/finding-trace";
import { DEFAULT_PANELS, FindingActions, FindingDetail, findingActions, hasDraftPanel as findingHasDraftPanel, firstStop, sidebarStops, type Pane, type PanelId } from "../ui/Palette/FindingDetail";
import {
  AllClear,
  CLEARED_GROUP,
  FindingsList,
  Headline,
  NotChecked,
  ScanError,
  groupOpen,
  listItems,
  listStops,
  pickSelected,
} from "../ui/Palette/FindingsList";
import { ClearedCells, FindingCells, MENU_SLOT, ROW, RowDate, UndecidedCells } from "../ui/Palette/ListRow";
import { Footer, ScanStatus } from "../ui/Palette/Footer";
import { SettingsButton, TraceButton, ViewButton, type ControlItem } from "../ui/Palette/Controls";
import { Header } from "../ui/Palette/Header";
import { Mark } from "../ui/Palette/Mark";
import { NowVisual } from "../ui/Palette/NowVisual";
import trayIcon from "../../src-tauri/icons/tray.png";
import { PaletteShell } from "../ui/Palette/PaletteShell";
import { ScenariosSheet } from "../ui/Palette/ScenariosSheet";
import { SamplePageSheet, hasHaveReady } from "../ui/Palette/RoutePanel";
import { chosenRoute, usesEmail, type SamplePage } from "../ui/fix-route";
import { ShortcutIntro, ShortcutSheet } from "../ui/Palette/ShortcutSheet";
import { StatusStrip } from "../ui/Palette/StatusStrip";
import { TIMELINE_ROW, Timeline, TimelineLine } from "../ui/Palette/Timeline";
import { Toast, ToastCard } from "../ui/Palette/Toast";
import { TraceDrawer } from "../ui/Palette/Trace";
import { ViewHeading } from "../ui/Palette/ViewHeading";
import { FINDINGS, endpointSamples, liveSamples, nowSamples, onboardingSample, routeSamples, sampleCorpus, scanSamples, type LiveSample } from "./fixtures";
import { isSetupScreen, type OnboardingState } from "../lib/onboarding";
import { DetailHint, ListHint, TimelineHint } from "../ui/Palette/FooterHint";
import { ApproveIcon, CheckNowIcon, SealIcon, RemindIcon, TraceIcon } from "../ui/icons";
import { SetupScreen } from "../ui/Onboarding/SetupScreen";
import { CrashPanel } from "../ui/CrashScreen";
import { replayNote } from "../ui/replay";
import { EndpointPreviewProvider, ModelDemoPreviewProvider, type EndpointStatus } from "../lib/endpoint";
import { SettingsDialog, type SettingsTab } from "../ui/Palette/SettingsDialog";
import { SyncButton } from "../ui/Palette/SyncButton";
import { PreviewLayers, Tip } from "../ui/layers";
import { CircleAlert, Ellipsis, Settings } from "lucide-react";
import { ProgressBar } from "../ui/ProgressBar";
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
  /** The selected stop in a finding's sidebar (-1: its first piece of evidence; past the end: the last stop). */
  stop?: number;
  /** The sidebar's open panels. */
  panels?: PanelId[];
  /** The evidence whose card is open, and the one open in the source sheet (-1: none). */
  peek?: number;
  source?: number;
  /** The draft's Details (To, Subject, Attach) unfolded. */
  detailsOpen?: boolean;
  /** A call, chat or online route's Have Ready unfolded. */
  readyOpen?: boolean;
  editing?: boolean;
  mouse?: boolean;
  hint?: boolean;
  /** The trace drawer: the whole check's, or ("finding") the open finding's own. */
  trace?: boolean | "finding";
  /** An open finding's sidebar folded to a strip (left out: as the app does it, folded once approved). */
  sidebarFolded?: boolean;
  sheet?: "keys" | "keysIntro" | "scenarios";
  /** The labelled stand-in for a fictional business's page. */
  samplePage?: SamplePage;
  /** The Settings dialog, open on this tab. */
  settings?: SettingsTab;
  /** Step 3: the "Agent working" fold open, and the plain seal in place of the animation. */
  agentOpen?: boolean;
  sealFallback?: boolean;
  /** The sync button's tooltip held open. */
  syncTip?: boolean;
  /** Shows the selected row's click buttons as if the pointer were on it. */
  holdHover?: boolean;
  /** A first-run onboarding step: its setup screen, or the first check. */
  onboarding?: OnboardingState;
  /** Draw the setup screens as the desktop app would (the welcome's ⌘⇧Space link). */
  desktop?: boolean;
  /** The summon key shown on the welcome (⌥Space unless set). */
  hotkey?: string[];
  endpoint?: EndpointStatus;
  modelDemo?: ModelDemo;
  /** Where an open finding was opened from (the rail shows that view as current). */
  detailFrom?: "list" | "timeline";
  /** View, Filter, Trace and Settings: one held hovered or with its tooltip open, or the Settings menu open. */
  controls?: { hover?: ControlItem; tip?: ControlItem; settings?: boolean };
  /** The top bar's search: drawn as if focused (open, typing), or closed with its tooltip held open. */
  search?: { focused?: boolean; tip?: boolean };
  /** "Checked and left alone" opened (it is closed by default, and opens by itself for a search that matches inside). */
  group?: boolean;
  /** The timeline's Earlier opened (closed by default, and open by itself for a search that matches inside). */
  earlier?: boolean;
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
  pane: paneAsked = "evidence",
  stop = -1,
  panels = DEFAULT_PANELS,
  peek = -1,
  source = -1,
  detailsOpen = true,
  readyOpen = false,
  editing = false,
  mouse = false,
  hint = false,
  trace = false,
  sidebarFolded,
  sheet,
  samplePage,
  holdHover = false,
  onboarding,
  desktop = false,
  hotkey = ["⌥", "Space"],
  endpoint,
  modelDemo,
  detailFrom = "list",
  controls,
  search,
  group = false,
  earlier = false,
  filters = [],
  filterMenu = false,
  settings,
  agentOpen = false,
  sealFallback = false,
  syncTip,
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
  const entries = filterTimeline(onlyFindings(buildTimeline(shownScan), passingFindings(everyRow, filters)), query);
  const isEarlierOpen = earlierOpen(entries, !!query.trim() || filters.length > 0, earlier, false);
  const timelineItems = timelineStops(entries, isEarlierOpen);
  const entry = pickTimelineStop(entries, timelineItems, selected);
  const nothingYet = items.length === 0 && !query && !filters.length;
  const inDetail = view === "detail" && !!openItem;
  const stops = openItem ? sidebarStops(openItem, shownScan.corpus, panels) : [];
  const stopAt = stop < 0 ? firstStop(stops) : Math.min(stop, stops.length - 1);
  const openFinding = openItem && "evidence" in openItem ? openItem : undefined;
  const hasDraftPanel = !!openFinding && findingHasDraftPanel(openFinding);
  const hasDetails = hasDraftPanel && !!openFinding?.draft && usesEmail(openFinding, shownScan);
  const hasReady = !!openFinding && hasHaveReady(openFinding, chosenRoute(openFinding, shownScan));
  // As in the app: the sidebar folds once a finding is approved, and then the keys are on the draft side.
  const sidebarShown = sidebarFolded !== undefined ? !sidebarFolded : openFinding?.status !== "approved";
  const pane: Pane = !sidebarShown && paneAsked === "evidence" ? "draft" : paneAsked;

  let main: React.ReactNode;
  if (setup) {
    main = <SetupScreen onboarding={onboarding} hotkey={hotkey} onHotkey={noop} mouse={mouse} desktop={desktop} agentOpen={agentOpen} sealFallback={sealFallback} />;
  } else if (inDetail) {
    main = (
      <FindingDetail
        item={openItem}
        corpus={shownScan.corpus}
        edited={"evidence" in openItem && isEdited(openItem.id, shownScan)}
        pane={pane}
        stops={stops}
        stop={stopAt}
        panels={panels}
        peek={peek}
        source={source}
        editing={editing}
        detailsOpen={detailsOpen}
        readyOpen={readyOpen}
        onToggleDetails={noop}
        mouse={mouse}
        onStopEditing={noop}
        onFocusDraft={noop}
        onCommand={noop}
        onPickRoute={noop}
        onVerb={noop}
        onSample={noop}
        sidebarOpen={sidebarShown}
        onToggleSidebar={noop}
        traceOpen={!!trace}
        tracePressed={trace === "finding"}
        onTogglePanel={noop}
        onPeek={noop}
        onOpenSource={noop}
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
        earlierOpen={isEarlierOpen}
        onToggleEarlier={noop}
        mouse={mouse}
        filters={filters}
        onRemoveFilter={noop}
        onClearFilters={noop}
      />
    );
  } else if (nothingYet && shownScan.phase === "error") main = <ScanError message={shownScan.error ?? "Something went wrong."} />;
  else if (nothingYet && shownScan.phase === "done") main = <AllClear checked={0} />;
  else if (nothingYet && shownScan.phase === "idle") main = <NotChecked />;
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
              bare={!!setup}
              crumbs={
                setup
                  ? []
                  : inDetail
                    ? [{ label: detailFrom === "timeline" ? copy.controls.timeline : copy.controls.list, onClick: noop }, { label: openItem.merchant }]
                    : [{ label: view === "timeline" ? copy.controls.timeline : copy.controls.list }]
              }
              onHome={inDetail ? { label: detailFrom === "timeline" ? copy.controls.timeline : copy.controls.list, run: noop } : undefined}
              controls={
                setup ? undefined : inDetail ? (
                  openFinding && <FindingActions actions={findingActions(openFinding, shownScan, editing)} mouse={mouse} sidebarOpen={sidebarShown} onCommand={noop} />
                ) : (
                  <>
                    <FilterButton
                      options={filterOptions(everyRow, filters)}
                      active={filters}
                      onToggle={noop}
                      onClear={noop}
                      open={filterMenu}
                      onOpenChange={noop}
                      onSettings={noop}
                      mouse={mouse}
                      preview={{ hover: controls?.hover === "filter", tip: controls?.tip === "filter" }}
                    />
                    <ViewButton
                      current={view === "timeline" ? "timeline" : "list"}
                      onToggle={noop}
                      preview={{ hover: controls?.hover === "view", tip: controls?.tip === "view" }}
                    />
                  </>
                )
              }
              search={
                setup || inDetail ? undefined : (
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
          replay={replayNote(shownScan)}
          footer={
            setup ? undefined : (
            <Footer
              onScenarios={noop}
              sync={<SyncButton onSync={noop} tip={syncTip} />}
              trace={<TraceButton pressed={!!trace} onClick={noop} hover={controls?.hover === "trace"} tip={controls?.tip === "trace"} />}
              settings={
                <SettingsButton
                  hotkey={["⌥", "Space"]}
                  mouse={mouse}
                  onKeys={noop}
                  onConnectors={noop}
                  onModels={noop}
                  onAllSettings={noop}
                  open={controls?.settings ?? false}
                  onOpenChange={noop}
                  hover={controls?.hover === "settings"}
                  tip={controls?.tip === "settings"}
                />
              }
              right={
                inDetail && editing ? undefined : inDetail ? (
                  <DetailHint
                    pane={pane}
                    stop={stops[stopAt]}
                    panelOpen={!!stops[stopAt] && "panel" in stops[stopAt] && panels.includes((stops[stopAt] as { panel: PanelId }).panel)}
                    twoPanes={!!openItem && "evidence" in openItem && sidebarShown}
                    detailsOpen={hasDetails ? detailsOpen : hasReady ? readyOpen : undefined}
                    mouse={mouse}
                    onToggle={noop}
                    onPane={noop}
                  />
                ) : view === "timeline" ? (
                  <TimelineHint stop={entry} mouse={mouse} onOpen={noop} />
                ) : view === "list" && !nothingYet ? (
                  <ListHint item={hintItem} mouse={mouse} onOpen={noop} onRescan={noop} />
                ) : undefined
              }
            />
            )
          }
          overlay={
            <>
              <Toast />
              <ShortcutSheet open={sheet === "keys"} onClose={noop} />
              <SamplePageSheet page={samplePage} onClose={noop} />
              <ShortcutIntro open={sheet === "keysIntro"} mouse={mouse} onClose={noop} onAll={noop} />
              <SettingsDialog
                tab={settings}
                onTab={noop}
                onClose={noop}
                mouse={mouse}
                hotkey={["⌥", "Space"]}
                onHotkey={noop}
                filterOptions={filterOptions(everyRow, filters)}
                activeFilters={filters}
                onToggleFilter={noop}
                onClearFilters={noop}
              />
              <ScenariosSheet open={sheet === "scenarios"} onReset={noop} mouse={mouse} onClose={noop} onCheck={noop} />
            </>
          }
        >
          {main}
          {trace && (
            <TraceDrawer
              lines={shownScan.trace}
              finding={inDetail && openFinding ? { merchant: openFinding.merchant, lines: findingTrace(openFinding) } : undefined}
              scope={trace === "finding" ? "finding" : "check"}
              mouse={mouse}
              editing={editing}
              onClose={noop}
            />
          )}
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
    <div data-gallery-frame className="grain relative flex w-[1000px] flex-col gap-3 rounded-[14px] border border-edge bg-panel p-4" {...blockers}>
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

/** All four toast tones with and without Undo, plus the question. Replays every 5 s to show the bar and fade. */
function ToastTones() {
  const loop = useLoop(TOAST_MS, true);
  const tones = [
    { label: "Error", tone: "error", text: copy.toasts.sealFailed },
    { label: "Warning", tone: "warning", text: copy.verbs.emailOnly },
    { label: "Success", tone: "success", text: copy.toasts.reminderAdded("20 Nov") },
    { label: "Info", tone: "info", text: copy.toasts.reminderRemoved("Skylink Internet") },
  ] as const;
  const card = (tone: ToastTone, text: string, undoable: boolean, ask?: string) => (
    <ToastCard key={loop} className="relative" toast={{ id: loop, tone, text, undoable, ask }} />
  );
  return (
    <Strip>
      {tones.map(({ label, tone, text }) => (
        <Labelled key={tone} label={label}>
          {card(tone, text, false)}
        </Labelled>
      ))}
      {tones.map(({ label, tone, text }) => (
        <Labelled key={tone} label={`${label}, Undo`}>
          <div className="flex items-center gap-3">
            {card(tone, text, true)}
            {tone !== "success" && <span className="text-meta text-faint">Not used today</span>}
          </div>
        </Labelled>
      ))}
      <Labelled label="Question">{card("success", copy.toasts.dismissed("BrightPage Kids"), true, "f-brightpage")}</Labelled>
    </Strip>
  );
}

/** The one loading bar in every state, with the two "reduce motion" pictures. */
function LoadingBars() {
  const bar = "w-[420px]";
  return (
    <Strip>
      <Labelled label="Start"><ProgressBar className={bar} percent={0} label="Sample" /></Labelled>
      <Labelled label="Part way"><ProgressBar className={bar} percent={42} label="Sample" /></Labelled>
      <Labelled label="Finished"><ProgressBar className={bar} percent={100} label="Sample" /></Labelled>
      <Labelled label="Failed"><ProgressBar className={bar} percent={42} stopped end={<CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="text-danger" />} label="Sample" /></Labelled>
      <Labelled label="Indeterminate"><ProgressBar className={bar} end="" label="Sample" /></Labelled>
      <Labelled label="Reduced, part way"><ProgressBar className={bar} percent={42} still label="Sample" /></Labelled>
      <Labelled label="Reduced, waiting"><ProgressBar className={bar} end="" still label="Sample" /></Labelled>
    </Strip>
  );
}

/** Every state of a list row, stacked so the columns can be compared. */
function RowStates() {
  const { skylink, streambox, ironworks, brightpage, redgum } = FINDINGS;
  const unsure = { ...skylink, confidence: "low" as const };
  // The IronWorks sample carries a doubt, which would show "Not sure" on every row made from it.
  const sure = { ...ironworks, confidence: "high" as const, doubts: [] };
  const states: { label: string; cells: React.ReactNode; selected?: boolean }[] = [
    { label: "Open", cells: <FindingCells finding={sure} /> },
    { label: "Selected", cells: <FindingCells finding={skylink} />, selected: true },
    { label: "Due within 7 days", cells: <FindingCells finding={streambox} /> },
    { label: "Selected, due soon", cells: <FindingCells finding={{ ...streambox, confidence: "low" }} />, selected: true },
    { label: "Later date", cells: <FindingCells finding={brightpage} /> },
    { label: "No deadline", cells: <FindingCells finding={{ ...redgum, deadline: undefined }} /> },
    { label: "Not sure", cells: <FindingCells finding={unsure} /> },
    { label: "Saved", cells: <FindingCells finding={sure} saved /> },
    { label: "Saved, not sure", cells: <FindingCells finding={unsure} saved /> },
    { label: "Approved", cells: <FindingCells finding={{ ...skylink, status: "approved" }} /> },
    { label: "Approved, selected", cells: <FindingCells finding={{ ...skylink, status: "approved" }} />, selected: true },
    { label: "Handled", cells: <FindingCells finding={{ ...streambox, status: "approved", draft: undefined }} /> },
    { label: "Not a leak", cells: <FindingCells finding={{ ...brightpage, status: "dismissed" }} /> },
    { label: "Couldn't decide", cells: <UndecidedCells merchant="Moreland Council" error="The model couldn't settle this one." /> },
    { label: "Undecided, selected", cells: <UndecidedCells merchant="Moreland Council" error="The model couldn't settle this one." />, selected: true },
    { label: "Cleared", cells: <ClearedCells merchant="Kookaburra Mobile" /> },
    { label: "Cleared, selected", cells: <ClearedCells merchant="Kookaburra Mobile" />, selected: true },
    {
      label: "Long name",
      cells: <FindingCells finding={{ ...unsure, merchant: "Brunswick and Northcote Community Energy Co-operative Retail Services Proprietary Limited" }} saved />,
    },
  ];
  return (
    <Strip>
      <div className="flex flex-col">
        {states.map(({ label, cells, selected }) => (
          <Labelled key={label} label={label}>
            <div className={`${ROW} ${selected ? "bg-raised" : ""}`}>
              {cells}
              <span className={`${MENU_SLOT} ${selected ? "text-muted" : ""}`}>
                {selected && <Ellipsis size={15} strokeWidth={1.75} aria-hidden="true" className="m-auto block" />}
              </span>
            </div>
          </Labelled>
        ))}
      </div>
    </Strip>
  );
}

/** Every kind of timeline line, stacked on one rail so the columns can be compared. */
function TimelineLineStates() {
  const line = (key: string, date: string, tone: TimelineEntry["tone"], who: string, what: string, extra: Partial<TimelineEntry> = {}): TimelineEntry => ({
    key,
    date,
    side: date <= "2026-11-19" ? "past" : "future",
    tone,
    who,
    what,
    ...extra,
  });
  const expect = "Once sent, expect $40.00 back, and $79.00 on the 14 Dec debit";
  const states: { label: string; entry: TimelineEntry; selected?: boolean }[] = [
    { label: "Past", entry: line("past", "2026-11-14", "past", "IronWorks Fitness", "Last day to give notice") },
    { label: "Past, with amount", entry: line("past-paid", "2026-11-10", "past", "Redgum Energy", "Bill paid", { amountCents: 57720 }) },
    { label: "Agent activity", entry: line("agent", "2026-11-19", "agent", "Checked everything", "Found 7 to look at, 2 that look fine", { at: Date.now() - 240_000, detail: "7 still need you. Nothing was sent or changed." }) },
    { label: "Agent, a decision", entry: line("agent-decided", "2026-11-19", "agent", "Skylink Internet", "Saved a draft", { at: Date.now() - 60_000, detail: "Ready to send. Then expect $40.00 back, and $79.00 on the 14 Dec debit." }) },
    { label: "Urgent, no amount", entry: line("soon", "2026-11-20", "soon", "Apple + StreamBox", "Cancel the Apple one before it renews") },
    { label: "Same day, not urgent", entry: line("same-day", "2026-11-20", "upcoming", "Aquastart Swim", "Expected charge", { amountCents: 16800 }) },
    { label: "Urgent, selected", entry: line("soon-selected", "2026-11-21", "soon", "Apple + StreamBox", "Apple renews", { amountCents: 1799 }), selected: true },
    { label: "Upcoming", entry: line("upcoming", "2026-11-28", "upcoming", "IronWorks Fitness", "Renews", { amountCents: 8900 }) },
    { label: "Upcoming, selected", entry: line("upcoming-selected", "2026-11-30", "upcoming", "Calendar", "Council rates due", { amountCents: 41230 }), selected: true },
    { label: "Deadline, no amount", entry: line("deadline", "2026-12-04", "upcoming", "Wattle Insurance", "Quote expires") },
    { label: "Several on one day", entry: line("day-1", "2026-12-07", "upcoming", "Wattle Insurance", "Renews", { amountCents: 148554 }) },
    { label: "Several on one day", entry: line("day-2", "2026-12-07", "upcoming", "Transit Top", "Expected charge", { amountCents: 5000 }) },
    { label: "Reminder", entry: line("reminder", "2026-12-12", "upcoming", "Skylink Internet", "Reminder in your calendar", { detail: "Check Skylink replied" }) },
    { label: "Approved", entry: line("done", "2026-12-14", "done", "Skylink Internet", "Next Skylink Internet charge", { amountCents: 9900, detail: expect }) },
    { label: "Approved, selected", entry: line("done-selected", "2026-12-15", "done", "Skylink Internet", "Next Skylink Internet charge", { amountCents: 9900, detail: expect }), selected: true },
    { label: "Handled", entry: line("handled", "2026-12-16", "done", "Kestrel Plumbing", "Refund due", { amountCents: 38500, handled: true, detail: "Then expect $385.00 back" }) },
    { label: "Long name", entry: line("long", "2026-12-18", "upcoming", "Brunswick and Northcote Community Energy Co-operative Retail Services Proprietary Limited", "A very long description of what happens on this date that has to truncate cleanly", { amountCents: 148554 }) },
  ];
  const entries = states.map((s) => s.entry);
  return (
    <Strip>
      <div className="flex gap-4">
        <div className="flex w-40 shrink-0 flex-col" aria-hidden="true">
          {states.map(({ entry, label }) => (
            <span key={entry.key} className="flex h-10.5 items-center font-mono text-label text-faint">{label}</span>
          ))}
        </div>
        <div role="listbox" aria-label="Timeline line states" className="flex min-w-0 flex-1 flex-col">
          {states.map(({ entry, selected = false }, i) => (
            <div key={entry.key} role="option" aria-selected={selected} className={`${TIMELINE_ROW} ${selected ? "bg-raised" : ""}`}>
              <TimelineLine entry={entry} showDate={showsDate(entries, i)} amberDate={isSoonDay(entries, entry.date)} first={i === 0} last={i === states.length - 1} />
            </div>
          ))}
        </div>
      </div>
    </Strip>
  );
}

const SECTIONS = [
  ["onboarding", "Onboarding"],
  ["list", "List"],
  ["search", "Search"],
  ["filters", "Filters"],
  ["finding", "Finding"],
  ["timeline", "Timeline"],
  ["controls", "Controls"],
  ["motion", "Motion"],
  ["states", "Scan states"],
  ["overlays", "Overlays"],
  ["settings", "Settings"],
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
  // Seal the leak's other routes, on approved findings with no email draft
  // (every finding in the seed has one, so these are hand-made from the samples).
  const approvedWith = (id: string, change: Partial<Finding>): ScanState => {
    const swap = (f: Finding) => (f.id === id ? { ...f, ...change } : f);
    return { ...s.approved, findings: s.approved.findings.map(swap), result: s.approved.result && { ...s.approved.result, findings: s.approved.result.findings.map(swap) } };
  };
  const r = routeSamples(s.done);
  const sealCalendar = approvedWith("f-ironworks", {
    draft: undefined,
    action: { kind: "none", summary: "Cancel at the front desk before 28 Nov." },
    evidence: [{ kind: "event", id: "evt_004", cited: true }, ...s.approved.findings.find((f) => f.id === "f-ironworks")!.evidence],
  });
  const sealBank = approvedWith("f-brightpage", { kind: "duplicate_payment", draft: undefined, action: { kind: "none", summary: "Ask your bank to dispute the second charge." } });
  // The top finding marked "Not a leak": it goes into "Checked and left alone".
  const dismissedTop: ScanState = { ...s.done, decisions: { ...s.done.decisions, [top.id]: "dismissed" } };
  // The timeline: a line from before today, and a check that found nothing still to come.
  const pastKey = buildTimeline(s.done).find((e) => e.date < "2026-11-19")?.key;
  const nothingAhead: ScanState = {
    ...s.done,
    findings: [],
    cleared: [],
    undecided: [],
    result: s.done.result && { ...s.done.result, findings: [], cleared: [], upcoming: [] },
    corpus: s.done.corpus && { ...s.done.corpus, events: [] },
  };
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
              <Shot title="1. Welcome, waiting for the key" note="Logo and name only: no status, lines or bottom bar. Get started is locked until the summon key is pressed; ⌘↵ or Skip gets past it if no key works">
                <PaletteFrame scan={s.idle} live="none" onboarding={o({ step: "welcome" })} />
              </Shot>
              <Shot title="1. Welcome, desktop app" note="The quiet link for when another app already has ⌥Space. Switching asks for the new key">
                <PaletteFrame scan={s.idle} live="none" desktop onboarding={o({ step: "welcome" })} />
              </Shot>
              <Shot title="1. Welcome, on ⌘⇧Space" note="The link goes back to ⌥Space, so a key another app has taken is never a dead end">
                <PaletteFrame scan={s.idle} live="none" desktop hotkey={["⌘", "⇧", "Space"]} onboarding={o({ step: "welcome" })} />
              </Shot>
              <Shot title="1. Welcome, key pressed" note="The line changes to the confirmation and the Onboarding CTA unlocks, with nothing moving">
                <PaletteFrame scan={s.idle} live="none" onboarding={o({ step: "welcome", summoned: true })} />
              </Shot>
              <Shot title="1. Welcome, key pressed, mouse mode" note="The CTA shows its icon instead of the key cap">
                <PaletteFrame scan={s.idle} live="none" mouse onboarding={o({ step: "welcome", summoned: true })} />
              </Shot>
              <Shot title="2. Connect your data, nothing yet" note="Larger heading and body, more room around the two columns. Enter connects the next">
                <PaletteFrame scan={s.idle} live="none" onboarding={o({ step: "connect" })} />
              </Shot>
              <Shot title="2. Connect your data, part way" note="Bank and Email in, Documents reading: the other + buttons are disabled until it finishes, and the CTA waits too. Mouse mode">
                <PaletteFrame scan={s.idle} live="connecting" mouse onboarding={o({ step: "connect", connected: ["bank", "email"], connecting: "documents" })} />
              </Shot>
              <Shot title="2. Connect your data, calendar signed out" note="All four in, calendar sign-in expiry switched on; ⌘↵ runs the check">
                <PaletteFrame scan={s.idle} live="connectedReconnect" onboarding={o({ step: "connect", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. First check, just started" note="The bar at 0%, before the first stage reports">
                <PaletteFrame scan={{ ...s.scanningEmpty, stage: undefined, progress: undefined, trace: [] }} live="syncing" onboarding={o({ step: "first-scan", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. First check, documents slow" note="No honest percentage while waiting, so the bar moves without a number. The reason is in the open steps">
                <PaletteFrame scan={s.scanningEmpty} live="slow" agentOpen onboarding={o({ step: "first-scan", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. First check, running" note="The live seal on a transparent background follows the pointer anywhere in the window. The fold is closed and shows how far along it is; View findings is locked until the check ends">
                <PaletteFrame scan={s.scanning} live="syncing" onboarding={o({ step: "first-scan", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. First check, Seal is on it, open" note="T or a click. The steps open over the empty space below, so the seal and button stay put">
                <PaletteFrame scan={s.scanning} live="syncing" agentOpen onboarding={o({ step: "first-scan", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. First check, done" note="View findings unlocks; it waits for the press instead of jumping away">
                <PaletteFrame scan={s.done} onboarding={o({ step: "first-scan", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. First check, done, steps open, mouse mode" note="Seal is done, with a full bar and 100%">
                <PaletteFrame scan={s.done} mouse agentOpen onboarding={o({ step: "first-scan", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. First check, on saved answers" note="The replay notice stays on the bare screen, so saved answers are always labelled">
                <PaletteFrame scan={s.replayForced} endpoint={endpointSamples.forced} onboarding={o({ step: "first-scan", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. First check, didn't finish" note="Try again, or carry on: this step can't trap anyone">
                <PaletteFrame scan={s.error} live="error" agentOpen onboarding={o({ step: "first-scan", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="3. If the animation can't load" note="The plain seal takes its place at the same size">
                <PaletteFrame scan={s.scanning} live="syncing" sealFallback onboarding={o({ step: "first-scan", connected: ["bank", "email", "documents", "calendar"] })} />
              </Shot>
              <Shot title="Then: the short shortcuts dialog" note="Shows once as the findings open. Enter closes it, ? swaps it for every shortcut">
                <PaletteFrame scan={s.done} sheet="keysIntro" />
              </Shot>
              <Shot title="The short shortcuts dialog, mouse mode">
                <PaletteFrame scan={s.done} mouse sheet="keysIntro" />
              </Shot>
              <Shot title="First palette, with the hint" note="Only for installs from before onboarding (life.hintSeen); the dialog above replaces it for everyone else">
                <PaletteFrame scan={s.done} hint />
              </Shot>
            </Section>

            <Section id="list" title="List">
              <Shot title="Row states" note="One row layout for every state: tile, merchant, kind, flags, date, amount, a reserved ⋯ slot" height={650}>
                <RowStates />
              </Shot>
              <Shot title="Findings, first run" note="Grouped by urgency: tile, name, kind, date, amount. Couldn't decide stays open; Checked and left alone is closed (the first-run hint is under Onboarding)">
                <PaletteFrame scan={s.done} />
              </Shot>
              <Shot title="Approved group, selected" note="Approved rows leave the main list for an open Approved group with a count (a title, not a J/K stop). ⋯ on an approved row has Seal the leak and Remind me">
                <PaletteFrame scan={s.decided} selected="f-skylink" />
              </Shot>
              <Shot title="After some decisions" note="An approved row and one marked Not a leak, mouse mode">
                <PaletteFrame scan={s.decided} mouse selected="f-ironworks" />
              </Shot>
              <Shot title="Row quick menu open" note="The selected row's ⋯ menu: Approve, Not a leak, Remind me (L)">
                <PaletteFrame scan={s.done} mouse holdHover selected="f-ironworks" />
              </Shot>
              <Shot title="Quick menu, reminder already set" note="Remind me is greyed out and says the date, so L can't add a second one">
                <PaletteFrame scan={s.reminded} mouse holdHover selected="f-streambox" />
              </Shot>
              <Shot title="Quick menu on an approved row" note="Seal the leak (S) opens Mail with the draft; Remind me (L) to check for a reply">
                <PaletteFrame scan={s.decided} mouse holdHover selected="f-skylink" />
              </Shot>
              <Shot title="Couldn't decide, selected" note="The footer's Check again for a case the model couldn't settle">
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
              <Shot title="Left alone, with what Maya said" note="All three answers. A reason replaces the plain Not a leak">
                <PaletteFrame scan={s.ruleKept} group selected="f-brightpage" />
              </Shot>
              <Shot title="Came back" note="Made-up later charges: the seed can't do this by itself. The tooltip has the reason in figures">
                <PaletteFrame scan={s.ruleBack} selected="f-brightpage" />
              </Shot>
              <Shot title="All approved" note="Ready to send on drafted ones, Handled when there's nothing to send">
                <PaletteFrame scan={s.approved} />
              </Shot>
              <Shot title="Everything dealt with" note="Every finding approved or marked Not a leak">
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
              <Shot title="Finding, with a search held" note="Seal / Timeline / IronWorks Fitness beside the open field; / or a click goes back to the timeline">
                <PaletteFrame scan={s.done} view="detail" selected="f-ironworks" detailFrom="timeline" query="iron" />
              </Shot>
            </Section>

            <Section id="filters" title="Filters">
              <Shot title="Filter icon, with its tooltip" note="At the right of the heading row, beside View. F or a click opens the menu">
                <PaletteFrame scan={s.done} controls={{ tip: "filter" }} />
              </Shot>
              <Shot title="Hovering Filter" note="Hover lifts it, like every icon button">
                <PaletteFrame scan={s.done} mouse controls={{ hover: "filter" }} />
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
              <Shot title="Two filters" note="Two kinds show rows of either kind. The Filter icon carries the count">
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
              <Shot title="Timeline, menu open" note="The same filters, counted by finding. F or a click stays on the timeline">
                <PaletteFrame scan={s.done} view="timeline" filterMenu filters={["kind:price_increase"]} />
              </Shot>
              <Shot title="Timeline, filtered" note="Only the dated lines of matching findings, with the same chips. The total and group sums follow">
                <PaletteFrame scan={s.done} view="timeline" filters={["kind:price_increase", "kind:trial_converted"]} />
              </Shot>
              <Shot title="Timeline, a finding with no dates" note="This sample has no dated lines, so it says how to get back">
                <PaletteFrame scan={s.done} view="timeline" filters={["kind:billing_error"]} />
              </Shot>
              <Shot title="Timeline, mouse mode" note="Clear all takes the place of the key hint">
                <PaletteFrame scan={s.done} view="timeline" mouse filters={["soon"]} />
              </Shot>
              <Shot title="Timeline, nothing matches" note="A filter and a search with no line in common: says how to get back">
                <PaletteFrame scan={s.done} view="timeline" query="sky" filters={["kind:billing_error"]} />
              </Shot>
            </Section>

            <Section id="finding" title="Finding">
              <Shot title="Evidence and draft" note="Main column: header, the amount at stake, deadline chip, then the draft. Sidebar: its heading (Leaks found, the trace and fold buttons), then one accordion, Evidence it relied on open with its first line selected; Also gathered and Checked by code folded. Each header has its count in a circle">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" />
              </Shot>
              <Shot title="All panels folded" note="Enter or Space on a header folds its panel: three headers, one line each">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" panels={[]} stop={0} />
              </Shot>
              <Shot title="Evidence preview" note="J to the second line, Enter: a card beside it with where it's from, a few words (at most 30 characters, around the amount code checked) and Open source. Esc closes it">
                <PaletteFrame scan={s.done} view="detail" selected="f-ironworks" stop={2} peek={1} />
              </Shot>
              <Shot title="Also gathered open" note="Several panels can be open at once; its lines preview the same way">
                <PaletteFrame scan={s.done} view="detail" selected="f-ironworks" panels={["cited", "gathered"]} stop={4} />
              </Shot>
              <Shot title="Checked by code open" note="C from either side, or J to its header and Enter. The header is the sidebar's last stop">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" panels={["cited", "figures"]} stop={99} />
              </Shot>
              <Shot title="Whole source" note="Open source (Enter on the card): the whole email over a dimmed palette, amounts checked by code highlighted. J/K scroll it, Esc goes back to the line">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" source={0} />
              </Shot>
              <Shot title="Whole source: a bank line" note="A transaction has no text: its description as the title, then account, date and amount">
                <PaletteFrame scan={s.done} view="detail" selected="f-brightpage" source={0} />
              </Shot>
              <Shot title="Not a leak, no answer yet" note="1, 2 and 3 say why. The route keys rest while it's set aside">
                <PaletteFrame scan={s.ruleNoReason} view="detail" selected="f-brightpage" />
              </Shot>
              <Shot title="Not a leak, answered" note="What Maya said and what would bring it back. Another number changes the answer">
                <PaletteFrame scan={s.ruleKept} view="detail" selected="f-brightpage" />
              </Shot>
              <Shot title="Came back: the amount changed" note="Back among the open findings, with its route and draft untouched">
                <PaletteFrame scan={s.ruleBack} view="detail" selected="f-brightpage" />
              </Shot>
              <Shot title="Came back: charged again" note="Already sorted, and Skylink charged the raised price again">
                <PaletteFrame scan={s.ruleBack} view="detail" selected="f-skylink" />
              </Shot>
              <Shot title="Came back: a different problem" note="Seal got it wrong only holds for the same kind of problem">
                <PaletteFrame scan={s.ruleBack} view="detail" selected="f-redgum" />
              </Shot>
              <Shot title="Came back: bank unread" note="Uncertain, so it shows. The next good check puts it away again">
                <PaletteFrame scan={s.ruleBack} view="detail" selected="f-streambox" />
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
              <Shot title="Meter photo" note="Evidence with no text layer: its card shows the photo">
                <PaletteFrame scan={s.done} view="detail" selected="f-redgum" stop={2} peek={1} />
              </Shot>
              <Shot title="Meter photo, whole source" note="Open source shows the photo large, so the red tenths digit can be read">
                <PaletteFrame scan={s.done} view="detail" selected="f-redgum" stop={2} source={1} />
              </Shot>
              <Shot title="Editing the draft" note="In the heading, Approve and Edit give way to Done (Esc, not primary), the same as the Done under the editor; they come back after. Revert (⌘⇧⌫) and Done (Esc, or ⌘↵) follow the button pattern: key caps here, icons with the mouse. While editing, letters type, Tab stays in the editor, and focus comes back to it if a menu took it">
                <PaletteFrame scan={s.edited} view="detail" selected="f-skylink" pane="draft" editing />
              </Shot>
              <Shot title="Editing, mouse mode" note="Revert and Done with their icons">
                <PaletteFrame scan={s.edited} view="detail" selected="f-skylink" pane="draft" editing mouse />
              </Shot>
              <Shot title="Editing with the trace open" note="Both at once: keys stay in the editor (T types a t), Esc ends editing first and then closes the drawer, so its Close shows an X. The draft keeps room to scroll clear of the drawer">
                <PaletteFrame scan={s.edited} view="detail" selected="f-skylink" pane="draft" editing trace="finding" />
              </Shot>
              <Shot title="Draft verbs" note="Firmer and Shorter, docked under the draft on the Email route. Quiet: no violet, and the row stays put when the text changes length">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Writing a rewrite" note="The text stays readable, a little quieter, until the checked version lands. Pressing the verb again or ⌘Z stops it">
                <PaletteFrame scan={s.rewriting} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="A rewrite on screen" note="The active verb is pressed in. Pressing it again, or ⌘Z, goes back to the version before">
                <PaletteFrame scan={s.rewritten} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="A saved rewrite" note="From saved answers, and it says so. Never shown as live">
                <PaletteFrame scan={s.rewrittenSaved} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Draft verbs, mouse mode" note="Icons in place of the key caps">
                <PaletteFrame scan={s.rewritten} view="detail" selected="f-skylink" pane="draft" mouse />
              </Shot>
              <Shot title="Hand-edited: verbs off" note="Revert first. Their tooltip says how">
                <PaletteFrame scan={s.edited} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="No version passed the checks" note="The draft on screen is kept, and the toast says so plainly">
                <PaletteFrame scan={s.rewriteFailed} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Not available offline" note="On saved answers, with no saved rewrite">
                <PaletteFrame scan={s.rewriteOffline} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Nothing to send" note="The fix is a step Maya takes herself">
                <PaletteFrame scan={s.done} view="detail" selected="f-streambox" />
              </Shot>
              <Shot title="Actions in the heading" note="On the left, the ways to act: Approve (A, the main action) and Edit (E: change the wording first). On the right, the ways to put it off or set it aside: Remind me (L) and Not a leak (D). Always in view while the draft scrolls. The draft's text is clickable (editing starts with the caret where you clicked); hovering it shows Edit under its bottom right, where Done sits while editing">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Approved: Seal the leak" note="The sidebar folds by itself on Approve (the evidence has done its job; ] brings it back). The heading keeps Edit (E, takes the approval back) on the left and Remind me on the right. The draft itself is hidden: the timeline's first line says what was saved (hover it for a pencil that edits it). Seal the leak (S, opens Mail with the draft filled in) is on the Send it line, left of its dot, between today and the next date">
                <PaletteFrame scan={s.approved} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Evidence folded away" note="] or the fold button in the sidebar's heading folds it to a strip: the unfold button and the trace icon under it (still in reach). The draft gets the room; Tab has only the draft side then, and ] (or a click on the strip) brings it back">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" pane="draft" sidebarFolded />
              </Shot>
              <Shot title="Trace for this finding" note="The trace icon in the sidebar's heading (pressed while open), or T inside a finding: what the agent did for this one, written by code from its record. A second press closes it; the switch goes to the whole check's. Close: Esc's key cap (an X with the mouse)">
                <PaletteFrame scan={s.done} view="detail" selected="f-redgum" trace="finding" />
              </Shot>
              <Shot title="Drafted email folded" note="Drafted email is a fold drawn like the sidebar's panel headers, open to start: To, Subject and Attach as a paper plane, a quote and a paper clip, each named in its tooltip. Enter or Space on the draft side (Hide details in the footer), or a click, folds it">
                <PaletteFrame scan={s.done} view="detail" selected="f-redgum" pane="draft" detailsOpen={false} />
              </Shot>
              <Shot title="Approved, mouse mode" note="Plain buttons, each with its icon before the label (Seal the leak: a seal); hovering Seal the leak says where it goes">
                <PaletteFrame scan={s.approved} view="detail" selected="f-skylink" mouse />
              </Shot>
              <Shot title="Routes: Email" note="Best way and why, then one tab per route on keys 1-4, recommended first. Email keeps the draft as it was; hovering it adds Copy (Y) beside Edit">
                <PaletteFrame scan={r.email} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Routes: Call" note="Number marked Sample (never dialled), hours and wait, Say this with Copy (Y), If they say no, and Have Ready folded: Edit leaves the heading, since there's no draft on this route">
                <PaletteFrame scan={r.call} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Routes: Call, Have Ready open" note="Enter or a click: what they'll ask for, then figures code checked. It starts closed on every finding">
                <PaletteFrame scan={r.call} view="detail" selected="f-skylink" pane="draft" readyOpen />
              </Shot>
              <Shot title="Routes: Chat" note="The opener to paste, with the link marked Sample: a click shows the sample page">
                <PaletteFrame scan={r.chat} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Routes: Online" note="Numbered steps from the directory, then the values to enter">
                <PaletteFrame scan={r.email} view="detail" selected="f-redgum" pane="draft" />
              </Shot>
              <Shot title="Routes, mouse mode" note="Each tab's key cap becomes its kind's icon, in the same width, so nothing moves">
                <PaletteFrame scan={r.call} view="detail" selected="f-skylink" pane="draft" mouse />
              </Shot>
              <Shot title="Route with no script" note="The model failed: contacts and figures come from code, so they still show">
                <PaletteFrame scan={r.noScript} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Script failed the check" note="A figure that isn't in the evidence: the same warning a draft gets">
                <PaletteFrame scan={r.unchecked} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Approved: Email, with where to go next" note="A dated If they say no line, 14 days on. O opens the real complaint form in the browser">
                <PaletteFrame scan={r.approvedEmail} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Approved: Email with files" note="A mail link can't carry files, so the Send it line names each one, and Mail opens with a note above the draft">
                <PaletteFrame scan={r.approvedFiles} view="detail" selected="f-norvik" pane="draft" />
              </Shot>
              <Shot title="Approved: Email claiming more than its files" note="The draft says the receipts are attached, but they are emails, so it says which ones and how to fix it">
                <PaletteFrame scan={r.approvedFilesMissing} view="detail" selected="f-kestrel" pane="draft" />
              </Shot>
              <Shot title="Approved: Call" note="No draft saved. The route is fixed (⌘Z to change it), the script stays under the timeline, and S shows the sample page rather than dialling">
                <PaletteFrame scan={r.approvedCall} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Approved: Online" note="The steps stay under the timeline while Maya does them">
                <PaletteFrame scan={r.approvedOnline} view="detail" selected="f-redgum" pane="draft" />
              </Shot>
              <Shot title="Warranty: Online" note="Two businesses, two jobs. The claim goes to Norvik, and the deadline is the time free cancellation ends at Spinwell">
                <PaletteFrame scan={r.warranty} view="detail" selected="f-norvik" pane="draft" />
              </Shot>
              <Shot title="Warranty: Call" note="The script is for Spinwell and only cancels the booking. The number is a sample and is never dialled">
                <PaletteFrame scan={r.warrantyCall} view="detail" selected="f-norvik" pane="draft" />
              </Shot>
              <Shot title="Warranty: approved" note="Approving the claim doesn't cancel the repair, so the cancel time and the last day to claim each keep their own dated line">
                <PaletteFrame scan={r.warrantyApproved} view="detail" selected="f-norvik" pane="draft" />
              </Shot>
              <Shot title="If they say no: a sample body" note="A fictional bank is marked Sample, and O shows its sample page">
                <PaletteFrame scan={r.approvedSampleBody} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Sample page" note="S on a call, chat or online route. Fictional businesses are never dialled or opened">
                <PaletteFrame scan={r.approvedOnline} view="detail" selected="f-redgum" pane="draft" samplePage={r.samplePage} />
              </Shot>
              <Shot title="Seal the leak: Calendar" note="Sample: no email or number, and a calendar event in the evidence (Ben's reminder), so it opens Calendar and names the date">
                <PaletteFrame scan={sealCalendar} view="detail" selected="f-ironworks" pane="draft" />
              </Shot>
              <Shot title="Seal the leak: the bank" note="Sample: a payment made twice with no email: there's no bank app to link to, so it says where to do it (in a toast on S)">
                <PaletteFrame scan={sealBank} view="detail" selected="f-brightpage" pane="draft" />
              </Shot>
              <Shot title="Approved, with a reminder" note="L added an all-day reminder to check for a reply: the bell notice says when, and the timeline has Reminder created (ticked) and the reminder's own day. Remind me leaves the button row once it's set">
                <PaletteFrame scan={s.reminded} view="detail" selected="f-skylink" pane="draft" />
              </Shot>
              <Shot title="Reminder on an open finding" note="Not approved yet, but put off: a bell notice says when, with Remove reminder (L again) to take it off, and Remind me comes back (two days before the deadline, never before tomorrow: here 20 Nov), and the Next timeline starts with Reminder created, then the reminder and the deadline (amber: within 7 days)">
                <PaletteFrame scan={s.reminded} view="detail" selected="f-streambox" pane="draft" />
              </Shot>
              <Shot title="Approved, a refund to expect" note="Redgum: the credit is an estimate, so it says about">
                <PaletteFrame scan={s.approved} view="detail" selected="f-redgum" pane="draft" />
              </Shot>
              <Shot title="Approved, nothing to send" note="Marked as handled, and what to expect once Maya cancels it herself. The step is in Apple's settings, so there's no Seal the leak: Undo (⌘Z) instead of Edit">
                <PaletteFrame scan={s.approved} view="detail" selected="f-streambox" />
              </Shot>
              <Shot title="Finding, mouse mode" note="Plain action buttons, no selection highlight; the footer says to click any evidence line to preview it">
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
              <Shot title="Line states" note="One line for every state: date, marker, merchant, what, amount. A second line only on agent and approved lines" height={770}>
                <TimelineLineStates />
              </Shot>
              <Shot title="Timeline" note="Earlier folded, today's activity, Now, then Next 7 days, Later in November and each month, with subtotals. Amber only within 7 days">
                <PaletteFrame scan={s.decided} view="timeline" />
              </Shot>
              <Shot title="Earlier, header selected" note="Closed by default, with a count. J/K stop on its header; Enter or Space opens it">
                <PaletteFrame scan={s.done} view="timeline" selected={EARLIER_GROUP} />
              </Shot>
              <Shot title="Earlier, open, a line selected" note="Month names stay inside. Coming back from a finding opened here keeps it open, with the line selected">
                <PaletteFrame scan={s.done} view="timeline" earlier selected={pastKey} />
              </Shot>
              <Shot title="Search that matches inside Earlier" note='"notice": Earlier opens by itself while the search holds'>
                <PaletteFrame scan={s.done} view="timeline" query="notice" />
              </Shot>
              <Shot title="Nothing ahead" note="Now ends the rail, with a quiet line under it">
                <PaletteFrame scan={nothingAhead} view="timeline" />
              </Shot>
              <Shot title="Timeline, while checking" note="Checking now sits above Now; the heading says more may appear">
                <PaletteFrame scan={s.scanning} view="timeline" />
              </Shot>
              <Shot title="Timeline, check didn't finish">
                <PaletteFrame scan={s.error} view="timeline" />
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

            <Section id="controls" title="Controls">
              <Shot title="Search, Filter and View" note="At the top right, with their keys in their tooltips. View is one click (or V) between the list and the timeline; its icon is the view you're on">
                <PaletteFrame scan={s.done} controls={{ tip: "view" }} />
              </Shot>
              <Shot title="View on the timeline, mouse mode" note="The icon shows the timeline; a click goes back to the list">
                <PaletteFrame scan={s.done} view="timeline" mouse controls={{ tip: "view" }} />
              </Shot>
              <Shot title="An open finding" note="Its actions take the top right. The sidebar runs the full height with a dotted zig-zag edge">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" detailFrom="timeline" />
              </Shot>
              <Shot title="An open finding, mouse mode" note="Approve shows its icon instead of its key cap; the icon buttons look the same in both modes">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" mouse />
              </Shot>
              <Shot title="An open finding, sidebar collapsed" note="The rest of the app takes the full width, and the sidebar icon is the last icon in the top bar (T still opens the trace)">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" sidebarFolded />
              </Shot>
              <Shot title="Hovering View" note="Hover lifts an icon button">
                <PaletteFrame scan={s.done} view="timeline" mouse controls={{ hover: "view" }} />
              </Shot>
              <Shot title="Trace in the top bar" note="Bottom left: the cog, Sync, Trace, then the status and date. Tooltip: T">
                <PaletteFrame scan={s.done} controls={{ tip: "trace" }} />
              </Shot>
              <Shot title="Trace open" note="T or the Trace icon; the icon stays lit while the drawer is open">
                <PaletteFrame scan={s.done} trace />
              </Shot>
              <Shot title="Settings cog" note="The bottom left corner. Tooltip: ⌘,">
                <PaletteFrame scan={s.done} controls={{ tip: "settings" }} />
              </Shot>
              <Shot title="Settings menu" note="The cog or ⌘,. Shortcuts, then Connectors, Models and Hide, then All settings">
                <PaletteFrame scan={s.done} controls={{ settings: true }} />
              </Shot>
              <Shot title="Settings menu, mouse mode" note="No key caps on the rows">
                <PaletteFrame scan={s.done} mouse controls={{ settings: true }} />
              </Shot>
              <Shot title="Settings menu, calendar signed out" note="A red dot on the cog; the Connectors row says what to fix">
                <PaletteFrame scan={s.done} live="reconnect" controls={{ settings: true }} />
              </Shot>
              <Shot title="Settings menu, endpoint offline" note="A red dot on the cog; the Models row says why">
                <PaletteFrame scan={s.replayOffline} endpoint={endpointSamples.offline} controls={{ settings: true }} />
              </Shot>
              <Shot title="Settings menu, saved answers chosen" note="An info dot on the cog">
                <PaletteFrame scan={s.replayForced} endpoint={endpointSamples.forced} modelDemo={{ ...DEMO_OFF, saved: true }} controls={{ settings: true }} />
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
                    <KeyButton keys={["A"]} label={copy.actions.approve} icon={<ApproveIcon />} tone="primary" onClick={noop} />
                    <KeyButton keys={["L"]} label={copy.actions.remind} icon={<RemindIcon />} onClick={noop} />
                  </Pressed>
                </Strip>
              </Shot>
            </Section>

            <Section id="states" title="Scan states">
              <Shot title="Loading bar" note="One bar everywhere: violet with grain, the number beside it" height={250}>
                <LoadingBars />
              </Shot>
              <Shot title="Checking, just started" note="The list stays in place. Bottom left: cog, Trace, Sync, the bar, then the status and date">
                <PaletteFrame scan={{ ...s.scanningEmpty, stage: undefined, progress: undefined, trace: [] }} live="syncing" />
              </Shot>
              <Shot title="Checking, part way, nothing yet">
                <PaletteFrame scan={s.scanningEmpty} live="syncing" />
              </Shot>
              <Shot title="Checking, documents slow" note="No honest percentage, so the bar moves without a number and the status says why">
                <PaletteFrame scan={s.scanningEmpty} live="slow" />
              </Shot>
              <Shot title="Checking, first findings in" note="Rows fill in above the bottom bar's loading bar">
                <PaletteFrame scan={s.scanning} live="syncing" />
              </Shot>
              <Shot title="Checking, on the timeline" note="The same bar, in the same place">
                <PaletteFrame scan={s.scanning} live="syncing" view="timeline" />
              </Shot>
              <Shot title="Checking, replay notice showing">
                <PaletteFrame scan={s.checkingOffline} live="syncing" />
              </Shot>
              <Shot title="Checking, inside a finding" note="The narrowest bottom bar: the loading bar gives up width first">
                <PaletteFrame scan={s.scanning} live="syncing" view="detail" selected="f-redgum" pane="draft" />
              </Shot>
              <Shot title="Background check" note="No bar: the last results stay and the footer says it's checking">
                <PaletteFrame scan={s.refreshing} />
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
              <Shot title="Crash screen" note="If drawing the app fails. A still picture here: its keys only work on the real screen (__life.crash() in dev)">
                <div data-gallery-frame style={{ width: 1000, height: 680 }} {...blockers}>
                  <CrashPanel onReload={noop} onHide={noop} />
                </div>
              </Shot>
            </Section>

            <Section id="overlays" title="Overlays">
              <Shot title="Replay mode banner, one answer saved" note="A single call fell back on its own; that row is labelled. More in Model endpoint">
                <PaletteFrame scan={s.replay} />
              </Shot>
              <Shot title="Toast with undo" note="Replays every 5 s">
                <PaletteFrame scan={s.toast} selected="f-ironworks" />
              </Shot>
              <Shot title="Not a leak: the toast asks why" note="D. Keys 1 to 3 belong to it while it shows. Ignoring it is fine">
                <PaletteFrame scan={s.ruleAsking} selected="f-ironworks" />
              </Shot>
              <Shot title="Not a leak: answered" note="Says what would bring it back, with Undo for the dismissal and its rule together">
                <PaletteFrame scan={s.ruleAnswered} selected="f-ironworks" />
              </Shot>
              <Shot title="Reminder couldn't be added" note="Calendar signed out (⌘⇧D, 1): nothing is stored, and R signs it back in">
                <PaletteFrame scan={s.reminderFailed} />
              </Shot>
              <Shot title="Toast without undo">
                <PaletteFrame scan={s.toastNoUndo} />
              </Shot>
              <Shot title="Toast tones" note="Error, Warning, Success and Info, with and without Undo, plus the question. Replays every 5 s" height={533}>
                <ToastTones />
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

            <Section id="settings" title="Settings">
              <Shot title="Connectors" note="Every menu's last row opens this dialog on its tab. J/K move between tabs, numbers work the rows">
                <PaletteFrame scan={s.done} settings="connectors" />
              </Shot>
              <Shot title="Connectors, mouse mode" note="Each whole row is its switch">
                <PaletteFrame scan={s.done} mouse settings="connectors" />
              </Shot>
              <Shot title="Connectors, a source off" note="Applies on the next sync, so the footer offers Sync to apply">
                <PaletteFrame scan={{ ...s.done, checkedSources: ["bank", "email", "documents", "calendar"] }} live="sourceOff" settings="connectors" />
              </Shot>
              <Shot title="Connectors, last source on" note="Its switch is locked: a check needs something to read">
                <PaletteFrame scan={{ ...s.done, checkedSources: ["bank"] }} live="lastSource" settings="connectors" />
              </Shot>
              <Shot title="Connectors, calendar signed out" note="Reconnect takes the place of its switch">
                <PaletteFrame scan={s.done} live="reconnect" settings="connectors" />
              </Shot>
              <Shot title="Connectors, check running" note="Switches rest until it finishes">
                <PaletteFrame scan={s.scanning} live="syncing" settings="connectors" />
              </Shot>
              <Shot title="Models" note="The endpoint, saved answers, and what each model does">
                <PaletteFrame scan={s.done} settings="models" />
              </Shot>
              <Shot title="Models, endpoint offline">
                <PaletteFrame scan={s.replayOffline} endpoint={endpointSamples.offline} settings="models" />
              </Shot>
              <Shot title="Models, launch flag holds saved answers on">
                <PaletteFrame scan={s.replayFlag} endpoint={endpointSamples.flag} modelDemo={{ ...DEMO_OFF, byFlag: true }} settings="models" />
              </Shot>
              <Shot title="View" note="Where the palette opens when summoned">
                <PaletteFrame scan={s.done} settings="view" />
              </Shot>
              <Shot title="Filters" note="Every filter with what it means and how many rows it matches">
                <PaletteFrame scan={s.done} filters={["kind:price_increase"]} settings="filters" />
              </Shot>
              <Shot title="Filters, nothing to filter yet">
                <PaletteFrame scan={s.idle} live="none" settings="filters" />
              </Shot>
              <Shot title="Remembered, nothing yet" note="The empty state says how a rule gets here">
                <PaletteFrame scan={s.done} settings="remembered" />
              </Shot>
              <Shot title="Remembered" note="Each answer and what would bring it back. A number or the bin forgets it, and the finding returns">
                <PaletteFrame scan={s.ruleKept} settings="remembered" />
              </Shot>
              <Shot title="Remembered, mouse mode">
                <PaletteFrame scan={s.ruleKept} mouse settings="remembered" />
              </Shot>
              <Shot title="Remembered, some came back" note="A rule stays listed while its finding is back, with the reason">
                <PaletteFrame scan={s.ruleBack} settings="remembered" />
              </Shot>
              <Shot title="General" note="The summon key and the background check">
                <PaletteFrame scan={s.done} settings="general" />
              </Shot>
              <Shot title="General, mouse mode">
                <PaletteFrame scan={s.done} mouse settings="general" />
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
              <Shot title="The cog's dot, by endpoint state" note="Nothing while live; info for slow or saved answers; red when it can't answer" height={380}>
                <Strip>
                  {(
                    [
                      ["Live", endpointSamples.live],
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
                          <SettingsButton hotkey={["⌥", "Space"]} mouse={false} onKeys={noop} onConnectors={noop} onModels={noop} onAllSettings={noop} />
                        </div>
                      </Labelled>
                    </Preview>
                  ))}
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
              <Shot title="The logo" note="At each size, and the menu bar icon in this theme's text colour (macOS draws it 18 px tall)" height={150}>
                <Strip>
                  <Labelled label="16, 18, 22, 32, 44">
                    <div className="flex items-center gap-6 text-text">
                      {[16, 18, 22, 32, 44].map((size) => (
                        <Mark key={size} size={size} />
                      ))}
                    </div>
                  </Labelled>
                  <Labelled label="Menu bar icon">
                    <span
                      role="img"
                      aria-label="Menu bar icon"
                      className="block size-[18px] bg-current text-text"
                      style={{ mask: `url(${trayIcon}) center / contain no-repeat`, WebkitMask: `url(${trayIcon}) center / contain no-repeat` }}
                    />
                  </Labelled>
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
            </Section>

            <Section id="header" title="Top bar">
              <Shot title="Status in the bottom bar" height={300}>
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
                        <ScanStatus />
                      </Labelled>
                    </Preview>
                  ))}
                </Strip>
              </Shot>
              <Shot title="Breadcrumb links, in a finding" note="Seal and Findings go back. Approve, then icon buttons for Edit and Remind me, take the place of Search, Filter and View. Not a leak is in the sidebar heading">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" />
              </Shot>
              <Shot title="Breadcrumb from the timeline" note="The link says where it goes: Timeline">
                <PaletteFrame scan={s.done} view="detail" selected="f-skylink" detailFrom="timeline" />
              </Shot>
              <Shot title="Search open, top right">
                <PaletteFrame scan={s.done} search={{ focused: true }} />
              </Shot>
              <Shot title="Sync, with its tooltip" note="One press syncs everything (R)">
                <PaletteFrame scan={s.done} syncTip />
              </Shot>
              <Shot title="Sync while a check runs" note="It spins and rests">
                <PaletteFrame scan={s.scanning} live="syncing" syncTip />
              </Shot>
            </Section>
            <Section id="parts" title="Parts">
              <Shot title="Type scale" note="Hero and lead are onboarding's larger steps" height={330}>
                <Strip>
                  {(
                    [
                      ["hero 34", "heading text-hero font-semibold"],
                      ["lead 18", "text-lead"],
                      ["heading 18", "heading text-heading font-semibold"],
                      ["title 16", "heading text-title font-semibold"],
                      ["body 14", "text-body"],
                      ["small 13", "text-small"],
                      ["meta 12", "text-meta"],
                      ["label 11", "label"],
                    ] as const
                  ).map(([label, type]) => (
                    <Labelled key={label} label={label}>
                      <p className={type}>Find the pesky leaks</p>
                    </Labelled>
                  ))}
                </Strip>
              </Shot>
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
              <Shot title="Key buttons" note="Keyboard (key caps before the label), mouse (an icon instead) and disabled. Seal the leak follows the same pattern: S in keyboard mode, its seal in mouse mode" height={150}>
                <Strip>
                  <Labelled label="Keyboard">
                    <div className="flex items-center gap-6 text-meta">
                      <KeyButton keys={["A"]} label={copy.actions.approve} icon={<ApproveIcon />} tone="primary" onClick={noop} />
                      <KeyButton keys={["S"]} label={copy.actions.seal} icon={<SealIcon />} tone="primary" onClick={noop} />
                      <KeyButton keys={["L"]} label={copy.actions.remind} icon={<RemindIcon />} onClick={noop} />
                      <KeyButton keys={["T"]} label="Trace" icon={<TraceIcon />} tone="faint" onClick={noop} />
                      <KeyButton keys={["R"]} label={copy.demo.checkInProgress} icon={<CheckNowIcon />} onClick={noop} disabled />
                    </div>
                  </Labelled>
                  <Labelled label="Mouse">
                    <div className="flex items-center gap-6 text-meta">
                      <KeyButton keys={["A"]} label={copy.actions.approve} icon={<ApproveIcon />} tone="primary" onClick={noop} mouse />
                      <KeyButton keys={["S"]} label={copy.actions.seal} icon={<SealIcon />} tone="primary" onClick={noop} mouse />
                      <KeyButton keys={["L"]} label={copy.actions.remind} icon={<RemindIcon />} onClick={noop} mouse />
                      <KeyButton keys={["T"]} label="Trace" icon={<TraceIcon />} tone="faint" onClick={noop} mouse />
                      <KeyButton keys={["R"]} label={copy.demo.checkInProgress} icon={<CheckNowIcon />} onClick={noop} mouse disabled />
                    </div>
                  </Labelled>
                </Strip>
              </Shot>
              <Shot title="Row dates" note="Plain figures. Past or within 7 days is amber, anything later is the normal text colour" height={110}>
                <Strip>
                  <Labelled label="14 Nov, 21 Nov, 18 Dec">
                    <div className="flex items-center gap-4">
                      <RowDate date="2026-11-14" />
                      <RowDate date="2026-11-21" />
                      <RowDate date="2026-11-28" />
                      <RowDate date="2026-12-18" />
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
