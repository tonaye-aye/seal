// Runs the detectors over the seed and reports, per planted leak and decoy,
// whether a candidate reached the later stages. Detectors should find every
// leak (recall); decoys are expected to show up here too, because clearing
// them is the judge's job, with evidence.
//
// This script (not the app) may read seed/eval/ground_truth.json.
//
// Run: node scripts/detectors-check.ts [--verbose]

import { readFileSync } from "node:fs";
import { buildCorpus } from "../src/agent/corpus.ts";
import { detect, upcomingCharges } from "../src/agent/detectors.ts";
import { createConnectors, syncAll } from "../src/connectors/index.ts";
import { nodeSeedSource } from "./seed-source.ts";

const verbose = process.argv.includes("--verbose");
const truth = JSON.parse(readFileSync(new URL("../seed/eval/ground_truth.json", import.meta.url), "utf8")) as {
  leaks: { id: string; title: string; merchant: string; evidence: unknown }[];
  decoys: { id: string; title: string; evidence: unknown }[];
};

const started = performance.now();
const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
const corpus = await buildCorpus(connectors, await syncAll(connectors));
const result = detect(corpus);
const ms = Math.round(performance.now() - started);

/** Every evidence id mentioned anywhere in a ground-truth entry. */
function idsIn(value: unknown): Set<string> {
  const text = JSON.stringify(value);
  return new Set(text.match(/\b(?:msg_\d+|doc_\d+|evt_\d+|JE-\d+|MC-\d+)\b/g) ?? []);
}

console.log(`\nCandidates (${result.candidates.length}), ${ms} ms\n`);
for (const c of result.candidates) {
  console.log(`  ${c.names.join(" + ")}  [${[...new Set(c.signals.map((s) => s.kind))].join(", ")}]  ${c.evidence.length} evidence`);
  if (verbose) for (const s of c.signals) console.log(`      - ${s.summary}`);
}
if (result.unplaced.length) {
  console.log(`\nUnplaced signals (${result.unplaced.length})`);
  for (const s of result.unplaced) console.log(`  - ${s.kind}: ${s.summary}`);
}

console.log("\nLeaks (should each have a candidate)");
let found = 0;
for (const leak of truth.leaks) {
  const ids = idsIn(leak.evidence);
  const match = result.candidates.find((c) => c.evidence.some((e) => ids.has(e.id)));
  if (match) found += 1;
  console.log(`  ${match ? "ok  " : "MISS"} ${leak.id} ${leak.title}${match ? `  -> ${match.names.join(" + ")}` : ""}`);
}

console.log("\nDecoys (a candidate is fine here; the judge must clear it)");
for (const decoy of truth.decoys) {
  const ids = idsIn(decoy.evidence);
  const match = result.candidates.find((c) => c.evidence.some((e) => ids.has(e.id)));
  console.log(`  ${decoy.id} ${decoy.title}: ${match ? `candidate ${match.names.join(" + ")}` : "no candidate"}`);
}

const leakIds = truth.leaks.map((l) => idsIn(l.evidence));
const decoyIds = truth.decoys.map((d) => idsIn(d.evidence));
const extra = result.candidates.filter(
  (c) => ![...leakIds, ...decoyIds].some((ids) => c.evidence.some((e) => ids.has(e.id))),
);
console.log(`\nCandidates matching no leak or decoy: ${extra.length}${extra.length ? ` (${extra.map((c) => c.names.join("+")).join(", ")})` : ""}`);

console.log("\nUpcoming recurring charges (next 45 days)");
for (const u of upcomingCharges(result.series)) console.log(`  ${u.date}  ${u.name}  $${(u.amountCents / 100).toFixed(2)}`);

console.log(`\nRecall at candidate stage: ${found}/${truth.leaks.length}`);
process.exitCode = found === truth.leaks.length ? 0 : 1;
