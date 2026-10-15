# ExpenseTrack — UX Guideline

**Version 1.0 · 2026-10-15 · Status: approved direction, not yet implemented**

This document is the design source of truth for ExpenseTrack on web and mobile. Every UI change
should follow it; anything that needs to break a rule here should update this file first.

It is Phase 1 ("UX foundation") of growing ExpenseTrack from a credit-card tracker into a personal
wealth tracker, so it plans navigation and layout for sections that do not exist yet (Net Worth,
Accounts, Month-end Close).

**Visual reference:** the "Algorithmic Trading Dashboard" (OnlyGenius) by ZeeFrames, an Awwwards
nominee (March 2026) — https://www.awwwards.com/sites/algorithmic-trading-dashboard. We borrow its
*qualities* — near-black cards, a headline KPI row, vivid charts, a strong brand moment — not its
layout pixel-for-pixel or its assets.

> **Privacy rule applies to this file too.** The repo is public. Every number, merchant and date in
> the examples below is a placeholder. Never paste real figures into this guideline or into mockups
> that get committed.

---

## Contents

1. [Design principles](#1-design-principles)
2. [Decisions on record](#2-decisions-on-record)
3. [Information architecture & navigation](#3-information-architecture--navigation)
4. [Layout, grid & breakpoints](#4-layout-grid--breakpoints)
5. [Design tokens](#5-design-tokens)
6. [Typography](#6-typography)
7. [Iconography](#7-iconography)
8. [Components](#8-components)
9. [Data visualisation](#9-data-visualisation)
10. [Mobile patterns](#10-mobile-patterns)
11. [Screen blueprints](#11-screen-blueprints)
12. [States: loading, empty, error, offline](#12-states-loading-empty-error-offline)
13. [Brand moments](#13-brand-moments)
14. [Content, numbers & formatting](#14-content-numbers--formatting)
15. [Motion](#15-motion)
16. [Accessibility](#16-accessibility)
17. [Implementation notes (mapping from today's code)](#17-implementation-notes-mapping-from-todays-code)
18. [Rollout increments](#18-rollout-increments)
19. [Review checklist](#19-review-checklist)
20. [Open items](#20-open-items)

---

## 1. Design principles

1. **Numbers first, chrome last.** The interface is a quiet dark frame; the money is the brightest
   thing on screen. If a decoration competes with a figure, the decoration loses.
2. **Answer the question in one glance.** Every screen opens with the answer to its main question
   ("How much have I spent this month?", "What do I owe and when?") before any detail.
3. **Calm daily, loud rarely.** Bold branding (pixel wordmark, orange→violet glow) is reserved for
   sign-in, first sync and empty states. Screens you look at every day stay calm.
4. **Colour means something.** Accent = interactive. Category colours = the same category everywhere.
   Green/red = good/bad *for you*, not up/down.
5. **Same app, two postures.** Web is for analysis (wide, side-by-side, hover detail). Mobile is for
   checking and fixing (thumb reach, swipe, sheets). Both have full feature parity — mobile reports
   are complete, just re-flowed.
6. **Never lose the user's work.** Destructive actions are undoable; sync state is always visible;
   cached data is labelled as cached.
7. **Private by default.** No personal data in code, in this guide, or in URLs. Optional "hide
   amounts" mode for public places (see [Open items](#20-open-items)).

---

## 2. Decisions on record

| Topic | Decision | Why |
|---|---|---|
| Direction | "Calm terminal" — dark, sleek cards; vivid charts | User liked the reference's dark cards, KPI row, colourful charts and bold branding |
| Primary accent | Blue-violet | Closest to the reference; user's choice |
| Navigation | Web: left sidebar. Mobile: bottom tab bar | Best usability for 4–5 top-level sections: always visible, one thumb-tap away. Hamburger menus measurably reduce navigation use |
| Feel / density | Balanced | User's choice: generous cards, but the key numbers and lists visible without much scrolling |
| Theme | Dark default + manual light toggle in Settings | User's choice |
| Icons | Thin line icons (Lucide), no emoji | User's choice; more premium and consistent |
| Home KPIs | Spend-first: This month spend · CC outstanding/due · Avg per month · Biggest category | User's choice |
| Mobile jobs | Quick status, categorise & notes, review subscriptions, full reports | User uses the phone for all four — so mobile must be complete, not a lite version |
| Scope | ExpenseTrack only, full future IA planned | User's choice |
| Branding placement | Sign-in, first sync, empty states, small sidebar wordmark | Designer's call (delegated): keeps daily screens calm so numbers stand out |
| Font | Inter (UI) + Silkscreen (wordmark only) | Designer's call; see §6 |
| Currency display | `Rp` prefix in UI; `IDR` only where currencies sit side by side | Local convention, shorter; see §14 |

---

## 3. Information architecture & navigation

### 3.1 Sitemap

| Section | Contains | Comes from today | Ships in |
|---|---|---|---|
| **Overview** (home) | KPI row, spend trend, category breakdown, transactions list, subscriptions to review | Overview tab | Phase 1 |
| **Spending** | Trend analysis, categories, top merchants, top transfers, recurring charges, bank split | Reporting tab | Phase 1 |
| **Credit Cards** | Per-card position, estimated billing, paid-through history, current-balance transactions; sub-tab **Foreign currency** | CC Position + Foreign Currency tabs | Phase 1 |
| **Net Worth** | Net worth over time, assets vs liabilities, change drivers | — | Phase 2 |
| **Accounts** | All accounts grouped by type, balances, last updated | — | Phase 2 |
| **Month-end Close** | Guided close: enter positions → review diff → journal list → re-check → done | — | Phase 3 |
| **Settings** | Appearance (theme), categories & rules, auto-note rules, date-category rules, FX rates, data (sync, export, sign out), about | Scattered controls today | Phase 1 |

**Rule: sections appear in navigation only once their phase ships.** No "coming soon" tabs.

### 3.2 Web — left sidebar

```
┌──────────────────────┐
│ ▣ EXPENSETRACK       │  ← small pixel wordmark (brand), 56px tall area
├──────────────────────┤
│ ◎ Overview           │  ← active: accent-soft fill, accent-text label, 3px left bar
│ ◔ Spending           │
│ ▭ Credit Cards       │
│ ─ WEALTH ─────────── │  ← group label, appears when Phase 2 ships
│ ◇ Net Worth          │
│ ▤ Accounts           │
│ ✓ Month-end Close    │
│                      │
│        (spacer)      │
├──────────────────────┤
│ ● Synced · 2m ago    │  ← sync status, click = sync now
│ ⚙ Settings           │
│ (avatar) Signed in ▾ │  ← menu: Export, Sign out
└──────────────────────┘
```

- Width **240px** at ≥1024px; **72px icon-only rail** at 768–1023px (labels appear as tooltips).
- Item: 40px tall, 12px horizontal padding, icon 18px + label 14/500, radius 10.
- Keyboard: ↑/↓ moves between items, Enter activates; the sidebar is a `<nav>` landmark.

### 3.3 Mobile — bottom tab bar + top app bar

```
┌─────────────────────────────┐
│ Overview      ⟳●  [This mo▾] + │ ← top app bar 56px: title · sync dot · period chip · add
├─────────────────────────────┤
│                             │
│          content            │
│                             │
├─────────────────────────────┤
│  ◎      ◔      ▭      ⋯     │ ← bottom bar 64px + safe-area inset
│ Overview Spending Cards More │
└─────────────────────────────┘
```

- **Phase 1 tabs:** Overview · Spending · Cards · More. **Phase 2+:** Overview · Spending · Cards ·
  Net Worth · More. Never more than 5.
- **More** opens a full page list: Accounts, Month-end Close, Settings, Export, Sign out.
- Active tab: accent icon + label, a 32×4px accent pill above the icon. Inactive: text-3.
- Tapping the active tab again scrolls its page to top.
- The bar hides on scroll-down and returns on scroll-up only inside long lists; elsewhere it is fixed.

### 3.4 Page header (web)

Every page has the same header row:

```
Page title                                   [Period: This month ▾]  [ + Add ]  [⟳]
One-line description in text-2
```

Title 22/600, description 14 text-2. Right side: page-level period picker (§8.6), primary action,
refresh. Credit Cards adds a card switcher (§11.4).

---

## 4. Layout, grid & breakpoints

| Name | Width | Nav | Columns | Page padding | Gutter |
|---|---|---|---|---|---|
| `xs` | < 480 | bottom bar | 4 | 16 | 12 |
| `sm` | 480–767 | bottom bar | 4 | 16 | 12 |
| `md` | 768–1023 | 72px rail | 8 | 24 | 16 |
| `lg` | 1024–1439 | 240px sidebar | 12 | 32 | 20 |
| `xl` | ≥ 1440 | 240px sidebar | 12 | 32 | 24 |

- Content max-width **1360px**, left-aligned next to the sidebar (not centred — avoids a floating
  island on ultrawide screens).
- Vertical rhythm between card rows: **20px** (lg+), **12px** (mobile).
- Replace today's single 640px breakpoint with the set above. Mobile behaviour starts at `< 768`.
- Card spans (12-col): KPI 3 each · main chart 8 + side card 4 · full-width tables 12.
  On `md`: KPI 4 each (2×2) · charts 8 full. On mobile everything is full width except KPIs (2×2).

---

## 5. Design tokens

All tokens are CSS custom properties on `:root`, overridden under `[data-theme="light"]`.
Names are semantic (what it's *for*), never literal (what colour it *is*).

### 5.1 Colour — surfaces & text

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--bg` | `#0A0A0F` | `#F6F6F9` | App background |
| `--bg-nav` | `#0E0E14` | `#FFFFFF` | Sidebar, bottom bar, top bar |
| `--surface-1` | `#13131A` | `#FFFFFF` | Cards |
| `--surface-2` | `#1A1A23` | `#F0F0F5` | Inputs, hover, nested panels, table header |
| `--surface-3` | `#20202B` | `#FFFFFF` | Popovers, menus, sheets, tooltips |
| `--border` | `rgba(255,255,255,0.06)` | `rgba(10,10,20,0.08)` | Card and divider lines |
| `--border-strong` | `rgba(255,255,255,0.12)` | `rgba(10,10,20,0.16)` | Inputs, focused/selected outlines |
| `--text-1` | `#F4F4F7` | `#0E0E14` | Primary text, numbers |
| `--text-2` | `#A1A1AE` | `#4B4B57` | Secondary text, descriptions |
| `--text-3` | `#8A8A98` | `#6B6B78` | Labels, axis ticks, timestamps (≥4.5:1 on every surface) |
| `--scrim` | `rgba(0,0,0,0.6)` | `rgba(10,10,20,0.35)` | Behind sheets and modals |

Dark mode shows depth with **lighter surfaces, not shadows**. Only `--surface-3` items get a shadow:
`0 12px 32px rgba(0,0,0,0.5)` (dark) / `0 12px 32px rgba(20,20,40,0.12)` (light).

### 5.2 Colour — accent & brand

| Token | Dark | Light | Use |
|---|---|---|---|
| `--accent` | `#5B5BF0` | `#4F46E5` | Primary button fill, active pill, toggles (white text passes 4.5:1) |
| `--accent-hover` | `#6C6CFF` | `#4338CA` | Hover/pressed fill |
| `--accent-text` | `#9A9AFF` | `#4338CA` | Links, active nav label, accent text on dark surfaces |
| `--accent-soft` | `rgba(108,108,255,0.14)` | `rgba(79,70,229,0.10)` | Active nav background, selected chip |
| `--grad-primary` | `linear-gradient(135deg,#3B82F6 0%,#7C5CFF 100%)` | same | Main trend chart line/fill, progress bars |
| `--grad-brand` | `radial-gradient(120% 120% at 50% 100%,#FF5A1F 0%,#C2410C 35%,#4C1D95 75%,#0A0A0F 100%)` | same | Brand moments only (§13) |

### 5.3 Colour — semantic

| Token | Dark | Light | Soft background (dark / light) |
|---|---|---|---|
| `--good` | `#34D399` | `#047857` | `rgba(52,211,153,0.14)` / `rgba(4,120,87,0.10)` |
| `--bad` | `#F87171` | `#B91C1C` | `rgba(248,113,113,0.14)` / `rgba(185,28,28,0.10)` |
| `--warn` | `#FBBF24` | `#92400E` | `rgba(251,191,36,0.14)` / `rgba(146,64,14,0.10)` |

Light `--bad` / `--warn` were darkened from `#DC2626` / `#B45309` during implementation (2026-10-15):
the originals measured 4.25:1 and 4.42:1 on `--surface-2`, below the 4.5:1 floor in §16.
| `--info` | `#60A5FA` | `#2563EB` | `rgba(96,165,250,0.14)` / `rgba(37,99,235,0.10)` |

**Meaning rule:** colour the *consequence*, not the direction.

| Metric | Goes up | Goes down |
|---|---|---|
| Spend, CC outstanding, fees | `--bad` | `--good` |
| Net worth, savings, income | `--good` | `--bad` |
| Change within ±2% | `--text-2` (neutral) | `--text-2` |

Always pair colour with an arrow (▲/▼) and a sign, so meaning never depends on colour alone.

### 5.4 Colour — categories

Fixed: a category keeps its colour on every chart, chip and row, in both themes. Replaces today's
muted `CATEGORIES` colours with a vivid set tuned for the dark UI.

| Category | Dark | Light | Lucide icon |
|---|---|---|---|
| Food & Dining | `#FF8A3D` | `#EA580C` | `utensils` |
| Groceries | `#34D399` | `#059669` | `shopping-basket` |
| Transport | `#3B82F6` | `#2563EB` | `car` |
| Shopping | `#EC4899` | `#DB2777` | `shopping-bag` |
| Tech & Subscriptions | `#8B5CF6` | `#7C3AED` | `laptop` |
| Travel | `#22D3EE` | `#0891B2` | `plane` |
| Fuel | `#FACC15` | `#CA8A04` | `fuel` |
| Telecom | `#14B8A6` | `#0D9488` | `smartphone` |
| Entertainment | `#F43F5E` | `#E11D48` | `clapperboard` |
| Sports | `#84CC16` | `#65A30D` | `dumbbell` |
| Religion | `#C084FC` | `#9333EA` | `heart-handshake` |
| Foreign | `#F59E0B` | `#D97706` | `globe` |
| Ad Hoc | `#E879F9` | `#C026D3` | `pin` |
| Transfer | `#94A3B8` | `#64748B` | `arrow-left-right` |
| Others | `#6B7280` | `#6B7280` | `circle-ellipsis` |

- **User-created categories** (stored in Drive) get a colour from an overflow ring
  (`#A3E635 #2DD4BF #FB923C #F472B6 #818CF8 #FDE047`) chosen by a stable hash of the name, and the
  `tag` icon.
- Transfer and Others are deliberately grey: they are not "real" spend and should recede in charts.

### 5.5 Spacing, radius, size

| Token | Value |
|---|---|
| `--space-1 … --space-12` | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 (px; 4px base) |
| `--radius-xs` | 6 — badges, tiny chips |
| `--radius-sm` | 10 — buttons, inputs, nav items, rows |
| `--radius-md` | 14 — cards |
| `--radius-lg` | 20 — sheet top corners, modals |
| `--radius-pill` | 999 — chips, segmented control, status pill |
| `--card-pad` | 20 (lg+) · 16 (mobile) |
| `--tap-min` | 44 — minimum touch target |
| `--topbar-h` / `--bottombar-h` | 56 / 64 (+ `env(safe-area-inset-bottom)`) |

---

## 6. Typography

**Families**

- **Inter** (Google Fonts, weights 400/500/600/700) for everything. Enable tabular figures on all
  numbers: `font-variant-numeric: tabular-nums;` — every digit is the same width, so amounts line up
  and don't jitter when they change.
- **Silkscreen** (Google Fonts, 400/700) — pixel font, **wordmark and brand moments only**. Never for
  body text, numbers or buttons.
- Fallback stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

**Scale**

| Role | Web | Mobile | Weight | Notes |
|---|---|---|---|---|
| `display` | 40/44 | 32/36 | 600 | Hero number on Net Worth / sign-in |
| `kpi` | 28/32 | 22/28 | 600 | KPI values; tabular |
| `h1` page title | 22/28 | 20/26 | 600 | |
| `h2` card title | 15/20 | 15/20 | 600 | |
| `body` | 14/20 | 15/22 | 400 | Mobile body slightly larger for readability |
| `body-strong` | 14/20 | 15/22 | 600 | Merchant names, amounts in rows |
| `small` | 13/18 | 13/18 | 400 | Descriptions, secondary row line |
| `label` | 12/16 | 12/16 | 500 | KPI labels, table headers; +0.02em tracking |
| `micro` | 11/14 | 11/14 | 500 | Badges, chart ticks. Never smaller than 11 |

- Form inputs on mobile use **16px** text — anything smaller makes iOS Safari zoom the page on focus.
- Currency prefix inside a KPI renders at 60% of the value size in `--text-2`
  (e.g. <small>Rp</small> **12.345.678**).
- Sentence case everywhere ("Biggest category", not "BIGGEST CATEGORY"). Uppercase only for the pixel
  wordmark and sidebar group labels (`micro`, 0.08em tracking, `--text-3`).

---

## 7. Iconography

- **Set:** Lucide (ISC licence), outline style, **1.75px stroke**, sizes 16 (inline), 18 (nav, buttons),
  20 (bottom bar), 24 (empty states use 40–48).
- **Delivery:** inline SVG `<symbol>` sprite at the top of `index.html`, used via
  `<svg><use href="#i-car"/></svg>`. No icon CDN, no build step — fits the single-file rule.
- Icons inherit `currentColor`. Category icons sit in a 28px rounded square (`--radius-sm`) filled
  with the category colour at 16% opacity, icon in the full category colour.
- **No emoji anywhere in the UI.** Table titles today such as "📋 Estimated Billing" become
  icon + title (`receipt` + "Estimated billing").

Core icon map:

| Use | Icon | Use | Icon |
|---|---|---|---|
| Overview | `layout-dashboard` | Sync | `refresh-cw` |
| Spending | `chart-pie` | Add | `plus` |
| Credit Cards | `credit-card` | Edit / note | `pencil` |
| Net Worth | `trending-up` | Split | `split` |
| Accounts | `landmark` | Delete | `trash-2` |
| Month-end Close | `calendar-check` | Category | `tag` |
| Settings | `settings` | Subscriptions | `repeat` |
| More | `ellipsis` | Export | `download` |
| Foreign currency | `globe` | Filter | `sliders-horizontal` |
| Calendar / period | `calendar` | Search | `search` |

---

## 8. Components

Each component lists anatomy, states, and web vs mobile differences.

### 8.1 Card (base container)

- `--surface-1`, 1px `--border`, `--radius-md`, padding `--card-pad`.
- **Header:** icon (optional, 16, `--text-3`) + title (`h2`) + optional description (`small`, `--text-2`)
  on the left; optional per-card control (period dropdown, "See all" link) on the right.
- Hover (web, only if the whole card is clickable): border → `--border-strong`, 120ms.
- Never nest a card in a card; use `--surface-2` panels inside instead.

### 8.2 KPI card

```
┌────────────────────────────┐
│ [icon] This month spend    │  label 12/500 text-3, icon in 24px soft square
│ Rp 12.345.678              │  kpi 28/600 text-1 (prefix 60% text-2)
│ ▲ 8% vs last month         │  micro/small, coloured by meaning (§5.3)
└────────────────────────────┘
```

- Row of 4 on `lg+`, 2×2 grid on `md` and mobile (KPI value drops to 22px).
- Optional 7-point sparkline in the bottom-right on `lg+` only (40×20, stroke 1.5, no axes).
- Clickable → jumps to the detail (e.g. Biggest category → Spending filtered to that category).
- **Biggest category** KPI shows the category chip (icon + name) as the value, amount as the sub-line.
- **CC outstanding / due** KPI sub-line shows the due countdown: "Due in 6 days · 25 Oct";
  `--warn` when ≤ 7 days, `--bad` when overdue.
- Loading: skeleton bars at the exact sizes of label/value/sub-line (§12).

### 8.3 Buttons

| Variant | Look | Use |
|---|---|---|
| Primary | `--accent` fill, white text, 600 | One per view: Save, Add, Sync now |
| Secondary | `--surface-2` fill, 1px `--border-strong`, `--text-1` | Cancel, Export, secondary actions |
| Ghost | transparent, `--text-2`, hover `--surface-2` | Toolbar actions, "See all" |
| Destructive | `--bad` text on `--bad` soft fill; solid `--bad` only inside a confirm | Delete |
| Icon button | 36px square (44 on mobile), ghost style, needs `aria-label` | Refresh, close, more |

Sizes: 36px tall (web), 44px (mobile). Radius `--radius-sm`. Pressed: scale 0.98, 120ms.
Disabled: 40% opacity, no hover. Loading: label stays, spinner replaces the icon, width does not change.

### 8.4 Chips & badges

- **Filter chip** (pill, 32px): `--surface-2`; selected = `--accent-soft` + `--accent-text` + check icon.
- **Category chip:** 24px tall pill, category icon + name, category colour at 16% fill, text `--text-1`.
  Tappable wherever it opens the category picker.
- **Status badge** (`micro`, `--radius-xs`): `OK` (good), `Fail` (bad), `Pending` (warn),
  `Excluded` (neutral `--surface-2`). Replaces today's "✓ OK / ✗ Fail" spans.
- **Bank badge:** neutral badge with the bank's short code; no bank logos (trademark + extra assets).

### 8.5 Inputs

- 40px tall (web) / 48px (mobile), `--surface-2`, 1px `--border-strong`, `--radius-sm`, 16px text on
  mobile.
- Label above (`label` style), helper/error text below (`small`; error in `--bad` with icon).
- Focus: 2px `--accent-text` ring, 2px offset.
- Amount inputs: `inputmode="numeric"`, live thousands separators, `Rp` prefix inside the field.
- Selects use the custom dropdown (§8.7) on web, a bottom sheet list on mobile.

### 8.6 Period picker

One **page-level period** drives every card on the page. Options (kept from today): This week ·
This month (default) · Last month · This year · All time · Custom range.

- **Web:** a pill dropdown in the page header showing the active period ("This month ▾"). Custom
  opens a two-month calendar popover with Apply/Cancel.
- **Mobile:** a period chip in the top app bar; tap opens a bottom sheet with the options as a list
  and a date-range picker for Custom.
- **Per-card override** only for cards whose job is a *range* (e.g. the trend chart's
  "Last 6 months ▾ / 12 months / All"), shown as a small ghost dropdown in that card's header —
  exactly like the reference. Cards never silently use a different period from the page.
- The active period is written in each card's sub-title when it differs from obvious
  ("Top 10 spending · This month").

### 8.7 Dropdown / menu / popover

`--surface-3`, `--radius-sm`, shadow, 8px padding, items 36px with 16px icon. Keyboard navigable,
Esc closes, focus returns to the trigger. On mobile every menu becomes a bottom sheet.

### 8.8 Tables (web)

- Header row: `--surface-2`, `label` style, sticky when the table scrolls.
- Rows 44px, 1px `--border` dividers, hover `--surface-2`. Numbers right-aligned, tabular.
- Column order for transactions: Date · Merchant (+ note line) · Category chip · Bank · Amount ·
  row actions (visible on hover: edit, split, delete; always visible on focus).
- Sortable headers show a sort arrow; current sort is announced via `aria-sort`.
- Long tables paginate at 50 rows or use "Show more"; never render thousands of rows at once.
- **Below 768px tables become row lists (§8.9).** Never shrink a table to fit a phone.

### 8.9 Transaction row (list item — mobile, and compact web lists)

```
┌──────────────────────────────────────────┐
│ [■ icon]  Merchant name          -Rp 85.000│
│           Category · Bank · 14 Oct    note ✎│
└──────────────────────────────────────────┘
```

- 64px tall, 16px padding. Leading 36px category square; title `body-strong`; second line `small`
  `--text-2`; amount `body-strong` right-aligned. Refunds/credits show `+Rp` in `--good`.
- Grouped by day with sticky day headers ("Today", "Yesterday", "Mon 13 Oct") and a day total.
- Tap → transaction detail sheet. Swipe → actions (§10.2). Long-press → multi-select mode
  (bulk categorise) — see [Open items](#20-open-items).

### 8.10 Progress bar & tracker

Borrowed from the reference's "Certification progress tracker", used for paid-through progress,
budget usage (future) and the Month-end Close stepper.

- Track 8px, `--surface-2`, pill radius; fill `--grad-primary`; value label right-aligned above.
- Over 100% (e.g. over budget): fill turns `--bad`, overflow shown as a striped segment.
- Stepper: numbered dots joined by a line; done = `--good` check, current = `--accent` ring,
  upcoming = `--text-3`.

### 8.11 Sheets, modals, toasts

- **Mobile bottom sheet:** `--surface-3`, top radius `--radius-lg`, 4×36px drag handle, snap points
  50% and 92%, swipe-down or scrim tap to close (asks first if there are unsaved edits). Primary
  action sits in a sticky footer above the safe area.
- **Web modal:** centred, max 520px wide (720 for split editor), `--radius-lg`, Esc closes, focus
  trapped. Used for Edit, Add, Split (today's `openEditModal`, `openAddModal`, `openSplitModal`).
- **Toast:** bottom-centre (above the bottom bar on mobile), `--surface-3`, max 1 line + action,
  auto-dismiss 5s, pauses on hover. Every destructive action gets an **Undo** toast instead of an
  "Are you sure?" dialog.
- **Banner:** full-width inside the content area for persistent states (offline, sync failed,
  re-auth needed), with one action button.

### 8.12 Sync status

Always visible: sidebar footer (web), a dot in the top app bar (mobile; tap opens a status sheet).

| State | Look | Text |
|---|---|---|
| Synced | `--good` dot | "Synced · 2 min ago" |
| Syncing | spinning `refresh-cw`, `--accent-text` | "Syncing Gmail… 120 new" |
| Saving to Drive | pulsing `--info` dot | "Saving…" |
| Conflict merged | `--info` dot + toast | "Merged changes from another device" |
| Failed | `--bad` dot + banner | "Sync failed — Retry" |
| Needs sign-in | `--warn` dot + banner | "Session expired — Sign in again" |

---

## 9. Data visualisation

Library stays **Chart.js 4.5** (already a dependency). Apply one global theme (§17.3) so every chart
matches automatically.

### 9.1 Chart choice

| Question | Chart | Notes |
|---|---|---|
| How is spend trending over time? | **Area line** with `--grad-primary` fill (fades to 0% at the bottom) | Hero chart of Overview and Spending — echoes the reference's "Equity overview" |
| Which months were high/low? | **Vertical bars**, single colour (`--accent`), current month highlighted, others at 55% opacity | |
| Where does the money go? | **Ranked horizontal bars** in category colours, value + % on the right | Primary category view. Replaces donuts as the main breakdown |
| Share at a glance | Small **donut** (≤ 6 slices + "Other"), 60% cutout, total in the centre | Secondary only, never the sole breakdown |
| Category mix per month | **Stacked bars** (top 5 categories + Other) | Spending page |
| Split by bank / card | **100% stacked bar** (one bar) with legend below | Replaces today's bank donut |
| Net worth over time (Phase 2) | Area line, `--good`/`--bad` fill by sign of period change | |
| Assets vs liabilities (Phase 2) | Diverging horizontal bars | |

### 9.2 Styling rules

- Gridlines: horizontal only, `rgba(255,255,255,0.05)` (light: `rgba(10,10,20,0.06)`); no vertical
  gridlines, no axis border lines.
- Ticks: `micro` 11px, `--text-3`. Y-axis uses compact money (`12,5 jt`), max 5 ticks.
- Lines: 2px, `tension: 0.4` (smooth, like the reference), no point dots; a 6px dot + vertical
  crosshair on hover.
- Bars: `borderRadius: 6`, `maxBarThickness: 28` (web) / `18` (mobile), 4px gaps.
- **Legends:** Chart.js legend off; render an HTML legend (category chips) under the chart so it is
  readable, wraps on mobile and is clickable to toggle a series.
- Tooltip: `--surface-3`, 1px `--border-strong`, `--radius-sm`, title `label`, values `body-strong`
  tabular, category colour square per line.
- Animation: 400ms ease-out on first render only; no animation on period change re-renders (just swap).
- Max **one y-axis** per chart. Two measures → two charts.
- Empty data: keep the axes, show "No spending in this period" centred in `--text-3`.

### 9.3 Mobile charts

- Full card width, height 200px (trend) / auto for ranked bars (32px per row).
- Show at most 6 x-axis labels; abbreviate months ("Jan").
- Touch: tap-and-hold scrubs the crosshair; the value shows in a fixed readout above the chart
  instead of a floating tooltip covered by the finger.
- Ranked bars show top 8 + "Show all categories" link.

### 9.4 Accessible charts

Every chart card has a "View as table" toggle (icon button `table`) and an `aria-label` sentence
summarising the main finding, e.g. "Spend this month Rp 12,3 jt, up 8% on last month; biggest
category Food & Dining."

---

## 10. Mobile patterns

### 10.1 Thumb-zone layout

Status (read-only) lives at the top; everything you *tap often* — tabs, sheet actions, swipe
targets — lives in the bottom two-thirds. Primary sheet buttons are full-width at the bottom.

### 10.2 Swipe actions on transaction rows

Kept from today (recent work), standardised:

| Gesture | Reveals | Notes |
|---|---|---|
| Swipe left (short) | **Category** · **Split** · **Delete** | 72px each; Delete is `--bad`, rightmost |
| Swipe left (full) | Delete immediately | Then an Undo toast for 5s |
| Swipe right | **Note** (edit note) | Quick annotate |

- A haptic tick (where supported) when crossing the full-swipe threshold.
- Only one row open at a time; scrolling closes open rows.
- Every swipe action is also available from the row's detail sheet (swipes are a shortcut, not the
  only path — needed for accessibility and discoverability).
- First-run hint: the first row peeks open 24px once, with a one-line tip.

### 10.3 Pull to refresh

Pull down on any top-level page to run an incremental Gmail sync. The indicator uses the accent
gradient; success shows "12 new transactions" as a toast; nothing new → "Up to date".

### 10.4 Sheets over pages

Edit, add, split, category picker, period picker, filters and sync status all open as bottom
sheets — the user never loses their scroll position in the list.

### 10.5 Category picker sheet

Search field at top (autofocus off by default on mobile so the keyboard doesn't jump), recent
categories as chips, then the full list with icon squares. Option at the bottom: "Always use this
category for *Merchant*" (writes a rule to Drive, never to code).

### 10.6 Subscriptions review (mobile job)

A card on Overview: "3 recurring charges to review" → full page list. Each row: merchant, average
amount, months seen, last charged, and two buttons: **Keep** / **Flag to cancel**. Flagged items
stay in a "To cancel" group until they stop appearing.

---

## 11. Screen blueprints

Wireframes are structural, not pixel-exact. All numbers are placeholders.

### 11.1 Sign-in (brand moment)

**Web**
```
┌───────────────────────────────────────────────────────────────┐
│                 (--grad-brand glow fills the lower half)      │
│                                                               │
│                 E X P E N S E T R A C K   (Silkscreen 64px)   │
│              Your cards, spending and wealth — in one place.  │
│                                                               │
│                    [  G  Continue with Google  ]              │
│        Read-only Gmail + private app storage in your Drive.   │
│     "Google hasn't verified this app" may appear — expected.  │
└───────────────────────────────────────────────────────────────┘
```
**Mobile:** same stack, wordmark 32px, button full width, explanation text collapsible
("Why these permissions?").

### 11.2 Overview (home)

**Web (lg)**
```
┌ Sidebar ┐┌────────────────────────────────────────────────────────────────┐
│         ││ Overview                          [This month ▾] [+ Add] [⟳]   │
│         ││ Your spending at a glance                                       │
│         ││┌──────────┐┌──────────┐┌──────────┐┌──────────┐                │
│         │││This month││CC owed   ││Avg/month ││Biggest   │  ← KPI row     │
│         │││Rp 12,3 jt││Rp 8,1 jt ││Rp 10,9 jt││[Food]    │                │
│         │││▲ 8%      ││Due in 6d ││12 months ││Rp 3,2 jt │                │
│         ││└──────────┘└──────────┘└──────────┘└──────────┘                │
│         ││┌─ Spend trend ───────[6 mo ▾]─┐┌─ Where it went ──────────┐   │
│         │││   area chart (8 cols)         ││ ranked category bars     │   │
│         │││                               ││ (4 cols), top 6 + Other  │   │
│         ││└───────────────────────────────┘└──────────────────────────┘   │
│         ││┌─ Transactions ────────[search][filter]──────────────────────┐ │
│         │││ table (12 cols), 50 rows, Show more                          │ │
│         ││└──────────────────────────────────────────────────────────────┘ │
│         ││┌─ Recurring charges to review (3) ───────────────[See all]───┐ │
│         ││└──────────────────────────────────────────────────────────────┘ │
└─────────┘└────────────────────────────────────────────────────────────────┘
```

**Mobile**
```
┌─────────────────────────────┐
│ Overview   ●  [This month▾] +│
├─────────────────────────────┤
│ ┌────────────┐┌────────────┐│
│ │This month  ││CC owed     ││  2×2 KPIs = the quick status,
│ │Rp 12,3 jt  ││Rp 8,1 jt   ││  fully above the fold
│ │▲ 8%        ││Due in 6d   ││
│ └────────────┘└────────────┘│
│ ┌────────────┐┌────────────┐│
│ │Avg/month   ││Biggest     ││
│ └────────────┘└────────────┘│
│ ┌ 3 recurring to review   ›┐│
│ ┌ Spend trend ─────[6 mo▾]─┐│
│ │ area chart, 200px        ││
│ └──────────────────────────┘│
│ ┌ Where it went ───────────┐│
│ │ top 5 ranked bars        ││
│ └──────────────────────────┘│
│ Today                -Rp 120rb│
│ [■] Merchant      -Rp 85.000 │  ← swipeable rows
│ [■] Merchant      -Rp 35.000 │
│ Yesterday ...                │
├─────────────────────────────┤
│ Overview Spending Cards More │
└─────────────────────────────┘
```

### 11.3 Spending (was Reporting)

Question it answers: *"What is driving my spend, and is anything unusual?"*

- **Web:** KPI strip (Total · Avg per month · Avg transaction · Biggest single expense) →
  monthly bars + category stacked bars side by side (6/6) → ranked categories (full) with
  drill-down → Top merchants (6) + Top transfers (6) → Recurring charges table → Bank split
  (100% bar).
- **Mobile:** same order, single column; Top merchants/transfers become a segmented control
  (Merchants | Transfers) in one card to save scroll.
- **Drill-down:** clicking a category (bar, chip or legend) filters the whole page to it and shows a
  removable filter chip under the header ("Food & Dining ✕"). Same pattern for merchant.

### 11.4 Credit Cards (was CC Position + Foreign Currency)

Question: *"What do I owe, on which card, and when?"*

```
Credit Cards                       [Card: All ▾]  [This cycle ▾]
[ Current cycle ] [ History ] [ Foreign currency ]      ← segmented sub-tabs

┌ Outstanding ┐┌ Estimated bill ┐┌ Due ──────────┐┌ Paid-through ──────┐
│ Rp 8,1 jt   ││ Rp 7,4 jt      ││ 25 Oct · 6 d  ││ ████████░░ 80%     │
└─────────────┘└────────────────┘└───────────────┘└────────────────────┘
┌ Estimated billing (breakdown) ───────────────────────────────────────┐
┌ Transactions in current balance (N · M excluded) ────────────────────┐
```

- **Card switcher:** "All cards" + each card detected (bank short code + last 4 digits). On mobile
  it is a horizontal scroll of card "tiles" (credit-card shaped, 160×96, subtle `--grad-primary`
  edge on the selected one).
- **History:** paid-through timeline as a vertical list of statement cycles with status badges.
- **Foreign currency:** FX rate inputs as an editable list (currency code · rate · last updated),
  then the foreign transactions table with original amount + converted `Rp` amount. This is the
  one place amounts show `IDR`/`USD` codes instead of `Rp`.

### 11.5 Net Worth (Phase 2 — blueprint for later)

Question: *"Am I getting wealthier?"*

- Hero: net worth in `display` style, change vs last month (coloured by meaning), period
  dropdown (6 mo / 12 mo / All).
- Area chart of net worth over time (full width).
- Assets vs liabilities: two KPI cards + diverging bars by group (Cash, Investments, Property,
  Receivables vs Credit cards, Loans).
- "What changed this month" list: top 5 movements with amounts.
- Mobile: hero + chart above the fold; the rest stacks.

### 11.6 Accounts (Phase 2)

- Grouped list (Cash & bank · Investments · Property · Credit cards · Loans), each group with a
  subtotal; each account row: name, institution badge, balance, "updated 3 d ago" (`--warn` when
  older than the last month-end).
- Web: list left (5 cols) + selected account detail right (7 cols, balance history chart).
- Mobile: list → tap → detail page.

### 11.7 Month-end Close (Phase 3)

Question: *"Is this month closed and reconciled?"*

Stepper (§8.10) across the top: **1 Enter positions → 2 Review differences → 3 Journal entries →
4 Re-check → 5 Closed**.

- Step 1: form list of accounts with "balance at month end" inputs, pre-filled where known.
- Step 2: diff table — app value vs books value vs difference, rows with a difference highlighted
  `--warn`.
- Step 3: generated journal-entry list to post manually (copy button per entry; the app never
  writes to the books).
- Step 4: re-check result — all green → "Close month" primary button.
- Closed months show a lock badge in the month picker.

### 11.8 Settings

Sections as a left sub-nav (web) / grouped list (mobile):

1. **Appearance** — Theme: Dark · Light (segmented control). (Later: Hide amounts.)
2. **Categories** — list with colour + icon, rename, merge, add.
3. **Rules** — merchant → category, auto-note rules, date-category rules; each a searchable list
   with add/edit in a sheet/modal.
4. **Currencies** — FX rate defaults.
5. **Data** — Sync now, last sync, Export to Excel, Sign out.
6. **About** — version, privacy note ("Your data lives in your private Google Drive app folder").

The theme choice is stored in `localStorage` (a per-device convenience, not personal data);
everything else stays in the Drive appData file as today.

---

## 12. States: loading, empty, error, offline

| State | Pattern |
|---|---|
| **First load (no cache)** | Full-page brand loader: pixel wordmark + a thin `--grad-primary` progress line + live step text ("Reading Gmail… 240 / 592"). |
| **Load with cache** | Render cached data instantly; sync status shows "Syncing…"; changed numbers update in place with a 200ms fade (no count-up). |
| **Card loading** | Skeleton blocks matching the final layout, `--surface-2` with a subtle 1.2s shimmer; disabled under reduced motion. Never a spinner in the middle of an empty card. |
| **Empty (no data in period)** | Inside the card: 40px `--text-3` icon, one line ("No spending this week"), one action ("Show this month"). |
| **Empty (brand-new user)** | Brand moment (§13): pixel illustration, "Connect your first card", primary action "Run first sync". |
| **Error (card-level)** | Card keeps its frame; message in `--text-2` + "Retry" ghost button. |
| **Error (app-level)** | Banner at top of content, `--bad` soft background, cause + one action. |
| **Offline** | `--warn` banner: "You're offline — showing data from 14 Oct, 09:12". Edits queue and sync when back; queued count shown in the sync pill. |
| **Re-auth needed** | `--warn` banner + "Sign in again" button; data stays visible. |

---

## 13. Brand moments

Where the reference's bold personality lives — and **only** here:

1. **Sign-in screen** — `--grad-brand` glow, Silkscreen wordmark 64px (32 mobile), a subtle
   "glitch" (2-frame horizontal offset of the wordmark, once, 300ms) on load.
2. **First sync loader** — wordmark + gradient progress line.
3. **Brand-new-user empty state** — small pixel illustration (inline SVG, 8-bit card + coin), glow
   behind it at 40% strength.
4. **Sidebar wordmark** — Silkscreen 14px, `--text-1`, no glow. A tiny pixel logomark (5×5 grid "E")
   doubles as the favicon / home-screen icon.
5. **Month closed** (Phase 3) — one-time confetti-free celebration: the stepper fills with the brand
   gradient and the wordmark glitches once.

Never: gradients on KPI cards, glow behind numbers, pixel font for data, animated backgrounds on
daily screens.

---

## 14. Content, numbers & formatting

### 14.1 Money

| Context | Format | Example |
|---|---|---|
| Full (rows, tables, KPI on web) | `Rp` + `id-ID` grouping | `Rp 1.234.567` |
| Compact (charts, mobile KPIs ≥ 10 jt) | 1 decimal, `id-ID` comma decimal, `rb` / `jt` / `M` | `Rp 12,3 jt` · `Rp 850 rb` · `Rp 1,2 M` |
| Spend (outflow) in lists | minus sign (U+2212) | `−Rp 85.000` |
| Refund / credit | plus sign, `--good` | `+Rp 85.000` |
| Mixed currencies on one view | ISO code | `USD 12.50` → `IDR 196.250` |
| Unknown / not applicable | em dash | `—` |

- KPI totals of spend are shown **without** a minus sign (the label says "spend").
- Today's `fmtIDRShort` writes `1.2jt` (dot decimal) — switch to `1,2 jt` to match `id-ID`.
- Never round in a way that changes meaning: totals compute from raw values, then format.

### 14.2 Dates & time

- Lists: `14 Oct` (current year), `14 Oct 2025` (other years); day group headers "Today",
  "Yesterday", then `Mon 13 Oct`.
- Relative times only for freshness ("2 min ago", "3 d ago"); absolute dates for transactions.
- Periods spelled out in titles: "This month", "Sep 2026", "1 Jan – 14 Oct 2026".

### 14.3 Percentages & deltas

`▲ 8%` / `▼ 3%` with "vs last month" (or matching comparison) in `--text-3`. Whole numbers above 10%,
one decimal below (`▲ 2.4%`). Comparison basis must always be stated once per card.

### 14.4 Voice & microcopy

- Plain, short, English UI. Sentence case. No exclamation marks, no jargon ("Sync" not "Fetch
  watermark").
- Buttons are verbs: "Add transaction", "Run sync", "Flag to cancel".
- Errors say what happened + what to do: "Couldn't reach Gmail. Check your connection and retry."
- Confirmations are toasts in past tense: "Category updated · Undo".

---

## 15. Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--dur-fast` | 120ms | `ease-out` | Hover, press, toggles |
| `--dur-base` | 200ms | `cubic-bezier(.2,.8,.2,1)` | Tab/sub-tab change, row expand, number fade |
| `--dur-slow` | 280ms | `cubic-bezier(.2,.8,.2,1)` | Sheet/modal enter |
| `--dur-exit` | 180ms | `ease-in` | Sheet/modal exit (exits are faster than entries) |

- Animate `transform` and `opacity` only.
- Page/tab switches: content cross-fade 200ms, no sliding pages on web; on mobile a 12px upward
  fade-in.
- `prefers-reduced-motion: reduce` → durations to 0, shimmer off, glitch off, charts render without
  animation.

---

## 16. Accessibility

Target **WCAG 2.2 AA** in both themes.

- **Contrast:** all text and semantic tokens were checked at ≥ 4.5:1 against every surface they sit
  on, in both themes (2026-10-15). `--text-3` is the floor — nothing dimmer for readable text.
  Category colours are for fills, icons and chart marks (non-text, ≥ 3:1), not for body text.
  Re-check if any token changes.
- **Colour never alone:** deltas use arrows + signs; status badges have text; chart series have
  legends and table view.
- **Targets:** ≥ 44×44px on touch; ≥ 32px on web with 8px spacing.
- **Focus:** visible 2px `--accent-text` ring with 2px offset on every interactive element; never
  `outline: none` without a replacement.
- **Keyboard:** full app usable without a mouse; sidebar arrow-key navigation; modals trap focus;
  Esc closes; focus returns to the trigger.
- **Semantics:** `<nav>` for sidebar/bottom bar, `<main>` for content, `<h1>` per page, card titles as
  `<h2>`; tables are real `<table>`s with `<th scope>`; icon buttons have `aria-label`.
- **Live regions:** sync status and toasts are `aria-live="polite"`; errors `assertive`.
- **Swipe alternatives:** every swipe action is reachable through the row's detail sheet.
- **Zoom:** layout holds at 200% browser zoom and with the OS large-text setting on mobile.

---

## 17. Implementation notes (mapping from today's code)

The app stays a **single `index.html` with no build step**. These notes map today's code to the
guideline so the redesign can be done incrementally.

### 17.1 Token mapping

| Today | Becomes |
|---|---|
| `--black #000` | `--bg` |
| `--glass-bg`, `--glass-border` (blurred glass) | `--surface-1` + `--border` (drop backdrop blur — solid surfaces read more crisply and scroll faster on phones) |
| `--beige`, `--white` | `--text-1` |
| `--muted` | `--text-2` |
| `--dim` | `--text-3` |
| `--beige06/12/30` tints | `--surface-2` / `--border` / `--border-strong` |
| `--yellow #FFCB05` | retired as UI accent → `--accent`. Kept nowhere else (a bank's brand colour should not be the app's accent once it is multi-bank) |
| `--taupe` | retired |
| `CATEGORIES[*].color` | §5.4 dark/light colours |
| `CATEGORIES[*].icon` (emoji) | §5.4 Lucide icon id |

### 17.2 Structure mapping

| Today | Becomes |
|---|---|
| `.tab-bar` / `.tab-btn` + `setTab()` | `<nav class="sidebar">` (web) + `<nav class="bottom-nav">` (mobile), both driving the same `setTab()` |
| Tabs `overview / cc / reporting / fx` | Sections `overview / spending / cards (sub: current, history, fx)` |
| `.hero` (3-col grid) + `.slabel` / `.sval` / `.sicon` | `.kpi-row` + `.kpi-card` (`.kpi-label`, `.kpi-value`, `.kpi-delta`) |
| `.table-title` with emoji | `.card-header` (icon + `h2` + description + control) |
| `.cat-card` grid | Ranked category bars component (§9.1) |
| `.tx-swipe-*` (mobile list) | Transaction row (§8.9) + swipe spec (§10.2) — extend, don't rewrite |
| `openEditModal / openAddModal / openSplitModal` | Same functions, rendered as modal (web) or bottom sheet (mobile) via one shared `openSheet()` shell |
| `setSyncBadge()` | Sync status component (§8.12), same states |
| `refresh-btn` row (Export, Sign out) | Moves to sidebar account menu / More / Settings › Data |
| `@media (max-width: 640px)` | Breakpoint set in §4 |
| `fmtIDR` / `fmtIDRShort` | `Rp` prefix + `id-ID` decimal comma (§14.1) |

### 17.3 Chart.js global theme (sketch)

```js
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function applyChartTheme() {
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = css('--text-3');
  Chart.defaults.borderColor = css('--border');
  Chart.defaults.plugins.legend.display = false;          // HTML legends instead
  Chart.defaults.plugins.tooltip.backgroundColor = css('--surface-3');
  Chart.defaults.plugins.tooltip.borderColor = css('--border-strong');
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.elements.line.tension = 0.4;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 6;
  Chart.defaults.elements.bar.borderRadius = 6;
  Chart.defaults.scale.grid.display = true;               // set x.grid.display=false per chart
}
// Re-run applyChartTheme() and re-render charts when the theme toggles.
```

### 17.4 New dependencies

Record in `browser-dependencies.json` when added:

- Google Fonts: Inter (400/500/600/700), Silkscreen (400/700) — one `<link>` with `display=swap`.
- Lucide icons — **not** a runtime dependency; the needed SVGs are copied into an inline sprite
  (ISC licence notice in a comment).

### 17.5 Theme switching

`<html data-theme="dark|light">`, set before first paint from `localStorage` (default `dark`) to
avoid a flash. `color-scheme` follows the theme so native inputs/scrollbars match.

---

## 18. Rollout increments

One reviewable increment at a time (per `WORKFLOW.md`); each ends with a local check on port 5500
at 375px and 1280px widths in both themes.

1. **Tokens, fonts, theme toggle** — new CSS variables, Inter, light theme, Settings › Appearance.
   No layout change.
2. **App shell** — sidebar, rail, bottom bar, top app bar, page headers; regroup tabs into
   Overview / Spending / Credit Cards (FX as sub-tab).
3. **Cards & KPIs** — card component, KPI row (spend-first), card headers with icons (emoji out).
4. **Charts** — global Chart.js theme, area trend, ranked category bars, HTML legends, mobile
   chart behaviour.
5. **Transactions** — row component, day grouping, swipe spec, sheets/modals shell, undo toasts.
6. **States & brand moments** — skeletons, empty/error/offline states, sign-in and first-sync
   screens, wordmark and favicon.
7. **Accessibility & polish pass** — keyboard, focus, contrast check, reduced motion, 200% zoom.

Phase 2/3 screens (§11.5–11.7) are designed against this system when those phases start.

---

## 19. Review checklist

Use before calling any UI change done.

**Visual**
- [ ] Only tokens used — no hard-coded hex values in new CSS
- [ ] Works in dark **and** light theme
- [ ] Numbers use tabular figures and the §14 formats
- [ ] Category colours/icons match §5.4
- [ ] Deltas coloured by meaning, with arrow + sign
- [ ] No emoji; icons from the sprite
- [ ] Brand gradient / pixel font only in §13 places

**Layout**
- [ ] Checked at 375, 768, 1024 and 1440px widths
- [ ] No horizontal page scroll on mobile
- [ ] Main answer of the screen visible without scrolling on a 375×812 phone

**Interaction**
- [ ] Every action reachable without swipe and without hover
- [ ] Destructive actions undoable
- [ ] Sync status visible and accurate
- [ ] Loading, empty and error states designed for every new card

**Accessibility**
- [ ] Contrast ≥ 4.5:1 for text, focus ring visible
- [ ] Touch targets ≥ 44px
- [ ] Keyboard path works; modals trap and return focus
- [ ] Reduced motion respected

**Privacy (pre-push gate)**
- [ ] No real merchant names, amounts, dates or personal rules in code, mockups or this file

---

## 20. Open items

Functional decisions this guideline leaves to the user:

1. **Hide-amounts mode** — a toggle (eye icon in the top bar) that blurs all money values for use in
   public. Recommended; needs a yes.
2. **Bulk categorise** — long-press multi-select on mobile / checkbox column on web to set the
   category for many rows at once. Recommended if categorising is frequent.
3. **Budgets per category** — the progress-bar component (§8.10) is ready for it; not in scope yet.
4. **App rename** — if ExpenseTrack becomes a wealth tracker, the wordmark (§13) changes; the system
   itself does not.
