# ExpenseTrack v4 — Books engine (`js/ledger.js`, schema `et-ledger/2`)

All examples use fabricated values. Personal data never goes into code, tests, fixtures, docs or
commit messages (the repo is public).

v4 copies the books rules of the owner's ERP (general ledger). **Posted journals are the only source
of every balance, view and report.** Drafts touch nothing. Void journals stay, with their history,
and are left out. The market values (`market`) and the cash statements (`cash`) are still stored in
`ledger.json`, for Net worth and Statements, but they never feed a ledger balance.

What is unchanged from `docs/v3-ledger.md`: the storage (Drive appData `ledger.json`, IndexedDB
`et-ledger` cache per account), compare-and-swap saves, the unreadable-file block, the two-files
merge, sign-out flush, backups (`et-backup/1`), the cash merge and cash-id remap (§3 there), and the
AI request (§7–8 there). This file is the contract for everything else; it replaces v3 §1, §2, §4.

Contents: 1 Schema · 2 Journals · 3 Periods and year-end · 4 Accounts · 5 Audit trail · 6 Views ·
7 Reports · 8 JS API · 9 Accurate feed and other imports · 10 Start my book and the standard chart ·
11 Migration /1 → /2 · 12 Re-code to the ERP chart · 13 Device merge · 14 Deviations · 15 What
callers must change.

## 1. `ledger.json` (schema `et-ledger/2`)

```json
{
  "schema": "et-ledger/2",
  "seededAt": "2026-11-11T10:00:00.000Z", "updatedAt": "...", "currency": "IDR",
  "source": {"book": "DEMO", "exportedOn": "...", "balancesAsOf": "2026-10", "wealthFrom": "2025-01", "wealthAsOf": "2026-10",
             "booksGeneratedAt": "...", "wealthGeneratedAt": "...", "cashGeneratedAt": "...", "cashAsOf": "..."},
  "accounts": {
    "1121.01": {"id": "1121.01", "name": "Bank A ••1234", "kind": "asset", "type": "Cash & Bank", "parent": "1121",
                "postable": true, "isParent": false, "archivedAt": null, "suspended": false, "order": null, "ccy": "IDR",
                "side": "asset", "group": "cash", "investment": false, "active": true, "plKind": null,
                "origin": "accurate", "oldCode": "1100.01", "createdAt": "...", "at": "...", "chartVer": 1}
  },
  "vouchers": {
    "v-20261104-7f3a": {"id": "v-20261104-7f3a", "kind": "manual", "status": "posted", "number": "JV/2026/00012",
      "refNo": "", "type": "", "date": "2026-11-04", "description": "Bought USD",
      "lines": [{"account": "1131.01", "amount": 16350000, "memo": "USD purchase", "fx": {"ccy": "USD", "amount": 1000, "rate": 16350}},
                {"account": "1121.01", "amount": -16350000, "memo": "USD purchase"}],
      "createdAt": "...", "updatedAt": "...", "postedAt": "...", "at": "...", "history": [], "chartVer": 1,
      "why": "Entered by hand", "prompt": null, "ref": null, "batch": null},
    "acc|GL|JV|1301": {"id": "acc|GL|JV|1301", "kind": "accurate", "status": "draft", "number": null, "refNo": "JV-2026-1301",
      "srcKey": "GL|JV|1301", "source": "GL", "type": "JV", "feedSig": "...", "feedAt": "...", "twin": "v-20261102-0a1b", "...": "as above"}
  },
  "periods":   {"2026-09": {"state": "closed", "at": "...", "closedAt": "...", "reason": "", "yearEndId": null}},
  "settings":  {"retainedEarnings": "3201", "firstMonth": "2024-12", "at": "...", "chartVer": 1},
  "audit":     [{"id": "a-…", "at": "...", "entity": "journal", "ref": "v-20261104-7f3a", "action": "post", "reason": "", "before": null, "after": {}}],
  "numbering": {"2026": 12},
  "recodes":   [{"id": "rc-…", "at": "...", "map": {"1100.01": "1121.01"}, "count": 39}],
  "migration": {"from": "et-ledger/1", "at": "...", "journals": 340, "numbered": 340, "drafts": 0, "backupAt": "...", "backupKept": false},
  "market": {}, "closes": [], "groups": [], "cash": {}, "imports": [],
  "links": {}, "flags": {}, "pending": {}
}
```

