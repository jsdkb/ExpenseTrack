# v5 — Ask Claude, the assistant across the app (2026-11-12)

Contract for `js/assistant.js`. The UX is in `UX-GUIDELINE.md` §11.13. The book's rules are in
`docs/v4-books.md`, and the AI key and request basics in `docs/v3-ledger.md` §7–§8.

The owner decided on 2026-11-12:
- The assistant may **navigate**, make **small edits** and draft **new entries**.
- It must **never change the app's architecture**, delete anything, renumber, or make big changes
  to spending.
- Claude **proposes all the changes together with everything they affect**. One approval
  applies them all.
- Claude looks up **only what each request needs**.

No personal data goes in this file or in `js/assistant.js`: the repo is public.

## 1. What exists, and what does not

The allowed list is closed: if an action is not in §4, there is no tool for it. Nothing is
filtered out after the fact. The system prompt names the actions that are not available, so Claude
can explain this and offer `navigate` instead.

**Not available:**
- deleting, hiding, voiding or removing anything (transactions, card markers, budgets, goals,
  drafts, journals, accounts, rules);
- editing an amount or a merchant, splits, FX rates;
- merchant, pattern, auto-note and date-category rules; approving a subscription; card-balance
  exclusions;
- chart of accounts changes (add, edit, archive, retained earnings), re-code;
- periods, set-up, seed, import, merge;
- file imports, backup and restore, Settings, the API key or model, sign-in, sync;
- month-end mapping and counter-accounts, posting the month-end entry, Accurate exports;
- editing a journal that is already posted.

## 2. The request

`window.etAI.call(body, timeoutMs)` is the existing `callClaude` in `js/entry.js`, now exported. It
keeps the same headers, fallback beta and error kinds, and it never adds the key to the body.

```json
{"model": "<Settings › AI model>", "max_tokens": 16000,
 "system": [{"type": "text", "text": "<fixed assistant rules>", "cache_control": {"type": "ephemeral"}}],
 "tools": ["<the fixed tool list, §3–§4; the last one carries cache_control>"],
 "tool_choice": {"type": "auto"},
 "output_config": {"effort": "medium"},
 "messages": [{"role": "user", "content": "<first turn: JSON context + the owner's text>"}]}
```

- **The first user turn** is `{today, page, filters, baseCurrency:'IDR', text}`. It holds no data
  beyond these fields:
  - `page` is `ACTIVE_TAB` plus the sub-view;
  - `filters` covers the period, bank, categories and merchant on the spending pages, the card
    on Cards, and the month on Month-end and Income.
  Later owner turns are appended as plain text.
- **The loop:**
  - While `stop_reason === 'tool_use'`, every `tool_use` block runs locally. All the
    `tool_result` blocks go back in one user message, and the next request follows.
  - The full `content` of each response is appended unchanged, thinking blocks included, so the
    conversation only grows.
  - At most **15 requests** per owner turn. After that the turn stops with "This needed too many
    steps — try a narrower request".
  - `pause_turn` resends the conversation as it is.
  - `refusal` and `max_tokens` end the turn with the §11.10b messages.
  - **Stop** aborts the fetch through an `AbortController` passed to `etAI.call`.
- **Tool inputs** are parsed with `JSON.parse` and checked against the schema in code. A bad input
  or an exception becomes a `tool_result` with `is_error: true` and a short reason.
- **Tool results** are compact JSON with whole rupiah. Each result is capped (rows ≤ 200,
  text ≤ 40 000 characters) and carries `truncated: true` when it was cut. Results never contain
  the key, `STATE` or a whole file.
- **Errors** (no key, 401/403/429, offline, timeout, server) end the turn with the error note. The
  change set being built in that turn is dropped, so no half-built set is ever shown.

## 3. Look-up tools (read only, run at once)

