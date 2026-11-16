# ExpenseTrack v6 — the new book, built beside the current app (`js/w2/`)

Status: contract for build round 1 (2026-11-13). The owner asked for the rebuild to be added to
the current app as an extra so both can be used at once, without changing the original.

## 0. Hard rules

1. **The original is not changed.** No edits to `index.html` (except the one loader line below),
   `js/*.js`, `data/`, `UX-GUIDELINE.md`, `tests/run_all.py` or any existing test. Another session
   is editing those files right now. Everything new lives in `js/w2/`, `tests/w2/`,
   `tests/test_w2_*.py`, `tests/run_w2.py` and this document.
2. The only line added to `index.html`, directly after the `js/assistant.js` script tag:
   `<script src="js/w2/boot.js"></script>`. Make that one edit with an exact single-line insert and
   touch nothing else in the file.
3. **Read-only towards the old data.** The new modules never write `STATE`, never call
   `scheduleDriveSave()`, never call a mutating `ledger*` function, never write the old
   localStorage or IndexedDB keys. They read `ALL_TRANSACTIONS`, `STATE`, `LEDGER()`, `W()`,
   `CM()`, `BOOKS()` and write only the new book (§2).
4. **No personal data in code, tests or docs** (the repo is public): no real names, account
   numbers, merchants or amounts. Fixtures are fabricated (`Person A`, `Bank Alpha ••1111`).
5. The original pages keep their numbers. The new modules register no `transactions` transform.
6. Whole rupiah everywhere; debit positive; every posted entry sums to 0.

## 1. Files

| File | Holds |
|---|---|
| `js/w2/boot.js` | Loads the other files in order (dynamic `<script>` tags, `async=false`), adds the menu group, registers the pages. Does nothing harmful if a file fails: logs and stops. |
| `js/w2/book.js` | The engine: pure functions on a book object, no DOM, no globals except `bookLib`. Also loadable in Node (`module.exports = bookLib` when `module` exists). |
| `js/w2/store.js` | Loading and saving the book (Drive appData file `book.json`, IndexedDB `et-book2` cache), the live book `BOOK2()`, change hook, history conversion on first load, the spending sync. |
| `js/w2/pages.js` (may be split: `pages-*.js`) | The new pages. |
| `tests/w2/*.test.mjs` | Node tests for `book.js` (`node --test tests/w2`). |
| `tests/test_w2_*.py`, `tests/run_w2.py` | Playwright suites using `tests/harness.py` (import it, do not edit it) and fabricated fixtures in `tests/fixtures/w2-*.js(on)`. |

Menu: `boot.js` appends `['w2','Version 2 · new book (preview)']` to the core's `NAV_GROUPS` array (it is a
top-level `const` array, so pushing to it needs no core edit) and registers its pages with
`registerPage({group:'w2', ...})`. Page keys start with `w2-`. Icons come from the existing sprite
or `registerIcon`.

## 2. `book.json` (schema `et-book/3`)

```json
{
  "schema": "et-book/3", "createdAt": "...", "updatedAt": "...", "currency": "IDR",
  "accounts": {"a-1": {"id": "a-1", "code": "1121.01", "name": "Bank Alpha ••1111",
      "kind": "asset", "role": "bank", "parent": null, "header": false, "ccy": "IDR",
      "person": null, "category": null, "incomeType": null,
      "stmt": null, "emailBank": null, "tax": null, "hidden": false, "origin": "migration", "at": "..."}},
  "people":   {"p-1": {"id": "p-1", "name": "Person A", "type": "person", "at": "..."}},
  "entries":  {"e-20261104-7f3a": {"id": "e-20261104-7f3a", "date": "2026-11-04", "kind": "paid-for",
      "status": "posted", "description": "Dinner", "number": null,
      "lines": [{"account": "a-9", "amount": 250000, "memo": ""}, {"account": "a-3", "amount": -250000}],
      "source": {"type": "email", "ref": "tx:abc123"}, "provisional": false,
      "createdAt": "...", "at": "...", "history": []}},
  "values":   {"a-5|2026-10": {"account": "a-5", "month": "2026-10", "value": 52000000, "at": "..."}},
  "checks":   {"a-1|2026-10": {"account": "a-1", "month": "2026-10", "statement": 195300000, "book": 195300000, "ok": true, "at": "..."}},
  "locks":    {"2026-09": {"state": "locked", "at": "...", "reason": ""}},
  "rules":    [{"id": "r-1", "match": {"payer": "PERSON A", "dir": "out"}, "answer": {"kind": "lent", "person": "p-1"}, "at": "..."}],
  "settings": {"retained": "a-30", "unexplained": "a-31", "fxGain": "a-32", "firstMonth": "2024-12",
               "syncFrom": "2026-11-01", "bankMap": {}, "at": "..."},
  "audit":    [{"id": "u-…", "at": "...", "entity": "entry", "ref": "e-…", "action": "post", "before": null, "after": {}}],
  "migration": {"from": "et-ledger/2", "at": "...", "entries": 0, "accounts": 0, "diffs": 0}
}
```