- Journals are stored under the key `vouchers` (kept so existing callers that read
  `LEDGER().vouchers[id]` keep working). A journal is one entry there.
- `links`, `flags`, `pending` are the v3 review data: kept in the file untouched, no longer used.
- Migrated journals also keep their v3 field `origin` (nothing is deleted). Read `kind`, never `origin`.
- `chartVer` (accounts, journals, market entries, settings) = how many re-codes the copy knew when
  it was last written; used only by the device merge (§13).
- Amounts are whole rupiah, debit positive. Every posted journal balances to 0.

## 2. Journals

**Status** `draft | posted | void` (plus `deleted`, the tombstone of a deleted draft, kept so another
device can't bring it back; never shown, never counted).
- Drafts may be unbalanced and may have any date, even in a closed month. They never touch any
  balance, view or report. They have no number.
- Void keeps the journal, its number and its history; it is left out of everything.

**Kind** `manual | ai | month-end | income | opening | year-end | accurate`. The API still accepts the
v3 `origin` names (`app` → `manual`). `year-end` and `accurate` are made by the engine only.

**Numbering** `JV/YYYY/00001`, per calendar year of the journal date, taken when it is posted (post or
post-draft). A failed post takes none. Numbers are never reused (`numbering[year]` = the last number
taken; the next one is max(counter, highest number in that year) + 1). Void keeps its number. An edit
that moves the date into another year keeps the number. Lists sort by date, then number.

**Posting rules** (`ledgerValidate`; checked whole before anything is written):
1. a valid date;
2. at least 2 lines;
3. each line: an account that exists, is postable (not a header) and not archived; one side only (a
   line is `{account, amount}` with debit positive, or `{account, debit, credit}`; both > 0 is
   refused); whole rupiah; not zero;
4. FX (optional per line) `{ccy, amount, rate}`: a 3-letter currency, amount and rate > 0, and
   `round(|amount| × rate)` within 1 of the line's rupiah amount;
5. debits = credits, and a non-zero total;
6. the date's month is open (`"<Month YYYY> is closed; reopen it in Books › Periods to post into it"`).

`ledgerValidate(v, {period: false})` skips rule 6. Error messages are plain strings; `ledgerPost` etc.
throw an `Error` whose `.errors` is that list.

**Backdate**: `ledgerWarnings(v)` → `['backdated']` when the date is more than 7 days before today
(a warning only, never a block).

**Edit / void** keep v3's history (`history: [{at, why, before: {date, description, lines, status, number}}]`).
Both are refused when the journal's month is closed or locked; an edit is also refused when the new
date's month is closed or locked. A year-end journal can't be edited or voided by hand (reopen
December). Editing a draft goes through `ledgerSaveDraft(v, {id})`; a draft is deleted, never voided.

**Copy** = a new draft dated today with the same description and lines (kind manual).

## 3. Periods and year-end

Months `YYYY-MM`, calendar year. A month with no entry in `periods` is **open**. The book's first
month = the earlier of `settings.firstMonth` and the first posted journal's month. A month before it
takes the first month's state once that one is closed or locked (nothing can be open before a closed
book). Transitions on months before the first month are refused.

State machine: open → closed (close) → locked (lock); closed → open (reopen, reason required);
locked → closed (unlock, reason required). Anything else is refused.

