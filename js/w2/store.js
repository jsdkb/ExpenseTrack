/* ExpenseTrack v6 — the new book's store (docs/v6-book.md §6) and its first page, "Start here" (§7).

   Holds the live new book (schema et-book/3): loads it once per sign-in from the device cache
   (IndexedDB `et-book2`, one entry per Google account) and from Drive appData `book.json`, saves it
   back debounced with compare-and-swap on the Drive revision (a conflict re-reads, merges with
   bookLib.merge and uploads), converts the current book on request, and copies the spending rows
   read from bank emails into the new book.

   Read-only towards everything old (§0): this file never writes STATE, never calls
   scheduleDriveSave() or a mutating ledger* function, never writes the old localStorage or
   IndexedDB keys and registers no transform. It reads ALL_TRANSACTIONS, LEDGER(), USER_EMAIL and
   the core's Drive helpers, and writes only the new book. No personal data in this file. */
(function () {
  'use strict';
  if (typeof bookLib === 'undefined' || typeof registerPage !== 'function' || typeof registerHook !== 'function') {
    console.warn('ExpenseTrack preview: the new book engine is not loaded, so its store stays off.');
    return;
  }

  const FILE = 'book.json', IDB_NAME = 'et-book2', IDB_STORE = 'book', SAVE_MS = 1500, DIFFS_KEPT = 200;
  const SCHEMA = bookLib.SCHEMA || 'et-book/3';

  let B = null;              // the live book
  let BFOR = '';             // the Google account it belongs to
  let STATUS = 'idle';       // idle | loading | ready | none | error | blocked
  let ERROR = null, BLOCKED = null, BUSY = null;
  let LOCAL_DONE = false, DRIVE_TRIED = false;
  let fileId = null, revId = null;
  let SAVE_T = null, SAVING = null, SYNC_T = null;
  let UNSAVED = false, EDIT = 0, VER = 0;
  let COUNTS = null;         // result of the last spending sync
  let GATE = null;           // result of the last conversion attempt
  let SYNC_SIG = '';

  const now = () => new Date().toISOString();
  const cp = o => JSON.parse(JSON.stringify(o));
  const owner = () => (typeof USER_EMAIL === 'string' && USER_EMAIL) || '';
  const token = () => (typeof accessToken !== 'undefined' && accessToken) || null;
  const errText = e => (e && Array.isArray(e.errors) && e.errors.length ? e.errors.join(' · ') : String((e && e.message) || e));
  const validBook = x => !!x && typeof x === 'object' && x.schema === SCHEMA && !!x.accounts && typeof x.accounts === 'object' &&
    !!x.entries && typeof x.entries === 'object' && !!x.settings && typeof x.settings === 'object';
  const onW2 = () => typeof ACTIVE_TAB === 'string' && ACTIVE_TAB.indexOf('w2-') === 0;
  function rerender() { if (onW2() && typeof renderAll === 'function') { try { renderAll(); } catch (e) { console.error('Preview page failed to render', e); } } }
  function hooks(why) { try { runHooks('book2Changed', why || ''); } catch (_) { /* a page's hook never breaks the store */ } }

  // A cheap fingerprint: which records exist and when each last changed.
  function fp(x) {
    if (!x) return '';
    const p = [];
    for (const k of ['accounts', 'people', 'entries', 'values', 'checks', 'locks']) {
      for (const [id, v] of Object.entries(x[k] || {})) p.push(k[0] + k[1] + ':' + id + ':' + String((v && v.at) || '') + ':' + String((v && v.status) || ''));
    }
    p.push('R' + (x.rules || []).length, 'U' + (x.audit || []).length, 'S' + String((x.settings && x.settings.at) || ''));
    return p.sort().join('|');
  }

  /* ── Device cache: IndexedDB `et-book2`, one entry per account, guarded and timed out ── */
  function idb(mode, fn) {
    return new Promise(res => {
      let done = false; const end = v => { if (!done) { done = true; res(v); } };
      setTimeout(() => end(null), 3000);
      try {
        const r = indexedDB.open(IDB_NAME, 1);
        r.onupgradeneeded = () => { try { r.result.createObjectStore(IDB_STORE); } catch (_) { } };
        r.onerror = () => end(null); r.onblocked = () => end(null);
        r.onsuccess = () => {
          try {
            const db = r.result, tx = db.transaction(IDB_STORE, mode), q = fn(tx.objectStore(IDB_STORE));
            q.onsuccess = () => end(q.result === undefined ? null : q.result); q.onerror = () => end(null);
            tx.oncomplete = () => { try { db.close(); } catch (_) { } };
          } catch (_) { end(null); }
        };
      } catch (_) { end(null); }
    });
  }
  const cacheKey = o => 'current|' + (o || '');
  function cachePut() {
    if (!B || !BFOR || BLOCKED) return Promise.resolve(null);
    return idb('readwrite', st => st.put({ owner: BFOR, book: B, unsaved: UNSAVED, counts: COUNTS, at: now() }, cacheKey(BFOR)));
  }
  const cacheGet = me => idb('readonly', st => st.get(cacheKey(me)));

  /* ── Drive appData `book.json`, compare-and-swap on the file revision ── */
  const BAD = {};
  async function readJson(id) { try { return await driveReadJson(id); } catch (e) { if (e instanceof SyntaxError) return BAD; throw e; } }
  function block(why) { BLOCKED = why; ERROR = why; STATUS = 'blocked'; clearTimeout(SAVE_T); SAVE_T = null; return 'blocked'; }
  function afterOutsideChange() { VER++; hooks('sync'); rerender(); }

  async function driveSave() {
    if (BLOCKED) return 'blocked';
    if (!token() || !B) return 'skip';
    const seq = EDIT, me = BFOR;
    if (!fileId) { const f = await driveFindFileByName(FILE); if (f) { fileId = f.id; revId = null; } }
    if (fileId) {
      const rev = await driveGetRevision(fileId);
      if (rev !== revId) {            // another device saved since this one last read: re-read and merge
        const remote = await readJson(fileId);
        if (remote === BAD || !validBook(remote)) return block('book.json in Google Drive is not a book this version can read');
        if (me !== BFOR || !B) return 'skip';
        revId = rev;
        const before = fp(B); B = bookLib.merge(remote, B);
        if (fp(B) !== before) afterOutsideChange();
      }
    }
    if (me !== BFOR || !B) return 'skip';
    const saved = await driveUploadJson(fileId, FILE, B);
    fileId = saved.id; revId = saved.headRevisionId;
    if (seq === EDIT) UNSAVED = false;   // an edit made during the save keeps the mark for its own save
    cachePut();
    return 'pushed';
  }
  function scheduleSave() {
    clearTimeout(SAVE_T); SAVE_T = null;
    if (!token() || BLOCKED) return;
    SAVE_T = setTimeout(() => { SAVE_T = null; book2Flush(); }, SAVE_MS);
  }
  // Saves to Drive now and resolves when done ('pushed' | 'skip' | 'blocked' | 'error').
  function book2Flush() {
    clearTimeout(SAVE_T); SAVE_T = null;
    const run = (SAVING || Promise.resolve()).then(() => driveSave()).then(
      r => { if (r === 'pushed') ERROR = null; return r; },
      e => { ERROR = errText(e); return 'error'; });
    const p = run.finally(() => { if (SAVING === p) SAVING = null; if (ACTIVE_TAB === 'w2-start') rerender(); });
    SAVING = p;
    return p;
  }
  async function driveSync() {
    const f = await driveFindFileByName(FILE);
    if (!f) { if (B) await driveSave(); return B ? 'pushed' : 'none'; }
    let remote = await readJson(f.id);
    if (remote === BAD || !validBook(remote)) return block('book.json in Google Drive is not a book this version can read');
    fileId = f.id; revId = f.headRevisionId;
    // Two devices that created the file at once leave two: every readable one is merged into the oldest.
    let extra = 0;
    if (f.more && typeof driveListFilesByName === 'function') {
      for (const g of (await driveListFilesByName(FILE)).slice(1)) {
        try { const o = await driveReadJson(g.id); if (validBook(o)) { remote = bookLib.merge(remote, o); extra++; } } catch (_) { }
      }
    }
    const remoteFp = fp(remote);
    B = B ? bookLib.merge(remote, B) : remote;
    VER++;
    if (UNSAVED || extra || fp(B) !== remoteFp) { UNSAVED = true; await driveSave(); } else cachePut();
    return 'pulled';
  }

  function reset() {
    clearTimeout(SAVE_T); clearTimeout(SYNC_T); SAVE_T = null; SYNC_T = null;
    B = null; BFOR = ''; STATUS = 'idle'; ERROR = null; BLOCKED = null; BUSY = null; LOCAL_DONE = false; DRIVE_TRIED = false;
    fileId = null; revId = null; UNSAVED = false; COUNTS = null; GATE = null; SYNC_SIG = ''; VER++;
  }

  // Loads the new book once per sign-in: the device cache (only this account's entry), then Drive.
  // Safe to call on every render. Never converts by itself.
  function ensureBook2() {
    if (BUSY) return BUSY;
    const me = owner();
    if (!me) return Promise.resolve(null);
    if (BFOR !== me) { reset(); BFOR = me; }
    const needLocal = !LOCAL_DONE, needDrive = !!token() && !DRIVE_TRIED && !BLOCKED;
    if (!needLocal && !needDrive) return Promise.resolve(B);
    if (!B) STATUS = 'loading';
    const had = !!B;
    BUSY = (async () => {
      try {
        if (needLocal) {
          LOCAL_DONE = true;
          const c = await cacheGet(me);
          if (me === BFOR && c && c.owner === me && validBook(c.book) && !B) { B = c.book; UNSAVED = !!c.unsaved; COUNTS = c.counts || null; VER++; }
        }
        if (needDrive && me === BFOR) {
          DRIVE_TRIED = true;
          try { await driveSync(); if (!BLOCKED) ERROR = null; } catch (e) { ERROR = errText(e); DRIVE_TRIED = false; RETRY_AT = Date.now() + 30000; }
        }
      } catch (e) { ERROR = errText(e); }
      if (me === BFOR) STATUS = BLOCKED ? 'blocked' : B ? 'ready' : ERROR ? 'error' : 'none';
      BUSY = null;
      if (B && !had) hooks('load');
      rerender();
      return B;
    })();
    return BUSY;
  }
  let RETRY_AT = 0;          // after a failed Drive read, the next automatic try waits until then

  /* ── Changing the book ── */
  function commit(w, why, quiet) {
    w.updatedAt = now(); B = w; VER++; UNSAVED = true; EDIT++;
    cachePut(); scheduleSave(); hooks(why);
    if (!quiet) rerender();
  }
  function need() {
    if (BLOCKED) throw new Error('The new book’s file in Google Drive can’t be read by this version, so nothing is changed');
    if (!B) throw new Error('The new book is not set up yet');
    return B;
  }
  // The only way pages change the book. fn gets a working copy; when it throws, nothing changes.
  function book2Do(fn, why) {
    const w = cp(need());
    const r = fn(w);
    commit(w, why || '');
    return r;
  }

  // The store's own check on a converted book, on top of the gate: every posted entry has at least
  // two lines on accounts that exist, in whole rupiah, and sums to 0 (§0 rule 6).
  function bookProblems(x) {
    const out = [];
    for (const e of Object.values(x.entries || {})) {
      if (!e || e.status !== 'posted') continue;
      const ls = Array.isArray(e.lines) ? e.lines : [], what = e.number || e.description || e.id;
      if (ls.length < 2) out.push(`${what}: fewer than two lines`);
      else if (ls.some(l => !l || !x.accounts[l.account])) out.push(`${what}: a line on an account that is not in the book`);
      else if (ls.some(l => !Number.isInteger(l.amount) || !l.amount)) out.push(`${what}: an amount that is not whole rupiah`);
      else if (ls.reduce((s, l) => s + l.amount, 0) !== 0) out.push(`${what}: debits and credits differ`);
    }
    return out;
  }

  /* ── History conversion (§5): never automatic, kept only when the gate finds no difference ── */
  async function book2Convert() {
    const fail = (reason, extra) => { GATE = { ok: false, at: now(), reason, count: 0, diffs: [], ...(extra || {}) }; rerender(); return { ok: false, diffs: GATE.diffs, reason, ...(GATE.error ? { error: GATE.error } : {}) }; };
    if (!owner() || !token()) return fail('signed-out');
    await ensureBook2();
    if (BLOCKED) return fail('blocked');
    if (ERROR && !B) return fail('drive', { error: ERROR });   // Drive could not be read: a book may already exist there
    if (B) return fail('exists');
    const old = typeof LEDGER === 'function' ? LEDGER() : null;
    if (!old) return fail('no-old-book');
    let r;
    // A copy, so the old book is never touched. The old side of the gate is worked out by the old
    // engine itself (ledgerLib.tb), not from the lines that were just copied.
    const oldTb = typeof ledgerLib === 'object' && ledgerLib && typeof ledgerLib.tb === 'function' ? ledgerLib.tb : null;
    try { r = oldTb ? bookLib.fromLedgerV2(cp(old), now(), { tb: oldTb }) : bookLib.fromLedgerV2(cp(old), now()); }
    catch (e) { return fail('error', { error: errText(e) }); }
    const diffs = (r && Array.isArray(r.diffs)) ? r.diffs : null;
    if (!r || !diffs || !validBook(r.book)) return fail('error', { error: 'The conversion returned no book' });
    if (diffs.length) return fail('diffs', { count: diffs.length, diffs: diffs.slice(0, DIFFS_KEPT) });
    const bad = bookProblems(r.book);
    if (bad.length) return fail('invalid', { count: bad.length, error: bad[0] });
    if (B || BFOR !== owner()) return fail('exists');
    B = r.book; STATUS = 'ready'; ERROR = null; UNSAVED = true; EDIT++; VER++;
    GATE = { ok: true, at: now(), reason: '', count: 0, diffs: [] };
    await cachePut();
    const saved = await book2Flush();
    hooks('convert');
    try { book2SyncSpending(); } catch (e) { console.warn('Spending sync failed', e); }
    rerender();
    return { ok: true, diffs: [], saved };
  }

  /* ── Spending sync (§6): email rows → entries, one source one entry ── */
  // Row fields read (index.html): id · txDate || msgDate (ISO; the local calendar day is used, as the
  // original pages do) · amount (whole rupiah; null while a foreign charge has no rate) · bank, or
  // manualBank when bank is 'Manual' (bankLabel) · category · merchantClean || merchantRaw ·
  // currency, amountOrig, fxRate. The rows carry no refund flag: a negative amount is read as money back.
  const rowDate = t => { const d = typeof txDateOf === 'function' ? txDateOf(t) : new Date(t.txDate || t.msgDate || 0);
    if (isNaN(d.getTime()) || !d.getTime()) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const rowBank = t => String((typeof bankLabel === 'function' ? bankLabel(t) : (t.bank === 'Manual' ? (t.manualBank || 'Manual') : t.bank)) || '');
  const rowAmount = t => (typeof t.amount === 'number' && isFinite(t.amount)) ? Math.round(t.amount) : 0;
  const rows = () => (typeof ALL_TRANSACTIONS !== 'undefined' && Array.isArray(ALL_TRANSACTIONS)) ? ALL_TRANSACTIONS : [];
  const dataReady = () => typeof DATA_READY !== 'undefined' && !!DATA_READY;

  function book2Banks() {
    const s = new Set();
    for (const t of rows()) { const b = rowBank(t); if (b) s.add(b); }
    return [...s].sort((a, b) => a.localeCompare(b));
  }
  function sig() {
    let h = 0, n = 0;
    for (const t of rows()) {
      const s = t.id + '|' + (t.txDate || t.msgDate || '') + '|' + t.amount + '|' + (t.category || '') + '|' + t.bank + '|' + (t.manualBank || '');
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      n++;
    }
    const st = (B && B.settings) || {};
    return n + ':' + h + ':' + JSON.stringify(st.bankMap || {}) + ':' + (st.syncFrom || '') + ':' + Object.keys((B && B.locks) || {}).length;
  }
  const usable = a => !!a && !a.header && !a.hidden && !a.deleted;
  // The line of an entry that sits on the mapped bank account (else the single line on the other side).
  function moneyLine(e, acc) {
    const ls = e.lines || [];
    return ls.find(l => l.account === acc) || (ls.filter(l => l.amount < 0).length === 1 ? ls.find(l => l.amount < 0) : null);
  }
  // An entry the owner answered otherwise keeps its kind and accounts; only amount and date follow the row.
  function followRow(w, e, acc, date, amount, t) {
    const m = moneyLine(e, acc);
    if (!m) return 'review';
    const want = -amount, diff = want - m.amount;        // money out of the account is a credit (negative)
    if (!diff && e.date === date) return 'same';
    let lines = e.lines.map(l => ({ ...l }));
    if (diff) {
      const mi = e.lines.indexOf(m), others = lines.filter((_, i) => i !== mi);
      // Two lines: the other side mirrors. More (a split): the owner's own part takes the difference.
      const tgt = others.length === 1 ? others[0] : others.find(l => (w.accounts[l.account] || {}).kind === 'expense');
      if (!tgt) return 'review';
      const next = tgt.amount - diff;
      if (!next || Math.sign(next) !== Math.sign(tgt.amount)) return 'review';
      lines[mi].amount = want; tgt.amount = next;
      for (const l of [lines[mi], tgt]) if (l.fx) delete l.fx;
    }
    bookLib.edit(w, e.id, { date, lines }, 'The email row changed', t);
    return 'edit';
  }
  // → {posted, edited, same, waiting, locked} (+ noAmount, before, voided, removed, review, failed, at); null when there is no book.
  function book2SyncSpending() {
    if (!B || BLOCKED) return null;
    SYNC_SIG = sig();
    const c = { posted: 0, edited: 0, same: 0, waiting: 0, locked: 0, noAmount: 0, before: 0, voided: 0, removed: 0, review: 0, failed: 0, declined: 0, stmtOnly: 0, at: now() };
    const w = cp(B), st = w.settings || {}, from = String(st.syncFrom || ''), map = st.bankMap || {}, t = c.at;
    const list = rows(), seen = new Set(); let firstErr = null;
    // A void entry frees its source in the engine. A row whose latest entry the owner voided by hand
    // must not come back by itself; only a row voided as "hidden" is posted again once it is visible.
    const voidedBy = {};
    for (const e of Object.values(w.entries)) {
      const s = e && e.source;
      if (!e || e.deleted || e.status !== 'void' || !s || s.type !== 'email') continue;
      const p = voidedBy[s.ref];
      if (!p || String(e.at || '') >= String(p.at || '')) voidedBy[s.ref] = e;
    }
    const voidWhy = e => { const h = e.history || []; return String((h[h.length - 1] || {}).why || ''); };
    if (!from) { c.waiting = list.length; const moved = countsMoved(COUNTS, c); COUNTS = c; if (moved) rerender(); return { ...c }; }
    for (const row of list) {
      if (!row || row.id == null || row.type === 'billing') continue;
      // A charge the original app added from a statement (no email for it) is a statement line: it is
      // answered in the Inbox (js/w2/match.js, source 'stmt'), never here, so it is not counted twice.
      // Left out of `seen`, so an entry an earlier version made for it is taken out by the sweep below.
      if (row.stmtAdded) { c.stmtOnly++; continue; }
      // Owner's rule (13 Nov 2026): a declined or failed charge is not spending, so it never enters
      // the new book. It is left out of `seen`, so an entry made for it earlier is taken out by the
      // sweep below, and it is posted again if the row later shows as successful.
      if (typeof txOk === 'function' && !txOk(row)) { c.declined++; continue; }
      const ref = 'tx:' + row.id; seen.add(ref);
      const date = rowDate(row);
      if (!date || date < from) { c.before++; continue; }
      const amount = rowAmount(row);
      if (!amount) { c.noAmount++; continue; }
      const acc = map[rowBank(row)];
      if (!acc || !usable(w.accounts[acc])) { c.waiting++; continue; }
      try {
        const have = bookLib.findBySource(w, 'email', ref);
        if (!have && voidedBy[ref] && voidWhy(voidedBy[ref]) !== 'hidden') { c.removed++; continue; }
        if (have && have.kind !== 'spending') {
          const lockedNow = bookLib.lockState(w, String(have.date).slice(0, 7)) === 'locked' || bookLib.lockState(w, date.slice(0, 7)) === 'locked';
          const r = lockedNow && (have.date !== date || (moneyLine(have, acc) || {}).amount !== -amount) ? 'locked' : followRow(w, have, acc, date, amount, t);
          c[r === 'edit' ? 'edited' : r]++;
          continue;
        }
        const d = { date, amount: Math.abs(amount), account: acc, dir: amount < 0 ? 'in' : 'out', category: row.category || 'Others',
          description: String(row.merchantClean || row.merchantRaw || ''), source: { type: 'email', ref } };
        const fx = row.currency && row.currency !== 'IDR' && row.amountOrig > 0
          ? { ccy: String(row.currency), amount: row.amountOrig, rate: row.fxRate > 0 ? row.fxRate : Math.abs(amount) / row.amountOrig } : null;
        let r;
        if (fx && !have) { try { r = bookLib.upsertBySource(w, bookLib.buildEntry(w, 'spending', { ...d, fx }, t), t); } catch (_) { r = null; } }
        if (!r) r = bookLib.upsertBySource(w, bookLib.buildEntry(w, 'spending', d, t), t);
        const a = r && r.action;
        c[a === 'post' ? 'posted' : a === 'edit' ? 'edited' : a === 'locked' ? 'locked' : 'same']++;
      } catch (e) { c.failed++; if (!firstErr) firstErr = e; }
    }
    // Rows that left the list (hidden in the original app): their entry is voided, never deleted.
    // Skipped while the list is empty, which is a list that has not loaded, not a list hidden whole.
    if (list.length) {
      for (const e of Object.values(w.entries)) {
        const s = e && e.source;
        if (!e || e.status !== 'posted' || !s || s.type !== 'email' || String(s.ref).indexOf('tx:') !== 0 || seen.has(s.ref)) continue;
        try {
          if (bookLib.lockState(w, String(e.date).slice(0, 7)) === 'locked') { c.locked++; continue; }
          if (bookLib.voidEntry(w, e.id, String(s.ref).indexOf('tx:stmt:') === 0 ? 'statement line: answered in the Inbox' : 'hidden', t)) c.voided++;
        } catch (err) { c.failed++; if (!firstErr) firstErr = err; }
      }
    }
    if (firstErr) console.warn('ExpenseTrack preview: ' + c.failed + ' spending row(s) could not be added to the new book: ' + errText(firstErr));
    const moved = countsMoved(COUNTS, c);
    COUNTS = c;
    if (c.posted || c.edited || c.voided) commit(w, 'spending-sync'); else { cachePut(); if (moved || ACTIVE_TAB === 'w2-start') rerender(); }
    inboxRun();
    return { ...c };
  }
  // Pages such as Home show these counts, so a sync that changes them redraws whichever preview page is open.
  function countsMoved(a, b) {
    if (!a) return true;
    return ['waiting', 'stmtOnly', 'declined', 'before', 'noAmount', 'locked', 'removed', 'review'].some(k => a[k] !== b[k]);
  }
  // The Inbox (js/w2/match.js, when it is loaded) answers what it can by itself after each spending sync.
  function inboxRun() {
    if (typeof book2InboxRun !== 'function' || !dataReady()) return null;
    try { return book2InboxRun(); } catch (e) { console.warn('ExpenseTrack preview: the Inbox could not run: ' + errText(e)); return null; }
  }
  // Statement accounts the app holds (the cash data behind Cash movements), read only.
  function stmtAccounts() {
    try { const c = typeof CM === 'function' ? CM() : null; return c && Array.isArray(c.accounts) ? c : null; } catch (_) { return null; }
  }
  // Links one statement account to a book account (settings.stmtMap); an empty accountId removes the link.
  function book2SetStmtMap(stmtAccount, accountId) {
    stmtAccount = String(stmtAccount || ''); if (!stmtAccount) throw new Error('Pick a statement');
    return book2Do(w => {
      if (accountId && !usable(w.accounts[accountId])) throw new Error('Pick an account that is in use');
      const t = now(), after = { ...((w.settings || {}).stmtMap || {}) };
      if (accountId) after[stmtAccount] = accountId; else delete after[stmtAccount];
      try { bookLib.setSetting(w, 'stmtMap', after, t); }
      catch (e) { if (!/not a setting/.test(errText(e))) throw e; w.settings.stmtMap = after; w.settings.at = t; }   // an engine without the key yet
      return after;
    }, 'stmt-map');
  }
  function book2SetBankMap(bank, accountId) {
    bank = String(bank || ''); if (!bank) throw new Error('Pick a bank');
    return book2Do(w => {
      if (accountId && !usable(w.accounts[accountId])) throw new Error('Pick an account that is in use');
      const t = now(), after = { ...((w.settings || {}).bankMap || {}) };
      if (accountId) after[bank] = accountId; else delete after[bank];
      bookLib.setSetting(w, 'bankMap', after, t);   // stamps settings.at and writes the audit record
      return after;
    }, 'bank-map');
  }

  /* ── Hooks: load once someone is signed in; sync after the rows or the links changed ── */
  registerHook('beforeRender', () => {
    const me = owner(); if (!me) return;
    if (BFOR && BFOR !== me) reset();
    if (!BUSY && (STATUS === 'idle' || (token() && !DRIVE_TRIED && !BLOCKED && Date.now() >= RETRY_AT))) ensureBook2();
    if (B && !BLOCKED && dataReady() && !SYNC_T && sig() !== SYNC_SIG) {
      SYNC_T = setTimeout(() => { SYNC_T = null; try { if (B && dataReady() && sig() !== SYNC_SIG) book2SyncSpending(); } catch (e) { console.warn('Spending sync failed', e); } }, 0);
    }
  });
  window.addEventListener('online', () => { RETRY_AT = 0; if (B && UNSAVED) scheduleSave(); });

  /* ── Page: Start here (w2-start) ── */
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const dayText = iso => { try { return typeof fmtDayLong === 'function' ? fmtDayLong(new Date(String(iso).slice(0, 10) + 'T00:00:00')) : String(iso).slice(0, 10); } catch (_) { return String(iso || ''); } };
  const whenText = iso => { try { return typeof fmtDateTime === 'function' ? fmtDateTime(iso) : new Date(iso).toLocaleString(); } catch (_) { return String(iso || ''); } };
  const row = (title, sub, right) => `<div class="setting-row"><div style="min-width:0"><div class="li-title">${title}</div>${sub ? `<div class="li-sub">${sub}</div>` : ''}</div>${right || ''}</div>`;
  function savedBadge() {
    if (BLOCKED) return '<span class="badge warn">Not saved</span>';
    if (!token()) return '<span class="badge warn">On this device only</span>';
    if (UNSAVED || SAVE_T || SAVING) return ERROR ? '<span class="badge warn">Waiting to save</span>' : '<span class="badge info">Saving…</span>';
    return '<span class="badge good">Saved to Google Drive</span>';
  }
  const diffLine = d => {
    d = d || {};
    const code = d.code || d.account || '', m = d.month ? (typeof monthLabel === 'function' ? monthLabel(d.month) : d.month) : '';
    const was = d.old != null ? d.old : d.was != null ? d.was : d.ledger != null ? d.ledger : d.before, is = d.new != null ? d.new : d.now != null ? d.now : d.book != null ? d.book : d.after;
    const nums = (typeof was === 'number' && typeof is === 'number') ? `Current book <span class="amt">${fmtIDR(was)}</span> · new book <span class="amt">${fmtIDR(is)}</span>` : escH(d.what || '');
    return `<div class="list-item"><div class="li-body"><div class="li-title">${escH([d.name || code, m].filter(Boolean).join(' · ') || 'Difference')}</div><div class="li-sub">${d.name && code ? escH(code) + ' · ' : ''}${nums}</div></div></div>`;
  };
  function gateHTML() {
    if (!GATE || GATE.ok) return '';
    const msg = {
      'signed-out': 'Sign in first, so the new book can be saved to your Google Drive.',
      'blocked': 'The new book’s file in Google Drive can’t be read by this version of the app.',
      'drive': 'Google Drive could not be reached, so the app can’t tell whether a new book already exists. Try again in a moment.',
      'exists': 'A new book already exists, so nothing was converted.',
      'no-old-book': 'Your current book is not set up or has not loaded yet. Open Books first, then come back.',
      'error': 'The conversion stopped before it finished.' + (GATE.error ? ' ' + GATE.error : ''),
      'diffs': `Not converted. ${plural(GATE.count, 'balance')} did not match your current book, so nothing was kept.`,
      'invalid': `Not converted. ${plural(GATE.count, 'journal')} in your current book cannot be copied exactly, so nothing was kept. First one: ${GATE.error || ''}.`
    }[GATE.reason] || 'Not converted.';
    const list = GATE.diffs.slice(0, 5).map(diffLine).join('');
    return `<div class="help err" role="alert" style="margin-top:12px">${ic('triangle-alert', 's16')}<span>${escH(msg)} Your current book is untouched.</span></div>
      ${list ? `<div class="list" id="w2GateDiffs" style="margin-top:8px">${list}</div>` : ''}
      ${GATE.count > 5 ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="w2Start.diffs()">Show all ${GATE.count}</button>` : ''}`;
  }
  function bookCardHTML() {
    const head = (desc, tools) => cardHead('book-open', 'Your new book', desc, tools);
    if (!owner()) return `<div class="card span-12">${head('')}${emptyHTML('lock', 'Sign in to set up the new book')}</div>`;
    if (STATUS === 'blocked') return `<div class="card span-12">${head('')}<div class="card-error">${ic('triangle-alert', 's24')}<div style="flex:1"><div style="font-weight:600;color:var(--text-1)">The new book can’t be opened</div><div class="help">Its file in Google Drive can’t be read by this version of the app, so nothing is saved over it. Reload the app. Your current book is not affected.</div></div></div></div>`;
    if (STATUS === 'idle' || STATUS === 'loading') return `<div class="card span-12" aria-busy="true">${head('Looking for your new book…')}<div class="skel" style="width:60%;height:14px"></div><div class="skel" style="width:40%;height:14px;margin-top:10px"></div></div>`;
    if (STATUS === 'error') return `<div class="card span-12">${head('')}<div class="card-error">${ic('triangle-alert', 's24')}<div style="flex:1"><div style="font-weight:600;color:var(--text-1)">Couldn’t reach Google Drive</div><div class="help">${escH(ERROR || '')}</div></div><button class="btn btn-secondary" onclick="w2Start.retry()">Retry</button></div></div>`;
    if (!B) {
      const old = typeof LEDGER === 'function' ? LEDGER() : null;
      const n = old ? Object.values(old.vouchers || {}).filter(v => v && v.status === 'posted').length : 0;
      return `<div class="card span-12">${head('Not set up yet')}
        <p class="muted" style="margin:0 0 12px">The new book starts as a copy of your current one. Every account and every posted journal is copied, then every month-end balance is checked against your current book. The copy is kept only when all of them match. Your current book is never changed.</p>
        ${old ? `<p class="help" style="margin:0 0 12px">Your current book has ${plural(Object.keys(old.accounts || {}).length, 'account')} and ${plural(n, 'posted journal')}.</p>` : `<p class="help" style="margin:0 0 12px">Your current book has not loaded yet. Open Books once, then come back.</p>`}
        <button class="btn btn-primary" id="w2Convert" onclick="w2Start.convert(this)"${old && token() ? '' : ' disabled'}>${ic('repeat')}Convert my book</button>
        ${!token() ? '<p class="help" style="margin-top:8px">Sign in again to convert.</p>' : ''}
        <div id="w2Gate">${gateHTML()}</div></div>`;
    }
    const acc = Object.values(B.accounts).filter(a => a && !a.deleted && !a.header).length;
    const ent = Object.values(B.entries).filter(e => e && e.status === 'posted').length;
    const mg = B.migration || null, st = B.settings || {};
    return `<div class="card span-12" id="w2Book">${head('Ready', savedBadge())}
      ${row('In the book', `${plural(acc, 'account')} · ${plural(ent, 'entry', 'entries')}`)}
      ${mg ? row('Copied from your current book', `${escH(whenText(mg.at))} · ${plural(mg.entries || 0, 'journal')} · ${plural(mg.accounts || 0, 'account')} · ${mg.diffs ? plural(mg.diffs, 'difference') : 'every month-end balance matched'}`, '<span class="badge good">Checked</span>') : ''}
      ${st.syncFrom ? row('Spending from your emails is added from', escH(dayText(st.syncFrom)) + '. Earlier months are already in the copied history, so nothing is counted twice.') : ''}
      ${ERROR && token() ? `<div class="help err" style="margin-top:8px">${ic('triangle-alert', 's16')}<span>The last save did not reach Google Drive. It is kept on this device and tried again. <button class="btn btn-ghost btn-sm" onclick="w2Start.retry()">Save now</button></span></div>` : ''}
    </div>`;
  }
  function accountOptions(sel) {
    const all = Object.values(B.accounts).filter(a => usable(a) && (a.kind === 'asset' || a.kind === 'liability'));
    const names = {}; for (const a of all) names[a.name] = (names[a.name] || 0) + 1;
    const label = a => names[a.name] > 1 && a.code ? `${a.name} (${a.code})` : a.name;
    const by = (x, y) => String(x.code || '').localeCompare(String(y.code || ''), undefined, { numeric: true }) || String(x.name).localeCompare(String(y.name));
    const main = all.filter(a => ['bank', 'card', 'cash', 'ewallet'].includes(a.role)).sort(by), rest = all.filter(a => !main.includes(a)).sort(by);
    const opt = a => `<option value="${escH(a.id)}"${a.id === sel ? ' selected' : ''}>${escH(label(a))}</option>`;
    return `<option value="">Not linked</option>${main.length ? `<optgroup label="Bank, card and cash">${main.map(opt).join('')}</optgroup>` : ''}${rest.length ? `<optgroup label="Other accounts">${rest.map(opt).join('')}</optgroup>` : ''}`;
  }
  function banksCardHTML() {
    const banks = book2Banks(), map = (B.settings || {}).bankMap || {}, from = String((B.settings || {}).syncFrom || '');
    // A bank that is linked but has no row right now still shows, so the link can be seen and changed.
    for (const b of Object.keys(map)) if (!banks.includes(b)) banks.push(b);
    const count = {}; for (const t of rows()) { const d = rowDate(t); if (d && from && d >= from) { const b = rowBank(t); count[b] = (count[b] || 0) + 1; } }
    const body = banks.length ? banks.map((b, i) => {
      const cur = map[b] && usable(B.accounts[map[b]]) ? map[b] : '';
      return `<div class="setting-row" data-w2-bank="${escH(b)}"><div style="min-width:0"><div class="li-title">${escH(b)}</div><div class="li-sub">${plural(count[b] || 0, 'email row')}${from ? ' since ' + escH(dayText(from)) : ''}${cur ? '' : ' · waiting for a link'}</div></div>
        <select class="input me-select" id="w2Bank${i}" data-bank="${escH(b)}" aria-label="Account for ${escH(b)}" onchange="w2Start.pick(this)">${accountOptions(cur)}</select></div>`;
    }).join('') : emptyHTML('inbox', dataReady() ? 'No bank emails found yet' : 'Your bank emails are still loading');
    return `<div class="card span-12" id="w2Banks">${cardHead('landmark', 'Link your banks', 'Tell the new book which account each bank’s emails belong to. Spending from a bank is added once it is linked.')}${body}</div>`;
  }
  function stmtCardHTML() {
    const c = stmtAccounts(); if (!c) return '';
    const map = (B.settings || {}).stmtMap || {}, from = String((B.settings || {}).syncFrom || '');
    const count = {}; for (const l of c.txns || []) if (l && from && l.date >= from) count[l.account] = (count[l.account] || 0) + 1;
    const accs = c.accounts.slice().sort((x, y) => String(x.label || x.id).localeCompare(String(y.label || y.id)));
    const body = accs.length ? accs.map((a, i) => {
      const foreign = (a.currency || 'IDR') !== 'IDR', cur = map[a.id] && usable(B.accounts[map[a.id]]) ? map[a.id] : '';
      const sub = foreign ? `${escH(a.currency)} · foreign-currency statements are left out for now`
        : `${a.kind === 'card' ? 'Card' : 'Bank'} statement · ${plural(count[a.id] || 0, 'line')}${from ? ' since ' + escH(dayText(from)) : ''}${cur ? '' : ' · waiting for a link'}`;
      return `<div class="setting-row" data-w2-stmt="${escH(a.id)}"><div style="min-width:0"><div class="li-title">${escH(a.label || a.id)}</div><div class="li-sub">${sub}</div></div>
        ${foreign ? '<span class="badge">Left out</span>' : `<select class="input me-select" id="w2Stmt${i}" data-stmt="${escH(a.id)}" data-label="${escH(a.label || a.id)}" aria-label="Account for ${escH(a.label || a.id)}" onchange="w2Start.pickStmt(this)">${accountOptions(cur)}</select>`}</div>`;
    }).join('') : emptyHTML('inbox', 'No statements in the app yet');
    return `<div class="card span-12" id="w2Stmts">${cardHead('receipt', 'Link your statements', 'Tell the new book which account each bank or card statement belongs to. Its lines then show in the Inbox; nothing is guessed for a statement that is not linked.')}${body}</div>`;
  }
  function syncCardHTML() {
    const c = COUNTS, cell = (label, n, sub) => `<div class="strip-cell"><span class="kpi-label">${label}</span><span class="kpi-value">${n}</span><span class="kpi-sub">${sub}</span></div>`;
    const extra = c ? [c.locked ? `${plural(c.locked, 'row')} in a locked month left as they are` : '', c.noAmount ? `${plural(c.noAmount, 'row')} without a rupiah amount yet` : '',
      c.declined ? `${plural(c.declined, 'declined or failed charge')} left out` : '',
      c.stmtOnly ? `${plural(c.stmtOnly, 'charge')} found only on a statement ${c.stmtOnly === 1 ? 'is' : 'are'} answered in the Inbox` : '',
      c.voided ? `${plural(c.voided, 'hidden or declined row')} taken out` : '', c.removed ? `${plural(c.removed, 'row')} you removed from the new book stay out` : '', c.review ? `${plural(c.review, 'answered row')} changed in the email list and need a look` : '',
      c.failed ? `${plural(c.failed, 'row')} could not be added` : ''].filter(Boolean) : [];
    return `<div class="card span-12" id="w2Sync">${cardHead('refresh-cw', 'Spending from your emails', c ? 'Last checked ' + escH(whenText(c.at)) : 'Not checked yet',
        `<button class="btn btn-secondary btn-sm" id="w2SyncNow" onclick="w2Start.sync()">${ic('refresh-cw')}Sync spending now</button>`)}
      ${c ? `<div class="strip" id="w2Counts" style="border:1px solid var(--border);border-radius:var(--radius-sm)">${cell('Added', c.posted, 'new entries')}${cell('Already there', c.edited + c.same, c.edited ? `${c.edited} updated to match the email` : 'nothing to change')}${cell('Waiting', c.waiting, 'bank not linked yet')}</div>
        ${extra.length ? `<p class="help" style="margin-top:10px">${extra.map(escH).join(' · ')}</p>` : ''}` : emptyHTML('inbox', 'Link a bank above, then sync')}
      <p class="help" style="margin-top:10px">This runs by itself after each email sync and after you change a category. Each email row becomes one entry, and running it again never adds it twice.</p></div>`;
  }
  function renderStart() {
    const ready = STATUS === 'ready' && !!B;
    return `${pageHead('Start here', 'The new book runs beside your current app. Nothing in your current pages or data changes.')}
      <div class="grid">${bookCardHTML()}${ready ? banksCardHTML() + stmtCardHTML() + syncCardHTML() : ''}</div>`;
  }
  window.w2Start = {
    async convert(btn) {
      if (btn) { btn.disabled = true; btn.innerHTML = ic('repeat') + 'Converting…'; }
      let r;
      try { r = await book2Convert(); } catch (e) { r = { ok: false, error: errText(e) }; GATE = { ok: false, at: now(), reason: 'error', count: 0, diffs: [], error: r.error }; }
      if (r.ok) toast('Your book is copied. Every month-end balance matched.'); else toast('Not converted. Your current book is untouched.');
      rerender();
      return r;
    },
    sync() {
      try {
        const c = book2SyncSpending();
        if (c) toast(c.posted || c.edited || c.voided ? `${c.posted} added · ${c.edited} updated${c.voided ? ` · ${c.voided} taken out` : ''}` : (c.waiting ? `Nothing new · ${plural(c.waiting, 'row')} waiting for a bank link` : 'Nothing new'));
      } catch (e) { toast('The sync stopped: ' + errText(e)); }
      rerender();
    },
    pick(el) {
      const bank = el.dataset.bank, id = el.value;
      try {
        book2SetBankMap(bank, id || null);
        const c = book2SyncSpending();
        toast(id ? `${bank} linked${c && c.posted ? ` · ${plural(c.posted, 'entry', 'entries')} added` : ''}` : `${bank} is no longer linked`);
      } catch (e) { toast(errText(e)); }
      rerender();
    },
    pickStmt(el) {
      const id = el.dataset.stmt, label = el.dataset.label || id, acc = el.value;
      try {
        book2SetStmtMap(id, acc || null);
        const r = inboxRun(), n = typeof book2InboxCount === 'function' ? book2InboxCount() : 0;
        toast(acc ? `${label} linked${r && r.posted ? ` · ${plural(r.posted, 'line')} answered by the app` : ''}${n ? ` · ${n} waiting in the Inbox` : ''}` : `${label} is no longer linked`);
      } catch (e) { toast(errText(e)); }
      rerender();
    },
    retry() { RETRY_AT = 0; if (B) { UNSAVED = true; book2Flush(); } else { DRIVE_TRIED = false; STATUS = 'idle'; ensureBook2(); } rerender(); },
    diffs() {
      if (!GATE || !GATE.diffs.length) return;
      openSheet({ title: 'Balances that did not match', wide: true, confirmDiscard: false,
        body: `<p class="muted" style="margin:0 0 12px">Nothing was kept. Your current book is untouched.</p><div class="list">${GATE.diffs.map(diffLine).join('')}</div>${GATE.count > GATE.diffs.length ? `<p class="help">…and ${GATE.count - GATE.diffs.length} more</p>` : ''}` });
    }
  };

  Object.assign(window, {
    BOOK2: () => B, book2Status: () => STATUS, book2Error: () => ERROR, book2Unsaved: () => UNSAVED,
    ensureBook2, book2Do, book2Convert, book2SyncSpending, book2SetBankMap, book2SetStmtMap, book2Banks,
    book2Counts: () => (COUNTS ? { ...COUNTS } : null), book2Gate: () => (GATE ? cp(GATE) : null),
    book2Flush, book2Reset: reset
  });

  if (typeof registerIcon === 'function') registerIcon('book-open', '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>');
  registerPage({ key: 'w2-start', label: 'Start here', icon: 'book-open', group: 'w2', order: 10, render: renderStart });
})();
