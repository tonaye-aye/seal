// Model spike + eval. Run: node --env-file=.env scripts/spike.ts [--tasks detect,draft,vision] [--only L1,D1]
// This script (and only this script) may read seed/eval/ground_truth.json.
// It hands each model the *evidence bundle* for a case (ids from ground truth), so it measures
// judging/drafting/reading quality, not retrieval. Retrieval is the agent's job and is tested separately.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BC_BASE_URL?.replace(/\/+$/, "");
const KEY = process.env.BC_API_KEY;
if (!BASE || !KEY) {
  console.error("BC_BASE_URL or BC_API_KEY missing. Copy .env.example to .env, fill both in, then run: node --env-file=.env scripts/spike.ts");
  process.exit(1);
}
const SEED = new URL("../seed/", import.meta.url).pathname;
const M9 = "basecompute/qwen3.5-9b";
const M35 = "basecompute/qwen3.6-35b-a3b";
const FLASH = "basecompute/qwen3.8-flash-next";
const args = process.argv.slice(2);
const opt = (k: string) => args[args.indexOf(`--${k}`) + 1];
const tasks = (args.includes("--tasks") ? opt("tasks") : "detect,draft,vision").split(",");
const only = args.includes("--only") ? opt("only").split(",") : null;

// ---------- endpoint client ----------
type Msg = { role: string; content: any };
interface CallResult { text: string; ms: number; tokens: { prompt: number; completion: number }; model: string; attempts: number; error?: string }

async function chat(model: string, messages: Msg[], o: { max_tokens: number; json?: boolean; timeoutMs?: number; retries?: number } ): Promise<CallResult> {
  const retries = o.retries ?? 1;
  const t0 = performance.now();
  let lastErr = "";
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model, messages, max_tokens: o.max_tokens, temperature: 0.1, ...(o.json ? { response_format: { type: "json_object" } } : {}) }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 180_000),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`; continue; }
      const j: any = await res.json();
      const text: string = j.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) { lastErr = `empty content (finish=${j.choices?.[0]?.finish_reason}, completion_tokens=${j.usage?.completion_tokens})`; continue; }
      return { text, ms: performance.now() - t0, tokens: { prompt: j.usage?.prompt_tokens ?? 0, completion: j.usage?.completion_tokens ?? 0 }, model, attempts: attempt };
    } catch (e: any) { lastErr = String(e?.name === "TimeoutError" ? "timeout" : e?.message ?? e); }
  }
  return { text: "", ms: performance.now() - t0, tokens: { prompt: 0, completion: 0 }, model, attempts: retries + 1, error: lastErr };
}

function parseJson(text: string): any | null {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ---------- seed readers (eval-side bundle building) ----------
const readJson = (p: string) => JSON.parse(readFileSync(join(SEED, p), "utf8"));
const gt = readJson("eval/ground_truth.json");
const emails: any[] = readJson("email/inbox.json").messages;
const docs: any[] = readJson("documents/index.json").documents;
const events: any[] = (() => { const c = readJson("calendar/events.json"); return Array.isArray(c) ? c : c.events ?? []; })();
const txns = new Map<string, string>();
for (const f of ["bank/joint-everyday.csv", "bank/maya-visa.csv"]) {
  for (const line of readFileSync(join(SEED, f), "utf8").split("\n").slice(1)) {
    const id = line.split(",")[0];
    if (id) txns.set(id, line);
  }
}

function bundle(ev: any): string {
  const out: string[] = [];
  if (ev.transactions?.length) out.push("## Bank transactions (id,date,description,debit,credit,balance)\n" + ev.transactions.map((i: string) => txns.get(i)).join("\n"));
  for (const id of ev.emails ?? []) {
    const m = emails.find((e) => e.id === id);
    if (m) out.push(`## Email ${m.id} | ${m.date} | from ${m.from?.name} <${m.from?.address}> | to ${(m.to ?? []).map((t: any) => t.name).join(", ")}\nSubject: ${m.subject}\n${m.body}`);
  }
  for (const id of ev.documents ?? []) {
    const d = docs.find((x) => x.id === id);
    if (d?.textPath) out.push(`## Document ${d.id} | ${d.filename}\n${readFileSync(join(SEED, "documents", d.textPath), "utf8")}`);
  }
  for (const id of ev.calendar ?? []) {
    const e = events.find((x) => x.id === id);
    if (e) out.push(`## Calendar ${id}\n${JSON.stringify(e)}`);
  }
  return out.join("\n\n");
}

