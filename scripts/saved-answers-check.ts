// Guards the saved model answers. Runs a whole check on saved answers only (no
// network) and lists every request that has no saved answer, by stage.
//
// Saved answers are matched on the exact request, so a changed prompt or seed
// record shows up here as a miss. Route plans are reported but allowed, because
// a new one is expected until the next live run fills it in.
//
//   node scripts/saved-answers-check.ts

import { runScan } from "../src/agent/pipeline.ts";
import { createConnectors } from "../src/connectors/index.ts";
import { createLlm, LlmError, type LlmTransport } from "../src/lib/llm.ts";
import { nodeTransport } from "./llm-node.ts";
import { nodeSeedSource } from "./seed-source.ts";

const EXPECTED_FINDINGS = 7;

const base = nodeTransport();
const misses = new Map<string, Set<string>>();

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
        misses.set(stage, (misses.get(stage) ?? new Set()).add(key));
      }
      throw error;
    }
  },
};

const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
const result = await runScan(connectors, createLlm(transport, { mode: "replay" }));

const count = (stage: string) => misses.get(stage)?.size ?? 0;
const blocking = [...misses.keys()].filter((s) => s !== "fix_plan");
console.log(`findings ${result.findings.length}, cleared ${result.cleared.length}, undecided ${result.undecided.length}`);
console.log(`with a draft ${result.findings.filter((f) => f.draft).length}, with routes ${result.findings.filter((f) => f.fix).length}`);
console.log(`route plans waiting for a live run: ${count("fix_plan")}`);
for (const stage of blocking) console.log(`FAIL no saved answer for ${count(stage)} "${stage}" request(s)`);

const ok = blocking.length === 0 && result.findings.length === EXPECTED_FINDINGS && result.undecided.length === 0;
console.log(ok ? "All existing saved answers still match" : "Saved answers no longer match");
process.exitCode = ok ? 0 : 1;
