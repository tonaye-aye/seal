// Model transport for scripts run with Node. Calls the endpoint directly with
// the key from .env and keeps every successful reply in .cache/llm/ (one file
// per request fingerprint), so re-running an eval is fast and repeatable.
//
// Run scripts with: node --env-file=.env scripts/<name>.ts

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LlmError, type LlmTransport } from "../src/lib/llm.ts";

const CACHE_DIR = new URL("../.cache/llm/", import.meta.url).pathname;
const TIMEOUT_MS = 180_000;

export function nodeTransport(): LlmTransport {
  const base = process.env.BC_BASE_URL?.replace(/\/+$/, "");
  const key = process.env.BC_API_KEY;

  return {
    async post(path, body, cacheKey, mode) {
      const file = join(CACHE_DIR, `${cacheKey}.json`);
      if (mode === "replay") {
        try {
          return { status: 200, body: await readFile(file, "utf8"), source: "cache" };
        } catch {
          throw new LlmError("not_cached", "No saved reply for this request.");
        }
      }
      if (!base || !key) {
        throw new LlmError("not_configured", "BC_BASE_URL or BC_API_KEY is missing. Run with --env-file=.env.");
      }
      let response: Response;
      try {
        response = await fetch(`${base}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new LlmError("network", `Could not reach the endpoint: ${(error as Error).message}`);
      }
      const text = await response.text();
      if (response.ok) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, text);
      }
      return { status: response.status, body: text, source: "live" };
    },
  };
}