const cases: { id: string; isLeak: boolean; title: string; merchant: string; ev: any; leak?: any }[] = [
  ...gt.leaks.map((l: any) => ({ id: l.id, isLeak: true, title: l.title, merchant: l.merchant, ev: l.evidence, leak: l })),
  ...gt.decoys.map((d: any) => ({ id: d.id, isLeak: false, title: d.title, merchant: d.slug, ev: d.evidence })),
].filter((c) => !only || only.includes(c.id));

const SYSTEM_CTX = `You are a household finance admin agent for the Whitlock family (Maya, Ben, kids Ollie and Pia) in Melbourne, Australia. Today is Thursday 19 November 2026. Currency is AUD. You never do arithmetic or date maths yourself beyond quoting figures that appear in the evidence; code will verify.`;

// ---------- task A: detect / judge ----------
const DETECT_PROMPT = (c: any, evidence: string = bundle(c.ev)) => `Below is the evidence the agent gathered about one merchant or charge. Decide whether the household should ACT on it: is there a charge (past or about to happen) that is wrong, duplicated, unwanted or avoidable, such that a message, a cancellation or a decision would save money?
Count as problems: price rises that break what was agreed in a contract; the same thing paid twice (two channels, two payment methods); a trial that quietly converted to a paid plan nobody uses; a renewal or annual fee approaching where the household wants out or a cheaper like-for-like quote exists; a bill based on an estimate or reading that looks wrong. A problem does not need to be a proven error: an upcoming charge the household would not want, with a deadline, counts.
NOT problems: increases the contract explicitly allows (e.g. CPI indexation) that were notified in advance and match the stated formula; charges that look alike but have different references, people or notices.

Return ONLY JSON: {"is_problem": boolean, "kind": "price_increase_vs_contract"|"duplicate_subscription"|"duplicate_payment"|"renewal_trap"|"trial_converted"|"renewal_price_creep"|"billing_error"|"none", "headline": string, "claimed_amount_aud": number|null, "confidence": number 0-1, "cited_ids": string[]}

${evidence}`;

interface Row { task: string; model: string; case: string; ok: boolean; ms: number; detail: string; tokens?: number; attempts?: number; error?: string }
const rows: Row[] = [];
const log = (r: Row) => { rows.push(r); console.log(`${r.ok ? "PASS" : "FAIL"} ${r.task.padEnd(7)} ${r.model.split("/")[1].padEnd(22)} ${r.case.padEnd(3)} ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${r.detail}${r.error ? "  ERR:" + r.error : ""}`); };

