// Stage 4 of the scan: the 9B model reads each email and document a case
// needs and copies out the facts (amounts, dates, references, key terms) as
// small JSON. It copies; it never calculates. Code then checks every value
// against the source text, and anything it can't find there is marked
// ungrounded and never used. Photos are read by the same model's vision.
//
// If the 9B returns something unusable, it tries once more, then hands the
// item to the 35B (thinking off). Each result records which model answered.

import type { LlmClient, ModelRole, ReplySchema } from "../lib/llm.ts";
import { LlmError } from "../lib/llm.ts";
import type { Connectors } from "../connectors/index.ts";
import type { Corpus } from "./corpus.ts";
import { mapLimited } from "./corpus.ts";
import { amountIn, clauseIn, dateIn, numberIn, referenceIn } from "./grounding.ts";
import type { CaseEvidence } from "./retrieval.ts";

// ---------- Shapes ----------

type Checked<T> = T & { grounded: boolean };

export type SourceFacts = {
  /** "email:msg_0024" or "doc:doc_001". */
  key: string;
  kind: "email" | "doc";
  id: string;
  merchant: string | null;
  docType: string;
  amounts: Checked<{ cents: number; label: string }>[];
  quantities: Checked<{ value: number; unit: string; label: string }>[];
  dates: Checked<{ date: string; label: string }>[];
  references: Checked<{ value: string }>[];
  clauses: Checked<{ text: string }>[];
  /** Set for photos: what the vision model read. */
  reading?: { value: number | null; unit: string; note: string };
  model: string;
  source: "live" | "cache";
  ms: number;
  attempts: number;
};

export type ExtractionFailure = { key: string; error: string };

export type ExtractionResult = {
  facts: Map<string, SourceFacts>;
  failures: ExtractionFailure[];
};

export type ExtractProgress = { done: number; total: number; key: string; model?: string; ok: boolean };

// ---------- Prompts and schemas ----------

const SYSTEM = `You copy facts out of household paperwork for the Whitlock family in Melbourne, Australia. Currency is AUD. Copy values exactly as written. Never calculate, convert, total or infer. If something is absent, use [] or null.`;

const FACTS_SCHEMA: ReplySchema = {
  name: "facts",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["merchant", "doc_type", "amounts", "quantities", "dates", "references", "key_clauses"],
    properties: {
      merchant: { type: ["string", "null"] },
      doc_type: { type: "string" },
      amounts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["value", "label"],
          properties: { value: { type: "number" }, label: { type: "string" } },
        },
      },
      quantities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["value", "unit", "label"],
          properties: { value: { type: "number" }, unit: { type: "string" }, label: { type: "string" } },
        },
      },
      dates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["iso", "label"],
          properties: { iso: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, label: { type: "string" } },
        },
      },
      references: { type: "array", items: { type: "string" } },
      key_clauses: { type: "array", items: { type: "string" } },
    },
  },
};

type RawFacts = {
  merchant: string | null;
  doc_type: string;
  amounts: { value: number; label: string }[];
  quantities: { value: number; unit: string; label: string }[];
  dates: { iso: string; label: string }[];
  references: string[];
  key_clauses: string[];
};

const factsPrompt = (kind: string, text: string) => `Extract facts from this ${kind}.
"amounts": money only, as numbers (1485.54), with a short label.
"quantities": kWh, meter readings, days, months, counts, with unit and label.
"dates": as YYYY-MM-DD with a label (e.g. "valid until", "renews on"). Today is 19 November 2026; a date written without a year is in the nearest sensible year.
"references": invoice, receipt, account, quote, agreement or customer numbers.
"key_clauses": up to 5 short sentences copied nearly word for word about price, term length, cancellation or notice, renewal, estimates, or what the sender promises or asks.

${text}`;

const METER_SCHEMA: ReplySchema = {
  name: "meter",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reading", "unit", "note"],
    properties: {
      reading: {
        type: ["number", "null"],
        description: "The register in whole units. A last digit in a red or differently coloured box is tenths: leave it out.",
      },
      unit: { type: "string" },
      note: { type: "string", description: "What the photo shows, in one short sentence (meter type, any date on screen)." },
    },
  },
};

const METER_PROMPT = `This is a photo of a household utility meter. Read the register.
If the last digit sits in a red or differently coloured window, it is tenths of a unit: do not include it.
Give the reading in whole units, the unit (e.g. kWh), and one short note.`;

// ---------- Source text ----------

function emailText(corpus: Corpus, id: string): string | undefined {
  const m = corpus.emails.find((e) => e.id === id);
  if (!m) return undefined;
  const attachments = m.attachments.map((a) => a.filename).join(", ");
  return [
    `From: ${m.from.name} <${m.from.address}>`,
    `Date: ${m.date}`,
    `Subject: ${m.subject}`,
    attachments ? `Attachments: ${attachments}` : "",
    "",
    m.body,
  ]
    .filter((line, i) => line !== "" || i === 4)
    .join("\n");
}

// ---------- Grounding ----------

