// Endpoint capability probes: what the endpoint really supports.
// Run: node --env-file=.env scripts/probe.ts [--only reasoning,schema,stream,tools,embed,concurrency]
// Answers yes/no questions about the endpoint and measures latency. It does not score quality (spike.ts does).
// Writes scripts/spike-out/probe.json (latest) and appends to probe.jsonl (history). Never prints the key.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BC_BASE_URL?.replace(/\/+$/, "");
const KEY = process.env.BC_API_KEY;
if (!BASE || !KEY) {
  console.error("BC_BASE_URL or BC_API_KEY missing. Copy .env.example to .env, fill both in, then run: node --env-file=.env scripts/probe.ts");
  process.exit(1);
}
const M9 = "basecompute/qwen3.5-9b";
const M35 = "basecompute/qwen3.6-35b-a3b";
const FLASH = "basecompute/qwen3.8-flash-next";
const EMB = "basecompute/qwen3-embedding-4b";
const CHAT_MODELS = [M9, M35, FLASH];
const short = (m: string) => m.split("/")[1];
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const want = (k: string) => !only || only.includes(k);
const SEED = new URL("../seed/", import.meta.url).pathname;

const results: Record<string, any> = {};
const say = (s: string) => console.log(s);

// ---------- raw client: returns everything so I can see what the endpoint really sends ----------
async function post(path: string, body: any, timeoutMs = 120_000) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text: json ? "" : text.slice(0, 300), ms: performance.now() - t0 };
  } catch (e: any) {
    return { status: 0, json: null, text: e?.name === "TimeoutError" ? "timeout" : String(e?.message ?? e), ms: performance.now() - t0 };
  }
}

function summarise(r: Awaited<ReturnType<typeof post>>) {
  const c = r.json?.choices?.[0];
  const msg = c?.message ?? {};
  const reasoningText: string = msg.reasoning ?? msg.reasoning_content ?? "";
  const u = r.json?.usage ?? {};
  const reasoningTokens = u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens ?? null;
  return {
    status: r.status, ms: Math.round(r.ms), finish: c?.finish_reason ?? null,
    content: typeof msg.content === "string" ? msg.content : null,
    reasoningChars: reasoningText?.length ?? 0, reasoningTokens, completionTokens: u.completion_tokens ?? null,
    error: r.status !== 200 ? (r.json?.error?.message ?? r.text).slice(0, 160) : undefined,
  };
}

const CLASSIFY = [
  { role: "user", content: 'Classify this bank descriptor into a category. Descriptor: "APPLE.COM/BILL 17.99". Reply with JSON only: {"category": string}' },
];

// ---------- 1. reasoning controls on the thinking models ----------
async function reasoning() {
  say("\n## Reasoning controls (can thinking be switched off or capped?)");
  const variants: [string, any][] = [
    ["baseline", {}],
    ["chat_template_kwargs.enable_thinking=false", { chat_template_kwargs: { enable_thinking: false } }],
    ["reasoning_effort=low", { reasoning_effort: "low" }],
    ["reasoning.effort=low", { reasoning: { effort: "low" } }],
    ["reasoning.enabled=false", { reasoning: { enabled: false } }],
    ["/no_think in prompt", { __noThink: true }],
  ];
  const out: any[] = [];
  for (const model of [M35, FLASH, M9]) {
    const rows = await Promise.all(variants.map(async ([name, extra]) => {
      const { __noThink, ...params } = extra;
      const messages = __noThink ? [{ role: "user", content: CLASSIFY[0].content + " /no_think" }] : CLASSIFY;
      const s = summarise(await post("/chat/completions", { model, messages, max_tokens: 2000, temperature: 0, ...params }));
      return { model: short(model), variant: name, ...s };
    }));
    for (const r of rows) {
      say(`  ${r.model.padEnd(20)} ${r.variant.padEnd(44)} ${r.status} ${String(r.ms).padStart(6)}ms  reasoning ${String(r.reasoningTokens ?? "?").padStart(4)} tok / ${String(r.reasoningChars).padStart(5)} chars  content=${r.content ? JSON.stringify(r.content.slice(0, 40)) : "null"}${r.error ? "  ERR " + r.error : ""}`);
      out.push(r);
    }
  }
  results.reasoning = out;
}