async function detect() {
  for (const model of [M9, M35]) {
    await Promise.all(cases.map(async (c) => {
      const msgs = [{ role: "system", content: SYSTEM_CTX }, { role: "user", content: DETECT_PROMPT(c) }];
      const run = (m: string) => chat(m, msgs, { max_tokens: m === M9 ? 800 : 6000, json: true });
      // Production policy: parse failure -> retry same model once -> fall back to the 35B.
      const t0 = performance.now();
      let r = await run(model), j = parseJson(r.text), note = "";
      if (!j) { console.log(`  ! ${model.split("/")[1]} ${c.id} bad JSON (${r.error ?? JSON.stringify(r.text.slice(0, 120))}), retrying`); r = await run(model); j = parseJson(r.text); note = " [retry]"; }
      if (!j && model !== M35) { r = await run(M35); j = parseJson(r.text); note = " [fell back to 35B]"; }
      r = { ...r, ms: performance.now() - t0 };
      if (!j) return log({ task: "detect", model, case: c.id, ok: false, ms: r.ms, detail: "no/invalid JSON after retry+fallback", error: r.error, attempts: r.attempts });
      const verdict = !!j.is_problem;
      const kindOk = !c.isLeak || j.kind === c.leak.kind;
      const ok = verdict === c.isLeak;
      log({ task: "detect", model, case: c.id, ok, ms: r.ms, tokens: r.tokens.completion, attempts: r.attempts,
        detail: `flagged=${verdict} kind=${j.kind}${c.isLeak ? (kindOk ? " (kind ok)" : ` (want ${c.leak.kind})`) : ""} amt=${j.claimed_amount_aud} conf=${j.confidence}${note}` });
    }));
  }
}

// ---------- task B: draft ----------
const MUST: Record<string, string[]> = {
  L1: ["24 months", "$79.00", "14 October 2025", "Oct", "Nov"],
  L2: ["StreamBox", "Apple", "17.99"],
  L3: ["14 November", "28 November", "3 September", "$89.00"],
  L4: ["BrightPage", "14.99"],
  L5: ["KP-20418", "R-77311", "R-77402", "$385.00"],
  L6: ["1,109", "1,485.54", "4 December"],
  L7: ["47,006", "30 October"],
};
async function draft() {
  await Promise.all(cases.filter((c) => c.isLeak).map(async (c) => {
    const prompt = `Write a short, polite, firm email from Maya Whitlock to ${c.merchant} fixing this problem: ${c.leak.title}.
Use ONLY facts in the evidence (ids, amounts, dates, receipt numbers). Quote exact figures as written. Do not invent facts. State exactly what you are asking for. Be honest about anything that weakens our position. Under 180 words. Plain text, subject line first.

${bundle(c.ev)}`;
    const r = await chat(FLASH, [{ role: "system", content: SYSTEM_CTX }, { role: "user", content: prompt }], { max_tokens: 8000 });
    const must = MUST[c.id] ?? [];
    const body = r.text.replace(/<think>[\s\S]*?<\/think>/g, "");
    const norm = body.replace(/\bOctober\b/g, "Oct").replace(/\bNovember\b/g, "Nov").replace(/\bSeptember\b/g, "Sep");
    const flat = (s: string) => s.toLowerCase().replace(/,/g, "");
    const missing = must.filter((m) => !flat(body).includes(flat(m)) && !flat(norm).includes(flat(m)) && !body.includes(m) && !norm.includes(m.replace(/\bOctober\b/g, "Oct").replace(/\bNovember\b/g, "Nov").replace(/\bSeptember\b/g, "Sep")));
    log({ task: "draft", model: FLASH, case: c.id, ok: !r.error && missing.length === 0, ms: r.ms, tokens: r.tokens.completion, attempts: r.attempts, error: r.error,
      detail: missing.length ? `missing: ${missing.join(" | ")}` : `all ${must.length} facts present, ${body.split(/\s+/).length} words` });
    if (!args.includes("--quiet")) writeFileSync(join(outDir(), `draft-${c.id}.txt`), body);
  }));
}

// ---------- task C: vision (meter photo) ----------
async function vision() {
  const img = readFileSync(join(SEED, "documents/Home & Utilities/Energy/Meter-Photo-2026-10-30.jpg")).toString("base64");
  const msg = [{ role: "user", content: [
    { type: "text", text: 'This is a photo of an electricity meter odometer. The last (red) digit is tenths of a kWh. Read the whole-kWh reading. Return ONLY JSON: {"kwh_whole": number, "tenths": number|null, "digits_seen": string}' },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } },
  ] }];
  for (const model of [M9, M35, FLASH]) {
    const r = await chat(model, msg, { max_tokens: model === M9 ? 400 : 6000, retries: 0, timeoutMs: 120_000 });
    const j = parseJson(r.text);
    const got = j?.kwh_whole;
    log({ task: "vision", model, case: "L7", ok: got === 47006, ms: r.ms, tokens: r.tokens.completion, error: r.error,
      detail: r.error ? "call failed (likely no image support)" : `read=${got} tenths=${j?.tenths} digits=${j?.digits_seen}${got === 470060 ? "  <- the known tenths misread" : ""}` });
  }
}

