# Pipeline eval results (19-23 Nov 2026)

**What this is:** the whole scan the app runs (sync, detect, retrieve, extract, verify, judge, draft, plan the
route) scored end to end against `seed/eval/ground_truth.json`. Unlike the spike (`SPIKE.md`), nothing is handed
the right evidence or figures: the agent has to find them.

## Final status (23 Nov)

| Measure | Result |
| --- | --- |
| **All nine fully live runs**, same prompts | 72/72 leaks with the right kind, amount, deadline and citations; 0/18 decoys; drafts 70/72; best route 66/72; 103-295 s per scan |
| **Latest three** (`main` at `4892009`, 23 Nov) | 24/24 leaks; 0/6 decoys; drafts 23/24; best route 19/24; 116-139 s per scan |
| **Three before those** (`main` at `5aca746`) | 24/24 leaks; 0/6 decoys; drafts 24/24; best route 24/24; 103-155 s per scan |
| **First three** | 24/24 leaks; 0/6 decoys; drafts 23/24; best route 23/24; 129-295 s per scan |
| **Saved answers on the final code** | 8/8 leaks, 0/2 decoys, drafts 8/8, routes 8/8 |
| Detect | 8/8 leaks reach a candidate |
| Retrieve | 82/82 expected evidence items, 5 extras |
| Extract | 12/12 key facts |
| Verify | 44/44 expected figures |
| Rewrites | Firmer 8/8, Shorter 6/8 |

No prompt or seed data changed across these nine runs. PR #36 made the draft claim check stricter after the first three, and
later commits changed the UI, the window, the docs and one demo switch in the fake calendar connector. Finding leaks and
leaving decoys alone held in every run. Choosing the best route varied most. These are small samples, on a seed the rules
were written against.
The sections below are in date order, so earlier sections show the seven-leak build and the failures that shaped it.

## How to run

Scripts may read `seed/eval/`; the app never does.

```bash
node --env-file=.env scripts/eval.ts --verbose                          # saved replies where available
node --env-file=.env scripts/eval.ts --fresh-judge --repeat 3 --verbose # judge called fresh each run
node --env-file=.env scripts/eval.ts --fresh-draft --repeat 3 --verbose # drafting called fresh each run
node --env-file=.env scripts/eval.ts --live                             # every model call fresh
```

`--live` overwrites the saved answers in `.cache/llm`, so back them up first. Without `--live`, a run with a key still
calls the endpoint for any request that has no saved answer.

Stage checks (each runs in seconds): `connectors-check.ts` (33), `detectors-check.ts` (8/8), `retrieval-check.ts`
(82/82), `extract-check.ts` (12/12), `verify-check.ts` (44/44), `claim-check.ts` (18), `rules-check.ts` (64),
`rewrites-check.ts` (16 rewrites), `replay-check.ts` and `saved-answers-check.ts`. `llm-check.ts` calls the live models.

**What is scored, per planted leak:** flagged at all; the right kind; a headline amount equal to one of the
expected amounts (to the cent, or within the stated tolerance: ±$15 for the meter); the deadline equal to an
expected date (or none when none is expected); and at least one cited id in the expected evidence. **Per
decoy:** not flagged. Plus any other false alarm.

**Per draft:** it passes the code claim check (every amount, date, reference, kWh value, count and percentage
is found in the verified figures or the evidence the drafter was given, and no internal ids); it signs off
"Thanks, Maya"; and it mentions the facts a reader needs (e.g. L5: KP-20418, both receipt numbers, $385.00).
Each run also saves every draft through the email connector and discards them again (approve, then undo);
the connector has no send operation.

## First results, seven leaks (19-20 Nov)

Extraction from saved replies, judge called fresh each run (temperature 0.1), 3 runs each.

| | Before the fix | After the fix |
| --- | --- | --- |
| Leaks flagged | 20/21 (missed L1 once) | **21/21** |
| Right kind / amount / deadline / cites evidence | 20/21 each | **21/21 each** |
| Decoys flagged (D1 CPI rise, D2 two school payments) | **0/6** | **0/6** |
| Other false alarms | 0 | 0 |
| Scan time (extraction cached, 9 cases judged 6 at a time) | 84-112 s | 40-82 s |

### Drafting (20 Nov)