// ---------- 2. structured output ----------
async function schema() {
  say("\n## Structured output (json_object vs json_schema)");
  const sch = {
    type: "object", additionalProperties: false, required: ["merchant", "amount", "is_subscription"],
    properties: { merchant: { type: "string" }, amount: { type: "number" }, is_subscription: { type: "boolean" } },
  };
  const messages = [{ role: "user", content: "Email: 'Your StreamBox Premium renews 21 Nov for $17.99.' Extract merchant, amount, and whether it is a subscription." }];
  const formats: [string, any][] = [
    ["none", undefined],
    ["json_object", { type: "json_object" }],
    ["json_schema strict", { type: "json_schema", json_schema: { name: "fact", strict: true, schema: sch } }],
  ];
  const out: any[] = [];
  for (const model of CHAT_MODELS) {
    for (const [name, rf] of formats) {
      const s = summarise(await post("/chat/completions", { model, messages, max_tokens: 3000, temperature: 0, ...(rf ? { response_format: rf } : {}) }));
      let parsed: any = null, pure = false, conforms = false;
      if (s.content) {
        try { parsed = JSON.parse(s.content.trim()); pure = true; } catch {
          const m = s.content.match(/\{[\s\S]*\}/); if (m) try { parsed = JSON.parse(m[0]); } catch {}
        }
        conforms = !!parsed && typeof parsed.merchant === "string" && typeof parsed.amount === "number" && typeof parsed.is_subscription === "boolean"
          && Object.keys(parsed).every((k) => k in sch.properties);
      }
      const r = { model: short(model), format: name, status: s.status, ms: s.ms, pureJson: pure, conformsToSchema: conforms, sample: s.content?.slice(0, 80), error: s.error };
      say(`  ${r.model.padEnd(20)} ${name.padEnd(20)} ${r.status} ${String(r.ms).padStart(6)}ms  pure JSON=${pure}  matches schema=${conforms}${r.error ? "  ERR " + r.error : ""}`);
      out.push(r);
    }
  }
  results.schema = out;
}

// ---------- 3. streaming ----------
async function stream() {
  say("\n## Streaming (SSE shape, time to first reasoning and first content token)");
  const out: any[] = [];
  for (const model of CHAT_MODELS) {
    const t0 = performance.now();
    let firstAny: number | null = null, firstReasoning: number | null = null, firstContent: number | null = null;
    let chunks = 0, content = "", usage: any = null, err = "";
    const deltaKeys = new Set<string>();
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "In two sentences, why do small language models struggle with arithmetic?" }], max_tokens: 3000, stream: true, stream_options: { include_usage: true } }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok || !res.body) err = `HTTP ${res.status}`;
      else {
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim(); if (data === "[DONE]") continue;
            let j: any; try { j = JSON.parse(data); } catch { continue; }
            chunks++; const now = performance.now() - t0; firstAny ??= now;
            if (j.usage) usage = j.usage;
            const d = j.choices?.[0]?.delta ?? {};
            Object.keys(d).forEach((k) => deltaKeys.add(k));
            if ((d.reasoning || d.reasoning_content) && firstReasoning === null) firstReasoning = now;
            if (d.content) { if (firstContent === null) firstContent = now; content += d.content; }
          }
        }
      }
    } catch (e: any) { err = String(e?.message ?? e); }
    const r = { model: short(model), totalMs: Math.round(performance.now() - t0), firstChunkMs: firstAny && Math.round(firstAny), firstReasoningMs: firstReasoning && Math.round(firstReasoning), firstContentMs: firstContent && Math.round(firstContent), chunks, deltaKeys: [...deltaKeys], usageInStream: !!usage, contentChars: content.length, error: err || undefined };
    say(`  ${r.model.padEnd(20)} first chunk ${r.firstChunkMs}ms  first reasoning ${r.firstReasoningMs ?? "-"}ms  first content ${r.firstContentMs ?? "-"}ms  total ${r.totalMs}ms  chunks ${chunks}  delta keys [${r.deltaKeys.join(",")}]  usage=${r.usageInStream}${err ? "  ERR " + err : ""}`);
    out.push(r);
  }
  results.stream = out;
}

