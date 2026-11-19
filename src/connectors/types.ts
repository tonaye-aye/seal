// The shapes the four connectors hand to the agent and the UI. They mirror
// what a real bank feed, mailbox, synced folder and calendar API would return,
// so swapping a fake connector for a real one would not change the agent.

export type ConnectorId = "bank" | "email" | "documents" | "calendar";

/** One page of results plus a cursor for the next page (absent on the last). */
export type Page<T> = { items: T[]; nextCursor?: string; total: number };

// ---------- Bank ----------

export type Account = {
  id: string;
  code: string; // prefix of its transaction ids, e.g. "JE"
  name: string;
  type: "transaction" | "credit_card";
  currency: "AUD";
  owners: string[];
  /** Whole cents. On the credit card, negative means money owed. */
  currentBalanceCents: number;
  currentBalanceDate: string;
  creditLimitCents?: number;
};

export type Transaction = {
  id: string; // e.g. "MC-00002"
  accountId: string;
  date: string; // "YYYY-MM-DD", Melbourne
  /** Raw bank text, deliberately messy, e.g. "APPLE.COM/BILL SYDNEY AU". */
  description: string;
  /** Whole cents. Negative is money out, positive is money in. */
  amountCents: number;
  balanceCents: number;
};

// ---------- Email ----------

export type Mailbox = { name: string; address: string };

export type EmailAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** The same file in the documents folder, when it was saved there. */
  documentId?: string;
};

/** What a search returns: everything but the full body. */
export type EmailSummary = {
  id: string;
  threadId: string;
  date: string; // ISO with offset
  from: Mailbox;
  to: Mailbox[];
  subject: string;
  snippet: string;
  labels: string[]; // INBOX, SENT, PROMOTIONS
  unread: boolean;
  attachments: EmailAttachment[];
};

export type EmailMessage = EmailSummary & { body: string };

export type DraftInput = {
  to: Mailbox[];
  subject: string;
  body: string;
  /** The message this replies to, if any. */
  inReplyTo?: string;
  /** Documents to attach, by document id. */
  attachDocumentIds?: string[];
};

/** A saved draft. There is deliberately no "send": Maya sends it herself. */
export type Draft = DraftInput & { id: string; createdAt: string };

// ---------- Documents ----------

export type DocumentMeta = {
  id: string;
  path: string;
  folder: string;
  filename: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  modifiedAt: string;
  source: string;
  /** False for images: there is no text layer, so a vision model must read it. */
  hasText: boolean;
};

export type DocumentImage = { mimeType: string; base64: string };

// ---------- Calendar ----------

/** One occurrence of an event. Repeating events are expanded into many. */
export type CalendarInstance = {
  id: string; // "evt_012:2026-10-24" for repeats, the event id otherwise
  eventId: string;
  calendar: string;
  title: string;
  /** ISO with offset for timed events, "YYYY-MM-DD" for all-day ones. */
  start: string;
  end?: string;
  allDay: boolean;
  notes: string;
  location: string;
  createdBy: string;
  createdAt: string;
  recurring: boolean;
};

export type EventInput = {
  calendar: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  notes?: string;
};
