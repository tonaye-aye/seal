// The app's seed source: Vite copies these files into the bundle at build time.
// The patterns below are an allowlist, one folder at a time. seed/eval/ is
// never listed, so the answer key cannot end up inside the app.

import { assertAllowedSeedPath, type SeedSource } from "./source.ts";

const text = import.meta.glob<string>(
  [
    "/seed/bank/*.{csv,json}",
    "/seed/email/inbox.json",
    "/seed/documents/index.json",
    "/seed/documents/_text/*.txt",
    // Photos have no real text layer. Their sidecar is a note for people
    // browsing the seed and states the answer, so it stays out of the app.
    "!/seed/documents/_text/*Photo*.txt",
    "/seed/calendar/events.json",
    "/seed/connectors/manifest.json",
    "/seed/persona.json",
  ],
  { query: "?raw", import: "default", eager: true },
);

// Binary files (images) are bundled as URLs and fetched when needed.
const binary = import.meta.glob<string>("/seed/documents/**/*.{jpg,jpeg,png}", {
  query: "?url",
  import: "default",
  eager: true,
});

function key(path: string): string {
  assertAllowedSeedPath(path);
  return `/seed/${path.replace(/^\/+/, "")}`;
}

export const viteSeedSource: SeedSource = {
  async readText(path) {
    const content = text[key(path)];
    if (content === undefined) throw new Error(`Seed file not bundled: ${path}`);
    return content;
  },
  async readBytes(path) {
    const url = binary[key(path)];
    if (url === undefined) throw new Error(`Seed file not bundled: ${path}`);
    const response = await fetch(url);
    return new Uint8Array(await response.arrayBuffer());
  },
};
