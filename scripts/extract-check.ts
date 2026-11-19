// Runs extraction on every email and document retrieval found, then reports:
// how many values the model copied correctly (grounded in the source), which
// model answered, timing, and spot checks on the facts the leaks depend on.
// Uses saved replies when it has them; pass --live to call the models fresh.
//
// Run: node --env-file=.env scripts/extract-check.ts [--live] [--verbose]

import { buildCorpus } from "../src/agent/corpus.ts";
import { detect } from "../src/agent/detectors.ts";
import { extractAll, type SourceFacts } from "../src/agent/extract.ts";
import { retrieveExact } from "../src/agent/retrieval.ts";
import { createConnectors, syncAll } from "../src/connectors/index.ts";
import { createLlm } from "../src/lib/llm.ts";
import { nodeTransport } from "./llm-node.ts";
import { nodeSeedSource } from "./seed-source.ts";

const liveOnly = process.argv.includes("--live");
const verbose = process.argv.includes("--verbose");

const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
const corpus = await buildCorpus(connectors, await syncAll(connectors));
const cases = detect(corpus).candidates.map((c) => retrieveExact(c, corpus));
const llm = createLlm(nodeTransport(), { mode: liveOnly ? "live" : "cache_first" });

const started = performance.now();
const { facts, failures } = await extractAll(cases, corpus, connectors, llm, (p) => {
  process.stdout.write(`\r  extracting ${p.done}/${p.total}`);
});
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log("\n");

// ---------- Grounding ----------
const all = [...facts.values()];
const count = (pick: (f: SourceFacts) => { grounded: boolean }[]) => {
  const items = all.flatMap(pick);
  return { total: items.length, grounded: items.filter((i) => i.grounded).length };
};
const fields = {
  amounts: count((f) => f.amounts),
  dates: count((f) => f.dates),
  references: count((f) => f.references),
  quantities: count((f) => (f.reading ? [] : f.quantities)),
  clauses: count((f) => f.clauses),
};
console.log("Grounded in the source (ungrounded values are dropped downstream)");
for (const [name, c] of Object.entries(fields)) console.log(`  ${name.padEnd(11)} ${c.grounded}/${c.total}`);

if (verbose) {
  console.log("\nUngrounded values");
  for (const f of all) {
    const bad = [
      ...f.amounts.filter((a) => !a.grounded).map((a) => `$${(a.cents / 100).toFixed(2)} (${a.label})`),
      ...f.dates.filter((d) => !d.grounded).map((d) => `${d.date} (${d.label})`),
      ...f.references.filter((r) => !r.grounded).map((r) => `ref ${r.value}`),
      ...(f.reading ? [] : f.quantities.filter((q) => !q.grounded).map((q) => `${q.value} ${q.unit}`)),
      ...f.clauses.filter((c) => !c.grounded).map((c) => `"${c.text.slice(0, 60)}"`),
    ];
    if (bad.length) console.log(`  ${f.key}: ${bad.join("; ")}`);
  }
}

// ---------- Models and timing ----------
const byModel = new Map<string, number>();
for (const f of all) byModel.set(f.model, (byModel.get(f.model) ?? 0) + 1);
const live = all.filter((f) => f.source === "live");
console.log(`\n${all.length} sources in ${seconds} s (${live.length} live, ${all.length - live.length} from cache)`);
for (const [model, n] of byModel) console.log(`  ${model}: ${n}`);
const retried = all.filter((f) => f.attempts > 1);
if (retried.length) console.log(`  needed a retry or a bigger model: ${retried.map((f) => `${f.key} (${f.attempts})`).join(", ")}`);
if (live.length) {
  const ms = live.map((f) => f.ms).sort((a, b) => a - b);
  console.log(`  per call: median ${ms[Math.floor(ms.length / 2)]} ms, slowest ${ms[ms.length - 1]} ms`);
}
if (failures.length) {
  console.log(`\nFailed (${failures.length})`);
  for (const f of failures) console.log(`  ${f.key}: ${f.error}`);
}

// ---------- Spot checks on facts the leaks need (eval-side expectations) ----------
const f = (key: string) => facts.get(key);
const hasAmount = (key: string, cents: number) => !!f(key)?.amounts.some((a) => a.grounded && a.cents === cents);
const hasDate = (key: string, date: string) => !!f(key)?.dates.some((d) => d.grounded && d.date === date);
const hasRef = (key: string, ref: string) => !!f(key)?.references.some((r) => r.grounded && r.value.includes(ref));
const mentions = (key: string, pattern: RegExp) =>
  !!f(key) && (f(key)!.clauses.some((c) => c.grounded && pattern.test(c.text)) || f(key)!.quantities.some((q) => q.grounded && pattern.test(`${q.value} ${q.unit}`)));

const checks: [string, boolean][] = [
  ["L1 agreement states a 24-month price term", mentions("doc:doc_001", /24\s*months?/i)],
  ["L1 changes email has the new $99.00", hasAmount("email:msg_0024", 9900)],
  ["L3 gym terms state 14 days' notice", mentions("doc:doc_008", /14\s*days?/i)],
  ["L3 reminder has the $89.00 annual fee", hasAmount("email:msg_0056", 8900)],
  ["L3 reminder has the 28 Nov renewal date", hasDate("email:msg_0056", "2026-11-28")],
  ["L5 invoice reference KP-20418", hasRef("doc:doc_009", "KP-20418")],
  ["L6 renewal premium $1,485.54", hasAmount("doc:doc_006", 148554)],
  ["L6 quote $1,109.00", hasAmount("doc:doc_007", 110900) || hasAmount("email:msg_0066", 110900)],
  ["L6 quote valid to 4 Dec", hasDate("doc:doc_007", "2026-12-04") || hasDate("email:msg_0066", "2026-12-04")],
  ["L7 bill's estimated reading 47,570", !!f("doc:doc_003")?.quantities.some((q) => q.grounded && q.value === 47570)],
  ["L7 meter photo reads 47,006", f("doc:doc_004")?.reading?.value === 47006],
  ["D1 mobile terms allow CPI indexation", mentions("doc:doc_010", /CPI|index/i)],
];
console.log("\nSpot checks");
for (const [label, ok] of checks) console.log(`  ${ok ? "ok  " : "MISS"} ${label}`);
const missed = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - missed}/${checks.length} spot checks, ${failures.length} failures`);
process.exitCode = missed || failures.length ? 1 : 0;
