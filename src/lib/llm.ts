// One way to call the models, shared by the app and the scripts. It knows the
// settings the spike settled on (scripts/SPIKE.md): strict JSON schemas, an
// explicit thinking switch, generous token budgets, and what to do when a
// thinking model spends its whole budget thinking and returns nothing.
//
// It never touches the network itself. A "transport" does: in the app that is
// a Rust command (so the API key stays out of the web page); in scripts it is
// a plain fetch. Both keep successful replies on disk, which is what replay
// mode reads when the endpoint is down. Every result says which it was.

export const MODELS = {
  /** Qwen 3.5 9B: fast extraction and the meter photo. Thinking off. */
  fast: "basecompute/qwen3.5-9b",
  /** Qwen 3.6 35B-A3B: judgment (thinking on) and drafting fallback (off). */
  judge: "basecompute/qwen3.6-35b-a3b",
  /** Qwen 3.8 Flash: drafting (thinking off) and long context. */
  flash: "basecompute/qwen3.8-flash-next",
} as const;

export type ModelRole = keyof typeof MODELS;

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type Message = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

/** A JSON Schema the reply must follow. Strict mode is used for every call. */
export type ReplySchema = { name: string; schema: Record<string, unknown> };

export type ChatRequest = {
  model: ModelRole;
  messages: Message[];
  /** Thinking models reason before answering: better judgment, much slower. */
  think: boolean;
  /** Room for thinking plus the answer. Too little and the answer is empty. */
  maxTokens: number;
  schema?: ReplySchema;
  temperature?: number;
};

export type ChatResult<T = unknown> = {
  text: string;
  /** The parsed reply when a schema was given. */
  json: T;
  model: string;
  /** "cache" means a saved reply was used (replay), not a fresh one. */
  source: "live" | "cache";
  ms: number;
  usage: { prompt: number; completion: number; reasoning: number };
};

export type LlmErrorKind =
  | "not_configured" // no API key
  | "network" // could not reach the endpoint
  | "http" // the endpoint answered with an error status
  | "empty" // the model returned no answer (usually thinking used the budget)
  | "invalid_json" // the answer did not parse as the requested JSON
  | "not_cached"; // replay mode and this exact request was never saved

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;
  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
  }
}

/** What a transport hands back: the raw reply and where it came from. */
export type TransportReply = { status: number; body: string; source: "live" | "cache" };

/**
 * Sends one request. `mode: "replay"` must only read the saved reply for
 * `cacheKey`; `"live"` calls the endpoint and saves a successful reply.
 * Network failures and a missing key throw LlmError; HTTP errors return
 * their status so the client can decide whether to retry.
 */
export interface LlmTransport {
  post(path: "chat/completions", body: string, cacheKey: string, mode: "live" | "replay"): Promise<TransportReply>;
}

export type LlmMode =
  | "live" // always call the endpoint
  | "live_with_fallback" // call it; if that fails, use the saved reply
  | "replay"; // saved replies only (demo without a connection)

export type LlmClient = {
  chat<T = unknown>(request: ChatRequest): Promise<ChatResult<T>>;
};

/** Short pauses before retrying a failed call, in milliseconds. */
const BACKOFF_MS = [800, 2500];

/** Fingerprint of a request, so the same request finds the same saved reply. */
export async function cacheKey(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The request body in the shape the OpenAI-compatible endpoint expects. */
export function requestBody(request: ChatRequest): string {
  return JSON.stringify({
    model: MODELS[request.model],
    messages: request.messages,
    max_tokens: request.maxTokens,
    temperature: request.temperature ?? 0.1,
    // The only switch that reliably turns thinking off on all three models.
    reasoning: { enabled: request.think },
    ...(request.schema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema },
          },
        }
      : {}),
  });
}

/** Retrying helps with overload and network blips, not with bad requests. */
function retryable(error: unknown): boolean {
  if (!(error instanceof LlmError)) return false;
  if (error.kind === "network") return true;
  return error.kind === "http" && (error.status === 429 || (error.status ?? 0) >= 500);
}

type RawReply = {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

function parseReply<T>(reply: TransportReply, request: ChatRequest, ms: number): ChatResult<T> {
  if (reply.status < 200 || reply.status >= 300) {
    throw new LlmError("http", `Endpoint answered ${reply.status}: ${reply.body.slice(0, 200)}`, reply.status);
  }
  const raw = JSON.parse(reply.body) as RawReply;
  const choice = raw.choices?.[0];
  const text = choice?.message?.content?.trim() ?? "";
  if (!text) {
    throw new LlmError(
      "empty",
      `No answer (finish_reason ${choice?.finish_reason ?? "unknown"}, ${raw.usage?.completion_tokens ?? "?"} tokens used)`,
    );
  }
  let json: unknown = undefined;
  if (request.schema) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError("invalid_json", `Reply was not valid JSON: ${text.slice(0, 120)}`);
    }
  }
  return {
    text,
    json: json as T,
    model: raw.model ?? MODELS[request.model],
    source: reply.source,
    ms,
    usage: {
      prompt: raw.usage?.prompt_tokens ?? 0,
      completion: raw.usage?.completion_tokens ?? 0,
      reasoning: raw.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

export function createLlm(
  transport: LlmTransport,
  options: { mode?: LlmMode; sleep?: (ms: number) => Promise<void> } = {},
): LlmClient {
  const mode = options.mode ?? "live_with_fallback";
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function once<T>(request: ChatRequest, sendMode: "live" | "replay"): Promise<ChatResult<T>> {
    const body = requestBody(request);
    const started = Date.now();
    const reply = await transport.post("chat/completions", body, await cacheKey(body), sendMode);
    return parseReply<T>(reply, request, Date.now() - started);
  }

  async function live<T>(request: ChatRequest): Promise<ChatResult<T>> {
    let current = request;
    let emptyRetried = false;
    for (let attempt = 0; ; attempt++) {
      try {
        return await once<T>(current, "live");
      } catch (error) {
        // A thinking model that ran out of room: try once more with double.
        if (error instanceof LlmError && error.kind === "empty" && !emptyRetried) {
          emptyRetried = true;
          current = { ...current, maxTokens: current.maxTokens * 2 };
          continue;
        }
        if (retryable(error) && attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt]);
          continue;
        }
        throw error;
      }
    }
  }

  return {
    async chat<T>(request: ChatRequest) {
      if (mode === "replay") return once<T>(request, "replay");
      try {
        return await live<T>(request);
      } catch (error) {
        if (mode !== "live_with_fallback") throw error;
        // Only fall back when the endpoint couldn't be used, not when the
        // model gave a bad answer (that answer would be replayed again).
        const unreachable =
          error instanceof LlmError && (error.kind === "network" || error.kind === "http" || error.kind === "not_configured");
        if (!unreachable) throw error;
        try {
          return await once<T>(request, "replay");
        } catch {
          throw error; // no saved reply either: report the original failure
        }
      }
    },
  };
}
