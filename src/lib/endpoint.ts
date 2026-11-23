// The model endpoint as the UI sees it: can the app reach it, does it accept the
// key, how fast does it answer, and is the app using saved answers instead.
//
// A check runs at launch and before every scan: it asks the endpoint for its
// model list (network, key and models in one quick call), then sends one tiny
// request to time a real answer. The result decides whether the next scan
// runs live or on saved answers (replay). Saved answers are always labelled.
//
// Also kept here: "Use saved answers only" (the demo panel's M, or
// LIFE_REPLAY=1 at launch), and the demo switch that makes the endpoint drop
// out partway through a check.

import { createContext, useContext, useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { copy } from "../copy.ts";
import { cacheKey, MODELS, requestBody } from "./llm.ts";
import { llmConfigured, tauriTransport } from "./llm-tauri.ts";
import { withLimit } from "./model-session.ts";

export type EndpointState =
  | "unknown" // not checked yet
  | "checking"
  | "live" // answering normally
  | "slow" // answering, but slowly: checks stay live and take longer
  | "offline" // couldn't reach it, or it didn't answer in time
  | "key_rejected" // it answered 401 or 403
  | "not_set_up" // no endpoint or key on the native side
  | "unavailable" // it answered with another error, or lacks a model
  | "forced" // saved answers chosen (demo panel or LIFE_REPLAY=1)
  | "browser"; // a plain browser tab (pnpm dev): no native side, saved answers only

export type EndpointStatus = {
  state: EndpointState;
  /** Real time of the last check (for "checked 9:31"). */
  checkedAt?: number;
  /** How long the tiny test request took, in milliseconds. */
  ms?: number;
  /** One plain sentence on what went wrong, when something did. */
  detail?: string;
  /** Saved answers were chosen at launch (LIFE_REPLAY=1), not in the demo panel. */
  byFlag?: boolean;
};

/** States in which a scan uses saved answers from the start. */
export function usesReplay(state: EndpointState): boolean {
  return state === "offline" || state === "key_rejected" || state === "not_set_up" || state === "unavailable" || state === "forced" || state === "browser";
}

/** The test request should answer well inside this; slower counts as "slow". */
export const SLOW_MS = 4_000;
/** Past this, the test request counts as no answer at all. */
export const NO_ANSWER_MS = 10_000;

// ---------- Saved settings ----------

const DEMO_KEY = "life.modelDemo";
type Demo = { saved: boolean; drop: boolean };

function loadDemo(): Demo {
  try {
    const raw = JSON.parse(localStorage.getItem(DEMO_KEY) ?? "null") as Partial<Demo> | null;
    return { saved: raw?.saved === true, drop: raw?.drop === true };
  } catch {
    return { saved: false, drop: false };
  }
}

let demo = loadDemo();
/** LIFE_REPLAY=1 for this launch: saved answers only, whatever the panel says. */
let byFlag = false;

function saveDemo() {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(demo));
  } catch {
    // Storage can be unavailable; the switch then lasts until the app quits.
  }
}

// ---------- The store ----------

let status: EndpointStatus = forcedNow() ? forcedStatus() : { state: "unknown" };
const listeners = new Set<() => void>();
let demoSnapshot = { ...demo, byFlag };

function set(next: EndpointStatus) {
  status = next;
  emit();
}

