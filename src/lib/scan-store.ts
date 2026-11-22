// The scan as the UI sees it. Runs the agent (src/agent/pipeline.ts) and turns
// its stream of AgentEvents into one small state object: what is happening
// now, the findings so far, a readable trace, and Maya's decisions (approved,
// "not a leak"; older saved decisions can also be snoozed) with an undo list. React reads it with
// useSyncExternalStore, the same way as the connector store.
//
// Nothing here sends anything. Approving saves an email draft through the
// email connector, which has no send operation.
//
// Maya's decisions and edits are kept in localStorage, so they survive a
// restart. A background check (startBackgroundChecks) runs the scan again
// while the palette is hidden, and only swaps in the new results at the end.

import { createContext, useContext, useSyncExternalStore } from "react";
import { discardSaved, loadVoice, saveDraft } from "../agent/draft.ts";
import { rewriteDraft, type RewriteOutcome, type Verb } from "../agent/rewrite.ts";
import { copy } from "../copy.ts";
import type { Corpus } from "../agent/corpus.ts";
import { rank, runScan, type AgentEvent, type Cleared, type Finding, type ScanResult, type Stage } from "../agent/pipeline.ts";
import { calendarNeedsReconnect, getConnectors, markNeedsReconnect, reconnectCalendar, setConnectorStatus } from "../connectors/live.ts";
import { getPreferences } from "./preferences.ts";
import { ConnectorError } from "../connectors/runtime.ts";
import { reminderEvent, type Reminder } from "./reminders.ts";
import { newRule, returnedFindings, type CameBack, type Rule, type RuleReason } from "./rules.ts";
import { ruleUntil } from "../ui/rule-words.ts";
import { shortDate } from "../ui/format.ts";
import { chosenRoute, usesEmail } from "../ui/fix-route.ts";
import type { ConnectorId } from "../connectors/types.ts";
import { draftKey, keepVersion, shownDraft, showVerb, stepBack, versionsFor, type DraftVersions } from "./draft-versions.ts";
import { checkEndpoint, dropAfterCalls, getEndpoint, markLost, usesReplay, type EndpointState, type EndpointStatus } from "./endpoint.ts";
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

/**
 * What kind of message a toast is. Error: something failed. Warning: blocked
 * until Maya does something. Success: her action worked (Seal saved or noted
 * it, never that a business replied or money came back). Info: neutral.
 */
export type ToastTone = "error" | "warning" | "success" | "info";

export type Toast = {
  id: number;
  text: string;
  tone: ToastTone;
  undoable: boolean;
  /** The finding this toast is asking "why isn't it a leak?" about. It holds keys 1, 2 and 3 while it shows. */
  ask?: string;
  /** The finding whose remembered answer this toast confirms. Forgetting that answer clears the toast. */
  remembered?: string;
};

type UndoEntry = {
  /** A decision (approve, not a leak), a reminder Maya added, or a verb's rewrite. Decisions when absent. */
  kind?: "decision" | "reminder" | "rewrite";
  findingId: string;
  before: Decision;
  /** The remembered rule this decision replaced, put back by undo. */
  ruleBefore?: Rule;
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
  /** The sources the latest check read, so a changed switch can say it hasn't applied yet. */
  checkedSources?: ConnectorId[];
  /** Maya's choices, kept by finding id so they survive a re-scan. */
  decisions: Record<string, Decision>;
  /** Draft ids saved in the mailbox, by finding id (for undo). */
  saved: Record<string, string>;
  /** Draft bodies Maya edited, by finding id. */
  edits: Record<string, string>;
  /** When each decision was made (real time, for "4 min ago" on the timeline). */
  decidedAt: Record<string, number>;
  /** Calendar reminders Maya asked for (L), by finding id. */
  reminders: Record<string, Reminder>;
  /** The way of fixing each finding Maya picked (1-4), by finding id. None: the recommended one. */
  routes: Record<string, string>;
  /** Firmer and Shorter versions of each draft, by finding id. */
  rewrites: Record<string, DraftVersions>;
  /** The verb being written right now, by finding id. */
  rewriting: Record<string, Verb>;
  /** What Seal remembers about each finding marked "Not a leak", by finding id. */
  rules: Record<string, Rule>;
  /** Findings set aside that this check shows again, and why. Worked out from `rules`, never saved. */
  returned: Record<string, CameBack>;
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

const REMINDERS_KEY = "life.reminders";

function loadReminders(): Record<string, Reminder> {
  try {
    const raw = JSON.parse(localStorage.getItem(REMINDERS_KEY) ?? "null") as { v?: number; reminders?: Record<string, Reminder> } | null;
    return raw?.v === 1 && raw.reminders ? raw.reminders : {};
  } catch {
    return {};
  }
}

function persistReminders(reminders: Record<string, Reminder>) {
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify({ v: 1, reminders }));
  } catch {
    // Storage can be unavailable; reminders then last until the app quits.
  }
}

const ROUTES_KEY = "life.routes";

