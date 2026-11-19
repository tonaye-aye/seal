// The whole scan, start to finish. Each stage reports what it is doing as an
// AgentEvent, so the UI can show a live trace, and findings are announced as
// soon as each case is judged rather than all at the end.
//
//   0 sync connectors      code     (connectors/index.ts)
//   1 read bodies and text code     (corpus.ts)
//   2 detect candidates    code     (detectors.ts)
//   3 gather evidence      code     (retrieval.ts)
//   4 extract facts        9B       (extract.ts)
//   5 verify figures       code     (verify.ts)
//   6 judge each case      35B      (judge.ts)
//   7 draft the fix        Flash, 35B fallback, claim check in code (draft.ts)
//
// Each case is drafted as soon as it is judged, so the first finding (with its
// draft) can be shown while other cases are still being judged.

import { now } from "../lib/clock.ts";
import { localDate, toZonedIso } from "../lib/dates.ts";
import type { LlmClient } from "../lib/llm.ts";
import { syncAll, type ConnectorStatus, type Connectors } from "../connectors/index.ts";
import { buildCorpus, mapLimited, type Corpus } from "./corpus.ts";
import { detect, upcomingCharges, type Candidate, type EvidenceRef } from "./detectors.ts";
import { draftFinding, loadVoice, type ProposedDraft } from "./draft.ts";
import { extractAll } from "./extract.ts";
import { judgeCase, type ActionKind, type FindingKind, type Verdict } from "./judge.ts";
import { retrieveExact } from "./retrieval.ts";
import { verifyCase, type Figure, type VerifiedCase } from "./verify.ts";

export type Finding = {
  id: string;
  kind: FindingKind;
  merchant: string;
  title: string;
  why: string;
  action: { kind: ActionKind; summary: string };
  /** Headline numbers in cents, all worked out by code. */
  amounts: { atStake?: number; recoverable?: number; perMonth?: number };
  deadline?: { date: string; label: string };
  confidence: "high" | "medium" | "low";
  /** Cited evidence first, then the rest of what was gathered. */
  evidence: (EvidenceRef & { cited: boolean })[];
  figures: Figure[];
  notes: string[];
  /** Anything code doubted about the case or the verdict. */
  doubts: string[];
  status: "new" | "approved" | "snoozed" | "dismissed";
  verified: true;
  judgedBy: { model: string; source: "live" | "cache"; ms: number };
  /** The message that fixes it, waiting for approval. Absent when there is nothing to ask for. */
  draft?: ProposedDraft;
};

/** A case the agent looked at and decided is fine, with the reason. */
export type Cleared = { id: string; merchant: string; title: string; why: string; citedIds: string[] };

export type Stage = "sync" | "read" | "detect" | "retrieve" | "extract" | "verify" | "judge" | "draft";

export type AgentEvent =
  | { type: "stage"; stage: Stage; status: "start" | "done"; detail?: string; at: number }
  | { type: "connector"; status: ConnectorStatus; at: number }
  /** Everything that was read, so the UI can show each piece of evidence. */
  | { type: "corpus"; corpus: Corpus; at: number }
  | { type: "progress"; stage: Stage; done: number; total: number; label?: string; at: number }
  | { type: "finding"; finding: Finding; at: number }
  /** A finding's draft is ready (it arrives after the finding itself). */
  | { type: "draft"; findingId: string; draft: ProposedDraft; at: number }
  | { type: "cleared"; cleared: Cleared; at: number }
  | { type: "problem"; stage: Stage; message: string; at: number };

export type ScanResult = {
  findings: Finding[];
  cleared: Cleared[];
  /** Cases the judge could not decide (shown as "Not sure: check evidence"). */
  undecided: { id: string; merchant: string; error: string }[];
  upcoming: ReturnType<typeof upcomingCharges>;
  /** What couldn't be read (e.g. calendar needs reconnecting). */
  missing: string[];
  checkedAt: string;
  /** True if any model answer came from saved replies (replay). */
  usedReplay: boolean;
};

/** Most urgent first: soonest deadline, then most money. */
export function rank(findings: Finding[]): Finding[] {
  const far = "9999-12-31";
  return [...findings].sort(
    (a, b) =>
      (a.deadline?.date ?? far).localeCompare(b.deadline?.date ?? far) ||
      (b.amounts.atStake ?? 0) - (a.amounts.atStake ?? 0),
  );
}

