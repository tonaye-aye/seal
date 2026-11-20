// First-run onboarding. It starts from an empty account and ends in the same
// connected, checked state the app has after any launch.
//
// Part one is practice: a pretend Postbox inbox and one made-up finding
// (src/onboarding/practice.ts). A guided tour runs in the real palette: each
// tip spotlights one thing (everything else dims) and either waits for Next
// or for the key it is teaching. Nothing in the practice round is read from
// the seed, saved, or sent to a model.
//
// Part two is the real setup: connect the four demo sources one at a time
// (real reads over the seed data), then the first real check.
//
// Where it got to is kept in localStorage and put back exactly after a
// restart or reload. Esc skips. React reads it like the other stores.

import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { ConnectorId } from "../connectors/types";
import { connectOne, forgetConnections, getConnectors } from "../connectors/live";
import { PRACTICE_TRACE, practiceDone, practiceFinding, practiceScanning } from "../onboarding/practice";
import { paletteVisibleNow, setHideOnBlur, setHotkeyPractice } from "./native";
import {
  dismissToast,
  enterPractice,
  getScan,
  inPractice,
  leavePractice,
  resetScan,
  startScan,
  subscribeScan,
  setScanSources,
  updatePractice,
  type ScanState,
  type TraceLine,
} from "./scan-store";

export type Step =
  | "welcome"
  | "summon"
  | "practice-connect"
  /** The scripted practice check, ending in "1 thing found". */
  | "practice-check"
  /** The real palette, running on the practice finding, with the guided tips. */
  | "practice"
  | "training-complete"
  | "connect"
  | "first-scan"
  | "done";

/** What the palette reports, so a tip waiting for that action can move on. */
export type CoachEvent = "timeline" | "list" | "move" | "open" | "back" | "dismiss" | "undo" | "approve" | "settings";

/** Actions the palette asks permission for during the practice round. */
export type CoachAction = CoachEvent | "snooze" | "edit";

export type TipId =
  | "list-intro"
  | "search"
  | "quick-menu"
  | "timeline"
  | "timeline-intro"
  | "to-item"
  | "detail-evidence"
  | "detail-draft"
  | "approve"
  | "approved"
  | "detail-back"
  | "settings"
  | "done";

/** The tour's four chapters, shown as dots in the coach strip. */
export const CHAPTERS = ["List", "Timeline", "Details", "Actions"] as const;
export type Chapter = (typeof CHAPTERS)[number];

export type Tip = {
  id: TipId;
  chapter: Chapter;
  /** The palette view the tip happens in. */
  view: "list" | "timeline" | "detail";
  /** "next" for tips that only explain; otherwise the action it is teaching. */
  waitFor: "next" | CoachEvent;
  /** What to spotlight (data-coach values), first one on screen wins. */
  target: string[];
  /** What can be clicked while the tip is up (data-coach values); everything else is locked. Defaults to `target`. */
  clickable?: string[];
};

