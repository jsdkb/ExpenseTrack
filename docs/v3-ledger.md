# ExpenseTrack v3 — the app keeps its own book (`js/ledger.js`)

All examples use fabricated values. Personal data never goes into code, tests, fixtures, docs or
commit messages (the repo is public).

Until v3 the app mirrored three files exported from the owner's PC (wealth snapshot `et-wealth/1`,
books `et-books/1`, cash movements `et-cash/1`), and each newer file replaced the stored copy. From
v3 the app keeps its own permanent ledger and is the source of truth. The Accurate exports become
an optional feed: new entries are offered, differing ones are only flagged, the app is never
overwritten, and nothing is ever deleted.

`js/ledger.js` loads after the core script and before the other modules (ledger, books, home,
statements, extras).

## 1. `ledger.json` (schema `et-ledger/1`)

Own Drive appData file `ledger.json`, plus an IndexedDB cache on each device (database `et-ledger`,
store `ledger`, key `current`, value `{owner: USER_EMAIL, ledger}`; only read for the same account).
Never in localStorage and never in `STATE`.

```json
{
  "schema": "et-ledger/1",
  "seededAt": "2026-11-04T10:00:00.000Z",
  "updatedAt": "2026-11-04T10:00:00.000Z",
  "currency": "IDR",
  "source": {"book": "DEMO", "exportedOn": "2026-11-01", "balancesAsOf": "2026-10",
             "booksGeneratedAt": "...", "wealthFrom": "2025-01", "wealthAsOf": "2026-10",
             "wealthGeneratedAt": "...", "cashGeneratedAt": "...", "cashAsOf": "2026-10-17"},
  "accounts": {
    "1100.01": {"id": "1100.01", "name": "Bank A ••1234", "kind": "asset", "type": "Cash/Bank",
                "parent": "1100", "isParent": false, "suspended": false, "order": 12, "ccy": "IDR",
                "side": "asset", "group": "cash", "investment": false, "active": true,
                "plKind": null, "origin": "accurate", "at": "2026-11-04T10:00:00.000Z"}
  },
  "vouchers": {
    "acc|GL|JV|1234": {"id": "acc|GL|JV|1234", "srcKey": "GL|JV|1234", "source": "GL", "origin": "accurate",
      "date": "2026-10-31", "number": "JV-0012", "type": "JV", "description": "Month-end",
      "status": "posted", "createdAt": "...", "updatedAt": "...", "at": "...",
      "lines": [{"account": "1100.01", "amount": 1500000, "memo": "..."},
                {"account": "4100", "amount": -1500000, "memo": "..."}],
      "history": []},
    "v-20261104-7f3a": {"id": "v-20261104-7f3a", "origin": "ai", "date": "2026-11-04",
      "description": "Bought USD", "status": "posted", "createdAt": "...", "updatedAt": "...", "at": "...",
      "lines": [{"account": "1100.12", "amount": 16350000, "memo": "USD purchase",
                 "fx": {"ccy": "USD", "amount": 1000, "rate": 16350}},
                {"account": "1100.11", "amount": -16350000, "memo": "USD purchase"}],
      "prompt": "I just bought USD 1,000 at 16,350 from Bank B", "history": []}
  },
  "market":  {"2026-10": {"1200.01": {"v": 550000000, "at": "...", "src": "snapshot"}}},
  "closes":  [{"month": "2026-10", "label": "Oct 2026", "status": "closed", "...": "as in the snapshot", "at": "..."}],
  "groups":  [{"id": "cash", "label": "Cash & bank", "side": "asset"}],
  "cash":    {"accounts": {"<id>": {"id": "...", "label": "...", "kind": "card", "currency": "IDR", "n": 1, "at": "..."}},
              "statements": {"<account>|<date>": {"id": "...", "account": "...", "date": "...", "periodStart": null,
                             "dueDate": null, "minPayment": null, "receivedAt": null, "opening": 0, "closing": 0,
                             "tieOk": true, "notes": [], "n": 2, "at": "..."}},
              "txns": {"t-0a1b2c3d4e5f": {"id": "t-0a1b2c3d4e5f", "account": "...", "currency": "IDR", "date": "...",
                       "amount": -50000, "type": "spend", "desc": "...", "counterparty": "", "match": null, "n": 3, "at": "..."}},
              "alias": {"cv0007": "t-0a1b2c3d4e5f"}},
  "links":   {"v-20261104-7f3a": "acc|GL|JV|1300"},
  "flags":   {"acc|GL|JV|1234": {"kind": "differs", "at": "...", "sig": "...", "accurate": {"date": "...", "lines": []}}},
  "pending": {"acc|GL|JV|1301": {"status": "pending", "at": "...", "importedAt": "...", "voucher": {}}},
  "imports": [{"at": "...", "kind": "books", "generatedAt": "...", "from": "folder", "added": 0, "new": 0,
               "differs": 0, "missing": 0, "linked": 0}]
}
```

