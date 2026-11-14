/* ExpenseTrack v6 — the new book's Add page (docs/v6-book.md §10, plan §7.9): page "w2-add" in the
   menu group "w2", an Add button on the head of every other new page, and book2ManualCandidates().

   Six typed forms (I spent · I received · I lent / paid for someone · I borrowed · I moved money ·
   I bought / sold an investment) that post at once through bookLib.buildEntry + book2Do with an Undo,
   and "Tell me what happened": one sentence → Claude drafts entries in a strict JSON shape → each is
   checked by the engine and shown in plain words → nothing is saved until the owner taps Save.

   What is sent to Claude: the sentence, today's date and the NAMES of the accounts, people,
   categories and income types. No balances, no amounts, no history. The call goes through the
   original's etAI.call; this file never reads, stores, logs or shows the API key.

   Read-only towards everything old (§0): never writes the original app's state, never calls its
   Drive save or a mutating ledger function. No personal data in this file: the repo is public. */
(function () {
  'use strict';
  if (typeof bookLib === 'undefined' || typeof BOOK2 !== 'function' || typeof book2Do !== 'function' || typeof registerPage !== 'function') {
    console.warn('ExpenseTrack preview: the new book store is not loaded, so the Add page stays off.');
    return;
  }
  const P = window.w2Add = {};

  /* ── Small helpers ── */
  const B = () => BOOK2();
  const cp = o => JSON.parse(JSON.stringify(o));
  const p2 = n => String(n).padStart(2, '0');
  const low = s => String(s == null ? '' : s).trim().toLowerCase();
  const str = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
  const errList = e => (e && Array.isArray(e.errors) && e.errors.length ? e.errors.slice() : [String((e && e.message) || e)]);
  const errText = e => errList(e).join(' · ');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const validDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(new Date(d + 'T00:00:00').getTime());
  const dayShort = iso => { try { return validDay(iso) ? fmtDay(new Date(iso + 'T00:00:00')) : String(iso || 'no date'); } catch (_) { return String(iso || ''); } };
  const moneyHTML = n => `<span class="amt">${escH(Number.isFinite(n) ? fmtIDR(n) : 'Rp ?')}</span>`;
  const moneyText = n => (Number.isFinite(n) ? fmtIDR(n) : 'Rp ?');
  const el = id => document.getElementById(id);
  const live = o => Object.values(o || {}).filter(x => x && !x.deleted);
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const byCode = (a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }) || byName(a, b);
  const usable = a => !!a && !a.header && !a.hidden && !a.deleted;
  const opt = (v, t, cur) => `<option value="${escH(v)}"${v === cur ? ' selected' : ''}>${escH(t)}</option>`;
  const uniq = list => { const seen = new Set(), out = []; for (const x of list) { const k = low(x); if (k && !seen.has(k)) { seen.add(k); out.push(String(x).trim()); } } return out; };

  // Layout only: spacing and wrapping built from the existing tokens. No colours, fonts or icons added.
  if (!el('w2AddStyle')) {
    const st = document.createElement('style'); st.id = 'w2AddStyle';
    st.textContent = `
      .w2a-kinds{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
      .w2a-kinds .chip{height:auto;min-height:32px;padding-top:6px;padding-bottom:6px;text-align:left}
      .w2a-row{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap}
      .w2a-row .grow{flex:1 1 200px;min-width:0}
      .w2a-form{max-width:720px}
      .w2a-text{min-height:64px}
      .w2a-note{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:18px;padding:10px 12px;border-radius:var(--radius-sm);margin:0 0 12px;background:var(--info-soft);color:var(--text-1)}
      .w2a-note.bad{background:var(--bad-soft)}
      .w2a-note svg.i{flex-shrink:0;margin-top:1px}
      .w2a-note span{min-width:0;overflow-wrap:anywhere}
      .w2a-link{color:var(--accent-text);font-weight:500;text-decoration:underline}
      .w2a-draft{display:flex;align-items:flex-start;gap:8px 12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border)}
      .w2a-draft .body{flex:1 1 260px;min-width:0}
      .w2a-draft .say{font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
      .w2a-draft .sub{font-size:12px;line-height:18px;color:var(--text-3);margin-top:2px;overflow-wrap:anywhere}
      .w2a-draft .acts{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
      .w2a-draft.off .say{color:var(--text-2)}
      .w2a-foot{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-top:16px}`;
    document.head.appendChild(st);
  }

  /* ── The book, read ── */
  const ROLE_GROUP = { bank: 'Bank and cash', cash: 'Cash in hand',ewallet: 'E-wallets', card: 'Credit cards', loan: 'Loans', investment: 'Investments' };
  const ROLE_WORD = { bank: 'bank', cash: 'cash', ewallet: 'e-wallet', card: 'credit card', loan: 'loan', investment: 'investment' };
  const ROLE_ORDER = ['bank', 'cash', 'ewallet', 'card', 'loan', 'investment'];
  const PAY = ['bank', 'cash', 'ewallet'], PAY_CARD = ['bank', 'cash', 'ewallet', 'card'];
  // Only accounts the owner can use: not a header, not hidden. Sorted by kind of account, then code.
  const accountsOf = (b, roles) => live(b.accounts).filter(a => usable(a) && roles.includes(a.role)).sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role) || byCode(x, y));
  function accountSelect(id, key, roles, cur, skip) {
    const list = accountsOf(B(), roles).filter(a => a.id !== skip);
    const groups = roles.map(r => { const g = list.filter(a => a.role === r); return g.length ? `<optgroup label="${escH(ROLE_GROUP[r])}">${g.map(a => opt(a.id, a.name, cur)).join('')}</optgroup>` : ''; }).join('');
    return `<select class="input" id="${id}" data-k="${key}">${list.length ? groups : '<option value="">No account to choose yet</option>'}</select>`;
  }
  function categoryNames(b) {
    const base = typeof CATEGORIES === 'object' && CATEGORIES ? Object.keys(CATEGORIES) : [];
    return uniq([...base, ...live(b.accounts).filter(a => usable(a) && a.kind === 'expense' && a.category).sort(byName).map(a => a.category)]);
  }
  // The income types of the book: tagged ones, and the names of the income accounts that came over untagged.
  function incomeTypes(b) {
    const own = live(b.accounts).filter(a => usable(a) && a.role === 'income').sort(byCode).map(a => a.incomeType || a.name);
    return uniq(own.length ? [...own, 'Other income'] : ['Salary', 'Business income', 'Interest', 'Dividend', 'Other income']);
  }
  const peopleOf = b => live(b.people).sort(byName);

  /* ── From a filled-in form or a draft ("spec") to the engine ──
     spec: {kind, date, amount, account, dir?, category?, incomeType?, toAccount?, person? {id} | {name, type},
            others? [{person, amount}], share?, taxWithheld?, cost?, description}. Accounts are ids. */
  function specToD(w, s, sourceType) {
    const who = p => {
      if (!p) return undefined;
      if (p.id && w.people[p.id]) return p.id;
      const name = str(p.name); if (!name) return undefined;
      const hit = live(w.people).find(x => low(x.name) === low(name));
      return hit ? hit.id : bookLib.addPerson(w, { name, type: p.type === 'company' ? 'company' : 'person' });
    };
    const d = { date: s.date, amount: s.amount, account: s.account, description: s.description || '', source: { type: sourceType } };
    if (s.dir) d.dir = s.dir;
    for (const k of ['category', 'incomeType', 'toAccount', 'share', 'taxWithheld', 'cost']) if (s[k] != null && s[k] !== '') d[k] = s[k];
    if (s.person) d.person = who(s.person);
    if (Array.isArray(s.others)) d.others = s.others.map(o => ({ person: who(o && o.person), amount: o ? o.amount : null }));
    return d;
  }
  const postSpec = (w, s, sourceType) => bookLib.post(w, bookLib.buildEntry(w, s.kind, specToD(w, s, sourceType)));

  // The entry in plain words. m formats money, x escapes names (HTML on the page, plain in a toast).
  function say(b, s, m, x) {
    const acc = id => x((b.accounts[id] || {}).name || 'an account');
    const who = p => x(!p ? 'someone' : p.id && b.people[p.id] ? b.people[p.id].name : p.name || 'someone');
    const A = acc(s.account), T = acc(s.toAccount), M = m(s.amount), on = ' on ' + x(dayShort(s.date));
    switch (s.kind) {
      case 'spending': return s.dir === 'in' ? `Got ${M} back (${x(s.category || 'no category')}) into ${A}${on}` : `Spent ${M} on ${x(s.category || 'no category')} from ${A}${on}`;
      case 'fee': return `Paid a fee of ${M} from ${A}${on}`;
      case 'income': return `Received ${M} (${x(s.incomeType || 'Other income')}) into ${A}${on}${s.taxWithheld ? `, after ${m(s.taxWithheld)} tax was taken off` : ''}`;
      case 'lent': return `Lent ${who(s.person)} ${M} from ${A}${on}`;
      case 'paid-for': return `Paid ${M} for ${who(s.person)} from ${A}${on}`;
      case 'reimburse': return `Paid ${M} from ${A}${on}, to be paid back by ${who(s.person)}`;
      case 'split': {
        const others = Array.isArray(s.others) && s.others.length ? s.others : s.person ? [{ person: s.person, amount: Number.isInteger(s.share) ? s.amount - s.share : NaN }] : [];
        const share = Number.isInteger(s.share) ? s.share : s.amount - others.reduce((t, o) => t + (Number.isInteger(o.amount) ? o.amount : 0), 0);
        return `Paid ${M} from ${A}${on}: your own part ${m(share)}${s.category ? ` (${x(s.category)})` : ''}${others.map(o => `, ${who(o.person)} owes you ${m(o.amount)}`).join('')}`;
      }
      case 'repaid-in': return `${who(s.person)} repaid you ${M} into ${A}${on}`;
      case 'borrowed': return `Borrowed ${M} from ${who(s.person)} into ${A}${on}`;
      case 'repaid-out': return `Repaid ${who(s.person)} ${M} from ${A}${on}`;
      case 'transfer': return `Moved ${M} from ${A} to ${T}${on}`;
      case 'card-payment': return `Paid ${M} to the card ${T} from ${A}${on}`;
      case 'invest-buy': return `Bought ${M} of ${T}, paid from ${A}${on}`;
      case 'invest-sell': return `Sold ${M} of ${T}, received into ${A}${on}`;
      default: return `${x(s.description || 'An entry')} · ${M}${on}`;
    }
  }
  const sayHTML = s => say(B(), s, moneyHTML, escH);
  const sayText = s => say(B(), s, moneyText, v => String(v));
  function undoToast(msg, ids) {
    toast(msg, { action: 'Undo', onAction: () => { try { book2Do(w => { for (const id of ids) bookLib.voidEntry(w, id, 'Undone'); }, 'undo'); toast('Undone'); } catch (e) { toast(errText(e)); } } });
  }

  /* ════════════════ The six forms ════════════════ */
  const FORMS = {
    spent: { label: 'I spent', title: 'I spent money', accLabel: 'From which account', roles: PAY_CARD },
    received: { label: 'I received', title: 'I received money', accLabel: 'Into which account', roles: PAY },
    lent: { label: 'I lent / paid for someone', title: 'I lent money, or paid for someone', accLabel: 'From which account', roles: PAY_CARD,
      variants: [['lent', 'I lent money'], ['paid-for', 'I paid for someone']] },
    borrowed: { label: 'I borrowed', title: 'I borrowed money', accLabel: 'Into which account', roles: PAY },
    moved: { label: 'I moved money', title: 'I moved money between my accounts', accLabel: 'From which account', roles: PAY },
    invest: { label: 'I bought / sold an investment', title: 'I bought or sold an investment', accLabel: 'Paid from which account', roles: PAY,
      variants: [['invest-buy', 'I bought'], ['invest-sell', 'I sold']] }
  };
  const S = { form: 'spent', vals: {}, text: '', answer: '', drafts: [], question: '', convo: null, busy: false, err: '', ctl: null, seq: 0, n: 0, key: null };
  const vals = () => S.vals[S.form] || (S.vals[S.form] = {});
  // Remembers what is typed, so a redraw of the page (a sync in the background) never empties the form.
  P.keep = function () {
    const v = vals();
    document.querySelectorAll('#w2aForm [data-k]').forEach(e => { v[e.dataset.k] = e.value; });
    const t = el('w2aText'); if (t) S.text = t.value;
    const a = el('w2aAnswer'); if (a) S.answer = a.value;
  };
  P.fmt = function (input) { const n = meParse(input.value); if (typeof n === 'number' && Number.isInteger(n) && n > 0) input.value = n.toLocaleString('id-ID'); P.keep(); };
  const field = (id, label, inner, cls, help) => `<div class="field${cls ? ' ' + cls : ''}"><label class="label" for="${id}">${escH(label)}</label>${inner}${help ? `<div class="help">${help}</div>` : ''}</div>`;
  const rp = (id, key, val, ph) => `<div class="input-affix"><span class="affix">Rp</span><input class="input" id="${id}" data-k="${key}" inputmode="numeric" autocomplete="off" placeholder="${escH(ph || '0')}" value="${escH(val || '')}" onblur="w2Add.fmt(this)"></div>`;
  // A list with "add new" at the end, and the name box when that is chosen.
  function pickNew(id, key, label, names, cur, newLabel, nameLabel, nameVal) {
    const isNew = cur === '__new' || !names.length, sel = isNew ? '__new' : names.includes(cur) ? cur : names[0];
    return field(id, label, `<select class="input" id="${id}" data-k="${key}" onchange="w2Add.pick('${id}New')">${names.map(n => opt(n, n, sel)).join('')}${opt('__new', newLabel, sel)}</select>`)
      + (isNew ? field(id + 'New', nameLabel, `<input class="input" id="${id}New" data-k="${key}New" maxlength="60" autocomplete="off" value="${escH(nameVal || '')}">`) : '');
  }
  function personFields(v, label) {
    const ps = peopleOf(B()), isNew = v.who === '__new' || !ps.length, sel = isNew ? '__new' : ps.some(p => p.id === v.who) ? v.who : ps[0].id;
    return field('w2aWho', label, `<select class="input" id="w2aWho" data-k="who" onchange="w2Add.pick('w2aWhoName')">${ps.map(p => opt(p.id, p.name + (p.type === 'company' ? ' (company)' : ''), sel)).join('')}${opt('__new', 'Add someone new…', sel)}</select>`)
      + (isNew ? field('w2aWhoName', 'Their name', `<input class="input" id="w2aWhoName" data-k="whoName" maxlength="60" autocomplete="off" value="${escH(v.whoName || '')}">`)
        + field('w2aWhoType', 'Person or company', `<select class="input" id="w2aWhoType" data-k="whoType">${opt('person', 'Person', v.whoType || 'person')}${opt('company', 'Company', v.whoType || 'person')}</select>`) : '');
  }
  function fourth(f, v, kind) {
    const b = B();
    if (f === 'spent') return pickNew('w2aCat', 'cat', 'Category', categoryNames(b), v.cat, 'Add a new category…', 'New category’s name', v.catNew);
    if (f === 'received') return pickNew('w2aType', 'type', 'What kind of income', incomeTypes(b), v.type, 'Add a new kind…', 'New kind’s name', v.typeNew);
    if (f === 'lent') return personFields(v, kind === 'lent' ? 'To whom' : 'For whom');
    if (f === 'borrowed') return personFields(v, 'From whom');
    if (f === 'moved') {
      // Opens on an account other than the one the money leaves, so the two never start out the same.
      const roles = ['bank', 'cash', 'ewallet', 'card', 'loan'], from = v.acc || (accountsOf(b, FORMS.moved.roles)[0] || {}).id;
      const cur = v.to || (accountsOf(b, roles).find(a => a.id !== from) || {}).id;
      return field('w2aTo', 'To which account', accountSelect('w2aTo', 'to', roles, cur), '', 'Choosing a credit card here records a card payment.');
    }
    const none = !accountsOf(b, ['investment']).length;
    return field('w2aInv', 'Which investment', accountSelect('w2aInv', 'inv', ['investment'], v.inv), '', none ? 'Your book has no investment account yet. Add one in the accounts list first.' : '')
      + (kind === 'invest-sell' ? field('w2aCost', 'What you had paid for it (optional)', rp('w2aCost', 'cost', v.cost, 'Same as the amount'), '', 'Fill this in to record the gain or loss. Left empty, no gain or loss is recorded.') : '');
  }
  const kindOfForm = (f, v) => { const F = FORMS[f]; return F.variants ? (F.variants.some(x => x[0] === v.variant) ? v.variant : F.variants[0][0]) : f; };
  function formHTML() {
    const f = S.form, F = FORMS[f], v = vals(), kind = kindOfForm(f, v);
    const accLabel = kind === 'invest-sell' ? 'Received into which account' : F.accLabel;
    const chips = Object.keys(FORMS).map(k => `<button class="chip" data-w2a-form="${k}" aria-pressed="${k === f}" onclick="w2Add.form('${k}')">${escH(FORMS[k].label)}</button>`).join('');
    const seg = F.variants ? `<div class="seg" role="group" aria-label="Which one" style="margin-bottom:16px">${F.variants.map(x => `<button data-w2a-variant="${x[0]}" aria-pressed="${x[0] === kind}" onclick="w2Add.variant('${x[0]}')">${escH(x[1])}</button>`).join('')}</div>` : '';
    const tip = f === 'received' && typeof pageByKey === 'function' && pageByKey('w2-people') ? `<p class="help" style="margin:12px 0 0">Did a person pay you back? Record that on <button class="w2a-link" onclick="setTab('w2-people')">People</button> with Got repaid, so it is not counted as income.</p>` : '';
    return `<section class="card span-12" id="w2aFormCard">${cardHead('pencil', 'Type it in', 'Pick what happened, fill in four fields and save. It is in your book at once, and you can undo it.')}
      <div class="w2a-kinds" role="group" aria-label="What happened">${chips}</div>
      <div class="w2a-form" id="w2aForm" data-form="${f}" data-kind="${kind}" oninput="w2Add.keep()" onchange="w2Add.keep()">
        <h3 class="eyebrow" style="margin:0 0 12px">${escH(F.title)}</h3>${seg}
        <div class="form-grid">
          ${field('w2aDate', 'Date', `<input class="input" type="date" id="w2aDate" data-k="date" value="${escH(v.date || today())}" max="${today()}">`)}
          ${field('w2aAmt', 'Amount', rp('w2aAmt', 'amt', v.amt, 'for example 2.000.000'))}
          ${field('w2aAcc', accLabel, accountSelect('w2aAcc', 'acc', F.roles, v.acc), '', accountsOf(B(), F.roles).length ? '' : 'Your book has no bank, cash or card account to choose yet.')}
          ${fourth(f, v, kind)}
          ${field('w2aNote', 'Note (optional)', `<input class="input" id="w2aNote" data-k="note" maxlength="80" autocomplete="off" value="${escH(v.note || '')}">`, 'full')}
          <div class="help err full" id="w2aErr" role="alert" style="display:none">${ic('triangle-alert', 's16')}<span></span></div>
        </div>
        <div class="w2a-foot"><button class="btn btn-primary" id="w2aSave" onclick="w2Add.save()">Save</button><button class="btn btn-ghost" id="w2aClear" onclick="w2Add.clear()">Clear</button></div>${tip}
      </div></section>`;
  }
  function redrawForm(focusId) {
    const box = el('w2aFormCard');
    if (box && B()) box.outerHTML = formHTML(); else if (typeof renderAll === 'function') renderAll();
    const f = focusId && el(focusId); if (f) f.focus();
  }
  P.form = function (k) { if (!FORMS[k]) return; P.keep(); S.form = k; redrawForm(); };
  P.variant = function (k) { P.keep(); vals().variant = k; redrawForm(); };
  P.pick = function (focusId) { P.keep(); redrawForm(focusId); };
  P.clear = function () { S.vals[S.form] = {}; redrawForm('w2aAmt'); };
  function formErr(msg, id) {
    const b = el('w2aErr'); if (!b) { toast(msg); return false; }
    b.style.display = msg ? '' : 'none'; b.querySelector('span').textContent = msg || '';
    document.querySelectorAll('#w2aForm [aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
    const f = id && el(id); if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
    return false;
  }
  // Reads the form into a spec, or shows what is missing in plain words and returns null.
  function readForm() {
    P.keep();
    const b = B(), f = S.form, v = vals(), kind = kindOfForm(f, v), note = str(v.note), amount = meParse(v.amt);
    const bad = (m, id) => { formErr(m, id); return null; };
    if (!validDay(v.date)) return bad('Enter the date it happened', 'w2aDate');
    if (v.date > today()) return bad('The date can’t be after today', 'w2aDate');
    if (!(typeof amount === 'number' && Number.isInteger(amount) && amount > 0)) return bad('Enter the amount in whole rupiah, above zero (for example 2.000.000)', 'w2aAmt');
    if (!v.acc || !usable(b.accounts[v.acc])) return bad('Choose the account the money moved through', 'w2aAcc');
    const s = { kind, date: v.date, amount, account: v.acc };
    const person = () => {
      if (v.who && v.who !== '__new') return b.people[v.who] ? { id: v.who } : null;
      const name = str(v.whoName); return name ? { name, type: v.whoType === 'company' ? 'company' : 'person' } : null;
    };
    const nameOf = p => (p.id ? b.people[p.id].name : p.name);
    if (f === 'spent') {
      const cat = v.cat === '__new' ? str(v.catNew) : str(v.cat);
      if (!cat) return bad(v.cat === '__new' ? 'Enter the new category’s name' : 'Choose a category', v.cat === '__new' ? 'w2aCatNew' : 'w2aCat');
      Object.assign(s, { kind: 'spending', dir: 'out', category: cat, description: note || cat });
    } else if (f === 'received') {
      const type = v.type === '__new' ? str(v.typeNew) : str(v.type);
      if (!type) return bad(v.type === '__new' ? 'Enter the new kind of income’s name' : 'Choose what kind of income it is', v.type === '__new' ? 'w2aTypeNew' : 'w2aType');
      Object.assign(s, { kind: 'income', dir: 'in', incomeType: type, description: note || type });
    } else if (f === 'lent' || f === 'borrowed') {
      const p = person();
      if (!p) return bad(v.who === '__new' || !peopleOf(b).length ? 'Enter the person’s name' : 'Choose the person', v.who === '__new' || !peopleOf(b).length ? 'w2aWhoName' : 'w2aWho');
      const n = nameOf(p);
      Object.assign(s, { person: p, description: note || (kind === 'lent' ? `Lent to ${n}` : kind === 'paid-for' ? `Paid for ${n}` : `Borrowed from ${n}`) });
    } else if (f === 'moved') {
      if (!v.to || !usable(b.accounts[v.to])) return bad('Choose the account the money went to', 'w2aTo');
      if (v.to === v.acc) return bad('Choose two different accounts', 'w2aTo');
      const to = b.accounts[v.to];
      Object.assign(s, { kind: to.role === 'card' ? 'card-payment' : 'transfer', toAccount: v.to, description: note || (to.role === 'card' ? `Card payment · ${to.name}` : `Moved to ${to.name}`) });
    } else {
      if (!v.inv || !usable(b.accounts[v.inv])) return bad('Choose the investment', 'w2aInv');
      const inv = b.accounts[v.inv];
      Object.assign(s, { toAccount: v.inv, description: note || (kind === 'invest-buy' ? `Bought ${inv.name}` : `Sold ${inv.name}`) });
      if (kind === 'invest-sell' && str(v.cost)) {
        const cost = meParse(v.cost);
        if (!(typeof cost === 'number' && Number.isInteger(cost) && cost > 0)) return bad('What you had paid must be whole rupiah, above zero (or leave it empty)', 'w2aCost');
        s.cost = cost;
      }
    }
    return s;
  }
  P.save = function () {
    if (!B()) return;
    const s = readForm(); if (!s) return;
    let id;
    try { id = book2Do(w => postSpec(w, s, 'manual'), 'add'); }
    catch (e) { formErr(errText(e)); return; }
    const text = sayText(s);
    S.vals[S.form] = {};
    redrawForm('w2aAmt');
    undoToast('Saved: ' + text, [id]);
  };

  /* ════════════════ Tell me what happened ════════════════ */
  const AI_KINDS = ['spending', 'fee', 'income', 'lent', 'paid-for', 'reimburse', 'split', 'repaid-in', 'borrowed', 'repaid-out', 'transfer', 'card-payment', 'invest-buy', 'invest-sell'];
  const AI_TIMEOUT = 60000, AI_MAX = 20;
  const nul = t => ({ anyOf: [{ type: 'null' }, t] });
  const SCHEMA = { type: 'object', additionalProperties: false, required: ['entries', 'question'], properties: {
    entries: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['kind', 'date', 'amount', 'account', 'dir', 'category', 'person', 'incomeType', 'toAccount', 'share', 'others', 'taxWithheld', 'description'],
      properties: {
        kind: { type: 'string', enum: AI_KINDS },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        amount: { type: 'integer', description: 'Whole rupiah, above zero' },
        account: { type: 'string', description: 'Name of the account the money moved through, exactly as given' },
        dir: { type: 'string', enum: ['out', 'in'] },
        category: nul({ type: 'string' }), person: nul({ type: 'string' }), incomeType: nul({ type: 'string' }),
        toAccount: nul({ type: 'string', description: 'Name of the other account, exactly as given' }),
        share: nul({ type: 'integer' }),
        others: nul({ type: 'array', items: { type: 'object', additionalProperties: false, required: ['person', 'amount'], properties: { person: { type: 'string' }, amount: { type: 'integer' } } } }),
        taxWithheld: nul({ type: 'integer' }),
        description: { type: 'string' } } } },
    question: nul({ type: 'string' }) } };
  const SYSTEM = `You turn one sentence from the owner of a personal finance book into draft entries. The owner checks every draft before anything is saved. Answer with JSON only, in the shape given.

The message is JSON: today (YYYY-MM-DD), sentence, accounts [{name, type}], people, categories, incomeTypes. Those are names only. You are not given balances or history and must not guess them.

Money is Indonesian rupiah in whole numbers: "2 jt" or "2 juta" = 2000000, "500rb" or "500 ribu" = 500000, "1,5 jt" = 1500000. Never invent an amount.

One entry per thing that happened. Fields: kind, date, amount, account, dir, category, person, incomeType, toAccount, share, others, taxWithheld, description. Use null for a field that does not apply.
- account: the name of the bank, card, cash or e-wallet account the money moved through, spelled exactly as in accounts. "cash" means the account of type cash.
- date: work out "yesterday", "last Friday" and the like from today. No date in the sentence means today.
- dir: "out" when money left the account, "in" when it arrived.
- description: a few plain words, at most 60 characters.

Kinds:
- spending: the owner spent money (dir out). category is required; pick from categories when one fits. A refund of spending is spending with dir in.
- fee: a bank or card fee (dir out).
- income: money the owner earned (dir in). incomeType from incomeTypes when one fits. amount is what arrived; taxWithheld is tax taken off before it arrived, when the sentence says so.
- lent: the owner lent money to a person (dir out). person is required.
- paid-for: the owner paid for something that was a person's, who will pay it back (dir out). person is required.
- reimburse: the owner paid something a company will pay back (dir out). person is the company.
- split: a shared bill the owner paid (dir out). amount is the whole bill, share is the owner's own part, others is [{person, amount}] for what each other person owes, category is for the owner's part.
- repaid-in: a person paid the owner back (dir in). repaid-out: the owner paid a person back (dir out).
- borrowed: the owner borrowed money from a person (dir in).
- transfer: between two of the owner's own accounts (dir out). account is where it left, toAccount where it arrived.
- card-payment: paying a credit card bill (dir out). account is where it was paid from, toAccount is the card.
- invest-buy: account is where it was paid from, toAccount is the investment account (dir out).
- invest-sell: account is where the money arrived, toAccount is the investment sold (dir in).

Use the name of a person, category or income type from the lists when it is the same one. When it is new, use the name as the owner wrote it; the owner will be offered to add it.

When the sentence does not say something you need (the amount, or which account when more than one could be meant), do not guess: leave that entry out and ask one short question in "question". Otherwise question is null.`;

  const hasAI = () => typeof etAI === 'object' && !!etAI && typeof etAI.call === 'function';
  // Whether a key is set: a yes or no from the original's own state. The key itself is never read here.
  function hasKey() { try { return hasAI() && typeof etAI.state === 'function' && !!etAI.state().hasKey; } catch (_) { return false; } }
  function goKey() { setTab('settings'); setTimeout(() => { const e = el('set-ai'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); }
  P.goKey = goKey;
  // What Claude is told: the sentence, today's date and names. Never a balance, an amount or an entry.
  function aiContext(sentence) {
    const b = B();
    return { today: today(), sentence: String(sentence),
      accounts: accountsOf(b, ROLE_ORDER).map(a => ({ name: a.name, type: ROLE_WORD[a.role] })),
      people: peopleOf(b).map(p => p.name), categories: categoryNames(b), incomeTypes: incomeTypes(b) };
  }
  const aiRequest = messages => ({ model: etAI.model(), max_tokens: 4000, system: SYSTEM, output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } }, messages });
  P.request = sentence => aiRequest([{ role: 'user', content: JSON.stringify(aiContext(sentence)) }]);   // for checks: what would be sent, no call
  function readAnswer(data) {
    const fail = m => { const e = new Error(m); e.kind = 'malformed'; return e; };
    if (data && data.stop_reason === 'refusal') throw fail('Claude declined to draft this one.');
    if (data && data.stop_reason === 'max_tokens') throw fail('Claude’s answer was cut off before it finished. Try a shorter sentence.');
    const text = (data && Array.isArray(data.content) ? data.content : []).filter(x => x && x.type === 'text').map(x => x.text).join('');
    let o; try { o = JSON.parse(text); } catch (_) { throw fail('Claude’s answer couldn’t be read. Try again, or use the forms below.'); }
    if (!o || typeof o !== 'object' || !Array.isArray(o.entries)) throw fail('Claude’s answer couldn’t be read. Try again, or use the forms below.');
    const question = str(o.question).slice(0, 300), entries = o.entries.filter(e => e && typeof e === 'object').slice(0, AI_MAX);
    if (!entries.length && !question) throw fail('Claude found nothing to add in that sentence. Try saying what happened, how much and from which account.');
    return { text, entries, question };
  }
  // One raw entry from Claude → a draft: a spec, what would be new, and why it can't be used (if so).
  // w is a scratch copy of the book: the engine builds and checks the entry there, nothing is saved.
  function draftOf(w, raw) {
    const errors = [], news = [], b = w;
    const accounts = accountsOf(b, ROLE_ORDER);
    const accId = (name, what) => {
      const n = low(name); if (!n) { errors.push(`Claude did not say ${what}`); return null; }
      const hits = accounts.filter(a => low(a.name) === n);
      if (hits.length === 1) return hits[0].id;
      errors.push(hits.length ? `Two accounts in your book are called “${str(name)}”` : `“${str(name)}” is not an account in your book`);
      return null;
    };
    const person = (name, type) => {
      const n = str(name); if (!n) return null;
      const hit = live(b.people).find(p => low(p.name) === low(n));
      if (hit) return { id: hit.id };
      if (!news.includes('new person: ' + n)) news.push('new person: ' + n);
      return { name: n.slice(0, 60), type };
    };
    const int = v => (v == null || v === '' ? null : Number(v));
    const kind = str(raw.kind);
    if (!AI_KINDS.includes(kind)) errors.push(`Claude chose a kind of entry this page can’t save (“${kind || 'none'}”)`);
    const s = { kind, date: str(raw.date), amount: Number(raw.amount), account: accId(raw.account, 'which account the money moved through'), description: str(raw.description).slice(0, 120) };
    if (raw.dir === 'in' || raw.dir === 'out') s.dir = raw.dir;
    const A = { spending: ['category'], split: ['category', 'others', 'share', 'person'], income: ['incomeType', 'taxWithheld'], transfer: ['toAccount'], 'card-payment': ['toAccount'],
      'invest-buy': ['toAccount'], 'invest-sell': ['toAccount'], lent: ['person'], 'paid-for': ['person'], reimburse: ['person'], 'repaid-in': ['person'], borrowed: ['person'], 'repaid-out': ['person'] }[kind] || [];
    if (A.includes('category') && str(raw.category)) {
      const c = str(raw.category).slice(0, 60), known = categoryNames(b).find(x => low(x) === low(c));
      s.category = known || c; if (!known) news.push('new category: ' + c);
    }
    if (A.includes('incomeType') && str(raw.incomeType)) {
      const t = str(raw.incomeType).slice(0, 60), known = incomeTypes(b).find(x => low(x) === low(t));
      s.incomeType = known || t; if (!known) news.push('new kind of income: ' + t);
    }
    if (A.includes('taxWithheld') && int(raw.taxWithheld)) s.taxWithheld = int(raw.taxWithheld);
    if (A.includes('toAccount')) s.toAccount = accId(raw.toAccount, 'which other account');
    if (A.includes('person') && str(raw.person)) s.person = person(raw.person, kind === 'reimburse' ? 'company' : 'person');
    if (A.includes('share') && int(raw.share) != null) s.share = int(raw.share);
    if (A.includes('others') && Array.isArray(raw.others) && raw.others.length) s.others = raw.others.slice(0, 12).map(o => ({ person: person(o && o.person, 'person'), amount: Number(o && o.amount) }));
    if (!errors.length) {
      try { const E = bookLib.validate(w, bookLib.buildEntry(w, kind, specToD(w, s, 'ai'))); errors.push(...E); }
      catch (e) { errors.push(...errList(e)); }
    }
    return { n: ++S.n, spec: s, news, errors: [...new Set(errors)] };
  }
  function draftsFrom(entries) { const w = cp(B()); return entries.map(r => draftOf(w, r)); }
  const usableDrafts = () => S.drafts.filter(d => !d.errors.length);

  function tellHTML() {
    const head = cardHead(hasAI() ? 'sparkles' : 'pencil', 'Tell me what happened', 'Say it in one sentence. Claude drafts it, you check it, and nothing is saved until you tap Save.');
    S.key = hasKey();
    if (!S.key) {
      return `<section class="card span-12" id="w2aTell" data-key="0">${head}<div class="w2a-note" id="w2aNoKey" style="margin:0">${ic('info', 's16')}<span>To use this, add your own Anthropic API key in <button class="w2a-link" id="w2aGoKey" onclick="w2Add.goKey()">Settings › AI</button>. Until then, type it in with the forms below. They work without a key.</span></div></section>`;
    }
    const ok = usableDrafts();
    const drafts = S.drafts.map(d => {
      const off = d.errors.length > 0;
      return `<div class="w2a-draft${off ? ' off' : ''}" data-w2a-draft="${d.n}" data-usable="${off ? 0 : 1}" data-kind="${escH(d.spec.kind)}"><div class="body"><div class="say">${sayHTML(d.spec)}</div>
        <div class="sub">${escH(d.spec.description || '')}${d.news.map(n => ` <span class="badge accent" data-w2a-new>${escH(n)}</span>`).join('')}${off ? ` <span class="badge warn">Can’t be saved</span>` : ''}</div>
        ${off ? `<div class="help err" data-w2a-why style="margin-top:6px">${ic('triangle-alert', 's16')}<span>${escH(d.errors.join(' · '))}</span></div>` : ''}
        ${d.news.length && !off ? `<div class="help" style="margin-top:4px">Saving adds ${d.news.length === 1 ? 'it' : 'them'} to your book.</div>` : ''}</div>
        <div class="acts">${off ? '' : `<button class="btn btn-primary btn-sm" data-w2a-save onclick="w2Add.draftSave(${d.n})">Save</button>`}<button class="btn btn-secondary btn-sm" data-w2a-remove onclick="w2Add.draftRemove(${d.n})">Remove</button></div></div>`;
    }).join('');
    const question = S.question ? `<div class="w2a-note" id="w2aQuestion" style="margin-top:12px;flex-wrap:wrap">${ic('info', 's16')}<span style="flex:1 1 220px"><b>Claude asks:</b> ${escH(S.question)}</span>
      <div class="w2a-row" style="flex:1 1 100%"><input class="input grow" id="w2aAnswer" maxlength="300" autocomplete="off" placeholder="Your answer" aria-label="Your answer to Claude" value="${escH(S.answer)}" oninput="w2Add.keep()" onkeydown="if(event.key==='Enter'){event.preventDefault();w2Add.answer();}"${S.busy ? ' disabled' : ''}>
      <button class="btn btn-secondary btn-sm" id="w2aAnswerBtn" onclick="w2Add.answer()"${S.busy ? ' disabled' : ''}>Draft again</button></div></div>` : '';
    return `<section class="card span-12" id="w2aTell" data-key="1"${S.busy ? ' aria-busy="true"' : ''}>${head}
      <label class="sr-only" for="w2aText">What happened</label>
      <textarea class="input w2a-text" id="w2aText" maxlength="500" placeholder="For example: Lent Person A 2 jt in cash yesterday" oninput="w2Add.keep()"${S.busy ? ' disabled' : ''}>${escH(S.text)}</textarea>
      <div class="w2a-foot" style="margin-top:10px">${S.busy ? `<button class="btn btn-secondary" id="w2aStop" onclick="w2Add.stop()">Stop</button><span class="help" role="status">Claude is drafting…</span>`
        : `<button class="btn btn-primary" id="w2aDraft" onclick="w2Add.draft()">${ic('sparkles', 's16')}Draft it</button>`}
        <span class="help grow" style="flex:1 1 260px">Sent to Claude: your sentence, today’s date and the names of your accounts, people, categories and kinds of income. No balances, no history.</span></div>
      ${S.err ? `<div class="w2a-note bad" id="w2aAiErr" role="alert" style="margin:12px 0 0">${ic('triangle-alert', 's16')}<span>${escH(S.err)}</span></div>` : ''}${question}
      ${S.drafts.length ? `<div id="w2aDrafts" style="margin-top:12px">${drafts}</div>
        <div class="w2a-foot">${ok.length > 1 ? `<button class="btn btn-primary" id="w2aSaveAll" onclick="w2Add.saveAll()">Save all ${ok.length}</button>` : ''}<button class="btn btn-ghost" id="w2aDropAll" onclick="w2Add.dropAll()">Remove all</button>
        <span class="help">Nothing is in your book until you tap Save.</span></div>` : ''}</section>`;
  }
  function redrawTell(focusId) {
    P.keep();
    const box = el('w2aTell'); if (!box) return;
    box.outerHTML = tellHTML();
    const f = focusId && el(focusId); if (f) f.focus();
  }
  async function ask(messages) {
    if (S.busy || !B()) return;
    const seq = ++S.seq, ctl = typeof AbortController === 'function' ? new AbortController() : null;
    S.busy = true; S.err = ''; S.ctl = ctl; redrawTell();
    try {
      const data = await etAI.call(aiRequest(messages), AI_TIMEOUT, ctl ? ctl.signal : undefined);
      if (seq !== S.seq) return;
      const a = readAnswer(data);
      S.drafts = B() ? draftsFrom(a.entries) : [];
      S.question = a.question; S.answer = '';
      S.convo = a.question ? [...messages, { role: 'assistant', content: a.text }] : null;
    } catch (e) {
      if (seq !== S.seq) return;
      if (!(e && e.kind === 'aborted')) S.err = e && e.kind === 'nokey' ? 'No Anthropic API key yet. Add one in Settings › AI.' : String((e && e.message) || 'Claude could not be asked. Try again.');
    } finally {
      if (seq === S.seq) { S.busy = false; S.ctl = null; redrawTell(S.question ? 'w2aAnswer' : null); }
    }
  }
  P.draft = function () {
    P.keep();
    const text = str(S.text);
    if (!text) { S.err = 'Type what happened first, in one sentence.'; redrawTell('w2aText'); return; }
    if (!hasKey()) { redrawTell(); return; }
    S.drafts = []; S.question = ''; S.convo = null;
    return ask([{ role: 'user', content: JSON.stringify(aiContext(text)) }]);
  };
  P.answer = function () {
    P.keep();
    const text = str(S.answer);
    if (!S.convo || !S.question) return;
    if (!text) { S.err = 'Type your answer first.'; redrawTell('w2aAnswer'); return; }
    return ask([...S.convo, { role: 'user', content: JSON.stringify({ answer: text }) }]);
  };
  P.stop = function () { S.seq++; try { if (S.ctl) S.ctl.abort(); } catch (_) { /* nothing to stop */ } S.busy = false; S.ctl = null; redrawTell('w2aText'); };
  P.draftRemove = function (n) { S.drafts = S.drafts.filter(d => d.n !== n); redrawTell(); };
  P.dropAll = function () { S.drafts = []; S.question = ''; S.convo = null; S.err = ''; redrawTell('w2aText'); };
  function saveDrafts(list) {
    if (!list.length || !B()) return;
    let ids, at = null;
    try { ids = book2Do(w => list.map(d => { at = d; return postSpec(w, d.spec, 'ai'); }), 'add-ai'); }
    catch (e) {
      // Nothing was saved (the store works on a copy). Say which draft the book refused, and why.
      if (at) at.errors = errList(e);
      S.err = list.length > 1 ? 'Nothing was saved: your book refused one of the drafts. Remove it, then save the rest.' : '';
      redrawTell(); return;
    }
    const texts = list.map(d => sayText(d.spec)), gone = new Set(list.map(d => d.n));
    S.drafts = S.drafts.filter(d => !gone.has(d.n));
    if (!S.drafts.length && !S.question) { S.text = ''; const t = el('w2aText'); if (t) t.value = ''; }
    S.err = '';
    redrawTell();
    undoToast(list.length === 1 ? 'Saved: ' + texts[0] : `Saved ${list.length} entries`, ids);
  }
  P.draftSave = function (n) { const d = S.drafts.find(x => x.n === n); if (d && !d.errors.length) saveDrafts([d]); };
  P.saveAll = function () { saveDrafts(usableDrafts()); };

  /* ════════════════ The page ════════════════ */
  function gate(title, desc) {
    const st = typeof book2Status === 'function' ? book2Status() : 'none', b = B();
    if (b && st !== 'blocked') return null;
    const wrap = (inner, busy) => `${pageHead(title, desc)}<div class="grid"><section class="card span-12" data-w2-state="${escH(st)}"${busy ? ' aria-busy="true"' : ''}>${inner}</section></div>`;
    const go = `<button class="btn btn-primary btn-sm" id="w2GoStart" onclick="setTab('w2-start')">Open Start here</button>`;
    const problem = (head, text) => `<div class="card-error">${ic('triangle-alert', 's24')}<div style="flex:1;min-width:0"><div style="font-weight:600;color:var(--text-1)">${escH(head)}</div><div class="help">${escH(text)}</div></div>${go}</div>`;
    if (typeof USER_EMAIL !== 'string' || !USER_EMAIL) return wrap(emptyHTML('lock', 'Sign in to add to the new book'));
    if (st === 'blocked') return wrap(problem('The new book can’t be opened', 'Its file in Google Drive can’t be read by this version of the app. Your current book is not affected.'));
    if (st === 'idle' || st === 'loading') return wrap('<div class="skel" style="width:60%;height:14px"></div><div class="skel" style="width:40%;height:14px;margin-top:10px"></div>', true);
    if (st === 'error') return wrap(problem('Couldn’t reach Google Drive', (typeof book2Error === 'function' && book2Error()) || 'Try again from Start here.'));
    return wrap(`<div class="empty">${ic('book-open', 's40')}<div class="e-title">The new book is not set up yet. Start here copies your current book into it.</div>${go}</div>`);
  }
  function renderAdd() {
    const title = 'Add', desc = 'Something that did not come from a bank email or a statement: tell it in a sentence, or type it in.';
    const g = gate(title, desc); if (g) return g;
    // The key is loaded by the original, once per account; when that changes the answer, draw the box again.
    if (hasAI() && typeof etAI.ensure === 'function') {
      try { Promise.resolve(etAI.ensure()).then(() => { if (el('w2aTell') && hasKey() !== S.key) redrawTell(); }, () => {}); } catch (_) { /* the forms still work */ }
    }
    return `${pageHead(title, desc, typeof hideBtn === 'function' ? hideBtn() : '')}<div class="grid">${tellHTML()}</div><div class="grid">${formHTML()}</div>`;
  }
  registerPage({ key: 'w2-add', label: 'Add', icon: 'plus', group: 'w2', order: 15, render: renderAdd });

  /* ── An Add button on the head of every other new page (no other file is edited: the button is
        put in after the page is drawn; on phones the core hides page heads, so Add is under More) ── */
  function addButton() {
    try {
      if (typeof ACTIVE_TAB !== 'string' || ACTIVE_TAB.indexOf('w2-') !== 0 || ACTIVE_TAB === 'w2-add' || el('w2AddBtn')) return;
      const head = document.querySelector('#root .page-head'); if (!head) return;
      let acts = head.querySelector('.page-actions');
      if (!acts) { acts = document.createElement('div'); acts.className = 'page-actions'; head.appendChild(acts); }
      acts.insertAdjacentHTML('afterbegin', `<button class="btn btn-primary btn-sm" id="w2AddBtn" onclick="setTab('w2-add')">${ic('plus', 's16')}Add</button>`);
    } catch (_) { /* a missing button must never break a page */ }
  }
  try {
    const root = el('root');
    if (root && typeof MutationObserver === 'function') { new MutationObserver(addButton).observe(root, { childList: true }); addButton(); }
  } catch (_) { /* no button: the page is still in the menu */ }

  /* ── For the Inbox: typed or drafted entries a statement line may be the same as ──
     Posted entries typed here or drafted by Claude (source type manual or ai) with a line on that
     account of the same amount (either sign), dated within 3 days of the date, and not yet linked
     to a statement line (linked = source.ref starts with "st:"). Nearest date first. Reads only:
     the entries returned are copies. */
  window.book2ManualCandidates = function (accountId, amount, date) {
    const b = B(), want = Math.abs(Math.round(Number(amount)));
    if (!b || !accountId || !(want > 0) || !validDay(date)) return [];
    const day = d => Math.round(new Date(d + 'T00:00:00Z').getTime() / 86400000), at = day(date);
    return live(b.entries).filter(e => e.status === 'posted' && e.source && (e.source.type === 'manual' || e.source.type === 'ai')
      && !/^st:/.test(String(e.source.ref || '')) && validDay(e.date) && Math.abs(day(e.date) - at) <= 3
      && (e.lines || []).some(l => l.account === accountId && Math.abs(l.amount) === want))
      .sort((x, y) => Math.abs(day(x.date) - at) - Math.abs(day(y.date) - at) || String(y.createdAt || '').localeCompare(String(x.createdAt || '')))
      .map(cp);
  };
})();