// ---------- 4. tool calling ----------
async function tools() {
  say("\n## Tool calling (does it pick the tool, with valid arguments, and use the result?)");
  const toolDefs = [
    { type: "function", function: { name: "search_email", description: "Search the household mailbox. Returns matching emails.", parameters: { type: "object", required: ["query"], properties: { query: { type: "string", description: "Keywords" }, after: { type: "string", description: "ISO date, optional" } } } } },
    { type: "function", function: { name: "list_transactions", description: "List bank and card transactions matching a descriptor.", parameters: { type: "object", required: ["descriptor"], properties: { descriptor: { type: "string" } } } } },
  ];
  const sys = { role: "system", content: "You investigate household charges. Use tools to find evidence before answering. Today is 2026-11-19." };
  const user = { role: "user", content: "There are card charges described only as APPLE.COM/BILL for $17.99. Find out what they are for." };
  const out: any[] = [];
  for (const model of CHAT_MODELS) {
    const r1 = await post("/chat/completions", { model, messages: [sys, user], tools: toolDefs, tool_choice: "auto", max_tokens: 4000, temperature: 0 });
    const m1 = r1.json?.choices?.[0]?.message;
    const calls: any[] = m1?.tool_calls ?? [];
    let argsValid = calls.length > 0;
    for (const c of calls) { try { JSON.parse(c.function?.arguments ?? ""); } catch { argsValid = false; } }
    let step2: any = null;
    if (calls.length) {
      // feed back a realistic tool result and see if it reaches the right answer
      const toolMsgs = calls.map((c) => ({ role: "tool", tool_call_id: c.id, content: c.function?.name === "search_email"
        ? JSON.stringify([{ id: "msg_0012", from: "Apple", date: "2026-08-21", body: "Receipt. StreamBox - Premium (1 month). Renews 21 Sep 2026. $17.99 AUD" }])
        : JSON.stringify([{ id: "txn_x", date: "2026-08-21", description: "APPLE.COM/BILL", debit: 17.99 }]) }));
      const r2 = await post("/chat/completions", { model, messages: [sys, user, { role: "assistant", content: m1.content ?? "", tool_calls: calls }, ...toolMsgs], tools: toolDefs, max_tokens: 4000, temperature: 0 });
      const m2 = r2.json?.choices?.[0]?.message;
      step2 = { status: r2.status, ms: Math.round(r2.ms), moreToolCalls: (m2?.tool_calls ?? []).length, mentionsStreamBox: /streambox/i.test(m2?.content ?? ""), answer: (m2?.content ?? "").slice(0, 120) };
    }
    const r = { model: short(model), status: r1.status, ms: Math.round(r1.ms), toolCalls: calls.map((c) => `${c.function?.name}(${c.function?.arguments})`), argsValid, finish: r1.json?.choices?.[0]?.finish_reason, step2, error: r1.status !== 200 ? (r1.json?.error?.message ?? r1.text).slice(0, 160) : undefined };
    say(`  ${r.model.padEnd(20)} ${r.status} ${String(r.ms).padStart(6)}ms  calls: ${r.toolCalls.join("; ") || "none"}  args valid=${argsValid}${step2 ? `  -> step 2 ${step2.ms}ms, found StreamBox=${step2.mentionsStreamBox}, more calls=${step2.moreToolCalls}` : ""}${r.error ? "  ERR " + r.error : ""}`);
    out.push(r);
  }
  results.tools = out;
}

