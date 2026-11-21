// Stage 8 of the scan: the ways to fix a finding, not just an email.
//
//   Code narrows the routes: which channels can do this job, whether the
//   business requires one of them, and which can still beat the deadline.
//   One model call (Flash, thinking off) picks the best of those and writes
//   the words for a call and a chat.
//   Code then checks those words: every figure must be in the evidence, and
//   every phone number, link and address must be in the help directory.
//
// Contacts and steps always come from the directory, never from a model, so
// without a model the routes still show, just without a script. Nothing here
// sends, calls or opens anything.

import { copy } from "../copy.ts";
import type { Connectors } from "../connectors/index.ts";
import { now } from "../lib/clock.ts";
import { daysBetween, localDate } from "../lib/dates.ts";
import { LlmError, type LlmClient, type ReplySchema } from "../lib/llm.ts";
import type { Corpus } from "./corpus.ts";
import {
  claimCheck,
  draftEvidence,
  draftFigures,
  figureValue,
  KIND_GUIDANCE,
  longDate,
  type DraftAttempt,
  type Voice,
} from "./draft.ts";
import { firstSentence, type FindingKind } from "./judge.ts";
import type { Finding } from "./pipeline.ts";

// ---------- The help directory (seed/help) ----------

export type Capability = "cancel" | "refund" | "dispute_price" | "waive_fee" | "retain" | "switch" | "correct_bill" | "claim_warranty";
export type RouteKind = "email" | "call" | "chat" | "online";

type Channel = {
  id: string;
  kind: RouteKind;
  label: string;
  canDo: Capability[];
  /** Jobs the business only accepts through this channel. */
  requiredFor?: Capability[];
  address?: string;
  phone?: string;
  href?: string;
  hours?: string;
  waitMinutes?: number;
  replyDays?: number;
  /** Takes effect as soon as it's done, so it can beat a close deadline. */
  immediate?: boolean;
  keepsRecord?: boolean;
  acceptsFiles?: boolean;
  needs?: string[];
  steps?: string[];
  note?: string;
  articleId?: string;
};

type Provider = { key: string; name: string; sector: string; domain: string; channels: Channel[] };
type Article = { id: string; provider: string; title: string; body: string };
type Body = {
  id: string;
  name: string;
  shortName: string;
  real: boolean;
  sectors?: string[];
  forKinds: string[];
  /** Only offered when the money went out on a card. */
  needsCardCharge?: boolean;
  phone: string;
  hours: string;
  href: string;
  afterDays: number;
  whenToUse: string;
  verifiedOn?: string;
};

export type HelpDirectory = { providers: Provider[]; bodies: Body[]; articles: Article[] };

/** Reads the bundled directory. */
export async function loadHelp(connectors: Connectors): Promise<HelpDirectory> {
  const read = async <T>(name: string) => JSON.parse(await connectors.runtime.source.readText(`help/${name}.json`)) as T;
  const [providers, bodies, articles] = await Promise.all([
    read<{ providers: Provider[] }>("providers"),
    read<{ bodies: Body[] }>("bodies"),
    read<{ articles: Article[] }>("articles"),
  ]);
  return { providers: providers.providers, bodies: bodies.bodies, articles: articles.articles };
}

// ---------- Shapes ----------

export type FixRoute = {
  id: string;
  kind: RouteKind;
  provider: string;
  label: string;
  canDo: Capability[];
  requiredFor: Capability[];
  address?: string;
  phone?: string;
  href?: string;
  hours?: string;
  waitMinutes?: number;
  replyDays?: number;
  immediate: boolean;
  keepsRecord: boolean;
  acceptsFiles: boolean;
  needs: string[];
  steps: string[];
  note?: string;
  article?: { title: string; body: string };
  /** A fictional business: its number and links must never really be dialled or opened. */
  sample: true;
};

export type CallScript = { opening: string; points: string[]; ask: string; ifNo: string };

/** Where to go if the business says no. */
export type Escalation = Omit<Body, "sectors" | "forKinds" | "needsCardCharge">;

