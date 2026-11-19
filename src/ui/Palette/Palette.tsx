import { useEffect, useRef, useState } from "react";
import type { Cleared, Finding } from "../../agent/pipeline";
import { reconnectCalendar, useLive } from "../../connectors/live";
import { activeHotkey, hidePalette, onPaletteShown } from "../../lib/native";
import { approve, dismiss, rankedFindings, snooze, startScan, undoLast, useScan } from "../../lib/scan-store";
import { ActionBar, FindingDetail, evidenceFor, type Command, type Pane } from "./FindingDetail";
import { AllClear, FindingsList, NotChecked, Scanning, ScanError, listItems, type ListItem, type RowAction } from "./FindingsList";
import { CommandBar } from "./CommandBar";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { ShortcutSheet } from "./ShortcutSheet";
import { Toast } from "./Toast";
import { TraceDrawer } from "./Trace";

// The summoned palette. It fills the native window; the window itself is
// transparent with a macOS blur behind, so this panel adds the warm tint.
//
// It owns every key, in one handler, so nothing else can fight over them:
//   list    J/K move, Enter opens, A approve, E edit, S snooze, D not a leak
//   detail  J/K move through evidence (or scroll the draft), Tab switch pane
//   always  Cmd+Z undo, / search, T trace, R check again, ? keys, Esc back

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
  const [view, setView] = useState<"list" | "detail">("list");
  const [pane, setPane] = useState<Pane>("evidence");
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showHint, setShowHint] = useState(!hintSeen());

  const findings = rankedFindings(scan);
  const items = listItems(findings, scan, query);
  const selected: ListItem | undefined = items.find((i) => i.key === selectedKey) ?? items[0];
  const selectedItem: Finding | Cleared | undefined =
    selected?.type === "finding" ? selected.finding : selected?.type === "cleared" ? selected.cleared : undefined;
  const evidenceCount = selectedItem ? evidenceFor(selectedItem, scan.corpus).length : 0;

  useEffect(() => {
    activeHotkey().then(setHotkey).catch(() => setHotkey([]));
    return onPaletteShown(() => {
      setQuery("");
      setView("list");
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
    select(items[Math.min(items.length - 1, Math.max(0, at + by))].key);
    setScrollKey((n) => n + 1);
  }

  function open(key: string) {
    const item = items.find((i) => i.key === key);
    if (!item || item.type === "undecided") return;
    select(key);
    setView("detail");
    setPane("evidence");
    setEditing(false);
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
        if (live.statuses.calendar?.state === "needs_reconnect") void reconnectCalendar().then(startScan);
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

      if (key === "Escape") {
        event.preventDefault();
        // Esc steps back one level at a time, and closes the palette last.
        if (sheetOpen) setSheetOpen(false);
        else if (editing) {
          setEditing(false);
          panelRef.current?.focus();
        } else if (typing && query) setQuery("");
        else if (typing) panelRef.current?.focus();
        else if (view === "detail") setView("list");
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

      if (typing) {
        // In search: Enter or Down goes to the results.
        if (key === "Enter" || key === "ArrowDown") {
          event.preventDefault();
          panelRef.current?.focus();
          select(items[0]?.key);
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
        onBack={() => setView("list")}
        onSelectEvidence={(i) => {
          setEvidenceIndex(i);
          setPane("evidence");
        }}
        draftRef={draftRef}
        scanning={scan.phase === "scanning"}
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
    >
      <Header />
      {scan.usedReplay && (
        <p role="status" className="mx-3 mb-2 truncate rounded-md border border-amber/25 bg-amber-glow/30 px-3 py-1 text-[11.5px] text-muted">
          <span className="font-medium text-amber">Replay mode.</span> Some answers are saved replies from an earlier run, not live from the model.
        </p>
      )}
      {!inDetail && <CommandBar ref={inputRef} value={query} onChange={setQuery} />}
      <div className="h-px shrink-0 bg-hairline" />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {main}
        {traceOpen && <TraceDrawer lines={scan.trace} onClose={() => setTraceOpen(false)} />}
      </div>
      {!nothingYet && <ActionBar item={actionItem} detail={inDetail} pane={pane} mouse={mouse} onCommand={run} />}
      <Footer hotkey={hotkey} onTrace={() => setTraceOpen((o) => !o)} onKeys={() => setSheetOpen(true)} />
      <Toast />
      {sheetOpen && <ShortcutSheet onClose={() => setSheetOpen(false)} />}
    </div>
  );
}
