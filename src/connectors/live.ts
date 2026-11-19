// The app's live connectors: built once over the bundled seed, synced at
// launch, and shared with the UI through a tiny store (React reads it with
// useSyncExternalStore, so no state library is needed).

import { useSyncExternalStore } from "react";
import {
  createConnectors,
  Scenarios,
  syncAll,
  type ConnectorStatus,
  type Connectors,
  type ScenarioId,
  type SyncSnapshot,
} from "./index.ts";
import type { ConnectorId } from "./types.ts";
import { viteSeedSource } from "./source.vite.ts";

const SCENARIO_KEY = "life.scenarios";
const ORDER: ConnectorId[] = ["bank", "email", "documents", "calendar"];

export type LiveState = {
  statuses: Partial<Record<ConnectorId, ConnectorStatus>>;
  snapshot?: SyncSnapshot;
  syncing: boolean;
};

let state: LiveState = { statuses: {}, syncing: false };
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
scenarios.subscribe(() => {
  try {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(scenarios.list()));
  } catch {
    // Storage can be unavailable; the scenario still applies for this session.
  }
});

let connectors: Promise<Connectors> | undefined;
export function getConnectors(): Promise<Connectors> {
  connectors ??= createConnectors({ source: viteSeedSource, scenarios });
  return connectors;
}

/** Syncs all four connectors. Calls made while a sync is running are ignored. */
export async function sync(): Promise<void> {
  if (state.syncing) return;
  setState({ syncing: true });
  const c = await getConnectors();
  const snapshot = await syncAll(c, (status) =>
    setState({ statuses: { ...state.statuses, [status.id]: status } }),
  );
  setState({ snapshot, syncing: false });
}

/** Signs the calendar back in, then syncs again. */
export async function reconnectCalendar(): Promise<void> {
  const c = await getConnectors();
  setState({
    statuses: {
      ...state.statuses,
      calendar: state.statuses.calendar && { ...state.statuses.calendar, state: "connecting", detail: undefined },
    },
  });
  await c.calendar.reconnect();
  await sync();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLive(): LiveState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Statuses in display order (bank, email, documents, calendar). */
export function orderedStatuses(live: LiveState): ConnectorStatus[] {
  return ORDER.flatMap((id) => (live.statuses[id] ? [live.statuses[id]] : []));
}

// In development, expose the scenario switches in the browser console until
// the hidden settings panel exists, e.g. __life.scenarios.set("bank_rate_limit", true).
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
  (window as unknown as { __life: object }).__life = { scenarios, sync, llm };
}
