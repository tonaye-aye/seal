// First-run onboarding. It starts from an empty account and ends in the same
// connected, checked state the app has after any launch. Three steps:
//
//   welcome     what Life does, and the key that opens it
//   connect     connect the four demo sources one at a time (real reads over the seed data)
//   first-scan  the first real check
//
// Then "done": the usual palette, with a short hint the first time (see Palette.tsx).
//
// Where it got to is kept in localStorage and put back after a restart or
// reload. React reads it like the other stores.

import { useSyncExternalStore } from "react";
import type { ConnectorId } from "../connectors/types";
import { connectOne, forgetConnections, getConnectors } from "../connectors/live";
import { setHideOnBlur } from "./native";
import { getScan, resetScan, setScanSources, startScan, subscribeScan } from "./scan-store";

export type Step = "welcome" | "connect" | "first-scan" | "done";

export const SOURCES: ConnectorId[] = ["bank", "email", "documents", "calendar"];

export type OnboardingState = {
  step: Step;
  /** Real sources connected so far, in order. */
  connected: ConnectorId[];
  /** The source being connected right now (not saved). */
  connecting?: ConnectorId;
};

const KEY = "life.onboarding";
type Saved = { v: 3; step: Step; connected: ConnectorId[] };

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
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as { v?: number; step?: string; connected?: ConnectorId[] } | null;
    if (raw?.v === 3 || raw?.v === 2) {
      const step = raw.v === 3 ? (raw.step as Step) : V2_STEPS[raw.step ?? ""];
      if (!step) return fresh();
      // The practice round never connected real sources, so a save from it starts the real connect empty.
      const connected = raw.v === 2 && step === "connect" && raw.step !== "connect" ? [] : (raw.connected ?? []);
      return { step, connected: connected.filter((id) => SOURCES.includes(id)) };
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

function set(change: Partial<OnboardingState>) {
  state = { ...state, ...change };
  try {
    const saved: Saved = { v: 3, step: state.step, connected: state.connected };
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage can be unavailable; onboarding then lasts until the app quits.
  }
  syncHideOnBlur();
  setScanSources(state.connected);
  for (const listener of listeners) listener();
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

/** Screens that replace the palette's views (the first check runs in the real palette). */
export function isSetupScreen(step: Step): boolean {
  return step === "welcome" || step === "connect";
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
  }
}

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
