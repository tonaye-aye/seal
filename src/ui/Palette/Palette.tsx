import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { Cleared, Finding } from "../../agent/pipeline";
import { activeHotkey, copyText, hidePalette, onOpenSettings, onPaletteShown, onWindowFocus } from "../../lib/native";
import {
  finishOnboarding,
  runFirstCheck,
  onboardingDone,
  isSetupScreen,
  next as nextSetupStep,
  proveSummon,
  resetOnboarding,
  skipConnect,
  useOnboarding,
} from "../../lib/onboarding";
import { getPreferences } from "../../lib/preferences";
import { DetailHint, ListHint, TimelineHint } from "./FooterHint";
import { VERB_BY_CODE } from "./DraftVerbs";
import { SetupScreen, SetupSkip, welcomeLocked } from "../Onboarding/SetupScreen";
import { approve, cancelReminder, cancelRewrite, chooseRoute, pressVerb, dismiss, isEdited, nothingConnected, notify, rankedFindings, rememberWhy, remind, reopen, resetEdit, syncEverything, undoLast, useScan } from "../../lib/scan-store";
import { RULE_REASONS } from "../../lib/rules";
import { openComplaintBody, seal, sealTarget } from "../seal";
import { chosenRoute, escalationPage, routePage, routeText, usesEmail, type SamplePage } from "../fix-route";
import { SamplePageSheet, hasHaveReady } from "./RoutePanel";
import { findingTrace } from "../finding-trace";
import { DEFAULT_PANELS, FindingActions, FindingDetail, findingActions, hasDraftPanel as findingHasDraftPanel, firstStop, sidebarStops, type Command, type Pane, type PanelId } from "./FindingDetail";
import {
  AllClear,
  CLEARED_GROUP,
  FindingsList,
  ScanError,
  SealState,
  groupOpen,
  leftAlone,
  listItems,
  listStops,
  pickSelected,
  type ListItem,
  type RowAction,
} from "./FindingsList";
import { SearchField } from "./SearchField";
import { FilterButton } from "./Filters";
import { applyFilters, filterOptions, passingFindings, toggleFilter, type FilterId } from "../filters";
import { Footer } from "./Footer";
import { Header, type Crumb } from "./Header";
import { PaletteShell } from "./PaletteShell";
import { copy } from "../../copy";
import { SettingsButton, TraceButton, ViewButton } from "./Controls";
import { SettingsDialog, type SettingsTab } from "./SettingsDialog";
import { ShortcutIntro, ShortcutSheet } from "./ShortcutSheet";
import { ScenariosSheet } from "./ScenariosSheet";
import { SyncButton } from "./SyncButton";
import { layerOwns, setPaletteElement } from "../layers";
import { Toast } from "./Toast";
import { TraceDrawer } from "./Trace";
import { replayNote } from "../replay";
import { Timeline } from "./Timeline";
import { EARLIER_GROUP, buildTimeline, earlierOpen, filterTimeline, isEarlier, isEarlierStop, nowIndex, onlyFindings, pickTimelineStop, timelineStops } from "../timeline";
import { changeView, nativeViewTransitions } from "../motion";

// The summoned palette. It fills the native window; the window itself is
// transparent with a macOS blur behind, so this panel adds the warm tint.
//
// It owns every key, in one handler, so nothing else can fight over them:
//   list    J/K move, Enter opens, A approve, S seal the leak (once approved), E edit, D not a leak, L remind me,
//           Enter or Space on "Checked and left alone" opens or closes it
//   detail  J/K move through the sidebar (or scroll the draft), Enter or Space
//           opens or closes the selected line, C "Checked by code", Tab draft/sidebar
//   timeline  J/K move through time, Enter opens the line's finding
//   list and timeline  F filter menu, Backspace removes the newest filter (Esc clears them all, after the search)
//   always  Cmd+Enter timeline, V view menu, Cmd+Z undo, / search, T trace, R sync everything, N connectors, M models, ? keys, Esc back
//   hidden  Cmd+Shift+D demo panel (its own keys live in ScenariosSheet)
//   setup   (the three onboarding steps) Enter does the step's action, Cmd+Enter runs the first check
//
// While a menu or a sheet is open, it owns the keys instead (src/ui/layers.tsx).

