import { useEffect, useRef, useState } from "react";
import type { Cleared, Finding } from "../../agent/pipeline";
import { reconnectCalendar, toggleScenario, useLive } from "../../connectors/live";
import { activeHotkey, hidePalette, onPaletteShown } from "../../lib/native";
import { approve, dismiss, rankedFindings, snooze, startScan, undoLast, useScan } from "../../lib/scan-store";
import { ActionBar, FindingDetail, evidenceFor, type Command, type Pane } from "./FindingDetail";
import { AllClear, FindingsList, NotChecked, Scanning, ScanError, listItems, type ListItem, type RowAction } from "./FindingsList";
import { CommandBar } from "./CommandBar";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { SwitchButton } from "../Kbd";
import { BackIcon, ListIcon, TimelineIcon } from "./ViewHeading";
import { ShortcutSheet } from "./ShortcutSheet";
import { SCENARIOS, ScenariosSheet } from "./ScenariosSheet";
import { Toast } from "./Toast";
import { TraceDrawer } from "./Trace";
import { Timeline, TimelineBar } from "./Timeline";
import { buildTimeline, filterTimeline, nowIndex } from "../timeline";

// The summoned palette. It fills the native window; the window itself is
// transparent with a macOS blur behind, so this panel adds the warm tint.
//
// It owns every key, in one handler, so nothing else can fight over them:
//   list    J/K move, Enter opens, A approve, E edit, S snooze, D not a leak
//   detail  J/K move through evidence (or scroll the draft), Tab switch pane
//   timeline  J/K move through time, Enter opens the line's finding
//   always  Cmd+Enter timeline, Cmd+Z undo, / search, T trace, R check again, ? keys, Esc back
//   hidden  Cmd+Shift+D demo panel: 1/2/3 switch a simulated failure, R check again, Esc close

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
  const [view, setView] = useState<"list" | "detail" | "timeline">("list");
  // Where Esc goes back to from an open finding.
  const [detailFrom, setDetailFrom] = useState<"list" | "timeline">("list");
  const [timelineKey, setTimelineKey] = useState<string>();
  const [pane, setPane] = useState<Pane>("evidence");
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The hidden demo panel for simulated connector failures.
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const [showHint, setShowHint] = useState(!hintSeen());

  const findings = rankedFindings(scan);
  const items = listItems(findings, scan, query);
  const selected: ListItem | undefined = items.find((i) => i.key === selectedKey) ?? items[0];
  const selectedItem: Finding | Cleared | undefined =
    selected?.type === "finding" ? selected.finding : selected?.type === "cleared" ? selected.cleared : undefined;
  const evidenceCount = selectedItem ? evidenceFor(selectedItem, scan.corpus).length : 0;
  const entries = filterTimeline(buildTimeline(scan), query);
  const selectedEntry = entries.find((e) => e.key === timelineKey) ?? entries[nowIndex(entries)] ?? entries[entries.length - 1];

  useEffect(() => {
    activeHotkey().then(setHotkey).catch(() => setHotkey([]));
    return onPaletteShown(() => {
      setQuery("");
      setView("list");
      setDetailFrom("list");
      setEditing(false);
      setSheetOpen(false);
      setOpenCount((n) => n + 1);
    });
  }, []);

  // Land focus on the panel (not the input) each time it opens.
  useEffect(() => {
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

  function open(key: string, from: "list" | "timeline" = "list") {
    const item = items.find((i) => i.key === key);
    if (!item || item.type === "undecided") return;
    select(key);
    setView("detail");
    setDetailFrom(from);
    setPane("evidence");
    setEditing(false);
  }

  function openTimeline() {
    // The search carries over, so "Skylink" then Cmd+Enter shows Skylink's dates.
    setEditing(false);
    setView("timeline");
    // Land on the first thing still to come, just under the "now" marker.
    setTimelineKey(entries[nowIndex(entries)]?.key);
  }

  function moveInTimeline(by: number) {
    if (!entries.length) return;
    const at = Math.max(0, entries.findIndex((e) => e.key === selectedEntry?.key));
    if (by < 0 && at === 0) return inputRef.current?.focus();
    setTimelineKey(entries[Math.min(entries.length - 1, Math.max(0, at + by))].key);
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
    if (view === "detail") setView(detailFrom);
    else if (view === "timeline") setView("list");
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
    const item = items.find((i) => i.key === key);
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
        if (inDetail && selectedItem && "evidence" in selectedItem) setPane((p) => (p === "evidence" ? "draft" : "evidence"));
        return;
      case "edit":
        if (selected?.type === "finding" && selected.finding.draft && selected.finding.status === "new") {
          if (!inDetail) open(selected.key);
          setPane("draft");
          setEditing(true);
        }
        return;
      case "rescan":
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

      // Cmd+Shift+D opens and closes the demo panel from anywhere.
      if (event.metaKey && event.shiftKey && lower === "d") {
        event.preventDefault();
        setScenariosOpen((o) => !o);
        setSheetOpen(false);
        panelRef.current?.focus();
        return;
      }

      // While the demo panel is open, it owns the keys.
      if (scenariosOpen) {
        if (key === "Escape") {
          event.preventDefault();
          setScenariosOpen(false);
          return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const scenario = SCENARIOS.find((s) => s.key === key);
        if (scenario) {
          event.preventDefault();
          toggleScenario(scenario.id);
        } else if (lower === "r") {
          // Close first, so the check and its failures are in plain view.
          // While a check is running, R does nothing here (the button says so).
          event.preventDefault();
          if (scan.phase === "scanning" || scan.refreshing) return;
          setScenariosOpen(false);
          run("rescan");
        }
        return;
      }

      if (key === "Escape") {
        event.preventDefault();
        // Esc steps back one level at a time, and closes the palette last.
        if (sheetOpen) setSheetOpen(false);
        else if (editing) {
          setEditing(false);
          panelRef.current?.focus();
        } else if (typing && query) setQuery("");
        else if (typing) panelRef.current?.focus();
        else if (view === "detail") back();
        else if (view === "timeline" && query) setQuery("");
        else if (view === "timeline") back();
        else if (traceOpen) setTraceOpen(false);
        else if (query) setQuery("");
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
        if (view === "timeline") setView("list");
        else openTimeline();
        return;
      }

      if (typing) {
        // In search: Enter or Down goes to the results.
        if (key === "Enter" || key === "ArrowDown") {
          event.preventDefault();
          panelRef.current?.focus();
          if (view === "timeline") setTimelineKey((entries[nowIndex(entries)] ?? entries[0])?.key);
          else select(items[0]?.key);
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

      if (sheetOpen) {
        if (key === "?") setSheetOpen(false);
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
        }
        return;
      }

      if (down || up) {
        event.preventDefault();
        if (!inDetail) move(down ? 1 : -1);
        else if (pane === "evidence") setEvidenceIndex((i) => Math.min(evidenceCount - 1, Math.max(0, i + (down ? 1 : -1))));
        else draftRef.current?.scrollBy({ top: down ? 64 : -64 });
        return;
      }

      switch (key) {
        case "/":
          event.preventDefault();
          if (inDetail) setView("list");
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
        case "Tab":
          if (inDetail) {
            event.preventDefault();
            run("pane");
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
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // What fills the middle of the palette.
  const nothingYet = items.length === 0 && !query;
  let main: React.ReactNode;
  if (view === "detail" && selectedItem) {
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
        search={
          <CommandBar
            ref={inputRef}
            value={query}
            onChange={setQuery}
            label="Search the timeline"
            placeholder="Search the timeline by business or date"
          />
        }
      />
    );
  } else if (nothingYet && scan.phase === "scanning") main = <Scanning scan={scan} />;
  else if (nothingYet && scan.phase === "error") main = <ScanError message={scan.error ?? "Something went wrong."} />;
  else if (nothingYet && scan.phase === "done") main = <AllClear checked={0} />;
  else if (nothingYet) main = <NotChecked />;
  else
    main = (
      <FindingsList
        items={items}
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
        search={<CommandBar ref={inputRef} value={query} onChange={setQuery} />}
      />
    );

  const inDetail = view === "detail" && !!selectedItem;
  const actionItem = selected?.type === "undecided" ? { undecided: selected.error } : selectedItem;

  return (
    <div
      key={openCount}
      ref={panelRef}
      tabIndex={-1}
      className="palette-enter relative flex h-full flex-col overflow-hidden rounded-[14px] border border-white/[0.06] bg-bg/[0.86] outline-none"
      // Any real pointer movement switches to mouse mode (click hints, no key
      // caps); any key press switches back. A still pointer under scrolling
      // content can fire a move event with no movement, so that doesn't count.
      onMouseMove={(e) => {
        if (e.movementX !== 0 || e.movementY !== 0) setMouse(true);
      }}
    >
      <Header
        action={
          view === "list" && !nothingYet ? (
            <SwitchButton keys={["⌘", "↵"]} label="View timeline" icon={<TimelineIcon />} mouse={mouse} onClick={openTimeline} />
          ) : view === "timeline" ? (
            <SwitchButton keys={["Esc"]} label="View list" icon={<ListIcon />} mouse={mouse} onClick={back} />
          ) : view === "detail" ? (
            // "Back", not a view name: it returns to wherever the finding was opened from.
            <SwitchButton keys={["Esc"]} label="Back" icon={<BackIcon />} mouse={mouse} onClick={back} />
          ) : undefined
        }
      />
      {scan.usedReplay && (
        <p role="status" className="mx-3 mb-2 truncate rounded-md border border-amber/25 bg-amber-glow/30 px-3 py-1 text-[11.5px] text-muted">
          <span className="font-medium text-amber">Replay mode.</span> Some answers are saved replies from an earlier run, not live from the model.
        </p>
      )}
      <div className="h-px shrink-0 bg-hairline" />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {main}
        {traceOpen && <TraceDrawer lines={scan.trace} onClose={() => setTraceOpen(false)} />}
      </div>
      {view === "timeline" ? (
        <TimelineBar entry={selectedEntry} mouse={mouse} onOpen={() => openEntry()} />
      ) : (
        !nothingYet && <ActionBar item={actionItem} detail={inDetail} pane={pane} mouse={mouse} onCommand={run} />
      )}
      <Footer
        hotkey={hotkey}
        mouse={mouse}
        onTrace={() => setTraceOpen((o) => !o)}
        onKeys={() => setSheetOpen(true)}
        onScenarios={() => setScenariosOpen(true)}
      />
      <Toast />
      {sheetOpen && <ShortcutSheet onClose={() => setSheetOpen(false)} />}
      {scenariosOpen && (
        <ScenariosSheet mouse={mouse} onClose={() => setScenariosOpen(false)} onCheck={() => {
            setScenariosOpen(false);
            run("rescan");
          }}
        />
      )}
    </div>
  );
}
