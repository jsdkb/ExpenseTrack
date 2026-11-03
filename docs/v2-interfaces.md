# ExpenseTrack v2 — shared interfaces (fixed before parallel build)

All examples below use fabricated values. Personal data never goes into code, tests or docs.

`index.html` holds the core and the existing pages. New v2 code lives in `js/books.js`, `js/home.js`,
`js/statements.js` and `js/extras.js`, loaded with plain `<script src>` after the core script in that
order. There is still no build step.

## 1. `books.json` (schema `et-books/1`)

Built by the wealth snapshot builder in the Accurate Desktop DB project, next to `wealth-snapshot.json`
(`%USERPROFILE%\accurate-desktop-db\exports\<BOOK>\wealth\books.json`). Inputs from the SAME dated
export folder: the Business Reports xlsx (authoritative balances) and `detail-<prefix>-ledger.json`
(GL lines + chart of accounts).

```json
{
  "schema": "et-books/1",
  "generatedAt": "2026-11-03T21:30:00",
  "source": {"book": "DEMO", "exportedOn": "2026-11-03", "glAsOf": "2026-10-31", "balancesAsOf": "2026-08"},
  "currency": "IDR",
  "accounts": [
    {"id": "1100.01", "name": "Bank A ••1234", "type": "Cash & Bank", "kind": "asset",
     "parent": "1100", "isParent": false, "suspended": false, "order": 12, "ccy": "IDR"}
  ],
  "vouchers": [
    {"key": "GL|JV|1234", "date": "2026-10-31", "number": "JV-2026-0012", "source": "GL", "type": "JV",
     "description": "Month-end", "lines": [
       {"account": "1100.01", "amount": 1500000, "description": "..."},
       {"account": "4100", "amount": -1500000, "description": "..."}]}
  ],
  "months": ["2023-12", "...", "2026-10"],
  "balances": {"2026-10": {"1100.01": 1500000}},
  "activity": {"2026-10": {"1100.01": 1500000, "4100": -1500000}},
  "checks": [],
  "tie": {"monthsChecked": 33, "maxDiff": 0}
}
```

Rules:
- `kind` ∈ asset | liability | equity | income | expense, from Accurate's account type.
- Amounts are whole rupiah (rounded), **debit positive, credit negative**, everywhere.
- `balances[month][code]` = cumulative balance from all GL lines through that month-end, for
  every non-parent account (no year-end closing applied). Zero balances omitted.
- `activity[month][code]` = that month's net movement. Zero omitted.
- Parent accounts carry no lines; the app rolls children up via `parent` (`null` on a top-level account).
- `vouchers` sorted by date then key; `key` = `source|type|source_id` and must be unique (builder
  test). `number` = Accurate voucher/document number (new column appended at the END of
  detail_export's GL `entry` rows, so other readers are unaffected); `""` when unknown.
- `name` goes through `mask_name` and id_guard exactly like the snapshot.
- Tie: for every month in both sources, each balance-sheet account's GL balance must equal the
  xlsx balance within 1.5; any miss is a line in `checks` AND makes the builder exit non-zero
  unless `--allow-untied` is given.
- `balancesAsOf` = last month of the xlsx; `glAsOf` = newest GL line date.

What the app accepts (`validBooks`): `schema === 'et-books/1'`, a parseable `generatedAt`, a
`source` object, and `accounts`, `vouchers`, `months` arrays plus a `balances` object.

## 2. Cash file additions (schema stays `et-cash/1`, fields added only)

`statements[]` gain (null when not on the statement):
- `periodStart` — now also for cards;
- `dueDate` — "YYYY-MM-DD", cards;
- `minPayment` — rupiah, cards;
- `notes` — already in the file, now kept by the app.

The app's `applyCash` keeps, per statement in `STATE.cash.statements[]`:
`id, account, date, periodStart, dueDate, minPayment, opening, closing, tieOk, notes`, and `kind`
per account. `id` is the file's own `id` when present, otherwise `account + '|' + date` (this is
the `stmtId` used in §3). `periodStart`, `dueDate` and `minPayment` are `null` when missing;
`notes` is always an array (`[]` when missing, each note cut to 200 characters). Older files
without these fields still load.

