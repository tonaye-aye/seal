// Fake bank feed (read-only), served from the CSV statements in seed/bank/.
// Behaves like an open-banking API: paged transactions, network delay, and an
// optional rate limit (every 4th transactions call is refused for 3 seconds).

import { parseCents } from "../lib/money.ts";
import {
  ConnectorError,
  manifestEntry,
  networkDelay,
  once,
  paginate,
  type ConnectorRuntime,
} from "./runtime.ts";
import type { Account, Page, Transaction } from "./types.ts";

export type TransactionQuery = {
  accountId?: string;
  /** Inclusive "YYYY-MM-DD" bounds. */
  from?: string;
  to?: string;
  cursor?: string;
};

export interface BankConnector {
  listAccounts(): Promise<Account[]>;
  listTransactions(query?: TransactionQuery): Promise<Page<Transaction>>;
}

type RawAccount = {
  id: string;
  code: string;
  name: string;
  type: Account["type"];
  currency: "AUD";
  owners: string[];
  statementFile: string;
  currentBalance: number;
  currentBalanceDate: string;
  creditLimit?: number;
};

/** Splits one CSV line, allowing for quoted fields that contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      out.push(field);
      field = "";
    } else field += char;
  }
  out.push(field);
  return out;
}

function parseStatement(csv: string, accountId: string): Transaction[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const columns = splitCsvLine(header);
  const col = (name: string) => {
    const index = columns.indexOf(name);
    if (index < 0) throw new Error(`Statement is missing the "${name}" column.`);
    return index;
  };
  const [id, date, description, debit, credit, balance] = [
    "TransactionId",
    "Date",
    "Description",
    "Debit",
    "Credit",
    "Balance",
  ].map(col);

  return lines.map((line) => {
    const f = splitCsvLine(line);
    const out = parseCents(f[debit]) ?? 0;
    const into = parseCents(f[credit]) ?? 0;
    return {
      id: f[id],
      accountId,
      date: f[date],
      description: f[description],
      amountCents: into - out,
      balanceCents: parseCents(f[balance]) ?? 0,
    };
  });
}

export function createBankConnector(runtime: ConnectorRuntime): BankConnector {
  const pageSize = manifestEntry(runtime, "bank").pageSize ?? 50;
  let transactionCalls = 0;

  const load = once(async () => {
    const file = JSON.parse(await runtime.source.readText("bank/accounts.json")) as {
      accounts: RawAccount[];
    };
    const accounts: Account[] = file.accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      currency: a.currency,
      owners: a.owners,
      currentBalanceCents: Math.round(a.currentBalance * 100),
      currentBalanceDate: a.currentBalanceDate,
      creditLimitCents: a.creditLimit === undefined ? undefined : Math.round(a.creditLimit * 100),
    }));
    const statements = await Promise.all(
      file.accounts.map(async (a) =>
        parseStatement(await runtime.source.readText(`bank/${a.statementFile}`), a.id),
      ),
    );
    // Oldest first across both accounts; ties keep statement order via the id.
    const transactions = statements
      .flat()
      .sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
    return { accounts, transactions };
  });

  return {
    async listAccounts() {
      await networkDelay(runtime, "bank");
      return (await load()).accounts;
    },

    async listTransactions(query = {}) {
      transactionCalls += 1;
      await networkDelay(runtime, "bank");
      if (runtime.scenarios.has("bank_rate_limit") && transactionCalls % 4 === 0) {
        throw new ConnectorError({
          connector: "bank",
          code: "rate_limited",
          status: 429,
          message: "Too many requests. Try again in 3 seconds.",
          retryAfterSeconds: 3,
        });
      }
      const { transactions } = await load();
      const matching = transactions.filter(
        (t) =>
          (!query.accountId || t.accountId === query.accountId) &&
          (!query.from || t.date >= query.from) &&
          (!query.to || t.date <= query.to),
      );
      return paginate(matching, pageSize, query.cursor);
    },
  };
}