export type FixPlan = {
  /** The best route first, at most four. */
  routes: FixRoute[];
  recommendedId: string;
  /** One plain sentence: why this route. */
  reason: string;
  /** rule: only one route could do it. model: picked from several. default: no model, so code's order. */
  chosenBy: "rule" | "model" | "default";
  callScript?: CallScript;
  chatOpener?: string;
  /** Checked figures to have in front of you, worked out by code. */
  haveReady: { label: string; value: string }[];
  escalation?: Escalation;
  /** True when every claim and contact in the written words was found in the sources. */
  grounded: boolean;
  problems: string[];
  attempts: DraftAttempt[];
  model?: string;
  source?: "live" | "cache";
  ms: number;
};

// ---------- Narrowing the routes (plain code) ----------

/** The jobs each kind of problem needs doing. The first is the one to do first. */
const NEEDS: Record<FindingKind, Capability[]> = {
  price_increase: ["dispute_price"],
  duplicate_subscription: ["cancel", "refund"],
  duplicate_payment: ["refund"],
  trial_converted: ["cancel", "refund"],
  renewal_trap: ["cancel", "waive_fee"],
  renewal_price_creep: ["retain", "switch"],
  billing_error: ["correct_bill"],
  warranty_claim: ["claim_warranty", "cancel"],
};

/** Each job in plain words, for telling the model what a call or chat is for. */
const JOB_WORDS: Record<Capability, string> = {
  cancel: "cancel it",
  refund: "refund or credit the charges it billed",
  dispute_price: "review the price against what was agreed and credit the difference",
  waive_fee: "consider waiving the fee as goodwill",
  retain: "match or beat the other quote",
  switch: "switch to the other quote",
  correct_bill: "correct the bill using the actual reading",
  claim_warranty: "take a warranty claim and arrange the repair",
};

/** The checked figures worth having in front of you, per kind of problem. */
const HAVE_READY: Record<FindingKind, string[]> = {
  price_increase: ["previous_price", "new_price", "term_months", "term_start", "overcharged_so_far"],
  duplicate_subscription: ["duplicate_amount", "duplicate_charges_count", "duplicated_total", "platform_renews"],
  duplicate_payment: ["invoice_reference", "receipt_references", "payment_amount", "first_payment", "second_payment"],
  trial_converted: ["converted_on", "paid_since_trial", "last_used", "next_charge"],
  renewal_trap: ["renewal_amount", "renews_on", "notice_deadline", "last_used"],
  renewal_price_creep: ["renewal_amount", "competitor_quote", "saving", "quote_valid_until"],
  billing_error: ["actual_reading", "actual_reading_date", "estimated_reading", "overcharge_estimate"],
  warranty_claim: ["product_serial", "purchase_date", "warranty_ends", "repair_reference", "cancel_by"],
};

/** A deadline this close can only be met by something that takes effect at once. */
const URGENT_DAYS = 2;
const MAX_ROUTES = 4;
const MAX_POINTS = 4;
const MAX_REASON_WORDS = 16;

function toRoute(provider: Provider, c: Channel, articles: Article[]): FixRoute {
  const article = articles.find((a) => a.id === c.articleId);
  return {
    id: c.id,
    kind: c.kind,
    provider: provider.name,
    label: c.label,
    canDo: c.canDo,
    requiredFor: c.requiredFor ?? [],
    address: c.address,
    phone: c.phone,
    href: c.href,
    hours: c.hours,
    waitMinutes: c.waitMinutes,
    replyDays: c.replyDays,
    immediate: !!c.immediate,
    keepsRecord: !!c.keepsRecord,
    acceptsFiles: !!c.acceptsFiles,
    needs: c.needs ?? [],
    steps: c.steps ?? [],
    note: c.note,
    article: article && { title: article.title, body: article.body },
    sample: true,
  };
}

