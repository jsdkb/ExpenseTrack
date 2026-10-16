# Wealth tracker — Phases 2–4 design

**Date:** 2026-10-16 · **Status:** approved via upfront questions (user, 2026-10-16) · **Repo is
public:** this spec contains no personal data; every figure below is a placeholder.

## Goal

Turn ExpenseTrack into a personal wealth tracker. The user's accounting book (Accurate desktop) is
the **books of record**; the app is a read-only window onto it, refreshed once a month by a
snapshot. Spending (Gmail) stays as it is.

| Phase | Ships |
|---|---|
| 2 — Wealth core | Snapshot format + local builder, automatic import, **Net Worth** and **Accounts** sections, cost vs. market toggle, credit-card tie-out |
| 3 — Month-end close | **Month-end** section showing each close: positions vs. books, journal entries to post, re-check, closed |
| 4 — Extras | Cash flow (income vs. spend, savings rate), allocation view, per-account "declared in tax return" flag (from the retired Net Worth Ledger) |

## Decisions (user, 2026-10-16)

1. **Data path:** automatic import on the user's desktop browser. The user grants one local
   folder once (File System Access API, Chromium desktop only). After that the app reads the
   newest snapshot on every load, if it is newer than what Drive holds, and saves it into the
   private Drive app file. Other devices get it through the normal Drive sync. A manual **Import
   snapshot** button is the fallback (any browser).
2. **Autonomy:** build Phases 2–4; publish each phase after tests and the pre-push privacy grep
   pass.
3. **Net Worth Ledger** (separate Claude Artifact): fold its useful part (the tax-declared flag)
   into this app, then mark it retired.
4. **History:** backfill monthly net worth from the book, as far back as the export reaches
   (December, three years before the latest posting).

Defaults stated to the user and not objected to: the name stays ExpenseTrack; bank account
numbers are masked to the last 4 digits; the close happens in chat with Claude; the app never
edits balances.

## Privacy model

