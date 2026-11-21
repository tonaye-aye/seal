// Guards the saved model answers. Runs a whole check on saved answers only (no
// network) and lists every request that has no saved answer, by stage.
//
// Saved answers are matched on the exact request, so a changed prompt or seed
// record shows up here as a miss. Every miss fails this check. Misses are
// counted apart for the washing machine case (L8), so a run before its answers
// are saved can still prove the other seven findings didn't move.
//
//   node scripts/saved-answers-check.ts

import { runScan } from "../src/agent/pipeline.ts";
import { createConnectors } from "../src/connectors/index.ts";
import { createLlm, LlmError, type LlmTransport } from "../src/lib/llm.ts";
import { nodeTransport } from "./llm-node.ts";
import { nodeSeedSource } from "./seed-source.ts";

const EARLIER_FINDINGS = [
  "finding_apple+streambox",
  "finding_brightpage",
  "finding_ironworks",
  "finding_kestrel",
  "finding_redgum",
  "finding_skylink",
  "finding_wattle",
];
const WARRANTY_FINDING = "finding_norvik+spinwell";
const EXPECTED_CLEARED = 2;

const base = nodeTransport();
const misses = new Map<string, Set<string>>();
const warrantyMisses = new Map<string, Set<string>>();

/** Is this request about the washing machine case? Its serial or businesses appear in every one. */
const isWarranty = (body: string) => /NVK-204417|Norvik|Spinwell/.test(body);

/** Which stage a request belongs to, from the name of the reply shape it asks for. */
function stageOf(body: string): string {
  const parsed = JSON.parse(body) as { response_format?: { json_schema?: { name?: string } } };
  return parsed.response_format?.json_schema?.name ?? "other";
}

const transport: LlmTransport = {
  async post(path, body, key) {
    try {
      return await base.post(path, body, key, "replay");
    } catch (error) {
      if (error instanceof LlmError && error.kind === "not_cached") {
        const stage = stageOf(body);
        const list = isWarranty(body) ? warrantyMisses : misses;
        list.set(stage, (list.get(stage) ?? new Set()).add(key));
      }
      throw error;
    }
  },
};

const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
const result = await runScan(connectors, createLlm(transport, { mode: "replay" }));

const total = (list: Map<string, Set<string>>) => [...list.values()].reduce((n, keys) => n + keys.size, 0);
const ids = new Set(result.findings.map((f) => f.id));
const missingEarlier = EARLIER_FINDINGS.filter((id) => !ids.has(id));
const whole = (id: string) => {
  const f = result.findings.find((x) => x.id === id);
  return !!f?.draft && !!f.fix;
};
console.log(`findings ${result.findings.length}, cleared ${result.cleared.length}, undecided ${result.undecided.length}`);
console.log(`with a draft ${result.findings.filter((f) => f.draft).length}, with routes ${result.findings.filter((f) => f.fix).length}`);
for (const [stage, keys] of misses) console.log(`FAIL no saved answer for ${keys.size} "${stage}" request(s) in the earlier seven`);
for (const id of missingEarlier) console.log(`FAIL ${id} is missing`);
const earlierOk = total(misses) === 0 && missingEarlier.length === 0 && EARLIER_FINDINGS.every(whole);
console.log(earlierOk ? "The earlier seven all replay, with zero misses" : "The earlier seven no longer replay");

for (const [stage, keys] of warrantyMisses) console.log(`waiting: ${keys.size} "${stage}" request(s) for the warranty case`);
const warrantyOk = total(warrantyMisses) === 0 && whole(WARRANTY_FINDING);
console.log(warrantyOk ? "The warranty case replays, with zero misses" : "The warranty case has no complete saved answers yet");

const ok = earlierOk && warrantyOk && result.findings.length === EARLIER_FINDINGS.length + 1 && result.cleared.length === EXPECTED_CLEARED && result.undecided.length === 0;
console.log(ok ? "All saved answers match" : "Saved answers are incomplete");
process.exitCode = ok ? 0 : 1;
