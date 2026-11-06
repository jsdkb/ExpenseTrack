/* ExpenseTrack v3 — the app's own book (schema et-ledger/1). Contract: docs/v3-ledger.md.

   Loaded by index.html after the core script and before the other modules (ledger, books, home,
   statements, extras). No personal data in this file: the repo is public.

   The ledger is a permanent record kept in its own Drive appData file (ledger.json) and cached on
   this device in IndexedDB 'et-ledger' (never in localStorage or STATE). It is seeded once from the
   three files the owner's PC exports (wealth snapshot, books, cash movements) and only if the views
   computed from it equal those files (the tie gate). From then on:
     - W(), BOOKS() and CM() in index.html return views computed from the ledger (§2);
     - a later Accurate export is merged, never copied over it: new vouchers wait in a pending list,
       vouchers that differ or disappeared are flagged, the app's own vouchers are linked (§3);
     - nothing is deleted: vouchers are voided, and every edit or void keeps the earlier version.
   Amounts are whole rupiah, debit positive. Balances are computed from posted vouchers. */
(function(){
  'use strict';

  const SCHEMA='et-ledger/1',FILE='ledger.json',IDB_NAME='et-ledger',IDB_STORE='ledger';
  const KINDS=['asset','liability','equity','income','expense'];
  const ORIGINS=['accurate','app','ai','month-end','income'];
  const ORIGIN_TYPE={app:'Manual',ai:'AI entry','month-end':'Month-end',income:'Income'};
  // The wealth snapshot's generic groups and account-type defaults (the PC snapshot builder). Only
  // used for an account the snapshot never classified (added later, in Accurate or in the app).
  const GROUPS_DEFAULT=[{id:'cash',label:'Cash & bank',side:'asset'},{id:'deposits',label:'Deposits & bonds',side:'asset'},
    {id:'stocks',label:'Stocks & crypto',side:'asset'},{id:'business',label:'Business stakes',side:'asset'},
    {id:'property',label:'Property',side:'asset'},{id:'receivables',label:'Receivables & reserves',side:'asset'},
    {id:'other_assets',label:'Other assets',side:'asset'},{id:'loans',label:'Loans',side:'liability'},
    {id:'cards',label:'Credit cards',side:'liability'},{id:'other_liabilities',label:'Other liabilities',side:'liability'}];
  const INVESTMENT_GROUPS=new Set(['deposits','stocks','business']);
  const TYPE_GROUP={'Cash/Bank':'cash','Accounts Receivable':'receivables','Investment':'receivables','Prepaid Tax / Other CA':'receivables',
    'Inventory':'other_assets','Fixed Assets':'property','Accum. Depreciation':'property','Accounts Payable':'loans','Other Payables':'loans'};
  const DIFF_SHOWN=50;

  /* ── State ── */
  let L=null,LFOR='',STATUS='idle',ERROR=null,LOCAL_DONE=false,DRIVE_TRIED=false,BUSY=null,fileId=null,revId=null;
  let VER=0,VIEWS={ver:-1},GATE=null,SAVE_T=null,SAVING=null,AUTO_SIG=null,SEEDING=null;
  // Drive holds a ledger.json this version can't read (damaged, or a newer schema): never save over it.
  let BLOCKED=null;

  /* ── Small helpers ── */
  const cp=o=>o==null?o:JSON.parse(JSON.stringify(o));
  const now=()=>new Date().toISOString();
  const iso=x=>{const t=Date.parse(x);return isNaN(t)?String(x||''):new Date(t).toISOString();};
  const atOf=v=>String((v&&v.at)||'');
  const cut=(s,n)=>String(s==null?'':s).slice(0,n);
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  const maxS=(...xs)=>xs.filter(Boolean).sort().pop()||null;
  const minS=(...xs)=>xs.filter(Boolean).sort()[0]||null;
  const owner=()=>(typeof USER_EMAIL==='string'&&USER_EMAIL)||'';
  function monthRange(a,b){const out=[];if(!a||!b||a>b)return out;let[y,m]=a.split('-').map(Number);const[ly,lm]=b.split('-').map(Number);
    while(y<ly||(y===ly&&m<=lm)){out.push(`${y}-${String(m).padStart(2,'0')}`);m++;if(m===13){y++;m=1;}}return out;}
  function validDate(d){if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;const t=new Date(d+'T00:00:00Z');return!isNaN(t)&&t.toISOString().slice(0,10)===d;}
  function err(list){const e=new Error((Array.isArray(list)?list:[list]).join('; '));e.errors=Array.isArray(list)?list:[list];return e;}

  function emptyLedger(){
    return{schema:SCHEMA,seededAt:null,updatedAt:null,currency:'IDR',source:{},accounts:{},vouchers:{},market:{},closes:[],groups:[],
      cash:{accounts:{},statements:{},txns:{},alias:{}},links:{},flags:{},pending:{},imports:[]};
  }
  function validLedger(x){return!!(x&&x.schema===SCHEMA&&x.accounts&&typeof x.accounts==='object'&&x.vouchers&&typeof x.vouchers==='object');}
  function norm(x){
    const e=emptyLedger(),o={...e,...x};
    for(const k of['source','accounts','vouchers','market','links','flags','pending'])if(!o[k]||typeof o[k]!=='object'||Array.isArray(o[k]))o[k]={};
    for(const k of['closes','groups','imports'])if(!Array.isArray(o[k]))o[k]=[];
    o.cash={...e.cash,...(o.cash||{})};for(const k of['accounts','statements','txns','alias'])if(!o.cash[k]||typeof o.cash[k]!=='object')o.cash[k]={};
    return o;
  }

  /* ── Voucher shapes ── */
  function normLines(ls){
    return(ls||[]).map(l=>{const o={account:String(l.account),amount:Math.round(+l.amount||0),memo:cut(l.memo!=null?l.memo:l.description,200)};
      if(l.fx)o.fx={ccy:String(l.fx.ccy||'').toUpperCase(),amount:+l.fx.amount,rate:+l.fx.rate};
      if(l.stmtLine)o.stmtLine=cut(l.stmtLine,120);return o;});
  }
  function vFromBooks(v,at){
    const k=String(v.key);
    return{id:'acc|'+k,srcKey:k,origin:'accurate',source:v.source||'',date:String(v.date).slice(0,10),number:v.number||'',type:v.type||'',
      description:v.description||'',status:'posted',createdAt:at,updatedAt:at,at,lines:normLines(v.lines),history:[]};
  }
  function accFromBooks(a,at){
    return{id:String(a.id),name:String(a.name!=null?a.name:a.id),kind:KINDS.includes(a.kind)?a.kind:'asset',type:a.type||'',
      parent:a.parent!=null&&a.parent!==''?String(a.parent):null,isParent:!!a.isParent,suspended:!!a.suspended,
      order:a.order!=null?a.order:null,ccy:a.ccy||'IDR',side:null,group:null,investment:null,active:null,origin:'accurate',at};
  }
  const CHART_FIELDS=['name','kind','type','parent','isParent','suspended','order','ccy'];
  // Same as sigOf in js/books.js: date | debit total | sorted set of accounts with a non-zero line.
  function sigOf(v){let dr=0;const s=new Set();for(const l of v.lines||[]){const a=Math.round(l.amount||0);if(a>0)dr+=a;if(a)s.add(String(l.account));}
    return`${v.date}|${dr}|${[...s].sort().join(',')}`;}
  // What "the same voucher" means when an import is compared with the ledger: date and lines.
  function contentSig(v){return v.date+'#'+(v.lines||[]).map(l=>`${l.account}:${Math.round(l.amount||0)}`).sort().join(',');}
  const debitOf=v=>(v.lines||[]).reduce((s,l)=>s+(l.amount>0?l.amount:0),0);

  /* ── Views (adapters). Computed from a ledger, cached per change for the live one ── */
  function coreOf(x){
    const act={},touched=new Set();let first=null,last=null,glAsOf=null;
    for(const v of Object.values(x.vouchers)){
      if(!v||v.status!=='posted')continue;
      const m=v.date.slice(0,7);if(!first||m<first)first=m;if(!last||m>last)last=m;if(!glAsOf||v.date>glAsOf)glAsOf=v.date;
      const a=act[m]||(act[m]={});
      for(const l of v.lines||[]){if(!l.amount)continue;a[l.account]=(a[l.account]||0)+l.amount;touched.add(l.account);}
    }
    const s=x.source||{};
    for(const t of[s.balancesAsOf,s.wealthAsOf])if(t&&(!last||t>last))last=t;
    if(!first)first=last;
    const months=monthRange(first,last),balances={},activity={},run={};
    for(const m of months){
      const a=act[m]||{};
      for(const[k,v]of Object.entries(a))run[k]=(run[k]||0)+v;
      activity[m]=sortedNonZero(a);balances[m]=sortedNonZero(run);
    }
    const wFrom=s.wealthFrom&&s.wealthFrom>first?s.wealthFrom:first;
    return{months,balances,activity,touched,glAsOf,wMonths:months.filter(m=>m>=wFrom)};
  }
  function sortedNonZero(o){const r={};for(const k of Object.keys(o).sort())if(o[k])r[k]=o[k];return r;}

  // Side and group of a balance-sheet account: what the snapshot said (kept per account), else a
  // default from the account's type; then the snapshot builder's rule for a balance on the "wrong"
  // side (a payable with a debit balance is shown as a receivable, an asset with a credit balance
  // under Other liabilities). Applied to what the snapshot said, the rule changes nothing, so the
  // seed reproduces the snapshot; later it moves an account the way the next snapshot would.
  function placeOf(a,latest){
    let group=a.group,side=a.side;
    if(!group||!side){
      group=/credit card/i.test(a.name||'')?'cards':TYPE_GROUP[a.type]||(a.kind==='liability'?'other_liabilities':'other_assets');
      side=(GROUPS_DEFAULT.find(g=>g.id===group)||{side:a.kind==='liability'?'liability':'asset'}).side;
    }
    let flipped=false;
    if(side==='liability'&&group!=='cards'&&latest>0.5){group='receivables';side='asset';flipped=true;}
    else if(side==='asset'&&latest<-0.5&&(group==='receivables'||group==='other_assets')){group='other_liabilities';side='liability';flipped=true;}
    return{group,side,flipped};
  }
  function wViewOf(x,c){
    const s=x.source||{},wm=c.wMonths,lastM=c.months[c.months.length-1],lastBal=lastM?c.balances[lastM]:{},recent=wm.slice(-12);
    const accounts=[];
    for(const a of Object.values(x.accounts)){
      if(!a||a.isParent||(a.kind!=='asset'&&a.kind!=='liability'))continue;
      const app=a.origin!=='accurate',lines=c.touched.has(a.id);
      if(!lines&&!(a.side&&a.group)&&!(app&&!a.suspended))continue;
      const p=placeOf(a,lastBal[a.id]||0);
      const o={id:a.id,name:a.name,group:p.group,side:p.side,ccy:a.ccy||'IDR',
        investment:p.flipped?false:(a.investment!=null?!!a.investment:INVESTMENT_GROUPS.has(p.group)),
        active:app&&!lines?true:recent.some(m=>(c.balances[m]||{})[a.id]),type:a.type||''};
      if(app)o.pending=true;
      accounts.push(o);
    }
    accounts.sort((p,q)=>cmp(p.id,q.id));
    const sideOf=new Map(accounts.map(a=>[a.id,a.side]));
    const months=wm.map(m=>{const b={};for(const[k,v]of Object.entries(c.balances[m]||{})){const sd=sideOf.get(k);if(sd&&v)b[k]=sd==='asset'?v:-v;}return{month:m,balances:b};});
    const market={};
    for(const[m,o]of Object.entries(x.market||{}).sort((p,q)=>cmp(p[0],q[0]))){const r={};for(const[k,e]of Object.entries(o||{}))if(e&&e.v!=null&&!e.deleted)r[k]=e.v;if(Object.keys(r).length)market[m]=r;}
    const kind=k=>(x.accounts[k]||{}).kind;
    const pnl=[];
    for(const m of c.months){let inc=0,exp=0,any=false;
      for(const[k,v]of Object.entries(c.activity[m]||{})){const kd=kind(k);if(kd!=='income'&&kd!=='expense')continue;any=true;if(v<0)inc-=v;else exp+=v;}
      if(any)pnl.push({month:m,income:inc,expense:exp});}
    const ledger=[];
    for(const a of Object.values(x.accounts)){
      if(!a||a.isParent||!['equity','income','expense'].includes(a.kind))continue;
      const app=a.origin!=='accurate';
      if(!a.plKind&&!c.touched.has(a.id)&&!(app&&!a.suspended))continue;
      const o={id:a.id,name:a.name,kind:a.plKind||a.kind,type:a.type||''};if(app)o.pending=true;ledger.push(o);
    }
    ledger.sort((p,q)=>cmp(p.id,q.id));
    const closes=(x.closes||[]).map(cl=>{const o=cp(cl);delete o.at;return o;}).sort((p,q)=>cmp(p.month,q.month));
    return{schema:'et-wealth/1',fromLedger:true,generatedAt:s.wealthGeneratedAt||x.seededAt,currency:x.currency||'IDR',
      source:{book:s.book||'',asOf:wm.length?wm[wm.length-1]:(s.wealthAsOf||''),exportedOn:s.exportedOn||''},
      groups:x.groups&&x.groups.length?cp(x.groups):cp(GROUPS_DEFAULT),accounts,months,market,pnl,ledger,closes,checks:[]};
  }
  function booksVoucher(v){
    const acc=v.origin==='accurate';
    return{key:acc?(v.srcKey||v.id):v.id,id:v.id,origin:v.origin,date:v.date,number:v.number||'',source:acc?(v.source||''):'App',
      type:acc?(v.type||''):(v.type||ORIGIN_TYPE[v.origin]||'Manual'),description:v.description||'',
      lines:(v.lines||[]).map(l=>{const o={account:l.account,amount:l.amount,description:l.memo||''};if(l.fx)o.fx={...l.fx};return o;})};
  }
  function booksViewOf(x,c){
    const s=x.source||{};
    const accounts=Object.values(x.accounts).filter(Boolean).map(a=>({id:a.id,name:a.name,type:a.type||'',kind:a.kind,parent:a.parent||null,
      isParent:!!a.isParent,suspended:!!a.suspended,order:a.order!=null?a.order:1e9,ccy:a.ccy||'IDR',...(a.origin!=='accurate'?{pending:true}:{})}))
      .sort((p,q)=>p.order-q.order||cmp(p.id,q.id));
    const vouchers=Object.values(x.vouchers).filter(v=>v&&v.status==='posted').map(booksVoucher).sort((p,q)=>cmp(p.date,q.date)||cmp(p.key,q.key));
    return{schema:'et-books/1',fromLedger:true,generatedAt:s.booksGeneratedAt||x.seededAt,currency:x.currency||'IDR',
      source:{book:s.book||'',exportedOn:s.exportedOn||'',glAsOf:c.glAsOf,balancesAsOf:s.balancesAsOf||c.months[c.months.length-1]||null},
      accounts,vouchers,months:c.months,balances:c.balances,activity:c.activity,checks:[],tie:{monthsChecked:0,maxDiff:0}};
  }
  function cashViewOf(x){
    const C=x.cash||{},s=x.source||{};
    const list=(o,f)=>Object.values(o||{}).filter(Boolean).sort((p,q)=>(p.n||0)-(q.n||0)).map(f);
    if(!Object.keys(C.txns||{}).length&&!Object.keys(C.statements||{}).length)return null;
    return{schema:'et-cash/1',fromLedger:true,generatedAt:s.cashGeneratedAt||x.seededAt,asOf:s.cashAsOf||null,
      accounts:list(C.accounts,a=>({id:a.id,label:a.label,kind:a.kind,currency:a.currency||'IDR'})),
      statements:list(C.statements,t=>({id:t.id,account:t.account,date:t.date,periodStart:t.periodStart||null,dueDate:t.dueDate||null,
        minPayment:t.minPayment!=null?t.minPayment:null,receivedAt:t.receivedAt||null,opening:t.opening,closing:t.closing,tieOk:!!t.tieOk,notes:Array.isArray(t.notes)?[...t.notes]:[]})),
      txns:list(C.txns,t=>({id:t.id,account:t.account,currency:t.currency||'IDR',date:t.date,amount:t.amount,type:t.type,desc:t.desc||'',counterparty:t.counterparty||'',match:t.match||null}))};
  }
  function live(){return L&&L.seededAt&&LFOR===owner()?L:null;}
  function views(){if(VIEWS.ver!==VER)VIEWS={ver:VER};return VIEWS;}
  // The adapters index.html's W(), BOOKS() and CM() return once the ledger is seeded (else null).
  function ledgerView(kind){
    const x=live();if(!x)return null;const V=views();
    if(!V.core)V.core=coreOf(x);
    if(kind==='wealth')return V.w||(V.w=wViewOf(x,V.core));
    if(kind==='books')return V.b||(V.b=booksViewOf(x,V.core));
    if(kind==='cash'){if(!('c'in V))V.c=cashViewOf(x);return V.c;}
    return null;
  }

  /* ── Merging an export into a ledger (Accurate wins nothing the app owns) ── */
  function setBooksSource(x,b){
    const s=x.source;s.book=(b.source&&b.source.book)||s.book||'';s.exportedOn=(b.source&&b.source.exportedOn)||s.exportedOn||'';
    s.balancesAsOf=maxS(s.balancesAsOf,b.source&&b.source.balancesAsOf);s.booksGeneratedAt=maxS(s.booksGeneratedAt,iso(b.generatedAt));
  }
  function fillWealth(x,w,stamp){
    const at=iso(w.generatedAt),n={accounts:0,market:0,closes:0};
    for(const a of w.accounts||[]){
      const id=String(a.id);let cur=x.accounts[id];
      if(!cur){cur=x.accounts[id]={id,name:a.name||id,kind:a.side==='liability'?'liability':'asset',type:a.type||'',parent:null,isParent:false,
        suspended:false,order:null,ccy:a.ccy||'IDR',side:null,group:null,investment:null,active:null,origin:'accurate',at:stamp};n.accounts++;}
      let ch=false;for(const k of['side','group','investment','active'])if(cur[k]==null&&a[k]!=null){cur[k]=a[k];ch=true;}
      if(ch&&stamp>atOf(cur))cur.at=stamp;
    }
    for(const l of w.ledger||[]){
      const id=String(l.id);let cur=x.accounts[id];
      if(!cur){cur=x.accounts[id]={id,name:l.name||id,kind:KINDS.includes(l.kind)?l.kind:'expense',type:l.type||'',parent:null,isParent:false,
        suspended:false,order:null,ccy:'IDR',side:null,group:null,investment:null,active:null,origin:'accurate',at:stamp};n.accounts++;}
      if(cur.plKind==null&&l.kind){cur.plKind=l.kind;if(stamp>atOf(cur))cur.at=stamp;}
    }
    for(const g of w.groups||[])if(g&&g.id&&!x.groups.some(h=>h.id===g.id))x.groups.push({id:g.id,label:g.label||g.id,side:g.side==='liability'?'liability':'asset'});
    for(const[m,o]of Object.entries(w.market||{}))for(const[code,v]of Object.entries(o||{})){
      if(v==null||isNaN(+v))continue;const mm=x.market[m]||(x.market[m]={}),cur=mm[code];
      if(!cur||(at>=atOf(cur)&&cur.v!==Math.round(+v))){mm[code]={v:Math.round(+v),at,src:'snapshot'};n.market++;}
    }
    for(const c of w.closes||[]){
      if(!c||!c.month)continue;const i=x.closes.findIndex(y=>y.month===c.month),cur=i<0?null:x.closes[i];
      const nx={...cp(c),at};
      if(!cur){x.closes.push(nx);n.closes++;}
      else if(at>=atOf(cur)&&JSON.stringify({...cur,at:0})!==JSON.stringify({...nx,at:0})){x.closes[i]=nx;n.closes++;}
    }
    x.closes.sort((p,q)=>cmp(p.month,q.month));
    const s=x.source,ms=(w.months||[]).map(m=>m.month).filter(Boolean).sort();
    s.book=s.book||(w.source&&w.source.book)||'';s.exportedOn=s.exportedOn||(w.source&&w.source.exportedOn)||'';
    if(ms.length){s.wealthFrom=minS(s.wealthFrom,ms[0]);s.wealthAsOf=maxS(s.wealthAsOf,ms[ms.length-1]);}
    s.wealthGeneratedAt=maxS(s.wealthGeneratedAt,at);
    return n;
  }
  const cashKey=t=>`${t.account}|${t.date}|${t.amount}|${cut(t.desc,120)}`;
  // Old line id → new line id for lines that lost their id in a newer file but are the same line
  // (account, date, amount and description equal). One-to-one, in file order.
  function cashIdRemap(oldList,newList){
    const newIds=new Set((newList||[]).map(t=>t&&t.id)),oldIds=new Set((oldList||[]).map(t=>t&&t.id)),stale=new Map(),map={};
    for(const t of oldList||[])if(t&&t.id&&!newIds.has(t.id)){const k=cashKey(t);(stale.get(k)||stale.set(k,[]).get(k)).push(t.id);}
    for(const t of newList||[])if(t&&t.id&&!oldIds.has(t.id)){const q=stale.get(cashKey(t));if(q&&q.length)map[q.shift()]=t.id;}
    return map;
  }
  // Moves the owner's decisions that point at a cash line from its old id to its new one.
  function remapCashRefs(map){
    const pairs=Object.entries(map||{});if(!pairs.length||typeof STATE!=='object'||!STATE)return 0;
    let n=0;const rekey=(o,a,b)=>{if(o&&Object.prototype.hasOwnProperty.call(o,a)&&!Object.prototype.hasOwnProperty.call(o,b)){o[b]=o[a];delete o[a];n++;}};
    const f=STATE.stmtFix||{};
    for(const[a,b]of pairs){
      for(const v of Object.values(f.match||{}))if(v&&v.line===a){v.line=b;n++;}
      rekey(f.added,a,b);rekey(STATE.cashTypeOverrides,a,b);
      for(const k of['catOverrides','txEdits','splits','notes','subDecisions'])rekey(STATE[k],'stmt:'+a,'stmt:'+b);
      for(const k of['hiddenIds','ccPosExcludedIds'])if(Array.isArray(STATE[k])){const i=STATE[k].indexOf('stmt:'+a);if(i>=0){STATE[k][i]='stmt:'+b;n++;}}
    }
    if(n&&typeof scheduleDriveSave==='function')scheduleDriveSave();
    return n;
  }
  // c is the cash file as applyCash stores it (fields trimmed). Lines and statements are never dropped.
  function mergeCash(x,c,remapState){
    const at=iso(c.generatedAt),C=x.cash,n={accounts:0,statements:0,txns:0,remapped:0,refs:0};
    let seq=1;for(const k of['accounts','statements','txns'])for(const v of Object.values(C[k]))if(v&&v.n>=seq)seq=v.n+1;
    const put=(store,id,val,count)=>{const cur=store[id];
      if(!cur){store[id]={...val,n:seq++,at};n[count]++;return;}
      if(at<atOf(cur))return;const a={...cur};delete a.n;delete a.at;if(JSON.stringify(a)!==JSON.stringify(val))store[id]={...val,n:cur.n,at};};
    for(const a of c.accounts||[])if(a&&a.id)put(C.accounts,a.id,{id:a.id,label:a.label,kind:a.kind,currency:a.currency||'IDR'},'accounts');
    for(const s of c.statements||[]){if(!s)continue;const id=s.id||(s.account+'|'+s.date);
      put(C.statements,id,{id,account:s.account,date:s.date,periodStart:s.periodStart||null,dueDate:s.dueDate||null,minPayment:s.minPayment!=null?s.minPayment:null,receivedAt:s.receivedAt||(C.statements[id]&&C.statements[id].receivedAt)||null,   // a file without it never wipes a known arrival day
        opening:s.opening,closing:s.closing,tieOk:!!s.tieOk,notes:Array.isArray(s.notes)?s.notes.map(t=>cut(t,200)):[]},'statements');}
    const inc=(c.txns||[]).filter(t=>t&&t.id);
    const map=cashIdRemap(Object.values(C.txns).sort((p,q)=>(p.n||0)-(q.n||0)),inc);
    for(const[a,b]of Object.entries(map)){const old=C.txns[a];C.txns[b]={...old,id:b,at};delete C.txns[a];C.alias[a]=b;n.remapped++;}
    for(const t of inc)put(C.txns,t.id,{id:t.id,account:t.account,currency:t.currency||'IDR',date:t.date,amount:t.amount,type:t.type,
      desc:cut(t.desc,120),counterparty:cut(t.counterparty,60),match:t.match||null},'txns');
    if(Object.keys(map).length)for(const t of Object.values(C.txns))if(t&&t.match&&map[t.match])t.match=map[t.match];
    if(remapState)n.refs=remapCashRefs(map);
    x.source.cashGeneratedAt=maxS(x.source.cashGeneratedAt,at);x.source.cashAsOf=maxS(x.source.cashAsOf,c.asOf||null);
    return n;
  }
  function mergeBooks(x,b){
    const at=iso(b.generatedAt),t=now(),r={accounts:0,new:0,differs:0,missing:0,linked:0};
    for(const a of b.accounts||[]){
      const id=String(a.id),cur=x.accounts[id],nx=accFromBooks(a,at);
      if(!cur){x.accounts[id]=nx;r.accounts++;continue;}
      const changedF=CHART_FIELDS.some(k=>JSON.stringify(cur[k])!==JSON.stringify(nx[k]));
      if(cur.origin!=='accurate'){for(const k of CHART_FIELDS)cur[k]=nx[k];cur.origin='accurate';cur.at=t;r.accounts++;continue;}   // created in Accurate since
      if(changedF&&at>=atOf(cur)){for(const k of CHART_FIELDS)cur[k]=nx[k];cur.at=at;r.accounts++;}
    }
    const incoming=new Map((b.vouchers||[]).map(v=>{const y=vFromBooks(v,at);return[y.id,y];}));
    const linkedTo=new Set(Object.values(x.links||{}));
    const appBySig=new Map();
    for(const v of Object.values(x.vouchers))if(v&&v.origin!=='accurate'&&v.status==='posted'&&!x.links[v.id]){const s=sigOf(v);(appBySig.get(s)||appBySig.set(s,[]).get(s)).push(v.id);}
    for(const q of appBySig.values())q.sort();
    // Fallback for foreign-currency entries: Accurate's file is rupiah-only and leaves the
    // foreign-currency group out (lines with fx, and Month-end's difference line on them — core
    // meFxGroup), so its signature differs. An app voucher with such lines (or from Month-end) also
    // links to an Accurate voucher on the same date whose lines are exactly its other lines.
    const fxGroup=l=>!!l.fx||(typeof meFxGroup==='function'&&meFxGroup(l));
    const appByRp=new Map(),used=new Set();
    for(const v of Object.values(x.vouchers))if(v&&v.origin!=='accurate'&&v.status==='posted'&&!x.links[v.id]&&(v.origin==='month-end'||(v.lines||[]).some(l=>l&&l.fx))){
      const rp=(v.lines||[]).filter(l=>l&&!fxGroup(l));if(!rp.length||rp.length===(v.lines||[]).length)continue;
      const k=contentSig({date:v.date,lines:rp});(appByRp.get(k)||appByRp.set(k,[]).get(k)).push(v.id);}
    for(const q of appByRp.values())q.sort();
    const take=q=>{while(q&&q.length){const id=q.shift();if(!used.has(id)){used.add(id);return id;}}return null;};
    for(const[id,y]of incoming){
      const cur=x.vouchers[id],f=x.flags[id];
      if(cur){
        const sig=contentSig(y);
        if(contentSig(cur)===sig){if(f&&(f.kind==='differs'||f.kind==='missing'))x.flags[id]={kind:'cleared',was:f.kind,at:t};continue;}
        if(f&&((f.kind==='dismissed'&&f.was==='differs')||f.kind==='differs')&&f.sig===sig){if(f.kind==='differs')r.differs++;continue;}
        x.flags[id]={kind:'differs',at:t,sig,accurate:{date:y.date,number:y.number,type:y.type,description:y.description,lines:y.lines}};r.differs++;continue;
      }
      if(linkedTo.has(id))continue;
      const p=x.pending[id];
      if(p&&p.status==='accepted')continue;
      const appId=take(appBySig.get(sigOf(y)))||take(appByRp.get(contentSig(y)));
      if(appId){x.links[appId]=id;linkedTo.add(id);r.linked++;continue;}
      if(p&&p.status==='pending'){if(contentSig(p.voucher||{})!==contentSig(y))x.pending[id]={...p,voucher:y,importedAt:at,at:t};continue;}
      x.pending[id]={status:'pending',at:t,importedAt:at,voucher:y};r.new++;
    }
    for(const v of Object.values(x.vouchers)){
      if(!v||v.origin!=='accurate'||incoming.has(v.id))continue;
      const f=x.flags[v.id];
      if(v.status!=='posted'||(f&&(f.kind==='missing'||(f.kind==='dismissed'&&f.was==='missing'))))continue;
      x.flags[v.id]={kind:'missing',at:t};r.missing++;
    }
    for(const[id,p]of Object.entries(x.pending))if(p&&p.status==='pending'&&!incoming.has(id))x.pending[id]={...p,status:'gone',at:t};
    setBooksSource(x,b);
    return r;
  }

  /* ── Seeding with the tie gate ── */
  function seedFrom(w,b,c){
    const x=emptyLedger(),at=iso(b.generatedAt);
    for(const a of b.accounts||[])x.accounts[String(a.id)]=accFromBooks(a,at);
    for(const v of b.vouchers||[]){const y=vFromBooks(v,at);x.vouchers[y.id]=y;}
    setBooksSource(x,b);
    const wn=fillWealth(x,w,iso(w.generatedAt));
    const imports=[{at:now(),kind:'books',generatedAt:at,added:Object.keys(x.vouchers).length,new:0,differs:0,missing:0,linked:0},
      {at:now(),kind:'wealth',generatedAt:iso(w.generatedAt),added:wn.market+wn.closes,new:0,differs:0,missing:0,linked:0}];
    if(c&&Array.isArray(c.txns)){const cn=mergeCash(x,c,false);imports.push({at:now(),kind:'cash',generatedAt:iso(c.generatedAt),added:cn.txns,new:0,differs:0,missing:0,linked:0});}
    x.imports=imports;
    return x;
  }
  function diffMaps(a,b,push){for(const k of new Set([...Object.keys(a||{}),...Object.keys(b||{})])){const p=(a||{})[k]||0,q=(b||{})[k]||0;if(p!==q)push(k,p,q);}}
  // Every difference between the views computed from x and the imported files ([] = the seed ties).
  function gateDiffs(x,w,b){
    const c=coreOf(x),vb=booksViewOf(x,c),vw=wViewOf(x,c),out=[];
    if(JSON.stringify(vb.months)!==JSON.stringify(b.months))out.push({what:'months',app:vb.months.length,file:b.months.length});
    for(const m of b.months){
      diffMaps(vb.balances[m],(b.balances||{})[m],(k,p,q)=>out.push({what:'books balance',month:m,account:k,app:p,file:q}));
      if(b.activity)diffMaps(vb.activity[m],b.activity[m],(k,p,q)=>out.push({what:'books activity',month:m,account:k,app:p,file:q}));
    }
    const byMonth=new Map(vw.months.map(m=>[m.month,m.balances]));
    for(const sm of w.months||[]){
      if(!byMonth.has(sm.month)){out.push({what:'snapshot month',month:sm.month});continue;}
      diffMaps(byMonth.get(sm.month),sm.balances,(k,p,q)=>out.push({what:'snapshot balance',month:sm.month,account:k,app:p,file:q}));
    }
    if(vw.months.length!==(w.months||[]).length)out.push({what:'months',app:vw.months.length,file:(w.months||[]).length});
    const va=new Map(vw.accounts.map(a=>[a.id,a]));
    for(const a of w.accounts||[]){const v=va.get(String(a.id));
      if(!v)out.push({what:'snapshot account',account:a.id});
      else if(v.side!==a.side||v.group!==a.group)out.push({what:'snapshot side',account:a.id,app:v.group+'/'+v.side,file:a.group+'/'+a.side});}
    return out;
  }
  function seedInputs(){
    const w=typeof STATE==='object'&&STATE?STATE.wealth:null,b=typeof BOOKS_DATA!=='undefined'?BOOKS_DATA:null,c=STATE?STATE.cash:null;
    return{w:typeof validWealth==='function'&&validWealth(w)?w:null,b:typeof validBooks==='function'&&validBooks(b)?b:null,c:c&&Array.isArray(c.txns)?c:null};
  }
  // Seeds the ledger from the imported files if (and only if) the views tie to them. Never replaces a
  // ledger that exists on this device or in Drive. → {ok, reason?, count, diffs}
  async function ledgerSeed(o){
    o=o||{};if(SEEDING)return SEEDING;
    SEEDING=(async()=>{
      try{
        if(STATUS==='error'&&!o.quiet)DRIVE_TRIED=false;   // a button press retries Drive
        await ensureLedger();
        if(live())return{ok:true,already:true};
        if(STATUS==='error')return GATE={ok:false,reason:'error',at:now(),count:0,diffs:[]};
        const{w,b,c}=seedInputs();
        if(!w||!b)return GATE={ok:false,reason:'missing',at:now(),count:0,diffs:[],wealth:!!w,books:!!b};
        const x=seedFrom(w,b,c),diffs=gateDiffs(x,w,b);
        GATE={ok:!diffs.length,at:now(),count:diffs.length,diffs:diffs.slice(0,DIFF_SHOWN),wealthAt:w.generatedAt,booksAt:b.generatedAt};
        if(diffs.length){if(!o.quiet)toast(`Your book wasn’t set up: ${diffs.length} difference${diffs.length===1?'':'s'} with the imported files`);
          if(typeof ACTIVE_TAB!=='undefined'&&ACTIVE_TAB==='settings')renderAll();return GATE;}
        x.seededAt=now();L=x;LFOR=owner();STATUS='ready';ERROR=null;
        changed({why:'seed'});
        toast(`Your book is set up · ${Object.keys(x.vouchers).length} vouchers`);
        return GATE;
      }finally{SEEDING=null;}
    })();
    return SEEDING;
  }
  // Quiet seed attempt, once per combination of imported files.
  function autoSeed(){
    if(BLOCKED||live()||!owner())return;
    const{w,b,c}=seedInputs();if(!w||!b)return;
    const sig=[w.generatedAt,b.generatedAt,c?c.generatedAt:''].join('|');
    if(sig===AUTO_SIG)return;AUTO_SIG=sig;
    ledgerSeed({quiet:true}).catch(e=>console.error('Ledger seed failed',e));
  }

  /* ── Device merge (two copies of the ledger): per entry, the newer `at` wins; union of keys ── */
  function byAt(r,l){const o={...(r||{})};for(const[k,v]of Object.entries(l||{}))if(!(k in o)||atOf(v)>=atOf(o[k]))o[k]=v;return o;}
  function mergeLedgers(remote,local){
    const r=norm(cp(remote)),l=norm(cp(local)),o=emptyLedger();
    o.seededAt=minS(r.seededAt,l.seededAt);o.updatedAt=maxS(r.updatedAt,l.updatedAt);o.currency=l.currency||r.currency||'IDR';
    o.accounts=byAt(r.accounts,l.accounts);
    o.vouchers=byAt(r.vouchers,l.vouchers);
    for(const id of Object.keys(o.vouchers)){const a=r.vouchers[id],b=l.vouchers[id];if(!a||!b)continue;
      const seen=new Set(),h=[];for(const e of[...(a.history||[]),...(b.history||[])]){const k=e.at+'|'+e.why;if(!seen.has(k)){seen.add(k);h.push(e);}}
      // Edited on both devices: the newer version wins, and the other one goes into the history.
      // "Both": the losing copy has a change the winner doesn't know about, its content differs, and
      // it isn't just an earlier state the winner already records.
      const win=o.vouchers[id],lose=win===a?b:a,lc=JSON.stringify(vContent(lose));
      const known=new Set((win.history||[]).map(e=>e.at+'|'+e.why)),edited=(lose.history||[]).some(e=>e&&!known.has(e.at+'|'+e.why));
      if(edited&&lc!==JSON.stringify(vContent(win))&&!h.some(e=>e&&e.before&&JSON.stringify(vContent(e.before))===lc))
        h.push({at:atOf(lose)||now(),why:CONCURRENT,before:vContent(lose)});
      o.vouchers[id]={...win,history:h.sort((p,q)=>cmp(p.at,q.at))};}
    healDuplicatePosts(o);
    for(const m of new Set([...Object.keys(r.market),...Object.keys(l.market)]))o.market[m]=byAt(r.market[m],l.market[m]);
    const cl=byAt(Object.fromEntries(r.closes.map(c=>[c.month,c])),Object.fromEntries(l.closes.map(c=>[c.month,c])));
    o.closes=Object.values(cl).sort((p,q)=>cmp(p.month,q.month));
    o.groups=[...l.groups,...r.groups.filter(g=>!l.groups.some(h=>h.id===g.id))];
    for(const k of['accounts','statements','txns'])o.cash[k]=byAt(r.cash[k],l.cash[k]);
    o.cash.alias={...r.cash.alias,...l.cash.alias};
    for(const a of Object.keys(o.cash.alias))if(o.cash.txns[a]){const b=o.cash.alias[a];if(!o.cash.txns[b])o.cash.txns[b]={...o.cash.txns[a],id:b};delete o.cash.txns[a];}
    o.links={...r.links,...l.links};
    o.flags=byAt(r.flags,l.flags);o.pending=byAt(r.pending,l.pending);
    const seen=new Set();o.imports=[...r.imports,...l.imports].filter(e=>{const k=e.at+'|'+e.kind;if(seen.has(k))return false;seen.add(k);return true;}).sort((p,q)=>cmp(p.at,q.at));
    const rs=r.source,ls=l.source;o.source={...rs,...ls};
    for(const k of['balancesAsOf','wealthAsOf','booksGeneratedAt','wealthGeneratedAt','cashGeneratedAt','cashAsOf'])o.source[k]=maxS(rs[k],ls[k]);
    o.source.wealthFrom=minS(rs.wealthFrom,ls.wealthFrom);
    return o;
  }
  const CONCURRENT='edited on another device at the same time',DUPLICATE='duplicate post from another device';
  function vContent(v){return{date:v.date,description:v.description||'',status:v.status||'posted',
    lines:(v.lines||[]).map(l=>({account:String(l.account),amount:Math.round(l.amount||0),memo:l.memo||'',...(l.fx?{fx:{ccy:l.fx.ccy,amount:l.fx.amount,rate:l.fx.rate}}:{})}))};}
  // Income and month-end vouchers carry the receipt id / 'month-end:YYYY-MM' as ref; only one may be
  // posted per ref. Two devices posting at once leave two: keep the newest, void the other (history
  // kept), so the book heals itself on the next merge.
  const REF_ORIGINS=['income','month-end'];
  function healDuplicatePosts(x){
    const by=new Map();let n=0;
    for(const v of Object.values(x.vouchers||{}))if(v&&v.status==='posted'&&v.ref&&REF_ORIGINS.includes(v.origin)){const k=v.origin+'|'+v.ref;(by.get(k)||by.set(k,[]).get(k)).push(v);}
    for(const vs of by.values()){if(vs.length<2)continue;
      vs.sort((p,q)=>cmp(String(q.createdAt||q.at||''),String(p.createdAt||p.at||''))||cmp(q.id,p.id));
      for(const v of vs.slice(1)){const t=now();
        x.vouchers[v.id]={...v,status:'void',updatedAt:t,at:t,history:[...(v.history||[]),{at:t,why:DUPLICATE,before:vContent(v)}]};n++;}}
    return n;
  }
  // The posted voucher for a ref (an income receipt id or 'month-end:YYYY-MM'), or null.
  function findByRef(ref,origin){const x=live();if(!x||!ref)return null;let best=null;
    for(const v of Object.values(x.vouchers))if(v&&v.status==='posted'&&v.ref===ref&&(!origin||v.origin===origin)&&(!best||String(v.createdAt||v.at||'')>String(best.createdAt||best.at||'')))best=v;
    return best;}
  // A cheap fingerprint: which entries exist and when each last changed.
  function fp(x){
    const p=[];for(const k of['accounts','vouchers','flags','pending'])for(const[id,v]of Object.entries(x[k]||{}))p.push(k+':'+id+':'+atOf(v));
    for(const[m,o]of Object.entries(x.market||{}))for(const[c,v]of Object.entries(o||{}))p.push('m:'+m+':'+c+':'+atOf(v));
    for(const c of x.closes||[])p.push('c:'+c.month+':'+atOf(c));
    for(const k of['accounts','statements','txns'])for(const[id,v]of Object.entries(((x.cash||{})[k])||{}))p.push('cash'+k+':'+id+':'+atOf(v));
    p.push('L'+Object.keys(x.links||{}).length,'I'+(x.imports||[]).length,'A'+Object.keys((x.cash||{}).alias||{}).length);
    return p.sort().join('|');
  }

  /* ── Storage: IndexedDB cache (guarded, times out) and Drive appData with compare-and-swap ── */
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
  // One cache entry per account ('current|' + owner), so switching Google accounts never mixes or
  // loses a book. An older single 'current' entry is read once for its own owner (never deleted).
  const cacheKey=o=>'current|'+(o||'');
  function cachePut(){if(L&&L.seededAt)return idb('readwrite',st=>st.put({owner:LFOR,ledger:L},cacheKey(LFOR)));return Promise.resolve(null);}
  async function cacheGet(me){
    const c=await idb('readonly',st=>st.get(cacheKey(me)));if(c)return c;
    const old=await idb('readonly',st=>st.get('current'));return old&&old.owner===me?old:null;
  }
  function block(why){
    BLOCKED=why;ERROR=why;STATUS='error';
    if(typeof showBanner==='function')showBanner('ledgerfile','warn','triangle-alert','Your book’s file in Google Drive can’t be read by this version of the app, so nothing is saved over it. Reload the app; if it stays, restore from a backup.');
    return'blocked';
  }
  // A file that isn't JSON at all is damaged, like a wrong schema: block. Network errors still throw.
  const BAD={};
  async function readJson(id){try{return await driveReadJson(id);}catch(e){if(e instanceof SyntaxError)return BAD;throw e;}}
  // Every ledger.json in the app folder, oldest first (two devices seeding at once can make two).
  async function listFiles(){
    const f=await driveFindFileByName(FILE);if(!f)return[];
    if(f.more&&typeof driveListFilesByName==='function'){const fs=await driveListFilesByName(FILE);if(Array.isArray(fs)&&fs.length)return fs;}
    return[f];
  }
  async function driveSave(){
    if(BLOCKED)return'blocked';
    if(!accessToken||!L||!L.seededAt)return'skip';
    if(!fileId){const f=(await listFiles())[0];if(f){fileId=f.id;revId=null;}}
    if(fileId){const rev=await driveGetRevision(fileId);
      if(rev!==revId){const remote=await readJson(fileId);
        if(remote===BAD||!validLedger(remote))return block('ledger.json in Drive is not a readable book');
        revId=rev;const before=fp(L);L=mergeLedgers(remote,L);if(fp(L)!==before){VER++;cachePut();afterOutsideChange();}}}
    const saved=await driveUploadJson(fileId,FILE,L);fileId=saved.id;revId=saved.headRevisionId;return'pushed';
  }
  function scheduleSave(){
    clearTimeout(SAVE_T);if(!accessToken)return;
    SAVE_T=setTimeout(()=>{SAVE_T=null;ledgerFlush();},1500);
  }
  // Saves to Drive now (and returns when done); for tests and before a backup.
  function ledgerFlush(){
    clearTimeout(SAVE_T);SAVE_T=null;
    const run=(SAVING||Promise.resolve()).then(()=>driveSave()).then(r=>{ERROR=null;return r;},e=>{ERROR=String(e&&e.message||e);return'error';});
    SAVING=run.finally(()=>{if(SAVING===run)SAVING=null;});
    return run;
  }
  async function driveSync(){
    const fs=await listFiles(),f=fs[0];let remote=null;
    if(f){remote=await readJson(f.id);
      if(remote===BAD||!validLedger(remote)){block('ledger.json in Drive is not a readable book');return'blocked';}
      fileId=f.id;revId=f.headRevisionId;
      // More than one file: merge every readable one into the oldest; the others stay as they are.
      let extra=0;for(const g of fs.slice(1)){try{const o=await driveReadJson(g.id);if(validLedger(o)){remote=mergeLedgers(o,remote);extra++;}}catch(_){}}
      // Logged once: the other files never change, so later loads would otherwise log them again.
      if(extra){const im=remote.imports||[],last=im[im.length-1];
        if(!(last&&last.kind==='drive-files'&&last.files===extra))remote.imports=[...im,{at:now(),kind:'drive-files',files:extra,added:0,differs:0,missing:0,linked:0}];revId=null;}}
    if(remote){const had=L;L=had?mergeLedgers(remote,had):norm(remote);LFOR=owner();VER++;cachePut();
      if((had&&fp(L)!==fp(norm(remote)))||revId===null)await driveSave();return'pulled';}
    if(L&&L.seededAt){await driveSave();return'pushed';}
    return'none';
  }
  function afterOutsideChange(){try{runHooks('ledgerChanged','sync');}catch(_){}if(typeof renderAll==='function')renderAll();}
  // Loads the ledger once per sign-in (device cache, then Drive). Safe to call on every render.
  function ensureLedger(){
    if(BUSY)return BUSY;
    const me=owner();
    if(LFOR!==me){resetLedger();LFOR=me;}
    const needLocal=!LOCAL_DONE,needDrive=typeof accessToken!=='undefined'&&!!accessToken&&!DRIVE_TRIED;
    if(!needLocal&&!needDrive)return Promise.resolve(L);
    if(!L)STATUS='loading';
    const wasLive=!!live();
    BUSY=(async()=>{
      try{
        if(needLocal){LOCAL_DONE=true;const c=await cacheGet(me);
          if(c&&c.owner===me&&validLedger(c.ledger)&&c.ledger.seededAt){L=L?mergeLedgers(c.ledger,L):norm(c.ledger);VER++;}}
        if(needDrive){DRIVE_TRIED=true;try{await driveSync();ERROR=null;}catch(e){ERROR=String(e&&e.message||e);}}
      }catch(e){ERROR=String(e&&e.message||e);}
      STATUS=BLOCKED?'error':live()?'ready':ERROR?'error':'none';BUSY=null;
      if(live()&&!wasLive)afterOutsideChange();
      else if(!live())autoSeed();
      return L;
    })();
    return BUSY;
  }
  function resetLedger(){clearTimeout(SAVE_T);SAVE_T=null;L=null;LFOR='';STATUS='idle';ERROR=null;BLOCKED=null;if(typeof hideBanner==='function')hideBanner('ledgerfile');LOCAL_DONE=false;DRIVE_TRIED=false;BUSY=null;fileId=null;revId=null;VER++;GATE=null;AUTO_SIG=null;}

  function changed(o){
    o=o||{};L.updatedAt=now();VER++;cachePut();scheduleSave();
    try{runHooks('ledgerChanged',o.why||'');}catch(_){}
    if(!o.quiet&&typeof renderAll==='function')renderAll();
  }
  function need(){const x=live();if(!x)throw err('Your book is not set up yet');return x;}

  /* ── Imports (called by index.html after it accepted a file) ── */
  function goReview(){hideBanner('ledger');setTab('settings');setTimeout(()=>{const e=document.getElementById('set-book');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});},60);}
  async function ledgerOnImport(kind,data,from,quiet){
    try{
      await ensureLedger();
      const x=live();
      if(!x){autoSeed();return null;}
      let r;
      if(kind==='books')r=mergeBooks(x,data);
      else if(kind==='wealth')r=fillWealth(x,data,now());
      else if(kind==='cash')r=mergeCash(x,data,true);
      else return null;
      x.imports.push({at:now(),kind,generatedAt:iso(data.generatedAt),from:from||'',added:r.txns||r.market||0,new:r.new||0,differs:r.differs||0,missing:r.missing||0,linked:r.linked||0,...(r.remapped?{remapped:r.remapped}:{})});
      changed({why:'import'});
      if(r.new||r.differs||r.missing){
        const bits=[r.new?`${r.new} new from Accurate`:'',r.differs?`${r.differs} differ${r.differs===1?'s':''}`:'',r.missing?`${r.missing} missing`:''].filter(Boolean);
        showBanner('ledger','info','info',bits.join(' · '),'Review',goReview);
      }
      return r;
    }catch(e){console.error('Ledger import failed',e);return null;}
  }
  // Same import, run on a file directly (tests and the real-data check; no copy is stored in STATE).
  function ledgerImport(kind,data){const x=need();const r=kind==='books'?mergeBooks(x,data):kind==='wealth'?fillWealth(x,data,now()):mergeCash(x,data,true);
    x.imports.push({at:now(),kind,generatedAt:iso(data.generatedAt),from:'direct',added:r.txns||r.market||0,new:r.new||0,differs:r.differs||0,missing:r.missing||0,linked:r.linked||0});
    changed({why:'import',quiet:true});return r;}

  /* ── Public API (contract §4) ── */
  function ledgerValidate(v){
    const x=live(),e=[];
    if(!x)return['Your book is not set up yet'];
    if(!v||typeof v!=='object')return['No voucher'];
    if(!validDate(v.date))e.push('Enter a valid date (YYYY-MM-DD)');
    const ls=Array.isArray(v.lines)?v.lines:[];
    if(ls.length<2)e.push('A voucher needs at least two lines');
    let sum=0;
    ls.forEach((l,i)=>{
      const n=i+1;
      if(!l||l.account==null||l.account===''){e.push(`Line ${n}: choose an account`);return;}
      const a=x.accounts[String(l.account)];
      if(!a)e.push(`Line ${n}: account ${l.account} is not in your book`);
      else if(a.isParent)e.push(`Line ${n}: ${l.account} is a parent account; post to one of the accounts under it`);
      if(typeof l.amount!=='number'||!isFinite(l.amount)||l.amount!==Math.round(l.amount))e.push(`Line ${n}: the amount must be whole rupiah`);
      else if(!l.amount)e.push(`Line ${n}: the amount is zero`);
      else sum+=l.amount;
      if(l.fx!=null){const f=l.fx;
        if(!f||!/^[A-Z]{3}$/.test(String(f.ccy||''))||!(Math.abs(+f.amount)>0)||!(+f.rate>0))e.push(`Line ${n}: a foreign amount needs a currency, an amount and a rate`);
        else if(typeof l.amount==='number'&&Math.abs(Math.round(Math.abs(+f.amount)*f.rate)-Math.abs(l.amount))>1)e.push(`Line ${n}: ${f.ccy} ${f.amount} at ${f.rate} is not ${Math.abs(l.amount)}`);}
    });
    if(ls.length>=2&&sum!==0&&!e.some(m=>/whole rupiah/.test(m)))e.push(`Debits and credits differ by ${Math.abs(sum)}`);
    return e;
  }
  function newId(date){
    const x=live(),d=String(date).replace(/-/g,'');let id;
    do{id=`v-${d}-${Math.floor(Math.random()*65536).toString(16).padStart(4,'0')}`;}while(x.vouchers[id]);
    return id;
  }
  function ledgerPost(v,o){
    o=o||{};const x=need(),errs=ledgerValidate(v);if(errs.length)throw err(errs);
    const origin=ORIGINS.includes(o.origin)&&o.origin!=='accurate'?o.origin:'app',t=now(),id=newId(v.date);
    const y={id,origin,date:v.date,number:cut(v.number,40),type:cut(v.type,40),description:cut(v.description,200),status:'posted',
      createdAt:t,updatedAt:t,at:t,lines:normLines(v.lines),history:[]};
    if(o.why)y.why=cut(o.why,200);
    if(v.prompt)y.prompt=cut(v.prompt,2000);
    if(v.ref)y.ref=cut(v.ref,120);
    if(v.batch)y.batch=cut(v.batch,60);
    x.vouchers[id]=y;changed({why:'post'});return id;
  }
  function before(v){return{date:v.date,description:v.description||'',lines:cp(v.lines),status:v.status};}
  function ledgerEdit(id,v,why){
    const x=need(),cur=x.vouchers[id];if(!cur)throw err('No such voucher');if(cur.status!=='posted')throw err('A void voucher can’t be edited');
    const next={date:v&&v.date!=null?v.date:cur.date,lines:v&&v.lines!=null?v.lines:cur.lines};
    const errs=ledgerValidate(next);if(errs.length)throw err(errs);
    const t=now();cur.history=[...(cur.history||[]),{at:t,why:cut(why||'Edited',200),before:before(cur)}];
    cur.date=next.date;cur.lines=normLines(next.lines);
    if(v&&v.description!=null)cur.description=cut(v.description,200);if(v&&v.number!=null)cur.number=cut(v.number,40);
    cur.updatedAt=t;cur.at=t;changed({why:'edit'});return id;
  }
  function ledgerVoid(id,why){
    const x=need(),cur=x.vouchers[id];if(!cur)throw err('No such voucher');if(cur.status==='void')return false;
    const t=now();cur.history=[...(cur.history||[]),{at:t,why:cut(why||'Voided',200),before:before(cur)}];
    cur.status='void';cur.updatedAt=t;cur.at=t;changed({why:'void'});return true;
  }
  // Adds an account to the book (or updates one this app added). Accounts from Accurate change only
  // through the next Accurate export.
  function ledgerAddAccount(acc){
    const x=need(),id=String(acc&&acc.id||'').trim();
    if(!/^[0-9A-Za-z][0-9A-Za-z.\-]*$/.test(id))throw err('Enter an account code (digits and dots)');
    const cur=x.accounts[id];if(cur&&cur.origin==='accurate')throw err(`${id} is already in your book`);
    const kind=acc.kind;if(!KINDS.includes(kind))throw err('Choose a kind: asset, liability, equity, income or expense');
    let parent=acc.parent!=null&&acc.parent!==''?String(acc.parent):null;
    if(parent&&!x.accounts[parent])parent=null;
    const bs=kind==='asset'||kind==='liability';
    const group=bs?(acc.group&&(x.groups.length?x.groups:GROUPS_DEFAULT).some(g=>g.id===acc.group)?acc.group:kind==='asset'?'other_assets':'other_liabilities'):null;
    const side=bs?((x.groups.length?x.groups:GROUPS_DEFAULT).find(g=>g.id===group)||{side:kind}).side:null;
    x.accounts[id]={id,name:cut(acc.name,80)||id,kind,type:cut(acc.type,60),parent,isParent:false,suspended:!!acc.suspended,
      order:acc.order!=null?acc.order:(parent&&x.accounts[parent]&&x.accounts[parent].order!=null?x.accounts[parent].order+0.5:null),
      ccy:String(acc.ccy||'IDR').toUpperCase().slice(0,3)||'IDR',side,group,investment:bs?!!acc.investment:null,active:true,
      origin:cur?cur.origin:'app',at:now(),...(cur&&cur.createdAt?{createdAt:cur.createdAt}:{createdAt:now()})};
    changed({why:'account'});return id;
  }
  function ledgerPending(){
    const x=live();if(!x)return[];
    return Object.entries(x.pending).filter(([,p])=>p&&p.status==='pending'&&p.voucher)
      .map(([id,p])=>({id,date:p.voucher.date,number:p.voucher.number||'',type:p.voucher.type||'',description:p.voucher.description||'',
        lines:cp(p.voucher.lines),debit:debitOf(p.voucher),importedAt:p.importedAt,at:p.at}))
      .sort((p,q)=>cmp(p.date,q.date)||cmp(p.id,q.id));
  }
  function ledgerAcceptPending(ids){
    const x=need(),want=ids==null?null:new Set([].concat(ids));let n=0;const t=now();
    for(const[id,p]of Object.entries(x.pending)){
      if(!p||p.status!=='pending'||!p.voucher||(want&&!want.has(id)))continue;
      if(!x.vouchers[id])x.vouchers[id]={...cp(p.voucher),updatedAt:t,at:t};
      x.pending[id]={status:'accepted',at:t,importedAt:p.importedAt};n++;
    }
    if(n){changed({why:'accept'});if(!ledgerPending().length&&!ledgerFlags().length)hideBanner('ledger');}
    return n;
  }
  function ledgerFlags(){
    const x=live();if(!x)return[];
    return Object.entries(x.flags).filter(([,f])=>f&&(f.kind==='differs'||f.kind==='missing'))
      .map(([id,f])=>{const v=x.vouchers[id];return{id,kind:f.kind,at:f.at,accurate:cp(f.accurate||null),
        voucher:v?{date:v.date,number:v.number||'',description:v.description||'',lines:cp(v.lines),status:v.status,debit:debitOf(v)}:null};})
      .sort((p,q)=>cmp((p.voucher||{}).date||'',(q.voucher||{}).date||'')||cmp(p.id,q.id));
  }
  // Differs: the voucher takes Accurate's date and lines (the old version stays in its history).
  // Missing: Accurate no longer has it, so taking Accurate's version voids it.
  function ledgerTakeAccurate(id){
    const x=need(),f=x.flags[id],v=x.vouchers[id];if(!f||!v||(f.kind!=='differs'&&f.kind!=='missing'))return false;
    const t=now();
    if(f.kind==='differs'){const a=f.accurate||{};
      v.history=[...(v.history||[]),{at:t,why:'Took Accurate’s version',before:before(v)}];
      v.date=a.date||v.date;v.lines=cp(a.lines||v.lines);if(a.description!=null)v.description=a.description;if(a.number!=null)v.number=a.number;
      if(v.status!=='posted')v.status='posted';
    }else if(v.status==='posted'){v.history=[...(v.history||[]),{at:t,why:'Not in Accurate any more',before:before(v)}];v.status='void';}
    v.updatedAt=t;v.at=t;x.flags[id]={kind:'cleared',was:f.kind,at:t};
    changed({why:'take'});if(!ledgerPending().length&&!ledgerFlags().length)hideBanner('ledger');return true;
  }
  function ledgerDismissFlag(id){
    const x=need(),f=x.flags[id];if(!f||(f.kind!=='differs'&&f.kind!=='missing'))return false;
    x.flags[id]={kind:'dismissed',was:f.kind,sig:f.sig||null,at:now()};
    changed({why:'dismiss'});if(!ledgerPending().length&&!ledgerFlags().length)hideBanner('ledger');return true;
  }
  function ledgerExport(){const x=need();return cp(x);}
  // Merges a backup (or another copy) into the book: per entry, the newer change wins; nothing in
  // the book is replaced wholesale and nothing is removed. → counts of entries the backup brought.
  function ledgerMergeIn(obj,from){
    if(!validLedger(obj))throw err('That is not an ExpenseTrack book backup');
    const cur=live(),base=cur||null;
    if(!base&&STATUS!=='none'&&STATUS!=='ready')throw err('Your book is still loading');
    const beforeV=base?Object.keys(base.vouchers).length:0,beforeA=base?Object.keys(base.accounts).length:0;
    L=base?mergeLedgers(obj,base):norm(cp(obj));
    if(!L.seededAt)L.seededAt=now();LFOR=owner();STATUS='ready';
    L.imports.push({at:now(),kind:'backup',generatedAt:iso(obj.updatedAt||obj.seededAt||now()),from:cut(from,40),added:Object.keys(L.vouchers).length-beforeV,new:0,differs:0,missing:0,linked:0});
    changed({why:'merge'});
    return{vouchers:Object.keys(L.vouchers).length-beforeV,accounts:Object.keys(L.accounts).length-beforeA};
  }
  function ledgerCounts(){
    const x=live();if(!x)return null;
    const vs=Object.values(x.vouchers);
    return{vouchers:vs.filter(v=>v.status==='posted').length,void:vs.filter(v=>v.status==='void').length,accounts:Object.keys(x.accounts).length,
      lines:Object.keys(x.cash.txns).length,statements:Object.keys(x.cash.statements).length,pending:ledgerPending().length,flags:ledgerFlags().length,
      lastImport:x.imports.length?x.imports[x.imports.length-1]:null};
  }
  // True when the code is an account Accurate has (so an account added in the app is no longer pending).
  function ledgerInAccurate(code){const x=live();return!!(x&&x.accounts[code]&&x.accounts[code].origin==='accurate');}

  /* ── Settings › Your book ── */
  const money=n=>`<span class="amt">${fmtIDR(n)}</span>`;
  const day=d=>d?fmtDayLong(new Date(d+'T00:00:00')):'—';
  const KIND_WORD={books:'books',wealth:'wealth snapshot',cash:'cash movements',backup:'backup','drive-files':'two book files in Drive merged'};
  function diffLine(d){
    const acc=d.account?` · ${escH(d.account)}`:'',mo=d.month?escH(monthLabel(d.month)):'';
    if(d.what==='months')return`<div class="li-title">Month count</div><div class="li-sub">Your book ${d.app} · the file ${d.file}</div>`;
    if(d.what==='snapshot month')return`<div class="li-title">${mo}</div><div class="li-sub">Month in the snapshot but not in your book</div>`;
    if(d.what==='snapshot account')return`<div class="li-title">${escH(d.account)}</div><div class="li-sub">Account in the snapshot but not in your book</div>`;
    if(d.what==='snapshot side')return`<div class="li-title">${escH(d.account)}</div><div class="li-sub">Grouped ${escH(d.app)} in your book, ${escH(d.file)} in the snapshot</div>`;
    return`<div class="li-title">${mo}${acc}</div><div class="li-sub">${escH(d.what)}: your book ${money(d.app)} · the file ${money(d.file)}</div>`;
  }
  function ledgerSettingsHTML(){
    const x=live(),cnt=ledgerCounts();
    let body='';
    if(!x){
      const{w,b}=seedInputs(),st=STATUS==='loading'||SEEDING;
      if(st)body=`<div class="setting-row"><div><div class="li-title">Checking your book…</div><div class="li-sub">Looking on this device and in your Drive</div></div></div>`;
      else if(!w||!b)body=`<div class="setting-row"><div><div class="li-title">Not set up yet</div><div class="li-sub">Import the ${!w&&!b?'wealth snapshot and the books':!w?'wealth snapshot':'books'} first. The app then keeps its own book and the Accurate files only add to it.</div></div></div>`;
      else{
        const g=GATE&&!GATE.ok&&GATE.count?GATE:null;
        body=`<div class="setting-row"><div><div class="li-title">${g?'Not set up: the files don’t tie':'Not set up yet'}</div><div class="li-sub">${g
            ?`${g.count} difference${g.count===1?'':'s'} between the book built from your files and the files themselves. The app keeps using the imported files until they tie.`
            :STATUS==='error'?'Couldn’t check your Drive for a book. Try again when you’re online.'
            :'Builds your own book from the imported snapshot, books and cash movements, and checks it against them first.'}</div></div>
          <button class="btn btn-secondary" onclick="ledgerUi.seed()">${ic('refresh-cw')}${g?'Check again':'Set up my book'}</button></div>`;
        if(g)body+=`<div class="list">${g.diffs.map(d=>`<div class="list-item"><div class="li-body">${diffLine(d)}</div></div>`).join('')}</div>${g.count>g.diffs.length?`<p class="help">…and ${g.count-g.diffs.length} more.</p>`:''}`;
      }
      return`<section class="card" id="set-book">${cardHead('book-open','Your book','Kept in its own file in your private Drive app folder')}${body}</section>`;
    }
    const li=cnt.lastImport;
    body=`<div class="setting-row"><div><div class="li-title">Set up ${escH(fmtDateTime(x.seededAt))}</div><div class="li-sub">${cnt.vouchers} voucher${cnt.vouchers===1?'':'s'}${cnt.void?` (${cnt.void} void)`:''} · ${cnt.accounts} accounts · ${cnt.lines} statement line${cnt.lines===1?'':'s'}</div></div><span class="badge good">In use</span></div>
      <div class="setting-row"><div><div class="li-title">Last import</div><div class="li-sub">${li?`${escH(KIND_WORD[li.kind]||li.kind)} · ${escH(fmtDateTime(li.at))}${li.new?` · ${li.new} new`:''}${li.differs?` · ${li.differs} differ`:''}${li.missing?` · ${li.missing} missing`:''}`:'None yet'}</div></div></div>`;
    const P=ledgerPending(),F=ledgerFlags();
    if(!P.length&&!F.length)body+=`<p class="help">Nothing to review. New vouchers from Accurate show up here before they go into your book.</p>`;
    if(P.length){
      body+=`<div class="setting-row"><div><div class="li-title">New from Accurate (${P.length})</div><div class="li-sub">Not in your book until you add them</div></div><button class="btn btn-secondary" onclick="ledgerUi.accept()">${ic('plus')}Add all</button></div>
        <div class="list">${P.slice(0,DIFF_SHOWN).map(p=>`<div class="list-item"><div class="li-body"><div class="li-title">${escH(p.description||p.number||'Voucher')}</div><div class="li-sub">${day(p.date)}${p.number?` · ${escH(p.number)}`:''} · ${money(p.debit)}</div></div><button class="btn btn-ghost btn-sm" onclick="ledgerUi.accept('${escAttr(p.id)}')">Add</button></div>`).join('')}</div>
        ${P.length>DIFF_SHOWN?`<p class="help">…and ${P.length-DIFF_SHOWN} more (Add all adds them too).</p>`:''}`;
    }
    if(F.length){
      body+=`<h3 class="label" style="margin:16px 0 8px">Differs from Accurate (${F.length})</h3>
        <div class="list">${F.slice(0,DIFF_SHOWN).map(f=>{const v=f.voucher||{},a=f.accurate;
          const sub=f.kind==='missing'?`Not in Accurate’s latest export · ${day(v.date)} · ${money(v.debit||0)}`
            :`Your book ${day(v.date)} · ${money(v.debit||0)} · Accurate ${day(a&&a.date)} · ${money(a?debitOf(a):0)}`;
          return`<div class="list-item" style="flex-wrap:wrap"><div class="li-body" style="flex:1 1 220px;min-width:0"><div class="li-title">${escH(v.description||v.number||f.id)} <span class="badge warn">${f.kind==='missing'?'Missing in Accurate':'Differs'}</span></div><div class="li-sub">${sub}</div></div>
            <div style="display:flex;gap:4px;margin-left:auto"><button class="btn btn-ghost btn-sm" onclick="ledgerUi.take('${escAttr(f.id)}')" title="${f.kind==='missing'?'Void it in your book (its history keeps it)':'Use Accurate’s date and lines (your version stays in its history)'}">Take Accurate’s version</button>
            <button class="btn btn-ghost btn-sm" onclick="ledgerUi.dismiss('${escAttr(f.id)}')">Dismiss</button></div></div>`;}).join('')}</div>`;
    }
    return`<section class="card" id="set-book">${cardHead('book-open','Your book','The app’s own book, in its own file in your private Drive app folder. Accurate exports only add to it.')}${body}</section>`;
  }
  const ui={
    async seed(){const r=await ledgerSeed({quiet:false});if(r&&r.reason==='missing')toast('Import the wealth snapshot and the books first');renderAll();},
    accept(id){const n=ledgerAcceptPending(id?[id]:undefined);if(n)toast(`${n} voucher${n===1?'':'s'} added to your book`);},
    take(id){if(ledgerTakeAccurate(id))toast('Accurate’s version taken · the earlier one stays in its history');},
    dismiss(id){if(ledgerDismissFlag(id))toast('Dismissed');}
  };

  registerIcon('book-open','<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>');
  // Load the device copy (and Drive's) once someone is signed in, before the first render needs it.
  registerHook('beforeRender',()=>{if(owner()&&STATUS==='idle')ensureLedger();});

  Object.assign(window,{LEDGER:()=>live(),ledgerStatus:()=>BLOCKED?'error':live()?'ready':STATUS,ledgerBlocked:()=>BLOCKED,ledgerFindByRef:findByRef,ensureLedger,ledgerSeeded:()=>!!live(),ledgerView,
    ledgerValidate,ledgerPost,ledgerEdit,ledgerVoid,ledgerAddAccount,ledgerPending,ledgerAcceptPending,ledgerFlags,ledgerTakeAccurate,
    ledgerDismissFlag,ledgerExport,ledgerMergeIn,ledgerSeed,ledgerGate:()=>cp(GATE),ledgerOnImport,ledgerImport,ledgerFlush,ledgerCounts,
    ledgerInAccurate,ledgerCashIdRemap:cashIdRemap,ledgerRemapCashRefs:remapCashRefs,ledgerSettingsHTML,resetLedger,
    ledgerAfterBooksLoad:autoSeed,ledgerUi:ui,
    // Pure helpers for tests and the next builders: the views and merges on any ledger object.
    ledgerLib:{healDuplicatePosts,seedFrom,gateDiffs,mergeLedgers,mergeBooks,mergeCash,fillWealth,coreOf,wViewOf,booksViewOf,cashViewOf,sigOf,contentSig}});
})();