/** Is this business in the finding's evidence (an email from it, or a document named after it)? */
function inEvidence(p: Provider, finding: Finding, corpus: Corpus): boolean {
  return finding.evidence.some((e) => {
    if (e.kind === "email") return !!corpus.emails.find((m) => m.id === e.id)?.from.address.toLowerCase().endsWith(`@${p.domain}`);
    if (e.kind === "doc") return !!corpus.documents.find((d) => d.id === e.id)?.filename.toLowerCase().includes(p.key);
    return false;
  });
}

/** Code's own order, used to sort the routes and when no model answers. */
function score(r: FixRoute, finding: Finding): number {
  return (
    (r.immediate ? 4 : 0) +
    (r.keepsRecord ? 2 : 0) +
    (r.acceptsFiles && finding.draft?.attachDocumentIds.length ? 2 : 0) -
    (r.replyDays ?? 0) / 2
  );
}

/**
 * The routes that can help with this finding, and which of them could be the
 * first step. Returns undefined when the directory has nothing for it.
 */
export function eligibleRoutes(
  finding: Finding,
  help: HelpDirectory,
  corpus: Corpus,
  today = localDate(now()),
): { routes: FixRoute[]; first: FixRoute[] } | undefined {
  const needs = NEEDS[finding.kind];
  const main = needs[0];
  const own = help.providers.filter((p) => finding.keys.includes(p.key));
  // Another business only counts as a route when it's the alternative on offer, like a competing quote.
  const alternatives = needs.includes("switch")
    ? help.providers.filter((p) => !own.includes(p) && p.channels.some((c) => c.canDo.includes("switch")) && inEvidence(p, finding, corpus))
    : [];

  const draftTo = finding.draft?.to.address.toLowerCase();
  const all: FixRoute[] = [];
  for (const p of [...own, ...alternatives]) {
    for (const c of p.channels) {
      if (!c.canDo.some((job) => needs.includes(job))) continue;
      // An email route is the drafted email, so it must go to the address the draft uses.
      if (c.kind === "email" && c.address?.toLowerCase() !== draftTo) continue;
      all.push(toRoute(p, c, help.articles));
    }
  }
  // A draft to an address the directory doesn't list is still a way to fix it.
  if (finding.draft && !all.some((r) => r.kind === "email")) {
    all.push({
      id: "draft_email",
      kind: "email",
      provider: finding.draft.to.name,
      label: copy.agent.routeEmail,
      canDo: [needs[needs.length - 1]],
      requiredFor: [],
      address: finding.draft.to.address,
      immediate: false,
      keepsRecord: true,
      acceptsFiles: false,
      needs: [],
      steps: [],
      sample: true,
    });
  }
  if (all.length === 0) return undefined;

  const able = all.filter((r) => r.canDo.includes(main));
  const required = able.filter((r) => r.requiredFor.includes(main));
  const daysLeft = finding.deadline ? daysBetween(today, finding.deadline.date) : undefined;
  const instant = daysLeft !== undefined && daysLeft <= URGENT_DAYS ? able.filter((r) => r.immediate) : [];
  const pool = required.length ? required : instant.length ? instant : able.length ? able : all;

  const byScore = (a: FixRoute, b: FixRoute) => score(b, finding) - score(a, finding);
  const first = [...pool].sort(byScore);
  // After the first step, the same business comes next: whoever billed it handles its refund.
  const sameBusiness = (r: FixRoute) => (r.provider === first[0].provider ? 0 : 1);
  const rest = all.filter((r) => !pool.includes(r)).sort((a, b) => sameBusiness(a) - sameBusiness(b) || byScore(a, b));
  return { routes: [...first, ...rest].slice(0, MAX_ROUTES), first };
}

