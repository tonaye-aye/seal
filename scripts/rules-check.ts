// Guards what Seal remembers after "Not a leak". The seed and clock are fixed,
// so a finding can never come back on its own. This takes the real findings
// from saved answers and adds made-up later bank rows, which exist only in this
// script. No network.
//
//   node scripts/rules-check.ts

import type { Corpus } from "../src/agent/corpus.ts";
import type { FindingKind } from "../src/agent/judge.ts";
import { runScan, type Finding } from "../src/agent/pipeline.ts";
import { createConnectors } from "../src/connectors/index.ts";
import type { Transaction } from "../src/connectors/types.ts";
import { createLlm, type LlmTransport } from "../src/lib/llm.ts";
import { checkRule, newRule, rememberedRules, returnedFindings, RULE_REASONS, type CameBack, type Rule, type RuleReason } from "../src/lib/rules.ts";
import { nodeTransport } from "./llm-node.ts";
import { nodeSeedSource } from "./seed-source.ts";

const base = nodeTransport();
const transport: LlmTransport = { post: (path, body, key) => base.post(path, body, key, "replay") };
const connectors = await createConnectors({ source: nodeSeedSource, latencyScale: 0 });
let seen: Corpus | undefined;
const result = await runScan(connectors, createLlm(transport, { mode: "replay" }), (e) => {
  if (e.type === "corpus") seen = e.corpus;
});
const corpus = seen!;
const finding = (id: string): Finding => {
  const f = result.findings.find((x) => x.id === id);
  if (!f) throw new Error(`No saved finding ${id}. Run saved-answers-check first.`);
  return f;
};

const SKYLINK = finding("finding_skylink");
const BRIGHTPAGE = finding("finding_brightpage");
const STREAMBOX = finding("finding_apple+streambox");
const IRONWORKS = finding("finding_ironworks");
const KESTREL = finding("finding_kestrel");
const REDGUM = finding("finding_redgum");
const WATTLE = finding("finding_wattle");
const NORVIK = finding("finding_norvik+spinwell");

/** The real bank text and account of a business's newest charge, so a made-up row matches it. */
function lastRow(needle: RegExp): Transaction {
  const rows = corpus.transactions.filter((t) => t.amountCents < 0 && needle.test(t.description));
  if (!rows.length) throw new Error(`No bank row for ${needle}`);
  return rows.sort((a, b) => a.date.localeCompare(b.date))[rows.length - 1];
}

let made = 0;
/** A made-up later bank row, in cents. */
function row(like: Transaction, date: string, cents: number): Transaction {
  return { ...like, id: `TEST-${++made}`, date, amountCents: -cents };
}
/** The same check, with extra made-up rows. */
const withRows = (...rows: Transaction[]): Corpus => ({ ...corpus, transactions: [...corpus.transactions, ...rows] });
const bankFailed: Corpus = { ...corpus, transactions: [], accounts: [], missing: ["bank"] };
const bankOff: Corpus = { ...corpus, transactions: [], accounts: [], missing: [] };

const rule = (f: Finding, reason?: RuleReason, at: Corpus = corpus): Rule => ({ ...newRule(f, at, 1), reason });

const SKY = lastRow(/skylink/i);
const BRIGHT = lastRow(/brightpage/i);
const APPLE = lastRow(/apple\.com/i);
const DIRECT = lastRow(/streambox/i);
const GYM = lastRow(/ironworks/i);
const PLUMBER = lastRow(/kestrel/i);
const POWER = lastRow(/redgum/i);
const INSURER = { ...BRIGHT, description: "WATTLE INSURANCE RENEWAL" };
const REPAIRS = { ...BRIGHT, description: "SPINWELL REPAIRS" };

type Expect = CameBack["why"] | "stays";
type Case = { name: string; rule: Rule; finding?: Pick<Finding, "kind">; corpus: Corpus; expect: Expect; check?: (b: CameBack) => boolean };

const other = (kind: FindingKind): FindingKind => (kind === "billing_error" ? "price_increase" : "billing_error");