/** The guided tour, in order: short, and mostly doing. The words for each tip live in src/ui/Onboarding/tips.tsx. */
export const TIPS: Tip[] = [
  { id: "list-intro", chapter: "List", view: "list", waitFor: "next", target: ["findings"] },
  { id: "search", chapter: "List", view: "list", waitFor: "next", target: ["search"], clickable: [] },
  // Points at the selected row's ⋯: it opens, but its actions do nothing here (approving is taught inside the item).
  { id: "quick-menu", chapter: "List", view: "list", waitFor: "next", target: ["row-menu", "finding-row"], clickable: ["row-menu", "row-menu-list"] },
  { id: "timeline", chapter: "List", view: "list", waitFor: "timeline", target: ["view-switch"] },
  { id: "timeline-intro", chapter: "Timeline", view: "timeline", waitFor: "next", target: ["timeline"] },
  // Move a couple of times, then go into the item from here (Enter or a click opens once two moves are made).
  { id: "to-item", chapter: "Timeline", view: "timeline", waitFor: "open", target: ["timeline"], clickable: ["timeline"] },
  { id: "detail-evidence", chapter: "Details", view: "detail", waitFor: "next", target: ["evidence"] },
  { id: "detail-draft", chapter: "Details", view: "detail", waitFor: "next", target: ["draft"] },
  { id: "approve", chapter: "Actions", view: "detail", waitFor: "approve", target: ["action:approve", "action-bar"] },
  // Undo is shown here but not required: Next moves on once the practice item is approved.
  { id: "approved", chapter: "Actions", view: "detail", waitFor: "next", target: ["toast", "action-bar"], clickable: ["toast", "action:approve"] },
  { id: "detail-back", chapter: "Actions", view: "detail", waitFor: "back", target: ["view-switch"] },
  // Where Trace, shortcuts and Hide Life live. Clicking the cog (or ⌘,) peeks the menu open.
  { id: "settings", chapter: "Actions", view: "list", waitFor: "settings", target: ["settings"] },
  // The very end: no target, so the tooltip sits in the middle. Finish (or Enter) completes the practice.
  { id: "done", chapter: "Actions", view: "list", waitFor: "next", target: [] },
];

/** Tips from the longer tour, so a save from it resumes at the start of the same chapter. */
const RETIRED: Record<string, TipId> = {
  move: "timeline-intro",
  "line-charged": "timeline-intro",
  "line-checked": "timeline-intro",
  "line-now": "timeline-intro",
  "line-deadline": "timeline-intro",
  "line-charge": "timeline-intro",
  "timeline-why": "timeline-intro",
  "detail-heading": "detail-evidence",
  "detail-figures": "detail-evidence",
  "detail-actions": "detail-evidence",
  "qa-approve": "to-item",
  "qa-snooze": "to-item",
  "qa-dismiss": "to-item",
  "try-dismiss": "to-item",
  undo: "to-item",
  "quick-actions": "to-item",
  "to-list": "to-item",
  open: "to-item",
};

/** Where a tip sits in its chapter, e.g. 2 of 4 in Details. */
export function chapterPlace(id: TipId): { chapter: Chapter; index: number; of: number } {
  const tip = tipFor(id);
  const inChapter = TIPS.filter((t) => t.chapter === tip.chapter);
  return { chapter: tip.chapter, index: inChapter.indexOf(tip) + 1, of: inChapter.length };
}


export function tipFor(id: TipId): Tip {
  return TIPS.find((t) => t.id === id) ?? TIPS[0];
}

export const SOURCES: ConnectorId[] = ["bank", "email", "documents", "calendar"];

export type OnboardingState = {
  step: Step;
  name: string;
  /** Real sources connected so far, in order. */
  connected: ConnectorId[];
  /** The source being connected right now. */
  connecting?: ConnectorId;
  tip: TipId;
  /** J/K moves made on the timeline tip: after two, it only says "Esc takes you back". */
  moves: number;
  /** The summon step: waiting for the hotkey, tucked away, worked, or the hotkey seems not to work. */
  summon: "waiting" | "tucked" | "success" | "trouble";
  /** The pretend Postbox account on the practice connect screen. */
  practiceConnect: "idle" | "connecting" | "ok";
  /** The practice check has finished and found its one thing. */
  practiceFound: boolean;
  /** A tip's key was just used: its key caps light up for a moment before the next tip (not saved). */
  flash?: boolean;
  /** The cog tip was answered: the settings menu shows open for a moment before training completes (not saved). */
  peek?: boolean;
};

const KEY = "life.onboarding";
/** Everything needed to put the screen back exactly as it was (not the source being connected right now). */
type Saved = { v: 2 } & Omit<OnboardingState, "connecting" | "flash" | "peek">;

function fresh(): OnboardingState {
  return {
    step: "welcome",
    name: "Maya",
    connected: [],
    tip: TIPS[0].id,
    moves: 0,
    summon: "waiting",
    practiceConnect: "idle",
    practiceFound: false,
  };
}

