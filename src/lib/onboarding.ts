// First-run onboarding. It starts from an empty account and ends in the same
// connected, checked state the app has after any launch. Three steps:
//
//   welcome     what Seal does, and pressing the key that opens it
//   connect     connect the four demo sources one at a time (real reads over the seed data)
//   first-scan  the first real check, then "View findings"
//
// Then "done": the usual palette, with a short shortcuts dialog the first time (see Palette.tsx).
//
// Where it got to is kept in localStorage and put back after a restart or
// reload. React reads it like the other stores.

import { useSyncExternalStore } from "react";
import type { ConnectorId } from "../connectors/types";
import { connectOne, forgetConnection, forgetConnections, getConnectors } from "../connectors/live";
import { onSummonProved, setMenuSettings, setSummonTest } from "./native";
import { resetPreferences } from "./preferences";
import { getScan, resetScan, setScanSources, startScan, subscribeScan } from "./scan-store";

export type Step = "welcome" | "connect" | "first-scan" | "done";

export const SOURCES: ConnectorId[] = ["bank", "email", "documents", "calendar"];

export type OnboardingState = {
  step: Step;
  /** Real sources connected so far, in order. */
  connected: ConnectorId[];
  /** The source being connected right now (not saved). */
  connecting?: ConnectorId;
  /** Step 1: the user has pressed the summon key, so Get started unlocks. */
  summoned?: boolean;
  /** Step 2 was skipped with nothing connected, so no check may read anything until a source is. */
  skipped?: boolean;
};

const KEY = "life.onboarding";
type Saved = { v: 3; step: Step; connected: ConnectorId[]; summoned?: boolean; skipped?: boolean };

/** Steps from the longer onboarding with a practice round (v2). Its practice steps resume at connect. */
const V2_STEPS: Record<string, Step> = {
  welcome: "welcome",
  summon: "welcome",
  "practice-connect": "connect",
  "practice-check": "connect",
  practice: "connect",
  "training-complete": "connect",
  connect: "connect",
  "first-scan": "first-scan",
  done: "done",
};

function fresh(): OnboardingState {
  return { step: "welcome", connected: [] };
}

function load(): OnboardingState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as { v?: number; step?: string; connected?: ConnectorId[]; summoned?: boolean; skipped?: boolean } | null;
    if (raw?.v === 3 || raw?.v === 2) {
      const step = raw.v === 3 ? (raw.step as Step) : V2_STEPS[raw.step ?? ""];
      if (!step) return fresh();
      // The practice round never connected real sources, so a save from it starts the real connect empty.
      const connected = raw.v === 2 && step === "connect" && raw.step !== "connect" ? [] : (raw.connected ?? []);
      return { step, connected: connected.filter((id) => SOURCES.includes(id)), summoned: raw.summoned === true, skipped: raw.skipped === true };
    }
    // The first version's save: finished stays finished, anything else starts over.
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

/** What a check may read: the connected sources, nothing after a skip, or all four for an older install. */
function sourcesToCheck(): ConnectorId[] | undefined {
  if (state.connected.length) return state.connected;
  return state.skipped ? [] : undefined;
}

function set(change: Partial<OnboardingState>) {
  state = { ...state, ...change };
  try {
    const saved: Saved = { v: 3, step: state.step, connected: state.connected, summoned: state.summoned, skipped: state.skipped };
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage can be unavailable; onboarding then lasts until the app quits.
  }
  syncMenuSettings();
  syncSummonTest();
  setScanSources(sourcesToCheck());
  for (const listener of listeners) listener();
}

// The menu bar menu's Settings stays greyed out until onboarding is done,
// because setup has no Settings to open.
let menuSettings: boolean | undefined;
function syncMenuSettings() {
  const want = state.step === "done";
  if (want === menuSettings) return;
  menuSettings = want;
  setMenuSettings(want);
}
syncMenuSettings();

// Step 1 waits for the summon key: until it's pressed, the key doesn't hide
// the app (src-tauri/src/palette.rs). After that it works as usual.
let summonArmed: boolean | undefined;
function syncSummonTest() {
  const want = state.step === "welcome" && !state.summoned;
  if (want === summonArmed) return;
  summonArmed = want;
  setSummonTest(want);
}
syncSummonTest();
onSummonProved(() => proveSummon());

// Every check reads only the sources connected during setup (all four for installs from before onboarding).
setScanSources(sourcesToCheck());

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