const cases: Case[] = [
  // We want this: the regular charge.
  { name: "wanted: same amount next month stays", rule: rule(BRIGHTPAGE, "wanted"), corpus: withRows(row(BRIGHT, "2026-12-18", 1499)), expect: "stays" },
  { name: "wanted: three more months at the same amount stay (atStake grows, the charge doesn't)", rule: rule(BRIGHTPAGE, "wanted"), corpus: withRows(row(BRIGHT, "2026-12-18", 1499), row(BRIGHT, "2027-01-18", 1499), row(BRIGHT, "2027-02-18", 1499)), expect: "stays" },
  {
    name: "wanted: a new price comes back with both amounts",
    rule: rule(BRIGHTPAGE, "wanted"),
    corpus: withRows(row(BRIGHT, "2026-12-18", 1699)),
    expect: "amount_changed",
    check: (b) => b.why === "amount_changed" && b.from === 1499 && b.to === 1699 && b.date === "2026-12-18",
  },
  { name: "wanted: Skylink compares the $99 charge, not the $20 rise", rule: rule(SKYLINK, "wanted"), corpus: withRows(row(SKY, "2026-12-14", 9900)), expect: "stays" },
  { name: "wanted: Skylink dropping to $79 is a change", rule: rule(SKYLINK, "wanted"), corpus: withRows(row(SKY, "2026-12-14", 7900)), expect: "amount_changed", check: (b) => b.why === "amount_changed" && b.from === 9900 },
  { name: "wanted: both StreamBox charges unchanged stay", rule: rule(STREAMBOX, "wanted"), corpus: withRows(row(APPLE, "2026-11-21", 1799), row(DIRECT, "2026-12-03", 1799)), expect: "stays" },
  { name: "wanted: one StreamBox charge rising comes back", rule: rule(STREAMBOX, "wanted"), corpus: withRows(row(APPLE, "2026-11-21", 1999), row(DIRECT, "2026-12-03", 1799)), expect: "amount_changed" },
  { name: "wanted: the gym's $89 annual fee isn't the $29.95 charge", rule: rule(IRONWORKS, "wanted"), corpus: withRows(row(GYM, "2026-11-28", 8900)), expect: "amount_changed", check: (b) => b.why === "amount_changed" && b.from === 2995 && b.to === 8900 },
  // We want this, with nothing regular to compare: treated like Already sorted.
  { name: "wanted, one-off: plumber quiet stays", rule: rule(KESTREL, "wanted"), corpus, expect: "stays" },
  { name: "wanted, one-off: plumber charging again comes back", rule: rule(KESTREL, "wanted"), corpus: withRows(row(PLUMBER, "2026-12-01", 38500)), expect: "charged_again" },
  { name: "wanted, bill: a new electricity charge comes back", rule: rule(REDGUM, "wanted"), corpus: withRows(row(POWER, "2027-02-10", 41000)), expect: "charged_again" },
  { name: "wanted, no bank rows: Wattle's first charge comes back", rule: rule(WATTLE, "wanted"), corpus: withRows(row(INSURER, "2026-12-07", 148554)), expect: "charged_again" },
  { name: "wanted, warranty: Spinwell's charge comes back", rule: rule(NORVIK, "wanted"), corpus: withRows(row(REPAIRS, "2026-11-26", 26400)), expect: "charged_again", check: (b) => b.why === "charged_again" && b.cents === 26400 },

  // Already sorted.
  { name: "sorted: nothing new stays", rule: rule(BRIGHTPAGE, "sorted"), corpus, expect: "stays" },
  { name: "sorted: any later charge comes back", rule: rule(BRIGHTPAGE, "sorted"), corpus: withRows(row(BRIGHT, "2026-12-18", 1499)), expect: "charged_again", check: (b) => b.why === "charged_again" && b.cents === 1499 && b.date === "2026-12-18" },
  { name: "sorted: a second charge on the same day is new", rule: rule(BRIGHTPAGE, "sorted"), corpus: withRows(row(BRIGHT, BRIGHT.date, 1499)), expect: "charged_again" },
  { name: "sorted: an older row isn't new", rule: rule(BRIGHTPAGE, "sorted"), corpus: withRows(row(BRIGHT, "2026-09-01", 1499)), expect: "stays" },
  { name: "sorted: a refund isn't a charge", rule: rule(BRIGHTPAGE, "sorted"), corpus: withRows({ ...row(BRIGHT, "2026-12-01", 0), amountCents: 1499 }), expect: "stays" },
  { name: "sorted: Skylink back at $79 stays", rule: rule(SKYLINK, "sorted"), corpus: withRows(row(SKY, "2026-12-14", 7900), row(SKY, "2027-01-14", 7900)), expect: "stays" },
  { name: "sorted: Skylink still at $99 comes back", rule: rule(SKYLINK, "sorted"), corpus: withRows(row(SKY, "2026-12-14", 9900)), expect: "charged_again" },
  { name: "sorted: Skylink above $99 comes back", rule: rule(SKYLINK, "sorted"), corpus: withRows(row(SKY, "2026-12-14", 12000)), expect: "charged_again" },
  { name: "sorted: Skylink $79 then $99 comes back", rule: rule(SKYLINK, "sorted"), corpus: withRows(row(SKY, "2026-12-14", 7900), row(SKY, "2027-01-14", 9900)), expect: "charged_again", check: (b) => b.why === "charged_again" && b.date === "2027-01-14" },
  { name: "sorted: only the StreamBox direct debit continuing stays", rule: rule(STREAMBOX, "sorted"), corpus: withRows(row(DIRECT, "2026-12-03", 1799)), expect: "stays" },
  { name: "sorted: only the Apple charge continuing stays", rule: rule(STREAMBOX, "sorted"), corpus: withRows(row(APPLE, "2026-11-21", 1799)), expect: "stays" },
  { name: "sorted: both StreamBox charges continuing comes back", rule: rule(STREAMBOX, "sorted"), corpus: withRows(row(APPLE, "2026-11-21", 1799), row(DIRECT, "2026-12-03", 1799)), expect: "charged_again" },

  // Seal got it wrong.
  { name: "wrong: new charges at a new price stay", rule: rule(SKYLINK, "wrong"), corpus: withRows(row(SKY, "2026-12-14", 12000)), expect: "stays" },
  { name: "wrong: a bank outage stays", rule: rule(SKYLINK, "wrong"), corpus: bankFailed, expect: "stays" },
  { name: "wrong: a different kind of problem comes back", rule: rule(SKYLINK, "wrong"), finding: { kind: "billing_error" }, corpus, expect: "new_problem", check: (b) => b.why === "new_problem" && b.kind === "billing_error" },

  // A different kind always shows, for every reason.
  ...RULE_REASONS.map((r): Case => ({ name: `${r}: a different kind comes back`, rule: rule(BRIGHTPAGE, r), finding: { kind: other(BRIGHTPAGE.kind) }, corpus, expect: "new_problem" })),

  // When the bank can't be read.
  { name: "wanted: bank failed shows it", rule: rule(BRIGHTPAGE, "wanted"), corpus: bankFailed, expect: "bank_unread" },
  { name: "sorted: bank failed shows it", rule: rule(BRIGHTPAGE, "sorted"), corpus: bankFailed, expect: "bank_unread" },
  { name: "sorted: bank switched off shows it", rule: rule(BRIGHTPAGE, "sorted"), corpus: bankOff, expect: "bank_unread" },
  { name: "answered with the bank down: holds while it's down", rule: rule(BRIGHTPAGE, "sorted", bankFailed), corpus: bankFailed, expect: "stays" },
  { name: "answered with the bank down: shows once it's back", rule: rule(BRIGHTPAGE, "wanted", bankFailed), corpus, expect: "no_baseline" },

  // No answer given: the dismissal works exactly as it always has.
  { name: "no reason: new charges stay hidden", rule: rule(BRIGHTPAGE), corpus: withRows(row(BRIGHT, "2026-12-18", 1999)), expect: "stays" },
  { name: "no reason: a different kind stays hidden", rule: rule(BRIGHTPAGE), finding: { kind: "billing_error" }, corpus, expect: "stays" },
  { name: "no reason: a bank outage stays hidden", rule: rule(BRIGHTPAGE), corpus: bankFailed, expect: "stays" },
];

