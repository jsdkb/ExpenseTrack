/* ExpenseTrack v6 — Month check (w2-check), docs/v6-book.md §9.3. Three steps on one page: the Inbox
   is empty, every balance agrees with its statement (or was counted), then the month is locked.

   Every figure comes from the new book through bookLib; every change goes through book2Do. The
   statement balances and lines are READ from the cash data the app already holds (CM()) and from
   the original's email-to-statement matches (ETStatements.last()); nothing old is ever written:
   no STATE, no scheduleDriveSave(), no mutating ledger* call. Plain words only. No personal data
   in this file: the repo is public. */
(function () {
  'use strict';
  if (typeof bookLib === 'undefined' || typeof BOOK2 !== 'function' || typeof book2Do !== 'function' || typeof registerPage !== 'function') {
    console.warn('ExpenseTrack preview: the new book store is not loaded, so Month check stays off.');
    return;
  }
  const P = window.w2Check = {};

  /* ── Small helpers ── */
  const B = () => BOOK2();
  const p2 = n => String(n).padStart(2, '0');
  const errText = e => (e && Array.isArray(e.errors) && e.errors.length ? e.errors.join(' · ') : String((e && e.message) || e));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const shiftM = (M, k) => { let [y, m] = M.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${p2(m)}`; };
  const monthsBetween = (a, b) => { const out = []; for (let M = a, i = 0; M <= b && i < 600; M = shiftM(M, 1), i++) out.push(M); return out; };
  const monthEnd = M => { const [y, m] = M.split('-').map(Number); return `${M}-${p2(new Date(y, m, 0).getDate())}`; };
  const nextDay = iso => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const dayGap = (a, b) => Math.abs(Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000));
  const dayText = iso => { try { return fmtDay(new Date(String(iso).slice(0, 10) + 'T00:00:00')); } catch (_) { return String(iso || ''); } };
  const whenText = iso => { try { return fmtDateTime(iso); } catch (_) { return String(iso || ''); } };
  const mLong = M => monthLabel(M, true);
  const money = n => `<span class="amt">${n < 0 ? '−' : ''}${fmtIDR(Math.abs(n))}</span>`;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const el = id => document.getElementById(id);
  const q = s => escAttr(s);
  const live = o => Object.values(o || {}).filter(x => x && !x.deleted);
  const posted = b => live(b.entries).filter(e => e.status === 'posted');
  function showErr(id, msg) { const b = el(id); if (!b) { toast(msg); return; } b.style.display = msg ? '' : 'none'; b.querySelector('span').textContent = msg || ''; }
  const errBox = id => `<div class="help err full" id="${id}" role="alert" style="display:none">${ic('triangle-alert', 's16')}<span></span></div>`;
  const sheetFoot = (label, fn, cls) => `<button class="btn btn-secondary" onclick="closeTopSheet(true)">Cancel</button><button class="btn ${cls || 'btn-primary'}" id="w2cSave" onclick="w2Check.${fn}()">${escH(label)}</button>`;
  const rpInput = (id, val) => `<div class="input-affix"><span class="affix">Rp</span><input class="input" id="${id}" inputmode="numeric" autocomplete="off" placeholder="0" value="${val == null ? '' : escH(Math.round(val).toLocaleString('id-ID'))}"></div>`;
  function change(fn, why, errId) {
    try { return { ok: true, value: book2Do(fn, why) }; }
    catch (e) { if (errId) showErr(errId, errText(e)); else toast(errText(e)); return { ok: false }; }
  }

  // Layout only, from the existing tokens (the same rules the round-1 pages use, plus two of its own).
  if (!el('w2CheckStyle')) {
    const st = document.createElement('style'); st.id = 'w2CheckStyle';
    st.textContent = `
      .w2-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:16px}
      .w2-bar .grow{flex:1 1 0;min-width:0}
      .w2-row{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border)}
      .w2-row:first-child{border-top:none}
      .w2-row .li-body{flex:1 1 180px}
      .w2-side{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;font-size:14px}
      .w2-group{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 0 6px}
      .w2-group:first-child{padding-top:0}
      .w2c-step .kpi-value{font-size:22px;line-height:28px;white-space:normal}
      .w2c-lock{display:flex;align-items:center;gap:10px 12px;flex-wrap:wrap;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)}
      .w2c-lock .help{flex:1 1 240px;margin:0}
      .w2c-sum{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--border);font-size:14px}
      .w2c-sum b{font-weight:600}
      @media (max-width:767px){.w2-side{margin-left:0;justify-content:flex-start;flex:1 1 100%}}`;
    document.head.appendChild(st);
  }

  /* ── States: signed out, loading, error, blocked, no book yet (as on the round-1 pages) ── */
  const TITLE = 'Month check', DESC = 'Close a month in three steps: empty the Inbox, see that every balance agrees, then lock it.';
  function gate() {
    const st = book2Status(), b = B();
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

  /* ── What the app already holds about statements (read-only) ── */
  const cashData = () => { try { const c = typeof CM === 'function' ? CM() : null; return c && Array.isArray(c.accounts) && Array.isArray(c.statements) ? c : null; } catch (_) { return null; } };
  // The original's email-to-statement matches: {line id → email row id}, or null when they cannot be read.
  function emailMatches() {
    try {
      const R = typeof ETStatements === 'object' && ETStatements && typeof ETStatements.last === 'function' ? ETStatements.last() : null;
      if (!R || !Array.isArray(R.matches)) return null;
      const m = {}; for (const x of R.matches) if (x && x.line && x.t) m[x.line.id] = String(x.t.id);
      return m;
    } catch (_) { return null; }
  }
  const isIDR = x => (x.currency || x.ccy || 'IDR') === 'IDR';
  // A statement's closing balance the way the book counts it: a card statement shows what is owed
  // as a positive number, the book holds a debt as a negative one.
  const stmtValue = (ca, s) => Math.round((ca && ca.kind === 'card' ? -1 : 1) * (+s.closing || 0));

  /* ── The month, worked out ── */
  const C = { month: null };
  const ROLE_ORDER = ['bank', 'ewallet', 'card', 'cash', 'loan', 'receivable', 'payable', 'other-asset', 'other-liability', 'investment', 'property'];
  const valued = a => a.role === 'investment' || a.role === 'property';
  const curMonth = () => today().slice(0, 7);
  function months(b) {
    const last = shiftM(curMonth(), -1), from = String((b.settings || {}).syncFrom || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(from) && from <= last ? monthsBetween(from, last) : [];
  }
  const locked = (b, M) => bookLib.lockState(b, M) === 'locked';
  function inboxCount(M) {
    if (typeof book2InboxCount !== 'function') return null;
    try { const n = book2InboxCount(M); return typeof n === 'number' && n >= 0 ? n : null; } catch (_) { return null; }
  }
  // The statement of one book account for the month: the latest one dated inside the month for
  // every rupiah statement account linked to it. → {linked, stmt: {date, v, parts}|null, why}
  function statementOf(b, cash, a, M) {
    const map = (b.settings || {}).stmtMap || {}, ids = Object.keys(map).filter(k => map[k] === a.id);
    const accs = ids.map(id => ({ id, ca: cash ? cash.accounts.find(x => x.id === id) || null : null })).filter(x => !x.ca || isIDR(x.ca));
    if (!accs.length || !isIDR(a)) return { linked: false, stmt: null };
    const first = M + '-01', end = monthEnd(M), parts = [];
    for (const x of accs) {
      const all = cash ? cash.statements.filter(s => s.account === x.id).sort((p, r) => String(p.date).localeCompare(String(r.date))) : [];
      const s = all.filter(r => r.date >= first && r.date <= end).pop();
      if (!s) return { linked: true, stmt: null, why: 'statement not in yet' };
      const prev = all.filter(r => r.date < s.date).pop();
      parts.push({ id: x.id, ca: x.ca, s, start: s.periodStart || (prev ? nextDay(prev.date) : first) });
    }
    if (parts.some(p => p.s.date !== parts[0].s.date)) return { linked: true, stmt: null, why: 'its statements end on different days' };
    return { linked: true, stmt: { date: parts[0].s.date, v: parts.reduce((t, p) => t + stmtValue(p.ca, p.s), 0), parts } };
  }
  // Every account of step 2 with its result, worked out now (never read back from a stored result,
  // except "same as book", which only the owner can say).
  function rowsOf(b, M) {
    const cash = cashData(), end = monthEnd(M), isLocked = locked(b, M), cache = {};
    const balAt = d => cache[d] || (cache[d] = bookLib.balances(b, d));
    const balEnd = balAt(end), moved = new Set();
    for (const e of posted(b)) if (e.date.slice(0, 7) === M) for (const l of e.lines) moved.add(l.account);
    const rows = [];
    for (const a of live(b.accounts)) {
      if (a.header || (a.kind !== 'asset' && a.kind !== 'liability')) continue;
      const bal = balEnd[a.id] || 0;
      if (!bal && !moved.has(a.id)) continue;
      const st = statementOf(b, cash, a, M);
      if (valued(a) && !st.linked) continue;                              // step 3 shows these
      const c = (b.checks || {})[`${a.id}|${M}`] || null, adj = c && c.adjustedBy && (b.entries[c.adjustedBy] || {}).status === 'posted' ? c.adjustedBy : null;
      const r = { a, bal, linked: st.linked, stmt: st.stmt, why: st.why || '', check: c, adjustedBy: adj, sign: a.kind === 'liability' ? -1 : 1 };
      if (st.stmt) { r.bookAt = balAt(st.stmt.date)[a.id] || 0; r.diff = st.stmt.v - r.bookAt; r.status = r.diff ? 'differs' : 'agrees'; }
      else if (st.linked) r.status = 'missing';
      else if (isLocked) r.status = c && c.ok ? 'checked' : 'todo';
      else r.status = c && c.ok && c.statement == null && c.book === bal ? 'checked' : 'todo';
      r.ok = r.status === 'agrees' || r.status === 'checked';
      rows.push(r);
    }
    rows.forEach(r => { r.name = r.a.name; });
    return rows.sort((x, y) => (y.linked - x.linked) || ROLE_ORDER.indexOf(x.a.role) - ROLE_ORDER.indexOf(y.a.role) || String(x.name).localeCompare(String(y.name)));
  }
  function valuesAt(b, M) { const best = {}; for (const v of live(b.values)) if (v.month <= M && (!best[v.account] || v.month > best[v.account].month)) best[v.account] = v; return best; }
  function valueRows(b, M) {
    const bal = bookLib.balances(b, monthEnd(M)), vals = valuesAt(b, M);
    return live(b.accounts).filter(a => !a.header && valued(a) && ((bal[a.id] || 0) || vals[a.id])).map(a => ({ a, book: bal[a.id] || 0, v: vals[a.id] || null }))
      .sort((x, y) => ROLE_ORDER.indexOf(x.a.role) - ROLE_ORDER.indexOf(y.a.role) || String(x.a.name).localeCompare(String(y.a.name)));
  }
  // Everything the page and its buttons need for one month.
  function monthState(b, M) {
    const rows = rowsOf(b, M), inbox = inboxCount(M), open = rows.filter(r => !r.ok);
    const step1 = inbox === null || inbox === 0, step2 = !open.length;
    return { M, rows, inbox, open, step1, step2, isLocked: locked(b, M), canLock: step1 && step2, anyway: step1 && open.length > 0 && open.every(r => r.status === 'missing') };
  }
  P.state = M => { const b = B(); return b ? monthState(b, M || C.month) : null; };   // read-only, for the tests and the console

  /* ── The page ── */
  function stepperHTML(ms, cur) {
    const i = ms.indexOf(cur);
    return `<div class="cm-month" role="group" aria-label="Month">
      <button class="icon-btn sm" id="w2cPrev" onclick="w2Check.step(-1)" aria-label="Previous month"${i <= 0 ? ' disabled' : ''}>${ic('chevron-left', 's16')}</button>
      <span class="lbl" id="w2cMonth" data-month="${escH(cur)}">${escH(mLong(cur))}</span>
      <button class="icon-btn sm" id="w2cNext" onclick="w2Check.step(1)" aria-label="Next month"${i < 0 || i >= ms.length - 1 ? ' disabled' : ''}>${ic('chevron-right', 's16')}</button></div>`;
  }
  const stepCard = (id, n, label, value, sub, state, extra) => `<div class="card kpi span-4 w2c-step" id="${id}" data-state="${state}"><span class="kpi-label">${n} · ${escH(label)}</span><span class="kpi-value"${state === 'done' ? ' style="color:var(--good)"' : ''}>${escH(value)}</span><span class="kpi-sub">${sub}</span>${extra || ''}</div>`;
  function rowHTML(r, S) {
    const id = q(r.a.id), shown = v => money(r.sign * v);
    let sub, side;
    if (r.stmt) sub = `Statement ${escH(dayText(r.stmt.date))}: ${shown(r.stmt.v)} · Book: ${shown(r.bookAt)}${r.diff ? ` · ${money(Math.abs(r.diff))} apart` : ''}`;
    else if (r.linked) sub = `No statement for ${escH(mLong(S.M))} yet · Book: ${shown(r.bal)}`;
    else sub = `No statement · Book: ${shown(r.bal)}`;
    if (r.status === 'agrees') side = `<span class="badge good">agrees${r.adjustedBy ? ' · adjusted' : ''}</span>`;
    else if (r.status === 'differs') side = `<span class="badge bad">differs</span>${S.isLocked ? '' : `<button class="btn btn-primary btn-sm" data-w2c="differs" onclick="w2Check.differs('${id}')">Show what differs</button><button class="btn btn-secondary btn-sm" data-w2c="adjust" onclick="w2Check.adjust('${id}')">Adjust</button>`}`;
    else if (r.status === 'missing') side = `<span class="badge warn">${escH(r.why || 'statement not in yet')}</span>`;
    else if (r.status === 'checked') side = `<span class="badge good">${r.check && r.check.how === 'counted' ? 'counted' : 'same as book'}${r.adjustedBy ? ' · adjusted' : ''}</span>${S.isLocked ? '' : `<button class="btn btn-ghost btn-sm" data-w2c="count" onclick="w2Check.count('${id}')">Count again</button>`}`;
    else side = S.isLocked ? '<span class="badge">not checked</span>' : `<button class="btn btn-secondary btn-sm" data-w2c="same" onclick="w2Check.same('${id}')">Same as book</button><button class="btn btn-ghost btn-sm" data-w2c="count" onclick="w2Check.count('${id}')">I counted it</button>`;
    return `<div class="w2-row" data-w2c-acc="${escH(r.a.id)}" data-status="${r.status}" data-book="${r.stmt ? r.bookAt : r.bal}"${r.stmt ? ` data-stmt="${r.stmt.v}" data-date="${r.stmt.date}"` : ''}><div class="li-body"><div class="li-title">${escH(r.name)}</div><div class="li-sub">${sub}</div></div><div class="w2-side">${side}</div></div>`;
  }
  function render() {
    const g = gate(); if (g) return g;
    const b = B(), ms = months(b);
    if (!ms.length) {
      return `${pageHead(TITLE, DESC, hideBtn())}<div class="grid"><section class="card span-12" id="w2cNone">${emptyHTML('calendar-check', `Nothing to check yet. ${mLong(curMonth())} can be checked once it is over.`)}</section></div>`;
    }
    if (!C.month || !ms.includes(C.month)) C.month = ms.find(m => !locked(b, m)) || ms[ms.length - 1];
    const M = C.month, S = monthState(b, M), L = (b.locks || {})[M] || {}, name = mLong(M), short = name.replace(/ \d{4}$/, '');
    const nOk = S.rows.length - S.open.length, hasInbox = typeof PAGES !== 'undefined' && Array.isArray(PAGES) && PAGES.some(p => p.key === 'w2-inbox');
    const s1 = S.inbox === null ? stepCard('w2cStep1', 1, 'Inbox empty', 'Inbox not available yet', 'This step is skipped for now. It does not hold up the lock.', 'skip')
      : S.inbox === 0 ? stepCard('w2cStep1', 1, 'Inbox empty', 'Done', `0 left for ${escH(short)}`, 'done')
      : stepCard('w2cStep1', 1, 'Inbox empty', `${S.inbox} left`, `Answer ${S.inbox === 1 ? 'it' : 'them'} first, for ${escH(short)}`, 'todo', hasInbox ? `<button class="btn btn-secondary btn-sm" id="w2cInbox" style="margin-top:8px;align-self:flex-start" onclick="setTab('w2-inbox')">Open Inbox</button>` : '');
    const s2 = stepCard('w2cStep2', 2, 'Balances agree', S.rows.length ? `${nOk} of ${S.rows.length}` : 'Nothing to check', S.open.length ? `${S.open.length} to look at` : S.rows.length ? 'Every account agrees' : 'No account held money this month', S.step2 ? 'done' : 'todo');
    const s3 = S.isLocked ? stepCard('w2cStep3', 3, 'Values and lock', 'Locked', `on ${escH(whenText(L.at))}`, 'done')
      : stepCard('w2cStep3', 3, 'Values and lock', S.canLock ? 'Ready to lock' : S.step2 ? 'After step 1' : 'After step 2', S.canLock ? 'Update values if you want, then lock' : 'Values can be updated at any time', S.canLock ? 'ready' : 'wait');

    const withS = S.rows.filter(r => r.linked), without = S.rows.filter(r => !r.linked), todo = without.filter(r => r.status === 'todo');
    const group = (label, list, tools) => (list.length ? `<div class="w2-group" data-w2c-group="${escH(label)}"><span class="eyebrow">${escH(label)}</span>${tools || ''}</div>${list.map(r => rowHTML(r, S)).join('')}` : '');
    const linkNote = withS.length || !cashData() ? '' : `<p class="help" style="margin-top:12px">No account is linked to a statement yet. <button class="btn btn-ghost btn-sm" onclick="setTab('w2-start')">Link your statements on Start here</button></p>`;
    const balances = S.rows.length ? group('With a statement', withS) + group('No statement', without, !S.isLocked && todo.length >= 3 ? `<button class="btn btn-ghost btn-sm" id="w2cSameAll" onclick="w2Check.sameAll()">All ${todo.length} the same as book</button>` : '') + linkNote
      : emptyHTML('wallet', 'No account held money or moved in this month');

    const vals = valueRows(b, M);
    const valuesHTML = vals.length ? vals.map(v => { const id = q(v.a.id);
      const note = v.v ? (v.v.month < M ? `<span class="badge warn">value from ${escH(monthLabel(v.v.month))}</span>` : '<span class="badge good">value this month</span>') : '<span class="badge">no value yet</span>';
      return `<div class="w2-row" data-w2c-val="${escH(v.a.id)}" data-v="${v.v ? v.v.value : ''}"><div class="li-body"><div class="li-title">${escH(v.a.name)}</div><div class="li-sub">What you paid: ${money(v.book)}${v.v ? ` · Worth: ${money(v.v.value)}` : ''}</div></div>
        <div class="w2-side">${note}${S.isLocked ? '' : `<button class="btn btn-secondary btn-sm" data-w2c="value" onclick="w2Check.value('${id}')">Update value</button>`}</div></div>`; }).join('')
      : '<p class="help">No investments or property in this month.</p>';
    const dec = M.slice(5) === '12';
    const means = `Locking ${escH(name)} means its entries can no longer be changed, added or removed until you unlock it.${dec ? ` Locking December also closes ${escH(M.slice(0, 4))}: the year’s income and spending move to retained earnings by themselves.` : ''}`;
    let lockBar;
    if (S.isLocked) {
      lockBar = `<p class="help" id="w2cMeans">${escH(name)} is locked: its entries cannot be changed, added or removed until you unlock it.${dec && bookLib.yearEndOf(b, M.slice(0, 4)) ? ` The year ${escH(M.slice(0, 4))} is closed. Unlocking takes the year-end entry back.` : ''}</p>
        <button class="btn btn-secondary" id="w2cUnlock" onclick="w2Check.unlock()">${ic('lock-open', 's16')}Unlock</button>`;
    } else {
      const why = S.canLock ? '' : !S.step1 ? `${plural(S.inbox, 'Inbox item')} for ${escH(short)} still ${S.inbox === 1 ? 'needs' : 'need'} an answer.`
        : S.anyway ? `${plural(S.open.length, 'statement')} ${S.open.length === 1 ? 'is' : 'are'} not in yet. Wait for ${S.open.length === 1 ? 'it' : 'them'}, or lock anyway and say why.`
        : `${plural(S.open.length, 'account')} still to look at in step 2.`;
      lockBar = `<p class="help" id="w2cMeans">${means}${why ? ` <span id="w2cWhy" style="color:var(--text-1)">${why}</span>` : ''}</p>
        ${S.anyway ? `<button class="btn btn-secondary" id="w2cAnyway" onclick="w2Check.lockAnyway()">Lock anyway</button>` : ''}
        <button class="btn btn-primary" id="w2cLock" onclick="w2Check.lock()"${S.canLock ? '' : ' disabled'}>${ic('lock', 's16')}Lock ${escH(short)}</button>`;
    }
    return `${pageHead(TITLE, DESC, hideBtn())}
      <div class="w2-bar">${stepperHTML(ms, M)}${S.isLocked ? '<span class="badge good" id="w2cLockedBadge">Locked</span>' : ''}</div>
      <div class="grid" id="w2cSteps">${s1}${s2}${s3}</div>
      <div class="grid"><section class="card span-12" id="w2cBalances">${cardHead('scale', '2 · Balances agree', `Your book against each statement for ${escH(name)}, on the statement’s own date`)}${balances}</section></div>
      <div class="grid"><section class="card span-12" id="w2cValues">${cardHead('trending-up', '3 · Values and lock', 'What investments and property are worth is optional. It feeds the Market view only')}${valuesHTML}
        <div class="w2c-lock">${lockBar}</div></section></div>`;
  }
  P.step = function (d) { const ms = months(B()), i = ms.indexOf(C.month) + d; if (i >= 0 && i < ms.length) { C.month = ms[i]; renderAll(); } };
  P.go = function (M) { if (months(B()).includes(M)) { C.month = M; renderAll(); } };
  const rowOf = id => { const S = P.state(); return S ? { S, r: S.rows.find(x => x.a.id === id) } : {}; };

  /* ── Show what differs ── */
  // The statement lines of the period with no entry, the entries on the account in the period with
  // no statement line, and what is still unexplained after both.
  function differsOf(b, r) {
    const cash = cashData(), matches = emailMatches(), ids = new Set(r.stmt.parts.map(p => p.id));
    const start = r.stmt.parts.map(p => p.start).sort()[0], end = r.stmt.date;
    const lines = (cash && Array.isArray(cash.txns) ? cash.txns : []).filter(l => ids.has(l.account) && isIDR(l) && r.stmt.parts.some(p => p.id === l.account && l.date >= p.start && l.date <= p.s.date));
    const lineIds = new Set(lines.map(l => l.id)), all = posted(b);
    // Which statement line ids already have an entry, anywhere in the book.
    const covered = new Set(), emailRefs = new Set();
    for (const e of all) {
      const s = e.source || {};
      if (s.type === 'stmt' && /^st:/.test(s.ref || '')) covered.add(s.ref.slice(3));
      if (s.type === 'email' && /^tx:stmt:/.test(s.ref || '')) covered.add(s.ref.slice(8));
      if (s.type === 'email') emailRefs.add(String(s.ref || '').slice(3));
      for (const l of e.lines) if (/^st:/.test(l.memo || '')) covered.add(l.memo.slice(3));
    }
    if (matches) for (const [lineId, tx] of Object.entries(matches)) if (emailRefs.has(tx)) covered.add(lineId);
    const txOfLine = {}; if (matches) for (const [lineId, tx] of Object.entries(matches)) if (lineIds.has(lineId)) txOfLine[tx] = lineId;
    let missing = lines.filter(l => !covered.has(l.id) && Math.round(l.amount));
    let extra = [];
    for (const e of all) {
      if (e.date < start || e.date > end) continue;
      const amount = e.lines.filter(l => l.account === r.a.id).reduce((t, l) => t + l.amount, 0); if (!amount) continue;
      const s = e.source || {}, ref = String(s.ref || '');
      const has = (s.type === 'stmt' && lineIds.has(ref.slice(3))) || e.lines.some(l => /^st:/.test(l.memo || '') && lineIds.has(l.memo.slice(3)))
        || (s.type === 'email' && (lineIds.has(ref.slice(8)) || !!txOfLine[ref.slice(3)]));
      if (!has) extra.push({ e, amount });
    }
    // The matches cannot be read: pair what is left by amount, within 3 days, so the same charge is not listed twice.
    if (!matches) {
      const used = new Set();
      extra = extra.filter(x => {
        if ((x.e.source || {}).type !== 'email') return true;
        const hit = missing.filter(l => !used.has(l.id) && Math.round(l.amount) === x.amount && dayGap(l.date, x.e.date) <= 3).sort((p, s) => dayGap(p.date, x.e.date) - dayGap(s.date, x.e.date))[0];
        if (hit) used.add(hit.id);
        return !hit;
      });
      missing = missing.filter(l => !used.has(l.id));
    }
    const sumM = missing.reduce((t, l) => t + Math.round(l.amount), 0), sumE = extra.reduce((t, x) => t + x.amount, 0);
    return { start, end, missing, extra, sumM, sumE, rest: r.diff - sumM + sumE, matches: !!matches };
  }
  P.differsData = id => { const { r } = rowOf(id); return r && r.stmt ? differsOf(B(), r) : null; };
  const inOut = n => `<span class="w2-right" style="white-space:nowrap">${n < 0 ? 'out ' : 'in '}${money(Math.abs(n))}</span>`;
  P.differs = function (id) {
    const { r, S } = rowOf(id); if (!r || !r.stmt) return;
    const d = differsOf(B(), r), item = (title, sub, n) => `<div class="list-item"><div class="li-body"><div class="li-title">${escH(title || '—')}</div><div class="li-sub">${escH(sub)}</div></div>${inOut(n)}</div>`;
    const part = (idd, head, help, list) => `<h3 class="eyebrow" style="margin:16px 0 4px">${escH(head)}</h3>${list.length ? `<div class="list" id="${idd}">${list.join('')}</div>` : `<p class="help" id="${idd}">${escH(help)}</p>`}`;
    const hasInbox = typeof PAGES !== 'undefined' && PAGES.some(p => p.key === 'w2-inbox');
    openSheet({ title: `What differs · ${r.name}`, wide: true, confirmDiscard: false,
      body: `<p class="muted" style="margin:0 0 4px">${escH(dayText(d.start))} to ${escH(dayText(d.end))}. Statement: ${money(r.sign * r.stmt.v)} · Book: ${money(r.sign * r.bookAt)} · ${money(Math.abs(r.diff))} apart.</p>
        ${part('w2cMissing', `On the statement, not in your book (${d.missing.length})`, 'Every statement line of this period has an entry.', d.missing.map(l => item(l.desc || l.counterparty, dayText(l.date), Math.round(l.amount))))}
        ${part('w2cExtra', `In your book, not on the statement (${d.extra.length})`, 'Every entry of this period is on the statement.', d.extra.map(x => item(x.e.description, dayText(x.e.date), x.amount)))}
        <div class="w2c-sum" style="margin-top:16px" id="w2cRest" data-v="${d.rest}"><span>${d.rest ? 'Still unexplained after these' : 'These explain the whole difference'}</span><b>${money(Math.abs(d.rest))}</b></div>
        <p class="help" style="margin-top:8px">${d.missing.length ? (hasInbox ? 'Answer the missing lines in the Inbox and this account will agree.' : 'Add the missing lines to your book and this account will agree.') + ' ' : ''}${d.extra.length ? 'An entry that is not on the statement may be a duplicate, or may belong to another account or month: check it in Journals. ' : ''}Adjust is the last resort.${d.matches ? '' : ' The link between your bank emails and this statement could not be read, so email rows were paired by amount and date.'}</p>`,
      foot: `${S.isLocked ? '' : `<button class="btn btn-secondary left" id="w2cDiffAdjust" onclick="closeTopSheet(true);w2Check.adjust('${q(id)}')">Adjust</button>`}${d.missing.length && hasInbox ? `<button class="btn btn-secondary" onclick="closeTopSheet(true);setTab('w2-inbox')">Open Inbox</button>` : ''}<button class="btn btn-primary" onclick="closeTopSheet(true)">Close</button>` });
  };

  /* ── Adjust (a statement account), Same as book and a counted amount (no statement) ── */
  // Posts the adjust entry that moves the account by `delta` on `date`; → its id.
  function postAdjust(w, a, delta, date, what) {
    return bookLib.post(w, bookLib.buildEntry(w, 'adjust', { date, amount: Math.abs(delta), account: a.id, dir: delta > 0 ? 'in' : 'out', description: `Month check · ${what}`, source: { type: 'manual' } }));
  }
  const undoAdjust = id => () => { try { book2Do(w => bookLib.voidEntry(w, id, 'Undone'), 'undo'); toast('Undone'); } catch (e) { toast(errText(e)); } };
  let AD = null;
  P.adjust = function (id) {
    const { r, S } = rowOf(id); if (!r || !r.stmt || !r.diff || S.isLocked) return;
    AD = { id, M: S.M };
    openSheet({ title: `Adjust · ${r.name}`, onEnter: () => P.adjustSave(),
      body: `<p class="muted" style="margin:0 0 12px">Use this only when you cannot find the cause. It adds one entry of ${money(Math.abs(r.diff))} dated ${escH(dayText(r.stmt.date))}, so your book shows ${money(r.sign * r.stmt.v)} like the statement.</p>
        <p class="help">The amount goes to “Unexplained” and shows as its own line in your results, so it cannot hide. You can void the entry later in Journals.</p>${errBox('w2cAdjErr')}`,
      foot: sheetFoot(`Adjust by ${fmtIDR(Math.abs(r.diff))}`, 'adjustSave') });
  };
  P.adjustSave = function () {
    if (!AD) return;
    const x = AD, b = B(), r = monthState(b, x.M).rows.find(q0 => q0.a.id === x.id); if (!r || !r.stmt || !r.diff) { closeTopSheet(true); return; }
    const res = change(w => { const eid = postAdjust(w, r.a, r.diff, r.stmt.date, r.name);
      bookLib.setCheck(w, { account: r.a.id, month: x.M, statement: r.stmt.v, book: r.stmt.v, ok: true, adjustedBy: eid, date: r.stmt.date, how: 'statement' }); return eid; }, 'check-adjust', 'w2cAdjErr');
    if (!res.ok) return;
    closeTopSheet(true); AD = null;
    toast(`${r.name} adjusted by ${fmtIDR(Math.abs(r.diff))}`, { action: 'Undo', onAction: undoAdjust(res.value) });
  };
  const sameCheck = (w, r, M) => bookLib.setCheck(w, { account: r.a.id, month: M, statement: null, book: r.bal, ok: true, how: 'same' });
  P.same = function (id) {
    const { r, S } = rowOf(id); if (!r || r.linked || S.isLocked) return;
    if (change(w => sameCheck(w, r, S.M), 'check-same').ok) toast(`${r.name}: same as book`);
  };
  P.sameAll = function () {
    const S = P.state(); if (!S || S.isLocked) return;
    const list = S.rows.filter(r => !r.linked && r.status === 'todo'); if (!list.length) return;
    if (change(w => { for (const r of list) sameCheck(w, r, S.M); }, 'check-same').ok) toast(`${plural(list.length, 'account')} marked the same as book`);
  };
  let CT = null;
  P.count = function (id) {
    const { r, S } = rowOf(id); if (!r || r.linked || S.isLocked) return;
    CT = { id, M: S.M };
    const debt = r.a.kind === 'liability', end = monthEnd(S.M);
    openSheet({ title: `Counted · ${r.name}`, focus: '#w2cCount', onEnter: () => P.countSave(),
      body: `<p class="muted" style="margin:0 0 14px">${debt ? 'Type what you owed' : 'Type what was there'} at the end of ${escH(dayText(end))}. Your book says ${money(r.sign * r.bal)}. A difference is added as one entry to “Unexplained”, dated that day.</p>
        <div class="form-grid"><div class="field full"><label class="label" for="w2cCount">${debt ? 'Amount owed' : 'Counted amount'}</label>${rpInput('w2cCount', null)}</div>${errBox('w2cCountErr')}</div>`,
      foot: sheetFoot('Save', 'countSave') });
  };
  P.countSave = function () {
    if (!CT) return;
    const x = CT, b = B(), r = monthState(b, x.M).rows.find(q0 => q0.a.id === x.id), raw = el('w2cCount').value, n = typeof meParse === 'function' ? meParse(raw) : Number(String(raw).replace(/[^\d]/g, ''));
    if (!r) { closeTopSheet(true); return; }
    if (!String(raw).trim() || !(typeof n === 'number' && Number.isInteger(n) && n >= 0)) { showErr('w2cCountErr', 'Enter the amount in whole rupiah (0 or more)'); return; }
    const target = r.sign * n, delta = target - r.bal;
    const res = change(w => { const eid = delta ? postAdjust(w, r.a, delta, monthEnd(x.M), r.name) : null;
      bookLib.setCheck(w, { account: r.a.id, month: x.M, statement: null, book: target, ok: true, how: 'counted', ...(eid ? { adjustedBy: eid } : {}) }); return eid; }, 'check-count', 'w2cCountErr');
    if (!res.ok) return;
    closeTopSheet(true); CT = null;
    if (delta) toast(`${r.name}: counted ${fmtIDR(n)}, adjusted by ${fmtIDR(Math.abs(delta))}`, { action: 'Undo', onAction: undoAdjust(res.value) });
    else toast(`${r.name}: counted, same as book`);
  };

  /* ── Values ── */
  let VA = null;
  P.value = function (id) {
    const b = B(), a = b && b.accounts[id]; if (!a || !C.month || locked(b, C.month)) return;
    const cur = valuesAt(b, C.month)[id];
    VA = { id, name: a.name, M: C.month };
    openSheet({ title: `Update value · ${a.name}`, focus: '#w2cVal', onEnter: () => P.valueSave(),
      body: `<p class="muted" style="margin:0 0 14px">Type what it was worth at the end of ${escH(mLong(C.month))}. This feeds the Market view only. It never changes what you paid.${cur ? ` Last value: ${money(cur.value)} for ${escH(monthLabel(cur.month))}.` : ''}</p>
        <div class="form-grid"><div class="field full"><label class="label" for="w2cVal">Value</label>${rpInput('w2cVal', cur ? cur.value : null)}</div>${errBox('w2cValErr')}</div>`,
      foot: sheetFoot('Save value', 'valueSave') });
  };
  P.valueSave = function () {
    if (!VA) return;
    const x = VA, raw = el('w2cVal').value, n = meParse(raw);
    if (!String(raw).trim() || !(typeof n === 'number' && Number.isInteger(n) && n >= 0)) { showErr('w2cValErr', 'Enter the value in whole rupiah'); return; }
    if (!change(w => bookLib.setValue(w, x.id, x.M, n), 'value', 'w2cValErr').ok) return;
    closeTopSheet(true); VA = null;
    toast(`${x.name}: ${fmtIDR(n)} for ${monthLabel(x.M)}`);
  };

  /* ── Lock and unlock ── */
  // Stores every row's result, then locks. `reason` is given only by Lock anyway.
  function doLock(S, reason) {
    return change(w => {
      for (const r of S.rows) {
        if (r.stmt) bookLib.setCheck(w, { account: r.a.id, month: S.M, statement: r.stmt.v, book: r.bookAt, ok: !r.diff, date: r.stmt.date, how: 'statement', ...(r.adjustedBy ? { adjustedBy: r.adjustedBy } : {}) });
        else if (r.status === 'missing') bookLib.setCheck(w, { account: r.a.id, month: S.M, statement: null, book: r.bal, ok: false, how: 'not-in-yet', note: reason || r.why });
      }
      bookLib.lock(w, S.M);
    }, 'lock', reason ? 'w2cAnyErr' : null);
  }
  const lockedToast = (b, M) => toast(`${mLong(M)} is locked${M.slice(5) === '12' && bookLib.yearEndOf(b, M.slice(0, 4)) ? ` and ${M.slice(0, 4)} is closed` : ''}`);
  P.lock = function () {
    const S = P.state(); if (!S || S.isLocked) return;
    if (!S.canLock) { toast('Finish steps 1 and 2 first'); return; }
    if (doLock(S).ok) lockedToast(B(), S.M);
  };
  P.lockAnyway = function () {
    const S = P.state(); if (!S || S.isLocked || !S.anyway) return;
    openSheet({ title: `Lock ${mLong(S.M)} anyway`, focus: '#w2cAnyWhy', onEnter: () => P.lockAnywaySave(),
      body: `<p class="muted" style="margin:0 0 14px">${plural(S.open.length, 'account')} ${S.open.length === 1 ? 'has' : 'have'} no statement for this month yet: ${escH(S.open.map(r => r.name).join(', '))}. The month is locked without that check, and your reason is kept with it.</p>
        <div class="form-grid"><div class="field full"><label class="label" for="w2cAnyWhy">Why lock without the statement?</label><input class="input" id="w2cAnyWhy" maxlength="120" autocomplete="off"></div>${errBox('w2cAnyErr')}</div>`,
      foot: sheetFoot('Lock anyway', 'lockAnywaySave') });
  };
  P.lockAnywaySave = function () {
    const S = P.state(), why = (el('w2cAnyWhy') ? el('w2cAnyWhy').value : '').trim(); if (!S || !S.anyway) { closeTopSheet(true); return; }
    if (!why) { showErr('w2cAnyErr', 'Say why, so the history explains it'); return; }
    if (!doLock(S, why).ok) return;
    closeTopSheet(true); lockedToast(B(), S.M);
  };
  P.unlock = function () {
    const b = B(), M = C.month; if (!b || !M || !locked(b, M)) return;
    const dec = M.slice(5) === '12' && bookLib.yearEndOf(b, M.slice(0, 4));
    openSheet({ title: `Unlock ${mLong(M)}`, focus: '#w2cUnWhy', onEnter: () => P.unlockSave(),
      body: `<p class="muted" style="margin:0 0 14px">Its entries can be changed again until you lock it once more.${dec ? ` The year-end entry for ${escH(M.slice(0, 4))} is taken back and made again when you lock December.` : ''} The reason is kept in the history.</p>
        <div class="form-grid"><div class="field full"><label class="label" for="w2cUnWhy">Why are you unlocking it?</label><input class="input" id="w2cUnWhy" maxlength="120" autocomplete="off"></div>${errBox('w2cUnErr')}</div>`,
      foot: sheetFoot('Unlock', 'unlockSave') });
  };
  P.unlockSave = function () {
    const M = C.month, why = (el('w2cUnWhy') ? el('w2cUnWhy').value : '').trim();
    if (!why) { showErr('w2cUnErr', 'Give a reason for unlocking the month'); return; }
    if (!change(w => bookLib.unlock(w, M, why), 'unlock', 'w2cUnErr').ok) return;
    closeTopSheet(true); toast(`${mLong(M)} is unlocked`);
  };

  // Opening the page (from any other page) starts again on the oldest month that is not locked;
  // staying on it keeps the month the owner picked, even after locking it.
  if (typeof registerHook === 'function') registerHook('beforeRender', () => { if (typeof ACTIVE_TAB !== 'undefined' && ACTIVE_TAB !== 'w2-check') C.month = null; });
  registerPage({ key: 'w2-check', label: 'Month check', icon: 'calendar-check', group: 'w2', order: 45, render });
})();