/** Screens that replace the palette's views: all three onboarding steps. */
export function isSetupScreen(step: Step): boolean {
  return step !== "done";
}

/** The sources switched on. An install from before onboarding has none saved, and reads all four. */
export function enabledSources(): ConnectorId[] {
  return sourcesToCheck() ?? SOURCES;
}

/** Step 1: the summon key was pressed, so Get started unlocks. */
export function proveSummon(): void {
  if (state.step === "welcome" && !state.summoned) set({ summoned: true });
}

/** Step 1: the key changed (Use ⌘⇧Space instead), so it has to be pressed again. */
export function retestSummon(): void {
  if (state.step === "welcome") set({ summoned: false });
}

// ---------- Starting and resuming ----------

/**
 * Called at launch (and after any page reload) while onboarding isn't
 * finished. Puts the screen back where it was left: sources already connected
 * are read again, and an unfinished first check runs again.
 */
export function resumeOnboarding(): void {
  if (state.step === "connect" && state.connected.length) void reconnectAll();
  if (state.step === "first-scan") void startScan();
}

async function reconnectAll() {
  for (const id of state.connected) await connectOne(id);
}

// ---------- Moving through the steps ----------

/** The current screen's main action (Enter, or its button). */
export function next(): void {
  switch (state.step) {
    case "welcome":
      set({ step: "connect", connected: [], connecting: undefined });
      return;
    case "connect":
      // Enter presses the next source's +; once all four are in, it runs the check.
      if (SOURCES.every((id) => state.connected.includes(id))) return runFirstCheck();
      return void connectNext();
    case "first-scan": {
      // View findings once the check is done; Try again if it didn't finish.
      const phase = getScan().phase;
      if (phase === "done") return finishOnboarding();
      if (phase === "error") void startScan();
      return;
    }
  }
}

/** Leaves step 3 for the findings. Waits for the check to end, however it ended. */
export function finishOnboarding(): void {
  const phase = getScan().phase;
  if (state.step === "first-scan" && (phase === "done" || phase === "error")) set({ step: "done" });
}

/** "Run my first check" (⌘↵): needs at least one connected source. */
export function runFirstCheck(): void {
  if (state.step !== "connect" || state.connecting || state.connected.length === 0) return;
  set({ step: "first-scan" });
  void startScan();
}

/**
 * Step 2's Skip: ends setup with what's connected. It checks those sources, and
 * with none connected it reads nothing until one is connected in Settings.
 */
export function skipConnect(): void {
  if (state.step !== "connect" || state.connecting) return;
  const none = state.connected.length === 0;
  set({ step: "done", skipped: none });
  if (!none) void startScan();
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

/**
 * A source's switch (the Connectors menu and Settings). On reads it straight
 * away; off forgets it. Either way the findings only change on the next check.
 * The last source can't be turned off, since a check needs something to read.
 */
export async function setSourceEnabled(id: ConnectorId, on: boolean): Promise<void> {
  const scan = getScan();
  if (state.connecting || scan.phase === "scanning" || scan.refreshing) return;
  const current = enabledSources();
  if (on === current.includes(id)) return;
  if (!on) {
    if (current.length === 1) return;
    set({ connected: current.filter((s) => s !== id) });
    forgetConnection(id);
    return;
  }
  set({ connecting: id });
  await connectOne(id);
  // In the usual order, so the same sources always ask the models the same questions.
  set({ connecting: undefined, skipped: false, connected: SOURCES.filter((s) => s === id || current.includes(s)) });
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

// A check that starts during the connect step is the first check. Step 3 then
// waits for its button (View findings), so it never jumps away by itself.
subscribeScan(() => {
  if (state.step === "connect" && getScan().phase === "scanning") set({ step: "first-scan", connecting: undefined });
});

// ---------- Reset (for rehearsing the demo) ----------

/**
 * Starts onboarding again from an empty account: forgets decisions, results,
 * connections and the first-run hint. Simulated failures stay as they are.
 * Returns false (and changes nothing) while a check is running.
 */
export async function resetOnboarding(): Promise<boolean> {
  if (!(await resetScan())) return false;
  try {
    localStorage.removeItem("life.decisions");
    localStorage.removeItem("life.routes");
    localStorage.removeItem("life.rewrites");
    localStorage.removeItem("life.rules");
    localStorage.removeItem("life.hintSeen");
  } catch {
    // Nothing to clear.
  }
  forgetConnections();
  resetPreferences();
  state = fresh();
  set({});
  return true;
}