Note: the app only replaces its cash data with a file whose `generatedAt` is newer, so a Drive copy
imported by an older app version gains the new fields only when the next (newer) cash file arrives.

## 3. App state (Drive appData main file unless noted)

| Key | Owner | Shape |
|---|---|---|
| books (separate appData file `books.json`, IndexedDB cache `et-books`) | F1 loader, read by A/B/D | §1 as imported. Read it with `BOOKS()`; never copy it into `STATE` or localStorage |
| `STATE.booksMeta` | F1 | `{importedAt, from: 'file'\|'folder', generatedAt}` |
| `STATE.stmtFix` | C | `{match: {[emailTxKey]: {stmtId, amount, at}}, added: {[stmtId]: {cat, at, excluded?}}, review: {[emailTxKey]: {decision: 'exclude'\|'keep', at}}}` |
| `STATE.cardMap` | C | `{[bank]: statementAccountId}` one-time mapping when a bank has several cards |
| `STATE.budgets` | D | `{[category]: {monthly: number, since: 'YYYY-MM', at}}` |
| `STATE.goals` | D | `[{id, name, kind: 'networth'\|'liquid'\|'saving'\|'account', target, by: 'YYYY-MM', accounts?: [code], at}]` |

Defaults (`defaultState()`): `booksMeta: null, stmtFix: {}, cardMap: {}, budgets: {}, goals: []`.
Create `stmtFix.match` / `.added` / `.review` on first write.

Merge rule for new keys (`mergeStates`, when two devices saved at once):
- Every entry carries `at` (ISO time of the edit). Per entry, the newer `at` wins; on a tie, or
  when neither side has `at`, this device wins. An entry with `at` beats one without.
- `stmtFix`: applied per sub-map (`match`, `added`, `review`, and any other sub-map), per key.
- `cardMap`: per bank. Values are plain ids without `at`, so this device's choice wins per bank
  (same as `monthEndCfg.stmtMap`).
- `budgets`: per category. `goals`: per `id`, this device's order first, then goals only the
  other device has.
- Removing something: write a dated tombstone instead of deleting the key — `{deleted: true, at}`
  for a budget or stmtFix entry, `{id, deleted: true, at}` for a goal — so the removal beats the
  other device's older copy. Readers skip `deleted` entries.
- `booksMeta`: the one with the newer `generatedAt` wins.
- After any change call `scheduleDriveSave()`.

## 4. Page registry (F1 builds, A–D use)

```js
registerPage({key, label, short?, icon, group, order, render, afterRender?, needs?})  // → true, or false if refused
// group ∈ 'top' | 'wealth' | 'books' | 'plan'; needs ∈ 'wealth' | 'books' | 'cash'
registerHook(name, fn)
runHooks(name, ...args)        // → array of every hook's non-null result
registerIcon(name, svgInner)   // add a Lucide icon to the sprite so ic(name) works
```

Pages:
- `key`: lowercase `[a-z][a-z0-9_-]*`, unique; registering the same key again replaces the page.
  Built-in keys (`overview, spending, cards, networth, cash, accounts, income, close, settings,
  more`) are refused. `label` becomes the top-bar and document title.
- `render(page)` returns the page HTML (inserted into `#root`); `afterRender(page)` runs on the next
  animation frame for charts. Store Chart.js instances in `CHARTS[id]` so `destroyCharts()` frees
  them on the next render. A page whose `render` throws shows an error card; the rest of the app
  keeps working. Re-render with `renderAll()`.
- Defaults: `icon: 'circle-ellipsis'`, `order: 100`. The sprite has only the icons already used by
  the app; add others with `registerIcon` (Lucide path markup, 24×24 view box).
