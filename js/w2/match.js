/* ExpenseTrack v6 — the Inbox of the new book (docs/v6-book.md §9.2): page w2-inbox and the public
   functions book2Inbox, book2InboxCount and book2InboxRun.

   Reads the statement lines the app already holds (the cash data behind Cash movements, through
   CM()), the email-to-statement matches the original statement module computed
   (ETStatements.last()) and the owner's own types in Cash movements, and decides per line: covered
   by an email entry, answered automatically, or waiting for the owner. Nothing is matched again
   here; the original's matches are used as they are.

   Read-only towards everything old (§0): this file never writes STATE, never calls
   scheduleDriveSave() or a mutating ledger* or cash function and registers no transform. Every
   change goes through book2Do. One source, one entry: an entry made from a statement line has
   source {type:'stmt', ref:'st:'+line id}. The entry's line on the linked account carries the memo
   'st:<line id>' ('auto st:<line id>' when the app answered by itself); a paired card payment or
   own transfer carries the second line's id the same way on its other line, because the engine
   keeps only one source ref per entry. No personal data in this file: the repo is public. */
(function () {
  'use strict';
  if (typeof bookLib === 'undefined' || typeof BOOK2 !== 'function' || typeof book2Do !== 'function' || typeof registerPage !== 'function' || typeof registerHook !== 'function') {
    console.warn('ExpenseTrack preview: the new book store is not loaded, so the Inbox stays off.');
    return;
  }
  const I = window.w2Inbox = {};

  /* ── Small helpers ── */
  const cp = o => JSON.parse(JSON.stringify(o));
  const nowIso = () => new Date().toISOString();
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const errText = e => (e && Array.isArray(e.errors) && e.errors.length ? e.errors.join(' · ') : String((e && e.message) || e));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const el = id => document.getElementById(id);
  const q = s => escAttr(s);
  const live = o => Object.values(o || {}).filter(x => x && !x.deleted);
  const usable = a => !!a && !a.header && !a.hidden && !a.deleted;
  const dayNo = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
  const dayText = iso => { try { return fmtDay(new Date(String(iso).slice(0, 10) + 'T00:00:00')); } catch (_) { return String(iso || ''); } };
  const signed = n => `<span class="amt">${n < 0 ? '−' : '+'}${fmtIDR(Math.abs(n))}</span>`;
  const byCode = (a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }) || String(a.name).localeCompare(String(b.name));
  const dataReady = () => typeof DATA_READY !== 'undefined' && !!DATA_READY;

  /* ── The old data, read only ── */
  const cash = () => { try { const c = typeof CM === 'function' ? CM() : null; return c && Array.isArray(c.txns) && Array.isArray(c.accounts) ? c : null; } catch (_) { return null; } };
  const recon = () => { try { return typeof ETStatements === 'object' && ETStatements && typeof ETStatements.last === 'function' ? ETStatements.last() : null; } catch (_) { return null; } };
  const typeOf = l => (typeof cashType === 'function' ? cashType(l) : l.type);
  const payerOf = l => (typeof cashPayerKey === 'function' ? cashPayerKey(l) : clean(l.counterparty || l.desc).toUpperCase().slice(0, 60));
  const oldState = () => (typeof STATE === 'object' && STATE) || {};
  // The type the owner set for this line or its payer in Cash movements (null when the reader's type stands).
  const ownerType = l => (oldState().cashTypeOverrides || {})[l.id] || (oldState().cashPayerRules || {})[payerOf(l)] || null;
  const guess = text => (typeof categorize === 'function' ? categorize(text) : 'Others');

  /* ── Answers ── */
  const UNDO_WHY = 'Undone', KEEP_WHY = 'Kept as spending: not on a statement', UNKEEP_WHY = 'Back to the Inbox', REMOVE_WHY = 'Removed: not on a statement', HOLD_WHY = 'Inbox: not a move between my accounts';
  const PERSON = ['paid-for', 'lent', 'reimburse', 'repaid-in', 'borrowed', 'repaid-out'];
  const TO = ['transfer', 'card-payment', 'invest-buy', 'invest-sell'];
  // The direction an answer needs (null = either way).
  const KDIR = { spending: null, fee: null, 'paid-for': 'out', lent: 'out', reimburse: 'out', split: 'out', 'repaid-out': 'out', 'repaid-in': 'in', borrowed: 'in', income: 'in',
    transfer: null, 'card-payment': null, 'invest-buy': 'out', 'invest-sell': 'in' };
  const BTN = { spending: 'Spending', lent: 'Lent', 'paid-for': 'Paid for…', 'repaid-out': 'Repaid a debt', transfer: 'Between my accounts', 'card-payment': 'Card payment', 'invest-buy': 'Investment',
    split: 'Split', reimburse: 'Company will reimburse', fee: 'Fee', income: 'Income', 'repaid-in': 'Got repaid', borrowed: 'Borrowed', 'invest-sell': 'Investment sold', refund: 'Refund' };
  const ICON = { spending: 'shopping-bag', lent: 'arrow-left-right', 'paid-for': 'circle-user', 'repaid-out': 'repeat', transfer: 'arrow-left-right', 'card-payment': 'credit-card', 'invest-buy': 'trending-up',
    split: 'split', reimburse: 'landmark', fee: 'receipt', income: 'chart-column', 'repaid-in': 'repeat', borrowed: 'circle-user', 'invest-sell': 'trending-up', refund: 'receipt' };
  const MAIN = { out: ['spending', 'lent', 'paid-for'], in: ['income', 'repaid-in', 'borrowed'] };
  const MORE = { out: ['repaid-out', 'transfer', 'card-payment', 'invest-buy', 'split', 'reimburse', 'fee'], in: ['transfer', 'card-payment', 'invest-sell', 'refund'] };
  const btnKind = (kind, dir) => (kind === 'spending' && dir === 'in' ? 'refund' : kind);
  const accountsOf = (b, roles) => live(b.accounts).filter(a => usable(a) && roles.includes(a.role)).sort(byCode);
  // Whether an answer can be posted for this line as it is, without asking anything.
  function complete(b, it, s) {
    if (!s || !(s.kind in KDIR) || (KDIR[s.kind] && KDIR[s.kind] !== it.dir)) return false;
    if (s.kind === 'spending') return !!s.category;
    if (s.kind === 'fee' || s.kind === 'income') return true;
    if (PERSON.includes(s.kind)) return !!(b.people[s.person] && !b.people[s.person].deleted);
    if (TO.includes(s.kind)) return usable(b.accounts[s.toAccount]) && s.toAccount !== it.bookAccount;
    return false;   // a split always asks for the parts
  }
  // "Spending · Groceries", "Lent · Person A", …
  function answerText(b, s, dir) {
    if (!s) return '';
    const name = id => (b.accounts[id] ? b.accounts[id].name : ''), who = id => (b.people[id] ? b.people[id].name : '');
    const head = BTN[btnKind(s.kind, dir)] || s.kind;
    const tail = s.kind === 'spending' || s.kind === 'fee' || s.kind === 'split' ? (s.category || '') : PERSON.includes(s.kind) ? who(s.person) : s.kind === 'income' ? (s.incomeType || '') : TO.includes(s.kind) ? name(s.toAccount) : '';
    return String(head).replace('…', '') + (tail ? ' · ' + tail : '');
  }
  // The answer an entry stands for, read from its lines (for the Answered tabs).
  function answerOfEntry(b, e, it) {
    const accs = (e.lines || []).map(l => b.accounts[l.account]).filter(Boolean), s = { kind: e.kind };
    const exp = accs.find(a => a.kind === 'expense'), per = accs.find(a => a.person), inc = accs.find(a => a.kind === 'income');
    const other = accs.find(a => a.id !== it.bookAccount && (a.kind === 'asset' || a.kind === 'liability') && !a.person);
    if (exp) s.category = exp.category || exp.name;
    if (per) s.person = per.person;
    if (inc) s.incomeType = inc.incomeType || inc.name;
    if (other) s.toAccount = other.id;
    return s;
  }

  /* ── The book, indexed once per scan ── */
  function indexBook(b) {
    const bySt = {}, held = {}, byEmail = {}, removed = {};
    for (const e of Object.values(b.entries || {})) {
      if (!e || e.deleted) continue;
      const s = e.source || {}, refs = [];
      for (const l of e.lines || []) { const m = /^(auto )?st:(.+)$/.exec(l.memo || ''); if (m) refs.push({ ref: m[2], auto: !!m[1] }); }
      if (s.type === 'stmt' && String(s.ref || '').indexOf('st:') === 0 && !refs.some(r => r.ref === s.ref.slice(3))) refs.push({ ref: s.ref.slice(3), auto: false });
      if (e.status === 'posted') { for (const r of refs) bySt[r.ref] = { e, auto: r.auto }; if (s.type === 'email') byEmail[s.ref] = e; }
      else if (e.status === 'void') {
        // An automatic answer the owner took back is never given again by itself. (Undo right after
        // saving a rule takes the rule back too, so nothing would answer those lines again anyway.)
        const h = e.history || [];
        if (String((h[h.length - 1] || {}).why || '') !== UNDO_WHY) for (const r of refs) if (r.auto) held[r.ref] = true;
        if (s.type === 'email' && String((h[h.length - 1] || {}).why || '') === REMOVE_WHY && (!removed[s.ref] || String(e.at) > String(removed[s.ref].at))) removed[s.ref] = e;
      }
    }
    return { bySt, held, byEmail, removed };
  }
  const lastWhy = (e, list) => { for (const h of (e.history || []).slice().reverse()) if (list.includes(h.why)) return h.why; return null; };

  /* ── The scan: every statement line in scope, sorted into waiting, automatic, answered, covered ── */
  let CACHE = null;
  const FAILED = new Set();     // automatic answers the engine refused in this session: not tried again
  function scan() {
    const b = BOOK2(), c = cash(), R = recon();
    const key = [c ? c.generatedAt + '#' + c.txns.length + '#' + (c.statements || []).length : '', JSON.stringify([oldState().cashTypeOverrides || {}, oldState().cashPayerRules || {}]), dataReady(), FAILED.size].join('|');
    if (CACHE && CACHE.b === b && CACHE.c === c && CACHE.R === R && CACHE.key === key) return CACHE.out;
    const out = { items: [], auto: [], answered: [], covered: [], link: [], foreign: [], todo: [], noMatch: [], loading: !dataReady(), hasCash: !!c };
    if (!b) return out;
    const st = b.settings || {}, from = String(st.syncFrom || ''), map = st.stmtMap || {}, bankMap = st.bankMap || {}, ix = indexBook(b);
    const accById = new Map((c ? c.accounts : []).map(a => [a.id, a])), lineById = new Map((c ? c.txns : []).map(l => [l.id, l]));
    const labelOf = id => { const a = accById.get(id); return a ? (a.label || a.id) : String(id || ''); };
    const matchOf = {}; for (const m of (R && R.matches) || []) if (m && m.line) matchOf[m.line.id] = m;
    // Statement accounts whose book account also takes email rows, but which the original app does
    // not check against those emails: a charge may then be here and among the email rows.
    const noMatch = new Set();
    for (const [sid, aid] of Object.entries(map)) if (usable(b.accounts[aid]) && Object.values(bankMap).includes(aid) && !((R && R.accounts) || []).includes(sid)) noMatch.add(sid);
    const waiting = {};
    if (c && from) for (const l of c.txns) {
      if (!l || l.id == null || !l.date || l.date < from) continue;
      const a = accById.get(l.account) || {}, amount = Math.round(l.amount);
      if ((l.currency || 'IDR') !== 'IDR' || (a.currency || 'IDR') !== 'IDR') { out.foreign.push({ line: l.id, account: l.account, date: l.date }); continue; }
      if (!amount) continue;
      const it = { id: 'st:' + l.id, type: 'line', line: l.id, account: l.account, accountLabel: labelOf(l.account), accountKind: a.kind || 'account', bookAccount: usable(b.accounts[map[l.account]]) ? map[l.account] : null,
        date: l.date, amount, dir: amount < 0 ? 'out' : 'in', payer: payerOf(l), description: clean(l.counterparty || l.desc) || 'Statement line', detail: clean(l.desc), cashType: typeOf(l), readerType: l.type, pair: l.match || null, flags: [] };
      const ans = ix.bySt[l.id];
      if (ans) { it.entry = ans.e.id; it.answer = answerOfEntry(b, ans.e, it); it.fromEmail = (ans.e.source || {}).type === 'email'; (ans.auto ? out.auto : out.answered).push(it); continue; }
      if (!it.bookAccount) { out.link.push({ line: l.id, account: l.account, date: l.date }); continue; }
      const m = matchOf[l.id];
      if (m) { const e = ix.byEmail['tx:' + m.key]; it.row = m.key; it.entry = e ? e.id : null; out.covered.push(it); continue; }
      // The other side of a pair whose email row already became the move between the two accounts:
      // that entry holds this line too, even when the original's matches cannot be read right now.
      const pe = it.pair ? ix.bySt[it.pair] : null, ps = pe ? pe.e.source || {} : {};
      if (pe && ps.type === 'email' && TO.includes(pe.e.kind) && pe.e.lines.some(x => x.account === it.bookAccount)) { it.row = String(ps.ref).slice(3); it.entry = pe.e.id; out.covered.push(it); continue; }
      waiting[l.id] = it;
    }
    const invs = accountsOf(b, ['investment']), cashAccs = accountsOf(b, ['cash']);
    const fixed = ty => (ty === 'fee' ? { kind: 'fee', category: 'Bank fees' } : ty === 'card-interest' ? { kind: 'fee', category: 'Card interest' } : ty === 'tax' ? { kind: 'spending', category: 'Tax' } : null);
    const earned = (ty, dir) => (dir !== 'in' ? null : ty === 'interest' ? { kind: 'income', incomeType: 'Interest' } : ty === 'cashback' ? { kind: 'income', incomeType: 'Cashback' } : null);
    // What a type of the statement reader (or the owner's own type in Cash movements) stands for.
    function typeAnswer(it, l, ty) {
      const text = l.counterparty || l.desc, moved = ty === 'card-payment' || ty === 'own-transfer';
      if (fixed(ty) || earned(ty, it.dir)) return fixed(ty) || earned(ty, it.dir);
      if (ty === 'spend' || ty === 'refund') return { kind: 'spending', category: guess(text) };
      if (ty === 'ewallet') return it.dir === 'out' ? { kind: 'spending', category: 'E-wallet' } : null;
      if (ty === 'income-business') return it.dir === 'in' ? { kind: 'income', incomeType: 'Business income' } : null;
      if (ty === 'investment-out') return it.dir === 'out' && invs.length ? { kind: 'invest-buy', toAccount: invs.length === 1 ? invs[0].id : null } : null;
      if (ty === 'investment-in') return it.dir === 'in' && invs.length ? { kind: 'invest-sell', toAccount: invs.length === 1 ? invs[0].id : null } : null;
      if (ty === 'cash') return it.dir === 'out' && cashAccs.length === 1 ? { kind: 'transfer', toAccount: cashAccs[0].id } : null;
      if (moved) { const p = lineById.get(it.pair), other = p && usable(b.accounts[map[p.account]]) ? map[p.account] : null; return { kind: ty === 'card-payment' ? 'card-payment' : 'transfer', toAccount: other && other !== it.bookAccount ? other : null }; }
      return null;   // transfers to and from people, other money in or out: the owner chooses
    }
    function autoAnswer(it, l) {
      const ty = it.cashType;
      const rule = it.payer ? (b.rules || []).filter(r => r && !r.deleted && r.match && r.match.payer === it.payer && (!r.match.dir || r.match.dir === it.dir))
        .sort((x, y) => String(y.at).localeCompare(String(x.at)) || String(y.id).localeCompare(String(x.id)))[0] : null;
      if (rule && complete(b, it, rule.answer)) return { answer: cp(rule.answer), why: 'rule' };
      if (fixed(ty) || earned(ty, it.dir)) return { answer: fixed(ty) || earned(ty, it.dir), why: 'type' };
      if ((ty !== 'card-payment' && ty !== 'own-transfer') || !it.pair) return null;
      const kind = ty === 'card-payment' ? 'card-payment' : 'transfer', p = waiting[it.pair], pl = lineById.get(it.pair);
      // Both lines of a pair the statement reader made, on two linked accounts: one entry.
      if (p && p.dir !== it.dir && Math.abs(p.amount) === Math.abs(it.amount) && p.bookAccount !== it.bookAccount && !ix.held[p.line]) return { answer: { kind, toAccount: p.bookAccount }, why: 'pair', pair: p.line, lead: it.dir === 'out' };
      // The paying side is already one of the email rows: that row's entry becomes the move.
      const m = pl && matchOf[pl.id], e = m && ix.byEmail['tx:' + m.key], src = pl && map[pl.account];
      if (e && it.dir === 'in' && e.kind === 'spending' && usable(b.accounts[src]) && src !== it.bookAccount && !lastWhy(e, [HOLD_WHY]) && e.lines.length === 2 && e.lines.some(x => x.account === src && x.amount === -it.amount))
        return { answer: { kind, toAccount: src }, why: 'pair', email: e.id, lead: true };
      return null;
    }
    function suggestFor(it, l) {
      const own = ownerType(l); let s = own ? typeAnswer(it, l, own) : null, why = 'cash';
      if (!s) {
        const h = it.payer ? bookLib.suggest(b, { payer: it.payer, dir: it.dir }) : null;
        if (h && h.kind in KDIR && (!KDIR[h.kind] || KDIR[h.kind] === it.dir)) { if (TO.includes(h.kind) && h.toAccount === it.bookAccount) delete h.toAccount; s = h; why = 'history'; }
      }
      if (!s) { s = typeAnswer(it, l, l.type); why = 'reader'; }
      return s ? { ...s, why, complete: complete(b, it, s) } : null;
    }
    for (const it of Object.values(waiting)) {
      const l = lineById.get(it.line);
      if (ix.held[it.line]) it.flags.push('held');
      if (bookLib.lockState(b, it.date.slice(0, 7)) === 'locked') it.flags.push('locked');
      if (noMatch.has(it.account) && it.dir === 'out' && ['spend', 'ewallet', 'cash', 'other-out', 'transfer-out'].includes(it.cashType)) it.flags.push('nomatch');
      const auto = autoAnswer(it, l);
      it.suggestion = auto ? { ...auto.answer, why: auto.why, complete: true } : suggestFor(it, l);
      // A 'nomatch' line may already be one of the email rows, so even a saved rule only suggests (§9.2).
      if (auto && auto.lead !== false && !['held', 'locked', 'nomatch'].some(f => it.flags.includes(f)) && !FAILED.has(it.id)) { it.auto = auto; out.todo.push(it); }
      out.items.push(it);
    }
    out.noMatch = [...noMatch].filter(sid => out.items.some(i => i.account === sid && i.flags.includes('nomatch'))).map(labelOf);
    // Email alerts the original app could not find on a closed statement (its review list).
    for (const r of (R && R.review) || []) {
      if (!r || r.decision === 'keep') continue;
      const ref = 'tx:' + r.key, e = ix.byEmail[ref], gone = !e && ix.removed[ref], x = e || gone;
      if (!x) continue;
      const stm = ((R.stmts || {})[r.stmtId]) || {}, ml = (x.lines || []).find(l => l.amount < 0) || {}, amount = -Math.abs(ml.amount || 0);
      const it = { id: 'al:' + r.key, type: 'alert', row: r.key, entry: x.id, account: r.account, accountLabel: labelOf(r.account), bookAccount: ml.account || null, date: x.date, amount, dir: 'out', payer: '',
        description: x.description || 'Email alert', detail: '', stmtDate: stm.end || null, excluded: r.decision === 'exclude', flags: bookLib.lockState(b, String(x.date).slice(0, 7)) === 'locked' ? ['locked'] : [] };
      if (gone) { it.state = 'removed'; out.answered.push(it); }
      else if (lastWhy(e, [KEEP_WHY, UNKEEP_WHY]) === KEEP_WHY) { it.state = 'kept'; out.answered.push(it); }
      else out.items.push(it);
    }
    const newest = (x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : String(x.id).localeCompare(String(y.id)));
    for (const k of ['items', 'auto', 'answered', 'covered']) out[k].sort(newest);
    CACHE = { b, c, R, key, out };
    return out;
  }

  /* ── Public: what is waiting ── */
  function book2Inbox(o) {
    o = o || {}; const S = scan();
    const f = x => (!o.month || String(x.date).slice(0, 7) === o.month) && (!o.account || x.account === o.account || x.bookAccount === o.account);
    return { items: S.items.filter(f), auto: S.auto.filter(f), answered: S.answered.filter(f), covered: S.covered.filter(f), waitingLink: S.link.filter(f).length, foreign: S.foreign.filter(f).length,
      unmatched: S.noMatch.slice(), loading: S.loading };
  }
  const book2InboxCount = month => { try { return book2Inbox(month ? { month } : {}).items.length; } catch (_) { return 0; } };

  /* ── Lines → entries ── */
  function build(w, it, ans, auto, t) {
    const k = ans.kind, mine = it.bookAccount, other = ans.toAccount;
    const d = { date: it.date, amount: Math.abs(it.amount), account: mine, dir: it.dir, description: it.description, source: { type: 'stmt', ref: it.id } };
    if (it.payer) d.payer = it.payer;
    if (k === 'spending' || k === 'fee') d.category = ans.category || (k === 'fee' ? 'Bank fees' : '');
    else if (PERSON.includes(k)) d.person = ans.person;
    else if (k === 'split') { d.person = ans.person; d.share = ans.share; d.category = ans.category; }
    else if (k === 'income') { d.incomeType = ans.incomeType || 'Other income'; if (ans.taxWithheld) d.taxWithheld = ans.taxWithheld; }
    else if (k === 'transfer' || k === 'card-payment') { if (it.dir === 'in') { d.account = other; d.toAccount = mine; d.dir = 'out'; } else d.toAccount = other; }
    else if (k === 'invest-buy') d.toAccount = other;
    else if (k === 'invest-sell') { d.toAccount = other; if (ans.cost) d.cost = ans.cost; }
    const e = bookLib.buildEntry(w, k, d, t);
    e.dir = it.dir;
    const ml = e.lines.find(l => l.account === mine); if (ml) ml.memo = (auto ? 'auto ' : '') + it.id;
    return e;
  }
  const tagOther = (e, account, line, auto) => { const l = e.lines.find(x => x.account === account && !x.memo); if (l) l.memo = (auto ? 'auto ' : '') + 'st:' + line; };
  function postAuto(w, it, t) {
    const a = it.auto;
    if (a.email) {
      const e = w.entries[a.email];
      const n = bookLib.buildEntry(w, a.answer.kind, { date: e.date, amount: Math.abs(it.amount), account: a.answer.toAccount, toAccount: it.bookAccount, dir: 'out', description: e.description, source: e.source }, t);
      tagOther(n, it.bookAccount, it.line, true);
      return bookLib.edit(w, e.id, { kind: n.kind, lines: n.lines }, 'Inbox: the statement shows a move between your accounts', t);
    }
    const e = build(w, it, a.answer, true, t);
    if (a.pair) tagOther(e, a.answer.toAccount, a.pair, true);
    return bookLib.post(w, e, t);
  }
  // Posts the automatic answers. Idempotent: an answered line is found by its source and left alone.
  function book2InboxRun() {
    const r = { posted: 0, pairs: 0, rules: 0, locked: 0, failed: 0 };
    if (!BOOK2() || (typeof book2Status === 'function' && book2Status() === 'blocked')) return r;
    const S = scan();
    r.locked = S.items.filter(i => i.type === 'line' && i.flags.includes('locked') && i.suggestion && ['rule', 'type', 'pair'].includes(i.suggestion.why)).length;
    if (!S.todo.length) return r;
    let firstErr = null; const NONE = {};
    try {
      book2Do(w => {
        const t = nowIso();
        for (const it of S.todo) {
          try { postAuto(w, it, t); r.posted++; if (it.auto.why === 'pair') r.pairs++; if (it.auto.why === 'rule') r.rules++; }
          catch (e) { r.failed++; FAILED.add(it.id); if (!firstErr) firstErr = e; }
        }
        if (!r.posted) throw NONE;   // nothing went in: leave the book exactly as it was
      }, 'inbox-auto');
    } catch (e) { if (e !== NONE) throw e; }
    if (firstErr) console.warn('ExpenseTrack preview: ' + r.failed + ' statement line(s) could not be answered automatically: ' + errText(firstErr));
    return r;
  }
  // A waiting line on the other account that is the same move seen from there (same amount, other way, within 3 days).
  function twinOf(S, it, other, used) {
    const fit = x => x.type === 'line' && x.id !== it.id && !used.has(x.id) && x.bookAccount === other && x.dir !== it.dir && Math.abs(x.amount) === Math.abs(it.amount) && Math.abs(dayNo(x.date) - dayNo(it.date)) <= 3;
    return S.items.find(x => fit(x) && x.line === it.pair) || S.items.find(fit) || null;
  }
  const ruleOf = a => { const r = { kind: a.kind }; for (const k of ['category', 'person', 'incomeType', 'toAccount']) if (a[k]) r[k] = a[k]; return r; };
  const ruleMates = (S, items) => { const f = items[0], ids = new Set(items.map(i => i.id)); return f && f.payer ? S.items.filter(x => x.type === 'line' && !ids.has(x.id) && x.payer === f.payer && x.dir === f.dir && !x.flags.includes('locked')) : []; };
  // Answers the given waiting lines. o.rule also saves "always for this payer" and answers that
  // payer's other waiting lines; o.replace voids an earlier answer first (Change).
  function answer(items, ans, o) {
    o = o || {}; const res = { ids: [], rule: null, extra: 0 }, S = scan(), used = new Set(items.map(i => i.id));
    book2Do(w => {
      const t = nowIso(), a = { ...ans };
      if (a.pick) { a.person = a.pick.id || bookLib.addPerson(w, { name: a.pick.name, type: a.pick.type }, t); delete a.pick; }
      if (o.replace && !bookLib.voidEntry(w, o.replace, 'Changed', t)) throw new Error('That answer was already taken back');
      for (const it of items) {
        const e = build(w, it, a, false, t);
        if (a.kind === 'transfer' || a.kind === 'card-payment') { const tw = twinOf(S, it, a.toAccount, used); if (tw) { used.add(tw.id); tagOther(e, a.toAccount, tw.line, false); } }
        res.ids.push(bookLib.post(w, e, t));
      }
      if (o.rule) {
        res.rule = bookLib.addRule(w, { match: { payer: items[0].payer, dir: items[0].dir }, answer: ruleOf(a) }, t);
        for (const x of ruleMates(S, items)) { res.ids.push(bookLib.post(w, build(w, x, a, true, t), t)); res.extra++; }
      }
    }, 'inbox-answer');
    return res;
  }
  const undo = res => () => {
    try {
      book2Do(w => { for (const id of res.ids) bookLib.voidEntry(w, id, UNDO_WHY); if (res.rule) bookLib.removeRule(w, res.rule); }, 'inbox-undo');
      toast('Undone. Back in the Inbox.');
    } catch (e) { toast(errText(e)); }
  };
  const itemById = id => { const S = scan(); return S.items.find(x => x.id === id) || S.auto.find(x => x.id === id) || S.answered.find(x => x.id === id) || null; };

  /* ════════════════ Page: Inbox (w2-inbox) ════════════════ */
  const V = { tab: 'waiting', filter: 'all', account: '', q: '', sel: new Set(), limit: 100 };
  if (!el('w2InboxStyle')) {
    // Layout only, from the existing tokens. No colours, fonts or icons added.
    const st = document.createElement('style'); st.id = 'w2InboxStyle';
    st.textContent = `
      .w2i-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:16px}
      .w2i-bar .seg{max-width:100%;overflow-x:auto;scrollbar-width:none}
      .w2i-bar .seg::-webkit-scrollbar{display:none}
      .w2i-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 12px;align-items:start;padding:12px var(--card-pad);border-top:1px solid var(--border)}
      .w2i-row.selected{background:var(--accent-soft)}
      .w2i-row .li-title,.w2i-row .li-sub{overflow-wrap:anywhere}
      .w2i-pick{display:flex;align-items:center;min-height:24px}
      .w2i-pick input{width:18px;height:18px;accent-color:var(--accent)}
      .w2i-amt{font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right}
      .w2i-acts{grid-column:2 / -1;display:flex;flex-wrap:wrap;gap:6px}
      .w2i-notes{padding:0 var(--card-pad) 12px}
      .w2i-notes .help{margin-top:6px}
      .w2i-sel{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px var(--card-pad);border-top:1px solid var(--border);background:var(--surface-2)}
      .w2i-sel .grow{flex:1 1 0;min-width:0;font-size:14px;font-weight:500}
      @media (max-width:767px){.w2i-row{padding:12px 16px}.w2i-notes,.w2i-sel{padding-left:16px;padding-right:16px}
        #w2iTabs,#w2iFilter{flex-wrap:wrap;overflow:visible;max-width:100%;border-radius:var(--radius-sm)}}`;
    document.head.appendChild(st);
  }
  function gate(title, desc) {
    const st = typeof book2Status === 'function' ? book2Status() : 'none';
    if (BOOK2() && st !== 'blocked') return null;
    const go = `<button class="btn btn-primary btn-sm" id="w2GoStart" onclick="setTab('w2-start')">Open Start here</button>`;
    const inner = typeof USER_EMAIL !== 'string' || !USER_EMAIL ? emptyHTML('lock', 'Sign in to see the new book')
      : st === 'idle' || st === 'loading' ? '<div class="skel" style="width:60%;height:14px"></div><div class="skel" style="width:40%;height:14px;margin-top:10px"></div>'
      : `<div class="empty">${ic('inbox', 's40')}<div class="e-title">${st === 'blocked' ? 'The new book can’t be opened. Your current book is not affected.' : st === 'error' ? 'Couldn’t reach Google Drive. Try again from Start here.' : 'The new book is not set up yet. Start here copies your current book into it.'}</div>${go}</div>`;
    return `${pageHead(title, desc)}<div class="grid"><section class="card span-12" data-w2-state="${escH(st)}"${st === 'idle' || st === 'loading' ? ' aria-busy="true"' : ''}>${inner}</section></div>`;
  }
  const WHY = { cash: 'you set this in Cash movements', history: 'you answered this payer the same way before', reader: 'from the statement', rule: 'your rule for this payer', type: 'from the statement', pair: 'the statement shows both sides' };
  function matches(it, s, digits) {
    if (!s) return true;
    return [it.description, it.detail, it.payer, it.accountLabel, it.date].join(' ').toLowerCase().includes(s) || (digits.length >= 3 && String(Math.abs(it.amount)).includes(digits));
  }
  function lineRow(b, it) {
    const id = q(it.id), sel = V.sel.has(it.id), sg = it.suggestion;
    const notes = [it.flags.includes('locked') ? `${monthLabel(it.date.slice(0, 7), true)} is locked` : '', it.flags.includes('nomatch') ? 'may also be one of your email rows' : '',
      it.flags.includes('held') ? 'you took the automatic answer back' : ''].filter(Boolean);
    const sub = [dayText(it.date), it.accountLabel, sg ? `Suggested: ${answerText(b, sg, it.dir)} (${WHY[sg.why] || 'from the statement'})` : 'No suggestion: you choose', ...notes].map(escH).join(' · ');
    const btn = k => `<button class="btn btn-secondary btn-sm" data-w2i-k="${k}" onclick="w2Inbox.open('${k}',['${id}'])">${escH(BTN[k])}</button>`;
    return `<div class="w2i-row${sel ? ' selected' : ''}" data-w2i="${escH(it.id)}" data-dir="${it.dir}" data-sug="${escH(sg ? sg.kind : '')}">
      <label class="w2i-pick"><input type="checkbox"${sel ? ' checked' : ''} onchange="w2Inbox.pick('${id}',this.checked)" aria-label="Select ${escH(it.description)}"></label>
      <div class="li-body"><div class="li-title">${escH(it.description)}</div><div class="li-sub">${sub}</div></div>
      <div class="w2i-amt${it.dir === 'in' ? ' cm-amt in' : ''}">${signed(it.amount)}</div>
      <div class="w2i-acts">${sg ? `<button class="btn btn-primary btn-sm" data-w2i-tap onclick="w2Inbox.tap('${id}')">${escH(answerText(b, sg, it.dir))}</button>` : ''}
        ${MAIN[it.dir].map(btn).join('')}<button class="btn btn-ghost btn-sm" data-w2i-more onclick="w2Inbox.more(this,'${id}')" aria-haspopup="menu">More${ic('chevron-down', 's16')}</button></div></div>`;
  }
  function alertRow(it) {
    const id = q(it.id);
    const sub = [dayText(it.date), it.accountLabel, it.stmtDate ? `the statement of ${dayText(it.stmtDate)} closed without it` : 'not found on a closed statement', it.excluded ? 'you left it out in the current app' : '',
      it.flags.includes('locked') ? `${monthLabel(it.date.slice(0, 7), true)} is locked` : ''].filter(Boolean).map(escH).join(' · ');
    return `<div class="w2i-row" data-w2i="${escH(it.id)}" data-dir="out" data-alert><span class="w2i-pick"></span>
      <div class="li-body"><div class="li-title">${escH(it.description)} <span class="badge warn">alert, not on a statement</span></div><div class="li-sub">${sub}</div></div>
      <div class="w2i-amt">${signed(it.amount)}</div>
      <div class="w2i-acts"><button class="btn ${it.excluded ? 'btn-secondary' : 'btn-primary'} btn-sm" data-w2i-keep onclick="w2Inbox.keep('${id}')">Keep as spending</button>
        <button class="btn ${it.excluded ? 'btn-primary' : 'btn-secondary'} btn-sm" data-w2i-remove onclick="w2Inbox.remove('${id}')">Remove</button></div></div>`;
  }
  function doneRow(b, it) {
    const id = q(it.id), what = it.type === 'alert' ? (it.state === 'kept' ? 'Kept as spending' : 'Removed from the new book') : answerText(b, it.answer, it.dir);
    return `<div class="w2i-row" data-w2i="${escH(it.id)}" data-dir="${it.dir}" data-entry="${escH(it.entry || '')}"><span class="w2i-pick"></span>
      <div class="li-body"><div class="li-title">${escH(it.description)}${it.type === 'alert' ? ' <span class="badge">alert</span>' : ''}</div>
        <div class="li-sub">${[dayText(it.date), it.accountLabel].map(escH).join(' · ')} · <span data-w2i-what>${escH(what)}</span></div></div>
      <div class="w2i-amt${it.dir === 'in' ? ' cm-amt in' : ''}">${signed(it.amount)}</div>
      <div class="w2i-acts"><button class="btn btn-secondary btn-sm" data-w2i-change onclick="w2Inbox.change(this,'${id}')" aria-haspopup="menu">Change</button></div></div>`;
  }
  function listOf(S) { return V.tab === 'auto' ? S.auto : V.tab === 'answered' ? S.answered : S.items; }
  function bodyHTML(b, S) {
    const s = V.q.trim().toLowerCase(), digits = s.replace(/[^\d]/g, '');
    const all = listOf(S).filter(it => (!V.account || it.account === V.account) && (V.tab !== 'waiting' || V.filter === 'all' || (V.filter === 'alert' ? it.type === 'alert' : it.type === 'line' && it.dir === V.filter)) && matches(it, s, digits));
    if (!all.length) {
      const none = !listOf(S).length;
      return `<div data-w2i-count="0">${emptyHTML(V.tab === 'waiting' && none ? 'check' : 'inbox', V.tab === 'waiting' ? (none ? 'Nothing is waiting. The Inbox is empty.' : 'Nothing waiting matches these filters') : none ? 'Nothing here yet' : 'Nothing matches these filters')}</div>`;
    }
    const rows = all.slice(0, V.limit).map(it => (V.tab !== 'waiting' ? doneRow(b, it) : it.type === 'alert' ? alertRow(it) : lineRow(b, it))).join('');
    return `<div data-w2i-count="${all.length}">${rows}</div>${all.length > V.limit ? `<div class="table-foot"><button class="btn btn-ghost" id="w2iMoreRows" onclick="w2Inbox.showMore()">Show more · ${all.length - V.limit} left</button></div>` : ''}`;
  }
  function renderInbox() {
    const title = 'Inbox', desc = 'Statement lines the app could not answer by itself. Emptying it is the monthly job.';
    const g = gate(title, desc); if (g) return g;
    const b = BOOK2(), S = scan(), c = cash();
    for (const id of [...V.sel]) if (!S.items.some(x => x.id === id)) V.sel.delete(id);
    const tabs = [['waiting', 'Waiting', S.items.length], ['auto', 'Answered · automatic', S.auto.length], ['answered', 'Answered', S.answered.length]];
    const bar = `<div class="w2i-bar"><div class="seg" role="group" aria-label="Show" id="w2iTabs">${tabs.map(([k, l, n]) => `<button data-tab="${k}" data-n="${n}" aria-pressed="${V.tab === k}" onclick="w2Inbox.tab('${k}')">${l} ${n}</button>`).join('')}</div></div>`;
    if (!c) return `${pageHead(title, desc, hideBtn())}<div class="grid"><section class="card span-12" id="w2iCard">${emptyHTML('inbox', 'No bank or card statements in the app yet. Import them on Cash movements first.')}</section></div>`;
    const inAcc = S.items.filter(it => !V.account || it.account === V.account), n = f => inAcc.filter(f).length;
    const chips = [['all', 'All', inAcc.length], ['out', 'Money out', n(i => i.type === 'line' && i.dir === 'out')], ['in', 'Money in', n(i => i.type === 'line' && i.dir === 'in')], ['alert', 'Alerts not on a statement', n(i => i.type === 'alert')]];
    const ids = new Set([...S.items, ...S.auto, ...S.answered].map(i => i.account)), accs = c.accounts.filter(a => ids.has(a.id));
    const tools = `<div class="cm-tools" id="w2iTools">
      ${V.tab === 'waiting' ? `<div class="seg" role="group" aria-label="Filter" id="w2iFilter">${chips.map(([k, l, m]) => `<button data-f="${k}" data-n="${m}" aria-pressed="${V.filter === k}" onclick="w2Inbox.filter('${k}')">${l} ${m}</button>`).join('')}</div>` : ''}
      <select class="input" id="w2iAcc" aria-label="Account" onchange="w2Inbox.account(this.value)"><option value="">All accounts</option>${accs.map(a => `<option value="${escH(a.id)}"${V.account === a.id ? ' selected' : ''}>${escH(a.label || a.id)}</option>`).join('')}</select>
      <div class="input-affix" style="flex:1;max-width:280px;min-width:160px"><span class="affix">${ic('search', 's16')}</span><input class="input" id="w2iSearch" type="search" placeholder="Search" value="${escH(V.q)}" oninput="w2Inbox.search(this.value)" aria-label="Search the Inbox" style="height:36px;width:100%"></div></div>`;
    const go = `<button class="btn btn-ghost btn-sm" onclick="setTab('w2-start')">Link it on Start here</button>`;
    const notes = [S.link.length ? `${plural(S.link.length, 'line')} on a statement that is not linked to an account yet ${S.link.length === 1 ? 'is' : 'are'} not shown. ${go}` : '',
      S.foreign.length ? `${plural(S.foreign.length, 'foreign-currency line')} ${S.foreign.length === 1 ? 'is' : 'are'} left out for now.` : '',
      S.noMatch.length ? `Emails for ${escH(S.noMatch.join(', '))} are not checked against that statement in the current app, so a charge here may also be one of your email rows. Compare before you answer.` : '',
      S.loading ? 'Your bank emails are still loading, so some lines may leave this list in a moment.' : '',
      !(b.settings || {}).syncFrom ? 'The new book has no start date yet, so no statement line is in scope.' : ''].filter(Boolean);
    const selBar = V.tab === 'waiting' && V.sel.size ? `<div class="w2i-sel" id="w2iSel"><span class="grow">${plural(V.sel.size, 'line')} ticked</span>
      <button class="btn btn-primary btn-sm" id="w2iAnswerSel" onclick="w2Inbox.selMenu(this)" aria-haspopup="menu">Answer ${V.sel.size} selected${ic('chevron-down', 's16')}</button><button class="btn btn-ghost btn-sm" id="w2iClearSel" onclick="w2Inbox.clearSel()">Clear</button></div>` : '';
    const head = { waiting: ['Waiting for you', 'One tap on the filled button uses the suggestion · tick several to answer them together'], auto: ['Answered by the app', 'Fees, interest, tax, paired moves between your accounts and your own rules'], answered: ['Answered by you', 'Change takes an answer back and lets you answer again'] }[V.tab];
    return `${pageHead(title, desc, hideBtn())}${bar}
      <div class="grid"><section class="card flush span-12" id="w2iCard" data-waiting="${S.items.length}">${cardHead('inbox', head[0], head[1])}${tools}
        ${notes.length ? `<div class="w2i-notes" id="w2iNotes">${notes.map(x => `<p class="help">${x}</p>`).join('')}</div>` : ''}${selBar}<div id="w2iBody">${bodyHTML(b, S)}</div></section></div>`;
  }
  I.tab = k => { V.tab = k; V.limit = 100; renderAll(); };
  I.filter = k => { V.filter = k; V.limit = 100; renderAll(); };
  I.account = v => { V.account = v; V.limit = 100; renderAll(); };
  I.search = v => { V.q = v; V.limit = 100; const box = el('w2iBody'); if (box && BOOK2()) box.innerHTML = bodyHTML(BOOK2(), scan()); };
  I.showMore = () => { V.limit += 100; const box = el('w2iBody'); if (box && BOOK2()) box.innerHTML = bodyHTML(BOOK2(), scan()); };
  I.pick = (id, on) => { if (on) V.sel.add(id); else V.sel.delete(id); renderAll(); };
  I.clearSel = () => { V.sel.clear(); renderAll(); };
  const menuItems = (kinds, ids) => kinds.map(k => ({ label: BTN[k], icon: ICON[k], onSelect: () => I.open(k, ids) }));
  I.more = function (btn, id) { const it = itemById(id); if (it) openMenu(btn, { title: it.description, items: menuItems(MORE[it.dir], [id]) }); };
  I.selMenu = function (btn) {
    const items = [...V.sel].map(itemById).filter(Boolean), dirs = new Set(items.map(i => i.dir));
    if (!items.length) return;
    if (dirs.size > 1) { toast('Tick lines that all went out, or all came in, to answer them together'); return; }
    const dir = items[0].dir, kinds = MAIN[dir].concat(MORE[dir]).filter(k => k !== 'split' && k !== 'invest-sell');
    openMenu(btn, { title: `Answer ${plural(items.length, 'line')}`, items: menuItems(kinds, items.map(i => i.id)) });
  };
  function done(kind, res, n) {
    const extra = res.rule ? ` · rule saved${res.extra ? `, ${plural(res.extra, 'more line')} answered` : ''}` : '';
    toast(`${String(BTN[kind] || kind).replace('…', '')} · ${plural(n, 'line')} answered${extra}`, { action: 'Undo', onAction: undo(res) });
  }
  // One tap on the suggestion: posted as it is when nothing is missing, else the sheet opens filled in.
  I.tap = function (id) {
    const it = itemById(id), s = it && it.suggestion; if (!s) return;
    if (!s.complete) { I.open(btnKind(s.kind, it.dir), [id]); return; }
    try { const res = answer([it], ruleOf(s)); V.sel.delete(id); done(btnKind(s.kind, it.dir), res, 1); } catch (e) { toast(errText(e)); }
  };

  /* ── The answer sheet: category, person, income type, split, other account, investment ── */
  let SH = null;
  const rpInput = (id, val, attrs) => `<div class="input-affix"><span class="affix">Rp</span><input class="input" id="${id}" inputmode="numeric" autocomplete="off" value="${val == null ? '' : escH(Math.round(val).toLocaleString('id-ID'))}" ${attrs || ''}></div>`;
  function categories(b) {
    const s = new Set();
    if (typeof CATEGORIES === 'object' && CATEGORIES) for (const k of Object.keys(CATEGORIES)) s.add(k);
    for (const a of live(b.accounts)) if (a.kind === 'expense' && a.category && !a.hidden) s.add(a.category);
    for (const k of ['Bank fees', 'Card interest', 'Tax']) s.add(k);
    return [...s];
  }
  function incomeTypes(b) {
    const s = new Set(['Business income', 'Salary', 'Interest', 'Cashback', 'Other income']);
    for (const a of live(b.accounts)) if (a.kind === 'income' && a.incomeType && !a.hidden) s.add(a.incomeType);
    return [...s];
  }
  function personField(b, prefer, chosen) {
    const ps = live(b.people).sort((x, y) => (prefer ? (y.type === prefer) - (x.type === prefer) : 0) || String(x.name).localeCompare(String(y.name))), isNew = !ps.length;
    return `<div class="field full"><label class="label" for="w2iWho">Who</label><select class="input" id="w2iWho" onchange="w2Inbox.who()">
        ${ps.map(p => `<option value="${escH(p.id)}"${p.id === chosen ? ' selected' : ''}>${escH(p.name)}${p.type === 'company' ? ' (company)' : ''}</option>`).join('')}<option value="__new"${isNew ? ' selected' : ''}>Add someone new…</option></select></div>
      <div class="field" id="w2iWhoNameBox"${isNew ? '' : ' style="display:none"'}><label class="label" for="w2iWhoName">Name</label><input class="input" id="w2iWhoName" maxlength="60" autocomplete="off"></div>
      <div class="field" id="w2iWhoTypeBox"${isNew ? '' : ' style="display:none"'}><label class="label" for="w2iWhoType">Person or company</label><select class="input" id="w2iWhoType"><option value="person"${prefer === 'company' ? '' : ' selected'}>Person</option><option value="company"${prefer === 'company' ? ' selected' : ''}>Company</option></select></div>`;
  }
  I.who = function () { const n = el('w2iWho').value === '__new'; el('w2iWhoNameBox').style.display = n ? '' : 'none'; el('w2iWhoTypeBox').style.display = n ? '' : 'none'; if (n) el('w2iWhoName').focus(); };
  function pickedPerson() {
    const v = el('w2iWho').value;
    if (v !== '__new') return { id: v };
    const name = el('w2iWhoName').value.trim();
    if (!name) throw new Error('Enter a name');
    return { name, type: el('w2iWhoType').value === 'company' ? 'company' : 'person' };
  }
  const TEXT = { spending: 'It counts as your own spending in this category.', refund: 'Money back on something you bought. It lowers your spending in this category.', fee: 'A bank or card charge. It counts as spending.',
    lent: 'It is a loan, not spending. They owe you the amount.', 'paid-for': 'You paid for someone. They owe you the amount, and it is not your spending.', reimburse: 'The company owes you the amount. It is not your spending.',
    'repaid-out': 'You paid back money you owed. It is not spending.', 'repaid-in': 'Someone paid back what they owed you. It is not income.', borrowed: 'Money you will pay back. It is not income.',
    income: 'Money you earned. If tax was held back before it reached you, type it and the full amount is counted as income.', split: 'Your own part stays in your spending. The rest is owed to you.',
    transfer: 'A move between two of your own accounts. It is neither income nor spending.', 'card-payment': 'Paying your card from your bank. It is not spending: the card’s charges already are.',
    'invest-buy': 'Money put into an investment. It is not spending.', 'invest-sell': 'Money back from an investment. Only a gain counts as income.' };
  I.open = function (kind, ids, replace) {
    const b = BOOK2(), items = (ids || []).map(itemById).filter(x => x && x.type === 'line'); if (!b || !items.length || !BTN[kind]) return;
    const one = items.length === 1 ? items[0] : null, f = items[0], k = kind === 'refund' ? 'spending' : kind, total = items.reduce((s, i) => s + Math.abs(i.amount), 0);
    const sg = f.suggestion && f.suggestion.kind === k ? f.suggestion : (f.answer && f.answer.kind === k ? f.answer : {}), own = new Set(items.map(i => i.bookAccount));
    SH = { kind, items, replace: replace || null };
    const fields = [];
    if (['spending', 'fee', 'split'].includes(k)) {
      const cur = sg.category || (k === 'fee' ? 'Bank fees' : one ? guess(one.description) : 'Others');
      fields.push(`<div class="field full"><label class="label" for="w2iCat">Category</label><select class="input" id="w2iCat">${categories(b).map(c => `<option value="${escH(c)}"${c === cur ? ' selected' : ''}>${escH(c)}</option>`).join('')}</select></div>`);
    }
    if (PERSON.includes(k) || k === 'split') fields.push(personField(b, k === 'reimburse' ? 'company' : '', sg.person));
    if (k === 'split') fields.push(`<div class="field full"><label class="label" for="w2iShare">Your own part</label>${rpInput('w2iShare', Math.floor(total / 2))}<div class="help">The other person owes you the rest.</div></div>`);
    if (k === 'income') fields.push(`<div class="field"><label class="label" for="w2iType">Kind of income</label><input class="input" id="w2iType" list="w2iTypes" maxlength="40" autocomplete="off" value="${escH(sg.incomeType || 'Business income')}"><datalist id="w2iTypes">${incomeTypes(b).map(x => `<option value="${escH(x)}">`).join('')}</datalist></div>
      <div class="field"><label class="label" for="w2iTax">Tax withheld (optional)</label>${rpInput('w2iTax', null, 'placeholder="0"')}</div>`);
    if (TO.includes(k)) {
      const roles = k === 'invest-buy' || k === 'invest-sell' ? ['investment'] : k === 'card-payment' ? (f.dir === 'out' ? ['card'] : ['bank', 'cash', 'ewallet']) : ['bank', 'cash', 'ewallet', 'card'];
      const list = accountsOf(b, roles).filter(a => !own.has(a.id)), label = k.indexOf('invest') === 0 ? 'Which investment' : f.dir === 'out' ? 'Where it went' : 'Where it came from';
      fields.push(`<div class="field full"><label class="label" for="w2iOther">${label}</label><select class="input" id="w2iOther" onchange="w2Inbox.twinHint()">${list.map(a => `<option value="${escH(a.id)}"${a.id === sg.toAccount ? ' selected' : ''}>${escH(a.name)}</option>`).join('')}</select>
        ${list.length ? '<div class="help" id="w2iTwin"></div>' : `<div class="help">${k.indexOf('invest') === 0 ? 'Your book has no investment account yet.' : 'Your book has no other account of that kind yet.'}</div>`}</div>`);
      if (k === 'invest-sell' && one) fields.push(`<div class="field full"><label class="label" for="w2iCost">What you paid for the part you sold (optional)</label>${rpInput('w2iCost', null, 'placeholder="Same as what came back"')}<div class="help">The difference is counted as a gain or a loss.</div></div>`);
    }
    const mates = ruleMates(scan(), items), samePayer = f.payer && items.every(i => i.payer === f.payer && i.dir === f.dir);
    if (samePayer && k !== 'split' && k !== 'invest-sell') fields.push(`<div class="field full"><label class="check"><input type="checkbox" id="w2iRule" onchange="w2Inbox.ruleHint()"> Always for this payer</label>
      <div class="help" id="w2iRuleN" data-n="${mates.length}" style="display:none">Every new line from ${escH(f.payer)} going the same way will be answered like this by itself. ${mates.length ? `It also answers ${plural(mates.length, 'other waiting line')} from this payer now.` : 'No other line from this payer is waiting now.'}</div></div>`);
    const sum = one ? `${escH(one.description)} · ${escH(dayText(one.date))} · ${escH(one.accountLabel)} · ${signed(one.amount)}` : `${plural(items.length, 'line')} · <span class="amt">${fmtIDR(total)}</span> in total`;
    openSheet({ title: String(BTN[kind]).replace('…', ''), onEnter: () => I.save(),
      body: `<p class="muted" style="margin:0 0 14px">${sum}<br>${escH(TEXT[kind] || '')}${replace ? ' The earlier answer is taken back first.' : ''}</p><div class="form-grid">${fields.join('')}
        <div class="help err full" id="w2iErr" role="alert" style="display:none">${ic('triangle-alert', 's16')}<span></span></div></div>`,
      foot: `<button class="btn btn-secondary" onclick="closeTopSheet(true)">Cancel</button><button class="btn btn-primary" id="w2iSave" onclick="w2Inbox.save()">${replace ? 'Change answer' : items.length > 1 ? `Answer ${items.length} lines` : 'Save'}</button>` });
    setTimeout(I.twinHint, 0);
  };
  I.ruleHint = function () { const c = el('w2iRule'), h = el('w2iRuleN'); if (c && h) h.style.display = c.checked ? '' : 'none'; };
  I.twinHint = function () {
    const box = el('w2iTwin'), sel = el('w2iOther'); if (!box || !sel || !SH || (SH.kind !== 'transfer' && SH.kind !== 'card-payment')) return;
    const S = scan(), used = new Set(SH.items.map(i => i.id)), tw = SH.items.map(it => twinOf(S, it, sel.value, used)).filter(Boolean);
    box.textContent = tw.length ? `This also answers the matching line on that account (${tw.map(t => dayText(t.date)).join(', ')}), so it is not counted twice.` : '';
  };
  const showErr = msg => { const box = el('w2iErr'); if (!box) { toast(msg); return; } box.style.display = msg ? '' : 'none'; box.querySelector('span').textContent = msg || ''; };
  I.save = function () {
    const A = SH; if (!A) return;
    const kind = A.kind, k = kind === 'refund' ? 'spending' : kind, ans = { kind: k }, whole = v => { const n = meParse(v); return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null; };
    try {
      if (el('w2iCat')) { ans.category = el('w2iCat').value; if (!ans.category) throw new Error('Choose a category'); }
      if (el('w2iWho')) ans.pick = pickedPerson();
      if (k === 'split') { const n = whole(el('w2iShare').value), amt = Math.abs(A.items[0].amount); if (n == null || n >= amt) throw new Error('Your own part must be a whole amount below ' + fmtIDR(amt)); ans.share = n; }
      if (k === 'income') {
        ans.incomeType = el('w2iType').value.trim() || 'Other income';
        const raw = el('w2iTax').value.trim(); if (raw) { const n = whole(raw); if (n == null) throw new Error('The tax withheld must be whole rupiah'); if (n) ans.taxWithheld = n; }
      }
      if (TO.includes(k)) { ans.toAccount = el('w2iOther') ? el('w2iOther').value : ''; if (!ans.toAccount) throw new Error(k.indexOf('invest') === 0 ? 'Choose the investment' : 'Choose the other account'); }
      if (el('w2iCost') && el('w2iCost').value.trim()) { const n = whole(el('w2iCost').value); if (!n) throw new Error('What you paid must be above zero, in whole rupiah'); ans.cost = n; }
    } catch (x) { showErr(x.message); return; }
    const rule = !!(el('w2iRule') && el('w2iRule').checked);
    let res; try { res = answer(A.items, ans, { rule, replace: A.replace }); } catch (e) { showErr(errText(e)); return; }
    closeTopSheet(true); SH = null; V.sel.clear();
    if (A.replace) toast(`Changed to ${String(BTN[kind]).replace('…', '')}`); else done(kind, res, A.items.length);
  };

  /* ── Change (Answered tabs) and the alerts ── */
  const lockedMsg = it => (it.flags.includes('locked') || bookLib.lockState(BOOK2(), String(it.date).slice(0, 7)) === 'locked' ? `${monthLabel(String(it.date).slice(0, 7), true)} is locked; unlock it to change it` : '');
  const run = (fn, why, msg, o) => { try { book2Do(fn, why); toast(msg, o); return true; } catch (e) { toast(errText(e)); return false; } };
  I.change = function (btn, id) {
    const it = itemById(id), b = BOOK2(); if (!it || !it.entry) return;
    const e = b.entries[it.entry]; if (!e) return;
    const refuse = (bookLib.lockState(b, String(e.date).slice(0, 7)) === 'locked' ? `${monthLabel(String(e.date).slice(0, 7), true)} is locked; unlock it to change it` : '') || lockedMsg(it);
    if (refuse) { toast(refuse); return; }
    if (it.type === 'alert') {
      const back = it.state === 'kept' ? () => run(w => bookLib.edit(w, e.id, { provisional: !!e.provisional }, UNKEEP_WHY), 'inbox-alert', 'Back in the Inbox')
        : () => run(w => bookLib.post(w, { date: e.date, kind: e.kind, description: e.description, lines: e.lines, source: e.source, payer: e.payer, dir: e.dir }), 'inbox-alert', 'Put back. It is waiting in the Inbox again.');
      openMenu(btn, { title: it.description, items: [{ label: 'Back to the Inbox', icon: 'inbox', onSelect: back }] });
      return;
    }
    if (it.fromEmail) {
      // The paying side is an email row: it goes back to plain spending and is not paired again by itself.
      const h = (e.history || []).slice().reverse().find(x => x.before && x.before.kind === 'spending');
      openMenu(btn, { title: it.description, items: [{ label: 'Not a move between my accounts', icon: 'inbox', onSelect: () => h && run(w => bookLib.edit(w, e.id, { kind: 'spending', lines: h.before.lines }, HOLD_WHY), 'inbox-change', 'Taken back. The line is waiting in the Inbox again.') }] });
      return;
    }
    const kinds = MAIN[it.dir].concat(MORE[it.dir]);
    openMenu(btn, { title: it.description, items: [{ heading: 'Answer again as' }, ...kinds.map(k => ({ label: BTN[k], icon: ICON[k], onSelect: () => I.open(k, [id], e.id) })), { divider: true },
      { label: 'Back to the Inbox', icon: 'inbox', onSelect: () => run(w => { if (!bookLib.voidEntry(w, e.id, 'Changed')) throw new Error('That answer was already taken back'); }, 'inbox-change', 'Taken back. The line is waiting in the Inbox again.') }] });
  };
  I.keep = function (id) {
    const it = itemById(id); if (!it || it.type !== 'alert') return;
    run(w => bookLib.edit(w, it.entry, { provisional: !!w.entries[it.entry].provisional }, KEEP_WHY), 'inbox-alert', 'Kept as your spending',
      { action: 'Undo', onAction: () => run(w => bookLib.edit(w, it.entry, { provisional: !!w.entries[it.entry].provisional }, UNKEEP_WHY), 'inbox-undo', 'Undone. Back in the Inbox.') });
  };
  I.remove = function (id) {
    const it = itemById(id); if (!it || it.type !== 'alert') return;
    const e = cp(BOOK2().entries[it.entry]);
    run(w => { if (!bookLib.voidEntry(w, it.entry, REMOVE_WHY)) throw new Error('It was already removed'); }, 'inbox-alert', 'Removed from the new book. Your current app is not changed.',
      { action: 'Undo', onAction: () => run(w => bookLib.post(w, { date: e.date, kind: e.kind, description: e.description, lines: e.lines, source: e.source, payer: e.payer, dir: e.dir }), 'inbox-undo', 'Undone. Back in the Inbox.') });
  };

  /* ── Menu badge, and running the automatic answers when the data changed ── */
  function badge() {
    let n = 0; try { n = BOOK2() ? scan().items.length : 0; } catch (_) { n = 0; }
    try {
      for (const lbl of document.querySelectorAll('.sb-item[data-tab="w2-inbox"] .lbl')) {
        const cur = lbl.querySelector('[data-w2i-badge]');
        if (cur && +cur.textContent === n) continue;
        lbl.innerHTML = 'Inbox' + (n ? ` <span class="badge accent" data-w2i-badge style="margin-left:6px">${n}</span>` : '');
      }
    } catch (_) { /* the badge is a nicety: never in the way */ }
    return n;
  }
  let RUN_T = null, RUN_SIG = '';
  function runSig() {
    const b = BOOK2(), c = cash(), R = recon(), st = (b && b.settings) || {};
    return [c ? c.generatedAt + '#' + c.txns.length : '', R ? (R.matches || []).length + '/' + (R.review || []).length : '', JSON.stringify([oldState().cashTypeOverrides || {}, oldState().cashPayerRules || {}, st.stmtMap || {}, st.bankMap || {}]),
      st.syncFrom || '', b ? Object.keys(b.entries).length + '/' + (b.rules || []).length + '/' + Object.keys(b.locks || {}).length : '', dataReady()].join('|');
  }
  registerHook('beforeRender', () => {
    if (RUN_T) return;
    RUN_T = setTimeout(() => {
      RUN_T = null;
      try { if (BOOK2() && cash() && dataReady()) { const s = runSig(); if (s !== RUN_SIG) { RUN_SIG = s; book2InboxRun(); RUN_SIG = runSig(); } } } catch (e) { console.warn('ExpenseTrack preview: the Inbox could not run', e); }
      badge();
    }, 0);
  });
  registerHook('book2Changed', () => { setTimeout(badge, 0); });

  Object.assign(window, { book2Inbox, book2InboxCount, book2InboxRun });
  registerPage({ key: 'w2-inbox', label: 'Inbox', icon: 'inbox', group: 'w2', order: 15, render: renderInbox });
})();