Rules:
- Amounts whole rupiah, debit positive. Every posted voucher balances to 0.
- `status` ∈ posted | void. Void vouchers stay, are left out of every view and balance, and are
  never deleted.
- `origin` ∈ accurate | app | ai | month-end | income. Accurate vouchers' id = `acc|` + Accurate key
  (`srcKey`); the app's own ids are `v-YYYYMMDD-xxxx`.
- `fx` (optional, per line): `{ccy, amount, rate}` with `round(|amount| * rate)` within 1 of the
  line amount (sign aside).
- `history`: `[{at, why, before: {date, description, lines, status}}]`, appended on every edit, void
  and "Take Accurate's version".
- `at` on each account / voucher / market entry / close / flag / pending entry / cash entry = last
  change time (ISO). Entries seeded or imported from a file carry the file's `generatedAt` (as ISO),
  so any later change made in the app is newer and wins a merge.
- `flags[id].kind` ∈ differs | missing (shown) and dismissed | cleared (kept so another device's
  older flag can't come back). `pending[id].status` ∈ pending | accepted | gone (no longer in
  Accurate's newer export).
- `cash.txns` keyed by the line id (Bank Statements emits stable content ids `t-` + 12 hex since
  2026-11-04); `cash.statements` keyed by statement id (`account|date`). Lines and statements are
  never dropped. `n` keeps the file order for the view. `alias` records a line whose id changed
  (old id → new id); the line itself lives on under its new id.

## 2. Computed views — the only way pages read data

`W()`, `BOOKS()` and `CM()` in index.html return `ledgerView('wealth' | 'books' | 'cash')` once the
ledger is seeded (and belongs to the signed-in account); until then the imported copies, unchanged
(`STATE.wealth`, `BOOKS_DATA`, `STATE.cash`). Views are built on first use after every change and
cached (the same object until the ledger changes; js/books.js rebuilds its index on a new object).
Each view carries `fromLedger: true`.

From the posted vouchers (core): months = first voucher month … the latest of the last voucher
month, `source.balancesAsOf` and `source.wealthAsOf`; `activity[month][code]` = the month's net,
`balances[month][code]` = cumulative through that month (no year-end closing), zeros left out.

- `BOOKS()` (`et-books/1` shape): `accounts` (all, sorted by order then id), `vouchers` (posted
  only, sorted by date then key; `key` = `srcKey` for Accurate vouchers, the id for the app's;
  `source` "App" and `type` Manual / AI entry / Month-end / Income for the app's; each also carries
  `id` and `origin`), `months`, `balances`, `activity`, `source {book, exportedOn, glAsOf = newest
  posted voucher date, balancesAsOf}`, `generatedAt` = the newest books import, `checks: []`.
- `W()` (`et-wealth/1` shape): `months` from `source.wealthFrom` (the snapshot's first month, which
  can be later than the book's first GL month) to the last core month; `accounts` = non-parent
  asset/liability accounts that the snapshot classified, that carry lines, or that the app added
  (not suspended), sorted by id, each `{id, name, group, side, ccy, investment, active, type,
  pending?}`; balances "as owned" (a liability shown positive). Side and group: the snapshot's
  (kept per account), else a default from the account type (`TYPE_GROUP`, "credit card" in the name
  → cards); then the snapshot builder's wrong-side rule on the latest balance (a non-card liability
  with a debit balance → receivables/asset; a receivable or other asset with a credit balance →
  other liabilities). Applied to what the snapshot said the rule changes nothing, so the seed
  reproduces the snapshot exactly. `active` = any balance in the last 12 months. `pnl` = per month,
  income/expense accounts' activity split by sign. `ledger` = equity/income/expense accounts with
  `kind` = the snapshot's sign-based kind (`plKind`) when known. `market`, `closes`, `groups` as
  stored; `source {book, asOf = last month, exportedOn}`; `generatedAt` = newest wealth import.
- `CM()` (`et-cash/1` as applyCash stores it): accounts, statements (incl. `receivedAt`) and txns in
  file order, `generatedAt`/`asOf` of the newest cash import; `null` while the ledger has no cash.

Accounts added in the app (`STATE.newAccounts`) are also ledger accounts (`origin: 'app'`, view
flag `pending: true`) once the ledger is seeded; `wAccounts()`/`meLedger()` list each code once, and
`naInBook(code)` is true when the ledger has the code from Accurate. When an Accurate export brings
the code, the account turns `origin: 'accurate'`.

## 3. Seeding, the gate, and later imports

**Seed.** Needs the wealth snapshot and the books (cash optional). Runs by itself after an import
or after the books load (once per combination of files), or from Settings › Your book (*Set up my
book* / *Check again*). It first loads the ledger (device cache, then Drive) and never seeds over
an existing one; if Drive could not be checked it waits. The candidate ledger is built from the
three files and committed only if the **gate** passes: the views must equal the files — books
`months`, and `balances` and `activity` of every month; the snapshot's every month and every
account balance as owned, and each snapshot account's side and group. On any miss nothing is
committed, the differences are listed in Settings, and the app keeps using the imported copies.

**Imports after the seed.** index.html's `applyWealth` / `applyBooks` / `applyCash` still keep
their imported copy (it stays in the Drive main file and books.json as before) and then call
`ledgerOnImport(kind, data, from, quiet)`:
- Books (app wins): chart accounts added or refreshed (unless changed in the app since); a new key →
  `pending` (*Add* / *Add all*); same key with different date or lines → `flags[id] = differs`
  (the app keeps its version; *Take Accurate's version* adopts Accurate's and records history);
  an Accurate voucher no longer in the export → `flags[id] = missing` (*Take Accurate's version*
  voids it); an app voucher matching a new Accurate voucher by signature (date | debit total |
  sorted account set, as `sigOf` in js/books.js) → `links[appId] = accId` and the Accurate one is not
  added. *Dismiss* keeps a flag from coming back for the same Accurate version.
- Wealth: market values and closes merged per month by `at`; account side/group/investment/active
  and the P&L kind filled only where the ledger has none; groups added; `wealthFrom/AsOf` widened.
- Cash: statements and lines unioned by id (a newer file refreshes an entry, a line missing from it
  is kept). A line that has no id match but equals an existing line on account | date | amount |
  description (one-to-one, file order) is the same line: it moves to the new id, `alias` records it,
  `match` references follow, and the owner's decisions move with it (`STATE.stmtFix.match[].line`,
  `stmtFix.added`, `cashTypeOverrides`, and the `stmt:<id>` row's `catOverrides`, `txEdits`, `splits`,
  `notes`, `subDecisions`, `hiddenIds`, `ccPosExcludedIds`). Before the seed, `applyCash` does the
  same remap of the owner's decisions against the copy it replaces.