function ground(raw: RawFacts, source: string): Omit<SourceFacts, "key" | "kind" | "id" | "model" | "source" | "ms" | "attempts"> {
  return {
    merchant: raw.merchant,
    docType: raw.doc_type,
    amounts: raw.amounts.map((a) => {
      const cents = Math.round(a.value * 100);
      return { cents, label: a.label, grounded: amountIn(cents, source) };
    }),
    quantities: raw.quantities.map((q) => ({ ...q, grounded: numberIn(q.value, source) })),
    dates: raw.dates.map((d) => ({ date: d.iso, label: d.label, grounded: dateIn(d.iso, source) })),
    references: raw.references.map((value) => ({ value, grounded: referenceIn(value, source) })),
    clauses: raw.key_clauses.map((text) => ({ text, grounded: clauseIn(text, source) })),
  };
}

// ---------- Calls with escalation ----------

/** The 9B first (twice), then the 35B. Thinking stays off: this is copying. */
const LADDER: ModelRole[] = ["fast", "fast", "judge"];

async function withLadder<T>(
  run: (model: ModelRole, attempt: number) => Promise<T>,
): Promise<{ value: T; model: ModelRole; attempts: number }> {
  let lastError: unknown;
  for (let i = 0; i < LADDER.length; i++) {
    try {
      return { value: await run(LADDER[i], i), model: LADDER[i], attempts: i + 1 };
    } catch (error) {
      lastError = error;
      // Network trouble won't be fixed by a bigger model; stop here.
      if (error instanceof LlmError && ["network", "not_configured", "not_cached"].includes(error.kind)) break;
    }
  }
  throw lastError;
}

async function extractText(llm: LlmClient, kind: "email" | "doc", id: string, text: string): Promise<SourceFacts> {
  const label = kind === "email" ? "email" : "document";
  const { value, attempts } = await withLadder(async (model, attempt) => {
    const r = await llm.chat<RawFacts>({
      model,
      think: false,
      maxTokens: 1500,
      // A second try at the same model needs a different request, or the
      // saved reply would come straight back.
      temperature: attempt === 1 ? 0.3 : 0.1,
      schema: FACTS_SCHEMA,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: factsPrompt(label, text) },
      ],
    });
    return r;
  });
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    ...ground(value.json, text),
    model: value.model,
    source: value.source,
    ms: value.ms,
    attempts,
  };
}

async function extractPhoto(llm: LlmClient, connectors: Connectors, id: string): Promise<SourceFacts> {
  const image = await connectors.documents.readImage(id);
  const { value, attempts } = await withLadder(async (model, attempt) => {
    const r = await llm.chat<{ reading: number | null; unit: string; note: string }>({
      model,
      think: false,
      maxTokens: 400,
      temperature: attempt === 1 ? 0.3 : 0.1,
      schema: METER_SCHEMA,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: METER_PROMPT },
            { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
          ],
        },
      ],
    });
    // A photo that came back unread is worth another look by a bigger model.
    if (r.json.reading === null) throw new LlmError("empty", "Could not read the meter.");
    return r;
  });
  const { reading, unit, note } = value.json;
  return {
    key: `doc:${id}`,
    kind: "doc",
    id,
    merchant: null,
    docType: "meter photo",
    amounts: [],
    // There is no source text to check a photo against: code checks the
    // reading against the bills instead (verify stage).
    quantities: reading === null ? [] : [{ value: reading, unit, label: "meter reading (photo)", grounded: false }],
    dates: [],
    references: [],
    clauses: [],
    reading: { value: reading, unit, note },
    model: value.model,
    source: value.source,
    ms: value.ms,
    attempts,
  };
}

// ---------- Entry point ----------

/** How many extraction calls run at once. The spike saw no rate limiting at 12. */
const CONCURRENCY = 8;

export async function extractAll(
  cases: CaseEvidence[],
  corpus: Corpus,
  connectors: Connectors,
  llm: LlmClient,
  onProgress: (p: ExtractProgress) => void = () => {},
): Promise<ExtractionResult> {
  // Each email or document once, however many cases cite it.
  const keys = [
    ...new Set(cases.flatMap((c) => c.items.filter((i) => i.kind === "email" || i.kind === "doc").map((i) => `${i.kind}:${i.id}`))),
  ];
  const facts = new Map<string, SourceFacts>();
  const failures: ExtractionFailure[] = [];
  let done = 0;

  await mapLimited(keys, CONCURRENCY, async (key) => {
    const [kind, id] = key.split(":") as ["email" | "doc", string];
    try {
      let result: SourceFacts | undefined;
      if (kind === "email") {
        const text = emailText(corpus, id);
        if (text) result = await extractText(llm, "email", id, text);
      } else {
        const doc = corpus.documents.find((d) => d.id === id);
        if (doc?.text) result = await extractText(llm, "doc", id, `${doc.title} (${doc.filename})\n\n${doc.text}`);
        else if (doc?.mimeType.startsWith("image/")) result = await extractPhoto(llm, connectors, id);
      }
      if (result) facts.set(key, result);
      onProgress({ done: ++done, total: keys.length, key, model: result?.model, ok: true });
    } catch (error) {
      failures.push({ key, error: error instanceof Error ? error.message : String(error) });
      onProgress({ done: ++done, total: keys.length, key, ok: false });
    }
  });

  return { facts, failures };
}
