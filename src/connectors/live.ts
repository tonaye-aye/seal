// The app's live connectors: built once over the bundled seed and shared with
// the UI through a tiny store (React reads it with useSyncExternalStore, so no
// state library is needed). The scan (src/lib/scan-store.ts) syncs them and
// reports each connector's state here.

import { createContext, useContext, useSyncExternalStore } from "react";
import {
  createConnectors,
  Scenarios,
  syncOne,
  type ConnectorStatus,
  type Connectors,
  type ScenarioId,
} from "./index.ts";
import type { ConnectorId } from "./types.ts";
import { viteSeedSource } from "./source.vite.ts";

const SCENARIO_KEY = "life.scenarios";
const ORDER: ConnectorId[] = ["bank", "email", "documents", "calendar"];

export type LiveState = {
  statuses: Partial<Record<ConnectorId, ConnectorStatus>>;
  /** Scenarios switched on or off since their connector was last synced. */
  pending: ScenarioId[];
  /** Document reads that are taking a long time, for the "slow to respond" skeleton. */
  slowReads?: { done: number; total: number };
};

let state: LiveState = { statuses: {}, pending: [] };

// The dev gallery passes fixed connector states through this. With no provider
// (the real app), useLive and useScenarios read the live store as before.
const LivePreview = createContext<{ live: LiveState; scenarios: ScenarioId[] } | undefined>(undefined);
export const LivePreviewProvider = LivePreview.Provider;
const listeners = new Set<() => void>();

function setState(change: Partial<LiveState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

/** Failure scenarios stay on across restarts so a demo can be set up beforehand. */
function savedScenarios(): ScenarioId[] {
  try {
    return JSON.parse(localStorage.getItem(SCENARIO_KEY) ?? "[]") as ScenarioId[];
  } catch {
    return [];
  }
}

export const scenarios = new Scenarios(savedScenarios());

/** Which connector each scenario breaks (from the manifest, kept here so the UI needs no async load). */
export const SCENARIO_CONNECTOR: Record<ScenarioId, ConnectorId> = {
  calendar_reauth: "calendar",
  bank_rate_limit: "bank",
  slow_documents: "documents",
};

// A stable copy of the switched-on list, so React can tell when it changed.
let scenarioList: ScenarioId[] = scenarios.list();
let lastSeen = new Set(scenarioList);

scenarios.subscribe(() => {
  try {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(scenarios.list()));
  } catch {
    // Storage can be unavailable; the scenario still applies for this session.
  }
  const next = scenarios.list();
  // Whatever just flipped only shows once its connector is read again.
  const flipped = (Object.keys(SCENARIO_CONNECTOR) as ScenarioId[]).filter((id) => lastSeen.has(id) !== next.includes(id));
  const pending = new Set(state.pending);
  for (const id of flipped) {
    // Flipping back before a check cancels out.
    if (pending.has(id)) pending.delete(id);
    else pending.add(id);
  }
  lastSeen = new Set(next);
  scenarioList = next;
  setState({ pending: [...pending] });
});

/** The scenarios that are switched on, for the demo panel and footer chip. */
export function useScenarios(): ScenarioId[] {
  const preview = useContext(LivePreview);
  const live = useSyncExternalStore(scenarios.subscribe.bind(scenarios), () => scenarioList);
  return preview?.scenarios ?? live;
}

/** Turns one simulated failure on or off. It is saved, so it survives a restart. */
export function toggleScenario(id: ScenarioId): void {
  scenarios.set(id, !scenarios.has(id));
}

/** A read longer than this counts as slow and shows the skeleton. */
const SLOW_READ_MS = 1500;

/**
 * Watches document reads so the UI can say when the documents source is slow,
 * the way a real app notices a slow server: by timing the calls, not by
 * knowing a scenario is on.
 */