function loadRoutes(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ROUTES_KEY) ?? "null") as { v?: number; routes?: Record<string, string> } | null;
    return raw?.v === 1 && raw.routes ? raw.routes : {};
  } catch {
    return {};
  }
}

function persistRoutes(routes: Record<string, string>) {
  try {
    localStorage.setItem(ROUTES_KEY, JSON.stringify({ v: 1, routes }));
  } catch {
    // Storage can be unavailable; the choice then lasts until the app quits.
  }
}

const REWRITES_KEY = "life.rewrites";

function loadRewrites(): Record<string, DraftVersions> {
  try {
    const raw = JSON.parse(localStorage.getItem(REWRITES_KEY) ?? "null") as { v?: number; rewrites?: Record<string, DraftVersions> } | null;
    return raw?.v === 1 && raw.rewrites ? raw.rewrites : {};
  } catch {
    return {};
  }
}

function persistRewrites(rewrites: Record<string, DraftVersions>) {
  try {
    localStorage.setItem(REWRITES_KEY, JSON.stringify({ v: 1, rewrites }));
  } catch {
    // Storage can be unavailable; rewrites then last until the app quits.
  }
}

const RULES_KEY = "life.rules";

function loadRules(): Record<string, Rule> {
  try {
    const raw = JSON.parse(localStorage.getItem(RULES_KEY) ?? "null") as { v?: number; rules?: Record<string, Rule> } | null;
    return raw?.v === 1 && raw.rules ? raw.rules : {};
  } catch {
    return {};
  }
}

function persistRules(rules: Record<string, Rule>) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify({ v: 1, rules }));
  } catch {
    // Storage can be unavailable; rules then last until the app quits.
  }
}

/** True until the first scan after launch has put the reminders back in the calendar (the stand-in calendar lives in memory). */
let remindersPending = Object.keys(loadReminders()).length > 0;

let state: ScanState = {
  phase: "idle",
  refreshing: false,
  findings: [],
  cleared: [],
  undecided: [],
  usedReplay: false,
  trace: [],
  ...loadSaved(),
  reminders: loadReminders(),
  routes: loadRoutes(),
  rewrites: loadRewrites(),
  rewriting: {},
  rules: loadRules(),
  returned: {},
  undo: [],
};
const listeners = new Set<() => void>();
let nextId = 1;
state = { ...state, undo: restoreUndo() };

// ---------- Which sources a check reads ----------

/**
 * The sources the user connected (set by onboarding). Undefined means all four,
 * for installs from before onboarding. Empty means setup was skipped with nothing
 * connected, so a check has nothing it's allowed to read.
 */
let scanSources: ConnectorId[] | undefined;

/** Onboarding tells the scan which sources are connected; every later check reads only those. */
export function setScanSources(ids: ConnectorId[] | undefined): void {
  scanSources = ids;
}

/** True when setup was skipped and no source has been connected since. */
export function nothingConnected(): boolean {
  return scanSources?.length === 0;
}

const ALL_SOURCES: ConnectorId[] = ["bank", "email", "documents", "calendar"];

/** True when the sources switched on differ from the ones the latest check read. */
export function sourcesChanged(on: ConnectorId[], s: ScanState = state): boolean {
  const checked = s.checkedSources;
  if (!checked) return false;
  return checked.length !== on.length || checked.some((id) => !on.includes(id));
}

/**
 * Sync everything: reads every connected source and runs the whole check (R,
 * the top bar's button, the Connectors menu). Signs the calendar back in first
 * if it needs it.
 */
export async function syncEverything(): Promise<void> {
  if (state.phase === "scanning" || state.refreshing) return;
  if (nothingConnected()) return showToast(copy.toasts.connectFirst, "warning");
  if (calendarNeedsReconnect()) await reconnectCalendar();
  await startScan();
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
  for (const r of Object.values(state.reminders)) {
    if (r.eventId) await (await getConnectors()).calendar.deleteEvent(r.eventId).catch(() => undefined);
  }
  restorePending = false;
  remindersPending = false;
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
    checkedSources: undefined,
    decisions: {},
    saved: {},
    edits: {},
    decidedAt: {},
    reminders: {},
    routes: {},
    rewrites: {},
    rewriting: {},
    rules: {},
    returned: {},
    undo: [],
    toast: undefined,
  });
  rewritesRunning.clear();
  return true;
}

