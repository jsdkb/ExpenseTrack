# ExpenseTrack v3 — the app keeps its own book (`js/ledger.js`)

All examples use fabricated values. Personal data never goes into code, tests, fixtures, docs or
commit messages (the repo is public).

Until v3 the app mirrored three files exported from the owner's PC (wealth snapshot `et-wealth/1`,
books `et-books/1`, cash movements `et-cash/1`), and each newer file replaced the stored copy. From
v3 the app keeps its own permanent ledger and is the source of truth. The Accurate exports become
an optional feed: new entries are offered, differing ones are only flagged, the app is never
overwritten, and nothing is ever deleted.

`js/ledger.js` loads after the core script and before the other modules (ledger, books, entry, home,
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
  added. Fallback for foreign-currency entries: Accurate's file is rupiah-only and leaves out the
  foreign-currency group (lines with `fx`, and Month-end's difference line on them — core
  `meFxGroup`), so an app voucher that has such lines (or comes from Month-end) also links to an
  Accurate voucher on the same date whose lines are exactly its other lines (same accounts and
  amounts). Each app voucher links once. *Dismiss* keeps a flag from coming back for the same
  Accurate version.
- Wealth: market values and closes merged per month by `at`; account side/group/investment/active
  and the P&L kind filled only where the ledger has none; groups added; `wealthFrom/AsOf` widened.
- Cash: statements and lines unioned by id (a newer file refreshes an entry, a line missing from it
  is kept). A statement's `receivedAt` (the day it arrived) is kept through `applyCash`, the ledger's
  cash record and `CM()`, so the statement calendar learns each account's lag from it; a newer file
  without `receivedAt` keeps the day already known. A line that has no id match but equals an existing line on account | date | amount |
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

## 6. New entry, edit and void (`js/entry.js`)

`js/entry.js` loads after `js/books.js`. It owns the entry form, the AI call and the key; Journals and
the voucher sheet call into it through `window.etEntry`.

- **Where:** Journals header **New entry** (primary button, only once the book is seeded) and Home's
  header **Tell me what happened** (hook `homeActions` in js/home.js). Both open the same sheet.
- **The form** (one form for manual entries, AI drafts and edits): date, description, then two or
  more lines, each with an account (text input with a searchable datalist of the non-parent,
  non-suspended accounts; the account's name, or "Not in your book", shows under it), debit, credit,
  memo and an optional foreign-currency row (currency, foreign amount, rate, "= Rp x" hint). Live
  checks run `ledgerValidate` on every keystroke (balanced, accounts exist and are not parents, whole
  rupiah, fx consistent); totals and a `Balanced` / `Off by Rp x` badge sit under the lines. **Post**
  stays disabled while any check fails.
- **With a key:** a "Tell me what happened" box and **Draft with Claude** above the form. Claude's
  draft fills the form; its assumptions and questions are listed under it; proposed new accounts are
  shown with editable code / name / kind / currency / parent and an **Add** button
  (→ `ledgerAddAccount`). Post stays blocked until each is added or removed. The AI never posts.
- **Without a key, offline, or on any API error** (401, 403, 429, 5xx, timeout at 90 s, malformed or
  refused answer): the same form, empty, with a message saying what happened and to fill it in by
  hand. One request per click; nothing retries by itself.
- **Post:** `ledgerPost(v, {origin, why})`: origin `ai` with `prompt` = the sentence when the form
  came from a Claude draft (even if the owner changed it), else `app`. Then Journals opens with the
  voucher in the panel (`window.openVoucher(key)` in js/books.js).
- **Edit** (voucher panel / sheet): the form prefilled, plus a required **Why the change**; saves
  with `ledgerEdit(id, v, why)`. Accurate vouchers are editable too and the form warns "your book
  differs from Accurate from now on" (a later Accurate export then flags it, never overwrites it).
- **Void:** a small sheet with a required reason → `ledgerVoid(id, why)`. The voucher stays in the
  book and shows with a `Void` badge; Journals gets a **Show void (n)** check that lists them.
- **Voucher panel extras:** an origin badge (From Accurate · Manual · AI · Month-end · Income), Edit /
  Void buttons, and a **History** list: newest change first (Changed / Voided / Accurate's version
  taken · why · by you or from an Accurate import · when · the earlier date, total and lines in a
  `<details>`), ending with how it was created (and the owner's sentence for an AI entry).
- **Excel:** Journals downloads the filtered set (`journals-<YYYY-MM | all | from_to>.xlsx`, one row
  per line: date, number, description, type, account, name, memo, debit, credit, foreign amount; a
  Total row) and General ledger the current account and range (`ledger-<from|start>_<to>.xlsx`:
  opening, every line with the running balance in the natural sign, closing). Same look as the other
  Books exports (`xlReport`, which now takes `numCols` and `xSplit`). File names never carry account
  names.

`window.etEntry = {open, edit(id), void(id), canPost, originBadge(v), voucherTools(v), voucherByKey(key),
voidList(), newEntryBtn()}`.

## 7. The AI request and response

Browser-direct `POST https://api.anthropic.com/v1/messages` with the owner's key. Headers:
`x-api-key`, `anthropic-version: 2026-10-21`, `anthropic-dangerous-direct-browser-access: true`,
`content-type: application/json`, and for Sonnet / Opus `anthropic-beta: server-side-fallback-2026-07-01`
(with `fallbacks: "default"` in the body, so a safety decline is retried on a fallback model by
Anthropic, not by the app). No `temperature` / `top_p` / `top_k` (rejected on this API version).

```json
{"model": "claude-sonnet-5-5", "max_tokens": 16000, "system": "<drafting rules>",
 "output_config": {"effort": "medium", "format": {"type": "json_schema", "schema": {"...": "below"}}},
 "fallbacks": "default",
 "messages": [{"role": "user", "content": "{\"today\":\"2026-11-04\",\"baseCurrency\":\"IDR\",\"chartOfAccounts\":[{\"id\":\"1100.01\",\"name\":\"Bank A ••1234\",\"kind\":\"asset\",\"ccy\":\"IDR\",\"isParent\":false}],\"sentence\":\"I just bought USD 1,000 at 16,350 from Bank B\"}"}]}
```

The user message is exactly four fields: `today`, `baseCurrency`, `chartOfAccounts` (id, name, kind,
ccy, isParent of every non-suspended account, parents included so a proposed account can name one;
the system prompt forbids posting to them) and `sentence`. Never balances, statement lines, notes or
anything else from the book.

Structured output (every object `additionalProperties: false`, every field required):

```json
{"date": "2026-11-04", "description": "Bought USD 1,000",
 "lines": [{"account": "1100.12", "debit": 16350000, "credit": 0, "memo": "USD purchase", "fx": {"ccy": "USD", "amount": 1000, "rate": 16350}},
           {"account": "1100.11", "debit": 0, "credit": 16350000, "memo": "USD purchase", "fx": null}],
 "newAccounts": [{"id": "6000.12", "name": "Hobby supplies", "kind": "expense", "ccy": "IDR", "parent": "6000"}],
 "assumptions": ["Paid from Bank B in rupiah"], "questions": ["Was there a transfer fee?"]}
```

The app reads the text blocks as JSON and checks the shape itself (a `refusal` or `max_tokens` stop,
unparsable text or no lines → the manual form with a message). A line with both a debit and a credit
is netted; `fx.amount` is stored as a positive amount; a proposed account without a usable code gets
the next free code under its parent. Settings › AI → **Test** sends one tiny request
(`max_tokens: 16`, effort low, "Reply with OK.") to check the key.

Models (Settings › AI): Claude Sonnet 5.5 `claude-sonnet-5-5` (default), Claude Opus 5.5
`claude-opus-5-5`, Claude Haiku 5.5 `claude-haiku-5-5` (no server-side fallback).

## 8. The owner's API key

- Pasted by the owner in Settings › AI (`#set-ai`, sub-nav "AI", after Your book): a password input,
  **Save key**, **Test**, **Remove** (with Undo), the model choice and the note "Your key is stored in
  your private Google Drive app folder and this device; set a spend limit on it at
  console.anthropic.com; your sentence and your chart of accounts are sent to Anthropic when you ask
  the AI."
- Stored as `{key, model, at}` in its own Drive appData file `ai.json` (through `driveFindFileByName`
  / `driveReadJson` / `driveUploadJson`) and in IndexedDB database `et-secret`, store `secret`, key
  `ai|<account e-mail>`, value `{key, model, at, owner}`. Signed out (no Drive token): IndexedDB only.
  On load the newer `at` wins and the older copy is updated. **Remove** writes `{key: null, model, at}`
  to both, so the removal also wins on other devices.
- Never in `STATE`, the localStorage mirror, the ledger (`ledgerExport()`), backups, Excel, the DOM
  (only `sk-…••••` + the last 4 characters) or the console; error messages from Anthropic are
  scrubbed of anything key-shaped. `window.etAI.state()` gives `{hasKey, masked, model, at, status}`,
  never the key.
- Tests mock api.anthropic.com inside the page and use a fake `sk-ant-test-0000`; no real key and no
  real call.

## 9. Posting from Month-end and Income (index.html)

Once the book is seeded (`ledgerSeeded()`), the Accurate import files become an optional extra (the
buttons say so) and the two pages post into the app's own book. The app never writes to Accurate.

**Month-end › Post to book** (`mePost(M)`). Posts `meJournal(M)` as one voucher: `origin: 'month-end'`,
dated the month-end, `ref: 'month-end:YYYY-MM'`. The foreign-currency lines (kept out of the Accurate
file, which can't carry rates) are in the voucher with `fx: {ccy, amount, rate}`: the rate is the
month-end rate typed for the account and `amount` is the rupiah change divided by it (so the
validator's "amount x rate = line" holds); the position itself is in the memo and the positions
table. The id is stored in `STATE.monthEnd[M].postedId` (+ `postedAt`); `mergeStates` keeps the later
posting.
- State of a month (`meJournal(M).state`): `new` (not posted), `posted` (the live voucher exists and
  every figure still matches the book), `update` (a figure changed after posting). The positions
  table compares your figures with the live book, which holds the posted voucher, so right after
  posting every difference is zero. After a later change the page shows the posted voucher's lines
  merged with the change; **Update posted entry** calls `ledgerEdit` on the same voucher (history
  kept). A month never gets a second live voucher. Void only through the ledger; a voided month is
  `new` again and posts a fresh voucher (the voided one stays in the book).
- The close's "Journal entries" step and the J entry's posted state come from the ledger when seeded
  (`entryPosted`); the manual "Posted in Accurate" tick stays for an unseeded book.
- In `posted` state `meJournal` leaves `lines`/`fx` empty, so Journals' "prepared, not in Accurate
  yet" list (js/books.js `preparedAll`) shows nothing for it.
- A month with foreign-currency lines has a voucher the rupiah-only Accurate file cannot equal by
  signature; a later Accurate import of that file still links to it through the foreign-currency
  fallback in §3 (same date, the same non-fx lines), so it does not arrive as "new".

**Income › Post to book** (`incPost(id)`, `incPostAll(M)`). One voucher per receipt: `origin:
'income'`, `ref` = the receipt id, Dr the receiving account / Cr the income account;
`STATE.income[id].postedId`. The status comes from the ledger (`incBook()`, cached per change): `own`
(its voucher is posted) or `accurate` (a receipt saved or ticked Posted earlier whose Accurate
voucher, same date, total and account set, has come in); otherwise "To post". This replaces the
timestamp guess `incBookState` and the "In this snapshot?" question when seeded. Editing a posted
receipt edits its voucher (`ledgerEdit`, history kept); removing it voids the voucher. Month-end
never counts a posted receipt twice: it is in the book balances, and only unposted typed income is
added to what the book "will hold" (as before). `mergeStates` keeps a `postedId` that a stale copy
lacks.

**Later Accurate import.** If the owner also imports the same entries into Accurate, the next books
import links them (`links[appId] = accId`, nothing added) by `ledgerLib.sigOf`.

## 10. Backup and restore (Settings › Data)

`et-backup/1`: `{schema, createdAt, ledger: ledgerExport() | null, state}`. `state` is `STATE`
without `wealth`, `wealthMeta`, `cash`, `cashMeta` (the book holds those; only before the book is set
up are they included, since then they exist nowhere else) and without anything secret: properties
named like keys, tokens, secrets or passwords, and values shaped like an API key, are dropped
(`backupStripSecrets`; the AI key lives in its own file and never in STATE). File name
`expensetrack-backup-YYYY-MM-DD.json`. Before building: `ensureLedger()`, then `ledgerFlush()`.

**Restore from backup…** validates the file (schema, book schema), merges the book with
`ledgerMergeIn` (a bad book stops before anything changes), then the rest with `mergeStates`
(backup as the remote side, this device's choices win a tie). It only adds; a sheet lists what was
added (vouchers, accounts, card transactions, payments, income receipts, month-end closes, ...).

**Reminder.** `STATE.lastBackupAt` (set by every download) and `STATE.backupRemindAfter` (snooze,
merged as the latest of both devices). When the book is seeded and the last backup (or, if none yet,
the book's set-up date) is older than 31 days, a quiet banner offers **Back up now** or **Remind me
in 7 days** (`showBanner` takes an optional fourth action `{label, action}`).

## 11. Deviations (entry builder, 2026-11-04)

- `chartOfAccounts` includes parent accounts (flagged `isParent: true`), not only posting accounts,
  so Claude can place a proposed account under the right parent.
- `newAccounts[].id` and `parent` are required in the schema (`parent` may be null); the app fills a
  missing code itself.
- `fallbacks: "default"` + its beta header are sent for Sonnet / Opus (Anthropic's recommended
  default); Haiku requests go without.
- The voucher history shows "By you" for every in-app change: the ledger records why and when, not
  who (there is one owner).
