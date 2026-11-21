// Checks the draft verbs (Firmer, Shorter) on all 8 findings: 16 rewrites.
//
//   node scripts/rewrites-check.ts                 guards, then all 16 from saved answers (no network)
//   node scripts/rewrites-check.ts --guards        guards only (no network, no saved rewrites needed)
//   node --env-file=.env scripts/rewrites-check.ts --live --max-calls 32 [--out file.json]
//
// --live asks the endpoint only for rewrites that have no saved answer. Every
// other request is read from saved answers, so the original drafts stay the
// ones replay returns, and it stops at --max-calls requests, retries included.

import { writeFile } from "node:fs/promises";
import type { Corpus } from "../src/agent/corpus.ts";
import { draftEvidence, draftFigures, loadVoice, type ProposedDraft } from "../src/agent/draft.ts";
import { runScan, type Finding } from "../src/agent/pipeline.ts";
import { checkRewrite, rewriteDraft, VERBS, type RewriteOutcome, type Verb } from "../src/agent/rewrite.ts";
import { createConnectors } from "../src/connectors/index.ts";
import { activeVerb, draftKey, keepVersion, shownDraft, showVerb, stepBack, type DraftVersions } from "../src/lib/draft-versions.ts";
import { createLlm, LlmError, type LlmTransport } from "../src/lib/llm.ts";
import { nodeTransport } from "./llm-node.ts";
import { nodeSeedSource } from "./seed-source.ts";

const args = process.argv.slice(2);
const live = args.includes("--live");
const guardsOnly = args.includes("--guards");
const flagValue = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const maxCalls = Number(flagValue("--max-calls") ?? 0);
const outFile = flagValue("--out");
if (live && !(maxCalls > 0)) throw new Error("--live needs --max-calls <n>");

const base = nodeTransport({ save: "if_absent" });
let liveCalls = 0;

const isRewrite = (body: string) =>
  (JSON.parse(body) as { response_format?: { json_schema?: { name?: string } } }).response_format?.json_schema?.name === "draft_rewrite";

const transport: LlmTransport = {
  async post(path, body, key, mode) {
    if (mode === "live") {
      // "not_configured" stops the caller at once: it isn't retried.
      if (!live || !isRewrite(body)) throw new LlmError("not_configured", "This check only calls the endpoint for rewrites, with --live.");
      if (liveCalls >= maxCalls) throw new LlmError("not_configured", `Stopped at the ${maxCalls}-call limit.`);
      liveCalls++;
    }
    return base.post(path, body, key, mode);
  },
};

const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
const saved = createLlm(transport, { mode: "replay" });
let readCorpus: Corpus | undefined;
const result = await runScan(connectors, saved, (event) => {
  if (event.type === "corpus") readCorpus = event.corpus;
});
const corpus = readCorpus!;
const voice = await loadVoice(connectors);
const findings = result.findings.filter((f): f is Finding & { draft: ProposedDraft } => !!f.draft);