function set(change: Partial<ScanState>) {
  state = { ...state, ...change };
  // Which findings have come back follows from the findings, the bank data and the rules.
  if ("findings" in change || "corpus" in change || "rules" in change) {
    state = { ...state, returned: returnedFindings(state.findings, state.rules, state.corpus) };
  }
  if (("decisions" in change || "edits" in change || "saved" in change || "decidedAt" in change)) persist(state);
  if ("reminders" in change) persistReminders(state.reminders);
  if ("routes" in change) persistRoutes(state.routes);
  if ("rewrites" in change) persistRewrites(state.rewrites);
  if ("rules" in change) persistRules(state.rules);
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
const STAGE_TEXT: Record<Stage, string> = copy.trace.stage;

function trace(text: string, tone: TraceLine["tone"] = "info"): TraceLine[] {
  const t = Date.now() - (state.startedAt ?? Date.now());
  return [...state.trace, { id: nextId++, t, text, tone }];
}

/** Each connector's last state, to notice when a retry starts and ends. */
const connectorState: Partial<Record<string, string>> = {};

/** True while the scan running now is a background one: its findings wait until it finishes. */
let quiet = false;
/** What a background check read. It replaces the data on screen along with the findings, at the end. */
let quietCorpus: Corpus | undefined;

function onEvent(event: AgentEvent) {
  if (quiet && event.type === "corpus") quietCorpus = event.corpus;
  // A background check keeps the last results on screen: only the connector
  // chips and the trace follow along.
  if (quiet && (event.type === "corpus" || event.type === "finding" || event.type === "draft" || event.type === "routes" || event.type === "cleared" || event.type === "progress")) return;
  switch (event.type) {
    case "connector": {
      const before = connectorState[event.status.id];
      connectorState[event.status.id] = event.status.state;
      setConnectorStatus(event.status);
      // Say so in the trace when a source asks us to wait, and when it lets us carry on.
      if (event.status.state === "retrying" && before !== "retrying") {
        const seconds = Math.max(1, Math.round(((event.status.retryAt ?? Date.now()) - Date.now()) / 1000));
        set({ trace: trace(copy.trace.slowDown(event.status.name, seconds), "warn") });
      }
      if (before === "retrying" && event.status.state !== "retrying" && event.status.state !== "error") {
        set({ trace: trace(copy.trace.answeredAgain(event.status.name)) });
      }
      if (event.status.state === "needs_reconnect") set({ trace: trace(copy.trace.needsReconnect(event.status.name), "warn") });
      if (event.status.state === "error") set({ trace: trace(copy.trace.couldntRead(event.status.name), "bad") });
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
        trace: trace(copy.trace.found(event.finding.title), "warn"),
      });
      return;
    case "draft":
      set({
        findings: state.findings.map((f) => (f.id === event.findingId ? { ...f, draft: event.draft } : f)),
        usedReplay: state.usedReplay || event.draft.source === "cache",
        trace: trace(
          event.draft.grounded ? copy.trace.drafted(event.draft.to.name) : copy.trace.draftedUnchecked(event.draft.to.name),
          event.draft.grounded ? "good" : "warn",
        ),
      });
      return;
    case "routes": {
      const merchant = state.findings.find((f) => f.id === event.findingId)?.merchant ?? "";
      const best = event.plan.routes.find((r) => r.id === event.plan.recommendedId)?.label ?? "";
      set({
        findings: state.findings.map((f) => (f.id === event.findingId ? { ...f, fix: event.plan } : f)),
        usedReplay: state.usedReplay || event.plan.source === "cache",
        trace: trace(
          event.plan.grounded ? copy.trace.routed(merchant, best) : copy.trace.routedUnchecked(merchant, best),
          event.plan.grounded ? "good" : "warn",
        ),
      });
      return;
    }
    case "cleared":
      set({ cleared: [...state.cleared, event.cleared], trace: trace(copy.trace.looksFine(event.cleared.merchant, event.cleared.why), "good") });
      return;
    case "problem":
      set({ trace: trace(event.message, "bad") });
      return;
  }
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One plain trace line when something Maya told Seal applied to this check. */
function noteRules(findings: Finding[], corpus: Corpus | undefined) {
  const applied = findings.filter((f) => state.rules[f.id]?.reason && state.decisions[f.id] === "dismissed");
  if (!applied.length) return;
  const back = returnedFindings(applied, state.rules, corpus);
  const names = applied.filter((f) => back[f.id]).map((f) => f.merchant);
  set({ trace: trace(copy.trace.remembered(applied.length - names.length, names), names.length ? "warn" : "info") });
}

// ---------- Running ----------

/**
 * Runs the whole check. Calls made while one is running are ignored.
 * `background`: keep showing the last results while it runs (used by the timer).
 */
export async function startScan({ background = false } = {}): Promise<void> {
  if (state.phase === "scanning" || state.refreshing || nothingConnected()) return;
  // Noted before either kind of check starts, so a switch flipped later shows as waiting.
  set({ checkedSources: scanSources ?? ALL_SOURCES });
  if (background && state.phase === "done") {
    return runBackground();
  }
  // A full check replaces the drafts, so a rewrite still being written no longer applies.
  rewritesRunning.clear();
  set({
    rewriting: {},
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
    noteRules(result.findings, state.corpus);
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
      trace: trace(copy.trace.done(Date.now() - (state.startedAt ?? Date.now())), "good"),
    });
    forgetOldRewrites();
    await restoreDrafts();
    await restoreReminders();
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
  quietCorpus = undefined;
  set({ refreshing: true, startedAt: Date.now(), trace: [] });
  set({ trace: trace(copy.trace.backgroundStart) });
  try {
    const { session, endpoint, lost } = await openSession({ background: true });
    // A background check is for fresh answers: with the endpoint down it waits for next time.
    if (usesReplay(endpoint.state) && endpoint.state !== "forced") {
      set({ refreshing: false, trace: trace(copy.trace.backgroundNoEndpoint, "warn") });
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
    // The rules need this check's bank rows, or they could never see a new charge.
    const corpus = quietCorpus ?? state.corpus;
    noteRules(result.findings, corpus);
    set({
      refreshing: false,
      finishedAt: Date.now(),
      stage: undefined,
      progress: undefined,
      result,
      corpus,
      findings: result.findings,
      cleared: result.cleared,
      undecided: result.undecided,
      usedReplay: result.usedReplay,
      replay: endpoint.state === "forced" ? { why: "forced", detail: endpoint.detail } : undefined,
      trace: trace(copy.trace.checkedAgain(Date.now() - (state.startedAt ?? Date.now())), "good"),
    });
    forgetOldRewrites();
  } catch (error) {
    // Keep the last good results; just say the background check didn't finish.
    const message = error instanceof Error ? error.message : String(error);
    set({ refreshing: false, stage: undefined, progress: undefined, trace: trace(copy.trace.backgroundFailed(message), "bad") });
  } finally {
    quiet = false;
  }
}

// ---------- The model endpoint, for one check ----------

/** What each stage is doing, for "Lost the model endpoint while ...". */
const STAGE_DOING: Partial<Record<Stage, string>> = copy.trace.doing;

/**
 * Checks the endpoint, says what it found in the trace, and returns the model
 * client for this check: live, or saved answers when the endpoint can't be used.
 */
async function openSession({ background = false } = {}) {
  set({ trace: trace(copy.trace.checkingEndpoint) });
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
      markLost(copy.endpoint.lostPartway(reason));
      const doing = state.stage ? STAGE_DOING[state.stage] : undefined;
      set({ trace: trace(copy.trace.lost(doing, reason, background), "warn") });
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
      return copy.trace.endpointLive(e.ms ?? 0);
    case "slow":
      return copy.trace.endpointSlow(e.detail ?? "");
    case "forced":
      return e.byFlag ? copy.trace.savedOnlyByFlag : copy.trace.savedOnlyChosen;
    case "browser":
      return copy.trace.browser;
    default:
      return copy.trace.endpointFallback(e.detail);
  }
}

/** The error when a check on saved answers finds none saved. */
function noSavedAnswers(e: EndpointStatus): string {
  if (e.state === "forced") return copy.endpoint.noSavedAnswers.forced;
  if (e.state === "not_set_up") return copy.endpoint.noSavedAnswers.not_set_up;
  if (e.state === "key_rejected") return copy.endpoint.noSavedAnswers.key_rejected;
  return copy.endpoint.noSavedAnswers.offline;
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

/**
 * After a restart, the reminders added last time are put back in the
 * calendar (the stand-in calendar only lives in memory; a real one keeps
 * them). Each gets a new event id. One that can't be added (calendar signed
 * out) stays in the list without an id, so undo still clears it.
 */
async function restoreReminders(): Promise<void> {
  if (!remindersPending) return;
  remindersPending = false;
  const connectors = await getConnectors();
  const reminders: Record<string, Reminder> = {};
  for (const [findingId, r] of Object.entries(state.reminders)) {
    try {
      const event = await connectors.calendar.createEvent({ ...reminderInput(findingId, r), start: r.date });
      reminders[findingId] = { ...r, eventId: event.eventId };
    } catch {
      reminders[findingId] = { ...r, eventId: undefined };
    }
  }
  set({ reminders });
}

/** The event to put back for a kept reminder: its own date and title, the finding's words for the notes. */
function reminderInput(findingId: string, r: Reminder) {
  const finding = state.findings.find((f) => f.id === findingId);
  return {
    calendar: copy.reminders.calendar,
    title: r.title,
    allDay: true,
    notes: finding ? copy.reminders.notes(finding.title) : undefined,
  };
}

/** Rebuilds the undo list from decisions and reminders kept across a restart, oldest first, so Cmd+Z still works. */
function restoreUndo(): UndoEntry[] {
  const LABEL: Record<Decision, string> = copy.toasts.decision;
  const decisions = Object.entries(loadSaved().decisions)
    .filter(([, d]) => d !== "new")
    .map(([findingId, d]) => ({
      at: state.decidedAt[findingId] ?? 0,
      entry: {
        findingId,
        before: "new" as Decision,
        label: LABEL[d],
        // The draft id is only known once restoreDrafts has saved it again.
        saving: d === "approved" ? waitForSaved(findingId) : undefined,
      } as UndoEntry,
    }));
  const reminders = Object.entries(loadReminders()).map(([findingId, r]) => ({
    at: r.at,
    entry: { kind: "reminder", findingId, before: "new", label: copy.toasts.decision.reminder } as UndoEntry,
  }));
  const rewrites = Object.entries(loadRewrites()).flatMap(([findingId, entry]) =>
    entry.trail.map((step) => ({
      at: step.at,
      entry: { kind: "rewrite", findingId, before: "new", label: copy.toasts.decision.rewrite } as UndoEntry,
    })),
  );
  return [...decisions, ...reminders, ...rewrites].sort((a, b) => a.at - b.at).map((x) => x.entry);
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
    // Settings can turn the timed check off.
    if (isHidden() && state.phase === "done" && getPreferences().backgroundChecks) void startScan({ background: true });
  }, everyMs);
  return () => clearInterval(timer);
}

