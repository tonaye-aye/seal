// Everything the agent reads in one place: the synced lists plus the full
// email bodies and document text (which a sync leaves out). Fetching the
// bodies happens here, in parallel, once per scan.

import type { Connectors, SyncSnapshot } from "../connectors/index.ts";
import type {
  Account,
  CalendarInstance,
  DocumentMeta,
  EmailMessage,
  Transaction,
} from "../connectors/types.ts";

export type CorpusDocument = DocumentMeta & { text: string | null };

export type Corpus = {
  accounts: Account[];
  transactions: Transaction[];
  emails: EmailMessage[];
  documents: CorpusDocument[];
  events: CalendarInstance[];
  /** Sources that could not be read, so findings can say what wasn't checked. */
  missing: string[];
};

/** Runs `task` over `items`, at most `limit` at a time. */
export async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function buildCorpus(connectors: Connectors, snapshot: SyncSnapshot): Promise<Corpus> {
  const [emails, documents] = await Promise.all([
    mapLimited(snapshot.messages ?? [], 8, (m) => connectors.email.getMessage(m.id)),
    mapLimited(snapshot.documents ?? [], 4, async (d) => ({ ...d, text: await connectors.documents.readText(d.id) })),
  ]);
  return {
    accounts: snapshot.accounts ?? [],
    transactions: snapshot.transactions ?? [],
    emails,
    documents,
    events: snapshot.events ?? [],
    missing: Object.keys(snapshot.failed),
  };
}
