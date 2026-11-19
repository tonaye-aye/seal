// Checks the model client end to end against the real endpoint: a JSON reply
// from each model with thinking off, the 35B with thinking on, the meter
// photo through the 9B, and replay from the saved replies.
//
// Run: node --env-file=.env scripts/llm-check.ts

import { readFile } from "node:fs/promises";
import { createLlm, type ModelRole } from "../src/lib/llm.ts";
import { nodeTransport } from "./llm-node.ts";

const live = createLlm(nodeTransport(), { mode: "live" });
const replay = createLlm(nodeTransport(), { mode: "replay" });

const schema = {
  name: "merchant",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["merchant", "amount"],
    properties: { merchant: { type: "string" }, amount: { type: "number" } },
  },
};
const ask = (model: ModelRole, think: boolean) => ({
  model,
  think,
  maxTokens: think ? 4000 : 300,
  schema,
  messages: [
    { role: "user" as const, content: 'From this bank line, give the merchant and amount: "SKYLINK INTERNET P/L DIRECT DEBIT 0082914 99.00"' },
  ],
});

let failed = 0;
async function step(label: string, run: () => Promise<string>) {
  try {
    console.log(`  ok    ${label}: ${await run()}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${label}: ${(error as Error).message}`);
  }
}

for (const [model, think] of [["fast", false], ["judge", false], ["flash", false], ["judge", true]] as const) {
  await step(`${model}, thinking ${think ? "on" : "off"}`, async () => {
    const r = await live.chat<{ merchant: string; amount: number }>(ask(model, think));
    return `${JSON.stringify(r.json)} in ${r.ms} ms, ${r.usage.reasoning} reasoning tokens, ${r.source}`;
  });
}

await step("meter photo (9B, thinking off)", async () => {
  const photo = await readFile(new URL("../seed/documents/Home & Utilities/Energy/Meter-Photo-2026-10-30.jpg", import.meta.url));
  const r = await live.chat<{ reading_kwh: number }>({
    model: "fast",
    think: false,
    maxTokens: 300,
    schema: {
      name: "meter",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["reading_kwh"],
        properties: { reading_kwh: { type: "number", description: "Whole kWh. A red final digit is tenths: leave it out." } },
      },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Read this electricity meter. Give the reading in whole kWh." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${photo.toString("base64")}` } },
        ],
      },
    ],
  });
  return `${r.json.reading_kwh} kWh in ${r.ms} ms`;
});

await step("replay returns the saved reply", async () => {
  const r = await replay.chat(ask("fast", false));
  if (r.source !== "cache") throw new Error(`source was ${r.source}`);
  return `source ${r.source}, ${r.ms} ms`;
});

await step("replay refuses a request never made", async () => {
  try {
    await replay.chat({ ...ask("fast", false), temperature: 0.42 });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected not_cached");
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
