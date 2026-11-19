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
//
// This script (not the app) may read seed/eval/.
//
// Run: node --env-file=.env scripts/eval.ts [--live | --fresh-judge] [--repeat N] [--verbose]
//   default        saved model replies where available (fast, repeatable)
//   --fresh-judge  extraction from saved replies, the judge called fresh each run
//   --live         every model call fresh

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runScan, type ScanResult } from "../src/agent/pipeline.ts";
import { createConnectors } from "../src/connectors/index.ts";
import { createLlm, type ChatRequest, type LlmClient } from "../src/lib/llm.ts";
import { nodeTransport } from "./llm-node.ts";
import { nodeSeedSource } from "./seed-source.ts";

const args = process.argv.slice(2);
const live = args.includes("--live");
const freshJudge = args.includes("--fresh-judge");
const verbose = args.includes("--verbose");
const repeat = Number(args[args.indexOf("--repeat") + 1]) || 1;

type Truth = {
  leaks: { id: string; title: string; kind: string; amounts: Record<string, number | string>; deadlines: { date: string; what: string }[]; evidence: Record<string, string[]> }[];
  decoys: { id: string; title: string; evidence: Record<string, string[]> }[];
};
const truth = JSON.parse(await readFile(new URL("../seed/eval/ground_truth.json", import.meta.url), "utf8")) as Truth;

// The ground truth names one kind differently.
const KIND_ALIASES: Record<string, string> = { price_increase_vs_contract: "price_increase" };

/** Model calls: extraction from saved replies unless --live; the judge fresh with --fresh-judge or --live. */
function client(): LlmClient {
  const transport = nodeTransport();
  const cached = createLlm(transport, { mode: live ? "live" : "cache_first" });
  const fresh = createLlm(transport, { mode: "live" });
  return {
    chat: (request: ChatRequest) => ((freshJudge || live) && request.model === "judge" ? fresh : cached).chat(request),
  } as LlmClient;
}

type LeakScore = { id: string; flagged: boolean; kind: boolean; amount: boolean; deadline: boolean; citesEvidence: boolean; detail: string };

function score(result: ScanResult) {
  const leaks: LeakScore[] = truth.leaks.map((leak) => {
    const expectedIds = new Set(Object.values(leak.evidence).flat());
    const finding = result.findings.find((f) => f.evidence.some((e) => expectedIds.has(e.id.split(":")[0])));
    if (!finding) return { id: leak.id, flagged: false, kind: false, amount: false, deadline: false, citesEvidence: false, detail: "not flagged" };
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
for (let run = 1; run <= repeat; run++) {
  const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
  const started = performance.now();
  const result = await runScan(connectors, client(), (e) => {
    if (e.type === "progress") process.stdout.write(`\r  run ${run}: ${e.stage} ${e.done}/${e.total}        `);
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const s = score(result);
  runs.push(s);

  console.log(`\n\nRun ${run} of ${repeat}: ${seconds} s${result.usedReplay ? " (some answers from saved replies)" : ""}`);
  for (const l of s.leaks) {
    const marks = [l.flagged && "flagged", l.kind && "kind", l.amount && "amount", l.deadline && "deadline", l.citesEvidence && "cites"].filter(Boolean);
    const all = l.flagged && l.kind && l.amount && l.deadline && l.citesEvidence;
    console.log(`  ${all ? "ok  " : l.flagged ? "PART" : "MISS"} ${l.id}  ${marks.join(" ")}  ${verbose || !all ? l.detail : ""}`);
  }
  for (const d of s.decoyFlags) console.log(`  ${d.flagged ? "FAIL" : "ok  "} ${d.id}  ${d.flagged ? "flagged as a problem" : "cleared"}: ${d.why}`);
  for (const f of s.falseAlarms) console.log(`  FAIL false alarm: ${f.title}`);
  if (result.undecided.length) console.log(`  undecided: ${result.undecided.map((u) => `${u.merchant} (${u.error})`).join("; ")}`);
  if (verbose) {
    for (const f of result.findings) {
      console.log(`\n  ${f.title}  (${f.merchant}, ${f.confidence}, judged in ${(f.judgedBy.ms / 1000).toFixed(1)} s)`);
      console.log(`    why: ${f.why}`);
      console.log(`    do: ${f.action.summary}`);
      if (f.doubts.length) console.log(`    doubts: ${f.doubts.join("; ")}`);
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
process.exitCode = total((l) => l.flagged) === out && decoysFlagged === 0 && falseAlarms === 0 ? 0 : 1;
