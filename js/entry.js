/* ExpenseTrack v3 — entries in the app's own book: New entry (typed by hand or drafted by Claude
   from a sentence), Edit / Void with history, and the owner's Anthropic API key (Settings › AI).
   Contract: docs/v3-ledger.md §6–§8. Loaded after js/books.js. No personal data in this file: the
   repo is public.

   The AI never posts. Claude only suggests a draft; the owner checks it in the same debit/credit
   form used for manual entries and taps Post. A request sends ONLY the chart of accounts (id, name,
   kind, ccy, isParent of the non-suspended accounts), today's date, the base currency and the
   owner's sentence: no balances, no statement lines, nothing else.

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
  const ORIGIN={accurate:['From Accurate',''],app:['Manual',''],ai:['AI','accent'],'month-end':['Month-end',''],income:['Income','']};

  registerIcon('sparkles','<path d="M9.94 14.06 4 20"/><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M20 3v4"/><path d="M22 5h-4"/>');
  registerIcon('ban','<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>');
  registerIcon('key-round','<path d="M2.6 18.4A2 2 0 0 0 2 19.8V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.2a2 2 0 0 0 1.4-.6l.8-.8a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>');
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
    @media (max-width:767px){
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

  // Structured output: the draft voucher (contract §7). Debit/credit in whole rupiah.
  const SCHEMA={type:'object',additionalProperties:false,required:['date','description','lines','newAccounts','assumptions','questions'],properties:{
    date:{type:'string',description:'YYYY-MM-DD'},
    description:{type:'string'},
    lines:{type:'array',items:{type:'object',additionalProperties:false,required:['account','debit','credit','memo','fx'],properties:{
      account:{type:'string',description:'Account id from the chart (or from newAccounts)'},
      debit:{type:'integer',description:'Whole rupiah, 0 when the line is a credit'},
      credit:{type:'integer',description:'Whole rupiah, 0 when the line is a debit'},
      memo:{type:'string'},
      fx:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['ccy','amount','rate'],properties:{
        ccy:{type:'string',description:'ISO currency code'},amount:{type:'number',description:'Amount in that currency'},rate:{type:'number',description:'Rupiah per unit'}}}]}}}},
    newAccounts:{type:'array',items:{type:'object',additionalProperties:false,required:['id','name','kind','ccy','parent'],properties:{
      id:{type:'string'},name:{type:'string'},kind:{type:'string',enum:KINDS},ccy:{type:'string'},parent:{anyOf:[{type:'string'},{type:'null'}]}}}},
    assumptions:{type:'array',items:{type:'string'}},
    questions:{type:'array',items:{type:'string'}}}};
  const SYSTEM=[
    'You draft one double-entry journal voucher for a personal accounting book kept in Indonesian rupiah (IDR), from one sentence the owner wrote. The owner reviews your draft and posts it; you never post.',
    'Rules:',
    '- Use only accounts from chartOfAccounts with isParent false. Never put a line on a parent account.',
    '- Every line is whole rupiah: the amount goes in debit or credit and the other is 0. Total debits must equal total credits exactly.',
    '- Assets and expenses increase with a debit; liabilities, equity and income increase with a credit. Money leaving a bank account is a credit to it; a purchase on a credit card is a credit to the card.',
    '- A line on an account whose ccy is not IDR, or a line whose amount the sentence gives in a foreign currency, carries fx {ccy, amount, rate}: the amount in that currency, the rate in rupiah per unit, and round(amount x rate) equals the line\'s rupiah amount. Every other line has fx null.',
    '- Use the date the sentence gives, else today (YYYY-MM-DD).',
    '- If no account in the chart fits, propose one in newAccounts (an unused id that follows the chart\'s numbering under a fitting parent, a short name, kind, ccy, parent id) and use that id in the lines. Never propose an account the chart already has. Otherwise newAccounts is empty.',
    '- If something is unclear (which bank, the rate, a fee), make the most reasonable assumption, state it in assumptions, and ask about it in questions. Do not invent amounts the sentence does not support.',
    '- description: a short neutral description of the event. memo: a few words per line.'].join('\n');
  // The chart sent to Claude: id, name, kind, ccy, isParent of every non-suspended account. Nothing else.
  function chartForAI(){
    const x=L();if(!x)return[];
    return Object.values(x.accounts).filter(a=>a&&!a.suspended)
      .sort((p,q)=>String(p.id).localeCompare(String(q.id),undefined,{numeric:true}))
      .map(a=>({id:String(a.id),name:String(a.name||a.id),kind:a.kind,ccy:a.ccy||'IDR',isParent:!!a.isParent}));
  }
  function draftRequest(sentence){
    return{model:SEC.model,max_tokens:16000,system:SYSTEM,
      output_config:{effort:'medium',format:{type:'json_schema',schema:SCHEMA}},
      messages:[{role:'user',content:JSON.stringify({today:todayISO(),baseCurrency:'IDR',chartOfAccounts:chartForAI(),sentence:String(sentence)})}]};
  }
  // Reads Claude's answer into a draft; throws 'malformed' when it isn't the shape asked for.
  function readDraft(data){
    if(data.stop_reason==='refusal')throw aiErr('refusal','Claude declined to draft this one.');
    if(data.stop_reason==='max_tokens')throw aiErr('malformed','Claude’s answer was cut off before it finished.');
    const t=(Array.isArray(data.content)?data.content:[]).filter(b=>b&&b.type==='text').map(b=>b.text).join('');
    let o;try{o=JSON.parse(t);}catch(_){throw aiErr('malformed','Claude’s answer couldn’t be read.');}
    if(!o||typeof o!=='object'||!Array.isArray(o.lines)||!o.lines.length)throw aiErr('malformed','Claude’s answer had no voucher lines.');
    const str=v=>typeof v==='string'?v:v==null?'':String(v);
    const amt=v=>{const n=Number(v);return isFinite(n)&&n>0?Math.round(n):0;};
    const lines=o.lines.filter(l=>l&&typeof l==='object').map(l=>{
      let dr=amt(l.debit),cr=amt(l.credit);if(dr&&cr){const d=dr-cr;dr=d>0?d:0;cr=d<0?-d:0;}
      const f=l.fx&&typeof l.fx==='object'?l.fx:null;
      return{account:str(l.account).trim(),debit:dr,credit:cr,memo:str(l.memo).slice(0,200),
        fx:f&&num(f.amount)!=null&&num(f.rate)!=null?{ccy:str(f.ccy).toUpperCase().slice(0,3),amount:Math.abs(num(f.amount)),rate:num(f.rate)}:null};
    });
    if(!lines.length)throw aiErr('malformed','Claude’s answer had no voucher lines.');
    const na=(Array.isArray(o.newAccounts)?o.newAccounts:[]).filter(a=>a&&typeof a==='object').map(a=>({id:str(a.id).trim(),name:str(a.name).trim().slice(0,80),
      kind:KINDS.includes(a.kind)?a.kind:'expense',ccy:(str(a.ccy)||'IDR').toUpperCase().slice(0,3),parent:a.parent?str(a.parent):''}));
    const date=/^\d{4}-\d{2}-\d{2}$/.test(str(o.date))?str(o.date):todayISO();
    const list=v=>(Array.isArray(v)?v:[]).map(str).filter(Boolean).slice(0,12);
    return{date,description:str(o.description).slice(0,200),lines,newAccounts:na,assumptions:list(o.assumptions),questions:list(o.questions)};
  }

  /* ══ The entry form (new, AI draft, edit) ══ */
  let D=null,SH=null;
  const blankLine=()=>({account:'',debit:0,credit:0,memo:'',fxOn:false,ccy:'',famt:'',rate:''});
  function accounts(){const x=L();return x?x.accounts:{};}
  function accOf(code){return accounts()[code]||null;}
  function postable(){
    return Object.values(accounts()).filter(a=>a&&!a.isParent&&!a.suspended).sort((p,q)=>String(p.id).localeCompare(String(q.id),undefined,{numeric:true}));
  }
  function lineFrom(l){
    const a=Math.round(l.amount||0),f=l.fx||null;
    return{account:String(l.account||''),debit:a>0?a:0,credit:a<0?-a:0,memo:l.memo||l.description||'',fxOn:!!f,ccy:f?f.ccy:'',famt:f?String(f.amount):'',rate:f?String(f.rate):''};
  }
  // Next free code under a parent following its children's pattern (e.g. 6000.12 after 6000.11).
  function nextCode(parent){
    if(!parent)return'';
    const ids=Object.keys(accounts()).filter(id=>id.startsWith(parent+'.')&&/^\d+$/.test(id.slice(parent.length+1)));
    const w=ids.reduce((m,id)=>Math.max(m,id.length-parent.length-1),2);
    let n=ids.reduce((m,id)=>Math.max(m,Number(id.slice(parent.length+1))),0)+1;
    let c;do{c=`${parent}.${String(n).padStart(w,'0')}`;n++;}while(accounts()[c]);
    return c;
  }
  function draftToD(dr,sentence){
    const na=dr.newAccounts.filter(a=>!accOf(a.id)||!a.id).map(a=>{
      const parent=a.parent&&accOf(a.parent)?a.parent:'';const id=a.id&&!accOf(a.id)?a.id:nextCode(parent);
      return{orig:a.id||a.name,id,name:a.name||id,kind:a.kind,ccy:a.ccy||'IDR',parent,added:false};});
    const lines=dr.lines.map(l=>{const nx=na.find(a=>a.orig===l.account||(a.name&&a.name===l.account));
      return{account:nx?nx.id:l.account,debit:l.debit,credit:l.credit,memo:l.memo,fxOn:!!l.fx,ccy:l.fx?l.fx.ccy:'',famt:l.fx?String(l.fx.amount):'',rate:l.fx?String(l.fx.rate):''};});
    while(lines.length<2)lines.push(blankLine());
    na.forEach(a=>{a.orig=a.id;});
    return{date:dr.date,description:dr.description,lines,newAccounts:na,assumptions:dr.assumptions,questions:dr.questions};
  }
  function voucherFromD(){
    return{date:D.date,description:D.description,lines:D.lines.filter(l=>l.account||l.debit||l.credit).map(l=>{
      const o={account:l.account,amount:Math.round((l.debit||0)-(l.credit||0)),memo:l.memo||''};
      if(l.fxOn){o.fx={ccy:String(l.ccy||'').toUpperCase(),amount:Math.abs(num(l.famt)||0),rate:num(l.rate)||0};}
      return o;})};
  }
  function errorsOf(v){
    let e=typeof ledgerValidate==='function'?ledgerValidate(v):['Your book is not set up yet'];
    const pend=new Map(D.newAccounts.filter(a=>!a.added).map(a=>[a.id,a]));
    e=e.map(m=>{const r=/^Line (\d+): account (.+) is not in your book$/.exec(m);return r&&pend.has(r[2])?`Line ${r[1]}: add the new account ${r[2]} to your book first (below)`:m;});
    if(D.newAccounts.some(a=>!a.added))e.push(`Confirm or remove the proposed new account${D.newAccounts.filter(a=>!a.added).length===1?'':'s'} before posting`);
    if(D.mode==='edit'&&!String(D.why||'').trim())e.push('Say why you are changing it');
    return e;
  }
  function sheetTitle(){return D.mode==='edit'?'Edit voucher':'New entry';}
  function askHTML(){
    if(D.mode==='edit')return'';
    if(!hasKey())return`<div class="en-note" id="enNoKey">${ic('info','s16')}<span>Claude can draft entries from a sentence once you add your own Anthropic API key in <button class="bk-link" data-en="settings">Settings › AI</button>. For now, fill this one in by hand.</span></div>`;
    return`<div class="en-ask"><label class="label" for="enText">Tell me what happened</label>
      <textarea class="input" id="enText" rows="2" placeholder="e.g. I bought USD 1,000 at 16,350 from my bank account">${escH(D.prompt||'')}</textarea>
      <div class="row"><button class="btn btn-secondary btn-sm" data-en="ask" id="enAsk">${ic('sparkles','s16')}Draft with Claude</button>
      <span class="help">Sends your sentence and your chart of accounts to Anthropic (${escH(modelOf(SEC.model).label)}). Nothing posts until you tap Post.</span></div></div>`;
  }
  function noteHTML(){
    if(!D.note)return'';
    return`<div class="en-note ${D.note.tone||''}" id="enNote" role="status">${ic(D.note.tone==='warn'||D.note.tone==='bad'?'triangle-alert':'info','s16')}<span>${escH(D.note.text)}</span></div>`;
  }
  function lineHTML(l,i){
    const a=accOf(l.account),pend=D.newAccounts.find(n=>n.id===l.account&&!n.added);
    const nm=!l.account?'':a?`${escH(a.name)}${a.isParent?' · parent account':''}${a.ccy&&a.ccy!=='IDR'?' · '+escH(a.ccy):''}`:pend?'New account (confirm below)':'Not in your book';
    const bad=l.account&&(!a||a.isParent)&&!pend;
    return`<div class="en-line" data-i="${i}">
      <div class="field en-acc"><label class="label" for="enAcc${i}">Account</label><input class="input" id="enAcc${i}" data-f="account" list="enAccList" autocomplete="off" spellcheck="false" placeholder="Code or name" value="${escH(l.account)}">
        <div class="en-accname${bad?' bad':''}" id="enAccName${i}">${nm}</div></div>
      <div class="field"><label class="label" for="enDr${i}">Debit</label><div class="input-affix"><span class="affix">Rp</span><input class="input" id="enDr${i}" data-f="debit" inputmode="numeric" autocomplete="off" value="${l.debit?fmtNum(l.debit):''}"></div></div>
      <div class="field"><label class="label" for="enCr${i}">Credit</label><div class="input-affix"><span class="affix">Rp</span><input class="input" id="enCr${i}" data-f="credit" inputmode="numeric" autocomplete="off" value="${l.credit?fmtNum(l.credit):''}"></div></div>
      <div class="en-btns"><button class="icon-btn sm" data-en="fx" data-i="${i}" aria-pressed="${l.fxOn}" aria-label="Foreign currency on line ${i+1}" title="Foreign currency">${ic('globe','s16')}</button>
        <button class="icon-btn sm" data-en="del" data-i="${i}" aria-label="Remove line ${i+1}" title="Remove line" ${D.lines.length<=2?'disabled':''}>${ic('x','s16')}</button></div>
      <div class="field en-memo"><label class="label" for="enMemo${i}">Memo</label><input class="input" id="enMemo${i}" data-f="memo" autocomplete="off" value="${escH(l.memo)}"></div>
      ${l.fxOn?`<div class="en-fx"><div class="field"><label class="label" for="enCcy${i}">Currency</label><input class="input" id="enCcy${i}" data-f="ccy" maxlength="3" autocomplete="off" placeholder="USD" value="${escH(l.ccy)}"></div>
        <div class="field"><label class="label" for="enFa${i}">Foreign amount</label><input class="input" id="enFa${i}" data-f="famt" type="number" step="any" min="0" value="${escH(l.famt)}"></div>
        <div class="field"><label class="label" for="enRate${i}">Rate (Rp per unit)</label><input class="input" id="enRate${i}" data-f="rate" type="number" step="any" min="0" value="${escH(l.rate)}"><span class="help" id="enFxHint${i}">${fxHint(l)}</span></div></div>`:''}
    </div>`;
  }
  function fxHint(l){const a=num(l.famt),r=num(l.rate);return a&&r?`= ${fmtIDR(Math.round(Math.abs(a)*r))}`:'';}
  function naHTML(){
    if(!D.newAccounts.length)return'';
    const parents=Object.values(accounts()).filter(a=>a&&a.isParent).sort((p,q)=>String(p.id).localeCompare(String(q.id),undefined,{numeric:true}));
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
  function aqHTML(){
    const a=D.assumptions||[],q=D.questions||[];if(!a.length&&!q.length)return'';
    return`<div class="en-sec" id="enAQ">${a.length?`<h3 class="label">Claude assumed</h3><ul>${a.map(x=>`<li>${escH(x)}</li>`).join('')}</ul>`:''}
      ${q.length?`<h3 class="label" style="margin-top:10px">Claude asks</h3><ul>${q.map(x=>`<li>${escH(x)}</li>`).join('')}</ul>`:''}</div>`;
  }
  function formHTML(){
    const warn=D.mode==='edit'&&D.origin==='accurate'
      ?`<div class="en-note warn" id="enAccWarn">${ic('triangle-alert','s16')}<span>This voucher came from Accurate. Once you change it here your book differs from Accurate from now on; a later Accurate export flags it but never overwrites it.</span></div>`:'';
    return`${warn}<div class="form-grid">
        <div class="field"><label class="label" for="enDate">Date</label><input class="input" id="enDate" type="date" value="${escH(D.date)}"></div>
        <div class="field"><label class="label" for="enDesc">Description</label><input class="input" id="enDesc" autocomplete="off" value="${escH(D.description)}"></div>
        ${D.mode==='edit'?`<div class="field full"><label class="label" for="enWhy">Why the change</label><input class="input" id="enWhy" autocomplete="off" placeholder="e.g. wrong account" value="${escH(D.why||'')}"></div>`:''}
      </div>
      <div class="en-lines" id="enLines">${D.lines.map(lineHTML).join('')}</div>
      <div><button class="btn btn-ghost btn-sm" data-en="addline">${ic('plus','s16')}Add line</button></div>
      <div class="en-tot" id="enTot"></div>
      <div class="en-checks" id="enChecks" role="status" aria-live="polite"></div>
      ${naHTML()}${aqHTML()}
      <datalist id="enAccList">${postable().map(a=>`<option value="${escH(a.id)}">${escH(a.id)} · ${escH(a.name)}${a.ccy&&a.ccy!=='IDR'?' · '+escH(a.ccy):''}</option>`).join('')}</datalist>`;
  }
  function bodyHTML(){return`<div id="enRoot">${askHTML()}<div id="enNoteHost">${noteHTML()}</div><div id="enForm">${formHTML()}</div></div>`;}
  function rerender(focusSel){
    if(!SH)return;const host=SH.sheet.querySelector('.sheet-body');if(!host)return;
    host.innerHTML=bodyHTML();updateChecks();
    if(focusSel){const f=host.querySelector(focusSel);if(f)try{f.focus();}catch(_){}}
  }
  function renderForm(){const f=SH&&SH.sheet.querySelector('#enForm');if(f){f.innerHTML=formHTML();updateChecks();}}
  function setNote(text,tone){D.note=text?{text,tone}:null;const h=SH&&SH.sheet.querySelector('#enNoteHost');if(h)h.innerHTML=noteHTML();}
  function sync(){
    if(!SH)return;const q=s=>SH.sheet.querySelector(s);
    const d=q('#enDate'),ds=q('#enDesc'),w=q('#enWhy'),t=q('#enText');
    if(d)D.date=d.value;if(ds)D.description=ds.value;if(w)D.why=w.value;if(t)D.prompt=t.value;
    SH.sheet.querySelectorAll('.en-line').forEach(el=>{const i=+el.dataset.i,l=D.lines[i];if(!l)return;
      el.querySelectorAll('[data-f]').forEach(inp=>{const f=inp.dataset.f;
        if(f==='debit'||f==='credit')l[f]=parseRp(inp.value);
        else if(f==='account')l.account=String(inp.value||'').split(/[\s·]/)[0].trim();
        else if(f==='ccy')l.ccy=String(inp.value||'').toUpperCase();
        else l[f]=inp.value;});});
    SH.sheet.querySelectorAll('.en-na').forEach(el=>{const a=D.newAccounts[+el.dataset.j];if(!a||a.added)return;
      el.querySelectorAll('[data-na]').forEach(inp=>{a[inp.dataset.na]=inp.dataset.na==='ccy'?String(inp.value).toUpperCase():inp.value.trim();});});
  }
  function updateChecks(){
    if(!SH)return;const q=s=>SH.sheet.querySelector(s);
    D.lines.forEach((l,i)=>{const el=q('#enAccName'+i);if(el){const a=accOf(l.account),pend=D.newAccounts.find(n=>n.id===l.account&&!n.added);
        el.textContent=!l.account?'':a?`${a.name}${a.isParent?' · parent account':''}${a.ccy&&a.ccy!=='IDR'?' · '+a.ccy:''}`:pend?'New account (confirm below)':'Not in your book';
        el.classList.toggle('bad',!!l.account&&(!a||a.isParent)&&!pend);}
      const h=q('#enFxHint'+i);if(h)h.textContent=fxHint(l);});
    const dr=D.lines.reduce((s,l)=>s+(l.debit||0),0),cr=D.lines.reduce((s,l)=>s+(l.credit||0),0);
    const tot=q('#enTot');
    if(tot)tot.innerHTML=`<span>Debits <b id="enDrTot" data-raw="${dr}">${rp(dr)}</b></span><span>Credits <b id="enCrTot" data-raw="${cr}">${rp(cr)}</b></span>
      ${dr===cr&&dr>0?'<span class="badge good">Balanced</span>':`<span class="badge bad" id="enDiff" data-raw="${dr-cr}">Off by ${rpSigned(Math.abs(dr-cr))}</span>`}`;
    const errs=errorsOf(voucherFromD()),ch=q('#enChecks');
    if(ch)ch.innerHTML=errs.length?errs.map(m=>`<div class="help err">${ic('triangle-alert','s16')}<span>${escH(m)}</span></div>`).join('')
      :`<div class="help" style="color:var(--good)">${ic('square-check','s16')} Ready to ${D.mode==='edit'?'save':'post'}: balanced, every account is in your book</div>`;
    const p=q('#enPost');if(p){p.disabled=!!errs.length||!!D.busy;p.dataset.errors=String(errs.length);}
  }
  function openForm(d){
    D=d;
    const foot=`<button class="btn btn-secondary" data-en="cancel">Cancel</button><button class="btn btn-primary" data-en="post" id="enPost" disabled>${ic('check','s16')}${D.mode==='edit'?'Save changes':'Post'}</button>`;
    SH=openSheet({title:sheetTitle(),body:bodyHTML(),foot,wide:true,focus:D.mode==='edit'?'#enDate':hasKey()?'#enText':'#enDate',onClose:()=>{SH=null;D=null;}});
    SH.sheet.id='enSheet';
    SH.sheet.addEventListener('input',e=>{if(e.target&&e.target.closest('[data-f],[data-na],#enDate,#enDesc,#enWhy,#enText')){sync();updateChecks();}});
    SH.sheet.addEventListener('change',e=>{if(e.target&&e.target.closest('[data-na]')){sync();updateChecks();}});
    SH.sheet.addEventListener('click',e=>{const b=e.target.closest('[data-en]');if(!b||b.disabled)return;e.preventDefault();act(b);});
    updateChecks();
    return SH;
  }
  async function act(b){
    const a=b.dataset.en,i=+b.dataset.i,j=+b.dataset.j;
    sync();
    switch(a){
      case'cancel':SH.close();return;
      case'settings':SH.close(true);goSettings();return;
      case'addline':D.lines.push(blankLine());renderForm();{const f=SH.sheet.querySelector(`#enAcc${D.lines.length-1}`);if(f)f.focus();}return;
      case'del':if(D.lines.length>2){D.lines.splice(i,1);renderForm();}return;
      case'fx':{const l=D.lines[i];l.fxOn=!l.fxOn;if(l.fxOn&&!l.ccy){const ac=accOf(l.account);if(ac&&ac.ccy&&ac.ccy!=='IDR')l.ccy=ac.ccy;}renderForm();return;}
      case'naadd':return addNew(j);
      case'nadel':D.newAccounts.splice(j,1);renderForm();return;
      case'ask':return ask(b);
      case'post':return post();
    }
  }
  function addNew(j){
    const a=D.newAccounts[j];if(!a)return;
    try{
      ledgerAddAccount({id:a.id,name:a.name,kind:a.kind,ccy:a.ccy||'IDR',parent:a.parent||null});
      if(a.orig&&a.orig!==a.id)D.lines.forEach(l=>{if(l.account===a.orig)l.account=a.id;});
      a.added=true;renderForm();toast(`${a.id} added to your book`);
    }catch(e){setNote(String(e&&e.message||e),'bad');}
  }
  async function ask(btn){
    const text=String(D.prompt||'').trim();
    if(!text){setNote('Write a sentence first, e.g. what you bought or paid, from which account, and the amount.','warn');return;}
    if(D.busy)return;
    D.busy=true;btn.disabled=true;const lbl=btn.innerHTML;btn.innerHTML=`${ic('sparkles','s16')}Drafting…`;btn.setAttribute('aria-busy','true');
    setNote('Asking Claude…','');updateChecks();
    try{
      const data=await callClaude(draftRequest(text),TIMEOUT_DRAFT);
      const dr=readDraft(data);
      if(!D)return;
      Object.assign(D,draftToD(dr,text),{fromAI:true,prompt:text});
      D.note={text:'Claude’s draft. Check every line, change anything that’s wrong, then tap Post.',tone:''};
    }catch(e){
      if(!D)return;
      D.note={text:`${clean(e&&e.message||e)} Fill the entry in by hand below${e&&e.kind!=='auth'&&e.kind!=='refusal'?', or try again':''}.`,tone:e&&e.kind==='auth'?'bad':'warn'};
      D.aiError=e&&e.kind||'error';
    }finally{
      if(D){D.busy=false;rerender();}
      else{btn.disabled=false;btn.innerHTML=lbl;}
    }
  }
  function post(){
    const v=voucherFromD(),errs=errorsOf(v);
    if(errs.length){updateChecks();return;}
    try{
      if(D.mode==='edit'){
        const id=D.id,key=D.key;ledgerEdit(id,v,String(D.why).trim());
        SH.close(true);toast('Saved · the earlier version stays in its history');openVoucherKey(key);
      }else{
        const ai=!!D.fromAI,vv={...v};if(ai)vv.prompt=D.prompt;
        const id=ledgerPost(vv,{origin:ai?'ai':'app',why:ai?'Drafted by Claude, checked and posted by you':'Entered by hand'});
        SH.close(true);toast('Posted to your book');openVoucherKey(id);
      }
    }catch(e){setNote(((e&&e.errors)||[String(e&&e.message||e)]).join(' · '),'bad');updateChecks();}
  }
  function openVoucherKey(key){if(typeof window.openVoucher==='function')window.openVoucher(key);}
  function goSettings(){setTab('settings');setTimeout(()=>{const e=document.getElementById('set-ai');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});},60);}

  /* ── Entry points ── */
  function canPost(){return seeded();}
  function openNew(){
    if(!canPost()){toast('Set up your book first (Settings › Your book)');return null;}
    aiEnsure();
    return openForm({mode:'new',date:todayISO(),description:'',lines:[blankLine(),blankLine()],newAccounts:[],assumptions:[],questions:[],prompt:'',fromAI:false,note:null});
  }
  function ledgerVoucher(id){const x=L();return x&&x.vouchers[id]||null;}
  function keyOf(v){return v.origin==='accurate'?(v.srcKey||v.id):v.id;}
  function openEdit(id){
    const v=ledgerVoucher(id);if(!v){toast('That voucher isn’t in your book');return null;}
    if(v.status!=='posted'){toast('A void voucher can’t be edited');return null;}
    const lines=(v.lines||[]).map(lineFrom);while(lines.length<2)lines.push(blankLine());
    return openForm({mode:'edit',id,key:keyOf(v),origin:v.origin,date:v.date,description:v.description||'',lines,newAccounts:[],assumptions:[],questions:[],why:'',note:null});
  }
  function openVoid(id){
    const v=ledgerVoucher(id);if(!v||v.status!=='posted')return null;
    const dr=(v.lines||[]).reduce((s,l)=>s+(l.amount>0?l.amount:0),0);
    const body=`${v.origin==='accurate'?`<div class="en-note warn">${ic('triangle-alert','s16')}<span>This voucher came from Accurate. Voiding it here means your book differs from Accurate from now on.</span></div>`:''}
      <p class="muted" style="margin:0 0 12px">${escH(v.description||v.number||'Voucher')} · ${escH(dayLong(v.date))} · ${rp(dr)}</p>
      <div class="field"><label class="label" for="enVoidWhy">Why void it</label><input class="input" id="enVoidWhy" autocomplete="off" placeholder="e.g. entered twice"></div>
      <p class="help" style="margin-top:8px">It stays in your book marked void, with its history; balances and reports leave it out. Nothing is deleted.</p>`;
    const s=openSheet({title:'Void voucher',body,foot:`<button class="btn btn-secondary" data-close-void>Cancel</button><button class="btn btn-danger" id="enVoidGo" disabled>${ic('ban','s16')}Void voucher</button>`,focus:'#enVoidWhy'});
    const inp=s.sheet.querySelector('#enVoidWhy'),go=s.sheet.querySelector('#enVoidGo');
    inp.addEventListener('input',()=>{go.disabled=!inp.value.trim();});
    s.sheet.querySelector('[data-close-void]').addEventListener('click',()=>s.close(true));
    go.addEventListener('click',()=>{const why=inp.value.trim();if(!why)return;
      try{ledgerVoid(id,why);s.close(true);toast('Voided · it stays in your book with its history');openVoucherKey(keyOf(v));}catch(e){toast(String(e&&e.message||e));}});
    return s;
  }

  /* ── Voucher detail extras (js/books.js calls these) ── */
  function originBadge(v){
    if(!v||!v.origin||!ORIGIN[v.origin])return'';
    const[t,tone]=ORIGIN[v.origin];return`<span class="badge${tone?' '+tone:''}" data-origin="${escH(v.origin)}">${escH(t)}</span>`;
  }
  // A books-shaped voucher for a key the view leaves out (a void one), straight from the ledger.
  function voucherByKey(key){
    const x=L();if(!x||key==null)return null;key=String(key);
    const v=Object.values(x.vouchers).find(y=>y&&keyOf(y)===key);if(!v)return null;
    return{key,id:v.id,origin:v.origin,status:v.status,date:v.date,number:v.number||'',source:v.origin==='accurate'?(v.source||''):'App',type:v.type||'',description:v.description||'',
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
    const created=v.origin==='accurate'?'Imported from Accurate':v.origin==='ai'?'Drafted by Claude, posted by you':v.origin==='app'?'Entered by hand':`Posted from ${ORIGIN[v.origin]?ORIGIN[v.origin][0]:v.origin}`;
    return`<div class="en-sec" id="enHist"><h3 class="label">${ic('history','s16')} History</h3><ol class="en-hist">
      ${h.map(({e,label})=>{const b=e.before||{},dr=(b.lines||[]).reduce((s,l)=>s+(l.amount>0?l.amount:0),0);
        return`<li data-at="${escH(e.at)}"><div class="li-title">${escH(label)}${e.why?` · ${escH(e.why)}`:''}</div><div class="li-sub">${escH(who(e.why))} · ${escH(when(e.at))}</div>
          <details><summary>Before: ${escH(dayLong(b.date))} · ${rp(dr)}${b.description&&b.description!==v.description?` · ${escH(b.description)}`:''}</summary>${linesTable(b.lines)}</details></li>`;}).join('')}
      <li><div class="li-title">${escH(created)}</div><div class="li-sub">${escH(when(v.createdAt||v.at))}${v.prompt?` · “${escH(v.prompt)}”`:''}</div></li></ol></div>`;
  }
  // Tools under a voucher in Journals / the voucher sheet: Edit, Void, the status and the history.
  function voucherTools(bv){
    if(!bv||!bv.id||!seeded())return'';
    const v=ledgerVoucher(bv.id);if(!v)return'';
    const isVoid=v.status==='void';
    return`<div class="en-tools" data-vid="${escH(v.id)}">${isVoid?`<span class="badge bad" id="enVoidBadge">Void</span>`:`<button class="btn btn-secondary btn-sm" data-en-act="edit" data-id="${escH(v.id)}">${ic('pencil','s16')}Edit</button>
        <button class="btn btn-ghost btn-sm" data-en-act="void" data-id="${escH(v.id)}" style="color:var(--bad)">${ic('ban','s16')}Void</button>`}</div>
      ${historyHTML(v)}`;
  }
  function newEntryBtn(cls){return canPost()?`<button class="btn ${cls||'btn-primary'} btn-sm" data-en-act="new" id="enNewBtn">${ic('plus','s16')}New entry</button>`:'';}
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('[data-en-act]');if(!b||b.disabled)return;
    e.preventDefault();e.stopPropagation();
    const a=b.dataset.enAct;
    if(a==='new')openNew();else if(a==='edit')openEdit(b.dataset.id);else if(a==='void')openVoid(b.dataset.id);
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
      <p class="help" id="aiNote">Your key is stored in your private Google Drive app folder and this device; set a spend limit on it at console.anthropic.com; your sentence and your chart of accounts are sent to Anthropic when you ask the AI.</p>
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
    request:draftRequest
  };
  window.etAI=AI;
  window.aiSettingsHTML=aiSettingsHTML;
  window.etEntry={open:openNew,edit:openEdit,void:openVoid,canPost,originBadge,voucherTools,voucherByKey,voidList,newEntryBtn};
})();