// ---------- 5. embeddings ----------
async function embed() {
  say("\n## Embeddings (dimension, latency, batch, does retrieval rank the right email?)");
  const msgs: any[] = JSON.parse(readFileSync(join(SEED, "email/inbox.json"), "utf8")).messages;
  const pick = (id: string) => { const m = msgs.find((x) => x.id === id); return `${m.subject}\n${m.body}`; };
  const docs = { msg_0012: pick("msg_0012"), msg_0018: pick("msg_0018"), msg_0009: pick("msg_0009"), msg_0020: pick("msg_0020"), msg_0030: pick("msg_0030") };
  const query = "Card charge APPLE.COM/BILL $17.99 on 21 Aug 2026";
  const one = await post("/embeddings", { model: EMB, input: query });
  const dim = one.json?.data?.[0]?.embedding?.length ?? null;
  const batch = await post("/embeddings", { model: EMB, input: [query, ...Object.values(docs)] });
  const vecs: number[][] = (batch.json?.data ?? []).sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
  const cos = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); };
  const ranking = vecs.length > 1 ? Object.keys(docs).map((id, i) => ({ id, score: +cos(vecs[0], vecs[i + 1]).toFixed(3) })).sort((a, b) => b.score - a.score) : [];
  // larger batch to see throughput: 32 short email texts
  const big = msgs.slice(0, 32).map((m) => `${m.subject}\n${m.body}`);
  const b32 = await post("/embeddings", { model: EMB, input: big });
  const r = { dim, singleMs: Math.round(one.ms), batch6Ms: Math.round(batch.ms), batch32Ms: Math.round(b32.ms), batch32Ok: (b32.json?.data ?? []).length === 32, ranking, error: one.status !== 200 ? one.text : b32.status !== 200 ? `batch32 HTTP ${b32.status} ${b32.json?.error?.message ?? b32.text}` : undefined };
  say(`  dim ${dim}  single ${r.singleMs}ms  batch of 6 ${r.batch6Ms}ms  batch of 32 ${r.batch32Ms}ms (ok=${r.batch32Ok})${r.error ? "  ERR " + r.error : ""}`);
  say(`  query "${query}" ranks: ${ranking.map((x) => `${x.id} ${x.score}`).join(" > ")}  (msg_0012 = Apple receipt for StreamBox; want it first)`);
  results.embed = r;
}

// ---------- 6. concurrency / rate limits ----------
async function concurrency() {
  say("\n## Concurrency (12 parallel 9B calls, then 6 parallel 35B calls)");
  const out: any[] = [];
  for (const [model, n] of [[M9, 12], [M35, 6]] as [string, number][]) {
    const t0 = performance.now();
    const rs = await Promise.all(Array.from({ length: n }, (_, i) => post("/chat/completions", { model, messages: [{ role: "user", content: `Reply with the number ${i} and nothing else.` }], max_tokens: 1500, temperature: 0 })));
    const ms = rs.map((r) => Math.round(r.ms)).sort((a, b) => a - b);
    const statuses = rs.reduce((acc: Record<number, number>, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
    const r = { model: short(model), n, wallMs: Math.round(performance.now() - t0), p50: ms[Math.floor(n / 2)], max: ms[n - 1], statuses };
    say(`  ${r.model.padEnd(20)} ${n} parallel: wall ${r.wallMs}ms  p50 ${r.p50}ms  max ${r.max}ms  statuses ${JSON.stringify(statuses)}`);
    out.push(r);
  }
  results.concurrency = out;
}

const t0 = performance.now();
if (want("reasoning")) await reasoning();
if (want("schema")) await schema();
if (want("stream")) await stream();
if (want("tools")) await tools();
if (want("embed")) await embed();
if (want("concurrency")) await concurrency();
say(`\ntotal ${((performance.now() - t0) / 1000).toFixed(0)}s`);

const dir = new URL("./spike-out/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const run = { at: new Date().toISOString(), args, results };
writeFileSync(join(dir, "probe.json"), JSON.stringify(run, null, 2));
appendFileSync(join(dir, "probe.jsonl"), JSON.stringify(run) + "\n");
