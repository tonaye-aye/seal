// End-to-end evaluation: runs the whole scan the app runs and scores it
// against seed/eval/ground_truth.json.
//   recall     planted leaks flagged (7)
//   precision  decoys not flagged (D1, D2) and no other false alarms
//   kind       the right kind of problem
//   amount     a headline amount equals one of the expected amounts (to the cent,
//              or within the stated tolerance)
//   deadline   the headline deadline is one of the expected dates (or none when
//              none is expected)
//   citations  every cited id is real (code drops invented ones) and at least
//              one cited id is in the expected evidence
//   draft      the finding has a draft that passed the claim check (every
//              amount, date, reference, kWh, count and % found in the verified
//              figures or evidence), signs off "Thanks, Maya", leaks no internal
//              ids, and mentions the key facts a reader needs (MUST below).
//              Also checks a draft saves and discards through the email
//              connector (drafts only, nothing sent).
//
// This script (not the app) may read seed/eval/.
//
// Run: node --env-file=.env scripts/eval.ts [--live | --fresh-judge | --fresh-draft] [--repeat N] [--verbose]
//   default        saved model replies where available (fast, repeatable)
//   --fresh-judge  extraction from saved replies, the judge called fresh each run
//   --fresh-draft  drafting (Flash and the 35B fallback) called fresh each run
//   --live         every model call fresh

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { discardSaved, saveDraft } from "../src/agent/draft.ts";
import { runScan, type Finding, type ScanResult } from "../src/agent/pipeline.ts";
import { createConnectors } from "../src/connectors/index.ts";
import { createLlm, type ChatRequest, type LlmClient } from "../src/lib/llm.ts";
import { nodeTransport } from "./llm-node.ts";
import { nodeSeedSource } from "./seed-source.ts";

const args = process.argv.slice(2);
const live = args.includes("--live");
const freshJudge = args.includes("--fresh-judge");
const freshDraft = args.includes("--fresh-draft");
const verbose = args.includes("--verbose");
const repeat = Number(args[args.indexOf("--repeat") + 1]) || 1;

type Truth = {
  leaks: { id: string; title: string; kind: string; amounts: Record<string, number | string>; deadlines: { date: string; what: string }[]; evidence: Record<string, string[]> }[];
  decoys: { id: string; title: string; evidence: Record<string, string[]> }[];
};
const truth = JSON.parse(await readFile(new URL("../seed/eval/ground_truth.json", import.meta.url), "utf8")) as Truth;

// The ground truth names one kind differently.
const KIND_ALIASES: Record<string, string> = { price_increase_vs_contract: "price_increase" };

/** Model calls: saved replies unless --live, or the stage asked for fresh (judge = 35B thinking, draft = Flash or 35B not thinking). */
function client(): LlmClient {
  const transport = nodeTransport();
  const cached = createLlm(transport, { mode: live ? "live" : "cache_first" });
  const fresh = createLlm(transport, { mode: "live" });
  const isJudge = (r: ChatRequest) => r.model === "judge" && r.think;
  const isDraft = (r: ChatRequest) => r.model === "flash" || (r.model === "judge" && !r.think);
  return {
    chat: (request: ChatRequest) =>
      (live || (freshJudge && isJudge(request)) || (freshDraft && isDraft(request)) ? fresh : cached).chat(request),
  } as LlmClient;
}

// Facts a reader of each draft needs (compared ignoring case and commas, with
// dates also matched in short form). Lifted from the spike.
const MUST: Record<string, string[]> = {
  L1: ["24 months", "$79.00", "14 October 2025"],
  L2: ["StreamBox", "Apple", "17.99"],
  L3: ["14 November", "28 November", "$89.00"],
  L4: ["BrightPage", "14.99"],
  L5: ["KP-20418", "R-77311", "R-77402", "$385.00"],
  L6: ["1,109", "1,485.54", "4 December"],
  L7: ["47,006", "30 October"],
};
const INTERNAL_ID = /\b(?:msg|doc|evt)_\d+|\b(?:JE|MC)-\d{5}\b/;

type DraftScore = { ok: boolean; grounded: boolean; missing: string[]; fallback: boolean; detail: string };