/** Where to go if the business says no, when there's somewhere that can actually take this kind of problem. */
export function escalationFor(finding: Finding, help: HelpDirectory): Escalation | undefined {
  const sectors = new Set(help.providers.filter((p) => finding.keys.includes(p.key)).map((p) => p.sector));
  const onCard = finding.evidence.some((e) => e.kind === "txn" && e.id.startsWith("MC-"));
  const body = help.bodies.find(
    (b) =>
      b.forKinds.includes(finding.kind) &&
      (!b.sectors || b.sectors.some((s) => sectors.has(s))) &&
      (!b.needsCardCharge || onCard),
  );
  if (!body) return undefined;
  const { id, name, shortName, real, phone, hours, href, afterDays, whenToUse, verifiedOn } = body;
  return { id, name, shortName, real, phone, hours, href, afterDays, whenToUse, verifiedOn };
}

function haveReady(finding: Finding): { label: string; value: string }[] {
  return HAVE_READY[finding.kind].flatMap((id) => {
    const figure = finding.figures.find((f) => f.id === id);
    return figure ? [{ label: figure.label, value: figureValue(figure) }] : [];
  });
}

// ---------- The check on the written words ----------

const PHONE_TEXT = /(?:\(0\d\)\s?\d{4}\s?\d{4}|\b1[38]00\s?\d{2,3}\s?\d{2,3}\b|\b13 \d{2} \d{2}\b|\b04\d{2}\s?\d{3}\s?\d{3}\b)/g;
const EMAIL_TEXT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const HOST_TEXT = /\b(?:[a-z0-9-]+\.)+(?:example|com|org|net|au)\b/gi;
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Everything wrong with the written words: `claimCheck`'s amounts, dates and
 * references, plus any phone number, email address or website that isn't one
 * of these routes' own. A wrong number is worse than a wrong figure here.
 */
export function routeCheck(text: string, allowed: string, routes: FixRoute[], today = localDate(now())): string[] {
  const bad = claimCheck(text, allowed, today);
  const phones = new Set(routes.flatMap((r) => (r.phone ? [digits(r.phone)] : [])));
  const addresses = new Set(routes.flatMap((r) => (r.address ? [r.address.toLowerCase()] : [])));
  const hosts = new Set(
    routes.flatMap((r) => [
      ...(r.href ? [new URL(r.href).hostname.toLowerCase()] : []),
      ...(r.address ? [r.address.split("@")[1].toLowerCase()] : []),
    ]),
  );
  for (const m of text.matchAll(PHONE_TEXT)) if (!phones.has(digits(m[0]))) bad.push(`phone ${m[0]}`);
  for (const m of text.matchAll(EMAIL_TEXT)) if (!addresses.has(m[0].toLowerCase())) bad.push(`address ${m[0]}`);
  const withoutEmails = text.replace(EMAIL_TEXT, " ");
  for (const m of withoutEmails.matchAll(HOST_TEXT)) if (!hosts.has(m[0].toLowerCase())) bad.push(`link ${m[0]}`);
  // A call or a chat box can't carry a file.
  if (/\battach(ed|ing|ment)?s?\b/i.test(text)) bad.push("mentions an attachment");
  // A blank Maya would have to spot and fill in before using it.
  if (/\[[^\]]{2,}\]|<[^>]{2,}>/.test(text)) bad.push("leaves a blank to fill in");
  // Nothing has been done yet: Maya hasn't taken any of these steps.
  if (/\b(?:have|I've|we've|already)\s+(?:already\s+)?(?:cancell?ed|sent|submitted|lodged)\b/i.test(text)) bad.push("says a step is already done");
  return [...new Set(bad)];
}

/** The reason as one short sentence, or the directory's own words if the model rambled. */
function shortReason(text: string, pick: FixRoute): string {
  const sentence = firstSentence(text.trim());
  const tooLong = sentence.split(/\s+/).length > MAX_REASON_WORDS;
  // The claim check can't verify "tomorrow" or "next week", so a reason that leans on one isn't used.
  const relativeDate = /\b(?:today|tonight|tomorrow|yesterday|(?:this|next|last) (?:week|month|year))\b/i.test(sentence);
  return tooLong || relativeDate || /\bfirst\b.*\broute\b|\broute\b.*\bfirst\b/i.test(sentence) ? (pick.note ?? copy.agent.routeFallback(pick.label)) : sentence;
}

