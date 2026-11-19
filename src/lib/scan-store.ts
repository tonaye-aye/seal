// The scan as the UI sees it. Runs the agent (src/agent/pipeline.ts) and turns
// its stream of AgentEvents into one small state object: what is happening
// now, the findings so far, a readable trace, and Maya's decisions (approved,
// snoozed, "not a leak") with an undo list. React reads it with
// useSyncExternalStore, the same way as the connector store.
//
// Nothing here sends anything. Approving saves an email draft through the
// email connector, which has no send operation.

import { useSyncExternalStore } from "react";
import { discardSaved, saveDraft } from "../agent/draft.ts";
import type { Corpus } from "../agent/corpus.ts";
import { rank, runScan, type AgentEvent, type Cleared, type Finding, type ScanResult, type Stage } from "../agent/pipeline.ts";
import { getConnectors, setConnectorStatus } from "../connectors/live.ts";
import { createAppLlm, llmConfigured } from "./llm-tauri.ts";

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
  trace: TraceLine[];
  /** Maya's choices, kept by finding id so they survive a re-scan. */
  decisions: Record<string, Decision>;
  /** Draft ids saved in the mailbox, by finding id (for undo). */
  saved: Record<string, string>;
  /** Draft bodies Maya edited, by finding id. */
  edits: Record<string, string>;
  undo: UndoEntry[];
  toast?: Toast;
};

let state: ScanState = {
  phase: "idle",
  findings: [],
  cleared: [],
  undecided: [],
  usedReplay: false,
  trace: [],
  decisions: {},
  saved: {},
  edits: {},
  undo: [],
};
const listeners = new Set<() => void>();
let nextId = 1;

function set(change: Partial<ScanState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useScan(): ScanState {
  return useSyncExternalStore(subscribe, () => state);
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

function onEvent(event: AgentEvent) {
  switch (event.type) {
    case "connector":
      setConnectorStatus(event.status);
      if (event.status.state === "needs_reconnect") set({ trace: trace(`${event.status.name} needs reconnecting, so it was skipped`, "warn") });
      if (event.status.state === "error") set({ trace: trace(`Couldn't read ${event.status.name}`, "bad") });
      return;
    case "corpus":
      set({ corpus: event.corpus });
      return;
    case "stage":
      if (event.status === "start") {
        // Judging and drafting run together; keep showing "judge" until it's done.
        if (event.stage === "draft") return;
        set({ stage: event.stage, progress: undefined, trace: trace(STAGE_TEXT[event.stage]) });
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

/** Runs the whole check. Calls made while one is running are ignored. */
export async function startScan(): Promise<void> {
  if (state.phase === "scanning") return;
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
    trace: [],
  });
  try {
    if (!(await llmConfigured())) {
      throw new Error("The model endpoint isn't set up. Add BC_API_KEY to .env, then restart the app.");
    }
    const connectors = await getConnectors();
    const result = await runScan(connectors, createAppLlm("live_with_fallback"), onEvent);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set({ phase: "error", finishedAt: Date.now(), error: message, trace: trace(message, "bad") });
  }
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
export const TOAST_MS = 10_000;

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
  if (entry.before === "new") delete decisions[entry.findingId];
  else decisions[entry.findingId] = entry.before;
  set({ decisions });
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
