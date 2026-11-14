/* ExpenseTrack v6 — the new book's Tax page (w2-tax, docs/v6-book.md §10; plan §7.8): the pack of
   figures for one tax year of the annual return (SPT). Income by type with the tax withheld, what
   you owned and owed on 31 December, money owed to you for over a year, foreign-currency holdings,
   a checklist, "declared" ticks, last year beside this year, and an Excel file for the accountant.

   Every figure comes from the new book through bookLib; every change goes through book2Do. The
   page only organises the owner's own figures: it states no tax rule and gives no tax advice.
   Read-only towards everything old (§0): never writes STATE, never calls scheduleDriveSave() or a
   mutating ledger* function. No personal data in this file: the repo is public. */
(function () {
  'use strict';
  if (typeof bookLib === 'undefined' || typeof BOOK2 !== 'function' || typeof book2Do !== 'function' || typeof registerPage !== 'function') {
    console.warn('ExpenseTrack preview: the new book store is not loaded, so the Tax page stays off.');
    return;
  }
  const X = window.w2Tax = {};

  /* ── Small helpers ── */
  const B = () => BOOK2();
  const cp = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const p2 = n => String(n).padStart(2, '0');
  const low = s => String(s == null ? '' : s).trim().toLowerCase();
  const el = id => document.getElementById(id);
  const live = o => Object.values(o || {}).filter(x => x && !x.deleted);
  const errText = e => (e && Array.isArray(e.errors) && e.errors.length ? e.errors.join(' · ') : String((e && e.message) || e));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const dayText = iso => { try { return fmtDayLong(new Date(String(iso).slice(0, 10) + 'T00:00:00')); } catch (_) { return String(iso || ''); } };
  const money = n => `<span class="amt">${fmtIDR(n)}</span>`;
  const signed = n => `<span class="amt">${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtIDR(Math.abs(n))}</span>`;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const byCode = (a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'en', { numeric: true }) || String(a.name).localeCompare(String(b.name));
  const rid = n => { let s = ''; while (s.length < n) s += Math.floor(Math.random() * 16).toString(16); return s; };
  const fxText = n => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });

  // Layout only: spacing and wrapping built from the existing tokens. No colours, fonts or icons added.
  if (!el('w2TaxStyle')) {
    const st = document.createElement('style'); st.id = 'w2TaxStyle';
    st.textContent = `
      .w2t-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:16px}
      .w2t-bar .input{height:36px;width:auto;min-width:0;max-width:100%}
      .w2t-bar .grow{flex:1 1 0;min-width:0}
      .w2t-note{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:20px;color:var(--text-2);margin-bottom:16px}
      .w2t-note svg{flex:none;margin-top:2px;color:var(--text-3)}
      .w2t-check{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border);font-size:14px}
      .w2t-check:first-of-type{border-top:none}
      .w2t-check .what{flex:1 1 200px;min-width:0}
      .w2t-check .side{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}
      .w2t-sub{font-size:12px;line-height:16px;color:var(--text-3);overflow-wrap:anywhere}
      .w2t-pad{padding:0 var(--card-pad) var(--card-pad)}
      .w2t-tick{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-2);white-space:nowrap}
      .w2t-tick input{width:16px;height:16px;accent-color:var(--accent);cursor:pointer}
      .w2t-pick{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
      .w2t-pick .input{height:36px;flex:1 1 150px;min-width:0}
      table.data.w2t td{overflow-wrap:anywhere}
      table.data.w2t td.num .w2t-sub{white-space:normal}
      table.data.w2t th{white-space:normal}
      table.data.w2t td[data-label="Since"],table.data.w2t td[data-label="Year bought"]{overflow-wrap:normal;white-space:nowrap}
      @media (max-width:767px){
        .w2t-bar .input{flex:1 1 130px}
        .w2t-bar .btn{flex:1 1 auto}
        .w2t-check .side{margin-left:0}
      }`;
    document.head.appendChild(st);
  }

  /* ── Not ready: signed out, loading, error, blocked, no book yet ── */
  const TITLE = 'Tax', DESC = 'Your figures for one tax year of the annual return (SPT), taken from the new book.';
  function gate() {
    const st = typeof book2Status === 'function' ? book2Status() : 'none', b = B();
    if (b && st !== 'blocked') return null;
    const wrap = (inner, busy) => `${pageHead(TITLE, DESC)}<div class="grid"><section class="card span-12" data-w2-state="${escH(st)}"${busy ? ' aria-busy="true"' : ''}>${inner}</section></div>`;
    const go = `<button class="btn btn-primary btn-sm" id="w2GoStart" onclick="setTab('w2-start')">Open Start here</button>`;
    const problem = (head, text) => `<div class="card-error">${ic('triangle-alert', 's24')}<div style="flex:1;min-width:0"><div style="font-weight:600;color:var(--text-1)">${escH(head)}</div><div class="help">${escH(text)}</div></div>${go}</div>`;
    if (typeof USER_EMAIL !== 'string' || !USER_EMAIL) return wrap(emptyHTML('lock', 'Sign in to see the new book'));
    if (st === 'blocked') return wrap(problem('The new book can’t be opened', 'Its file in Google Drive can’t be read by this version of the app. Your current book is not affected.'));
    if (st === 'idle' || st === 'loading') return wrap('<div class="skel" style="width:60%;height:14px"></div><div class="skel" style="width:40%;height:14px;margin-top:10px"></div><div class="skel" style="width:50%;height:14px;margin-top:10px"></div>', true);
    if (st === 'error') return wrap(problem('Couldn’t reach Google Drive', (typeof book2Error === 'function' && book2Error()) || 'Try again from Start here.'));
    return wrap(`<div class="empty">${ic('book-open', 's40')}<div class="e-title">The new book is not set up yet. Start here copies your current book into it.</div>${go}</div>`);
  }

  /* ── The figures of one tax year ── */
  const T = { year: null, compare: false };
  const NEEDS = ['investment', 'property', 'other-asset'];       // assets that carry a year bought and a cost
  const VALUED = ['investment', 'property'];                     // assets that can carry a market value
  const KIND = { bank: 'Bank account', cash: 'Cash', ewallet: 'E-wallet', investment: 'Investment', property: 'Property', receivable: 'Money owed to you', 'other-asset': 'Other asset',
    card: 'Credit card', loan: 'Loan', payable: 'Money you owe someone', 'other-liability': 'Other debt' };
  const UNTYPED = 'other income';
  const isIncomeAcc = a => !!a && a.kind === 'income' && a.role !== 'fx';
  const isTaxAcc = a => !!a && a.kind === 'expense' && low(a.category || a.name) === 'tax';
  const curYear = () => +today().slice(0, 4);

  // The calendar year: 1 January to 31 December, or to today while the year is not finished.
  function yearInfo(year) {
    const now = today(), finished = year < +now.slice(0, 4);
    return { year, finished, from: `${year}-01-01`, asOf: finished ? `${year}-12-31` : now, label: finished ? `31 Dec ${year}` : `today (${year} so far)` };
  }
  // From the book's first year to the current one.
  function years(b) {
    const cur = curYear(); let first = +String((b.settings || {}).firstMonth || '').slice(0, 4) || cur;
    for (const e of live(b.entries)) if (e.status === 'posted' && +e.date.slice(0, 4) < first) first = +e.date.slice(0, 4);
    if (!(first >= 1900) || first > cur) first = cur;
    const out = []; for (let y = first; y <= cur; y++) out.push(y);
    return out;
  }
  const defaultYear = ys => (ys.includes(curYear() - 1) ? curYear() - 1 : ys[ys.length - 1]);
  const monthsApart = (a, b) => Math.max(0, (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) - (b.slice(8, 10) < a.slice(8, 10) ? 1 : 0));
  function valuesAt(b, M) { const best = {}; for (const v of live(b.values)) if (v.month <= M && (!best[v.account] || v.month > best[v.account].month)) best[v.account] = v; return best; }

  // One year on its own: income by type with tax withheld, and what was owned and owed at its end.
  function sideOf(b, yi) {
    const base = b.currency || 'IDR', inc = {}, first = {}, fxSum = {}, fxMiss = {}, untyped = [];
    let otherTax = 0, nInc = 0;
    for (const e of live(b.entries)) {
      if (e.status !== 'posted' || e.date > yi.asOf) continue;
      for (const l of e.lines || []) {
        if (!first[l.account] || e.date < first[l.account]) first[l.account] = e.date;
        const a = b.accounts[l.account];
        if (a && a.ccy && a.ccy !== base) {
          if (l.fx && l.fx.ccy === a.ccy) fxSum[a.id] = (fxSum[a.id] || 0) + Math.sign(l.amount) * Math.abs(l.fx.amount); else fxMiss[a.id] = true;
        }
      }
      if (e.date < yi.from || e.kind === 'year-end') continue;
      const got = []; let tax = 0;
      for (const l of e.lines || []) {
        const a = b.accounts[l.account];
        if (isIncomeAcc(a)) got.push({ type: a.incomeType || a.name, amount: -l.amount });
        else if (isTaxAcc(a)) tax += l.amount;
      }
      if (!got.length) { otherTax += tax; continue; }          // tax booked on its own, outside an income entry
      nInc++;
      for (const g of got) { const r = inc[g.type] || (inc[g.type] = { type: g.type, amount: 0, tax: 0, entries: 0 }); r.amount += g.amount; }
      const main = got.slice().sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))[0];
      inc[main.type].tax += tax; inc[main.type].entries++;
      if (got.some(g => low(g.type) === UNTYPED)) untyped.push(e.id);
    }
    const income = Object.values(inc).filter(r => r.amount || r.tax).sort((x, y) => y.amount - x.amount || x.type.localeCompare(y.type));

    const bal = bookLib.balances(b, yi.asOf), vals = valuesAt(b, yi.asOf.slice(0, 7)), assets = [], debts = [];
    for (const a of live(b.accounts).sort(byCode)) {
      const v = bal[a.id] || 0; if (a.header || !v) continue;
      const tax = a.tax || {}, year = +tax.year || null, note = String(tax.note || '');
      if (a.kind === 'asset') {
        const needs = NEEDS.includes(a.role), cost = needs && Number.isInteger(tax.cost) ? tax.cost : null, val = VALUED.includes(a.role) ? vals[a.id] : null;
        assets.push({ id: a.id, code: a.code, name: a.name, role: a.role, kind: KIND[a.role] || 'Other asset', ccy: a.ccy || base, book: v, needs, year, cost, amount: cost != null ? cost : v,
          basis: !needs ? 'balance' : cost != null ? 'cost' : 'book', filled: !needs || (!!year && cost != null), note, market: val ? val.value : null, marketMonth: val ? val.month : null });
      } else if (a.kind === 'liability') {
        debts.push({ id: a.id, code: a.code, name: a.name, role: a.role, kind: KIND[a.role] || 'Other debt', ccy: a.ccy || base, amount: -v, year: year || (first[a.id] ? +first[a.id].slice(0, 4) : null), note });
      }
    }
    const sum = (l, k) => l.reduce((s, r) => s + (r[k] || 0), 0);
    const assetsBook = sum(assets, 'book');

    // Owed to you for over one year: open items dated a year or more before the as-of date.
    const cut = `${+yi.asOf.slice(0, 4) - 1}${yi.asOf.slice(4)}`, old = [];
    const pushOld = (name, items, total) => {
      const o = items.filter(i => i.date <= cut); if (!o.length) return;
      old.push({ name, oldest: o[0].date, months: monthsApart(o[0].date, yi.asOf), amount: o.reduce((s, i) => s + i.open, 0), total });
    };
    for (const p of bookLib.people(b, yi.asOf)) pushOld(p.name, p.items.filter(i => i.side === 'receivable'), p.owedToYou);
    for (const a of live(b.accounts)) {                           // receivable accounts that belong to no person (copied history)
      if (a.role !== 'receivable' || a.person || a.header || !((bal[a.id] || 0) > 0)) continue;
      const items = []; let settled = 0;
      for (const r of bookLib.ledgerOf(b, a.id, null, yi.asOf).rows) { if (r.debit) items.push({ date: r.date, open: r.debit }); settled += r.credit; }
      for (const it of items) { const u = Math.min(it.open, settled); it.open -= u; settled -= u; }
      pushOld(a.name, items.filter(i => i.open > 0), bal[a.id]);
    }
    old.sort((x, y) => (x.oldest < y.oldest ? -1 : x.oldest > y.oldest ? 1 : x.name.localeCompare(y.name)));

    // Foreign-currency holdings: asset accounts kept in another currency, in rupiah as the book carries them.
    const byC = {};
    for (const r of assets) {
      if (r.ccy === base) continue;
      const g = byC[r.ccy] || (byC[r.ccy] = { ccy: r.ccy, rp: 0, foreign: 0, known: true, accounts: [] });
      const f = fxMiss[r.id] || fxSum[r.id] == null ? null : Math.round(fxSum[r.id] * 100) / 100;
      g.rp += r.book; if (f == null) g.known = false; else g.foreign += f;
      g.accounts.push({ id: r.id, name: r.name, ccy: r.ccy, rp: r.book, foreign: f });
    }
    const fx = Object.values(byC).sort((x, y) => y.rp - x.rp).map(g => ({ ...g, foreign: g.known ? Math.round(g.foreign * 100) / 100 : null, share: assetsBook ? g.rp / assetsBook : 0 }));

    return { yi, income, incomeTotal: sum(income, 'amount'), taxTotal: sum(income, 'tax'), otherTax, nInc, untyped, assets, debts, assetsBook, assetsCost: sum(assets, 'amount'),
      debtsTotal: sum(debts, 'amount'), old, oldTotal: sum(old, 'amount'), fx, fxTotal: sum(fx, 'rp') };
  }
  // This year's rows with last year's figure beside them; a row that only last year has is kept as "gone".
  function beside(rows, prev, key, blank) {
    if (!prev) return rows.map(r => ({ ...r, prev: null, change: null, isNew: false, gone: false }));
    const was = new Map(prev.map(r => [r[key], r])), seen = new Set();
    const out = rows.map(r => { seen.add(r[key]); const p = was.get(r[key]); return { ...r, prev: p ? p.amount : 0, prevTax: p ? p.tax || 0 : 0, change: r.amount - (p ? p.amount : 0), isNew: !p, gone: false }; });
    for (const p of prev) if (!seen.has(p[key])) out.push({ ...p, ...blank, prev: p.amount, prevTax: p.tax || 0, amount: 0, change: -p.amount, isNew: false, gone: true });
    return out;
  }
  // cmp: last year sits beside each line (Compare with last year). Without it a line that only last
  // year has is left out and nothing is flagged, so the page and the Excel file show this year alone.
  function taxData(b, year, cmp) {
    const ys = years(b), yi = yearInfo(year), d = sideOf(b, yi), set = b.settings || {};
    const prev = ys.includes(year - 1) ? sideOf(b, yearInfo(year - 1)) : null;
    const dec = (set.taxDeclared || {})[year] || {}, slips = (set.taxSlips || {})[year] || {};
    const side = cmp && prev ? prev : null;
    d.year = year; d.years = ys; d.prev = prev; d.prevYear = prev ? year - 1 : null; d.cmp = !!side;
    d.income = beside(d.income, side && side.income, 'type', { tax: 0, entries: 0 }).map(r => ({ ...r, key: 'i:' + r.type, declared: !!dec['i:' + r.type], slip: !!slips[r.type] }));
    d.assets = beside(d.assets, side && side.assets, 'id', { book: 0, market: null, marketMonth: null }).map(r => ({ ...r, key: 'a:' + r.id, declared: !!dec['a:' + r.id] }));
    d.debts = beside(d.debts, side && side.debts, 'id', {}).map(r => ({ ...r, key: 'a:' + r.id, declared: !!dec['a:' + r.id] }));
    const lines = [...d.income, ...d.assets, ...d.debts].filter(r => !r.gone);
    d.declared = { done: lines.filter(r => r.declared).length, of: lines.length };
    // Checklist (§10): months locked, assets with year and cost, income entries with a type, slips ticked.
    let locked = 0; for (let m = 1; m <= 12; m++) if (bookLib.lockState(b, `${year}-${p2(m)}`) === 'locked') locked++;
    const need = d.assets.filter(r => r.needs && !r.gone), withTax = d.income.filter(r => !r.gone && r.tax > 0);
    d.missing = need.filter(r => !r.filled).map(r => r.id);
    d.check = { months: { done: locked, of: 12 }, assets: { done: need.length - d.missing.length, of: need.length },
      typed: { done: d.nInc - d.untyped.length, of: d.nInc }, slips: { done: withTax.filter(r => r.slip).length, of: withTax.length } };
    return d;
  }
  X.data = (year, cmp) => { const b = B(); return b ? taxData(b, year == null ? T.year : +year, cmp == null ? T.compare : !!cmp) : null; };

  /* ── The page ── */
  const tick = (kind, key, on, label) => `<input type="checkbox" data-w2t-${kind}="${escH(key)}"${on ? ' checked' : ''} onclick="w2Tax.tick('${kind}',this)" aria-label="${escH(label)}" title="${escH(label)}">`;
  const flag = r => (r.gone ? ' <span class="badge warn" data-w2t-flag="gone">Gone since last year</span>' : r.isNew ? ' <span class="badge accent" data-w2t-flag="new">New this year</span>' : '');
  // Last year and the change share one column (the change under last year's figure), so a table
  // with Compare on stays inside its card on a laptop.
  const cmpCells = (r, cmp, py) => (cmp ? `<td class="num" data-label="${escH('31 Dec ' + py + ' · change')}">${r.isNew ? '<span class="faint">—</span>' : money(r.prev)}<div class="w2t-sub" data-w2t-change>${signed(r.change)}</div></td>` : '');
  const cmpHead = (cmp, py) => (cmp ? `<th scope="col" class="num">31 Dec ${py} · change</th>` : '');
  const cmpTotal = (cmp, now, was) => (cmp ? `<td class="num" data-label="Last year · change">${money(was)}<div class="w2t-sub" data-w2t-change>${signed(now - was)}</div></td>` : '');
  const table = (id, head, body) => `<div class="table-wrap"><table class="data ex-rows w2t" id="${id}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  const kpi = (id, label, v, sub) => `<div class="card kpi span-3" id="${id}" data-v="${v}"><span class="kpi-label">${escH(label)}</span><span class="kpi-value">${kpiMoney(v)}</span><span class="kpi-sub"><span class="vs">${sub}</span></span></div>`;

  function checklist(d) {
    const c = d.check, y = d.year;
    const state = (x, none) => (!x.of ? `<span class="badge">${escH(none)}</span>` : x.done >= x.of ? '<span class="badge good">done</span>' : `<span class="badge warn">${x.done} of ${x.of}</span>`);
    const row = (id, x, text, sub, none, btn) => `<div class="w2t-check" id="${id}" data-done="${x.done}" data-of="${x.of}"><div class="what">${escH(text)}${sub ? `<div class="w2t-sub">${escH(sub)}</div>` : ''}</div><div class="side">${state(x, none)}${btn || ''}</div></div>`;
    const hasCheck = typeof pageByKey === 'function' && pageByKey('w2-check');
    return `<section class="card span-12" id="w2tChecklist">${cardHead('square-check', 'Checklist', `Before you hand ${y} to your accountant`)}
      ${row('w2tcMonths', c.months, `All 12 months of ${y} locked`, d.yi.finished ? 'A locked month can no longer change, so these figures stay put.' : `${y} is not finished yet.`, '', c.months.done < 12 && hasCheck ? `<button class="btn btn-secondary btn-sm" onclick="setTab('w2-check')">Open Month check</button>` : '')}
      ${row('w2tcAssets', c.assets, 'Every asset has the year bought and its cost', 'Investments, property and other assets. Bank accounts and money owed to you use their balance.', 'no such assets', d.missing.length ? `<button class="btn btn-primary btn-sm" id="w2tFill" onclick="w2Tax.fill()">Fill</button>` : '')}
      ${row('w2tcTyped', c.typed, 'Every income entry has a type', d.untyped.length ? `${plural(d.untyped.length, 'entry', 'entries')} still sit under “Other income”.` : '', 'no income this year', d.untyped.length ? `<button class="btn btn-secondary btn-sm" id="w2tTypes" onclick="w2Tax.types()">Show</button>` : '')}
      ${row('w2tcSlips', c.slips, 'Withholding slips ticked as received', 'One per income type that had tax withheld. Tick it in the income table.', 'no tax withheld', '')}
      <p class="help" id="w2tDeclared" data-done="${d.declared.done}" data-of="${d.declared.of}" style="margin-top:12px">Declared in the return so far: ${d.declared.done} of ${plural(d.declared.of, 'line')}. Tick a line once you or your accountant entered it.</p></section>`;
  }
  function incomeCard(d, cmp) {
    const py = d.prevYear, prevTotal = d.prev ? d.prev.incomeTotal : 0;
    const rows = d.income.map(r => `<tr data-w2t-income="${escH(r.type)}" data-v="${r.amount}" data-tax="${r.tax}"${r.gone ? ' class="muted-row"' : ''}>
      <td class="sel-col ex-full" data-label="Declared">${r.gone ? '' : tick('declared', r.key, r.declared, 'Declared in the return: ' + r.type)}</td>
      <td class="merchant ex-full"><div class="merchant-name">${escH(r.type)}${flag(r)}</div>${low(r.type) === UNTYPED ? '<div class="w2t-sub">No type chosen yet</div>' : ''}</td>
      <td class="num" data-label="Income">${money(r.amount)}</td><td class="num" data-label="Tax withheld">${r.tax ? money(r.tax) : '<span class="faint">—</span>'}</td>
      <td data-label="Slip">${r.gone ? '' : `<label class="w2t-tick">${tick('slip', r.type, r.slip, 'Withholding slip received: ' + r.type)}received</label>`}</td>${cmpCells(r, cmp, py)}</tr>`).join('');
    const body = d.income.length ? table('w2tIncome', `<th scope="col">Declared</th><th scope="col">Income type</th><th scope="col" class="num">Income</th><th scope="col" class="num">Tax withheld</th><th scope="col">Withholding slip</th>${cmpHead(cmp, py)}`,
      `${rows}<tr class="ex-total"><td class="ex-full" colspan="2">Total income (Penghasilan)</td><td class="num" data-label="Income">${money(d.incomeTotal)}</td><td class="num" data-label="Tax withheld">${money(d.taxTotal)}</td><td></td>${cmpTotal(cmp, d.incomeTotal, prevTotal)}</tr>`)
      : emptyHTML('inbox', `No income in the book for ${d.year}`);
    const other = d.otherTax ? `<div class="w2t-pad"><p class="help" id="w2tOtherTax" data-v="${d.otherTax}" style="margin-top:12px">${money(d.otherTax)} more went to the Tax category on entries of its own (not inside an income entry). It is not in the figures above.</p></div>` : '';
    return `<section class="card flush span-12" id="w2tIncomeCard">${cardHead('trending-up', 'Income by type (Penghasilan)', `1 Jan to ${escH(d.yi.finished ? '31 Dec ' + d.year : 'today')} · before tax, with the tax that was withheld`)}${body}${other}</section>`;
  }
  function assetsCard(d, cmp) {
    const py = d.prevYear, prevTotal = d.prev ? d.prev.assetsCost : 0;
    const basis = r => (r.gone ? '' : r.basis === 'book' ? '<div><span class="badge warn" data-w2t-basis="book">book value, cost not filled</span></div>' : r.basis === 'balance' ? '<div class="w2t-sub">balance</div>' : r.cost !== r.book ? `<div class="w2t-sub">book shows ${money(r.book)}</div>` : '');
    const rows = d.assets.map(r => `<tr data-w2t-asset="${escH(r.id)}" data-v="${r.amount}" data-book="${r.book}" data-basis="${r.gone ? 'gone' : r.basis}"${r.gone ? ' class="muted-row"' : ''}>
      <td class="sel-col ex-full" data-label="Declared">${r.gone ? '' : tick('declared', r.key, r.declared, 'Declared in the return: ' + r.name)}</td>
      <td class="merchant ex-full"><div class="merchant-name">${escH(r.name)}${flag(r)}</div><div class="w2t-sub">${escH(r.kind)}${r.ccy !== (B().currency || 'IDR') ? ' · ' + escH(r.ccy) : ''}${r.note ? ' · ' + escH(r.note) : ''}</div></td>
      <td data-label="Year bought">${r.year ? r.year : r.needs && !r.gone ? '<span class="badge warn">not filled</span>' : '<span class="faint">—</span>'}</td>
      <td class="num" data-label="Cost">${money(r.amount)}${basis(r)}</td>
      <td class="num" data-label="Market value">${r.market != null ? `${money(r.market)}${r.marketMonth < d.yi.asOf.slice(0, 7) ? `<div class="w2t-sub">from ${escH(monthLabel(r.marketMonth))}</div>` : ''}` : '<span class="faint">—</span>'}</td>${cmpCells(r, cmp, py)}
      <td class="num" data-label="">${r.needs && !r.gone ? `<button class="btn btn-ghost btn-sm" data-w2t-edit="${escH(r.id)}" onclick="w2Tax.fill('${escAttr(r.id)}')">${r.filled ? 'Edit' : 'Fill'}</button>` : ''}</td></tr>`).join('');
    const body = d.assets.length ? table('w2tAssets', `<th scope="col">Declared</th><th scope="col">Asset · kind · where held</th><th scope="col">Year bought</th><th scope="col" class="num">Cost</th><th scope="col" class="num">Market value</th>${cmpHead(cmp, py)}<th scope="col"><span class="sr-only">Fill</span></th>`,
      `${rows}<tr class="ex-total"><td class="ex-full" colspan="3">Total assets at cost (Harta)</td><td class="num" data-label="At cost">${money(d.assetsCost)}</td><td></td>${cmpTotal(cmp, d.assetsCost, prevTotal)}<td></td></tr>`)
      : emptyHTML('wallet', `Nothing owned at ${d.yi.label}`);
    const tie = d.assetsCost !== d.assetsBook ? `<div class="w2t-pad"><p class="help" id="w2tBookNote" style="margin-top:12px">Your book shows ${money(d.assetsBook)} for the same assets. The difference is where the cost you typed is not the book balance.</p></div>` : '';
    return `<section class="card flush span-12" id="w2tAssetsCard">${cardHead('landmark', 'Assets at cost (Harta)', `What you owned at ${escH(d.yi.label)}`)}${body}${tie}</section>`;
  }
  function debtsCard(d, cmp) {
    const py = d.prevYear, prevTotal = d.prev ? d.prev.debtsTotal : 0;
    const rows = d.debts.map(r => `<tr data-w2t-debt="${escH(r.id)}" data-v="${r.amount}"${r.gone ? ' class="muted-row"' : ''}>
      <td class="sel-col ex-full" data-label="Declared">${r.gone ? '' : tick('declared', r.key, r.declared, 'Declared in the return: ' + r.name)}</td>
      <td class="merchant ex-full"><div class="merchant-name">${escH(r.name)}${flag(r)}</div><div class="w2t-sub">${escH(r.kind)}</div></td>
      <td data-label="Since">${r.year || '<span class="faint">—</span>'}</td><td class="num" data-label="You owe">${money(r.amount)}</td>${cmpCells(r, cmp, py)}</tr>`).join('');
    const body = d.debts.length ? table('w2tDebts', `<th scope="col">Declared</th><th scope="col">Debt · lender</th><th scope="col">Since</th><th scope="col" class="num">You owe</th>${cmpHead(cmp, py)}`,
      `${rows}<tr class="ex-total"><td class="ex-full" colspan="3">Total debts (Utang)</td><td class="num" data-label="You owe">${money(d.debtsTotal)}</td>${cmpTotal(cmp, d.debtsTotal, prevTotal)}</tr>`)
      : emptyHTML('square-check', `No debts at ${d.yi.label}`);
    return `<section class="card flush span-12" id="w2tDebtsCard">${cardHead('receipt', 'Debts (Utang)', `Cards, loans and people you owed at ${escH(d.yi.label)}`)}${body}</section>`;
  }
  function oldCard(d) {
    const rows = d.old.map(r => `<tr data-w2t-old="${escH(r.name)}" data-v="${r.amount}" data-months="${r.months}"><td class="merchant ex-full"><div class="merchant-name">${escH(r.name)}</div></td><td data-label="Oldest open item">${escH(dayText(r.oldest))}</td>
      <td class="num" data-label="Age">${plural(r.months, 'month')}</td><td class="num" data-label="Open over one year">${money(r.amount)}</td><td class="num" data-label="Owes you in all">${money(r.total)}</td></tr>`).join('');
    const body = d.old.length ? table('w2tOld', '<th scope="col">Who</th><th scope="col">Oldest open item</th><th scope="col" class="num">Age</th><th scope="col" class="num">Open over one year</th><th scope="col" class="num">Owes you in all</th>',
      `${rows}<tr class="ex-total"><td class="ex-full" colspan="3">Total open over one year</td><td class="num" data-label="Open over one year">${money(d.oldTotal)}</td><td></td></tr>`)
      : emptyHTML('square-check', 'Nothing has been owed to you for over a year');
    return `<section class="card flush span-12" id="w2tOldCard">${cardHead('circle-user', 'Owed to you for over one year', `Open items a year or older at ${escH(d.yi.label)}. Money back settles the oldest item first. These are already inside Assets.`)}${body}</section>`;
  }
  function fxCard(d) {
    const rows = d.fx.map(g => `<tr class="group-row"><th scope="rowgroup" colspan="4">${escH(g.ccy)} · ${fmtPct(g.share * 100)} of your assets</th></tr>` + g.accounts.map(a => `<tr data-w2t-fx="${escH(a.id)}" data-v="${a.rp}"><td class="merchant ex-full"><div class="merchant-name">${escH(a.name)}</div></td>
      <td data-label="Currency">${escH(a.ccy)}</td><td class="num" data-label="In that currency">${a.foreign != null ? `<span class="amt">${escH(fxText(a.foreign))}</span>` : '<span class="faint">not in the book</span>'}</td><td class="num" data-label="In rupiah">${money(a.rp)}</td></tr>`).join('')).join('');
    const body = d.fx.length ? table('w2tFx', '<th scope="col">Account</th><th scope="col">Currency</th><th scope="col" class="num">In that currency</th><th scope="col" class="num">In rupiah (book)</th>',
      `${rows}<tr class="ex-total"><td class="ex-full" colspan="3">Total foreign-currency holdings</td><td class="num" data-label="In rupiah">${money(d.fxTotal)}</td></tr>`)
      : emptyHTML('globe', 'No foreign-currency accounts with a balance');
    return `<section class="card flush span-12" id="w2tFxCard">${cardHead('globe', 'Foreign-currency holdings', 'Accounts kept in another currency, in rupiah as your book carries them. These are already inside Assets.')}${body}</section>`;
  }
  function render() {
    const g = gate(); if (g) return g;
    const b = B(), ys = years(b);
    if (T.year == null || !ys.includes(T.year)) T.year = defaultYear(ys);
    const d = taxData(b, T.year, T.compare), cmp = d.cmp, cy = curYear();
    const bar = `<div class="w2t-bar"><label><span class="sr-only">Tax year</span><select class="input" id="w2tYear" aria-label="Tax year" onchange="w2Tax.year(this.value)">${ys.slice().reverse().map(y => `<option value="${y}"${y === T.year ? ' selected' : ''}>Tax year ${y}${y === cy ? ' · so far' : ''}</option>`).join('')}</select></label>
      <span class="grow"></span>
      <button class="btn btn-secondary btn-sm" id="w2tCompare" aria-pressed="${cmp}" onclick="w2Tax.compare()"${d.prev ? '' : ' disabled title="The book has no earlier year"'}>${cmp ? 'Hide last year' : 'Compare with last year'}</button>
      <button class="btn btn-primary btn-sm" id="w2tXl" onclick="w2Tax.download()">${ic('download', 's16')}Download Excel</button></div>`;
    const note = `<div class="w2t-note" id="w2tNote" role="note">${ic('info', 's16')}<span>This page gathers your own figures for the annual tax return. <b>Confirm the list of fields with your tax accountant before filing.</b> It is not tax advice, and nothing here is sent anywhere.</span></div>`;
    const kpis = kpi('w2tKIncome', 'Income (Penghasilan)', d.incomeTotal, plural(d.income.filter(r => !r.gone).length, 'type') + ', before tax')
      + kpi('w2tKTax', 'Tax already paid', d.taxTotal, 'withheld from your income')
      + kpi('w2tKAssets', `Assets (Harta) · ${d.yi.finished ? '31 Dec' : 'today'}`, d.assetsCost, 'at cost')
      + kpi('w2tKDebts', `Debts (Utang) · ${d.yi.finished ? '31 Dec' : 'today'}`, d.debtsTotal, plural(d.debts.filter(r => !r.gone).length, 'debt'));
    const soFar = d.yi.finished ? '' : `<p class="help" id="w2tSoFar" style="margin:0 0 16px">${d.year} is not finished: income runs to today and the balances are today’s, not 31 December’s.</p>`;
    return `${pageHead(TITLE, DESC, hideBtn())}${bar}${note}${soFar}
      <div class="grid" id="w2tKpis" data-year="${d.year}" data-asof="${escH(d.yi.asOf)}" data-compare="${cmp}">${kpis}</div>
      <div class="grid">${checklist(d)}</div>
      <div class="grid">${incomeCard(d, cmp)}</div>
      <div class="grid">${assetsCard(d, cmp)}</div>
      <div class="grid">${debtsCard(d, cmp)}</div>
      <div class="grid">${oldCard(d)}</div>
      <div class="grid">${fxCard(d)}</div>
      <p class="ex-note">Income is counted before tax. Assets show the cost you typed, or the book balance where no cost is filled in; bank accounts and money owed to you show their balance. The Excel file has one sheet per section with the same totals. Nothing on this page changes an entry, except setting an income type from the checklist.</p>`;
  }
  X.year = function (y) { T.year = +y; renderAll(); };
  X.compare = function () { T.compare = !T.compare; renderAll(); };

  /* ── Ticks: declared per line, slip per income type (settings.taxDeclared / taxSlips, per year) ── */
  // The engine's setSetting knows a fixed list of keys. Until it lists these two, the page writes
  // them the same way itself: the value, the settings time stamp and an audit record.
  function setS(w, key, value) {
    try { bookLib.setSetting(w, key, value); }
    catch (e) {
      if (!/is not a setting/.test(String(e && e.message))) throw e;
      const at = new Date().toISOString(), before = w.settings[key] == null ? null : cp(w.settings[key]);
      w.settings[key] = cp(value); w.settings.at = at;
      if (Array.isArray(w.audit)) w.audit.push({ id: 'u-' + rid(10), at, entity: 'settings', ref: key, action: 'edit', before: { [key]: before }, after: { [key]: cp(value) } });
    }
  }
  X.tick = function (kind, box) {
    const setting = kind === 'slip' ? 'taxSlips' : 'taxDeclared', key = box.getAttribute(kind === 'slip' ? 'data-w2t-slip' : 'data-w2t-declared'), on = !!box.checked, y = String(T.year);
    try {
      book2Do(w => {
        const all = cp(w.settings[setting]) || {}, mine = { ...(all[y] || {}) };
        if (on) mine[key] = true; else delete mine[key];
        all[y] = mine; setS(w, setting, all);
      }, 'tax-' + kind);
    } catch (e) { box.checked = !on; toast(errText(e)); }
  };

  /* ── Fill: the assets missing a year or a cost, one after another ── */
  let F = null;
  const fillTitle = () => (F.queue.length > 1 ? `Fill · ${F.i + 1} of ${F.queue.length}` : 'Year bought and cost');
  function fillBody() {
    const b = B(), a = b.accounts[F.queue[F.i]], t = a.tax || {}, bal = bookLib.balances(b, yearInfo(T.year).asOf)[a.id] || 0;
    return `<p class="muted" id="w2tfWhat" data-id="${escH(a.id)}" style="margin:0 0 14px"><b>${escH(a.name)}</b> · ${escH(KIND[a.role] || 'Asset')}<br>Your book shows ${money(bal)} at ${escH(yearInfo(T.year).label)}.</p>
      <div class="form-grid"><div class="field"><label class="label" for="w2tfYear">Year bought</label><input class="input" id="w2tfYear" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="e.g. ${T.year}" value="${t.year ? escH(t.year) : ''}"></div>
      <div class="field"><label class="label" for="w2tfCost">What it cost</label><div class="input-affix"><span class="affix">Rp</span><input class="input" id="w2tfCost" inputmode="numeric" autocomplete="off" value="${Number.isInteger(t.cost) ? escH(t.cost.toLocaleString('id-ID')) : ''}"></div>
        <div class="help"><button class="btn btn-ghost btn-sm" id="w2tfUse" type="button" onclick="w2Tax.fillUseBook(${bal})">Use the book balance</button></div></div>
      <div class="field full"><label class="label" for="w2tfNote">Note (optional): what it is, where it is held</label><input class="input" id="w2tfNote" maxlength="80" autocomplete="off" value="${escH(t.note || '')}"></div>
      <div class="help err full" id="w2tfErr" role="alert" style="display:none">${ic('triangle-alert', 's16')}<span></span></div></div>`;
  }
  function fillShow() {
    const box = el('w2tfBox'); if (!box) return;
    box.innerHTML = fillBody();
    const title = box.closest('.sheet') && box.closest('.sheet').querySelector('.sheet-title'); if (title) title.textContent = fillTitle();
    const save = el('w2tfSave'); if (save) save.textContent = F.i >= F.queue.length - 1 ? 'Save' : 'Save and next';
    const y = el('w2tfYear'); if (y) y.focus();
  }
  const fillFoot = () => `${F.queue.length > 1 ? `<button class="btn btn-ghost left" id="w2tfSkip" onclick="w2Tax.fillSkip()">Skip</button>` : ''}<button class="btn btn-secondary" onclick="closeTopSheet(true)">Close</button><button class="btn btn-primary" id="w2tfSave" onclick="w2Tax.fillSave()">${F.queue.length > 1 ? 'Save and next' : 'Save'}</button>`;
  X.fill = function (id) {
    const b = B(); if (!b) return;
    const queue = id ? [id] : taxData(b, T.year).missing;
    if (!queue.length || queue.some(q => !b.accounts[q])) return;
    F = { queue, i: 0, saved: 0 };
    openSheet({ title: fillTitle(), focus: '#w2tfYear', onEnter: () => X.fillSave(), body: `<div id="w2tfBox">${fillBody()}</div>`, foot: fillFoot() });
  };
  X.fillUseBook = function (bal) { const c = el('w2tfCost'); if (c) { c.value = Math.round(bal).toLocaleString('id-ID'); c.focus(); } };
  function fillErr(msg) { const e = el('w2tfErr'); if (!e) { toast(msg); return; } e.style.display = msg ? '' : 'none'; e.querySelector('span').textContent = msg || ''; }
  function fillNext() {
    if (F.i >= F.queue.length - 1) { const n = F.saved; closeTopSheet(true); F = null; if (n) toast(n === 1 ? 'Saved' : `Saved ${n} assets`); return; }
    F.i++; fillShow();
  }
  X.fillSkip = function () { if (F) fillNext(); };
  X.fillSave = function () {
    if (!F || !el('w2tfYear')) return;
    const id = F.queue[F.i], year = +String(el('w2tfYear').value).trim(), cost = meParse(el('w2tfCost').value), note = el('w2tfNote').value.trim();
    if (!(Number.isInteger(year) && year >= 1900 && year <= curYear())) { fillErr(`Enter the year it was bought, between 1900 and ${curYear()}`); return; }
    if (!(typeof cost === 'number' && Number.isInteger(cost) && cost >= 0)) { fillErr('Enter what it cost, in whole rupiah'); return; }
    try { book2Do(w => bookLib.editAccount(w, id, { tax: { year, cost, note } }), 'tax-fill'); }
    catch (e) { fillErr(errText(e)); return; }
    F.saved++; fillNext();
  };

  /* ── Income entries without a type: show them, and set a type ── */
  const TYPES = ['Salary', 'Business', 'Interest', 'Dividends', 'Gifts'];
  function typeChoices(b) {
    const seen = new Set(), out = [];
    for (const t of [...live(b.accounts).filter(a => isIncomeAcc(a) && !a.header && !a.hidden).map(a => a.incomeType || a.name), ...TYPES]) {
      if (low(t) === UNTYPED || seen.has(low(t))) continue; seen.add(low(t)); out.push(t);
    }
    return out;
  }
  function typesBody() {
    const b = B(), d = taxData(b, T.year), opts = typeChoices(b).map(t => `<option value="${escH(t)}">${escH(t)}</option>`).join('');
    if (!d.untyped.length) return '<p class="muted" id="w2ttDone">Every income entry of this year has a type now.</p>';
    return `<p class="muted" style="margin:0 0 8px">These entries sit under “Other income”. Choose what each one was.</p><div class="list">${d.untyped.map(id => { const e = b.entries[id];
      const amt = -(e.lines || []).filter(l => { const a = b.accounts[l.account]; return isIncomeAcc(a) && low(a.incomeType || a.name) === UNTYPED; }).reduce((s, l) => s + l.amount, 0);
      return `<div class="list-item" data-w2t-untyped="${escH(id)}" style="align-items:flex-start"><div class="li-body"><div class="li-title">${escH(e.description || 'Income')}</div><div class="li-sub">${escH(dayText(e.date))} · ${money(amt)}</div>
        <div class="w2t-pick"><select class="input" aria-label="Income type for ${escH(e.description || 'this entry')}">${opts}</select><button class="btn btn-secondary btn-sm" onclick="w2Tax.setType('${escAttr(id)}',this)">Set type</button></div></div></div>`; }).join('')}</div>
      <div class="help err" id="w2ttErr" role="alert" style="display:none;margin-top:10px">${ic('triangle-alert', 's16')}<span></span></div>`;
  }
  X.types = function () { if (!B()) return; openSheet({ title: 'Income without a type', confirmDiscard: false, body: `<div id="w2ttBox">${typesBody()}</div>`, foot: `<button class="btn btn-secondary" onclick="closeTopSheet(true)">Close</button>` }); };
  X.setType = function (id, btn) {
    const type = btn.parentElement.querySelector('select').value; if (!type) return;
    try {
      book2Do(w => {
        const e = w.entries[id], to = bookLib.incomeAccount(w, type);
        const lines = e.lines.map(l => { const a = w.accounts[l.account]; return isIncomeAcc(a) && low(a.incomeType || a.name) === UNTYPED ? { ...l, account: to } : l; });
        bookLib.edit(w, id, { lines }, 'Income type set on the Tax page');
      }, 'tax-type');
    } catch (e) { const box = el('w2ttErr'); if (box) { box.style.display = ''; box.querySelector('span').textContent = errText(e); } else toast(errText(e)); return; }
    const box = el('w2ttBox'); if (box) box.innerHTML = typesBody();
    toast(`Set to ${type}`);
  };

  /* ── Excel: tax-pack-<year>.xlsx, one sheet per section with totals. ExcelJS is loaded the way the
     original SPT pack loads it (the core's xlLib: pinned version, integrity hash, on first use). ── */
  async function workbook(d) {
    if (typeof xlLib !== 'function') throw new Error('The Excel library is not available');
    const E = await xlLib(), wb = new E.Workbook(), py = d.cmp ? d.prevYear : null;
    const NUM = '#,##0', HDR = { bold: true }, FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
    const sheet = (name, cols) => {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = cols.map(c => ({ header: c.h, width: c.w, style: c.fmt ? { numFmt: c.fmt } : {} }));
      const r = ws.getRow(1); r.font = HDR; r.eachCell(c => { c.fill = FILL; c.border = { bottom: { style: 'thin' } }; });
      return ws;
    };
    const total = (ws, vals) => { const r = ws.addRow(vals); r.font = HDR; r.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: 'thin' } }; }); };
    const yn = v => (v ? 'Yes' : 'No'), flagOf = r => (r.gone ? 'Gone since last year' : r.isNew ? 'New this year' : '');
    const last = py ? [{ h: `31 Dec ${py} (Rp)`, w: 20, fmt: NUM }, { h: 'Change (Rp)', w: 18, fmt: NUM }, { h: 'Compared with last year', w: 24 }] : [];
    const lastOf = r => (py ? [r.prev, r.change, flagOf(r)] : []), lastTot = (now, was) => (py ? [was, now - was, ''] : []);
    const c = d.check, of = x => (x.of ? `${x.done} of ${x.of}` : 'none');

    const s = sheet('Summary', [{ h: 'Item', w: 46 }, { h: 'Value', w: 26, fmt: NUM }]);
    s.addRow(['Tax year', String(d.year)]); s.addRow(['Figures as of', d.yi.asOf]);
    s.addRow(['Note', 'Your own figures from the book. Confirm the list of fields with your tax accountant before filing.']);
    s.addRow(['Total income, before tax (Penghasilan)', d.incomeTotal]); s.addRow(['Tax already paid (withheld from income)', d.taxTotal]);
    s.addRow(['Tax booked on entries of its own (not in the totals)', d.otherTax]);
    s.addRow(['Assets at cost (Harta)', d.assetsCost]); s.addRow(['Assets, book balance', d.assetsBook]); s.addRow(['Debts (Utang)', d.debtsTotal]);
    s.addRow(['Owed to you for over one year', d.oldTotal]); s.addRow(['Foreign-currency holdings, in rupiah', d.fxTotal]);
    s.addRow(['Checklist: months locked', of(c.months)]); s.addRow(['Checklist: assets with year bought and cost', of(c.assets)]);
    s.addRow(['Checklist: income entries with a type', of(c.typed)]); s.addRow(['Checklist: withholding slips received', of(c.slips)]);
    s.addRow(['Lines ticked as declared', `${d.declared.done} of ${d.declared.of}`]);

    const inc = sheet('Income (Penghasilan)', [{ h: 'Income type', w: 30 }, { h: 'Income before tax (Rp)', w: 22, fmt: NUM }, { h: 'Tax withheld (Rp)', w: 20, fmt: NUM }, { h: 'Slip received', w: 14 }, { h: 'Declared', w: 12 }, ...last]);
    d.income.forEach(r => inc.addRow([r.type, r.amount, r.tax, r.gone ? '' : yn(r.slip), r.gone ? '' : yn(r.declared), ...lastOf(r)]));
    total(inc, ['Total income', d.incomeTotal, d.taxTotal, '', '', ...lastTot(d.incomeTotal, d.prev ? d.prev.incomeTotal : 0)]);

    const BASIS = { cost: 'cost', book: 'book value, cost not filled', balance: 'balance' };
    const as = sheet('Assets (Harta)', [{ h: 'Asset', w: 36 }, { h: 'Code', w: 12 }, { h: 'Kind', w: 20 }, { h: 'Currency', w: 10 }, { h: 'Year bought', w: 12 }, { h: 'Cost (Rp)', w: 20, fmt: NUM }, { h: 'Cost is', w: 26 },
      { h: 'Book balance (Rp)', w: 20, fmt: NUM }, { h: 'Market value (Rp)', w: 20, fmt: NUM }, { h: 'Note', w: 30 }, { h: 'Declared', w: 12 }, ...last]);
    d.assets.forEach(r => { const row = as.addRow([r.name, r.code, r.kind, r.ccy, r.year || null, r.amount, r.gone ? '' : BASIS[r.basis], r.book, r.market, r.note || '', r.gone ? '' : yn(r.declared), ...lastOf(r)]); row.getCell(2).numFmt = '@'; row.getCell(5).numFmt = '0'; });
    total(as, ['Total assets at cost', '', '', '', '', d.assetsCost, '', d.assetsBook, '', '', '', ...lastTot(d.assetsCost, d.prev ? d.prev.assetsCost : 0)]);

    const de = sheet('Debts (Utang)', [{ h: 'Debt · lender', w: 36 }, { h: 'Code', w: 12 }, { h: 'Kind', w: 22 }, { h: 'Currency', w: 10 }, { h: 'Since (year)', w: 12 }, { h: 'You owe (Rp)', w: 20, fmt: NUM }, { h: 'Declared', w: 12 }, ...last]);
    d.debts.forEach(r => { const row = de.addRow([r.name, r.code, r.kind, r.ccy, r.year || null, r.amount, r.gone ? '' : yn(r.declared), ...lastOf(r)]); row.getCell(2).numFmt = '@'; row.getCell(5).numFmt = '0'; });
    total(de, ['Total debts', '', '', '', '', d.debtsTotal, '', ...lastTot(d.debtsTotal, d.prev ? d.prev.debtsTotal : 0)]);

    const ol = sheet('Owed over one year', [{ h: 'Who', w: 34 }, { h: 'Oldest open item', w: 18 }, { h: 'Age (months)', w: 14, fmt: '0' }, { h: 'Open over one year (Rp)', w: 24, fmt: NUM }, { h: 'Owes you in all (Rp)', w: 22, fmt: NUM }]);
    d.old.forEach(r => ol.addRow([r.name, r.oldest, r.months, r.amount, r.total]));
    total(ol, ['Total open over one year', '', '', d.oldTotal, '']);

    const fx = sheet('Foreign currency', [{ h: 'Account', w: 34 }, { h: 'Currency', w: 10 }, { h: 'Amount in that currency', w: 24, fmt: '#,##0.00' }, { h: 'In rupiah, book (Rp)', w: 22, fmt: NUM }, { h: 'Share of assets', w: 16, fmt: '0.0%' }]);
    d.fx.forEach(g => g.accounts.forEach(a => fx.addRow([a.name, a.ccy, a.foreign, a.rp, d.assetsBook ? a.rp / d.assetsBook : 0])));
    total(fx, ['Total foreign-currency holdings', '', '', d.fxTotal, d.assetsBook ? d.fxTotal / d.assetsBook : 0]);
    return wb;
  }
  X.workbook = async function (year) { const d = X.data(year); if (!d) throw new Error('The new book is not set up yet'); return { wb: await workbook(d), d }; };
  X.download = async function () {
    const d = X.data(); if (!d) return;
    let wb; try { wb = await workbook(d); } catch (e) { toast(errText(e) || 'Could not build the Excel file'); return; }
    const buf = await wb.xlsx.writeBuffer(), name = `tax-pack-${d.year}.xlsx`;
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Saved ${name}`);
  };

  registerPage({ key: 'w2-tax', label: 'Tax', icon: 'file-text', group: 'w2', order: 80, render });
})();
