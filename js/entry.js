/* ExpenseTrack v4 — the journal editor of the app's own book: a new journal (typed by hand or
   drafted by Claude from a sentence), drafts (Save draft · Post · Delete draft), posted journals
   (Copy · Void · Edit with history), and the owner's Anthropic API key (Settings › AI).
   Contract: docs/v4-books.md §2, §3, §8 (the book) and docs/v3-ledger.md §7–§8 (the AI request);
   UX-GUIDELINE.md §11.10 and §11.10b. Loaded after js/books.js. No personal data in this file: the
   repo is public. Nothing posts or saves in a closed or locked month (the book refuses it); the
   editor says so and links to Books › Periods.

   The AI never posts. Claude only suggests drafts (one prompt may give several entries: a
   receipt, then a transfer, ...); the owner checks each in the same debit/credit form used for
   manual entries and posts it. A request sends today's date, the base currency, the chart of
   accounts (id, name, kind, ccy, isParent of the accounts neither suspended nor archived), the current balance of
   each posting account, the open receivables and payables, the last 60 days of statement lines
   (id, book account, statement name, date, amount, description, counterparty; at most 400) and
   the owner's sentence. Nothing else; never the key.

   The key lives only in its own Drive appData file ai.json ({key, model, at}) and this device's
   IndexedDB 'et-secret' (per signed-in account). It is never put in STATE, the localStorage
   mirror, the ledger, backups, Excel, the DOM (shown as sk-…•••• + last 4) or the console. */
