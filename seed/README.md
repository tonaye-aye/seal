# Seed data: the Whitlock household

A fictional Melbourne household (Maya, Ben, Ollie 8, Pia 5) with three months of bank history, a year of
email, a synced documents folder and a family calendar. Everything is fictional; brand names are invented.

"Today" inside the app is **Thursday 19 November 2026, 9:30am (Australia/Melbourne)**.

| Folder | What the fake connector serves |
| --- | --- |
| `bank/` | `joint-everyday.csv`, `maya-visa.csv`, `accounts.json` (history from 2026-08-20) |
| `email/inbox.json` | Maya's mailbox plus the shared household address (~78 messages) |
| `documents/` | PDFs, a meter photo, `index.json`, and `_text/` pre-extracted text |
| `calendar/events.json` | Family, Maya and Ben calendars (some recurring) |
| `connectors/manifest.json` | Connection state, paging, latency, opt-in failure scenarios |
| `persona.json` | Household profile and the agent's standing preferences |
| `help/` | Hand-written help directory: each business's channels, short help articles, and where to escalate. Merchants are fictional; complaint bodies marked `real` are real and were checked on their official sites |
| `eval/` | Ground truth for scoring. **The app must never load this.** |

## Regenerate / check

```bash
python3 generate.py   # deterministic; PDFs need reportlab, the photo needs Pillow
python3 verify.py     # balances, cross-references, arithmetic
```

## Conventions

- Dates are ISO-8601 in Australia/Melbourne. Bank descriptors are intentionally messy.
- Card balance is negative when money is owed and is paid in full on the 12th.
- Documents carry a text sidecar, as a real connector's index would. The meter photo has none: use a vision model.
