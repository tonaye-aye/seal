// The scan as the UI sees it. Runs the agent (src/agent/pipeline.ts) and turns
// its stream of AgentEvents into one small state object: what is happening
// now, the findings so far, a readable trace, and Maya's decisions (approved,
// snoozed, "not a leak") with an undo list. React reads it with
// useSyncExternalStore, the same way as the connector store.
//
// Nothing here sends anything. Approving saves an email draft through the
// email connector, which has no send operation.
//
// Maya's decisions and edits are kept in localStorage, so they survive a
// restart. A background check (startBackgroundChecks) runs the scan again
// while the palette is hidden, and only swaps in the new results at the end.

import { createContext, useContext, useSyncExternalStore } from "react";
import { discardSaved, saveDraft } from "../agent/draft.ts";
import type { Corpus } from "../agent/corpus.ts";
import { rank, runScan, type AgentEvent, type Cleared, type Finding, type ScanResult, type Stage } from "../agent/pipeline.ts";
import { getConnectors, setConnectorStatus } from "../connectors/live.ts";
import type { ConnectorId } from "../connectors/types.ts";
import { checkEndpoint, dropAfterCalls, markLost, usesReplay, type EndpointState, type EndpointStatus } from "./endpoint.ts";
import { tauriTransport } from "./llm-tauri.ts";
import { createModelSession } from "./model-session.ts";

export type Decision = Finding["status"];

export type TraceLine = {
  id: number;
  /** Milliseconds since the scan started. */
  t: number;
  text: string;
  tone: "info" | "good" | "warn" | "bad";
};

export type Toast = { id: number; text: string; undoable: boolean };

type UndoEntry = {
  findingId: string;
  before: Decision;
  /** The draft being saved for this approval: resolves to its id, or undefined if saving failed. */
  saving?: Promise<string | undefined>;
  label: string;
};

export type ScanState = {
  phase: "idle" | "scanning" | "done" | "error";
  /** A background check is running; the last results stay on screen until it finishes. */
  refreshing: boolean;
  startedAt?: number;
  finishedAt?: number;
  /** The stage running now, and how far through it is. */
  stage?: Stage;
  progress?: { stage: Stage; done: number; total: number; label?: string };
  /** In the order they were found. Use `rankedFindings` for display. */
  findings: Finding[];
  cleared: Cleared[];
  undecided: ScanResult["undecided"];
  result?: ScanResult;
  corpus?: Corpus;
  error?: string;
  /** True once any model answer came from saved replies, not the endpoint. */
  usedReplay: boolean;
  /**
   * Why this check uses saved answers, when it does: the endpoint check's
   * state (offline, key rejected, chosen...) or "lost" when the endpoint
   * dropped out partway. Undefined for a live check.
   */
  replay?: { why: EndpointState | "lost"; detail?: string; stage?: Stage };
  trace: TraceLine[];
  /** Maya's choices, kept by finding id so they survive a re-scan. */
  decisions: Record<string, Decision>;
  /** Draft ids saved in the mailbox, by finding id (for undo). */
  saved: Record<string, string>;
  /** Draft bodies Maya edited, by finding id. */
  edits: Record<string, string>;
  /** When each decision was made (real time, for "4 min ago" on the timeline). */
  decidedAt: Record<string, number>;
  undo: UndoEntry[];
  toast?: Toast;
};

// ---------- Kept across restarts ----------

const SAVED_KEY = "life.decisions";
type Saved = Pick<ScanState, "decisions" | "edits" | "decidedAt" | "saved">;

function loadSaved(): Saved {
  const empty: Saved = { decisions: {}, edits: {}, decidedAt: {}, saved: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null") as (Saved & { v?: number }) | null;
    return raw?.v === 1 ? { ...empty, decisions: raw.decisions, edits: raw.edits, decidedAt: raw.decidedAt, saved: raw.saved } : empty;
  } catch {
    return empty;
  }
}

