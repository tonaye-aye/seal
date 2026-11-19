// Scores evidence retrieval: for each planted leak and decoy, how much of the
// evidence listed in the ground truth was gathered for its case (recall), and
// how many other items came along (extra). The judge and drafter only see
// what retrieval finds, so a miss here is a miss everywhere downstream.
//
// This script (not the app) may read seed/eval/ground_truth.json.
//
// Run: node scripts/retrieval-check.ts [--verbose]

import { readFileSync } from "node:fs";
import { buildCorpus } from "../src/agent/corpus.ts";
import { detect } from "../src/agent/detectors.ts";
import { retrieveExact, type CaseEvidence } from "../src/agent/retrieval.ts";
import { createConnectors, syncAll } from "../src/connectors/index.ts";
import { nodeSeedSource } from "./seed-source.ts";

const verbose = process.argv.includes("--verbose");
type Entry = { id: string; title: string; evidence: Record<string, string[]> };
const truth = JSON.parse(readFileSync(new URL("../seed/eval/ground_truth.json", import.meta.url), "utf8")) as {
  leaks: Entry[];
  decoys: Entry[];
};

const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
const corpus = await buildCorpus(connectors, await syncAll(connectors));
const { candidates } = detect(corpus);
const started = performance.now();
const cases: CaseEvidence[] = candidates.map((c) => retrieveExact(c, corpus));
const ms = Math.round(performance.now() - started);

// Repeating calendar events are stored per occurrence ("evt_012:2026-10-24").
const baseId = (id: string) => id.split(":")[0];

let wantedTotal = 0;
let foundTotal = 0;
let extraTotal = 0;
for (const entry of [...truth.leaks, ...truth.decoys]) {
  const wanted = Object.values(entry.evidence).flat();
  const candidate = candidates.find((c) => c.evidence.some((e) => wanted.includes(e.id)));
  const got = cases.find((c) => c.candidateId === candidate?.id)?.items ?? [];
  const gotIds = new Set(got.map((i) => baseId(i.id)));
  const missing = wanted.filter((id) => !gotIds.has(id));
  const extra = got.filter((i) => !wanted.includes(baseId(i.id)));
  wantedTotal += wanted.length;
  foundTotal += wanted.length - missing.length;
  extraTotal += extra.length;
  const mark = missing.length === 0 ? "ok  " : "PART";
  console.log(`${mark} ${entry.id} ${wanted.length - missing.length}/${wanted.length} found, ${extra.length} extra  ${entry.title}`);
  if (missing.length) console.log(`       missing: ${missing.join(", ")}`);
  if (verbose && extra.length) console.log(`       extra: ${extra.map((i) => `${i.id}(${i.reasons.join("+")})`).join(", ")}`);
}
console.log(`\nEvidence recall ${foundTotal}/${wantedTotal}, ${extraTotal} extra items, ${ms} ms`);