Extraction and judge from saved replies, drafting called fresh each run (Flash, thinking off, temperature 0.2;
on a failed claim check the 35B, thinking off, rewrites it once). Each row is the code after that change, in
the order they were made. Stricter checks made the score drop before the fix that followed.

| Change | Runs | Fully correct | Pass claim check | 35B rewrites (fixed) |
| --- | --- | --- | --- | --- |
| First version | 1 | 6/7 (L4 left out the price) | 7/7 | 0 |
| No-reply filter, attachment rule, "quote key amounts" | 3 | 18/21 | 18/21 (L7 x3: checker bug) | 4 (1) |
| Fix the checker for "$0.285" | 3 | 21/21 | 21/21 | 3 (3) |
| Per-kind guidance (L2 reasoning) | 3 | 21/21 | 21/21 | 1 (1) |
| Attachments must be real files | 3 | 18/21 | 18/21 | 4 (1) |
| "No files to attach" prompt, code fixes the sign-off | 3 | 20/21 | 20/21 | 2 (1) |
| **Final: verify works out "paid after last use"** | **3** | **21/21** | **21/21** | **0** |

Flash took 3.0-6.6 s per draft in the final runs (35B rewrites 4.4-8.6 s when needed).

The scan's other scores were unchanged in every run: 21/21 leaks with the right kind, amount, deadline and
citations, 0/6 decoys, 0 false alarms. Each case is drafted as soon as it is judged: the finding shows straight
away and its draft follows about 5 s later, while other cases are still being judged.

Stage by stage at that point, with seven leaks (deterministic stages run every time; model stages from the extract run):

| Stage | Who | Result | Time |
| --- | --- | --- | --- |
| Detect candidates | code | 9 candidates: 7/7 leaks + both decoys, 0 others | ~50 ms |
| Retrieve evidence | code | 76/76 expected evidence items, 5 extras (all relevant) | ~9 ms |
| Extract facts | 9B, thinking off | 55 sources, 0 failures, 0 escalations; 12/12 key facts | 21 s live (median 2.5 s per source, 8 at a time) |
| Verify figures | code | 37/37 expected figures | ~7 ms |
| Judge | 35B, thinking on | see above | 14-100 s per case |
| Draft | Flash, thinking off (35B fallback) | 21/21 grounded and complete | 3-7 s per draft, run alongside judging |

## What went wrong, and what the design does about it

These are real failures seen while building.

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

5. **Drafters still do sums (L4).** Asked to request a refund of "the 2 charges after it was last used", both
   Flash and the 35B wrote "$29.98" (2 x $14.99) themselves (Flash in 6 of 15 runs), despite being told never to
   calculate. The sum was right, but it wasn't a checked figure, so the claim check rejected it; when the 35B
   rewrite did the same (once), the draft was kept and marked "check before sending".
   *Response:* the claim check caught every one. The real fix was upstream: verify now works out "paid after
   it was last used" ($29.98) itself, so the number the drafter wants is a checked one. After that, 0 rewrites.

