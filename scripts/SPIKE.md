# Model spike results (19 Nov 2026)

**What this is:** a test of the models before building on them. Each model is handed the *correct evidence*
for the 7 planted leaks and 2 decoys and scored against `seed/eval/ground_truth.json`. It measures
reading, judging and writing, **not retrieval** (that is the agent's job, scored later by the end-to-end
eval). `scripts/probe.ts` tests what the endpoint supports; `scripts/spike.ts` tests quality.

**How to run:** `node --env-file=.env scripts/probe.ts` and
`node --env-file=.env scripts/spike.ts --tasks detect,draft,vision,pipeline --draft-models 9b,35b-n,flash-n --repeat 3`.
Quality numbers below are **totals over 3 runs** (temperature 0.1) unless marked "1 run". Raw history:
`scripts/spike-out/*.jsonl` (gitignored).

## Endpoint capabilities (probe.ts)

| Capability | Result |
| --- | --- |
| Thinking on/off | `reasoning: {enabled: false}` turns it off on all three chat models (~0.7-0.8 s small calls). **The 9B thinks by default** and can burn its whole budget, returning `content: null`. `reasoning_effort` and `/no_think` are unreliable. |
| Structured output | `json_schema` strict works and conforms on all three, including `pattern` constraints. `json_object` returns JSON but not the requested shape; **Flash rejects it (HTTP 400)**. |
| Streaming | SSE with separate `reasoning` and `content` deltas; usage in the final chunk. First chunk 0.5-1.5 s. |
| Tool calling | Works on all three. 35B: 3 sensible parallel calls, then the right answer (StreamBox). 9B: 1 call, didn't get there. Flash: kept calling. |
| Embeddings | 2560 dims; 32 emails in ~2.7 s. Right email ranked first (0.71) but a near-duplicate close behind (0.65), so pair with keyword/amount/date matching. |
| Concurrency | 12 parallel 9B / 6 parallel 35B: all succeeded, no rate limiting seen. |

## Quality (3 runs)

| Task | 9B, no think | 35B, no think | 35B, thinking | Flash, no think |
| --- | --- | --- | --- | --- |
| **Judge**: leaks flagged / decoys wrongly flagged | 14/21, 0/6, 2.2 s | 18/21, 0/6, 3.0 s (misses L1 every run) | **20/21, 0/6, 30 s** (missed L1 once) | n/a |
| **Pipeline**: 9B facts then 35B judge | | | **26/27**, 35 s (missed L1 once) | |
| **Extract** (9B): invented amounts / refs | **0/216, 0/69**, 3.0 s per source | | | |
| **Vision**: meter photo reads 47,006 | **3/3**, 3.7 s | 3/3, 1.5 s | 3/3, 5.6 s | (thinking: 3/3, 4.1 s) |
| **Draft** (code figures, id-free evidence): fully correct / claim check clean | 14/21, 19/21, 3.7 s | 20/21, 20/21, 4.3 s | 1 run: 7/7, 44 s | **21/21, 21/21, 4.9 s** |

1-run results not repeated because they were already ruled out on speed: Flash *thinking* drafts 6/7 at
68 s (up to 205 s); drafting without code-computed figures failed on 3-4 of 7 for every fast model.

## What the failures teach (use these in the report)

- **L1 is the hard case.** "Price rose after 12 months but the agreement says 24" needs the judge to connect
  a contract term to a date. Without thinking the 35B never gets it; with thinking it still missed 1 in 21.
  **Design response:** compute it in code. The verify stage gives the judge "agreement promises $79.00 for
  24 months from 14 October 2025; $99.00 charged from 14 October 2026 (month 13)", the way drafters get
  figures. Retest L1 when the real pipeline exists.
- **Models do sums, and get them wrong.** Without figures, drafters wrote their own totals; most were right
  ($20.00 = $99 − $79) but the 9B claimed "1,534 kWh" used (correct is ~1,077). **Response:** code computes
  every figure; the drafter is told never to calculate; the claim check rejects any amount, date, reference
  or kWh value not in the evidence or figures.
- **The claim check catches what prompts don't.** With figures supplied, the 35B still once wrote
  "3 December 2026", a date nowhere in its evidence. Caught and would be regenerated.
- **Instructions don't stop id leaks; removing the ids does.** Told "never mention msg_/JE- ids", the 35B
  still copied them from evidence headers into a letter to Skylink. Drafters now get evidence labelled
  for humans (no internal ids, dates as "14 October 2025"); ids stay in the UI for citations.
- **Thinking costs a lot and doesn't help writing.** Thinking drafters took 44-68 s for no accuracy gain.
  Thinking is worth it only for judgment.
- **The 9B extracts faithfully but can't judge.** 0 invented amounts or references across 3 runs, but it
  flagged only 14/21 leaks. Its remaining "invented dates" are relative dates it resolved ("the 28th" →
  2026-11-28): correct, but code must confirm them against the email date.

## Model assignments

| Step | Model | Measured reason |
| --- | --- | --- |
| Extraction (email/doc to facts) | **9B, thinking off, strict schema** | 0 invented amounts/refs over 3 runs at ~3 s; code checks every value against the source. |
| Vision (meter photo) | **9B, thinking off** (35B fallback) | 3/3 correct at ~3.7 s; it failed earlier only because thinking ate its budget. |
| Judgment (leak or not) | **35B, thinking on**, with code-computed facts | 20/21 with no false positives; without thinking it never gets L1. ~30 s each, run in parallel in the background scan. |
| Drafting | **Flash, thinking off**; claim check; on failure regenerate once with **35B, thinking off** | 3 runs: Flash 21/21 at ~4.9 s; 35B 20/21 at ~4.3 s (its miss was caught by the claim check). Half a second slower is invisible; one fewer failure is not. |
| Retrieval | Code (keyword + amount/date window) + embeddings; 35B tool calling optional | Embeddings rank well but not decisively. |
| Arithmetic, dates, verification, claim check | **Plain code** | Every arithmetic slip came from a model. |

**Main drafter: Flash** (decided by Tony after the 3-run results, replacing the earlier 35B-first plan).
Over 3 runs Flash was perfect (21/21) and only ~0.6 s slower than the 35B, whose single miss the claim
check caught. The 35B stays as the regenerate fallback.

## Done since the first run

- Strict `json_schema` everywhere, with an ISO `pattern` for extracted dates (date-format errors gone).
- Drafters get code figures and human-labelled, id-free evidence with human dates.
- Claim check covers amounts, day-month dates, month-year dates, references and kWh; allows today's date.
- `--repeat N` for variance; all quality numbers above are 3-run totals.