- Menu placement: groups render in the order top, Wealth, Books, Plan; the Books and Plan headings
  only appear once a page is registered in them. Within a group, pages sort by `order`
  (built-ins: Overview 10, Spending 20, Credit cards 30; Net worth 10, Cash movements 20,
  Income 30, Accounts 40, Month-end 50). A `top` page with `order` below 10 (e.g. Home at 0) comes
  first. Phone bottom bar: the first three `top` pages, then Net worth, then More; every other page
  is listed on the More page in group order.
- `needs`: a `wealth` or `cash` page (outside groups `top`/`books`) stays out of the menu until
  that data exists. `books` pages and `top` pages always show and render their own empty state.
  Rendering a page with `needs: 'books'` or key `home` starts the lazy books load.

Keys: `home` (B), `coa`, `journals`, `ledger`, `bs`, `pl`, `tb` (A), `budgets`, `goals`,
`invest`, `spt` (D). C adds no page: it extends built-in pages through hooks.

Hooks (results are HTML strings inserted as-is: escape data with `escH()`):

| Hook | Called from | Return |
|---|---|---|
| `txnBadges(tx)` | every transaction row on Overview and Spending (web table and phone list) | HTML appended to the row's sub-line |
| `cardsHistory(cards)` | Credit cards › History, once per render; `cards` = the selected card states (`{key, label, ...}`) | HTML appended below the paid-through history (e.g. a statements section) |
| `accountsExtraCol(acc)` | each account row on Accounts | HTML appended to the account's sub-line under its name |
| `homeComingUp()` | Home (B calls `runHooks('homeComingUp')`) | items `{date, kind: 'statement'\|'due'\|'missing'\|'manual', account, label, amount?}` |

`runHooks` spreads an array result into the list, skips `null`/`undefined`, and logs and skips a
hook that throws. With no hooks registered the built-in pages render exactly as before.

Cross-page navigation helper: `openLedger(code, fromDate?, toDate?)` (A provides on `window`;
others call it).

Books loader (index.html):
- `BOOKS()` → the imported §1 data or `null`. `booksStatus()` → `'idle' | 'loading' | 'ready' |
  'none' | 'error'`.
- `ensureBooks()` → Promise of the data. Loads once per sign-in: the IndexedDB cache first (only
  if it belongs to the signed-in account), then Drive's `books.json` when signed in. Re-renders the
  current page when it is a books page. Safe to call on every render. `reloadBooks()` retries Drive
  (for a Retry button).
- `applyBooks(data, from, quiet)` → Promise<boolean>. Validates, keeps the newer `generatedAt`,
  writes the IndexedDB cache, sets `STATE.booksMeta` and saves `books.json` to Drive with
  compare-and-swap (a newer copy saved by another device is adopted instead of overwritten). The
  Settings Import button (`applyImported`) and the snapshot folder (`readBooksFromHandle`) both use
  it. IndexedDB failing (private window, blocked storage) only means no cache.

Module rules: wrap each `js/*.js` file in a function so its helpers stay private; put only
deliberate cross-module helpers (e.g. `openLedger`) on `window`. Core helpers (`$`, `ic`, `escH`,
`fmtIDR`, `pageHead`, `cardHead`, `emptyHTML`, `toast`, `openSheet`, `STATE`, `scheduleDriveSave`,
`renderAll`, `setTab`) are globals from index.html.

## 5. Fixtures (fabricated, F1 creates)

`tests/fixtures/books-demo.json` (≥ 30 accounts across all kinds incl. one USD account, parents,
≥ 18 months, ≥ 200 vouchers, balances that tie), and `tests/fixtures/cash-demo-v2.json` (cards with
dueDate/minPayment/periodStart, ≥ 2 cards on one bank). Existing fixtures stay.

Both are written by `tests/fixtures/make_v2_fixtures.py` (deterministic; re-run it after changing
it). As built: books-demo has 41 accounts (10 parents), 23 months (2024-12 to 2026-10), 340
vouchers, a USD bank account and one suspended account. cash-demo-v2 has one bank account and three
cards, two of them on the same bank (`Bank-Alpha-CC`), with three card cycles each; every
statement ties (opening + its transactions = closing). `tests/test_foundation.py` checks all of it.