// ---------- What the UI shows ----------

/** Where a finding stands now. One she set aside that has come back needs her again. */
export function statusOf(findingId: string, s: ScanState = state): Decision {
  const decision = s.decisions[findingId] ?? "new";
  return decision === "dismissed" && s.returned[findingId] ? "new" : decision;
}

/** A finding with Maya's decision applied. */
export function withDecision(f: Finding, s: ScanState = state): Finding {
  const status = statusOf(f.id, s);
  const body = s.edits[f.id];
  // The version on screen (Seal's, or a verb's rewrite), then Maya's own edits on top.
  const draft = shownDraft(f.draft, s.rewrites[f.id], status === "approved");
  return { ...f, status, draft: draft && body !== undefined ? { ...draft, body } : draft };
}

/** Maya changed the draft's text ("Edited by you", Revert). */
export function isEdited(findingId: string, s: ScanState = state): boolean {
  return s.edits[findingId] !== undefined;
}

/** Still needing Maya first (most urgent first), then the ones she has dealt with. */
export function rankedFindings(s: ScanState): Finding[] {
  const all = rank(s.findings).map((f) => withDecision(f, s));
  return [...all.filter((f) => f.status === "new"), ...all.filter((f) => f.status !== "new")];
}

// ---------- Decisions, with undo ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export const TOAST_MS = 5_000;

