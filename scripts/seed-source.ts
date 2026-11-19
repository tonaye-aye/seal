// Seed source for scripts run with Node: reads files straight from seed/.
// Same rule as the app: seed/eval/ is refused here too, so the connectors
// can never read the answer key even when the eval script is driving them.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertAllowedSeedPath, type SeedSource } from "../src/connectors/source.ts";

const SEED = new URL("../seed/", import.meta.url).pathname;

export const nodeSeedSource: SeedSource = {
  async readText(path) {
    assertAllowedSeedPath(path);
    return readFile(join(SEED, path), "utf8");
  },
  async readBytes(path) {
    assertAllowedSeedPath(path);
    return new Uint8Array(await readFile(join(SEED, path)));
  },
};
