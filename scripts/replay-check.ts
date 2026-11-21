// Checks how the app copes when the model endpoint can't be used
// (src/lib/model-session.ts): saved answers from the start, losing the
// endpoint partway through, calls that never answer, and requests with no
// saved answer. The first part uses a pretend endpoint, so it needs no network.
//
//   node scripts/replay-check.ts
//
// With --scan it also runs a whole check with the real endpoint, which "drops"
// after a set number of calls (like the demo panel's switch), and reports how
// many findings came live and how many from saved answers:
//
//   node --env-file=.env scripts/replay-check.ts --scan [--drop 60]

import { runScan } from "../src/agent/pipeline.ts";
import { createConnectors } from "../src/connectors/index.ts";
import { LlmError, type ChatRequest, type LlmTransport, type TransportReply } from "../src/lib/llm.ts";
import { createModelSession } from "../src/lib/model-session.ts";
import { nodeTransport } from "./llm-node.ts";
import { nodeSeedSource } from "./seed-source.ts";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}

const reply = (text: string, source: "live" | "cache"): TransportReply => ({
  status: 200,
  source,
  body: JSON.stringify({ model: "test", choices: [{ message: { content: text }, finish_reason: "stop" }], usage: {} }),
});

/** A pretend endpoint: `live` decides what each live call does; saved answers exist for every request unless `noSaved`. */
function fake(live: (n: number) => Promise<TransportReply>, noSaved = false) {
  const calls = { live: 0, replay: 0 };
  const transport: LlmTransport = {
    async post(_path, _body, _key, mode) {
      if (mode === "replay") {
        calls.replay++;
        if (noSaved) throw new LlmError("not_cached", "No saved reply.");
        return reply("saved", "cache");
      }
      calls.live++;
      return live(calls.live);
    },
  };
  return { transport, calls };
}

const ask = (n: number): ChatRequest => ({ model: "fast", think: false, maxTokens: 20, messages: [{ role: "user", content: `question ${n}` }] });
const down = () => Promise.reject(new LlmError("network", "Could not reach the endpoint"));

// 1. Live while it works, then saved answers for the rest after the first failure.
{
  const { transport, calls } = fake((n) => (n <= 2 ? Promise.resolve(reply("live", "live")) : down()));
  let lostCount = 0;
  const s = createModelSession({ transport, start: "live", onLost: () => lostCount++ });
  const a = [await s.chat(ask(1)), await s.chat(ask(2)), await s.chat(ask(3)), await s.chat(ask(4)), await s.chat(ask(5))];
  check("first two answers are live", a[0].source === "live" && a[1].source === "live");
  check("after the endpoint drops, answers are saved ones", a.slice(2).every((r) => r.source === "cache"));
  check("lost is reported once", lostCount === 1 && s.lost() !== undefined, s.lost());
  // The failing call retries twice (live() backoff), then nothing more goes to the endpoint.
  check("no live calls after the drop", calls.live === 5, `${calls.live} live calls`);
}

// 2. Saved answers from the start never touch the endpoint.
{
  const { transport, calls } = fake(() => Promise.resolve(reply("live", "live")));
  const s = createModelSession({ transport, start: "replay" });
  const r = await s.chat(ask(1));
  check("replay start uses saved answers only", r.source === "cache" && calls.live === 0);
}

// 3. A call that never answers counts as the endpoint being down.
{
  const { transport } = fake(() => new Promise<TransportReply>(() => {}));
  const s = createModelSession({ transport, start: "live", callLimitMs: 50 });
  const started = Date.now();
  const r = await s.chat(ask(1));
  check("a call with no answer falls back after the time limit", r.source === "cache" && Date.now() - started < 1000, `${Date.now() - started} ms`);
  check("and says why", /in time/.test(s.lost() ?? ""), s.lost());
}

// 4. Down with nothing saved: a plain error, nothing made up.
{
  const { transport } = fake(down, true);
  const s = createModelSession({ transport, start: "live" });
  try {
    await s.chat(ask(1));
    check("no saved answer gives an error", false);
  } catch (error) {
    check("no saved answer gives a not_cached error", error instanceof LlmError && error.kind === "not_cached", (error as Error).message);
  }
}

// 5. A bad request (400) is not the endpoint being down: no switch to replay.
{
  const { transport } = fake((n) => Promise.resolve(n === 1 ? { status: 400, body: "bad", source: "live" } : reply("live", "live")));
  const s = createModelSession({ transport, start: "live" });
  const first = await s.chat(ask(1));
  const second = await s.chat(ask(2));
  check("a 400 uses a saved answer for that call only", first.source === "cache" && second.source === "live" && !s.lost());
}

// 6. A rejected key partway through counts as lost.
{
  const { transport } = fake((n) => Promise.resolve(n === 1 ? reply("live", "live") : { status: 401, body: "no", source: "live" }));
  const s = createModelSession({ transport, start: "live" });
  await s.chat(ask(1));
  const r = await s.chat(ask(2));
  check("a 401 partway switches to saved answers", r.source === "cache" && /API key/.test(s.lost() ?? ""), s.lost());
}

// 7. Optional: a whole check against the real endpoint that drops partway,
// handled the way the app does (src/lib/scan-store.ts): on the drop, the check
// starts again on saved answers. Saves only first answers, like the app, so
// the eval's saved answers are never replaced.
if (process.argv.includes("--scan")) {
  const i = process.argv.indexOf("--drop");
  const dropAfter = i > 0 ? Number(process.argv[i + 1]) : 15;
  const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
  const transport = nodeTransport({ save: "if_absent" });
  let stage = "";
  let signal: (reason: string) => void = () => undefined;
  const lost = new Promise<string>((resolve) => (signal = resolve));
  const session = createModelSession({ transport, start: "live", dropAfter, onLost: signal });
  const started = Date.now();
  const live = runScan(connectors, session, (e) => {
    if (e.type === "stage" && e.status === "start") stage = e.stage;
  });
  live.catch(() => undefined);
  const outcome = await Promise.race([live.then((result) => ({ result })), lost.then((reason) => ({ reason }))]);
  const lostAt = "reason" in outcome ? `${stage}: ${outcome.reason} after ${((Date.now() - started) / 1000).toFixed(1)} s` : undefined;
  const result = "result" in outcome ? outcome.result : await runScan(connectors, createModelSession({ transport, start: "replay" }));
  const saved = result.findings.filter((f) => f.judgedBy.source === "cache").length;
  console.log(`\nWhole check, endpoint drops after ${dropAfter} calls: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  lost at ${lostAt ?? "never"}`);
  console.log(`  ${result.findings.length} findings (${saved} from saved answers), ${result.cleared.length} left alone, ${result.undecided.length} couldn't decide`);
  check("redone check still finds 8, leaves 2 alone, none undecided", result.findings.length === 8 && result.cleared.length === 2 && result.undecided.length === 0);
  check("every finding and draft is labelled saved", result.findings.every((f) => f.judgedBy.source === "cache" && (!f.draft || f.draft.source === "cache")));
  check("the drop was reported", lostAt !== undefined);
  // The abandoned live run carries on in the background; don't wait for it.
}

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