function showToast(text: string, tone: ToastTone, undoable = false, ask?: string, remembered?: string) {
  clearTimeout(toastTimer);
  const toast: Toast = { id: nextId++, text, tone, undoable, ask, remembered };
  set({ toast });
  toastTimer = setTimeout(() => {
    if (state.toast?.id === toast.id) set({ toast: undefined });
  }, TOAST_MS);
}

export function dismissToast(): void {
  clearTimeout(toastTimer);
  set({ toast: undefined });
}

/**
 * Records a decision. `rule` is what a new "Not a leak" remembers. Any other
 * decision ends the old rule, and undo puts it back.
 */
function decide(findingId: string, status: Decision, entry: Omit<UndoEntry, "findingId" | "before" | "ruleBefore">, rule?: Rule) {
  const before = state.decisions[findingId] ?? "new";
  const ruleBefore = state.rules[findingId];
  const { [findingId]: _old, ...rules } = state.rules;
  set({
    decisions: { ...state.decisions, [findingId]: status },
    decidedAt: { ...state.decidedAt, [findingId]: Date.now() },
    rules: rule ? { ...rules, [findingId]: rule } : rules,
    undo: [...state.undo, { findingId, before, ruleBefore, ...entry }],
  });
}

/**
 * Approve: saves the drafted message to Maya's Drafts folder. Nothing is
 * sent. A finding with nothing to send (a "check this" case) is marked done.
 */
export async function approve(findingId: string): Promise<void> {
  const finding = state.findings.find((f) => f.id === findingId);
  if (!finding || statusOf(findingId) !== "new") return;
  // Approving takes the version on screen: a rewrite still being written is ignored.
  cancelRewrite(findingId);
  const shown = withDecision(finding);
  // The route is fixed by approving. Only Email saves a draft: a call, chat or
  // online step is Maya's to do, so nothing goes to the mailbox.
  const route = chosenRoute(shown, state);
  if (route) set({ routes: { ...state.routes, [findingId]: route.id } });
  if (route && route.kind !== "email") {
    decide(findingId, "approved", { label: copy.toasts.decision.route });
    showToast(copy.toasts.routeReady[route.kind](route.provider), "success", true);
    return;
  }
  if (finding.action.kind !== "none" && !shown.draft) {
    showToast(copy.toasts.stillWriting, "warning");
    return;
  }
  if (!shown.draft) {
    decide(findingId, "approved", { label: copy.toasts.decision.handled });
    showToast(copy.toasts.markedHandled(finding.merchant), "success", true);
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
      // Back to how it was, including a finding that had come back after being set aside.
      const entry = state.undo.find((u) => u.saving === saving);
      const decisions = { ...state.decisions };
      if (entry && entry.before !== "new") decisions[findingId] = entry.before;
      else delete decisions[findingId];
      const rules = entry?.ruleBefore ? { ...state.rules, [findingId]: entry.ruleBefore } : state.rules;
      set({ decisions, rules, undo: state.undo.filter((u) => u.saving !== saving) });
      showToast(copy.toasts.couldntSave(error instanceof Error ? error.message : String(error)), "error");
      return undefined;
    });
  decide(findingId, "approved", { saving, label: copy.toasts.decision.approved });
  showToast(copy.toasts.savedToDrafts(draft.to.name), "success", true);
  await saving;
}

