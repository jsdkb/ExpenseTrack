/* ExpenseTrack v6 — Home · new (w2-home) and Performance (w2-perf), docs/v6-book.md §10.

   Every figure comes from the new book through bookLib (netWorth, actualSpending, income, saved,
   bridge, people, balances); every change goes through book2Do. The new book keeps its own budgets
   and goals in settings.budgets / settings.goals. Read-only towards everything old (§0): this file
   never writes STATE, never calls scheduleDriveSave() or a mutating ledger* function and registers
   no transform. It reads STATE.budgets / STATE.goals only when the owner taps "Copy", and the
   original's statement calendar only through runHooks('homeComingUp'). Functions of other preview
   files (Inbox, Month check, Add) are used only when they exist. No personal data in this file. */
(function () {
  'use strict';
  if (typeof bookLib === 'undefined' || typeof BOOK2 !== 'function' || typeof book2Do !== 'function' || typeof registerPage !== 'function') {
    console.warn('ExpenseTrack preview: the new book store is not loaded, so Home · new and Performance stay off.');
    return;
  }
  const P = window.w2Perf = {};

  /* ── Small helpers ── */
  const B = () => BOOK2();
  const cp = o => JSON.parse(JSON.stringify(o));
  const p2 = n => String(n).padStart(2, '0');
  const errText = e => (e && Array.isArray(e.errors) && e.errors.length ? e.errors.join(' · ') : String((e && e.message) || e));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const curMonth = () => today().slice(0, 7);
  const shiftM = (M, k) => { let [y, m] = M.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${p2(m)}`; };
  const diffM = (a, b) => { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
  const monthsBetween = (a, b) => { const out = []; for (let M = a, i = 0; M <= b && i < 600; M = shiftM(M, 1), i++) out.push(M); return out; };
  const monthEnd = M => { const [y, m] = M.split('-').map(Number); return `${M}-${p2(new Date(y, m, 0).getDate())}`; };
  const daysIn = M => +monthEnd(M).slice(8);
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const daysSince = iso => Math.max(0, Math.round((new Date(today() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000));
  const dayText = iso => { try { return fmtDayLong(new Date(String(iso).slice(0, 10) + 'T00:00:00')); } catch (_) { return String(iso || ''); } };
  const money = n => `<span class="amt">${fmtIDR(n)}</span>`;
  const signedText = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtIDR(Math.abs(n));
  const signed = (n, cls) => `<span class="amt${cls ? ' ' + cls : ''}">${signedText(n)}</span>`;
  const tone = n => (n > 0 ? 'good' : n < 0 ? 'bad' : '');
  const pctText = p => (p > 0 ? '+' : p < 0 ? '−' : '') + fmtPct(Math.abs(p));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const el = id => document.getElementById(id);
  const q = s => escAttr(s);
  const live = o => Object.values(o || {}).filter(x => x && !x.deleted);
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const rpInput = (id, val, attrs) => `<div class="input-affix"><span class="affix">Rp</span><input class="input" id="${id}" inputmode="numeric" autocomplete="off" value="${val == null ? '' : escH(Math.round(val).toLocaleString('id-ID'))}" ${attrs || ''}></div>`;
  function showErr(id, msg) { const b = el(id); if (!b) { toast(msg); return; } b.style.display = msg ? '' : 'none'; b.querySelector('span').textContent = msg || ''; }
  const errBox = id => `<div class="help err full" id="${id}" role="alert" style="display:none">${ic('triangle-alert', 's16')}<span></span></div>`;
  const hasPage = key => typeof PAGES !== 'undefined' && Array.isArray(PAGES) && PAGES.some(p => p && p.key === key);
  const bar = (pct, over, label) => `<div class="progress${over ? ' over' : ''}" role="progressbar" aria-valuenow="${Math.max(0, Math.min(100, Math.round(pct)))}" aria-valuemin="0" aria-valuemax="100" aria-label="${escH(label)}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

  // Layout only: spacing and wrapping built from the existing tokens. No colours, fonts or icons added.
  if (!el('w2PerfStyle')) {
    const st = document.createElement('style'); st.id = 'w2PerfStyle';
    st.textContent = `
      .w2p-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:16px}
      .w2p-bar .grow{flex:1 1 0;min-width:0}
      .w2p-bar .seg{max-width:100%;overflow-x:auto;scrollbar-width:none}
      .w2p-row{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border)}
      .w2p-row:first-child{border-top:none}
      .w2p-row .li-body{flex:1 1 170px;min-width:0}
      .w2p-row .li-title,.w2p-row .li-sub{overflow-wrap:anywhere;white-space:normal}
      .w2p-side{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;font-size:14px;text-align:right}
      .w2p-side b{font-weight:600;white-space:nowrap}
      .w2p-col{display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:14px;white-space:nowrap}
      .w2p-item{padding:12px 0;border-top:1px solid var(--border)}
      .w2p-item:first-child{border-top:none}
      .w2p-top{display:flex;justify-content:space-between;align-items:baseline;gap:6px 12px;flex-wrap:wrap;font-size:14px;margin-bottom:8px}
      .w2p-top .n{font-weight:500;overflow-wrap:anywhere;min-width:0}
      .w2p-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 16px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
      .w2p-stats dd{font-size:15px;line-height:20px;font-weight:600;margin-top:4px}
      .w2p-stats .s{font-size:12px;line-height:16px;color:var(--text-3);margin-top:2px;font-weight:400}
      .w2p-sub{font-weight:600}
      .w2p-card{text-align:left;width:100%}
      .w2p-budrow{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)}
      .w2p-budrow:first-child{border-top:none}
      .w2p-budrow label{flex:1 1 150px;min-width:0;font-size:14px;overflow-wrap:anywhere}
      .w2p-budrow .input-affix{flex:0 1 190px}
      @media (max-width:767px){
        .w2p-side{margin-left:0;justify-content:flex-start;text-align:left;flex:1 1 100%}
        .w2p-col{align-items:flex-start}
        .w2p-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
      }`;
    document.head.appendChild(st);
  }
  if (typeof registerIcon === 'function') {
    registerIcon('users', '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>');
    registerIcon('target', '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>');
    registerIcon('gauge', '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>');
  }

  /* ── States shared by both pages: signed out, loading, error, blocked, no book yet ── */
  function gate(title, desc) {
    const st = book2Status(), b = B();
    if (b && st !== 'blocked') return null;
    const wrap = (inner, busy) => `${pageHead(title, desc)}<div class="grid"><section class="card span-12" data-w2-state="${escH(st)}"${busy ? ' aria-busy="true"' : ''}>${inner}</section></div>`;
    const go = `<button class="btn btn-primary btn-sm" id="w2GoStart" onclick="setTab('w2-start')">Open Start here</button>`;
    const problem = (head, text) => `<div class="card-error">${ic('triangle-alert', 's24')}<div style="flex:1;min-width:0"><div style="font-weight:600;color:var(--text-1)">${escH(head)}</div><div class="help">${escH(text)}</div></div>${go}</div>`;
    if (typeof USER_EMAIL !== 'string' || !USER_EMAIL) return wrap(emptyHTML('lock', 'Sign in to see the new book'));
    if (st === 'blocked') return wrap(problem('The new book can’t be opened', 'Its file in Google Drive can’t be read by this version of the app. Your current book is not affected.'));
    if (st === 'idle' || st === 'loading') return wrap('<div class="skel" style="width:60%;height:14px"></div><div class="skel" style="width:40%;height:14px;margin-top:10px"></div><div class="skel" style="width:50%;height:14px;margin-top:10px"></div>', true);
    if (st === 'error') return wrap(problem('Couldn’t reach Google Drive', (typeof book2Error === 'function' && book2Error()) || 'Try again from Start here.'));
    return wrap(`<div class="empty">${ic('book-open', 's40')}<div class="e-title">Set up your accounts first. Start here copies your current book into the new one.</div>${go}</div>`);
  }
  // Runs a change; on a refusal shows the engine's own message in the sheet.
  function change(fn, why, errId) {
    try { return { ok: true, value: book2Do(fn, why) }; }
    catch (e) { showErr(errId, errText(e)); return { ok: false }; }
  }
  // Budgets and goals are settings of the new book. An engine that does not know the key yet
  // refuses it; then the value is written on the working copy directly (same record, same stamp).
  function setS(w, key, value) {
    try { bookLib.setSetting(w, key, value); }
    catch (e) { if (!/is not a setting/.test(errText(e))) throw e; w.settings[key] = cp(value); w.settings.at = new Date().toISOString(); }
  }

  /* ── The book, read ── */
  const V = { view: 'book' };                       // Book / Market, shared by Home and Performance
  const CASH_ROLES = ['bank', 'cash', 'ewallet'];
  function firstMonth(b) {
    const cur = curMonth(); let first = String((b.settings || {}).firstMonth || '');
    for (const e of live(b.entries)) if (e.status === 'posted' && (!first || e.date.slice(0, 7) < first)) first = e.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(first) || first > cur) first = cur;
    return first;
  }
  const allMonths = b => monthsBetween(firstMonth(b), curMonth());
  const sumRoles = (b, bal, roles) => live(b.accounts).filter(a => !a.header && roles.includes(a.role)).reduce((s, a) => s + (bal[a.id] || 0), 0);
  const cashAt = (b, M) => sumRoles(b, bookLib.balances(b, monthEnd(M)), CASH_ROLES);
  function valuesAt(b, M) { const best = {}; for (const v of live(b.values)) if (v.month <= M && (!best[v.account] || v.month > best[v.account].month)) best[v.account] = v; return best; }

  // The months of a period ending at M: one month, the year so far, or twelve months. Never before the book starts.
  function periodMonths(b, mode, M) {
    const first = firstMonth(b); let from = mode === 'ytd' ? M.slice(0, 4) + '-01' : mode === '12m' ? shiftM(M, -11) : M;
    if (from < first) from = first; if (from > M) from = M;
    return monthsBetween(from, M);
  }
  function periodLabel(months) {
    const a = months[0], z = months[months.length - 1];
    return a === z ? monthLabel(z, true) : a.slice(0, 4) === z.slice(0, 4) ? `${monthLabel(a, true).replace(/ \d{4}$/, '')} to ${monthLabel(z, true)}` : `${monthLabel(a)} to ${monthLabel(z)}`;
  }
  // The engine's bridge, month by month, added up. One month's closing is the next month's opening,
  // so the sum adds up exactly as each month does. Book view: the same without the market line.
  function bridgeOf(b, months, view) {
    const t = { income: 0, spending: 0, market: 0, fx: 0, unexplained: 0, other: 0 };
    let first = null, last = null;
    for (const m of months) { const x = bookLib.bridge(b, m); if (!first) first = x; last = x; for (const k of Object.keys(t)) t[k] += x[k]; }
    t.opening = first.opening; t.closing = last.closing;
    if (view !== 'market') { t.market = 0; t.opening = bookLib.netWorth(b, shiftM(months[0], -1), 'book').net; t.closing = bookLib.netWorth(b, months[months.length - 1], 'book').net; }
    t.saved = t.income - t.spending; t.change = t.closing - t.opening;
    t.ok = t.opening + t.income - t.spending + t.market + t.fx + t.unexplained + t.other === t.closing;
    return t;
  }
  // Which line of the bridge a line of an entry belongs to (the engine's own rule); null = net worth itself.
  function partOf(b, e, l) {
    const a = b.accounts[l.account] || null, k = a ? a.kind : 'asset';
    if (k === 'asset' || k === 'liability') return null;
    if (e.kind === 'year-end' || k === 'equity') return 'other';
    if (a.role === 'fx') return 'fx';
    if (a.role === 'unexplained') return 'unexplained';
    return k === 'income' ? 'income' : 'spending';
  }
  // The entries behind one line of the bridge, newest first: {e, v (as the line counts it), group}.
  function behind(b, months, part) {
    const set = new Set(months), rows = [];
    for (const e of live(b.entries)) {
      if (e.status !== 'posted' || !set.has(e.date.slice(0, 7))) continue;
      let v = 0, hit = false; const names = [];
      for (const l of e.lines || []) {
        if (partOf(b, e, l) !== part) continue;
        hit = true; v += part === 'spending' ? l.amount : -l.amount;
        const a = b.accounts[l.account]; names.push(a ? (a.category || a.incomeType || a.name) : String(l.account));
      }
      if (hit) rows.push({ e, v, group: [...new Set(names)].join(', ') });
    }
    return rows.sort((x, y) => (x.e.date < y.e.date ? 1 : x.e.date > y.e.date ? -1 : String(y.e.createdAt || '').localeCompare(String(x.e.createdAt || ''))));
  }
  // The market line by account: how much (typed value − what was paid) moved over the period.
  function marketBehind(b, months) {
    const z = months[months.length - 1], a0 = shiftM(months[0], -1);
    const gaps = M => { const bal = bookLib.balances(b, monthEnd(M)), vals = valuesAt(b, M), out = {};
      for (const id of Object.keys(vals)) { const a = b.accounts[id]; if (a && a.kind === 'asset' && !a.header) out[id] = { gap: vals[id].value - (bal[id] || 0), value: vals[id].value, paid: bal[id] || 0, month: vals[id].month }; }
      return out; };
    const g1 = gaps(z), g0 = gaps(a0);
    return [...new Set([...Object.keys(g1), ...Object.keys(g0)])].map(id => ({ a: b.accounts[id], v: (g1[id] ? g1[id].gap : 0) - (g0[id] ? g0[id].gap : 0), now: g1[id] || null }))
      .filter(r => r.v || r.now).sort((x, y) => Math.abs(y.v) - Math.abs(x.v) || byName(x.a, y.a));
  }

  /* ── Budgets ── */
  const budgetMap = b => { const o = (b.settings || {}).budgets; return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; };
  const budgetList = b => { const o = budgetMap(b); return Object.keys(o).filter(c => o[c] && !o[c].deleted && o[c].monthly > 0).map(c => ({ cat: c, monthly: o[c].monthly, since: o[c].since || '' })); };
  function spentBy(b, months) { const out = {}; for (const m of months) { const by = bookLib.actualSpending(b, m).byCategory; for (const c of Object.keys(by)) out[c] = (out[c] || 0) + by[c]; } return out; }
  // Per budget: spent in the period against the monthly amount × the months of the period.
  function budgetData(b, months) {
    const spent = spentBy(b, months), n = months.length, z = months[n - 1], nowMonth = n === 1 && z === curMonth();
    const day = nowMonth ? +today().slice(8) : daysIn(z), dim = daysIn(z);
    const rows = budgetList(b).map(x => {
      const s = spent[x.cat] || 0, budget = x.monthly * n, projected = nowMonth && day >= 2 ? Math.round(s / day * dim) : s;
      return { ...x, spent: s, budget, pct: budget ? s / budget * 100 : 0, over: s - budget, status: s > budget ? 'over' : projected > budget ? 'watch' : 'ok' };
    }).sort((x, y) => y.pct - x.pct || x.cat.localeCompare(y.cat));
    const have = new Set(rows.map(r => r.cat)), rest = Object.keys(spent).filter(c => !have.has(c) && spent[c] > 0);
    return { rows, n, nowMonth, day, dim, budget: rows.reduce((s, r) => s + r.budget, 0), spent: rows.reduce((s, r) => s + r.spent, 0),
      restTotal: rest.reduce((s, c) => s + spent[c], 0), restCount: rest.length };
  }
  const oldBudgets = () => { const o = (typeof STATE !== 'undefined' && STATE && STATE.budgets) || {}; return Object.keys(o).filter(c => o[c] && !o[c].deleted && o[c].monthly > 0).map(c => ({ cat: c, monthly: Math.round(o[c].monthly), since: o[c].since || '' })); };
  const oldGoals = () => ((typeof STATE !== 'undefined' && STATE && Array.isArray(STATE.goals)) ? STATE.goals : []).filter(g => g && g.id && !g.deleted && g.target > 0);

  /* ── Investments: cost, value, gain and a return that never counts money put in as a gain ── */
  // Modified Dietz, as the original: (end − start − money added) ÷ (start + half the money added).
  function dietz(vStart, vEnd, bStart, bEnd) {
    if (!(vStart > 0)) return null;
    const c = bEnd - bStart, den = vStart + c / 2;
    return den > 0 ? (vEnd - vStart - c) / den * 100 : null;
  }
  function holdings(b, M) {
    const memo = {}, balAt = m => memo[m] || (memo[m] = bookLib.balances(b, monthEnd(m)));
    return live(b.accounts).filter(a => a.role === 'investment' && !a.header).map(a => {
      const vals = live(b.values).filter(v => v.account === a.id && v.month <= M).sort((x, y) => (x.month < y.month ? -1 : 1));
      const h = { a, cost: balAt(M)[a.id] || 0, n: vals.length, value: null, asOf: null, costAt: null, gain: null, pct: null, ret: null, from: null, added: null };
      if (vals.length) {
        const z = vals[vals.length - 1];
        h.value = z.value; h.asOf = z.month; h.costAt = balAt(z.month)[a.id] || 0; h.gain = h.value - h.costAt; h.pct = h.costAt ? h.gain / h.costAt * 100 : null;
        if (vals.length > 1) { const f = vals[0], b0 = balAt(f.month)[a.id] || 0; h.from = f.month; h.added = h.costAt - b0; h.ret = dietz(f.value, z.value, b0, h.costAt); }
      }
      return h;
    }).filter(h => h.cost || h.n).sort((x, y) => y.cost - x.cost || byName(x.a, y.a));
  }

  /* ── Goals ── */
  const GOAL_KINDS = { networth: 'Net worth', liquid: 'Cash and bank', saving: 'Saving', account: 'Chosen accounts' };
  const GSTAT = { achieved: ['good', 'Goal reached'], on: ['good', 'On pace'], behind: ['warn', 'Behind'], overdue: ['bad', 'Past its date'] };
  const goalsRaw = b => (Array.isArray((b.settings || {}).goals) ? b.settings.goals : []);
  const goalList = b => goalsRaw(b).filter(g => g && g.id && !g.deleted);
  function measure(b, g, M) {
    if (g.kind === 'networth' || g.kind === 'saving') return bookLib.netWorth(b, M, 'book').net;
    const bal = bookLib.balances(b, monthEnd(M));
    if (g.kind === 'liquid') return sumRoles(b, bal, CASH_ROLES);
    return (g.accounts || []).reduce((s, id) => s + (bal[id] || 0), 0);
  }
  // Progress at the end of month M on book balances; pace = average monthly change over up to 6 months.
  function goalCalc(b, g, M) {
    const first = firstMonth(b), now = measure(b, g, M);
    let progress = now, base = null;
    if (g.kind === 'saving') {
      const since = g.since || String(g.at || '').slice(0, 7) || M;
      base = shiftM(since, -1); if (base < first) base = first;
      progress = since > M ? 0 : now - measure(b, g, base);
    }
    const n = Math.min(6, Math.max(0, diffM(first, M))), avg = n > 0 ? (now - measure(b, g, shiftM(M, -n))) / n : null;
    const monthsLeft = diffM(M, g.by), remaining = Math.max(0, g.target - progress), required = monthsLeft > 0 ? remaining / monthsLeft : remaining;
    const status = remaining <= 0 ? 'achieved' : monthsLeft <= 0 ? 'overdue' : avg != null && avg >= required ? 'on' : 'behind';
    return { progress, pct: g.target > 0 ? progress / g.target * 100 : 0, remaining, monthsLeft, required, avg, n, status, base };
  }

  /* ── Trends and runway ── */
  function trends(b, M) {
    const first = firstMonth(b), keys = []; for (let i = 11; i >= 0; i--) keys.push(shiftM(M, -i));
    const rows = keys.map(k => { if (k < first) return { month: k, income: null, spending: null, saved: null, rate: null }; const s = bookLib.saved(b, k); return { month: k, income: s.income, spending: s.spending, saved: s.saved, rate: s.income > 0 ? s.saved / s.income * 100 : null }; });
    const inBook = rows.filter(r => r.income != null), inc = inBook.reduce((s, r) => s + r.income, 0), sav = inBook.reduce((s, r) => s + r.saved, 0);
    // Runway: cash and bank ÷ the average spending of up to six months ending at M (the running month is left out).
    const pool = monthsBetween(first, M).filter(m => m !== curMonth()).slice(-6), cash = cashAt(b, M);
    const avg = pool.length ? pool.reduce((s, m) => s + bookLib.actualSpending(b, m).total, 0) / pool.length : null;
    return { rows, rate12: inc > 0 ? sav / inc * 100 : null, cash, avg, n: pool.length, runway: avg > 0 ? cash / avg : null };
  }

  /* ── Needs you ── */
  function comingRaw() {
    if (typeof runHooks !== 'function') return [];
    try { return runHooks('homeComingUp').filter(x => x && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x.date)).map(x => ({ ...x, date: x.date.slice(0, 10) })); } catch (_) { return []; }
  }
  // What waits for the owner: {key, n, text, amount?, btn, tab, note?}. tab = the page its button opens.
  function needs(b) {
    const out = [], M = curMonth(), t = today();
    if (typeof book2InboxCount === 'function') {
      let n = 0; try { n = +book2InboxCount() || 0; } catch (_) { n = 0; }
      if (n > 0) out.push({ key: 'inbox', n, text: `${plural(n, 'movement')} to answer`, btn: 'Open Inbox', tab: 'w2-inbox' });
    }
    const from = String((b.settings || {}).syncFrom || '').slice(0, 7) || firstMonth(b);
    const open = monthsBetween(from, shiftM(M, -1)).filter(m => bookLib.lockState(b, m) !== 'locked');
    if (open.length) out.push({ key: 'check', n: open.length, month: open[0], text: open.length === 1 ? `${monthLabel(open[0], true)} is ready to check` : `${monthLabel(open[0], true)} and ${plural(open.length - 1, 'more month')} are ready to check`, btn: 'Check month', tab: 'w2-check' });
    const c = typeof book2Counts === 'function' ? book2Counts() : null;
    if (c && c.waiting > 0) out.push({ key: 'link', n: c.waiting, text: `${plural(c.waiting, 'email row')} from a bank that is not linked yet`, btn: 'Link it', tab: 'w2-start' });
    const hi = addDays(t, 14);
    for (const x of comingRaw()) {
      if (x.date > hi) continue;
      if (x.kind === 'missing' || x.kind === 'manual') out.push({ key: 'statement', n: 1, text: String(x.label || 'A statement is late'), btn: 'See', tab: 'cards' });
      else if (x.kind === 'due' && +x.amount !== 0 && (x.date >= t || x.status === 'overdue' || x.status === 'unconfirmed'))
        out.push({ key: 'due', n: 1, text: `${x.label || 'Card payment due'} · ${dayText(x.date)}`, amount: x.amount != null && !isNaN(+x.amount) ? +x.amount : null, btn: 'See', tab: 'cards' });
    }
    return out;
  }
  P.needs = () => (B() ? needs(B()) : []);
  P.go = function (tab) { if (hasPage(tab) || (typeof BUILTIN_TABS !== 'undefined' && BUILTIN_TABS.includes(tab))) setTab(tab); else toast('That page is not part of this preview yet'); };
  P.view = function (v) { V.view = v === 'market' ? 'market' : 'book'; renderAll(); };
  const viewSeg = () => `<div class="seg" role="group" aria-label="Valuation"><button id="w2vBook" aria-pressed="${V.view !== 'market'}" onclick="w2Perf.view('book')" title="What you paid, from your book">Book</button><button id="w2vMarket" aria-pressed="${V.view === 'market'}" onclick="w2Perf.view('market')" title="The values you typed for investments and property">Market</button></div>`;
  const addBtn = () => (hasPage('w2-add') ? `<button class="btn btn-primary btn-sm" id="w2pAddBtn" onclick="setTab('w2-add')">${ic('plus', 's16')}Add</button>` : '');

  /* ════════════════ Home · new (w2-home) ════════════════ */
  function renderHome() {
    const title = 'Home · new', desc = 'Where you stand and what needs you, from the new book.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), M = curMonth(), market = V.view === 'market';
    const nw = bookLib.netWorth(b, M, V.view), d = nw.net - bookLib.netWorth(b, shiftM(M, -1), V.view).net;
    const sp = bookLib.actualSpending(b, M).total, sv = bookLib.saved(b, M), bd = budgetData(b, [M]);
    const bpct = bd.budget ? bd.spent / bd.budget * 100 : null, day = +today().slice(8), spct = sv.income > 0 ? sv.saved / sv.income * 100 : null;
    const kNet = `<button class="card kpi clickable span-4 w2p-card" id="w2hNet" data-v="${nw.net}" data-change="${d}" onclick="setTab('w2-networth')" aria-label="Net worth. Open Net worth">
        <span class="kpi-label">Net worth · ${market ? 'market value' : 'book value'}</span><span class="kpi-value">${money(nw.net)}</span>
        <span class="kpi-sub"><span class="delta ${tone(d) || 'neutral'}">${d > 0 ? '▲ ' : d < 0 ? '▼ ' : ''}${money(Math.abs(d))}</span><span class="vs">this month</span></span></button>`;
    const kSpend = `<div class="card kpi span-4" id="w2hSpend" data-v="${sp}" data-pct="${bpct == null ? '' : Math.round(bpct)}">
        <span class="kpi-label">Actual spending · ${escH(monthLabel(M))}</span><span class="kpi-value">${money(sp)}</span>
        <span class="kpi-sub">${bpct == null ? `<span class="vs">Day ${day} of ${daysIn(M)} · no budget set</span><button class="btn btn-ghost btn-sm" id="w2hSetBud" onclick="w2Perf.openMonth('${M}')">Set budgets</button>`
          : `<span${bd.spent > bd.budget ? ' class="delta bad"' : ''}>${Math.round(bpct)}% of budget</span><span class="vs">· day ${day} of ${daysIn(M)}</span>`}</span>
        ${bpct == null ? '' : bar(bpct, bd.spent > bd.budget, 'Share of this month’s budget used')}</div>`;
    const kSaved = `<div class="card kpi span-4" id="w2hSaved" data-v="${sv.saved}" data-pct="${spct == null ? '' : Math.round(spct)}">
        <span class="kpi-label">Saved · ${escH(monthLabel(M))} so far</span><span class="kpi-value">${signed(sv.saved, tone(sv.saved))}</span>
        <span class="kpi-sub">${spct == null ? '<span class="vs">No income entered this month yet</span>' : `<span>${Math.round(spct)}% of income</span><span class="vs">· income ${money(sv.income)}</span>`}</span></div>`;

    const list = needs(b);
    const need = list.length ? list.map(x => `<div class="w2p-row" data-w2-need="${escH(x.key)}" data-n="${x.n}"><div class="li-body"><div class="li-title">${escH(x.text)}${x.amount != null ? ' · ' + money(x.amount) : ''}</div>
        ${hasPage(x.tab) || x.tab === 'cards' ? '' : `<div class="li-sub">${x.key === 'check' ? 'Month check' : 'That page'} is not part of this preview yet.</div>`}</div>
        ${hasPage(x.tab) || x.tab === 'cards' ? `<div class="w2p-side"><button class="btn ${x.key === 'inbox' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-w2-go="${escH(x.tab)}" onclick="w2Perf.go('${q(x.tab)}')">${escH(x.btn)}</button></div>` : ''}</div>`).join('')
      : emptyHTML('calendar-check', 'Nothing needs you right now');
    const inboxNote = typeof book2InboxCount === 'function' ? '' : '<p class="help" id="w2hNoInbox" style="margin-top:8px">The Inbox for statement lines is not part of this preview yet, so movements to answer are not counted here.</p>';
    const ppl = bookLib.people(b); let owed = 0, nOwed = 0, owe = 0, nOwe = 0, oldest = null;
    for (const p of ppl) {
      if (p.owedToYou > 0) { owed += p.owedToYou; nOwed++; }
      if (p.youOwe > 0) { owe += p.youOwe; nOwe++; }
      for (const i of p.items) if (i.side === 'receivable' && (!oldest || i.date < oldest.date)) oldest = { date: i.date, name: p.name };
    }
    const people = `<div class="w2p-row" id="w2hOwed" data-v="${owed}" data-n="${nOwed}"><div class="li-body"><div class="li-title">Owed to you</div><div class="li-sub">${plural(nOwed, 'person', 'people')}</div></div><div class="w2p-side"><b>${money(owed)}</b></div></div>
      <div class="w2p-row" id="w2hOwe" data-v="${owe}" data-n="${nOwe}"><div class="li-body"><div class="li-title">You owe</div><div class="li-sub">${plural(nOwe, 'person', 'people')}</div></div><div class="w2p-side"><b>${money(owe)}</b></div></div>
      <div class="w2p-row"><div class="li-body"><div class="li-sub" id="w2hOldest">${oldest ? `Oldest: ${escH(oldest.name)}, ${plural(daysSince(oldest.date), 'day')}` : 'Nothing is open'}</div></div><div class="w2p-side"><button class="btn btn-secondary btn-sm" id="w2hPeople" onclick="w2Perf.go('w2-people')">People</button></div></div>`;

    const t = trends(b, M), any = t.rows.some(r => r.saved);
    const chart = `<section class="card span-12" id="w2hChartCard" aria-label="Saved each month">${cardHead('piggy-bank', 'Saved each month', '12 months · income minus actual spending · tap a bar to open that month in Performance', any ? tableToggle('w2hChartCard') : '')}
      ${any ? `<div class="chart-readout" id="w2hReadout" aria-live="polite"></div><div class="chart-box"><canvas id="w2hChart" role="img" aria-label="Saved per month, 12 months"></canvas></div>
        <div class="chart-table"><table class="data"><thead><tr><th scope="col">Month</th><th scope="col" class="num">Income</th><th scope="col" class="num">Spending</th><th scope="col" class="num">Saved</th></tr></thead><tbody>
        ${t.rows.filter(r => r.saved != null).map(r => `<tr><td>${escH(monthLabel(r.month))}</td><td class="num amt">${fmtIDR(r.income)}</td><td class="num amt">${fmtIDR(r.spending)}</td><td class="num amt">${signedText(r.saved)}</td></tr>`).join('')}</tbody></table></div>`
        : emptyHTML('piggy-bank', 'No income or spending in the new book yet')}</section>`;
    return `${pageHead(title, desc, `${addBtn()}${hideBtn()}`)}
      <div class="w2p-bar">${viewSeg()}<span class="grow"></span><button class="btn btn-secondary btn-sm" id="w2hPerf" onclick="w2Perf.go('w2-perf')">${ic('chart-column', 's16')}Performance</button><span class="only-sm">${addBtn().replace('w2pAddBtn', 'w2pAddBtnSm')}</span></div>
      <div class="grid">${kNet}${kSpend}${kSaved}</div>
      <div class="grid"><section class="card span-7" id="w2hNeeds" aria-label="Needs you">${cardHead('inbox', 'Needs you', 'What is waiting, each with the page that settles it')}${need}${inboxNote}</section>
        <section class="card span-5" id="w2hPeopleCard" aria-label="Owed to you and you owe">${cardHead('users', 'Owed to you · you owe', 'From the People page')}${people}</section></div>
      <div class="grid">${chart}</div>`;
  }
  function drawHome() {
    const c = el('w2hChart'), b = B(); if (!c || !b || typeof Chart === 'undefined') return;
    const rows = trends(b, curMonth()).rows, mobile = isMobile(), good = cssVar('--good'), bad = cssVar('--bad');
    const say = r => { const o = el('w2hReadout'); if (o && r) o.innerHTML = `${escH(monthLabel(r.month))} · <b class="amt">${amountsHidden() ? '•••' : signedText(r.saved)}</b>`; };
    say([...rows].reverse().find(r => r.saved != null));
    CHARTS.w2hChart = new Chart(c, { type: 'bar',
      data: { labels: rows.map(r => monthLabel(r.month).replace(/ \d{4}$/, '')), datasets: [{ data: rows.map(r => r.saved), backgroundColor: rows.map(r => (r.saved >= 0 ? good : bad)), borderRadius: 6, borderSkipped: false, maxBarThickness: mobile ? 18 : 28 }] },
      options: { responsive: true, maintainAspectRatio: false, ...animOnce(),
        onClick: (e, els) => { if (els.length && rows[els[0].index].saved != null) P.openMonth(rows[els[0].index].month); },
        onHover: (e, els) => { if (els.length && rows[els[0].index].saved != null) say(rows[els[0].index]); },
        plugins: { tooltip: { enabled: !mobile, displayColors: false, callbacks: { title: it => monthLabel(rows[it[0].dataIndex].month, true), label: x => (amountsHidden() ? '•••' : signedText(x.parsed.y)) } } },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: mobile ? 6 : 12, maxRotation: 0 } }, y: { border: { display: false }, ticks: { maxTicksLimit: 5, callback: moneyTick } } } } });
    P.homeChart = { keys: rows.map(r => r.month), vals: rows.map(r => r.saved) };
  }
  // A bar on Home, or "Set budgets": that month in Performance.
  P.openMonth = function (m) { F.mode = 'month'; F.month = m; setTab('w2-perf'); };

  /* ════════════════ Performance (w2-perf) ════════════════ */
  const F = { mode: 'month', month: null };
  const MODES = [['month', 'Month'], ['ytd', 'Year to date'], ['12m', '12 months']];
  const PARTS = { income: 'Income', spending: 'Actual spending', market: 'Market gain or loss', fx: 'Currency gain or loss', unexplained: 'Unexplained (adjustments)', other: 'Opening balances and other' };
  const PART_SUB = { income: 'Pay, interest and everything else you earned', spending: 'Your own spending, after what was not yours', market: 'Typed values of investments and property against what you paid',
    fx: 'Rate differences on foreign money', unexplained: 'Corrections made in a month check', other: 'Balances the book started with' };
  function stepper(months, cur) {
    const i = months.indexOf(cur);
    return `<div class="cm-month" role="group" aria-label="Month">
      <button class="icon-btn sm" id="w2Prev" onclick="w2Perf.step(-1)" aria-label="Previous month"${i <= 0 ? ' disabled' : ''}>${ic('chevron-left', 's16')}</button>
      <span class="lbl" id="w2Month" data-month="${escH(cur)}">${escH(monthLabel(cur, true))}</span>
      <button class="icon-btn sm" id="w2Next" onclick="w2Perf.step(1)" aria-label="Next month"${i < 0 || i >= months.length - 1 ? ' disabled' : ''}>${ic('chevron-right', 's16')}</button></div>`;
  }
  function bridgeCard(b, months, label) {
    const t = bridgeOf(b, months, V.view), market = V.view === 'market', a0 = shiftM(months[0], -1);
    const steps = [['income', t.income], ['spending', -t.spending], ['market', t.market], ['fx', t.fx], ['unexplained', t.unexplained], ['other', t.other]].filter(s => s[0] !== 'other' || t.other);
    let run = t.opening; const pos = [t.opening]; for (const s of steps) { run += s[1]; pos.push(run); }
    const lo = Math.min(...pos), hi = Math.max(...pos), span = hi - lo || 1, x = v => (v - lo) / span * 92 + 4;
    const track = (a, c) => (a === c ? '' : `<i style="left:${x(Math.min(a, c))}%;width:${Math.max(0.8, Math.abs(x(c) - x(a)))}%;background:${c > a ? 'var(--good)' : 'var(--bad)'}"></i>`);
    const total = (part, name, sub, v) => `<div class="hb-row hb-total" data-part="${part}" data-v="${v}"><span class="hb-name">${name}<small>${sub}</small></span><span class="hb-track" aria-hidden="true"><i class="mk" style="left:calc(${x(v)}% - 1.5px)"></i></span><span class="hb-val">${money(v)}</span></div>`;
    const rate = t.income > 0 ? Math.round(t.saved / t.income * 100) : null;
    const row = (s, i) => {
      const [k, v] = s, off = k === 'market' && !market;
      const inner = `<span class="hb-name">${escH(PARTS[k])}<small>${escH(off ? 'Not counted in the Book view. Switch to Market to include it.' : PART_SUB[k])}</small></span><span class="hb-track" aria-hidden="true">${track(pos[i], pos[i + 1])}</span><span class="hb-val">${signed(v, tone(v))}${off ? '' : ic('chevron-right')}</span>`;
      const html = off ? `<div class="hb-row" data-part="${k}" data-v="${v}">${inner}</div>` : `<button class="hb-row" data-part="${k}" data-v="${v}" onclick="w2Perf.behind('${k}')" aria-label="${escH(PARTS[k])}: see what is behind it">${inner}</button>`;
      return html + (k === 'spending' ? `<div class="hb-row hb-total" data-part="saved" data-v="${t.saved}" data-rate="${rate == null ? '' : rate}"><span class="hb-name w2p-sub">Saved<small>${rate == null ? 'Income minus actual spending' : rate + '% of income'}</small></span><span class="hb-track" aria-hidden="true"><i class="mk" style="left:calc(${x(pos[i + 1])}% - 1.5px)"></i></span><span class="hb-val w2p-sub">${signed(t.saved, tone(t.saved))}</span></div>` : '');
    };
    return `<section class="card span-12" id="w2fBridge" data-ok="${t.ok}" data-opening="${t.opening}" data-closing="${t.closing}" aria-label="Where the change in net worth came from">
      ${cardHead('chart-column', 'Where the change in net worth came from', `${escH(label)} · ${market ? 'market value' : 'book value'} · tap a line to see what is behind it`)}
      <div class="hb-list">${total('opening', 'Net worth at the start', escH(dayText(monthEnd(a0))), t.opening)}${steps.map(row).join('')}${total('closing', 'Net worth at the end', escH(dayText(monthEnd(months[months.length - 1]))), t.closing)}</div>
      <div class="hb-change" data-part="change" data-v="${t.change}"><span>Net worth change · ${escH(label)}</span><span class="${tone(t.change)}">${signed(t.change)}</span></div>
      <p class="help" style="margin-top:10px">${t.ok ? 'The lines add up to the change exactly.' : 'These lines do not add up. Please report this.'} Card payments, moves between your accounts, lending and investment purchases are never income or spending.</p></section>`;
  }
  function budgetCard(b, months, label) {
    const d = budgetData(b, months), old = oldBudgets();
    const tools = `<button class="btn btn-secondary btn-sm" id="w2fBudBtn" onclick="w2Perf.budgets()">Set budgets</button>`;
    const body = d.rows.length ? d.rows.map(r => `<div class="w2p-item" data-w2-budget="${escH(r.cat)}" data-pct="${Math.round(r.pct)}" data-spent="${r.spent}" data-budget="${r.budget}" data-status="${r.status}">
        <div class="w2p-top"><span class="n">${escH(r.cat)}</span><span>${money(r.spent)} <span class="faint">of</span> ${money(r.budget)} · ${Math.round(r.pct)}%${r.status === 'over' ? ' <span class="badge bad" data-w2-over>over</span>' : r.status === 'watch' ? ' <span class="badge warn">on pace to go over</span>' : ''}</span></div>
        ${bar(r.pct, r.status === 'over', r.cat + ' budget used')}</div>`).join('')
        + `<p class="help" style="margin-top:10px">${d.n > 1 ? `Each budget is the monthly amount × ${d.n} months. ` : ''}${d.restCount ? `${money(d.restTotal)} was spent in ${plural(d.restCount, 'category', 'categories')} without a budget.` : 'Every category you spent in has a budget.'}</p>`
      : `<div class="empty">${ic('gauge', 's40')}<div class="e-title">No budgets in the new book yet</div>
          ${old.length ? `<button class="btn btn-primary btn-sm" id="w2fBudCopy" onclick="w2Perf.copyBudgets()">Copy the ${plural(old.length, 'budget')} from your current app</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="w2Perf.budgets()">Set budgets</button></div>`;
    return `<section class="card span-6" id="w2fBudgets" data-budget="${d.budget}" data-spent="${d.spent}" aria-label="Spending against budget">${cardHead('gauge', 'Spending against budget', escH(label), tools)}${body}</section>`;
  }
  function investCard(b, M) {
    const hs = holdings(b, M);
    const body = hs.length ? hs.map(h => {
      const id = q(h.a.id), stale = h.asOf && h.asOf < M ? ` <span class="badge warn">value from ${escH(monthLabel(h.asOf))}</span>` : '';
      const sub = h.n === 0 ? 'No value typed yet' : `Paid ${money(h.costAt)} · worth ${money(h.value)}${stale}${h.costAt !== h.cost ? ` · paid to date ${money(h.cost)}` : ''}`;
      const ret = h.n < 2 ? `<span class="badge" data-w2-costonly>${h.n ? 'No return yet · needs a second valued month' : 'Cost only'}</span>`
        : h.ret == null ? '<span class="faint">—</span>' : `<span class="delta ${tone(h.ret) || 'neutral'}" data-w2-ret>${pctText(h.ret)}</span><span class="li-sub">return since ${escH(monthLabel(h.from))}${h.added ? ` · ${money(Math.abs(h.added))} ${h.added > 0 ? 'put in' : 'taken out'}, not counted as gain` : ''}</span>`;
      return `<div class="w2p-row" data-w2-hold="${escH(h.a.id)}" data-cost="${h.cost}" data-value="${h.value == null ? '' : h.value}" data-gain="${h.gain == null ? '' : h.gain}" data-ret="${h.ret == null ? '' : h.ret}" data-n="${h.n}">
        <div class="li-body"><div class="li-title">${escH(h.a.name)}</div><div class="li-sub">${h.n === 0 ? `Paid ${money(h.cost)} · ` : ''}${sub}</div></div>
        <div class="w2p-side"><span class="w2p-col">${h.gain == null ? '' : `<b>${signed(h.gain, tone(h.gain))}</b>`}${ret}</span>
          <button class="btn btn-secondary btn-sm" data-w2-value="${escH(h.a.id)}" onclick="w2Perf.value('${id}')">Update value</button></div></div>`; }).join('')
      + '<p class="help" style="margin-top:10px">Gain = the value you typed minus what you paid. The return uses money put in and taken out, so a top-up is never counted as a gain.</p>'
      : emptyHTML('trending-up', 'No investment accounts in the new book yet');
    return `<section class="card span-6" id="w2fInvest" aria-label="Investments">${cardHead('trending-up', 'Investments', `What you paid against the values you typed · to ${escH(monthLabel(M))}`)}${body}</section>`;
  }
  function goalsCard(b, M) {
    const gs = goalList(b), old = oldGoals();
    const tools = `<button class="btn btn-secondary btn-sm" id="w2fGoalAdd" onclick="w2Perf.goal()">${ic('plus', 's16')}Goal</button>`;
    const body = gs.length ? gs.map(g => { const c = goalCalc(b, g, M), [cls, txt] = GSTAT[c.status];
      return `<div class="w2p-item" data-w2-goal="${escH(g.id)}" data-pct="${Math.round(c.pct)}" data-progress="${c.progress}" data-status="${c.status}">
        <div class="w2p-top"><span class="n">${escH(g.name)}</span><span>${Math.round(c.pct)}% · <span class="badge ${cls}">${txt}</span> <button class="icon-btn sm" onclick="w2Perf.goal('${q(g.id)}')" aria-label="Edit goal ${escH(g.name)}" title="Edit">${ic('pencil', 's16')}</button></span></div>
        ${bar(c.pct, c.status === 'overdue', g.name + ' progress')}
        <div class="li-sub" style="margin-top:6px">${escH(GOAL_KINDS[g.kind] || g.kind)} · ${money(c.progress)} of ${money(g.target)} by ${escH(monthLabel(g.by))}${c.remaining > 0 && c.monthsLeft > 0 ? ` · needs ${money(Math.round(c.required))} a month` : ''}${c.avg != null && c.remaining > 0 ? ` · your pace ${signed(Math.round(c.avg))} a month` : ''}</div></div>`; }).join('')
      : `<div class="empty">${ic('target', 's40')}<div class="e-title">No goals in the new book yet</div>
          ${old.length ? `<button class="btn btn-primary btn-sm" id="w2fGoalCopy" onclick="w2Perf.copyGoals()">Copy the ${plural(old.length, 'goal')} from your current app</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="w2Perf.goal()">Add a goal</button></div>`;
    return `<section class="card span-6" id="w2fGoals" aria-label="Goals">${cardHead('target', 'Goals', `Measured on what you paid (book), at the end of ${escH(monthLabel(M))}`, tools)}${body}</section>`;
  }
  function trendsCard(b, M, months) {
    const t = trends(b, M), s = months.reduce((o, m) => { const x = bookLib.saved(b, m); o.income += x.income; o.saved += x.saved; return o; }, { income: 0, saved: 0 });
    const rate = s.income > 0 ? s.saved / s.income * 100 : null, r1 = n => n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
    return `<section class="card span-6" id="w2fTrends" aria-label="Trends">${cardHead('chart-line', 'Trends', `Income and actual spending · 12 months to ${escH(monthLabel(M))}`)}
      <div class="chart-box"><canvas id="w2fChart" role="img" aria-label="Income and spending per month, 12 months"></canvas></div>
      <div class="legend"><span class="legend-item"><i style="background:var(--good)"></i>Income</span><span class="legend-item"><i style="background:var(--bad)"></i>Actual spending</span></div>
      <dl class="w2p-stats"><div id="w2fRate" data-v="${rate == null ? '' : rate}"><dt class="eyebrow">Savings rate</dt><dd>${rate == null ? '—' : Math.round(rate) + '%'}</dd><div class="s">this period</div></div>
        <div id="w2fRate12" data-v="${t.rate12 == null ? '' : t.rate12}"><dt class="eyebrow">12-month rate</dt><dd>${t.rate12 == null ? '—' : Math.round(t.rate12) + '%'}</dd><div class="s">saved ÷ income</div></div>
        <div id="w2fRunway" data-v="${t.runway == null ? '' : t.runway}" data-cash="${t.cash}" data-avg="${t.avg == null ? '' : t.avg}" data-n="${t.n}"><dt class="eyebrow">Runway</dt><dd>${t.runway == null ? '—' : r1(t.runway) + ' months'}</dd>
          <div class="s">${t.runway == null ? 'Needs a finished month of spending' : `${money(t.cash)} in cash and bank ÷ ${money(Math.round(t.avg))} a month (${t.n}-month average)`}</div></div></dl></section>`;
  }
  function renderPerf() {
    const title = 'Performance', desc = 'How you are doing: what moved your net worth, budgets, investments and goals.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), all = allMonths(b);
    if (!F.month || !all.includes(F.month)) F.month = all[all.length - 1];
    const M = F.month, months = periodMonths(b, F.mode, M), label = periodLabel(months);
    const seg = `<div class="seg" role="group" aria-label="Period">${MODES.map(([k, l]) => `<button id="w2fMode-${k}" aria-pressed="${F.mode === k}" onclick="w2Perf.mode('${k}')">${l}</button>`).join('')}</div>`;
    return `${pageHead(title, desc, `${addBtn()}${hideBtn()}`)}
      <div class="w2p-bar" id="w2fBar" data-from="${months[0]}" data-to="${M}" data-n="${months.length}">${stepper(all, M)}${seg}<span class="grow"></span>${viewSeg()}</div>
      <div class="grid">${bridgeCard(b, months, label)}</div>
      <div class="grid">${budgetCard(b, months, label)}${investCard(b, M)}</div>
      <div class="grid">${goalsCard(b, M)}${trendsCard(b, M, months)}</div>`;
  }
  function drawPerf() {
    const c = el('w2fChart'), b = B(); if (!c || !b || typeof Chart === 'undefined' || !F.month) return;
    const rows = trends(b, F.month).rows, mobile = isMobile();
    const ds = (label, key, col) => ({ label, data: rows.map(r => r[key]), backgroundColor: col, borderRadius: 4, borderSkipped: false, maxBarThickness: mobile ? 9 : 16 });
    CHARTS.w2fChart = new Chart(c, { type: 'bar',
      data: { labels: rows.map(r => monthLabel(r.month).replace(/ \d{4}$/, '')), datasets: [ds('Income', 'income', cssVar('--good')), ds('Actual spending', 'spending', cssVar('--bad'))] },
      options: { responsive: true, maintainAspectRatio: false, ...animOnce(), interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { enabled: !mobile, callbacks: { title: it => monthLabel(rows[it[0].dataIndex].month, true), label: x => `${x.dataset.label}: ${moneyTip(x.parsed.y)}` } } },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: mobile ? 6 : 12, maxRotation: 0 } }, y: { border: { display: false }, ticks: { maxTicksLimit: 5, callback: moneyTick } } } } });
    P.perfChart = { keys: rows.map(r => r.month), income: rows.map(r => r.income), spending: rows.map(r => r.spending) };
  }
  P.step = function (d) { const ms = allMonths(B()), i = ms.indexOf(F.month) + d; if (i >= 0 && i < ms.length) { F.month = ms[i]; renderAll(); } };
  P.mode = function (m) { if (MODES.some(x => x[0] === m)) { F.mode = m; renderAll(); } };

  // A line of the bridge → the entries (or, for the market line, the accounts) behind it.
  P.behind = function (part) {
    const b = B(); if (!b || !PARTS[part] || !F.month) return;
    const months = periodMonths(b, F.mode, F.month), label = periodLabel(months), KIND = { 'year-end': 'Year end', opening: 'Opening balance', migrated: 'Copied history' };
    let total, rows, n;
    if (part === 'market') {
      const list = marketBehind(b, months); total = list.reduce((s, r) => s + r.v, 0); n = list.length;
      rows = list.map(r => `<div class="list-item" data-w2-behind="${escH(r.a.id)}" data-v="${r.v}"><div class="li-body"><div class="li-title">${escH(r.a.name)}</div>
        <div class="li-sub">${r.now ? `worth ${money(r.now.value)} (${escH(monthLabel(r.now.month))}) · paid ${money(r.now.paid)}` : 'no value at the end of the period'}</div></div><span class="amt" style="font-weight:600;white-space:nowrap">${signedText(r.v)}</span></div>`);
    } else {
      const list = behind(b, months, part), sign = part === 'spending' ? -1 : 1; total = sign * list.reduce((s, r) => s + r.v, 0); n = list.length;
      rows = list.slice(0, 300).map(r => `<div class="list-item" data-w2-behind="${escH(r.e.id)}" data-v="${sign * r.v}"><div class="li-body"><div class="li-title">${escH(r.e.description || KIND[r.e.kind] || '—')}</div>
        <div class="li-sub">${escH(dayText(r.e.date))} · ${escH(r.group)}${r.e.number ? ' · ' + escH(r.e.number) : ''}</div></div><span class="amt" style="font-weight:600;white-space:nowrap">${signedText(sign * r.v)}</span></div>`);
    }
    openSheet({ title: `${PARTS[part]} · ${label}`, wide: true, confirmDiscard: false,
      body: `<p class="muted" id="w2fBehindTotal" data-v="${total}" data-n="${n}" style="margin:0 0 12px">${part === 'market' ? plural(n, 'account') : plural(n, 'entry', 'entries')} · total ${signed(total)}${n > 300 ? ' · showing the latest 300' : ''}</p>
        ${rows.length ? `<div class="list" id="w2fBehindList">${rows.join('')}</div>` : emptyHTML('inbox', 'Nothing in this period')}`,
      foot: `${part !== 'market' && hasPage('w2-journals') ? `<button class="btn btn-ghost left" onclick="closeTopSheet(true);setTab('w2-journals')">Open Journals</button>` : ''}<button class="btn btn-secondary" onclick="closeTopSheet(true)">Close</button>` });
  };

  /* ── Set budgets ── */
  function budgetCats(b) {
    const have = budgetList(b).map(x => x.cat), s = new Set(have);
    for (const c of Object.keys(spentBy(b, monthsBetween(shiftM(curMonth(), -5), curMonth()).filter(m => m >= firstMonth(b))))) s.add(c);
    if (typeof CATEGORIES === 'object' && CATEGORIES) for (const c of Object.keys(CATEGORIES)) s.add(c);
    for (const a of live(b.accounts)) if (a.kind === 'expense' && a.category && !a.hidden) s.add(a.category);
    return [...s].sort((x, y) => (have.includes(y) - have.includes(x)) || x.localeCompare(y));
  }
  P.budgets = function () {
    const b = B(); if (!b) return;
    const cur = Object.fromEntries(budgetList(b).map(x => [x.cat, x.monthly])), cats = budgetCats(b), old = oldBudgets();
    openSheet({ title: 'Set budgets', focus: '#w2fb-0', onEnter: () => P.budgetsSave(),
      body: `<p class="muted" style="margin:0 0 12px">A monthly amount per spending category. Leave a box empty for no budget. These budgets belong to the new book; the ones in your current app are not changed.</p>
        ${old.length ? `<p style="margin:0 0 12px"><button class="btn btn-ghost btn-sm" id="w2fBudCopy2" onclick="closeTopSheet(true);w2Perf.copyBudgets()">Copy from current app</button></p>` : ''}
        <div id="w2fbList">${cats.map((c, i) => `<div class="w2p-budrow"><label for="w2fb-${i}">${escH(c)}</label>${rpInput('w2fb-' + i, cur[c] || null, `placeholder="No budget" data-cat="${escH(c)}"`)}</div>`).join('')}</div>${errBox('w2fbErr')}`,
      foot: `<button class="btn btn-secondary" onclick="closeTopSheet(true)">Cancel</button><button class="btn btn-primary" id="w2Save" onclick="w2Perf.budgetsSave()">Save budgets</button>` });
  };
  P.budgetsSave = function () {
    const b = B(), prev = budgetMap(b), next = {}, M = curMonth(); let bad = '';
    for (const inp of document.querySelectorAll('#w2fbList input[data-cat]')) {
      const raw = inp.value.trim(), n = raw ? meParse(raw) : 0, cat = inp.dataset.cat;
      if (raw && !(typeof n === 'number' && Number.isInteger(n) && n >= 0)) { bad = cat; continue; }
      if (n > 0) next[cat] = { monthly: n, since: (prev[cat] && !prev[cat].deleted && prev[cat].since) || M };
    }
    if (bad) { showErr('w2fbErr', `Enter the ${bad} budget in whole rupiah, or leave it empty`); return; }
    if (!change(w => setS(w, 'budgets', next), 'budgets', 'w2fbErr').ok) return;
    closeTopSheet(true); toast(`${plural(Object.keys(next).length, 'budget')} saved`);
  };
  const undoSetting = (key, before, why) => () => { try { book2Do(w => setS(w, key, before), why); toast('Undone'); } catch (e) { toast(errText(e)); } };
  // Copies the budgets of the current app into the new book. Reads STATE.budgets; never writes it.
  P.copyBudgets = function () {
    const b = B(), old = oldBudgets(); if (!b || !old.length) { toast('There are no budgets in your current app to copy'); return; }
    const before = cp(budgetMap(b)), next = cp(before);
    for (const x of old) next[x.cat] = { monthly: x.monthly, since: x.since || curMonth() };
    try { book2Do(w => setS(w, 'budgets', next), 'copy-budgets'); } catch (e) { toast(errText(e)); return; }
    toast(`${plural(old.length, 'budget')} copied. Your current app is unchanged.`, { action: 'Undo', onAction: undoSetting('budgets', before, 'undo') });
  };

  /* ── Goals ── */
  const goalAccounts = b => live(b.accounts).filter(a => a.kind === 'asset' && !a.header && !a.hidden && !a.person).sort((x, y) => String(x.code || '').localeCompare(String(y.code || ''), undefined, { numeric: true }) || byName(x, y));
  let GE = null;
  P.goal = function (id) {
    const b = B(); if (!b) return;
    const cur = id ? goalList(b).find(g => g.id === id) : null, g = cur || { kind: 'networth', name: '', target: null, by: shiftM(curMonth(), 12), accounts: [] };
    GE = cur ? cur.id : null;
    openSheet({ title: cur ? 'Edit goal' : 'Add goal', focus: '#w2gName', onEnter: () => P.goalSave(),
      body: `<div class="form-grid"><div class="field full"><label class="label" for="w2gName">Name</label><input class="input" id="w2gName" maxlength="60" autocomplete="off" value="${escH(g.name)}" placeholder="For example: net worth target"></div>
        <div class="field full"><label class="label" for="w2gKind">What to measure</label><select class="input" id="w2gKind" onchange="w2Perf.goalKind()">${Object.keys(GOAL_KINDS).map(k => `<option value="${k}"${k === g.kind ? ' selected' : ''}>${GOAL_KINDS[k]}</option>`).join('')}</select><div class="help" id="w2gHelp"></div></div>
        <div class="field"><label class="label" for="w2gTarget">Target amount</label>${rpInput('w2gTarget', g.target, 'placeholder="0"')}</div>
        <div class="field"><label class="label" for="w2gBy">By (month)</label><input class="input" type="month" id="w2gBy" value="${escH(g.by)}"></div>
        <div class="field full" id="w2gAccBox"><span class="label">Accounts</span><div class="ex-check-list" id="w2gAccs">${goalAccounts(b).map(a => `<label class="check"><input type="checkbox" value="${escH(a.id)}"${(g.accounts || []).includes(a.id) ? ' checked' : ''}> ${escH(a.name)}</label>`).join('')}</div></div>${errBox('w2gErr')}</div>`,
      foot: `${cur ? `<button class="btn btn-danger left" id="w2gDel" onclick="w2Perf.goalRemove()">Remove</button>` : ''}<button class="btn btn-secondary" onclick="closeTopSheet(true)">Cancel</button><button class="btn btn-primary" id="w2Save" onclick="w2Perf.goalSave()">${cur ? 'Save' : 'Add goal'}</button>` });
    P.goalKind();
  };
  P.goalKind = function () {
    const k = el('w2gKind').value;
    el('w2gAccBox').style.display = k === 'account' ? '' : 'none';
    el('w2gHelp').textContent = { networth: 'Everything you own minus everything you owe, at what you paid.', liquid: 'Bank, cash and e-wallet accounts together.', saving: 'How much your net worth grows from now on. The target is the amount to add.', account: 'The balances of the accounts you tick, added up.' }[k] || '';
  };
  P.goalSave = function () {
    const b = B(), name = el('w2gName').value.trim().slice(0, 60), kind = el('w2gKind').value, t = meParse(el('w2gTarget').value), by = el('w2gBy').value;
    const accounts = kind === 'account' ? [...document.querySelectorAll('#w2gAccs input:checked')].map(i => i.value) : [];
    if (!name) { showErr('w2gErr', 'Enter a name'); return; }
    if (!GOAL_KINDS[kind]) { showErr('w2gErr', 'Choose what to measure'); return; }
    if (!(typeof t === 'number' && Number.isInteger(t) && t > 0)) { showErr('w2gErr', 'Enter a target above zero, in whole rupiah'); return; }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(by)) { showErr('w2gErr', 'Choose the month to reach it by'); return; }
    if (kind === 'account' && !accounts.length) { showErr('w2gErr', 'Tick at least one account'); return; }
    const list = cp(goalsRaw(b)), i = GE ? list.findIndex(g => g && g.id === GE) : -1, old = i >= 0 ? list[i] : null, at = new Date().toISOString();
    const g = { id: old ? old.id : 'g-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, kind, target: t, by, ...(kind === 'account' ? { accounts } : {}), since: (old && old.since) || curMonth(), at };
    if (old) list[i] = g; else list.push(g);
    if (!change(w => setS(w, 'goals', list), 'goal', 'w2gErr').ok) return;
    closeTopSheet(true); GE = null; toast(old ? 'Goal saved' : 'Goal added');
  };
  // Removing keeps a dated marker in the list (nothing is deleted outright) and offers Undo.
  P.goalRemove = function () {
    const b = B(), before = cp(goalsRaw(b)), i = before.findIndex(g => g && g.id === GE); if (i < 0) return;
    const list = cp(before), name = list[i].name; list[i] = { id: GE, deleted: true, at: new Date().toISOString() };
    if (!change(w => setS(w, 'goals', list), 'goal-remove', 'w2gErr').ok) return;
    closeTopSheet(true); GE = null; toast(`${name} removed`, { action: 'Undo', onAction: undoSetting('goals', before, 'undo') });
  };
  // Copies the goals of the current app. Reads STATE.goals; never writes it. Old account codes are
  // matched to the copied accounts of the new book; a goal on accounts that are not there is skipped.
  P.copyGoals = function () {
    const b = B(), old = oldGoals(); if (!b || !old.length) { toast('There are no goals in your current app to copy'); return; }
    const before = cp(goalsRaw(b)), list = cp(before), have = new Set(list.map(g => g && g.id)), at = new Date().toISOString();
    const find = code => { const a = b.accounts['a-' + code] || live(b.accounts).find(x => String(x.code) === String(code)); return a && a.kind === 'asset' && !a.header ? a.id : null; };
    let n = 0, skipped = 0;
    for (const o of old) {
      const id = 'g-old-' + o.id; if (have.has(id) || !GOAL_KINDS[o.kind] || !/^\d{4}-\d{2}$/.test(String(o.by || ''))) { skipped++; continue; }
      const g = { id, name: String(o.name || 'Goal').slice(0, 60), kind: o.kind, target: Math.round(o.target), by: o.by, since: o.since || String(o.at || '').slice(0, 7) || curMonth(), at };
      if (o.kind === 'account') { g.accounts = (o.accounts || []).map(find).filter(Boolean); if (!g.accounts.length) { skipped++; continue; } }
      list.push(g); n++;
    }
    if (!n) { toast('Nothing to copy: those goals are already here, or their accounts are not in the new book'); return; }
    try { book2Do(w => setS(w, 'goals', list), 'copy-goals'); } catch (e) { toast(errText(e)); return; }
    toast(`${plural(n, 'goal')} copied${skipped ? ` · ${skipped} skipped` : ''}. Your current app is unchanged.`, { action: 'Undo', onAction: undoSetting('goals', before, 'undo') });
  };

  /* ── Update value (the same question as on Net worth) ── */
  let VA = null;
  P.value = function (id) {
    const b = B(), a = b && b.accounts[id]; if (!a) return;
    const M = F.month || curMonth(), cur = valuesAt(b, M)[id];
    VA = { id, name: a.name };
    openSheet({ title: `Update value · ${a.name}`, focus: '#w2fvVal', onEnter: () => P.valueSave(),
      body: `<p class="muted" style="margin:0 0 14px">Type what it is worth at the end of the month. It never changes what you paid.${cur ? ` Last value: ${money(cur.value)} for ${escH(monthLabel(cur.month))}.` : ''}</p>
        <div class="form-grid"><div class="field"><label class="label" for="w2fvMonth">Month</label><input class="input" type="month" id="w2fvMonth" value="${escH(M)}"></div>
        <div class="field"><label class="label" for="w2fvVal">Value</label>${rpInput('w2fvVal', cur ? cur.value : null, 'placeholder="0"')}</div>${errBox('w2fvErr')}</div>`,
      foot: `<button class="btn btn-secondary" onclick="closeTopSheet(true)">Cancel</button><button class="btn btn-primary" id="w2Save" onclick="w2Perf.valueSave()">Save value</button>` });
  };
  P.valueSave = function () {
    if (!VA) return;
    const month = el('w2fvMonth').value, n = meParse(el('w2fvVal').value), x = VA;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { showErr('w2fvErr', 'Choose a month'); return; }
    if (!(typeof n === 'number' && Number.isInteger(n) && n >= 0)) { showErr('w2fvErr', 'Enter the value in whole rupiah'); return; }
    if (!change(w => bookLib.setValue(w, x.id, month, n), 'value', 'w2fvErr').ok) return;
    closeTopSheet(true); VA = null; toast(`${x.name}: ${fmtIDR(n)} for ${monthLabel(month)}`);
  };

  // For tests and other preview files: plain figures, no HTML.
  P.calc = { bridgeOf, behind, marketBehind, budgetData, holdings, goalCalc, trends, periodMonths, dietz };

  registerPage({ key: 'w2-home', label: 'Home · new', icon: 'house', group: 'w2', order: 12, render: renderHome, afterRender: drawHome });
  registerPage({ key: 'w2-perf', label: 'Performance', icon: 'chart-column', group: 'w2', order: 46, render: renderPerf, afterRender: drawPerf });
})();
