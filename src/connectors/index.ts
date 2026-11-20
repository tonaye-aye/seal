// One place to build all four connectors over a seed source, and to sync them
// (stage 0 of the agent pipeline). Each connector syncs on its own and reports
// its state as it goes, so one broken connection never blocks the others.

import { now } from "../lib/clock.ts";
import { addDays, localDate, toZonedIso } from "../lib/dates.ts";
import { createBankConnector, type BankConnector } from "./bank.ts";
import { createCalendarConnector, type CalendarConnector } from "./calendar.ts";
import { createDocumentConnector, type DocumentConnector } from "./documents.ts";
import { createEmailConnector, type EmailConnector } from "./email.ts";
import {
  ConnectorError,
  loadManifest,
  realSleep,
  Scenarios,
  type ConnectorRuntime,
  type ScenarioId,
} from "./runtime.ts";
import type { SeedSource } from "./source.ts";
import type {
  Account,
  CalendarInstance,
  ConnectorId,
  DocumentMeta,
  EmailSummary,
  Page,
  Transaction,
} from "./types.ts";

export type Connectors = {
  runtime: ConnectorRuntime;
  bank: BankConnector;
  email: EmailConnector;
  documents: DocumentConnector;
  calendar: CalendarConnector;
};

export async function createConnectors(options: {
  source: SeedSource;
  scenarios?: ScenarioId[] | Scenarios;
  latencyScale?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<Connectors> {
  const scenarios =
    options.scenarios instanceof Scenarios ? options.scenarios : new Scenarios(options.scenarios);
  const runtime: ConnectorRuntime = {
    source: options.source,
    manifest: await loadManifest(options.source),
    scenarios,
    latencyScale: options.latencyScale ?? 1,
    random: options.random ?? Math.random,
    sleep: options.sleep ?? realSleep,
  };
  return {
    runtime,
    bank: createBankConnector(runtime),
    email: createEmailConnector(runtime),
    documents: createDocumentConnector(runtime),
    calendar: createCalendarConnector(runtime),
  };
}

// ---------- Sync ----------

export type ConnectorState =
  | "connecting" // first call in flight
  | "syncing" // reading pages
  | "retrying" // waiting out a rate limit
  | "ok"
  | "needs_reconnect" // token expired: Maya has to act
  | "error";

export type ConnectorStatus = {
  id: ConnectorId;
  name: string;
  state: ConnectorState;
  lastSyncedAt: string;
  /** Short progress or error text, e.g. "Read 50 of 134 transactions". */
  detail?: string;
  /** When the next retry happens (for a "Retrying in 3s" countdown). */
  retryAt?: number;
  /** How many items the last successful sync read. */
  count?: number;
};

export type SyncSnapshot = {
  accounts?: Account[];
  transactions?: Transaction[];
  messages?: EmailSummary[];
  documents?: DocumentMeta[];
  events?: CalendarInstance[];
  /** Connectors that failed, so the agent can say what it could not check. */
  failed: Partial<Record<ConnectorId, ConnectorError>>;
};

/** How far back and ahead the calendar is read, in days from today. */
const CALENDAR_WINDOW = { back: 120, ahead: 90 };
const MAX_RETRIES = 3;

/** Reads every page of a paged list, retrying when rate limited. */
async function readAllPages<T>(
  connectors: Connectors,
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  report: (status: Partial<ConnectorStatus>) => void,
  noun: string,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  let retries = 0;
  do {
    try {
      const page = await fetchPage(cursor);
      items.push(...page.items);
      cursor = page.nextCursor;
      retries = 0;
      report({ state: "syncing", detail: `Read ${items.length} of ${page.total} ${noun}`, retryAt: undefined });
    } catch (error) {
      const limited = error instanceof ConnectorError && error.code === "rate_limited";
      if (!limited || retries >= MAX_RETRIES) throw error;
      retries += 1;
      const waitMs = (error.retryAfterSeconds ?? 1) * 1000 * connectors.runtime.latencyScale;
      report({ state: "retrying", detail: "Bank asked us to slow down", retryAt: Date.now() + waitMs });
      await connectors.runtime.sleep(waitMs);
    }
  } while (cursor !== undefined);
  return items;
}

/**
 * Syncs all four connectors in parallel. `onStatus` fires on every state
 * change. Resolves with whatever was read, plus the connectors that failed.
 */
export async function syncAll(
  connectors: Connectors,
  onStatus: (status: ConnectorStatus) => void = () => {},
): Promise<SyncSnapshot> {
  return syncSome(connectors, ["bank", "email", "documents", "calendar"], onStatus);
}

/**
 * Syncs one connector on its own, exactly as syncAll would. Used when Maya
 * connects her sources one at a time on first run.
 */
export async function syncOne(
  connectors: Connectors,
  id: ConnectorId,
  onStatus: (status: ConnectorStatus) => void = () => {},
): Promise<SyncSnapshot> {
  return syncSome(connectors, [id], onStatus);
}

/** Syncs just the given connectors, the way syncAll does (used when only some are connected). */
export async function syncSome(
  connectors: Connectors,
  ids: ConnectorId[],
  onStatus: (status: ConnectorStatus) => void = () => {},
): Promise<SyncSnapshot> {
  const snapshot: SyncSnapshot = { failed: {} };
  const today = localDate(now());

  async function run(id: ConnectorId, work: (report: (s: Partial<ConnectorStatus>) => void) => Promise<number>) {
    // Only the connectors asked for are read.
    if (!ids.includes(id)) return;
    const entry = connectors.runtime.manifest.connectors.find((c) => c.id === id)!;
    let status: ConnectorStatus = { id, name: entry.name, state: "connecting", lastSyncedAt: entry.lastSyncedAt };
    const report = (change: Partial<ConnectorStatus>) => {
      status = { ...status, ...change };
      onStatus(status);
    };
    report({});
    try {
      const count = await work(report);
      report({ state: "ok", detail: undefined, retryAt: undefined, count, lastSyncedAt: toZonedIso(now()) });
    } catch (error) {
      const failure =
        error instanceof ConnectorError
          ? error
          : new ConnectorError({ connector: id, code: "unavailable", status: 500, message: String(error) });
      snapshot.failed[id] = failure;
      report({
        state: failure.code === "unauthorized" ? "needs_reconnect" : "error",
        detail: failure.message,
        retryAt: undefined,
      });
    }
  }

  await Promise.all([
    run("bank", async (report) => {
      const accounts = await connectors.bank.listAccounts();
      snapshot.accounts = accounts;
      // One account at a time, as open-banking APIs page per account.
      const transactions: Transaction[] = [];
      for (const account of accounts) {
        const rows = await readAllPages(
          connectors,
          (cursor) => connectors.bank.listTransactions({ accountId: account.id, cursor }),
          (s) => report({ ...s, detail: s.detail && `${account.name}: ${s.detail}` }),
          "transactions",
        );
        transactions.push(...rows);
      }
      snapshot.transactions = transactions.sort(
        (x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id),
      );
      return transactions.length;
    }),
    run("email", async (report) => {
      snapshot.messages = await readAllPages(
        connectors,
        (cursor) => connectors.email.search({ cursor }),
        report,
        "emails",
      );
      return snapshot.messages.length;
    }),
    run("documents", async (report) => {
      snapshot.documents = await readAllPages(
        connectors,
        (cursor) => connectors.documents.list(cursor),
        report,
        "documents",
      );
      return snapshot.documents.length;
    }),
    run("calendar", async (report) => {
      report({ state: "syncing", detail: "Reading events" });
      snapshot.events = await connectors.calendar.listEvents({
        from: addDays(today, -CALENDAR_WINDOW.back),
        to: addDays(today, CALENDAR_WINDOW.ahead),
      });
      return snapshot.events.length;
    }),
  ]);

  return snapshot;
}

export { ConnectorError, Scenarios };
export type { ScenarioId };
export type * from "./types.ts";