const HINT_KEY = "life.hintSeen";

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function typingIn(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** The view to open on (Settings, View). "Where I left off" starts on the list after a restart. */
function startingView(): "list" | "timeline" {
  return getPreferences().startView === "timeline" ? "timeline" : "list";
}

/**
 * Is this key press the summon hotkey? Only needed in a plain browser, which
 * has no global hotkey: in the app, the native side catches it first.
 */
function isHotkey(event: KeyboardEvent, keys: string[]): boolean {
  if (event.code !== "Space") return false;
  return keys.join("") === "⌘⇧Space" ? event.metaKey && event.shiftKey : event.altKey && !event.metaKey;
}

export function Palette() {
  const scan = useScan();
  const onboarding = useOnboarding();
  const setup = isSetupScreen(onboarding.step);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  // Bumped on every summon so React remounts the panel and the entrance
  // animation plays again. Findings and decisions live in the store, so they stay.
  const [openCount, setOpenCount] = useState(0);
  const [hotkey, setHotkey] = useState<string[]>([]);
  // False until the app says which key registered, so step 1 doesn't flash unlocked.
  const [hotkeyReady, setHotkeyReady] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>();
  // Bumped when the keyboard moves the selection, so only that scrolls the list.
  const [scrollKey, setScrollKey] = useState(0);
  // Which hand is driving: moving the mouse moves the selection and shows the
  // row's click buttons; any key press hides them until the mouse moves again.
  const [mouse, setMouse] = useState(false);
  // False while another app has focus: the palette dims, like an inactive window.
  const [focused, setFocused] = useState(true);
  const [view, setView] = useState<"list" | "detail" | "timeline">(startingView);
  // Where Esc goes back to from an open finding.
  const [detailFrom, setDetailFrom] = useState<"list" | "timeline">("list");
  const [timelineKey, setTimelineKey] = useState<string>();
  const [pane, setPane] = useState<Pane>("evidence");
  // In an open finding's sidebar: the selected stop (-1: the first piece of
  // evidence), which panels are open (the evidence it relied on, to start),
  // and which evidence has its card open, or its whole source in the sheet (-1: none).
  const [sideStop, setSideStop] = useState(-1);
  const [panels, setPanels] = useState<PanelId[]>(DEFAULT_PANELS);
  const [peek, setPeek] = useState(-1);
  // The labelled stand-in for a fictional business's page or number.
  const [samplePage, setSamplePage] = useState<SamplePage>();
  // The finding's sidebar, showing or slid away (] or its icon). For
  // findings that still need Maya it stays as she left it from one to the next.
  // An approved finding is past its evidence, so its sidebar folds on its own
  // (approvedSidebarOpen, false each time one is opened or approved); ⌘Z or Edit
  // takes the approval back and the evidence returns.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [approvedSidebarOpen, setApprovedSidebarOpen] = useState(false);
  const [source, setSource] = useState(-1);
  const [editing, setEditing] = useState(false);
  // The draft's "Drafted email" fold (To, Subject, Attach): open to start, and
  // left as Maya sets it from one finding to the next.
  const [detailsOpen, setDetailsOpen] = useState(true);
  // Which finding has Have Ready unfolded. It starts closed on every finding.
  const [readyFor, setReadyFor] = useState<string>();
  const [traceOpen, setTraceOpen] = useState(false);
  // Which trace the drawer shows: the open finding's own, or the whole check's.
  const [traceScope, setTraceScope] = useState<"finding" | "check">("check");
  const [sheetOpen, setSheetOpen] = useState(false);
  // The settings menu (the cog, or ⌘,).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The Settings dialog, on one of its tabs (undefined: closed). Every menu's last row opens it.
  const [settingsTab, setSettingsTab] = useState<SettingsTab>();
  // Onboarding's step 3: the "Agent working" fold (T, or a click).
  const [agentOpen, setAgentOpen] = useState(false);
  // The short shortcuts dialog, shown once as onboarding ends.
  const [keysIntro, setKeysIntro] = useState(false);
  // The findings list's filters, newest last, and the Filter menu (F, or a click).
  // Like the search, they are cleared on every summon: the palette opens on
  // everything that needs Maya, and a filter left on could hide a new one.
  const [filters, setFilters] = useState<FilterId[]>([]);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  // The hidden demo panel for simulated connector failures.
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const [showHint, setShowHint] = useState(!hintSeen());
  // "Checked and left alone": closed on every summon. A search that matches a
  // row inside opens it by itself, unless it was closed during that search.
  const [groupOpened, setGroupOpened] = useState(false);
  const [groupClosedInSearch, setGroupClosedInSearch] = useState(false);
  const filterKey = filters.join();
  useEffect(() => setGroupClosedInSearch(false), [query, filterKey]);
  // The timeline's Earlier: closed by default, open by itself while a search matches inside it.
  const [earlierOpened, setEarlierOpened] = useState(false);
  const [earlierClosedInSearch, setEarlierClosedInSearch] = useState(false);
  useEffect(() => setEarlierClosedInSearch(false), [query, filterKey]);
  // Editing belongs to an open finding: leaving it (Esc, the rail, the
  // breadcrumb, the search) ends editing, so the list's keys never get stuck
  // waiting for a draft that isn't on screen.
  useEffect(() => {
    if (view !== "detail") setEditing(false);
  }, [view]);

  const findings = rankedFindings(scan);
  // Every row that matches the search and the filters, then the stops J/K move
  // through (the closed group's rows left out).
  const everyRow = listItems(findings, scan, "");
  const rows = applyFilters(query ? listItems(findings, scan, query) : everyRow, filters);
  const narrowed = !!query.trim() || filters.length > 0;
  const isGroupOpen = groupOpen(rows, narrowed, groupOpened, groupClosedInSearch);
  const items = listStops(rows, isGroupOpen);
  // A finding opened from the timeline can be one the list's search hides (a
  // date can match there but not here): while it is open, find it among every row.
  const hiddenOpen = view === "detail" && !rows.some((i) => i.key === selectedKey) ? everyRow.find((i) => i.key === selectedKey) : undefined;
  const selected: ListItem | undefined = hiddenOpen ?? pickSelected(rows, items, selectedKey, view === "list");
  const selectedItem: Finding | Cleared | undefined =
    selected?.type === "finding" ? selected.finding : selected?.type === "cleared" ? selected.cleared : undefined;
  const stops = selectedItem ? sidebarStops(selectedItem, scan.corpus, panels) : [];
  const stopAt = sideStop < 0 ? firstStop(stops) : Math.min(sideStop, stops.length - 1);
  const selectedStop = stops[stopAt];
  const selectedFinding = selectedItem && "evidence" in selectedItem ? selectedItem : undefined;
  const sidebarShown = selectedFinding?.status === "approved" ? approvedSidebarOpen : sidebarOpen;
  // With the sidebar folded (by hand, or on approving), the keys go to the draft side.
  useEffect(() => {
    if (!sidebarShown && pane === "evidence") setPane("draft");
  }, [sidebarShown, pane]);
  // An approved finding has no draft panel (the Next timeline says what was saved, or the step).
  const hasDraftPanel = !!selectedFinding && findingHasDraftPanel(selectedFinding);
  // Details only exist on a draft that's still shown (not once approved).
  const hasDetails = hasDraftPanel && !!selectedFinding?.draft && usesEmail(selectedFinding, scan);
  // A call, chat or online route has a Have Ready fold instead, on the same Enter key.
  const hasReady = !!selectedFinding && hasHaveReady(selectedFinding, chosenRoute(selectedFinding, scan));
  const readyOpen = hasReady && readyFor === selectedFinding?.id;
  // The same filters narrow the timeline to the dated lines of the findings that pass.
  const entries = filterTimeline(onlyFindings(buildTimeline(scan), passingFindings(everyRow, filters)), query);
  const isEarlierOpen = earlierOpen(entries, narrowed, earlierOpened, earlierClosedInSearch);
  // The stops J/K move through on the timeline (Earlier's header included), and the selected one.
  const timelineItems = timelineStops(entries, isEarlierOpen);
  const timelineStop = pickTimelineStop(entries, timelineItems, timelineKey);

  useEffect(() => {
    activeHotkey()
      .then(setHotkey)
      .catch(() => setHotkey([]))
      .finally(() => setHotkeyReady(true));
    const stopShown = onPaletteShown(() => {
      // During onboarding, everything stays exactly as it was left.
      if (onboardingDone()) {
        const start = getPreferences().startView;
        setQuery("");
        if (start !== "last") {
          setView(start);
          setDetailFrom("list");
        }
        setEditing(false);
        setSheetOpen(false);
        setKeysIntro(false);
        setSettingsTab(undefined);
        setGroupOpened(false);
        setEarlierOpened(false);
        setFilters([]);
      }
      setOpenCount((n) => n + 1);
    });
    // Settings in the menu bar menu. A frame later, because showing the palette
    // redraws it and clears any open dialog first.
    const stopSettings = onOpenSettings(() => {
      requestAnimationFrame(() => setSettingsTab("general"));
    });
    // Dim the palette while another app has focus (it stays on screen during onboarding).
    const stopFocus = onWindowFocus(setFocused);
    return () => {
      stopShown();
      stopSettings();
      stopFocus();
    };
  }, []);

  // Each onboarding step starts from the list, with nothing open on top.
  const lastStep = useRef(onboarding.step);
  useEffect(() => {
    // From step 3, or from step 2's Skip.
    const finished = (lastStep.current === "first-scan" || lastStep.current === "connect") && onboarding.step === "done";
    lastStep.current = onboarding.step;
    setView(startingView());
    setPane("evidence");
    setDetailFrom("list");
    setQuery("");
    setFilters([]);
    setEditing(false);
    setSheetOpen(false);
    setSettingsTab(undefined);
    setTraceOpen(false);
    setAgentOpen(false);
    // Onboarding just ended: the short shortcuts dialog does the teaching, so the list's hint stays away.
    setKeysIntro(finished);
    if (finished) dismissHint();
    else setShowHint(!hintSeen());
    panelRef.current?.focus();
  }, [onboarding.step]);

  // Land focus on the panel (not the input) each time it opens, and tell the
  // menus and sheets where to hand focus back when they close.
  useEffect(() => {
    setPaletteElement(panelRef.current);
    panelRef.current?.focus();
  }, [openCount]);

  function dismissHint() {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // Storage can be unavailable; the hint just shows again next launch.
    }
  }

  function select(key: string | undefined) {
    setSelectedKey(key);
    setSideStop(-1);
    setPanels(DEFAULT_PANELS);
    setPeek(-1);
    setSource(-1);
    setApprovedSidebarOpen(false);
    setReadyFor(undefined);
    // Editing belongs to one open finding: moving to another ends it.
    setEditing(false);
  }

  /**
   * Opens or closes one of the sidebar's panels (Enter on its header, a click,
   * or C for "Checked by code"), and selects its header. A header keeps its
   * place when its own panel opens or closes, as only the lines after it move.
   */
  function togglePanel(id: PanelId) {
    const at = stops.findIndex((s) => "panel" in s && s.panel === id);
    if (at < 0) return;
    setPane("evidence");
    setSideStop(at);
    setPanels((open) => (open.includes(id) ? open.filter((p) => p !== id) : [...open, id]));
  }

  /** Opens a piece of evidence's card (Enter, Space or a click on its line) and selects it; -1 closes it. */
  function peekAt(index: number) {
    if (index >= 0) {
      setPane("evidence");
      const at = stops.findIndex((s) => "evidence" in s && s.evidence === index);
      if (at >= 0) setSideStop(at);
    }
    setPeek(index);
  }

  /** T outside a finding, and the bottom bar's Trace: the whole check's trace, open or closed. */
  function toggleCheckTrace() {
    // Open on a finding's trace: switch to the whole check rather than close.
    if (traceOpen && traceScope === "finding" && view === "detail") return setTraceScope("check");
    setTraceScope("check");
    setTraceOpen((o) => !o);
  }

  /** Slides the sidebar away (keys go to the draft) or brings it back (keys go to the evidence). */
  function toggleSidebar() {
    const open = !sidebarShown;
    if (selectedFinding?.status === "approved") setApprovedSidebarOpen(open);
    else setSidebarOpen(open);
    setPeek(-1);
    setSource(-1);
    setPane(open ? "evidence" : "draft");
  }

  /** Opens the whole source in a sheet (Open source on the card); -1 closes it. */
  function openSource(index: number) {
    setPeek(-1);
    setSource(index);
  }

  function move(by: number) {
    if (!items.length) return;
    const at = Math.max(0, items.findIndex((i) => i.key === selected?.key));
    // Up from the first row goes back to the search bar.
    if (by < 0 && at === 0) return inputRef.current?.focus();
    select(items[Math.min(items.length - 1, Math.max(0, at + by))].key);
    setScrollKey((n) => n + 1);
  }

  /** Opens or closes "Checked and left alone". Closing it with a row inside selected lands on its header. */
  function toggleGroup(next = !isGroupOpen) {
    if (narrowed) setGroupClosedInSearch(!next);
    setGroupOpened(next);
    // The header keeps the selection either way (it may only be standing in for
    // a hidden row, which must not grab the selection back when the rows show).
    if (selected?.type === "group" || (!next && selected && leftAlone(selected))) select(CLEARED_GROUP);
  }

  function open(key: string, from: "list" | "timeline" = "list") {
    if (key === CLEARED_GROUP) return toggleGroup();
    // From the timeline, a finding the list's search hides still opens.
    const item = rows.find((i) => i.key === key) ?? (from === "timeline" ? everyRow.find((i) => i.key === key) : undefined);
    if (!item || item.type === "undecided" || item.type === "group") return;
    // A case opened from the timeline is shown in its group when you come back to the list.
    if (leftAlone(item)) setGroupOpened(true);
    changeView(() => {
      select(key);
      setView("detail");
      setDetailFrom(from);
      setPane("evidence");
      setEditing(false);
    }, "forward");
  }

  function openTimeline() {
    // The search carries over, so "Skylink" then Cmd+Enter shows Skylink's dates.
    changeView(() => {
      setEditing(false);
      setView("timeline");
      // Land on the first thing still to come, just under the "now" marker.
      // During a check the lines are still coming in, so no line is held:
      // the selection follows the first one to come until you move it.
      setTimelineKey(scan.phase === "scanning" ? undefined : entries[nowIndex(entries)]?.key);
    }, "forward");
  }

  function moveInTimeline(by: number) {
    if (!timelineItems.length) return;
    const at = Math.max(0, timelineItems.findIndex((s) => s.key === timelineStop?.key));
    // Up from the first stop goes to the search bar.
    if (by < 0 && at === 0) return inputRef.current?.focus();
    const to = timelineItems[Math.min(timelineItems.length - 1, Math.max(0, at + by))].key;
    if (to === timelineStop?.key) return;
    setTimelineKey(to);
    setScrollKey((n) => n + 1);
  }

  /** Opens or closes the timeline's Earlier. Its header takes the selection, so the highlight stays put while it folds. */
  function toggleEarlier(next = !isEarlierOpen) {
    if (narrowed) setEarlierClosedInSearch(!next);
    setEarlierOpened(next);
    setTimelineKey(EARLIER_GROUP);
  }

  /** Enter (or a click) on a timeline line opens the finding, or the cleared case, it belongs to. On Earlier's header it opens or closes it. */
  function openEntry(key = timelineStop?.key) {
    if (key === EARLIER_GROUP) return toggleEarlier();
    const entry = entries.find((e) => e.key === key);
    const target = entry?.findingId ?? entry?.clearedId;
    if (!entry || !target) return;
    // Coming back, a line from Earlier is still there, selected.
    if (isEarlier(entry)) setEarlierOpened(true);
    setTimelineKey(entry.key);
    open(target, "timeline");
  }

  function back() {
    if (view === "detail") changeView(() => setView(detailFrom), "back");
    else if (view === "timeline") changeView(() => setView("list"), "back");
  }

  /** Back to the list from wherever you are. */
  function goList() {
    if (view === "timeline" || (view === "detail" && detailFrom === "list")) back();
    else if (view === "detail") changeView(() => setView("list"), "back");
  }

  /** Back to the timeline from a finding opened there, else open it (like ⌘↵). */
  function goTimeline() {
    if (view === "detail" && detailFrom === "timeline") back();
    else if (view !== "timeline") openTimeline();
  }

  /** The / key. An open finding has no search in its top bar, so it steps back to its view first. */
  function focusSearch() {
    if (view !== "detail") return inputRef.current?.focus();
    setEditing(false);
    changeView(() => setView(detailFrom), "back", () => inputRef.current?.focus());
  }

  /** V, or the View button: over to the other view (from an open finding, the other one from where it was opened). */
  function toggleView() {
    if ((view === "detail" ? detailFrom : view) === "timeline") goList();
    else goTimeline();
  }

  /**
   * Opens or closes the Filter menu. The list and the timeline can both be
   * filtered. An open finding has no Filter button, so F steps back to the view
   * it was opened from.
   */
  function setFilterMenu(next: boolean) {
    if (next && view === "detail") {
      setEditing(false);
      changeView(() => setView(detailFrom), "back");
    }
    setFilterMenuOpen(next);
  }

  /** The next row to land on once the selected finding moves down the list. */
  function nextKeyAfter(key: string): string | undefined {
    const at = items.findIndex((i) => i.key === key);
    const after = items.slice(at + 1).find((i) => i.type === "finding" && i.finding.status === "new");
    const before = items.slice(0, at).find((i) => i.type === "finding" && i.finding.status === "new");
    return (after ?? before)?.key;
  }

  /**
   * Approve, seal the leak or "not a leak" on one finding: the selected one, or the
   * row a hover button was clicked on. When it is the selected one, the
   * selection steps on to the next finding that still needs Maya.
   */
  function act(kind: RowAction, key = selected?.key) {
    const item = rows.find((i) => i.key === key);
    // Remind me works on approved findings too, and leaves the selection where it is.
    // Approving or "Not a leak" (by a click, mid-edit) ends editing: the draft is now saved or set aside.
    if (kind === "approve" || kind === "dismiss") setEditing(false);
    // Approving folds the sidebar: the evidence has done its job, and the Next timeline is what matters now.
    if (kind === "approve") {
      setApprovedSidebarOpen(false);
      setPeek(-1);
      setSource(-1);
    }
    if (item?.type === "finding" && kind === "remind") {
      // Inside a finding, L (or the notice's Remove reminder) takes a set reminder back off; elsewhere it adds one.
      const id = item.finding.id;
      return void (view === "detail" && scan.reminders[id] ? cancelReminder(id) : remind(id));
    }
    // Seal, once approved: opens Mail (or a call, Calendar), and leaves the selection where it is.
    if (item?.type === "finding" && kind === "seal") {
      const target = item.finding.status === "approved" ? sealTarget(item.finding, scan.corpus, scan) : undefined;
      // A call, chat or online step belongs to a fictional business: show its sample, never dial or open it.
      if (target?.kind === "sample") setSamplePage(routePage(target.route));
      else if (target) void seal(target);
      return;
    }
    if (item?.type !== "finding" || item.finding.status !== "new") return;
    const id = item.finding.id;
    if (kind === "approve" && (item.finding.draft || item.finding.action.kind === "none")) dismissHint();
    if (view === "list" && key === selected?.key) {
      // Step on to the next finding that needs Maya. With the mouse, that is
      // usually the row sliding up under the pointer, so don't scroll.
      select(nextKeyAfter(id) ?? id);
      if (!mouse) setScrollKey((n) => n + 1);
    }
    if (kind === "approve") void approve(id);
    if (kind === "dismiss") dismiss(id);
  }

  /** Keys 1-4, or a click on a route: only until it's approved. */
  function pickRoute(index: number) {
    const route = selectedFinding?.fix?.routes[index];
    if (!selectedFinding || !route || selectedFinding.status !== "new") return;
    chooseRoute(selectedFinding.id, route.id);
    draftRef.current?.scrollTo({ top: 0 });
  }

  /** Y: the chosen route's script, opener, figures or draft, onto the clipboard. */
  async function copyRoute() {
    const route = selectedFinding && chosenRoute(selectedFinding, scan);
    const text = route && routeText(selectedFinding, route);
    if (!text) return notify(copy.toasts.nothingToCopy, "info");
    if (await copyText(text)) notify(copy.toasts.copied, "success");
    else notify(copy.toasts.copyFailed, "error");
  }

  /** O: where to go if the business says no. A real body's form opens; a fictional one shows its sample. */
  function escalate() {
    const body = selectedFinding?.status === "approved" ? selectedFinding.fix?.escalation : undefined;
    if (!body) return;
    if (body.real) void openComplaintBody(body.href);
    else setSamplePage(escalationPage(body));
  }

  /** One place for what each action does, whether it came from a key or a click. */
  function run(command: Command) {
    const inDetail = view === "detail";
    switch (command) {
      case "copy":
        return void copyRoute();
      case "escalate":
        return escalate();
      case "approve":
        return act("approve");
      case "seal":
        return act("seal");
      case "dismiss":
        return act("dismiss");
      case "remind":
        return act("remind");
      case "undo":
        return void undoLast();
      case "done":
        // Done in the heading (while editing): the same as Esc or the Done under the editor.
        if (editing) {
          setEditing(false);
          panelRef.current?.focus();
        }
        return;
      case "trace":
        // The trace icon in a finding's sidebar (or T inside it). Closed, or showing the whole
        // check: show this finding's trace. Already showing it: close the drawer.
        if (traceOpen && traceScope === "finding") setTraceOpen(false);
        else {
          setTraceScope("finding");
          setTraceOpen(true);
        }
        return;
      case "details":
        // Enter or Space on the draft side, or a click on "Drafted email" (also while editing): open or fold To, Subject and Attach.
        if (inDetail && hasDetails) setDetailsOpen((o) => !o);
        else if (inDetail && hasReady) setReadyFor(readyOpen ? undefined : selectedFinding?.id);
        return;
      case "open":
        if (selected) open(selected.key);
        return;
      case "pane":
        // With the sidebar folded there's only the draft side.
        if (inDetail && sidebarShown && selectedItem && "evidence" in selectedItem) {
          setPane((p) => (p === "evidence" ? "draft" : "evidence"));
        }
        return;
      case "toggle":
        // Enter or Space on the selected sidebar line.
        if (!inDetail) return;
        if (!selectedStop) return;
        if ("panel" in selectedStop) togglePanel(selectedStop.panel);
        else peekAt(selectedStop.evidence);
        return;
      case "figures":
        if (inDetail) togglePanel("figures");
        return;
      case "edit": {
        if (selected?.type !== "finding" || !selected.finding.draft) return;
        const { finding } = selected;
        // Only the Email route has a draft to edit, so E moves there first.
        const email = finding.fix?.routes.find((r) => r.kind === "email");
        if (finding.fix && !email) return;
        const startEditing = () => {
          // Maya's own edit wins over a rewrite still on its way.
          cancelRewrite(finding.id);
          if (email) chooseRoute(finding.id, email.id);
          if (!inDetail) open(selected.key);
          setPane("draft");
          setEditing(true);
        };
        if (finding.status === "new") startEditing();
        // Approved: take the approval back first, then edit (Approve again when done).
        else if (finding.status === "approved") void reopen(finding.id).then((done) => done && startEditing());
        return;
      }
      case "rescan":
        // Not on the setup screens: the first check is their own button.
        if (setup) return;
        // Signs the calendar back in first if it needs it.
        void syncEverything();
        return;
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A key press hands control back to the keyboard (a lone modifier doesn't count).
      if (!["Meta", "Shift", "Alt", "Control"].includes(event.key)) setMouse(false);
      const typing = typingIn(event.target);
      const key = event.key;
      const lower = key.toLowerCase();

      // An open menu or sheet has the keys (Esc closes it, and only it).
      if (layerOwns(event)) return;

      // Cmd+Shift+D opens the demo panel (it closes itself the same way).
      if (event.metaKey && event.shiftKey && lower === "d") {
        event.preventDefault();
        setScenariosOpen(true);
        return;
      }

      // Cmd+, opens Settings (the cog), the usual shortcut on a Mac. The setup
      // steps have no cog, and the menu mustn't be waiting open when they end.
      if (event.metaKey && key === ",") {
        event.preventDefault();
        if (!setup) setSettingsOpen((o) => !o);
        return;
      }

      // Onboarding screens: Enter does the screen's action, Cmd+Enter runs the
      // first check. Esc does nothing: the setup can't be skipped, since a
      // check needs connected sources.

      if (setup) {
        // A plain browser has no global hotkey, so the page spots it for step 1.
        if (onboarding.step === "welcome" && !isTauri() && isHotkey(event, hotkey)) {
          event.preventDefault();
          proveSummon();
          return;
        }
        // Step 3: T opens or closes "Agent working".
        if (onboarding.step === "first-scan" && lower === "t" && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          setAgentOpen((o) => !o);
          return;
        }
        // Skip, at the top right. Step 1's is for when another app holds the summon key.
        if (key === "Enter" && event.metaKey && event.shiftKey) {
          event.preventDefault();
          if (onboarding.step === "welcome" && welcomeLocked(onboarding, hotkey, hotkeyReady)) nextSetupStep();
          else if (onboarding.step === "connect") skipConnect();
          return;
        }
        if (key === "Enter" && event.metaKey && onboarding.step === "welcome") {
          event.preventDefault();
          return;
        }
        // Step 3, if the check didn't finish: Cmd+Enter carries on without it.
        if (key === "Enter" && event.metaKey && onboarding.step === "first-scan") {
          event.preventDefault();
          if (scan.phase === "error") finishOnboarding();
          return;
        }
        if (key === "Enter" && event.metaKey && onboarding.step === "connect") {
          // Run my first check (once a source is connected).
          event.preventDefault();
          runFirstCheck();
          return;
        }
        if (key === "Escape") {
          event.preventDefault();
        } else if (key === "Enter" && !event.metaKey) {
          event.preventDefault();
          // Step 1 waits until the summon key has been pressed.
          if (!(onboarding.step === "welcome" && welcomeLocked(onboarding, hotkey, hotkeyReady))) nextSetupStep();
        }
        return;
      }

      if (key === "Escape") {
        event.preventDefault();
        // Esc steps back one level at a time, and closes the palette last.
        if (editing) {
          setEditing(false);
          panelRef.current?.focus();
        } else if (typing && query) setQuery("");
        else if (typing) panelRef.current?.focus();
        // An open trace drawer is the nearest level, in every view: it closes first.
        else if (traceOpen) setTraceOpen(false);
        else if (view === "detail") back();
        else if (view === "timeline" && query) setQuery("");
        else if (view === "timeline" && filters.length) setFilters([]);
        else if (view === "timeline") back();
        else if (query) setQuery("");
        else if (filters.length) setFilters([]);
        else hidePalette();
        return;
      }

      if (editing) {
        // While a draft is being edited, the keys belong to the editor: letters
        // type, ⌘Z undoes typing. Only these do something else.
        if (key === "Enter" && event.metaKey) {
          // ⌘↵: Done, like Esc.
          event.preventDefault();
          setEditing(false);
          panelRef.current?.focus();
        } else if (key === "Backspace" && event.metaKey && event.shiftKey) {
          // ⌘⇧⌫: Revert (the button's key): the agent's draft back, and editing done, in one step.
          event.preventDefault();
          if (selectedFinding) resetEdit(selectedFinding.id);
          setEditing(false);
          panelRef.current?.focus();
        } else if (key === "Tab") {
          // Tab would move focus out of the editor and strand the keys: it stays put.
          event.preventDefault();
        } else if (!typing) {
          // Focus wandered off the editor (a menu or sheet opened and closed, or a
          // click elsewhere): put it back, so this key and the next land in the draft.
          panelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
        }
        return;
      }

      // Cmd+Enter opens the timeline from anywhere, and closes it again.
      if (key === "Enter" && event.metaKey) {
        event.preventDefault();
        if (view === "timeline") back();
        else openTimeline();
        return;
      }

      if (typing) {
        // In search: Enter or Down goes to the results.
        if (key === "Enter" || key === "ArrowDown") {
          event.preventDefault();
          panelRef.current?.focus();
          if (view === "timeline") setTimelineKey((entries[nowIndex(entries)] ?? timelineItems.find((s) => !isEarlierStop(s)) ?? timelineItems[0])?.key);
          // The first matching row, not the "Checked and left alone" header in front of it.
          else select((items.find((i) => i.type !== "group") ?? items[0])?.key);
          setScrollKey((n) => n + 1);
        }
        return;
      }

      if (event.metaKey && lower === "z") {
        event.preventDefault();
        run("undo");
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // 1, 2 and 3 answer "why isn't it a leak?" while the toast is asking, ahead of the route switcher.
      if (scan.toast?.ask && /^[123]$/.test(key)) {
        event.preventDefault();
        rememberWhy(scan.toast.ask, RULE_REASONS[Number(key) - 1]);
        return;
      }

      // Settings on its Connectors or Models tab, from any view.
      if (lower === "n" || lower === "m") {
        event.preventDefault();
        setSettingsTab(lower === "n" ? "connectors" : "models");
        return;
      }

      const inDetail = view === "detail";
      const down = lower === "j" || key === "ArrowDown";
      const up = lower === "k" || key === "ArrowUp";

      if (view === "timeline") {
        // Only moving, opening and the "always" keys work here: A/S/D/E act
        // on findings, so they wait until one is open.
        if (down || up) {
          event.preventDefault();
          moveInTimeline(down ? 1 : -1);
        } else if (key === "Enter") {
          event.preventDefault();
          openEntry();
        } else if (key === " " && isEarlierStop(timelineStop)) {
          // Space opens and closes Earlier, like Enter.
          event.preventDefault();
          toggleEarlier();
        } else if (key === "/") {
          event.preventDefault();
          inputRef.current?.focus();
        } else if (key === "?") {
          event.preventDefault();
          setSheetOpen(true);
        } else if (lower === "r") {
          event.preventDefault();
          run("rescan");
        } else if (lower === "t") {
          event.preventDefault();
          toggleCheckTrace();
        } else if (lower === "v") {
          event.preventDefault();
          toggleView();
        } else if (lower === "f") {
          event.preventDefault();
          setFilterMenu(true);
        } else if (key === "Backspace" && filters.length) {
          // Takes the newest filter off, like on the list.
          event.preventDefault();
          setFilters((f) => f.slice(0, -1));
        }
        return;
      }

      if (down || up) {
        event.preventDefault();
        if (!inDetail) move(down ? 1 : -1);
        else if (pane === "evidence") {
          setSideStop(Math.min(stops.length - 1, Math.max(0, stopAt + (down ? 1 : -1))));
        }
        else draftRef.current?.scrollBy({ top: down ? 64 : -64 });
        return;
      }

      // ⇧1 and ⇧2: Firmer and Shorter. Matched on the physical key, because Shift+1 types "!".
      if (inDetail && event.shiftKey && VERB_BY_CODE[event.code]) {
        event.preventDefault();
        if (selectedFinding) pressVerb(selectedFinding.id, VERB_BY_CODE[event.code]);
        return;
      }
      // On a finding marked "Not a leak", the numbers say why (or change the answer).
      if (inDetail && selectedFinding?.status === "dismissed" && /^[123]$/.test(key)) {
        event.preventDefault();
        rememberWhy(selectedFinding.id, RULE_REASONS[Number(key) - 1]);
        return;
      }
      if (inDetail && !event.shiftKey && /^[1-4]$/.test(key)) {
        event.preventDefault();
        pickRoute(Number(key) - 1);
        return;
      }
      if (inDetail && lower === "y") {
        event.preventDefault();
        run("copy");
        return;
      }
      if (inDetail && lower === "o") {
        event.preventDefault();
        run("escalate");
        return;
      }

      switch (key) {
        case "/":
          event.preventDefault();
          focusSearch();
          return;
        case "?":
          event.preventDefault();
          setSheetOpen(true);
          return;
        case "Enter":
          event.preventDefault();
          if (!inDetail) run("open");
          else if (pane === "evidence") run("toggle");
          else run("details");
          return;
        case " ":
          // Space opens and closes "Checked and left alone" and the sidebar's lines, like Enter.
          if (!inDetail && selected?.type === "group") {
            event.preventDefault();
            toggleGroup();
          } else if (inDetail) {
            event.preventDefault();
            run(pane === "evidence" ? "toggle" : "details");
          }
          return;
        case "Tab":
          if (inDetail) {
            event.preventDefault();
            run("pane");
          }
          return;
        case "Backspace":
          // Takes the newest filter off (the chips under the heading).
          if (!inDetail && filters.length) {
            event.preventDefault();
            setFilters((f) => f.slice(0, -1));
          }
          return;
      }

      const byLetter: Record<string, Command> = { a: "approve", s: "seal", d: "dismiss", e: "edit", l: "remind", r: "rescan" };
      if (byLetter[lower]) {
        event.preventDefault();
        run(byLetter[lower]);
      } else if (lower === "c" && inDetail) {
        event.preventDefault();
        if (!sidebarShown) toggleSidebar();
        run("figures");
      } else if (key === "]" && inDetail) {
        event.preventDefault();
        toggleSidebar();
      } else if (lower === "t") {
        event.preventDefault();
        // Inside a finding, T is the trace icon: this finding's trace, a second press closes it.
        // Elsewhere (and on a case left alone) it opens or closes the whole check's.
        if (inDetail && selectedFinding) run("trace");
        else toggleCheckTrace();
      } else if (lower === "v") {
        event.preventDefault();
        toggleView();
      } else if (lower === "f") {
        event.preventDefault();
        setFilterMenu(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // What fills the middle of the palette.
  const nothingYet = items.length === 0 && !query && !filters.length;
  let main: React.ReactNode;
  if (setup) {
    main = <SetupScreen onboarding={onboarding} hotkey={hotkey} hotkeyReady={hotkeyReady} onHotkey={setHotkey} mouse={mouse} agentOpen={agentOpen} onAgentOpen={setAgentOpen} />;
  } else if (view === "detail" && selectedItem) {
    main = (
      <FindingDetail
        item={selectedItem}
        corpus={scan.corpus}
        edited={"evidence" in selectedItem && isEdited(selectedItem.id, scan)}
        pane={pane}
        stops={stops}
        stop={stopAt}
        panels={panels}
        peek={peek}
        source={source}
        editing={editing}
        detailsOpen={detailsOpen}
        readyOpen={readyOpen}
        onToggleReady={() => run("details")}
        onToggleDetails={() => run("details")}
        mouse={mouse}
        onStopEditing={() => {
          setEditing(false);
          panelRef.current?.focus();
        }}
        onFocusDraft={() => setPane("draft")}
        onCommand={run}
        onPickRoute={pickRoute}
        onVerb={(verb) => selectedFinding && pressVerb(selectedFinding.id, verb)}
        onSample={(route) => setSamplePage(routePage(route))}
        sidebarOpen={sidebarShown}
        onToggleSidebar={toggleSidebar}
        traceOpen={traceOpen}
        tracePressed={traceOpen && traceScope === "finding"}
        onTogglePanel={togglePanel}
        onPeek={peekAt}
        onOpenSource={openSource}
        draftRef={draftRef}
        scanning={scan.phase === "scanning"}
      />
    );
  } else if (view === "timeline") {
    main = (
      <Timeline
        entries={entries}
        selectedKey={timelineStop?.key}
        scrollKey={scrollKey}
        onHover={(key) => {
          setMouse(true);
          if (key !== timelineStop?.key) setTimelineKey(key);
        }}
        onOpen={openEntry}
        scan={scan}
        query={query}
        earlierOpen={isEarlierOpen}
        onToggleEarlier={toggleEarlier}
        mouse={mouse}
        filters={filters}
        onRemoveFilter={(id) => setFilters((f) => f.filter((x) => x !== id))}
        onClearFilters={() => setFilters([])}
      />
    );
  } else if (nothingYet && scan.phase === "error") main = <ScanError message={scan.error ?? copy.shared.somethingWentWrong} />;
  else if (nothingYet && scan.phase === "done") main = <AllClear checked={0} />;
  // One component for all three, so the same seal stays on screen when a check starts.
  else if (nothingYet && (scan.phase === "idle" || scan.phase === "scanning"))
    main = (
      <SealState
        kind={scan.phase === "scanning" ? "checking" : nothingConnected() ? "no-sources" : "not-checked"}
        onConnect={() => setSettingsTab("connectors")}
        onRun={() => run("rescan")}
      />
    );
  // While a check runs the list stays in place, like the timeline: the bottom
  // bar shows the loading bar and the rows fill in as each one is checked.
  else
    main = (
      <FindingsList
        items={rows}
        allFindings={findings}
        selectedKey={selected?.key}
        scrollKey={scrollKey}
        mouse={mouse}
        onHover={(key) => {
          setMouse(true);
          if (key !== selected?.key) select(key);
        }}
        onOpen={open}
        onAct={act}
        scan={scan}
        showHint={showHint}
        onDismissHint={dismissHint}
        query={query}
        open={isGroupOpen}
        onToggleGroup={toggleGroup}
        filters={filters}
        onRemoveFilter={(id) => setFilters((f) => f.filter((x) => x !== id))}
        onClearFilters={() => setFilters([])}
      />
    );

  const inDetail = view === "detail" && !!selectedItem;
  // The breadcrumb: the view you're in, then an open finding's business. While
  // a finding is open, the view's name (and the app's) link back to that view.
  const shownView = inDetail ? detailFrom : view === "timeline" ? "timeline" : "list";
  const homeName = shownView === "timeline" ? copy.controls.timeline : copy.controls.list;
  const crumbs: Crumb[] = inDetail ? [{ label: homeName, onClick: back }, { label: selectedItem.merchant }] : [{ label: homeName }];
  const actionItem = selected?.type === "undecided" ? { undecided: selected.error } : selectedItem;
  // One search for both views, in the top bar. It searches the view you're
  // in (an open finding: the one it was opened from).
  const searchTimeline = shownView === "timeline";
  const search = (
    <SearchField
      ref={inputRef}
      value={query}
      onChange={setQuery}
      label={searchTimeline ? copy.search.timelineLabel : copy.search.findingsLabel}
      placeholder={searchTimeline ? copy.search.timelinePlaceholder : copy.search.findingsPlaceholder}
      mouse={mouse}
    />
  );

  return (
    <PaletteShell
      key={openCount}
      ref={panelRef}
      tabIndex={-1}
      className={`palette-enter ${focused ? "" : "palette-inactive"}`}
      // Any real pointer movement switches to mouse mode (click hints, no key
      // caps); any key press switches back. A still pointer under scrolling
      // content can fire a move event with no movement, so that doesn't count.
      onMouseMove={(e) => {
        if (e.movementX !== 0 || e.movementY !== 0) setMouse(true);
      }}
      header={
        setup ? (
          <Header bare controls={<SetupSkip onboarding={onboarding} hotkey={hotkey} hotkeyReady={hotkeyReady} mouse={mouse} />} />
        ) : (
          <Header
            crumbs={crumbs}
            onHome={inDetail ? { label: homeName, run: back } : undefined}
            // An open finding swaps Search, Filter and View for its own actions.
            search={inDetail ? undefined : search}
            controls={
              inDetail ? (
                selectedFinding && <FindingActions actions={findingActions(selectedFinding, scan, editing)} mouse={mouse} sidebarOpen={sidebarShown} onCommand={run} />
              ) : (
                <>
                  <FilterButton
                    options={filterOptions(everyRow, filters)}
                    active={filters}
                    onToggle={(id) => setFilters((f) => toggleFilter(f, id))}
                    onClear={() => setFilters([])}
                    open={filterMenuOpen}
                    onOpenChange={setFilterMenu}
                    onSettings={() => setSettingsTab("filters")}
                    mouse={mouse}
                  />
                  <ViewButton current={shownView} onToggle={toggleView} />
                </>
              )
            }
          />
        )
      }
      replay={replayNote(scan)}
      // An open finding's actions sit above its draft; how to move around goes in
      // the footer, like the list's and the timeline's. The setup steps have no footer.

      footer={
        setup ? undefined : (
        <Footer
          onScenarios={() => setScenariosOpen(true)}
          sync={<SyncButton onSync={() => run("rescan")} />}
          // The whole check's trace (on a finding's trace, it switches to it).
          trace={<TraceButton pressed={traceOpen} onClick={toggleCheckTrace} />}
          settings={
            <SettingsButton
              hotkey={hotkey}
              mouse={mouse}
              onKeys={() => setSheetOpen(true)}
              onConnectors={() => setSettingsTab("connectors")}
              onModels={() => setSettingsTab("models")}
              onAllSettings={() => setSettingsTab("general")}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
            />
          }
          right={
            inDetail && editing ? undefined : inDetail ? (
              // While editing there are no move hints: those keys type into the draft (Revert and Done carry theirs).
              <DetailHint
                pane={pane}
                stop={selectedStop}
                panelOpen={!!selectedStop && "panel" in selectedStop && panels.includes(selectedStop.panel)}
                twoPanes={!!selectedItem && "evidence" in selectedItem && sidebarShown}
                detailsOpen={hasDetails ? detailsOpen : hasReady ? readyOpen : undefined}
                canSayWhy={selectedFinding?.status === "dismissed"}
                mouse={mouse}
                onToggle={() => run(pane === "evidence" ? "toggle" : "details")}
                onPane={() => run("pane")}
              />
            ) : view === "timeline" ? (
              <TimelineHint stop={timelineStop} mouse={mouse} onOpen={() => openEntry()} />
            ) : view === "list" && !nothingYet ? (
              <ListHint
                item={selected?.type === "group" ? { group: selected.open } : actionItem}
                mouse={mouse}
                onOpen={() => run("open")}
                onRescan={() => run("rescan")}
              />
            ) : undefined
          }
        />
        )
      }
      overlay={
        <>
          <Toast />
          <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
          <SamplePageSheet page={samplePage} onClose={() => setSamplePage(undefined)} />
          <ShortcutIntro
            open={keysIntro}
            mouse={mouse}
            onClose={() => setKeysIntro(false)}
            onAll={() => {
              setKeysIntro(false);
              setSheetOpen(true);
            }}
          />
          <SettingsDialog
            tab={settingsTab}
            onTab={setSettingsTab}
            onClose={() => setSettingsTab(undefined)}
            mouse={mouse}
            hotkey={hotkey}
            onHotkey={setHotkey}
            filterOptions={filterOptions(everyRow, filters)}
            activeFilters={filters}
            onToggleFilter={(id) => setFilters((f) => toggleFilter(f, id))}
            onClearFilters={() => setFilters([])}
          />
          <ScenariosSheet
            open={scenariosOpen}
            mouse={mouse}
            onClose={() => setScenariosOpen(false)}
            onReset={() => void resetOnboarding().then((done) => done && setScenariosOpen(false))}
            onCheck={() => {
              setScenariosOpen(false);
              run("rescan");
            }}
          />
        </>
      }
    >
      {/* One wrapper per view, so changing view crossfades (changeView in src/ui/motion.ts). */}
      <div key={setup ? "setup" : view} className={`view-area flex min-h-0 flex-1 flex-col ${nativeViewTransitions() ? "" : "view-in"}`}>
        {main}
      </div>
      {traceOpen && (
        <TraceDrawer
          lines={scan.trace}
          // Only inside an open finding; on the list or the timeline it is the whole check's.
          finding={view === "detail" && selectedFinding ? { merchant: selectedFinding.merchant, lines: findingTrace(selectedFinding) } : undefined}
          scope={traceScope}
          onScope={setTraceScope}
          mouse={mouse}
          editing={editing}
          onClose={() => setTraceOpen(false)}
        />
      )}
    </PaletteShell>
  );
}