| Tool | Input | Returns (from) |
|---|---|---|
| `overview` | — | The categories (`CATEGORIES` plus any in use). Cards, each with its current outstanding (`ccState`). Months with data (`dataMonths`). Whether the book is set up. The chart of accounts as id, name, kind, ccy, isParent, archived (as `chartForAI`). Budgets and goals, names only |
| `find_transactions` | `from`, `to` (YYYY-MM-DD, required), and optionally `category`, `merchant` (case-insensitive contains), `bank`, `min`, `max`, `text` (in merchant or note), `limit` ≤ 200 | Rows from `ALL_TRANSACTIONS` with no hidden ones: `{id, date, merchant, amount, category, bank, card?, note?, manual?}`, newest first. Also `count` and `total` over every match, not just the rows returned |
| `spending_summary` | `from`, `to`, `group_by`: `category` \| `merchant` \| `month` \| `bank`; optionally `category`, `bank` | Totals and counts per group, using the same rules as `categoryTotals` / `monthSeries` (spending only, splits applied) |
| `card_position` | `card` (one of the cards in `overview`) | `ccState`: balance, since, last payment, days since. The last 6 cycles from `ccHistory` |
| `budgets_goals` | `month` (optional, YYYY-MM) | `EXTRAS.budCompute` rows `{cat, monthly, spent, pct, projected, status}`. `EXTRAS.goalList()` with `goalCalc` `{id, name, kind, target, by, progress, pct, required, status}` |
| `book_report` | `report`: `balances` \| `trial_balance` \| `income_statement` \| `balance_sheet` \| `general_ledger`; optionally `from`, `to` (YYYY-MM-DD or YYYY-MM), and `account` (required for `general_ledger`) | From `ledgerLib` (`tb`, `pl`, `bs`, `gl`), posted journals only. `balances` = the current balance of each posting account that is not zero |
| `list_journals` | optionally `from`, `to`, `status` (`posted` \| `draft` \| `void`), `kind`, `text`, `limit` ≤ 100 | `ledgerView('journals')` rows: `{id, number, kind, status, date, description, lines:[{account, amount, memo}]}` |
| `month_end` | `month` YYYY-MM | Per account: book value, entered value and its source, statement value, difference. Then the journal state (`meJournal`: state, issues), the checklist entries and their ticks, and whether the period is open, closed or locked |
| `income_list` | `month` (optional) | `incList()` rows `{id, date, payer, amount, account, incomeAccount, note, posted}` |
| `cash_movements` | `from`, `to`, optionally `account`, `type` | `CM()` lines `{id, date, account, amount, desc, counterparty, type}`, each with the type in effect (`cashType`), plus totals in and out per month |
| `statement_lines` | `from`, `to`, optionally `account` | Same shape as `stmtLinesForAI` in `js/entry.js`, for that range only, at most 400, with `inBook` |
| `net_worth` | `months` (optional, ≤ 24) | `wTotals` per month: assets, liabilities, net, and the groups |

## 4. Action tools

All of these have `strict: true`. Each one checks its input against the live data the moment
it is called. Only then is the item **queued** in the turn's change set; nothing is written.
- **When the check passes:** the result is `{queued: <item no>, summary, affected}`.
- **When it fails:** the result has `is_error: true` and the reason, for example
  "transaction t-… not found" or "October 2026 is closed".

`navigate` is the one exception: it changes no data, so it runs at once.

| Tool | Input | Checks | Apply | Undo |
|---|---|---|---|---|
| `navigate` | `page` (any key from `BUILTIN_TABS` or the registered pages), optionally `month`, `from`, `to`, `category`, `merchant`, `bank`, `card`, `cards_view` (`current` \| `history` \| `fx`), `account`, `journal` | The page exists | Runs at once: `setTab`, `reportGoTo`, `openLedger`, `openJournals` or `openVoucher`. On phones the sheet then closes | — |
| `set_category` | `transaction_ids[]` (1–200), `category` | Every id is in `ALL_TRANSACTIONS_RAW`; the category is a known one or a new name of ≤ 40 characters | `catOverrides[id] = cat`, plus a `catChangeLog` entry with `rule: false`. **Never** writes `merchantCats` | Put back the earlier override, or remove it, only if it still equals the applied value; take out the log entries |
| `set_note` | `transaction_id`, `note` (≤ 200 characters; empty clears it) | The transaction exists | `notes[id]` | Put back the earlier note |
| `set_budget` | `category`, `monthly` (> 0) | Amount > 0 | `STATE.budgets[cat] = {monthly, since, at}`, the same as `EXTRAS.budSet` | Put back the earlier record (a tombstone or nothing; when there was nothing, write a dated tombstone) |
| `save_goal` | `goal_id` (null for a new goal), `name`, `kind` (`networth` \| `liquid` \| `saving` \| `account`), `target` (> 0), `by` (YYYY-MM), `accounts[]` | The same rules as `EXTRAS.goalSave`; the goal exists when an id is given | Add to or replace in `STATE.goals` | Put back the earlier goal; a new one becomes a dated tombstone |
| `add_journal` | `date`, `description`, `lines[] {account, debit, credit, memo, fx \| null}` | `ledgerValidate`: balanced, posting accounts only, no zero lines. `ledgerPeriodState` of the month is open | `ledgerPost(v, {kind:'ai', why:'Ask Claude'})`, which gives the JV number and the audit entry | `ledgerVoid(id, 'Undo of Ask Claude change set')` |
| `add_income` | `date`, `payer`, `amount`, `into_account`, `income_account`, `note` | The accounts can be posted to; amount > 0; the period is open | Add the receipt to the income store, as `incSave` does. Then, when the own book is set up, `incPostOne` | Void its voucher, then write a dated tombstone for the receipt |
| `add_manual_transaction` | `date`, `merchant`, `amount` (> 0), `category`, `paid_with` (`Cash` \| a card or bank name), `note` | Amount > 0; the date is valid | The same record as `saveAddModal` (`manualTxns`, plus the note) | Remove that manual record (it was created by this set), only if it is unchanged |
| `mark_card_paid` | `card`, `date`, `time` (HH:MM, optional), `note` | The card is known | Push to `payments`, as `addCCPayment` does | Remove that marker (created by this set) |
| `set_month_end_balance` | `month`, `account`, `amount`, `fx` (`{amount, rate}` \| null) | The account is on that month's list; the month-end has been started, or it is started on Apply; the period is not locked | `meStore()[M].pos[code] = {v, fx?, src:'typed', at}`, as `meInput` does | Put back the earlier position |
| `set_cash_type` | `cash_id`, `type` (a key of `CASH_TYPES`) | The line exists | `cashTypeOverrides[id]` for this one line only (never `cashPayerRules`) | Put back the earlier override |
| `tick_checklist` | `month`, `entry_id`, `posted` (bool) | The entry exists for that month. The app journal "J" of an own-book month cannot be ticked (its status comes from the book) | `closeTicks[M][id]` | Put back the earlier tick |
| `set_declared` | `account`, `declared` (bool) | The account exists | `STATE.declared[id]` | Put back the earlier value |