(function(){
  'use strict';

  /* ── Settings that are not personal data ── */
  const API_URL='https://api.anthropic.com/v1/messages',API_VERSION='2026-10-21';
  const FALLBACK_BETA='server-side-fallback-2026-07-01';
  const MODELS=[
    {id:'claude-sonnet-5-5',label:'Claude Sonnet 5.5',sub:'Default · good and quick',fallback:true},
    {id:'claude-opus-5-5',label:'Claude Opus 5.5',sub:'Most careful · costs about twice as much',fallback:true},
    {id:'claude-haiku-5-5',label:'Claude Haiku 5.5',sub:'Fastest and cheapest',fallback:false}];
  const DEFAULT_MODEL='claude-sonnet-5-5';
  const AI_FILE='ai.json',IDB_NAME='et-secret',IDB_STORE='secret';
  const TIMEOUT_DRAFT=90000,TIMEOUT_TEST=20000;
  const KINDS=['asset','liability','equity','income','expense'];
  const KIND_LABEL={asset:'Asset',liability:'Liability',equity:'Equity',income:'Income',expense:'Expense'};
  // Journal kinds (v4) as badges; the v3 origin names map onto them.
  const KIND_BADGE={manual:['Manual',''],ai:['AI','accent'],'month-end':['Month-end',''],income:['Income',''],opening:['Opening',''],'year-end':['Year-end','info'],accurate:['From Accurate','']};
  const v3Name=k=>k==='manual'?'app':k;   // the v3 origin name of a kind (data-origin, kept for older readers)

  registerIcon('sparkles','<path d="M9.94 14.06 4 20"/><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M20 3v4"/><path d="M22 5h-4"/>');
  registerIcon('ban','<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>');
  registerIcon('key-round','<path d="M2.6 18.4A2 2 0 0 0 2 19.8V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.2a2 2 0 0 0 1.4-.6l.8-.8a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>');
  registerIcon('copy','<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
  registerIcon('save','<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>');
  registerIcon('trash','<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>');
  registerIcon('history','<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>');

  /* ── Styles (tokens only, so light and dark both work) ── */
  (function(){
    if(document.getElementById('en-styles'))return;
    const s=document.createElement('style');s.id='en-styles';
    s.textContent=`
    .en-ask{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
    .en-ask .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .en-note{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:18px;padding:10px 12px;border-radius:var(--radius-sm);margin:0 0 12px;background:var(--info-soft);color:var(--text-1)}
    .en-note.warn{background:var(--warn-soft)}.en-note.bad{background:var(--bad-soft)}.en-note.good{background:var(--good-soft)}
    .en-note svg.i{flex-shrink:0;margin-top:1px}
    .en-lines{margin-top:12px}
    .en-line{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:start;padding:10px 0;border-top:1px solid var(--border)}
    .en-line .en-memo{grid-column:1/-1}
    .en-line .en-fx{grid-column:1/-1;display:grid;grid-template-columns:90px minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:start}
    .en-line .en-btns{display:flex;gap:2px;padding-top:22px}
    .en-accname{font-size:12px;line-height:16px;color:var(--text-3);overflow-wrap:anywhere}
    .en-accname.bad{color:var(--bad)}
    .en-tot{display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:space-between;align-items:center;padding:12px 0;border-top:1px solid var(--border-strong);font-size:14px}
    .en-tot b{font-variant-numeric:tabular-nums}
    .en-checks{display:flex;flex-direction:column;gap:4px;margin:8px 0 4px}
    .en-sec{margin-top:16px}
    .en-sec h3{margin:0 0 8px}
    .en-sec ul{margin:0;padding-left:18px;font-size:14px;line-height:20px;color:var(--text-2)}
    .en-na{display:grid;grid-template-columns:110px minmax(0,1.6fr) 120px 80px 110px auto;gap:8px;align-items:end;padding:10px 0;border-top:1px solid var(--border)}
    .en-hist{list-style:none;margin:0;padding:0}
    .en-hist li{padding:10px 0;border-top:1px solid var(--border)}
    .en-hist summary{cursor:pointer;font-size:13px;color:var(--accent-text);margin-top:4px}
    .en-hist table{width:100%;font-size:13px;margin-top:6px;border-collapse:collapse}
    .en-hist td{padding:3px 6px 3px 0;color:var(--text-2)}
    .en-hist td.num{text-align:right;font-variant-numeric:tabular-nums}
    .en-tools{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
    .en-key{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
    .en-card{border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin:0 0 12px;background:var(--surface)}
    .en-card.off{opacity:.72}
    .en-card-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
    .en-num{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--accent-soft);color:var(--accent-text);font-size:12px;font-weight:600}
    .en-grow{flex:1}
    .en-card-foot{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border)}
    .en-src{display:flex;gap:4px;align-items:center;margin-top:4px}
    .en-qs{display:flex;flex-direction:column;gap:8px}
    .en-q{white-space:normal;line-height:18px}
    .en-batch{font-size:13px;color:var(--text-2);margin-top:10px}
    .en-when{font-size:13px;line-height:18px;color:var(--text-2);margin:-4px 0 8px;overflow-wrap:anywhere}
    .en-jr{margin:4px 0 0}
    .en-jr-h{margin:16px 0 4px}
    .en-jr table.data{width:100%}
    .en-jr table.data td.bk-acc{min-width:0}
    .en-jr tr.cr td.bk-acc{padding-left:40px}
    .en-jr .en-dc{display:inline-block;width:24px;font-size:12px;font-weight:600;color:var(--text-2)}
    .en-jr tr.cr .en-dc{color:var(--text-3)}
    .en-jr .merchant-sub{display:flex;flex-wrap:wrap;gap:2px 10px}
    .en-jr .en-bad{color:var(--bad)}
    .en-jr td.num{white-space:nowrap}
    .en-confirm{flex-wrap:wrap;margin:4px 0 0}
    .en-confirm .li-body{flex:1 1 220px;min-width:0}
    .en-confirm .en-cbtns{display:flex;gap:6px;flex-wrap:wrap}
    .en-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px;font-size:14px;color:var(--text-2)}
    .en-head .en-no{font-variant-numeric:tabular-nums;color:var(--text-1);font-weight:600}
    .en-head .en-no.draft{font-style:italic;font-weight:400;color:var(--text-2)}
    .en-note .bk-link{font-size:13px;padding:0 2px;vertical-align:0}
    @media (max-width:767px){
      .en-jr tr.cr td.bk-acc{padding-left:24px}
      .en-line{grid-template-columns:1fr 1fr}
      .en-line .en-acc{grid-column:1/-1}
      .en-line .en-btns{grid-column:1/-1;padding-top:0;justify-content:flex-end}
      .en-line .en-fx{grid-template-columns:80px 1fr 1fr}
      .en-na{grid-template-columns:1fr 1fr}
      .en-na .en-na-name{grid-column:1/-1}
    }`;
    document.head.appendChild(s);
  })();

  /* ── Small helpers ── */
  const now=()=>new Date().toISOString();
  const owner=()=>(typeof USER_EMAIL==='string'&&USER_EMAIL)||'';
  const signedIn=()=>typeof accessToken!=='undefined'&&!!accessToken;
  const todayISO=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const rp=n=>`<span class="amt">${fmtIDR(Math.round(n||0))}</span>`;
  const rpSigned=n=>n<0?`<span class="amt">−${fmtIDR(-Math.round(n))}</span>`:rp(n);
  const parseRp=s=>{const t=String(s==null?'':s).replace(/[^\d]/g,'');return t?Number(t):0;};
  const num=s=>{if(s==null||s==='')return null;const n=Number(String(s).replace(/,/g,''));return isFinite(n)?n:null;};
  const L=()=>typeof LEDGER==='function'?LEDGER():null;
  const seeded=()=>typeof ledgerSeeded==='function'&&ledgerSeeded();
  const dayLong=d=>{try{return fmtDayLong(new Date(d+'T00:00:00'));}catch(_){return d;}};
  const when=t=>{try{return fmtDateTime(t);}catch(_){return String(t||'');}};
  const modelOf=id=>MODELS.find(m=>m.id===id)||MODELS[0];
  const fx4=n=>Number(n||0).toLocaleString('id-ID',{maximumFractionDigits:4});
  // v4 journal facts: the kind (a journal from before v4 may only carry its v3 origin), headers,
  // archived accounts, and the state of a date's month in the book.
  const kindOf=v=>v?(v.kind||(v.origin==='app'?'manual':v.origin)||'manual'):'';
  const isHeader=a=>!!a&&(a.postable===false||(a.postable==null&&!!a.isParent));
  const isArchived=a=>!!(a&&a.archivedAt);
  const monthOfD=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''))?String(d).slice(0,7):'';
  const periodOf=M=>M&&typeof ledgerPeriodState==='function'&&seeded()?ledgerPeriodState(M):'open';
  const mLong=M=>{try{return monthLabel(M,true);}catch(_){return M;}};
  const isLockMsg=m=>/\b(is|which is) (closed|locked)\b/.test(String(m||''));
  // "October 2026 is closed. Reopen it in Periods to change entries." (UX §11.10b), Periods a link.
  function lockNoteHTML(M,todo,id){
    const st=periodOf(M);if(st==='open')return'';
    return`<div class="en-note warn en-lock"${id?` id="${id}"`:''} role="status" data-lock="${escH(M)}">${ic('lock','s16')}<span>${escH(mLong(M))} is ${st}. Reopen it in <button class="bk-link" data-en-act="periods">Periods</button> to ${escH(todo||'change entries')}.</span></div>`;
  }
  function goPeriods(){if(typeof closeAllSheets==='function')closeAllSheets();setTab('periods');}
  // A refusal from the book as a toast; a closed or locked month gets a Periods button.
  function errToast(e){const m=((e&&e.errors)||[String(e&&e.message||e)]).join(' · ');
    if(isLockMsg(m))toast(m,{action:'Periods',onAction:goPeriods,duration:9000});else toast(m);return m;}

  /* ══ The key: IndexedDB 'et-secret' on this device + Drive appData ai.json ══ */
  let SEC={owner:null,key:null,model:DEFAULT_MODEL,at:'',localDone:false,driveTried:false,busy:null,fileId:null,status:'idle'};
  function idb(mode,fn){
    return new Promise(res=>{
      let done=false;const end=v=>{if(!done){done=true;res(v);}};setTimeout(()=>end(null),3000);
      try{const r=indexedDB.open(IDB_NAME,1);
        r.onupgradeneeded=()=>{try{r.result.createObjectStore(IDB_STORE);}catch(_){}};
        r.onerror=()=>end(null);r.onblocked=()=>end(null);
        r.onsuccess=()=>{try{const db=r.result,tx=db.transaction(IDB_STORE,mode),q=fn(tx.objectStore(IDB_STORE));
          q.onsuccess=()=>end(q.result===undefined?null:q.result);q.onerror=()=>end(null);tx.oncomplete=()=>{try{db.close();}catch(_){}};}catch(_){end(null);}};
      }catch(_){end(null);}
    });
  }
  const idbKey=()=>'ai|'+owner();
  const validRec=r=>!!(r&&typeof r==='object'&&typeof r.at==='string'&&(r.key==null||typeof r.key==='string'));
  function take(r){SEC.key=r.key||null;SEC.model=modelOf(r.model).id;SEC.at=r.at||'';}
  const rec=()=>({key:SEC.key||null,model:SEC.model,at:SEC.at});
  function resetSec(){SEC={owner:owner(),key:null,model:DEFAULT_MODEL,at:'',localDone:false,driveTried:false,busy:null,fileId:null,status:'idle'};}
  // Loads the key once per account from this device, then (signed in) from Drive; the newer `at` wins.
  function aiEnsure(){
    if(SEC.owner!==owner())resetSec();
    if(SEC.busy)return SEC.busy;
    const needLocal=!SEC.localDone,needDrive=signedIn()&&!SEC.driveTried;
    if(!needLocal&&!needDrive)return Promise.resolve(!!SEC.key);
    const me=SEC.owner,before=SEC.key+'|'+SEC.at;SEC.status='loading';
    SEC.busy=(async()=>{
      try{
        if(needLocal){SEC.localDone=true;const r=await idb('readonly',st=>st.get(idbKey()));if(validRec(r)&&r.at>=SEC.at)take(r);}
        if(needDrive){SEC.driveTried=true;
          try{const f=await driveFindFileByName(AI_FILE);
            if(f){SEC.fileId=f.id;const r=await driveReadJson(f.id);
              if(validRec(r)&&r.at>SEC.at){take(r);await idb('readwrite',st=>st.put({...rec(),owner:me},idbKey()));}
              else if(SEC.at&&(!validRec(r)||r.at<SEC.at))await driveWrite();}
            else if(SEC.at)await driveWrite();
          }catch(_){/* Drive unreachable: the device copy stays in use */}}
      }finally{SEC.busy=null;SEC.status='ready';}
      if(SEC.owner===me&&(before!==SEC.key+'|'+SEC.at||document.getElementById('aiLoading'))&&typeof ACTIVE_TAB!=='undefined'&&ACTIVE_TAB==='settings'&&!keyTyped())renderAll();
      return!!SEC.key;
    })();
    return SEC.busy;
  }
  const keyTyped=()=>{const i=document.getElementById('aiKey');return!!(i&&i.value);};
  async function driveWrite(){
    if(!SEC.fileId){const f=await driveFindFileByName(AI_FILE);if(f)SEC.fileId=f.id;}
    const saved=await driveUploadJson(SEC.fileId,AI_FILE,rec());if(saved&&saved.id)SEC.fileId=saved.id;
  }
  // Stores the current key/model on this device and (signed in) in Drive. → 'drive' | 'device'
  async function store(){
    SEC.at=now();
    await idb('readwrite',st=>st.put({...rec(),owner:SEC.owner},idbKey()));
    if(!signedIn())return'device';
    try{await driveWrite();return'drive';}catch(_){return'device-only';}
  }
  const hasKey=()=>!!SEC.key;
  const masked=()=>SEC.key?`sk-…••••${SEC.key.slice(-4)}`:'';
  // Never let the key reach a message, the DOM or the console.
  const clean=s=>{s=String(s==null?'':s);if(SEC.key&&SEC.key.length>6)s=s.split(SEC.key).join('•••');return s.replace(/sk-[A-Za-z0-9_\-]{8,}/g,'sk-…');};

  /* ══ Calling Claude (browser-direct, the owner's own key) ══ */
  function aiErr(kind,msg,status){const e=new Error(msg);e.kind=kind;if(status)e.status=status;return e;}
  async function callClaude(body,timeout){
    if(!SEC.key)throw aiErr('nokey','No Anthropic API key yet. Add one in Settings › AI.');
    if(typeof navigator!=='undefined'&&navigator.onLine===false)throw aiErr('offline','You’re offline, so Claude can’t be asked right now.');
    const m=modelOf(body.model),headers={'content-type':'application/json','x-api-key':SEC.key,'anthropic-version':API_VERSION,
      'anthropic-dangerous-direct-browser-access':'true'};
    if(m.fallback){headers['anthropic-beta']=FALLBACK_BETA;body={...body,fallbacks:'default'};}
    const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),timeout);
    let r;
    try{r=await fetch(API_URL,{method:'POST',headers,body:JSON.stringify(body),signal:ctl.signal,credentials:'omit',referrerPolicy:'no-referrer'});}
    catch(e){clearTimeout(t);throw e&&e.name==='AbortError'?aiErr('timeout','Claude took too long to answer.'):aiErr('network','Couldn’t reach Anthropic. Check your connection.');}
    let data=null;
    try{data=await r.json();}catch(_){data=null;}finally{clearTimeout(t);}
    if(!r.ok){
      const s=r.status,detail=data&&data.error&&data.error.message?clean(String(data.error.message).slice(0,200)):'';
      if(s===401)throw aiErr('auth','Anthropic didn’t accept the key (401). Check or replace it in Settings › AI.',s);
      if(s===403)throw aiErr('auth','This key isn’t allowed to use that model (403). Check it at console.anthropic.com.',s);
      if(s===429)throw aiErr('rate','Too many requests or the key’s spend limit is reached (429). Wait a minute, or check the limit at console.anthropic.com.',s);
      if(s===400||s===404||s===413)throw aiErr('request',`Anthropic couldn’t take this request (${s})${detail?': '+detail:''}.`,s);
      if(s>=500)throw aiErr('server',`Anthropic is busy or having trouble (${s}). Try again in a moment.`,s);
      throw aiErr('http',`Anthropic answered with an error (${s}).`,s);
    }
    if(!data||typeof data!=='object')throw aiErr('malformed','Claude’s answer couldn’t be read.');
    return data;
  }

  // Structured output: the drafted entries (contract §7). Debit/credit in whole rupiah.
  const LINE_SCHEMA={type:'object',additionalProperties:false,required:['account','debit','credit','memo','fx','stmtLine'],properties:{
    account:{type:'string',description:'Account id from the chart (or from newAccounts)'},
    debit:{type:'integer',description:'Whole rupiah, 0 when the line is a credit'},
    credit:{type:'integer',description:'Whole rupiah, 0 when the line is a debit'},
    memo:{type:'string'},
    fx:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['ccy','amount','rate'],properties:{
      ccy:{type:'string',description:'ISO currency code'},amount:{type:'number',description:'Amount in that currency'},rate:{type:'number',description:'Rupiah per unit'}}}]},
    stmtLine:{anyOf:[{type:'null'},{type:'string'}],description:'id of the statementLines entry the amount was taken from, else null'}}};
  const SCHEMA={type:'object',additionalProperties:false,required:['entries','newAccounts','assumptions','questions'],properties:{
    entries:{type:'array',items:{type:'object',additionalProperties:false,required:['date','description','lines'],properties:{
      date:{type:'string',description:'YYYY-MM-DD'},
      description:{type:'string'},
      lines:{type:'array',items:LINE_SCHEMA}}}},
    newAccounts:{type:'array',items:{type:'object',additionalProperties:false,required:['id','name','kind','ccy','parent'],properties:{
      id:{type:'string'},name:{type:'string'},kind:{type:'string',enum:KINDS},ccy:{type:'string'},parent:{anyOf:[{type:'string'},{type:'null'}]}}}},
    assumptions:{type:'array',items:{type:'string'}},
    questions:{type:'array',items:{type:'string'}}}};
  const SYSTEM=[
    'You draft double-entry journal vouchers for a personal accounting book kept in Indonesian rupiah (IDR), from what the owner wrote. The owner reviews every draft and posts it; you never post.',
    'Split what the owner wrote into separate transactions, in the order they happened, one entry each. Example: "the receivable from X was paid into my bank account, then I moved it to my 5678 account" is two entries: first Dr the bank account / Cr the receivable, then Dr the account whose name ends ••5678 / Cr the bank account. Receipts, payments, transfers between the owner\'s own accounts, purchases, currency buys, card payments and fees are each their own entry.',
    'Rules for every entry:',
    '- Lines only on accounts from chartOfAccounts with isParent false (or from newAccounts). Never a parent account: a bank\'s name or "my bank" means the posting account under it whose name matches, not the parent.',
    '- Account names mask numbers as ••1234. "My 5678 account" or "the ••5678 account" is the posting account whose name ends with ••5678.',
    '- Every line is whole rupiah: the amount goes in debit or credit and the other is 0. Each entry\'s debits equal its credits exactly.',
    '- Assets and expenses increase with a debit; liabilities, equity and income increase with a credit. Money leaving a bank account is a credit to it; a purchase on a credit card is a credit to the card; a receivable that is paid is a credit to the receivable.',
    '- A line on an account whose ccy is not IDR, or a line whose amount is in a foreign currency, carries fx {ccy, amount, rate}: the amount in that currency, the rate in rupiah per unit, and round(amount x rate) equals the line\'s rupiah amount. Every other line has fx null.',
    '- Amounts, in this order: (1) the amount in the owner\'s words; (2) else a matching line in statementLines (same account, same direction, a fitting description or counterparty): use its amount, use its date as the entry\'s date, and put its id in stmtLine on the line for that account; (3) else the open balance in openItems (for example a receivable paid in full). Otherwise stmtLine is null.',
    '- Never write an amount of 0 on a line. If no amount can be found for an entry, leave that entry out and ask for the amount in questions.',
    '- balances is the current book balance of each posting account (debit positive, credit negative; an account not listed is 0). openItems lists receivables and payables that are not settled (outstanding = what is still owed). statementLines are the last 60 days of bank and card lines: amount positive = money into that account (for a card: a payment or refund), negative = money out (for a card: a charge); account = the book account it belongs to, or null; statement = the statement\'s name. A line with inBook true is already in the book: do not use it again unless the owner says so.',
    '- date: the statement line\'s date when an amount came from one, else the date the owner gives, else today (YYYY-MM-DD).',
    '- If no account in the chart fits, propose one in newAccounts (an unused id that follows the chart\'s numbering under a fitting parent, a short name, kind, ccy, parent id) and use that id in the lines. Never propose an account the chart already has. Otherwise newAccounts is empty.',
    '- If something is unclear (which account, the rate, a fee), make the most reasonable assumption, state it in assumptions, and ask about it in questions. Never invent an amount.',
    '- description: a short neutral description of each entry. memo: a few words per line.',
    'When the app sends back errors, fix those entries and return the whole answer again. On a follow-up (followUp true) the owner answers your questions and may have edited your draft (currentDraft): return the whole answer again with every entry still to post, using the answers and keeping the owner\'s edits unless the answers change them. Entries in postedAlready are in the book: never repeat them.'].join('\n');
  // The chart sent to Claude: id, name, kind, ccy, isParent of every account that is neither
  // suspended nor archived (v4). Nothing else.
  function chartForAI(){
    const x=L();if(!x)return[];
    return Object.values(x.accounts).filter(a=>a&&!a.suspended&&!isArchived(a))
      .sort((p,q)=>String(p.id).localeCompare(String(q.id),undefined,{numeric:true}))
      .map(a=>({id:String(a.id),name:String(a.name||a.id),kind:a.kind,ccy:a.ccy||'IDR',isParent:isHeader(a)}));
  }
  // The book's current balance per account: the views' cumulative balances at their latest month,
  // which hold every posted journal up to the newest one; drafts and void journals never count
  // (js/ledger.js coreOf, v4 §6).
  function bookBalances(){
    const b=typeof BOOKS==='function'?BOOKS():null;
    if(!b||!b.fromLedger||!Array.isArray(b.months)||!b.months.length)return{};
    return b.balances[b.months[b.months.length-1]]||{};
  }
  function balancesForAI(){
    const bal=bookBalances(),out={};
    for(const a of postable()){const v=Math.round(bal[a.id]||0);if(v)out[a.id]=v;}
    return out;
  }
  // Receivables and payables that are not settled: the wealth view's receivables, loans and other
  // liabilities groups, plus any account whose type says receivable or payable.
  const OPEN_GROUPS=new Set(['receivables','loans','other_liabilities']);
  function openItemsForAI(){
    const w=typeof W==='function'?W():null,bal=bookBalances(),grp=new Map(((w&&w.accounts)||[]).map(a=>[String(a.id),a.group]));
    const out=[];
    for(const a of postable()){
      if(a.kind!=='asset'&&a.kind!=='liability')continue;
      if(!OPEN_GROUPS.has(grp.get(a.id))&&!/receivable|payable/i.test(a.type||''))continue;
      const v=Math.round(bal[a.id]||0);if(!v)continue;
      out.push({account:String(a.id),name:String(a.name||a.id),kind:v>0?'receivable':'payable',outstanding:Math.abs(v)});
    }
    return out;
  }
  // Cash lines → the book account their statement belongs to (Month-end's statement mapping).
  function stmtCode(ca){try{return typeof meMapOf==='function'?(meMapOf(ca)||null):null;}catch(_){return null;}}
  function cashAccOf(id){const c=typeof CM==='function'?CM():null;return(c&&c.accounts||[]).find(a=>a.id===id)||{id,label:String(id),kind:'account',currency:'IDR'};}
  const STMT_DAYS=60,STMT_CAP=400;
  const isoMinus=(d,n)=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()-n);return t.toISOString().slice(0,10);};
  // The last 60 days of statement lines, counted back from the newest line (never after today),
  // newest first, at most 400.
  function stmtWindow(){
    const c=typeof CM==='function'?CM():null,ts=(c&&Array.isArray(c.txns)?c.txns:[]).filter(t=>t&&t.id&&/^\d{4}-\d{2}-\d{2}$/.test(String(t.date)));
    if(!ts.length)return[];
    const today=todayISO();let end=ts.reduce((m,t)=>t.date>m&&t.date<=today?t.date:m,'');if(!end)end=today;
    const from=isoMinus(end,STMT_DAYS);
    return ts.filter(t=>t.date>from&&t.date<=end).sort((p,q)=>q.date.localeCompare(p.date)||String(q.id).localeCompare(String(p.id))).slice(0,STMT_CAP);
  }
  function stmtLinesForAI(){
    const used=usedStmtLines(),accs=new Map();
    const acc=id=>{if(!accs.has(id)){const ca=cashAccOf(id);accs.set(id,{code:stmtCode(ca),label:String(ca.label||id)});}return accs.get(id);};
    return stmtWindow().map(t=>{const a=acc(t.account),o={id:String(t.id),account:a.code,statement:a.label,date:t.date,amount:Math.round(+t.amount||0)};
      if(t.currency&&t.currency!=='IDR')o.currency=t.currency;
      o.desc=String(t.desc||'');o.counterparty=String(t.counterparty||'');if(used.has(String(t.id)))o.inBook=true;return o;});
  }
  // Statement line ids already used by a posted voucher (stmtLine on its lines), through the cash
  // id aliases so a line renamed by a newer file still counts.
  function stmtResolve(id){const al=((L()||{}).cash||{}).alias||{};let x=String(id),n=0;while(al[x]&&n++<8)x=al[x];return x;}
  function usedStmtLines(){
    const x=L(),s=new Set();if(!x)return s;
    for(const v of Object.values(x.vouchers))if(v&&v.status==='posted')for(const l of v.lines||[])if(l&&l.stmtLine)s.add(stmtResolve(l.stmtLine));
    return s;
  }
  function stmtLineOf(id){
    if(!id)return null;const c=typeof CM==='function'?CM():null;if(!c||!Array.isArray(c.txns))return null;
    const r=stmtResolve(id);return c.txns.find(t=>t&&(t.id===id||t.id===r))||null;
  }
  // What the first message carries. Never the key.
  function contextForAI(sentence){
    return{today:todayISO(),baseCurrency:'IDR',chartOfAccounts:chartForAI(),balances:balancesForAI(),openItems:openItemsForAI(),
      statementLines:stmtLinesForAI(),sentence:String(sentence)};
  }
  // The request. With no messages it is the first turn for a sentence; a correction or follow-up
  // passes the whole conversation so far (append-only: Claude's earlier answers go back unchanged).
  function draftRequest(sentence,messages){
    return{model:SEC.model,max_tokens:16000,system:SYSTEM,
      output_config:{effort:'medium',format:{type:'json_schema',schema:SCHEMA}},
      messages:messages||[{role:'user',content:JSON.stringify(contextForAI(sentence))}]};
  }
  // Reads Claude's answer; throws 'malformed' when it isn't the shape asked for.
  function readAnswer(data){
    if(data.stop_reason==='refusal')throw aiErr('refusal','Claude declined to draft this one.');
    if(data.stop_reason==='max_tokens')throw aiErr('malformed','Claude’s answer was cut off before it finished.');
    const t=(Array.isArray(data.content)?data.content:[]).filter(b=>b&&b.type==='text').map(b=>b.text).join('');
    let o;try{o=JSON.parse(t);}catch(_){throw aiErr('malformed','Claude’s answer couldn’t be read.');}
    if(!o||typeof o!=='object'||!Array.isArray(o.entries))throw aiErr('malformed','Claude’s answer couldn’t be read.');
    const str=v=>typeof v==='string'?v:v==null?'':String(v);
    const amt=v=>{const n=Number(v);return isFinite(n)&&n>0?Math.round(n):0;};
    const list=v=>(Array.isArray(v)?v:[]).map(str).filter(Boolean).slice(0,12);
    const entries=o.entries.filter(e=>e&&typeof e==='object'&&Array.isArray(e.lines)).slice(0,20).map(e=>({
      date:/^\d{4}-\d{2}-\d{2}$/.test(str(e.date))?str(e.date):todayISO(),description:str(e.description).slice(0,200),
      lines:e.lines.filter(l=>l&&typeof l==='object').slice(0,30).map(l=>{
        let dr=amt(l.debit),cr=amt(l.credit);if(dr&&cr){const d=dr-cr;dr=d>0?d:0;cr=d<0?-d:0;}
        const f=l.fx&&typeof l.fx==='object'?l.fx:null,sl=str(l.stmtLine).trim();
        return{account:str(l.account).trim(),debit:dr,credit:cr,memo:str(l.memo).slice(0,200),
          fx:f&&num(f.amount)!=null&&num(f.rate)!=null?{ccy:str(f.ccy).toUpperCase().slice(0,3),amount:Math.abs(num(f.amount)),rate:num(f.rate)}:null,
          stmtLine:sl&&stmtLineOf(sl)?sl:null};})})).filter(e=>e.lines.length);
    const questions=list(o.questions);
    if(!entries.length&&!questions.length)throw aiErr('malformed','Claude’s answer had no entries and no questions.');
    const na=(Array.isArray(o.newAccounts)?o.newAccounts:[]).filter(a=>a&&typeof a==='object').map(a=>({id:str(a.id).trim(),name:str(a.name).trim().slice(0,80),
      kind:KINDS.includes(a.kind)?a.kind:'expense',ccy:(str(a.ccy)||'IDR').toUpperCase().slice(0,3),parent:a.parent?str(a.parent):''}));
    return{entries,newAccounts:na,assumptions:list(o.assumptions),questions};
  }

  /* ══ The journal editor (UX §11.10b): new, AI drafts, draft, posted (view / edit) ══
     D holds the sheet: D.entries is one entry for a manual journal, a draft or an edit, and one per
     drafted entry after a Claude answer (D.ai). D.mode: 'new' (nothing saved yet) · 'draft' (D.id is
     a saved draft) · 'edit' (a posted journal being changed, with "Why the change") · 'view' (a
     posted or void journal, read-only, Copy · Void · Edit) · 'locked' (posted in a closed or locked
     month, or a year-end journal: read-only, Copy only). D.confirm: 'post' | 'delete' | null, the
     in-place confirm row. Ids: en<Name><i> for the single form, enE<k><Name><i> for drafted entry k. */
  let D=null,SH=null;
  const blankLine=()=>({account:'',debit:0,credit:0,memo:'',fxOn:false,ccy:'',famt:'',rate:'',stmtLine:null});
  const blankEntry=(date)=>({date:date||todayISO(),description:'',lines:[blankLine(),blankLine()],include:true,dup:[]});
  function accounts(){const x=L();return x?x.accounts:{};}
  function accOf(code){return accounts()[code]||null;}
  function postable(){
    return Object.values(accounts()).filter(a=>a&&!isHeader(a)&&!a.suspended&&!isArchived(a)).sort((p,q)=>String(p.id).localeCompare(String(q.id),undefined,{numeric:true}));
  }
  function lineFrom(l){
    const a=Math.round(l.amount||0),f=l.fx||null;
    return{account:String(l.account||''),debit:a>0?a:0,credit:a<0?-a:0,memo:l.memo||l.description||'',fxOn:!!f,ccy:f?f.ccy:'',famt:f?String(f.amount):'',rate:f?String(f.rate):'',stmtLine:l.stmtLine||null};
  }
  // Next free code under a parent following its children's pattern (e.g. 6000.12 after 6000.11).
  function nextCode(parent,taken){
    if(!parent)return'';
    const used=id=>!!accounts()[id]||!!(taken&&taken.has(id));
    const ids=Object.keys(accounts()).filter(id=>id.startsWith(parent+'.')&&/^\d+$/.test(id.slice(parent.length+1)));
    const w=ids.reduce((m,id)=>Math.max(m,id.length-parent.length-1),2);
    let n=ids.reduce((m,id)=>Math.max(m,Number(id.slice(parent.length+1))),0)+1;
    let c;do{c=`${parent}.${String(n).padStart(w,'0')}`;n++;}while(used(c));
    return c;
  }
  // Claude's answer → entries for the form; proposed accounts get a usable code first.
  function answerToForm(ans){
    const taken=new Set();
    const na=ans.newAccounts.filter(a=>!a.id||!accOf(a.id)).map(a=>{
      const parent=a.parent&&accOf(a.parent)?a.parent:'';const id=a.id&&!accOf(a.id)&&!taken.has(a.id)?a.id:nextCode(parent,taken);taken.add(id);
      return{orig:a.id||a.name,name0:a.name,id,name:a.name||id,kind:a.kind,ccy:a.ccy||'IDR',parent,added:false};});
    const entries=ans.entries.map((e,k)=>{
      const lines=e.lines.map(l=>{const nx=na.find(a=>a.orig===l.account||(a.name0&&a.name0===l.account));
        return{account:nx?nx.id:l.account,debit:l.debit,credit:l.credit,memo:l.memo,fxOn:!!l.fx,ccy:l.fx?l.fx.ccy:'',famt:l.fx?String(l.fx.amount):'',rate:l.fx?String(l.fx.rate):'',stmtLine:l.stmtLine||null};});
      return{n:k+1,date:e.date,description:e.description,lines,include:true,dup:[]};});
    na.forEach(a=>{a.orig=a.id;delete a.name0;});
    return{entries,newAccounts:na};
  }
  function voucherOf(E){
    return{date:E.date,description:E.description,lines:E.lines.filter(l=>l.account||l.debit||l.credit).map(l=>{
      const o={account:l.account,amount:Math.round((l.debit||0)-(l.credit||0)),memo:l.memo||''};
      if(l.fxOn){o.fx={ccy:String(l.ccy||'').toUpperCase(),amount:Math.abs(num(l.famt)||0),rate:num(l.rate)||0};}
      if(l.stmtLine)o.stmtLine=l.stmtLine;
      return o;})};
  }
  const pendingNew=()=>D.newAccounts.filter(a=>!a.added);
  // The book's checks on one entry, with "add the proposed account" in place of "not in your book".
  // Lines with both a debit and a credit (the form keeps both inputs; the book wants one side).
  const bothSides=E=>E.lines.map((l,i)=>(l.debit||0)>0&&(l.credit||0)>0?`Line ${i+1}: enter either a debit or a credit, not both`:null).filter(Boolean);
  // Save draft (v4 §2): a valid date and at least two filled lines (an account each); may be unbalanced.
  function draftErrorsOf(E){
    const e=[],v=voucherOf(E);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(E.date||'')))e.push('Enter a valid date');
    if(v.lines.filter(l=>l.account).length<2)e.push('A draft needs at least two lines with an account');
    v.lines.forEach((l,i)=>{if(!l.account)e.push(`Line ${i+1}: choose an account`);});
    return e.concat(bothSides(E));
  }
  function errorsOf(E){
    let e=typeof ledgerValidate==='function'?ledgerValidate(voucherOf(E)):['Your book is not set up yet'];
    e=bothSides(E).concat(e.filter(m=>!/not both/.test(m)));
    const pend=new Map(pendingNew().map(a=>[a.id,a]));
    e=e.map(m=>{const r=/^Line (\d+): account (.+) is not in your book$/.exec(m);return r&&pend.has(r[2])?`Line ${r[1]}: add the new account ${r[2]} to your book first (below)`:m;});
    if(pend.size&&E.lines.some(l=>pend.has(l.account)))e.push(`Confirm or remove the proposed new account${pend.size===1?'':'s'} before posting`);
    if(D.mode==='edit'&&!String(E.why||'').trim())e.push('Say why you are changing it');
    return e;
  }
  // The checks sent back to Claude: the book's own checks, except a proposed account the owner
  // still has to confirm (that is not Claude's mistake).
  function aiErrorsOf(form){
    const pend=new Set(form.newAccounts.map(a=>a.id)),out=[];
    form.entries.forEach((E,k)=>{
      const v=voucherOf(E),errs=(typeof ledgerValidate==='function'?ledgerValidate(v):['Your book is not set up yet'])
        .filter(m=>{const r=/^Line \d+: account (.+) is not in your book$/.exec(m);return!(r&&pend.has(r[1]));});
      if(errs.length)out.push({entry:k+1,description:E.description,errors:errs});
    });
    return out;
  }
  const pre=k=>D&&D.ai?`E${k}`:'';
  const remaining=()=>D.entries.filter(E=>E.include);
  function sheetTitle(){return D.mode==='edit'?'Edit journal':D.mode==='draft'?'Draft journal':D.mode==='view'||D.mode==='locked'?'Journal':'New journal';}
  const readOnly=()=>D&&(D.mode==='view'||D.mode==='locked');
  function askHTML(){
    if(D.mode!=='new')return'';
    if(!hasKey())return`<div class="en-note" id="enNoKey">${ic('info','s16')}<span>Claude can draft entries from a sentence once you add your own Anthropic API key in <button class="bk-link" data-en="settings">Settings › AI</button>. For now, fill this one in by hand.</span></div>`;
    return`<div class="en-ask"><label class="label" for="enText">Tell me what happened</label>
      <textarea class="input" id="enText" rows="2" placeholder="e.g. the money my friend owed me came into my bank account, then I moved it to my ••5678 account">${escH(D.prompt||'')}</textarea>
      <div class="row"><button class="btn btn-secondary btn-sm" data-en="ask" id="enAsk">${ic('sparkles','s16')}Draft with Claude</button>
      <span class="help" id="enSends">Sends your chart of accounts, account balances, open receivables and payables, the last 60 days of statement lines and your sentence to Anthropic (${escH(modelOf(SEC.model).label)}). Nothing posts until you tap Post.</span></div></div>`;
  }
  function noteHTML(){
    if(!D.note)return'';
    return`<div class="en-note ${D.note.tone||''}" id="enNote" role="status">${ic(D.note.tone==='warn'||D.note.tone==='bad'?'triangle-alert':'info','s16')}<span>${escH(D.note.text)}</span></div>`;
  }
  function accLabel(a){return`${a.name}${isHeader(a)?' · parent account':''}${isArchived(a)?' · archived':''}${a.ccy&&a.ccy!=='IDR'?' · '+a.ccy:''}`;}
  function lineHTML(E,k,l,i){
    const p=pre(k),a=accOf(l.account),pend=D.newAccounts.find(n=>n.id===l.account&&!n.added);
    const nm=!l.account?'':a?escH(accLabel(a)):pend?'New account (confirm below)':'Not in your book';
    const bad=l.account&&(!a||isHeader(a)||isArchived(a))&&!pend;
    const src=srcNote(l.stmtLine);
    return`<div class="en-line" data-i="${i}">
      <div class="field en-acc"><label class="label" for="en${p}Acc${i}">Account</label><input class="input" id="en${p}Acc${i}" data-f="account" list="enAccList" autocomplete="off" spellcheck="false" placeholder="Code or name" value="${escH(l.account)}">
        <div class="en-accname${bad?' bad':''}" id="en${p}AccName${i}">${nm}</div></div>
      <div class="field"><label class="label" for="en${p}Dr${i}">Debit</label><div class="input-affix"><span class="affix">Rp</span><input class="input" id="en${p}Dr${i}" data-f="debit" inputmode="numeric" autocomplete="off" value="${l.debit?fmtNum(l.debit):''}"></div></div>
      <div class="field"><label class="label" for="en${p}Cr${i}">Credit</label><div class="input-affix"><span class="affix">Rp</span><input class="input" id="en${p}Cr${i}" data-f="credit" inputmode="numeric" autocomplete="off" value="${l.credit?fmtNum(l.credit):''}"></div></div>
      <div class="en-btns"><button class="icon-btn sm" data-en="fx" data-k="${k}" data-i="${i}" aria-pressed="${l.fxOn}" aria-label="Foreign currency on line ${i+1}" title="Foreign currency">${ic('globe','s16')}</button>
        <button class="icon-btn sm" data-en="del" data-k="${k}" data-i="${i}" aria-label="Remove line ${i+1}" title="Remove line" ${E.lines.length<=2?'disabled':''}>${ic('x','s16')}</button></div>
      <div class="field en-memo"><label class="label" for="en${p}Memo${i}">Memo</label><input class="input" id="en${p}Memo${i}" data-f="memo" autocomplete="off" value="${escH(l.memo)}">
        ${src?`<div class="help en-src" id="en${p}Src${i}" data-stmt="${escH(l.stmtLine)}">${ic('landmark','s16')}<span>${escH(src)}</span></div>`:''}</div>
      ${l.fxOn?`<div class="en-fx"><div class="field"><label class="label" for="en${p}Ccy${i}">Currency</label><input class="input" id="en${p}Ccy${i}" data-f="ccy" maxlength="3" autocomplete="off" placeholder="USD" value="${escH(l.ccy)}"></div>
        <div class="field"><label class="label" for="en${p}Fa${i}">Foreign amount</label><input class="input" id="en${p}Fa${i}" data-f="famt" type="number" step="any" min="0" value="${escH(l.famt)}"></div>
        <div class="field"><label class="label" for="en${p}Rate${i}">Rate (Rp per unit)</label><input class="input" id="en${p}Rate${i}" data-f="rate" type="number" step="any" min="0" value="${escH(l.rate)}"><span class="help" id="en${p}FxHint${i}">${fxHint(l)}</span></div></div>`:''}
    </div>`;
  }
  // "from Test savings ••1111 statement 3 Nov" under a line whose amount came from a statement line.
  function srcNote(id){
    const t=stmtLineOf(id);if(!t)return'';
    const d=typeof meDay==='function'?meDay(t.date):t.date;
    return`from ${cashAccOf(t.account).label||t.account} statement ${d}`;
  }
  function fxHint(l){const a=num(l.famt),r=num(l.rate);return a&&r?`= ${fmtIDR(Math.round(Math.abs(a)*r))}`:'';}
  // The entry as a journal: debit lines first, then the credit lines indented, each with its
  // account, what it does to that account in plain words, memo, currency and statement source.
  // ids=true only where it is the card's own view (journal mode), so the form's totals keep their ids.
  const UP_ON_DEBIT={asset:true,expense:true,liability:false,equity:false,income:false};
  function effectOf(a,isDr){
    if(!a||!KIND_LABEL[a.kind])return'';
    const up=UP_ON_DEBIT[a.kind]===isDr;
    return`${KIND_LABEL[a.kind]} · goes ${up?'up':'down'}`;
  }
  function journalHTML(E,k,ids){
    const p=pre(k),rows=E.lines.map((l,i)=>({l,i})).filter(({l})=>l.account||l.debit||l.credit);
    const dr=rows.filter(({l})=>(l.debit||0)>=(l.credit||0)),cr=rows.filter(({l})=>(l.debit||0)<(l.credit||0));
    let tDr=0,tCr=0;
    const row=({l,i},isDr)=>{
      const amt=isDr?(l.debit||0)-(l.credit||0):(l.credit||0)-(l.debit||0);if(isDr)tDr+=amt;else tCr+=amt;
      const a=accOf(l.account),pend=D.newAccounts.find(n=>n.id===l.account&&!n.added);
      const name=!l.account?'<span class="en-bad">No account yet</span>':a?escH(a.name)+(isHeader(a)?' <span class="en-bad">· parent account, pick one under it</span>':isArchived(a)?' <span class="en-bad">· archived</span>':'')
        :pend?`${escH(pend.name||pend.id)} <span class="badge warn">New</span>`:'<span class="en-bad">Not in your book</span>';
      const eff=a&&!isHeader(a)?effectOf(a,isDr):pend?effectOf(pend,isDr):'',src=srcNote(l.stmtLine);
      const sub=[eff?`<span>${escH(eff)}</span>`:'',l.memo?`<span>${escH(l.memo)}</span>`:'',
        l.fxOn&&l.ccy?`<span class="badge">${escH(l.ccy)} ${escH(fx4(num(l.famt)))} @ ${escH(fx4(num(l.rate)))}</span>`:'',
        src?`<span class="en-src">${ic('landmark','s16')}${escH(src)}</span>`:'',!amt?'<span class="en-bad">No amount</span>':''].filter(Boolean).join('');
      return`<tr class="${isDr?'dr':'cr'}" data-i="${i}"${ids?` id="en${p}Jr${i}"`:''}><td class="bk-acc"><div class="merchant-name"><span class="en-dc">${isDr?'Dr':'Cr'}</span>${l.account?`<span class="bk-code">${escH(l.account)}</span>`:''}${name}</div>${sub?`<div class="merchant-sub">${sub}</div>`:''}</td>
        <td class="num hide-sm">${isDr&&amt?rp(amt):''}</td><td class="num hide-sm">${!isDr&&amt?rp(amt):''}</td><td class="num only-sm">${amt?rp(amt):''}</td></tr>`;
    };
    const body=dr.map(r=>row(r,true)).join('')+cr.map(r=>row(r,false)).join('');
    const bal=tDr===tCr&&tDr>0,id=s=>ids?` id="en${p}${s}"`:'';
    return`<div class="table-wrap en-jr"${id('Jr')}><table class="data"><thead><tr><th scope="col">Account</th><th scope="col" class="num hide-sm">Debit</th><th scope="col" class="num hide-sm">Credit</th><th scope="col" class="num only-sm">Amount</th></tr></thead>
      <tbody>${body||'<tr><td colspan="4" class="muted">No lines yet</td></tr>'}</tbody>
      <tfoot><tr class="bk-tot"><td>Total ${bal?'<span class="badge good">Balanced</span>':`<span class="badge bad"${id('Diff')} data-raw="${tDr-tCr}">Off by ${rpSigned(Math.abs(tDr-tCr))}</span>`}</td>
        <td class="num hide-sm"${id('DrTot')} data-raw="${tDr}">${rp(tDr)}</td><td class="num hide-sm"${id('CrTot')} data-raw="${tCr}">${rp(tCr)}</td><td class="num only-sm">${rp(tDr)}</td></tr></tfoot></table></div>`;
  }
  // A card shows the journal unless the owner tapped Edit.
  const journalMode=E=>!!(D&&D.ai&&!E.editing);
  function naHTML(){
    if(!D.newAccounts.length)return'';
    const parents=Object.values(accounts()).filter(a=>a&&isHeader(a)&&!isArchived(a)).sort((p,q)=>String(p.id).localeCompare(String(q.id),undefined,{numeric:true}));
    return`<div class="en-sec" id="enNew"><h3 class="label">New account${D.newAccounts.length===1?'':'s'} Claude proposes</h3>
      <p class="help" style="margin:0 0 4px">Not in your book yet. Check each one and add it, or remove it and pick an existing account.</p>
      ${D.newAccounts.map((a,j)=>a.added?`<div class="en-na" data-j="${j}"><div class="li-body" style="grid-column:1/-1"><span class="bk-code">${escH(a.id)}</span>${escH(a.name)} <span class="badge good">Added to your book</span></div></div>`
      :`<div class="en-na" data-j="${j}">
        <div class="field"><label class="label" for="enNaId${j}">Code</label><input class="input" id="enNaId${j}" data-na="id" value="${escH(a.id)}" autocomplete="off"></div>
        <div class="field en-na-name"><label class="label" for="enNaName${j}">Name</label><input class="input" id="enNaName${j}" data-na="name" value="${escH(a.name)}" autocomplete="off"></div>
        <div class="field"><label class="label" for="enNaKind${j}">Kind</label><select class="input" id="enNaKind${j}" data-na="kind">${KINDS.map(k=>`<option value="${k}"${k===a.kind?' selected':''}>${KIND_LABEL[k]}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="enNaCcy${j}">Currency</label><input class="input" id="enNaCcy${j}" data-na="ccy" maxlength="3" value="${escH(a.ccy)}" autocomplete="off"></div>
        <div class="field"><label class="label" for="enNaPar${j}">Under</label><select class="input" id="enNaPar${j}" data-na="parent"><option value="">(top level)</option>${parents.map(p=>`<option value="${escH(p.id)}"${p.id===a.parent?' selected':''}>${escH(p.id)} · ${escH(p.name)}</option>`).join('')}</select></div>
        <div style="display:flex;gap:4px"><button class="btn btn-secondary btn-sm" data-en="naadd" data-j="${j}">${ic('plus','s16')}Add</button><button class="icon-btn sm" data-en="nadel" data-j="${j}" aria-label="Remove the proposed account" title="Remove">${ic('x','s16')}</button></div>
      </div>`).join('')}</div>`;
  }
  // Claude's assumptions, its questions with an answer box each, and Answer & redraft.
  function aqHTML(){
    if(!D.ai)return'';
    const a=D.assumptions||[],q=D.questions||[];
    return`<div class="en-sec" id="enAQ">${a.length?`<h3 class="label">Claude assumed</h3><ul>${a.map(x=>`<li>${escH(x)}</li>`).join('')}</ul>`:''}
      ${q.length?`<h3 class="label" style="margin-top:10px">Claude asks</h3><div class="en-qs">${q.map((x,j)=>`<div class="field"><label class="label en-q" for="enQA${j}">${escH(x)}</label>
        <input class="input" id="enQA${j}" data-qa="${j}" autocomplete="off" placeholder="Your answer" value="${escH((D.answers||[])[j]||'')}"></div>`).join('')}</div>`:''}
      <div class="field" style="margin-top:10px"><label class="label" for="enMore">${q.length?'Anything else to add or correct?':'Anything to add or correct?'}</label>
        <textarea class="input" id="enMore" rows="2" placeholder="e.g. the transfer was on the 9th, with a Rp 6.500 fee">${escH(D.more||'')}</textarea></div>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px"><button class="btn btn-secondary btn-sm" data-en="redraft" id="enRedraft">${ic('sparkles','s16')}Answer &amp; redraft</button>
        <span class="help">Sends your answers and the draft as it is now back to Claude; entries already posted stay as they are.</span></div></div>`;
  }
  function entryFieldsHTML(E,k){
    const p=pre(k);
    return`<div class="form-grid">
        <div class="field"><label class="label" for="en${p}Date">Date</label><input class="input" id="en${p}Date" data-e="date" type="date" value="${escH(E.date)}"></div>
        <div class="field"><label class="label" for="en${p}Desc">Description</label><input class="input" id="en${p}Desc" data-e="desc" autocomplete="off" value="${escH(E.description)}"></div>
        ${D.mode==='edit'?`<div class="field full"><label class="label" for="enWhy">Why the change</label><input class="input" id="enWhy" data-e="why" autocomplete="off" placeholder="e.g. wrong account" value="${escH(E.why||'')}"></div>`:''}
      </div>
      <div class="en-lines" id="en${p}Lines">${E.lines.map((l,i)=>lineHTML(E,k,l,i)).join('')}</div>
      <div><button class="btn btn-ghost btn-sm" data-en="addline" data-k="${k}">${ic('plus','s16')}Add line</button></div>
      <div class="en-tot" id="en${p}Tot"></div>
      <h3 class="label en-jr-h">The journal this makes</h3><div id="en${p}JrPrev">${journalHTML(E,k,false)}</div>
      <div id="en${p}Warn"></div><div id="en${p}Lock"></div>
      <div class="en-checks" id="en${p}Checks" role="status" aria-live="polite"></div>`;
  }
  // A drafted card read as a journal: date and description on top, the lines, the checks.
  function journalCardHTML(E,k){
    const p=pre(k);
    return`<div class="en-when" id="en${p}When">${escH(dayLong(E.date))}${E.description?` · ${escH(E.description)}`:''}</div>
      ${journalHTML(E,k,true)}
      <div id="en${p}Warn"></div><div id="en${p}Lock"></div>
      <div class="en-checks" id="en${p}Checks" role="status" aria-live="polite"></div>`;
  }
  function cardHTML(E,k){
    const dup=E.dup&&E.dup.length;
    return`<section class="en-card en-entry${E.include?'':' off'}" data-k="${k}" id="enE${k}" aria-label="Entry ${E.n}">
      <div class="en-card-head"><span class="en-num">${E.n}</span><span class="li-title">Entry ${E.n} of ${D.total}</span><span class="badge accent">AI</span><span class="en-grow"></span>
        <label class="check"><input type="checkbox" data-e="inc" id="enE${k}Inc" ${E.include?'checked':''}> Include</label></div>
      ${dup?`<div class="en-note warn en-dup" id="enE${k}Dup">${ic('triangle-alert','s16')}<span>Already in your book: ${E.dup.length===1?'its statement line is':'its statement lines are'} used by an entry you posted before. It is left out unless you tick Include.</span></div>`:''}
      ${E.same&&E.same.length?`<div class="en-note warn en-dup" id="enE${k}Same">${ic('triangle-alert','s16')}<span>Same bank line as entry ${E.same.join(' and ')}: one statement line can back only one entry. It is left out unless you tick Include.</span></div>`:''}
      ${journalMode(E)?journalCardHTML(E,k):entryFieldsHTML(E,k)}
      <div class="en-card-foot"><button class="btn btn-ghost btn-sm" data-en="edit1" data-k="${k}" id="enE${k}Edit">${journalMode(E)?`${ic('pencil','s16')}Edit`:`${ic('check','s16')}Done editing`}</button>
        <button class="btn btn-ghost btn-sm" data-en="remove" data-k="${k}" id="enE${k}Remove">${ic('x','s16')}Remove</button>
        <button class="btn btn-ghost btn-sm" data-en="draft1" data-k="${k}" id="enE${k}Draft" disabled title="Keep it as a draft journal: it touches no balance until you post it">${ic('save','s16')}Save as draft</button>
        <button class="btn btn-secondary btn-sm" data-en="post1" data-k="${k}" id="enE${k}Post" disabled>${ic('check','s16')}Post</button></div></section>`;
  }
  function postedHTML(){
    const ps=(D.posted||[]).filter(p=>!p.draft),ds=(D.posted||[]).filter(p=>p.draft);
    return(ps.length?`<div class="en-note good" id="enPosted">${ic('square-check','s16')}<span>Posted from this prompt: ${ps.map(p=>`${escH(p.description||'Entry '+p.n)}${p.number?` (${escH(p.number)})`:''}`).join(' · ')}</span></div>`:'')
      +(ds.length?`<div class="en-note" id="enSavedDrafts">${ic('save','s16')}<span>Saved as drafts from this prompt: ${ds.map(p=>escH(p.description||'Entry '+p.n)).join(' · ')}. They wait in Journals until you post them.</span></div>`:'');
  }
  // A posted (or void) journal read in the editor: number, status and kind, then the journal.
  function readHTML(){
    const v=ledgerVoucher(D.id),E=D.entries[0];if(!v)return'';
    const st=v.status==='void'?'<span class="badge" style="text-decoration:line-through">Void</span>':'<span class="badge good">Posted</span>';
    const yearEnd=kindOf(v)==='year-end',M=monthOfD(v.date);
    const lock=yearEnd?`<div class="en-note warn en-lock" id="enLock" role="status">${ic('lock','s16')}<span>Made by the year-end close. Reopen December in <button class="bk-link" data-en-act="periods">Periods</button> to change it.</span></div>`
      :v.status==='posted'?lockNoteHTML(M,'change entries','enLock'):'';
    return`<div class="en-head" id="enHead"><span class="en-no">${escH(v.number||'')}</span>${st}${originBadge(v)}${v.refNo?`<span class="faint">Accurate ${escH(v.refNo)}</span>`:''}</div>
      ${lock}<div class="en-when" id="enWhen">${escH(dayLong(E.date))}${E.description?` · ${escH(E.description)}`:''}</div>
      ${journalHTML(E,0,true)}${historyHTML(v)}`;
  }
  function formHTML(){
    if(readOnly())return readHTML();
    const warn=D.mode==='edit'&&D.kind==='accurate'
      ?`<div class="en-note warn" id="enAccWarn">${ic('triangle-alert','s16')}<span>This journal came from Accurate. Once you change it here your book differs from Accurate from now on; a later Accurate export notes it but never overwrites it.</span></div>`:'';
    const head=D.mode==='draft'?`<div class="en-head" id="enHead"><span class="en-no draft">(draft)</span><span class="badge info">Draft</span>${originBadge({kind:D.kind})}${D.refNo?`<span class="faint">Accurate ${escH(D.refNo)}</span>`:''}</div>`
      :D.mode==='edit'?`<div class="en-head" id="enHead"><span class="en-no">${escH(D.number||'')}</span><span class="badge good">Posted</span>${originBadge({kind:D.kind})}</div>`:'';
    const list=`<datalist id="enAccList">${postable().map(a=>`<option value="${escH(a.id)}">${escH(a.id)} · ${escH(a.name)}${a.ccy&&a.ccy!=='IDR'?' · '+escH(a.ccy):''}</option>`).join('')}</datalist>`;
    if(!D.ai)return`${head}${warn}<div class="en-entry" data-k="0">${entryFieldsHTML(D.entries[0],0)}</div>${naHTML()}${list}`;
    const cards=D.entries.length?`<div class="en-cards" id="enCards">${D.entries.map(cardHTML).join('')}</div>`
      :`<div class="en-empty" id="enNoEntries"><p class="muted" style="margin:0 0 8px">${D.posted&&D.posted.length?'Nothing left to post from this prompt.':'No entries drafted yet: Claude needs your answers first.'}</p>
        <button class="btn btn-ghost btn-sm" data-en="manual" id="enManual">${ic('pencil','s16')}Fill one in by hand instead</button></div>`;
    return`${postedHTML()}${cards}${naHTML()}${aqHTML()}${list}`;
  }
  function footHTML(){
    if(D.ai)return`<button class="btn btn-ghost" data-en="cancel">Cancel</button><button class="btn btn-secondary" data-en="saveall" id="enSaveAll" disabled>${ic('save','s16')}Save all as drafts (${remaining().length})</button><button class="btn btn-primary" data-en="postall" id="enPostAll" disabled>${ic('check','s16')}Post all (${remaining().length})</button>`;
    if(D.mode==='edit')return`<button class="btn btn-secondary" data-en="cancel">Cancel</button><button class="btn btn-primary" data-en="post" id="enPost" disabled>${ic('check','s16')}Save changes</button>`;
    if(D.mode==='view'){const v=ledgerVoucher(D.id),posted=v&&v.status==='posted';
      return`<button class="btn btn-ghost" data-en="copy" id="enCopy">${ic('copy','s16')}Copy</button>${posted?`<button class="btn btn-ghost" data-en="voidj" id="enVoidBtn" style="color:var(--bad)">${ic('ban','s16')}Void</button><button class="btn btn-secondary" data-en="editj" id="enEditBtn">${ic('pencil','s16')}Edit</button>`:''}`;}
    if(D.mode==='locked')return`<button class="btn btn-ghost" data-en="copy" id="enCopy">${ic('copy','s16')}Copy</button><button class="btn btn-secondary" data-en="cancel">Close</button>`;
    const first=D.mode==='draft'?`<button class="btn btn-ghost" data-en="deldraft" id="enDelDraft" style="color:var(--bad)">${ic('trash','s16')}Delete draft</button>`
      :`<button class="btn btn-ghost" data-en="cancel">Cancel</button>`;
    return`${first}<button class="btn btn-secondary" data-en="savedraft" id="enSaveDraft" disabled title="Ctrl+S">${ic('save','s16')}Save draft</button><button class="btn btn-primary" data-en="post" id="enPost" disabled title="Ctrl+Enter">${ic('check','s16')}Post</button>`;
  }
  // The in-place confirm (a bk-check row above the footer): Post with its date, total and the number
  // it will get; Delete draft. Nothing changes until the owner confirms here.
  function confirmHTML(){
    if(!D||!D.confirm||D.ai)return'';
    if(D.confirm==='delete')return`<div class="bk-check en-confirm" id="enConfirm" data-c="delete">${ic('trash','s16')}<span class="li-body"><span class="li-title" style="display:block">Delete this draft?</span><span class="li-sub" style="display:block">It isn’t in your book; once deleted it can’t be opened again.</span></span>
      <span class="en-cbtns"><button class="btn btn-ghost btn-sm" data-en="confirmno">Keep it</button><button class="btn btn-danger btn-sm" data-en="delgo" id="enDelGo">${ic('trash','s16')}Delete draft</button></span></div>`;
    const E=D.entries[0],dr=E.lines.reduce((t,l)=>t+Math.max(0,(l.debit||0)-(l.credit||0)),0);
    return`<div class="bk-check en-confirm" id="enConfirm" data-c="post">${ic('info','s16')}<span class="li-body"><span class="li-title" style="display:block">Post on ${escH(dayLong(E.date))} · total ${rp(dr)}</span><span class="li-sub" style="display:block">It gets the next journal number and counts in every balance and report.</span></span>
      <span class="en-cbtns"><button class="btn btn-ghost btn-sm" data-en="confirmno">Not yet</button><button class="btn btn-primary btn-sm" data-en="postgo" id="enPostGo">${ic('check','s16')}Post now</button></span></div>`;
  }
  function bodyHTML(){return`<div id="enRoot">${askHTML()}<div id="enNoteHost">${noteHTML()}</div><div id="enForm">${formHTML()}</div><div id="enConfirmHost">${confirmHTML()}</div></div>`;}
  function rerender(focusSel){
    if(!SH)return;const host=SH.sheet.querySelector('.sheet-body');if(!host)return;
    host.innerHTML=bodyHTML();renderFoot();updateChecks();
    if(focusSel){const f=host.querySelector(focusSel);if(f)try{f.focus();}catch(_){}}
  }
  function renderFoot(){const f=SH&&SH.sheet.querySelector('.sheet-foot');if(f)f.innerHTML=footHTML();const c=SH&&SH.sheet.querySelector('#enConfirmHost');if(c)c.innerHTML=confirmHTML();}
  function renderForm(){const f=SH&&SH.sheet.querySelector('#enForm');if(f){f.innerHTML=formHTML();renderFoot();updateChecks();}}
  function setNote(text,tone){D.note=text?{text,tone}:null;const h=SH&&SH.sheet.querySelector('#enNoteHost');if(h)h.innerHTML=noteHTML();}
  function sync(){
    if(!SH)return;const q=s=>SH.sheet.querySelector(s);
    const t=q('#enText');if(t)D.prompt=t.value;
    const m=q('#enMore');if(m)D.more=m.value;
    SH.sheet.querySelectorAll('[data-qa]').forEach(inp=>{(D.answers||(D.answers=[]))[+inp.dataset.qa]=inp.value;});
    SH.sheet.querySelectorAll('.en-entry').forEach(el=>{const E=D.entries[+el.dataset.k];if(!E)return;
      el.querySelectorAll('[data-e]').forEach(inp=>{const f=inp.dataset.e;
        if(f==='date')E.date=inp.value;else if(f==='desc')E.description=inp.value;else if(f==='why')E.why=inp.value;else if(f==='inc')E.include=!!inp.checked;});
      el.querySelectorAll('.en-line').forEach(le=>{const l=E.lines[+le.dataset.i];if(!l)return;
        le.querySelectorAll('[data-f]').forEach(inp=>{const f=inp.dataset.f;
          if(f==='debit'||f==='credit')l[f]=parseRp(inp.value);
          else if(f==='account')l.account=String(inp.value||'').split(/[\s·]/)[0].trim();
          else if(f==='ccy')l.ccy=String(inp.value||'').toUpperCase();
          else l[f]=inp.value;});});});
    SH.sheet.querySelectorAll('.en-na').forEach(el=>{const a=D.newAccounts[+el.dataset.j];if(!a||a.added)return;
      el.querySelectorAll('[data-na]').forEach(inp=>{a[inp.dataset.na]=inp.dataset.na==='ccy'?String(inp.value).toUpperCase():inp.value.trim();});});
  }
  // Splits the book's checks: a closed or locked month shows as the lock note (with the Periods
  // link), everything else as help lines.
  const lockOf=errs=>errs.find(isLockMsg)||null;
  function updateChecks(){
    if(!SH||!D)return;const q=s=>SH.sheet.querySelector(s);
    if(readOnly())return;
    let allOk=true,allDraft=true;
    D.entries.forEach((E,k)=>{
      const p=pre(k);
      E.lines.forEach((l,i)=>{const el=q(`#en${p}AccName${i}`);if(el){const a=accOf(l.account),pend=D.newAccounts.find(n=>n.id===l.account&&!n.added);
          el.textContent=!l.account?'':a?accLabel(a):pend?'New account (confirm below)':'Not in your book';
          el.classList.toggle('bad',!!l.account&&(!a||isHeader(a)||isArchived(a))&&!pend);}
        const h=q(`#en${p}FxHint${i}`);if(h)h.textContent=fxHint(l);});
      const jp=q(`#en${p}JrPrev`);if(jp)jp.innerHTML=journalHTML(E,k,false);
      const dr=E.lines.reduce((s,l)=>s+(l.debit||0),0),cr=E.lines.reduce((s,l)=>s+(l.credit||0),0);
      const tot=q(`#en${p}Tot`);
      if(tot)tot.innerHTML=`<span>Debits <b id="en${p}DrTot" data-raw="${dr}">${rp(dr)}</b></span><span>Credits <b id="en${p}CrTot" data-raw="${cr}">${rp(cr)}</b></span>
        ${dr===cr&&dr>0?'<span class="badge good">Balanced</span>':`<span class="badge bad" id="en${p}Diff" data-raw="${dr-cr}">Off by ${rpSigned(Math.abs(dr-cr))}</span>`}`;
      const errs=errorsOf(E),ch=q(`#en${p}Checks`),lock=lockOf(errs),rest=errs.filter(m=>m!==lock);E.ok=!errs.length;
      E.draftOk=!draftErrorsOf(E).length;
      if(E.include&&errs.length)allOk=false;
      if(E.include&&!E.draftOk)allDraft=false;
      // A backdate of more than 7 days is a warning only (v4 §2); it never blocks.
      const w=q(`#en${p}Warn`),bd=typeof ledgerWarnings==='function'&&ledgerWarnings({date:E.date}).includes('backdated');
      if(w)w.innerHTML=bd?`<div class="en-note warn" id="en${p}Backdate" role="status">${ic('triangle-alert','s16')}<span>Dated more than 7 days ago. You can still ${D.mode==='edit'?'save':'post'} it.</span></div>`:'';
      const lk=q(`#en${p}Lock`);
      if(lk)lk.innerHTML=lock?lockNoteHTML(monthOfD(E.date)||monthOfD(D.origDate),D.mode==='edit'?'change this journal':'post into it',`en${p}LockNote`)
        ||`<div class="en-note warn en-lock" id="en${p}LockNote">${ic('lock','s16')}<span>${escH(lock)} <button class="bk-link" data-en-act="periods">Periods</button></span></div>`:'';
      if(ch)ch.innerHTML=rest.length?rest.map(m=>`<div class="help err">${ic('triangle-alert','s16')}<span>${escH(m)}</span></div>`).join('')
        :lock?'':`<div class="help" style="color:var(--good)">${ic('square-check','s16')} Ready to ${D.mode==='edit'?'save':'post'}: balanced, every account is in your book</div>`;
      const b=q(`#enE${k}Post`);if(b)b.disabled=!!errs.length||!E.include||!!D.busy;
      const bd2=q(`#enE${k}Draft`);if(bd2)bd2.disabled=!E.draftOk||!E.include||!!D.busy;
      const card=q(`#enE${k}`);if(card)card.classList.toggle('off',!E.include);
    });
    const p=q('#enPost');if(p){const errs=D.entries[0]?errorsOf(D.entries[0]):['No entry'];p.disabled=!!errs.length||!!D.busy;p.dataset.errors=String(errs.length);}
    const sd=q('#enSaveDraft');if(sd){const de=D.entries[0]?draftErrorsOf(D.entries[0]):['No entry'];sd.disabled=!!de.length||!!D.busy;sd.dataset.errors=String(de.length);sd.title=de.length?de[0]:'Ctrl+S';}
    // A confirm row whose entry stopped passing the checks goes away.
    if(D.confirm==='post'&&p&&p.disabled){D.confirm=null;const c=q('#enConfirmHost');if(c)c.innerHTML='';}
    const pa=q('#enPostAll');if(pa){const n=remaining().length;pa.disabled=!n||!allOk||!!D.busy;pa.dataset.n=String(n);
      pa.innerHTML=`${ic('check','s16')}Post all (${n})`;}
    const sa=q('#enSaveAll');if(sa){const n=remaining().length;sa.disabled=!n||!allDraft||!!D.busy;sa.dataset.n=String(n);
      sa.innerHTML=`${ic('save','s16')}Save all as drafts (${n})`;}
    const rd=q('#enRedraft');if(rd)rd.disabled=!!D.busy;
  }
  // What the editor holds now, to tell a saved draft from unsaved changes.
  const sigOfE=()=>D&&D.entries[0]?JSON.stringify([D.entries[0].date,D.entries[0].description,voucherOf(D.entries[0]).lines]):'';
  function openForm(d){
    D=d;D.confirm=D.confirm||null;
    SH=openSheet({title:sheetTitle(),body:bodyHTML(),foot:footHTML(),wide:true,focus:readOnly()?'.sheet-foot .btn':D.mode!=='new'?'#enDate':hasKey()?'#enText':'#enDate',onClose:()=>{SH=null;D=null;}});
    SH.sheet.id='enSheet';SH.sheet.dataset.mode=D.mode;
    D.savedSig=D.mode==='draft'?sigOfE():null;
    SH.sheet.addEventListener('input',e=>{if(e.target&&e.target.closest('[data-f],[data-na],[data-e],[data-qa],#enText,#enMore')){sync();updateChecks();}});
    SH.sheet.addEventListener('change',e=>{if(e.target&&e.target.closest('[data-na],[data-e]')){sync();updateChecks();}});
    SH.sheet.addEventListener('click',e=>{const b=e.target.closest('[data-en]');if(!b||b.disabled)return;e.preventDefault();act(b);});
    // Ctrl+S saves the draft, Ctrl+Enter posts (UX §11.10b).
    SH.sheet.addEventListener('keydown',e=>{
      if(!(e.ctrlKey||e.metaKey)||!D||D.ai||readOnly())return;
      const k=String(e.key||'').toLowerCase(),q=s=>SH&&SH.sheet.querySelector(s);
      if(k==='s'){e.preventDefault();e.stopPropagation();sync();updateChecks();const b=q('#enSaveDraft');if(b&&!b.disabled)act(b);}
      else if(k==='enter'){e.preventDefault();e.stopPropagation();sync();updateChecks();const b=q('#enPostGo')||q('#enPost');if(b&&!b.disabled)act(b);}
    });
    updateChecks();
    if(D.confirm){const c=SH.sheet.querySelector('#enConfirmHost');if(c)c.innerHTML=confirmHTML();if(D.confirm==='post'&&SH.sheet.querySelector('#enPost').disabled)D.confirm=null,c.innerHTML='';}
    return SH;
  }
  function showConfirm(c){D.confirm=c;const h=SH&&SH.sheet.querySelector('#enConfirmHost');if(h){h.innerHTML=confirmHTML();const f=h.querySelector(c==='delete'?'#enDelGo':'#enPostGo');if(f)try{f.focus();}catch(_){}}}
  async function act(b){
    const a=b.dataset.en,k=+(b.dataset.k||0),i=+b.dataset.i,j=+b.dataset.j,E=D.entries[k];
    if(!readOnly())sync();
    switch(a){
      // Cancel: a draft saved as it is closes without asking; unsaved changes ask first.
      case'cancel':SH.close(readOnly()||(D.mode==='draft'&&sigOfE()===D.savedSig));return;
      case'settings':SH.close(true);goSettings();return;
      case'addline':if(E){E.lines.push(blankLine());renderForm();const f=SH.sheet.querySelector(`#en${pre(k)}Acc${E.lines.length-1}`);if(f)f.focus();}return;
      case'del':if(E&&E.lines.length>2){E.lines.splice(i,1);renderForm();}return;
      case'fx':{const l=E&&E.lines[i];if(!l)return;l.fxOn=!l.fxOn;if(l.fxOn&&!l.ccy){const ac=accOf(l.account);if(ac&&ac.ccy&&ac.ccy!=='IDR')l.ccy=ac.ccy;}renderForm();return;}
      case'naadd':return addNew(j);
      case'nadel':D.newAccounts.splice(j,1);renderForm();return;
      case'ask':return ask(b,false);
      case'redraft':return ask(b,true);
      case'remove':if(E){D.entries.splice(k,1);renderForm();}return;
      case'edit1':if(E){E.editing=!E.editing;renderForm();const f=SH.sheet.querySelector(E.editing?`#enE${k}Acc0`:`#enE${k}Edit`);if(f)try{f.focus();}catch(_){}}return;
      case'manual':D.ai=false;D.entries=[blankEntry()];D.newAccounts=[];setNote('Fill the entry in by hand below.','');renderForm();return;
      case'post':if(D.mode==='edit')return post();updateChecks();if(errorsOf(D.entries[0]).length)return;showConfirm('post');return;
      case'postgo':return post();
      case'confirmno':D.confirm=null;{const h=SH.sheet.querySelector('#enConfirmHost');if(h)h.innerHTML='';}return;
      case'savedraft':return saveDraft();
      case'deldraft':showConfirm('delete');return;
      case'delgo':return deleteDraft();
      case'copy':return copyJournal(D.id);
      case'voidj':{const id=D.id;SH.close(true);openVoid(id);return;}
      case'editj':{const id=D.id;SH.close(true);openEdit(id);return;}
      case'post1':return postEntries([k],false);
      case'postall':return postEntries(D.entries.map((x,n)=>x.include?n:-1).filter(n=>n>=0),true);
      case'draft1':return saveEntries([k],false);
      case'saveall':return saveEntries(D.entries.map((x,n)=>x.include?n:-1).filter(n=>n>=0),true);
    }
  }
  function addNew(j){
    const a=D.newAccounts[j];if(!a)return;
    try{
      ledgerAddAccount({id:a.id,name:a.name,kind:a.kind,ccy:a.ccy||'IDR',parent:a.parent||null});
      if(a.orig&&a.orig!==a.id)D.entries.forEach(E=>E.lines.forEach(l=>{if(l.account===a.orig)l.account=a.id;}));
      a.added=true;renderForm();toast(`${a.id} added to your book`);
    }catch(e){setNote(String(e&&e.message||e),'bad');}
  }
  /* ── Asking Claude: one call, at most one automatic correction, then the owner's follow-ups ── */
  async function turn(messages){
    const data=await callClaude(draftRequest(null,messages),TIMEOUT_DRAFT);
    const ans=readAnswer(data);
    // Claude's answer goes back unchanged (thinking blocks included) on any later turn.
    return{ans,assistant:{role:'assistant',content:Array.isArray(data.content)?data.content:[]}};
  }
  function correctionText(errs){
    return'Some entries in your answer fail the book\'s checks. Fix them and return the whole answer again (every entry, in the same format). Use only posting accounts (isParent false), whole rupiah, never 0, and make each entry balance.\n'
      +JSON.stringify({errors:errs});
  }
  function draftForAI(){
    const lineOut=l=>({account:l.account,debit:l.debit||0,credit:l.credit||0,memo:l.memo||'',
      fx:l.fxOn?{ccy:String(l.ccy||'').toUpperCase(),amount:Math.abs(num(l.famt)||0),rate:num(l.rate)||0}:null,stmtLine:l.stmtLine||null});
    return{entries:D.entries.map(E=>({date:E.date,description:E.description,lines:E.lines.filter(l=>l.account||l.debit||l.credit).map(lineOut),
      ...(E.include?{}:{leftOut:true})})),newAccounts:D.newAccounts.map(a=>({id:a.id,name:a.name,kind:a.kind,ccy:a.ccy,parent:a.parent||null,addedToBook:!!a.added}))};
  }
  function followUpText(){
    const q=D.questions||[],ans=q.map((x,j)=>({question:x,answer:String((D.answers||[])[j]||'').trim()})).filter(x=>x.answer);
    return JSON.stringify({followUp:true,currentDraft:draftForAI(),postedAlready:(D.posted||[]).map(p=>({date:p.date,description:p.description})),
      answers:ans,ownerNote:String(D.more||'').trim()});
  }
  function applyAnswer(ans){
    const f=answerToForm(ans),used=usedStmtLines(),base=D.posted?D.posted.length:0;
    // A statement line already on a posted voucher, or already cited by an earlier entry of this
    // draft, leaves the entry out until the owner ticks Include.
    const seen=new Map();
    f.entries.forEach((E,k)=>{E.n=base+k+1;const ids=[...new Set(E.lines.map(l=>l.stmtLine).filter(Boolean).map(stmtResolve))];
      E.dup=ids.filter(id=>used.has(id));E.same=[...new Set(ids.filter(id=>!used.has(id)&&seen.has(id)).map(id=>seen.get(id)))];
      ids.forEach(id=>{if(!seen.has(id))seen.set(id,E.n);});E.include=!E.dup.length&&!E.same.length;});
    // A proposed account the owner already added keeps its "added" state.
    const added=new Map(D.newAccounts.filter(a=>a.added).map(a=>[a.id,a]));
    D.newAccounts=f.newAccounts.filter(a=>!accOf(a.id)).concat([...added.values()].filter(a=>f.entries.some(E=>E.lines.some(l=>l.account===a.id))));
    D.ai=true;D.entries=f.entries;D.total=base+f.entries.length;
    D.assumptions=ans.assumptions;D.questions=ans.questions;D.answers=[];D.more='';
  }
  async function ask(btn,followUp){
    const text=String(D.prompt||'').trim();
    if(!text){setNote('Write a sentence first, e.g. what you bought or paid, from which account, and the amount.','warn');return;}
    if(D.busy)return;
    if(followUp&&!D.convo){followUp=false;}
    if(followUp&&!String(D.more||'').trim()&&!(D.answers||[]).some(x=>String(x||'').trim())){setNote('Answer a question or say what to change first.','warn');return;}
    // A fresh draft for a different sentence starts a new batch: nothing posted from the old
    // sentence counts as posted from this one, and its conversation is not continued.
    if(!followUp&&D.drafted!=null&&text!==D.drafted){D.batch=null;D.posted=[];D.convo=null;D.total=0;}
    const me=D;
    D.busy=true;btn.disabled=true;const lbl=btn.innerHTML;btn.innerHTML=`${ic('sparkles','s16')}${followUp?'Redrafting…':'Drafting…'}`;btn.setAttribute('aria-busy','true');
    setNote('Asking Claude…','');updateChecks();
    let msgs=followUp?[...D.convo,{role:'user',content:followUpText()}]:[{role:'user',content:JSON.stringify(contextForAI(text))}];
    let got=null,stuck=null;
    try{
      const r=await turn(msgs);if(D!==me)return;
      msgs=[...msgs,r.assistant];got=r.ans;
      const errs=aiErrorsOf(answerToForm(r.ans));
      if(errs.length){
        setNote('Claude’s first draft didn’t pass the checks; asking it to fix them…','');
        msgs=[...msgs,{role:'user',content:correctionText(errs)}];
        try{const r2=await turn(msgs);if(D!==me)return;msgs=[...msgs,r2.assistant];got=r2.ans;
          const e2=aiErrorsOf(answerToForm(r2.ans));if(e2.length)stuck=e2;}
        catch(e){if(D!==me)return;
          // The correction got no answer: drop it so the conversation still alternates user/assistant.
          msgs=msgs.slice(0,-1);stuck=errs;stuck.err=clean(e&&e.message||e);}
      }
      if(!D.batch)D.batch=`b-${todayISO().replace(/-/g,'')}-${Math.floor(Math.random()*16777216).toString(16).padStart(6,'0')}`;
      D.convo=msgs;D.prompt=text;D.drafted=text;D.fromAI=true;applyAnswer(got);
      // An entry that still fails the book's checks opens in Edit, so what to fix is in front of the owner.
      D.entries.forEach(E=>{E.editing=aiErrorsOf({entries:[E],newAccounts:D.newAccounts}).length>0;});
      const n=D.entries.length,dups=D.entries.filter(E=>E.dup.length).length,same=D.entries.filter(E=>!E.dup.length&&E.same.length).length;
      D.note=stuck?{text:`Claude couldn’t fix ${stuck.length===1?'one entry':stuck.length+' entries'}${stuck.err?' ('+stuck.err+')':''}: ${stuck.map(s=>`entry ${s.entry}: ${s.errors.join('; ')}`).join(' · ')}. Correct ${stuck.length===1?'it':'them'} below, remove ${stuck.length===1?'it':'them'}, or answer and redraft.`,tone:'warn'}
        :!n?{text:'Claude needs more before it can draft this. Answer its questions below and tap Answer & redraft.',tone:'warn'}
        :{text:`Claude drafted ${n===1?'one entry':n+' entries'}${dups?`; ${dups===1?'one is':dups+' are'} already in your book and left out`:''}${same?`; ${same===1?'one uses':same+' use'} the same bank line as an earlier entry and ${same===1?'is':'are'} left out`:''}. Read each journal below; tap Edit to change one, then post.`,tone:dups||same?'warn':''};
    }catch(e){
      if(D!==me)return;
      const msg=clean(e&&e.message||e);
      if(followUp)D.note={text:`${msg} Your draft is unchanged${e&&e.kind!=='auth'&&e.kind!=='refusal'?'; try again':''}.`,tone:e&&e.kind==='auth'?'bad':'warn'};
      else D.note={text:`${msg} Fill the entry in by hand below${e&&e.kind!=='auth'&&e.kind!=='refusal'?', or try again':''}.`,tone:e&&e.kind==='auth'?'bad':'warn'};
      D.aiError=e&&e.kind||'error';
    }finally{
      me.busy=false;
      // A late answer never lands in another sheet (the owner closed this one, maybe opened a new one).
      if(D===me)rerender();
      else{btn.disabled=false;btn.innerHTML=lbl;btn.removeAttribute('aria-busy');}
    }
  }
  const noteBackdate=v=>typeof ledgerWarnings==='function'&&ledgerWarnings(v).includes('backdated')?' · dated more than 7 days ago':'';
  const numberOf=id=>{const v=ledgerVoucher(id);return v&&v.number||'';};
  // Post (new or draft, after the confirm row) or Save changes (edit). Posting takes the next number.
  function post(){
    const E=D.entries[0],v=voucherOf(E),errs=errorsOf(E);
    if(errs.length){D.confirm=null;renderFoot();updateChecks();return;}
    try{
      if(D.mode==='edit'){
        const id=D.id,key=D.key;ledgerEdit(id,v,String(E.why).trim());
        SH.close(true);toast(`Saved${numberOf(id)?' '+numberOf(id):''} · the earlier version stays in its history`);openVoucherKey(key);
      }else if(D.mode==='draft'){
        const id=D.id;
        if(sigOfE()!==D.savedSig)ledgerSaveDraft(v,{id,why:'Changed before posting'});
        D.savedSig=sigOfE();
        ledgerPostDraft(id,{why:'Posted from the editor'});
        SH.close(true);toast(`Posted as ${numberOf(id)}${noteBackdate(v)}`);openVoucherKey(id);
      }else{
        const id=ledgerPost(v,{kind:'manual',why:'Entered by hand'});
        SH.close(true);toast(`Posted as ${numberOf(id)}${noteBackdate(v)}`);openVoucherKey(id);
      }
    }catch(e){D.confirm=null;renderFoot();const m=((e&&e.errors)||[String(e&&e.message||e)]).join(' · ');setNote(m,isLockMsg(m)?'warn':'bad');updateChecks();}
  }
  // Save draft (Ctrl+S): never touches a balance; the editor stays open on the saved draft.
  function saveDraft(){
    const E=D.entries[0],errs=draftErrorsOf(E);if(errs.length){updateChecks();return;}
    try{
      const v=voucherOf(E),first=D.mode!=='draft';
      const id=ledgerSaveDraft(v,first?{kind:'manual',why:'Saved as a draft'}:{id:D.id,why:'Changed in the editor'});
      D.mode='draft';D.id=id;D.kind=D.kind||'manual';D.savedSig=sigOfE();D.confirm=null;
      SH.sheet.dataset.mode='draft';const t=SH.sheet.querySelector('.sheet-title');if(t)t.textContent=sheetTitle();
      if(first){const f=SH.sheet.querySelector('#enForm');if(f)f.innerHTML=formHTML();}
      setNote(first?'Saved as a draft. It touches no balance until you post it.':'Draft saved.','good');renderFoot();updateChecks();
      toast(first?'Saved as a draft':'Draft saved');
    }catch(e){setNote(((e&&e.errors)||[String(e&&e.message||e)]).join(' · '),'bad');updateChecks();}
  }
  function deleteDraft(){
    try{ledgerDeleteDraft(D.id,'Deleted in the editor');SH.close(true);toast('Draft deleted');}
    catch(e){D.confirm=null;renderFoot();setNote(((e&&e.errors)||[String(e&&e.message||e)]).join(' · '),'bad');}
  }
  // Copy: a new draft dated today with the same description and lines (kind manual), opened at once.
  function copyJournal(id){
    let nid;try{nid=ledgerCopy(id);}catch(e){errToast(e);return null;}
    if(SH)SH.close(true);toast('Copied to a new draft dated today');return openDraft(nid);
  }
  // Posts drafted entries (one card, or every included one): each its own journal, kind ai, the
  // drafted sentence as prompt and the shared batch id. Stops at the first refusal and keeps the
  // sheet open: posted entries leave the cards (listed as posted, never posted again), the rest stay.
  function postEntries(ks,all){
    if(!D||D.busy)return;
    const list=ks.map(k=>D.entries[k]).filter(E=>E&&E.include);
    if(!list.length||list.some(E=>errorsOf(E).length)){updateChecks();return;}
    const ids=[];let failed=null;
    for(const E of list){
      try{const id=ledgerPost({...voucherOf(E),prompt:D.drafted||D.prompt,batch:D.batch},{kind:'ai',why:'Drafted by Claude, checked and posted by you'});
        ids.push(id);(D.posted||(D.posted=[])).push({id,n:E.n,date:E.date,description:E.description,number:numberOf(id)});D.entries.splice(D.entries.indexOf(E),1);}
      catch(e){failed={E,why:((e&&e.errors)||[String(e&&e.message||e)]).join(' · ')};break;}
    }
    if(failed){
      setNote(`${ids.length} posted, 1 failed: entry ${failed.E.n}: ${failed.why}. ${D.entries.length===1?'It is':`The ${D.entries.length} entries not posted are`} still below; fix and post again.`,'bad');
      if(ids.length)toast(`Posted ${ids.length} ${ids.length===1?'entry':'entries'} · 1 failed`);
      renderForm();return;
    }
    if(!ids.length){renderForm();return;}
    const nos=ids.map(numberOf).filter(Boolean);
    if(all||!D.entries.length){
      const left=D.entries.length;SH.close(true);
      toast(ids.length===1?`Posted as ${nos[0]||'a journal'}${left?` · ${left} left out`:''}`:`Posted ${ids.length} entries as ${nos[0]}–${nos[nos.length-1]}${left?` · ${left} left out`:''}`);
      openVoucherKey(ids[0]);return;
    }
    setNote(`Posted entry ${list[0].n} as ${nos[0]}. ${D.entries.length===1?'One entry is':D.entries.length+' entries are'} still to check.`,'good');
    toast(`Posted as ${nos[0]}`);renderForm();
  }
  // "Save as draft" for drafted entries (one card, or every included one): each its own draft
  // journal, kind ai, with the sentence and the batch id. A draft may be unbalanced and touches no
  // balance; it waits in Journals. Saved entries leave the cards like posted ones.
  function saveEntries(ks,all){
    if(!D||D.busy)return;
    const list=ks.map(k=>D.entries[k]).filter(E=>E&&E.include);
    if(!list.length||list.some(E=>draftErrorsOf(E).length)){updateChecks();return;}
    const ids=[];let failed=null;
    for(const E of list){
      try{const id=ledgerSaveDraft({...voucherOf(E),prompt:D.drafted||D.prompt,batch:D.batch},{kind:'ai',why:'Drafted by Claude, saved as a draft by you'});
        ids.push(id);(D.posted||(D.posted=[])).push({id,n:E.n,date:E.date,description:E.description,draft:true});D.entries.splice(D.entries.indexOf(E),1);}
      catch(e){failed={E,why:((e&&e.errors)||[String(e&&e.message||e)]).join(' · ')};break;}
    }
    if(failed){setNote(`${ids.length} saved, 1 failed: entry ${failed.E.n}: ${failed.why}.`,'bad');renderForm();return;}
    if(!ids.length){renderForm();return;}
    if(all||!D.entries.length){const left=D.entries.length;SH.close(true);
      toast(`Saved ${ids.length===1?'as a draft':ids.length+' drafts'}${left?` · ${left} left out`:''} · post ${ids.length===1?'it':'them'} from Journals`);openVoucherKey(ids[0]);return;}
    setNote(`Saved entry ${list[0].n} as a draft. ${D.entries.length===1?'One entry is':D.entries.length+' entries are'} still to check.`,'good');
    toast('Saved as a draft');renderForm();
  }
  function openVoucherKey(key){if(typeof window.openVoucher==='function')window.openVoucher(key);}
  function goSettings(){setTab('settings');setTimeout(()=>{const e=document.getElementById('set-ai');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});},60);}

  /* ── Entry points ── */
  function canPost(){return seeded();}
  function openNew(o){
    if(!canPost()){toast('Set up your book first (Settings › Your book)');return null;}
    aiEnsure();o=o||{};
    return openForm({mode:'new',kind:'manual',ai:false,entries:[blankEntry(o.date)],newAccounts:[],assumptions:[],questions:[],answers:[],more:'',prompt:'',fromAI:false,note:null,posted:[],convo:null,batch:null});
  }
  function ledgerVoucher(id){const x=L();const v=x&&x.vouchers[id]||null;return v&&v.status!=='deleted'?v:null;}
  function keyOf(v){return kindOf(v)==='accurate'?(v.srcKey||v.id):v.id;}
  const entryOf=v=>{const lines=(v.lines||[]).map(lineFrom);while(lines.length<2)lines.push(blankLine());return{date:v.date,description:v.description||'',lines,why:'',include:true,dup:[]};};
  const lockedV=v=>kindOf(v)==='year-end'||periodOf(monthOfD(v.date))!=='open';
  // A draft in the editor: Delete draft · Save draft · Post. o.confirm 'post' | 'delete' opens with
  // that confirm row showing (the Journals panel's Post / Delete draft buttons).
  function openDraft(id,o){
    const v=ledgerVoucher(id);if(!v){toast('That journal isn’t in your book');return null;}
    if(v.status!=='draft')return openJournal(id);
    o=o||{};
    return openForm({mode:'draft',ai:false,id,key:v.id,kind:kindOf(v),refNo:v.refNo||'',entries:[entryOf(v)],newAccounts:[],assumptions:[],questions:[],note:null,posted:[],confirm:o.confirm||null});
  }
  // A posted or void journal, read-only: Copy · Void · Edit (posted, open month), Copy only when its
  // month is closed or locked or it is a year-end journal.
  function openJournal(id){
    const v=ledgerVoucher(id);if(!v){toast('That journal isn’t in your book');return null;}
    if(v.status==='draft')return openDraft(id);
    return openForm({mode:v.status==='posted'&&lockedV(v)?'locked':'view',ai:false,id,key:keyOf(v),kind:kindOf(v),entries:[entryOf(v)],newAccounts:[],assumptions:[],questions:[],note:null,posted:[]});
  }
  function openEdit(id){
    const v=ledgerVoucher(id);if(!v){toast('That journal isn’t in your book');return null;}
    if(v.status==='draft')return openDraft(id);
    if(v.status!=='posted'){toast('A void journal can’t be edited');return null;}
    // The book refuses the edit in a closed or locked month (and of a year-end journal): read-only.
    if(lockedV(v))return openJournal(id);
    return openForm({mode:'edit',ai:false,id,key:keyOf(v),kind:kindOf(v),number:v.number||'',origDate:v.date,entries:[entryOf(v)],newAccounts:[],assumptions:[],questions:[],note:null,posted:[]});
  }
  function openVoid(id){
    const v=ledgerVoucher(id);if(!v||v.status!=='posted')return null;
    if(kindOf(v)==='year-end'){toast('A year-end journal can’t be voided by hand; reopen December in Periods instead',{action:'Periods',onAction:goPeriods,duration:9000});return null;}
    const M=monthOfD(v.date),st=periodOf(M);
    if(st!=='open'){toast(`This journal is in ${mLong(M)}, which is ${st}`,{action:'Periods',onAction:goPeriods,duration:9000});return null;}
    const dr=(v.lines||[]).reduce((s,l)=>s+(l.amount>0?l.amount:0),0);
    const body=`${kindOf(v)==='accurate'?`<div class="en-note warn">${ic('triangle-alert','s16')}<span>This journal came from Accurate. Voiding it here means your book differs from Accurate from now on.</span></div>`:''}
      <p class="muted" style="margin:0 0 12px">${v.number?`${escH(v.number)} · `:''}${escH(v.description||'Journal')} · ${escH(dayLong(v.date))} · ${rp(dr)}</p>
      <div class="field"><label class="label" for="enVoidWhy">Why void it</label><input class="input" id="enVoidWhy" autocomplete="off" placeholder="e.g. entered twice"></div>
      <p class="help" style="margin-top:8px">It stays in your book marked void, with its number and history; balances and reports leave it out. Nothing is deleted.</p>`;
    const s=openSheet({title:'Void journal',body,foot:`<button class="btn btn-secondary" data-close-void>Cancel</button><button class="btn btn-danger" id="enVoidGo" disabled>${ic('ban','s16')}Void journal</button>`,focus:'#enVoidWhy'});
    const inp=s.sheet.querySelector('#enVoidWhy'),go=s.sheet.querySelector('#enVoidGo');
    inp.addEventListener('input',()=>{go.disabled=!inp.value.trim();});
    s.sheet.querySelector('[data-close-void]').addEventListener('click',()=>s.close(true));
    go.addEventListener('click',()=>{const why=inp.value.trim();if(!why)return;
      try{ledgerVoid(id,why);s.close(true);toast(`Voided${v.number?' '+v.number:''} · it stays in your book with its history`);openVoucherKey(keyOf(v));}catch(e){errToast(e);}});
    return s;
  }

  /* ── Voucher detail extras (js/books.js calls these) ── */
  // The kind badge (UX §11.10b): Manual · AI · Month-end · Income · Opening · Year-end · From Accurate.
  // data-kind is the v4 kind; data-origin keeps the v3 name for older readers.
  function originBadge(v){
    const k=kindOf(v);if(!k||!KIND_BADGE[k])return'';
    const[t,tone]=KIND_BADGE[k];return`<span class="badge${tone?' '+tone:''}" data-kind="${escH(k)}" data-origin="${escH(v3Name(k))}">${escH(t)}</span>`;
  }
  // A books-shaped voucher for a key the view leaves out (a void one), straight from the ledger.
  function voucherByKey(key){
    const x=L();if(!x||key==null)return null;key=String(key);
    const v=Object.values(x.vouchers).find(y=>y&&keyOf(y)===key);if(!v)return null;
    const k=kindOf(v);
    return{key,id:v.id,kind:k,origin:v3Name(k),status:v.status,date:v.date,number:v.number||'',refNo:v.refNo||'',source:k==='accurate'?(v.source||''):'App',type:v.type||'',description:v.description||'',
      lines:(v.lines||[]).map(l=>({account:l.account,amount:l.amount,description:l.memo||'',...(l.fx?{fx:{...l.fx}}:{})}))};
  }
  function voidList(){const x=L();if(!x)return[];return Object.values(x.vouchers).filter(v=>v&&v.status==='void').sort((p,q)=>q.date.localeCompare(p.date)||String(q.id).localeCompare(String(p.id)))
    .map(v=>({key:keyOf(v),id:v.id,date:v.date,description:v.description||v.number||'Voucher',debit:(v.lines||[]).reduce((s,l)=>s+(l.amount>0?l.amount:0),0)}));}
  function linesTable(ls){
    return`<table><tbody>${(ls||[]).map(l=>{const a=Math.round(l.amount||0),ac=accOf(String(l.account));
      return`<tr><td><span class="bk-code">${escH(l.account)}</span>${escH(ac?ac.name:'')}${l.fx?` <span class="badge">${escH(l.fx.ccy)} ${escH(fx4(l.fx.amount))} @ ${escH(fx4(l.fx.rate))}</span>`:''}</td><td class="num">${a>0?rp(a):''}</td><td class="num">${a<0?rp(-a):''}</td></tr>`;}).join('')}</tbody></table>`;
  }
  function historyHTML(v){
    // Each entry keeps the state BEFORE the change; the state after it is the next entry's "before"
    // (or the voucher as it is now), so a change from posted to void is the void.
    const all=v.history||[],after=k=>k+1<all.length?(all[k+1].before||{}):{status:v.status};
    const who=w=>/Accurate/.test(w||'')?'From an Accurate import':'By you';
    const kind=k=>{const e=all[k],b=e.before||{};
      if(b.status==='posted'&&after(k).status==='void')return'Voided';
      return/Accurate/.test(e.why||'')?'Accurate’s version taken':'Changed';};
    const h=all.map((e,k)=>({e,label:kind(k)})).reverse();
    const k=kindOf(v),created=k==='accurate'?'Imported from Accurate':k==='ai'?(v.status==='draft'?'Drafted by Claude, saved as a draft':'Drafted by Claude, posted by you'):k==='manual'?(v.status==='draft'?'Saved as a draft':'Entered by hand')
      :k==='year-end'?'Made by the year-end close':`Posted from ${KIND_BADGE[k]?KIND_BADGE[k][0]:k}`;
    return`<div class="en-sec" id="enHist"><h3 class="label">${ic('history','s16')} History</h3><ol class="en-hist">
      ${h.map(({e,label})=>{const b=e.before||{},dr=(b.lines||[]).reduce((s,l)=>s+(l.amount>0?l.amount:0),0);
        return`<li data-at="${escH(e.at)}"><div class="li-title">${escH(label)}${e.why?` · ${escH(e.why)}`:''}</div><div class="li-sub">${escH(who(e.why))} · ${escH(when(e.at))}</div>
          <details><summary>Before: ${escH(dayLong(b.date))} · ${rp(dr)}${b.description&&b.description!==v.description?` · ${escH(b.description)}`:''}</summary>${linesTable(b.lines)}</details></li>`;}).join('')}
      <li><div class="li-title">${escH(created)}</div><div class="li-sub">${escH(when(v.createdAt||v.at))}${v.prompt?` · “${escH(v.prompt)}”`:''}</div></li></ol></div>`;
  }
  // Vouchers posted from one prompt share a batch id: Journals marks them "AI · 1 of 2" and the
  // voucher panel links the others. Cached per change of the book.
  let BATCH={ver:null,map:new Map()};
  function batches(){
    const x=L();if(!x)return new Map();
    const ver=(x.updatedAt||'')+'|'+Object.keys(x.vouchers).length;
    if(BATCH.ver!==ver||BATCH.x!==x){const m=new Map();
      for(const v of Object.values(x.vouchers))if(v&&v.batch&&v.status==='posted')(m.get(v.batch)||m.set(v.batch,[]).get(v.batch)).push(v);
      for(const l of m.values())l.sort((p,q)=>p.date.localeCompare(q.date)||String(p.createdAt||'').localeCompare(String(q.createdAt||''))||String(p.id).localeCompare(String(q.id)));
      BATCH={ver,x,map:m};}
    return BATCH.map;
  }
  function batchOf(bv){const v=bv&&bv.id?ledgerVoucher(bv.id):null;if(!v||!v.batch)return null;const l=batches().get(v.batch);return l&&l.length>1?{v,list:l,i:l.indexOf(v)}:null;}
  function batchBadge(bv){const b=batchOf(bv);return b?`<span class="badge accent" data-batch="${escH(b.v.batch)}" title="Posted together from one prompt">AI · ${b.i+1} of ${b.list.length}</span>`:'';}
  function batchHTML(bv){
    const b=batchOf(bv);if(!b)return'';
    return`<div class="en-batch" id="enBatch">${ic('sparkles','s16')} Entry ${b.i+1} of ${b.list.length} from one prompt: ${b.list.map((y,n)=>n===b.i?`<b>${n+1}. ${escH(y.description||'This entry')}</b>`
      :`<button class="bk-link" data-en-act="open" data-id="${escH(y.id)}">${n+1}. ${escH(y.description||'Entry')}</button>`).join(' · ')}</div>`;
  }
  // Tools under a journal in the Journals panel (js/books.js), by state (UX §11.10b):
  //   posted, open month → ghost Copy · ghost Void · secondary Edit;
  //   posted in a closed/locked month → ghost Copy and the lock note (class en-lock, Periods link);
  //   year-end → the note only (reopen December in Periods);
  //   draft → primary Post · secondary Open draft · ghost Delete draft (Post / Delete confirm in the editor);
  //   void → the Void badge and Copy. Then the batch line and the history.
  function voucherTools(bv){
    if(!bv||!bv.id||!seeded())return'';
    const v=ledgerVoucher(bv.id);if(!v)return'';
    const id=escH(v.id),k=kindOf(v),M=monthOfD(v.date),copy=`<button class="btn btn-ghost btn-sm" data-en-act="copy" data-id="${id}" id="enToolCopy">${ic('copy','s16')}Copy</button>`;
    let tools='',note='';
    if(k==='year-end'){note=`<div class="en-note warn en-lock" role="status">${ic('lock','s16')}<span>Made by the year-end close. Reopen December in <button class="bk-link" data-en-act="periods">Periods</button> to change it.</span></div>`;}
    else if(v.status==='void')tools=`<span class="badge bad" id="enVoidBadge">Void</span>${copy}`;
    else if(v.status==='draft'){
      const lock=periodOf(M)!=='open';
      tools=`<button class="btn btn-primary btn-sm" data-en-act="postdraft" data-id="${id}" id="enToolPost"${lock?' disabled':''}>${ic('check','s16')}Post</button>
        <button class="btn btn-secondary btn-sm" data-en-act="draft" data-id="${id}" id="enToolOpen">${ic('pencil','s16')}Open draft</button>
        <button class="btn btn-ghost btn-sm" data-en-act="deldraft" data-id="${id}" id="enToolDel" style="color:var(--bad)">${ic('trash','s16')}Delete draft</button>`;
      if(lock)note=lockNoteHTML(M,'post this draft, or change its date');
    }else if(periodOf(M)!=='open'){tools=copy;note=lockNoteHTML(M,'change entries');}
    else tools=`${copy}<button class="btn btn-ghost btn-sm" data-en-act="void" data-id="${id}" style="color:var(--bad)">${ic('ban','s16')}Void</button>
        <button class="btn btn-secondary btn-sm" data-en-act="edit" data-id="${id}">${ic('pencil','s16')}Edit</button>`;
    return`${note}<div class="en-tools" data-vid="${id}" data-status="${escH(v.status)}">${tools}</div>
      ${batchHTML(bv)}${historyHTML(v)}`;
  }
  function newEntryBtn(cls){return canPost()?`<button class="btn ${cls||'btn-primary'} btn-sm" data-en-act="new" id="enNewBtn">${ic('plus','s16')}New journal</button>`:'';}
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('[data-en-act]');if(!b||b.disabled)return;
    e.preventDefault();e.stopPropagation();
    const a=b.dataset.enAct,id=b.dataset.id;
    if(a==='new')openNew();else if(a==='edit')openEdit(id);else if(a==='void')openVoid(id);else if(a==='open')openVoucherKey(id);
    else if(a==='copy')copyJournal(id);else if(a==='draft')openDraft(id);else if(a==='postdraft')openDraft(id,{confirm:'post'});
    else if(a==='deldraft')openDraft(id,{confirm:'delete'});else if(a==='journal')openJournal(id);else if(a==='periods')goPeriods();
  },true);
  registerHook('homeActions',()=>canPost()?`<button class="btn btn-secondary btn-sm" data-en-act="new" id="enHomeBtn">${ic('sparkles','s16')}Tell me what happened</button>`:null);
  registerHook('beforeRender',()=>{if(owner()&&(SEC.owner!==owner()||(!SEC.localDone)||(signedIn()&&!SEC.driveTried)))aiEnsure();});

  /* ══ Settings › AI ══ */
  function aiSettingsHTML(){
    if(SEC.owner!==owner())aiEnsure();
    const loading=SEC.status!=='ready'&&!SEC.key;
    const keyRow=loading?`<div class="setting-row" id="aiLoading"><div><div class="li-title">API key</div><div class="li-sub">Checking this device${signedIn()?' and your Drive':''}…</div></div></div>`
      :SEC.key?`<div class="setting-row"><div><div class="li-title">API key</div><div class="li-sub"><span class="en-key" id="aiMasked">${escH(masked())}</span> · saved ${escH(when(SEC.at))}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn btn-secondary" onclick="etAI.test()" id="aiTest">Test</button><button class="btn btn-ghost" onclick="etAI.remove()" id="aiRemove" style="color:var(--bad)">Remove</button></div></div>`
      :`<div class="setting-row"><div><div class="li-title">API key</div><div class="li-sub">Not set. Without one, new entries are typed by hand.</div></div><span class="badge">Off</span></div>`;
    return`<section class="card" id="set-ai">${cardHead('sparkles','AI','Claude drafts journal entries from a sentence; you check and post them. Uses your own Anthropic API key.')}
      ${keyRow}
      <div class="setting-row" style="align-items:flex-end"><div class="field" style="flex:1 1 260px"><label class="label" for="aiKey">${SEC.key?'Replace the key':'Paste your API key'}</label>
          <input class="input en-key" id="aiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" aria-describedby="aiNote"></div>
        <button class="btn btn-primary" onclick="etAI.save()" id="aiSave">${ic('key-round','s16')}Save key</button></div>
      <div class="setting-row"><div><div class="li-title">Model</div><div class="li-sub">${escH(modelOf(SEC.model).sub)}</div></div>
        <select class="input" id="aiModel" style="width:auto" onchange="etAI.setModel(this.value)" aria-label="Model">${MODELS.map(m=>`<option value="${m.id}"${m.id===SEC.model?' selected':''}>${escH(m.label)}</option>`).join('')}</select></div>
      <p class="help" id="aiNote">Your key is stored in your private Google Drive app folder and this device; set a spend limit on it at console.anthropic.com; when you ask the AI, it is sent your chart of accounts, account balances, open receivables and payables, the last 60 days of statement lines and your sentence (to Anthropic only, never the key in any of it).</p>
      <div class="help" id="aiStatus" role="status" aria-live="polite"></div></section>`;
  }
  function status(msg,tone){const el=document.getElementById('aiStatus');if(el){el.textContent=msg||'';el.style.color=tone==='bad'?'var(--bad)':tone==='good'?'var(--good)':'';}}
  let UNDO=null;
  const AI={
    async save(){
      const el=document.getElementById('aiKey');const k=String(el&&el.value||'').trim();
      if(!/^sk-[A-Za-z0-9_\-]{8,}$/.test(k)){status('That doesn’t look like an Anthropic API key (it starts with sk-ant-).','bad');return false;}
      await aiEnsure();SEC.key=k;if(el)el.value='';
      const w=await store();
      renderAll();toast(w==='drive'?'Key saved to your Drive app folder and this device':w==='device-only'?'Key saved on this device; Drive couldn’t be reached':'Key saved on this device');
      return true;
    },
    async test(){
      if(!SEC.key){status('Add a key first.','bad');return false;}
      const b=document.getElementById('aiTest');if(b)b.disabled=true;status('Testing…');
      try{await callClaude({model:SEC.model,max_tokens:16,output_config:{effort:'low'},messages:[{role:'user',content:'Reply with OK.'}]},TIMEOUT_TEST);
        status(`The key works with ${modelOf(SEC.model).label}.`,'good');return true;}
      catch(e){status(clean(e&&e.message||e),'bad');return false;}
      finally{if(b)b.disabled=false;}
    },
    async remove(){
      if(!SEC.key)return false;
      UNDO=SEC.key;SEC.key=null;await store();renderAll();
      toast('Key removed from your Drive app folder and this device',{action:'Undo',onAction:async()=>{if(UNDO){SEC.key=UNDO;UNDO=null;await store();renderAll();}}});
      setTimeout(()=>{UNDO=null;},6000);
      return true;
    },
    async setModel(m){await aiEnsure();SEC.model=modelOf(m).id;await store();renderAll();},
    // For tests and other modules: plain facts, never the key itself.
    state(){return{hasKey:!!SEC.key,masked:masked(),model:SEC.model,at:SEC.at,status:SEC.status};},
    ensure:aiEnsure,
    request:draftRequest,
    // Counts only, for checks on real data: what a request for a sentence would carry. No call.
    requestCounts(sentence){const r=draftRequest(sentence||'test'),u=JSON.parse(r.messages[0].content);
      return{accounts:u.chartOfAccounts.length,balances:Object.keys(u.balances).length,openItems:u.openItems.length,statementLines:u.statementLines.length,
        bytes:new Blob([JSON.stringify(r)]).size};}
  };
  window.etAI=AI;
  window.aiSettingsHTML=aiSettingsHTML;
  window.etEntry={open:openNew,openDraft,openJournal,copy:copyJournal,edit:openEdit,void:openVoid,canPost,originBadge,kindOf,voucherTools,voucherByKey,voidList,newEntryBtn,batchBadge};
})();