/**
 * Not a leak: done at once. The toast then asks why, and ignoring it is fine.
 * What the bank shows now is noted either way, so a reason added later still
 * compares against this moment.
 */
export function dismiss(findingId: string): void {
  if (statusOf(findingId) !== "new") return;
  cancelRewrite(findingId);
  const f = state.findings.find((x) => x.id === findingId);
  decide(findingId, "dismissed", { label: copy.toasts.decision.dismissed }, f && newRule(f, state.corpus, Date.now()));
  showToast(copy.toasts.dismissed(f?.merchant ?? copy.toasts.it), "success", true, f && findingId);
}

/** Maya says why it isn't a leak (keys 1-3, from the toast or the dismissed finding). */
export function rememberWhy(findingId: string, reason: RuleReason): void {
  if (statusOf(findingId) !== "dismissed") return;
  const finding = state.findings.find((f) => f.id === findingId);
  // A dismissal saved before rules existed has no record yet, so it starts from this check.
  const rule = state.rules[findingId] ?? (finding && newRule(finding, state.corpus, Date.now()));
  if (!rule) return;
  // The case on screen is the one she's answering about, even if a later check named its kind differently.
  const next: Rule = { ...rule, reason, kind: finding?.kind ?? rule.kind };
  set({ rules: { ...state.rules, [findingId]: next } });
  // Undo in the toast takes back the newest action, so it's only offered when that is this dismissal.
  const top = state.undo[state.undo.length - 1];
  const undoable = top?.findingId === findingId && (top.kind ?? "decision") === "decision";
  showToast(copy.rules.remembered(ruleUntil(next)), "success", undoable, undefined, findingId);
}

/** Deletes a remembered rule (Settings): its finding comes back straight away. */
export function forgetRule(findingId: string): void {
  if (!state.rules[findingId]) return;
  const { [findingId]: _gone, ...rules } = state.rules;
  const change: Partial<ScanState> = { rules };
  if (state.decisions[findingId] === "dismissed") {
    const { [findingId]: _decision, ...decisions } = state.decisions;
    const { [findingId]: _when, ...decidedAt } = state.decidedAt;
    change.decisions = decisions;
    change.decidedAt = decidedAt;
    // Nothing is left for ⌘Z to take back on this finding.
    change.undo = state.undo.filter((u) => u.findingId !== findingId || (u.kind ?? "decision") !== "decision");
  }
  // A toast still asking about this answer, or confirming it, no longer applies (its Undo would take back something else).
  if (state.toast?.ask === findingId || state.toast?.remembered === findingId) {
    clearTimeout(toastTimer);
    change.toast = undefined;
  }
  set(change);
}

/** Puts back the most recent decision (and removes its saved draft, if any), or removes the last reminder. */
export async function undoLast(): Promise<void> {
  // A rewrite still being written is the newest thing to take back.
  const writing = Object.keys(state.rewriting)[0];
  if (writing) {
    cancelRewrite(writing);
    return showToast(copy.verbs.stopped, "info");
  }
  const entry = state.undo[state.undo.length - 1];
  if (!entry) return;
  // Maya's own edits sit on top of this rewrite, so going back would mix the two.
  if (entry.kind === "rewrite" && state.edits[entry.findingId] !== undefined) {
    const merchant = state.findings.find((x) => x.id === entry.findingId)?.merchant ?? copy.toasts.it;
    return showToast(copy.verbs.revertEditsFirst(merchant), "warning");
  }
  set({ undo: state.undo.slice(0, -1) });
  if (entry.kind === "reminder") return removeReminder(entry.findingId);
  if (entry.kind === "rewrite") return goBackOneVersion(entry.findingId);
  const savedId = await revert(entry);
  const f = state.findings.find((x) => x.id === entry.findingId);
  showToast(savedId ? copy.toasts.undoneDraft(f?.merchant) : copy.toasts.undone(f?.merchant), "info");
}

/**
 * Edit on an approved finding: takes the approval back (and its draft out of
 * Drafts), so Maya can change the draft and approve it again. Returns false
 * when it isn't approved.
 */
export async function reopen(findingId: string): Promise<boolean> {
  if (state.decisions[findingId] !== "approved") return false;
  // Its latest decision in the undo list (it may be gone after a restart).
  let at = state.undo.length - 1;
  while (at >= 0 && (state.undo[at].findingId !== findingId || (state.undo[at].kind ?? "decision") !== "decision")) at--;
  const entry: UndoEntry = at >= 0 ? state.undo[at] : { findingId, before: "new", label: "" };
  if (at >= 0) set({ undo: state.undo.filter((_, i) => i !== at) });
  await revert(entry);
  showToast(copy.toasts.reopened, "info");
  return true;
}

/** Shows a short message in the toast (the Seal button's notes), with no Undo. */
export function notify(text: string, tone: ToastTone): void {
  showToast(text, tone);
}

