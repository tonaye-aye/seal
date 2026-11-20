// The model client for one scan. It decides, call by call, whether an answer
// comes live from the endpoint or from the saved answers (replay), and makes
// sure a dead endpoint costs seconds, not minutes.
//
// It starts live (or on saved answers, when the endpoint check failed or saved
// answers were chosen). The first time the endpoint can't be used, it switches
// the rest of the scan to saved answers at once, instead of letting each of
// the ~70 calls wait through its own retries. Every answer still says where it
// came from, so the UI can label saved ones.
//
// The agent code doesn't change: it gets an ordinary LlmClient.

import { createLlm, LlmError, type ChatRequest, type ChatResult, type LlmClient, type LlmTransport } from "./llm.ts";

/** A thinking model can take ~30 s; past this a call counts as no answer. */
export const CALL_LIMIT_MS = 90_000;

export type SessionOptions = {
  transport: LlmTransport;
  /** "replay": saved answers from the start. */
  start: "live" | "replay";
  /** Demo switch: the endpoint stops answering after this many live calls. */
  dropAfter?: number;
  /** Called once, when the scan loses the endpoint partway through. */
  onLost?: (reason: string) => void;
  callLimitMs?: number;
};

export type ModelSession = LlmClient & {
  /** Set once the endpoint was lost partway: why, in plain words. */
  lost(): string | undefined;
};

/** Failures that mean the endpoint can't be used right now (not a bad answer from a model). */
function endpointDown(error: unknown): boolean {
  if (!(error instanceof LlmError)) return false;
  if (error.kind === "network" || error.kind === "not_configured") return true;
  const status = error.status ?? 0;
  return error.kind === "http" && (status === 401 || status === 403 || status === 429 || status >= 500);
}

function lostReason(error: LlmError): string {
  if (error.kind === "http" && (error.status === 401 || error.status === 403)) return "the endpoint stopped accepting the API key";
  if (error.kind === "http" && error.status === 429) return "the endpoint kept asking us to slow down";
  if (error.kind === "http") return `the endpoint answered with an error (${error.status})`;
  if (/within/.test(error.message)) return "the endpoint stopped answering in time";
  return "the endpoint stopped answering";
}

export function createModelSession(options: SessionOptions): ModelSession {
  let liveCalls = 0;
  // The demo switch wraps the transport: after N live calls it acts like a dropped connection.
  const transport: LlmTransport =
    options.dropAfter === undefined
      ? options.transport
      : {
          post(path, body, key, mode) {
            if (mode === "live" && ++liveCalls > options.dropAfter!) {
              return Promise.reject(new LlmError("network", "Simulated: the endpoint stopped answering."));
            }
            return options.transport.post(path, body, key, mode);
          },
        };

  const live = createLlm(transport, { mode: "live" });
  const replay = createLlm(transport, { mode: "replay" });
  const limit = options.callLimitMs ?? CALL_LIMIT_MS;
  let onReplay = options.start === "replay";
  let lost: string | undefined;

  async function fromSaved<T>(request: ChatRequest, liveError?: unknown): Promise<ChatResult<T>> {
    try {
      return await replay.chat<T>(request);
    } catch (error) {
      if (error instanceof LlmError && error.kind === "not_cached") {
        // Said plainly in "Couldn't decide": nothing is made up to fill the gap.
        throw new LlmError(
          "not_cached",
          liveError ? "The model endpoint couldn't be reached and there's no saved answer for this one." : "There's no saved answer for this one.",
        );
      }
      throw error;
    }
  }

  return {
    lost: () => lost,
    async chat<T>(request: ChatRequest) {
      if (onReplay) return fromSaved<T>(request);
      try {
        return await withLimit(live.chat<T>(request), limit);
      } catch (error) {
        if (endpointDown(error)) {
          // The first failure switches the rest of the scan to saved answers.
          if (!onReplay) {
            onReplay = true;
            lost = lostReason(error as LlmError);
            options.onLost?.(lost);
          }
          return fromSaved<T>(request, error);
        }
        // A bad request (400) may still have a saved answer, as before; a bad
        // answer from the model is not swapped for a saved one.
        if (error instanceof LlmError && error.kind === "http") {
          try {
            return await replay.chat<T>(request);
          } catch {
            throw error;
          }
        }
        throw error;
      }
    },
  };
}

/** Gives up on a promise after `ms` (the request itself carries on and is ignored). */
export function withLimit<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new LlmError("network", `The endpoint didn't answer within ${Math.round(ms / 1000)} seconds`)),
      ms,
    );
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error) => (clearTimeout(timer), reject(error)),
    );
  });
}