function load(): OnboardingState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as (Saved | { v: 1; step: Step }) | null;
    if (raw?.v === 2) {
      const { v: _v, ...saved } = raw;
      const tip = TIPS.some((t) => t.id === saved.tip) ? saved.tip : (RETIRED[saved.tip] ?? TIPS[0].id);
      return { ...fresh(), ...saved, tip, name: saved.name || "Maya", connected: saved.connected ?? [] };
    }
    // An earlier version's save: finished stays finished, anything else starts over.
    if (raw?.v === 1) return raw.step === "done" ? { ...fresh(), step: "done" } : fresh();
    // Installs from before onboarding existed have already used the app: don't put them through it.
    if (localStorage.getItem("life.decisions") || localStorage.getItem("life.hintSeen")) return { ...fresh(), step: "done" };
  } catch {
    // Storage unavailable: show onboarding, it just won't be remembered.
  }
  return fresh();
}

let state: OnboardingState = load();
const listeners = new Set<() => void>();

function set(change: Partial<OnboardingState>) {
  state = { ...state, ...change };
  try {
    const { connecting: _busy, flash: _flash, peek: _peek, ...rest } = state;
    const saved: Saved = { v: 2, ...rest };
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage can be unavailable; onboarding then lasts until the app quits.
  }
  syncHideOnBlur();
  syncHotkeyPractice();
  setScanSources(state.connected);
  for (const listener of listeners) listener();
}

// On the summon step the hotkey answers the step ("Success") instead of
// hiding the palette: the one time it doesn't hide.
let hotkeyPractice: boolean | undefined;
function syncHotkeyPractice() {
  const want = state.step === "summon" && state.summon !== "success";
  if (want === hotkeyPractice) return;
  hotkeyPractice = want;
  setHotkeyPractice(want);
}

// While onboarding runs, clicking into another app leaves the palette on
// screen (dimmed) instead of hiding it, so nothing is lost mid-way. Once it's
// done, the usual Spotlight-style hide on click-away comes back.
let hidesOnBlur: boolean | undefined;
function syncHideOnBlur() {
  const want = state.step === "done";
  if (want === hidesOnBlur) return;
  hidesOnBlur = want;
  setHideOnBlur(want);
}
syncHideOnBlur();
// Every check reads only the sources connected during setup (all four for installs from before onboarding).
setScanSources(state.connected);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnboarding(): OnboardingState {
  return useSyncExternalStore(subscribe, () => state);
}

export function getOnboarding(): OnboardingState {
  return state;
}

export function onboardingDone(): boolean {
  return state.step === "done";
}

/** Screens that replace the palette's views (the practice round's tour uses the real views). */
export function isSetupScreen(step: Step): boolean {
  return (
    step === "welcome" ||
    step === "summon" ||
    step === "practice-connect" ||
    step === "practice-check" ||
    step === "training-complete" ||
    step === "connect"
  );
}

export function isPracticeStep(step: Step): boolean {
  return (
    step === "welcome" ||
    step === "summon" ||
    step === "practice-connect" ||
    step === "practice-check" ||
    step === "practice" ||
    step === "training-complete"
  );
}

// ---------- Starting and resuming ----------

let summonTimer: ReturnType<typeof setTimeout> | undefined;
let practiceTimer: ReturnType<typeof setTimeout> | undefined;
/** How long the summon step waits for the hotkey before suggesting another app may have it. */
export const SUMMON_TROUBLE_MS = 8000;

/**
 * Called at launch (and after any page reload) while onboarding isn't
 * finished. Puts the screen back exactly where it was left: the same step,
 * the same tip with the practice item in the same state, the same view (see
 * Palette.tsx), sources already connected read again, and an unfinished first
 * check run again.
 */
