// The app's model transport: hands each request to the Rust command
// (src-tauri/src/llm.rs), which adds the API key, calls the endpoint and keeps
// the reply for replay. The key never exists on this side.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { createLlm, LlmError, type LlmErrorKind, type LlmMode, type LlmTransport, type TransportReply } from "./llm.ts";

type Failure = { kind: LlmErrorKind; message: string };

export const tauriTransport: LlmTransport = {
  async post(path, body, cacheKey, mode) {
    if (!isTauri()) {
      // A plain browser tab (pnpm dev) has no native side and so no key.
      throw new LlmError("not_configured", "Model calls need the desktop app (pnpm tauri dev).");
    }
    try {
      return await invoke<TransportReply>("llm_request", { path, body, cacheKey, mode });
    } catch (error) {
      const failure = error as Partial<Failure>;
      throw new LlmError(failure.kind ?? "network", failure.message ?? String(error));
    }
  },
};

/** Whether the native side has an endpoint and key (never the key itself). */
export async function llmConfigured(): Promise<boolean> {
  return isTauri() ? invoke<boolean>("llm_configured") : false;
}

export function createAppLlm(mode: LlmMode = "live_with_fallback") {
  return createLlm(tauriTransport, { mode });
}