A change set holds at most **200 items**; one `set_category` call counts one item per transaction.
A later proposal for the same target replaces the earlier item, for example the same transaction's
category, or the same budget.

## 5. The change set and "everything affected"

Each queued item is `{no, type, input, before, after, summary, affected[], blocked?}`.
- `before` is read at the moment of the proposal.
- **Affected** is computed by simulating the item on a copy of only the slice involved, not by
  writing anything:
  - **category** and **manual transaction**: the totals of each affected category in each
    affected month, before → after, and the budget's percentage used this month;
  - **budget**: this month's spent, amount and percentage, before → after;
  - **goal**: target, by-date and the monthly amount required, before → after;
  - **journal** and **income**: the balance of each account touched, before → after;
  - **card paid-through**: the card's current outstanding, before → after;
  - **month-end balance**: that account's difference to the book, before → after;
  - **cash type**: that month's in, out and invest totals, before → after;
  - **ticks**: the checklist step's state, before → after.
- The card adds up the affected lines across all items, so a figure touched twice shows once, with
  its final value.
- A line is marked `warn` when a total moves by more than 20% or a budget goes over.
- At the end of a turn Claude writes a short summary. The card shows that summary and the set.
- A new turn that proposes changes builds on the unapplied set: it replaces or adds items.
  **Leave all out** clears the set.

## 6. Apply and Undo

- **Apply all (n)** first checks every ticked item again against the live data. If any item
  fails, nothing is applied and that item shows as blocked.
- It then applies the items in the order of §4's table. It writes `STATE` through the existing
  getters and savers, then calls `scheduleDriveSave()` once and `renderAll()` once. The ledger
  saves itself.
- **If something fails mid-way**, the items already applied are undone in reverse order, using the
  §4 Undo column, and the error is shown.
- **A record** goes to `STATE.aiLog`: `[{id, at, text (the owner's first message, ≤ 200
  characters), items:[{type, summary, ref}], undoneAt?}]`. Only the last 200 sets are kept, and only
  in the private Drive state. No figures beyond each summary are stored.
- **Undo all** works through the §4 Undo column in reverse. An item that was changed after Apply
  is skipped and listed. Journal undo voids the journal (history kept); a void in a closed month
  is refused, and that item is listed. The log entry gets `undoneAt`.
- Undo is available from the toast, from the applied card in this chat, and for the log's entries,
  while the target values still match.

## 7. System prompt (fixed)

The prompt tells Claude:
- the app and the owner: a personal book in rupiah;
- the allowed actions and the not-available list (§1);
- to look things up before proposing anything, and to never invent ids, amounts or accounts;
- to put every change into the change set through the action tools, because none of them write
  anything and the owner approves the whole set;
- to use `navigate` when the owner wants to see something, or when an action is not available
  ("I can't do that, but I can open Books › Periods for you");
- the accounting rules, the same as the journal prompt in `js/entry.js` (posting accounts only,
  whole rupiah, debits equal credits, `fx`);
- to end each turn with a short plain summary of what it found and what it proposes.

## 8. Privacy

- A request carries the first-turn context and only the results of the tools Claude called. The
  key is sent only as the `x-api-key` header.