/** The kind of problem a case most likely is, from what raised it (used when the judge didn't say). */
function kindFromSignals(candidate: Candidate): FindingKind {
  const kinds = new Set(candidate.signals.map((s) => s.kind));
  if (kinds.has("duplicate_charges")) return "duplicate_subscription";
  if (kinds.has("duplicate_payment")) return "duplicate_payment";
  if (kinds.has("estimated_bill")) return "billing_error";
  if (kinds.has("trial")) return "trial_converted";
  if (kinds.has("price_change")) return "price_increase";
  if (kinds.has("competitor_quote")) return "renewal_price_creep";
  return "renewal_trap";
}

/**
 * When the judge's verdict goes against facts code has checked, the model
 * doesn't get the last word. A case it cleared despite a hard fact pointing
 * to a problem is kept, marked low confidence, with both sides shown. A case
 * it flagged despite facts pointing only to "fine" is kept but marked low.
 * The person decides; nothing is silently dropped.
 */
export function settleDisagreement(candidate: Candidate, verified: VerifiedCase, verdict: Verdict): Verdict {
  const problem = verified.pointsToProblem;
  const fine = verified.pointsToFine;
  if (!verdict.isProblem && problem.length > 0 && fine.length === 0) {
    return {
      ...verdict,
      isProblem: true,
      kind: kindFromSignals(candidate),
      title: `Check ${candidate.names.join(" and ")}`,
      why: problem[0],
      action: "none",
      actionSummary: "Look at the evidence and decide: the checks and the model disagree.",
      confidence: "low",
      issues: [...verdict.issues, `The model judged this fine ("${verdict.why}"), but code found: ${problem.join(" ")}`],
    };
  }
  if (verdict.isProblem && fine.length > 0 && problem.length === 0) {
    return {
      ...verdict,
      confidence: "low",
      issues: [...verdict.issues, `Code found reasons this may be fine: ${fine.join(" ")}`],
    };
  }
  return verdict;
}

function toFinding(candidate: Candidate, verdict: Verdict, verified: ReturnType<typeof verifyCase>, evidence: EvidenceRef[]): Finding {
  const cited = new Set(verdict.citedIds);
  return {
    id: candidate.id.replace(/^cand_/, "finding_"),
    kind: verdict.kind as FindingKind,
    merchant: candidate.names.join(" + "),
    title: verdict.title,
    why: verdict.why,
    action: { kind: verdict.action, summary: verdict.actionSummary },
    amounts: { atStake: verified.atStakeCents, recoverable: verified.recoverableCents, perMonth: verified.perMonthCents },
    deadline: verified.deadline,
    confidence: verdict.confidence,
    evidence: [
      ...evidence.filter((e) => cited.has(e.id)).map((e) => ({ ...e, cited: true })),
      ...evidence.filter((e) => !cited.has(e.id)).map((e) => ({ ...e, cited: false })),
    ],
    figures: verified.figures,
    notes: verified.notes,
    doubts: [...verified.warnings, ...verdict.issues],
    status: "new",
    verified: true,
    judgedBy: { model: verdict.model, source: verdict.source, ms: verdict.ms },
  };
}

