/* ExpenseTrack v5 — Ask Claude, the assistant across the app.
   Contract: docs/v5-assistant.md; UX: UX-GUIDELINE.md §11.13. Loaded after js/extras.js.
   No personal data in this file: the repo is public.

   One chat for the whole app. Claude may open pages (navigate, at once), make small edits and draft
   new entries. Every change goes into ONE change set through the action tools below; none of them
   writes anything. The owner applies the whole set with Apply all and can take it back with Undo
   all. The tool list is closed: there is no tool to delete, hide, void, change rules, change the
   chart of accounts, renumber, close periods, import, restore or change Settings.

   Each request carries the fixed rules and tools, the first-turn context {today, page, filters,
   baseCurrency, text} and only the results of the look-ups Claude asked for. The key is only ever
   sent as the x-api-key header by window.etAI.call (js/entry.js). */
(function(){
  'use strict';

  /* ── Settings that are not personal data ── */
  const MAX_REQ=15,MAX_ITEMS=200,ROWS_CAP=200,TEXT_CAP=40000,TIMEOUT=120000,LOG_MAX=200;
  const UNDO_WHY='Undo of Ask Claude change set';
  const W_DRAWER=420;

  registerIcon('as-send','<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>');
  registerIcon('as-stop','<rect x="6" y="6" width="12" height="12" rx="2"/>');
  registerIcon('as-undo','<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>');
  registerIcon('as-dot','<circle cx="12" cy="12" r="3"/>');
  registerIcon('as-arrow','<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>');
  registerIcon('sparkles','<path d="M9.94 14.06 4 20"/><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M20 3v4"/><path d="M22 5h-4"/>');

  /* ── Styles (existing tokens only, so light and dark both work) ── */
  (function(){
    if(document.getElementById('as-styles'))return;
    const s=document.createElement('style');s.id='as-styles';
    s.textContent=`
    .as-fab{position:fixed;right:24px;bottom:24px;z-index:2400;width:48px;height:48px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
      background:var(--surface-3);color:var(--accent);border:1px solid var(--border);cursor:pointer;transition:background var(--dur-fast) ease-out}
    .as-fab:hover{background:var(--surface-2)}
    .as-fab svg.i{width:22px;height:22px}
    body.as-open .as-fab{display:none}
    @media (max-width:1023px){body.as-open .toast-host{top:calc(env(safe-area-inset-top) + 12px);bottom:auto}}
    .as-scrim{display:none}
    .as-panel{position:fixed;top:0;right:0;bottom:0;width:${W_DRAWER}px;max-width:100vw;z-index:2500;display:flex;flex-direction:column;
      background:var(--surface-2);border-left:1px solid var(--border);color:var(--text-1);box-sizing:border-box}
    .as-panel[hidden]{display:none}
    .as-handle{display:none}
    .as-head{display:flex;align-items:center;gap:8px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--border);min-width:0}
    .as-head h2{margin:0;font-size:16px;line-height:22px;font-weight:600;white-space:nowrap}
    .as-model{font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .as-grow{flex:1;min-width:0}
    .as-log{flex:1;overflow-y:auto;overflow-x:hidden;padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0;overscroll-behavior:contain}
    .as-you{align-self:flex-end;max-width:85%;background:var(--surface-3);border:1px solid var(--border);border-radius:var(--radius-md);padding:8px 12px;font-size:14px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
    .as-claude{font-size:14px;line-height:21px;color:var(--text-1);overflow-wrap:anywhere}
    .as-claude p{margin:0 0 8px}.as-claude p:last-child{margin-bottom:0}
    .as-claude ul,.as-claude ol{margin:0 0 8px;padding-left:20px}
    .as-look,.as-nav{display:flex;gap:6px;align-items:center;font-size:13px;line-height:18px;color:var(--text-3);overflow-wrap:anywhere}
    .as-look svg.i{width:12px;height:12px;flex-shrink:0}
    .as-nav{color:var(--text-2)}
    .as-looks summary{cursor:pointer;font-size:13px;color:var(--text-3);list-style:none}
    .as-looks summary::-webkit-details-marker{display:none}
    .as-looks .as-look{margin:4px 0 0 4px}
    .as-busy{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2)}
    .as-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--border-strong);border-top-color:var(--accent);animation:spin 1s linear infinite;flex-shrink:0}
    .as-note{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;font-size:13px;line-height:18px;padding:10px 12px;border-radius:var(--radius-sm);background:var(--bad-soft);color:var(--text-1)}
    .as-note.info{background:var(--info-soft)}
    .as-note .as-note-t{flex:1 1 200px;min-width:0;overflow-wrap:anywhere}
    .as-empty{display:flex;flex-direction:column;gap:10px;color:var(--text-2);font-size:14px}
    .as-chips{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
    .as-chips .chip{height:auto;min-height:32px;white-space:normal;text-align:left;line-height:18px;padding:6px 12px}
    .as-recent{margin-top:8px;font-size:13px;color:var(--text-3)}
    .as-recent ul{margin:4px 0 0;padding-left:18px}
    .as-input{display:flex;gap:8px;align-items:flex-end;padding:12px 12px 12px 16px;border-top:1px solid var(--border)}
    .as-input textarea{flex:1;min-width:0;resize:none;height:auto;min-height:40px;max-height:112px;line-height:20px;padding:9px 12px;font:inherit;font-size:14px}
    .as-set{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-1);padding:12px;display:flex;flex-direction:column;gap:10px;min-width:0}
    .as-set-h b{font-size:14px}
    .as-sum{font-size:13px;color:var(--text-2);margin-top:2px;overflow-wrap:anywhere}
    .as-grp{display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px solid var(--border);min-width:0}
    .as-grp>.check{font-weight:600;color:var(--text-1);font-size:13px}
    .as-item{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:18px;padding:4px 6px;border-radius:var(--radius-xs);min-width:0}
    .as-item.blocked{background:var(--bad-soft)}
    .as-item input{margin-top:2px;flex-shrink:0}
    .as-item-b{flex:1;min-width:0;overflow-wrap:anywhere}
    .as-item-sub{color:var(--text-3)}
    .as-old{color:var(--text-3);text-decoration:line-through}
    .as-new{color:var(--text-1)}
    .as-why{display:block;color:var(--text-1);margin-top:2px}
    .as-jr{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;table-layout:fixed}
    .as-jr td{padding:2px 4px 2px 0;vertical-align:top;overflow-wrap:anywhere}
    .as-jr td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;width:30%}
    .as-jr tr.cr td:first-child{padding-left:14px}
    .as-aff summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--text-1)}
    .as-aff-l{display:flex;gap:8px;justify-content:space-between;font-size:13px;line-height:18px;padding:3px 0;min-width:0}
    .as-aff-l .as-al{min-width:0;overflow-wrap:anywhere;color:var(--text-2)}
    .as-aff-l .as-av{white-space:nowrap;text-align:right}
    .as-warn-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--warn);margin-right:6px;vertical-align:1px}
    .as-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border)}
    .as-applied{display:flex;flex-direction:column;gap:6px}
    .as-applied .as-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    @media (min-width:1280px){body.as-open .main{margin-right:${W_DRAWER}px}}
    @media (min-width:1024px) and (max-width:1279px){.as-panel{box-shadow:var(--shadow-pop)}}
    @media (max-width:1023px){
      .as-scrim{display:block;position:fixed;inset:0;z-index:2490;background:var(--scrim)}
      .as-scrim[hidden]{display:none}
      .as-panel{top:auto;left:0;right:0;width:auto;height:92vh;height:92dvh;border-left:none;border-top:1px solid var(--border-strong);
        border-radius:var(--radius-lg) var(--radius-lg) 0 0;background:var(--surface-3);box-shadow:var(--shadow-pop);padding-bottom:env(safe-area-inset-bottom)}
      .as-handle{display:block;width:36px;height:4px;border-radius:4px;background:var(--border-strong);margin:8px auto 0;flex-shrink:0}
    }
    @media (max-width:767px){.as-fab{display:none}.as-head{padding:8px 8px 8px 16px}.as-log{padding:12px 16px}.as-input textarea{font-size:16px}}`;
    document.head.appendChild(s);
  })();

  /* ── Small helpers ── */
  const pad=n=>String(n).padStart(2,'0');
  const isoDay=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayISO=()=>isoDay(new Date());
  const thisMonth=()=>todayISO().slice(0,7);
  const stamp=()=>new Date().toISOString();
  const R=n=>Math.round(+n||0);
  const clone=o=>o==null?o:JSON.parse(JSON.stringify(o));
  const has=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
  const validDate=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00');return!isNaN(d)&&isoDay(d)===s;};
  const validMonth=s=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(s||''));
  const monthEnd=M=>{const[y,m]=M.split('-').map(Number);return`${M}-${pad(new Date(y,m,0).getDate())}`;};
  const txDay=t=>{const d=txDateOf(t);return isNaN(d.getTime())?'':isoDay(d);};
  const merchantOf=t=>t.merchantClean||t.merchantRaw||'Unknown';
  const seeded=()=>typeof ledgerSeeded==='function'&&ledgerSeeded();
  const dayShort=d=>{try{return fmtDay(new Date(String(d).slice(0,10)+'T00:00:00'));}catch(_){return String(d||'');}};
  const mLong=M=>{try{return monthLabel(M,true);}catch(_){return M;}};
  const money=n=>n==null?'—':`<span class="amt">${escH(fmtIDR(R(n)))}</span>`;
  const moneyS=n=>n==null?'—':`<span class="amt">${escH(fmtIDRShort(R(n)))}</span>`;
  const pct=n=>n==null?'—':`<span class="amt">${Math.round(n)}%</span>`;
  const isSheetMode=()=>window.matchMedia('(max-width: 1023px)').matches;
  function bad(msg){const e=new Error(msg);e.toolErr=true;throw e;}
  // "2026-10-01".."2026-10-31" → "October 2026"; else "3 Oct – 9 Oct 2026".
  function rangeLabel(f,t){
    if(f&&t&&f.slice(0,7)===t.slice(0,7)&&f.endsWith('-01')&&t===monthEnd(f.slice(0,7)))return mLong(f.slice(0,7));
    try{return`${fmtDayLong(new Date(f+'T00:00:00')).replace(/ \d{4}$/,'')} – ${fmtDayLong(new Date(t+'T00:00:00'))}`;}catch(_){return`${f} – ${t}`;}
  }
  // from/to as YYYY-MM-DD; YYYY-MM is taken as the month's first / last day.
  function day(v,end,name){
    if(v==null||v==='')return null;v=String(v);
    if(validMonth(v))return end?monthEnd(v):v+'-01';
    if(!validDate(v))bad(`${name||'date'} must be YYYY-MM-DD`);return v;
  }
  function range(i,req){
    const f=day(i.from,false,'from'),t=day(i.to,true,'to');
    if(req&&(!f||!t))bad('from and to are required (YYYY-MM-DD)');
    if(f&&t&&f>t)bad('from is after to');return[f,t];
  }
  const inRange=(d,f,t)=>!!d&&(!f||d>=f)&&(!t||d<=t);
  const allTx=()=>{const m=new Map();for(const t of ALL_TRANSACTIONS_RAW||[])if(t&&t.id)m.set(t.id,t);for(const t of ALL_TRANSACTIONS||[])if(t&&t.id&&!m.has(t.id))m.set(t.id,t);return m;};
  function findTx(id){return(ALL_TRANSACTIONS||[]).find(t=>t.id===id)||(ALL_TRANSACTIONS_RAW||[]).find(t=>t.id===id)||null;}
  const knownCats=()=>[...new Set([...Object.keys(CATEGORIES),...(ALL_TRANSACTIONS||[]).map(t=>t.category).filter(Boolean),...Object.values(STATE.merchantCats||{})])];
  const cardOf=c=>{const s=String(c||'').trim().toLowerCase();return CC_CARDS.find(x=>x.key.toLowerCase()===s||x.label.toLowerCase()===s)||null;};
  const isHeader=a=>!!a&&(a.postable===false||(a.postable==null&&!!a.isParent));
  const L=()=>typeof LEDGER==='function'?LEDGER():null;
  const accName=code=>{const x=L(),a=x&&x.accounts[code];if(a)return a.name;const w=typeof wAcc==='function'&&W()?wAcc(code):null;return w?w.name:code;};
  const modelLabel=id=>{const p=String(id||'').replace(/^claude-/,'').split('-');if(!p.length||!p[0])return'Claude';return'Claude '+p[0].charAt(0).toUpperCase()+p[0].slice(1)+(p.length>1?' '+p.slice(1).join('.'):'');};
  const pageLabel=k=>(typeof TAB_TITLES!=='undefined'&&TAB_TITLES[k])||((typeof pageByKey==='function'&&pageByKey(k))||{}).label||k;
  const pageKeys=()=>[...new Set([...BUILTIN_TABS,...PAGES.map(p=>p.key)])];
  // Caps a result: rows ≤ 200 (truncated:true), the JSON ≤ 40 000 characters.
  function capped(o){
    for(const k of Object.keys(o))if(Array.isArray(o[k])&&o[k].length>(o.__cap||ROWS_CAP)){o[k]=o[k].slice(0,o.__cap||ROWS_CAP);o.truncated=true;}
    delete o.__cap;
    let s=JSON.stringify(o);
    while(s.length>TEXT_CAP){
      const k=Object.keys(o).filter(x=>Array.isArray(o[x])&&o[x].length>1).sort((a,b)=>JSON.stringify(o[b]).length-JSON.stringify(o[a]).length)[0];
      if(!k){s=s.slice(0,TEXT_CAP);break;}
      o[k]=o[k].slice(0,Math.ceil(o[k].length/2));o.truncated=true;s=JSON.stringify(o);
    }
    return s;
  }

  /* ══ The fixed rules (system prompt, contract §7) ══ */
  const SYSTEM=[
    'You are "Ask Claude", the assistant inside ExpenseTrack, the owner\'s personal finance app. It keeps a personal book in Indonesian rupiah (IDR): card and bank spending, budgets and goals, net worth, cash movements, income, the month-end close, and a double-entry book (chart of accounts, journals, ledger, reports).',
    'You can do three things: open pages for the owner (navigate), make small edits, and draft new entries. Use these tools only.',
    'Allowed changes (each through its action tool): set the category of listed transactions (set_category; per transaction only, never a merchant rule), set or clear a transaction note (set_note), set a monthly budget (set_budget), add or change a goal (save_goal), add a journal that is posted to the book (add_journal), add an income receipt (add_income), add a manual transaction (add_manual_transaction), mark a card as paid through a date (mark_card_paid), enter a month-end balance (set_month_end_balance), set the type of one cash movement (set_cash_type), tick a month-end checklist entry (tick_checklist), mark an account as declared in the tax return (set_declared).',
    'Not available, and there is no tool for it: deleting, hiding, voiding or removing anything (transactions, card markers, budgets, goals, drafts, journals, accounts, rules); editing an amount or a merchant, splits, FX rates; merchant, pattern, auto-note and date-category rules, approving a subscription, card-balance exclusions; chart of accounts changes (add, edit, archive, retained earnings), re-coding; periods (closing, reopening, locking), set-up, seed, import, merge; file imports, backup and restore, Settings, the API key or model, sign-in, sync; month-end mapping and counter-accounts, posting the month-end entry, Accurate exports; editing a journal that is already posted. When asked for one of these, say plainly that you can\'t do it and offer to open the page where the owner can do it (for example "I can\'t do that, but I can open Books › Periods for you"), using navigate.',
    'Look things up before proposing anything. Never invent ids, amounts, dates or accounts: take them from the look-up results. Ask only for what you need, with narrow ranges.',
    'None of the action tools writes anything. Each one checks the change and puts it into one change set that the owner reviews as a whole, with everything it affects, and applies with one approval. So put every change you propose through the action tools, in one go, rather than describing it. A tool answer with is_error explains what was wrong: fix the input or tell the owner. A later proposal for the same thing replaces the earlier one.',
    'Use navigate when the owner wants to see something; it opens the page at once and changes no data.',
    'Accounting rules for add_journal (the same as the app\'s journal drafts): lines only on posting accounts (isParent false, not archived) from the chart of accounts; whole rupiah; each line has either a debit or a credit and the other is 0; never a line of 0; debits equal credits exactly. Assets and expenses increase with a debit; liabilities, equity and income increase with a credit. A line on an account whose ccy is not IDR, or an amount in a foreign currency, carries fx {ccy, amount, rate} with round(amount x rate) equal to the line\'s rupiah amount; otherwise fx is null. A month that is closed or locked takes no new journal.',
    'Amounts in tool answers are whole rupiah. Dates are YYYY-MM-DD, months YYYY-MM. Amounts of spending are positive. In your replies write every amount in full as Rp with dot thousands, for example Rp 1.500.000 (never 1,5 jt or 1.5 million), so the app can hide amounts when the owner asks.',
    'End every turn with a short plain summary: what you found and, when you proposed changes, what the change set does. Keep it brief; short bold and lists are fine, no tables, no HTML.'].join('\n');

  /* ══ Tools (contract §3–§4): the closed list ══ */
  const S={str:{type:'string'},int:{type:'integer'},num:{type:'number'},bool:{type:'boolean'}};
  const obj=(props,req,extra)=>({type:'object',additionalProperties:false,properties:props,required:req||[],...(extra||{})});
  const LOOKUPS=[
    {name:'overview',description:'The categories, the credit cards with their current outstanding, the months with spending data, whether the book is set up, the chart of accounts (id, name, kind, ccy, isParent, archived) and the names of budgets and goals. Start here when you need ids, names or accounts.',
      input_schema:obj({})},
    {name:'find_transactions',description:'Card and bank transactions (hidden ones left out), newest first. Also count and total over every match, not just the rows returned.',
      input_schema:obj({from:{type:'string',description:'YYYY-MM-DD'},to:{type:'string',description:'YYYY-MM-DD'},category:{type:'string'},merchant:{type:'string',description:'case-insensitive contains'},
        bank:{type:'string'},min:{type:'number'},max:{type:'number'},text:{type:'string',description:'in merchant or note'},limit:{type:'integer',description:'at most 200, default 50'}},['from','to'])},
    {name:'spending_summary',description:'Spending totals and counts per category, merchant, month or bank, the same way the Spending page counts them (spending only, splits applied).',
      input_schema:obj({from:{type:'string'},to:{type:'string'},group_by:{type:'string',enum:['category','merchant','month','bank']},category:{type:'string'},bank:{type:'string'}},['from','to','group_by'])},
    {name:'card_position',description:'A credit card\'s current outstanding since its last paid-through marker, the last payment, days since, and the last 6 cycles.',
      input_schema:obj({card:{type:'string',description:'one of the cards from overview'}},['card'])},
    {name:'budgets_goals',description:'Budgets for a month (spent, % used, projected, status) and goals with progress, % and the monthly amount required.',
      input_schema:obj({month:{type:'string',description:'YYYY-MM, default this month'}})},
    {name:'book_report',description:'Reports from the book (posted journals only): balances (current balance of each posting account that is not zero), trial_balance, income_statement, balance_sheet, general_ledger (needs account).',
      input_schema:obj({report:{type:'string',enum:['balances','trial_balance','income_statement','balance_sheet','general_ledger']},from:{type:'string',description:'YYYY-MM-DD or YYYY-MM'},to:{type:'string',description:'YYYY-MM-DD or YYYY-MM'},account:{type:'string'}},['report'])},
    {name:'list_journals',description:'Journals in the book with their number, kind, status, date, description and lines (amount: debit positive, credit negative), newest first.',
      input_schema:obj({from:S.str,to:S.str,status:{type:'string',enum:['posted','draft','void']},kind:S.str,text:{type:'string',description:'in description or number'},limit:{type:'integer',description:'at most 100, default 30'}})},
    {name:'month_end',description:'A month-end close: per account the book value, the entered value and its source, the statement value and the difference; the journal state and its issues; the checklist entries and their ticks; whether the period is open, closed or locked.',
      input_schema:obj({month:{type:'string',description:'YYYY-MM'}},['month'])},
    {name:'income_list',description:'Income receipts typed in the app: date, payer, amount, the account it came into, the income account, note, whether it is posted.',
      input_schema:obj({month:{type:'string',description:'YYYY-MM'}})},
    {name:'cash_movements',description:'Bank and account movements from the statements, each with the type in effect, plus totals in, out and into investments per month.',
      input_schema:obj({from:S.str,to:S.str,account:{type:'string',description:'statement account id or name'},type:{type:'string',description:'a cash type key'}},['from','to'])},
    {name:'statement_lines',description:'Statement lines in a date range (at most 400): id, the book account it belongs to, statement name, date, amount (positive = money in), description, counterparty, inBook when a posted journal already uses it.',
      input_schema:obj({from:S.str,to:S.str,account:{type:'string',description:'book account code'}},['from','to'])},
    {name:'net_worth',description:'Net worth per month from the book: assets, liabilities, net and the groups.',
      input_schema:obj({months:{type:'integer',description:'at most 24, default 12'}})}];
  // Strict schemas: no numeric or length limits in the schema itself (they are checked in code).
  const NULLSTR={anyOf:[{type:'string'},{type:'null'}]};
  const LINE=obj({account:{type:'string',description:'posting account id'},debit:{type:'integer',description:'whole rupiah, 0 for a credit line'},credit:{type:'integer',description:'whole rupiah, 0 for a debit line'},
    memo:{type:'string'},fx:{anyOf:[{type:'null'},obj({ccy:{type:'string'},amount:{type:'number'},rate:{type:'number'}},['ccy','amount','rate'])]}},['account','debit','credit','memo','fx']);
  const ACTIONS=[
    {name:'navigate',description:'Opens a page for the owner at once (no data changes): any page key (overview = Daily spending, spending, cards, networth, cash, accounts, income, close = Month-end, settings, more, home, coa, journals, ledger, bs, pl, tb, periods, audit, budgets, goals, invest, spt), optionally with filters.',
      input_schema:obj({page:S.str,month:{type:'string',description:'YYYY-MM'},from:S.str,to:S.str,category:S.str,merchant:S.str,bank:S.str,card:S.str,cards_view:{type:'string',enum:['current','history','fx']},account:S.str,journal:{type:'string',description:'journal id or number'}},['page'])},
    {name:'set_category',description:'Proposes a category for listed transactions (1–200 ids). Per transaction only; never a merchant rule.',
      input_schema:obj({transaction_ids:{type:'array',items:S.str},category:{type:'string',description:'a known category, or a new name of at most 40 characters'}},['transaction_ids','category'])},
    {name:'set_note',description:'Proposes a note for one transaction (at most 200 characters; empty clears it).',
      input_schema:obj({transaction_id:S.str,note:S.str},['transaction_id','note'])},
    {name:'set_budget',description:'Proposes a monthly budget for a spending category (amount above 0).',
      input_schema:obj({category:S.str,monthly:{type:'integer',description:'whole rupiah, above 0'}},['category','monthly'])},
    {name:'save_goal',description:'Proposes a new goal (goal_id null) or a change to one. kind: networth, liquid (cash and deposits), saving (growth from now), account (the chosen accounts; give their ids).',
      input_schema:obj({goal_id:NULLSTR,name:S.str,kind:{type:'string',enum:['networth','liquid','saving','account']},target:{type:'integer',description:'whole rupiah, above 0'},by:{type:'string',description:'YYYY-MM'},accounts:{type:'array',items:S.str}},['goal_id','name','kind','target','by','accounts'])},
    {name:'add_journal',description:'Proposes a new journal, posted to the book on Apply (it then gets its JV number). Balanced, posting accounts only, no zero lines, the month must be open.',
      input_schema:obj({date:{type:'string',description:'YYYY-MM-DD'},description:S.str,lines:{type:'array',items:LINE}},['date','description','lines'])},
    {name:'add_income',description:'Proposes an income receipt: Dr the account it came into, Cr the income account; posted to the book on Apply when the book is set up.',
      input_schema:obj({date:S.str,payer:S.str,amount:{type:'integer',description:'whole rupiah, above 0'},into_account:S.str,income_account:S.str,note:S.str},['date','payer','amount','into_account','income_account','note'])},
    {name:'add_manual_transaction',description:'Proposes a manual spending transaction (like Add transaction). paid_with: Cash, Other, or a card or bank name (Maybank, BCA, OCBC, OCBC CC).',
      input_schema:obj({date:S.str,merchant:S.str,amount:{type:'integer',description:'whole rupiah, above 0'},category:S.str,paid_with:S.str,note:S.str},['date','merchant','amount','category','paid_with','note'])},
    {name:'mark_card_paid',description:'Proposes a paid-through marker for a credit card: everything up to that moment counts as paid.',
      input_schema:obj({card:S.str,date:S.str,time:{type:'string',description:'HH:MM'},note:S.str},['card','date'])},
    {name:'set_month_end_balance',description:'Proposes the balance of one account at a month-end (whole rupiah; for a foreign account give fx with the foreign amount and the rate).',
      input_schema:obj({month:S.str,account:S.str,amount:S.int,fx:{anyOf:[{type:'null'},obj({amount:S.num,rate:S.num},['amount','rate'])]}},['month','account','amount','fx'])},
    {name:'set_cash_type',description:'Proposes the type of one cash movement (this line only, never a payer rule).',
      input_schema:obj({cash_id:S.str,type:{type:'string',enum:Object.keys(CASH_TYPES)}},['cash_id','type'])},
    {name:'tick_checklist',description:'Proposes ticking (or unticking) a month-end checklist entry as posted.',
      input_schema:obj({month:S.str,entry_id:S.str,posted:S.bool},['month','entry_id','posted'])},
    {name:'set_declared',description:'Proposes marking an account as declared (or not) in the tax return (SPT).',
      input_schema:obj({account:S.str,declared:S.bool},['account','declared'])}].map(t=>({...t,strict:true}));
  const TOOLS=[...LOOKUPS,...ACTIONS];
  const TOOL_NAMES=TOOLS.map(t=>t.name);
  function toolsForRequest(){const t=clone(TOOLS);t[t.length-1].cache_control={type:'ephemeral'};return t;}

  // The schema check in code (the subset the tools use).
  function checkSchema(v,s,path){
    if(s.anyOf){const errs=s.anyOf.map(x=>checkSchema(v,x,path));if(errs.some(e=>!e))return null;return errs[0];}
    const t=s.type;
    if(t==='null')return v===null?null:`${path} must be null`;
    if(t==='string'){if(typeof v!=='string')return`${path} must be a string`;if(s.enum&&!s.enum.includes(v))return`${path} must be one of ${s.enum.join(', ')}`;return null;}
    if(t==='integer')return Number.isInteger(v)?null:`${path} must be a whole number`;
    if(t==='number')return typeof v==='number'&&isFinite(v)?null:`${path} must be a number`;
    if(t==='boolean')return typeof v==='boolean'?null:`${path} must be true or false`;
    if(t==='array'){if(!Array.isArray(v))return`${path} must be a list`;for(let i=0;i<v.length;i++){const e=checkSchema(v[i],s.items,`${path}[${i}]`);if(e)return e;}return null;}
    if(t==='object'){
      if(!v||typeof v!=='object'||Array.isArray(v))return`${path||'input'} must be an object`;
      for(const k of s.required||[])if(!has(v,k))return`${path?path+'.':''}${k} is required`;
      for(const k of Object.keys(v)){if(!has(s.properties,k)){if(s.additionalProperties===false)return`${path?path+'.':''}${k} is not a known field`;continue;}
        const e=checkSchema(v[k],s.properties[k],path?`${path}.${k}`:k);if(e)return e;}
      return null;
    }
    return null;
  }

  /* ══ Look-ups (read only, run at once) ══ */
  function chartForAI(){
    const x=L();
    if(x)return Object.values(x.accounts).filter(a=>a&&!a.suspended).sort((p,q)=>String(p.id).localeCompare(String(q.id),undefined,{numeric:true}))
      .map(a=>({id:String(a.id),name:String(a.name||a.id),kind:a.kind,ccy:a.ccy||'IDR',isParent:isHeader(a),archived:!!a.archivedAt}));
    if(W())return wAccounts().map(a=>({id:a.id,name:a.name,kind:a.side,ccy:a.ccy||'IDR',isParent:false,archived:!a.active}));
    return[];
  }
  function budgetCats(){const b=STATE.budgets||{};return Object.keys(b).filter(c=>b[c]&&!b[c].deleted&&b[c].monthly>0);}
  const goalsLive=()=>(Array.isArray(STATE.goals)?STATE.goals:[]).filter(g=>g&&g.id&&!g.deleted);
  function txRow(t){
    const o={id:t.id,date:txDay(t),merchant:merchantOf(t),amount:t.amount==null?null:R(t.amount),category:t.category||'Others',bank:typeof bankLabel==='function'?bankLabel(t):t.bank};
    if(cardOf(t.bank))o.card=cardOf(t.bank).label;if(t.note)o.note=String(t.note);if(t.manual)o.manual=true;return o;
  }
  function spendIn(f,t,o){
    o=o||{};const cat=o.category?String(o.category).toLowerCase():null,bank=o.bank?String(o.bank).toLowerCase():null;
    return(ALL_TRANSACTIONS||[]).filter(x=>(x.amount||0)>0&&inRange(txDay(x),f,t)&&(!cat||String(x.category||'Others').toLowerCase()===cat)
      &&(!bank||String(x.bank||'').toLowerCase()===bank||String(bankLabel(x)).toLowerCase()===bank));
  }
  function tbMap(){const m={};if(!seeded())return m;try{for(const r of ledgerLib.tb(null,null,null).rows)m[r.code]=r.closing;}catch(_){}return m;}
  function cashLabel(id){const a=typeof cashAcc==='function'?cashAcc(id):null;return a?a.label:id;}
  function stmtCode(ca){try{return typeof meMapOf==='function'?(meMapOf(ca)||null):null;}catch(_){return null;}}
  function usedStmtLines(){
    const x=L(),s=new Set();if(!x)return s;const al=(x.cash||{}).alias||{};
    const res=id=>{let k=String(id),n=0;while(al[k]&&n++<8)k=al[k];return k;};
    for(const v of Object.values(x.vouchers))if(v&&v.status==='posted')for(const l of v.lines||[])if(l&&l.stmtLine)s.add(res(l.stmtLine));
    return s;
  }
  const LOOK={
    overview:{label:()=>'Looked up your categories, cards and accounts',run(){
      const ms=dataMonths();
      return{categories:knownCats(),cards:CC_CARDS.map(c=>({card:c.key,label:c.label,outstanding:R(ccState(c.key).balance)})),
        monthsWithData:ms,bookSetUp:seeded(),chartOfAccounts:chartForAI(),budgets:budgetCats(),goals:goalsLive().map(g=>({id:g.id,name:g.name})),__cap:400};}},
    find_transactions:{label:i=>`Looked up transactions · ${rangeLabel(...range(i,true))}${i.category?' · '+i.category:''}${i.merchant?' · '+i.merchant:''}`,run(i){
      const[f,t]=range(i,true),lim=Math.max(1,Math.min(200,R(i.limit)||50));
      const cat=i.category?String(i.category).toLowerCase():null,mer=i.merchant?String(i.merchant).toLowerCase():null,bank=i.bank?String(i.bank).toLowerCase():null,txt=i.text?String(i.text).toLowerCase():null;
      const rows=(ALL_TRANSACTIONS||[]).filter(x=>{const d=txDay(x);if(!inRange(d,f,t))return false;
        if(cat&&String(x.category||'Others').toLowerCase()!==cat)return false;
        if(mer&&!merchantOf(x).toLowerCase().includes(mer)&&!String(x.merchantRaw||'').toLowerCase().includes(mer))return false;
        if(bank&&String(x.bank||'').toLowerCase()!==bank&&String(bankLabel(x)).toLowerCase()!==bank)return false;
        if(i.min!=null&&!((x.amount||0)>=i.min))return false;if(i.max!=null&&!((x.amount||0)<=i.max))return false;
        if(txt&&!(merchantOf(x)+' '+(x.note||'')).toLowerCase().includes(txt))return false;return true;})
        .sort((a,b)=>txDateOf(b)-txDateOf(a));
      const out={from:f,to:t,count:rows.length,total:R(rows.reduce((s,x)=>s+(x.amount||0),0)),rows:rows.slice(0,lim).map(txRow)};
      if(rows.length>lim)out.truncated=true;return out;}},
    spending_summary:{label:i=>`Looked up spending by ${i.group_by||'category'} · ${rangeLabel(...range(i,true))}`,run(i){
      const[f,t]=range(i,true),by={};
      const key=x=>i.group_by==='merchant'?merchantOf(x):i.group_by==='month'?monthKeyOf(txDateOf(x)):i.group_by==='bank'?bankLabel(x):(x.category||'Others');
      const xs=spendIn(f,t,i);for(const x of xs){const k=key(x);(by[k]||(by[k]={group:k,total:0,count:0})).total+=x.amount;by[k].count++;}
      const rows=Object.values(by).map(r=>({...r,total:R(r.total)}));
      rows.sort(i.group_by==='month'?(a,b)=>a.group.localeCompare(b.group):(a,b)=>b.total-a.total);
      return{from:f,to:t,groupBy:i.group_by,total:R(xs.reduce((s,x)=>s+x.amount,0)),count:xs.length,rows};}},
    card_position:{label:i=>`Read card position · ${(cardOf(i.card)||{label:i.card}).label}`,run(i){
      const c=cardOf(i.card);if(!c)bad(`card ${i.card} is not one of ${CC_CARDS.map(x=>x.key).join(', ')}`);
      const st=ccState(c.key);
      return{card:c.key,label:c.label,balance:R(st.balance),since:st.lastPayDate?st.lastPayment.date:null,transactionsSince:st.since.length,excludedSince:st.excludedCount,
        lastPayment:st.lastPayment?{date:st.lastPayment.date,note:st.lastPayment.note||''}:null,daysSince:st.daysSince,
        cycles:ccHistory(st).slice(-6).map(h=>({paidThrough:h.p.date,total:R(h.total),count:h.count}))};}},
    budgets_goals:{label:()=>'Read budgets and goals',run(i){
      let now=new Date();if(i.month){if(!validMonth(i.month))bad('month must be YYYY-MM');if(i.month!==thisMonth()){const[y,m]=i.month.split('-').map(Number);now=new Date(y,m,0,23,59,59);}}
      const d=EXTRAS.budCompute(now);
      const goals=W()?EXTRAS.goalList().map(g=>{const c=EXTRAS.goalCalc(g)||{};return{id:g.id,name:g.name,kind:g.kind,target:R(g.target),by:g.by,accounts:g.accounts||undefined,
        progress:R(c.progress),pct:Math.round(c.pct||0),required:R(c.required),status:c.status||null};}):[];
      return{month:d.cm,budgets:d.rows.map(r=>({cat:r.cat,monthly:R(r.monthly),spent:R(r.spent),pct:Math.round(r.pct),projected:R(r.projected),status:r.status})),
        unbudgeted:d.unbudgeted.slice(0,30).map(([c,v])=>({cat:c,spent:R(v)})),goals,...(W()?{}:{goalsNote:'Goals need the wealth snapshot or your book'})};}},
    book_report:{label:i=>`Read the ${String(i.report||'').replace(/_/g,' ')}`,run(i){
      if(!seeded())bad('Your book is not set up yet (Settings › Your book)');
      const[f,t]=range(i,false);
      if(i.report==='balances'){const rows=ledgerLib.tb(null,null,t||null).rows.filter(r=>r.postable&&r.closing).map(r=>({account:r.code,name:r.name,kind:r.kind,balance:R(r.closing)}));return{asOf:t||todayISO(),rows};}
      if(i.report==='trial_balance'){const tb=ledgerLib.tb(null,f,t);return{from:f,to:t,balanced:tb.balanced,totals:tb.totals,rows:tb.rows.filter(r=>r.opening||r.debit||r.credit||r.closing).map(r=>({account:r.code,name:r.name,kind:r.kind,opening:R(r.opening),debit:R(r.debit),credit:R(r.credit),closing:R(r.closing)}))};}
      if(i.report==='income_statement'){const p=ledgerLib.pl(null,f,t);return{from:f,to:t,income:p.income,expense:p.expense,totalIncome:R(p.totalIncome),totalExpense:R(p.totalExpense),net:R(p.net)};}
      if(i.report==='balance_sheet'){const b=ledgerLib.bs(null,t||null);return{asOf:b.asOf,assets:b.assets,liabilities:b.liabilities,equity:b.equity,unclosedPriorEarnings:b.unclosedPriorEarnings,currentYearEarnings:b.currentYearEarnings,
        totalAssets:b.totalAssets,totalLiabilities:b.totalLiabilities,totalEquity:b.totalEquity,balanced:b.balanced};}
      if(i.report==='general_ledger'){if(!i.account)bad('account is required for general_ledger');const x=L();if(!x.accounts[String(i.account)])bad(`account ${i.account} is not in your book`);
        const a=ledgerLib.gl(null,String(i.account),f,t).accounts[0]||{};
        return{account:a.code,name:a.name,from:f,to:t,opening:R(a.opening),debit:R(a.debit),credit:R(a.credit),closing:R(a.closing),
          rows:(a.rows||[]).map(r=>({date:r.date,id:r.id,number:r.number,description:r.description,memo:r.memo,debit:R(r.debit),credit:R(r.credit),running:R(r.running)}))};}
      bad('unknown report');}},
    list_journals:{label:()=>'Looked up journals',run(i){
      if(!seeded())bad('Your book is not set up yet (Settings › Your book)');
      const[f,t]=range(i,false),q=i.text?String(i.text).toLowerCase():null,lim=Math.max(1,Math.min(100,R(i.limit)||30));
      const all=(ledgerView('journals')||[]).filter(j=>inRange(j.date,f,t)&&(!i.status||j.status===i.status)&&(!i.kind||j.kind===i.kind)
        &&(!q||String(j.description||'').toLowerCase().includes(q)||String(j.number||'').toLowerCase().includes(q))).reverse();
      const out={count:all.length,rows:all.slice(0,lim).map(j=>({id:j.id,number:j.number,kind:j.kind,status:j.status,date:j.date,description:j.description,lines:j.lines.map(l=>({account:l.account,amount:R(l.amount),memo:l.memo||''}))}))};
      if(all.length>lim)out.truncated=true;return out;}},
    month_end:{label:i=>`Read month-end · ${mLong(i.month)}`,run(i){
      const M=String(i.month);if(!validMonth(M))bad('month must be YYYY-MM');if(!W())bad('Month-end needs the wealth snapshot or your book');
      const bi=meBookIdx(M),accs=meAccounts(M),started=!!(STATE.monthEnd||{})[M];
      const rows=accs.map(a=>{const p=mePosOf(M,a.id),s=meStmt(M,a.id),exp=meExpected(M,a.id,bi);
        return{account:a.id,name:a.name,ccy:a.ccy||'IDR',book:R(exp),entered:p?R(p.v):null,source:p?(p.src||'typed'):null,statement:s?R(s.v):null,difference:p?R(p.v-exp):null};});
      const j=meJournal(M),c=allCloses().find(x=>x.month===M);
      return{month:M,started,period:bookMonthState(M),accounts:rows,journal:{state:j.state,issues:j.issues},
        checklist:c?c.entries.map(e=>({id:e.id,memo:e.memo||'',posted:entryPosted(c,e),...(c.app&&e.id==='J'&&meOwn()?{fromBook:true}:{})})):[]};}},
    income_list:{label:i=>`Read income${i.month?' · '+mLong(i.month):''}`,run(i){
      if(i.month&&!validMonth(i.month))bad('month must be YYYY-MM');
      const own=incOwn(),ib=own?incBook():null;
      return{rows:incList().filter(x=>!i.month||x.date.slice(0,7)===i.month).map(x=>({id:x.id,date:x.date,payer:x.payer,amount:R(x.amount),account:x.account,incomeAccount:x.incomeAccount,note:x.note||'',posted:own?ib.has(x.id):!!x.posted}))};}},
    cash_movements:{label:i=>`Looked up cash movements · ${rangeLabel(...range(i,true))}`,run(i){
      const c=CM();if(!c)bad('No cash movements yet (Cash movements page)');
      const[f,t]=range(i,true),acc=i.account?String(i.account).toLowerCase():null;
      const rows=c.txns.filter(x=>inRange(x.date,f,t)&&(!acc||String(x.account).toLowerCase()===acc||String(cashLabel(x.account)).toLowerCase().includes(acc))&&(!i.type||cashType(x)===i.type))
        .sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id)));
      const by={};for(const x of rows){if((x.currency||'IDR')!=='IDR')continue;const m=x.date.slice(0,7),g=cashMeta(cashType(x)).g,r=by[m]||(by[m]={month:m,in:0,out:0,invest:0});
        if(g==='in')r.in+=x.amount;else if(g==='out')r.out-=x.amount;else if(g==='invest')r.invest-=x.amount;}
      return{from:f,to:t,count:rows.length,months:Object.values(by).sort((a,b)=>a.month.localeCompare(b.month)).map(r=>({month:r.month,in:R(r.in),out:R(r.out),invest:R(r.invest)})),
        rows:rows.map(x=>({id:x.id,date:x.date,account:cashLabel(x.account),amount:R(x.amount),...(x.currency&&x.currency!=='IDR'?{currency:x.currency}:{}),desc:x.desc||'',counterparty:x.counterparty||'',type:cashType(x)}))};}},
    statement_lines:{label:i=>`Looked up statement lines · ${rangeLabel(...range(i,true))}`,run(i){
      const c=CM();if(!c)bad('No statements yet (Cash movements page)');
      const[f,t]=range(i,true),used=usedStmtLines(),accs=new Map();
      const acc=id=>{if(!accs.has(id)){const ca=cashAcc(id);accs.set(id,{code:stmtCode(ca),label:String(ca.label||id)});}return accs.get(id);};
      const rows=c.txns.filter(x=>x&&x.id&&inRange(x.date,f,t)).map(x=>{const a=acc(x.account),o={id:String(x.id),account:a.code,statement:a.label,date:x.date,amount:R(x.amount)};
        if(x.currency&&x.currency!=='IDR')o.currency=x.currency;o.desc=String(x.desc||'');o.counterparty=String(x.counterparty||'');if(used.has(String(x.id)))o.inBook=true;return o;})
        .filter(o=>!i.account||o.account===String(i.account)).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
      return{from:f,to:t,count:rows.length,rows,__cap:400};}},
    net_worth:{label:()=>'Read net worth',run(i){
      if(!W())bad('Net worth needs the wealth snapshot or your book');
      const ms=wMonths(),n=Math.max(1,Math.min(24,R(i.months)||12)),from=Math.max(0,ms.length-n);
      return{rows:ms.slice(from).map((m,k)=>{const t=wTotals(from+k,'book');const g={};for(const[a,v]of Object.entries(t.groups))g[a]=R(v);return{month:m.month,assets:R(t.assets),liabilities:R(t.liab),net:R(t.net),groups:g};})};}}};

  /* ══ Action tools: validate against the live data, then queue (contract §4) ══ */
  const GROUPS=[['cat','Categories'],['note','Notes'],['budget','Budgets'],['goal','Goals'],['journal','Journals'],['income','Income'],['manual','Manual transactions'],
    ['card','Card paid-through'],['me','Month-end balances'],['cash','Cash movement types'],['tick','Checklist and SPT ticks']];
  const ORDER=['set_category','set_note','set_budget','save_goal','add_journal','add_income','add_manual_transaction','mark_card_paid','set_month_end_balance','set_cash_type','tick_checklist','set_declared'];
  const PAY_WITH=['Cash','Other','Maybank','BCA','OCBC','OCBC CC'];
  const lockMsg=m=>/\b(is|which is) (closed|locked)\b/.test(String(m||''));
  const voucherOf=i=>({date:i.date,description:String(i.description||'').slice(0,500),lines:i.lines.map(l=>{
    const o={account:String(l.account),amount:R(l.debit)-R(l.credit),memo:String(l.memo||'').slice(0,200)};if(l.fx)o.fx={ccy:String(l.fx.ccy||'').toUpperCase(),amount:Math.abs(+l.fx.amount),rate:+l.fx.rate};return o;})});
  function postableAcc(code,kinds){
    const x=L();if(!x)return'Your book is not set up yet (Settings › Your book)';
    const a=x.accounts[String(code)];if(!a)return`account ${code} is not in your book`;
    if(isHeader(a))return`${code} is a parent account (a header); use one of the accounts under it`;
    if(a.archivedAt)return`${code} is archived`;if(a.suspended)return`${code} is suspended`;
    if(kinds&&!kinds.includes(a.kind))return`${code} is a ${a.kind} account; it needs to be ${kinds.join(' or ')}`;
    return null;
  }
  // T[type]: norm(input) → normalised input (throws with the reason); make(input) → the item's
  // before/after/summary/target; apply(item) / changed(item) / undo(item) for Apply all and Undo all.
  const T={
    set_category:{g:'cat',
      norm(i){const tx=findTx(i.id);if(!tx)bad(`transaction ${i.id} not found`);const c=String(i.category||'').trim();if(!c)bad('category is empty');if(c.length>40&&!knownCats().includes(c))bad('a new category name has at most 40 characters');return{id:i.id,category:c};},
      make(i){const t=findTx(i.id);return{target:'cat:'+i.id,before:t.category||'Others',after:i.category,tx:{date:txDay(t),merchant:merchantOf(t),amount:t.amount==null?null:R(t.amount),month:monthKeyOf(txDateOf(t))},
        summary:`Category · ${merchantOf(t)} ${dayShort(txDay(t))} · ${t.category||'Others'} → ${i.category}`};},
      apply(it){const id=it.input.id,cat=it.after,ov=getCatOverrides(),u=it.u={had:has(ov,id),prev:ov[id],txs:[]};ov[id]=cat;
        const txs=[...new Set([(ALL_TRANSACTIONS||[]).find(t=>t.id===id),(ALL_TRANSACTIONS_RAW||[]).find(t=>t.id===id)].filter(Boolean))];
        if(txs[0]&&txs[0].category!==cat){const at=stamp(),e={id:`${id}@${at}`,tx:id,m:txs[0].merchantClean||'',raw:txs[0].merchantRaw||'',from:txs[0].category||'',to:cat,at,rule:false};
          STATE.catChangeLog=[...(STATE.catChangeLog||[]),e].slice(-CAT_LOG_MAX);u.log=e.id;}
        for(const t of txs){u.txs.push([t,t.category]);t.category=cat;}},
      changed:it=>getCatOverrides()[it.input.id]!==it.after,
      undo(it){const ov=getCatOverrides(),u=it.u;if(u.had)ov[it.input.id]=u.prev;else delete ov[it.input.id];
        if(u.log)STATE.catChangeLog=(STATE.catChangeLog||[]).filter(e=>e.id!==u.log);for(const[t,c]of u.txs)if(t.category===it.after)t.category=c;}},
    set_note:{g:'note',
      norm(i){if(!findTx(i.transaction_id))bad(`transaction ${i.transaction_id} not found`);const n=String(i.note||'').trim();if(n.length>200)bad('a note has at most 200 characters');return{id:i.transaction_id,note:n};},
      make(i){const t=findTx(i.id),cur=has(STATE.notes,i.id)?STATE.notes[i.id]:(t.note||'');
        return{target:'note:'+i.id,before:cur||'',after:i.note,tx:{date:txDay(t),merchant:merchantOf(t),amount:t.amount==null?null:R(t.amount)},summary:`Note · ${merchantOf(t)} ${dayShort(txDay(t))} · ${i.note?'“'+i.note.slice(0,60)+'”':'cleared'}`};},
      apply(it){const n=getNotes(),id=it.input.id,u=it.u={had:has(n,id),prev:n[id],txs:[]};if(it.after)n[id]=it.after;else delete n[id];
        for(const t of new Set([(ALL_TRANSACTIONS||[]).find(t=>t.id===id),(ALL_TRANSACTIONS_RAW||[]).find(t=>t.id===id)].filter(Boolean))){u.txs.push([t,t.note]);t.note=it.after||undefined;}},
      changed:it=>(getNotes()[it.input.id]||'')!==(it.after||''),
      undo(it){const n=getNotes(),u=it.u;if(u.had)n[it.input.id]=u.prev;else delete n[it.input.id];for(const[t,v]of u.txs)t.note=v;}},
    set_budget:{g:'budget',
      norm(i){const c=String(i.category||'').trim();if(!c)bad('category is empty');if(!(Number.isInteger(i.monthly)&&i.monthly>0))bad('the monthly budget must be a whole amount above 0');return{category:c,monthly:i.monthly};},
      make(i){const b=(STATE.budgets||{})[i.category],cur=b&&!b.deleted&&b.monthly>0?R(b.monthly):null;
        return{target:'budget:'+i.category,before:cur,after:i.monthly,summary:`Budget · ${i.category} · ${cur?fmtIDR(cur):'none'} → ${fmtIDR(i.monthly)}`};},
      apply(it){const b=STATE.budgets||(STATE.budgets={}),c=it.input.category,prev=b[c],at=stamp();it.u={prev:clone(prev),at};
        b[c]={monthly:it.input.monthly,since:(prev&&!prev.deleted&&prev.since)||thisMonth(),at};},
      changed:it=>{const b=(STATE.budgets||{})[it.input.category];return!b||b.at!==it.u.at||b.monthly!==it.input.monthly;},
      undo(it){const b=STATE.budgets||(STATE.budgets={});b[it.input.category]=it.u.prev?{...it.u.prev,at:stamp()}:{deleted:true,at:stamp()};}},
    save_goal:{g:'goal',
      norm(i){if(!W())bad('Goals need the wealth snapshot or your book');
        const name=String(i.name||'').trim().slice(0,60);if(!name)bad('name is empty');if(!['networth','liquid','saving','account'].includes(i.kind))bad('unknown goal kind');
        if(!(Number.isInteger(i.target)&&i.target>0))bad('target must be a whole amount above 0');if(!validMonth(i.by))bad('by must be YYYY-MM');
        const accounts=i.kind==='account'?[...new Set((i.accounts||[]).map(String))]:[];
        if(i.kind==='account'){if(!accounts.length)bad('a goal on chosen accounts needs at least one account');const miss=accounts.filter(a=>!wAcc(a));if(miss.length)bad(`account ${miss[0]} not found`);}
        if(i.goal_id!=null&&!goalsLive().some(g=>g.id===i.goal_id))bad(`goal ${i.goal_id} not found`);
        return{goal_id:i.goal_id==null?null:String(i.goal_id),name,kind:i.kind,target:i.target,by:i.by,accounts};},
      make(i){const old=i.goal_id?goalsLive().find(g=>g.id===i.goal_id):null;
        return{target:'goal:'+(i.goal_id||'new:'+i.name.toLowerCase()),before:old?{name:old.name,target:R(old.target),by:old.by}:null,after:{name:i.name,target:i.target,by:i.by},
          summary:old?`Goal · ${old.name} · ${fmtIDR(old.target)} by ${old.by} → ${fmtIDR(i.target)} by ${i.by}`:`New goal · ${i.name} · ${fmtIDR(i.target)} by ${i.by}`};},
      goalOf(i,old){return{id:old?old.id:'new',name:i.name,kind:i.kind,target:i.target,by:i.by,...(i.kind==='account'?{accounts:i.accounts}:{}),since:old&&old.since?old.since:thisMonth(),at:stamp()};},
      apply(it){const list=Array.isArray(STATE.goals)?STATE.goals:(STATE.goals=[]),i=it.input,old=i.goal_id?list.find(g=>g.id===i.goal_id&&!g.deleted):null;
        const g=T.save_goal.goalOf(i,old);if(!old)g.id='g'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
        it.u={id:g.id,old:clone(old),at:g.at};it.ref=g.id;if(old)list[list.indexOf(old)]=g;else list.push(g);},
      changed:it=>{const g=(STATE.goals||[]).find(x=>x.id===it.u.id);return!g||g.at!==it.u.at;},
      undo(it){const l=STATE.goals||[],j=l.findIndex(x=>x.id===it.u.id);if(j<0)return;l[j]=it.u.old?{...it.u.old,at:stamp()}:{id:it.u.id,deleted:true,at:stamp()};}},
    add_journal:{g:'journal',
      norm(i){if(!seeded())bad('Your book is not set up yet (Settings › Your book)');
        if(!validDate(i.date))bad('date must be YYYY-MM-DD');const d=String(i.description||'').trim();if(!d)bad('description is empty');
        if(!Array.isArray(i.lines)||i.lines.length<2)bad('a journal needs at least two lines');
        i.lines.forEach((l,k)=>{if(!(Number.isInteger(l.debit)&&l.debit>=0&&Number.isInteger(l.credit)&&l.credit>=0))bad(`line ${k+1}: debit and credit are whole amounts of 0 or more`);
          if(l.debit&&l.credit)bad(`line ${k+1}: enter either a debit or a credit, not both`);});
        const n={date:i.date,description:d.slice(0,500),lines:i.lines.map(l=>({account:String(l.account).trim(),debit:l.debit,credit:l.credit,memo:String(l.memo||'').slice(0,200),fx:l.fx?{ccy:String(l.fx.ccy||'').toUpperCase(),amount:l.fx.amount,rate:l.fx.rate}:null}))};
        const errs=ledgerValidate(voucherOf(n));if(errs.length)bad(errs.join('; '));return n;},
      make(i){const dr=i.lines.reduce((s,l)=>s+l.debit,0);return{target:'journal:'+Math.random().toString(36).slice(2,9),before:null,after:{total:dr},summary:`Journal · ${dayShort(i.date)} · ${i.description} · ${fmtIDR(dr)}`};},
      apply(it,set){const id=ledgerPost({...voucherOf(it.input),prompt:String(set.text||'').slice(0,2000),batch:'as-'+set.id},{kind:'ai',why:'Ask Claude'});
        const v=L().vouchers[id];it.u={id,updatedAt:v.updatedAt};it.ref=id;it.number=v.number;},
      changed:it=>{const v=(L()||{vouchers:{}}).vouchers[it.u.id];return!v||v.status!=='posted'||v.updatedAt!==it.u.updatedAt;},
      undo(it){ledgerVoid(it.u.id,UNDO_WHY);}},
    add_income:{g:'income',
      norm(i){if(!W()&&!seeded())bad('Income needs the wealth snapshot or your book');
        if(!validDate(i.date))bad('date must be YYYY-MM-DD');const payer=meText(i.payer,60);if(!payer)bad('payer is empty');
        if(!(Number.isInteger(i.amount)&&i.amount>0))bad('amount must be a whole amount above 0');
        const into=String(i.into_account||'').trim(),inc=String(i.income_account||'').trim();
        if(seeded()){const e1=postableAcc(into,['asset']);if(e1)bad(e1);const e2=postableAcc(inc,['income']);if(e2)bad(e2);}
        else{if(!incIntoAccounts().some(a=>a.id===into))bad(`account ${into} can't take income`);if(!meLedger().some(l=>l.id===inc&&l.kind==='income'))bad(`${inc} is not an income account`);}
        const M=i.date.slice(0,7),st=bookMonthState(M);if(st!=='open')bad(`${mLong(M)} is ${st}; reopen it in Books › Periods to post into it`);
        return{date:i.date,payer,amount:i.amount,account:into,incomeAccount:inc,note:meText(i.note,60)};},
      make(i){return{target:'income:'+Math.random().toString(36).slice(2,9),before:null,after:{amount:i.amount},summary:`Income · ${dayShort(i.date)} · ${i.payer} · ${fmtIDR(i.amount)} into ${i.account}`};},
      apply(it){const s=incStore(),id='inc-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),i=it.input;
        const x={id,date:i.date,payer:i.payer,amount:i.amount,account:i.account,incomeAccount:i.incomeAccount,note:i.note,at:stamp()};
        s[id]=x;it.u={id};it.ref=id;
        if(incOwn()){try{incPostOne(x);}catch(e){delete s[id];throw e;}const v=L().vouchers[x.postedId];it.number=v&&v.number;it.u.vid=x.postedId;}
        it.u.at=x.at;},
      changed:it=>{const x=(STATE.income||{})[it.u.id];return!x||x.deleted||x.at!==it.u.at;},
      undo(it){const s=incStore();if(it.u.vid){const v=L()&&L().vouchers[it.u.vid];if(v&&v.status==='posted')ledgerVoid(it.u.vid,UNDO_WHY);}s[it.u.id]={id:it.u.id,deleted:true,at:stamp()};}},
    add_manual_transaction:{g:'manual',
      norm(i){if(!validDate(i.date))bad('date must be YYYY-MM-DD');const m=String(i.merchant||'').trim().slice(0,80);if(!m)bad('merchant is empty');
        if(!(Number.isInteger(i.amount)&&i.amount>0))bad('amount must be a whole amount above 0');const c=String(i.category||'').trim()||'Others';if(c.length>40&&!knownCats().includes(c))bad('a new category name has at most 40 characters');
        const p=PAY_WITH.find(x=>x.toLowerCase()===String(i.paid_with||'').trim().toLowerCase())||(cardOf(i.paid_with)||{}).key;if(!p)bad(`paid_with must be one of ${PAY_WITH.join(', ')}`);
        return{date:i.date,merchant:m,amount:i.amount,category:c,paid_with:p,note:String(i.note||'').trim().slice(0,200)};},
      make(i){return{target:'manual:'+Math.random().toString(36).slice(2,9),before:null,after:{amount:i.amount},summary:`Manual transaction · ${dayShort(i.date)} · ${i.merchant} · ${fmtIDR(i.amount)} · ${i.category}`};},
      apply(it){const i=it.input,id='manual_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
        const tx={id,merchantRaw:i.merchant,merchantClean:i.merchant,category:i.category,bank:(i.paid_with==='Cash'||i.paid_with==='Other')?'Manual':i.paid_with,
          amount:i.amount,amountStr:'IDR '+i.amount.toLocaleString('id-ID'),status:'Approved',txDate:i.date,msgDate:i.date,type:'transaction',note:i.note||undefined,manual:true,manualBank:i.paid_with};
        getManualTxns().push(tx);if(i.note)getNotes()[id]=i.note;ALL_TRANSACTIONS.push(tx);ALL_TRANSACTIONS.sort(sortByDateDesc);
        it.u={id,json:JSON.stringify(tx)};it.ref=id;},
      changed:it=>{const m=getManualTxns().find(t=>t.id===it.u.id);return!m||JSON.stringify(m)!==it.u.json;},
      undo(it){const id=it.u.id,ms=getManualTxns(),k=ms.findIndex(t=>t.id===id);if(k>=0)ms.splice(k,1);
        const n=getNotes();if(it.input.note&&n[id]===it.input.note)delete n[id];ALL_TRANSACTIONS=ALL_TRANSACTIONS.filter(t=>t.id!==id);}},
    mark_card_paid:{g:'card',
      norm(i){const c=cardOf(i.card);if(!c)bad(`card ${i.card} is not one of ${CC_CARDS.map(x=>x.key).join(', ')}`);if(!validDate(i.date))bad('date must be YYYY-MM-DD');
        if(i.time!=null&&i.time!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(i.time))bad('time must be HH:MM');
        return{card:c.key,date:i.date,time:i.time||'',note:String(i.note||'').trim().slice(0,120)};},
      dt:i=>i.time?`${i.date}T${i.time}:00`:`${i.date}T23:59:59`,
      make(i){const st=ccState(i.card),c=cardOf(i.card);return{target:'card:'+i.card,before:st.lastPayment?st.lastPayment.date:null,after:T.mark_card_paid.dt(i),
        summary:`Card paid-through · ${c.label} · ${st.lastPayment?fmtDateTime(st.lastPayment.date):'none'} → ${fmtDateTime(T.mark_card_paid.dt(i))}`};},
      apply(it){const i=it.input,p={id:'ccp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),date:T.mark_card_paid.dt(i),note:i.note,card:i.card};
        const a=getCCPayments();a.push(p);a.sort((x,y)=>new Date(x.date)-new Date(y.date));it.u={id:p.id,json:JSON.stringify(p)};it.ref=p.id;},
      changed:it=>{const p=getCCPayments().find(x=>x.id===it.u.id);return!p||JSON.stringify(p)!==it.u.json;},
      undo(it){const a=getCCPayments(),k=a.findIndex(x=>x.id===it.u.id);if(k>=0)a.splice(k,1);}},
    set_month_end_balance:{g:'me',
      norm(i){const M=String(i.month||'');if(!validMonth(M))bad('month must be YYYY-MM');if(!W())bad('Month-end needs the wealth snapshot or your book');
        const a=meAccounts(M).find(x=>x.id===String(i.account));if(!a)bad(`account ${i.account} is not on the ${mLong(M)} list`);
        if(bookMonthState(M)==='locked')bad(`${mLong(M)} is locked; unlock it in Books › Periods first`);
        if(!Number.isInteger(i.amount))bad('amount must be whole rupiah');
        let fx=null;if(i.fx){if(!(+i.fx.amount>=0&&+i.fx.rate>0))bad('fx needs an amount and a rate above 0');fx={amt:+i.fx.amount,rate:+i.fx.rate};}
        else if((a.ccy||'IDR')!=='IDR')bad(`${a.id} is a ${a.ccy} account: give fx with the ${a.ccy} amount and the rate`);
        return{month:M,account:a.id,amount:fx?R(fx.amt*fx.rate):i.amount,fx};},
      make(i){const p=mePosOf(i.month,i.account);return{target:`me:${i.month}:${i.account}`,before:p?R(p.v):null,after:i.amount,
        summary:`Month-end · ${mLong(i.month)} · ${accName(i.account)} · ${p?fmtIDR(p.v):'empty'} → ${fmtIDR(i.amount)}`};},
      apply(it){const i=it.input,s=meStore(),created=!s[i.month];if(created)s[i.month]={pos:{},market:{},startedAt:stamp()};
        const st=meClose0(i.month),prev=st.pos[i.account],at=stamp();it.u={created,had:has(st.pos,i.account),prev:clone(prev),at};
        st.pos[i.account]={v:i.amount,...(i.fx?{fx:{...i.fx}}:{}),src:'typed',at};},
      changed:it=>{const st=meClose0(it.input.month),p=st&&st.pos[it.input.account];return!p||p.at!==it.u.at;},
      undo(it){const st=meClose0(it.input.month);if(!st)return;st.pos[it.input.account]=it.u.had?{...it.u.prev,at:stamp()}:{v:null,src:'typed',at:stamp()};}},
    set_cash_type:{g:'cash',
      norm(i){const t=CM()?cashTx(i.cash_id):null;if(!t)bad(`cash line ${i.cash_id} not found`);if(!CASH_TYPES[i.type])bad('unknown cash type');return{id:i.cash_id,type:i.type};},
      make(i){const t=cashTx(i.id),cur=cashType(t);return{target:'cash:'+i.id,before:cur,after:i.type,line:{date:t.date,desc:t.desc||t.counterparty||'',amount:R(t.amount),month:t.date.slice(0,7)},
        summary:`Cash type · ${dayShort(t.date)} ${t.desc||t.counterparty||''} · ${cashMeta(cur).label} → ${cashMeta(i.type).label}`};},
      value(i){const t=cashTx(i.id),pr=STATE.cashPayerRules||{};return i.type===(pr[cashPayerKey(t)]||t.type)?null:i.type;},
      apply(it){const ov=STATE.cashTypeOverrides||(STATE.cashTypeOverrides={}),v=T.set_cash_type.value(it.input);it.u={prev:ov[it.input.id]||null,v};ov[it.input.id]=v;},
      changed:it=>((STATE.cashTypeOverrides||{})[it.input.id]||null)!==it.u.v,
      undo(it){(STATE.cashTypeOverrides||(STATE.cashTypeOverrides={}))[it.input.id]=it.u.prev;}},
    tick_checklist:{g:'tick',
      norm(i){const M=String(i.month||'');if(!validMonth(M))bad('month must be YYYY-MM');if(!W())bad('The checklist needs the wealth snapshot or your book');
        const c=allCloses().find(x=>x.month===M);const e=c&&c.entries.find(x=>x.id===String(i.entry_id));if(!e)bad(`entry ${i.entry_id} is not on the ${mLong(M)} checklist`);
        if(c.app&&e.id==='J'&&meOwn())bad('The app journal J is ticked by your book itself: it counts as posted once it is posted there');
        return{month:M,entry:e.id,posted:!!i.posted};},
      cur(i){const c=allCloses().find(x=>x.month===i.month),e=c.entries.find(x=>x.id===i.entry);return entryPosted(c,e);},
      make(i){const b=T.tick_checklist.cur(i);return{target:`tick:${i.month}:${i.entry}`,before:b,after:i.posted,summary:`Checklist · ${mLong(i.month)} · entry ${i.entry} · ${b?'posted':'not posted'} → ${i.posted?'posted':'not posted'}`};},
      apply(it){const t=STATE.closeTicks||(STATE.closeTicks={}),m=t[it.input.month]||(t[it.input.month]={});it.u={had:has(m,it.input.entry),prev:m[it.input.entry]};m[it.input.entry]=it.input.posted;},
      changed:it=>((STATE.closeTicks||{})[it.input.month]||{})[it.input.entry]!==it.input.posted,
      undo(it){const m=(STATE.closeTicks||{})[it.input.month];if(!m)return;if(it.u.had)m[it.input.entry]=it.u.prev;else delete m[it.input.entry];}},
    set_declared:{g:'tick',
      norm(i){if(!W()||!wAcc(String(i.account)))bad(`account ${i.account} not found`);return{account:String(i.account),declared:!!i.declared};},
      make(i){const b=!!(STATE.declared||{})[i.account];return{target:'declared:'+i.account,before:b,after:i.declared,summary:`SPT · ${accName(i.account)} · ${b?'declared':'not declared'} → ${i.declared?'declared':'not declared'}`};},
      apply(it){const d=STATE.declared||(STATE.declared={});it.u={had:has(d,it.input.account),prev:d[it.input.account]};d[it.input.account]=it.input.declared;},
      changed:it=>!!(STATE.declared||{})[it.input.account]!==it.input.declared,
      undo(it){const d=STATE.declared||(STATE.declared={});if(it.u.had)d[it.input.account]=it.u.prev;else delete d[it.input.account];}}};
  // set_category's tool input is a list; each id becomes its own item.
  function propose(name,input,set){
    if(name==='set_category'){
      const ids=input.transaction_ids;if(!ids.length)bad('transaction_ids is empty');if(ids.length>200)bad('at most 200 transactions at once');
      const cat=String(input.category||'').trim();if(!cat)bad('category is empty');if(cat.length>40&&!knownCats().includes(cat))bad('a new category name has at most 40 characters');
      const miss=ids.filter(id=>!findTx(id));if(miss.length)bad(`transaction ${miss[0]} not found${miss.length>1?` (and ${miss.length-1} more)`:''}`);
      const uniq=[...new Set(ids)],same=uniq.filter(id=>(findTx(id).category||'Others')===cat&&!set.items.some(x=>x.target==='cat:'+id));
      const todo=uniq.filter(id=>!same.includes(id));
      if(set.items.filter(x=>!todo.some(id=>x.target==='cat:'+id)).length+todo.length>MAX_ITEMS)bad(`a change set holds at most ${MAX_ITEMS} changes`);
      const items=todo.map(id=>queue(set,'set_category',T.set_category.norm({id,category:cat})));
      return{items,extra:same.length?{unchanged:same}:{}};
    }
    const n=T[name].norm(input),it=queue(set,name,n,true);return{items:[it],extra:{}};
  }
  function queue(set,type,input,checkCap){
    const m=T[type].make(input),it={no:++set.seq,type,input,ticked:true,blocked:null,...m};
    const k=set.items.findIndex(x=>x.target===it.target);
    if(k>=0)set.items[k]=it;else{if(checkCap&&set.items.length>=MAX_ITEMS)bad(`a change set holds at most ${MAX_ITEMS} changes`);set.items.push(it);}
    set.touched=true;return it;
  }
  function recheck(it){try{T[it.type].norm(it.type==='set_category'?{id:it.input.id,category:it.input.category}:rawOf(it));return null;}catch(e){return String(e&&e.message||e);}}
  // The normalised input back in the tool's shape, for a re-check against the live data.
  function rawOf(it){const i=it.input;
    switch(it.type){
      case'set_note':return{transaction_id:i.id,note:i.note};
      case'add_income':return{date:i.date,payer:i.payer,amount:i.amount,into_account:i.account,income_account:i.incomeAccount,note:i.note};
      case'set_month_end_balance':return{month:i.month,account:i.account,amount:i.amount,fx:i.fx?{amount:i.fx.amt,rate:i.fx.rate}:null};
      case'set_cash_type':return{cash_id:i.id,type:i.type};
      case'tick_checklist':return{month:i.month,entry_id:i.entry,posted:i.posted};
      default:return i;}
  }

  /* ══ Everything affected: simulated on copies of only the slice involved (contract §5) ══ */
  function affectedOf(items){
    const out=[],add=(key,label,before,after,fmt,warn,keep)=>{if(before===after&&fmt!=='text'&&!keep)return;out.push({key,label,before,after,fmt,warn:warn==null?moved(before,after,fmt):warn});};
    const by=t=>items.filter(i=>i.type===t);
    // Categories and manual transactions: each affected category per affected month; budgets this month.
    const cats=by('set_category'),mans=by('add_manual_transaction'),buds=by('set_budget');
    const cm=thisMonth(),delta={},months=new Set(),touched=new Set();
    const bump=(m,c,v)=>{const k=m+'|'+c;delta[k]=(delta[k]||0)+v;months.add(m);touched.add(c);};
    for(const it of cats){const t=findTx(it.input.id);if(!t||!(t.amount>0))continue;const m=monthKeyOf(txDateOf(t));bump(m,it.before,-t.amount);bump(m,it.after,t.amount);}
    for(const it of mans){const d=new Date(it.input.date);bump(monthKeyOf(isNaN(d)?new Date(it.input.date+'T00:00:00'):d),it.input.category,it.input.amount);}
    if(months.size){
      const base={};for(const t of ALL_TRANSACTIONS||[]){if(!(t.amount>0))continue;const m=monthKeyOf(txDateOf(t));if(!months.has(m))continue;const c=t.category||'Others';if(!touched.has(c))continue;base[m+'|'+c]=(base[m+'|'+c]||0)+t.amount;}
      for(const k of Object.keys(delta).sort()){if(!R(delta[k]))continue;const[m,c]=k.split('|'),b=R(base[k]||0);add('cat:'+k,`${monthLabel(m).replace(/ \d{4}$/,'')} ${c}`,b,b+R(delta[k]),'money');}
    }
    const budCats=new Set([...buds.map(i=>i.input.category),...[...touched].filter(c=>months.has(cm))]);
    if(budCats.size){
      let spent={};try{spent=EXTRAS.spentIn(cm,new Date());}catch(_){}
      for(const c of budCats){
        const rec=(STATE.budgets||{})[c],cur=rec&&!rec.deleted&&rec.monthly>0?R(rec.monthly):null,bi=buds.find(i=>i.input.category===c),nb=bi?bi.input.monthly:cur;
        if(nb==null)continue;
        const s0=R(spent[c]||0),s1=s0+R(delta[cm+'|'+c]||0);
        if(bi)add('budamt:'+c,`${c} budget`,cur,nb,'money',false);
        if(s1!==s0)add('budspent:'+c,`${c} spent this month`,s0,s1,'money',false);
        const p0=cur?s0/cur*100:null,p1=s1/nb*100;
        out.push({key:'bud:'+c,label:`${c} budget used this month`,before:p0,after:p1,fmt:'pct',warn:p1>100&&!(p0>100),over:p1>100});
      }
    }
    // Goals: target, by-date and the monthly amount required.
    for(const it of by('save_goal')){
      const i=it.input,old=i.goal_id?goalsLive().find(g=>g.id===i.goal_id):null,ng=T.save_goal.goalOf(i,old);
      const c0=old?EXTRAS.goalCalc(old):null,c1=W()?EXTRAS.goalCalc(ng):null;
      add('goalt:'+it.target,`${i.name} target`,old?R(old.target):null,i.target,'money',false);
      if(!old||old.by!==i.by)out.push({key:'goalb:'+it.target,label:`${i.name} by`,before:old?mLong(old.by):null,after:mLong(i.by),fmt:'text'});
      if(c1)add('goalr:'+it.target,`${i.name} needed per month`,c0?R(c0.required):null,R(c1.required),'money',false);
    }
    // Journals and income: the balance of each account touched.
    const bal={},inc=by('add_income');
    for(const it of by('add_journal'))for(const l of voucherOf(it.input).lines)bal[l.account]=(bal[l.account]||0)+l.amount;
    if(seeded())for(const it of inc){bal[it.input.account]=(bal[it.input.account]||0)+it.input.amount;bal[it.input.incomeAccount]=(bal[it.input.incomeAccount]||0)-it.input.amount;}
    if(Object.keys(bal).length){const tb=tbMap();for(const code of Object.keys(bal).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){const b=R(tb[code]||0);add('bal:'+code,`${code} · ${accName(code)}`,b,b+R(bal[code]),'money');}}
    if(!seeded()&&inc.length){const per={};for(const it of inc){const m=it.input.date.slice(0,7);per[m]=(per[m]||0)+it.input.amount;}
      for(const m of Object.keys(per)){const b=R(incList().filter(x=>x.date.slice(0,7)===m).reduce((s,x)=>s+x.amount,0));add('inc:'+m,`Income ${mLong(m)}`,b,b+per[m],'money');}}
    // Card paid-through: the card's current outstanding.
    for(const it of by('mark_card_paid')){
      const st=ccState(it.input.card),ex=getCCPosExcluded(),nd=new Date(T.mark_card_paid.dt(it.input)),last=st.lastPayDate&&st.lastPayDate>nd?st.lastPayDate:nd;
      const after=st.all.filter(t=>txDateOf(t)>last&&!ex.has(t.id)).reduce((s,t)=>s+ccGross(t),0);
      add('card:'+it.input.card,`${cardOf(it.input.card).label} outstanding`,R(st.balance),R(after),'money');
    }
    // Month-end balance: that account's difference to the book.
    for(const it of by('set_month_end_balance')){const i=it.input,bi=meBookIdx(i.month),exp=meExpected(i.month,i.account,bi),p=mePosOf(i.month,i.account);
      add(`me:${i.month}:${i.account}`,`${accName(i.account)} difference to book · ${monthLabel(i.month)}`,p?R(p.v-exp):null,R(i.amount-exp),'money',false);}
    // Cash type: that month's in, out and invest totals.
    const cash=by('set_cash_type');
    if(cash.length){const ov={};for(const it of cash)ov[it.input.id]=it.input.type;
      const ms=[...new Set(cash.map(it=>(cashTx(it.input.id)||{date:''}).date.slice(0,7)).filter(Boolean))].sort();
      for(const m of ms){const b=cashTotals(m),a={in:0,out:0,invest:0};
        for(const t of cashMonthTxns(m)){if(t.currency!=='IDR')continue;const g=cashMeta(ov[t.id]||cashType(t)).g;if(g==='in')a.in+=t.amount;else if(g==='out')a.out-=t.amount;else if(g==='invest')a.invest-=t.amount;}
        for(const[k,l]of[['in','money in'],['out','money out'],['invest','into investments']])add(`cash:${m}:${k}`,`${monthLabel(m)} ${l}`,R(b[k]),R(a[k]),'money',null,true);}}
    // Ticks: the checklist step's state.
    for(const it of by('tick_checklist'))out.push({key:it.target,label:`${monthLabel(it.input.month)} checklist entry ${it.input.entry}`,before:it.before?'Posted':'Not posted',after:it.after?'Posted':'Not posted',fmt:'text'});
    for(const it of by('set_declared'))out.push({key:it.target,label:`${accName(it.input.account)} in the SPT`,before:it.before?'Declared':'Not declared',after:it.after?'Declared':'Not declared',fmt:'text'});
    return out;
  }
  function moved(b,a,fmt){if(fmt!=='money'||a==null)return false;if(!b)return!!a;return Math.abs(a-b)/Math.abs(b)>0.2;}
  const affJSON=lines=>lines.map(l=>({label:l.label,before:l.fmt==='pct'&&l.before!=null?Math.round(l.before):l.before,after:l.fmt==='pct'?Math.round(l.after):l.after,...(l.fmt==='pct'?{unit:'%'}:{}),...(l.warn?{warn:true}:{})}));

  /* ══ The chat (this tab only; nothing saved) ══ */
  let CHAT=newChat(),SET=null,SEQ=0;
  function newChat(){return{msgs:[],view:[],busy:false,ctl:null,lastText:'',firstText:''};}
  const newSet=()=>({id:Date.now().toString(36)+(++SEQ),items:[],seq:0,summary:'',text:'',touched:false});
  const UI={open:false,el:null};

  function firstTurn(text){
    const tab=ACTIVE_TAB,f={};let page=tab;
    if(tab==='cards'){page=`cards › ${CARDS_SUB}`;f.card=CCP_CARD;}
    if(tab==='overview'||tab==='spending'){const b=getRangeBounds(ACTIVE_RANGE);f.period=periodLabel();if(b){f.from=isoDay(b[0]);f.to=isoDay(b[1]);}
      f.bank=ACTIVE_BANK;f.categories=[...ACTIVE_CATEGORIES];if(ACTIVE_MERCHANT)f.merchant=ACTIVE_MERCHANT;}
    if(tab==='close'&&typeof CLOSE_SEL!=='undefined'&&CLOSE_SEL)f.month=CLOSE_SEL;
    if(tab==='income'&&typeof INC_MONTH!=='undefined'&&INC_MONTH)f.month=INC_MONTH;
    return{today:todayISO(),page,filters:f,baseCurrency:'IDR',text:String(text)};
  }
  function request(){
    return{model:etAI.model(),max_tokens:16000,system:[{type:'text',text:SYSTEM,cache_control:{type:'ephemeral'}}],tools:toolsForRequest(),
      tool_choice:{type:'auto'},output_config:{effort:'medium'},messages:CHAT.msgs};
  }
  function aiErr(kind,msg){const e=new Error(msg);e.kind=kind;return e;}
  async function runTool(b,set,looks){
    const name=b.name;let input=b.input;
    const res=(content,isErr)=>({type:'tool_result',tool_use_id:b.id,content,...(isErr?{is_error:true}:{})});
    try{
      if(typeof input==='string')input=JSON.parse(input);
      if(!TOOL_NAMES.includes(name))return res(`There is no tool named ${name}.`,true);
      const sch=TOOLS.find(t=>t.name===name).input_schema,e=checkSchema(input==null?{}:input,sch,'');if(e)return res(e,true);
      input=input||{};
      if(LOOK[name]){let label='';try{label=LOOK[name].label(input);}catch(_){label='Looked something up';}
        const out=LOOK[name].run(input);looks.push(label);CHAT.view.push({t:'look',label});render();return res(capped(out));}
      if(name==='navigate'){const label=navigate(input);CHAT.view.push({t:'nav',label});render();return res(JSON.stringify({opened:label}));}
      const r=propose(name,input,set);
      const aff=affJSON(affectedOf(r.items));
      return res(capped({queued:r.items.length===1?r.items[0].no:r.items.map(i=>i.no),summary:r.items.length===1?r.items[0].summary:r.items.length?`Category · ${r.items.length} transactions → ${input.category}`:'Nothing to change',affected:aff,...r.extra}));
    }catch(e){return res(String(e&&e.toolErr?e.message:'That didn’t work: '+(e&&e.message||e)).slice(0,500),true);}
  }
  async function send(text){
    text=String(text||'').trim();if(!text||CHAT.busy)return;
    if(!etAI.state().hasKey){render();return;}
    const snap=CHAT.msgs.length,first=!snap;
    CHAT.msgs.push({role:'user',content:first?JSON.stringify(firstTurn(text)):text});
    if(!CHAT.firstText)CHAT.firstText=text;CHAT.lastText=text;
    CHAT.view.push({t:'you',text});
    const pending=SET&&!SET.applied?clone(SET):newSet();pending.touched=false;if(!pending.text)pending.text=text.slice(0,200);
    const looks=[],ctl=new AbortController();CHAT.busy=true;CHAT.ctl=ctl;render();
    let reply='';
    try{
      for(let n=0;;n++){
        if(n>=MAX_REQ)throw aiErr('steps','This needed too many steps — try a narrower request.');
        const data=await etAI.call(request(),TIMEOUT,ctl.signal);
        const content=Array.isArray(data.content)?data.content:[];
        CHAT.msgs.push({role:'assistant',content});
        const sr=data.stop_reason;
        if(sr==='refusal')throw aiErr('refusal','Claude declined this one.');
        if(sr==='max_tokens')throw aiErr('cut','Claude’s answer was cut off before it finished.');
        const txt=content.filter(c=>c&&c.type==='text'&&c.text).map(c=>c.text).join('\n').trim();
        if(txt){reply=txt;CHAT.view.push({t:'claude',text:txt});render();}
        if(sr==='tool_use'){
          const results=[];for(const b of content)if(b&&b.type==='tool_use')results.push(await runTool(b,pending,looks));
          if(!results.length)break;
          CHAT.msgs.push({role:'user',content:results});continue;
        }
        if(sr==='pause_turn')continue;
        break;
      }
      if(pending.touched){
        pending.items.sort((a,b)=>a.no-b.no);pending.summary=(reply.split('\n').find(l=>l.trim())||'').replace(/[*_#`>]/g,'').trim().slice(0,200);
        CHAT.view=CHAT.view.filter(v=>!(v.t==='set'&&v.set===SET));
        SET=pending.items.length?pending:null;if(SET)CHAT.view.push({t:'set',set:SET});
      }
    }catch(e){
      // A failed turn leaves the conversation as it was before it and drops the set it was building.
      CHAT.msgs.length=snap;
      const kind=e&&e.kind||'error',msg=e&&e.message?String(e.message):'Something went wrong.';
      CHAT.view.push(kind==='aborted'?{t:'note',tone:'info',text:'Stopped. Nothing was changed.'}:{t:'err',kind,text:msg,retry:text});
    }finally{CHAT.busy=false;CHAT.ctl=null;render(true);}
  }
  function stop(){if(CHAT.ctl)CHAT.ctl.abort();}

  /* ── navigate (runs at once; no data changes) ── */
  function navigate(i){
    const k=String(i.page||'').trim();if(!pageKeys().includes(k))bad(`there is no page ${k}`);
    const parts=[pageLabel(k)];
    const go=()=>{if(typeof closeAllSheets==='function')closeAllSheets();if(ACTIVE_TAB===k)renderAll();else setTab(k);};
    if(k==='overview'||k==='spending'){
      let f=null,t=null;if(i.month){if(!validMonth(i.month))bad('month must be YYYY-MM');f=i.month+'-01';t=monthEnd(i.month);}
      else if(i.from||i.to){[f,t]=range(i,true);}
      if(f){CUSTOM_FROM=f;CUSTOM_TO=t;ACTIVE_RANGE='custom';parts.push(rangeLabel(f,t));}
      if(f||i.category||i.merchant||i.bank){ACTIVE_CATEGORIES=new Set(i.category?[String(i.category)]:[]);ACTIVE_MERCHANT=i.merchant?String(i.merchant):null;if(i.bank)ACTIVE_BANK=String(i.bank);}
      if(i.category)parts.push(String(i.category));if(i.merchant)parts.push(String(i.merchant));if(i.bank)parts.push(String(i.bank));
      TX_LIMIT=50;go();
    }else if(k==='cards'){
      if(i.cards_view)CARDS_SUB=i.cards_view;if(i.card){const c=cardOf(i.card);if(!c)bad(`card ${i.card} is not one of ${CC_CARDS.map(x=>x.key).join(', ')}`);CCP_CARD=c.key;parts.push(c.label);}
      parts.push({current:'Current cycle',history:'History',fx:'Foreign currency'}[CARDS_SUB]||CARDS_SUB);go();
    }else if(k==='journals'&&i.journal){
      const j=(ledgerView('journals')||[]).find(x=>x.id===i.journal||x.number===i.journal||x.key===i.journal);if(!j)bad(`journal ${i.journal} not found`);
      closeAllSheets();openVoucher(j.id);parts.push(j.number||j.description||'draft');
    }else if(k==='journals'&&(i.from||i.to||i.month)){
      const[f,t]=i.month?[i.month+'-01',monthEnd(i.month)]:range(i,false);closeAllSheets();openJournals({from:f||'',to:t||''});if(f||t)parts.push(rangeLabel(f||t,t||f));
    }else if(k==='ledger'&&(i.account||i.from||i.to||i.month)){
      if(i.account&&!(L()&&L().accounts[String(i.account)]))bad(`account ${i.account} is not in your book`);
      const[f,t]=i.month?[i.month+'-01',monthEnd(i.month)]:range(i,false);closeAllSheets();openLedger(i.account?String(i.account):null,f,t);
      if(i.account)parts.push(`${i.account} · ${accName(String(i.account))}`);if(f||t)parts.push(rangeLabel(f||t,t||f));
    }else{
      if(i.month&&!validMonth(i.month))bad('month must be YYYY-MM');
      if(k==='close'&&i.month){CLOSE_SEL=i.month;parts.push(mLong(i.month));}
      if(k==='income'&&i.month){INC_MONTH=i.month;parts.push(mLong(i.month));}
      if(k==='cash'&&i.month){CM_MONTH=i.month;parts.push(mLong(i.month));}
      if(k==='accounts'&&i.account){ACC_SEL=String(i.account);parts.push(accName(String(i.account)));}
      go();
    }
    // On phones (the sheet covers the page) the sheet closes so the page can be seen.
    if(isSheetMode())setTimeout(()=>close(false),0);
    return parts.join(' · ');
  }

  /* ══ Apply all and Undo all (contract §6) ══ */
  function applyAll(){
    const set=SET;if(!set||set.applied||CHAT.busy)return;
    for(const it of set.items)it.blocked=it.ticked?recheck(it):null;
    const todo=ORDER.flatMap(t=>set.items.filter(i=>i.type===t&&i.ticked));
    if(!todo.length||set.items.some(i=>i.ticked&&i.blocked)){render();return;}
    const done=[];let fail=null;
    for(const it of todo){try{T[it.type].apply(it,set);done.push(it);}catch(e){fail={it,msg:String(e&&e.errors?e.errors.join(' · '):e&&e.message||e)};break;}}
    if(fail){
      for(const it of done.slice().reverse())try{T[it.type].undo(it);}catch(e){console.error('Ask Claude rollback failed',e);}
      scheduleDriveSave();renderAll();
      CHAT.view.push({t:'err',kind:'apply',text:`Nothing was applied: ${fail.it.summary} failed (${fail.msg}). Every change made before it was taken back.`});render();return;
    }
    const at=stamp(),log={id:'as-'+set.id,at,text:String(set.text||CHAT.firstText||'').slice(0,200),items:done.map(i=>({type:i.type,summary:i.summary,ref:i.ref||i.target}))};
    STATE.aiLog=[...(Array.isArray(STATE.aiLog)?STATE.aiLog:[]),log].slice(-LOG_MAX);
    set.applied={at,items:done,logId:log.id,undoneAt:null,skipped:[]};
    scheduleDriveSave();renderAll();
    toast(`Applied ${done.length} change${done.length===1?'':'s'}`,{action:'Undo',onAction:()=>undoAll(set),duration:8000});
    SET=null;render(true);
  }
  function undoAll(set){
    const a=set&&set.applied;if(!a||a.undoneAt)return;
    const skipped=[];
    for(const it of a.items.slice().reverse()){
      if(T[it.type].changed(it)){skipped.push({summary:it.summary,why:'changed since'});continue;}
      try{T[it.type].undo(it);}catch(e){const m=String(e&&e.errors?e.errors.join(' · '):e&&e.message||e);skipped.push({summary:it.summary,why:m});}
    }
    a.undoneAt=stamp();a.skipped=skipped;
    const log=(STATE.aiLog||[]).find(x=>x.id===a.logId);if(log)log.undoneAt=a.undoneAt;
    scheduleDriveSave();renderAll();
    toast(skipped.length?`Undid ${a.items.length-skipped.length} of ${a.items.length} changes · ${skipped.length} skipped`:`Undid ${a.items.length} change${a.items.length===1?'':'s'}`);
    render();
  }
  function leaveAll(){if(!SET||SET.applied)return;CHAT.view=CHAT.view.filter(v=>!(v.t==='set'&&v.set===SET));CHAT.view.push({t:'note',tone:'info',text:`Left out ${SET.items.length} change${SET.items.length===1?'':'s'}. Nothing was changed.`});SET=null;render();}

  /* ══ Rendering ══ */
  // Safe minimal markdown: everything escaped first, then bold, lists and line breaks; figures blur
  // with Hide amounts.
  const amt=h=>h.replace(/(Rp\s?[−-]?\d[\d.,]*(?:\s?(?:jt|rb|M))?|[−-]?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?(?:jt|juta|rb|ribu|k|million|M)\b|\d{5,}(?![-\d]))/g,'<span class="amt">$1</span>');
  const amtText=s=>amt(escH(String(s==null?'':s)));
  function md(s){
    const esc=escH(String(s||'')),blocks=[];let list=null,para=[];
    const inl=h=>amt(h.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g,'$1<i>$2</i>').replace(/`([^`]+)`/g,'<code>$1</code>'));
    const flush=()=>{if(para.length){blocks.push(`<p>${para.map(inl).join('<br>')}</p>`);para=[];}if(list){blocks.push(`<${list.t}>${list.items.map(x=>`<li>${inl(x)}</li>`).join('')}</${list.t}>`);list=null;}};
    for(const raw of esc.split(/\r?\n/)){
      const l=raw.replace(/^#{1,6}\s+/,'');let m;
      if(!l.trim()){flush();continue;}
      if((m=/^\s*[-*•]\s+(.*)$/.exec(l))){if(para.length){const p=para;para=[];blocks.push(`<p>${p.map(inl).join('<br>')}</p>`);}if(!list||list.t!=='ul'){flush();list={t:'ul',items:[]};}list.items.push(m[1]);continue;}
      if((m=/^\s*\d+[.)]\s+(.*)$/.exec(l))){if(para.length){const p=para;para=[];blocks.push(`<p>${p.map(inl).join('<br>')}</p>`);}if(!list||list.t!=='ol'){flush();list={t:'ol',items:[]};}list.items.push(m[1]);continue;}
      if(list)flush();para.push(l);
    }
    flush();return blocks.join('');
  }
  const ba=(b,a,fmtB,fmtA)=>`${b==null||b===''?'<span class="as-old">—</span>':`<s class="as-old">${fmtB(b)}</s>`} → <span class="as-new">${fmtA(a)}</span>`;
  const txt=v=>escH(String(v));
  function itemHTML(it){
    const i=it.input;
    switch(it.type){
      case'set_category':return`${escH(dayShort(it.tx.date))} · ${escH(it.tx.merchant)} · ${money(it.tx.amount)}<br>${ba(it.before,it.after,txt,txt)}`;
      case'set_note':return`${escH(dayShort(it.tx.date))} · ${escH(it.tx.merchant)} · ${money(it.tx.amount)}<br>${ba(it.before?'“'+it.before+'”':null,it.after?'“'+it.after+'”':'(no note)',txt,txt)}`;
      case'set_budget':return`${escH(i.category)} · per month<br>${ba(it.before,it.after,money,money)}`;
      case'save_goal':return`${escH(i.name)} <span class="as-item-sub">· ${escH({networth:'Net worth',liquid:'Cash & deposits',saving:'Saving',account:'Chosen accounts'}[i.kind])}</span><br>${ba(it.before?`${fmtIDR(it.before.target)} by ${mLong(it.before.by)}`:null,`${fmtIDR(i.target)} by ${mLong(i.by)}`,v=>`<span class="amt">${escH(v)}</span>`,v=>`<span class="amt">${escH(v)}</span>`)}`;
      case'add_journal':{const ls=voucherOf(i).lines,dr=ls.filter(l=>l.amount>0),cr=ls.filter(l=>l.amount<0);
        return`<b>${escH(it.number||'JV/…')}</b> <span class="as-item-sub">${it.number?'':'(given when posted)'}</span> · ${escH(dayShort(i.date))} · ${escH(i.description)}
          <table class="as-jr"><tbody>${dr.map(l=>`<tr><td>Dr ${escH(l.account)} ${escH(accName(l.account))}</td><td class="num">${money(l.amount)}</td><td class="num"></td></tr>`).join('')}
          ${cr.map(l=>`<tr class="cr"><td>Cr ${escH(l.account)} ${escH(accName(l.account))}</td><td class="num"></td><td class="num">${money(-l.amount)}</td></tr>`).join('')}</tbody></table>`;}
      case'add_income':return`${escH(dayShort(i.date))} · ${escH(i.payer)} · ${money(i.amount)}<br><span class="as-item-sub">into ${escH(i.account)} ${escH(accName(i.account))} · from ${escH(i.incomeAccount)} ${escH(accName(i.incomeAccount))}${i.note?' · '+escH(i.note):''}${it.number?' · '+escH(it.number):seeded()?' · JV/… (given when posted)':''}</span>`;
      case'add_manual_transaction':return`${escH(dayShort(i.date))} · ${escH(i.merchant)} · ${money(i.amount)}<br><span class="as-item-sub">${escH(i.category)} · ${escH(i.paid_with)}${i.note?' · '+escH(i.note):''}</span>`;
      case'mark_card_paid':return`${escH(cardOf(i.card).label)} paid through<br>${ba(it.before,it.after,v=>escH(fmtDateTime(v)),v=>escH(fmtDateTime(v)))}`;
      case'set_month_end_balance':return`${escH(mLong(i.month))} · ${escH(i.account)} ${escH(accName(i.account))}<br>${ba(it.before,it.after,money,money)}`;
      case'set_cash_type':return`${escH(dayShort(it.line.date))} · ${escH(it.line.desc)} · ${money(it.line.amount)}<br>${ba(cashMeta(it.before).label,cashMeta(it.after).label,txt,txt)}`;
      case'tick_checklist':return`${escH(mLong(i.month))} · entry ${escH(i.entry)}<br>${ba(it.before?'Posted':'Not posted',it.after?'Posted':'Not posted',txt,txt)}`;
      case'set_declared':return`${escH(i.account)} ${escH(accName(i.account))} in the SPT<br>${ba(it.before?'Declared':'Not declared',it.after?'Declared':'Not declared',txt,txt)}`;
    }
    return escH(it.summary);
  }
  function blockedHTML(it){
    if(!it.blocked)return'';const lock=lockMsg(it.blocked);
    const page=lock?'periods':{set_category:'overview',set_note:'overview',set_budget:'budgets',save_goal:'goals',add_journal:'journals',add_income:'income',add_manual_transaction:'overview',
      mark_card_paid:'cards',set_month_end_balance:'close',set_cash_type:'cash',tick_checklist:'close',set_declared:'accounts'}[it.type];
    const why=lock?`${it.blocked.replace(/;.*$/,'')} — reopen it in Books › Periods first`:it.blocked;
    return`<span class="as-why" role="status">${escH(why)} <button class="bk-link" data-as="go" data-page="${escH(page)}">${escH(lock?'Periods':pageLabel(page))}</button></span>`;
  }
  function setHTML(set){
    if(set.applied)return appliedHTML(set);
    for(const it of set.items)it.blocked=recheck(it);
    const ticked=set.items.filter(i=>i.ticked),anyBlocked=ticked.some(i=>i.blocked);
    const groups=GROUPS.map(([g,label])=>{
      const its=set.items.filter(i=>T[i.type].g===g).sort((a,b)=>ORDER.indexOf(a.type)-ORDER.indexOf(b.type)||a.no-b.no);if(!its.length)return'';
      const all=its.every(i=>i.ticked),some=its.some(i=>i.ticked);
      const row=it=>`<div class="as-item${it.blocked?' blocked':''}" data-no="${it.no}">${its.length>1?`<input type="checkbox" data-as-item="${it.no}" aria-label="Include: ${escH(it.summary)}" ${it.ticked?'checked':''} ${it.blocked&&!it.ticked?'disabled':''}>`:''}
        <div class="as-item-b">${itemHTML(it)}${blockedHTML(it)}</div></div>`;
      const head=g==='cat'?`Categories · ${its.length} transaction${its.length===1?'':'s'}`:its.length>1?`${label} · ${its.length}`:label;
      const blk=its.length===1&&its[0].blocked&&!its[0].ticked;
      const rows=its.length>5&&(g==='cat'||g==='note'||g==='cash')?its.slice(0,5).map(row).join('')+`<details><summary class="as-item-sub" style="cursor:pointer">Show all ${its.length}</summary>${its.slice(5).map(row).join('')}</details>`:its.map(row).join('');
      return`<div class="as-grp" data-g="${g}"><label class="check"><input type="checkbox" data-as-grp="${g}" ${all?'checked':''} ${blk?'disabled':''} ${!all&&some?'data-mixed="1"':''}> ${escH(head)}</label>${rows}</div>`;
    }).join('');
    const aff=affectedOf(ticked);
    const affHTML=aff.length?`<details class="as-aff"${aff.length<=6?' open':''}><summary>Everything affected</summary>${aff.map(l=>{
      const f=l.fmt==='money'?(l.before!=null&&fmtIDRShort(R(l.before))===fmtIDRShort(R(l.after))?money:moneyS):l.fmt==='pct'?pct:v=>v==null?'—':escH(v);
      const badge=l.fmt==='pct'?` <span class="badge ${l.over?'bad':'good'}">${l.over?'Over budget':'On track'}</span>`:'';
      return`<div class="as-aff-l" data-key="${escH(l.key)}"${l.warn?' data-warn="1"':''}><span class="as-al">${l.warn?'<span class="as-warn-dot" title="Moves a lot" aria-label="Moves a lot"></span>':''}${escH(l.label)}</span><span class="as-av">${l.before==null?'—':f(l.before)} → ${f(l.after)}${badge}</span></div>`;}).join('')}</details>`:'';
    return`<section class="as-set" id="asSet" data-set="${escH(set.id)}">
      <div class="as-set-h"><b>Change set · ${set.items.length} change${set.items.length===1?'':'s'}</b>${set.summary?`<div class="as-sum">${md(set.summary).replace(/^<p>|<\/p>$/g,'')}</div>`:''}</div>
      ${groups}${affHTML}
      <div class="as-foot"><button class="btn btn-secondary btn-sm" data-as="leave" id="asLeave">Leave all out</button>
        <button class="btn btn-primary btn-sm" data-as="apply" id="asApply" ${!ticked.length||anyBlocked||CHAT.busy?'disabled':''}>Apply all (${ticked.length})</button></div></section>`;
  }
  function appliedHTML(set){
    const a=set.applied,t=new Date(a.at),hm=`${pad(t.getHours())}:${pad(t.getMinutes())}`;
    return`<section class="as-set as-applied" data-set="${escH(set.id)}" data-applied="1">
      <div class="as-row"><b>${a.undoneAt?'Undone':'Applied'} · ${a.items.length} change${a.items.length===1?'':'s'} · ${hm}</b><span class="as-grow"></span>
        ${a.undoneAt?'':`<button class="btn btn-secondary btn-sm" data-as="undo" data-set="${escH(set.id)}" id="asUndo">${ic('as-undo','s16')}Undo all</button>`}</div>
      ${a.items.some(i=>i.number)?`<div class="as-item-sub">${a.items.filter(i=>i.number).map(i=>escH(i.number)).join(' · ')}</div>`:''}
      ${a.skipped&&a.skipped.length?`<div class="as-note" id="asSkipped"><span class="as-note-t">Not undone (${a.skipped.length}): ${a.skipped.map(s=>`${amtText(s.summary)} — ${amtText(s.why)}`).join('; ')}</span></div>`:''}</section>`;
  }
  const CHIPS={overview:['Recategorise this month’s ride-hailing trips','What did I spend most on this month?','Add a cash expense from today'],
    spending:['Which categories grew most this month?','Recategorise this month’s ride-hailing trips','Show Food & Dining for last month'],
    budgets:['Suggest budgets from my last 3 months','Which budgets am I on pace to overspend?','Set a budget for Groceries'],
    journals:['Record a transfer between my accounts','Show this month’s journals','Find journals for a description'],
    cards:['How much do I owe on each card?','Mark my card as paid today','Show the last card cycles'],
    close:['What is still missing for this month-end?','Enter a balance for an account','Tick the entries already posted'],
    cash:['What came in this month?','Retype a cash movement','Show money out by type'],
    income:['Record income received today','What income came in this month?','Post my income to the book'],
    goals:['Am I on track for my goals?','Add a net-worth goal','Change a goal’s target'],
    _:['What did I spend most on this month?','Show my net worth trend','Open the trial balance']};
  function emptyHTML(){
    const chips=CHIPS[ACTIVE_TAB]||CHIPS._,log=(Array.isArray(STATE.aiLog)?STATE.aiLog:[]).slice(-5).reverse();
    return`<div class="as-empty" id="asEmpty"><div>Ask me to find, fix or add something.</div>
      <div class="as-chips">${chips.map(c=>`<button class="chip" data-as="chip" data-text="${escH(c)}">${escH(c)}</button>`).join('')}</div>
      ${log.length?`<div class="as-recent" id="asRecent">Recent change sets<ul>${log.map(l=>`<li>${escH(fmtDateTime(l.at))} · ${l.items.length} change${l.items.length===1?'':'s'}${l.undoneAt?' · undone':''}${l.text?` · “${escH(l.text.slice(0,60))}”`:''}</li>`).join('')}</ul></div>`:''}</div>`;
  }
  function logHTML(){
    const v=CHAT.view,out=[];
    for(let k=0;k<v.length;k++){
      const e=v[k];
      if(e.t==='look'){let j=k;while(j<v.length&&v[j].t==='look')j++;const run=v.slice(k,j);k=j-1;
        const line=x=>`<div class="as-look">${ic('as-dot')}<span>${escH(x.label)}</span></div>`;
        out.push(run.length>3?`<details class="as-looks"><summary>${ic('as-dot','s16')} ${run.length} look-ups</summary>${run.map(line).join('')}</details>`:run.map(line).join(''));continue;}
      if(e.t==='you')out.push(`<div class="as-you">${escH(e.text)}</div>`);
      else if(e.t==='claude')out.push(`<div class="as-claude">${md(e.text)}</div>`);
      else if(e.t==='nav')out.push(`<div class="as-nav">${ic('as-arrow','s16')}<span>Opened ${escH(e.label)}</span></div>`);
      else if(e.t==='set')out.push(setHTML(e.set));
      else if(e.t==='note')out.push(`<div class="as-note info" role="status"><span class="as-note-t">${escH(e.text)}</span></div>`);
      else if(e.t==='err')out.push(`<div class="as-note" role="alert" data-kind="${escH(e.kind)}"><span class="as-note-t">${amtText(e.text)}</span>${e.kind==='nokey'||e.kind==='auth'?`<button class="btn btn-secondary btn-sm" data-as="settings">Open Settings</button>`:''}${e.retry&&e.kind!=='nokey'?`<button class="btn btn-secondary btn-sm" data-as="retry" data-text="${escH(e.retry)}">Try again</button>`:''}</div>`);
    }
    if(CHAT.busy)out.push(`<div class="as-busy" id="asBusy" role="status"><span class="as-spin" aria-hidden="true"></span><span>Claude is thinking…</span><button class="btn btn-ghost btn-sm" data-as="stop" id="asStop">${ic('as-stop','s16')}Stop</button></div>`);
    return out.join('');
  }
  function noKeyHTML(){
    const st=etAI.state();
    if(st.status!=='ready'&&!st.hasKey)return`<div class="as-empty" id="asLoading">Checking for your API key…</div>`;
    return`<div class="as-empty" id="asNoKey"><div>Add your Anthropic API key in Settings › AI to use Claude.</div><div><button class="btn btn-primary btn-sm" data-as="settings" id="asOpenSettings">Open Settings</button></div></div>`;
  }
  function render(scrollEnd){
    const p=UI.el;if(!p||!UI.open)return;
    const hasKey=etAI.state().hasKey,log=p.querySelector('#asLog'),near=log.scrollHeight-log.scrollTop-log.clientHeight<80;
    p.querySelector('#asModel').textContent=modelLabel(etAI.model());
    log.innerHTML=!hasKey&&!CHAT.view.length?noKeyHTML():CHAT.view.length?logHTML():emptyHTML();
    const ta=p.querySelector('#asText'),sb=p.querySelector('#asSend');
    ta.disabled=!hasKey;sb.disabled=!hasKey||CHAT.busy;ta.placeholder=hasKey?'Ask Claude…':'Add your API key in Settings › AI first';
    p.querySelectorAll('[data-mixed]').forEach(b=>{b.indeterminate=true;});
    if(scrollEnd||near)log.scrollTop=log.scrollHeight;
  }

  /* ── The panel, the button and the phone top-bar icon ── */
  function build(){
    if(UI.el)return UI.el;
    const fab=document.createElement('button');fab.className='as-fab';fab.id='asFab';fab.type='button';fab.title='Ask Claude (Ctrl+K)';fab.setAttribute('aria-label','Ask Claude (Ctrl+K)');
    fab.innerHTML=ic('sparkles');fab.addEventListener('click',()=>open());document.body.appendChild(fab);
    const scrim=document.createElement('div');scrim.className='as-scrim';scrim.id='asScrim';scrim.hidden=true;scrim.addEventListener('click',()=>close());document.body.appendChild(scrim);
    const p=document.createElement('aside');p.className='as-panel';p.id='asPanel';p.hidden=true;p.setAttribute('role','dialog');p.setAttribute('aria-label','Ask Claude');
    p.innerHTML=`<div class="as-handle" aria-hidden="true"></div>
      <header class="as-head"><h2>Ask Claude</h2><span class="as-model" id="asModel"></span><span class="as-grow"></span>
        <button class="btn btn-ghost btn-sm" type="button" data-as="new" id="asNew">New chat</button>
        <button class="icon-btn sm" type="button" data-as="close" id="asClose" aria-label="Close Ask Claude">${ic('x')}</button></header>
      <div class="as-log" id="asLog" aria-live="polite"></div>
      <div class="as-input"><textarea class="input" id="asText" rows="1" aria-label="Ask Claude" placeholder="Ask Claude…"></textarea>
        <button class="icon-btn" type="button" data-as="send" id="asSend" aria-label="Send">${ic('as-send')}</button></div>`;
    document.body.appendChild(p);UI.el=p;
    const ta=p.querySelector('#asText');
    const grow=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight+2,112)+'px';};
    ta.addEventListener('input',grow);
    ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();const v=ta.value;if(!v.trim()||CHAT.busy)return;ta.value='';grow();send(v);}});
    p.addEventListener('click',e=>{
      const b=e.target.closest('[data-as]');if(!b||b.disabled)return;const a=b.dataset.as;
      if(a==='close')close();else if(a==='new'){if(CHAT.busy)stop();CHAT=newChat();SET=null;render();}
      else if(a==='send'){const v=ta.value;if(!v.trim())return;ta.value='';grow();send(v);}
      else if(a==='stop')stop();else if(a==='chip'){ta.value=b.dataset.text||'';grow();ta.focus();}
      else if(a==='retry')send(b.dataset.text);else if(a==='apply')applyAll();else if(a==='leave')leaveAll();
      else if(a==='undo'){const v=CHAT.view.find(x=>x.t==='set'&&x.set.id===b.dataset.set);if(v)undoAll(v.set);}
      else if(a==='settings'){close(false);setTab('settings');setTimeout(()=>{const s=document.getElementById('set-ai');if(s)s.scrollIntoView({block:'start'});},60);}
      else if(a==='go'){setTab(b.dataset.page);if(isSheetMode())close(false);}
    });
    p.addEventListener('change',e=>{
      const t=e.target;if(!SET||SET.applied)return;
      if(t.dataset.asItem){const it=SET.items.find(i=>String(i.no)===t.dataset.asItem);if(it)it.ticked=t.checked;render();}
      else if(t.dataset.asGrp){for(const it of SET.items)if(T[it.type].g===t.dataset.asGrp&&!(t.checked&&it.blocked))it.ticked=t.checked;render();}
    });
    return p;
  }
  function placeTopIcon(){
    if(document.getElementById('asTopBtn'))return;
    const bar=document.querySelector('.topbar'),add=document.getElementById('topAdd');if(!bar)return;
    const b=document.createElement('button');b.className='icon-btn';b.id='asTopBtn';b.type='button';b.setAttribute('aria-label','Ask Claude');b.title='Ask Claude';
    b.innerHTML=ic('sparkles','s20');b.addEventListener('click',()=>open());
    if(add&&add.parentNode===bar)bar.insertBefore(b,add);else bar.appendChild(b);
  }
  function open(){
    const p=build();UI.open=true;p.hidden=false;document.body.classList.add('as-open');
    const sc=document.getElementById('asScrim');if(sc)sc.hidden=false;
    Promise.resolve(etAI.ensure&&etAI.ensure()).then(()=>render()).catch(()=>render());
    render(true);
    if(!window.matchMedia('(max-width: 767px)').matches)setTimeout(()=>{const t=p.querySelector('#asText');if(t&&!t.disabled)t.focus();},30);
  }
  function close(){
    if(!UI.el)return;UI.open=false;UI.el.hidden=true;document.body.classList.remove('as-open');
    const sc=document.getElementById('asScrim');if(sc)sc.hidden=true;
  }
  const toggle=()=>UI.open?close():open();
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&!e.altKey&&String(e.key||'').toLowerCase()==='k'){e.preventDefault();e.stopPropagation();toggle();return;}
    if(e.key==='Escape'&&UI.open&&!(typeof SHEETS!=='undefined'&&SHEETS.length)&&!(typeof OPEN_MENU!=='undefined'&&OPEN_MENU)){e.preventDefault();close();}
  },true);
  function init(){build();placeTopIcon();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  // The top bar is static markup; this only puts the icon back if something ever rebuilt it.
  registerHook('beforeRender',()=>{if(!document.getElementById('asTopBtn'))placeTopIcon();});

  // For tests and other modules: facts only, never the key.
  window.etAssistant={open,close,toggle,send,stop,applyAll,leaveAll,
    undoLast(){const v=[...CHAT.view].reverse().find(x=>x.t==='set'&&x.set.applied&&!x.set.applied.undoneAt);if(v)undoAll(v.set);},
    tools:()=>TOOL_NAMES.slice(),system:()=>SYSTEM,request:()=>clone(request()),
    state:()=>({open:UI.open,busy:CHAT.busy,messages:CHAT.msgs.length,view:CHAT.view.map(v=>v.t),
      set:SET?{id:SET.id,summary:SET.summary,items:SET.items.map(i=>({no:i.no,type:i.type,target:i.target,before:i.before,after:i.after,summary:i.summary,ticked:i.ticked,blocked:i.blocked}))}:null}),
    affected:()=>SET?affJSON(affectedOf(SET.items.filter(i=>i.ticked))):[]};
})();
