# Pipeline eval results (19 Nov 2026)

**What this is:** the whole scan the app runs (sync, detect, retrieve, extract, verify, judge) scored end to
end against `seed/eval/ground_truth.json`. Unlike the spike (`SPIKE.md`), nothing is handed the right
evidence: the agent has to find it. Drafting is not built yet and is not scored here.

**How to run** (scripts may read `seed/eval/`; the app never does):

```bash
node --env-file=.env scripts/eval.ts --verbose                          # saved replies where available
node --env-file=.env scripts/eval.ts --fresh-judge --repeat 3 --verbose # judge called fresh each run
node --env-file=.env scripts/eval.ts --live                             # every model call fresh
```

Stage checks (each runs in seconds): `connectors-check.ts` (33 checks), `detectors-check.ts`,
`retrieval-check.ts`, `extract-check.ts`, `verify-check.ts`, `llm-check.ts`.

**What is scored, per planted leak:** flagged at all; the right kind; a headline amount equal to one of the
expected amounts (to the cent, or within the stated tolerance: ±$15 for the meter); the deadline equal to an
expected date (or none when none is expected); and at least one cited id in the expected evidence. **Per
decoy:** not flagged. Plus any other false alarm.

## Results

Extraction from saved replies, judge called fresh each run (temperature 0.1), 3 runs each.

| | Before the fix | After the fix |
| --- | --- | --- |
| Leaks flagged | 20/21 (missed L1 once) | **21/21** |
| Right kind / amount / deadline / cites evidence | 20/21 each | **21/21 each** |
| Decoys flagged (D1 CPI rise, D2 two school payments) | **0/6** | **0/6** |
| Other false alarms | 0 | 0 |
| Scan time (extraction cached, 9 cases judged 6 at a time) | 84-112 s | 40-82 s |

Stage by stage (deterministic stages run every time; model stages from the extract run):

| Stage | Who | Result | Time |
| --- | --- | --- | --- |
| Detect candidates | code | 9 candidates: 7/7 leaks + both decoys, 0 others | ~50 ms |
| Retrieve evidence | code | 76/76 expected evidence items, 5 extras (all relevant) | ~9 ms |
| Extract facts | 9B, thinking off | 55 sources, 0 failures, 0 escalations; 12/12 key facts | 21 s live (median 2.5 s per source, 8 at a time) |
| Verify figures | code | 37/37 expected figures | ~7 ms |
| Judge | 35B, thinking on | see above | 14-100 s per case |

## What went wrong, and what the design does about it

These are real failures seen while building, for the report.

1. **The judge contradicted checked facts (L1).** In one run the 35B cleared Skylink's $79 to $99 rise as
   "aligns perfectly with your contract term", although the brief said the rise came in month 13 of a
   24-month fixed-price term. Same failure the spike saw.
   *Response:* verify now records hard, code-checked facts that point to a problem (rise inside a promised
   term, notice deadline passed, invoice paid twice, platform receipts naming a service already paid,
   charges after last use, a cheaper like-for-like quote, a meter reading below the estimate) or to "fine"
   (matches an announced change exactly, different payment references). If the judge's verdict goes against
   them, the model doesn't get the last word: the case is kept as "Check Skylink Internet", low confidence,
   with both sides shown. The note was also made blunter ("the rise came 12 months before the promised price
   was due to end"). After the change the judge got L1 right in 3/3 runs on its own, so the safety net was
   not triggered live; it is tested directly (a wrong "fine" verdict on L1 becomes a low-confidence finding,
   and both decoys still clear).

2. **The 9B inferred instead of copying.** Asked to copy values, it still worked some out: a trial end date
   (7 days after the start email), Ben's "before the 14th" turned into 14 Nov, a 10% drop from "15% to 5%",
   and once a "$0.00 free visit".
   *Response:* every extracted value is checked against its source text (`src/agent/grounding.ts`). Values
   not found there are marked ungrounded and never used; code computes the ones that matter.
   Grounded: amounts 75/77, dates 88/92, references 44/44, clauses 100/104.

3. **Models wrote internal ids and long answers despite instructions.** The judge's "why" listed ids like
   `(MC-00027, msg_0035)` and ran to four sentences; the spike saw the same in drafts.
   *Response:* code strips ids from anything the household reads and keeps the first sentence.

4. **The judge is slow.** 14-100 s per case with thinking on (the energy case, with the longest evidence
   list, is the slowest).
   *Response:* it runs in the background scan, 6 cases at a time, and each finding is shown as soon as its
   case is judged. Thinking off is ~3 s but missed L1 every run in the spike, so the trade is deliberate.

5. **Embeddings were not needed on this data.** Exact links (sender, attachment, references, amount near
   the charge date, household mail by kind of business, same folder) found 76/76 evidence items, so the
   scan makes no embedding calls. On real mail, where names don't line up, embeddings are the fallback.

## Caveats

- The detectors' keyword rules and verify's label matching were written while looking at this seed. They are
  general (no merchant names), but a broader test set would be needed before trusting them on real mail.
- Verify finds facts by the labels the 9B gave them (e.g. "Promotional period duration"). Labels vary between
  runs; a production version would fix them in the extraction schema.
- Results above reuse saved extraction replies. A full `--live` run re-extracts every source (~21 s more).
