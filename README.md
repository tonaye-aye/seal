# Life

A desktop agent for one household's monthly money check. It reads the household's bank statements, email,
documents and calendar, and finds charges that are wrong or unwanted: price rises that break a contract,
things paid twice, forgotten trials, renewal traps and a bill based on a bad meter estimate. For each one it
gathers the evidence and drafts the fix, and you approve it with one key. It isn't a chat window. You summon
it, triage what it found, then approve, snooze or dismiss each item. All model calls go to the Base Compute endpoint (Qwen models).

The household is fictional: Maya and Ben Whitlock and their two kids, renting in Brunswick, Melbourne. Their
data is in [`seed/`](seed/README.md).

## Prerequisites

- macOS (the only platform tested)
- [Node.js](https://nodejs.org) 22.18 or newer (the scripts run TypeScript directly; tested on Node 26)
- [pnpm](https://pnpm.io)
- [Rust](https://rustup.rs) (stable, via rustup)
- Xcode Command Line Tools: `xcode-select --install`

## Setup

1. Install the dependencies:

   ```bash
   pnpm install
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Fill in `BC_BASE_URL` and `BC_API_KEY` in `.env` with the endpoint and key from the take-home brief.
   `.env` is gitignored. Only the Rust side reads the key, and it never reaches the web view.

## Run

```bash
pnpm tauri dev
```

The first build compiles the Rust side and takes a few minutes. Later starts are quick.

The first launch opens a short setup: a welcome screen, then you connect the household's four sources and the
first check runs. After that, the app sits in the menu bar.
Press **⌥Space** to bring it up (or **⌘⇧Space** if ⌥Space is taken). The app's clock is fixed at
**Thu 19 Nov 2026, 9:30am Melbourne**, so the dates line up with the seed data.

| Key | Does |
| --- | --- |
| `J` / `K` | Next / previous finding |
| `↵` | Open the evidence and the draft |
| `A` | Approve: save the draft to Drafts (nothing is sent) |
| `E` / `S` / `D` | Edit the draft / Snooze / Not a leak |
| `⌘Z` | Undo |
| `⌘↵` | Timeline: what's coming |
| `/` | Search |
| `T` | Show what the agent did (the trace) |
| `R` | Check again |
| `?` | All shortcuts |
| `Esc` | Back, then close |

Every row and button shows its key, and everything works with the mouse too.

## Seed data

The connectors are fake, but they behave like real ones. They load from [`seed/`](seed/README.md) and have
realistic latency, paging and errors. The data covers:

- three months of bank history across two accounts (134 transactions with messy descriptors)
- 75 emails
- nine PDFs and a photo of an electricity meter
- a family calendar

| Folder | What's in it |
| --- | --- |
| `seed/bank/` | Two account statements (CSV) and account details |
| `seed/email/` | Maya's mailbox and the shared household address |
| `seed/documents/` | PDFs, the meter photo, an index and the text pulled from each document |
| `seed/calendar/` | Family, Maya and Ben calendars, some recurring |
| `seed/connectors/manifest.json` | Connection state, latency, paging and opt-in failure scenarios |
| `seed/persona.json` | The household and the agent's standing preferences (tone, sign-off, never act without approval) |
| `seed/eval/` | Ground truth for scoring. **Only the eval scripts read it.** The app never bundles or reads it. |

`python3 seed/verify.py` checks that the data adds up (balances, cross-references, arithmetic).
`python3 seed/generate.py` rebuilds it exactly (needs `reportlab` and `Pillow`).

## How it works

The models read, judge and write. Plain code does all the arithmetic, date maths and checking.

1. **Sync:** read the four connectors at once.
2. **Detect** *(code):* find suspicious charges, such as a changed price, the same amount paid twice, a
   charge after the last use, an unclear descriptor like `APPLE.COM/BILL`, an upcoming renewal or an
   estimated bill.
3. **Retrieve** *(code):* link each suspicious charge to its evidence by sender, reference, amount and date.
4. **Extract** *(Qwen3.5 9B, thinking off):* turn each email and document into facts, and read the meter photo.
   Code checks every value against the source text.
5. **Verify** *(code):* compare the facts with the bank rows and work out every figure: overcharges,
   deadlines, totals.
6. **Judge** *(Qwen3.6 35B, thinking on):* decide whether each case is a real leak, citing its evidence.
   Where the code's facts disagree with the verdict, the finding is kept at low confidence.
7. **Draft** *(Qwen3.8 Flash, thinking off):* write the fix. A claim check rejects any number, date or reference
   that isn't in the verified figures or the evidence. If a draft fails it, the 35B rewrites it once.

| Folder | What's there |
| --- | --- |
| `src/agent/` | The pipeline above (`pipeline.ts`, detectors, retrieval, extraction, verify, judge, drafting) |
| `src/connectors/` | The fake bank, email, documents and calendar connectors |
| `src/lib/` | The model client, money in integer cents, Melbourne dates, the fixed clock, the scan store |
| `src/ui/` | The palette, findings, evidence and draft, timeline, trace, onboarding, "now" mark |
| `src-tauri/` | The Rust side: window, hotkey, tray, and the model requests (the key lives here) |
| `scripts/` | The model spike, eval and stage checks |

## Results and evaluation

Scored end to end against `seed/eval/ground_truth.json`:

- **Leaks found:** 7/7, each with the right kind, amount, deadline and cited evidence.
- **Decoys flagged:** 0/2. A mobile price rise allowed by the contract and two school payments that look
  like duplicates are both correctly left alone.
- **Drafts:** 7/7 grounded and complete.

Over three runs the totals were 21/21 leaks, 0/6 decoys and 21/21 drafts.

- [`scripts/SPIKE.md`](scripts/SPIKE.md): what the endpoint supports and how each model did at each task,
  which decided who does what.
- [`scripts/EVAL.md`](scripts/EVAL.md): the end-to-end results, stage by stage, with every failure seen
  during the build and what the design does about it.

To run the eval and checks:

```bash
node --env-file=.env scripts/eval.ts --verbose
```

The eval reuses saved model answers when it has them. Add `--live` to call every model fresh.

Quicker checks, one per stage:

```bash
node scripts/connectors-check.ts
```

```bash
node scripts/detectors-check.ts
```

```bash
node scripts/replay-check.ts
```

There are also `retrieval-check.ts`, `extract-check.ts`, `verify-check.ts` and `llm-check.ts` in
[`scripts/`](scripts/).

## Demo controls

Press **⌘⇧D** in the app to open the demo controls. They're hidden from first-time users.

| Key | Does |
| --- | --- |
| `1` | The calendar asks you to sign in again |
| `2` | The bank rate-limits every 4th request |
| `3` | Documents load slowly |
| `4` | The model endpoint drops after 15 calls. The check is redone from saved answers, clearly labelled. |
| `M` | Use saved model answers only (replay mode) |
| `O` | Start onboarding again |
| `R` | Check now |

Launch options:

```bash
LIFE_REPLAY=1 pnpm tauri dev
```

```bash
LIFE_ONBOARDING=1 pnpm tauri dev
```

The first uses saved answers for the whole session. The second starts onboarding again.

In development, `http://localhost:1420/#/gallery` shows every component in every state: empty, scanning,
error, replay, undo and more.

## Limitations

- **The endpoint stands in for on-device models.** The household data the agent reads goes to it.
  Nothing else leaves the app.
- **Nothing is ever sent, cancelled or paid.** The email connector can only save drafts, and every action needs
  your approval and can be undone.
- **Replay needs one live check first.** Saved answers are kept in the app's cache folder, which starts empty on a
  fresh clone.
- **The detectors were written against this seed data.** They use no merchant names, but they need a broader
  test set before they could handle real mail.
- **macOS only**, one household, AUD only, fake connectors.

## Licences

- [Poppins](https://github.com/itfoundry/Poppins) by Indian Type Foundry (headings): SIL Open Font License 1.1,
  installed through `@fontsource/poppins`.
- [Nunito](https://github.com/googlefonts/nunito) by Vernon Adams (body and UI text): SIL Open Font License 1.1,
  installed through `@fontsource-variable/nunito`.
- [Geist Mono](https://github.com/vercel/geist-font) by Vercel (figures, dates and small labels): SIL Open Font
  License 1.1, installed through `@fontsource-variable/geist-mono`.
- [Lucide](https://lucide.dev) icons (`lucide-react`): ISC.
- [Radix Primitives](https://www.radix-ui.com/primitives) (`@radix-ui/react-tooltip`, `react-dropdown-menu`,
  `react-dialog`, `react-switch`, `react-accordion`) for tooltips, menus, sheets, switches and the "Checked and left
  alone" group, restyled from the app's own tokens: MIT.
- React, Vite, Tailwind CSS: MIT. Tauri: MIT or Apache-2.0.
- All seed data, people and brands are made up.
