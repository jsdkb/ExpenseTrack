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
| `STATE.stmtFix` | C | Only the owner's decisions; matches themselves are recomputed every run (§6). `{match: {[emailTxKey]: {stmtId, line, amount, off: true, at}}` (an undone fix: the alert keeps its own amount and stays paired with cash line `line`), `added: {[cashTxnId]: {stmtId, excluded: true, at}}` (a statement-only line removed from spending), `review: {[emailTxKey]: {decision: 'exclude'\|'keep', at}}`, `manual: {[statementAccountId]: {on: true, at}}` (statements the owner downloads by hand)}. "Apply again" / "undo" write a dated tombstone `{deleted: true, at}`. `emailTxKey` = the transaction `id` (the key used by catOverrides, txEdits, hiddenIds) |
| `STATE.cardMap` | C | `{[emailBank]: statementAccountId \| ''}` — which statement account a bank's email alerts are checked against. Needed when a bank has several cards (or to link a bank whose name doesn't match); `''` = not linked. Unset = automatic by name |
| `STATE.budgets` | D | `{[category]: {monthly: number, since: 'YYYY-MM', at}}` |
| `STATE.goals` | D | `[{id, name, kind: 'networth'\|'liquid'\|'saving'\|'account', target, by: 'YYYY-MM', accounts?: [code], since: 'YYYY-MM', at}]`. `since` = the month the goal was created; set once and kept on every edit (`at` changes on every edit, so it can't date the goal). A `saving` goal counts net-worth change from the end of the month before `since`. Older goals without `since` fall back to `at`'s month |

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
  (built-ins: Daily spending 10 — key `overview`, short label "Spending" —, Spending 20, Credit
  cards 30; Net worth 10, Cash movements 20, Income 30, Accounts 40, Month-end 50). A `top` page with
  `order` below 10 comes first: Home is `order: 5`. The resulting menu is Home · Daily spending ·
  Spending · Credit cards · Wealth (Net worth, Cash movements, Income, Investment returns 35,
  Accounts, Month-end, SPT pack 60) · Books (Chart of accounts, Journals, General ledger, Balance
  sheet, Income statement, Trial balance) · Plan (Budgets, Goals); Settings sits in the sidebar
  footer.
- Landing page: `defaultTab()` = `home` when js/home.js registered it, else `overview`. The app
  starts on it and every sign-in (`onSignedIn`) returns to it.
- Phone bottom bar: exactly the keys in `BOTTOM_KEYS` = `home, overview, cards, networth`, shown
  with their `short` labels (Home · Spending · Cards · Net worth), then More. A key whose page isn't
  registered is skipped. Every other page, the Spending category page included, is listed on the
  More page in group order.
- `needs`: a `wealth` or `cash` page (outside groups `top`/`books`) stays out of the menu until
  that data exists. `books` pages and `top` pages always show and render their own empty state.
  Rendering a page with `needs: 'books'` or key `home` starts the lazy books load once someone is
  signed in (`USER_EMAIL` set); Home also renders behind the sign-in screen and must not load then.
- Chart draws: `renderAll()` numbers every render. Each page's chart draw (the built-in pages'
  draws and a registered page's `afterRender`) runs on the next animation frame only if no newer
  render started since, and calls `destroyCharts()` first. Two `renderAll()` calls in one frame
  therefore draw each chart once ("Canvas is already in use" can't happen).

Keys: `home` (B), `coa`, `journals`, `ledger`, `bs`, `pl`, `tb` (A), `budgets`, `goals`,
`invest`, `spt` (D). C adds no page: it extends built-in pages through hooks.

Hooks (results are HTML strings inserted as-is: escape data with `escH()`):

| Hook | Called from | Return |
|---|---|---|
| `txnBadges(tx)` | every transaction row on Overview and Spending (web table and phone list) | HTML appended to the row's sub-line |
| `cardsHistory(cards)` | Credit cards › History, once per render; `cards` = the selected card states (`{key, label, ...}`) | HTML appended below the paid-through history (e.g. a statements section) |
| `accountsExtraCol(acc)` | each account row on Accounts | HTML appended to the account's sub-line under its name |
| `homeComingUp()` | Home (B calls `runHooks('homeComingUp')`) | items `{date, kind: 'statement'\|'due'\|'missing'\|'manual', account, label, amount?}` |
| `beforeRender()` | the first line of every `renderAll()`, before the menu and the page are drawn | nothing (return value ignored). For a module that keeps derived data up to date (C re-runs its reconcile here when the cash file, `stmtFix`, `cardMap`, re-tags or the day changed). Must not call `renderAll()` |

`runHooks` spreads an array result into the list, skips `null`/`undefined`, and logs and skips a
hook that throws. With no hooks registered the built-in pages render exactly as before.

Transforms (added by C):

```js
registerTransform(name, fn, unapply?)  // fn(list) → new list; unapply(rowCopy) → the row before fn, or null for a row fn added
runTransforms(name, list)              // → the list after every transform; one that throws or returns a non-array is logged and skipped
untransformed(name, list)              // → copies of the rows with every unapply run, newest transform first; dropped rows left out
```

`load()` runs `ALL_TRANSACTIONS = runTransforms('transactions', ALL_TRANSACTIONS)` in both of its
paths (cache and Gmail), right after the core rules (`applySplits`) and before the
`ALL_TRANSACTIONS_RAW` snapshot, the hidden filter, manual entries and every total. So whatever a
transform changes is seen by Daily spending, Spending and Credit cards alike. With no transform
registered the list is unchanged.

The cache never holds a transform's changes. The Gmail path calls `saveCache` before
`runTransforms`, and `saveCache(list)` always stores `untransformed('transactions', list)`, so the
later saves after an edit (which pass the live, transformed `ALL_TRANSACTIONS_RAW`) are stripped
too. A module that fails to load, or whose transform stops running, therefore leaves the plain
email rows behind: no corrected amounts, no added rows. A transform may still change the live rows
in place (C does, so the owner's edits on a corrected row keep working); one that re-runs on the
live list must strip its own previous changes first (C's `strip` = `unapply` on every row).

Billing reminders: Maybank "billing" e-mails (`type: 'billing'`, `dueDate` as printed, no amount)
never enter `ALL_TRANSACTIONS` / `ALL_TRANSACTIONS_RAW`, so they are in no total. The core keeps
them in the global `BILLING` (an array of rows `{id, type: 'billing', bank, dueDate, msgDate, …}`),
filled by both load paths, merged by id on an incremental sync and stored with the cache
(`STATE.txns` holds them next to the email rows; `load()` splits them out again). Modules read
`BILLING`, never write it.

Cross-page navigation helpers (A provides on `window`; others call them):
- `openLedger(code, fromDate?, toDate?)` — the General ledger for one account (dates `YYYY-MM-DD`).
- `openJournals({from?, to?, kind?})` — Journals for a date range (either end optional); `kind`
  `'income'` or `'expense'` keeps the vouchers that touch such an account. Other filters clear.

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
statement ties with the pipeline's rule (below). `tests/test_foundation.py` checks all of it.

**Card sign (one rule everywhere).** The Bank Statements pipeline ties a bank account as
opening + transactions = closing and a card as opening − transactions = closing (charges are
negative lines, payments and refunds positive). So a card's closing is what is owed when positive
and in credit ("CR") when negative. Every reader of a card closing uses the core helpers
`cardOwed(closing)` = max(0, closing) and `cardCredit(closing)` = max(0, −closing): Cash movements
("Owed" / "In credit"), the statement calendar's due amount (`owedOf`) and Home's next card due. The
fixture follows the same rule.

## 6. Statements module (C, `js/statements.js`)

**Linking.** Email bank → statement account: `STATE.cardMap[bank]` when set, otherwise automatic —
same bank name and kind (`Maybank`, `OCBC CC`, any `… CC` → card; `BCA`, `OCBC` → bank account),
rupiah accounts only, account id prefix before `:` minus `-CC`/`-account` (e.g. `Maybank-CC:••1234`
↔ `Maybank`). Several candidates → not linked until the owner picks one (Credit cards › History ›
Statement links).

**Matching** (per linked account, recomputed on every load and whenever the cash file, `stmtFix`,
`cardMap`, cash re-tags or the day change — checked in the `beforeRender` hook):
- alerts: `type === 'transaction'`, not manual, rupiah amount > 0 (gross of splits) or a foreign
  currency alert; card accounts skip `category === 'Transfer'`;
- statement lines: money out, IDR, inside a statement period, on or after `HISTORY_START`;
- IDR: equal rupiah. FX alert: rupiah estimate within 3% of the line, or (no estimate) the foreign
  amount appears in the line text;
- dates within ±3 days; one-to-one, greedy by date gap, then amount gap, then ids (deterministic).

**Outcomes** (on the transaction objects, original kept in `tx.stmt`):
- matched → `amount` := statement rupiah (`tx.stmt = {kind:'match', line, stmtId, account, stmtAmount, orig, set}`; split rows keep their share);
- statement-only, closed statement, `cashMeta(cashType(line)).g === 'out'` and not a refund →
  added row `{id: 'stmt:' + cashTxnId, stmtAdded: true, bank, category: categorize(desc)
  ('Transfer' for transfer-out), …}`; the owner's category/note/edit/split rules apply to it by id;
- alert not on a closed statement (alert date ≥ the account's first period start and ≤ the newest
  closed statement date − 3 days) → review (`tx.stmt.kind = 'review'`); Exclude sets `amount` to 0
  (original kept), Keep leaves it.

`window.ETStatements` exposes `reconcile, strip, unapply, apply, calendar, cycleDay, expectedNext,
comingUp, last(), refresh` (read-only use) and the UI actions. It registers `unapply` with its
transform (§4), so the cache holds the alerts as parsed and every load re-derives the corrections
from `STATE.cash` and `STATE.stmtFix`.

**Calendar** (every statement account): cycle day = lower median of statement days, a statement on
a month's last day counting as 31; expected next = the month after the last statement, day clamped
to the month's length. Card due = latest statement `dueDate` / owed closing / `minPayment`, else the
newest billing reminder in `BILLING` for that card (linked like the alerts) dated after the last
statement (date only, no amount).

**Was it paid?** A card's own payment line only arrives with its next statement, so the evidence is
on the bank side: bank-account lines typed `card-payment` dated after the card statement and up to
the due date + 3 days (`PAY_GRACE`). A line belongs to a card when its text has the card's last four
digits; else when its amount equals that card's due amount or minimum; else when its text names
the card's bank and only one card of that bank is due. The card's own payment lines after the
statement count too. Paid = payments ≥ the minimum (or the amount owed when there is no minimum),
or nothing owed. When the due date has passed unpaid, the bank statements decide: only when every
bank account that pays cards (every bank account if none has yet) has a statement dated on or after
the due date + 3 days is it `overdue`; otherwise it is `unconfirmed` ("Payment not confirmed yet",
neutral). Rows carry `paid, overdue, unconfirmed, payment: {amount, lines, from: 'bank'|'card'|null}`.

Status, first that applies: `overdue`, `manual` (owner-flagged source and the expected date has
come), `late` (> 3 days past expected), `due-soon` (due within 7 days, unpaid), `unconfirmed`,
else `on-time`.
`homeComingUp()` items: `{date, kind, account (label), accountId, label, amount?}` for the next 14
days plus late/overdue/manual, sorted by date then kind (missing, manual, due, statement).
