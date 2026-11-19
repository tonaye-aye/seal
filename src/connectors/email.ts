// Fake mailbox: Maya's inbox plus the shared household address. The agent can
// search, read and save drafts. There is no send operation at all, so nothing
// can ever leave on Maya's behalf without her sending it herself.

import { now } from "../lib/clock.ts";
import { toZonedIso } from "../lib/dates.ts";
import {
  ConnectorError,
  manifestEntry,
  networkDelay,
  once,
  paginate,
  type ConnectorRuntime,
} from "./runtime.ts";
import type { Draft, DraftInput, EmailMessage, EmailSummary, Page } from "./types.ts";

export type EmailQuery = {
  /** Words that must all appear (any case) in the subject, body or sender. */
  text?: string;
  /** Part of the sender's name or address. */
  from?: string;
  /** Inclusive "YYYY-MM-DD" bounds on the date sent (Melbourne). */
  after?: string;
  before?: string;
  label?: string;
  unreadOnly?: boolean;
  cursor?: string;
};

export interface EmailConnector {
  /** Newest first. Results leave out the body; use getMessage for that. */
  search(query?: EmailQuery): Promise<Page<EmailSummary>>;
  getMessage(id: string): Promise<EmailMessage>;
  createDraft(input: DraftInput): Promise<Draft>;
  listDrafts(): Promise<Draft[]>;
  /** Removes a draft the agent saved (this is how "undo" works). */
  discardDraft(id: string): Promise<void>;
}

function summary({ body: _body, ...rest }: EmailMessage): EmailSummary {
  return rest;
}

export function createEmailConnector(runtime: ConnectorRuntime): EmailConnector {
  const pageSize = manifestEntry(runtime, "email").pageSize ?? 25;
  const drafts = new Map<string, Draft>();
  let draftCount = 0;

  const load = once(async () => {
    const file = JSON.parse(await runtime.source.readText("email/inbox.json")) as {
      messages: EmailMessage[];
    };
    return [...file.messages].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  });

  return {
    async search(query = {}) {
      await networkDelay(runtime, "email");
      const words = (query.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const from = query.from?.toLowerCase();
      const matching = (await load()).filter((m) => {
        const day = m.date.slice(0, 10); // seed dates are already Melbourne-local
        if (query.after && day < query.after) return false;
        if (query.before && day > query.before) return false;
        if (query.label && !m.labels.includes(query.label)) return false;
        if (query.unreadOnly && !m.unread) return false;
        const sender = `${m.from.name} ${m.from.address}`.toLowerCase();
        if (from && !sender.includes(from)) return false;
        if (words.length) {
          const haystack = `${m.subject}\n${m.body}\n${sender}`.toLowerCase();
          if (!words.every((w) => haystack.includes(w))) return false;
        }
        return true;
      });
      const page = paginate(matching, pageSize, query.cursor);
      return { ...page, items: page.items.map(summary) };
    },

    async getMessage(id) {
      await networkDelay(runtime, "email");
      const message = (await load()).find((m) => m.id === id);
      if (!message) {
        throw new ConnectorError({
          connector: "email",
          code: "not_found",
          status: 404,
          message: `No message with id ${id}.`,
        });
      }
      return message;
    },

    async createDraft(input) {
      await networkDelay(runtime, "email");
      draftCount += 1;
      const draft: Draft = {
        ...input,
        id: `draft_${String(draftCount).padStart(3, "0")}`,
        createdAt: toZonedIso(now()),
      };
      drafts.set(draft.id, draft);
      return draft;
    },

    async listDrafts() {
      await networkDelay(runtime, "email");
      return [...drafts.values()];
    },

    async discardDraft(id) {
      await networkDelay(runtime, "email");
      drafts.delete(id);
    },
  };
}