// ---------- task D: 9B extraction, scored against the source text, then fed to the 35B judge ----------
interface Src { id: string; kind: string; text: string }
function sources(ev: any): Src[] {
  const out: Src[] = [];
  for (const id of ev.emails ?? []) {
    const m = emails.find((e) => e.id === id);
    if (m) out.push({ id, kind: "email", text: `Date: ${m.date}\nFrom: ${m.from?.name}\nSubject: ${m.subject}\n${m.body}` });
  }
  for (const id of ev.documents ?? []) {
    const d = docs.find((x) => x.id === id);
    if (d?.textPath) out.push({ id, kind: "document", text: readFileSync(join(SEED, "documents", d.textPath), "utf8") });
  }
  for (const id of ev.calendar ?? []) {
    const e = events.find((x) => x.id === id);
    if (e) out.push({ id, kind: "calendar event", text: JSON.stringify(e) });
  }
  return out;
}

const EXTRACT_PROMPT = (s: Src) => `Extract facts from this ${s.kind} for a household finance agent. Copy values exactly as written; never calculate, convert or infer. If something is absent use [] or null.
Return ONLY JSON, no analysis: {"merchant": string|null, "doc_type": string, "amounts": [{"value": number, "label": string}] (money only), "quantities": [{"value": number, "unit": string, "label": string}] (kWh, meter readings, days, months, counts), "dates": [{"iso": "YYYY-MM-DD", "label": string}], "references": string[], "key_clauses": string[]}
"references" are invoice, receipt, account, agreement or transaction numbers. "key_clauses": up to 5 short sentences copied nearly verbatim about price, term length, cancellation or notice, renewal, or what the sender promises or asks.

Source ${s.id}:
${s.text}`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function amountIn(v: number, text: string): boolean {
  const t = text.replace(/,/g, "");
  const forms = new Set([v.toFixed(2), String(v), v.toFixed(0)]);
  return [...forms].some((f) => new RegExp(`(^|[^0-9.])${f.replace(".", "\\.")}([^0-9]|$)`).test(t) && (f !== v.toFixed(0) || Number.isInteger(v)));
}
function dateIn(iso: string, text: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [m[1], +m[2], +m[3]];
  const long = MONTHS[mo - 1], short = long.slice(0, 3);
  const dd = String(d).padStart(2, "0"), mm = String(mo).padStart(2, "0");
  return [`${d} ${long}`, `${d} ${short}`, `${long} ${d}`, `${short} ${d}`, `${dd}/${mm}/${y}`, `${d}/${mo}/${y}`, iso].some((f) => text.toLowerCase().includes(f.toLowerCase()));
}

// Values a perfect extractor must surface for each case (only counted if literally present in the sources).
const EXPECT: Record<string, { amounts: number[]; dates: string[]; refs: string[] }> = {
  L1: { amounts: [79, 99], dates: ["2025-10-14"], refs: [] },
  L2: { amounts: [17.99], dates: [], refs: [] },
  L3: { amounts: [89, 29.95], dates: ["2026-11-28"], refs: [] },
  L4: { amounts: [14.99], dates: [], refs: [] },
  L5: { amounts: [385], dates: [], refs: ["KP-20418", "R-77311", "R-77402"] },
  L6: { amounts: [1485.54, 1134, 1109], dates: ["2026-12-04", "2026-12-07"], refs: [] },
  L7: { amounts: [577.2, 1690], dates: [], refs: ["RG-2610-88413"] },
};