6. **Right facts, wrong reasoning (L2).** Every StreamBox draft passed the claim check, but early ones asked
   StreamBox (or Apple's no-reply address) to "cancel the subscription in my Apple settings" and called it "a
   billing error on your end". Only Maya can cancel an App Store subscription, and nobody made an error. A claim
   check verifies facts, not logic.
   *Response:* no-reply addresses are only offered as a recipient when nothing else exists; the prompt carries
   short per-kind guidance (for a platform-billed duplicate: "we are cancelling that copy ourselves; please
   refund the duplicates or say how to claim them"); and the draft is always shown to Maya before anything is
   saved. A reasoning check by a second model is a possible next step.

7. **Promising attachments that aren't there.** Drafts said "I have attached the receipts" when the case had no
   files (receipts are emails), and the model filled the attach list with made-up names.
   *Response:* code accepts only real files from the evidence. A draft that mentions an attachment but has none
   fails the check, and when a case has no files the prompt says so outright.

8. **The claim check had a bug of its own.** It read "$0.285 per kWh" as "$0.28" and failed every L7 draft
   (3/3) for a number the model had copied correctly. Fixed: amounts with more than two decimals are checked as
   plain numbers. It is a reminder that a strict checker needs its own tests: a false alarm costs a rewrite
   (about 5 s), a missed invention costs trust.

9. **Sign-off drift.** Both models sometimes wrote "Thanks,\nMaya" or left the sign-off out (about 1 draft in
   10 across the runs, each one costing a rewrite). That is a preference, not a claim, so code now fixes it instead of asking for a rewrite.

10. **Embeddings were not needed on this data.** Exact links (sender, attachment, references, amount near
   the charge date, household mail by kind of business, same folder) found 76/76 evidence items at this point
   and 82/82 with all eight leaks, so the scan makes no embedding calls. On real mail, where names don't line up, embeddings are the fallback.

## Fix routes (21 Nov)

Each finding now gets a recommended way to fix it (email, call, chat or online steps), from a bundled help directory.
Code narrows the options, Flash picks among them and writes the call script and chat opener, and code checks the words.

- **On saved answers:** 7/7 best route, 7/7 pass the check, 7/7 have their scripts. The earlier results are unchanged.
- **Three fully live runs (`--live --repeat 3`):** recall 21/21, decoys 0/6, kind 21/21, citations 21/21, **amount 17/21, deadline
  20/21, drafts 17/21, routes 18/21**. Routes were right on all 18 findings that had a draft. The other 3 had no draft because the
  judge gave no action. The amount misses came from fresh extraction: Redgum had no figures once and **$2.00 at high confidence**
  once. Results elsewhere in this file reuse saved extraction, so they are not a measure of a fully live check.
- **What the check caught while building:** an invented $200.00, household email addresses, a blank `[Account Number]`, and a chat
  asking StreamBox to cancel a subscription only Apple can cancel. Reading the scripts also found a veiled threat and a made-up
  "my husband", which the prompt now rules out; those two can't be caught by a pattern, so they still rely on reading the output.

## Fully live reliability (22 Nov)

Saved answers hid a real weakness: the 9B doesn't read a document the same way every time. No prompt changed in this fix, so
saved answers still match.

- **Redgum, $2.00 at high confidence:** the 9B returned the October bill's meter table in only 3 of 12 identical calls. Without it,
  verify fell back to the July bill and worked out $2.00 instead of $174.14, with no warning. Over 5 live extractions Redgum was
  right once, $2.00 three times and had no figures once.
  *Response:* verify uses only the bill flagged as estimated and finds its readings by their sums, not their labels. If the bill
  doesn't add up, it shows no overcharge, says so, and confidence can't be high. A bill missing its readings goes up the retry
  path to the 35B, which returned the table in 12 of 12 calls.
- **IronWorks, no figures:** one run labelled the renewal "charge date", which verify's label match missed.
  *Response:* if nothing gives a future date, code rolls the agreement's yearly date forward.
- **Skylink, no draft:** the judge called it a problem but chose action `none`.
  *Response:* code picks the action from the kind of problem. A case the judge cleared against the facts stays a low-confidence
  "Check" with no draft.

| Five fully live runs after the fix (`--live --repeat 5`) | Result |
| --- | --- |
| Leaks flagged, right kind, cites evidence | 35/35 each |
| Decoys flagged, other false alarms | 0/10, 0 |
| **Amount / deadline** (before: 17/21, 20/21) | **35/35 / 35/35** |
| Wrong amount at any confidence | **0** |
| Drafts fully correct (before: 17/21) / pass the claim check | 33/35 / 35/35 |
| Best route | 34/35 |
| Time per scan | 106-136 s |

The three misses: one Skylink draft said "24-month term" where the scorer looks for "24 months", one BrightPage draft gave totals but
not the $14.99 price, and one Skylink route picked chat over the expected route. Five runs is a small sample, so read these as much
better, not as proof it can't fail.

## The warranty case, all eight leaks (22 Nov)

L8 adds a paid repair booked for a washing machine still under warranty. It has no bank rows, and it needs two businesses: the claim
goes to Norvik, and the booking is cancelled with Spinwell. Code links them through the serial number both quote, and reads the
warranty dates, price and cancel time straight from the source text. Existing seed records and prompts did not change, and a replay of
the earlier seven findings had zero misses.

Three fully live runs (`eval.ts --live --repeat 3`), every model call fresh:

| | Result |
| --- | --- |
| Leaks flagged, right kind, amount, deadline, cites evidence | 24/24 each |
| Decoys flagged, other false alarms | 0/6, 0 |
| Drafts fully correct / pass the claim check | 23/24 / 24/24 |
| Best route / pass the check / have their scripts | 23/24 / 24/24 / 24/24 |
| L8 alone: found, draft and route all correct | 3/3 |
| Time per scan | 129-295 s |

The two misses were both in earlier cases: one Wattle draft left out the quote's 4 December end date, and one Redgum route chose Email
over the meter-read form. The 295 s run was the first of the three, and the other two took about 130 s. Three runs is a small sample.

## Final live check on the submitted code (22 Nov)

PR #36 made the draft claim check stricter about years after the runs above, so the whole eval was run again on `main` at `5aca746`.
It ran from a clean copy of the committed code, so the saved answers in `.cache/llm` were not touched.

Three fully live runs (`eval.ts --live --repeat 3`), every model call fresh:

| | Result |
| --- | --- |
| Leaks flagged, right kind, amount, deadline, cites evidence | 24/24 each |
| Decoys flagged, other false alarms | 0/6, 0 |
| Drafts fully correct / pass the claim check / needed the 35B rewrite | 24/24 / 24/24 / 0 |
| Best route / pass the check / have their scripts | 24/24 / 24/24 / 24/24 |
| Time per scan | 103-155 s |

These three runs had no misses, but the three before them, with the same prompts, missed one Wattle draft and one Redgum route, so
those mistakes can still happen. Three runs is a small sample. The drafts were scored by the eval's checks and not read by hand.

## Final live check on the merged code (23 Nov)

The eval ran again on `main` at `4892009`, from a clean clone with its own cache, so the saved answers in `.cache/llm` were not touched.
Three fully live runs (`eval.ts --live --repeat 3`), every model call fresh:

| | Result |
| --- | --- |
| Leaks flagged, right kind, amount, deadline, cites evidence | 24/24 each |
| Decoys flagged, other false alarms | 0/6, 0 |
| Drafts fully correct / pass the claim check / needed the 35B rewrite | 23/24 / 23/24 / 0 |
| Best route / pass the check / have their scripts | 19/24 / 23/24 / 23/24 |
| Time per scan | 116-139 s |

The misses:

- **Redgum, 3 of 3 runs:** chose Email over the expected meter-read form. Email is a listed route that accepts the photo, but the form is
  the scored best route.
- **Skylink, 1 run:** chose a call over the expected Email route.
- **Norvik, 1 run:** the case was found with the right kind, amount, deadline and citations, but had no draft and no routes.

Across all nine live runs with these prompts: leaks 72/72, decoys 0/18, drafts 70/72, best route 66/72, at 103-295 s per scan. The
agent is steadier at finding a problem than at choosing how to fix it, which is why every route is shown and the person chooses.

## Firmer and Shorter rewrites (22 Nov)

Firmer and Shorter rewrite an email draft without a chat box. Code re-checks every rewrite against the evidence and the original
draft, so it can't add a figure, reference, date, apology, threat or made-up feeling, or lose the key facts and the ask.

| Saved rewrites | Result |
| --- | --- |
| Firmer | 8/8 pass |
| Shorter | 6/8 pass |

BrightPage's and Norvik's Shorter have no passing version, so the app says so and keeps the original draft. **Warmer was built and
cut:** its first pass cleared the checks 8/8 but invented feelings, such as "enjoyed being part of the community" in an email cancelling
that gym. Reading the output mattered more than the pass rate.

## Caveats

- The detectors' keyword rules and verify's label matching were written while looking at this seed. They are
  general (no merchant names), but a broader test set would be needed before trusting them on real mail.
- Apart from a bill's meter readings and the warranty case, verify still finds facts by the labels the 9B gave them (e.g. "Promotional period
  duration"). Labels vary between runs; a production version would fix them in the extraction schema.
- Results above reuse saved extraction replies unless they say fully live.
- The draft "key facts" list (`MUST` in `scripts/eval.ts`) is short and hand-picked from the spike. It checks a
  draft says what matters, not that it is well written; that was judged by reading the drafts (all 21 final
  drafts read as plain, polite and specific; one says "we have now cancelled" for something Maya has yet to do).
- The fallback path (35B rewrite) ran 14 times across the earlier runs: it fixed 7; the other 7 (3 caused by
  the checker bug) were kept but marked "check before sending". It was not needed in the final runs.
