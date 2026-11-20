import { useEffect, useRef, useState } from "react";
import type { Cleared, Finding } from "../../agent/pipeline";
import { reconnectCalendar, useLive } from "../../connectors/live";
import { activeHotkey, hidePalette, onPaletteShown, onWindowFocus } from "../../lib/native";
import {
  runFirstCheck,
  onboardingDone,
  isSetupScreen,
  next as nextSetupStep,
  resetOnboarding,
  useOnboarding,
} from "../../lib/onboarding";
import { ListHint, TimelineHint } from "./FooterHint";
import { PrimaryButton, SetupScreen } from "../Onboarding/SetupScreen";
import { approve, dismiss, rankedFindings, snooze, startScan, undoLast, useScan } from "../../lib/scan-store";
import { ActionBar, FindingDetail, evidenceFor, type Command, type Pane } from "./FindingDetail";
import {
  AllClear,
  CLEARED_GROUP,
  FindingsList,
  NotChecked,
  Scanning,
  ScanError,
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
import { applyFilters, filterOptions, toggleFilter, type FilterId } from "../filters";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { PaletteShell } from "./PaletteShell";
import { copy } from "../../copy";
import { Rail, SettingsButton } from "./Rail";
import { ShortcutSheet } from "./ShortcutSheet";
import { ScenariosSheet } from "./ScenariosSheet";
import { layerOwns, setPaletteElement } from "../layers";
import { Toast } from "./Toast";
import { TraceDrawer } from "./Trace";
import { replayNote } from "../replay";
import { Timeline } from "./Timeline";
import { buildTimeline, filterTimeline, nowIndex } from "../timeline";
import { changeView, nativeViewTransitions } from "../motion";

// The summoned palette. It fills the native window; the window itself is
// transparent with a macOS blur behind, so this panel adds the warm tint.
//
// It owns every key, in one handler, so nothing else can fight over them:
//   list    J/K move, Enter opens, A approve, E edit, S snooze, D not a leak,
//           Enter or Space on "Checked and left alone" opens or closes it
//   detail  J/K move through evidence (or scroll the draft), Tab switch pane
//   timeline  J/K move through time, Enter opens the line's finding
//   list    F filter menu, Backspace removes the newest filter (Esc clears them all, after the search)
//   always  Cmd+Enter timeline, V view menu, Cmd+Z undo, / search, T trace, R check again, ? keys, Esc back
//   hidden  Cmd+Shift+D demo panel (its own keys live in ScenariosSheet)
//   setup   (first-run onboarding screens) Enter does the screen's action, Cmd+Enter runs the first check
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

export function Palette() {
  const scan = useScan();
  const live = useLive();
  const onboarding = useOnboarding();
  const setup = isSetupScreen(onboarding.step);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  // Bumped on every summon so React remounts the panel and the entrance
  // animation plays again. Findings and decisions live in the store, so they stay.
  const [openCount, setOpenCount] = useState(0);
  const [hotkey, setHotkey] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>();
  // Bumped when the keyboard moves the selection, so only that scrolls the list.
  const [scrollKey, setScrollKey] = useState(0);
  // Which hand is driving: moving the mouse moves the selection and shows the
  // row's click buttons; any key press hides them until the mouse moves again.
  const [mouse, setMouse] = useState(false);
  // False while another app has focus: the palette dims, like an inactive window.
  const [focused, setFocused] = useState(true);
  const [view, setView] = useState<"list" | "detail" | "timeline">("list");
  // Where Esc goes back to from an open finding.
  const [detailFrom, setDetailFrom] = useState<"list" | "timeline">("list");
  const [timelineKey, setTimelineKey] = useState<string>();
  const [pane, setPane] = useState<Pane>("evidence");
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The settings menu (the cog, or ⌘,).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The rail's View menu (V, or a click): Findings or Timeline.
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  // The findings list's filters, newest last, and the rail's Filter menu (F, or a click).
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

  const findings = rankedFindings(scan);
  // Every row that matches the search and the filters, then the stops J/K move
  // through (the closed group's rows left out).
  const everyRow = listItems(findings, scan, "");
  const rows = applyFilters(query ? listItems(findings, scan, query) : everyRow, filters);
  const narrowed = !!query.trim() || filters.length > 0;
  const isGroupOpen = groupOpen(rows, narrowed, groupOpened, groupClosedInSearch);
  const items = listStops(rows, isGroupOpen);
  const selected: ListItem | undefined = pickSelected(rows, items, selectedKey, view === "list");
  const selectedItem: Finding | Cleared | undefined =
    selected?.type === "finding" ? selected.finding : selected?.type === "cleared" ? selected.cleared : undefined;
  const evidenceCount = selectedItem ? evidenceFor(selectedItem, scan.corpus).length : 0;
  const entries = filterTimeline(buildTimeline(scan), query);
  const selectedEntry = entries.find((e) => e.key === timelineKey) ?? entries[nowIndex(entries)] ?? entries[entries.length - 1];

  useEffect(() => {
    activeHotkey().then(setHotkey).catch(() => setHotkey([]));
    const stopShown = onPaletteShown(() => {
      // During onboarding, everything stays exactly as it was left.
      if (onboardingDone()) {
        setQuery("");
        setView("list");
        setDetailFrom("list");
        setEditing(false);
        setSheetOpen(false);
        setGroupOpened(false);
        setFilters([]);
      }
      setOpenCount((n) => n + 1);
    });
    // Dim the palette while another app has focus (it stays on screen during onboarding).
    const stopFocus = onWindowFocus(setFocused);
    return () => {
      stopShown();
      stopFocus();
    };
  }, []);

  // Each onboarding step starts from the list, with nothing open on top.
  useEffect(() => {
    setView("list");
    setPane("evidence");
    setDetailFrom("list");
    setQuery("");
    setFilters([]);
    setEditing(false);
    setSheetOpen(false);
    setTraceOpen(false);
    // Starting onboarding again clears the first-run hint, so it shows again after the first check.
    setShowHint(!hintSeen());
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
    setEvidenceIndex(0);
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
    const item = rows.find((i) => i.key === key);
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
    if (!entries.length) return;
    const at = Math.max(0, entries.findIndex((e) => e.key === selectedEntry?.key));
    // Up from the first line goes to the search bar.
    if (by < 0 && at === 0) return inputRef.current?.focus();
    const to = entries[Math.min(entries.length - 1, Math.max(0, at + by))].key;
    if (to === selectedEntry?.key) return;
    setTimelineKey(to);
    setScrollKey((n) => n + 1);
  }

  /** Enter (or a click) on a timeline line opens the finding, or the cleared case, it belongs to. */
  function openEntry(key = selectedEntry?.key) {
    const entry = entries.find((e) => e.key === key);
    const target = entry?.findingId ?? entry?.clearedId;
    if (!entry || !target) return;
    setTimelineKey(entry.key);
    open(target, "timeline");
  }

  function back() {
    if (view === "detail") changeView(() => setView(detailFrom), "back");
    else if (view === "timeline") changeView(() => setView("list"), "back");
  }

  /** The rail's Findings icon: back to the list from wherever you are. */
  function goList() {
    if (view === "timeline" || (view === "detail" && detailFrom === "list")) back();
    else if (view === "detail") changeView(() => setView("list"), "back");
  }

  /** The rail's Timeline icon: back to it from a finding opened there, else open it (like ⌘↵). */
  function goTimeline() {
    if (view === "detail" && detailFrom === "timeline") back();
    else if (view !== "timeline") openTimeline();
  }

  /**
   * Opens or closes the Filter menu. Filters are for the findings list, so
   * from the timeline or an open finding it goes back to the list first.
   */
  function setFilterMenu(next: boolean) {
    if (next && view !== "list") {
      setEditing(false);
      changeView(() => setView("list"), "back");
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
   * Approve, snooze or "not a leak" on one finding: the selected one, or the
   * row a hover button was clicked on. When it is the selected one, the
   * selection steps on to the next finding that still needs Maya.
   */
  function act(kind: RowAction, key = selected?.key) {
    const item = rows.find((i) => i.key === key);
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
    if (kind === "snooze") snooze(id);
    if (kind === "dismiss") dismiss(id);
  }

  /** One place for what each action does, whether it came from a key or a click. */
  function run(command: Command) {
    const inDetail = view === "detail";
    switch (command) {
      case "approve":
        return act("approve");
      case "snooze":
        return act("snooze");
      case "dismiss":
        return act("dismiss");
      case "undo":
        return void undoLast();
      case "open":
        if (selected) open(selected.key);
        return;
      case "pane":
        if (inDetail && selectedItem && "evidence" in selectedItem) {
          setPane((p) => (p === "evidence" ? "draft" : "evidence"));
        }
        return;
      case "edit":
        if (selected?.type === "finding" && selected.finding.draft && selected.finding.status === "new") {
          if (!inDetail) open(selected.key);
          setPane("draft");
          setEditing(true);
        }
        return;
      case "rescan":
        // Not on the setup screens: the first check is their own button.
        if (setup) return;
        // Check again, signing the calendar back in first if it needs it.
        if (live.statuses.calendar?.state === "needs_reconnect") void reconnectCalendar().then(() => startScan());
        else void startScan();
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

      // Cmd+, opens Settings (the cog), the usual shortcut on a Mac.
      if (event.metaKey && key === ",") {
        event.preventDefault();
        setSettingsOpen((o) => !o);
        return;
      }

      // Onboarding screens: Enter does the screen's action, Cmd+Enter runs the
      // first check. Esc does nothing: the setup can't be skipped, since a
      // check needs connected sources.

      if (setup) {
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
          nextSetupStep();
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
        else if (view === "detail") back();
        else if (view === "timeline" && query) setQuery("");
        else if (view === "timeline") back();
        else if (traceOpen) setTraceOpen(false);
        else if (query) setQuery("");
        else if (filters.length) setFilters([]);
        else hidePalette();
        return;
      }

      if (editing) {
        if (key === "Enter" && event.metaKey) {
          event.preventDefault();
          setEditing(false);
          panelRef.current?.focus();
        }
        return; // Everything else is typing in the draft.
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
          if (view === "timeline") setTimelineKey((entries[nowIndex(entries)] ?? entries[0])?.key);
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
          setTraceOpen((o) => !o);
        } else if (lower === "v") {
          event.preventDefault();
          setViewMenuOpen(true);
        } else if (lower === "f") {
          event.preventDefault();
          setFilterMenu(true);
        }
        return;
      }

      if (down || up) {
        event.preventDefault();
        if (!inDetail) move(down ? 1 : -1);
        else if (pane === "evidence") {
          setEvidenceIndex((i) => Math.min(evidenceCount - 1, Math.max(0, i + (down ? 1 : -1))));
        }
        else draftRef.current?.scrollBy({ top: down ? 64 : -64 });
        return;
      }

      switch (key) {
        case "/":
          event.preventDefault();
          // From an open finding, the field's onFocus goes back to the list it came from.
          inputRef.current?.focus();
          return;
        case "?":
          event.preventDefault();
          setSheetOpen(true);
          return;
        case "Enter":
          event.preventDefault();
          if (!inDetail) run("open");
          return;
        case " ":
          // Space opens and closes "Checked and left alone", like Enter.
          if (!inDetail && selected?.type === "group") {
            event.preventDefault();
            toggleGroup();
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

      const byLetter: Record<string, Command> = { a: "approve", s: "snooze", d: "dismiss", e: "edit", r: "rescan" };
      if (byLetter[lower]) {
        event.preventDefault();
        run(byLetter[lower]);
      } else if (lower === "t") {
        event.preventDefault();
        setTraceOpen((o) => !o);
      } else if (lower === "v") {
        event.preventDefault();
        setViewMenuOpen(true);
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
    main = <SetupScreen onboarding={onboarding} hotkey={hotkey} onHotkey={setHotkey} mouse={mouse} />;
  } else if (view === "detail" && selectedItem) {
    main = (
      <FindingDetail
        item={selectedItem}
        corpus={scan.corpus}
        edited={"evidence" in selectedItem && scan.edits[selectedItem.id] !== undefined}
        pane={pane}
        evidenceIndex={evidenceIndex}
        editing={editing}
        onStopEditing={() => {
          setEditing(false);
          panelRef.current?.focus();
        }}
        onFocusDraft={() => setPane("draft")}
        onSelectEvidence={(i) => {
          setEvidenceIndex(i);
          setPane("evidence");
        }}
        draftRef={draftRef}
        scanning={scan.phase === "scanning"}
      />
    );
  } else if (view === "timeline") {
    main = (
      <Timeline
        entries={entries}
        selectedKey={selectedEntry?.key}
        scrollKey={scrollKey}
        onHover={(key) => {
          setMouse(true);
          if (key !== selectedEntry?.key) setTimelineKey(key);
        }}
        onOpen={openEntry}
        scan={scan}
        query={query}
      />
    );
  } else if (nothingYet && scan.phase === "scanning") main = <Scanning scan={scan} />;
  else if (nothingYet && scan.phase === "error") main = <ScanError message={scan.error ?? copy.shared.somethingWentWrong} />;
  else if (nothingYet && scan.phase === "done") main = <AllClear checked={0} />;
  else if (nothingYet) main = <NotChecked />;
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

  // A line under the top bar during the first check.
  const banner =
    onboarding.step === "first-scan" && scan.phase === "scanning" ? (
      <>
        <span className="font-semibold text-text">{copy.onboarding.firstCheckLead}</span> {copy.onboarding.firstCheckBody}
      </>
    ) : undefined;

  const inDetail = view === "detail" && !!selectedItem;
  // The breadcrumb: the view you're in, then an open finding's business.
  const shownView = inDetail ? detailFrom : view === "timeline" ? "timeline" : "list";
  const crumbs = [shownView === "timeline" ? copy.rail.timeline : copy.rail.list, ...(inDetail ? [selectedItem.merchant] : [])];
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
      onFocus={() => {
        // Searching from an open finding (/ or a click) goes back to its list
        // or timeline first, so the matches are in view.
        if (view !== "detail") return;
        setEditing(false);
        back();
      }}
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
      header={<Header crumbs={setup ? [] : crumbs} search={setup ? undefined : search} />}
      rail={
        setup ? undefined : (
          <Rail
            view={view === "detail" && !selectedItem ? "list" : view}
            from={detailFrom}
            traceOpen={traceOpen}
            onList={goList}
            onTimeline={goTimeline}
            onTrace={() => setTraceOpen((o) => !o)}
            viewOpen={viewMenuOpen}
            onViewOpenChange={setViewMenuOpen}
            mouse={mouse}
            filter={
              <FilterButton
                options={filterOptions(everyRow, filters)}
                active={filters}
                onToggle={(id) => setFilters((f) => toggleFilter(f, id))}
                onClear={() => setFilters([])}
                open={filterMenuOpen}
                onOpenChange={setFilterMenu}
                mouse={mouse}
                away={shownView === "timeline"}
              />
            }
            settings={
              <SettingsButton
                hotkey={hotkey}
                mouse={mouse}
                onKeys={() => setSheetOpen(true)}
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
              />
            }
          />
        )
      }
      replay={replayNote(scan)}
      banner={banner}
      // Only an open finding has a bar of its own (its actions). The list and
      // timeline put their hint in the footer, and setup steps their action.
      bar={!setup && inDetail ? <ActionBar item={actionItem} detail pane={pane} mouse={mouse} onCommand={run} /> : undefined}
      footer={
        <Footer
          onScenarios={() => setScenariosOpen(true)}
          right={
            setup ? (
              <PrimaryButton onboarding={onboarding} mouse={mouse} />
            ) : view === "timeline" ? (
              <TimelineHint entry={selectedEntry} mouse={mouse} onOpen={() => openEntry()} />
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
      }
      overlay={
        <>
          <Toast />
          <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
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
      {traceOpen && <TraceDrawer lines={scan.trace} onClose={() => setTraceOpen(false)} />}
    </PaletteShell>
  );
}