const extracted = new Map<string, { ok: boolean; data?: any; ms: number; model: string; note: string }>();
async function extractAll(model = M9) {
  const all = new Map<string, Src>();
  for (const c of cases) for (const s of sources(c.ev)) all.set(s.id, s);
  const list = [...all.values()];
  for (let i = 0; i < list.length; i += 10) {
    await Promise.all(list.slice(i, i + 10).map(async (s) => {
      const run = () => chat(model, [{ role: "system", content: SYSTEM_CTX }, { role: "user", content: EXTRACT_PROMPT(s) }], { max_tokens: 1500, json: true });
      const t0 = performance.now();
      let r = await run(), j = parseJson(r.text), note = "";
      if (!j) { r = await run(); j = parseJson(r.text); note = "retried"; }
      extracted.set(s.id, { ok: !!j, data: j, ms: performance.now() - t0, model, note: j ? note : "FAILED " + (r.error ?? JSON.stringify(r.text.slice(0, 80))) });
    }));
  }
  // hallucination check: every amount/date/reference must be literally present in its source
  let nAmt = 0, badAmt = 0, nDate = 0, badDate = 0, nRef = 0, badRef = 0, failed = 0;
  const bad: string[] = [];
  for (const s of list) {
    const e = extracted.get(s.id)!;
    if (!e.ok) { failed++; bad.push(`${s.id}: extraction failed (${e.note})`); continue; }
    for (const a of e.data.amounts ?? []) { nAmt++; if (typeof a.value !== "number" || !amountIn(a.value, s.text)) { badAmt++; bad.push(`${s.id}: amount ${a.value} (${a.label}) not in source`); } }
    for (const d of e.data.dates ?? []) { nDate++; if (!dateIn(String(d.iso).slice(0, 10), s.text)) { badDate++; bad.push(`${s.id}: date ${d.iso} (${d.label}) not in source`); } }
    for (const r of e.data.references ?? []) { nRef++; if (!s.text.includes(String(r))) { badRef++; bad.push(`${s.id}: reference ${r} not in source`); } }
  }
  writeFileSync(join(outDir(), "extracted.json"), JSON.stringify(Object.fromEntries(extracted), null, 2));
  const avg = [...extracted.values()].reduce((x, e) => x + e.ms, 0) / extracted.size / 1000;
  console.log(`\nEXTRACT ${model.split("/")[1]}: ${list.length} sources, ${failed} failed after retry, avg ${avg.toFixed(1)}s`);
  console.log(`  invented values: amounts ${badAmt}/${nAmt}, dates ${badDate}/${nDate}, references ${badRef}/${nRef}`);
  bad.slice(0, 15).forEach((b) => console.log("   - " + b));
  log({ task: "extract", model, case: "ALL", ok: failed === 0 && badAmt + badDate + badRef === 0, ms: avg * 1000, detail: `failed=${failed} invented amt=${badAmt} date=${badDate} ref=${badRef}` });

  // recall: did the extractor surface the facts a judge/drafter needs?
  for (const c of cases.filter((c) => c.isLeak)) {
    const srcs = sources(c.ev), joined = srcs.map((s) => s.text).join("\n");
    const got = srcs.map((s) => extracted.get(s.id)?.data).filter(Boolean);
    const gAmt = got.flatMap((g) => [...(g.amounts ?? []), ...(g.quantities ?? [])].map((a: any) => a.value)), gDate = got.flatMap((g) => (g.dates ?? []).map((d: any) => d.iso)), gRef = got.flatMap((g) => g.references ?? []);
    const e = EXPECT[c.id];
    const wantA = e.amounts.filter((v) => amountIn(v, joined)), wantD = e.dates.filter((d) => dateIn(d, joined)), wantR = e.refs.filter((r) => joined.includes(r));
    const miss = [...wantA.filter((v) => !gAmt.includes(v)).map(String), ...wantD.filter((d) => !gDate.includes(d)), ...wantR.filter((r) => !gRef.some((x: string) => x.includes(r)))];
    const total = wantA.length + wantD.length + wantR.length;
    log({ task: "extract", model, case: c.id, ok: miss.length === 0, ms: 0, detail: `recall ${total - miss.length}/${total}${miss.length ? " missing: " + miss.join(", ") : ""}` });
  }
}

