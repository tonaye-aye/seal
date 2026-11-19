// Where the fake connectors get their raw files from. The app reads them from
// the bundle (source.vite.ts); the eval scripts read them from disk
// (scripts/seed-source.ts). Either way the connectors behave the same.

/** Raw access to files under seed/, by path relative to that folder. */
export interface SeedSource {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}

/**
 * Hard stop on the answer key. seed/eval/ holds the expected findings for
 * scoring; if the agent could read it, the eval would be meaningless.
 */
export function assertAllowedSeedPath(path: string): void {
  const normal = path.replace(/^\.?\/+/, "");
  if (normal === "eval" || normal.startsWith("eval/") || normal.includes("/eval/")) {
    throw new Error("seed/eval/ is for scoring only and is never readable by the app.");
  }
}

/** Bytes to base64 text, in chunks so large images don't overflow the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