function persist(s: ScanState) {
  try {
    const saved: Saved & { v: number } = { v: 1, decisions: s.decisions, edits: s.edits, decidedAt: s.decidedAt, saved: s.saved };
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch {
    // Storage can be unavailable; decisions then last until the app quits.
  }
}

/** True until the first scan after launch has put back the drafts saved before a restart. */
let restorePending = Object.keys(loadSaved().saved).length > 0;

let state: ScanState = {
  phase: "idle",
  refreshing: false,
  findings: [],
  cleared: [],
  undecided: [],
  usedReplay: false,
  trace: [],
  ...loadSaved(),
  undo: [],
};
const listeners = new Set<() => void>();
let nextId = 1;
state = { ...state, undo: restoreUndo() };

// ---------- Which sources a check reads ----------

/** The sources the user connected (set by onboarding). Undefined means all four. */
let scanSources: ConnectorId[] | undefined;

/** Onboarding tells the scan which sources are connected; every later check reads only those. */
export function setScanSources(ids: ConnectorId[] | undefined): void {
  scanSources = ids && ids.length ? ids : undefined;
}

/**
 * Forgets every result and decision, and removes any drafts this session
 * saved (Reset onboarding). Does nothing while a check is running, since a
 * running check can't be stopped part way.
 */
export async function resetScan(): Promise<boolean> {
  if (state.phase === "scanning" || state.refreshing) return false;
  const savedIds = Object.values(state.saved);
  if (savedIds.length) {
    const connectors = await getConnectors();
    for (const id of savedIds) await discardSaved(connectors, id).catch(() => undefined);
  }
  restorePending = false;
  clearTimeout(toastTimer);
  set({
    phase: "idle",
    refreshing: false,
    startedAt: undefined,
    finishedAt: undefined,
    stage: undefined,
    progress: undefined,
    findings: [],
    cleared: [],
    undecided: [],
    result: undefined,
    corpus: undefined,
    error: undefined,
    usedReplay: false,
    replay: undefined,
    trace: [],
    decisions: {},
    saved: {},
    edits: {},
    decidedAt: {},
    undo: [],
    toast: undefined,
  });
  return true;
}

function set(change: Partial<ScanState>) {
  state = { ...state, ...change };
  if (("decisions" in change || "edits" in change || "saved" in change || "decidedAt" in change)) persist(state);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs `listener` on every change to the scan state (onboarding watches for the first check to finish). */
export const subscribeScan = subscribe;

// The dev gallery passes fixed sample states through this. With no provider
// (the real app), useScan reads the live store as before.
const ScanPreview = createContext<ScanState | undefined>(undefined);
export const ScanPreviewProvider = ScanPreview.Provider;

export function useScan(): ScanState {
  const preview = useContext(ScanPreview);
  const live = useSyncExternalStore(subscribe, () => state);
  return preview ?? live;
}

export function getScan(): ScanState {
  return state;
}

// ---------- Reading the event stream ----------

/** What each stage is called in the trace while it runs. */
const STAGE_TEXT: Record<Stage, string> = {
  sync: "Syncing bank, email, documents and calendar",
  read: "Reading emails and documents",
  detect: "Looking for charges worth a closer look",
  retrieve: "Gathering the evidence for each one",
  extract: "Reading the facts out of each piece of evidence",
  verify: "Checking the numbers and dates in code",
  judge: "Deciding which ones are real problems",
  draft: "Drafting the fixes",
};

function trace(text: string, tone: TraceLine["tone"] = "info"): TraceLine[] {
  const t = Date.now() - (state.startedAt ?? Date.now());
  return [...state.trace, { id: nextId++, t, text, tone }];
}

/** Each connector's last state, to notice when a retry starts and ends. */
const connectorState: Partial<Record<string, string>> = {};

/** True while the scan running now is a background one: its findings wait until it finishes. */
let quiet = false;

function onEvent(event: AgentEvent) {
  // A background check keeps the last results on screen: only the connector
  // chips and the trace follow along.
  if (quiet && (event.type === "corpus" || event.type === "finding" || event.type === "draft" || event.type === "cleared" || event.type === "progress")) return;
  switch (event.type) {
    case "connector": {
      const before = connectorState[event.status.id];
      connectorState[event.status.id] = event.status.state;
      setConnectorStatus(event.status);
      // Say so on the checking screen when a source asks us to wait, and when it lets us carry on.
      if (event.status.state === "retrying" && before !== "retrying") {
        const seconds = Math.max(1, Math.round(((event.status.retryAt ?? Date.now()) - Date.now()) / 1000));
        set({ trace: trace(`${event.status.name} asked us to slow down, trying again in ${seconds} s`, "warn") });
      }
      if (before === "retrying" && event.status.state !== "retrying" && event.status.state !== "error") {
        set({ trace: trace(`${event.status.name} answered again, carrying on`) });
      }
      if (event.status.state === "needs_reconnect") set({ trace: trace(`${event.status.name} needs reconnecting, so it was skipped`, "warn") });
      if (event.status.state === "error") set({ trace: trace(`Couldn't read ${event.status.name}`, "bad") });
      return;
    }
    case "corpus":
      set({ corpus: event.corpus });
      return;
    case "stage":
      if (event.status === "start") {
        // Judging and drafting run together; keep showing "judge" until it's done.
        if (event.stage === "draft") return;
        if (quiet) set({ trace: trace(STAGE_TEXT[event.stage]) });
        else set({ stage: event.stage, progress: undefined, trace: trace(STAGE_TEXT[event.stage]) });
      } else if (event.detail) {
        set({ trace: trace(sentence(event.detail), event.stage === "draft" ? "good" : "info") });
      }
      return;
    case "progress":
      // The trace stays calm: progress shows in the header, not as lines.
      if (event.stage === state.stage) set({ progress: { stage: event.stage, done: event.done, total: event.total, label: event.label } });
      return;
    case "finding":
      set({
        findings: [...state.findings, event.finding],
        usedReplay: state.usedReplay || event.finding.judgedBy.source === "cache",
        trace: trace(`Found: ${event.finding.title}`, "warn"),
      });
      return;
    case "draft":
      set({
        findings: state.findings.map((f) => (f.id === event.findingId ? { ...f, draft: event.draft } : f)),
        usedReplay: state.usedReplay || event.draft.source === "cache",
        trace: trace(
          event.draft.grounded
            ? `Drafted a message to ${event.draft.to.name}, every figure checked`
            : `Drafted a message to ${event.draft.to.name}, but some claims need checking`,
          event.draft.grounded ? "good" : "warn",
        ),
      });
      return;
    case "cleared":
      set({ cleared: [...state.cleared, event.cleared], trace: trace(`${event.cleared.merchant} looks fine: ${event.cleared.why}`, "good") });
      return;
    case "problem":
      set({ trace: trace(event.message, "bad") });
      return;
  }
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------- Running ----------

/**
 * Runs the whole check. Calls made while one is running are ignored.
 * `background`: keep showing the last results while it runs (used by the timer).
 */
export async function startScan({ background = false } = {}): Promise<void> {
  if (state.phase === "scanning" || state.refreshing) return;
  if (background && state.phase === "done") {
    return runBackground();
  }
  set({
    phase: "scanning",
    startedAt: Date.now(),
    finishedAt: undefined,
    stage: undefined,
    progress: undefined,
    findings: [],
    cleared: [],
    undecided: [],
    result: undefined,
    error: undefined,
    usedReplay: false,
    replay: undefined,
    trace: [],
  });
  try {
    const { session, endpoint, lost } = await openSession();
    const connectors = await getConnectors();
    const live = runScan(connectors, session, eventsFor(++scanRun), { only: scanSources });
    live.catch(() => undefined); // an abandoned run ends quietly
    const outcome = await Promise.race([live.then((result) => ({ result })), lost.then((reason) => ({ reason }))]);
    let result: ScanResult;
    if ("result" in outcome) result = outcome.result;
    else {
      // Lost the endpoint partway. Live answers vary a little from run to run,
      // and later questions are built from earlier answers, so mixing live and
      // saved answers would leave gaps. Instead the whole check starts again
      // on saved answers, which follow one earlier run from start to end.
      // The live run is left to finish on its own; its events are ignored.
      set({
        stage: undefined,
        progress: undefined,
        findings: [],
        cleared: [],
        undecided: [],
        usedReplay: false,
        replay: { why: "lost", detail: outcome.reason, stage: state.stage },
      });
      const replay = createModelSession({ transport: tauriTransport, start: "replay" });
      result = await runScan(connectors, replay, eventsFor(++scanRun), { only: scanSources });
    }
    // On saved answers with none saved, every case fails: say why, rather than show an empty list.
    if (state.replay && result.findings.length === 0 && result.cleared.length === 0 && result.undecided.length > 0) {
      throw new Error(noSavedAnswers(endpoint));
    }
    set({
      phase: "done",
      finishedAt: Date.now(),
      stage: undefined,
      progress: undefined,
      result,
      findings: result.findings,
      cleared: result.cleared,
      undecided: result.undecided,
      usedReplay: result.usedReplay,
      trace: trace(`Done in ${((Date.now() - (state.startedAt ?? Date.now())) / 1000).toFixed(1)} s. Nothing was sent or changed.`, "good"),
    });
    await restoreDrafts();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Drafts kept from before a restart can't be put back without a scan; stop waiting for them.
    restorePending = false;
    set({ phase: "error", finishedAt: Date.now(), error: message, trace: trace(message, "bad") });
  }
}

/** The timer's check: the last results stay put until the new ones are all in. */
async function runBackground(): Promise<void> {
  quiet = true;
  set({ refreshing: true, startedAt: Date.now(), trace: [] });
  set({ trace: trace("Checking again in the background") });
  try {
    const { session, endpoint, lost } = await openSession({ background: true });
    // A background check is for fresh answers: with the endpoint down it waits for next time.
    if (usesReplay(endpoint.state) && endpoint.state !== "forced") {
      set({ refreshing: false, trace: trace("The model endpoint isn't available, so the last results stay. The next background check will try again.", "warn") });
      return;
    }
    const live = runScan(await getConnectors(), session, eventsFor(++scanRun), { only: scanSources });
    live.catch(() => undefined);
    const outcome = await Promise.race([live.then((result) => ({ result })), lost.then((reason) => ({ reason }))]);
    if (!("result" in outcome)) {
      scanRun++; // ignore the rest of the abandoned run
      set({ refreshing: false, stage: undefined, progress: undefined }); // the trace already says so
      return;
    }
    const { result } = outcome;
    set({
      refreshing: false,
      finishedAt: Date.now(),
      stage: undefined,
      progress: undefined,
      result,
      findings: result.findings,
      cleared: result.cleared,
      undecided: result.undecided,
      usedReplay: result.usedReplay,
      replay: endpoint.state === "forced" ? { why: "forced", detail: endpoint.detail } : undefined,
      trace: trace(`Checked again in ${((Date.now() - (state.startedAt ?? Date.now())) / 1000).toFixed(1)} s. Nothing was sent or changed.`, "good"),
    });
  } catch (error) {
    // Keep the last good results; just say the background check didn't finish.
    const message = error instanceof Error ? error.message : String(error);
    set({ refreshing: false, stage: undefined, progress: undefined, trace: trace(`The background check didn't finish: ${message}`, "bad") });
  } finally {
    quiet = false;
  }
}

// ---------- The model endpoint, for one check ----------

/** What each stage is doing, for "Lost the model endpoint while ...". */
const STAGE_DOING: Partial<Record<Stage, string>> = {
  extract: "reading the evidence",
  judge: "deciding and drafting",
  draft: "drafting",
};

/**
 * Checks the endpoint, says what it found in the trace, and returns the model
 * client for this check: live, or saved answers when the endpoint can't be used.
 */
async function openSession({ background = false } = {}) {
  set({ trace: trace("Checking the model endpoint") });
  const endpoint = await checkEndpoint();
  const start = usesReplay(endpoint.state) ? "replay" : "live";
  set({ trace: trace(endpointLine(endpoint), start === "replay" || endpoint.state === "slow" ? "warn" : "good") });
  if (start === "replay" && !background) set({ replay: { why: endpoint.state, detail: endpoint.detail } });
  // Resolves with the reason if the endpoint is lost partway through.
  let signalLost: (reason: string) => void = () => undefined;
  const lost = new Promise<string>((resolve) => (signalLost = resolve));
  const session = createModelSession({
    transport: tauriTransport,
    start,
    dropAfter: dropAfterCalls(),
    onLost: (reason) => {
      markLost(`Lost partway through a check: ${reason}.`);
      const doing = state.stage ? STAGE_DOING[state.stage] : undefined;
      const next = background ? "The last results stay." : "Starting the check again from saved answers.";
      set({ trace: trace(`Lost the model endpoint${doing ? ` while ${doing}` : ""}: ${reason}. ${next}`, "warn") });
      signalLost(reason);
    },
  });
  return { session, endpoint, lost };
}

/** Counts scan runs, so events from an abandoned run (after a lost endpoint) are ignored. */
let scanRun = 0;

function eventsFor(run: number) {
  return (event: AgentEvent) => {
    if (run === scanRun) onEvent(event);
  };
}

/** The trace line for the endpoint check. */
function endpointLine(e: EndpointStatus): string {
  switch (e.state) {
    case "live":
      return `Model endpoint answered in ${((e.ms ?? 0) / 1000).toFixed(1)} s`;
    case "slow":
      return `Model endpoint is slow today: ${e.detail ?? ""}`.trim();
    case "forced":
      return e.byFlag ? "Using saved answers only (started with LIFE_REPLAY=1)" : "Using saved answers only, as chosen";
    case "browser":
      return "Browser preview: using saved answers from an earlier run";
    default:
      return `${e.detail ?? "Couldn't use the model endpoint."} Using saved answers from an earlier run.`;
  }
}

/** The error when a check on saved answers finds none saved. */
function noSavedAnswers(e: EndpointStatus): string {
  if (e.state === "forced") return "There are no saved answers for this check yet. Turn off saved answers only (⌘⇧D, then M) and run a live check first.";
  if (e.state === "not_set_up") return "The model endpoint isn't set up, and there are no saved answers yet. Add BC_API_KEY to .env, then restart the app.";
  if (e.state === "key_rejected") return "The model endpoint didn't accept the API key, and there are no saved answers yet. Check BC_API_KEY in .env, then restart the app.";
  return "Couldn't reach the model endpoint, and there are no saved answers yet. Check the network, then press R.";
}

/**
 * After a restart, the drafts approved last time are put back in the Drafts
 * folder (the stand-in mailbox only lives in memory; a real one keeps them).
 * Runs once, after the first scan has drafted everything again.
 */
async function restoreDrafts(): Promise<void> {
  if (!restorePending) return;
  restorePending = false;
  const connectors = await getConnectors();
  const saved: Record<string, string> = {};
  for (const finding of state.findings) {
    if (state.decisions[finding.id] !== "approved") continue;
    const draft = withDecision(finding).draft;
    if (!draft) continue;
    try {
      saved[finding.id] = (await saveDraft(connectors, draft)).id;
    } catch {
      // Leave it approved; the draft can be saved again by undoing and approving.
    }
  }
  set({ saved });
}

/** Rebuilds the undo list from decisions kept across a restart, oldest first, so Cmd+Z still works. */
function restoreUndo(): UndoEntry[] {
  const LABEL: Record<Decision, string> = { approved: "Saved to Drafts", snoozed: "Snoozed", dismissed: "Not a leak", new: "" };
  return Object.entries(loadSaved().decisions)
    .filter(([, d]) => d !== "new")
    .sort(([a], [b]) => (state.decidedAt[a] ?? 0) - (state.decidedAt[b] ?? 0))
    .map(([findingId, d]) => ({
      findingId,
      before: "new" as Decision,
      label: LABEL[d],
      // The draft id is only known once restoreDrafts has saved it again.
      saving: d === "approved" ? waitForSaved(findingId) : undefined,
    }));
}

/** Resolves to the finding's saved draft id once there is one (or undefined if the first scan ends without one). */
function waitForSaved(findingId: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const check = () => {
      if (state.saved[findingId] && !restorePending) return resolve(state.saved[findingId]), true;
      if (!restorePending && state.phase !== "scanning") return resolve(undefined), true;
      return false;
    };
    if (check()) return;
    const stop = subscribe(() => {
      if (check()) stop();
    });
  });
}

/** How often the background check runs while the palette is hidden. */
export const BACKGROUND_EVERY_MS = 30 * 60 * 1000;

/**
 * Re-runs the check on a timer while the app sits in the menu bar. It waits
 * while the palette is open, so results never change under Maya's hands.
 * Returns a function that stops the timer.
 */
export function startBackgroundChecks(isHidden: () => boolean, everyMs = BACKGROUND_EVERY_MS): () => void {
  const timer = setInterval(() => {
    if (isHidden() && state.phase === "done") void startScan({ background: true });
  }, everyMs);
  return () => clearInterval(timer);
}

// ---------- What the UI shows ----------

/** A finding with Maya's decision applied. */
export function withDecision(f: Finding, s: ScanState = state): Finding {
  const status = s.decisions[f.id] ?? "new";
  const body = s.edits[f.id];
  return { ...f, status, draft: f.draft && body !== undefined ? { ...f.draft, body } : f.draft };
}

/** Still needing Maya first (most urgent first), then the ones she has dealt with. */
export function rankedFindings(s: ScanState): Finding[] {
  const all = rank(s.findings).map((f) => withDecision(f, s));
  return [...all.filter((f) => f.status === "new"), ...all.filter((f) => f.status !== "new")];
}

// ---------- Decisions, with undo ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export const TOAST_MS = 5_000;

function showToast(text: string, undoable: boolean) {
  clearTimeout(toastTimer);
  const toast = { id: nextId++, text, undoable };
  set({ toast });
  toastTimer = setTimeout(() => {
    if (state.toast?.id === toast.id) set({ toast: undefined });
  }, TOAST_MS);
}

export function dismissToast(): void {
  clearTimeout(toastTimer);
  set({ toast: undefined });
}

function decide(findingId: string, status: Decision, entry: Omit<UndoEntry, "findingId" | "before">) {
  const before = state.decisions[findingId] ?? "new";
  set({
    decisions: { ...state.decisions, [findingId]: status },
    decidedAt: { ...state.decidedAt, [findingId]: Date.now() },
    undo: [...state.undo, { findingId, before, ...entry }],
  });
}

/**
 * Approve: saves the drafted message to Maya's Drafts folder. Nothing is
 * sent. A finding with nothing to send (a "check this" case) is marked done.
 */
export async function approve(findingId: string): Promise<void> {
  const finding = state.findings.find((f) => f.id === findingId);
  if (!finding || (state.decisions[findingId] ?? "new") !== "new") return;
  const shown = withDecision(finding);
  if (finding.action.kind !== "none" && !shown.draft) {
    showToast("The draft is still being written. Try again in a moment.", false);
    return;
  }
  if (!shown.draft) {
    decide(findingId, "approved", { label: "Marked as handled" });
    showToast(`Marked ${finding.merchant} as handled.`, true);
    return;
  }
  // Show it as approved at once; the mailbox save happens behind it. If the
  // save fails, the decision is rolled back and Maya is told.
  const draft = shown.draft;
  const saving = getConnectors()
    .then((c) => saveDraft(c, draft))
    .then((saved) => {
      set({ saved: { ...state.saved, [findingId]: saved.id } });
      return saved.id;
    })
    .catch((error: unknown) => {
      const decisions = { ...state.decisions };
      delete decisions[findingId];
      set({ decisions, undo: state.undo.filter((u) => u.saving !== saving) });
      showToast(`Couldn't save the draft: ${error instanceof Error ? error.message : String(error)}`, false);
      return undefined;
    });
  decide(findingId, "approved", { saving, label: "Saved to Drafts" });
  showToast(`Saved to Drafts for ${draft.to.name}. Nothing was sent.`, true);
  await saving;
}

export function snooze(findingId: string): void {
  if ((state.decisions[findingId] ?? "new") !== "new") return;
  const f = state.findings.find((x) => x.id === findingId);
  decide(findingId, "snoozed", { label: "Snoozed" });
  showToast(`Snoozed ${f?.merchant ?? "it"}. It stays in the list, below the rest.`, true);
}

export function dismiss(findingId: string): void {
  if ((state.decisions[findingId] ?? "new") !== "new") return;
  const f = state.findings.find((x) => x.id === findingId);
  decide(findingId, "dismissed", { label: "Not a leak" });
  showToast(`Marked ${f?.merchant ?? "it"} as not a leak.`, true);
}

/** Puts back the most recent decision (and removes its saved draft, if any). */
export async function undoLast(): Promise<void> {
  const entry = state.undo[state.undo.length - 1];
  if (!entry) return;
  set({ undo: state.undo.slice(0, -1) });
  const savedId = entry.saving && (await entry.saving);
  if (savedId) {
    try {
      await discardSaved(await getConnectors(), savedId);
    } catch {
      // Already gone: nothing to remove.
    }
    const { [entry.findingId]: _gone, ...saved } = state.saved;
    set({ saved });
  }
  const decisions = { ...state.decisions };
  const decidedAt = { ...state.decidedAt };
  if (entry.before === "new") {
    delete decisions[entry.findingId];
    delete decidedAt[entry.findingId];
  } else decisions[entry.findingId] = entry.before;
  set({ decisions, decidedAt });
  const f = state.findings.find((x) => x.id === entry.findingId);
  showToast(savedId ? `Undone: the draft for ${f?.merchant} was removed from Drafts.` : `Undone: ${f?.merchant} is back in the list.`, false);
}

export function setEdit(findingId: string, body: string): void {
  set({ edits: { ...state.edits, [findingId]: body } });
}

export function resetEdit(findingId: string): void {
  const { [findingId]: _gone, ...edits } = state.edits;
  set({ edits });
}