export function resumeOnboarding(): void {
  switch (state.step) {
    case "summon":
      if (state.summon === "waiting" || state.summon === "trouble") enterSummon(state.summon);
      // Tucked away and the page reloaded on the way back: if it's on screen, that was the summon.
      else if (state.summon === "tucked") void paletteVisibleNow().then((shown) => shown && paletteSummoned());
      return;
    case "practice-connect":
      // A connect half way through carries on; done stays done.
      if (state.practiceConnect === "connecting") connectPractice();
      return;
    case "practice-check":
      if (state.practiceFound) enterPractice({ ...practiceScanning(), phase: "idle", trace: allPracticeLines() });
      else runPracticeCheck();
      return;
    case "practice":
      enterPractice(practiceStateFor(state.tip));
      return;
    case "connect":
      if (state.connected.length) void reconnectAll();
      return;
    case "first-scan":
      void startScan();
      return;
  }
}

async function reconnectAll() {
  for (const id of state.connected) await connectOne(id);
}

const PRACTICE_ID = practiceFinding.id;

/** The practice palette as it stands at a tip: approved, with a working undo, on the last tip. */
function practiceStateFor(tip: TipId): Partial<ScanState> {
  const done = practiceDone(allPracticeLines());
  // After the approve tip, the practice item stays approved.
  if (tip === "detail-back" || tip === "settings" || tip === "done") {
    return { ...done, decisions: { [PRACTICE_ID]: "approved" }, decidedAt: { [PRACTICE_ID]: Date.now() } };
  }
  if (tip === "approved") {
    return {
      ...done,
      decisions: { [PRACTICE_ID]: "approved" },
      decidedAt: { [PRACTICE_ID]: Date.now() },
      undo: [{ findingId: PRACTICE_ID, before: "new", label: "Saved to Drafts" }],
    };
  }
  return done;
}

/** The practice item is approved right now (the last tip's Finish needs it). */
export function practiceApproved(): boolean {
  return getScan().decisions[PRACTICE_ID] === "approved";
}

function allPracticeLines(): TraceLine[] {
  return PRACTICE_TRACE.map((l, i) => ({ id: -(i + 1), t: 300 + i * 650, ...l }));
}

// ---------- Moving through the steps ----------

export function setName(name: string): void {
  set({ name });
}

/** The current screen's main action (Enter, or its button). */
export function next(): void {
  switch (state.step) {
    case "welcome":
      // A name is needed first (Get started stays disabled until there is one).
      if (!state.name.trim()) return;
      enterSummon();
      return;
    case "summon":
      // Continue is always allowed, even if the hotkey didn't seem to work.
      clearTimeout(summonTimer);
      set({ step: "practice-connect", practiceConnect: "idle" });
      return;
    case "practice-connect":
      if (state.practiceConnect === "idle") return connectPractice();
      if (state.practiceConnect === "ok") {
        set({ step: "practice-check", practiceFound: false });
        return runPracticeCheck();
      }
      return;
    case "practice-check":
      if (!state.practiceFound) return;
      updatePractice(practiceDone(getScan().trace));
      set({ step: "practice", tip: TIPS[0].id, moves: 0 });
      return;
    case "practice":
      return coachNext();
    case "training-complete":
      // The keys were just learned, so the first-run hint isn't needed.
      try {
        localStorage.setItem("life.hintSeen", "1");
      } catch {
        // Storage unavailable: the hint shows once, which is harmless.
      }
      set({ step: "connect", connected: [], connecting: undefined });
      return;
    case "connect":
      // Enter presses the next source's +; once all four are in, it runs the check.
      if (SOURCES.every((id) => state.connected.includes(id))) return runFirstCheck();
      return void connectNext();
  }
}

/** Esc (or Skip): the practice round skips to the real setup; the real setup skips to the usual check. */
export function skip(): void {
  clearTimers();
  if (isPracticeStep(state.step)) {
    leavePractice();
    set({ step: "connect", connected: [], connecting: undefined });
    return;
  }
  // The real setup can't be skipped: a check needs at least one connected source.
}