// ---------- Asking the model ----------

type RawPlan = {
  recommended: string;
  reason: string;
  call_script?: { opening: string; points: string[]; ask: string; if_no: string };
  chat_opener?: string;
};

function planSchema(first: FixRoute[], routes: FixRoute[]): ReplySchema {
  const properties: Record<string, unknown> = {
    recommended: { type: "string", enum: first.map((r) => r.id), description: "The route to try first." },
    reason: {
      type: "string",
      description: "One short sentence, at most 12 words, saying why this way fits, like 'Retention offers are only made on this line.' No amounts, dates or ids.",
    },
  };
  if (routes.some((r) => r.kind === "call")) {
    properties.call_script = {
      type: "object",
      additionalProperties: false,
      required: ["opening", "points", "ask", "if_no"],
      properties: {
        opening: { type: "string", description: "One short sentence: who is calling and what about." },
        points: { type: "array", items: { type: "string" }, description: "At most 4 short facts to mention, the most important first, each with its figure or reference." },
        ask: { type: "string", description: "One question starting 'Can you' or 'Could you': exactly what to ask this route for." },
        if_no: {
          type: "string",
          description: "One calm instruction to the caller for if they refuse, starting with a verb, like 'Ask for a reference number, then use the online form.' Only the other routes listed. No threats.",
        },
      },
    };
  }
  if (routes.some((r) => r.kind === "chat")) {
    properties.chat_opener = {
      type: "string",
      description: "A message to paste into the support chat, under 60 words: what happened and what is wanted. No sign-off.",
    };
  }
  return {
    name: "fix_plan",
    schema: { type: "object", additionalProperties: false, required: Object.keys(properties), properties },
  };
}

/** One route as the model reads it. */
function routeBlock(r: FixRoute, canBeFirst: boolean): string {
  const facts = [
    `kind: ${r.kind}`,
    `can do: ${r.canDo.join(", ")}`,
    r.hours && `hours: ${r.hours}`,
    r.waitMinutes !== undefined && `usual wait: ${r.waitMinutes} minutes`,
    r.replyDays !== undefined && `usual reply: ${r.replyDays} business days`,
    r.immediate && "takes effect at once",
    r.keepsRecord && "leaves a written record",
    r.acceptsFiles && "accepts files",
    r.needs.length > 0 && `needs: ${r.needs.join(", ")}`,
    r.note,
  ].filter(Boolean);
  const help = r.article ? `\n  Help page "${r.article.title}": ${r.article.body}` : "";
  return `- ${r.id}${canBeFirst ? " (can go first)" : ""}: ${r.provider}, ${r.label}. ${facts.join("; ")}${help}`;
}

/** What the call or chat is for: only the jobs that route can do for this finding. */
function scopeLine(name: string, route: FixRoute | undefined, needs: Capability[]): string {
  if (!route) return "";
  const jobs = route.canDo.filter((job) => needs.includes(job)).map((job) => JOB_WORDS[job]).join(", and ");
  const limits = route.note ? ` ${route.note}` : "";
  return `- "${name}" is for ${route.provider}, ${route.label}. Ask it only to ${jobs}. Don't ask it for anything else.${limits}\n`;
}

/** The household's own email addresses never go into a script: they're swapped for plain words. */
function withoutHousehold(raw: RawPlan, household: string[]): RawPlan {
  const hide = (text: string) => household.reduce((t, address) => t.split(address).join("the email on my account"), text);
  const c = raw.call_script;
  return {
    ...raw,
    reason: hide(raw.reason),
    chat_opener: raw.chat_opener && hide(raw.chat_opener),
    call_script: c && { opening: hide(c.opening), points: c.points.map(hide), ask: hide(c.ask), if_no: hide(c.if_no) },
  };
}