// Answering about the check on screen never brings a finding straight back.
for (const f of result.findings) {
  for (const reason of RULE_REASONS) cases.push({ name: `same check: ${f.merchant}, ${reason}`, rule: rule(f, reason), finding: f, corpus, expect: "stays" });
}

let failed = 0;
for (const c of cases) {
  const back = checkRule(c.rule, c.finding ?? { kind: c.rule.kind }, c.corpus);
  const got: Expect = back?.why ?? "stays";
  const ok = got === c.expect && (!c.check || (!!back && c.check(back)));
  if (!ok) {
    failed++;
    console.log(`FAIL ${c.name}: expected ${c.expect}, got ${JSON.stringify(back) ?? "stays"}`);
  }
}

// The whole-check function: nothing it is given changes, and only broken rules show.
function wholeCheck(): string | undefined {
  const rules: Record<string, Rule> = { [BRIGHTPAGE.id]: rule(BRIGHTPAGE, "wanted"), [SKYLINK.id]: rule(SKYLINK, "sorted"), [KESTREL.id]: rule(KESTREL) };
  const later = withRows(row(BRIGHT, "2026-12-18", 1699), row(SKY, "2026-12-14", 7900), row(PLUMBER, "2026-12-20", 38500));
  const before = JSON.stringify([result.findings, rules, later]);
  const back = returnedFindings(result.findings, rules, later);
  if (JSON.stringify([result.findings, rules, later]) !== before) return "changed its inputs";
  if (Object.keys(back).join() !== BRIGHTPAGE.id) return `returned ${Object.keys(back).join()}`;
  if (!result.findings.every((f) => f.fix)) return "a finding lost its fix plan";
  if (Object.keys(returnedFindings(result.findings, rules, undefined)).length) return "returned something with no bank data";
  const listed = rememberedRules({ a: { ...rule(SKYLINK, "sorted"), at: 1 }, b: { ...rule(BRIGHTPAGE, "wanted"), at: 2 }, c: { ...rule(KESTREL), at: 3 } });
  if (listed.map((r) => r.findingId).join() !== `${BRIGHTPAGE.id},${SKYLINK.id}`) return "Remembered list is wrong";
  return undefined;
}
const whole = wholeCheck();
if (whole) {
  failed++;
  console.log(`FAIL whole check: ${whole}`);
}

const total = cases.length + 1;
console.log(`rules ${total - failed}/${total}`);
if (failed) process.exit(1);