function watchDocumentReads(c: Connectors): Connectors {
  const readText = c.documents.readText.bind(c.documents);
  let inFlight = 0;
  let done = 0;
  let slow = 0;
  const update = () => setState({ slowReads: slow > 0 ? { done, total: done + inFlight } : undefined });
  c.documents.readText = async (id) => {
    if (inFlight === 0) {
      done = 0;
      slow = 0;
    }
    inFlight += 1;
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      slow += 1;
      update();
    }, SLOW_READ_MS);
    try {
      return await readText(id);
    } finally {
      clearTimeout(timer);
      inFlight -= 1;
      done += 1;
      if (late) slow -= 1;
      // Once every read is back, the skeleton goes away.
      if (inFlight === 0) slow = 0;
      update();
    }
  };
  return c;
}

let connectors: Promise<Connectors> | undefined;
export function getConnectors(): Promise<Connectors> {
  connectors ??= createConnectors({ source: viteSeedSource, scenarios }).then(watchDocumentReads);
  return connectors;
}

/** Records one connector's latest state (called by the scan as it syncs). */
export function setConnectorStatus(status: ConnectorStatus): void {
  // A sync starting on this connector means its scenarios are now in play.
  const pending =
    status.state === "connecting" ? state.pending.filter((id) => SCENARIO_CONNECTOR[id] !== status.id) : state.pending;
  setState({ statuses: { ...state.statuses, [status.id]: status }, pending });
}

/**
 * A write outside a sync found the sign-in expired (adding a reminder): the
 * chip says so, and R signs it back in before checking again.
 */
export function markNeedsReconnect(id: ConnectorId, detail: string): void {
  const current = state.statuses[id];
  if (current) setConnectorStatus({ ...current, state: "needs_reconnect", detail, retryAt: undefined });
}

/**
 * Connects one source on first run: a real read of that connector (real
 * delays, and any failure switched on in the demo panel), shown on its chip.
 * Resolves with how it ended.
 */
export async function connectOne(id: ConnectorId): Promise<ConnectorStatus | undefined> {
  const c = await getConnectors();
  await syncOne(c, id, setConnectorStatus);
  return state.statuses[id];
}

/** Forgets every source's state, so the chips read "Not connected yet" again (Reset onboarding). */
export function forgetConnections(): void {
  setState({ statuses: {}, slowReads: undefined });
}

/** Forgets one source's state, once its switch is turned off. */
export function forgetConnection(id: ConnectorId): void {
  const statuses = { ...state.statuses };
  delete statuses[id];
  setState({ statuses });
}

/** True when the calendar's sign-in has expired. */
export function calendarNeedsReconnect(): boolean {
  return state.statuses.calendar?.state === "needs_reconnect";
}

/** Signs the calendar back in. The caller then runs the check again. */
export async function reconnectCalendar(): Promise<void> {
  const c = await getConnectors();
  const calendar = state.statuses.calendar;
  if (calendar) setConnectorStatus({ ...calendar, state: "connecting", detail: undefined });
  await c.calendar.reconnect();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLive(): LiveState {
  const preview = useContext(LivePreview);
  const live = useSyncExternalStore(subscribe, () => state);
  return preview?.live ?? live;
}

/** Statuses in display order (bank, email, documents, calendar). */
export function orderedStatuses(live: LiveState): ConnectorStatus[] {
  return ORDER.flatMap((id) => (live.statuses[id] ? [live.statuses[id]] : []));
}

// In development, the scenario switches are also in the browser console, e.g.
// __life.scenarios.set("bank_rate_limit", true), then __life.scan() to check
// again. The demo panel (Cmd+Shift+D) does the same in every build.
if (import.meta.env.DEV) {
  // `__life.llm` sends a tiny model request through the Rust command, to check
  // the endpoint from the running app: await __life.llm()
  const llm = async (mode: "live" | "replay" = "live") => {
    const { createAppLlm, llmConfigured } = await import("../lib/llm-tauri.ts");
    if (!(await llmConfigured())) return "Endpoint or key missing on the native side.";
    const r = await createAppLlm(mode).chat({
      model: "fast",
      think: false,
      maxTokens: 50,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    return `${r.text} (${r.source}, ${r.ms} ms)`;
  };
  const scan = async () => (await import("../lib/scan-store.ts")).startScan();
  (window as unknown as { __life: object }).__life = { scenarios, scan, llm };
}