- `accounts[].kind`: `asset | liability | equity | income | expense`.
- `accounts[].role`: `bank | cash | ewallet | card | investment | property | receivable | payable |
  loan | other-asset | other-liability | income | expense | equity | retained | unexplained | fx`.
  A `receivable`/`payable` account with `person` set is that person's balance (one per person per
  side). An `expense` account with `category` set is that spending category's account (one per
  category). `code` is the account code shown in the Accountant view (migrated accounts keep the
  old book's code; new ones get the next free code under their sibling group).
- `entries[].kind` (the "answer"): `spending | paid-for | split | reimburse | lent | repaid-in |
  borrowed | repaid-out | income | transfer | card-payment | invest-buy | invest-sell | fee |
  write-off | adjust | opening | year-end | manual | migrated`.
- `entries[].status`: `posted | void`. There are no drafts.
- `source.type`: `email | stmt | manual | ai | migration | system`. `source.ref` is unique among
  posted entries for types `email`, `stmt` and `migration` (**one source, one entry**).
- Removal is always a tombstone (`deleted: true, at`) or `status: 'void'`; nothing is deleted.

## 3. Engine API (`bookLib`, all pure; mutating functions change the passed book and return a result)

Errors: throw `Error` with `.errors = [plain strings]`.

| Function | Does |
|---|---|
| `emptyBook(now?)` | A valid empty book with the three system accounts (retained, unexplained, fx gain). |
| `validate(book, entry, opts?)` → `[errors]` | Date valid; ≥ 2 lines; each account exists, not a header, not hidden-with-zero-use is allowed; whole rupiah, not zero; fx `{ccy, amount, rate}` within 1 rupiah; debits = credits; month not locked (`opts.lock === false` skips); source ref not already used by another posted entry. |
| `post(book, entry, now?)` → id | Validates, stamps, appends audit. |
| `edit(book, id, patch, why, now?)` | Keeps `history`; refused in a locked month (old or new date). |
| `voidEntry(book, id, why, now?)` → bool | |
| `findBySource(book, type, ref)` → entry or null | Posted only. |
| `upsertBySource(book, entry, now?)` → `{id, action: 'post'\|'edit'\|'same'}` | Posts when the source is new; edits when date, lines or kind differ; nothing when equal. In a locked month: `action: 'locked'`, no change. |
| `addAccount(book, acc, now?)` → id · `editAccount` · `hideAccount` (zero balance only) | |
| `categoryAccount(book, category, now?)` → id | Finds or creates the expense account of a spending category. |
| `addPerson(book, {name, type}, now?)` → id · `personAccount(book, personId, side, now?)` → id | side `receivable \| payable`; finds or creates. |
| `buildEntry(book, kind, d, now?)` → entry (not posted) | `d = {date, amount (positive), account (the bank/card/cash it moved through), dir: 'out'\|'in', category?, person?, incomeType?, toAccount?, share? (split: owner's own part), others? [{person, amount}], taxWithheld?, description, source?, fx?}`. Writes the lines per the table in §4. |
| `balances(book, asOf?)` → `{accountId: amount}` | Posted entries up to and including the date. |
| `tb(book, from, to)`, `bs(book, asOf)`, `pl(book, from, to)`, `ledgerOf(book, account, from?, to?)` | Report shapes. |
| `people(book, asOf?)` → `[{person, owedToYou, youOwe, items, oldestDate}]` | From the person accounts. |
| `actualSpending(book, month)` → `{total, byCategory: {name: amount}}` | Net debits to `expense` accounts in the month (fees included, `unexplained` and `fx` excluded). |
| `income(book, month)`, `saved(book, month)` | |
| `netWorth(book, month, view)` → `{assets, liabilities, net}` | `view` `book \| market` (market replaces an investment's book balance with `values` for that month, or the latest earlier one). |
| `bridge(book, month)` → `{opening, income, spending, market, fx, unexplained, other, closing}` | Must add up exactly. |
| `lock(book, month, now?)`, `unlock(book, month, reason, now?)`, `lockState(book, month)` | |
| `addRule`, `removeRule`, `suggest(book, item)` → answer or null | Rules first, then the latest posted entry with the same payer. |
| `merge(a, b)` → book | Two devices: per id, newer `at` wins; tombstones beat older copies; after merging, two posted entries with the same unique source ref → the older one stays, the newer is voided with why "duplicate source". |
| `fromLedgerV2(ledger, now?)` → `{book, diffs}` | §5. |
| `SCHEMA` | `'et-book/3'` |

## 4. What each answer writes (debit ← credit)

| kind | Lines |
|---|---|
| `spending`, `fee` | expense (category) ← account |
| `paid-for`, `lent`, `reimburse` | receivable (person) ← account |
| `split` | expense (category) `share` + receivable (each other person) ← account |
| `repaid-in` | account ← receivable (person) |
| `borrowed` | account ← payable (person) |
| `repaid-out` | payable (person) ← account |
| `income` | account (+ expense "Tax" for `taxWithheld`) ← income (type), gross |
| `transfer`, `card-payment`, `invest-buy` | `toAccount` ← account |
| `invest-sell` | account ← investment (cost) and income "Investment gain" (difference; a loss debits it) |
| `write-off` | expense (category) ← receivable (person) |
| `adjust` | account ↔ `settings.unexplained` |

A refund on a spending row (money in on the same category) is `spending` with `dir: 'in'`: the lines reverse.

## 5. History conversion (`fromLedgerV2`)

- Input: the old book as returned by `LEDGER()` (`et-ledger/2`, docs/v4-books.md §1). The old
  file is never written.
- Every account becomes an account with the same `code`, name, kind, currency and header flag;
  `role` from the old `side`/`group`/`kind` (cash → bank, cards → card, investments → investment,
  receivables → receivable, loans → loan, income/expense/equity as is; unknown → other-asset /
  other-liability). Archived or inactive → `hidden`.
- Every **posted** journal becomes one entry: kind `migrated`, `number` = the old number,
  `source: {type: 'migration', ref: <old id>}`, same date, description and lines (accounts mapped
  by code), history dropped. Drafts and void journals are not converted. Year-end journals come
  over as kind `year-end`.
- Old periods `closed`/`locked` → `locks[month] = locked`. Old `market` values → `values`.
  `settings.retained` from the old retained earnings account; `firstMonth` kept.
- `settings.syncFrom` = the first day of the month after the last locked month (or after the
  last month with a migrated entry when nothing is locked). The spending sync (§6) only writes
  entries dated on or after it, so history is never counted twice.
- **Gate:** `diffs` = every `(account code, month)` whose closing balance differs between
  `ledgerLib.tb` on the old book and `bookLib.balances` on the new one, for every month from
  `firstMonth` to the last entry. The store only keeps a converted book when `diffs.length === 0`;
  otherwise it shows the count and keeps nothing.

## 6. Store (`js/w2/store.js`)

- `BOOK2()` → the live book or null. `book2Status()` → `idle | loading | ready | none | error |
  blocked`. `ensureBook2()` → Promise; once per sign-in: IndexedDB cache (only when it belongs to
  the signed-in account), then Drive `book.json`; when neither exists and the old book is ready,
  offers the conversion (never automatic: the owner taps **Convert my book** on a new page).
- Saving: debounced, compare-and-swap on the Drive file revision using the core's existing
  `driveFindFileByName`, `driveReadJson`, `driveUploadJson`, `driveGetRevision`; on a conflict
  re-read, `bookLib.merge`, retry. Signed out or offline: the cache only, marked unsaved, saved on
  the next sign-in for the same account only.
- `book2Do(fn, why)` — the only way pages change the book: runs `fn(book)`, saves, then
  `runHooks('book2Changed', why)` and re-renders the current page when it is a `w2-` page.
- **Spending sync** `book2SyncSpending()` → `{posted, edited, same, waiting, locked}`: for every row
  of `ALL_TRANSACTIONS` dated on or after `settings.syncFrom` whose bank is mapped in
  `settings.bankMap` (`{[row bank label]: accountId}`), `upsertBySource` an entry with
  `source {type:'email', ref:'tx:'+row.id}`. The entry's kind is `spending` at the row's current
  category unless the owner answered that row otherwise (then the answered entry is kept and only
  its amount and date follow the row). Rows of an unmapped bank are counted as `waiting`. Runs
  after the book is ready, after each Gmail sync, and after a category change (hook
  `beforeRender`, cheap signature check first). Rows that left `ALL_TRANSACTIONS` (hidden) →
  their entry is voided, why "hidden".
- Everything the store needs from the row (id, date, amount, bank label, category, refund flag,
  foreign currency) is read from the existing row shape; read the code for the exact field names.

## 7. Round-1 pages (group `w2`)

| Key | Page | Round 1 content |
|---|---|---|
| `w2-start` | Start here | Status of the new book; **Convert my book** with the gate result; link each email bank to an account (`bankMap`); counts from the last spending sync. |
| `w2-rows` | Spending · actual | The synced rows by month with the Actual spending strip (from emails, not mine, actual) and, per row, **Not my spending ▸** Paid for someone · Split · Company will reimburse · Lent, and **Mine again**. |
| `w2-people` | People | Totals; per person balance, age, items; Got repaid / I repaid (typed amount, account, date in round 1); Add person; Write off; Copy reminder. |
| `w2-networth` | Net worth | Book / Market; accounts grouped by role with balances from the new book; account movements. Read-only in round 1 except Update value. |
| `w2-journals` | Journals (accountant) | Every entry as debit and credit lines with kind, source and status; filter by month, kind, account; open one; void with a reason. |

Design: reuse the core helpers and classes (`pageHead`, `cardHead`, `emptyHTML`, `openSheet`,
`toast`, `fmtIDR`, `escH`, `ic`) and the tokens in `UX-GUIDELINE.md` §5–§8. No new colours or
fonts. Works at 375 and 1440, light and dark, no sideways scroll. Hide amounts must blur the new
pages' amounts too (use the class the core uses).

Later rounds (not now): Inbox from statement lines, Month check, Performance, Tax, Accurate
export, Ask Claude tools, Add.

## 8. Verification for round 1

- `node --test tests/w2` green: engine rules, every answer of §4, source uniqueness, lock rules,
  merge (including the duplicate-source case), reports tie (`bs` balances, `bridge` exact),
  `fromLedgerV2` on `tests/fixtures/books-demo.json`-derived data with 0 diffs.
- `python -B tests/run_w2.py` green: with the fabricated fixture, convert → 0 diffs; map a bank;
  sync posts one entry per row and a second sync posts none; "Paid for someone" lowers actual
  spending and raises that person by the same amount with net worth unchanged; repaid returns the
  person to zero; original pages' totals are identical with and without `js/w2` loaded; no
  console errors; 375 and 1440, light and dark.
- `python -B tests/run_all.py` still passes unchanged (the original is untouched).
- Privacy grep of every new file.

## Engine decisions

Choices made in `js/w2/book.js` where the sections above are silent (2026-11-13). Tests: `tests/w2/`.

**Running the tests.** On Node 22+ `node --test tests/w2` runs the folder as one file instead of
walking it, so `tests/w2/index.js` loads every `*.test.mjs` beside it. `node --test "tests/w2/*.test.mjs"`
gives the same result.

**Extra functions (not in the §3 table; nothing in the table changed).**
- `incomeAccount(book, incomeType, now?)` → id: the income twin of `categoryAccount`.
- `setValue(book, account, month, value, now?)` → key: stores a market value (`values`), audited.
- `setSetting(book, key, value, now?)`: changes one of `retained | unexplained | fxGain | firstMonth |
  syncFrom | bankMap` and stamps `settings.at`, so two devices merge the settings by time. Write
  `bankMap` through it, not directly.
- `gateDiffs(ledger, book, opts?)` → the §5 gate on its own (`fromLedgerV2` calls it).
- `seedIds(n)` makes generated ids repeatable (tests); `seedIds(null)` goes back to random.
- `KINDS`, `ROLES`, `ENTRY_KINDS`: the allowed values, as arrays.
- Optional third arguments: `merge(a, b, now?)` (the time stamped on a duplicate it voids) and
  `fromLedgerV2(ledger, now?, opts?)` with `opts.tb = ledgerLib.tb`.

**Ids and time.** `now` is an ISO string; without it the real time is used. Generated ids:
entries `e-YYYYMMDD-xxxx`, accounts `a-xxxxxx`, people `p-xxxxxx`, rules `r-xxxxxx`, audit
`u-xxxxxxxxxx` (random hex, not counters, so two devices never make the same id). An `id` given on
the entry, account, person or rule is kept (refused when taken). Fixed ids where two devices must
agree: the system accounts `a-retained`, `a-unexplained`, `a-fx`; converted accounts `a-<old code>`;
converted entries `e-m-<old journal id>`. `book.updatedAt` only moves forward.

**Return values.** `edit`, `editAccount` → the id. `voidEntry`, `hideAccount`, `lock`, `unlock`,
`removeRule` → `true`, or `false` when there was nothing to do (already void, hidden, locked, open,
removed). `upsertBySource` in a locked month → `{id: <the entry's id, or null when it is new>, action:
'locked'}`. `saved(book, month)` → `{income, spending, saved}`. `income(book, month)` → `{total,
byType: {name: amount}}`. Anywhere a date is taken as `asOf`/`from`/`to`, a month `YYYY-MM` is also
accepted (its last day; for `from`, its first).

**Posting rules.**
- A hidden account may still take a line (hidden only means "off the pickers"; converted history
  needs it). Headers and unknown accounts are refused.
- Source uniqueness is per `(type, ref)` for `email`, `stmt`, `migration`. A void entry frees its
  source, so the same source can be posted again later.
- `kind` defaults to `manual`; an unknown kind is refused. `why` is recorded but not required by
  the engine for `edit` and `voidEntry` (the pages should ask for it); `unlock` requires a reason.
- `voidEntry` is refused in a locked month. A void entry cannot be edited or un-voided.
- An `edit` may change `date, description, kind, lines, number, provisional, source, payer, dir`.
- `upsertBySource` compares date, kind and lines (account, amount, fx). A different description
  alone is "same". When it edits, the description, payer and dir follow the new entry.
- Locks have no order rule (any month can be locked or unlocked on its own). `unlock` keeps the
  record as `{state: 'open', at, reason}` so the other device learns of it.

**Accounts.**
- `kind` follows `role` and can never change; `role` may change within the same kind.
- System accounts: Retained earnings (equity, `3201`), Unexplained differences (expense, role
  `unexplained`, `8990`), Exchange gains and losses (income, role `fx`, `7290`). They cannot be hidden.
- New codes: an account with no `parent` joins the accounts of its role (their most common parent)
  and takes that group's highest code + 1; an empty group starts at `<base>.01`, where the base is
  the parent's code or the role's code in the ERP chart (bank 1121, cash 1111, e-wallet 1113,
  investment 1311, property 1211, receivable 1151, other asset 1499, card 2111, payable 2122, loan
  2121, other liability 2199, equity 3109, income 4909, expense 6909). A `code` given is kept;
  a taken code is refused.
- `categoryAccount` / `incomeAccount` match without regard to case. When no account carries the
  tag but an untagged expense (income) account has that name (a converted one), it takes the tag
  instead of a second account being made.
- `hideAccount` needs an all-time balance of zero. `editAccount(…, {hidden: false})` shows it again.
  An account with entries cannot become a header.
- People: names are unique without regard to case; `type` defaults to `person`. Person accounts
  are named `<name> (owes you)` and `<name> (you owe)`.

**`buildEntry`.**
- It may add accounts to the book (category, income type, person accounts) but posts nothing. It
  checks everything first, so a refused call adds nothing.
- `dir` reverses the lines only for `spending` and `fee` (a refund), and decides the side for
  `adjust` (default `out`: unexplained ← account). Every other answer has one natural direction; a
  `dir` that contradicts it is refused ("Lent is money out, not money in").
- `income`: `amount` is what arrived in the account (net); income is credited with `amount +
  taxWithheld`. No `incomeType` → "Other income". The tax goes to the expense category "Tax".
- `invest-sell`: `toAccount` is the investment sold, `amount` the proceeds, and an extra field
  `d.cost` the book cost taken out (default = `amount`, so no gain line). The difference goes to
  the income type "Investment gain"; a loss debits it.
- `split`: `share + Σ others = amount`. A missing `share` is worked out; `share` 0 writes no expense
  line; without `others`, `{person, share}` means one other person owes the rest.
- `fee` without a category → "Bank fees"; `write-off` without one → "Written off", and it needs no
  `account`. `spending` needs a category.
- `opening`, `manual`, `year-end`, `migrated` take `d.lines` as given.
- `d.fx` is put on the line of `d.account`. `d.payer` is stored upper-cased on the entry (with
  `dir`) for `suggest`. `d.id` is passed through.

**Reports.**
- `balances` lists every account (0 when it has nothing). `tb`, `bs`, `pl` have the old engine's
  shapes (docs/v4-books.md §7) with `account` (the id) added to each row; `ledgerOf` returns one
  account `{account, code, name, kind, role, opening, rows: [{date, id, number, kind, description,
  memo, debit, credit, running, fx?}], debit, credit, closing}`.
- Year-end entries are left out of `pl`, `actualSpending`, `income`, `saved` and of the income and
  spending parts of `bridge` (there they net to zero inside `other`).
- `actualSpending` groups by the account's `category`, else its name; so tax withheld shows as
  "Tax" and write-offs as "Written off". `income` groups by `incomeType`, else the name.
- `people` → `{person (the id), name, type, owedToYou, youOwe, items, oldestDate}`, sorted by name,
  everyone listed. `owedToYou` / `youOwe` are the raw balances of the two person accounts (negative
  when overpaid). `items` are the open items only, `{entry, date, kind, description, side, amount,
  open}`; money back settles the oldest item first, and `oldestDate` is the oldest open item's date
  (null when nothing is open).
- `netWorth`: `liabilities` is a positive number, `net = assets − liabilities`. The market view
  uses a stored value for **any asset account that has one** (not only role `investment`), so
  converted property values are not lost; an account without a value keeps its book balance. A
  value from an earlier month stands until a newer one is stored, even if the book balance moved.
- `bridge` is on the market view: `opening + income − spending + market + fx + unexplained + other
  = closing`, where `spending` is positive and equals `actualSpending().total`, `income` equals
  `income().total`, `fx` and `unexplained` are gains (+) or losses (−) on those two accounts,
  `market` is the change in (market − book), and `other` is what went through equity (opening
  balances). Each part is summed from the lines; none is a balancing figure.
- `suggest(book, {payer, dir})`: the newest live rule for that payer (a rule without `dir` matches
  both ways), else the latest posted §4-kind entry with that payer, read back as `{kind, category?,
  person?, incomeType?, toAccount?}`.

**`merge`.** Returns a new book; the inputs are not touched; `merge(a, b)` and `merge(b, a)` give
the same book. On equal `at`, a tombstone or void wins. `settings` merge as one record (newer `at`).
`audit` is the union by id in time order. The earlier `migration` record is kept. A duplicate
source is voided even in a locked month. Not handled: two devices that each made an account for the
same category or person offline end up with two accounts (the store should save before creating).

**`fromLedgerV2`.**
- The engine cannot reach `ledgerLib`, so by default the gate works the old month-end balances out
  itself from the old posted journals (same rule as `ledgerLib.tb`: posted, non-zero lines, by
  date). The store should pass `{tb: ledgerLib.tb}` so the old engine itself is the yardstick; the
  tests do both and they agree. A diff is `{code, month, old, new}`.
- Entries are written as they are, not through `post` (locked months, hidden accounts). Zero lines
  are dropped, as the old reports do. `createdAt` is the old one.
- Hidden = archived, inactive (`active: false`) or suspended. An old account with an unknown kind
  becomes an asset. A posted line on a code that is not in the old chart gets a hidden
  `other-asset` account named after the code. Expense and income accounts come over without a
  category or income type (see `categoryAccount` above).
- The old Retained earnings account becomes `settings.retained` (role `retained`). The two other
  system accounts are added on the first free codes from `8990` and `7290`.
- Deleted market values are not converted. Values are kept for any account, with their old `at`.
- No lock and no entry at all → `syncFrom` is the first day of the current month.
- Anything that is not `et-ledger/2` is refused with an error.

## Store decisions

Choices made in `js/w2/boot.js` and `js/w2/store.js` where the sections above are silent or were
changed during the build (2026-11-13). Tests: `tests/test_w2_store.py`, run with `python -B tests/run_w2.py`.

**Loader (`boot.js`).**
- **The preview is opt-in per browser.** `boot.js` does nothing (no menu group, no file requested)
  unless localStorage `et_w2_preview` is `'1'`. Opening the app once with `?w2=1` sets it, `?w2=0`
  clears it. With it off the menu, the page list and the console are those of the original app.
- `FILES` lists only files that exist on disk (now `book.js`, `store.js`); a missing file would be a
  404 that the browser logs on every page. The pages helper adds its file when it is finished.
  This replaces the "a missing pages.js must not break anything" case: nothing missing is requested.
- Files load one after another (the next tag is added when the previous one loaded, `async=false`).
  When one fails: one `console.warn`, the files after it are not loaded. `store.js` also stops
  quietly when `bookLib` is absent. `window.w2Boot = {on, loaded, failed, done}` tells what happened.
- The group is pushed before any file loads; a group without pages is not drawn by the core.

**Store API beyond §6** (same file, all on `window`): `book2Flush()` → Promise of `'pushed' | 'skip' |
'blocked' | 'error'` (save now); `book2Unsaved()`; `book2Error()`; `book2Gate()` (the last conversion
attempt: `{ok, at, reason, count, diffs, error?}`); `book2Reset()` (tests, account switch);
`w2Start` (the Start here page's button handlers). Hook: `runHooks('book2Changed', why)` with `why`
= `load | sync | convert | spending-sync | bank-map |` whatever a page passed to `book2Do`.

**Loading and saving.**
- The device cache is one IndexedDB record per Google account (`et-book2`, store `book`, key
  `current|<email>`): `{owner, book, unsaved, counts, at}`. Nothing is loaded while nobody is signed in.
- `book.json` with another schema (or unreadable) → status `blocked`: nothing is saved over it,
  `book2Do` throws, the page says so. A Drive read that fails → status `error` (or `ready` from the
  cache), retried after 30 s, on "Retry", or when the browser comes back online.
- Cache and Drive both exist → `bookLib.merge(drive, cache)`; uploaded only when the cache was marked
  unsaved or the merge differs from Drive's copy. Cache exists and Drive has no file → uploaded
  (as `js/ledger.js` does). Two `book.json` files (two devices created it at once) → every readable
  one is merged into the oldest, which is the one written from then on.
- Compare-and-swap is the core's pattern: read the file's revision, and when it is not the one this
  device last saw, re-read, merge, upload. Drive offers no conditional upload here, so two saves in
  the same second can still overlap; the next save's merge heals it.
- `book2Do(fn, why)` runs `fn` on a **copy** of the book and swaps it in only when `fn` returns, so
  a throw changes nothing. `fn` must be synchronous. Objects read from `BOOK2()` before a change
  are stale afterwards; read again.
- Sign-out does not wait for the 1.5 s save timer: a change made in that window stays in the cache,
  marked unsaved, and is saved on the next sign-in of the same account. (The core's `signOut` only
  flushes the old book and may not be edited.)

**Conversion (`book2Convert`).**
- Returns `{ok, diffs}` plus `reason` when refused: `signed-out` (a live sign-in is required, so the
  new book can be checked against Drive first and saved), `blocked`, `drive` (Drive could not be
  read, so a book may already exist there), `exists` (a new book already exists: never converted
  twice), `no-old-book`, `error` (the engine threw), `diffs` (the gate), `invalid` (below).
- The engine gets a deep copy of `LEDGER()` and `{tb: ledgerLib.tb}`, so the old engine is the gate's
  yardstick (without `ledgerLib` the engine's own yardstick is used).
- **Extra check on top of the gate:** the converted book is kept only when every posted entry has
  at least two lines on accounts that exist, in whole rupiah, summing to 0 (§0 rule 6). The gate
  alone passes an old journal that is unbalanced or carries a fraction of a rupiah, because both
  sides of the comparison carry the same fault. Such a book is refused with `reason: 'invalid'`.
- On success the book is saved to Drive before the function returns, then the spending sync runs.

**Spending sync (`book2SyncSpending`).** Row fields read: `id`; `txDate || msgDate` (through the
core's `txDateOf`; the **local** calendar day, as the original pages group days and months);
`amount` (rupiah; `null` while a foreign charge has no rate); `bank`, or `manualBank` when `bank`
is `'Manual'` (the core's `bankLabel`); `category`; `merchantClean || merchantRaw` (description);
`currency`, `amountOrig`, `fxRate`; `type` (`billing` rows are ignored).
- **The rows carry no refund or credit flag.** A negative `amount` is read as money back (`dir:
  'in'`); nothing else marks a refund today.
- **Failed charges are synced like any other row.** The original totals count every row with an
  amount, whatever its `status` (Declined, Failed), so the new book does the same to stay equal to
  Daily spending. Open question for the owner: a declined charge is not real spending.
- A row split in the original app ("split with N people") is synced at its reduced `amount` (the
  owner's part), because that is the amount the original pages count. The full charge on the card
  is not known to the sync.
- Rows without a rupiah amount are skipped and counted (`noAmount`); rows before `syncFrom`
  are counted (`before`). Manual rows are synced like email rows (source type `email`, ref `tx:<id>`),
  under their own bank label.
- Foreign rows with `amountOrig` pass `fx {ccy, amount, rate}`; when the engine refuses the fx
  figures the row is posted without them.
- Returns `{posted, edited, same, waiting, locked}` plus `noAmount, before, voided, removed,
  review, failed, at`; `null` when there is no book. `book2Counts()` returns the last one (kept in
  the device cache, not in `book.json`).
- **Answered rows** (entry kind other than `spending`): kind and accounts are kept. When the row's
  amount changed, the line on the linked account takes the new amount and the other side follows:
  with two lines the other line mirrors it; with more (a split) the owner's own expense line takes
  the difference. If that would make it zero or flip its sign, nothing changes and the row is
  counted as `review`.
- **Hidden rows:** an entry whose row left `ALL_TRANSACTIONS` is voided with why `hidden`; when the
  row is visible again it is posted again. Voiding is skipped while the list is empty or the email
  data has not loaded, so a failed load can never void the book's spending.
- **Removed by hand:** a row whose latest entry is void for any reason other than `hidden` is not
  posted again (`removed`).
- A linked account that was hidden or removed later counts its rows as `waiting`.
- Re-linking a bank to another account moves that bank's entries from `syncFrom` on to the new
  account at the next sync (locked months are left alone and counted).
- Runs after conversion, after a link changes, on "Sync spending now", and from the `beforeRender`
  hook when a signature of the rows (id, date, amount, category, bank), the links, `syncFrom` or the
  number of locks changed. The hook defers the run to after the render. A run that changes nothing
  does not touch the book and uploads nothing.
- `book2SetBankMap(bank, accountId)` writes through `bookLib.setSetting`; an empty `accountId`
  removes the link; an account that is a header, hidden or unknown is refused.
- `book2Banks()` returns the labels sorted; the page also lists a linked bank with no row left.

**Start here page (`w2-start`)** is registered by `store.js`. The pickers list asset and liability
accounts, bank, card, cash and e-wallet first. Only the amounts of a failed gate are money on this
page; they carry the core's `amt` class, so Hide amounts blurs them.

## Pages decisions

Choices made in `js/w2/pages.js` where §7 and the approved layouts are silent (2026-11-13). Tests:
`tests/test_w2_pages.py` (98 checks; screenshots in `tests/shots/w2/`).

**All four pages.**
- Handlers live on `window.w2Pages`. A small `<style id="w2PagesStyle">` adds layout rules only
  (spacing, wrapping), built from the existing tokens; it is added only when the preview is on.
- The core hides the page header on phones, so the month stepper, the Book / Market switch and the
  People buttons sit in a bar at the top of the page body, not in the header.
- Not ready: signed out, loading (skeleton), Drive error and unreadable file each show one card;
  "no book yet" shows one line and **Open Start here**.
- Sheets show a refusal from the engine in the engine's own words (locked month, name taken).
- Posting from a sheet offers **Undo** in the toast; Undo voids that entry (reason "Undone").

**Spending · actual (`w2-rows`).**
- Lists the posted entries whose source is a bank email, by month. Months run from the month of
  `settings.syncFrom` to the current month; it opens on the latest month that has rows.
- From emails = the rows' amounts (a refund counts negative). Not my spending = what those rows put
  on a person's "owes you" account. Actual spending = `bookLib.actualSpending`. When Actual differs
  from the first minus the second (a write-off, a typed entry), one line under the list says so. The
  mock-up's "+ on statements, no email" line waits for statement lines (later round).
- An answer edits the row's own entry (`bookLib.buildEntry` → `bookLib.edit` with kind and lines),
  keeping its email source; the store's sync treats any email entry whose kind is not `spending` as
  answered. **Mine again** edits it back to `spending` in the row's category (the email row's
  current category, else the entry's last spending category from its history, else "Others").
- Badges: "Owed by …" (paid for), "Split · …", "Reimburse · …", "Lent to …". A row that is wholly
  someone else's is greyed and stays in the list. A refund row has no menu.
- Split: one other person in round 1; the sheet offers half as your own part; your part may be 0.
- **Net worth and "Paid for someone".** The answered entry itself moves nothing in or out of net
  worth (the card owes more, the person owes you the same). Compared with the moment before the
  answer, when the row still counted as spending, net worth is higher by that amount, because money
  owed to you is an asset. The suite checks exactly this, and that **Mine again** restores it.

**People (`w2-people`).**
- "Owed to you" and "You owe" add the positive balances; "Older than 60 days" adds the open
  "owes you" items dated more than 60 days ago. A person with both sides shows both lines.
- **Got repaid / I repaid**: typed amount (prefilled with what is open), date, account (bank, cash
  and e-wallet accounts). More than is open is refused. Picking a matching statement line is later.
- **Lent or borrowed in cash** is one sheet (lent / borrowed, person or a new one, amount, date,
  account, note).
- **Write off**: amount up to what is open, category from the app's categories plus "Written off"
  (the default), dated today.
- **Copy reminder** lists the open "owes you" items and the total; it tries the clipboard and
  falls back to a hidden text box. Nothing is sent. Items are not yet linked to their spending row.
- **Open** shows every movement with what was open after it. Inside one day the page orders the
  movements by when they were entered (the engine orders by id inside a day).

**Net worth (`w2-networth`).**
- Groups: Cash and bank, Investments, Property, Owed to you, Other assets, Credit cards, Loans, You
  owe, Other debts. Debts show as positive amounts. An account shows when it holds something in the
  chosen month (hidden ones too, so the groups add up to the total), or when it is an investment or
  property with a stored value.
- **Update value** on investment and property accounts: month and value → `bookLib.setValue`;
  0 is allowed. Market shows "value this month", "value from <month>" or "no value yet".
- The chart is the 12 months ending at the chosen month, in the chosen view.
- An account's sheet lists its movements up to the end of the chosen month (latest 300): In / Out /
  Balance for assets, Added / Paid / You owe for debts.

**Journals (`w2-journals`).**
- Web table columns: Date, Number, Description with kind and source under it, the lines (Account,
  Debit, Credit), Status. Phones get a list. 100 entries at a time with **Show more**.
- Filters: month, kind, account, status, and a search over description, number, kind, source,
  account names and amounts (3 digits or more).
- **Void** asks for a reason (required by the page). Voiding an entry that came from a bank email
  frees its source, so the next spending sync adds the row again as plain spending; the sheet says so.
- Kind and source names shown: "Copied history" for migrated entries, "Bank email", "Typed in".

## Owner rulings

- 2026-11-13: declined or failed card charges are left out of the new book (the original Daily spending still counts them). The spending sync skips a row the core's `txOk()` rejects, counts it as `declined`, takes out an entry made for it earlier, and posts it again if the row later shows as successful. This replaces Store decision 3.

## 9. Round 2 contract (2026-11-13): Inbox and Month check

§0 still holds in full: read-only towards everything old, new files only, preview off by default,
no personal data. Plan reference: `private/rebuild-plan.html` §7.2 (Inbox) and §7.6 (Month check).

### 9.1 Files and owners

| File | Owner | Holds |
|---|---|---|
| `js/w2/match.js` | Inbox helper | Reads the statement lines the app already holds (the cash data behind Cash movements: `STATE.cash` / `CM()`, and the email-to-statement matches computed by `js/statements.js`), decides per line: covered by an email entry, answered automatically, or waiting in the Inbox. Page `w2-inbox`. |
| `js/w2/store.js` | Inbox helper (edits allowed) | Start here gains "Link your statements" (`settings.stmtMap`: statement account id → book account id). |
| `js/w2/pages.js` | Inbox helper (edits allowed, `w2-rows` only) | The Actual spending strip gains the line "+ on statements, no email". |
| `js/w2/check.js` | Month check helper | Page `w2-check`. |
| `js/w2/book.js` + `tests/w2/*.test.mjs` | Month check helper (additions only; no signature of §3 changes) | `setCheck`, year-end on locking December, anything else the check needs. If the Inbox helper needs an engine addition it asks in its report instead of editing. |
| `js/w2/boot.js` | each helper adds only its own file to `FILES`, after re-reading it | Order: book, store, match, pages, check. |
| tests | `tests/test_w2_inbox.py` + `tests/fixtures/w2-inbox-fixture.js`; `tests/test_w2_check.py` + `tests/fixtures/w2-check-fixture.js` | `tests/run_w2.py` picks up `test_w2_*.py` by itself. Existing w2 suites must stay green. |

### 9.2 Inbox rules

- **Scope:** statement lines dated on or after `settings.syncFrom`, on a statement account linked
  in `settings.stmtMap`. Lines of unlinked accounts are counted as waiting for a link, never
  guessed. Foreign-currency statement accounts are left out in round 2 and counted.
- **One source, one entry:** an entry made from a statement line has
  `source {type:'stmt', ref:'st:'+<line id>}`. A line is never answered twice.
- **Covered by an email entry:** a line the original app matched to an email row is not an Inbox
  item; that row's entry already holds it (and follows the statement amount, because the row
  does). Read the matches from the original's statement module; do not recompute them differently.
  If the matches are not available for an account, its spending-type lines wait in the Inbox with a
  notice instead of being posted, so nothing is counted twice.
- **Answered automatically** (posted without asking, listed under "Answered · automatic", each
  with **Change**):
  - a card payment or a move between own accounts that the statement reader paired, when both
    accounts are linked: one entry for the pair (`card-payment` / `transfer`); both lines count as
    answered. With only one side linked or paired, it waits in the Inbox with that suggestion;
  - bank and card fees, card interest → `fee`; tax on interest → `spending` category "Tax";
    interest and cashback received → `income` (types "Interest", "Cashback");
  - a line that matches a rule (`rules`) the owner saved with "Always for this payer".
- **Everything else waits in the Inbox** with a suggestion, in this order: the type the owner
  already set for that line or payer in Cash movements (read-only: `cashTypeOverrides`,
  `cashPayerRules`), the latest answer the owner gave the same payer in the new book, then the
  statement reader's type (spending with the category `categorize()` gives its description;
  business income → Income; transfer to or from a person → no suggestion, the owner chooses;
  into investments → Investment when an investment account exists).
- **Email alerts not on a closed statement** (the original's review list) appear as their own
  Inbox kind with **Keep as spending** / **Remove** (Remove voids the entry by hand; the sync then
  leaves it out).
- **Answers** are the kinds of §4, through `bookLib.buildEntry` and `book2Do`. Buttons: the
  suggestion (one tap), Spending (category picker), Lent / Paid for… / Got repaid / Borrowed /
  Repaid a debt (person picker with add new), Income (type, optional tax withheld), More ▾ (Between
  my accounts, Card payment, Investment, Split, Company will reimburse, Fee). Undo toast. Tick
  several → answer all; **Always for this payer** saves a rule and shows how many waiting lines it
  will also answer before confirming. "Answered" tab lists answered lines with **Change** (voids
  and re-answers; refused in a locked month).
- **Public functions** (on `window`): `book2Inbox({month?, account?})` → `{items, auto, covered,
  waitingLink, foreign}`; `book2InboxCount(month?)` → number waiting; `book2InboxRun()` → posts the
  automatic answers (idempotent; runs after the spending sync and when the cash data changes).
- "Ask Claude to sort these" is not in round 2.

### 9.3 Month check rules

- **Months:** every finished month from the month of `settings.syncFrom` on, oldest unlocked first.
- **Step 1 · Inbox empty:** `book2InboxCount(month) === 0` (when `match.js` is not loaded the step
  says so and does not block).
- **Step 2 · Balances agree:** per account that holds a balance or moved in the month:
  - linked to a statement: compare the book balance with the statement's closing balance on the
    statement's own date, using the latest statement dated inside the month or at its end (cards
    close mid-month: compare on that date). Equal → "agrees". No statement yet → "statement not in
    yet" (blocks the lock, with **Lock anyway** asking for a reason);
  - different → **Show what differs** (statement lines of the period with no entry; entries on
    that account in the period with no statement line; the remaining difference) and **Adjust**
    (last resort: an `adjust` entry dated the statement date for the difference; it shows as
    "Unexplained" in the bridge);
  - no statement (cash, a loan, a person): **Same as book**, or a counted amount → `adjust` for
    the difference.
  Each result is stored in `checks`.
- **Step 3 · Values and lock:** investments and property show their value for the month with
  **Update value** (optional). **Lock <month>** is enabled when steps 1 and 2 pass. Locking December
  also posts the year-end entry (income and expense accounts to `settings.retained`); unlocking
  December voids it. **Unlock** asks for a reason.
- The page states plainly what a lock means: the month's entries can no longer change until it is
  unlocked.

### 9.4 Verification for round 2

`python -B tests/run_w2.py` green, including: a matched line is not an Inbox item and is not
counted twice (actual spending equals email rows + answered statement-only spending lines); a
paired card payment posts one entry and both lines leave the Inbox; a second `book2InboxRun()`
posts nothing; each answer kind posts the lines of §4 and removes the item; Undo and Change work;
a rule answers the other waiting lines of that payer; a locked month refuses; Month check: agrees /
differs / no statement / adjust / lock / December year-end / unlock; `STATE` and the old book
unchanged throughout; flag off = original; 375 and 1440, light and dark; no console errors.

## 10. Rounds 3 and 4 contract (2026-11-13)

§0 still holds in full. Plan reference: `private/rebuild-plan.html` §7.1 (Home), §7.7
(Performance), §7.8 (Tax), §7.9 (Add), §7.10 (Accountant view incl. Accurate export). Each file has
one owner; nobody edits another owner's file. Only the Accountant helper may edit `js/w2/book.js`
(additions only, node tests first). Each helper adds only its own file to `FILES` in `boot.js`
after re-reading it, and its own `tests/test_w2_<name>.py` + `tests/fixtures/w2-<name>-fixture.js`.

| File | Pages | Content |
|---|---|---|
| `js/w2/perf.js` | `w2-home` "Home · new", `w2-perf` "Performance" | Home: net worth (Book / Market), Actual spending this month with budget %, Saved this month and % of income, **Needs you** (Inbox count, months to check, late statements and card dues read from the original's statement calendar hooks read-only, each with a button to the right page), Owed to you / You owe, 12-month Saved chart. Performance: period Month / Year to date / 12 months; the bridge from `bookLib.bridge` (each line opens the entries behind it; must add up exactly); Spending vs budget per category; Investments (cost, value, gain, return per holding using money put in and taken out, modified Dietz as the original does, months without a value shown as book only); Goals; trends (savings rate, spending, income; runway = cash and bank ÷ 6-month average spending). Budgets and goals: the new book keeps its own (`settings.budgets`, `settings.goals` via `bookLib.setSetting`); on first use it offers to copy the ones in the old `STATE.budgets` / `STATE.goals` (read-only). |
| `js/w2/add.js` | `w2-add` "Add", plus an **Add** button on every w2 page head if that needs no edit to another helper's file (otherwise only its own page and Home links to it) | Six forms: I spent · I received · I lent / paid for someone · I borrowed · I moved money · I bought / sold an investment. Four fields each (date, amount, account, and category / person / type / other account), Save posts at once through `bookLib.buildEntry` + `book2Do` with Undo. `source.type: 'manual'`. **Tell me what happened**: when the owner's Claude key is set (the original exposes `etAI.call` / `etAI.model` from `js/entry.js`; read-only use), one sentence → Claude returns a draft in a strict JSON shape (kind + the `buildEntry` fields, one or several entries) → shown in plain words → Save all / Remove; never posts without the tap; only the sentence, today's date, the account names, people names and category names are sent. Without a key the box explains where to set it. Tests mock the call. A typed entry that a later statement line duplicates: the Inbox suggestion for that line is "Already added by you" (match by account, amount, ±3 days) which links the line to the entry instead of posting a second one; if that needs a hook in `match.js`, expose `book2ManualCandidates(account, amount, date)` here and say so in the report. |
| `js/w2/tax.js` | `w2-tax` "Tax" | Tax year picker. Four totals (income, tax already paid, assets at cost on 31 Dec, debts on 31 Dec). Checklist: months locked, every asset has year bought and cost, every income entry has a type, withholding slips ticked. Sections: income by type with tax withheld; assets (kind, year bought, cost, where held; **Fill** walks through the accounts missing them, stored on `accounts[].tax` via `bookLib.editAccount`); debts; owed to you over one year; foreign-currency holdings. Declared ticks stored in `settings.taxDeclared`. **Download Excel** (ExcelJS loaded the way the original SPT pack loads it), one sheet per section. **Compare with last year**. A plain note that the field list must be confirmed with the tax accountant. |
| `js/w2/acct.js` | `w2-reports` "Reports", `w2-accounts` "Accounts chart", `w2-audit` "Audit", `w2-accurate` "Accurate export" | Reports: Balance sheet, Income statement, Trial balance on three tabs with period and **Compare with** (previous period, same period last year), Excel. Accounts chart: codes, names, kinds, balances; Add, Rename, Hide; Accurate code per account. Audit: every change, filter, Excel. Accurate export per plan §7.10: locked months not yet exported; one summary journal per month dated the last day (each account's net movement; debits = credits; number `ET-YYYY-MM`; description "ExpenseTrack summary <month>"), or every entry; **Download file for Accurate** = Accurate 5's own General Journal import XML, loadable under File › Import with no other tool (take the exact layout from the owner's import tool: project `C:\Users\User\OneDrive\Documents\Claude\Accurate Write`, its `jv_xml` module and tests; copy only the generic layout, no book names, account codes or figures); second button = the same journals as the tool's JSON voucher list; checks before download (every account has an Accurate code, memo ≤ 80 characters, balanced); **Mark as imported** (stored in `settings.accurate.exported[month]`), **Changed after export** list; **Compare balances** from a pasted or loaded balance list (code, balance). Engine: `accounts[].accurateCode`; `fromLedgerV2` sets it from the old account's `oldCode` when present, else its code. |

Not built while the original must stay unchanged: Ask Claude tools for the new book (they live in
`js/assistant.js`), "Not my spending" on the original rows, replacing the original menu. Those
are the switch-over and need the owner's decision.