function clearTimers() {
  clearTimeout(flashTimer);
  clearTimeout(summonTimer);
  clearTimeout(practiceTimer);
}

function enterSummon(from: "waiting" | "trouble" = "waiting") {
  clearTimeout(summonTimer);
  set({ step: "summon", summon: from });
  summonTimer = setTimeout(() => {
    if (state.step === "summon" && state.summon === "waiting") set({ summon: "trouble" });
  }, SUMMON_TROUBLE_MS);
}

/** The palette was hidden (by the hotkey, Esc or a click elsewhere). */
export function paletteHidden(): void {
  // Once it has worked, hiding again changes nothing: the success stays until Continue.
  if (state.step === "summon" && (state.summon === "waiting" || state.summon === "trouble")) {
    clearTimeout(summonTimer);
    set({ summon: "tucked" });
  }
}

/** The hotkey was pressed on the summon step (the palette stayed open): it worked. */
export function hotkeyPressed(): void {
  if (state.step !== "summon" || state.summon === "success") return;
  clearTimeout(summonTimer);
  set({ summon: "success" });
}

/** The palette was summoned. Also called in a plain browser when Option+Space is pressed on the page. */
export function paletteSummoned(): void {
  if (state.step !== "summon" || state.summon === "success") return;
  if (state.summon === "tucked" || !isTauri()) {
    clearTimeout(summonTimer);
    set({ summon: "success" });
  }
}

// ---------- Practice round ----------

/** The pretend Postbox account: a short local connecting, then connected. Nothing is read. */
function connectPractice() {
  clearTimeout(practiceTimer);
  set({ practiceConnect: "connecting" });
  practiceTimer = setTimeout(() => set({ practiceConnect: "ok" }), 1300);
}

/** The scripted practice check. It ends on "1 thing found" and waits for See items found. */
function runPracticeCheck() {
  clearTimeout(practiceTimer);
  enterPractice(practiceScanning());
  const startedAt = Date.now();
  const lines: TraceLine[] = [];
  const add = (i: number) => {
    if (state.step !== "practice-check" || !inPractice()) return;
    if (i < PRACTICE_TRACE.length) {
      const line = PRACTICE_TRACE[i];
      lines.push({ id: -(i + 1), t: Date.now() - startedAt, ...line });
      updatePractice({ trace: [...lines] });
      // The problem found and the fix drafted (marked with a cross and a tick) get a moment longer.
      practiceTimer = setTimeout(() => add(i + 1), line.coach ? 900 : 650);
    } else {
      // Done: the now mark settles, and the screen waits on its success message.
      updatePractice({ phase: "idle", stage: undefined });
      set({ practiceFound: true });
    }
  };
  practiceTimer = setTimeout(() => add(0), 300);
}

function currentTip(): Tip {
  return tipFor(state.tip);
}

/** Whether the palette may do this right now. In the practice round, only what the tip is teaching. */
export function coachAllows(action: CoachAction): boolean {
  if (state.step !== "practice") return true;
  const tip = currentTip();
  // The timeline tip: move between its lines, and open the item once you've moved twice.
  if (tip.id === "to-item" && action === "move") return true;
  if (tip.id === "to-item" && action === "open") return state.moves >= 2;
  // The last tip: undo is shown, and approving again after an undo.
  if (tip.id === "approved") return action === "undo" || (action === "approve" && !practiceApproved());
  return tip.waitFor === action;
}

/** The tip only explains: Enter or Next (Finish) moves on. The last one waits until the item is approved. */
export function tipWaitsForNext(): boolean {
  if (state.step !== "practice" || currentTip().waitFor !== "next") return false;
  return state.tip !== "approved" || practiceApproved();
}

/** Next, on a tip that only explains. */
export function coachNext(): void {
  if (tipWaitsForNext()) advance();
}