/** Puts a decision back as it was before, removing its saved draft. Returns the draft's id if one was removed. */
async function revert(entry: UndoEntry): Promise<string | undefined> {
  const savedId = (entry.saving && (await entry.saving)) || state.saved[entry.findingId];
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
  // The dismissal and its rule go together, as one step.
  const { [entry.findingId]: _rule, ...rules } = state.rules;
  set({ decisions, decidedAt, rules: entry.ruleBefore ? { ...rules, [entry.findingId]: entry.ruleBefore } : rules });
  return savedId;
}

// ---------- Remind me (L) ----------

/** Findings mid-way through being added, so a second L press doesn't add two. */
const adding = new Set<string>();

/** Why a reminder can't be added for this finding right now, or undefined if it can. */
export function cannotRemind(findingId: string, s: ScanState = state): string | undefined {
  if (s.result?.notConnected?.includes("calendar")) return copy.toasts.reminderNoCalendar;
  const status = statusOf(findingId, s);
  if (status !== "new" && status !== "approved") return copy.toasts.reminderNotNow;
  return undefined;
}

/**
 * Adds an all-day reminder to Maya's calendar for this finding, only because
 * she pressed L. Nothing is sent. Cmd+Z removes it again.
 */
export async function remind(findingId: string): Promise<void> {
  const finding = state.findings.find((f) => f.id === findingId);
  if (!finding || adding.has(findingId)) return;
  const existing = state.reminders[findingId];
  if (existing) return showToast(copy.toasts.reminderAlready(shortDate(existing.date)), "info");
  const why = cannotRemind(findingId);
  if (why) return showToast(why, "warning");
  const input = reminderEvent(finding, state.decisions[findingId] === "approved");
  adding.add(findingId);
  try {
    const event = await (await getConnectors()).calendar.createEvent(input);
    const reminder: Reminder = { eventId: event.eventId, date: input.start, title: input.title, at: Date.now() };
    set({
      reminders: { ...state.reminders, [findingId]: reminder },
      undo: [...state.undo, { kind: "reminder", findingId, before: state.decisions[findingId] ?? "new", label: copy.toasts.decision.reminder }],
    });
    showToast(copy.toasts.reminderAdded(shortDate(input.start)), "success", true);
  } catch (error) {
    const reauth = error instanceof ConnectorError && error.code === "unauthorized";
    if (reauth) markNeedsReconnect("calendar", error.message);
    showToast(reauth ? copy.toasts.reminderReauth : copy.toasts.reminderFailed(error instanceof Error ? error.message : String(error)), "error");
  } finally {
    adding.delete(findingId);
  }
}

/** Takes a reminder out of the calendar and the list (undo). */
async function removeReminder(findingId: string, toast: (merchant: string) => string = copy.toasts.undoneReminder): Promise<void> {
  const reminder = state.reminders[findingId];
  if (!reminder) return;
  if (reminder.eventId) {
    try {
      await (await getConnectors()).calendar.deleteEvent(reminder.eventId);
    } catch {
      // The calendar is signed out or it's already gone; still forget it here.
    }
  }
  const { [findingId]: _gone, ...reminders } = state.reminders;
  set({ reminders });
  const f = state.findings.find((x) => x.id === findingId);
  showToast(toast(f?.merchant ?? copy.toasts.it), "info");
}

/**
 * Remove reminder (the button on the reminder notice, or L again inside the
 * finding): takes it out of the calendar, and out of the undo list so ⌘Z
 * doesn't try to remove it twice. Remind me comes back.
 */
export async function cancelReminder(findingId: string): Promise<void> {
  set({ undo: state.undo.filter((u) => !(u.kind === "reminder" && u.findingId === findingId)) });
  await removeReminder(findingId, copy.toasts.reminderRemoved);
}

/** Picks a way of fixing a finding (1-4). Fixed once approved: ⌘Z first to change it. */
export function chooseRoute(findingId: string, routeId: string): void {
  if (statusOf(findingId) !== "new" || state.routes[findingId] === routeId) return;
  set({ routes: { ...state.routes, [findingId]: routeId } });
}

export function setEdit(findingId: string, body: string): void {
  set({ edits: { ...state.edits, [findingId]: body } });
}

/** Revert: back to the agent's draft. */
export function resetEdit(findingId: string): void {
  const { [findingId]: _gone, ...edits } = state.edits;
  set({ edits });
}

// ---------- Draft verbs (Firmer, Shorter) ----------

/** The latest run for each finding. A result from any other run is late, so it isn't shown. */
const rewritesRunning = new Map<string, number>();
let rewriteRun = 0;

/** A call that takes this long has stopped being a quick rewrite. */
const REWRITE_LIMIT_MS = 30_000;