async function pipeline() {
  if (!extracted.size) await extractAll();
  await Promise.all(cases.map(async (c) => {
    const parts: string[] = [];
    if (c.ev.transactions?.length) parts.push("## Bank transactions (id,date,description,debit,credit,balance)\n" + c.ev.transactions.map((i: string) => txns.get(i)).join("\n"));
    let fallbacks = 0;
    for (const s of sources(c.ev)) {
      const e = extracted.get(s.id);
      if (e?.ok) parts.push(`## ${s.kind} ${s.id} (facts extracted by a small model)\n${JSON.stringify(e.data)}`);
      else { fallbacks++; parts.push(`## ${s.kind} ${s.id}\n${s.text}`); }
    }
    const ev2 = parts.join("\n\n");
    const r = await chat(M35, [{ role: "system", content: SYSTEM_CTX }, { role: "user", content: DETECT_PROMPT(c, ev2) }], { max_tokens: 6000, json: true });
    const j = parseJson(r.text);
    const flagged = j ? !!j.is_problem : null;
    log({ task: "pipeline", model: M35, case: c.id, ok: flagged === c.isLeak, ms: r.ms, tokens: r.tokens.completion,
      detail: `9B facts -> 35B judge: flagged=${flagged} kind=${j?.kind} amt=${j?.claimed_amount_aud} evidence ${bundle(c.ev).length}->${ev2.length} chars${fallbacks ? ` (${fallbacks} raw fallbacks)` : ""}` });
  }));
}

function outDir() { const d = new URL("./spike-out/", import.meta.url).pathname; mkdirSync(d, { recursive: true }); return d; }

// ---------- run + summary ----------
const t0 = performance.now();
if (tasks.includes("detect")) await detect();
if (tasks.includes("draft")) await draft();
if (tasks.includes("vision")) await vision();
if (tasks.includes("extract") && !tasks.includes("pipeline")) await extractAll();
if (tasks.includes("pipeline")) await pipeline();

console.log("\n=== SUMMARY ===");
for (const model of [M9, M35, FLASH]) {
  const d = rows.filter((r) => r.task === "detect" && r.model === model);
  if (d.length) {
    const leaks = d.filter((r) => /^L/.test(r.case)), decoys = d.filter((r) => /^D/.test(r.case));
    const flaggedLeaks = leaks.filter((r) => r.ok).length, falsePos = decoys.filter((r) => !r.ok).length;
    const avg = d.reduce((s, r) => s + r.ms, 0) / d.length / 1000;
    console.log(`${model.padEnd(34)} detect recall ${flaggedLeaks}/${leaks.length}  false positives ${falsePos}/${decoys.length}  avg ${avg.toFixed(1)}s`);
  }
}
const dr = rows.filter((r) => r.task === "draft");
if (dr.length) console.log(`${FLASH.padEnd(34)} drafts with all required facts ${dr.filter((r) => r.ok).length}/${dr.length}  avg ${(dr.reduce((s, r) => s + r.ms, 0) / dr.length / 1000).toFixed(1)}s`);
console.log(`total wall time ${((performance.now() - t0) / 1000).toFixed(0)}s`);
// results.json = latest run only; results.jsonl = every run, one line each, so earlier runs survive.
const run = { at: new Date().toISOString(), args, rows };
writeFileSync(join(outDir(), "results.json"), JSON.stringify(run, null, 2));
appendFileSync(join(outDir(), "results.jsonl"), JSON.stringify(run) + "\n");