function scoreDraft(leakId: string, finding: Finding | undefined): DraftScore {
  const d = finding?.draft;
  if (!d) return { ok: false, grounded: false, missing: MUST[leakId] ?? [], fallback: false, detail: "no draft" };
  const text = `${d.subject}\n${d.body}`;
  const flat = (s: string) => s.toLowerCase().replace(/,/g, "");
  const shortMonths = (s: string) => s.replace(/(January|February|March|April|May|June|July|August|September|October|November|December)/g, (m) => m.slice(0, 3));
  const missing = (MUST[leakId] ?? []).filter((m) => !flat(text).includes(flat(m)) && !flat(shortMonths(text)).includes(flat(shortMonths(m))));
  const signed = /thanks,\s*maya/i.test(d.body);
  const ids = INTERNAL_ID.test(text);
  const fallback = d.attempts.length > 1;
  const ok = d.grounded && signed && !ids && missing.length === 0;
  const words = d.body.split(/\s+/).length;
  const parts = [
    d.grounded ? "claim check clean" : `NOT GROUNDED: ${d.problems.join(" | ")}`,
    missing.length ? `missing: ${missing.join(" | ")}` : "key facts present",
    signed ? "" : "no sign-off",
    ids ? "INTERNAL IDS" : "",
    `${words} words`,
    `to ${d.to.address}`,
    d.attachDocumentIds.length ? `attach ${d.attachDocumentIds.join(",")}` : "",
    d.attempts.map((a) => `${a.model.split("/").pop()} ${(a.ms / 1000).toFixed(1)}s${a.problems.length ? ` (${a.problems.length} problems: ${a.problems.join(" | ")})` : ""}`).join(" -> "),
  ];
  return { ok, grounded: d.grounded, missing, fallback, detail: parts.filter(Boolean).join("; ") };
}

type LeakScore = { id: string; flagged: boolean; kind: boolean; amount: boolean; deadline: boolean; citesEvidence: boolean; detail: string; draft: DraftScore };

function score(result: ScanResult) {
  const leaks: LeakScore[] = truth.leaks.map((leak) => {
    const expectedIds = new Set(Object.values(leak.evidence).flat());
    const finding = result.findings.find((f) => f.evidence.some((e) => expectedIds.has(e.id.split(":")[0])));
    const draft = scoreDraft(leak.id, finding);
    if (!finding) return { id: leak.id, flagged: false, kind: false, amount: false, deadline: false, citesEvidence: false, detail: "not flagged", draft };
    const money = Object.entries(leak.amounts)
      .filter(([k, v]) => typeof v === "number" && !/count|charges|pct|tolerance|remaining/.test(k))
      .map(([, v]) => Math.round((v as number) * 100));
    const tolerance = typeof leak.amounts.tolerance === "number" ? Math.round(leak.amounts.tolerance * 100) : 0;
    const headline = [finding.amounts.atStake, finding.amounts.recoverable].filter((x): x is number => x !== undefined);
    const amount = headline.some((h) => money.some((m) => Math.abs(h - m) <= tolerance));
    const expectedDates = new Set(JSON.stringify(leak.deadlines).match(/\d{4}-\d{2}-\d{2}/g) ?? []);
    const deadline = expectedDates.size === 0 ? !finding.deadline : !!finding.deadline && expectedDates.has(finding.deadline.date);
    const kind = (KIND_ALIASES[leak.kind] ?? leak.kind) === finding.kind;
    const citesEvidence = finding.evidence.some((e) => e.cited && expectedIds.has(e.id.split(":")[0]));
    return {
      id: leak.id,
      flagged: true,
      kind,
      amount,
      deadline,
      citesEvidence,
      draft,
      detail: `${finding.title} [${finding.kind}, ${finding.confidence}] at stake ${headline.map((h) => `$${(h / 100).toFixed(2)}`).join("/")}, deadline ${finding.deadline?.date ?? "none"}`,
    };
  });
  const decoyFlags = truth.decoys.map((d) => {
    const ids = new Set(Object.values(d.evidence).flat());
    const finding = result.findings.find((f) => f.evidence.some((e) => ids.has(e.id)));
    const cleared = result.cleared.find((c) => c.citedIds.some((id) => ids.has(id)) || c.id.includes(d.id));
    return { id: d.id, flagged: !!finding, why: finding ? finding.title : (cleared?.why ?? "not raised") };
  });
  const matched = new Set(
    truth.leaks.flatMap((l) => {
      const ids = new Set(Object.values(l.evidence).flat());
      return result.findings.filter((f) => f.evidence.some((e) => ids.has(e.id.split(":")[0]))).map((f) => f.id);
    }),
  );
  const falseAlarms = result.findings.filter((f) => !matched.has(f.id));
  return { leaks, decoyFlags, falseAlarms };
}