/** Why this finding's draft can't be rewritten right now, or undefined if it can. */
export function cannotRewrite(findingId: string, s: ScanState = state): string | undefined {
  const finding = s.findings.find((f) => f.id === findingId);
  if (!finding?.draft) return copy.verbs.noDraft;
  if (s.phase === "scanning" || !s.corpus) return copy.verbs.waitForCheck;
  if (statusOf(findingId, s) !== "new") return copy.verbs.alreadyDecided;
  if (!usesEmail(withDecision(finding, s), s)) return copy.verbs.emailOnly;
  if (s.edits[findingId] !== undefined) return copy.verbs.revertFirst;
  return undefined;
}

/** Stops waiting for a rewrite. If it arrives later it's kept for next time, but not shown. */
export function cancelRewrite(findingId: string): void {
  if (!state.rewriting[findingId]) return;
  rewritesRunning.delete(findingId);
  const { [findingId]: _gone, ...rewriting } = state.rewriting;
  set({ rewriting });
}

/**
 * A verb's key or button. Pressing the verb on screen goes back to the version
 * before it, a version already written comes back at once, and anything else
 * asks the model.
 */
export function pressVerb(findingId: string, verb: Verb): void {
  const why = cannotRewrite(findingId);
  if (why) return showToast(why, "warning");
  const finding = state.findings.find((f) => f.id === findingId)!;
  const original = finding.draft!;
  // Pressed again while it's being written: stop waiting.
  if (state.rewriting[findingId] === verb) return cancelRewrite(findingId);
  cancelRewrite(findingId);
  const entry = versionsFor(original, state.rewrites[findingId]);
  if (entry?.active === verb) {
    let at = state.undo.length - 1;
    while (at >= 0 && !(state.undo[at].kind === "rewrite" && state.undo[at].findingId === findingId)) at--;
    if (at >= 0) set({ undo: state.undo.filter((_, i) => i !== at) });
    return goBackOneVersion(findingId);
  }
  if (entry?.versions[verb]) return putOnScreen(findingId, entry, verb);
  void writeRewrite(finding, verb);
}

function putOnScreen(findingId: string, entry: DraftVersions, verb: Verb) {
  set({
    rewrites: { ...state.rewrites, [findingId]: showVerb(entry, verb, Date.now()) },
    undo: [...state.undo, { kind: "rewrite", findingId, before: state.decisions[findingId] ?? "new", label: copy.toasts.decision.rewrite }],
  });
}

function goBackOneVersion(findingId: string) {
  const entry = state.rewrites[findingId];
  if (!entry) return;
  const back = stepBack(entry);
  set({ rewrites: { ...state.rewrites, [findingId]: back } });
  showToast(back.active ? copy.verbs.backToVerb(copy.verbs.name[back.active]) : copy.verbs.backToOriginal, "info");
}

async function writeRewrite(finding: Finding, verb: Verb): Promise<void> {
  const id = finding.id;
  const original = finding.draft!;
  const run = ++rewriteRun;
  rewritesRunning.set(id, run);
  set({ rewriting: { ...state.rewriting, [id]: verb } });

  // Live, unless this app is on saved answers. A saved answer says so on screen.
  const session = createModelSession({
    transport: tauriTransport,
    start: usesReplay(getEndpoint().state) ? "replay" : "live",
    callLimitMs: REWRITE_LIMIT_MS,
  });
  let outcome: RewriteOutcome;
  try {
    const voice = await loadVoice(await getConnectors());
    outcome = await rewriteDraft(session, finding, original, state.corpus!, voice, verb);
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    outcome = { ok: false, why: "failed", problems: [problem], attempts: [] };
  }

  const latest = rewritesRunning.get(id) === run;
  if (latest) cancelRewrite(id);
  // A new check may have written a different draft while this one was on its way.
  const current = state.findings.find((f) => f.id === id)?.draft;
  const sameDraft = !!current && draftKey(current) === draftKey(original);
  if (outcome.ok && sameDraft) {
    set({ rewrites: { ...state.rewrites, [id]: keepVersion(state.rewrites[id], original, verb, outcome.version) } });
  }
  if (!latest) return;
  if (!outcome.ok) {
    const name = copy.verbs.name[verb];
    const offline = outcome.why === "no_saved";
    // No saved version while the model is fine is a limit of being offline, not a failure.
    if (offline && !session.lost()) return showToast(copy.verbs.notOffline(name), "warning");
    return showToast(offline ? copy.verbs.unreachable(name) : copy.verbs.failed(name), "error");
  }
  if (sameDraft && statusOf(id) === "new" && state.edits[id] === undefined) {
    putOnScreen(id, state.rewrites[id], verb);
  }
}

/** After a check: rewrites of a draft that has since changed no longer apply (an approved one stays as approved). */
function forgetOldRewrites() {
  const rewrites = { ...state.rewrites };
  for (const [id, entry] of Object.entries(rewrites)) {
    const draft = state.findings.find((f) => f.id === id)?.draft;
    if (draft && !versionsFor(draft, entry) && state.decisions[id] !== "approved") delete rewrites[id];
  }
  if (Object.keys(rewrites).length === Object.keys(state.rewrites).length) return;
  set({ rewrites, undo: state.undo.filter((u) => u.kind !== "rewrite" || rewrites[u.findingId]) });
}