- The Settings › AI note names both features (reviewer note, 2026-11-12): "when you use “Tell me
  what happened”, it is sent your chart of accounts, account balances, open receivables and
  payables, the last 60 days of statement lines and your sentence; when you use Ask Claude, it is
  sent only what each request needs — the data it looks up (for example the transactions,
  balances or journals in question) and your message. Both go to Anthropic only, never the key."
- The system prompt asks for amounts in full ("Rp 1.500.000"), so Hide amounts can blur them. The
  blur also catches short forms ("1,5 jt", "850k").
- `STATE.aiLog` lives only in the Drive appData state (and its localStorage mirror), like the rest
  of `STATE`.

## 9. Tests (`tests/test_assistant.py`, local-only)

`api.anthropic.com` is mocked inside the page with a scripted queue of responses (`tool_use` turns,
then `end_turn`), and the fake key is `sk-ant-test-0000`. The suite covers:
- **Entry points:** the button and Ctrl+K open the panel on every page; the phone top-bar icon;
  Esc; the no-key state.
- **Request:** the shape (tools, cached system, first-turn context); the key never appears in a
  body; each look-up result is the only data sent; the 15-request cap; Stop; errors; `pause_turn`.
- **Look-ups:** each tool returns the right figures from the fixtures.
- **Each action tool:** a passing input queues an item with its before → after and affected lines;
  a failing one returns `is_error`. **Nothing changes in `STATE` or the ledger before Apply.**
- **Apply all:** every ticked item is written; one unticked item is left alone; a blocked item
  (a closed month) disables Apply; a mid-way failure rolls back.
- **Undo all:** values are restored; a journal is voided with its history kept; an item changed
  since Apply is skipped.
- **The never list:** the tool list holds exactly the §3–§4 names, so no delete, rule, chart or
  period tool exists.
- **`navigate`:** it opens the page and its filters.
- **Layout:** desktop and 375px, light and dark, no sideways scroll; hide amounts blurs the panel.

## 10. Deviations (build, 2026-11-12)

1. **Month-end balance in a month not started yet.** Apply creates the month's record
   (`{pos:{}, market:{}, startedAt}`) without `meStart`'s fill from statements, so only the proposed
   balance changes. Undo puts back the earlier position or, when there was none, a dated `{v:null}`
   (the app's own "cleared" record, so it wins a merge); the month stays started.
2. **Manual transaction.** Written like `saveAddModal` (`manualTxns`, the note in `notes`, the row in
   `ALL_TRANSACTIONS`) but without `saveCache`, so the email cache (`STATE.txns`) is untouched and
   Undo removes the record cleanly. Manual rows come back from `manualTxns` on every load.
3. **One save, one render.** Apply and Undo write through the existing getters (`getCatOverrides()`,
   `getNotes()`, `getManualTxns()`, `getCCPayments()`) and the `STATE` fields, then call
   `scheduleDriveSave()` once and `renderAll()` once. The `save…` wrappers are not called, because
   each schedules its own save. `ledgerPost`, `ledgerVoid` and `incPostOne` still re-render once each
   from inside `js/ledger.js`; the ledger saves itself.
4. **Undo from the log.** Only change sets applied in this tab can be undone (the toast and the
   applied card). `STATE.aiLog` keeps summaries only (§6: no figures), so entries from earlier
   sessions are listed under "Recent change sets" in the empty state but cannot be undone.
5. **Blocked item tick box.** It stays enabled while ticked, so the owner can tick it off and Apply
   the rest; once off it cannot be ticked again until the block clears.
6. **`set_category`.** Transactions already in the requested category are not queued; the tool
   result lists them as `unchanged`. `queued` is a list of item numbers (one per transaction).
7. **Strict schemas.** The action tools' schemas carry no numeric or length limits (`minimum`,
   `maxLength`, `maxItems`); the code checks them and answers `is_error`.
8. **`navigate` closes the sheet** whenever the panel is a sheet (below 1024px: phones and tablet
   portrait), because the sheet covers the page there.
9. **AI journals** also carry `prompt` (the owner's first message of the set, ≤ 2000 characters) and
   `batch` (`as-<set id>`), like the journal AI, so Journals groups them and their history shows the
   request.
10. **`STATE.aiLog` and device merges.** `aiLog` is in `defaultState`. `mergeStates` unions both
    devices' logs by id, sorted by `at`, newest 200, as it does `catChangeLog`. When both
    devices have the same entry, this device's copy wins, so its `undoneAt` is kept. (Added by Alpha
    after the build.)
11. **Affected lines.** A budget's "spent this month" is `EXTRAS.spentIn` (the Budgets page's own
    count) plus the simulated category and manual-transaction changes. Income without the own book
    shows the month's typed income total instead of account balances. The cash type lines always show
    in, out and into investments, also when a total does not move.
12. **Requests** time out after 120 s each; the header's model name is derived from the model id.