const runs: ReturnType<typeof score>[] = [];
const saveChecks: boolean[] = [];
for (let run = 1; run <= repeat; run++) {
  const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
  const started = performance.now();
  const result = await runScan(connectors, client(), (e) => {
    if (e.type === "progress") process.stdout.write(`\r  run ${run}: ${e.stage} ${e.done}/${e.total}        `);
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const s = score(result);
  runs.push(s);

  // Approve and undo go through the email connector, which only keeps drafts.
  const withDraft = result.findings.filter((f) => f.draft);
  const saved = await Promise.all(withDraft.map((f) => saveDraft(connectors, f.draft!)));
  const listed = (await connectors.email.listDrafts()).length;
  await Promise.all(saved.map((d) => discardSaved(connectors, d.id)));
  const afterUndo = (await connectors.email.listDrafts()).length;
  saveChecks.push(listed === withDraft.length && afterUndo === 0);

  console.log(`\n\nRun ${run} of ${repeat}: ${seconds} s${result.usedReplay ? " (some answers from saved replies)" : ""}`);
  for (const l of s.leaks) {
    const marks = [l.flagged && "flagged", l.kind && "kind", l.amount && "amount", l.deadline && "deadline", l.citesEvidence && "cites"].filter(Boolean);
    const all = l.flagged && l.kind && l.amount && l.deadline && l.citesEvidence;
    console.log(`  ${all ? "ok  " : l.flagged ? "PART" : "MISS"} ${l.id}  ${marks.join(" ")}  ${verbose || !all ? l.detail : ""}`);
  }
  for (const l of s.leaks) console.log(`  ${l.draft.ok ? "ok  " : "FAIL"} ${l.id} draft  ${verbose || !l.draft.ok ? l.draft.detail : ""}`);
  console.log(`  ${saveChecks.at(-1) ? "ok  " : "FAIL"} drafts saved to and discarded from the email connector (nothing sent)`);
  for (const d of s.decoyFlags) console.log(`  ${d.flagged ? "FAIL" : "ok  "} ${d.id}  ${d.flagged ? "flagged as a problem" : "cleared"}: ${d.why}`);
  for (const f of s.falseAlarms) console.log(`  FAIL false alarm: ${f.title}`);
  if (result.undecided.length) console.log(`  undecided: ${result.undecided.map((u) => `${u.merchant} (${u.error})`).join("; ")}`);
  if (verbose) {
    for (const f of result.findings) {
      console.log(`\n  ${f.title}  (${f.merchant}, ${f.confidence}, judged in ${(f.judgedBy.ms / 1000).toFixed(1)} s)`);
      console.log(`    why: ${f.why}`);
      console.log(`    do: ${f.action.summary}`);
      if (f.doubts.length) console.log(`    doubts: ${f.doubts.join("; ")}`);
      if (f.draft) console.log(`    draft to ${f.draft.to.address}: ${f.draft.subject}\n      ${f.draft.body.replace(/\n/g, "\n      ")}`);
    }
  }

  await mkdir(new URL("../.cache/eval/", import.meta.url), { recursive: true });
  await writeFile(new URL(`../.cache/eval/run-${run}.json`, import.meta.url), JSON.stringify(result, null, 2));
}

// ---------- Summary across runs ----------
const total = (pick: (l: LeakScore) => boolean) => runs.reduce((n, r) => n + r.leaks.filter(pick).length, 0);
const out = runs.length * truth.leaks.length;
const decoysFlagged = runs.reduce((n, r) => n + r.decoyFlags.filter((d) => d.flagged).length, 0);
const falseAlarms = runs.reduce((n, r) => n + r.falseAlarms.length, 0);
console.log(`\nSummary over ${runs.length} run${runs.length === 1 ? "" : "s"}`);
console.log(`  recall       ${total((l) => l.flagged)}/${out} leaks flagged`);
console.log(`  precision    ${decoysFlagged}/${runs.length * truth.decoys.length} decoys flagged, ${falseAlarms} other false alarms`);
console.log(`  kind         ${total((l) => l.kind)}/${out}`);
console.log(`  amount       ${total((l) => l.amount)}/${out}`);
console.log(`  deadline     ${total((l) => l.deadline)}/${out}`);
console.log(`  citations    ${total((l) => l.citesEvidence)}/${out} cite expected evidence`);
console.log(`  drafts       ${total((l) => l.draft.ok)}/${out} fully correct, ${total((l) => l.draft.grounded)}/${out} pass the claim check, ${total((l) => l.draft.fallback)} needed the 35B rewrite`);
console.log(`  save/undo    ${saveChecks.filter(Boolean).length}/${saveChecks.length} runs`);
process.exitCode =
  total((l) => l.flagged) === out && decoysFlagged === 0 && falseAlarms === 0 && total((l) => l.draft.ok) === out && saveChecks.every(Boolean) ? 0 : 1;