/** A call or chat asked to cancel something that channel can't cancel. */
function asksWrongJob(raw: RawPlan, routes: FixRoute[]): string[] {
  const asksToCancel = /\b(?:please|need to|want to|like to|can you|could you)\s+cancel\b/i;
  const call = routes.find((r) => r.kind === "call");
  const chat = routes.find((r) => r.kind === "chat");
  const c = raw.call_script;
  const callText = c ? [c.opening, ...c.points, c.ask].join(" ") : "";
  return [
    call && !call.canDo.includes("cancel") && asksToCancel.test(callText) && `the call asks ${call.provider} to cancel, which this line can't do`,
    chat && !chat.canDo.includes("cancel") && asksToCancel.test(raw.chat_opener ?? "") && `the chat asks ${chat.provider} to cancel, which it can't do`,
  ].filter((p): p is string => !!p);
}

/** Written words that run too long to read on a call or paste into a chat. */
function tooLong(raw: RawPlan): string[] {
  const words = (s = "") => s.trim().split(/\s+/).filter(Boolean).length;
  const c = raw.call_script;
  return [
    words(c?.opening) > 30 && "call opening is over 30 words",
    words(c?.ask) > 35 && "call ask is over 35 words",
    words(c?.if_no) > 35 && "if_no is over 35 words",
    words(raw.chat_opener) > 70 && "chat opener is over 70 words",
  ].filter((p): p is string => !!p);
}

function prompt(finding: Finding, voice: Voice, routes: FixRoute[], block: string, figures: string, evidence: string, retryProblems: string[]): string {
  const retry = retryProblems.length
    ? `\nAn earlier answer had these problems: ${retryProblems.join("; ")}. Fix every one, by leaving the item out or using the exact listed value.\n`
    : "";
  const needs = NEEDS[finding.kind];
  const scope = scopeLine("call_script", routes.find((r) => r.kind === "call"), needs) + scopeLine("chat_opener", routes.find((r) => r.kind === "chat"), needs);
  return `Choose the best way for ${voice.fromName} to fix this problem with ${finding.merchant}, and write the words to use.
Problem: ${finding.title}. ${finding.why}
What we want: ${finding.action.summary}
${KIND_GUIDANCE[finding.kind] ?? ""}

Choosing:
- "recommended" must be a route marked "can go first": the one most likely to fix this soon.
- Prefer a written route when the case rests on what a contract promised, because it leaves a record.
- Prefer a call when a person must make an offer on the spot, or the business is a small office.
- Prefer a form that accepts files when the business needs to see a photo or document.

Writing:
${scope}- Write in the first person as ${voice.fromName}. If an account is in someone else's name, say you're calling for them, using their first name only, and describe what they did by name, not as "I". Never say how you are related.
- Use ONLY the VERIFIED FIGURES, EVIDENCE and ROUTES below. Copy every amount, date, count and reference exactly. Never calculate or estimate. If a number you want is not listed, leave it out.
- No blanks or placeholders such as [Account Number]. If a detail isn't in the sources, leave it out.
- Never write a phone number, web link or email address. The app shows those.
- Never mention attachments or sending files: a call or chat can't carry a file.
- Nothing has been done yet. Never say anything has already been cancelled, sent or submitted.
- Never threaten a dispute, a complaint, a chargeback or legal action.
- Dates after today are still ahead; say "by" for those, never "was".
- Don't say the business made a mistake unless the figures show one. Be honest about anything that weakens our case, and ask for goodwill where that is all we can ask for.
- Tone: ${voice.tone}. Plain text, no markdown.
${retry}
ROUTES:
${block}

VERIFIED FIGURES (worked out and checked by code):
${figures}

EVIDENCE:
${evidence}`;
}

