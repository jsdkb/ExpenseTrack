/* ExpenseTrack v6 — the Accountant view of the new book (docs/v6-book.md §10): Reports (w2-reports),
   Accounts chart (w2-accounts), Audit (w2-audit) and Accurate export (w2-accurate), in the menu
   group "w2". Journals is the round-1 page in pages.js.

   Every figure comes from the new book through bookLib; every change goes through book2Do. Read-only
   towards everything old (§0): this file never writes STATE, never calls scheduleDriveSave() or a
   mutating ledger* function. The Accurate export only makes files the owner downloads: the app never
   writes to Accurate. The XML is the layout Accurate 5 Desktop's own Export/Import uses for journal
   vouchers (element names, order and formats only). No personal data in this file: the repo is public. */
(function () {
  'use strict';
  if (typeof bookLib === 'undefined' || typeof BOOK2 !== 'function' || typeof book2Do !== 'function' || typeof registerPage !== 'function') {
    console.warn('ExpenseTrack preview: the new book store is not loaded, so the Accountant view stays off.');
    return;
  }
  const P = window.w2Acct = {};

  /* ── Small helpers ── */
  const B = () => BOOK2();
  const p2 = n => String(n).padStart(2, '0');
  const errText = e => (e && Array.isArray(e.errors) && e.errors.length ? e.errors.join(' · ') : String((e && e.message) || e));
  const localDay = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const today = () => localDay(new Date());
  const curMonth = () => today().slice(0, 7);
  const validMonth = M => typeof M === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(M);
  const validDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  const shiftM = (M, k) => { let [y, m] = M.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${p2(m)}`; };
  const monthEnd = M => { const [y, m] = M.split('-').map(Number); return `${M}-${p2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
  const addDays = (iso, k) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const mStart = iso => iso.slice(0, 8) + '01';
  const mEnd = iso => monthEnd(iso.slice(0, 7));
  const shiftMonths = (iso, k) => { const M = shiftM(iso.slice(0, 7), k); return `${M}-${p2(Math.min(+iso.slice(8, 10), +monthEnd(M).slice(8, 10)))}`; };
  const shiftKeepEnd = (iso, k) => (iso === mEnd(iso) ? mEnd(shiftMonths(iso, k)) : shiftMonths(iso, k));
  const dayText = iso => { try { return fmtDayLong(new Date(String(iso).slice(0, 10) + 'T00:00:00')); } catch (_) { return String(iso || ''); } };
  const whenText = iso => { try { return fmtDateTime(iso); } catch (_) { return String(iso || ''); } };
  const mLong = M => monthLabel(M, true);
  const num = n => Math.round(Math.abs(n)).toLocaleString('id-ID');
  const money = n => `<span class="amt">${n < 0 ? '−' : ''}${fmtIDR(Math.abs(n))}</span>`;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const el = id => document.getElementById(id);
  const q = s => escAttr(s);
  const live = o => Object.values(o || {}).filter(x => x && !x.deleted);
  const cmpCode = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
  const byCode = (a, b) => cmpCode(a.code, b.code) || String(a.name).localeCompare(String(b.name));
  function rangeLabel(f, t) {
    if (f === t) return dayText(f);
    return f.slice(0, 4) === t.slice(0, 4) ? `${dayText(f).replace(/ \d{4}$/, '')} – ${dayText(t)}` : `${dayText(f)} – ${dayText(t)}`;
  }
  function showErr(id, msg) { const b = el(id); if (!b) { toast(msg); return; } b.style.display = msg ? '' : 'none'; b.querySelector('span').textContent = msg || ''; }
  const errBox = id => `<div class="help err full" id="${id}" role="alert" style="display:none">${ic('triangle-alert', 's16')}<span></span></div>`;
  const sheetFoot = (label, fn, cls) => `<button class="btn btn-secondary" onclick="closeTopSheet(true)">Cancel</button><button class="btn ${cls || 'btn-primary'}" id="w2aSave" onclick="w2Acct.${fn}()">${escH(label)}</button>`;
  function change(fn, why, errId) {
    try { return { ok: true, value: book2Do(fn, why) }; }
    catch (e) { if (errId) showErr(errId, errText(e)); else toast(errText(e)); return { ok: false }; }
  }
  const xlBtn = (id, fn) => `<button class="btn btn-secondary btn-sm" id="${id}" onclick="w2Acct.${fn}()">${ic('download', 's16')}Download Excel</button>`;
  const opt = (v, t, cur) => `<option value="${escH(v)}"${v === cur ? ' selected' : ''}>${escH(t)}</option>`;
  function saveFile(name, data, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Saved ${name} to your downloads`);
  }

  // Layout only: spacing and wrapping built from the existing tokens. No colours, fonts or icons added.
  if (!el('w2AcctStyle')) {
    const st = document.createElement('style'); st.id = 'w2AcctStyle';
    st.textContent = `
      .w2-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:16px}
      .w2-bar .grow{flex:1 1 0;min-width:0}
      .w2-bar .input{height:36px;width:auto;min-width:0;max-width:100%}
      .w2-row{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border)}
      .w2-row:first-child{border-top:none}
      .w2-row .li-body{flex:1 1 180px;min-width:0}
      .w2-side{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;font-size:14px}
      .w2-pad{padding:0 var(--card-pad) var(--card-pad)}
      .w2-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;white-space:nowrap;font-size:14px}
      .w2a-lbl{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-2);min-width:0;max-width:100%}
      table.data.w2a-t td,table.data.w2a-t th{padding-left:10px;padding-right:10px}
      table.data.w2a-t td.w2a-name{overflow-wrap:anywhere;min-width:120px}
      table.data.w2a-t td.w2a-wrap{overflow-wrap:anywhere;height:auto;padding-top:8px;padding-bottom:8px}
      table.data.w2a-t tr.w2a-tot td{font-weight:600;border-top:1px solid var(--border)}
      table.data.w2a-t tr.w2a-sec th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);padding-top:14px}
      .w2a-pct{display:block;font-size:12px;color:var(--text-3)}
      .w2a-net{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:var(--card-pad);font-weight:600}
      .w2a-check{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid var(--border)}
      .w2a-check:first-child{border-top:none}
      .w2a-check .li-body{flex:1 1 0;min-width:0}
      .w2a-area{width:100%;min-height:120px;font-variant-numeric:tabular-nums}
      .w2a-fix{margin:6px 0 0;padding:0;list-style:none;font-size:13px;color:var(--text-2)}
      .w2a-fix li{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
      .w2a-fix li span:first-child{min-width:0;overflow-wrap:anywhere}
      @media (max-width:767px){
        .w2-bar .input{flex:1 1 130px}
        .w2-side{margin-left:0;justify-content:flex-start;flex:1 1 100%}
        .w2-bar .seg{display:flex;width:100%;max-width:100%;border-radius:12px}
        .w2-bar .seg button{flex:1 1 0;min-width:0;height:auto;min-height:30px;padding:4px 8px;justify-content:center;text-align:center;white-space:normal;line-height:16px;border-radius:10px}
      }`;
    document.head.appendChild(st);
  }

  /* ── States shared by the four pages: signed out, loading, error, blocked, no book yet ── */
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
    return wrap(`<div class="empty">${ic('book-open', 's40')}<div class="e-title">The new book is not set up yet. Start here copies your current book into it.</div>${go}</div>`);
  }

  /* ── Words ── */
  const KIND_WORD = { asset: 'Asset · you own', liability: 'Debt · you owe', equity: 'Equity', income: 'Income', expense: 'Expense' };
  const ROLE_WORD = { bank: 'Bank account', cash: 'Cash', ewallet: 'E-wallet', investment: 'Investment', property: 'Property', receivable: 'Owed to you', 'other-asset': 'Other asset',
    card: 'Credit card', payable: 'You owe someone', loan: 'Loan', 'other-liability': 'Other debt', equity: 'Your own capital', retained: 'Result of past years',
    income: 'Income', fx: 'Exchange gain or loss', expense: 'Spending', unexplained: 'Unexplained differences' };
  const ADD_ROLES = ['bank', 'cash', 'ewallet', 'investment', 'property', 'other-asset', 'card', 'loan', 'other-liability', 'income', 'expense', 'equity'];
  const ENTRY_WORD = { spending: 'Spending', 'paid-for': 'Paid for someone', split: 'Split', reimburse: 'To be reimbursed', lent: 'Lent', 'repaid-in': 'Got repaid', borrowed: 'Borrowed', 'repaid-out': 'Repaid',
    income: 'Income', transfer: 'Between accounts', 'card-payment': 'Card payment', 'invest-buy': 'Investment bought', 'invest-sell': 'Investment sold', fee: 'Fee', 'write-off': 'Written off',
    adjust: 'Adjustment', opening: 'Opening balance', 'year-end': 'Year end', manual: 'Manual', migrated: 'Copied history' };
  // The sign an account's balance is shown with on a statement: what you own and spend as they are, the rest turned round.
  const natural = (a, v) => (a && (a.kind === 'asset' || a.kind === 'expense') ? v : -v);

  /* ── Excel (ExcelJS through the core's on-demand loader, the same sheet layout as the original Books pages) ── */
  async function xl(o) {
    let X; try { X = await xlLib(); } catch (e) { toast(e.message); return false; }
    const wb = new X.Workbook(), ws = wb.addWorksheet(o.sheet, { views: [{ state: 'frozen', ySplit: 3, xSplit: o.xSplit != null ? o.xSplit : 2 }] });
    const isNum = c => (o.numCols || []).includes(c), isPct = c => (o.pctCols || []).includes(c);
    ws.columns = o.widths.map(w => ({ width: w }));
    ws.getCell('A1').value = o.title; ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = o.sub; ws.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };
    const hr = ws.getRow(3);
    o.head.forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } }; c.border = { bottom: { style: 'thin' } }; if (isNum(i + 1) || isPct(i + 1)) c.alignment = { horizontal: 'right' }; });
    o.rows.forEach((r, k) => {
      const row = ws.getRow(4 + k); row.values = r.v;
      for (let i = 1; i <= r.v.length; i++) { if (isPct(i)) row.getCell(i).numFmt = '0.0%'; else if (isNum(i)) row.getCell(i).numFmt = '#,##0;-#,##0;0'; }
      row.getCell(1).numFmt = '@';
      if (r.s === 'sec') { row.getCell(1).font = { bold: true }; row.getCell(2).font = { bold: true }; }
      if (r.s === 'tot' || r.s === 'grand') row.eachCell({ includeEmpty: true }, c => { c.font = { bold: true }; c.border = { top: { style: r.s === 'grand' ? 'double' : 'thin' } }; });
    });
    saveFile(o.file, await wb.xlsx.writeBuffer(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return true;
  }
  const xlCmp = (cur, prev) => [prev, cur - prev, prev ? (cur - prev) / Math.abs(prev) : '—'];

  /* ════════════════ Reports (w2-reports) ════════════════ */
  const yearStart = () => today().slice(0, 4) + '-01-01';
  const RS = { tab: 'bs', bs: { asOf: today(), cmp: 'none' }, pl: { from: yearStart(), to: today(), cmp: 'none' }, tb: { from: yearStart(), to: today(), cmp: 'none' } };
  const TABS = [['bs', 'Balance sheet'], ['pl', 'Income statement'], ['tb', 'Trial balance']];
  const CMP = [['none', 'Compare with: nothing'], ['prev', 'Compare with: previous period'], ['yoy', 'Compare with: same period last year']];
  const ASOF_P = { today: () => today(), endLastMonth: () => addDays(mStart(today()), -1), endLastYear: () => `${+today().slice(0, 4) - 1}-12-31` };
  const RANGE_P = { thisMonth: () => [mStart(today()), today()], lastMonth: () => { const e = addDays(mStart(today()), -1); return [mStart(e), e]; },
    thisYear: () => [yearStart(), today()], lastYear: () => { const y = +today().slice(0, 4) - 1; return [`${y}-01-01`, `${y}-12-31`]; } };
  // The earlier date or range a statement is compared with (the original Books pages' rule).
  function cmpAsOf(f) { return f.cmp === 'yoy' ? shiftKeepEnd(f.asOf, -12) : f.cmp === 'prev' ? shiftKeepEnd(f.asOf, -1) : null; }
  function cmpRange(f) {
    const { from, to } = f;
    if (f.cmp === 'yoy') return [shiftKeepEnd(from, -12), shiftKeepEnd(to, -12)];
    if (f.cmp !== 'prev') return null;
    if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01')) return [shiftMonths(from, -1), shiftKeepEnd(to, -1)];           // a month → the month before
    if (from.slice(0, 4) === to.slice(0, 4) && from.slice(5) === '01-01') return [shiftMonths(from, -12), shiftKeepEnd(to, -12)];     // a year → the year before
    const n = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1; return [addDays(from, -n), addDays(from, -1)];             // the same number of days just before
  }
  const pctOf = (ch, prev) => (!prev ? '—' : `${ch < 0 ? '−' : ch > 0 ? '+' : ''}${Math.abs(ch / Math.abs(prev) * 100).toFixed(1)}%`);
  const chgHTML = (cur, prev) => { const ch = cur - prev; return `<span class="amt">${ch > 0 ? '+' : ch < 0 ? '−' : ''}${fmtIDR(Math.abs(ch))}</span><span class="w2a-pct">${pctOf(ch, prev)}</span>`; };
  // The amount cell(s) of a row: one column, or with Compare on, the compared figure and the change
  // as columns (web) or a line under the amount (phones).
  function amtTDs(cur, prev, on) {
    if (!on) return `<td class="num" data-cur="${cur}">${money(cur)}</td>`;
    return `<td class="num" data-cur="${cur}">${money(cur)}<div class="li-sub only-sm">was ${money(prev)}</div></td>
      <td class="num hide-sm" data-prev="${prev}">${money(prev)}</td><td class="num hide-sm" data-chg="${cur - prev}">${chgHTML(cur, prev)}</td>`;
  }
  const amtTHs = (on, label, cmpLabel) => `<th scope="col" class="num">${escH(label)}</th>${on ? `<th scope="col" class="num hide-sm">${escH(cmpLabel)}</th><th scope="col" class="num hide-sm">Change</th>` : ''}`;
  // Two lists of {account, code, name, amount} side by side → {account, code, name, cur, prev}.
  function mergeRows(a, c) {
    const m = new Map();
    for (const r of a) m.set(r.account, { account: r.account, code: r.code, name: r.name, cur: r.amount, prev: 0 });
    for (const r of c || []) { const x = m.get(r.account) || { account: r.account, code: r.code, name: r.name, cur: 0, prev: 0 }; x.prev = r.amount; m.set(r.account, x); }
    return [...m.values()].sort(byCode);
  }
  const safe = fn => { try { return fn(); } catch (_) { return null; } };
  function bsData(b) {
    const f = RS.bs, d = safe(() => bookLib.bs(b, f.asOf)), ca = cmpAsOf(f), c = ca ? safe(() => bookLib.bs(b, ca)) : null;
    if (!d) return null;
    const earn = [], pr = d.unclosedPriorEarnings, cy = d.currentYearEarnings, cpr = c ? c.unclosedPriorEarnings : 0, ccy = c ? c.currentYearEarnings : 0;
    if (pr || cpr) earn.push({ calc: 'prior', name: 'Result of earlier years, not closed yet', cur: pr, prev: cpr });
    earn.push({ calc: 'cy', name: 'Result of this year so far', cur: cy, prev: ccy });
    return { f, d, c, ca, A: mergeRows(d.assets, c && c.assets), L: mergeRows(d.liabilities, c && c.liabilities), E: mergeRows(d.equity, c && c.equity), earn };
  }
  function plData(b) {
    const f = RS.pl, d = safe(() => bookLib.pl(b, f.from, f.to)), cr = cmpRange(f), c = cr ? safe(() => bookLib.pl(b, cr[0], cr[1])) : null;
    return d && { f, d, c, cr, inc: mergeRows(d.income, c && c.income), exp: mergeRows(d.expense, c && c.expense) };
  }
  function tbData(b) {
    const f = RS.tb, d = safe(() => bookLib.tb(b, f.from, f.to)), cr = cmpRange(f), c = cr ? safe(() => bookLib.tb(b, cr[0], cr[1])) : null;
    if (!d) return null;
    const z = { opening: 0, debit: 0, credit: 0, closing: 0 }, cm = new Map(c ? c.rows.map(r => [r.account, r]) : []), seen = new Set(d.rows.map(r => r.account));
    const rows = d.rows.map(r => ({ ...r, prev: (cm.get(r.account) || z).closing }));
    for (const r of c ? c.rows : []) if (!seen.has(r.account)) rows.push({ ...r, ...z, prev: r.closing });
    return { f, d, c, cr, rows: rows.sort(byCode) };
  }
  const rowTR = (r, on, lf, lt) => `<tr class="clickable" data-row="${escH(r.code)}" onclick="w2Acct.ledger('${q(r.account)}','${q(lf || '')}','${q(lt)}')"><td class="hide-sm">${escH(r.code)}</td><td class="w2a-name">${escH(r.name)}</td>${amtTDs(r.cur, r.prev, on)}</tr>`;
  const totTR = (id, label, cur, prev, on) => `<tr class="w2a-tot" data-tot="${id}"><td class="hide-sm"></td><td>${escH(label)}</td>${amtTDs(cur, prev, on)}</tr>`;
  const statusLine = (ok, title, sub, id) => `<div class="w2a-check" id="${id}" data-ok="${ok ? 1 : 0}">${ic(ok ? 'square-check' : 'triangle-alert')}<span class="li-body"><span class="li-title" style="display:block">${title}</span>${sub ? `<span class="li-sub" style="display:block">${sub}</span>` : ''}</span><span class="badge ${ok ? 'good' : 'bad'}">${ok ? 'OK' : 'Check'}</span></div>`;
  function bsHTML(b) {
    const x = bsData(b); if (!x) return `<div class="grid"><section class="card span-12">${emptyHTML('triangle-alert', 'Pick a valid date')}</section></div>`;
    const { d, c, ca } = x, on = !!c, nc = on ? 5 : 3, cl = on ? dayText(ca) : '', fy = d.fyStart, to = d.asOf;
    const head = `<thead><tr><th scope="col" class="hide-sm">Code</th><th scope="col">Name</th>${amtTHs(on, 'Amount', cl)}</tr></thead>`;
    const sec = t => `<tr class="w2a-sec"><th scope="rowgroup" colspan="${nc}">${escH(t)}</th></tr>`;
    const rows = list => list.map(r => rowTR(r, on, null, to)).join('');
    const earn = x.earn.map(r => `<tr data-calc="${r.calc}"><td class="hide-sm"></td><td class="w2a-name">${escH(r.name)}</td>${amtTDs(r.cur, r.prev, on)}</tr>`).join('');
    return `<div class="grid"><section class="card span-12">${statusLine(d.balanced, d.balanced ? 'Balanced' : 'Not balanced', d.balanced ? `What you own equals what you owe plus your equity on ${escH(dayText(d.asOf))}` : `Assets ${money(d.totalAssets)} · debts and equity ${money(d.totalLE)}`, 'w2aBSCheck')}</section></div>
      <div class="grid" id="w2aBS"><section class="card flush span-6" id="w2aBSA">${cardHead('scale', 'Assets', `What you own · as of ${escH(dayText(d.asOf))}`)}
        <div class="table-wrap"><table class="data w2a-t">${head}<tbody>${rows(x.A) || `<tr><td colspan="${nc}" class="muted">Nothing</td></tr>`}</tbody><tfoot>${totTR('A', 'Total assets', d.totalAssets, on ? c.totalAssets : 0, on)}</tfoot></table></div></section>
      <section class="card flush span-6" id="w2aBSLE">${cardHead('scale', 'Debts and equity', `What you owe, and what is yours · since ${escH(dayText(fy))} for this year’s result`)}
        <div class="table-wrap"><table class="data w2a-t">${head}<tbody>${sec('Debts')}${rows(x.L)}${totTR('L', 'Total debts', d.totalLiabilities, on ? c.totalLiabilities : 0, on)}
          ${sec('Equity')}${rows(x.E)}${earn}${totTR('E', 'Total equity', d.totalEquity, on ? c.totalEquity : 0, on)}</tbody><tfoot>${totTR('LE', 'Total debts and equity', d.totalLE, on ? c.totalLE : 0, on)}</tfoot></table></div></section></div>`;
  }
  function plHTML(b) {
    const x = plData(b); if (!x) return `<div class="grid"><section class="card span-12">${emptyHTML('triangle-alert', 'Pick a valid date range')}</section></div>`;
    const { f, d, c, cr } = x, on = !!c, cl = on ? rangeLabel(cr[0], cr[1]) : '', nc = on ? 5 : 3, net = d.net, cnet = on ? c.net : 0;
    const section = (id, title, icon, rows, tid, tot, ctot) => `<section class="card flush span-12" id="${id}">${cardHead(icon, title, '')}
      <div class="table-wrap"><table class="data w2a-t"><thead><tr><th scope="col" class="hide-sm">Code</th><th scope="col">Name</th>${amtTHs(on, 'Amount', cl)}</tr></thead>
      <tbody>${rows.map(r => rowTR(r, on, f.from, f.to)).join('') || `<tr><td colspan="${nc}" class="muted">Nothing in this range</td></tr>`}</tbody><tfoot>${totTR(tid, 'Total ' + title.toLowerCase(), tot, ctot, on)}</tfoot></table></div></section>`;
    return `<div class="grid">${section('w2aPLInc', 'Income', 'chart-column', x.inc, 'inc', d.totalIncome, on ? c.totalIncome : 0)}</div>
      <div class="grid">${section('w2aPLExp', 'Expenses', 'receipt', x.exp, 'exp', d.totalExpense, on ? c.totalExpense : 0)}</div>
      <div class="grid"><section class="card flush span-12"><div class="w2a-net" id="w2aPLNet" data-cur="${net}" data-prev="${cnet}" data-chg="${net - cnet}"><span>${net < 0 ? 'Spent more than earned' : 'Left over (income minus expenses)'} · ${escH(rangeLabel(f.from, f.to))}</span>
        <span class="w2-right">${money(net)}${on ? `<span class="li-sub">was ${money(cnet)} (${escH(cl)}) · change ${money(net - cnet)}</span>` : ''}</span></div>
        <p class="help w2-pad">Year-end entries are left out of this statement.</p></section></div>`;
  }
  function tbHTML(b) {
    const x = tbData(b); if (!x) return `<div class="grid"><section class="card span-12">${emptyHTML('triangle-alert', 'Pick a valid date range')}</section></div>`;
    const { f, d, c, cr, rows } = x, on = !!c, cl = on ? `Closing ${rangeLabel(cr[0], cr[1])}` : '', T = d.totals;
    const body = rows.map(r => `<tr class="clickable" data-row="${escH(r.code)}" onclick="w2Acct.ledger('${q(r.account)}','${q(f.from)}','${q(f.to)}')"><td class="hide-sm">${escH(r.code)}</td>
      <td class="w2a-name">${escH(r.name)}<div class="li-sub only-sm">Opening ${money(r.opening)} · in ${money(r.debit)} · out ${money(r.credit)}</div></td>
      <td class="num hide-sm" data-k="opening" data-v="${r.opening}">${money(r.opening)}</td><td class="num hide-sm" data-k="debit" data-v="${r.debit}">${money(r.debit)}</td><td class="num hide-sm" data-k="credit" data-v="${r.credit}">${money(r.credit)}</td>${amtTDs(r.closing, r.prev, on)}</tr>`).join('');
    return `<div class="grid"><section class="card span-12">${statusLine(d.balanced, 'Debits and credits are equal', `Debits ${money(T.debit)} · credits ${money(T.credit)}`, 'w2aTBBal')}
        ${statusLine(d.openingBalanced, 'Opening balances are equal', d.openingBalanced ? 'Every balance before the start date nets to zero' : `Off by ${money(Math.abs(T.opening))}`, 'w2aTBOpen')}</section></div>
      <div class="grid"><section class="card flush span-12" id="w2aTB">${cardHead('square-check', escH(rangeLabel(f.from, f.to)), 'Raw amounts: debit is plus, credit is minus · tap a row for its movements')}
        <div class="table-wrap"><table class="data w2a-t"><thead><tr><th scope="col" class="hide-sm">Code</th><th scope="col">Name</th><th scope="col" class="num hide-sm">Opening</th><th scope="col" class="num hide-sm">Debit</th><th scope="col" class="num hide-sm">Credit</th>${amtTHs(on, 'Closing', cl)}</tr></thead>
        <tbody>${body}</tbody><tfoot><tr class="w2a-tot" data-tot="tb"><td class="hide-sm"></td><td>Total</td><td class="num hide-sm" data-k="opening" data-v="${T.opening}">${money(T.opening)}</td><td class="num hide-sm" data-k="debit" data-v="${T.debit}">${money(T.debit)}</td><td class="num hide-sm" data-k="credit" data-v="${T.credit}">${money(T.credit)}</td>${amtTDs(T.closing, on ? c.totals.closing : 0, on)}</tr></tfoot></table></div></section></div>`;
  }
  function renderReports() {
    const title = 'Reports', desc = 'Balance sheet, income statement and trial balance of the new book, for you or your accountant.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), tab = RS.tab, f = RS[tab];
    const tabs = `<div class="seg" role="group" aria-label="Report">${TABS.map(([k, l]) => `<button id="w2aTab-${k}" aria-pressed="${tab === k}" onclick="w2Acct.rTab('${k}')">${l}</button>`).join('')}</div>`;
    const date = (id, key, label) => `<label class="w2a-lbl">${label}<input class="input" type="date" id="${id}" value="${escH(f[key])}" max="2100-12-31" onchange="w2Acct.rDate('${key}',this.value)"></label>`;
    const presets = tab === 'bs' ? [['', 'Quick pick'], ['today', 'Today'], ['endLastMonth', 'End of last month'], ['endLastYear', 'End of last year']]
      : [['', 'Quick pick'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['thisYear', 'This year'], ['lastYear', 'Last year']];
    const bar = `<div class="w2-bar" id="w2aRBar">${tab === 'bs' ? date('w2aAsOf', 'asOf', 'As of') : date('w2aFrom', 'from', 'From') + date('w2aTo', 'to', 'to')}
      <select class="input" id="w2aPreset" aria-label="Quick pick" onchange="w2Acct.rPreset(this.value)">${presets.map(([v, l]) => opt(v, l, '')).join('')}</select>
      <select class="input" id="w2aCmp" aria-label="Compare with" onchange="w2Acct.rCmp(this.value)">${CMP.map(([v, l]) => opt(v, l, f.cmp)).join('')}</select></div>`;
    return `${pageHead(title, desc, xlBtn('w2aXl', 'rExcel') + hideBtn())}<div class="w2-bar">${tabs}</div>${bar}${tab === 'bs' ? bsHTML(b) : tab === 'pl' ? plHTML(b) : tbHTML(b)}`;
  }
  P.rTab = function (k) { if (RS[k]) { RS.tab = k; renderAll(); } };
  P.rCmp = function (v) { RS[RS.tab].cmp = CMP.some(c => c[0] === v) ? v : 'none'; renderAll(); };
  P.rDate = function (key, v) {
    const f = RS[RS.tab]; if (!validDay(v)) { toast('Enter a valid date'); renderAll(); return; }
    f[key] = v; if (f.from && f.to && f.from > f.to) { if (key === 'from') f.to = v; else f.from = v; }
    renderAll();
  };
  P.rPreset = function (v) {
    const f = RS[RS.tab];
    if (RS.tab === 'bs' && ASOF_P[v]) f.asOf = ASOF_P[v](); else if (RS.tab !== 'bs' && RANGE_P[v]) [f.from, f.to] = RANGE_P[v](); else return;
    renderAll();
  };
  P.rExcel = function () {
    const b = B(); if (!b) return false;
    const row = on => (code, name, cur, prev, s) => ({ v: [code, name, cur, ...(on ? xlCmp(cur, prev) : [])], s });
    if (RS.tab === 'bs') {
      const x = bsData(b); if (!x) return false; const { d, c, ca } = x, on = !!c, r = row(on);
      const rows = [{ v: ['ASSETS'], s: 'sec' }, ...x.A.map(a => r(a.code, a.name, a.cur, a.prev)), r('', 'Total assets', d.totalAssets, on ? c.totalAssets : 0, 'grand'),
        { v: ['DEBTS'], s: 'sec' }, ...x.L.map(a => r(a.code, a.name, a.cur, a.prev)), r('', 'Total debts', d.totalLiabilities, on ? c.totalLiabilities : 0, 'tot'),
        { v: ['EQUITY'], s: 'sec' }, ...x.E.map(a => r(a.code, a.name, a.cur, a.prev)), ...x.earn.map(a => r('', a.name, a.cur, a.prev)), r('', 'Total equity', d.totalEquity, on ? c.totalEquity : 0, 'tot'),
        r('', 'Total debts and equity', d.totalLE, on ? c.totalLE : 0, 'grand'), { v: ['', d.balanced ? 'Balanced' : 'NOT balanced'] }];
      return xl({ file: `new-book-balance-sheet-${d.asOf}.xlsx`, sheet: 'Balance sheet', numCols: [3, ...(on ? [4, 5] : [])], pctCols: on ? [6] : [],
        title: `Balance sheet as of ${dayText(d.asOf)}`, sub: `New book · amounts in Rp · debts and equity shown positive${on ? ` · compared with ${dayText(ca)}` : ''}`,
        head: ['Code', 'Account', 'Amount', ...(on ? [dayText(ca), 'Change', 'Change %'] : [])], widths: [12, 46, 20, ...(on ? [20, 18, 11] : [])], rows });
    }
    if (RS.tab === 'pl') {
      const x = plData(b); if (!x) return false; const { f, d, c, cr } = x, on = !!c, r = row(on);
      const rows = [{ v: ['INCOME'], s: 'sec' }, ...x.inc.map(a => r(a.code, a.name, a.cur, a.prev)), r('', 'Total income', d.totalIncome, on ? c.totalIncome : 0, 'tot'),
        { v: ['EXPENSES'], s: 'sec' }, ...x.exp.map(a => r(a.code, a.name, a.cur, a.prev)), r('', 'Total expenses', d.totalExpense, on ? c.totalExpense : 0, 'tot'),
        r('', 'Income minus expenses', d.net, on ? c.net : 0, 'grand')];
      return xl({ file: `new-book-income-statement-${f.from}_${f.to}.xlsx`, sheet: 'Income statement', numCols: [3, ...(on ? [4, 5] : [])], pctCols: on ? [6] : [],
        title: `Income statement · ${rangeLabel(f.from, f.to)}`, sub: `New book · amounts in Rp · income and expenses shown positive · year-end entries left out${on ? ` · compared with ${rangeLabel(cr[0], cr[1])}` : ''}`,
        head: ['Code', 'Account', 'Amount', ...(on ? [rangeLabel(cr[0], cr[1]), 'Change', 'Change %'] : [])], widths: [12, 46, 20, ...(on ? [24, 18, 11] : [])], rows });
    }
    const x = tbData(b); if (!x) return false; const { f, d, c, cr } = x, on = !!c, T = d.totals;
    const rows = x.rows.map(r => ({ v: [r.code, r.name, KIND_WORD[r.kind] || '', r.opening, r.debit, r.credit, r.closing, ...(on ? xlCmp(r.closing, r.prev) : [])] }));
    rows.push({ v: ['', 'Total', '', T.opening, T.debit, T.credit, T.closing, ...(on ? xlCmp(T.closing, c.totals.closing) : [])], s: 'grand' });
    rows.push({ v: ['', `Debits and credits are equal: ${d.balanced ? 'yes' : 'NO'} · opening balances are equal: ${d.openingBalanced ? 'yes' : 'NO'}`] });
    return xl({ file: `new-book-trial-balance-${f.from}_${f.to}.xlsx`, sheet: 'Trial balance', numCols: [4, 5, 6, 7, ...(on ? [8, 9] : [])], pctCols: on ? [10] : [],
      title: `Trial balance · ${rangeLabel(f.from, f.to)}`, sub: `New book · amounts in Rp · raw amounts, debit +, credit −${on ? ` · compared with ${rangeLabel(cr[0], cr[1])}` : ''}`,
      head: ['Code', 'Account', 'Kind', 'Opening', 'Debit', 'Credit', 'Closing', ...(on ? [`Closing ${rangeLabel(cr[0], cr[1])}`, 'Change', 'Change %'] : [])], widths: [12, 40, 18, 18, 18, 18, 18, ...(on ? [24, 18, 11] : [])], rows });
  };
  // One account's movements with a running balance (raw: debit +, credit −), newest first.
  P.ledger = function (id, from, to) {
    const b = B(); if (!b || !b.accounts[id]) return;
    let L; try { L = bookLib.ledgerOf(b, id, from || null, to || null); } catch (e) { toast(errText(e)); return; }
    const rows = L.rows.slice().reverse().slice(0, 300);
    const table = rows.length ? `<div class="table-wrap hide-sm"><table class="data w2a-t" id="w2aLedger"><thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col" class="num">Debit</th><th scope="col" class="num">Credit</th><th scope="col" class="num">Balance</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td style="white-space:nowrap">${escH(dayText(r.date))}</td><td class="w2a-wrap">${escH(r.description || '—')}<div class="li-sub">${escH(ENTRY_WORD[r.kind] || r.kind)}${r.number ? ' · ' + escH(r.number) : ''}</div></td><td class="num">${r.debit ? money(r.debit) : ''}</td><td class="num">${r.credit ? money(r.credit) : ''}</td><td class="num">${money(r.running)}</td></tr>`).join('')}</tbody></table></div>
      <div class="only-sm"><div class="list">${rows.map(r => `<div class="list-item"><div class="li-body"><div class="li-title">${escH(r.description || '—')}</div><div class="li-sub">${escH(dayText(r.date))} · ${escH(ENTRY_WORD[r.kind] || r.kind)}</div></div>
        <span class="w2-right"><span>${r.debit ? 'Debit ' + money(r.debit) : 'Credit ' + money(r.credit)}</span><span class="li-sub">${money(r.running)}</span></span></div>`).join('')}</div></div>` : emptyHTML('inbox', 'No movements in this period');
    openSheet({ title: `${L.code} · ${L.name}`, wide: true, confirmDiscard: false,
      body: `<p class="muted" id="w2aLedBal" style="margin:0 0 12px">${from ? `${escH(rangeLabel(from, to))} · opening ${money(L.opening)} · ` : `Up to ${escH(dayText(to || today()))} · `}closing ${money(L.closing)} · debit is plus, credit is minus${L.rows.length > 300 ? ' · showing the latest 300 movements' : ''}</p>${table}` });
  };

  /* ════════════════ Accounts chart (w2-accounts) ════════════════ */
  const AC = { q: '', hidden: false, noCode: false };
  function chartRows(b) {
    const bal = bookLib.balances(b), s = AC.q.trim().toLowerCase();
    return live(b.accounts).map(a => ({ a, code: a.code, name: a.name, balance: natural(a, bal[a.id] || 0), raw: bal[a.id] || 0 })).filter(r => {
      if (r.a.hidden && !AC.hidden) return false;
      if (AC.noCode && (r.a.accurateCode || r.a.header)) return false;
      return !s || [r.code, r.name, KIND_WORD[r.a.kind], ROLE_WORD[r.a.role], r.a.accurateCode].join(' ').toLowerCase().includes(s);
    }).sort(byCode);
  }
  const accBadges = a => `${a.header ? ' <span class="badge">Heading</span>' : ''}${a.hidden ? ' <span class="badge warn">Hidden</span>' : ''}`;
  const accCode = a => (a.header ? '<span class="faint">—</span>' : a.accurateCode ? escH(a.accurateCode) : '<span class="badge warn">Not set</span>');
  const accMenu = a => `<button class="icon-btn sm" data-w2a-menu="${escH(a.id)}" onclick="w2Acct.accMenu(this,'${q(a.id)}')" aria-label="More for ${escH(a.name)}" aria-haspopup="menu">${ic('ellipsis', 's16')}</button>`;
  function chartBody(b) {
    const rows = chartRows(b);
    if (!rows.length) return `<div data-w2a-count="0">${emptyHTML('search', 'No accounts match')}</div>`;
    const table = `<div class="table-wrap hide-sm"><table class="data w2a-t" id="w2aAccTable"><thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">What it is</th><th scope="col" class="num">Balance</th><th scope="col">Accurate code</th><th scope="col"><span class="sr-only">More</span></th></tr></thead><tbody>
      ${rows.map(r => `<tr data-w2a-acc="${escH(r.a.id)}" data-code="${escH(r.code)}" data-v="${r.balance}"${r.a.hidden ? ' class="muted-row"' : ''}><td style="white-space:nowrap">${escH(r.code)}</td><td class="w2a-name">${escH(r.name)}${accBadges(r.a)}</td><td>${escH(KIND_WORD[r.a.kind] || r.a.kind)}</td><td>${escH(ROLE_WORD[r.a.role] || r.a.role)}</td>
        <td class="num">${r.a.header ? '' : money(r.balance)}</td><td data-w2a-ac>${accCode(r.a)}</td><td class="num">${accMenu(r.a)}</td></tr>`).join('')}</tbody></table></div>`;
    const phone = `<div class="only-sm w2-pad"><div class="list" id="w2aAccList">${rows.map(r => `<div class="list-item" data-w2a-acc="${escH(r.a.id)}"${r.a.hidden ? ' style="opacity:.55"' : ''}><div class="li-body"><div class="li-title">${escH(r.name)}${accBadges(r.a)}</div>
        <div class="li-sub">${escH(r.code)} · ${escH(ROLE_WORD[r.a.role] || r.a.role)}${r.a.header ? '' : ` · Accurate ${r.a.accurateCode ? escH(r.a.accurateCode) : 'not set'}`}</div></div><span class="w2-right">${r.a.header ? '' : money(r.balance)}</span>${accMenu(r.a)}</div>`).join('')}</div></div>`;
    return `<div data-w2a-count="${rows.length}">${table}${phone}</div>`;
  }
  function renderAccounts() {
    const title = 'Accounts chart', desc = 'Every account of the new book with its code, what it is, its balance today and its code in Accurate.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), all = live(b.accounts), nHidden = all.filter(a => a.hidden).length, nNo = all.filter(a => !a.header && !a.hidden && !a.accurateCode).length;
    const bar = `<div class="w2-bar"><button class="btn btn-primary btn-sm" id="w2aAccAdd" onclick="w2Acct.accAdd()">${ic('plus', 's16')}Add account</button>
      <input class="input grow" id="w2aAccSearch" type="search" placeholder="Search code, name or kind" aria-label="Search accounts" value="${escH(AC.q)}" oninput="w2Acct.accSearch(this.value)" style="flex:1 1 200px">
      <button class="chip" id="w2aAccNoCode" aria-pressed="${AC.noCode}" onclick="w2Acct.accFilter('noCode')">Without Accurate code (${nNo})</button>
      <button class="chip" id="w2aAccHidden" aria-pressed="${AC.hidden}" onclick="w2Acct.accFilter('hidden')">Show hidden (${nHidden})</button></div>`;
    return `${pageHead(title, desc, xlBtn('w2aAccXl', 'accExcel') + hideBtn())}${bar}
      <div class="grid"><section class="card flush span-12" id="w2aAccCard">${cardHead('list-tree', 'Accounts', 'Balances as of today · debts, equity and income shown as positive amounts')}<div id="w2aAccBody">${chartBody(b)}</div></section></div>`;
  }
  P.accSearch = function (v) { AC.q = v; const box = el('w2aAccBody'); if (box && B()) box.innerHTML = chartBody(B()); };
  P.accFilter = function (k) { AC[k] = !AC[k]; renderAll(); };
  P.accMenu = function (btn, id) {
    const b = B(), a = b && b.accounts[id]; if (!a) return;
    const items = [{ label: 'Rename', icon: 'pencil', onSelect: () => P.accRename(id) }];
    if (!a.header) items.push({ label: 'Set Accurate code', icon: 'tag', onSelect: () => P.accCode(id) }, { label: 'See movements', icon: 'table', onSelect: () => P.ledger(id, '', today()) });
    items.push({ divider: true }, a.hidden ? { label: 'Show again', icon: 'eye', onSelect: () => P.accShow(id) } : { label: 'Hide', icon: 'eye-off', onSelect: () => P.accHide(id) });
    openMenu(btn, { title: a.name, items });
  };
  let AS = null;
  P.accAdd = function () {
    AS = { mode: 'add' };
    openSheet({ title: 'Add account', focus: '#w2aName', onEnter: () => P.accSave(),
      body: `<div class="form-grid"><div class="field full"><label class="label" for="w2aName">Name</label><input class="input" id="w2aName" maxlength="80" autocomplete="off"></div>
        <div class="field"><label class="label" for="w2aRole">What it is</label><select class="input" id="w2aRole">${ADD_ROLES.map(r => opt(r, `${ROLE_WORD[r]} (${KIND_WORD[bookRoleKind(r)].split(' · ')[0].toLowerCase()})`, 'bank')).join('')}</select></div>
        <div class="field"><label class="label" for="w2aACode">Accurate code (optional)</label><input class="input" id="w2aACode" maxlength="40" autocomplete="off"></div>
        <p class="help full" style="margin:0">The app gives the account its own code. The Accurate code is the account’s number in your Accurate book: the account must exist there first, because Accurate’s import cannot create accounts.</p>${errBox('w2aErr')}</div>`,
      foot: sheetFoot('Add account', 'accSave') });
  };
  const ROLE_KIND = { bank: 'asset', cash: 'asset', ewallet: 'asset', investment: 'asset', property: 'asset', 'other-asset': 'asset', card: 'liability', loan: 'liability', 'other-liability': 'liability', income: 'income', expense: 'expense', equity: 'equity' };
  function bookRoleKind(r) { return ROLE_KIND[r] || 'asset'; }
  P.accRename = function (id) {
    const a = B().accounts[id]; if (!a) return; AS = { mode: 'rename', id };
    openSheet({ title: `Rename ${a.name}`, focus: '#w2aName', onEnter: () => P.accSave(),
      body: `<div class="form-grid"><div class="field full"><label class="label" for="w2aName">Name</label><input class="input" id="w2aName" maxlength="80" autocomplete="off" value="${escH(a.name)}"></div>${errBox('w2aErr')}</div>`, foot: sheetFoot('Save', 'accSave') });
  };
  P.accCode = function (id) {
    const a = B().accounts[id]; if (!a) return; AS = { mode: 'code', id };
    openSheet({ title: `Accurate code · ${a.name}`, focus: '#w2aACode', onEnter: () => P.accSave(),
      body: `<p class="muted" style="margin:0 0 14px">The number this account has in your Accurate book, exactly as Accurate shows it. It is used only in the Accurate export. Leave it empty to clear it.</p>
        <div class="form-grid"><div class="field full"><label class="label" for="w2aACode">Accurate code</label><input class="input" id="w2aACode" maxlength="40" autocomplete="off" value="${escH(a.accurateCode || '')}"></div>${errBox('w2aErr')}</div>`, foot: sheetFoot('Save', 'accSave') });
  };
  P.accSave = function () {
    if (!AS) return; const x = AS, name = el('w2aName') ? el('w2aName').value.trim() : '', code = el('w2aACode') ? el('w2aACode').value.trim() : '';
    if (x.mode !== 'code' && !name) { showErr('w2aErr', 'Enter a name'); return; }
    let r, msg;
    if (x.mode === 'add') { const role = el('w2aRole').value; r = change(w => bookLib.addAccount(w, { name, role, ...(code ? { accurateCode: code } : {}) }), 'account-add', 'w2aErr'); msg = `${name} added`; }
    else if (x.mode === 'rename') { r = change(w => bookLib.editAccount(w, x.id, { name }), 'account-rename', 'w2aErr'); msg = 'Renamed'; }
    else {
      if ((B().accounts[x.id].accurateCode || '') === code) { closeTopSheet(true); AS = null; return; }
      r = change(w => bookLib.editAccount(w, x.id, { accurateCode: code }), 'account-accurate-code', 'w2aErr'); msg = code ? `Accurate code set to ${code}` : 'Accurate code cleared';
    }
    if (!r.ok) return;
    closeTopSheet(true); AS = null; toast(msg);
  };
  P.accHide = function (id) {
    const r = change(w => { if (!bookLib.hideAccount(w, id)) throw new Error('This account is already hidden'); }, 'account-hide');
    if (r.ok) toast('Hidden. It stays in the book and in its past entries.', { action: 'Undo', onAction: () => P.accShow(id) });
  };
  P.accShow = function (id) { if (change(w => bookLib.editAccount(w, id, { hidden: false }), 'account-show').ok) toast('Shown again'); };
  P.accExcel = function () {
    const b = B(); if (!b) return false;
    const rows = chartRows(b).map(r => ({ v: [r.code, r.name, KIND_WORD[r.a.kind] || r.a.kind, ROLE_WORD[r.a.role] || r.a.role, r.a.header ? '' : r.balance, r.a.accurateCode || '', r.a.header ? 'Heading' : '', r.a.hidden ? 'Hidden' : ''] }));
    return xl({ file: `new-book-accounts-chart-${today()}.xlsx`, sheet: 'Accounts chart', numCols: [5], title: `Accounts chart as of ${dayText(today())}`,
      sub: 'New book · amounts in Rp · debts, equity and income shown positive', head: ['Code', 'Account', 'Kind', 'What it is', 'Balance', 'Accurate code', 'Heading', 'Hidden'], widths: [12, 44, 20, 24, 20, 16, 10, 10], rows });
  };

  /* ════════════════ Audit (w2-audit) ════════════════ */
  const AU = { what: '', from: '', to: '', limit: 100 };
  const ENT = { entry: 'Entries', account: 'Accounts', person: 'People', value: 'Values', check: 'Month check', lock: 'Locks', rule: 'Rules', settings: 'Settings', book: 'The book' };
  const ACT = { post: 'added', edit: 'changed', void: 'voided', add: 'added', hide: 'hidden', set: 'set', lock: 'locked', unlock: 'unlocked', remove: 'removed', migrate: 'copied from your current book' };
  const ONE = { entry: 'Entry', account: 'Account', person: 'Person', value: 'Value', check: 'Month check', lock: 'Month', rule: 'Rule', settings: 'Setting', book: 'History' };
  const SET_WORD = { bankMap: 'Bank links', stmtMap: 'Statement links', accurate: 'Accurate export', budgets: 'Budgets', goals: 'Goals', taxDeclared: 'Tax ticks', taxSlips: 'Tax slips',
    syncFrom: 'Start date of the spending sync', firstMonth: 'First month', retained: 'Past years account', unexplained: 'Unexplained account', fxGain: 'Exchange gain account' };
  const FIELD_WORD = { name: 'Name', code: 'Code', accurateCode: 'Accurate code', hidden: 'Hidden', role: 'What it is', category: 'Category', incomeType: 'Income type', parent: 'Group', header: 'Heading', tax: 'Tax details', stmt: 'Statement', emailBank: 'Email bank', person: 'Person', ccy: 'Currency' };
  const short = v => { const s = v == null || v === '' ? 'nothing' : typeof v === 'object' ? 'details' : v === true ? 'yes' : v === false ? 'no' : String(v); return s.length > 40 ? s.slice(0, 39) + '…' : s; };
  // One audit record in plain words: {what, item, detail (text), amount (number or null)}.
  function auditWords(b, u) {
    const af = u.after || {}, bf = u.before || {}, accName = id => (b.accounts[id] || {}).name || String(id || '');
    const what = `${ONE[u.entity] || u.entity} ${ACT[u.action] || u.action}`;
    let item = String(u.ref || ''), detail = '', amount = null;
    if (u.entity === 'entry') {
      const s = u.after || u.before || {}; item = `${s.description || (b.entries[u.ref] || {}).description || 'Entry'} · ${dayText(s.date)}`;
      amount = (s.lines || []).filter(l => l.amount > 0).reduce((t, l) => t + l.amount, 0);
      detail = ENTRY_WORD[s.kind] || s.kind || '';
    } else if (u.entity === 'account') {
      item = accName(u.ref);
      detail = u.action === 'edit' ? Object.keys(af).map(k => `${FIELD_WORD[k] || k}: ${short(bf[k])} → ${short(af[k])}`).join(' · ') : u.action === 'add' ? (ROLE_WORD[af.role] || '') : '';
    } else if (u.entity === 'person') { item = af.name || (b.people[u.ref] || {}).name || item; detail = af.type === 'company' ? 'Company' : 'Person'; }
    else if (u.entity === 'value') { item = `${accName(af.account)} · ${validMonth(af.month) ? mLong(af.month) : ''}`; amount = af.value; detail = 'Value'; }
    else if (u.entity === 'check') { item = `${accName(af.account)} · ${validMonth(af.month) ? mLong(af.month) : ''}`; detail = af.ok ? 'Agrees' : 'Differs'; }
    else if (u.entity === 'lock') { item = validMonth(u.ref) ? mLong(u.ref) : item; detail = af.reason || ''; }
    else if (u.entity === 'rule') { item = ((af.match || bf.match) || {}).payer || item; detail = ENTRY_WORD[((af.answer || bf.answer) || {}).kind] || ''; }
    else if (u.entity === 'settings') { item = SET_WORD[u.ref] || item; }
    else if (u.entity === 'book') { item = 'Your current book'; detail = af.entries != null ? `${plural(af.entries, 'entry', 'entries')}, ${plural(af.accounts || 0, 'account')}` : ''; }
    return { what, item, detail, amount };
  }
  function auditList(b) {
    return (b.audit || []).filter(u => u && (!AU.what || u.entity === AU.what) && (!AU.from || localDay(new Date(u.at)) >= AU.from) && (!AU.to || localDay(new Date(u.at)) <= AU.to))
      .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : String(y.id).localeCompare(String(x.id))));
  }
  function auditBody(b) {
    const all = auditList(b), list = all.slice(0, AU.limit);
    if (!all.length) return `<div data-w2a-count="0">${emptyHTML('search', 'No changes match these filters')}</div>`;
    const w = list.map(u => ({ u, ...auditWords(b, u) }));
    const det = r => `${escH(r.detail)}${r.amount != null ? `${r.detail ? ' · ' : ''}${money(r.amount)}` : ''}`;
    const table = `<div class="table-wrap hide-sm"><table class="data w2a-t" id="w2aAuTable"><thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Item</th><th scope="col">Detail</th></tr></thead><tbody>
      ${w.map(r => `<tr data-w2a-audit="${escH(r.u.id)}" data-entity="${escH(r.u.entity)}" data-action="${escH(r.u.action)}"><td style="white-space:nowrap">${escH(whenText(r.u.at))}</td><td>${escH(r.what)}</td><td class="w2a-wrap">${escH(r.item)}</td><td class="w2a-wrap">${det(r)}</td></tr>`).join('')}</tbody></table></div>`;
    const phone = `<div class="only-sm w2-pad"><div class="list">${w.map(r => `<div class="list-item" data-w2a-audit="${escH(r.u.id)}"><div class="li-body"><div class="li-title">${escH(r.what)} · ${escH(r.item)}</div><div class="li-sub">${escH(whenText(r.u.at))}${r.detail || r.amount != null ? ' · ' + det(r) : ''}</div></div></div>`).join('')}</div></div>`;
    return `<div data-w2a-count="${all.length}">${table}${phone}<div class="w2-pad" style="padding-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span class="help">${list.length} of ${plural(all.length, 'change')}</span>
      ${all.length > list.length ? `<button class="btn btn-secondary btn-sm" id="w2aAuMore" onclick="w2Acct.auMore()">Show more</button>` : ''}</div></div>`;
  }
  function renderAudit() {
    const title = 'Audit', desc = 'Every change made to the new book, newest first. Nothing is ever removed from this list.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), kinds = [...new Set((b.audit || []).map(u => u.entity))].sort((x, y) => String(ENT[x] || x).localeCompare(String(ENT[y] || y)));
    const bar = `<div class="w2-bar" id="w2aAuBar"><select class="input" id="w2aAuWhat" aria-label="What changed" onchange="w2Acct.auSet('what',this.value)"><option value="">Everything</option>${kinds.map(k => opt(k, ENT[k] || k, AU.what)).join('')}</select>
      <label class="w2a-lbl">From<input class="input" type="date" id="w2aAuFrom" value="${escH(AU.from)}" onchange="w2Acct.auSet('from',this.value)"></label>
      <label class="w2a-lbl">to<input class="input" type="date" id="w2aAuTo" value="${escH(AU.to)}" onchange="w2Acct.auSet('to',this.value)"></label>
      ${AU.what || AU.from || AU.to ? `<button class="btn btn-ghost btn-sm" id="w2aAuClear" onclick="w2Acct.auClear()">Clear filters</button>` : ''}</div>`;
    return `${pageHead(title, desc, xlBtn('w2aAuXl', 'auExcel') + hideBtn())}${bar}
      <div class="grid"><section class="card flush span-12" id="w2aAuCard">${cardHead('history', 'Changes', 'Who changed what is not recorded: this book has one owner')}<div id="w2aAuBody">${auditBody(b)}</div></section></div>`;
  }
  P.auSet = function (k, v) { AU[k] = v; AU.limit = 100; renderAll(); };
  P.auClear = function () { AU.what = AU.from = AU.to = ''; AU.limit = 100; renderAll(); };
  P.auMore = function () { AU.limit += 100; const box = el('w2aAuBody'); if (box && B()) box.innerHTML = auditBody(B()); };
  P.auExcel = function () {
    const b = B(); if (!b) return false;
    const j = o => (o == null ? '' : JSON.stringify(o).slice(0, 2000));
    const rows = auditList(b).map(u => { const w = auditWords(b, u); return { v: [u.at, w.what, w.item, w.detail, w.amount == null ? '' : w.amount, j(u.before), j(u.after)] }; });
    return xl({ file: `new-book-audit-${today()}.xlsx`, sheet: 'Audit', xSplit: 0, numCols: [5], title: `Audit · ${plural(rows.length, 'change')}`,
      sub: `New book · newest first${AU.what ? ` · ${ENT[AU.what] || AU.what} only` : ''}${AU.from ? ` · from ${AU.from}` : ''}${AU.to ? ` · to ${AU.to}` : ''}`,
      head: ['When (UTC)', 'What', 'Item', 'Detail', 'Amount', 'Before', 'After'], widths: [26, 22, 40, 36, 18, 50, 50], rows });
  };

  /* ════════════════ Accurate export (w2-accurate) ════════════════ */
  const X = { mode: 'summary', target: null, cmp: { date: '', text: '', sign: 'pos', rows: null, skipped: 0 } };
  const exportable = e => !!e && e.status === 'posted' && !e.deleted && e.kind !== 'year-end';
  const axSet = b => { const a = (b.settings || {}).accurate; return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; };
  // The first month the export offers: history copied from the old book came from Accurate, so it is never sent back.
  function axStart(b) {
    const a = axSet(b), s = b.settings || {};
    if (validMonth(a.from)) return a.from;
    if (b.migration && validDay(s.syncFrom)) return s.syncFrom.slice(0, 7);
    if (validMonth(s.firstMonth)) return s.firstMonth;
    return live(b.entries).filter(exportable).reduce((m, e) => (e.date.slice(0, 7) < m ? e.date.slice(0, 7) : m), curMonth());
  }
  function axMonths(b) {
    const exported = axSet(b).exported || {}, start = axStart(b), count = {};
    for (const e of live(b.entries)) if (exportable(e)) { const M = e.date.slice(0, 7); count[M] = (count[M] || 0) + 1; }
    const mine = Object.keys(count).filter(M => M >= start && !exported[M]).sort();
    return { start, count, exported, waiting: mine.filter(M => bookLib.lockState(b, M) === 'locked'), open: mine.filter(M => bookLib.lockState(b, M) !== 'locked') };
  }
  // The journals of the chosen months, in the app's own terms: lines carry the account id.
  function axJournals(b, months, mode) {
    const out = [];
    for (const M of months) {
      if (mode !== 'entry') {
        const s = bookLib.monthSummary(b, M);
        out.push({ month: M, number: s.number, date: s.date, description: s.description, txid: 900000000 + +M.replace('-', ''), lines: s.lines.map(l => ({ account: l.account, amount: l.amount, memo: s.description })) });
        continue;
      }
      const es = live(b.entries).filter(e => exportable(e) && e.date.slice(0, 7) === M).sort((p, r) => (p.date < r.date ? -1 : p.date > r.date ? 1 : String(p.number || '').localeCompare(String(r.number || '')) || String(p.id).localeCompare(String(r.id))));
      es.forEach((e, i) => out.push({ month: M, entry: e.id, number: 'ET-' + (e.number || e.id), date: e.date, description: e.description || ENTRY_WORD[e.kind] || 'ExpenseTrack entry',
        txid: 1000000000 + (+M.slice(2, 4) * 100 + +M.slice(5)) * 10000 + i + 1, lines: e.lines.map(l => ({ account: l.account, amount: l.amount, memo: l.memo || '' })) }));
    }
    return out;
  }
  // The same journals as they go into the file: Accurate codes instead of app accounts. A summary adds
  // up app accounts that share one Accurate code. Foreign-currency lines go in at their rupiah amount.
  function axFile(b, journals, mode) {
    return journals.map(j => {
      let lines = j.lines.map(l => { const a = b.accounts[l.account] || {}; return { account: l.account, name: a.name || String(l.account), code: a.accurateCode || '', amount: l.amount, memo: l.memo || '' }; });
      if (mode !== 'entry') {
        const m = new Map();
        for (const l of lines) { const k = l.code ? 'c:' + l.code : 'a:' + l.account, x = m.get(k); if (x) x.amount += l.amount; else m.set(k, { ...l }); }
        lines = [...m.values()].filter(l => l.amount).sort((p, r) => cmpCode(p.code, r.code));
      }
      return { ...j, lines };
    }).filter(j => j.lines.length);
  }
  function axChecks(b, file) {
    const miss = new Map(), unbal = [], long = [], zero = [];
    for (const j of file) {
      for (const l of j.lines) { if (!l.code) miss.set(l.account, l.name); if (!l.amount) zero.push(j.number); if (String(l.memo || '').length > 80) long.push(j.number); }
      if (String(j.description || '').length > 2000) long.push(j.number);
      if (j.lines.length < 2 || j.lines.reduce((t, l) => t + l.amount, 0) !== 0) unbal.push(j.number);
    }
    const uniq = l => [...new Set(l)], some = l => uniq(l).slice(0, 8).join(', ') + (uniq(l).length > 8 ? ` and ${uniq(l).length - 8} more` : '');
    const branch = String(axSet(b).branchCode || '').trim();
    return [
      { id: 'codes', ok: !miss.size, title: 'Every account in the file has an Accurate code', detail: miss.size ? `No Accurate code yet: ${some([...miss.values()])}. Set it on Accounts chart.` : '', missing: [...miss.keys()] },
      { id: 'balanced', ok: !unbal.length, title: 'Every journal balances (debits equal credits)', detail: unbal.length ? `Not balanced: ${some(unbal)}` : '' },
      { id: 'memo', ok: !long.length, title: 'Every line note is 80 characters or shorter', detail: long.length ? `Too long for Accurate: ${some(long)}` : '' },
      { id: 'zero', ok: !zero.length, title: 'No line has a zero amount', detail: zero.length ? `Zero line in: ${some(zero)}` : '' },
      { id: 'branch', ok: !!branch, title: 'The branch code of your Accurate book is filled in', detail: branch ? '' : 'Accurate’s import file names the book’s branch code. Add it under File settings.' },
    ];
  }

  /* The file itself. Layout taken from the journal-voucher export of Accurate 5 Desktop:
     NMEXML > TRANSACTIONS > JV (TRANSACTIONID, ACCOUNTLINE…, JVNUMBER, TRANSDATE, SOURCE, TRANSTYPE,
     TRANSDESCRIPTION, JVAMOUNT). Amounts: whole numbers, debit positive, credit negative; dates
     YYYY-MM-DD; an empty value is an empty element; text is escaped (& < >). */
  const xmlText = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/[\r\n\t]+/g, ' ');
  const xmlEsc = s => xmlText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xmlAttr = s => `"${xmlEsc(s).replace(/"/g, '&quot;')}"`;
  const tag = (name, v) => (v == null || v === '' ? `<${name}/>` : `<${name}>${xmlEsc(v)}</${name}>`);
  function accurateXml(file, o) {
    o = o || {};
    const parts = file.map((j, i) => {
      const lines = j.lines.map((l, k) => '<ACCOUNTLINE operation="Add">' + tag('KeyID', k) + tag('GLACCOUNT', l.code) + tag('GLAMOUNT', l.amount) + tag('DESCRIPTION', l.memo)
        + tag('RATE', 1) + tag('PRIMEAMOUNT', l.amount) + '<TXDATE/><POSTED/>' + tag('CURRENCYNAME', o.currencyName) + '</ACCOUNTLINE>').join('');
      const debits = j.lines.reduce((t, l) => t + (l.amount > 0 ? l.amount : 0), 0);
      return `<JV operation="Add" REQUESTID="${i + 1}">` + tag('TRANSACTIONID', j.txid) + lines + tag('JVNUMBER', j.number) + tag('TRANSDATE', j.date)
        + tag('SOURCE', 'GL') + tag('TRANSTYPE', 'journal voucher') + tag('TRANSDESCRIPTION', j.description) + tag('JVAMOUNT', debits) + '</JV>';
    });
    return '<?xml version="1.0"?>\n' + `<NMEXML EximID=${xmlAttr(o.eximId == null ? 1 : o.eximId)} BranchCode=${xmlAttr(o.branchCode || '')} ACCOUNTANTCOPYID=""><TRANSACTIONS OnError="CONTINUE">`
      + parts.join('') + '</TRANSACTIONS></NMEXML>\n';
  }
  // Accurate is a Windows-1252 program: the file is saved in that encoding (a character outside it becomes "?").
  const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function cp1252(s) {
    const out = [];
    for (const ch of String(s)) { const c = ch.codePointAt(0); out.push(c < 0x80 || (c >= 0xA0 && c <= 0xFF) ? c : CP1252[c] || 0x3F); }
    return new Uint8Array(out);
  }
  // The same journals for the import tool on this PC: a JSON list, one entry per voucher.
  const vouchersJson = file => file.map(j => ({ date: j.date, description: j.description, lines: j.lines.map(l => (l.memo ? { account: l.code, amount: l.amount, memo: l.memo } : { account: l.code, amount: l.amount })) }));

  // Everything the page and its buttons need, worked out once from the book.
  function axState(b) {
    const m = axMonths(b);
    if (!X.target || !m.waiting.includes(X.target)) X.target = m.waiting[m.waiting.length - 1] || null;
    const months = m.waiting.filter(M => M <= X.target), mode = X.mode === 'entry' ? 'entry' : 'summary';
    const file = axFile(b, axJournals(b, months, mode), mode), checks = axChecks(b, file);
    return { ...m, months, mode, file, checks, ok: file.length > 0 && checks.every(c => c.ok), entries: months.reduce((t, M) => t + (m.count[M] || 0), 0) };
  }
  // What an exported month's entry looked like when the month was marked, and what it is now → the
  // correction still to make in Accurate (per Accurate account, debit positive).
  function axChanged(b) {
    const exported = axSet(b).exported || {}, out = [], months = Object.keys(exported);
    if (!months.length) return out;
    for (const e of live(b.entries)) {
      if (e.kind === 'year-end') continue;
      for (const M of months) {
        const rec = exported[M]; if (!rec || !(String(e.at || '') > String(rec.at || ''))) continue;
        const first = (e.history || []).find(h => String(h.at || '') > String(rec.at));
        const was = first ? first.before : (String(e.createdAt || '') > String(rec.at) ? null : e);
        const wasIn = !!was && (was.status || 'posted') === 'posted' && String(was.date).slice(0, 7) === M && was.kind !== 'year-end';
        const nowIn = e.status === 'posted' && e.date.slice(0, 7) === M;
        if (!wasIn && !nowIn) continue;
        const net = new Map(), put = (lines, s) => { for (const l of lines || []) net.set(l.account, (net.get(l.account) || 0) + s * l.amount); };
        if (nowIn) put(e.lines, 1); if (wasIn) put(was.lines, -1);
        const lines = [...net.entries()].filter(([, v]) => v).map(([id, v]) => { const a = b.accounts[id] || {}; return { account: id, code: a.accurateCode || '', name: a.name || id, amount: v }; }).sort((p, r) => cmpCode(p.code, r.code));
        if (!lines.length) continue;
        out.push({ month: M, entry: e.id, description: e.description || ENTRY_WORD[e.kind] || 'Entry', date: e.date,
          what: !wasIn ? 'Added after the export' : !nowIn ? (e.status === 'void' ? 'Voided after the export' : 'Moved to another month after the export') : 'Changed after the export', lines });
      }
    }
    return out.sort((p, r) => (p.month < r.month ? -1 : p.month > r.month ? 1 : p.date < r.date ? -1 : p.date > r.date ? 1 : String(p.entry).localeCompare(String(r.entry))));
  }
  const monthsText = ms => (!ms.length ? '' : ms.length === 1 ? mLong(ms[0]) : `${monthLabel(ms[0])} – ${monthLabel(ms[ms.length - 1])}`);
  function renderAccurate() {
    const title = 'Accurate export', desc = 'Send the new book’s journals to your Accurate book when you choose to. One way only: the app to Accurate.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), s = axState(b), set = axSet(b), changed = axChanged(b), expMonths = Object.keys(s.exported).sort();
    const lastM = expMonths[expMonths.length - 1], lastAt = expMonths.reduce((t, M) => (String(s.exported[M].at) > t ? String(s.exported[M].at) : t), '');
    const waitingEntries = s.waiting.reduce((t, M) => t + (s.count[M] || 0), 0);
    const cell = (id, label, v, shown, sub) => `<div class="strip-cell" id="${id}" data-v="${escH(v)}"><span class="eyebrow">${label}</span><span class="strip-val">${shown}</span><span class="strip-sub">${sub}</span></div>`;
    const strip = `<section class="card strip span-12" id="w2xStrip" aria-label="Accurate export summary">
      ${cell('w2xLast', 'Last export', lastM || '', lastM ? escH(dayText(monthEnd(lastM))) : 'Nothing yet', lastM ? `Marked as imported ${escH(whenText(lastAt))}` : 'No month has been marked as imported')}
      ${cell('w2xWait', 'Waiting to export', waitingEntries, plural(waitingEntries, 'entry', 'entries'), s.waiting.length ? `${escH(monthsText(s.waiting))} · locked months only` : 'No locked month is waiting')}
      ${cell('w2xChanged', 'Changed after export', changed.length, String(changed.length), changed.length ? 'to fix by hand in Accurate' : 'Nothing to fix in Accurate')}</section>`;
    const note = `<p class="help" id="w2xNote" style="margin:0">The app never writes to Accurate itself: it only makes a file that you import. Try the file once on a sandbox copy of your Accurate book before the first real import.</p>`;
    const jl = s.file.length, nl = s.file.reduce((t, j) => t + j.lines.length, 0);
    const make = !s.waiting.length ? `${emptyHTML('inbox', s.open.length ? `Nothing to export yet. ${plural(s.open.length, 'month')} with entries ${s.open.length === 1 ? 'is' : 'are'} not locked.` : 'Nothing to export. Every locked month has been marked as imported.', s.open.length ? 'Open Month check' : '', "setTab('w2-check')")}` : `
      <div class="w2-bar" style="margin-bottom:8px"><label class="w2a-lbl">Export up to<select class="input" id="w2xTarget" onchange="w2Acct.axTarget(this.value)">${s.waiting.map(M => opt(M, dayText(monthEnd(M)), X.target)).join('')}</select></label>
        <div class="seg" role="group" aria-label="What goes in the file"><button id="w2xSummary" aria-pressed="${s.mode === 'summary'}" onclick="w2Acct.axMode('summary')">One summary journal per month</button><button id="w2xEntry" aria-pressed="${s.mode === 'entry'}" onclick="w2Acct.axMode('entry')">Every entry</button></div></div>
      <p class="help" id="w2xWhat" data-journals="${jl}" data-lines="${nl}" style="margin:0 0 8px">This file: ${plural(jl, 'journal')} with ${plural(nl, 'line')} for ${escH(monthsText(s.months))}${s.mode === 'summary' ? ', each dated the last day of its month and moving every account by its total for the month' : ', one journal per entry'}. Amounts in another currency go in at their rupiah amount.</p>
      <div id="w2xChecks" data-ok="${s.ok ? 1 : 0}">${s.checks.map(c => `<div class="w2a-check" data-w2x-check="${c.id}" data-ok="${c.ok ? 1 : 0}">${ic(c.ok ? 'square-check' : 'triangle-alert')}<span class="li-body"><span class="li-title" style="display:block">${escH(c.title)}</span>${c.detail ? `<span class="li-sub" style="display:block">${escH(c.detail)}</span>` : ''}</span>
        ${c.ok ? '<span class="badge good">OK</span>' : c.id === 'codes' ? `<button class="btn btn-secondary btn-sm" id="w2xMatch" onclick="w2Acct.axMatch()">Match codes</button>` : c.id === 'branch' ? `<button class="btn btn-secondary btn-sm" onclick="w2Acct.axSettings()">File settings</button>` : '<span class="badge bad">Fix</span>'}</div>`).join('')}</div>
      <div class="w2-bar" style="margin:14px 0 0"><button class="btn btn-primary" id="w2xXml"${s.ok ? '' : ' disabled'} onclick="w2Acct.axXml()">${ic('download', 's16')}Download file for Accurate</button>
        <button class="btn btn-secondary" id="w2xJson"${s.ok ? '' : ' disabled'} onclick="w2Acct.axJson()">File for the import tool</button>
        ${s.ok ? '' : '<span class="help" id="w2xWaitMsg">The download waits until every check above passes.</span>'}</div>`;
    const after = `<div class="w2-row"><div class="li-body"><div class="li-title">After importing in Accurate</div><div class="li-sub">Tick the months once Accurate says the import worked. A ticked month is never offered again, so nothing can be imported twice.</div></div>
        <div class="w2-side"><button class="btn btn-secondary btn-sm" id="w2xMark"${s.months.length ? '' : ' disabled'} onclick="w2Acct.axMark()">Mark as imported</button><button class="btn btn-secondary btn-sm" id="w2xCmpGo" onclick="document.getElementById('w2xCmpCard').scrollIntoView({block:'start'})">Compare balances</button></div></div>
      <div class="w2-row"><div class="li-body"><div class="li-title">File settings</div><div class="li-sub" id="w2xSetLine">Branch code ${set.branchCode ? escH(set.branchCode) : 'not set'} · currency name ${set.currencyName ? escH(set.currencyName) : 'left empty'} · first month to export ${escH(mLong(s.start))}</div></div>
        <div class="w2-side"><button class="btn btn-secondary btn-sm" id="w2xSet" onclick="w2Acct.axSettings()">Change</button></div></div>`;
    const preview = s.file.length ? `<div class="grid"><section class="card span-12" id="w2xPreview">${cardHead('table', 'What is in the file', `${plural(jl, 'journal')} · the first ${Math.min(jl, 30)} shown`)}
      ${s.file.slice(0, 30).map(j => `<div class="w2-row" data-w2x-j="${escH(j.number)}"><div class="li-body"><div class="li-title">${escH(j.number)} · ${escH(j.description)}</div><div class="li-sub">${escH(dayText(j.date))} · ${plural(j.lines.length, 'line')}</div>
        <ul class="w2a-fix">${j.lines.slice(0, 40).map(l => `<li><span>${l.code ? escH(l.code) : '<span class="badge warn">No Accurate code</span>'} · ${escH(l.name)}</span><span>${l.amount > 0 ? 'Debit' : 'Credit'} ${money(Math.abs(l.amount))}</span></li>`).join('')}</ul></div></div>`).join('')}</section></div>` : '';
    const chg = changed.length ? `<div class="grid"><section class="card span-12" id="w2xChgCard">${cardHead('triangle-alert', 'Changed after export', 'These months are already in Accurate. Make each correction there by hand, dated in the same month.')}
      ${changed.map(c => `<div class="w2-row" data-w2x-chg="${escH(c.entry)}" data-month="${escH(c.month)}"><div class="li-body"><div class="li-title">${escH(c.description)} · ${escH(dayText(c.date))}</div><div class="li-sub">${escH(c.what)} · ${escH(mLong(c.month))} · correction to enter in Accurate:</div>
        <ul class="w2a-fix">${c.lines.map(l => `<li><span>${l.code ? escH(l.code) : 'no Accurate code'} · ${escH(l.name)}</span><span>${l.amount > 0 ? 'Debit' : 'Credit'} ${money(Math.abs(l.amount))}</span></li>`).join('')}</ul></div></div>`).join('')}
      <div class="w2-bar" style="margin:12px 0 0">${[...new Set(changed.map(c => c.month))].map(M => `<button class="btn btn-secondary btn-sm" data-w2x-fixed="${escH(M)}" onclick="w2Acct.axFixed('${q(M)}')">Fixed in Accurate · ${escH(monthLabel(M))}</button>`).join('')}</div></section></div>` : '';
    const done = expMonths.length ? `<div class="grid"><section class="card span-12" id="w2xDone">${cardHead('square-check', 'Months marked as imported', 'Newest first')}
      ${expMonths.slice().reverse().map(M => { const r = s.exported[M]; return `<div class="w2-row" data-w2x-done="${escH(M)}"><div class="li-body"><div class="li-title">${escH(mLong(M))}</div><div class="li-sub">${escH(whenText(r.at))} · ${r.mode === 'entry' ? 'every entry' : 'one summary journal'} · ${plural(r.entries || 0, 'entry', 'entries')}</div></div>
        <div class="w2-side"><button class="btn btn-ghost btn-sm" data-w2x-back="${escH(M)}" onclick="w2Acct.axBack('${q(M)}')">Not imported after all</button></div></div>`; }).join('')}</section></div>` : '';
    return `${pageHead(title, desc, hideBtn())}<div class="grid">${strip}</div>
      <div class="grid"><section class="card span-12" id="w2xMake">${cardHead('upload', 'Make the file', 'Only locked months, and only months not marked as imported before')}${make}
        <div style="margin-top:16px">${after}</div><div style="margin-top:12px">${note}</div></section></div>${preview}${chg}${cmpCard(b, lastM)}${done}`;
  }
  P.axMode = function (m) { X.mode = m === 'entry' ? 'entry' : 'summary'; renderAll(); };
  P.axTarget = function (M) { X.target = M; renderAll(); };
  P.axMatch = function () { AC.noCode = true; AC.q = ''; setTab('w2-accounts'); };
  function axNames(s) { const a = s.months[0], z = s.months[s.months.length - 1]; return `${a}${z !== a ? '_' + z : ''}-${s.mode === 'entry' ? 'entries' : 'summary'}`; }
  P.axXml = function () {
    const b = B(), s = b && axState(b); if (!s || !s.ok) { toast('The download waits until every check passes'); return false; }
    const set = axSet(b), xml = accurateXml(s.file, { branchCode: String(set.branchCode || '').trim(), currencyName: String(set.currencyName || '').trim(), eximId: Object.keys(s.exported).length + 1 });
    saveFile(`accurate-journals-${axNames(s)}.xml`, cp1252(xml), 'application/xml'); return true;
  };
  P.axJson = function () {
    const b = B(), s = b && axState(b); if (!s || !s.ok) { toast('The download waits until every check passes'); return false; }
    saveFile(`accurate-vouchers-${axNames(s)}.json`, JSON.stringify(vouchersJson(s.file), null, 2) + '\n', 'application/json'); return true;
  };
  let MK = null;
  P.axMark = function () {
    const b = B(), s = b && axState(b); if (!s || !s.months.length) return;
    MK = { months: s.months.slice(), mode: s.mode, count: s.count };
    openSheet({ title: 'Mark as imported', onEnter: () => P.axMarkSave(),
      body: `<p class="muted" style="margin:0 0 12px">Tick this only after Accurate said the import worked. These months will not be offered again:</p>
        <div class="list" id="w2xMarkList">${s.months.map(M => `<div class="list-item"><div class="li-body"><div class="li-title">${escH(mLong(M))}</div><div class="li-sub">${plural(s.count[M] || 0, 'entry', 'entries')} · ${s.mode === 'entry' ? 'every entry' : 'one summary journal'}</div></div></div>`).join('')}</div>
        <p class="help" style="margin-top:12px">The app never writes to Accurate itself. This tick only records what you did there.</p>${errBox('w2xMarkErr')}`,
      foot: sheetFoot('Mark as imported', 'axMarkSave') });
  };
  const axWrite = (fn, why, errId) => change(w => { const a = JSON.parse(JSON.stringify(axSet(w))); a.exported = a.exported || {}; fn(a); bookLib.setSetting(w, 'accurate', a); }, why, errId);
  P.axMarkSave = function () {
    if (!MK) return; const x = MK, at = new Date().toISOString(), before = JSON.parse(JSON.stringify(axSet(B())));
    if (!axWrite(a => { for (const M of x.months) a.exported[M] = { at, mode: x.mode, entries: x.count[M] || 0 }; }, 'accurate-mark', 'w2xMarkErr').ok) return;
    closeTopSheet(true); MK = null;
    toast(`${plural(x.months.length, 'month')} marked as imported`, { action: 'Undo', onAction: () => { if (change(w => bookLib.setSetting(w, 'accurate', before), 'accurate-mark-undo').ok) toast('Undone'); } });
  };
  P.axBack = function (M) {
    const before = JSON.parse(JSON.stringify(axSet(B())));
    if (!axWrite(a => { delete a.exported[M]; }, 'accurate-unmark').ok) return;
    toast(`${mLong(M)} is waiting to be exported again`, { action: 'Undo', onAction: () => { if (change(w => bookLib.setSetting(w, 'accurate', before), 'accurate-unmark-undo').ok) toast('Undone'); } });
  };
  P.axFixed = function (M) {
    const before = JSON.parse(JSON.stringify(axSet(B()))), at = new Date().toISOString();
    if (!axWrite(a => { if (a.exported[M]) a.exported[M] = { ...a.exported[M], at, fixedAt: at }; }, 'accurate-fixed').ok) return;
    toast(`${mLong(M)}: corrections marked as made in Accurate`, { action: 'Undo', onAction: () => { if (change(w => bookLib.setSetting(w, 'accurate', before), 'accurate-fixed-undo').ok) toast('Undone'); } });
  };
  P.axSettings = function () {
    const b = B(), set = axSet(b), start = axStart(b), first = live(b.entries).filter(exportable).reduce((m, e) => (e.date.slice(0, 7) < m ? e.date.slice(0, 7) : m), start);
    const months = []; for (let M = first < start ? first : start, i = 0; M <= curMonth() && i < 600; M = shiftM(M, 1), i++) months.push(M);
    if (!months.includes(start)) months.push(start);
    openSheet({ title: 'File settings', focus: '#w2xBranch', onEnter: () => P.axSettingsSave(),
      body: `<div class="form-grid"><div class="field full"><label class="label" for="w2xBranch">Branch code of your Accurate book</label><input class="input" id="w2xBranch" maxlength="40" autocomplete="off" value="${escH(set.branchCode || '')}">
          <div class="help">Every file Accurate exports (File › Export Import Transaction) starts with BranchCode="…". Copy that number here once.</div></div>
        <div class="field"><label class="label" for="w2xCcy">Currency name in Accurate (optional)</label><input class="input" id="w2xCcy" maxlength="40" autocomplete="off" value="${escH(set.currencyName || '')}"><div class="help">Written on every line when filled in. Leave it empty unless the sandbox test asks for it.</div></div>
        <div class="field"><label class="label" for="w2xFrom">First month to export</label><select class="input" id="w2xFrom">${months.sort().map(M => opt(M, mLong(M), start)).join('')}</select><div class="help">Months before it came from Accurate and are never sent back.</div></div>${errBox('w2xSetErr')}</div>`,
      foot: sheetFoot('Save', 'axSettingsSave') });
  };
  P.axSettingsSave = function () {
    const branch = el('w2xBranch').value.trim(), ccy = el('w2xCcy').value.trim(), from = el('w2xFrom').value;
    if (/[<>"&]/.test(branch)) { showErr('w2xSetErr', 'The branch code is a number or short code, without < > " or &'); return; }
    if (!axWrite(a => { a.branchCode = branch; a.currencyName = ccy; if (validMonth(from)) a.from = from; }, 'accurate-settings', 'w2xSetErr').ok) return;
    closeTopSheet(true); toast('File settings saved');
  };

  /* ── Compare balances ── */
  // "1.234.567", "1,234,567.00", "(1.000)", "-1000", "Rp 1.000" → whole rupiah, or NaN.
  function parseAmount(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/^"|"$/g, '').replace(/rp\.?/i, '').replace(/\s+/g, ''), neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1); } else if (/[-−]$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (!/^\d[\d.,]*$/.test(s)) return NaN;
    const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
    let dec = '';
    if (dots && commas) dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    else if (dots + commas === 1) { const c = dots ? '.' : ',', tail = s.length - s.indexOf(c) - 1; if (tail !== 3) dec = c; }
    const n = dec ? parseFloat(s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.')) : parseFloat(s.replace(/[.,]/g, ''));
    return isNaN(n) ? NaN : Math.round(neg ? -n : n);
  }
  // One account per line: the code first, the balance last, separated by a comma, semicolon or tab.
  function parseBalances(text) {
    const rows = [], skipped = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const f = (/[;\t]/.test(line) ? line.split(/[;\t]/) : line.split(',')).map(x => x.trim()), code = (f[0] || '').replace(/^"|"$/g, '');
      let amount = NaN;
      if (/[;\t]/.test(line)) { for (let i = f.length - 1; i >= 1 && isNaN(amount); i--) if (f[i] !== '') amount = parseAmount(f[i]); }
      else for (let i = 1; i < f.length && isNaN(amount); i++) amount = parseAmount(f.slice(i).join(','));
      if (!code || isNaN(amount)) { skipped.push(line.trim().slice(0, 60)); continue; }
      rows.push({ code, amount });
    }
    return { rows, skipped };
  }
  // Each Accurate code: the app's balance on the date beside the figure from the list.
  function compareBalances(b, date, list, sign) {
    const bal = bookLib.balances(b, date), app = new Map(), nocode = [], out = [];
    for (const a of live(b.accounts)) {
      if (a.header) continue; const raw = bal[a.id] || 0, v = sign === 'raw' ? raw : natural(a, raw);
      if (!a.accurateCode) { if (raw) nocode.push({ code: '', name: a.name, app: v, file: null, diff: v, status: 'No Accurate code yet' }); continue; }
      const x = app.get(a.accurateCode) || { names: [], amount: 0 }; x.names.push(a.name); x.amount += v; app.set(a.accurateCode, x);
    }
    const file = new Map(); for (const r of list) file.set(r.code, (file.get(r.code) || 0) + r.amount);
    for (const [code, v] of file) { const x = app.get(code); out.push(x ? { code, name: x.names.join(' + '), app: x.amount, file: v, diff: v - x.amount, status: v === x.amount ? 'Matches' : 'Differs' } : { code, name: '', app: null, file: v, diff: v, status: 'Not in the app' }); }
    for (const [code, x] of app) if (!file.has(code) && x.amount) out.push({ code, name: x.names.join(' + '), app: x.amount, file: null, diff: -x.amount, status: 'Not in the list' });
    out.push(...nocode);
    return out.sort((p, r) => (p.status === 'Matches') - (r.status === 'Matches') || cmpCode(p.code, r.code) || String(p.name).localeCompare(String(r.name)));
  }
  function cmpCard(b, lastM) {
    const c = X.cmp; if (!validDay(c.date)) c.date = lastM ? monthEnd(lastM) : addDays(mStart(today()), -1);
    let res = '';
    if (c.rows) {
      const nOk = c.rows.filter(r => r.status === 'Matches').length, nBad = c.rows.length - nOk, cellA = v => (v == null ? '<span class="faint">—</span>' : money(v));
      const badge = r => `<span class="badge ${r.status === 'Matches' ? 'good' : 'bad'}">${escH(r.status)}</span>`;
      res = `<p class="help" id="w2xCmpSum" data-ok="${nOk}" data-bad="${nBad}" style="margin:14px 0 8px">${plural(nOk, 'account')} ${nOk === 1 ? 'matches' : 'match'}, ${nBad} ${nBad === 1 ? 'differs' : 'differ'} on ${escH(dayText(c.date))}.${c.skipped ? ` ${plural(c.skipped, 'line')} could not be read and ${c.skipped === 1 ? 'was' : 'were'} left out.` : ''}</p>
        ${c.rows.length ? `<div class="table-wrap hide-sm"><table class="data w2a-t" id="w2xCmpTable"><thead><tr><th scope="col">Accurate code</th><th scope="col">Account in the app</th><th scope="col" class="num">In the app</th><th scope="col" class="num">In Accurate</th><th scope="col" class="num">Difference</th><th scope="col">Result</th></tr></thead><tbody>
          ${c.rows.map(r => `<tr data-w2x-cmp="${escH(r.code)}" data-status="${escH(r.status)}" data-diff="${r.diff}"><td>${escH(r.code || '—')}</td><td class="w2a-name">${escH(r.name || '—')}</td><td class="num">${cellA(r.app)}</td><td class="num">${cellA(r.file)}</td><td class="num">${r.diff ? money(r.diff) : ''}</td><td>${badge(r)}</td></tr>`).join('')}</tbody></table></div>
          <div class="only-sm"><div class="list">${c.rows.map(r => `<div class="list-item" data-w2x-cmp="${escH(r.code)}"><div class="li-body"><div class="li-title">${escH(r.code || '—')} · ${escH(r.name || 'not in the app')}</div><div class="li-sub">App ${cellA(r.app)} · Accurate ${cellA(r.file)}${r.diff ? ` · difference ${money(r.diff)}` : ''}</div></div>${badge(r)}</div>`).join('')}</div></div>` : emptyHTML('inbox', 'No line of the list could be read')}`;
    }
    return `<div class="grid"><section class="card span-12" id="w2xCmpCard">${cardHead('scale', 'Compare balances', 'After an import: check that Accurate and the app show the same balance per account')}
      <div class="w2-bar" style="margin-bottom:10px"><label class="w2a-lbl">Balances on<input class="input" type="date" id="w2xCmpDate" value="${escH(c.date)}" max="2100-12-31"></label>
        <select class="input" id="w2xCmpSign" aria-label="How the list shows debts and income">${opt('pos', 'The list shows debts, equity and income as positive', c.sign)}${opt('raw', 'The list shows credit balances as negative', c.sign)}</select></div>
      <label class="label" for="w2xCmpText">Paste Accurate’s balance list: one account per line, the account code first and the balance last, separated by a comma, semicolon or tab</label>
      <textarea class="input w2a-area" id="w2xCmpText" spellcheck="false" placeholder="110.001; 12.500.000">${escH(c.text)}</textarea>
      <div class="w2-bar" style="margin:10px 0 0"><button class="btn btn-primary btn-sm" id="w2xCmpRun" onclick="w2Acct.cmpRun()">Compare</button>
        <button class="btn btn-secondary btn-sm" id="w2xCmpLoad" onclick="document.getElementById('w2xCmpFile').click()">${ic('upload', 's16')}Load a list</button>
        <input type="file" id="w2xCmpFile" accept=".csv,.txt,text/csv,text/plain" style="display:none" onchange="w2Acct.cmpLoad(this)">
        ${c.rows ? '<button class="btn btn-ghost btn-sm" id="w2xCmpClear" onclick="w2Acct.cmpClear()">Clear</button>' : ''}</div>${res}</section></div>`;
  }
  P.cmpRun = function () {
    const b = B(), c = X.cmp; if (!b) return;
    const date = el('w2xCmpDate').value; c.text = el('w2xCmpText').value; c.sign = el('w2xCmpSign').value === 'raw' ? 'raw' : 'pos';
    if (!validDay(date)) { toast('Choose the date of the balances'); return; }
    c.date = date;
    const p = parseBalances(c.text);
    if (!p.rows.length) { c.rows = null; toast('Paste or load the list first: one account per line, code then balance'); return; }
    c.rows = compareBalances(b, date, p.rows, c.sign); c.skipped = p.skipped.length; renderAll();
    const card = el('w2xCmpCard'); if (card) card.scrollIntoView({ block: 'start' });
  };
  P.cmpLoad = function (input) {
    const f = input && input.files && input.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { el('w2xCmpText').value = String(r.result || ''); P.cmpRun(); };
    r.onerror = () => toast('That file could not be read');
    r.readAsText(f);
  };
  P.cmpClear = function () { X.cmp.rows = null; X.cmp.text = ''; X.cmp.skipped = 0; renderAll(); };

  // The pure parts, for the tests and for anything that wants the same file without the page.
  P.lib = { accurateXml, cp1252, vouchersJson, parseAmount, parseBalances, compareBalances, axMonths, axJournals, axFile, axChecks, axChanged, axState, cmpAsOf, cmpRange };

  registerPage({ key: 'w2-reports', label: 'Reports', icon: 'scale', group: 'w2', order: 90, render: renderReports });
  registerPage({ key: 'w2-accounts', label: 'Accounts chart', icon: 'list-tree', group: 'w2', order: 91, render: renderAccounts });
  registerPage({ key: 'w2-audit', label: 'Audit', icon: 'history', group: 'w2', order: 92, render: renderAudit });
  registerPage({ key: 'w2-accurate', label: 'Accurate export', icon: 'upload', group: 'w2', order: 93, render: renderAccurate });
})();