- Each import is logged in `imports`; when it brings new, differing or missing vouchers a banner
  says e.g. "2 new from Accurate · 1 differs" with *Review* (Settings › Your book).

**Device merge** (Drive revision changed, `ensureLedger` sync, or `ledgerMergeIn`): per account /
voucher / market entry / close / flag / pending entry / cash entry the newer `at` wins (a tie keeps
this device's), union of keys; voucher `history` unioned; `imports` unioned by `at|kind`; `links`
and `alias` unioned (aliased old line ids are dropped after the union); `source` widened.

**Saving.** Every change: `updatedAt`, the IndexedDB cache, and (signed in) a Drive save 1.5 s
later with compare-and-swap like `booksDriveSave`, except that a changed revision is MERGED per
entry, never one copy replacing the other. `ledgerFlush()` saves now.

**localStorage mirror.** Once seeded, `saveStateMirror` writes `wealth: null, cash: null` (the copies
stay in the Drive main file; `mergeStates` keeps Drive's when the mirror has none).

## 4. JS API (globals from js/ledger.js)

| Function | Does |
|---|---|
| `LEDGER()` | The live ledger object or null (read-only use) |
| `ledgerStatus()` | idle \| loading \| ready \| none \| error |
| `ensureLedger()` | Promise; loads device cache then Drive once per sign-in (onSignedIn calls it; also the first render when someone is signed in) |
| `ledgerSeeded()` | true once the views are on |
| `ledgerView(kind)` | 'wealth' \| 'books' \| 'cash' view, or null |
| `ledgerValidate(v)` | `[]` or error strings: date, ≥ 2 lines, whole rupiah, non-zero, accounts exist and are not parents, balanced, fx consistent |
| `ledgerPost(v, {origin, why})` | → id; throws `Error` with `.errors` when invalid. `v = {date, description, number?, type?, prompt?, ref?, lines: [{account, amount, memo?, fx?}]}`; origin app (default) \| ai \| month-end \| income |
| `ledgerEdit(id, v, why)` | change date / lines / description / number; history kept |
| `ledgerVoid(id, why)` | status void; history kept; → false if already void |
| `ledgerAddAccount(acc)` | `{id, name, kind, type?, parent?, group?, ccy?, investment?, order?, suspended?}`; adds an app account or updates one the app added (Add account uses it); refuses an Accurate code |
| `ledgerPending()` / `ledgerAcceptPending(ids?)` | the review list; accept some or (no ids) all → count |
| `ledgerFlags()` / `ledgerTakeAccurate(id)` / `ledgerDismissFlag(id)` | differs / missing review |
| `ledgerExport()` | deep copy for backups |
| `ledgerMergeIn(obj, from)` | merge a backup (call after `ensureLedger()`); never replaces → `{vouchers, accounts}` added |
| `ledgerOnImport(kind, data, from, quiet)` | called by index.html after it accepted a file |
| `ledgerImport(kind, data)` | same merge on a file directly, no STATE copy (tests, real-data checks) |
| `ledgerSeed({quiet})` / `ledgerGate()` | seed attempt → gate result `{ok, count, diffs[≤50], reason?}` |
| `ledgerCounts()`, `ledgerInAccurate(code)`, `ledgerFlush()`, `resetLedger()` | helpers (sign-out calls `resetLedger`) |
| `ledgerCashIdRemap(old, new)`, `ledgerRemapCashRefs(map)` | the cash id remap |
| `ledgerLib` | pure helpers on any ledger object: `seedFrom, gateDiffs, mergeLedgers, mergeBooks, mergeCash, fillWealth, coreOf, wViewOf, booksViewOf, cashViewOf, sigOf, contentSig` |

Hook: `runHooks('ledgerChanged', why)` after every change (why ∈ seed, post, edit, void, account,
accept, take, dismiss, import, merge, sync); the current page re-renders.

UI: Settings › **Your book** (`ledgerSettingsHTML()`, section `#set-book`): status (set up date,
counts of vouchers / accounts / statement lines, last import), the gate's differences before the
seed, and the review list (Add all · Add · Take Accurate's version · Dismiss).

## 5. Deviations from the fixed interfaces (2026-11-04 ledger)

- Added fields: `source` (book, exportedOn, balancesAsOf, wealthFrom/AsOf, the three generatedAt,
  cashAsOf), `pending` (the review list has to live somewhere), `cash.alias`, `n` on cash entries,
  `at` on closes, flags and pending entries, `srcKey` + `source` on Accurate vouchers, `plKind` on
  accounts, `sig` on flags, `why`/`prompt`/`ref` on app vouchers. Import log entries also carry `new`
  (vouchers waiting for review) and `from`.
- Flags keep `dismissed` / `cleared` entries instead of being removed, and pending entries become
  `accepted` / `gone`, so another device's older copy can't bring them back.
- "Take Accurate's version" on a `missing` flag voids the voucher.
- A cash line from a newer file refreshes the stored line with the same id (the app never edits cash
  lines; the owner's re-tags live in `STATE.cashTypeOverrides`). Lines missing from the file are kept.
- `W().accounts[].active` is recomputed from the view's last 12 months (equal to the snapshot at the
  seed); `W().pnl` comes from the vouchers, so a month can differ from the snapshot's P&L sheet by a
  few rupiah of rounding (not part of the gate).
- The Settings card is its own section (`#set-book`, sub-nav "Your book") right after Data.
