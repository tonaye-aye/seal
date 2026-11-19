// Runs the scan up to the verify stage and compares the code-computed figures
// with the expected numbers for each planted leak and decoy. Amounts must be
// right to the cent unless a tolerance is given (the meter estimate).
//
// This script (not the app) holds the expected values. Uses saved model
// replies when it has them.
//
// Run: node --env-file=.env scripts/verify-check.ts [--verbose]

import { buildCorpus } from "../src/agent/corpus.ts";
import { detect } from "../src/agent/detectors.ts";
import { extractAll } from "../src/agent/extract.ts";
import { retrieveExact } from "../src/agent/retrieval.ts";
import { verifyCase, type VerifiedCase } from "../src/agent/verify.ts";
import { createConnectors, syncAll } from "../src/connectors/index.ts";
import { createLlm } from "../src/lib/llm.ts";
import { nodeTransport } from "./llm-node.ts";
import { nodeSeedSource } from "./seed-source.ts";

const verbose = process.argv.includes("--verbose");
const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
const corpus = await buildCorpus(connectors, await syncAll(connectors));
const candidates = detect(corpus).candidates;
const evidence = candidates.map((c) => retrieveExact(c, corpus));
const extraction = await extractAll(evidence, corpus, connectors, createLlm(nodeTransport(), { mode: "cache_first" }));

const started = performance.now();
const verified = new Map<string, VerifiedCase>(
  candidates.map((c, i) => [c.id, verifyCase(c, evidence[i], extraction, corpus)]),
);
const ms = (performance.now() - started).toFixed(1);

const fig = (id: string, figure: string) => verified.get(id)?.figures.find((f) => f.id === figure)?.value;

type Expect = [label: string, actual: unknown, expected: unknown, tolerance?: number];
const expectations: Record<string, Expect[]> = {
  "L1 Skylink": [
    ["overcharged so far", fig("cand_skylink", "overcharged_so_far"), 4000],
    ["per month", verified.get("cand_skylink")?.perMonthCents, 2000],
    ["term months", fig("cand_skylink", "term_months"), 24],
    ["at stake over the term", fig("cand_skylink", "at_stake"), 24000],
    ["charges left in term", fig("cand_skylink", "charges_left_in_term"), 10],
  ],
  "L2 StreamBox": [
    ["paid twice since June", fig("cand_apple+streambox", "duplicated_total"), 8995],
    ["charges via Apple", fig("cand_apple+streambox", "duplicate_charges_count"), 5],
    ["in statements", fig("cand_apple+streambox", "duplicates_in_statements"), 3],
    ["Apple renews", fig("cand_apple+streambox", "platform_renews"), "2026-11-21"],
    ["cancel by", fig("cand_apple+streambox", "cancel_by"), "2026-11-20"],
  ],
  "L3 IronWorks": [
    ["renews", fig("cand_ironworks", "renews_on"), "2026-11-28"],
    ["annual fee", fig("cand_ironworks", "renewal_amount"), 8900],
    ["notice deadline", fig("cand_ironworks", "notice_deadline"), "2026-11-14"],
    ["deadline passed", fig("cand_ironworks", "notice_passed"), true],
    ["last visit", fig("cand_ironworks", "last_used"), "2026-09-03"],
    ["monthly continues", verified.get("cand_ironworks")?.perMonthCents, 2995],
  ],
  "L4 BrightPage": [
    ["charges since trial", fig("cand_brightpage", "charges_since_trial"), 3],
    ["paid since trial", fig("cand_brightpage", "paid_since_trial"), 4497],
    ["last used", fig("cand_brightpage", "last_used"), "2026-09-21"],
    ["next charge", fig("cand_brightpage", "next_charge"), "2026-12-18"],
  ],
  "L5 Kestrel": [
    ["overpaid", fig("cand_kestrel", "overpaid"), 38500],
    ["invoice", fig("cand_kestrel", "invoice_reference"), "KP-20418"],
    ["receipts", fig("cand_kestrel", "receipt_references"), "R-77311, R-77402"],
  ],
  "L6 Wattle": [
    ["renewal premium", fig("cand_wattle", "renewal_amount"), 148554],
    ["increase", fig("cand_wattle", "renewal_increase"), 35154],
    ["increase %", fig("cand_wattle", "renewal_increase_percent"), 31],
    ["saving", fig("cand_wattle", "saving"), 37654],
    ["quote valid until", fig("cand_wattle", "quote_valid_until"), "2026-12-04"],
    ["like for like", fig("cand_wattle", "like_for_like"), true],
    ["renews", fig("cand_wattle", "renews_on"), "2026-12-07"],
  ],
  "L7 Redgum": [
    ["photo reading", fig("cand_redgum", "actual_reading"), 47006],
    ["estimated reading", fig("cand_redgum", "estimated_reading"), 47570],
    ["overcharge (±$15)", fig("cand_redgum", "overcharge_estimate"), 17500, 1500],
    ["already paid", fig("cand_redgum", "bill_paid_on"), "2026-11-10"],
  ],
  "D1 Kookaburra (decoy)": [
    ["matches announced CPI", fig("cand_kookaburra", "matches_announced_change"), true],
    ["increase", fig("cand_kookaburra", "overcharged_so_far"), 220],
  ],
  "D2 SchoolPay (decoy)": [["different references", fig("cand_schoolpay", "different_references"), true]],
};

let passed = 0;
let total = 0;
for (const [title, checks] of Object.entries(expectations)) {
  console.log(title);
  for (const [label, actual, expected, tolerance] of checks) {
    total += 1;
    const ok =
      tolerance !== undefined && typeof actual === "number" && typeof expected === "number"
        ? Math.abs(actual - expected) <= tolerance
        : actual === expected;
    if (ok) passed += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${String(actual)}${ok ? "" : ` (expected ${String(expected)})`}`);
  }
}

if (verbose) {
  for (const v of verified.values()) {
    console.log(`\n## ${v.names.join(" + ")}  deadline ${v.deadline ? `${v.deadline.date} ${v.deadline.label}` : "none"}`);
    for (const n of v.notes) console.log(`  - ${n}`);
    for (const w of v.warnings) console.log(`  ! ${w}`);
  }
}
console.log(`\n${passed}/${total} figures match, verify took ${ms} ms`);
process.exitCode = passed === total ? 0 : 1;