/** The palette tells the coach what just happened; the tip moves on when it is the action it was waiting for. */
export function coachSaw(event: CoachEvent): void {
  if (state.step !== "practice" || getScan().phase !== "done" || state.flash) return;
  // Moves on the timeline tip are counted: after two, it only says how to go back.
  if (event === "move" && state.tip === "to-item") return set({ moves: state.moves + 1 });
  if (currentTip().waitFor !== event) return;
  // The cog tip: show the settings menu open for a moment, then finish.
  if (event === "settings") {
    set({ peek: true, flash: true });
    flashTimer = setTimeout(() => {
      set({ peek: false, flash: false });
      advance();
    }, PEEK_MS);
    return;
  }
  // The key caps in the tooltip light up for a moment, then the next tip shows.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return advance();
  set({ flash: true });
  flashTimer = setTimeout(() => {
    set({ flash: false });
    advance();
  }, FLASH_MS);
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
/** How long the key caps light up after the right key, before the next tip. */
const FLASH_MS = 320;
/** How long the settings menu stays open on the cog tip before training completes. */
const PEEK_MS = 1400;

function advance() {
  const at = TIPS.findIndex((t) => t.id === state.tip);
  const following = TIPS[at + 1];
  if (!following) return finishPractice();
  set({ tip: following.id, moves: 0 });
}

function finishPractice() {
  clearTimers();
  dismissToast();
  leavePractice();
  set({ step: "training-complete", peek: false, flash: false });
}

/** "Skip practice" from the coach strip. */
export function skipPractice(): void {
  skip();
}

// ---------- Real setup ----------

/** Connects the given source, or the next one not yet connected; once all four are in, starts the first check. */
/** "Run my first check" (⌘↵): needs at least one connected source. */
export function runFirstCheck(): void {
  if (state.step !== "connect" || state.connecting || state.connected.length === 0) return;
  set({ step: "first-scan" });
  void startScan();
}

/** Connects the given source, or the next one not yet connected (its row's +, or Enter). */
export async function connectNext(which?: ConnectorId): Promise<void> {
  if (state.connecting) return;
  const id = which && !state.connected.includes(which) ? which : SOURCES.find((s) => !state.connected.includes(s));
  if (!id) return;
  set({ connecting: id });
  await connectOne(id);
  // Counted as connected even if it failed: its row then offers what to do (e.g. Reconnect).
  set({ connecting: undefined, connected: [...state.connected, id] });
}

/** Connects a source after setup (the Connectors menu), then checks again so its findings show. */
export async function connectLater(id: ConnectorId): Promise<void> {
  if (state.connecting || state.connected.includes(id)) return;
  set({ connecting: id });
  await connectOne(id);
  set({ connecting: undefined, connected: [...state.connected, id] });
  void startScan();
}

/** Connects one failed source again (its row's Reconnect). */
export async function retrySource(id: ConnectorId): Promise<void> {
  if (state.connecting) return;
  set({ connecting: id });
  const c = await getConnectors();
  if (id === "calendar") await c.calendar.reconnect();
  await connectOne(id);
  set({ connecting: undefined });
}

// The first real check: once it finishes (or if one starts some other way,
// e.g. the footer's Reconnect), onboarding is done.
subscribeScan(() => {
  const phase = getScan().phase;
  if (inPractice()) return;
  if (state.step === "connect" && phase === "scanning") set({ step: "first-scan", connecting: undefined });
  if (state.step === "first-scan" && (phase === "done" || phase === "error")) set({ step: "done" });
});

// ---------- Reset (for rehearsing the demo) ----------

/**
 * Starts onboarding again from an empty account: forgets decisions, results,
 * connections and the first-run hint. Simulated failures stay as they are.
 * Returns false (and changes nothing) while a check is running.
 */
export async function resetOnboarding(): Promise<boolean> {
  if (!(await resetScan())) return false;
  clearTimers();
  try {
    localStorage.removeItem("life.decisions");
    localStorage.removeItem("life.hintSeen");
  } catch {
    // Nothing to clear.
  }
  forgetConnections();
  state = fresh();
  set({});
  return true;
}
