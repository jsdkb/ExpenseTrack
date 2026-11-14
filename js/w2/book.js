/* ExpenseTrack v6 — the new book's engine (schema et-book/3). Contract: docs/v6-book.md §2–§5.
   Pure functions on a book object: no DOM, no network, no app globals. The only global is bookLib
   (and module.exports in Node). Whole rupiah, debit positive, every posted entry sums to 0.
   Nothing is ever deleted: entries are voided, rules get a tombstone, accounts are hidden.
   Mutating functions change the book they are given; every one that stamps a time takes an
   optional `now` (ISO string). No personal data lives in this file. */
(function () {
  'use strict';

  const SCHEMA = 'et-book/3';
  const KINDS = ['asset', 'liability', 'equity', 'income', 'expense'];
  // role → [kind, the code new accounts of that role start from (the ERP chart's classes)]
  const ROLES = {
    bank: ['asset', '1121'], cash: ['asset', '1111'], ewallet: ['asset', '1113'], investment: ['asset', '1311'],
    property: ['asset', '1211'], receivable: ['asset', '1151'], 'other-asset': ['asset', '1499'],
    card: ['liability', '2111'], payable: ['liability', '2122'], loan: ['liability', '2121'], 'other-liability': ['liability', '2199'],
    equity: ['equity', '3109'], retained: ['equity', '3201'],
    income: ['income', '4909'], fx: ['income', '7290'],
    expense: ['expense', '6909'], unexplained: ['expense', '8990'],
  };
  const ENTRY_KINDS = ['spending', 'paid-for', 'split', 'reimburse', 'lent', 'repaid-in', 'borrowed', 'repaid-out', 'income', 'transfer',
    'card-payment', 'invest-buy', 'invest-sell', 'fee', 'write-off', 'adjust', 'opening', 'year-end', 'manual', 'migrated'];
  // The answers of §4: the direction the money moves (null = either way), and what else they need.
  const ANSWERS = {
    spending: { dir: 'out', flips: true, label: 'Spending' }, fee: { dir: 'out', flips: true, label: 'A fee' },
    'paid-for': { dir: 'out', person: true, label: 'Paid for someone' }, lent: { dir: 'out', person: true, label: 'Lent' },
    reimburse: { dir: 'out', person: true, label: 'To be reimbursed' }, split: { dir: 'out', label: 'A split' },
    'repaid-in': { dir: 'in', person: true, label: 'Got repaid' }, borrowed: { dir: 'in', person: true, label: 'Borrowed' },
    'repaid-out': { dir: 'out', person: true, label: 'I repaid' }, income: { dir: 'in', label: 'Income' },
    transfer: { dir: 'out', to: true, label: 'A transfer' }, 'card-payment': { dir: 'out', to: true, label: 'A card payment' },
    'invest-buy': { dir: 'out', to: true, label: 'Buying an investment' }, 'invest-sell': { dir: 'in', to: true, label: 'Selling an investment' },
    'write-off': { dir: null, person: true, noAccount: true, label: 'A write-off' }, adjust: { dir: null, flips: true, label: 'An adjustment' },
  };
  const UNIQUE_SOURCES = ['email', 'stmt', 'migration'];
  const SETTING_KEYS = ['retained', 'unexplained', 'fxGain', 'firstMonth', 'syncFrom', 'bankMap', 'stmtMap',
    'budgets', 'goals', 'taxDeclared', 'taxSlips', 'accurate'];   // the last six: plain objects or arrays, stored as given (a copy)
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ── Small helpers ── */
  const cp = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const stamp = now => now || new Date().toISOString();
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const cmpCode = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
  const p2 = n => String(n).padStart(2, '0');
  const isInt = n => Number.isSafeInteger(n);
  const rp = n => 'Rp ' + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const clean = s => String(s == null ? '' : s).trim();
  const low = s => clean(s).toLowerCase();
  const payerKey = s => clean(s).toUpperCase();
  const live = o => Object.values(o || {}).filter(x => x && !x.deleted);
  function err(list) { const l = Array.isArray(list) ? list : [list]; const e = new Error(l.join('; ')); e.errors = l; return e; }
  function validDate(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const t = new Date(d + 'T00:00:00Z'); return !isNaN(t) && t.toISOString().slice(0, 10) === d;
  }
  const validMonth = M => typeof M === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(M);
  const monthEnd = M => { const [y, m] = M.split('-').map(Number); return `${M}-${p2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
  function shiftMonth(M, k) { let [y, m] = M.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${p2(m)}`; }
  function monthRange(a, b) { const out = []; for (let M = a; M <= b; M = shiftMonth(M, 1)) out.push(M); return out; }
  const monthLabel = M => `${MONTHS[+M.slice(5, 7) - 1]} ${M.slice(0, 4)}`;
  const needMonth = M => { if (!validMonth(M)) throw err('Enter a valid month (YYYY-MM)'); return M; };
  // A date, or a month meaning its last day, or nothing (= everything).
  function asOfDate(x) {
    if (x == null || x === '') return null;
    if (validMonth(x)) return monthEnd(x);
    if (!validDate(x)) throw err('Enter a valid date (YYYY-MM-DD)');
    return x;
  }
  function range(from, to) {
    const F = asOfDate(from) && (validMonth(from) ? from + '-01' : from), T = asOfDate(to);
    if (F && T && F > T) throw err('The start date is after the end date');
    return [F || '0000-01-01', T || '9999-12-31'];
  }

  // Ids: random by default; seedIds(n) makes them repeatable (tests), seedIds(null) goes back.
  let rand = Math.random;
  function seedIds(seed) {
    if (seed == null) { rand = Math.random; return; }
    let s = seed >>> 0;
    rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const rid = n => { let s = ''; while (s.length < n) s += Math.floor(rand() * 16).toString(16); return s; };
  function freeId(taken, prefix, n) { let id; do { id = prefix + rid(n); } while (taken(id)); return id; }

  function audit(book, at, entity, ref, action, before, after) {
    book.audit.push({ id: freeId(id => book.audit.some(u => u.id === id), 'u-', 10), at, entity, ref, action, before: before == null ? null : cp(before), after: after == null ? null : cp(after) });
    if (!book.updatedAt || at > book.updatedAt) book.updatedAt = at;
  }

  /* ── The book ── */
  function sysAccount(id, code, name, role, at) {
    return { id, code, name, kind: ROLES[role][0], role, parent: null, header: false, ccy: 'IDR', person: null, category: null, incomeType: null,
      stmt: null, emailBank: null, tax: null, hidden: false, origin: 'system', at };
  }
  function emptyBook(now) {
    const at = stamp(now);
    return {
      schema: SCHEMA, createdAt: at, updatedAt: at, currency: 'IDR',
      accounts: {
        'a-retained': sysAccount('a-retained', ROLES.retained[1], 'Retained earnings', 'retained', at),
        'a-unexplained': sysAccount('a-unexplained', ROLES.unexplained[1], 'Unexplained differences', 'unexplained', at),
        'a-fx': sysAccount('a-fx', ROLES.fx[1], 'Exchange gains and losses', 'fx', at),
      },
      people: {}, entries: {}, values: {}, checks: {}, locks: {}, rules: [],
      settings: { retained: 'a-retained', unexplained: 'a-unexplained', fxGain: 'a-fx', firstMonth: null, syncFrom: null, bankMap: {}, at },
      audit: [], migration: null,
    };
  }
  const accOf = (book, id) => { const a = id != null && book.accounts[id]; return a && !a.deleted ? a : null; };
  const personOf = (book, id) => { const p = id != null && book.people[id]; return p && !p.deleted ? p : null; };
  const isPosted = e => !!e && e.status === 'posted' && !e.deleted;
  // Posted entries in date order (then number, then id).
  function postedList(book) {
    return Object.values(book.entries || {}).filter(isPosted).sort((a, b) => cmp(a.date, b.date) || cmp(a.number || '', b.number || '') || cmp(a.id, b.id));
  }

  /* ── Locks ── */
  function lockState(book, month) { const l = (book.locks || {})[month]; return l && l.state === 'locked' ? 'locked' : 'open'; }
  const lockedMsg = M => `${monthLabel(M)} is locked; unlock it to change it`;
  function lock(book, month, now) {
    needMonth(month); if (lockState(book, month) === 'locked') return false;
    const at = stamp(now), before = book.locks[month] || null;
    if (month.slice(5) === '12') postYearEnd(book, month.slice(0, 4), at);   // before the lock: a locked month takes no entry
    book.locks[month] = { state: 'locked', at, reason: '' };
    audit(book, at, 'lock', month, 'lock', before, book.locks[month]); return true;
  }
  function unlock(book, month, reason, now) {
    needMonth(month); if (!clean(reason)) throw err('Give a reason for unlocking the month');
    if (lockState(book, month) !== 'locked') return false;
    const at = stamp(now), before = book.locks[month];
    book.locks[month] = { state: 'open', at, reason: clean(reason) };
    audit(book, at, 'lock', month, 'unlock', before, book.locks[month]);
    if (month.slice(5) === '12') {                                           // the year is open again: its year-end entry goes
      for (const e of Object.values(book.entries)) if (isYearEndOf(e, month.slice(0, 4))) { const b4 = voidIn(book, e, 'December unlocked: ' + clean(reason), at); audit(book, at, 'entry', e.id, 'void', b4, snap(e)); }
    }
    return true;
  }

  /* ── Year end (made by locking December, taken back by unlocking it) ── */
  const isYearEndOf = (e, year) => isPosted(e) && e.kind === 'year-end' && !!e.source && e.source.type === 'system' && e.source.ref === 'year-end:' + year;
  function yearEndOf(book, year) { return Object.values(book.entries || {}).find(e => isYearEndOf(e, String(year))) || null; }
  // One entry dated 31 December that brings every income and expense account's total for the year to
  // zero and puts the difference on settings.retained. Nothing to move → no entry.
  function postYearEnd(book, year, at) {
    if (yearEndOf(book, year)) return null;
    const tot = new Map();
    for (const e of Object.values(book.entries)) {
      if (!isPosted(e) || e.date.slice(0, 4) !== year) continue;
      for (const l of e.lines) { const a = book.accounts[l.account]; if (a && (a.kind === 'income' || a.kind === 'expense')) tot.set(l.account, (tot.get(l.account) || 0) + l.amount); }
    }
    const ids = [...tot.keys()].filter(id => tot.get(id)).sort((p, q) => cmpCode(book.accounts[p].code, book.accounts[q].code) || cmp(p, q));
    if (!ids.length) return null;
    const lines = ids.map(id => ({ account: id, amount: -tot.get(id), memo: '' })), net = ids.reduce((t, id) => t + tot.get(id), 0);
    if (net) lines.push({ account: book.settings.retained, amount: net, memo: '' });
    let id = 'e-ye-' + year; for (let n = 2; book.entries[id]; n++) id = `e-ye-${year}-${n}`;   // fixed ids, so two devices agree
    return post(book, { id, date: year + '-12-31', kind: 'year-end', description: 'Year end ' + year, lines, source: { type: 'system', ref: 'year-end:' + year } }, at);
  }

  /* ── Month check results ── */
  // One stored result per account and month: the statement figure (null when the account has no
  // statement), the book figure it was compared with, and whether they agree.
  function setCheck(book, check, now) {
    const c = check || {}, E = [];
    if (!accOf(book, c.account)) E.push('Account not found');
    if (!validMonth(c.month)) E.push('Enter a valid month (YYYY-MM)');
    if (c.statement != null && !isInt(c.statement)) E.push('The statement amount must be whole rupiah');
    if (!isInt(c.book)) E.push('The book amount must be whole rupiah');
    if (typeof c.ok !== 'boolean') E.push('Say whether the account agrees or not');
    if (c.date != null && (!validDate(c.date) || (validMonth(c.month) && c.date.slice(0, 7) !== c.month))) E.push('The date compared on must be inside the month');
    if (validMonth(c.month) && lockState(book, c.month) === 'locked') E.push(lockedMsg(c.month));
    if (E.length) throw err(E);
    const at = stamp(now), key = `${c.account}|${c.month}`, before = book.checks[key] || null;
    const rec = { account: c.account, month: c.month, statement: c.statement == null ? null : c.statement, book: c.book, ok: c.ok };
    if (c.adjustedBy) rec.adjustedBy = String(c.adjustedBy);
    if (clean(c.note)) rec.note = clean(c.note);
    if (c.date) rec.date = c.date;
    if (clean(c.how)) rec.how = clean(c.how);
    rec.at = at;
    book.checks[key] = rec;
    audit(book, at, 'check', key, 'set', before, rec);
    return key;
  }
  function checksOf(book, month) {
    needMonth(month);
    const code = c => (book.accounts[c.account] || {}).code || '';
    return live(book.checks).filter(c => c.month === month).sort((p, q) => cmpCode(code(p), code(q)) || cmp(p.account, q.account)).map(cp);
  }

  /* ── Entries ── */
  function cleanLines(lines) {
    return (Array.isArray(lines) ? lines : []).map(l => {
      const o = { account: l && l.account != null ? String(l.account) : '', amount: l ? l.amount : null, memo: clean(l && l.memo) };
      if (l && l.fx) o.fx = { ccy: l.fx.ccy, amount: l.fx.amount, rate: l.fx.rate };
      return o;
    });
  }
  const cleanSource = s => ({ type: (s && s.type) || 'manual', ref: s && s.ref != null ? String(s.ref) : null });
  const snap = e => ({ date: e.date, description: e.description, kind: e.kind, status: e.status, number: e.number, lines: cp(e.lines) });

  function findBySource(book, type, ref) {
    if (ref == null) return null;
    const r = String(ref);
    for (const e of Object.values(book.entries || {})) if (isPosted(e) && e.source && e.source.type === type && e.source.ref === r) return e;
    return null;
  }

  function validate(book, entry, opts) {
    const o = opts || {}, e = entry || {}, E = [];
    const dateOk = validDate(e.date);
    if (!dateOk) E.push('Enter a valid date (YYYY-MM-DD)');
    if (e.kind != null && !ENTRY_KINDS.includes(e.kind)) E.push(`"${e.kind}" is not a kind of entry`);
    const L = Array.isArray(e.lines) ? e.lines : [];
    if (L.length < 2) E.push('An entry needs at least 2 lines');
    let sum = 0, amountsOk = true;
    L.forEach((l, i) => {
      const n = `Line ${i + 1}: `, a = l && accOf(book, l.account), amt = l ? l.amount : null;
      if (!a) E.push(n + 'choose an account that is in the book');
      else if (a.header) E.push(n + `${a.name} is a header account and cannot take entries`);
      if (!isInt(amt) || amt === 0) { E.push(n + 'the amount must be whole rupiah and not zero'); amountsOk = false; } else sum += amt;
      if (l && l.fx) {
        const f = l.fx;
        if (!/^[A-Z]{3}$/.test(f.ccy || '') || !(Math.abs(f.amount) > 0) || !(f.rate > 0)) E.push(n + 'enter the foreign currency (3 letters), its amount and the rate');
        else if (isInt(amt) && Math.abs(Math.round(Math.abs(f.amount) * f.rate) - Math.abs(amt)) > 1) E.push(n + 'the foreign currency amount times the rate does not match the rupiah amount');
      }
    });
    if (L.length >= 2 && amountsOk && sum !== 0) E.push(`Debits and credits are not equal (off by ${rp(sum)})`);
    if (o.lock !== false && dateOk && lockState(book, e.date.slice(0, 7)) === 'locked') E.push(lockedMsg(e.date.slice(0, 7)));
    const s = e.source;
    if (s && UNIQUE_SOURCES.includes(s.type) && s.ref != null) {
      const f = findBySource(book, s.type, s.ref);
      if (f && f.id !== e.id) E.push('This source already has an entry (one source, one entry)');
    }
    return E;
  }

  function post(book, entry, now) {
    const at = stamp(now), x = entry || {};
    const e = { id: x.id || null, date: x.date, kind: x.kind || 'manual', status: 'posted', description: clean(x.description), number: x.number || null,
      lines: cleanLines(x.lines), source: cleanSource(x.source), provisional: !!x.provisional, createdAt: at, at, history: [] };
    if (x.payer) e.payer = payerKey(x.payer);
    if (x.dir === 'in' || x.dir === 'out') e.dir = x.dir;
    if (e.id && book.entries[e.id]) throw err('An entry with this id already exists');
    const E = validate(book, e); if (E.length) throw err(E);
    if (!e.id) e.id = freeId(id => !!book.entries[id], `e-${e.date.replace(/-/g, '')}-`, 4);
    book.entries[e.id] = e;
    audit(book, at, 'entry', e.id, 'post', null, snap(e));
    return e.id;
  }

  function edit(book, id, patch, why, now) {
    const e = book.entries[id], p = patch || {};
    if (!e || e.deleted) throw err('Entry not found');
    if (e.status !== 'posted') throw err('A void entry cannot be changed');
    const next = { ...e };
    for (const k of ['date', 'description', 'kind', 'number', 'provisional', 'dir']) if (k in p) next[k] = p[k];
    if ('lines' in p) next.lines = cleanLines(p.lines);
    if ('source' in p) next.source = cleanSource(p.source);
    if ('payer' in p) next.payer = payerKey(p.payer);
    const E = [];
    if (lockState(book, e.date.slice(0, 7)) === 'locked') E.push(lockedMsg(e.date.slice(0, 7)));
    for (const m of validate(book, next)) if (!E.includes(m)) E.push(m);
    if (E.length) throw err(E);
    const at = stamp(now), before = snap(e);
    next.history = [...(e.history || []), { at, why: clean(why), before }];
    next.at = at;
    book.entries[id] = next;
    audit(book, at, 'entry', id, 'edit', before, snap(next));
    return id;
  }

  function voidIn(book, e, why, at) {
    const before = snap(e);
    e.history = [...(e.history || []), { at, why: clean(why), before }];
    e.status = 'void'; e.at = at;
    return before;
  }
  function voidEntry(book, id, why, now) {
    const e = book.entries[id];
    if (!e || e.deleted) throw err('Entry not found');
    if (e.status !== 'posted') return false;
    if (lockState(book, e.date.slice(0, 7)) === 'locked') throw err(lockedMsg(e.date.slice(0, 7)));
    const at = stamp(now), before = voidIn(book, e, why, at);
    audit(book, at, 'entry', id, 'void', before, snap(e));
    return true;
  }

  // What makes two versions of a sourced entry "the same": date, kind and lines (account, amount, fx).
  const sigOf = e => JSON.stringify([e.date, e.kind || 'manual', cleanLines(e.lines).map(l => [l.account, l.amount, l.fx || null])]);
  function upsertBySource(book, entry, now) {
    const s = entry && entry.source;
    if (!s || !s.type || s.ref == null) throw err('This entry has no source to look it up by');
    const found = findBySource(book, s.type, s.ref);
    const locked = d => validDate(d) && lockState(book, d.slice(0, 7)) === 'locked';
    if (!found) {
      if (locked(entry.date)) return { id: null, action: 'locked' };
      return { id: post(book, entry, now), action: 'post' };
    }
    if (sigOf(found) === sigOf(entry)) return { id: found.id, action: 'same' };
    if (locked(found.date) || locked(entry.date)) return { id: found.id, action: 'locked' };
    const patch = { date: entry.date, kind: entry.kind || 'manual', lines: entry.lines };
    if (entry.description != null) patch.description = clean(entry.description);
    if (entry.payer) patch.payer = entry.payer;
    if (entry.dir) patch.dir = entry.dir;
    edit(book, found.id, patch, 'The source changed', now);
    return { id: found.id, action: 'edit' };
  }

  /* ── Accounts ── */
  function balanceOf(book, id) { let t = 0; for (const e of Object.values(book.entries)) if (isPosted(e)) for (const l of e.lines) if (l.account === id) t += l.amount; return t; }
  const hasLines = (book, id) => Object.values(book.entries).some(e => !e.deleted && e.lines.some(l => l.account === id));
  const isSystem = (book, id) => [book.settings.retained, book.settings.unexplained, book.settings.fxGain].includes(id);

  // Where a new account goes: with the accounts of its role (their usual parent), on the next free code.
  function place(book, a) {
    const others = live(book.accounts).filter(x => x.id !== a.id);
    let sib;
    if (a.parent) sib = others.filter(x => x.parent === a.parent);
    else {
      const groups = new Map();
      for (const x of others.filter(y => !y.header && y.role === a.role).sort((p, q) => cmpCode(p.code, q.code))) {
        const k = x.parent || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x);
      }
      sib = [...groups.values()].sort((p, q) => q.length - p.length)[0] || [];
      if (sib.length && sib[0].parent) a.parent = sib[0].parent;
    }
    if (a.code) return;
    const used = new Set(others.map(x => x.code));
    const last = sib.map(x => String(x.code || '')).sort(cmpCode).pop();
    const m = last && /^(.*\D)(\d+)$/.exec(last);
    let prefix, n = 0, w = 2;
    if (m) { prefix = m[1]; n = +m[2]; w = m[2].length; }
    else prefix = (a.parent ? book.accounts[a.parent].code : ROLES[a.role][1]) + '.';
    do { n++; a.code = prefix + String(n).padStart(w, '0'); } while (used.has(a.code));
  }
  // The rules every account must keep (a = the candidate record).
  function accountErrors(book, a) {
    const E = [], others = live(book.accounts).filter(x => x.id !== a.id);
    if (!a.name) E.push('Give the account a name');
    if (!ROLES[a.role]) E.push('Choose a role for the account (bank, card, investment, ...)');
    else if (a.kind !== ROLES[a.role][0]) E.push(`A ${a.role} account is of kind ${ROLES[a.role][0]}; the kind of an account cannot change`);
    if (a.parent && (!accOf(book, a.parent) || a.parent === a.id)) E.push('The parent account is not in the book');
    if (a.code && others.some(x => x.code === a.code)) E.push(`The code ${a.code} is already used`);
    if (a.person && !personOf(book, a.person)) E.push('That person is not in the book');
    if (a.person && (a.role === 'receivable' || a.role === 'payable') && others.some(x => x.role === a.role && x.person === a.person)) E.push('This person already has an account on that side');
    if (a.category && others.some(x => x.kind === 'expense' && low(x.category) === low(a.category))) E.push('This category already has an account');
    if (a.incomeType && others.some(x => x.kind === 'income' && low(x.incomeType) === low(a.incomeType))) E.push('This income type already has an account');
    return E;
  }
  function addAccount(book, acc, now) {
    const at = stamp(now), x = acc || {};
    const role = x.role || (x.kind === 'asset' ? 'other-asset' : x.kind === 'liability' ? 'other-liability' : x.kind);
    const a = { id: x.id || null, code: x.code ? clean(x.code) : null, name: clean(x.name), kind: x.kind || (ROLES[role] || [])[0], role, parent: x.parent || null, header: !!x.header,
      ccy: x.ccy || book.currency || 'IDR', person: x.person || null, category: clean(x.category) || null, incomeType: clean(x.incomeType) || null,
      stmt: x.stmt || null, emailBank: x.emailBank || null, tax: x.tax || null, hidden: false, origin: x.origin || 'app', at };
    if (clean(x.accurateCode)) a.accurateCode = clean(x.accurateCode);   // the account's code in the owner's Accurate book (Accountant view, §10); absent = not set
    const E = accountErrors(book, a);
    if (a.id && book.accounts[a.id]) E.push('An account with this id already exists');
    if (E.length) throw err(E);
    if (!a.id) a.id = freeId(id => !!book.accounts[id], 'a-', 6);
    place(book, a);
    book.accounts[a.id] = a;
    audit(book, at, 'account', a.id, 'add', null, a);
    return a.id;
  }
  function editAccount(book, id, patch, now) {
    const a = accOf(book, id), p = patch || {};
    if (!a) throw err('Account not found');
    const next = { ...a }, E = [];
    for (const k of ['name', 'code', 'category', 'incomeType', 'accurateCode']) if (k in p) next[k] = clean(p[k]) || null;
    for (const k of ['role', 'parent', 'ccy', 'person', 'stmt', 'emailBank', 'tax']) if (k in p) next[k] = p[k] || null;
    for (const k of ['header', 'hidden']) if (k in p) next[k] = !!p[k];
    if ('kind' in p && p.kind !== a.kind) E.push('The kind of an account cannot change');
    if (!next.code) E.push('An account needs a code');
    E.push(...accountErrors(book, next));
    if (next.header && !a.header && hasLines(book, id)) E.push('An account with entries cannot become a header');
    if (next.hidden && !a.hidden) E.push(...hideErrors(book, a));
    if (E.length) throw err([...new Set(E)]);
    const before = {}, after = {};
    for (const k of Object.keys(next)) if (JSON.stringify(next[k]) !== JSON.stringify(a[k])) { before[k] = a[k]; after[k] = next[k]; }
    if (!Object.keys(after).length) return id;
    next.at = stamp(now);
    book.accounts[id] = next;
    audit(book, next.at, 'account', id, 'edit', before, after);
    return id;
  }
  function hideErrors(book, a) {
    if (isSystem(book, a.id)) return ['The book needs this account, so it cannot be hidden'];
    const bal = balanceOf(book, a.id);
    return bal ? [`${a.name} still has a balance of ${rp(bal)}; bring it to zero first`] : [];
  }
  function hideAccount(book, id, now) {
    const a = accOf(book, id);
    if (!a) throw err('Account not found');
    if (a.hidden) return false;
    const E = hideErrors(book, a); if (E.length) throw err(E);
    a.hidden = true; a.at = stamp(now);
    audit(book, a.at, 'account', id, 'hide', { hidden: false }, { hidden: true });
    return true;
  }
  // One account per spending category / income type: found by its tag, else an untagged account of
  // that name (a migrated one) takes the tag, else a new one.
  function tagAccount(book, role, field, value, now) {
    const name = clean(value), what = field === 'category' ? 'category' : 'income type';
    if (!name) throw err(`Choose a ${what}`);
    const all = live(book.accounts).filter(a => a.role === role && !a.header).sort((p, q) => cmpCode(p.code, q.code));
    const hit = all.find(a => low(a[field]) === low(name));
    if (hit) return hit.id;
    const same = all.find(a => !a[field] && low(a.name) === low(name));
    if (same) { const at = stamp(now); same[field] = name; same.at = at; audit(book, at, 'account', same.id, 'edit', { [field]: null }, { [field]: name }); return same.id; }
    return addAccount(book, { name, role, [field]: name }, now);
  }
  const categoryAccount = (book, category, now) => tagAccount(book, 'expense', 'category', category, now);
  const incomeAccount = (book, incomeType, now) => tagAccount(book, 'income', 'incomeType', incomeType, now);

  /* ── People ── */
  function addPerson(book, person, now) {
    const at = stamp(now), x = person || {}, name = clean(x.name);
    if (!name) throw err('Give the person a name');
    if (live(book.people).some(p => low(p.name) === low(name))) throw err(`${name} is already in the book`);
    if (x.id && book.people[x.id]) throw err('A person with this id already exists');
    const p = { id: x.id || freeId(id => !!book.people[id], 'p-', 6), name, type: x.type || 'person', at };
    book.people[p.id] = p;
    audit(book, at, 'person', p.id, 'add', null, p);
    return p.id;
  }
  function personAccount(book, personId, side, now) {
    if (side !== 'receivable' && side !== 'payable') throw err('The side is receivable (they owe you) or payable (you owe them)');
    const p = personOf(book, personId);
    if (!p) throw err('That person is not in the book');
    const hit = live(book.accounts).find(a => a.role === side && a.person === personId);
    if (hit) return hit.id;
    return addAccount(book, { name: `${p.name} (${side === 'receivable' ? 'owes you' : 'you owe'})`, role: side, person: personId }, now);
  }

  /* ── Answers → lines (§4) ── */
  function buildEntry(book, kind, d, now) {
    d = d || {};
    if (!ENTRY_KINDS.includes(kind)) throw err(`"${kind}" is not a kind of entry`);
    const head = { date: d.date, kind, description: clean(d.description) };
    if (d.id) head.id = d.id;
    const tail = { source: cleanSource(d.source), provisional: !!d.provisional };
    if (d.payer) tail.payer = payerKey(d.payer);
    if (d.dir === 'in' || d.dir === 'out') tail.dir = d.dir;
    const A = ANSWERS[kind];
    if (!A) {                                             // opening, manual, year-end, migrated: the lines are given
      if (!Array.isArray(d.lines)) throw err('Enter the lines of this entry');
      return { ...head, lines: cleanLines(d.lines), ...tail };
    }
    const E = [], amt = d.amount;
    if (!isInt(amt) || amt <= 0) E.push('Enter an amount above zero, in whole rupiah');
    if (!A.noAccount && !accOf(book, d.account)) E.push('Choose the account the money moved through');
    if (d.dir != null && d.dir !== 'in' && d.dir !== 'out') E.push('The direction is "in" or "out"');
    else if (d.dir && A.dir && d.dir !== A.dir && !A.flips) E.push(`${A.label} is money ${A.dir}, not money ${d.dir}`);
    if (A.person && !personOf(book, d.person)) E.push('Choose the person');
    if (A.to && (!accOf(book, d.toAccount) || d.toAccount === d.account)) E.push('Choose the other account (not the same one)');
    if (kind === 'spending' && !clean(d.category)) E.push('Choose a category');
    const tax = d.taxWithheld == null ? 0 : d.taxWithheld;
    if (kind === 'income' && (!isInt(tax) || tax < 0)) E.push('The tax withheld must be whole rupiah, zero or more');
    const cost = d.cost == null ? amt : d.cost;
    if (kind === 'invest-sell' && (!isInt(cost) || cost <= 0)) E.push('The cost of what was sold must be above zero, in whole rupiah');
    let others = [], share = 0;
    if (kind === 'split') {
      others = Array.isArray(d.others) ? d.others : d.person ? [{ person: d.person, amount: isInt(d.share) ? amt - d.share : null }] : [];
      const sumOthers = others.reduce((t, o) => t + (o && isInt(o.amount) ? o.amount : 0), 0);
      share = d.share == null ? amt - sumOthers : d.share;
      if (!others.length) E.push('Choose at least one other person for the split');
      else if (others.some(o => !o || !personOf(book, o.person))) E.push('Choose the person for each part of the split');
      else if (others.some(o => !isInt(o.amount) || o.amount <= 0) || !isInt(share) || share < 0) E.push('Each part of the split must be whole rupiah (your own part may be zero)');
      else if (share + sumOthers !== amt) E.push('Your part and the others\' parts must add up to the amount');
      if (share > 0 && !clean(d.category)) E.push('Choose a category');
    }
    if (E.length) throw err(E);

    const ln = (account, amount) => ({ account, amount, memo: '' });
    const acct = amount => { const l = ln(d.account, amount); if (d.fx) l.fx = { ccy: d.fx.ccy, amount: d.fx.amount, rate: d.fx.rate }; return l; };
    const recv = p => personAccount(book, p, 'receivable', now), pay = p => personAccount(book, p, 'payable', now);
    let L;
    switch (kind) {
      case 'spending': case 'fee': {
        const cat = categoryAccount(book, clean(d.category) || 'Bank fees', now), s = d.dir === 'in' ? -1 : 1;   // in = a refund
        L = [ln(cat, s * amt), acct(-s * amt)]; break;
      }
      case 'paid-for': case 'lent': case 'reimburse': L = [ln(recv(d.person), amt), acct(-amt)]; break;
      case 'split':
        L = [...(share > 0 ? [ln(categoryAccount(book, d.category, now), share)] : []), ...others.map(o => ln(recv(o.person), o.amount)), acct(-amt)]; break;
      case 'repaid-in': L = [acct(amt), ln(recv(d.person), -amt)]; break;
      case 'borrowed': L = [acct(amt), ln(pay(d.person), -amt)]; break;
      case 'repaid-out': L = [ln(pay(d.person), amt), acct(-amt)]; break;
      case 'income':                                       // the amount is what arrived; income is booked gross
        L = [acct(amt), ...(tax ? [ln(categoryAccount(book, 'Tax', now), tax)] : []), ln(incomeAccount(book, clean(d.incomeType) || 'Other income', now), -(amt + tax))]; break;
      case 'transfer': case 'card-payment': case 'invest-buy': L = [ln(d.toAccount, amt), acct(-amt)]; break;
      case 'invest-sell':                                  // toAccount = the investment sold; a loss debits the gain account
        L = [acct(amt), ln(d.toAccount, -cost), ...(amt !== cost ? [ln(incomeAccount(book, 'Investment gain', now), cost - amt)] : [])]; break;
      case 'write-off': L = [ln(categoryAccount(book, clean(d.category) || 'Written off', now), amt), ln(recv(d.person), -amt)]; break;
      case 'adjust':
        L = d.dir === 'in' ? [acct(amt), ln(book.settings.unexplained, -amt)] : [ln(book.settings.unexplained, amt), acct(-amt)]; break;
    }
    return { ...head, lines: L, ...tail };
  }

  /* ── Balances and statements ── */
  function balances(book, asOf) {
    const T = asOfDate(asOf), out = {};
    for (const a of live(book.accounts)) out[a.id] = 0;
    for (const e of Object.values(book.entries || {})) {
      if (!isPosted(e) || (T && e.date > T)) continue;
      for (const l of e.lines) out[l.account] = (out[l.account] || 0) + l.amount;
    }
    return out;
  }
  function rowBase(book, id) {
    const a = book.accounts[id];
    return a ? { account: id, code: a.code, name: a.name, kind: a.kind, role: a.role, header: !!a.header, hidden: !!a.hidden }
      : { account: id, code: id, name: id, kind: null, role: null, header: false, hidden: false, unknown: true };
  }
  const byCode = (p, q) => cmpCode(p.code, q.code) || cmp(p.account, q.account);
  // Trial balance [from, to]: every account that takes entries and is not hidden, plus any account with figures.
  function tb(book, from, to) {
    const [F, T] = range(from, to), m = new Map();
    for (const e of postedList(book)) {
      if (e.date > T) break;
      for (const l of e.lines) {
        let r = m.get(l.account); if (!r) m.set(l.account, r = { opening: 0, debit: 0, credit: 0 });
        if (e.date < F) r.opening += l.amount; else if (l.amount > 0) r.debit += l.amount; else r.credit -= l.amount;
      }
    }
    const ids = new Set(m.keys());
    for (const a of live(book.accounts)) if (!a.header && !a.hidden) ids.add(a.id);
    const rows = [...ids].map(id => { const r = m.get(id) || { opening: 0, debit: 0, credit: 0 }; return { ...rowBase(book, id), ...r, closing: r.opening + r.debit - r.credit }; }).sort(byCode);
    const totals = rows.reduce((t, r) => ({ opening: t.opening + r.opening, debit: t.debit + r.debit, credit: t.credit + r.credit, closing: t.closing + r.closing }), { opening: 0, debit: 0, credit: 0, closing: 0 });
    return { from: from || null, to: to || null, rows, totals, balanced: totals.debit === totals.credit, openingBalanced: totals.opening === 0 };
  }
  // Balance sheet as of a date: assets +(dr − cr), liabilities and equity −(dr − cr); income and
  // expense show as two earnings lines split at 1 January of the as-of year.
  function bs(book, asOf) {
    const T = asOfDate(asOf) || '9999-12-31', fy = T.slice(0, 4) + '-01-01', bal = new Map();
    let prior = 0, cur = 0;
    for (const e of postedList(book)) {
      if (e.date > T) break;
      for (const l of e.lines) {
        const a = book.accounts[l.account], k = a ? a.kind : null;
        if (k === 'income' || k === 'expense') { if (e.date < fy) prior += l.amount; else cur += l.amount; }
        else bal.set(l.account, (bal.get(l.account) || 0) + l.amount);
      }
    }
    const assets = [], liabilities = [], equity = [];
    for (const [id, v] of bal) {
      if (!v) continue;
      const b = rowBase(book, id), k = b.kind || 'asset';
      const row = { account: id, code: b.code, name: b.name, amount: k === 'asset' ? v : -v }; if (b.unknown) row.unknown = true;
      (k === 'asset' ? assets : k === 'liability' ? liabilities : equity).push(row);
    }
    for (const list of [assets, liabilities, equity]) list.sort(byCode);
    const sum = r => r.reduce((t, q) => t + q.amount, 0);
    const unclosedPriorEarnings = prior ? -prior : 0, currentYearEarnings = cur ? -cur : 0;
    const totalAssets = sum(assets), totalLiabilities = sum(liabilities), totalEquity = sum(equity) + unclosedPriorEarnings + currentYearEarnings;
    return { asOf: T, fyStart: fy, assets, liabilities, equity, unclosedPriorEarnings, currentYearEarnings, totalAssets, totalLiabilities, totalEquity,
      totalLE: totalLiabilities + totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
  }
  // Income statement [from, to]; year-end entries are left out. income = −(dr − cr), expense = dr − cr.
  function pl(book, from, to) {
    const [F, T] = range(from, to), s = new Map();
    for (const e of postedList(book)) {
      if (e.date > T) break; if (e.date < F || e.kind === 'year-end') continue;
      for (const l of e.lines) { const a = book.accounts[l.account]; if (a && (a.kind === 'income' || a.kind === 'expense')) s.set(l.account, (s.get(l.account) || 0) + l.amount); }
    }
    const income = [], expense = [];
    for (const [id, v] of s) { if (!v) continue; const a = book.accounts[id]; (a.kind === 'income' ? income : expense).push({ account: id, code: a.code, name: a.name, amount: a.kind === 'income' ? -v : v }); }
    income.sort(byCode); expense.sort(byCode);
    const totalIncome = income.reduce((t, r) => t + r.amount, 0), totalExpense = expense.reduce((t, r) => t + r.amount, 0);
    return { from: from || null, to: to || null, income, expense, totalIncome, totalExpense, net: totalIncome - totalExpense };
  }
  // One account's lines with a running balance.
  function ledgerOf(book, account, from, to) {
    if (!book.accounts[account]) throw err('Account not found');
    const [F, T] = range(from, to), rows = [];
    let opening = 0, run = 0, debit = 0, credit = 0;
    for (const e of postedList(book)) {
      if (e.date > T) break;
      for (const l of e.lines) {
        if (l.account !== account) continue;
        if (e.date < F) { opening += l.amount; run = opening; continue; }
        const dr = l.amount > 0 ? l.amount : 0, cr = l.amount < 0 ? -l.amount : 0; run += l.amount; debit += dr; credit += cr;
        const row = { date: e.date, id: e.id, number: e.number, kind: e.kind, description: e.description, memo: l.memo || '', debit: dr, credit: cr, running: run };
        if (l.fx) row.fx = cp(l.fx);
        rows.push(row);
      }
    }
    return { ...rowBase(book, account), from: from || null, to: to || null, opening, rows, debit, credit, closing: opening + debit - credit };
  }

  /* ── People ── */
  // The open items of one person account, oldest first: money back settles the oldest item first.
  function openItems(book, accId, sign, T, side) {
    const items = []; let settled = 0, balance = 0;
    if (!accId) return { items, balance };
    for (const e of postedList(book)) {
      if (T && e.date > T) break;
      for (const l of e.lines) {
        if (l.account !== accId) continue;
        const v = l.amount * sign; balance += v;
        if (v > 0) items.push({ entry: e.id, date: e.date, kind: e.kind, description: e.description, side, amount: v, open: v }); else settled -= v;
      }
    }
    for (const it of items) { const u = Math.min(it.open, settled); it.open -= u; settled -= u; }
    return { items: items.filter(i => i.open > 0), balance };
  }
  function people(book, asOf) {
    const T = asOfDate(asOf), accs = live(book.accounts);
    return live(book.people).sort((p, q) => cmp(low(p.name), low(q.name)) || cmp(p.id, q.id)).map(p => {
      const find = side => (accs.find(a => a.role === side && a.person === p.id) || {}).id;
      const r = openItems(book, find('receivable'), 1, T, 'receivable'), y = openItems(book, find('payable'), -1, T, 'payable');
      const items = [...r.items, ...y.items].sort((a, b) => cmp(a.date, b.date));
      return { person: p.id, name: p.name, type: p.type, owedToYou: r.balance, youOwe: y.balance, items, oldestDate: items.length ? items[0].date : null };
    });
  }

  /* ── Month figures ── */
  function monthLines(book, month, fn) {
    needMonth(month);
    for (const e of Object.values(book.entries || {})) {
      if (!isPosted(e) || e.date.slice(0, 7) !== month) continue;
      for (const l of e.lines) fn(e, l, book.accounts[l.account] || null);
    }
  }
  const isSpendingAcc = a => !!a && a.kind === 'expense' && a.role !== 'unexplained' && a.role !== 'fx';
  const isIncomeAcc = a => !!a && a.kind === 'income' && a.role !== 'fx';
  function grouped(book, month, pick, sign, nameOf) {
    const by = {}; let total = 0;
    monthLines(book, month, (e, l, a) => { if (e.kind === 'year-end' || !pick(a)) return; const n = nameOf(a); by[n] = (by[n] || 0) + sign * l.amount; total += sign * l.amount; });
    for (const k of Object.keys(by)) if (!by[k]) delete by[k];
    return { total, by };
  }
  // Net debits to expense accounts (fees in; refunds net; the unexplained and fx accounts and year-end entries out).
  function actualSpending(book, month) { const g = grouped(book, month, isSpendingAcc, 1, a => a.category || a.name); return { total: g.total, byCategory: g.by }; }
  // Net credits to income accounts (the fx account and year-end entries out).
  function income(book, month) { const g = grouped(book, month, isIncomeAcc, -1, a => a.incomeType || a.name); return { total: g.total, byType: g.by }; }
  function saved(book, month) { const i = income(book, month).total, s = actualSpending(book, month).total; return { income: i, spending: s, saved: i - s }; }

  // The latest stored value of each account, for the month or an earlier one.
  function valuesAt(book, month) {
    const best = {};
    for (const v of live(book.values)) if (v.month <= month && (!best[v.account] || v.month > best[v.account].month)) best[v.account] = v;
    return best;
  }
  function netWorth(book, month, view) {
    needMonth(month);
    const bal = balances(book, monthEnd(month)), vals = view === 'market' ? valuesAt(book, month) : {};
    let assets = 0, liabilities = 0;
    for (const [id, v] of Object.entries(bal)) {
      const a = book.accounts[id], k = a ? a.kind : 'asset';
      if (k === 'asset') assets += vals[id] && a && !a.header ? vals[id].value : v;
      else if (k === 'liability') liabilities -= v;
    }
    return { assets, liabilities, net: assets - liabilities };
  }
  function setValue(book, account, month, value, now) {
    const E = [];
    if (!accOf(book, account)) E.push('Account not found');
    if (!validMonth(month)) E.push('Enter a valid month (YYYY-MM)');
    if (!isInt(value)) E.push('The value must be whole rupiah');
    if (E.length) throw err(E);
    const at = stamp(now), key = `${account}|${month}`, before = book.values[key] || null;
    book.values[key] = { account, month, value, at };
    audit(book, at, 'value', key, 'set', before, book.values[key]);
    return key;
  }
  // Why net worth (market view) moved in the month:
  // opening + income − spending + market + fx + unexplained + other = closing, exactly.
  function bridge(book, month) {
    needMonth(month);
    const prev = shiftMonth(month, -1);
    const opening = netWorth(book, prev, 'market').net, closing = netWorth(book, month, 'market').net;
    const gap = M => netWorth(book, M, 'market').net - netWorth(book, M, 'book').net;
    let inc = 0, spend = 0, fx = 0, unexplained = 0, other = 0;
    monthLines(book, month, (e, l, a) => {
      const k = a ? a.kind : 'asset';
      if (k === 'asset' || k === 'liability') return;                    // net worth itself
      if (e.kind === 'year-end' || k === 'equity') other -= l.amount;    // opening balances, year-end close (nets to zero)
      else if (a.role === 'fx') fx -= l.amount;
      else if (a.role === 'unexplained') unexplained -= l.amount;
      else if (k === 'income') inc -= l.amount;
      else spend += l.amount;
    });
    return { opening, income: inc, spending: spend, market: gap(month) - gap(prev), fx, unexplained, other, closing };
  }

  /* ── Accurate export (Accountant view, §10) ── */
  // One balanced journal for a month, dated its last day: each account's net movement from the
  // month's posted entries. Accounts that net to zero are left out, and so is the year-end entry
  // (Accurate closes its own year). Lines are {account (the id), amount (debit positive)}, in code order.
  function monthSummary(book, month) {
    needMonth(month);
    const net = new Map(), seen = new Set();
    monthLines(book, month, (e, l) => { if (e.kind === 'year-end') return; seen.add(e.id); net.set(l.account, (net.get(l.account) || 0) + l.amount); });
    const code = id => (book.accounts[id] || {}).code || id;
    const lines = [...net.keys()].filter(id => net.get(id)).sort((p, q) => cmpCode(code(p), code(q)) || cmp(p, q)).map(id => ({ account: id, amount: net.get(id) }));
    return { month, number: 'ET-' + month, date: monthEnd(month), description: 'ExpenseTrack summary ' + monthLabel(month), entries: seen.size, lines };
  }

  /* ── Rules and suggestions ── */
  function addRule(book, rule, now) {
    const x = rule || {}, m = x.match || {}, a = x.answer || {}, E = [];
    if (!clean(m.payer)) E.push('A rule needs a payer to match');
    if (m.dir != null && m.dir !== 'in' && m.dir !== 'out') E.push('The direction is "in" or "out"');
    if (!ANSWERS[a.kind]) E.push(`"${a.kind}" is not a kind of answer`);
    if (x.id && book.rules.some(r => r.id === x.id)) E.push('A rule with this id already exists');
    if (E.length) throw err(E);
    const at = stamp(now), match = { payer: payerKey(m.payer) }; if (m.dir) match.dir = m.dir;
    const r = { id: x.id || freeId(id => book.rules.some(q => q.id === id), 'r-', 6), match, answer: cp(a), at };
    book.rules.push(r);
    audit(book, at, 'rule', r.id, 'add', null, r);
    return r.id;
  }
  function removeRule(book, id, now) {
    const r = book.rules.find(q => q.id === id);
    if (!r || r.deleted) return false;
    const at = stamp(now), before = cp(r);
    r.deleted = true; r.at = at;
    audit(book, at, 'rule', id, 'remove', before, r);
    return true;
  }
  // The answer an entry stands for, read back from its lines.
  function answerOf(book, e) {
    const out = { kind: e.kind }, accs = e.lines.map(l => book.accounts[l.account]).filter(Boolean);
    const pick = f => { const a = accs.find(f); return a || null; };
    if (['spending', 'fee', 'split', 'write-off'].includes(e.kind)) { const a = pick(q => q.kind === 'expense' && q.category); if (a) out.category = a.category; }
    if (ANSWERS[e.kind].person || e.kind === 'split') { const a = pick(q => q.person); if (a) out.person = a.person; }
    if (e.kind === 'income') { const a = pick(q => q.kind === 'income' && q.incomeType); if (a) out.incomeType = a.incomeType; }
    if (['transfer', 'card-payment', 'invest-buy'].includes(e.kind)) out.toAccount = e.lines[0].account;
    if (e.kind === 'invest-sell') out.toAccount = e.lines[1].account;
    return out;
  }
  function suggest(book, item) {
    const x = item || {}, payer = payerKey(x.payer);
    if (!payer) return null;
    const rule = book.rules.filter(r => !r.deleted && r.match.payer === payer && (!r.match.dir || !x.dir || r.match.dir === x.dir))
      .sort((a, b) => cmp(b.at, a.at) || cmp(b.id, a.id))[0];
    if (rule) return cp(rule.answer);
    const e = postedList(book).filter(q => q.payer === payer && ANSWERS[q.kind] && (!q.dir || !x.dir || q.dir === x.dir))
      .sort((a, b) => cmp(b.date, a.date) || cmp(b.at, a.at) || cmp(b.id, a.id))[0];
    return e ? answerOf(book, e) : null;
  }

  /* ── Settings ── */
  function setSetting(book, key, value, now) {
    if (!SETTING_KEYS.includes(key)) throw err(`"${key}" is not a setting of the book`);
    if (['retained', 'unexplained', 'fxGain'].includes(key) && !accOf(book, value)) throw err('Account not found');
    const at = stamp(now), before = { [key]: book.settings[key] };
    book.settings[key] = cp(value); book.settings.at = at;
    audit(book, at, 'settings', key, 'edit', before, { [key]: value });
    return true;
  }

  /* ── Two devices ── */
  // The copy that wins: the newer `at`; on a tie a tombstone or a void, then a fixed order.
  function newer(x, y) {
    if (!x) return y; if (!y) return x;
    const ax = String(x.at || ''), ay = String(y.at || '');
    if (ax !== ay) return ax > ay ? x : y;
    const gone = o => (o.deleted || o.status === 'void' ? 1 : 0);
    if (gone(x) !== gone(y)) return gone(x) ? x : y;
    return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
  }
  function mergeMaps(a, b) { const out = {}; for (const k of [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort()) out[k] = cp(newer((a || {})[k], (b || {})[k])); return out; }
  const listMap = l => Object.fromEntries((l || []).map(x => [x.id, x]));
  function merge(a, b, now) {
    const at = stamp(now);
    const out = {
      schema: SCHEMA, createdAt: [a.createdAt, b.createdAt].filter(Boolean).sort()[0] || at,
      updatedAt: [a.updatedAt, b.updatedAt].filter(Boolean).sort().pop() || at, currency: a.currency || b.currency || 'IDR',
      accounts: mergeMaps(a.accounts, b.accounts), people: mergeMaps(a.people, b.people), entries: mergeMaps(a.entries, b.entries),
      values: mergeMaps(a.values, b.values), checks: mergeMaps(a.checks, b.checks), locks: mergeMaps(a.locks, b.locks),
      rules: Object.values(mergeMaps(listMap(a.rules), listMap(b.rules))),
      settings: cp(newer(a.settings, b.settings)),
      audit: Object.values({ ...listMap(cp(b.audit)), ...listMap(cp(a.audit)) }).sort((p, q) => cmp(p.at, q.at) || cmp(p.id, q.id)),
      migration: cp(!a.migration ? b.migration : !b.migration ? a.migration : String(a.migration.at) <= String(b.migration.at) ? a.migration : b.migration) || null,
    };
    // One source, one entry: of two posted entries with the same unique source the older stays.
    const seen = new Map();
    const list = Object.values(out.entries).filter(e => isPosted(e) && e.source && UNIQUE_SOURCES.includes(e.source.type) && e.source.ref != null)
      .sort((p, q) => cmp(p.createdAt || '', q.createdAt || '') || cmp(p.id, q.id));
    for (const e of list) {
      const k = e.source.type + '|' + e.source.ref;
      if (!seen.has(k)) { seen.set(k, e); continue; }
      const before = voidIn(out, e, 'duplicate source', at);
      out.audit.push({ id: 'u-dup-' + e.id + '-' + at, at, entity: 'entry', ref: e.id, action: 'void', before, after: snap(e) });
      if (at > out.updatedAt) out.updatedAt = at;
    }
    out.audit.sort((p, q) => cmp(p.at, q.at) || cmp(p.id, q.id));
    return out;
  }

  /* ── History conversion from the old book (et-ledger/2), §5 ── */
  const oldPostable = a => !!a && (a.postable != null ? !!a.postable : !a.isParent);
  const oldPosted = ledger => Object.values(ledger.vouchers || {}).filter(v => v && v.status === 'posted' && validDate(v.date));
  function oldRole(a, retained) {
    const g = a.group;
    if (a.kind === 'asset') return g === 'cash' ? 'bank' : g === 'deposits' || g === 'stocks' || g === 'business' || a.investment ? 'investment'
      : g === 'property' ? 'property' : g === 'receivables' ? 'receivable' : 'other-asset';
    if (a.kind === 'liability') return g === 'cards' ? 'card' : g === 'loans' ? 'loan' : 'other-liability';
    if (a.kind === 'equity') return a.id === retained ? 'retained' : 'equity';
    return a.kind === 'income' ? 'income' : a.kind === 'expense' ? 'expense' : 'other-asset';
  }
  function fromLedgerV2(ledger, now, opts) {
    if (!ledger || ledger.schema !== 'et-ledger/2' || !ledger.accounts || !ledger.vouchers) throw err('This is not an et-ledger/2 book, so it cannot be converted');
    const at = stamp(now), book = emptyBook(at), old = ledger, set = old.settings || {};
    const aid = code => 'a-' + code;
    book.accounts = {}; book.currency = old.currency || 'IDR';
    const put = (code, o) => { book.accounts[aid(code)] = { id: aid(code), code: String(code), parent: null, header: false, ccy: book.currency, person: null, category: null, incomeType: null,
      stmt: null, emailBank: null, tax: null, hidden: false, origin: 'migration', at, ...o }; };
    for (const a of Object.values(old.accounts).sort((p, q) => cmpCode(p.id, q.id))) {
      const kind = KINDS.includes(a.kind) ? a.kind : 'asset';
      put(a.id, { name: a.name || String(a.id), kind, role: oldRole({ ...a, kind }, set.retainedEarnings), parent: a.parent && old.accounts[a.parent] ? aid(a.parent) : null,
        header: !oldPostable(a), ccy: a.ccy || book.currency, hidden: !!a.archivedAt || a.active === false || !!a.suspended,
        accurateCode: clean(a.oldCode) || String(a.id) });   // the code this account has in Accurate: the one it had before a re-code, else its own
    }
    const posted = oldPosted(old).sort((p, q) => cmp(p.date, q.date) || cmp(p.number || '', q.number || '') || cmp(p.id, q.id));
    // A line on a code that is not in the old chart (migrated data only) still needs an account.
    for (const v of posted) for (const l of v.lines || []) if (l && l.amount && !book.accounts[aid(l.account)]) put(l.account, { name: String(l.account), kind: 'asset', role: 'other-asset', hidden: true, accurateCode: String(l.account) });
    // The system accounts: the old Retained earnings account, and two new ones on free codes.
    const usedCodes = new Set(Object.values(book.accounts).map(a => a.code));
    const sys = (id, role, name) => { let c = +ROLES[role][1]; while (usedCodes.has(String(c))) c++; usedCodes.add(String(c)); book.accounts[id] = sysAccount(id, String(c), name, role, at); return id; };
    const re = set.retainedEarnings != null && book.accounts[aid(set.retainedEarnings)];
    book.settings.retained = re && re.kind === 'equity' ? re.id : sys('a-retained', 'retained', 'Retained earnings');
    book.settings.unexplained = sys('a-unexplained', 'unexplained', 'Unexplained differences');
    book.settings.fxGain = sys('a-fx', 'fx', 'Exchange gains and losses');

    for (const v of posted) {
      const id = 'e-m-' + v.id;
      book.entries[id] = { id, date: v.date, kind: v.kind === 'year-end' ? 'year-end' : 'migrated', status: 'posted', description: v.description || '', number: v.number || null,
        lines: (v.lines || []).filter(l => l && l.amount).map(l => { const o = { account: aid(l.account), amount: l.amount, memo: l.memo || '' }; if (l.fx) o.fx = cp(l.fx); return o; }),
        source: { type: 'migration', ref: String(v.id) }, provisional: false, createdAt: v.createdAt || at, at, history: [] };
    }
    for (const [M, p] of Object.entries(old.periods || {})) if (validMonth(M) && p && (p.state === 'closed' || p.state === 'locked')) book.locks[M] = { state: 'locked', at: p.at || at, reason: '' };
    for (const [M, o] of Object.entries(old.market || {})) for (const [code, e] of Object.entries(o || {})) {
      if (!validMonth(M) || !e || e.deleted || e.v == null || !book.accounts[aid(code)]) continue;
      book.values[`${aid(code)}|${M}`] = { account: aid(code), month: M, value: Math.round(+e.v), at: e.at || at };
    }
    const firstPosted = posted.length ? posted[0].date.slice(0, 7) : null, lastPosted = posted.length ? posted[posted.length - 1].date.slice(0, 7) : null;
    const lastLocked = Object.keys(book.locks).sort().pop();
    book.settings.firstMonth = set.firstMonth || firstPosted;
    const after = lastLocked || lastPosted;
    book.settings.syncFrom = (after ? shiftMonth(after, 1) : at.slice(0, 7)) + '-01';

    const diffs = gateDiffs(old, book, opts);
    book.migration = { from: 'et-ledger/2', at, entries: posted.length, accounts: Object.keys(old.accounts).length, diffs: diffs.length };
    book.audit.push({ id: 'u-migrate-' + at, at, entity: 'book', ref: null, action: 'migrate', before: null, after: cp(book.migration) });
    return { book, diffs };
  }
  // The gate: every (account code, month) whose closing balance differs between the old book and the
  // new one, from the first month to the last entry. The old side is worked out here from the old
  // posted journals, or by the old engine itself when opts.tb = ledgerLib.tb is given.
  function gateDiffs(ledger, book, opts) {
    const posted = oldPosted(ledger);
    if (!posted.length) return [];
    const dates = posted.map(v => v.date).sort(), set = ledger.settings || {};
    let first = dates[0].slice(0, 7); if (validMonth(set.firstMonth) && set.firstMonth < first) first = set.firstMonth;
    const months = monthRange(first, dates[dates.length - 1].slice(0, 7)), tbOld = opts && opts.tb, diffs = [];
    const lines = [];
    if (!tbOld) for (const v of posted) for (const l of v.lines || []) if (l && l.amount) lines.push({ date: v.date, code: String(l.account), amount: l.amount });
    lines.sort((p, q) => cmp(p.date, q.date));
    const run = {}; let i = 0;
    for (const M of months) {
      const end = monthEnd(M); let was;
      if (tbOld) { was = {}; for (const r of tbOld(ledger, null, end).rows) was[r.code] = r.closing; }
      else { for (; i < lines.length && lines[i].date <= end; i++) run[lines[i].code] = (run[lines[i].code] || 0) + lines[i].amount; was = run; }
      const is = {};
      for (const [id, v] of Object.entries(balances(book, end))) { const a = book.accounts[id], c = a ? String(a.code) : id; is[c] = (is[c] || 0) + v; }
      for (const code of [...new Set([...Object.keys(was), ...Object.keys(is)])].sort(cmpCode)) {
        const o = was[code] || 0, n = is[code] || 0;
        if (o !== n) diffs.push({ code, month: M, old: o, new: n });
      }
    }
    return diffs;
  }

  const bookLib = {
    SCHEMA, emptyBook, validate, post, edit, voidEntry, findBySource, upsertBySource,
    addAccount, editAccount, hideAccount, categoryAccount, addPerson, personAccount, buildEntry,
    balances, tb, bs, pl, ledgerOf, people, actualSpending, income, saved, netWorth, bridge,
    lock, unlock, lockState, addRule, removeRule, suggest, merge, fromLedgerV2,
    // Not in the §3 table (see "Engine decisions" in docs/v6-book.md):
    incomeAccount, setValue, setSetting, gateDiffs, seedIds, setCheck, checksOf, yearEndOf, monthSummary, KINDS, ROLES: Object.keys(ROLES), ENTRY_KINDS,
  };
  globalThis.bookLib = bookLib;
  if (typeof module !== 'undefined' && module && module.exports) module.exports = bookLib;
})();