export async function runScan(
  connectors: Connectors,
  llm: LlmClient,
  emit: (event: AgentEvent) => void = () => {},
): Promise<ScanResult> {
  const at = () => Date.now();
  const stage = (s: Stage, status: "start" | "done", detail?: string) => emit({ type: "stage", stage: s, status, detail, at: at() });
  let usedReplay = false;

  stage("sync", "start");
  const snapshot = await syncAll(connectors, (status) => emit({ type: "connector", status, at: at() }));
  const missing = Object.keys(snapshot.failed);
  stage("sync", "done", missing.length ? `Couldn't read: ${missing.join(", ")}` : undefined);

  stage("read", "start");
  const corpus = await buildCorpus(connectors, snapshot);
  emit({ type: "corpus", corpus, at: at() });
  stage("read", "done", `${corpus.transactions.length} transactions, ${corpus.emails.length} emails, ${corpus.documents.length} documents, ${corpus.events.length} calendar entries`);

  stage("detect", "start");
  const detection = detect(corpus);
  stage("detect", "done", `${detection.candidates.length} things worth a closer look`);

  stage("retrieve", "start");
  const evidence = detection.candidates.map((c) => retrieveExact(c, corpus));
  stage("retrieve", "done", `${evidence.reduce((n, e) => n + e.items.length, 0)} pieces of evidence`);

  stage("extract", "start");
  const extraction = await extractAll(evidence, corpus, connectors, llm, (p) =>
    emit({ type: "progress", stage: "extract", done: p.done, total: p.total, label: p.key, at: at() }),
  );
  usedReplay ||= [...extraction.facts.values()].some((f) => f.source === "cache");
  for (const f of extraction.failures) emit({ type: "problem", stage: "extract", message: `${f.key}: ${f.error}`, at: at() });
  stage("extract", "done", `${extraction.facts.size} read, ${extraction.failures.length} failed`);

  stage("verify", "start");
  const verified = detection.candidates.map((c, i) => verifyCase(c, evidence[i], extraction, corpus));
  stage("verify", "done", `${verified.reduce((n, v) => n + v.figures.length, 0)} figures checked`);

  const voice = await loadVoice(connectors);
  stage("judge", "start");
  stage("draft", "start", "each finding is drafted as soon as it is judged");
  let drafted = 0;
  let toDraft = 0;
  const findings: Finding[] = [];
  const cleared: Cleared[] = [];
  const undecided: ScanResult["undecided"] = [];
  let judged = 0;
  // The 35B thinks for ~10-30 s per case, so cases run side by side.
  await mapLimited(detection.candidates.map((_, i) => i), 6, async (i) => {
    const candidate = detection.candidates[i];
    try {
      const verdict = settleDisagreement(
        candidate,
        verified[i],
        await judgeCase(llm, candidate, verified[i], evidence[i], extraction, corpus),
      );
      usedReplay ||= verdict.source === "cache";
      if (verdict.isProblem) {
        const finding = toFinding(candidate, verdict, verified[i], evidence[i].items);
        findings.push(finding);
        emit({ type: "finding", finding, at: at() });
        // A "Check X" finding (action none) has nothing to ask a business yet.
        if (verdict.action !== "none") {
          toDraft++;
          try {
            finding.draft = await draftFinding(llm, finding, corpus, voice);
            usedReplay ||= finding.draft.source === "cache";
            emit({ type: "draft", findingId: finding.id, draft: finding.draft, at: at() });
            if (!finding.draft.grounded) {
              emit({ type: "problem", stage: "draft", message: `${finding.merchant}: draft needs checking (${finding.draft.problems.join("; ")})`, at: at() });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            emit({ type: "problem", stage: "draft", message: `${finding.merchant}: couldn't draft (${message})`, at: at() });
          }
          emit({ type: "progress", stage: "draft", done: ++drafted, total: toDraft, label: finding.merchant, at: at() });
        }
      } else {
        const c: Cleared = { id: candidate.id, merchant: candidate.names.join(" + "), title: verdict.title, why: verdict.why, citedIds: verdict.citedIds };
        cleared.push(c);
        emit({ type: "cleared", cleared: c, at: at() });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      undecided.push({ id: candidate.id, merchant: candidate.names.join(" + "), error: message });
      emit({ type: "problem", stage: "judge", message: `${candidate.names.join(" + ")}: ${message}`, at: at() });
    }
    emit({ type: "progress", stage: "judge", done: ++judged, total: detection.candidates.length, label: candidate.names.join(" + "), at: at() });
  });
  stage("judge", "done", `${findings.length} need you, ${cleared.length} look fine`);
  const withDrafts = findings.filter((f) => f.draft);
  const unchecked = withDrafts.filter((f) => !f.draft!.grounded).length;
  stage("draft", "done", `${withDrafts.length} drafts ready${unchecked ? `, ${unchecked} need checking` : ", every claim checked"}`);

  return {
    findings: rank(findings),
    cleared,
    undecided,
    upcoming: upcomingCharges(detection.series, 45, localDate(now())),
    missing,
    checkedAt: toZonedIso(now()),
    usedReplay,
  };
}
