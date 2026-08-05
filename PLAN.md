# CC Expense Tracker — Rebuild Plan

Rebuilding the Cowork-based expense tracker (currently [Artifacts/maybank-cc-tracker/index.html](../Artifacts/maybank-cc-tracker/index.html)) as a standalone web app with Google OAuth, deployable to GitHub Pages.

## Setup decisions (locked in)
- **Auth:** Google Identity Services, browser-only OAuth token flow. Scopes: `gmail.readonly` + `drive.appdata`.
- **OAuth Client ID:** `271369266444-ekr1p1n98npap9sk4uvg0ndkki44385c.apps.googleusercontent.com`
- **Authorized origins:** `http://localhost:5500` (local testing), `https://jsdkb.github.io` (production)
- **Data sync backend:** Google Drive App Data folder (hidden, per-app storage — not the Gmail draft approach originally suggested in the spec, and not visible in the user's normal Drive).
- **Deploy target:** GitHub Pages, repo `https://github.com/jsdkb/ExpenseTrack`, live URL `https://jsdkb.github.io/ExpenseTrack/`
- **Local dev server:** Python `http.server` on port 5500, launched via `.claude/launch.json` config `expense-tracker`.

## Risk review (2026-08-04) — addressed below
Six gaps flagged before continuing: hourly re-login friction, the "unverified app" warning, personal data leaking into the public repo, migrating data off the old Cowork tool, silent parsing breakage, and re-scanning all mail every load / multi-device write conflicts. Each is folded into a step below rather than left as a follow-up.

## Steps

1. **[DONE] Auth + Gmail + Drive connection test**
   Google sign-in, Gmail read scope test, Drive appDataFolder round-trip test. Confirmed working end to end (`index.html` in this folder is the current state of that test page).

2. **[DONE] Token lifecycle: silent refresh**
   Silently request a new access token ~50 minutes in (tokens last ~60min), with no popup, as long as the browser still has an active Google session — only fall back to a visible login prompt if silent renewal fails (e.g. browser closed for days). Cuts the login prompt from hourly to rare.
   *Note, not code:* the "Google hasn't verified this app" warning only appears on that rare full re-auth, not on silent renewals — once this step is in, it's an occasional "Advanced → Go to (unsafe)" click, not a recurring annoyance. No fix needed beyond documenting it in the sign-in UI copy.

3. **[DONE] Port bank email parsers and fetch pipeline**
   Port `cleanMerchant`, `categorize`, `parseTxFromBody` (Maybank), `parseOCBCFromBody`, `parseBCAFromBody`, `parseBillingFromSnippet`, `parseM2UFromSnippet` unchanged from the existing artifact. Replace `window.cowork.callMcpTool` calls with direct Gmail REST API calls (list/search with pagination, get message with base64url body decode) using the access token from step 1.
   *Incremental fetch:* store a "last synced" watermark (timestamp of newest processed email) in the synced data; every load after the first full sync only queries Gmail for messages newer than that watermark, instead of re-scanning everything.

4. **[DONE] Data pipeline and Drive appdata persistence**
   Port the override/edit pipeline (FX rates, date-category rules, merchant cats, category overrides, sub decisions, notes, auto-notes, tx edits, splits, hidden filter, manual txns) and swap localStorage-primary storage for Google Drive appDataFolder sync, keeping localStorage as a write-through cache. Add a sync status badge.
   *Privacy by construction:* all user-specific settings (merchant→category mappings, notes, auto-note rules, date-category rules, FX rates) live only in the private Drive appdata file, never hardcoded into the committed code — the public repo only ever contains generic "how to parse a bank email" logic, not this user's actual categorization habits.
   *Conflict-safe writes:* use the Drive file's revision/ETag on write (compare-and-swap) so two devices saving near-simultaneously don't silently clobber each other — on conflict, re-fetch and merge (or prompt) instead of blind overwrite.

5. **[DONE] Data migration tooling**
   Add an "Export my data" button to the *existing* Cowork tool (`Artifacts/maybank-cc-tracker/index.html`) that downloads everything (notes, edits, overrides, splits, manual entries, CC payment history) as one JSON file. Add a matching "Import my data" button to the new app that loads that file into Drive appdata. Run both tools in parallel for about a week before retiring the old one.

6. **[DONE] Build Overview tab UI**
   Date filter bar, hero stats, category cards, donut chart, month-over-month chart, transaction table with row actions (edit/split/note/category/remove/exclude), manual transaction modal, subscription detector.
   *Note:* built together with steps 7-8 in one mechanical port rather than three separate passes — the old tool's renderAll() dispatches all tabs from one tightly-coupled function sharing helpers (filters, chart rendering, formatters), so splitting it into artificial chunks would have meant re-deriving the same shared code three times for no benefit. Verified working tab-by-tab afterward instead. Also discovered and ported the old tool's **Foreign Currency** tab (a 4th tab, separate from Overview, not called out as its own tab in the original spec doc) since it exists in the actual source.

7. **[DONE] Build CC Position tab UI**
   Current balance hero stats, billing estimator, mark-as-paid-through flow, paid-through history table, outstanding transactions table with exclude toggle. Uses the unfiltered transaction set. Dropped `seedInitialPayment()`'s hardcoded personal payment note (real name/amount/date baked into the old code) — that data now only lives in Drive via the migration import, never in committed code.

8. **[DONE] Build Reporting tab UI**
   All Time / Monthly / Yearly period selector, category breakdown, top merchants/transfers tables, category pie and monthly trend charts.

9. **Parity validation — folded into deployment, not a separate gate**
   Decided (2026-08-04) to skip a dedicated side-by-side pass: real data was already cross-checked extensively while building steps 3-8 (592/293/375 transaction counts across full-sync/refresh/import runs, correct split math against real transactions, category overrides applying correctly, full migration import verified). Remaining validation happens naturally during the parallel-run week (step 5) rather than as a pre-deploy gate.

10. **Deploy to GitHub Pages**
    Pre-push audit: grep the final code for anything personal (real merchant names, category habits, hardcoded rules) before the first commit — should find nothing, since step 4 already keeps that out of the code. Then init git repo, push to `https://github.com/jsdkb/ExpenseTrack`, enable GitHub Pages, verify OAuth works against the production URL.

## Reference

Full spec and business logic (parsers, categories, data model, filtering, UI layout) is documented in the original conversation and mirrored in the existing artifact at `../Artifacts/maybank-cc-tracker/index.html`.