function emit() {
  demoSnapshot = { ...demo, byFlag };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function forcedNow(): boolean {
  return demo.saved || byFlag;
}

function forcedStatus(): EndpointStatus {
  return {
    state: "forced",
    checkedAt: Date.now(),
    byFlag: byFlag && !demo.saved,
    detail: byFlag && !demo.saved ? (isTauri() ? copy.endpoint.startedWithFlag : copy.endpoint.startedWithQuery) : copy.endpoint.chosenInPanel,
  };
}

export function getEndpoint(): EndpointStatus {
  return status;
}

// The dev gallery passes fixed states through these. With no provider (the
// real app), the hooks read the live store.
const EndpointPreview = createContext<EndpointStatus | undefined>(undefined);
export const EndpointPreviewProvider = EndpointPreview.Provider;
const DemoPreview = createContext<(Demo & { byFlag: boolean }) | undefined>(undefined);
export const ModelDemoPreviewProvider = DemoPreview.Provider;

export function useEndpoint(): EndpointStatus {
  const preview = useContext(EndpointPreview);
  const live = useSyncExternalStore(subscribe, () => status);
  return preview ?? live;
}

export function getModelDemo(): Demo & { byFlag: boolean } {
  return demoSnapshot;
}

/** The demo panel's model switches: saved answers only, and the partway drop. */
export function useModelDemo(): Demo & { byFlag: boolean } {
  const preview = useContext(DemoPreview);
  const live = useSyncExternalStore(subscribe, () => demoSnapshot);
  return preview ?? live;
}

// ---------- Switches ----------

/** Called once at launch with LIFE_REPLAY=1 (or ?replay in a browser). */
export function setReplayFlag(on: boolean): void {
  byFlag = on;
  if (on) set(forcedStatus());
  else emit();
}

/** The demo panel's M: saved answers only, or back to live. Applies to the next check. */
export function toggleSavedOnly(): void {
  demo = { ...demo, saved: !demo.saved };
  saveDemo();
  if (forcedNow()) set(forcedStatus());
  else void checkEndpoint();
}

/** The demo panel's 4: the endpoint answers the first few calls of the next check, then stops. */
export function toggleDrop(): void {
  demo = { ...demo, drop: !demo.drop };
  saveDemo();
  emit();
}

/** How many model calls the "drops partway" switch lets through, or undefined when it is off. */
export function dropAfterCalls(): number | undefined {
  return demo.drop ? DROP_AFTER : undefined;
}
export const DROP_AFTER = 15;

/** A scan lost the endpoint partway through: the footer chip says so until the next check. */
export function markLost(detail: string): void {
  if (usesReplay(status.state)) return;
  set({ state: "offline", checkedAt: Date.now(), detail });
}

// ---------- The check ----------

let running: Promise<EndpointStatus> | undefined;

/**
 * Checks the endpoint and returns what it found. Takes under a second when
 * healthy, and gives up within about 15 seconds when it isn't. Calls made
 * while one runs share it.
 */
export function checkEndpoint(): Promise<EndpointStatus> {
  running ??= run().finally(() => (running = undefined));
  return running;
}

async function run(): Promise<EndpointStatus> {
  if (forcedNow()) {
    set(forcedStatus());
    return status;
  }
  if (!isTauri()) {
    set({ state: "browser", checkedAt: Date.now(), detail: copy.endpoint.browser });
    return status;
  }
  set({ ...status, state: "checking" });
  const result = await probe();
  // Saved answers may have been chosen while the check ran: that wins.
  set(forcedNow() ? forcedStatus() : { ...result, checkedAt: Date.now() });
  return status;
}

type Check = { status: number; ms: number; models: string[] };

async function probe(): Promise<EndpointStatus> {
  if (!(await llmConfigured())) {
    return { state: "not_set_up", detail: copy.endpoint.noKey };
  }
  // 1. The model list: network, key and models in one quick call (src-tauri/src/llm.rs).
  let check: Check;
  try {
    check = await invoke<Check>("llm_check");
  } catch (error) {
    const failure = error as { kind?: string; message?: string };
    if (failure.kind === "not_configured") return { state: "not_set_up", detail: copy.endpoint.noKey };
    return { state: "offline", detail: offlineDetail(failure.message ?? String(error)) };
  }
  if (check.status === 401 || check.status === 403) {
    return { state: "key_rejected", detail: copy.endpoint.keyRejected(check.status) };
  }
  if (check.status < 200 || check.status >= 300) {
    return { state: "unavailable", detail: copy.endpoint.error(check.status) };
  }
  const missing = Object.values(MODELS).filter((id) => !check.models.includes(id));
  if (missing.length) {
    return { state: "unavailable", detail: copy.endpoint.missingModels(missing) };
  }

  // 2. One tiny real request, to time an answer (the list can be up while the models are not).
  const body = requestBody({
    model: "fast",
    think: false,
    maxTokens: 8,
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
  });
  const started = Date.now();
  try {
    const reply = await withLimit(tauriTransport.post("chat/completions", body, await cacheKey(body), "live"), NO_ANSWER_MS);
    const ms = Date.now() - started;
    if (reply.status === 401 || reply.status === 403) return { state: "key_rejected", detail: copy.endpoint.keyRejected(reply.status) };
    if (reply.status < 200 || reply.status >= 300) return { state: "unavailable", detail: copy.endpoint.modelsError(reply.status) };
    if (ms > SLOW_MS) return { state: "slow", ms, detail: copy.endpoint.slow(ms) };
    return { state: "live", ms };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "offline", detail: offlineDetail(message) };
  }
}

function offlineDetail(message: string): string {
  if (/within|didn't answer|no answer/i.test(message)) return message.endsWith(".") ? message : `${message}.`;
  return copy.endpoint.unreachable;
}

// When the Mac's network comes back, check again so the footer stops saying offline.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (status.state === "offline") void checkEndpoint();
  });
  window.addEventListener("offline", () => {
    if (!usesReplay(status.state)) set({ state: "offline", checkedAt: Date.now(), detail: copy.endpoint.macOffline });
  });
}
