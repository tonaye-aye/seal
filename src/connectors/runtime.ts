// Shared plumbing for the fake connectors: the manifest (connection details),
// realistic network delays, the opt-in failure scenarios and a common error.

import type { ConnectorId } from "./types.ts";
import type { SeedSource } from "./source.ts";

// ---------- Manifest ----------

export type ManifestConnector = {
  id: ConnectorId;
  name: string;
  kind: string;
  status: string;
  access: string;
  scopes?: string[];
  pageSize?: number;
  lastSyncedAt: string;
  latencyMs: { p50: number; p95: number };
  operations: string[];
  notes?: string;
};

export type ScenarioId = "calendar_reauth" | "bank_rate_limit" | "slow_documents";

export type ManifestScenario = {
  id: ScenarioId;
  default: boolean;
  connector: ConnectorId;
  behaviour: string;
};

export type Manifest = {
  asOf: string;
  connectors: ManifestConnector[];
  scenarios: ManifestScenario[];
};

export async function loadManifest(source: SeedSource): Promise<Manifest> {
  return JSON.parse(await source.readText("connectors/manifest.json")) as Manifest;
}

// ---------- Failure scenarios ----------

/**
 * Which failure scenarios are switched on. The demo flips these from a hidden
 * panel to show how the app copes with a broken connection.
 */
export class Scenarios {
  private on = new Set<ScenarioId>();
  private listeners = new Set<() => void>();

  constructor(initial: Iterable<ScenarioId> = []) {
    for (const id of initial) this.on.add(id);
  }

  has(id: ScenarioId): boolean {
    return this.on.has(id);
  }

  set(id: ScenarioId, enabled: boolean): void {
    if (enabled === this.on.has(id)) return;
    if (enabled) this.on.add(id);
    else this.on.delete(id);
    for (const listener of this.listeners) listener();
  }

  list(): ScenarioId[] {
    return [...this.on];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// ---------- Errors ----------

export type ConnectorErrorCode = "unauthorized" | "rate_limited" | "not_found" | "unavailable";

/** A failure the way a real API reports it: an HTTP-like status and a code. */
export class ConnectorError extends Error {
  readonly connector: ConnectorId;
  readonly code: ConnectorErrorCode;
  readonly status: number;
  /** Set on rate limits: how long the server asks us to wait. */
  readonly retryAfterSeconds?: number;

  constructor(init: {
    connector: ConnectorId;
    code: ConnectorErrorCode;
    status: number;
    message: string;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = "ConnectorError";
    this.connector = init.connector;
    this.code = init.code;
    this.status = init.status;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

// ---------- Runtime ----------

/** Everything the connectors share. Tests pass `latencyScale: 0` to skip waits. */
export type ConnectorRuntime = {
  source: SeedSource;
  manifest: Manifest;
  scenarios: Scenarios;
  /** 1 = delays as in the manifest, 0 = instant (eval and checks). */
  latencyScale: number;
  random: () => number;
  sleep: (ms: number) => Promise<void>;
};

export const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function manifestEntry(runtime: ConnectorRuntime, id: ConnectorId): ManifestConnector {
  const entry = runtime.manifest.connectors.find((c) => c.id === id);
  if (!entry) throw new Error(`Connector "${id}" is missing from the manifest.`);
  return entry;
}

/**
 * A believable network delay. Real latency is skewed: most calls are near the
 * median (p50) with a long tail. A log-normal curve fitted to p50 and p95
 * gives that shape. 1.645 is how far p95 sits from the middle of a bell curve.
 */
export function sampleLatency(p50: number, p95: number, random: () => number): number {
  const sigma = Math.log(p95 / p50) / 1.645;
  // Two uniform random numbers turned into one bell-curve number (Box-Muller).
  const u = Math.max(random(), 1e-9);
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  const ms = Math.exp(Math.log(p50) + sigma * z);
  return Math.min(Math.max(ms, p50 * 0.3), p95 * 1.5);
}

/** Wait as long as one call to this connector would take. */
export function networkDelay(runtime: ConnectorRuntime, id: ConnectorId): Promise<void> {
  const { p50, p95 } = manifestEntry(runtime, id).latencyMs;
  return runtime.sleep(sampleLatency(p50, p95, runtime.random) * runtime.latencyScale);
}

/** Simple paging: the cursor is the position of the next item. */
export function paginate<T>(all: T[], pageSize: number, cursor?: string) {
  const start = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(start) || start < 0) throw new Error(`Bad page cursor: ${cursor}`);
  const end = start + pageSize;
  return {
    items: all.slice(start, end),
    nextCursor: end < all.length ? String(end) : undefined,
    total: all.length,
  };
}

/** Load a file once and reuse it for every later call. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => {
    promise ??= load().catch((error) => {
      promise = undefined; // let a later call try again
      throw error;
    });
    return promise;
  };
}