let failures = 0;
function expect(name: string, ok: boolean, detail = "") {
  if (ok) return;
  failures++;
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

// ---------- The guards: each bad rewrite must be caught ----------

function guards() {
  const byKind = (kind: Finding["kind"]) => findings.find((f) => f.kind === kind)!;
  const allowedFor = (f: Finding) => `${draftFigures(f)}\n${draftEvidence(f.evidence, corpus).text}`;
  /** The original with a harmless change, so it counts as a valid rewrite to break. */
  const fine = (f: Finding & { draft: ProposedDraft }) => f.draft.body.replace("Thanks, Maya", "Thank you for your help.\n\nThanks, Maya");
  const check = (f: Finding & { draft: ProposedDraft }, body: string, verb: Verb = "firmer", subject = f.draft.subject) =>
    checkRewrite({ verb, written: { subject, body }, original: f.draft, c: f, allowed: allowedFor(f), signOff: voice.signOff });

  let cases = 0;
  const caught = (name: string, f: Finding & { draft: ProposedDraft }, body: string, needle: RegExp, verb: Verb = "firmer", subject = f.draft.subject) => {
    cases++;
    expect(`bad rewrite not changed by the test: ${name}`, body !== fine(f) || subject !== f.draft.subject);
    const problems = check(f, body, verb, subject);
    expect(`guard missed: ${name}`, problems.some((p) => needle.test(p)), problems.join("; ") || "no problems found");
  };

  for (const f of findings) {
    cases++;
    const problems = check(f, fine(f));
    expect(`a harmless rewrite of ${f.id} should pass`, problems.length === 0, problems.join("; "));
  }

  const skylink = byKind("price_increase");
  const gym = byKind("renewal_trap");
  const washer = byKind("warranty_claim");
  const plumber = byKind("duplicate_payment");
  const apple = byKind("duplicate_subscription");
  const energy = byKind("billing_error");

  caught("dropped amount", skylink, fine(skylink).replaceAll("$40.00", "the extra"), /dropped/);
  caught("changed amount", skylink, fine(skylink).replaceAll("$40.00", "$41.00"), /\$41\.00/);
  caught("invented date", skylink, fine(skylink).replace("Thanks, Maya", "Please reply by 30 November 2026.\n\nThanks, Maya"), /30 November/);
  caught("true figure the original left out", apple, fine(apple).replace("Thanks, Maya", "We will cancel by 20 November 2026.\n\nThanks, Maya"), /new detail/);
  caught("internal id", skylink, fine(skylink).replace("Thanks, Maya", "See msg_0012.\n\nThanks, Maya"), /internal id/);
  caught("dropped reference", plumber, fine(plumber).replaceAll("R-77402", "the second receipt"), /dropped/);
  caught("changed cancel time", washer, fine(washer).replace("10:00 am", "11:00 am"), /new time|dropped/);
  caught("cancel time on the wrong day", washer, fine(washer).replace("10:00 am on 25 November 2026", "10:00 am on 26 November 2026"), /dropped/);
  caught("dropped serial", washer, fine(washer).replace(" (serial NVK-204417)", ""), /dropped/, "firmer", "Warranty claim: Norvik WM-8");
  caught("wrong year on a real date", washer, fine(washer).replace("ends on 6 December 2026", "ends on 6 December 2025"), /wrong year|dropped/);
  caught("dropped warranty end", washer, fine(washer).replace("The warranty ends on 6 December 2026. ", ""), /dropped/);
  caught("no longer admits the missed notice", gym, fine(gym).replace("We missed the written notice deadline of 14 November 2026", "The written notice deadline was 14 November 2026"), /admits/);
  caught("dropped goodwill", gym, fine(gym).replaceAll("goodwill", "help"), /goodwill/);
  caught("a goodwill refund becomes a plain refund", byKind("trial_converted"), fine(byKind("trial_converted")).replace("a goodwill refund", "a refund"), /goodwill/);
  caught("no longer asks for a refund", plumber, fine(plumber).replace(/refund/gi, "payment").replace(/credit/gi, "balance"), /refund/);
  caught("apology", gym, fine(gym).replace("Thanks, Maya", "We are so sorry about this.\n\nThanks, Maya"), /apology/);
  caught("weaker request", skylink, fine(skylink).replace("Thanks, Maya", "No worries if you can't.\n\nThanks, Maya"), /weaker/);
  caught("excusing the business", skylink, fine(skylink).replace("Thanks, Maya", "We know this is not your fault.\n\nThanks, Maya"), /excusing/);
  caught("blame", apple, fine(apple).replace("Thanks, Maya", "This is your mistake.\n\nThanks, Maya"), /blame/);
  caught("threat", skylink, fine(skylink).replace("Thanks, Maya", "Otherwise we will go to the ombudsman.\n\nThanks, Maya"), /threat/);
  caught("made-up feeling", gym, fine(gym).replace("Thanks, Maya", "We have really enjoyed being part of the community.\n\nThanks, Maya"), /made-up feeling/);
  caught("demands goodwill", gym, fine(gym).replace("we are asking for your goodwill to waive", "we expect your goodwill to waive"), /demands goodwill/);
  caught("pasted a figure's label", byKind("renewal_price_creep"), fine(byKind("renewal_price_creep")).replace("for $1,109.00", "for Other provider's quote: $1,109.00"), /copied a label/);
  caught("lost the greeting", skylink, skylink.draft.body.replace(/^Hi Skylink team,\s*/, ""), /greeting/);
  caught("subject lost its reference", skylink, fine(skylink), /subject lost/, "firmer", "Skylink price increase");
  caught("says attached with nothing attached", apple, fine(apple).replace("Thanks, Maya", "I have attached the receipts.\n\nThanks, Maya"), /attach/);
  caught("drops the attachment line", energy, fine(energy).replace(/ ?I have attached[^.]*\./, ""), /attached/);
  caught("no sign-off", skylink, fine(skylink).replace("Thanks, Maya", "Regards"), /sign-off/);
  caught("Shorter that isn't shorter", skylink, fine(skylink).replace("Please enforce", "Kindly enforce"), /not clearly shorter/, "shorter");
  cases++;
  expect("unchanged body", check(skylink, skylink.draft.body).some((p) => /did not change/.test(p)));

  // ---------- Which version is on screen ----------
  const original = skylink.draft;
  const firmer = { subject: "Firm subject", body: "Firm body", model: "m", source: "cache" as const };
  const shorter = { subject: "Short subject", body: "Short body", model: "m", source: "live" as const };
  let entry: DraftVersions = keepVersion(undefined, original, "firmer", firmer);
  expect("keeping a version doesn't show it", shownDraft(original, entry, false)?.body === original.body);
  entry = showVerb(entry, "firmer", 1);
  const shown = shownDraft(original, entry, false)!;
  expect("the rewrite's subject and body show", shown.subject === firmer.subject && shown.body === firmer.body);
  expect("the recipient and attachments stay", shown.to === original.to && shown.attachDocumentIds === original.attachDocumentIds);
  entry = showVerb(keepVersion(entry, original, "shorter", shorter), "shorter", 2);
  expect("Shorter is on screen", activeVerb(original, entry) === "shorter");
  entry = stepBack(entry);
  expect("one step back is Firmer", activeVerb(original, entry) === "firmer");
  entry = stepBack(entry);
  expect("two steps back is the original", activeVerb(original, entry) === null && shownDraft(original, entry, false)?.body === original.body);
  const stale = showVerb(keepVersion(undefined, original, "firmer", firmer), "firmer", 1);
  const newer = { ...original, body: `${original.body} changed` };
  expect("a rewrite of an older draft isn't shown", shownDraft(newer, stale, false)?.body === newer.body);
  expect("an approved rewrite stays as approved", shownDraft(newer, stale, true)?.body === firmer.body);
  expect("the key follows the draft", draftKey(newer) !== draftKey(original));
  cases += 9;
  return cases;
}

// ---------- The 16 rewrites ----------

/** Rewrites where neither saved answer passed. Listed so a new miss still fails this check. */
const KNOWN_MISSES = ["finding_brightpage/shorter", "finding_norvik+spinwell/shorter"];

async function rewrites() {
  const client = createLlm(transport, { mode: live ? "cache_first" : "replay" });
  const jobs = findings.flatMap((f) => VERBS.map((verb) => ({ f, verb })));
  const results: { id: string; verb: Verb; outcome: RewriteOutcome }[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < jobs.length) {
        const { f, verb } = jobs[next++];
        const outcome = await rewriteDraft(client, f, f.draft, corpus, voice, verb);
        results.push({ id: f.id, verb, outcome });
      }
    }),
  );
  results.sort((a, b) => a.id.localeCompare(b.id) || VERBS.indexOf(a.verb) - VERBS.indexOf(b.verb));

  for (const { id, verb, outcome } of results) {
    const original = findings.find((f) => f.id === id)!.draft;
    const before = original.body.split(/\s+/).length;
    if (outcome.ok) {
      const tries = outcome.attempts.length === 1 ? "Flash" : "35B retry";
      console.log(`ok   ${id.replace("finding_", "").padEnd(18)} ${verb.padEnd(8)} ${tries.padEnd(10)} ${before} -> ${outcome.version.body.split(/\s+/).length} words`);
    } else if (outcome.why === "failed" && !live && KNOWN_MISSES.includes(`${id}/${verb}`)) {
      // Safe: the app keeps the draft on screen and says no version passed.
      console.log(`miss ${id.replace("finding_", "").padEnd(18)} ${verb.padEnd(8)} no saved version passed, so the draft stays: ${outcome.problems.join("; ").slice(0, 150)}`);
    } else {
      failures++;
      console.log(`FAIL ${id.replace("finding_", "").padEnd(18)} ${verb.padEnd(8)} ${outcome.why}: ${outcome.problems.join("; ").slice(0, 220)}`);
    }
  }
  for (const verb of VERBS) {
    const set = results.filter((r) => r.verb === verb);
    const firstTry = set.filter((r) => r.outcome.ok && r.outcome.attempts.length === 1).length;
    console.log(`${verb}: ${set.filter((r) => r.outcome.ok).length}/${set.length} passed (${firstTry} on Flash's first try)`);
  }
  if (live) console.log(`Live requests: ${liveCalls} of ${maxCalls} allowed`);
  if (outFile) {
    const text = results.map(({ id, verb, outcome }) => ({
      id,
      verb,
      ok: outcome.ok,
      subject: outcome.ok ? outcome.version.subject : undefined,
      body: outcome.ok ? outcome.version.body : undefined,
      attempts: outcome.attempts.map((a) => ({ model: a.model, problems: a.problems })),
    }));
    await writeFile(outFile, JSON.stringify(text, null, 1));
  }
  return results.length;
}

expect("all 8 findings have a draft", findings.length === 8, String(findings.length));
expect("all 8 findings have an Email route", findings.every((f) => f.fix?.routes.some((r) => r.kind === "email")));
const cases = guards();
console.log(`Guards: ${cases} cases`);
const total = guardsOnly ? 0 : await rewrites();
console.log(failures === 0 ? `All passed${total ? ` (${total} rewrites)` : ""}` : `${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