**Close** (`ledgerClosePeriod(M, reason?)`): the checklist must pass
(`ledgerCloseChecklist(M, reason?)` → `{month, state, items, yearEnd, canClose}`, items
`{code, ok, blocking, detail}`):
- `previous`: the month before is not open (or is before the book's first month);
- `drafts`: no draft dated in the month — the only check a reason acknowledges (the drafts stay drafts);
- `tb`: the month's trial balance is balanced and its opening is balanced;
- `retained` (December only): nothing to close, or a valid Retained earnings account is set.
Closing goes oldest first, across years.

**December = year-end close.** For every income and expense account, the year's posted net (dr − cr)
gets the opposite line (memo `Year-end close`); `settings.retainedEarnings` gets the net (memo
`Profit (loss) for the year`; a credit for a profit). It is posted as `kind: year-end`, dated 31 Dec,
description `Year-end close YYYY`, numbered like any journal, while December is still open; then
December closes with `yearEndId`. An empty year makes no journal and needs no RE account; activity
without one is refused. Archived income/expense accounts are allowed on that journal only.
`ledgerLib.yearEndPlan(x, year)` previews it.

**Reopen** (`ledgerReopenPeriod(M, reason)`): the month must be closed and the next month open, so
reopening goes newest first (across years). Reopening December voids every posted year-end journal
dated 31 Dec of that year, with why `Reopened December YYYY: <reason>`. Closing again makes a new
year-end journal with a new number.

**Lock** (`ledgerLockPeriod(M)`): closed → locked; the previous month must be locked (or before the
book). **Unlock** (`ledgerUnlockPeriod(M, reason)`): locked → closed; the next month must not be locked.

`ledgerPeriods(year)` → 12 rows `{month, label, state, stored, closedAt, reason, yearEndId, inBook,
canClose, canReopen, canLock, canUnlock}` (can* follow the order rules only; open the checklist for
the rest). `ledgerPeriodState(M)` → the state.

What P&L-like figures leave out: `ledgerLib.pl`, `W().pnl` and `BOOKS().activity` exclude year-end
journals. The trial balance, ledger, balance sheet and `BOOKS().balances` include them.

## 4. Accounts

Fields: `id` (the code, 1–20 chars of letters, digits, dots, dashes), `name`, `kind` (the ERP type:
asset | liability | equity | income | expense), `type` (Accurate's label, free text), `parent`,
`postable` (canonical; `isParent` is kept as its mirror), `archivedAt`, `suspended` (v3, kept: hide
from pickers), `ccy`, Net worth `group`/`side`/`investment`/`active`, `plKind`, `origin`
(`accurate` from Accurate's chart · `app` added in the app · `standard` from the template), `oldCode`
(after a re-code), `createdAt`, `at`.

Rules (ERP):
- the parent must exist, have the same kind and not be archived; cycles are refused;
- code and kind are fixed after creation (`ledgerEditAccount` refuses both);
- an account with any line (draft or posted) can't become a header;
- archive (`ledgerArchiveAccount`) is refused while the account has an all-time posted balance ≠ 0,
  has non-archived children, or is the Retained earnings account. There is no restore. Archived
  accounts can't take lines (pickers should hide `archived` and `suspended` ones);
- no account is ever created automatically from an unknown code (not by views, not by imports).

`ledgerAddAccount(acc)` creates only (an existing code is refused; use `ledgerEditAccount` to change
one). `acc = {id|code, name, kind, parent?, postable? (default true), group?, ccy?, investment?,
accType?, suspended?, order?}`. `ledgerSetRetainedEarnings(code)`: a postable, non-archived equity
account.

## 5. Audit trail

`audit` is append-only: `{id, at, entity, ref, action, reason, before, after}`.

| entity | ref | actions |
|---|---|---|
| journal | journal id | save (draft created or changed, Accurate drafts too), post, edit, void, delete-draft, renumber, accurate-differs |
| account | code | add, edit (before/after hold the changed fields only), archive |
| period | YYYY-MM | close, reopen, lock, unlock (after = the stored period + `transition: 'open->closed'`) |
| settings | retainedEarnings | edit |
| chart | — | recode (after = `{accounts, map}`) |
| book | — | migrate, start |

`ledgerAudit({entity?, ref?, from?, to?})` → newest first. Journal `before`/`after` =
`{date, description, status, number, kind, lines}`.

## 6. Views (shapes kept; computed from posted journals only)

`W()`, `BOOKS()`, `CM()` in index.html return `ledgerView('wealth' | 'books' | 'cash')` once the book
exists. Cached per change (same object until the book changes).

- **Core** (internal): months = first … last posted month, extended to `source.balancesAsOf` /
  `wealthAsOf`. `activity[m][code]` = the month's net **without year-end journals**,
  `yearEnd[m][code]` = the year-end journal's net, `balances[m][code]` = cumulative of everything
  posted (= previous + activity + yearEnd). Zeros left out.
- **`BOOKS()`** (`et-books/1`): `accounts` (all, each also `code`, `postable`, `archived`, `oldCode?`;
  `isParent` kept; `pending: true` only for `origin: app`), `vouchers` (posted only, sorted by date,
  number; each `{key, id, kind, origin (v3 name of the kind), status, date, number (JV), refNo, source,
  type, description, postedAt, lines: [{account, amount, description, fx?}]}`; `key` = `srcKey` for
  Accurate journals, else the id), `months`, `balances`, `activity`, `yearEnd`, `source`,
  `generatedAt`, `checks: []`.
- **`W()`** (`et-wealth/1`): as v3. Accounts = postable asset/liability accounts that carry lines, or
  that the wealth snapshot classified (`origin: accurate` with side and group), or that the owner
  added (`origin: app`, not suspended/archived); a template account without lines is left out.
  `archived: true` on archived ones. `pnl` per month from `activity` (year-end left out). `ledger`,
  `market`, `closes`, `groups` as v3.
- **`CM()`** (`et-cash/1`): unchanged.
- **`ledgerView('journals')`**: every journal but deleted drafts, sorted by date, number, id: `{id, key,
  number (null for drafts), refNo, kind, status, date, description, debit (Σ debits), lines: [{account,
  amount, memo, fx?, stmtLine?}], createdAt, postedAt, updatedAt, changes (history length), srcKey?,
  source?, type?, twin?, batch?, ref?, why?, errors? (drafts: the posting-rule errors now)}`.
  `twin` = a posted non-Accurate journal with the same date, debit total and accounts (a likely
  duplicate). Full detail (history, prompt): `ledgerJournal(id)`.

## 7. Reports (`ledgerLib`, pure, from posted lines by date)

Pass the ledger object, or `null` for the live book. Dates `YYYY-MM-DD`; `from`/`to` may be null
(= from the beginning / to the end). An inverted range throws `The start date is after the end date`.
Raw amounts are debit − credit; the statements flip the sign by kind. Lines sort by date, number, line.

| Call | Returns |
|---|---|
| `tb(x, from, to)` | `{from, to, rows: [{code, name, kind, postable, archived, unknown?, opening, debit, credit, closing}], totals: {opening, debit, credit, closing}, balanced, openingBalanced}` — every postable non-archived account (even at zero) plus any account with posted lines up to `to`; sorted by code (numeric-aware) |
| `gl(x, code \| null, from, to)` | `{from, to, accounts: [{code, name, kind, …, opening, rows: [{date, id, number, kind, description (the journal's), memo, debit, credit, running}], debit, credit, closing}]}` — all accounts: those with no opening and no lines left out; one code: always that account |
| `pl(x, from, to)` | `{from, to, income: [{code, name, amount}], expense: [...], totalIncome, totalExpense, net}` — year-end journals left out; income = −(dr − cr), expense = dr − cr; zero accounts left out |
| `bs(x, asOf)` | `{asOf, fyStart, assets, liabilities, equity: [{code, name, amount, unknown?}], unclosedPriorEarnings, currentYearEarnings, totalAssets, totalLiabilities, totalEquity, totalLE, balanced}` — cumulative to asOf incl. year-end journals; assets +(dr − cr), liabilities/equity −(dr − cr); zero rows left out (a contra account shows negative); the two earnings lines split at 1 Jan of asOf's year; a negative line is a loss (the UI relabels it) |
| `yearEndPlan(x, year)` | `{year, empty, accounts, net (profit +), retainedEarnings, lines}` |
| `checklist(x, M, reason)`, `periods(x, year)`, `periodState(x, M)`, `firstMonth(x)` | as §3 |
| `validate(x, v, opts)`, `warnings(v)` | as §2 |

A code on a line that is not in the chart (only possible in migrated data) shows with `unknown: true`
(name = code; on the balance sheet among the assets). On real data there are none.

## 8. JS API (globals)

| Function | Does |
|---|---|
| `LEDGER()` | the live book or null (read-only use) |
| `ledgerStatus()` / `ledgerBlocked()` | idle \| loading \| ready \| none \| error / why it is blocked (unreadable Drive file, or a /1 book that could not migrate) |
| `ensureLedger()` | Promise; loads device cache then Drive once per sign-in; migrates a /1 book (§11) |
| `ledgerSeeded()` | true once the book exists (views on) |
| `ledgerView(kind)` | 'wealth' \| 'books' \| 'cash' \| 'journals' |
| `ledgerValidate(v, opts?)` / `ledgerWarnings(v)` | §2 |
| `ledgerPost(v, {kind\|origin, why})` | creates and posts at once → id. `v = {date, description, refNo?, type?, prompt?, ref?, batch?, lines}`. kinds manual (default) \| ai \| month-end \| income \| opening |
| `ledgerSaveDraft(v, {id?, kind?, why?})` | new draft, or (with `id`) changes a draft → id. Needs a valid date, ≥ 2 lines, whole-rupiah amounts, one side per line; may be unbalanced |
| `ledgerPostDraft(id, {why?})` | posting rules, then number → id |
| `ledgerPostDrafts(ids \| null, {kind?})` | posts each (null = every draft, optionally of one kind) → `{posted: [ids], failed: [{id, errors}]}` |
| `ledgerDeleteDraft(id, why?)` / `ledgerCopy(id)` | drafts only / new draft from any journal → id |
| `ledgerEdit(id, v, why)` / `ledgerVoid(id, why)` | §2 (void → false if already void) |
| `ledgerJournal(id)` | a copy of one journal (with history), or null |
| `ledgerAddAccount(acc)` / `ledgerEditAccount(code, patch, why?)` / `ledgerArchiveAccount(code, why?)` | §4 |
| `ledgerSetRetainedEarnings(code)` / `ledgerSettings()` | `{retainedEarnings, firstMonth, at}` |
| `ledgerPeriods(year)`, `ledgerPeriodState(M)`, `ledgerCloseChecklist(M, reason?)` | §3 |
| `ledgerClosePeriod(M, reason?)` → `{month, state, yearEndId}` · `ledgerReopenPeriod(M, reason)` → `{month, state, voided}` · `ledgerLockPeriod(M)` · `ledgerUnlockPeriod(M, reason)` | §3 |
| `ledgerAudit(filter?)` | §5 |
| `ledgerStart({chart: 'standard' \| 'from-books', opening?: {date, description?, lines}})` | Promise; §10 |
| `ledgerStandardChart()` | Promise → the template accounts (copy) |
| `ledgerRecodeProposal()` / `ledgerRecode(map, {why?})` / `ledgerCodeMap()` / `ledgerResolveCode(code)` | Promises / Promise / sync / sync; §12 |
| `ledgerAccurateDrafts()` | the journals view filtered to Accurate drafts |
| `ledgerMigration()` | `{status: none \| migrated \| seeded \| blocked, count?, diffs?, at, backupAt?}` |
| `ledgerFindByRef(ref, kind)` | the posted journal of an income receipt id / `month-end:YYYY-MM` |
| `ledgerOnImport(kind, data, from, quiet)` / `ledgerImport(kind, data)` | §9 |
| `ledgerExport()`, `ledgerMergeIn(obj, from)` (a /1 backup is migrated first), `ledgerFlush()`, `ledgerCounts()` (`{vouchers (= posted), posted, drafts, void, accurateDrafts, accounts, lines, statements, audit, lastImport}`), `ledgerInAccurate(code)`, `resetLedger()`, `ledgerCashIdRemap`, `ledgerRemapCashRefs`, `ledgerSettingsHTML()` | as v3 |
| `ledgerSeed()` / `ledgerGate()` | **legacy**, tests and real-data checks only: builds a /1 book from the imported files with the v3 tie gate, then migrates it. Nothing calls it automatically any more |
| `ledgerPending`, `ledgerAcceptPending`, `ledgerFlags`, `ledgerTakeAccurate`, `ledgerDismissFlag`, `ledgerAfterBooksLoad` | retired stubs ([] / 0 / false / no-op) |
| `ledgerLib` | pure helpers: `tb gl pl bs validate warnings periodState firstMonth periods checklist yearEndPlan migrate migrationDiffs toV2 recodeProposal recode codeMap resolveCode leafFor ops healDuplicatePosts renumberCollisions applyRecodes seedFrom gateDiffs mergeLedgers mergeBooks mergeCash fillWealth coreOf wViewOf booksViewOf cashViewOf journalsViewOf sigOf contentSig emptyLedger SCHEMA`. `ledgerLib.ops` = the mutating operations on any ledger object (post, saveDraft, postDraft, deleteDraft, copy, edit, void, addAccount, editAccount, archiveAccount, setRetainedEarnings, close, reopen, lock, unlock), for tests and what-if checks |

Hook: `runHooks('ledgerChanged', why)` after every change; why ∈ start, seed, post, draft, delete,
edit, void, account, settings, period, recode, import, merge, sync. The current page re-renders.

## 9. Accurate feed and other imports

`ledgerOnImport(kind, data, from, quiet)` (index.html calls it after it accepted a file; it does
nothing until the book exists):
- **books** (Accurate) — only ever creates **draft** journals: id `acc|<key>`, `kind: accurate`,
  `refNo` = Accurate's number, `type`, `source`, line codes resolved through the re-code map.
  - The same key is never created twice (any status, deleted drafts included; keys the v3 book had
    linked or accepted are skipped too).
  - A changed Accurate version of a still-draft journal refreshes it (history entry `Accurate’s newer
    version`, audit `save`). For a posted (or void) journal it only adds one audit note
    `accurate-differs` per Accurate version (`feedSig` remembers it); the journal is untouched.
  - An unknown code makes that draft fail its checks until the account is added.
  - Banner: "n new drafts from Accurate · m drafts refreshed", *Review* → Settings › Your book.
  - Import log `{at, kind, generatedAt, from, added, new, refreshed, changedPosted, …}`.
- **wealth** — never adds an account; fills side / group / investment / active / plKind only where
  missing; market values and closes merged by `at` (codes resolved through the re-code map).
- **cash** — unchanged (v3 §3).

## 10. Start my book and the standard chart

`ledgerStart({chart, opening?})` (signed in, no book on this device or in Drive):
- `chart: 'standard'` loads `data/standard-coa.json` (fetched; a failed fetch throws "Couldn’t load
  the standard chart…") and sets Retained earnings to `3201`;
- `chart: 'from-books'` takes the imported books' chart (accounts only, no vouchers);
- `opening: {date, description?, lines}` posts a `kind: opening` journal (posting rules apply; the
  start fails as a whole if it is invalid). `settings.firstMonth` = the opening date's month, else
  this month.

`data/standard-coa.json` (`et-coa/1`, generic, no personal data): `{schema, name, note, accounts:
[{code, parent, name, type, postable, normalSide, level, group, investment}]}` — 161 accounts, 101
postable, 4 levels. Classes 1000 Assets · 2000 Liabilities · 3000 Equity · 4000 Operating income ·
5000 Cost of sales (header only) · 6000 Operating (living) expenses · 7000 Other income · 8000 Other
expenses · 9000 Income tax. A code ending in 0 is a header; several accounts of one kind are `.nn`
children of a postable code (1121.01, 1121.02). `group` = the Net worth group id (cash, deposits,
stocks, business, property, receivables, other_assets, loans, cards, other_liabilities) for every
balance-sheet account; `normalSide` is reference only (accumulated depreciation is credit).

## 11. Migration /1 → /2

Runs once, in place, on whatever et-ledger/1 copy is loaded (device cache, Drive, a backup being
restored): accounts get `postable` / `archivedAt`; journals get `kind` (from `origin`), `refNo` (the
old `number`), `postedAt`, normalised whole-rupiah lines; posted **and void** journals are numbered by
date, then id; v3 `pending` Accurate vouchers become Accurate drafts (the pending list itself stays);
`settings.firstMonth` = the first posted month; RE is left unset (the owner picks it in Periods); an
audit `migrate` entry. Nothing is deleted.

**Gate**: for every month, balances and activity of the migrated book (posted journals only) must
equal the /1 book's, and the posted count must match. Otherwise nothing migrates: the /1 book is
used read-only (views on, every change refused, nothing saved, banner `ledgermigrate`,
`ledgerStatus()` error, `ledgerMigration().status` blocked with the differences).

**Backup**: before the first /2 save to Drive, the /1 copy (Drive's if it had one, else the device's)
is uploaded as `ledger-v1-backup.json`; an existing backup is never overwritten (`backupKept: true`).
`migration.backupAt` records it.

## 12. Re-code to the ERP chart

`ledgerRecodeProposal()` → `[{old, new, name, kind, reason, confidence: high|low, leaf?, header?}]`,
one row per account:
- an account already on an ERP code (a template code, or `.nn` under a postable template code, same
  kind) keeps it; `low` when its name points to another leaf;
- every other postable account (or any account with lines) goes to the `.nn` child of the standard
  leaf chosen from its kind, Net worth group, currency and name (`ledgerLib.leafFor`), nn = 01, 02…
  in old-code order. `low` when only a fallback leaf matched (other receivables, other expense…);
- a header goes to the deepest standard header above all the accounts under it (no accounts under
  it: the class header). Several old headers can land on one standard header (headers have no lines).

`ledgerRecode(map, {why?})` applies `{old: new}` (unlisted accounts keep their code), on a copy:
- the whole standard chart is added; an old account taking a template code replaces that template
  account; a standard leaf that receives `.nn` children becomes a header; `order` is cleared (sorted
  by code); each moved account keeps `oldCode`;
- every journal line (all statuses), `settings.retainedEarnings` and the market values are re-pointed;
  `recodes` gets `{id, at, map (changed codes), count}`; audit `recode`;
- refused (nothing changes) when two accounts with lines would share a code, a parent would be of
  another kind, a code is invalid, or the **gate** finds any difference: per old account per month,
  balance and activity equal its new account's, and totals per kind match. The thrown error carries
  `.diffs` and `.count`.

`ledgerCodeMap()` → composed `{old: current}`. `ledgerResolveCode(code)` → the current code for a code
**from before the re-code** (Accurate files, STATE fields not yet remapped). Do not resolve codes that
are already current: a template code can also be an old code of a different account (2 such codes in
the owner's chart), so resolution is only meaningful for old-world codes.

## 13. Device merge

Per entry, the newer `at` wins, union of keys (v3), plus:
- accounts and market entries: the copy with the higher `chartVer` wins first, then `at`;
- `periods`: per month newest `at`; `settings`: the newer object; `audit` and `recodes`: union by id;
  `numbering`: max per year; `migration`: union, newest `backupAt`;
- after the union: a copy that had not seen a re-code moves its journal lines, accounts and market
  values to the new codes (an old-code account whose new one exists is dropped as the older copy);
- **numbers**: if two devices posted in the same year while apart and took the same number, the
  journal posted first (`postedAt`, then id) keeps it; the other gets the next free number of that
  year, a history entry and one audit `renumber` (deterministic id, so merging again adds nothing);
- duplicate-ref healing (income / month-end) as v3, plus an audit `void`;
- a journal posted offline into a month another device closed stays (the close is not re-run).

## 14. Deviations

From the ERP:
- **Edit and Void stay** (owner's ruling), with history, refused in closed/locked months; no reversal
  journals. Reopening December voids the year-end journal instead of reversing it.
- Whole rupiah, not 2 decimals. Months are implicit (open unless stored). No control accounts.
- Drafts may be saved with any date (as the ERP), need ≥ 2 lines (the ERP UI rule) but may be unbalanced.
- Deleted drafts are kept as a `deleted` tombstone (device merge), never shown.

From the plan / brief:
- Journals stay under the storage key `vouchers` and keep v3 field names (`lines[].amount` signed,
  `memo`), so existing readers keep working.
- `BOOKS().activity` (used by Home's P&L) leaves year-end journals out; `BOOKS().yearEnd` holds them
  so `balances` still adds up.
- v3 pending Accurate vouchers become drafts at migration (the natural successor of the review list);
  keys v3 had linked to an app voucher are never brought in as drafts.
- `ledgerAddAccount` no longer updates an existing account (use `ledgerEditAccount`).
- The re-code adds the whole standard chart (so the ERP structure is there to grow into); the TB then
  lists every postable template account at zero, as the ERP does.
- `ledgerSeed` is kept (not automatic) because the other suites and the real-data check need a /1
  book built from the demo files.

## 15. What callers must change (Books UI and callers helpers)

- Nothing seeds automatically any more: test set-ups that imported the three files and waited for
  the seed must call `await ledgerSeed()` (or Start my book).
- `BOOKS().vouchers[].number` is now the JV number; Accurate's number is `refNo`. Kinds via `kind`
  (`origin` still present in the view, v3 names).
- Read `kind` on `LEDGER().vouchers[id]`, not `origin`.
- Pages: no automatic accounts for unknown codes (books.js `buildIdx`'s `extra`); hide archived
  accounts in pickers; use `postable`.
- `ledgerPost` / `ledgerEdit` / `ledgerVoid` now throw for closed/locked months: show the message and
  link to Books › Periods. Month-end posts into a closed month are refused the same way.
- Accounts added in the app: `ledgerAddAccount` for new codes, `ledgerEditAccount` for changes
  (index.html's suspend sync used the old upsert).
- After a re-code, remap every stored code in `STATE` once with `ledgerCodeMap()` (Month-end
  mappings, Income accounts, new-account records…) and record that it was done; afterwards don't
  resolve those codes again.
- Settings › Your book (`ledgerSettingsHTML`) is minimal: status, RE, migration, Start my book, and
  "Drafts from Accurate (n)" with Post / Post all. The re-code table (*Move to the ERP chart*) and the
  opening-balances form are UI work for the callers helper (`ledgerRecodeProposal` → editable table →
  `ledgerRecode(map)`; show `err.diffs` on refusal).