/** The ways to fix one finding. Never throws: without a model it still returns the routes. */
export async function planFix(
  llm: LlmClient,
  finding: Finding,
  corpus: Corpus,
  voice: Voice,
  help: HelpDirectory,
  today = localDate(now()),
): Promise<FixPlan | undefined> {
  const options = eligibleRoutes(finding, help, corpus, today);
  if (!options) return undefined;
  const { routes, first } = options;
  const base = { routes, haveReady: haveReady(finding), escalation: escalationFor(finding, help) };

  const figures = draftFigures(finding);
  const { text: evidence } = draftEvidence(finding.evidence, corpus);
  const block = routes.map((r) => routeBlock(r, first.includes(r))).join("\n");
  const allowed = `${figures}\n${evidence}\n${block}`;
  const schema = planSchema(first, routes);
  const system = `You plan practical next steps for the Whitlock family's household admin in Melbourne, Australia. Today is ${longDate(today)}. Currency is AUD. You never do arithmetic or date maths: you quote checked figures exactly.`;

  const attempts: DraftAttempt[] = [];
  // `notes` is everything to fix on a retry; only wrong facts count against the check.
  let best: { raw: RawPlan; attempt: DraftAttempt; notes: string[] } | undefined;

  // Flash first; the 35B (thinking off) once, only if Flash's words failed the check.
  for (const model of ["flash", "judge"] as const) {
    try {
      const r = await llm.chat<RawPlan>({
        model,
        think: false,
        maxTokens: 1200,
        temperature: 0.2,
        schema,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt(finding, voice, routes, block, figures, evidence, best?.notes ?? []) },
        ],
      });
      const raw = withoutHousehold(r.json, voice.householdAddresses);
      const c = raw.call_script;
      // Only what will be shown is checked: the reason's first sentence and the first few points.
      const written = [firstSentence(raw.reason.trim()), c?.opening, ...(c?.points.slice(0, MAX_POINTS) ?? []), c?.ask, c?.if_no, raw.chat_opener]
        .filter(Boolean)
        .join("\n");
      const problems = [...routeCheck(written, allowed, routes, today), ...asksWrongJob(raw, routes)];
      if (!first.some((x) => x.id === raw.recommended)) problems.push(`route ${raw.recommended} can't be the first step`);
      const notes = [...problems, ...tooLong(raw)];
      const attempt: DraftAttempt = { model: r.model, source: r.source, ms: r.ms, problems };
      attempts.push(attempt);
      if (!best || problems.length < best.attempt.problems.length || (problems.length === best.attempt.problems.length && notes.length < best.notes.length)) {
        best = { raw, attempt, notes };
      }
      if (notes.length === 0) break;
    } catch (error) {
      attempts.push({ model, source: "live", ms: 0, problems: [error instanceof Error ? error.message : String(error)] });
      // No point asking a second model when the endpoint itself is unreachable.
      if (error instanceof LlmError && ["network", "not_configured", "not_cached"].includes(error.kind)) break;
    }
  }

  const ms = attempts.reduce((n, a) => n + a.ms, 0);
  const onlyOne = first.length === 1;
  if (!best) {
    // No model: code's first choice, in the directory's own words, and no script.
    const pick = first[0];
    return {
      ...base,
      recommendedId: pick.id,
      reason: pick.note ?? copy.agent.routeFallback(pick.label),
      chosenBy: onlyOne ? "rule" : "default",
      grounded: true,
      problems: [],
      attempts,
      ms,
    };
  }

  const { raw, attempt } = best;
  const pick = first.find((x) => x.id === raw.recommended) ?? first[0];
  const script = raw.call_script;
  return {
    ...base,
    // The recommended route leads the list.
    routes: [pick, ...routes.filter((r) => r !== pick)],
    recommendedId: pick.id,
    reason: shortReason(raw.reason, pick),
    chosenBy: onlyOne ? "rule" : "model",
    callScript: script && {
      opening: script.opening.trim(),
      points: script.points.slice(0, MAX_POINTS).map((p) => p.trim()),
      ask: script.ask.trim(),
      // The app labels this "If they say no", so the model's own label would repeat it.
      ifNo: script.if_no.trim().replace(/^if they say no:\s*/i, ""),
    },
    chatOpener: raw.chat_opener?.trim(),
    grounded: attempt.problems.length === 0,
    problems: attempt.problems,
    attempts,
    model: attempt.model,
    source: attempt.source,
    ms,
  };
}
