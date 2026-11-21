// Guards the year rule in the draft claim check, using the washing machine:
// bought on 6 December 2024, warranty ends on 6 December 2026. A draft that
// mixes those up into "6 December 2025" must be caught. No network.
//
//   node scripts/claim-check.ts

import { claimCheck } from "../src/agent/draft.ts";
import { dateIn } from "../src/agent/grounding.ts";

const TODAY = "2026-11-19";
const WASHER = "Purchase date: 6 December 2024\nWarranty ends: 6 December 2026";

type Case = { name: string; draft: string; evidence?: string; passes: boolean };

const cases: Case[] = [
  // Dates the evidence really supports.
  { name: "purchase date", draft: "Bought on 6 December 2024.", passes: true },
  { name: "warranty end", draft: "Covered until 6 December 2026.", passes: true },
  { name: "month first", draft: "Covered until December 6, 2026.", passes: true },
  { name: "short month and ordinal", draft: "Covered until 6th Dec 2026.", passes: true },
  { name: "month and year", draft: "Covered until December 2026.", passes: true },
  { name: "today", draft: "Written on 19 November 2026.", passes: true },
  { name: "numeric evidence", draft: "Covered until 6 December 2026.", evidence: "Ends 06/12/2026", passes: true },
  { name: "short September", draft: "Booked for 3 Sept 2026.", evidence: "Booked 3 September 2026", passes: true },

  // A date with no year behaves as it did before.
  { name: "no year", draft: "Covered until 6 December.", passes: true },
  { name: "no year, wrong day", draft: "Covered until 7 December.", passes: false },

  // The right day and month in a year the evidence doesn't have.
  { name: "washer, wrong year", draft: "Covered until 6 December 2025.", passes: false },
  { name: "wrong year, month first", draft: "Covered until December 6, 2025.", passes: false },
  { name: "wrong year, short month", draft: "Covered until 6th Dec 2025.", passes: false },
  { name: "wrong year, month and year", draft: "Covered until December 2025.", passes: false },
  { name: "year after the warranty", draft: "Covered until 6 December 2027.", passes: false },
  { name: "evidence has no year", draft: "Covered until 6 December 2026.", evidence: "Ends 6 December", passes: false },
  { name: "similar day", draft: "Covered until 6 December 2026.", evidence: "Ends 16 December 2026", passes: false },
];

let failed = 0;
for (const c of cases) {
  const problems = claimCheck(c.draft, c.evidence ?? WASHER, TODAY);
  const ok = (problems.length === 0) === c.passes;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${c.name}${ok ? "" : `: ${problems.join("; ") || "not flagged"}`}`);
}

// Extraction still relies on the looser check, where a day and month can match without a year.
const looseOk = dateIn("2025-12-06", WASHER);
if (!looseOk) failed++;
console.log(`${looseOk ? "ok  " : "FAIL"} dateIn still ignores the year for extraction`);

const total = cases.length + 1;
console.log(failed ? `${failed} of ${total} failed` : `All ${total} passed`);
process.exitCode = failed ? 1 : 0;
