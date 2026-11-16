/* ExpenseTrack v6 — the new book's round-1 pages (docs/v6-book.md §7): Spending · actual (w2-rows),
   People (w2-people), Net worth (w2-networth) and Journals (w2-journals), in the menu group "w2".

   Every figure comes from the new book through bookLib; every change goes through book2Do (the
   store saves it and draws the page again). Read-only towards everything old (§0): this file never
   writes STATE, never calls scheduleDriveSave() or a mutating ledger* function and registers no
   transform. It reads ALL_TRANSACTIONS only to show a row's original category. Plain words on every
   page; debit and credit appear on Journals only. No personal data in this file: the repo is public. */
(function () {
  'use strict';
  if (typeof bookLib === 'undefined' || typeof BOOK2 !== 'function' || typeof book2Do !== 'function' || typeof registerPage !== 'function') {
    console.warn('ExpenseTrack preview: the new book store is not loaded, so its pages stay off.');
    return;
  }
  const P = window.w2Pages = {};

  /* ── Small helpers ── */
  const B = () => BOOK2();
  const cp = o => JSON.parse(JSON.stringify(o));
  const p2 = n => String(n).padStart(2, '0');
  const errText = e => (e && Array.isArray(e.errors) && e.errors.length ? e.errors.join(' · ') : String((e && e.message) || e));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const curMonth = () => today().slice(0, 7);
  const shiftM = (M, k) => { let [y, m] = M.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${p2(m)}`; };
  const monthsBetween = (a, b) => { const out = []; for (let M = a, i = 0; M <= b && i < 600; M = shiftM(M, 1), i++) out.push(M); return out; };
  const monthEnd = M => { const [y, m] = M.split('-').map(Number); return `${M}-${p2(new Date(y, m, 0).getDate())}`; };
  const validDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(new Date(d + 'T00:00:00').getTime());
  const dayText = iso => { try { return fmtDayLong(new Date(String(iso).slice(0, 10) + 'T00:00:00')); } catch (_) { return String(iso || ''); } };
  const whenText = iso => { try { return fmtDateTime(iso); } catch (_) { return String(iso || ''); } };
  const daysSince = iso => Math.max(0, Math.round((new Date(today() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000));
  const money = n => `<span class="amt">${fmtIDR(n)}</span>`;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const el = id => document.getElementById(id);
  const q = s => escAttr(s);
  const live = o => Object.values(o || {}).filter(x => x && !x.deleted);
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const rpInput = (id, val, attrs) => `<div class="input-affix"><span class="affix">Rp</span><input class="input" id="${id}" inputmode="numeric" autocomplete="off" value="${val == null ? '' : escH(Math.round(val).toLocaleString('id-ID'))}" ${attrs || ''}></div>`;
  // The whole-rupiah amount typed in a field: a number above zero, else null.
  const rpOf = id => { const n = meParse(el(id) ? el(id).value : ''); return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null; };
  function showErr(id, msg) { const b = el(id); if (!b) { toast(msg); return; } b.style.display = msg ? '' : 'none'; b.querySelector('span').textContent = msg || ''; }
  const errBox = id => `<div class="help err full" id="${id}" role="alert" style="display:none">${ic('triangle-alert', 's16')}<span></span></div>`;
  const sheetFoot = (label, fn, cls) => `<button class="btn btn-secondary" onclick="closeTopSheet(true)">Cancel</button><button class="btn ${cls || 'btn-primary'}" id="w2Save" onclick="w2Pages.${fn}()">${escH(label)}</button>`;
  function stepper(months, cur, fn) {
    const i = months.indexOf(cur);
    return `<div class="cm-month" role="group" aria-label="Month">
      <button class="icon-btn sm" id="w2Prev" onclick="w2Pages.${fn}(-1)" aria-label="Previous month"${i <= 0 ? ' disabled' : ''}>${ic('chevron-left', 's16')}</button>
      <span class="lbl" id="w2Month" data-month="${escH(cur)}">${escH(monthLabel(cur, true))}</span>
      <button class="icon-btn sm" id="w2Next" onclick="w2Pages.${fn}(1)" aria-label="Next month"${i < 0 || i >= months.length - 1 ? ' disabled' : ''}>${ic('chevron-right', 's16')}</button></div>`;
  }
  const kpi = (id, label, value, sub, v) => `<div class="card kpi span-4" id="${id}" data-v="${v}"><span class="kpi-label">${escH(label)}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></div>`;

  // Layout only: spacing and wrapping built from the existing tokens. No colours, fonts or icons added.
  if (!el('w2PagesStyle')) {
    const st = document.createElement('style'); st.id = 'w2PagesStyle';
    st.textContent = `
      .w2-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:16px}
      .w2-bar .grow{flex:1 1 0;min-width:0}
      .w2-bar .input{height:36px;width:auto;min-width:0;max-width:100%}
      .w2-row{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border)}
      .w2-row:first-child{border-top:none}
      .w2-row .li-body{flex:1 1 180px}
      .w2-side{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;font-size:14px}
      .w2-side b{font-weight:600;white-space:nowrap}
      .w2-group{display:flex;justify-content:space-between;gap:12px;padding:16px 0 6px}
      .w2-group:first-child{padding-top:0}
      .w2-link{font-size:14px;font-weight:500;text-align:left;overflow-wrap:anywhere}
      .w2-link:hover{color:var(--accent-text)}
      .w2-dim{opacity:.55}
      .w2-jl{display:grid;grid-template-columns:minmax(0,1fr) 112px 112px;gap:2px 12px;font-size:13px;line-height:20px;min-width:0}
      .w2-jl .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
      .w2-jl .h{color:var(--text-3);font-size:12px}
      .w2-jl span{min-width:0;overflow-wrap:anywhere}
      table.data td.w2-top{vertical-align:top;padding-top:12px;padding-bottom:12px;height:auto}
      table.data.w2-moves th,table.data.w2-moves td{padding-left:10px;padding-right:10px}
      table.data.w2-moves td.w2-what{padding-top:8px;padding-bottom:8px;overflow-wrap:anywhere}
      .w2-pad{padding:0 var(--card-pad) var(--card-pad)}
      .w2-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;white-space:nowrap;font-size:14px}
      .w2-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;margin-bottom:16px}
      .w2-facts dd{font-size:14px;font-weight:500;margin-top:2px;overflow-wrap:anywhere}
      @media (max-width:767px){
        .w2-bar .input{flex:1 1 130px}
        .w2-jl{grid-template-columns:minmax(0,1fr) auto auto;gap:2px 10px}
        .w2-side{margin-left:0;justify-content:flex-start;flex:1 1 100%}
      }`;
    document.head.appendChild(st);
  }
  if (typeof registerIcon === 'function') registerIcon('users', '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>');

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

  /* ── The book, read ── */
  const acc = id => { const b = B(); return (b && b.accounts[id]) || null; };
  const accName = id => { const a = acc(id); return a ? a.name : String(id); };
  const personName = id => { const b = B(), p = b && b.people && b.people[id]; return p ? p.name : 'Someone'; };
  const isMoneyAcc = a => !!a && (a.kind === 'asset' || a.kind === 'liability') && a.role !== 'receivable' && a.role !== 'payable';
  // The line of an entry on the bank, card or cash account the money moved through.
  const moneyLine = e => (e.lines || []).find(l => isMoneyAcc(acc(l.account))) || (e.lines || []).find(l => l.amount < 0) || null;
  const usable = a => !!a && !a.header && !a.hidden && !a.deleted;
  function payAccounts() {
    const all = live(B().accounts).filter(usable), main = all.filter(a => ['bank', 'cash', 'ewallet'].includes(a.role));
    return (main.length ? main : all.filter(isMoneyAcc)).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }) || byName(a, b));
  }
  const accountField = (id, label) => { const list = payAccounts(); return `<div class="field full"><label class="label" for="${id}">${escH(label)}</label><select class="input" id="${id}">${list.map(a => `<option value="${escH(a.id)}">${escH(a.name)}</option>`).join('')}</select>${list.length ? '' : '<div class="help">Add a bank or cash account in your book first.</div>'}</div>`; };
  const dateField = (id, label) => `<div class="field"><label class="label" for="${id}">${escH(label)}</label><input class="input" type="date" id="${id}" value="${today()}" max="2100-12-31"></div>`;

  // Person picker with "add new": a select of the people in the book, and a name + type when new.
  function personPicker(prefer, chosen) {
    const ps = live(B().people).sort((a, b) => (prefer ? (b.type === prefer) - (a.type === prefer) : 0) || byName(a, b));
    const isNew = !ps.length;
    return `<div class="field full"><label class="label" for="w2pSel">Who</label><select class="input" id="w2pSel" onchange="w2Pages.pSel()">
        ${ps.map(p => `<option value="${escH(p.id)}"${p.id === chosen ? ' selected' : ''}>${escH(p.name)}${p.type === 'company' ? ' (company)' : ''}</option>`).join('')}<option value="__new"${isNew ? ' selected' : ''}>Add someone new…</option></select></div>
      <div class="field" id="w2pNameBox"${isNew ? '' : ' style="display:none"'}><label class="label" for="w2pName">Name</label><input class="input" id="w2pName" maxlength="60" autocomplete="off"></div>
      <div class="field" id="w2pTypeBox"${isNew ? '' : ' style="display:none"'}><label class="label" for="w2pType">Person or company</label><select class="input" id="w2pType"><option value="person"${prefer === 'company' ? '' : ' selected'}>Person</option><option value="company"${prefer === 'company' ? ' selected' : ''}>Company</option></select></div>`;
  }
  P.pSel = function () { const n = el('w2pSel').value === '__new'; el('w2pNameBox').style.display = n ? '' : 'none'; el('w2pTypeBox').style.display = n ? '' : 'none'; if (n) el('w2pName').focus(); };
  // → {id} for someone in the book, {name, type} for someone new; throws a plain message when empty.
  function pickedPerson() {
    const v = el('w2pSel').value;
    if (v !== '__new') return { id: v };
    const name = el('w2pName').value.trim();
    if (!name) throw new Error('Enter a name');
    return { name, type: el('w2pType').value === 'company' ? 'company' : 'person' };
  }
  const personIn = (w, pick) => pick.id || bookLib.addPerson(w, { name: pick.name, type: pick.type });
  // Runs a change; on a refusal shows the engine's own message in the sheet and returns false.
  function change(fn, why, errId) {
    try { return { ok: true, value: book2Do(fn, why) }; }
    catch (e) { showErr(errId, errText(e)); return { ok: false }; }
  }
  const undoPost = id => () => { try { book2Do(w => bookLib.voidEntry(w, id, 'Undone'), 'undo'); toast('Undone'); } catch (e) { toast(errText(e)); } };

  /* ════════════════ Spending · actual (w2-rows) ════════════════ */
  const R = { month: null };
  const ANSWER = {
    'paid-for': { label: 'Paid for someone', icon: 'circle-user', badge: n => 'Owed by ' + n, why: 'Paid for someone' },
    split: { label: 'Split with someone', icon: 'split', badge: n => 'Split · ' + n, why: 'Split with someone' },
    reimburse: { label: 'Company will reimburse', icon: 'landmark', badge: n => 'Reimburse · ' + n, why: 'Company will reimburse' },
    lent: { label: 'Lent', icon: 'arrow-left-right', badge: n => 'Lent to ' + n, why: 'Lent' }
  };
  const emailEntries = b => live(b.entries).filter(e => e.status === 'posted' && e.source && e.source.type === 'email');
  function txMap() {
    const m = {};
    if (typeof ALL_TRANSACTIONS !== 'undefined' && Array.isArray(ALL_TRANSACTIONS)) for (const t of ALL_TRANSACTIONS) if (t && t.id != null) m['tx:' + t.id] = t;
    return m;
  }
  const expenseLine = (b, lines) => (lines || []).find(l => (b.accounts[l.account] || {}).kind === 'expense');
  const catOfLine = (b, l) => { const a = l && b.accounts[l.account]; return a ? (a.category || a.name) : ''; };
  // The category a row had as plain spending: its own expense line, else the email row, else its history.
  function originalCategory(b, e, tx) {
    const now = catOfLine(b, expenseLine(b, e.lines)); if (now) return now;
    const t = (tx || txMap())[e.source && e.source.ref]; if (t && t.category) return String(t.category);
    for (const h of (e.history || []).slice().reverse()) { const c = h && h.before && catOfLine(b, expenseLine(b, h.before.lines)); if (c) return c; }
    return 'Others';
  }
  function rowInfo(b, e, tx) {
    const m = moneyLine(e), amount = m ? -m.amount : 0;
    const recv = e.lines.filter(l => (b.accounts[l.account] || {}).role === 'receivable');
    const notMine = recv.reduce((s, l) => s + l.amount, 0);
    const who = [...new Set(recv.map(l => personName((b.accounts[l.account] || {}).person)))].join(', ');
    return { e, amount, notMine, who, answered: !!ANSWER[e.kind], category: originalCategory(b, e, tx) };
  }
  function rowsMonths(b) {
    const cur = curMonth(), from = String((b.settings || {}).syncFrom || '').slice(0, 7) || cur;
    const last = emailEntries(b).reduce((m, e) => (e.date.slice(0, 7) > m ? e.date.slice(0, 7) : m), cur);
    return monthsBetween(from <= last ? from : last, last);
  }
  function rowBadge(r) { const a = ANSWER[r.e.kind]; return a ? `<span class="badge accent" data-w2-badge>${escH(a.badge(r.who || 'someone'))}</span>` : ''; }
  const rowMenuBtn = r => r.amount > 0 ? `<button class="icon-btn sm" data-w2-menu="${escH(r.e.id)}" onclick="w2Pages.rowMenu(this,'${q(r.e.id)}')" aria-label="More for ${escH(r.e.description || 'this row')}" aria-haspopup="menu">${ic('ellipsis', 's16')}</button>` : '';
  function renderRows() {
    const title = 'Spending · actual', desc = 'What you really spent: your email rows, minus what was not yours.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), months = rowsMonths(b), tx = txMap(), all = emailEntries(b);
    if (!R.month || !months.includes(R.month)) R.month = months.slice().reverse().find(m => all.some(e => e.date.slice(0, 7) === m)) || months[months.length - 1];
    const M = R.month;
    // An email row the Inbox turned into a move between two of your own accounts (the statement
    // paired it) is not spending and is not listed; one line under the list says how many.
    const isMove = e => e.kind === 'transfer' || e.kind === 'card-payment';
    const moved = all.filter(e => e.date.slice(0, 7) === M && isMove(e)).length;
    const rows = all.filter(e => e.date.slice(0, 7) === M && !isMove(e)).map(e => rowInfo(b, e, tx)).sort((x, y) => (x.e.date < y.e.date ? 1 : x.e.date > y.e.date ? -1 : String(x.e.description).localeCompare(String(y.e.description))));
    const fromEmails = rows.reduce((s, r) => s + r.amount, 0), notMine = rows.reduce((s, r) => s + r.notMine, 0), nNot = rows.filter(r => r.notMine > 0).length;
    // Statement lines with no email, answered in the Inbox: what they put on spending accounts in
    // the month, minus what the email rows of that month already hold there (nothing, normally).
    const stmtEntries = live(b.entries).filter(e => e.status === 'posted' && e.source && e.source.type === 'stmt' && e.date.slice(0, 7) === M);
    const isSpend = l => { const a = b.accounts[l.account]; return !!a && a.kind === 'expense' && a.role !== 'unexplained'; };
    const onStmt = stmtEntries.reduce((s, e) => s + e.lines.filter(isSpend).reduce((t, l) => t + l.amount, 0), 0), nStmt = stmtEntries.filter(e => e.lines.some(isSpend)).length;
    const actual = bookLib.actualSpending(b, M).total, other = actual - (fromEmails + onStmt - notMine);
    const cell = (id, label, v, shown, sub) => `<div class="strip-cell" id="${id}" data-v="${v}"><span class="eyebrow">${label}</span><span class="strip-val">${shown}</span><span class="strip-sub">${sub}</span></div>`;
    const strip = `<section class="card strip span-12" id="w2rStrip" aria-label="Actual spending" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      ${cell('w2rFrom', 'From emails', fromEmails, money(fromEmails), plural(rows.length, 'row'))}
      ${cell('w2rStmt', '+ on statements, no email', onStmt, `<span class="amt">${onStmt < 0 ? '−' : onStmt ? '+' : ''}${fmtIDR(Math.abs(onStmt))}</span>`, nStmt ? plural(nStmt, 'line') + ' answered in the Inbox' : 'Nothing answered yet')}
      ${cell('w2rNot', 'Not my spending', notMine, `<span class="amt">${notMine ? '−' : ''}${fmtIDR(notMine)}</span>`, nNot ? plural(nNot, 'row') + ' owed back to you' : 'Nothing marked yet')}
      ${cell('w2rActual', 'Actual spending', actual, money(actual), escH(monthLabel(M, true)))}</section>`;
    const from = String((b.settings || {}).syncFrom || ''), counts = typeof book2Counts === 'function' ? book2Counts() : null;
    const notes = [from ? `Rows before ${escH(dayText(from))} are not shown here. They are already in your copied history.` : '',
      other ? `Actual spending also includes ${money(other)} that did not come from an email row (for example an amount written off).` : '',
      moved ? `${plural(moved, 'email row')} ${moved === 1 ? 'was a move' : 'were moves'} between your own accounts and ${moved === 1 ? 'is' : 'are'} not listed.` : '',
      counts && counts.waiting ? `${plural(counts.waiting, 'row')} from a bank that is not linked yet ${counts.waiting === 1 ? 'is' : 'are'} waiting. <button class="btn btn-ghost btn-sm" onclick="setTab('w2-start')">Link it on Start here</button>` : ''].filter(Boolean);
    const table = `<div class="table-wrap hide-sm"><table class="data" id="w2rTable"><thead><tr><th scope="col">Date</th><th scope="col">Merchant</th><th scope="col">Category</th><th scope="col" class="num">Amount</th><th scope="col">Whose</th><th scope="col"><span class="sr-only">More</span></th></tr></thead><tbody>
      ${rows.map(r => `<tr data-w2-row="${escH(r.e.id)}" data-ref="${escH(r.e.source.ref || '')}" data-kind="${escH(r.e.kind)}"><td class="${r.notMine >= r.amount ? 'w2-dim' : ''}" style="white-space:nowrap">${escH(fmtDay(new Date(r.e.date + 'T00:00:00')))}</td>
        <td class="merchant${r.notMine >= r.amount ? ' w2-dim' : ''}"><span class="merchant-name">${escH(r.e.description || '—')}</span></td><td class="${r.notMine >= r.amount ? 'w2-dim' : ''}">${catChip(r.category)}</td>
        <td class="num${r.notMine >= r.amount ? ' w2-dim' : ''}">${money(r.amount)}</td><td>${rowBadge(r) || '<span class="faint">Mine</span>'}${r.e.kind === 'split' ? ` <span class="li-sub">your part ${money(r.amount - r.notMine)}</span>` : ''}</td><td class="num">${rowMenuBtn(r)}</td></tr>`).join('')}</tbody></table></div>`;
    const list = `<div class="only-sm w2-pad"><div class="list" id="w2rList">${rows.map(r => `<div class="list-item" data-w2-row="${escH(r.e.id)}" data-kind="${escH(r.e.kind)}"><div class="li-body${r.notMine >= r.amount ? ' w2-dim' : ''}"><div class="li-title">${escH(r.e.description || '—')}</div>
        <div class="li-sub">${escH(fmtDay(new Date(r.e.date + 'T00:00:00')))} · ${escH(r.category)}${r.e.kind === 'split' ? ` · your part ${money(r.amount - r.notMine)}` : ''}</div>${rowBadge(r) ? `<div style="margin-top:4px">${rowBadge(r)}</div>` : ''}</div>
        <span class="w2-right">${money(r.amount)}</span>${rowMenuBtn(r)}</div>`).join('')}</div></div>`;
    const body = rows.length ? table + list : emptyHTML('inbox', Object.values((b.settings || {}).bankMap || {}).some(Boolean) ? 'No email rows in this month' : 'No rows yet. Link your banks on Start here first.', 'Open Start here', "setTab('w2-start')");
    return `${pageHead(title, desc, hideBtn())}
      <div class="w2-bar">${stepper(months, M, 'rowsStep')}</div>
      <div class="grid">${strip}</div>
      <div class="grid"><section class="card flush span-12" id="w2rCard">${cardHead('receipt', 'Rows from your bank emails', `${escH(monthLabel(M, true))} · use the ⋯ on a row when it was not your own spending`)}${body}
        ${notes.length ? `<div class="w2-pad">${notes.map(n => `<p class="help" style="margin-top:8px">${n}</p>`).join('')}</div>` : ''}</section></div>`;
  }
  P.rowsStep = function (d) { const ms = rowsMonths(B()), i = ms.indexOf(R.month) + d; if (i >= 0 && i < ms.length) { R.month = ms[i]; renderAll(); } };
  P.rowMenu = function (btn, id) {
    const e = B().entries[id]; if (!e) return;
    const items = [{ heading: 'Not my spending' }, ...Object.keys(ANSWER).map(k => ({ label: ANSWER[k].label, icon: ANSWER[k].icon, checked: e.kind === k ? true : undefined, onSelect: () => P.answer(id, k) }))];
    if (ANSWER[e.kind]) items.push({ divider: true }, { label: 'Mine again', icon: 'repeat', onSelect: () => P.mine(id) });
    openMenu(btn, { title: e.description || 'This row', items });
  };
  let A = null;
  P.answer = function (id, kind) {
    const b = B(), e = b.entries[id], m = e && moneyLine(e); if (!e || !m || !ANSWER[kind]) return;
    const amount = -m.amount, recv = e.lines.find(l => (b.accounts[l.account] || {}).role === 'receivable'), chosen = recv ? b.accounts[recv.account].person : null;
    A = { id, kind, amount };
    const text = { 'paid-for': 'They owe you the whole amount. It leaves your spending.', split: 'Your own part stays in your spending. The rest is owed to you.',
      reimburse: 'The company owes you the whole amount. It leaves your spending.', lent: 'It is a loan, not spending. They owe you the whole amount.' }[kind];
    openSheet({ title: ANSWER[kind].label, focus: '#w2pSel', onEnter: () => P.answerSave(),
      body: `<p class="muted" style="margin:0 0 14px">${escH(e.description || 'This row')} · ${escH(dayText(e.date))} · ${money(amount)}<br>${escH(text)}</p>
        <div class="form-grid">${personPicker(kind === 'reimburse' ? 'company' : '', chosen)}
        ${kind === 'split' ? `<div class="field full"><label class="label" for="w2aShare">Your own part</label>${rpInput('w2aShare', Math.floor(amount / 2), 'oninput="w2Pages.shareHint()"')}<div class="help" id="w2aRest"></div></div>` : ''}
        ${errBox('w2aErr')}</div>`,
      foot: sheetFoot('Save', 'answerSave') });
    if (kind === 'split') setTimeout(P.shareHint, 0);
  };
  P.shareHint = function () {
    const box = el('w2aRest'); if (!box || !A) return;
    const n = meParse(el('w2aShare').value), ok = typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < A.amount;
    box.innerHTML = ok ? `The other person owes you ${money(A.amount - n)}.` : `Enter a whole amount below ${money(A.amount)}.`;
  };
  function undoAnswer(id, before) {
    return () => { try { book2Do(w => bookLib.edit(w, id, { kind: before.kind, lines: before.lines }, 'Undo'), 'undo'); toast('Undone'); } catch (e) { toast(errText(e)); } };
  }
  P.answerSave = function () {
    if (!A) return;
    const b = B(), e = b.entries[A.id], m = e && moneyLine(e); if (!e || !m) return;
    let pick, share = null;
    try { pick = pickedPerson(); } catch (x) { showErr('w2aErr', x.message); return; }
    if (A.kind === 'split') {
      const n = meParse(el('w2aShare').value);
      if (!(typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < A.amount)) { showErr('w2aErr', 'Your own part must be a whole amount below ' + fmtIDR(A.amount)); return; }
      share = n;
    }
    const before = { kind: e.kind, lines: cp(e.lines) }, kind = A.kind, amount = A.amount, cat = originalCategory(b, e);
    // Same entry, same source: the spending sync keeps an answered row and only follows its amount and date.
    const r = change(w => {
      const d = { date: e.date, amount, account: m.account, dir: 'out', person: personIn(w, pick), description: e.description, source: e.source };
      if (m.fx) d.fx = m.fx;
      if (kind === 'split') { d.share = share; d.category = cat; }
      const n = bookLib.buildEntry(w, kind, d);
      bookLib.edit(w, e.id, { kind: n.kind, lines: n.lines }, ANSWER[kind].why);
    }, 'answer', 'w2aErr');
    if (!r.ok) return;
    closeTopSheet(true); A = null;
    toast(`${ANSWER[kind].label}: ${fmtIDR(kind === 'split' ? amount - share : amount)} left your spending`, { action: 'Undo', onAction: undoAnswer(e.id, before) });
  };
  P.mine = function (id) {
    const b = B(), e = b.entries[id], m = e && moneyLine(e); if (!e || !m) return;
    const before = { kind: e.kind, lines: cp(e.lines) }, cat = originalCategory(b, e);
    try {
      book2Do(w => {
        const d = { date: e.date, amount: Math.abs(m.amount), account: m.account, dir: m.amount < 0 ? 'out' : 'in', category: cat, description: e.description, source: e.source };
        if (m.fx) d.fx = m.fx;
        bookLib.edit(w, e.id, { kind: 'spending', lines: bookLib.buildEntry(w, 'spending', d).lines }, 'Mine again');
      }, 'mine-again');
      toast('Counted as your spending again', { action: 'Undo', onAction: undoAnswer(e.id, before) });
    } catch (x) { toast(errText(x)); }
  };

  /* ════════════════ People (w2-people) ════════════════ */
  const PP = { settled: false };
  function peopleData(b) {
    const list = bookLib.people(b), cut = new Date(today() + 'T00:00:00'); cut.setDate(cut.getDate() - 60);
    const cutIso = `${cut.getFullYear()}-${p2(cut.getMonth() + 1)}-${p2(cut.getDate())}`;
    let owed = 0, nOwed = 0, owe = 0, nOwe = 0, old = 0, nOld = 0;
    for (const p of list) {
      if (p.owedToYou > 0) { owed += p.owedToYou; nOwed++; }
      if (p.youOwe > 0) { owe += p.youOwe; nOwe++; }
      const o = p.items.filter(i => i.side === 'receivable' && i.date < cutIso).reduce((s, i) => s + i.open, 0);
      if (o > 0) { old += o; nOld++; }
    }
    return { list, owed, nOwed, owe, nOwe, old, nOld, open: list.filter(p => p.owedToYou || p.youOwe), settled: list.filter(p => !p.owedToYou && !p.youOwe) };
  }
  function personRow(p) {
    const company = p.type === 'company' ? ' <span class="badge">company</span>' : '', id = q(p.person);
    const age = p.oldestDate ? `${plural(p.items.length, 'open item')} · oldest ${plural(daysSince(p.oldestDate), 'day')}` : 'Nothing open';
    const sides = [];
    if (p.owedToYou > 0) sides.push(`<span>owes you <b>${money(p.owedToYou)}</b></span><button class="btn btn-secondary btn-sm" data-w2-act="repaid-in" onclick="w2Pages.repaid('${id}','in')">Got repaid</button>`);
    if (p.owedToYou < 0) sides.push(`<span>paid you <b>${money(-p.owedToYou)}</b> too much</span>`);
    if (p.youOwe > 0) sides.push(`<span>you owe <b>${money(p.youOwe)}</b></span><button class="btn btn-secondary btn-sm" data-w2-act="repaid-out" onclick="w2Pages.repaid('${id}','out')">I repaid</button>`);
    if (p.youOwe < 0) sides.push(`<span>you paid <b>${money(-p.youOwe)}</b> too much</span>`);
    return `<div class="w2-row" data-w2-person="${escH(p.person)}" data-name="${escH(p.name)}" data-owes="${p.owedToYou}" data-owe="${p.youOwe}"><div class="li-body"><div class="li-title">${escH(p.name)}${company}</div><div class="li-sub">${escH(age)}</div></div>
      <div class="w2-side">${sides.join('') || '<span class="faint">Settled</span>'}<button class="btn btn-ghost btn-sm" data-w2-act="open" onclick="w2Pages.person('${id}')">Open</button></div></div>`;
  }
  function renderPeople() {
    const title = 'People', desc = 'Who owes you, whom you owe, and how long it has been open.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), d = peopleData(b);
    const tools = `<button class="btn btn-primary btn-sm" id="w2pAdd" onclick="w2Pages.addPerson()">${ic('plus', 's16')}Add person</button><button class="btn btn-secondary btn-sm" id="w2pCash" onclick="w2Pages.cash()">Lent or borrowed in cash</button>`;
    const kpis = kpi('w2pOwed', 'Owed to you', money(d.owed), plural(d.nOwed, 'person', 'people'), d.owed)
      + kpi('w2pOwe', 'You owe', money(d.owe), plural(d.nOwe, 'person', 'people'), d.owe)
      + kpi('w2pOld', 'Older than 60 days', `<span class="amt"${d.old ? ' style="color:var(--warn)"' : ''}>${fmtIDR(d.old)}</span>`, plural(d.nOld, 'person', 'people'), d.old);
    const open = d.open.length ? d.open.map(personRow).join('') : emptyHTML('users', d.list.length ? 'Everything is settled' : 'Nobody here yet. Add a person, or mark a spending row as not yours.');
    const settled = d.settled.length ? `<div class="grid"><section class="card span-12" id="w2pSettled"><button class="btn btn-ghost btn-sm" id="w2pSettledBtn" aria-expanded="${PP.settled}" onclick="w2Pages.toggleSettled()">Settled (${d.settled.length})${ic(PP.settled ? 'chevron-down' : 'chevron-right', 's16')}</button>
      ${PP.settled ? `<div style="margin-top:8px">${d.settled.map(personRow).join('')}</div>` : ''}</section></div>` : '';
    return `${pageHead(title, desc, hideBtn())}
      <div class="w2-bar">${tools}</div>
      <div class="grid">${kpis}</div>
      <div class="grid"><section class="card span-12" id="w2pList">${cardHead('users', 'Open balances', 'Money back settles the oldest item first')}${open}</section></div>${settled}`;
  }
  P.toggleSettled = function () { PP.settled = !PP.settled; renderAll(); };
  P.addPerson = function () {
    openSheet({ title: 'Add person', focus: '#w2nName', onEnter: () => P.addPersonSave(),
      body: `<div class="form-grid"><div class="field"><label class="label" for="w2nName">Name</label><input class="input" id="w2nName" maxlength="60" autocomplete="off"></div>
        <div class="field"><label class="label" for="w2nType">Person or company</label><select class="input" id="w2nType"><option value="person">Person</option><option value="company">Company</option></select></div>${errBox('w2nErr')}</div>`,
      foot: sheetFoot('Add person', 'addPersonSave') });
  };
  P.addPersonSave = function () {
    const name = el('w2nName').value.trim(), type = el('w2nType').value;
    if (!name) { showErr('w2nErr', 'Enter a name'); return; }
    if (!change(w => bookLib.addPerson(w, { name, type }), 'add-person', 'w2nErr').ok) return;
    PP.settled = true; closeTopSheet(true); toast(`${name} added`);
  };
  // Oldest first; within one day in the order the entries were made (the engine's order inside a day is by id).
  function inOrder(b, rows) {
    const made = r => String((b.entries[r.id] || {}).createdAt || '');
    return rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : made(x) < made(y) ? -1 : made(x) > made(y) ? 1 : String(x.id).localeCompare(String(y.id))));
  }
  // The movements on a person's two accounts, oldest first, with what is open after each one (+ = they owe you).
  function personMoves(b, pid) {
    const out = [];
    for (const a of live(b.accounts)) {
      if (a.person !== pid || (a.role !== 'receivable' && a.role !== 'payable')) continue;
      for (const r of bookLib.ledgerOf(b, a.id).rows) out.push({ date: r.date, id: r.id, kind: r.kind, description: r.description, delta: r.debit - r.credit });
    }
    inOrder(b, out);
    let run = 0; for (const r of out) { run += r.delta; r.run = run; }
    return out;
  }
  const balText = n => (n > 0 ? `owes you ${money(n)}` : n < 0 ? `you owe ${money(-n)}` : 'settled');
  // A list of movements: a table on web, a list on phones. rows: {date, what, sub, a, b, bal} (newest first).
  function movesHTML(rows, colA, colB, colBal) {
    if (!rows.length) return emptyHTML('inbox', 'Nothing yet');
    const cellA = r => (r.a ? money(r.a) : ''), cellB = r => (r.b ? money(r.b) : '');
    return `<div class="table-wrap hide-sm"><table class="data w2-moves" data-w2-moves><thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col" class="num">${escH(colA)}</th><th scope="col" class="num">${escH(colB)}</th><th scope="col" class="num">${escH(colBal)}</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td style="white-space:nowrap">${escH(dayText(r.date))}</td><td class="w2-what"><span class="merchant-name">${escH(r.what || '—')}</span><div class="li-sub">${escH(r.sub || '')}</div></td><td class="num">${cellA(r)}</td><td class="num">${cellB(r)}</td><td class="num">${r.bal}</td></tr>`).join('')}</tbody></table></div>
      <div class="only-sm"><div class="list">${rows.map(r => `<div class="list-item"><div class="li-body"><div class="li-title">${escH(r.what || '—')}</div><div class="li-sub">${escH(dayText(r.date))} · ${escH(r.sub || '')}</div></div>
        <span class="w2-right"><span>${r.a ? escH(colA) + ' ' + money(r.a) : escH(colB) + ' ' + money(r.b)}</span><span class="li-sub">${r.bal}</span></span></div>`).join('')}</div></div>`;
  }
  P.person = function (pid) {
    const b = B(), p = bookLib.people(b).find(x => x.person === pid); if (!p) return;
    const moves = personMoves(b, pid).reverse().map(r => ({ date: r.date, what: r.description, sub: KIND[r.kind] || r.kind, a: r.delta > 0 ? r.delta : 0, b: r.delta < 0 ? -r.delta : 0, bal: balText(r.run) }));
    const id = q(pid), acts = [];
    if (p.owedToYou > 0) acts.push(`<button class="btn btn-secondary btn-sm" id="w2oRepaid" onclick="closeTopSheet(true);w2Pages.repaid('${id}','in')">Got repaid</button>`,
      `<button class="btn btn-secondary btn-sm" id="w2oCopy" onclick="w2Pages.copyReminder('${id}')">Copy reminder</button>`, `<button class="btn btn-ghost btn-sm" id="w2oWrite" onclick="closeTopSheet(true);w2Pages.writeOff('${id}')">Write off</button>`);
    if (p.youOwe > 0) acts.push(`<button class="btn btn-secondary btn-sm" id="w2oRepay" onclick="closeTopSheet(true);w2Pages.repaid('${id}','out')">I repaid</button>`);
    openSheet({ title: p.name, wide: true, confirmDiscard: false,
      body: `<p class="muted" id="w2oBal" style="margin:0 0 12px">${p.type === 'company' ? 'Company · ' : ''}${[p.owedToYou ? balText(p.owedToYou) : '', p.youOwe ? balText(-p.youOwe) : ''].filter(Boolean).join(' · ') || 'Settled'}</p>
        ${acts.length ? `<div class="w2-bar">${acts.join('')}</div>` : ''}${movesHTML(moves, 'Added', 'Settled', 'Open after')}` });
  };
  let RP = null;
  P.repaid = function (pid, dir) {
    const b = B(), p = bookLib.people(b).find(x => x.person === pid); if (!p) return;
    const max = dir === 'in' ? p.owedToYou : p.youOwe;
    RP = { pid, dir, max, name: p.name };
    openSheet({ title: dir === 'in' ? `${p.name} repaid you` : `You repaid ${p.name}`, focus: '#w2rpAmt', onEnter: () => P.repaidSave(),
      body: `<p class="muted" style="margin:0 0 14px">${dir === 'in' ? 'Open: owes you ' : 'Open: you owe '}${money(max)}</p>
        <div class="form-grid"><div class="field"><label class="label" for="w2rpAmt">Amount</label>${rpInput('w2rpAmt', max)}</div>${dateField('w2rpDate', 'Date')}
        ${accountField('w2rpAcc', dir === 'in' ? 'Into which account' : 'From which account')}${errBox('w2rpErr')}</div>`,
      foot: sheetFoot(dir === 'in' ? 'Got repaid' : 'I repaid', 'repaidSave') });
  };
  P.repaidSave = function () {
    if (!RP) return;
    const amount = rpOf('w2rpAmt'), date = el('w2rpDate').value, account = el('w2rpAcc').value, x = RP;
    if (!amount) { showErr('w2rpErr', 'Enter an amount above zero, in whole rupiah'); return; }
    if (amount > x.max) { showErr('w2rpErr', `That is more than the ${fmtIDR(x.max)} that is open`); return; }
    if (!validDay(date)) { showErr('w2rpErr', 'Enter a date'); return; }
    if (!account) { showErr('w2rpErr', 'Choose an account'); return; }
    const kind = x.dir === 'in' ? 'repaid-in' : 'repaid-out', description = x.dir === 'in' ? `Repaid by ${x.name}` : `Repaid to ${x.name}`;
    const r = change(w => bookLib.post(w, bookLib.buildEntry(w, kind, { date, amount, account, person: x.pid, description, source: { type: 'manual' } })), kind, 'w2rpErr');
    if (!r.ok) return;
    closeTopSheet(true); RP = null;
    toast(`${description} · ${fmtIDR(amount)}`, { action: 'Undo', onAction: undoPost(r.value) });
  };
  P.cash = function () {
    openSheet({ title: 'Lent or borrowed in cash', focus: '#w2cAmt', onEnter: () => P.cashSave(),
      body: `<div class="form-grid"><div class="field full"><label class="label" for="w2cKind">What happened</label><select class="input" id="w2cKind"><option value="lent">I lent money</option><option value="borrowed">I borrowed money</option></select></div>
        ${personPicker('')}<div class="field"><label class="label" for="w2cAmt">Amount</label>${rpInput('w2cAmt', null, 'placeholder="0"')}</div>${dateField('w2cDate', 'Date')}
        ${accountField('w2cAcc', 'Which account the money left or came into')}
        <div class="field full"><label class="label" for="w2cNote">Note (optional)</label><input class="input" id="w2cNote" maxlength="80" autocomplete="off"></div>${errBox('w2cErr')}</div>`,
      foot: sheetFoot('Save', 'cashSave') });
  };
  P.cashSave = function () {
    const kind = el('w2cKind').value === 'borrowed' ? 'borrowed' : 'lent', amount = rpOf('w2cAmt'), date = el('w2cDate').value, account = el('w2cAcc').value, note = el('w2cNote').value.trim();
    let pick; try { pick = pickedPerson(); } catch (x) { showErr('w2cErr', x.message); return; }
    if (!amount) { showErr('w2cErr', 'Enter an amount above zero, in whole rupiah'); return; }
    if (!validDay(date)) { showErr('w2cErr', 'Enter a date'); return; }
    if (!account) { showErr('w2cErr', 'Choose an account'); return; }
    const r = change(w => { const pid = personIn(w, pick), name = w.people[pid].name;
      return bookLib.post(w, bookLib.buildEntry(w, kind, { date, amount, account, person: pid, description: note || (kind === 'lent' ? `Lent to ${name}` : `Borrowed from ${name}`), source: { type: 'manual' } })); }, kind, 'w2cErr');
    if (!r.ok) return;
    closeTopSheet(true);
    toast(`${kind === 'lent' ? 'Lent' : 'Borrowed'} · ${fmtIDR(amount)}`, { action: 'Undo', onAction: undoPost(r.value) });
  };
  let WO = null;
  function spendingCategories() {
    const s = new Set(['Written off']);
    if (typeof CATEGORIES === 'object' && CATEGORIES) for (const c of Object.keys(CATEGORIES)) s.add(c);
    for (const a of live(B().accounts)) if (a.kind === 'expense' && a.category && !a.hidden) s.add(a.category);
    return [...s];
  }
  P.writeOff = function (pid) {
    const p = bookLib.people(B()).find(x => x.person === pid); if (!p || !(p.owedToYou > 0)) return;
    WO = { pid, max: p.owedToYou, name: p.name };
    openSheet({ title: `Write off for ${p.name}`, focus: '#w2wAmt', onEnter: () => P.writeOffSave(),
      body: `<p class="muted" style="margin:0 0 14px">Use this when the money is not coming back. It becomes your spending, dated today, and ${escH(p.name)} no longer owes it. Open: ${money(p.owedToYou)}</p>
        <div class="form-grid"><div class="field"><label class="label" for="w2wAmt">Amount</label>${rpInput('w2wAmt', p.owedToYou)}</div>
        <div class="field"><label class="label" for="w2wCat">Count it as</label><select class="input" id="w2wCat">${spendingCategories().map(c => `<option value="${escH(c)}">${escH(c)}</option>`).join('')}</select></div>${errBox('w2wErr')}</div>`,
      foot: sheetFoot('Write off', 'writeOffSave') });
  };
  P.writeOffSave = function () {
    if (!WO) return;
    const amount = rpOf('w2wAmt'), category = el('w2wCat').value, x = WO;
    if (!amount) { showErr('w2wErr', 'Enter an amount above zero, in whole rupiah'); return; }
    if (amount > x.max) { showErr('w2wErr', `That is more than the ${fmtIDR(x.max)} that is open`); return; }
    const r = change(w => bookLib.post(w, bookLib.buildEntry(w, 'write-off', { date: today(), amount, person: x.pid, category, description: `Written off: ${x.name}`, source: { type: 'manual' } })), 'write-off', 'w2wErr');
    if (!r.ok) return;
    closeTopSheet(true); WO = null;
    toast(`Written off · ${fmtIDR(amount)} is now ${category} spending`, { action: 'Undo', onAction: undoPost(r.value) });
  };
  function reminderText(p) {
    const items = p.items.filter(i => i.side === 'receivable');
    return [`Hi ${p.name}, a quick reminder of what is still open:`, ...items.map(i => `- ${dayText(i.date)} · ${i.description || KIND[i.kind] || 'Item'} · ${fmtIDR(i.open)}`),
      `Total: ${fmtIDR(items.reduce((s, i) => s + i.open, 0))}`, 'Thank you.'].join('\n');
  }
  P.copyReminder = function (pid) {
    const p = bookLib.people(B()).find(x => x.person === pid); if (!p) return;
    const text = reminderText(p); P.lastReminder = text;
    const done = () => toast('Reminder copied. Nothing was sent.');
    const fallback = () => { try { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); if (ok) done(); else toast('Could not copy. Select the text by hand.'); } catch (_) { toast('Could not copy on this device'); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback(); } catch (_) { fallback(); }
  };

  /* ════════════════ Net worth (w2-networth) ════════════════ */
  const NW = { view: 'book', month: null };
  const NW_GROUPS = [['Cash and bank', ['bank', 'cash', 'ewallet']], ['Investments', ['investment']], ['Property', ['property']], ['Owed to you', ['receivable']], ['Other assets', ['other-asset']],
    ['Credit cards', ['card']], ['Loans', ['loan']], ['You owe', ['payable']], ['Other debts', ['other-liability']]];
  const valued = a => a.role === 'investment' || a.role === 'property';
  function nwMonths(b) {
    const cur = curMonth(); let first = String((b.settings || {}).firstMonth || '');
    for (const e of live(b.entries)) if (e.status === 'posted' && (!first || e.date.slice(0, 7) < first)) first = e.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(first) || first > cur) first = cur;
    return monthsBetween(first, cur);
  }
  // The latest stored value of each account, for the month or an earlier one (as the engine's Market view reads them).
  function valuesAt(b, M) { const best = {}; for (const v of live(b.values)) if (v.month <= M && (!best[v.account] || v.month > best[v.account].month)) best[v.account] = v; return best; }
  function renderNetWorth() {
    const title = 'Net worth', desc = 'Everything you own minus everything you owe, from the new book.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), months = nwMonths(b);
    if (!NW.month || !months.includes(NW.month)) NW.month = months[months.length - 1];
    const M = NW.month, market = NW.view === 'market', t = bookLib.netWorth(b, M, NW.view), bal = bookLib.balances(b, monthEnd(M)), stored = valuesAt(b, M), vals = market ? stored : {};
    const seg = `<div class="seg" role="group" aria-label="Valuation"><button id="w2nwBook" aria-pressed="${!market}" onclick="w2Pages.nwView('book')" title="What you paid, from your book">Book</button><button id="w2nwMarket" aria-pressed="${market}" onclick="w2Pages.nwView('market')" title="Today’s value where you typed one">Market</button></div>`;
    const groups = NW_GROUPS.map(([label, roles]) => {
      const rows = live(b.accounts).filter(a => !a.header && roles.includes(a.role)).map(a => {
        const v = vals[a.id], amount = a.kind === 'asset' ? (v ? v.value : (bal[a.id] || 0)) : -(bal[a.id] || 0);
        return { a, v, amount };
      }).filter(r => r.amount || (valued(r.a) && stored[r.a.id])).sort((x, y) => y.amount - x.amount || byName(x.a, y.a));
      if (!rows.length) return '';
      const total = rows.reduce((s, r) => s + r.amount, 0);
      return `<div class="w2-group" data-w2-group="${escH(label)}" data-v="${total}"><span class="eyebrow">${escH(label)}</span><span class="eyebrow">${money(total)}</span></div>
        ${rows.map(r => { const id = q(r.a.id), who = r.a.person ? personName(r.a.person) : r.a.name;
          const note = !valued(r.a) ? '' : market ? (r.v ? (r.v.month < M ? `<span class="badge warn">value from ${escH(monthLabel(r.v.month))}</span>` : '<span class="badge good">value this month</span>') : '<span class="badge">no value yet · showing what you paid</span>') : '';
          return `<div class="w2-row" data-w2-acc="${escH(r.a.id)}" data-v="${r.amount}"><div class="li-body"><button class="w2-link" onclick="w2Pages.account('${id}')">${escH(who)}</button>${note ? ' ' + note : ''}</div>
            <div class="w2-side"><b>${money(r.amount)}</b>${valued(r.a) ? `<button class="btn btn-secondary btn-sm" data-w2-value="${escH(r.a.id)}" onclick="w2Pages.value('${id}')">Update value</button>` : ''}</div></div>`; }).join('')}`;
    }).join('');
    return `${pageHead(title, desc, hideBtn())}
      <div class="w2-bar">${stepper(months, M, 'nwStep')}<span class="grow"></span>${seg}</div>
      <div class="grid"><section class="card summary span-12" id="w2nwCard" aria-label="Net worth summary">
        <div class="summary-l"><div class="eyebrow">Net worth · ${escH(monthLabel(M, true))} · ${market ? 'market value' : 'book value'}</div>
          <div class="display" id="w2nwNet" data-v="${t.net}"><span class="amt"><span class="cur">Rp</span>${escH(Math.round(t.net).toLocaleString('id-ID'))}</span></div>
          <div class="summary-line">${market ? 'Market uses the values you typed for investments and property. Everything else is the book balance.' : 'Book shows what you paid. Switch to Market to use the values you typed.'}</div>
          <dl class="facts"><div><dt class="eyebrow">Assets</dt><dd id="w2nwAssets" data-v="${t.assets}">${money(t.assets)}</dd></div><div><dt class="eyebrow">Debts</dt><dd id="w2nwDebts" data-v="${t.liabilities}">${money(t.liabilities)}</dd></div></dl></div>
        <div class="summary-r">${cardHead('', 'Net worth over time', '12 months to ' + escH(monthLabel(M)) + ', month-end')}
          <div class="chart-readout" id="w2nwReadout" aria-live="polite"></div>
          <div class="chart-box"><canvas id="w2nwChart" role="img" aria-label="Net worth by month"></canvas></div></div></section></div>
      <div class="grid"><section class="card span-12" id="w2nwAccounts">${cardHead('wallet', 'Accounts', 'Tap an account to see its movements')}${groups || emptyHTML('wallet', 'No balances in this month')}</section></div>`;
  }
  function drawNetWorth() {
    const c = el('w2nwChart'), b = B(); if (!c || !b || typeof Chart === 'undefined' || !NW.month) return;
    const keys = []; for (let i = 11; i >= 0; i--) keys.push(shiftM(NW.month, -i));
    const vals = keys.map(k => bookLib.netWorth(b, k, NW.view).net), mobile = isMobile(), accent = cssVar('--accent'), last = vals.length - 1;
    readout('w2nwReadout', monthLabel(keys[last]), vals[last]);
    CHARTS.w2nwChart = new Chart(c, { type: 'line', plugins: [crosshairPlugin],
      data: { labels: keys.map(k => monthLabel(k).replace(/ \d{4}$/, '')), datasets: [{ data: vals, fill: true, borderColor: accent, backgroundColor: x => gradientFill(x.chart), pointHoverBackgroundColor: accent, pointHoverBorderColor: cssVar('--surface-1'), pointHoverBorderWidth: 2, pointHitRadius: 16 }] },
      options: { responsive: true, maintainAspectRatio: false, ...animOnce(), interaction: { mode: 'index', intersect: false },
        onHover: (e, els) => { if (els.length) readout('w2nwReadout', monthLabel(keys[els[0].index]), vals[els[0].index]); },
        plugins: { tooltip: { enabled: !mobile, displayColors: false, callbacks: { title: it => monthLabel(keys[it[0].dataIndex], true), label: x => moneyTip(x.parsed.y) } } },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: mobile ? 5 : 12, maxRotation: 0 } }, y: { border: { display: false }, ticks: { maxTicksLimit: 5, callback: moneyTick } } } } });
    P.chartData = { keys, vals };
  }
  P.nwView = function (v) { NW.view = v === 'market' ? 'market' : 'book'; renderAll(); };
  P.nwStep = function (d) { const ms = nwMonths(B()), i = ms.indexOf(NW.month) + d; if (i >= 0 && i < ms.length) { NW.month = ms[i]; renderAll(); } };
  P.account = function (id) {
    const b = B(), a = b.accounts[id]; if (!a) return;
    const L = bookLib.ledgerOf(b, id, null, monthEnd(NW.month || curMonth())), debt = a.kind === 'liability', sign = debt ? -1 : 1;
    let run = L.opening;
    const rows = inOrder(b, L.rows.slice()).map(r => { run += r.debit - r.credit; return { date: r.date, what: r.description, sub: KIND[r.kind] || r.kind, a: debt ? r.credit : r.debit, b: debt ? r.debit : r.credit, bal: money(sign * run) }; }).reverse().slice(0, 300);
    openSheet({ title: a.person ? `${personName(a.person)} · ${a.role === 'receivable' ? 'owes you' : 'you owe'}` : a.name, wide: true, confirmDiscard: false,
      body: `<p class="muted" id="w2accBal" style="margin:0 0 12px">${debt ? 'You owe' : 'Balance'} at the end of ${escH(monthLabel(NW.month || curMonth(), true))}: ${money(sign * L.closing)}${L.rows.length > 300 ? ' · showing the latest 300 movements' : ''}</p>
        ${movesHTML(rows, debt ? 'Added' : 'In', debt ? 'Paid' : 'Out', debt ? 'You owe' : 'Balance')}` });
  };
  let VA = null;
  P.value = function (id) {
    const b = B(), a = b.accounts[id]; if (!a) return;
    const M = NW.month || curMonth(), cur = valuesAt(b, M)[id];
    VA = { id, name: a.name };
    openSheet({ title: `Update value · ${a.name}`, focus: '#w2vVal', onEnter: () => P.valueSave(),
      body: `<p class="muted" style="margin:0 0 14px">Type what it is worth at the end of the month. This feeds the Market view only. It never changes what you paid (Book).${cur ? ` Last value: ${money(cur.value)} for ${escH(monthLabel(cur.month))}.` : ''}</p>
        <div class="form-grid"><div class="field"><label class="label" for="w2vMonth">Month</label><input class="input" type="month" id="w2vMonth" value="${escH(M)}"></div>
        <div class="field"><label class="label" for="w2vVal">Value</label>${rpInput('w2vVal', cur ? cur.value : null, 'placeholder="0"')}</div>${errBox('w2vErr')}</div>`,
      foot: sheetFoot('Save value', 'valueSave') });
  };
  P.valueSave = function () {
    if (!VA) return;
    const month = el('w2vMonth').value, n = meParse(el('w2vVal').value), x = VA;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { showErr('w2vErr', 'Choose a month'); return; }
    if (!(typeof n === 'number' && Number.isInteger(n) && n >= 0)) { showErr('w2vErr', 'Enter the value in whole rupiah'); return; }
    if (!change(w => bookLib.setValue(w, x.id, month, n), 'value', 'w2vErr').ok) return;
    closeTopSheet(true); VA = null;
    toast(`${x.name}: ${fmtIDR(n)} for ${monthLabel(month)}`);
  };

  /* ════════════════ Journals (w2-journals) ════════════════ */
  const KIND = { spending: 'Spending', 'paid-for': 'Paid for someone', split: 'Split', reimburse: 'To be reimbursed', lent: 'Lent', 'repaid-in': 'Got repaid', borrowed: 'Borrowed', 'repaid-out': 'Repaid',
    income: 'Income', transfer: 'Between accounts', 'card-payment': 'Card payment', 'invest-buy': 'Investment bought', 'invest-sell': 'Investment sold', fee: 'Fee', 'write-off': 'Written off',
    adjust: 'Adjustment', opening: 'Opening balance', 'year-end': 'Year end', manual: 'Manual', migrated: 'Copied history' };
  const SOURCE = { email: 'Bank email', stmt: 'Statement', manual: 'Typed in', ai: 'Claude', migration: 'Copied history', system: 'System' };
  const J = { month: '', kind: '', account: '', status: '', q: '', limit: 100 };
  const srcText = e => SOURCE[(e.source && e.source.type) || 'manual'] || 'Typed in';
  const statusBadge = e => (e.status === 'void' ? '<span class="badge bad">Void</span>' : '<span class="badge good">Posted</span>');
  const linesHTML = (e, head) => `<div class="w2-jl">${head ? '<span class="h">Account</span><span class="h n">Debit</span><span class="h n">Credit</span>' : ''}${(e.lines || []).map(l => `<span>${escH(accName(l.account))}</span><span class="n amt">${l.amount > 0 ? fmtIDR(l.amount) : ''}</span><span class="n amt">${l.amount < 0 ? fmtIDR(-l.amount) : ''}</span>`).join('')}</div>`;
  function journalList(b) {
    const s = J.q.trim().toLowerCase(), digits = s.replace(/[^\d]/g, '');
    return live(b.entries).filter(e => {
      if (J.month && e.date.slice(0, 7) !== J.month) return false;
      if (J.kind && e.kind !== J.kind) return false;
      if (J.status && e.status !== J.status) return false;
      if (J.account && !(e.lines || []).some(l => l.account === J.account)) return false;
      if (!s) return true;
      const text = [e.description, e.number, KIND[e.kind], srcText(e), e.date, ...(e.lines || []).map(l => accName(l.account))].join(' ').toLowerCase();
      return text.includes(s) || (digits.length >= 3 && (e.lines || []).some(l => String(Math.abs(l.amount)).includes(digits)));
    }).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : String(y.createdAt || '').localeCompare(String(x.createdAt || ''))));
  }
  function journalBody(b) {
    const all = journalList(b), list = all.slice(0, J.limit);
    if (!all.length) return `<div data-w2-count="0">${emptyHTML('search', 'No entries match these filters')}</div>`;
    const table = `<div class="table-wrap hide-sm"><table class="data" id="w2jTable"><thead><tr><th scope="col">Date</th><th scope="col">Number</th><th scope="col">Description · kind · source</th><th scope="col"><div class="w2-jl"><span>Account</span><span class="n">Debit</span><span class="n">Credit</span></div></th><th scope="col">Status</th></tr></thead><tbody>
      ${list.map(e => `<tr class="clickable${e.status === 'void' ? ' muted-row' : ''}" data-w2-entry="${escH(e.id)}" data-status="${escH(e.status)}" onclick="w2Pages.entry('${q(e.id)}')"><td class="w2-top" style="white-space:nowrap">${escH(dayText(e.date))}</td><td class="w2-top">${escH(e.number || '—')}</td>
        <td class="w2-top" style="min-width:160px;overflow-wrap:anywhere"><span class="merchant-name">${escH(e.description || '—')}</span><div class="li-sub" data-w2-ks>${escH(KIND[e.kind] || e.kind)} · ${escH(srcText(e))}</div></td><td class="w2-top" style="min-width:340px;width:46%">${linesHTML(e)}</td><td class="w2-top">${statusBadge(e)}</td></tr>`).join('')}</tbody></table></div>`;
    const phone = `<div class="only-sm w2-pad"><div class="list">${list.map(e => `<button class="list-item" style="align-items:flex-start${e.status === 'void' ? ';opacity:.55' : ''}" data-w2-entry="${escH(e.id)}" onclick="w2Pages.entry('${q(e.id)}')"><div class="li-body"><div class="li-title">${escH(e.description || '—')} ${statusBadge(e)}</div>
        <div class="li-sub">${escH(dayText(e.date))} · ${escH(KIND[e.kind] || e.kind)} · ${escH(srcText(e))}${e.number ? ' · ' + escH(e.number) : ''}</div><div style="margin-top:6px">${linesHTML(e, true)}</div></div></button>`).join('')}</div></div>`;
    return `<div data-w2-count="${all.length}">${table}${phone}<div class="w2-pad" style="padding-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span class="help">${list.length} of ${plural(all.length, 'entry', 'entries')}</span>
      ${all.length > list.length ? `<button class="btn btn-secondary btn-sm" id="w2jMore" onclick="w2Pages.jMore()">Show more</button>` : ''}</div></div>`;
  }
  function renderJournals() {
    const title = 'Journals', desc = 'Every entry in the new book as debit and credit lines, for you or your accountant.';
    const g = gate(title, desc); if (g) return g;
    const b = B(), es = live(b.entries);
    const months = [...new Set(es.map(e => e.date.slice(0, 7)))].sort().reverse(), kinds = [...new Set(es.map(e => e.kind))].sort((x, y) => String(KIND[x] || x).localeCompare(String(KIND[y] || y)));
    const used = new Set(); for (const e of es) for (const l of e.lines || []) used.add(l.account);
    const accounts = [...used].map(id => ({ id, name: accName(id) })).sort(byName);
    const sel = (id, key, label, opts) => `<select class="input" id="${id}" aria-label="${label}" onchange="w2Pages.jSet('${key}',this.value)"><option value="">${label}</option>${opts}</select>`;
    const o = (v, t, cur) => `<option value="${escH(v)}"${v === cur ? ' selected' : ''}>${escH(t)}</option>`;
    const bar = `<div class="w2-bar" id="w2jBar">${sel('w2jMonth', 'month', 'All months', months.map(m => o(m, monthLabel(m), J.month)).join(''))}
      ${sel('w2jKind', 'kind', 'All kinds', kinds.map(k => o(k, KIND[k] || k, J.kind)).join(''))}
      ${sel('w2jAcc', 'account', 'All accounts', accounts.map(a => o(a.id, a.name, J.account)).join(''))}
      ${sel('w2jStatus', 'status', 'Posted and void', o('posted', 'Posted', J.status) + o('void', 'Void', J.status))}
      <input class="input grow" id="w2jSearch" type="search" placeholder="Search description, account or amount" aria-label="Search entries" value="${escH(J.q)}" oninput="w2Pages.jSearch(this.value)" style="flex:1 1 200px"></div>`;
    return `${pageHead(title, desc, hideBtn())}${bar}
      <div class="grid"><section class="card flush span-12" id="w2jCard">${cardHead('table', 'Entries', 'Newest first · tap one to see its history or void it')}<div id="w2jBody">${journalBody(b)}</div></section></div>`;
  }
  P.jSet = function (k, v) { J[k] = v; J.limit = 100; renderAll(); };
  P.jSearch = function (v) { J.q = v; J.limit = 100; const box = el('w2jBody'); if (box && B()) box.innerHTML = journalBody(B()); };
  P.jMore = function () { J.limit += 100; const box = el('w2jBody'); if (box && B()) box.innerHTML = journalBody(B()); };
  let JV = null;
  P.entry = function (id) {
    const b = B(), e = b.entries[id]; if (!e) return;
    JV = id;
    const fact = (k, v) => `<div><dt class="eyebrow">${k}</dt><dd>${v}</dd></div>`;
    const hist = (e.history || []).slice().reverse().map(h => { const bf = h.before || {}, tot = (bf.lines || []).filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0);
      return `<div class="list-item"><div class="li-body"><div class="li-title">${escH(h.why || 'Changed')}</div><div class="li-sub">${escH(whenText(h.at))} · before: ${escH(KIND[bf.kind] || bf.kind || '')}, ${escH(dayText(bf.date))}, ${money(tot)}</div></div></div>`; }).join('');
    const fromEmail = e.source && e.source.type === 'email';
    openSheet({ title: e.description || 'Entry', wide: true, confirmDiscard: false, onEnter: () => P.voidSave(),
      body: `<dl class="w2-facts">${fact('Date', escH(dayText(e.date)))}${fact('Number', escH(e.number || '—'))}${fact('Kind', escH(KIND[e.kind] || e.kind))}${fact('Source', escH(srcText(e)))}${fact('Status', statusBadge(e))}${fact('Entered', escH(whenText(e.createdAt)))}</dl>
        <div id="w2eLines">${linesHTML(e, true)}</div>
        <h3 class="eyebrow" style="margin:18px 0 4px">History</h3>${hist ? `<div class="list" id="w2eHist">${hist}</div>` : '<p class="help" id="w2eHist">No changes since it was entered.</p>'}
        ${e.status === 'posted' ? `<div id="w2eVoidBox" style="display:none;margin-top:16px"><div class="field"><label class="label" for="w2eWhy">Why are you voiding it?</label><input class="input" id="w2eWhy" maxlength="120" autocomplete="off"></div>
          <p class="help" style="margin-top:6px">A void entry stays in the list with its history, and leaves every balance.${fromEmail ? ' This one came from a bank email, so the next sync adds the row again as plain spending.' : ''}</p></div>` : ''}${errBox('w2eErr')}`,
      foot: e.status === 'posted' ? `<button class="btn btn-danger left" id="w2eVoid" onclick="w2Pages.voidAsk()">Void this entry</button><button class="btn btn-secondary" onclick="closeTopSheet(true)">Close</button>` : `<button class="btn btn-secondary" onclick="closeTopSheet(true)">Close</button>` });
  };
  P.voidAsk = function () {
    const box = el('w2eVoidBox'); if (!box) return;
    if (box.style.display === 'none') { box.style.display = ''; el('w2eVoid').textContent = 'Void now'; el('w2eWhy').focus(); return; }
    P.voidSave();
  };
  P.voidSave = function () {
    const box = el('w2eVoidBox'); if (!JV || !box || box.style.display === 'none') return;
    const why = el('w2eWhy').value.trim(), id = JV;
    if (!why) { showErr('w2eErr', 'Say why, so the history explains it'); return; }
    if (!change(w => { if (!bookLib.voidEntry(w, id, why)) throw new Error('This entry is already void'); }, 'void', 'w2eErr').ok) return;
    closeTopSheet(true); JV = null; toast('Entry voided. It stays in the list with its history.');
  };

  registerPage({ key: 'w2-rows', label: 'Spending · actual', icon: 'receipt', group: 'w2', order: 20, render: renderRows });
  registerPage({ key: 'w2-people', label: 'People', icon: 'users', group: 'w2', order: 30, render: renderPeople });
  registerPage({ key: 'w2-networth', label: 'Net worth', icon: 'trending-up', group: 'w2', order: 40, render: renderNetWorth, afterRender: drawNetWorth });
  registerPage({ key: 'w2-journals', label: 'Journals', icon: 'table', group: 'w2', order: 50, render: renderJournals });
})();