- The snapshot holds personal financial data. It is written only to the **local data hub**
  (`%USERPROFILE%\accurate-desktop-db\exports\<BOOK>\wealth\`, outside OneDrive and outside the
  repo) and, once imported, to the **Drive appData file**. It never enters `index.html` or the
  repo.
- Account names in the snapshot have long digit runs (≥ 6) masked to `••1234`.
- The browser's folder handle lives in IndexedDB on that device (a per-device convenience).

## Snapshot format `et-wealth/1`

One JSON file, `wealth-snapshot.json` (newest), plus dated copies.

```json
{
  "schema": "et-wealth/1",
  "generatedAt": "2026-10-16T09:00:00+07:00",
  "source": { "book": "<key>", "asOf": "2026-08-31", "exportedOn": "2026-10-15" },
  "currency": "IDR",
  "groups": [ { "id": "cash", "label": "Cash & bank", "side": "asset" }, "…" ],
  "accounts": [
    { "id": "1100.01", "name": "Bank X ••1234", "group": "cash", "side": "asset", "ccy": "IDR",
      "investment": false, "active": true }
  ],
  "months": [ { "month": "2026-08", "balances": { "1100.01": 1000000 } } ],
  "market": { "2026-08": { "1300.01": 2000000 } },
  "pnl": [ { "month": "2026-08", "income": 0, "expense": 0, "other": 0 } ],
  "closes": [
    { "month": "2026-10", "label": "Sep + Oct 2026", "status": "open",
      "positions": [ { "account": "1100.01", "books": 0, "actual": 0 } ],
      "entries": [ { "id": "A", "memo": "…", "status": "to-post",
                     "lines": [ { "account": "1500.01", "debit": 0, "credit": 0 } ] } ],
      "recheck": null, "note": "" }
  ]
}
```

- Balances are **as owned**: assets positive, liabilities positive as amounts owed. Equity and
  P&L accounts are excluded. Net worth = Σ assets − Σ liabilities, which the builder checks
  against equity + cumulative P&L (tolerance Rp 1).
- `market` is optional per month and account. When a market value exists, the app's
  **Market** view uses it in place of the book (cost) balance for that account.
- `closes` is maintained by the builder from a local positions file the close conversation
  produces (Phase 3).

## Account groups

| Group | Side | Typical book accounts |
|---|---|---|
| Cash & bank | asset | bank and cash accounts (one credit-card clearing account is a liability) |
| Deposits & bonds | asset | time deposits, bonds, money-market funds |
| Stocks & crypto | asset (investment) | brokerage, mutual-fund, crypto accounts |
| Business stakes | asset (investment) | capital invested in businesses |
| Property | asset | land, buildings |
| Receivables & reserves | asset | receivables, money set aside |
| Loans | liability | amounts owed to people or companies |
| Credit cards | liability | the book's combined credit-card account |

Classification is by account type plus a small code-prefix map in the builder; anything
unclassified falls into "Other assets/liabilities" by sign, and the builder prints a warning.

## App changes

**Navigation** (guideline §3): sidebar group "Wealth" with **Net Worth**, **Accounts** and
**Month-end**. Mobile bottom bar: Overview · Spending · Cards · Net worth · More (Accounts and
Month-end sit under More). Sections show only once a snapshot exists; before that, Net Worth
shows a "Connect your snapshot" empty state.

**Net Worth** (§11.5): hero net worth with the change vs. the previous month (coloured by
meaning: up = good); a period control (12 mo / 24 mo / All); a **Book | Market** segmented
toggle; an area chart; assets-vs-liabilities figures plus horizontal bars by group; "What changed"
(top 5 account movements vs. the previous month); and a credit-card tie-out line (book credit-card
account vs. the app's card balances, i.e. Maybank + OCBC CC owed).

**Accounts** (§11.6): grouped list with group subtotals; each row shows name, currency, balance,
"as of" month, and a market value when one exists. Selecting a row shows its balance history
(web: detail panel; mobile: sheet). Phase 4 adds the **Declared** checkbox per account.

**Month-end** (§11.7): month list with status badges. The selected close shows the five-step
stepper — 1 Positions → 2 Differences → 3 Journal entries → 4 Re-check → 5 Closed — with the
positions-vs-books table, the entry list (copy buttons, posted/to-post status that the user can
tick, saved to Drive) and the re-check result. The app never writes to the books.

**Settings › Data:** "Connect snapshot folder" (desktop Chromium), "Import snapshot…" (file
picker), and the last-imported snapshot's as-of date.

**Phase 4:** a Spending-page **Cash flow** card (monthly income from the book vs. spend from
Gmail; savings rate), a Net Worth **Allocation** card (asset mix by group, with % share), and the
**Declared in tax return** flag with a "Not yet declared" filter on Accounts.

## Local tooling (Accurate Desktop DB project)

- `src/kjo_wealth_snapshot.py` — reads the newest export workbook (sheets "Monthly Balances by
  Account", "P&L by Account by Month"), builds `et-wealth/1`, masks names, checks the
  net-worth tie, and writes `wealth-snapshot.json` plus a dated copy to the data hub. It reads
  an optional `positions-<YYYY-MM>.json` from the same folder to fill `closes` and `market`.
- The nightly run already refreshes the export; the snapshot builder runs from the same nightly
  pass, so the folder always holds the newest snapshot.

## Testing

Fabricated snapshots only (in the session scratchpad): Playwright checks for import (file +
folder handle mocked), Net Worth maths (sum of groups, change, Book/Market switch), Accounts
grouping and subtotals, Month-end stepper states and entry ticking, cash flow and allocation
totals, empty states, mobile layout. Python unit checks for the builder: masking, grouping,
the net-worth tie, positions merging.

## Out of scope

Editing balances in the app, any write to the books, live market prices, budgets, renaming the
app.
