/* ExpenseTrack v4 — the app's own book (schema et-ledger/2). Contract: docs/v4-books.md
   (docs/v3-ledger.md for the parts that did not change: cash, storage, backups).

   Loaded by index.html after the core script and before the other modules (ledger, books, entry,
   home, statements, extras). No personal data in this file: the repo is public.

   The books rules are copied from the owner's ERP (general ledger):
     - posted journals are the ONLY source of every balance, view and report; drafts touch nothing,
       void journals stay (with their history) and are left out; the market values and the cash
       statements stored in the same file feed Net worth and Statements only, never a balance;
     - a journal is numbered JV/YYYY/00001 when it is posted, per calendar year, never reused;
     - months are open until closed; close goes oldest first, reopen newest first; closing December
       posts the year-end journal into the Retained earnings account, reopening December voids it;
       nothing is posted, edited or voided in a closed or locked month;
     - accounts are postable or headers, the parent has the same type, code and type are fixed,
       archive is refused while there is a balance, active children or it is Retained earnings;
     - every change is in the audit trail (append-only, merged across devices by union).
   Amounts are whole rupiah, debit positive. The file is kept in Drive appData (ledger.json) and
   cached in IndexedDB 'et-ledger'. An et-ledger/1 file is migrated in place once, only if the
   migrated book equals the old one month by month (else it stays read-only). */
(function(){
  'use strict';

  const SCHEMA='et-ledger/2',SCHEMA1='et-ledger/1',FILE='ledger.json',BACKUP_FILE='ledger-v1-backup.json',IDB_NAME='et-ledger',IDB_STORE='ledger';
  const KINDS=['asset','liability','equity','income','expense'];
  const JKINDS=['manual','ai','month-end','income','opening','year-end','accurate'];
  const USER_KINDS=['manual','ai','month-end','income','opening'];
  const ORIGIN_KIND={app:'manual',manual:'manual',ai:'ai','month-end':'month-end',income:'income',accurate:'accurate',opening:'opening','year-end':'year-end'};
  const KIND_ORIGIN={manual:'app',ai:'ai','month-end':'month-end',income:'income',accurate:'accurate',opening:'opening','year-end':'year-end'};
  const KIND_TYPE={manual:'Manual',ai:'AI entry','month-end':'Month-end',income:'Income',opening:'Opening balances','year-end':'Year-end close',accurate:'From Accurate'};
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
  const DIFF_SHOWN=50,BACKDATE_DAYS=7;
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

  /* ── State ── */
  let L=null,LFOR='',STATUS='idle',ERROR=null,LOCAL_DONE=false,DRIVE_TRIED=false,BUSY=null,fileId=null,revId=null;
  let VER=0,VIEWS={ver:-1},GATE=null,SAVE_T=null,SAVING=null,SEEDING=null,STD=null;
  // Drive holds a ledger.json this version can't read (damaged, or a newer schema): never save over it.
  let BLOCKED=null;
  // An et-ledger/1 book that could not be migrated (the gate found differences): read-only.
  let MIG_BLOCK=null;
  // The et-ledger/1 copy to keep in Drive (ledger-v1-backup.json) before the first /2 save.
  let V1RAW=null,MIG_INFO=null;

  /* ── Small helpers ── */
  const cp=o=>o==null?o:JSON.parse(JSON.stringify(o));
  const now=()=>new Date().toISOString();
  const iso=x=>{const t=Date.parse(x);return isNaN(t)?String(x||''):new Date(t).toISOString();};
  const atOf=v=>String((v&&v.at)||'');
  const cut=(s,n)=>String(s==null?'':s).slice(0,n);
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  const cmpCode=(a,b)=>String(a).localeCompare(String(b),'en',{numeric:true});
  const maxS=(...xs)=>xs.filter(Boolean).sort().pop()||null;
  const minS=(...xs)=>xs.filter(Boolean).sort()[0]||null;
  const p2=n=>String(n).padStart(2,'0');
  const owner=()=>(typeof USER_EMAIL==='string'&&USER_EMAIL)||'';
  const todayISO=()=>{const d=new Date();return`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;};
  const thisMonth=()=>todayISO().slice(0,7);
  const mLabel=M=>validMonth(M)?`${MONTHS[+M.slice(5,7)-1]} ${M.slice(0,4)}`:String(M);
  function monthRange(a,b){const out=[];if(!a||!b||a>b)return out;let[y,m]=a.split('-').map(Number);const[ly,lm]=b.split('-').map(Number);
    while(y<ly||(y===ly&&m<=lm)){out.push(`${y}-${p2(m)}`);m++;if(m===13){y++;m=1;}}return out;}
  function shiftMonth(M,k){let[y,m]=M.split('-').map(Number);m+=k;while(m>12){m-=12;y++;}while(m<1){m+=12;y--;}return`${y}-${p2(m)}`;}
  const prevMonth=M=>shiftMonth(M,-1),nextMonth=M=>shiftMonth(M,1);
  const monthStart=M=>M+'-01';
  const monthEnd=M=>{const[y,m]=M.split('-').map(Number);return`${M}-${p2(new Date(Date.UTC(y,m,0)).getUTCDate())}`;};
  function validDate(d){if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;const t=new Date(d+'T00:00:00Z');return!isNaN(t)&&t.toISOString().slice(0,10)===d;}
  const validMonth=M=>typeof M==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(M);
  function err(list){const e=new Error((Array.isArray(list)?list:[list]).join('; '));e.errors=Array.isArray(list)?list:[list];return e;}
  const rid=n=>Math.random().toString(36).slice(2,2+n).padEnd(n,'0');

  function emptyLedger(){
    return{schema:SCHEMA,seededAt:null,updatedAt:null,currency:'IDR',source:{},accounts:{},vouchers:{},
      periods:{},settings:{retainedEarnings:null,firstMonth:null,at:''},audit:[],numbering:{},recodes:[],migration:null,
      market:{},closes:[],groups:[],cash:{accounts:{},statements:{},txns:{},alias:{}},links:{},flags:{},pending:{},imports:[]};
  }
  function validLedger(x){return!!(x&&(x.schema===SCHEMA||x.schema===SCHEMA1)&&x.accounts&&typeof x.accounts==='object'&&x.vouchers&&typeof x.vouchers==='object');}
  function norm(x){
    const e=emptyLedger(),o={...e,...x};
    for(const k of['source','accounts','vouchers','market','links','flags','pending','periods','numbering'])if(!o[k]||typeof o[k]!=='object'||Array.isArray(o[k]))o[k]={};
    for(const k of['closes','groups','imports','audit','recodes'])if(!Array.isArray(o[k]))o[k]=[];
    o.settings={...e.settings,...(o.settings&&typeof o.settings==='object'?o.settings:{})};
    o.cash={...e.cash,...(o.cash||{})};for(const k of['accounts','statements','txns','alias'])if(!o.cash[k]||typeof o.cash[k]!=='object')o.cash[k]={};
    return o;
  }
  const stampOf=x=>(x.recodes||[]).length;   // the chart version: how many re-codes this copy knows

  /* ── Journals, accounts and lines ── */
  const kindOfV=v=>(v&&(v.kind||ORIGIN_KIND[v.origin]))||'manual';
  const isPosted=v=>!!v&&v.status==='posted';
  const isPostable=a=>!!a&&(a.postable!=null?!!a.postable:!a.isParent);
  const userKind=k=>{if(k==null||k==='')return'manual';const m=ORIGIN_KIND[k];return USER_KINDS.includes(m)?m:null;};
  // A line is {account, amount} (debit positive) or {account, debit, credit}.
  function lineAmt(l){
    if(!l)return{amount:NaN,both:false};
    if(l.amount!=null)return{amount:typeof l.amount==='number'?l.amount:+l.amount,both:false};
    const d=l.debit==null||l.debit===''?0:+l.debit,c=l.credit==null||l.credit===''?0:+l.credit;
    return{amount:d-c,both:d>0&&c>0,d,c};
  }
  function normLines(ls){
    return(ls||[]).map(l=>{const o={account:String(l.account==null?'':l.account),amount:Math.round(lineAmt(l).amount||0),memo:cut(l.memo!=null?l.memo:l.description,200)};
      if(l.fx)o.fx={ccy:String(l.fx.ccy||'').toUpperCase(),amount:+l.fx.amount,rate:+l.fx.rate};
      if(l.stmtLine)o.stmtLine=cut(l.stmtLine,120);return o;});
  }
  function vFromBooks(v,at){   // an Accurate voucher as the /1 seed stored it
    const k=String(v.key);
    return{id:'acc|'+k,srcKey:k,origin:'accurate',source:v.source||'',date:String(v.date).slice(0,10),number:v.number||'',type:v.type||'',
      description:v.description||'',status:'posted',createdAt:at,updatedAt:at,at,lines:normLines(v.lines),history:[]};
  }
  function accFromBooks(a,at){
    return{id:String(a.id),name:String(a.name!=null?a.name:a.id),kind:KINDS.includes(a.kind)?a.kind:'asset',type:a.type||'',
      parent:a.parent!=null&&a.parent!==''?String(a.parent):null,isParent:!!a.isParent,suspended:!!a.suspended,
      order:a.order!=null?a.order:null,ccy:a.ccy||'IDR',side:null,group:null,investment:null,active:null,origin:'accurate',at};
  }
  function groupsOf(x){return x.groups&&x.groups.length?x.groups:GROUPS_DEFAULT;}
  function sideOfGroup(x,g,kind){return(groupsOf(x).find(q=>q.id===g)||GROUPS_DEFAULT.find(q=>q.id===g)||{side:kind==='liability'?'liability':'asset'}).side;}
  function accFromStd(s,at,ver){
    const bs=s.type==='asset'||s.type==='liability';
    return{id:s.code,name:s.name,kind:s.type,type:'',parent:s.parent||null,postable:!!s.postable,isParent:!s.postable,suspended:false,archivedAt:null,
      order:null,ccy:'IDR',side:bs&&s.group?(GROUPS_DEFAULT.find(g=>g.id===s.group)||{side:s.type}).side:null,group:bs?(s.group||null):null,
      investment:bs&&s.postable?!!s.investment:null,active:null,origin:'standard',createdAt:at,at,chartVer:ver||0};
  }
  // Same as sigOf in js/books.js: date | debit total | sorted set of accounts with a non-zero line.
  function sigOf(v){let dr=0;const s=new Set();for(const l of v.lines||[]){const a=Math.round(l.amount||0);if(a>0)dr+=a;if(a)s.add(String(l.account));}
    return`${v.date}|${dr}|${[...s].sort().join(',')}`;}
  // What "the same voucher" means when an import is compared with the ledger: date and lines.
  function contentSig(v){return v.date+'#'+(v.lines||[]).map(l=>`${l.account}:${Math.round(l.amount||0)}`).sort().join(',');}
  const debitOf=v=>(v.lines||[]).reduce((s,l)=>s+(l.amount>0?l.amount:0),0);
  function jContent(v){return{date:v.date,description:v.description||'',status:v.status,number:v.number||null,kind:kindOfV(v),lines:cp(v.lines||[])};}

  /* ── Numbering: JV/YYYY/00001 per calendar year, taken when a journal is posted ── */
  const NUM_RE=/^JV\/(\d{4})\/(\d+)$/;
  const fmtNo=(y,n)=>`JV/${y}/${String(n).padStart(5,'0')}`;
  function lastNo(x,y){let m=+((x.numbering||{})[y])||0;for(const v of Object.values(x.vouchers)){const r=v&&v.number&&NUM_RE.exec(v.number);if(r&&r[1]===y&&+r[2]>m)m=+r[2];}return m;}
  function takeNo(x,y){const n=lastNo(x,y)+1;x.numbering[y]=n;return fmtNo(y,n);}

  /* ── Audit trail (append-only) ── */
  function audit(x,entity,ref,action,o){
    o=o||{};const e={id:o.id||`a-${Date.now().toString(36)}-${rid(6)}`,at:o.at||now(),entity,ref:String(ref==null?'':ref),action,
      reason:cut(o.reason||'',300),before:o.before==null?null:cp(o.before),after:o.after==null?null:cp(o.after)};
    if(o.id&&x.audit.some(a=>a&&a.id===o.id))return null;
    x.audit.push(e);return e;
  }

  /* ── Views (adapters). Computed from posted journals only, cached per change for the live one ── */
  function coreOf(x){
    const act={},ye={},touched=new Set();let first=null,last=null,glAsOf=null;
    for(const v of Object.values(x.vouchers)){
      if(!isPosted(v))continue;
      const m=v.date.slice(0,7);if(!first||m<first)first=m;if(!last||m>last)last=m;if(!glAsOf||v.date>glAsOf)glAsOf=v.date;
      const box=kindOfV(v)==='year-end'?ye:act,a=box[m]||(box[m]={});
      for(const l of v.lines||[]){if(!l.amount)continue;a[l.account]=(a[l.account]||0)+l.amount;touched.add(l.account);}
    }
    const s=x.source||{};
    for(const t of[s.balancesAsOf,s.wealthAsOf])if(t&&(!last||t>last))last=t;
    if(!first)first=last;
    const months=monthRange(first,last),balances={},activity={},yearEnd={},run={};
    for(const m of months){
      const a=act[m]||{},y=ye[m]||{};
      for(const[k,v]of Object.entries(a))run[k]=(run[k]||0)+v;
      for(const[k,v]of Object.entries(y))run[k]=(run[k]||0)+v;
      activity[m]=sortedNonZero(a);balances[m]=sortedNonZero(run);
      if(ye[m]){const z=sortedNonZero(y);if(Object.keys(z).length)yearEnd[m]=z;}
    }
    const wFrom=s.wealthFrom&&s.wealthFrom>first?s.wealthFrom:first;
    return{months,balances,activity,yearEnd,touched,glAsOf,wMonths:months.filter(m=>m>=wFrom)};
  }
  function sortedNonZero(o){const r={};for(const k of Object.keys(o).sort())if(o[k])r[k]=o[k];return r;}

  // Side and group of a balance-sheet account: what the snapshot said (kept per account), else a
  // default from the account's type; then the snapshot builder's rule for a balance on the "wrong"
  // side (a payable with a debit balance is shown as a receivable, an asset with a credit balance
  // under Other liabilities).
  function placeOf(a,latest){
    let group=a.group,side=a.side;
    if(!group||!side){
      group=group||(/credit card/i.test(a.name||'')?'cards':TYPE_GROUP[a.type]||(a.kind==='liability'?'other_liabilities':'other_assets'));
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
      if(!a||!isPostable(a)||(a.kind!=='asset'&&a.kind!=='liability'))continue;
      const app=a.origin==='app',lines=c.touched.has(a.id);
      // Lines, or classified by the wealth snapshot, or added by the owner (a template account
      // without lines stays out of Net worth).
      if(!lines&&!(a.origin==='accurate'&&a.side&&a.group)&&!(app&&!a.suspended&&!a.archivedAt))continue;
      const p=placeOf(a,lastBal[a.id]||0);
      const o={id:a.id,name:a.name,group:p.group,side:p.side,ccy:a.ccy||'IDR',
        investment:p.flipped?false:(a.investment!=null?!!a.investment:INVESTMENT_GROUPS.has(p.group)),
        active:app&&!lines?true:recent.some(m=>(c.balances[m]||{})[a.id]),type:a.type||''};
      if(app)o.pending=true;
      if(a.archivedAt)o.archived=true;
      accounts.push(o);
    }
    accounts.sort((p,q)=>cmp(p.id,q.id));
    const sideOf=new Map(accounts.map(a=>[a.id,a.side]));
    const months=wm.map(m=>{const b={};for(const[k,v]of Object.entries(c.balances[m]||{})){const sd=sideOf.get(k);if(sd&&v)b[k]=sd==='asset'?v:-v;}return{month:m,balances:b};});
    const market={};
    for(const[m,o]of Object.entries(x.market||{}).sort((p,q)=>cmp(p[0],q[0]))){const r={};for(const[k,e]of Object.entries(o||{}))if(e&&e.v!=null&&!e.deleted)r[k]=e.v;if(Object.keys(r).length)market[m]=r;}
    const kind=k=>(x.accounts[k]||{}).kind;
    const pnl=[];   // year-end journals are left out (c.activity excludes them)
    for(const m of c.months){let inc=0,exp=0,any=false;
      for(const[k,v]of Object.entries(c.activity[m]||{})){const kd=kind(k);if(kd!=='income'&&kd!=='expense')continue;any=true;if(v<0)inc-=v;else exp+=v;}
      if(any)pnl.push({month:m,income:inc,expense:exp});}
    const ledger=[];
    for(const a of Object.values(x.accounts)){
      if(!a||!isPostable(a)||!['equity','income','expense'].includes(a.kind))continue;
      const app=a.origin==='app';
      if(!a.plKind&&!c.touched.has(a.id)&&!(app&&!a.suspended&&!a.archivedAt))continue;
      const o={id:a.id,name:a.name,kind:a.plKind||a.kind,type:a.type||''};if(app)o.pending=true;ledger.push(o);
    }
    ledger.sort((p,q)=>cmp(p.id,q.id));
    const closes=(x.closes||[]).map(cl=>{const o=cp(cl);delete o.at;return o;}).sort((p,q)=>cmp(p.month,q.month));
    return{schema:'et-wealth/1',fromLedger:true,generatedAt:s.wealthGeneratedAt||x.seededAt,currency:x.currency||'IDR',
      source:{book:s.book||'',asOf:wm.length?wm[wm.length-1]:(s.wealthAsOf||''),exportedOn:s.exportedOn||''},
      groups:cp(groupsOf(x)),accounts,months,market,pnl,ledger,closes,checks:[]};
  }
  function booksVoucher(v,v1){
    const kind=kindOfV(v),acc=kind==='accurate';
    return{key:acc?(v.srcKey||v.id):v.id,id:v.id,kind,origin:KIND_ORIGIN[kind]||'app',status:v.status,date:v.date,
      number:v1?(v.number||''):(v.number||''),refNo:v1?'':(v.refNo||''),source:acc?(v.source||''):'App',
      type:acc?(v.type||''):(v.type||KIND_TYPE[kind]||'Manual'),description:v.description||'',postedAt:v.postedAt||null,
      lines:(v.lines||[]).map(l=>{const o={account:l.account,amount:l.amount,description:l.memo||''};if(l.fx)o.fx={...l.fx};return o;})};
  }
  function booksViewOf(x,c){
    const s=x.source||{},v1=x.schema===SCHEMA1;
    const accounts=Object.values(x.accounts).filter(Boolean).map(a=>({id:a.id,code:a.id,name:a.name,type:a.type||'',kind:a.kind,parent:a.parent||null,
      isParent:!isPostable(a),postable:isPostable(a),archived:!!a.archivedAt,suspended:!!a.suspended,order:a.order!=null?a.order:1e9,ccy:a.ccy||'IDR',
      ...(a.oldCode?{oldCode:a.oldCode}:{}),...(a.origin==='app'?{pending:true}:{})}))
      .sort((p,q)=>p.order-q.order||cmpCode(p.id,q.id));
    const vouchers=Object.values(x.vouchers).filter(isPosted).map(v=>booksVoucher(v,v1)).sort((p,q)=>cmp(p.date,q.date)||cmp(p.number,q.number)||cmp(p.key,q.key));
    return{schema:'et-books/1',fromLedger:true,generatedAt:s.booksGeneratedAt||x.seededAt,currency:x.currency||'IDR',
      source:{book:s.book||'',exportedOn:s.exportedOn||'',glAsOf:c.glAsOf,balancesAsOf:s.balancesAsOf||c.months[c.months.length-1]||null},
      accounts,vouchers,months:c.months,balances:c.balances,activity:c.activity,yearEnd:c.yearEnd,checks:[],tie:{monthsChecked:0,maxDiff:0}};
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
  // Every journal but deleted drafts (drafts, posted and void), for the Journals list.
  function journalsViewOf(x){
    const v1=x.schema===SCHEMA1;
    return Object.values(x.vouchers).filter(v=>v&&v.status!=='deleted').map(v=>{
      const kind=kindOfV(v),o={id:v.id,key:kind==='accurate'?(v.srcKey||v.id):v.id,number:v1?null:(v.number||null),refNo:v1?(v.number||''):(v.refNo||''),
        kind,status:v.status,date:v.date,description:v.description||'',debit:debitOf(v),
        lines:(v.lines||[]).map(l=>{const q={account:l.account,amount:l.amount,memo:l.memo||''};if(l.fx)q.fx={...l.fx};if(l.stmtLine)q.stmtLine=l.stmtLine;return q;}),
        createdAt:v.createdAt||null,postedAt:v.postedAt||null,updatedAt:v.updatedAt||null,changes:(v.history||[]).length};
      for(const k of['srcKey','source','type','twin','batch','ref','why'])if(v[k])o[k]=v[k];
      if(v.status==='draft')o.errors=v1?[]:validateIn(x,v,{});
      return o;}).sort((p,q)=>cmp(p.date,q.date)||cmp(p.number||'~',q.number||'~')||cmp(p.id,q.id));
  }
  function live(){return L&&L.seededAt&&LFOR===owner()?L:null;}
  function views(){if(VIEWS.ver!==VER)VIEWS={ver:VER};return VIEWS;}
  // The adapters index.html's W(), BOOKS() and CM() return once the book exists (else null).
  function ledgerView(kind){
    const x=live();if(!x)return null;const V=views();
    if(!V.core)V.core=coreOf(x);
    if(kind==='wealth')return V.w||(V.w=wViewOf(x,V.core));
    if(kind==='books')return V.b||(V.b=booksViewOf(x,V.core));
    if(kind==='cash'){if(!('c'in V))V.c=cashViewOf(x);return V.c;}
    if(kind==='journals')return V.j||(V.j=journalsViewOf(x));
    return null;
  }

  /* ── Reports from posted journal lines, by date (ERP trial balance, ledger, P&L, balance sheet) ── */
  function buildLines(x){
    const out=[];
    for(const v of Object.values(x.vouchers)){if(!isPosted(v))continue;const kind=kindOfV(v);
      (v.lines||[]).forEach((l,i)=>{if(l&&l.amount)out.push({date:v.date,id:v.id,number:v.number||'',kind,description:v.description||'',account:String(l.account),amount:l.amount,memo:l.memo||'',li:i});});}
    out.sort((a,b)=>cmp(a.date,b.date)||cmp(a.number,b.number)||cmp(a.id,b.id)||a.li-b.li);
    return out;
  }
  function postedLines(x){if(x===L){const V=views();return V.lines||(V.lines=buildLines(x));}return buildLines(x);}
  const lx=x=>{const y=x||live();if(!y)throw err('Your book is not set up yet');return y;};
  function range(from,to){
    if(from&&!validDate(from))throw err('Enter a valid start date (YYYY-MM-DD)');
    if(to&&!validDate(to))throw err('Enter a valid end date (YYYY-MM-DD)');
    if(from&&to&&from>to)throw err('The start date is after the end date');
    return[from||'0000-01-01',to||'9999-12-31'];
  }
  const accOf=(x,code)=>x.accounts[code]||null;
  function rowBase(x,code){const a=accOf(x,code);return a?{code,name:a.name,kind:a.kind,postable:isPostable(a),archived:!!a.archivedAt}:{code,name:code,kind:null,postable:true,archived:false,unknown:true};}
  // Trial balance [from, to]: every postable, non-archived account (even at zero) plus any other
  // account with posted lines up to `to`. opening = lines before from; closing = opening + dr − cr.
  function tbOf(x,from,to){
    x=lx(x);const[F,T]=range(from,to),m=new Map();
    for(const l of postedLines(x)){if(l.date>T)break;let r=m.get(l.account);if(!r)m.set(l.account,r={opening:0,debit:0,credit:0});
      if(l.date<F)r.opening+=l.amount;else if(l.amount>0)r.debit+=l.amount;else r.credit-=l.amount;}
    const codes=new Set(m.keys());for(const a of Object.values(x.accounts))if(a&&isPostable(a)&&!a.archivedAt)codes.add(a.id);
    const rows=[...codes].sort(cmpCode).map(c=>{const r=m.get(c)||{opening:0,debit:0,credit:0};return{...rowBase(x,c),opening:r.opening,debit:r.debit,credit:r.credit,closing:r.opening+r.debit-r.credit};});
    const totals=rows.reduce((t,r)=>({opening:t.opening+r.opening,debit:t.debit+r.debit,credit:t.credit+r.credit,closing:t.closing+r.closing}),{opening:0,debit:0,credit:0,closing:0});
    return{from:from||null,to:to||null,rows,totals,balanced:totals.debit===totals.credit,openingBalanced:totals.opening===0};
  }
  // General ledger [from, to]: per account an opening row, the lines (date, number, journal
  // description, debit, credit, running) and the closing. All accounts: those with no opening and
  // no lines are left out; one account: always returned. Year-end journals are included.
  function glOf(x,code,from,to){
    x=lx(x);const[F,T]=range(from,to),by=new Map();
    const want=code!=null&&code!==''?String(code):null;
    for(const l of postedLines(x)){if(l.date>T)break;if(want&&l.account!==want)continue;
      let r=by.get(l.account);if(!r)by.set(l.account,r={opening:0,rows:[]});
      if(l.date<F)r.opening+=l.amount;else r.rows.push(l);}
    const codes=want?[want]:[...by.keys()].sort(cmpCode);
    const accounts=[];
    for(const c of codes){const r=by.get(c)||{opening:0,rows:[]};if(!want&&!r.opening&&!r.rows.length)continue;
      let run=r.opening,dr=0,cr=0;
      const rows=r.rows.map(l=>{const d=l.amount>0?l.amount:0,k=l.amount<0?-l.amount:0;run+=l.amount;dr+=d;cr+=k;
        return{date:l.date,id:l.id,number:l.number,kind:l.kind,description:l.description,memo:l.memo,debit:d,credit:k,running:run};});
      accounts.push({...rowBase(x,c),opening:r.opening,rows,debit:dr,credit:cr,closing:r.opening+dr-cr});}
    return{from:from||null,to:to||null,accounts};
  }
  // Profit and loss [from, to], year-end journals left out. income = −(dr − cr), expense = dr − cr.
  function plOf(x,from,to){
    x=lx(x);const[F,T]=range(from,to),s=new Map();
    for(const l of postedLines(x)){if(l.date>T)break;if(l.date<F||l.kind==='year-end')continue;const a=accOf(x,l.account);
      if(!a||(a.kind!=='income'&&a.kind!=='expense'))continue;s.set(l.account,(s.get(l.account)||0)+l.amount);}
    const income=[],expense=[];
    for(const c of[...s.keys()].sort(cmpCode)){const v=s.get(c);if(!v)continue;const a=accOf(x,c);
      (a.kind==='income'?income:expense).push({code:c,name:a.name,amount:a.kind==='income'?-v:v});}
    const totalIncome=income.reduce((t,r)=>t+r.amount,0),totalExpense=expense.reduce((t,r)=>t+r.amount,0);
    return{from:from||null,to:to||null,income,expense,totalIncome,totalExpense,net:totalIncome-totalExpense};
  }
  // Balance sheet as of a date. Assets +(dr − cr); liabilities and equity −(dr − cr), cumulative,
  // closing journals included. Two equity lines: unclosed prior-year earnings (income/expense before
  // 1 January of as-of's year, 0 once those years are closed) and current-year earnings.
  function bsOf(x,asOf){
    x=lx(x);asOf=asOf||todayISO();if(!validDate(asOf))throw err('Enter a valid date (YYYY-MM-DD)');
    const fy=asOf.slice(0,4)+'-01-01',bal=new Map();let prior=0,cur=0;
    for(const l of postedLines(x)){if(l.date>asOf)break;const a=accOf(x,l.account),k=a?a.kind:null;
      if(k==='income'||k==='expense'){if(l.date<fy)prior+=l.amount;else cur+=l.amount;}
      else bal.set(l.account,(bal.get(l.account)||0)+l.amount);}
    const assets=[],liabilities=[],equity=[];
    for(const c of[...bal.keys()].sort(cmpCode)){const v=bal.get(c);if(!v)continue;const b=rowBase(x,c),k=b.kind||'asset';
      const row={code:c,name:b.name,amount:k==='asset'?v:-v};if(b.unknown)row.unknown=true;
      (k==='asset'?assets:k==='liability'?liabilities:equity).push(row);}
    const sum=r=>r.reduce((t,q)=>t+q.amount,0);
    const unclosedPriorEarnings=prior?-prior:0,currentYearEarnings=cur?-cur:0;
    const totalAssets=sum(assets),totalLiabilities=sum(liabilities),totalEquity=sum(equity)+unclosedPriorEarnings+currentYearEarnings;
    return{asOf,fyStart:fy,assets,liabilities,equity,unclosedPriorEarnings,currentYearEarnings,totalAssets,totalLiabilities,totalEquity,
      totalLE:totalLiabilities+totalEquity,balanced:totalAssets===totalLiabilities+totalEquity};
  }

  /* ── Periods: calendar months, open unless stored otherwise ── */
  function firstMonthOf(x){
    let f=(x.settings||{}).firstMonth||null;
    for(const v of Object.values(x.vouchers))if(isPosted(v)&&validDate(v.date)){const m=v.date.slice(0,7);if(!f||m<f)f=m;}
    return f||thisMonth();
  }
  // open | closed | locked. A month before the book's first month takes the first month's state
  // once that one is closed (a closed book has nothing open before it).
  function periodState(x,M){
    const p=(x.periods||{})[M];if(p&&p.state)return p.state;
    const f=firstMonthOf(x);if(M<f){const s=((x.periods||{})[f]||{}).state;if(s==='closed'||s==='locked')return s;}
    return'open';
  }
  const prevExists=(x,M)=>prevMonth(M)>=firstMonthOf(x);
  function yearEndPlan(x,Y){
    Y=String(Y);const from=`${Y}-01-01`,to=`${Y}-12-31`,n=new Map();
    for(const v of Object.values(x.vouchers)){if(!isPosted(v)||v.date<from||v.date>to)continue;
      for(const l of v.lines||[]){const a=accOf(x,l.account);if(!a||(a.kind!=='income'&&a.kind!=='expense')||!l.amount)continue;n.set(l.account,(n.get(l.account)||0)+l.amount);}}
    const lines=[];let S=0;
    for(const c of[...n.keys()].sort(cmpCode)){const v=n.get(c);if(!v)continue;lines.push({account:c,amount:-v,memo:'Year-end close'});S+=v;}
    const re=(x.settings||{}).retainedEarnings||null;
    if(lines.length&&S)lines.push({account:re,amount:S,memo:'Profit (loss) for the year'});
    return{year:Y,empty:!lines.length,accounts:lines.length-(S?1:0),net:S?-S:0,retainedEarnings:re,lines};
  }
  function reProblem(x){
    const c=(x.settings||{}).retainedEarnings,a=c&&accOf(x,c);
    if(!c)return'Pick the Retained earnings account first (Books › Periods)';
    if(!a)return`The Retained earnings account ${c} is not in your book`;
    if(a.kind!=='equity'||!isPostable(a)||a.archivedAt)return`${c} can’t take the year-end close (it must be a postable, non-archived equity account)`;
    return null;
  }
  function draftsIn(x,M){return Object.values(x.vouchers).filter(v=>v&&v.status==='draft'&&String(v.date).slice(0,7)===M).map(v=>v.id).sort();}
  function checklistIn(x,M,reason){
    if(!validMonth(M))throw err('Pick a month (YYYY-MM)');
    const rs=String(reason||'').trim(),state=periodState(x,M),items=[];
    const hp=prevExists(x,M),pv=prevMonth(M),ps=hp?periodState(x,pv):null;
    items.push({code:'previous',ok:!hp||ps!=='open',blocking:true,detail:!hp?'The first month of your book':ps!=='open'?`${mLabel(pv)} is ${ps}`:`Close ${mLabel(pv)} first`});
    const ds=draftsIn(x,M);
    items.push({code:'drafts',ok:!ds.length,blocking:!rs,count:ds.length,ids:ds,
      detail:ds.length?`${ds.length} draft journal${ds.length===1?'':'s'} dated in ${mLabel(M)}${rs?' (acknowledged with your reason)':'; give a reason to close anyway'}`:'No drafts'});
    const t=tbOf(x,monthStart(M),monthEnd(M));
    items.push({code:'tb',ok:t.balanced&&t.openingBalanced,blocking:true,
      detail:t.balanced&&t.openingBalanced?'Debits equal credits and the opening balances balance':`Debits ${t.totals.debit} · credits ${t.totals.credit} · opening ${t.totals.opening}`});
    let yearEnd=null;
    if(M.endsWith('-12')){const p=yearEndPlan(x,M.slice(0,4)),pr=p.empty?null:reProblem(x);
      yearEnd={year:p.year,empty:p.empty,accounts:p.accounts,net:p.net,retainedEarnings:p.retainedEarnings};
      items.push({code:'retained',ok:!pr,blocking:true,detail:p.empty?'Nothing to close into Retained earnings':pr||`The year-end journal moves ${p.accounts} income and expense account${p.accounts===1?'':'s'} into ${p.retainedEarnings}`});}
    return{month:M,state,items,yearEnd,canClose:state==='open'&&M>=firstMonthOf(x)&&items.every(i=>i.ok||!i.blocking)};
  }
  function periodsOf(x,year){
    const Y=String(year||todayISO().slice(0,4)),f=firstMonthOf(x),out=[];
    for(let i=1;i<=12;i++){const M=`${Y}-${p2(i)}`,p=(x.periods||{})[M]||{},st=periodState(x,M),hp=prevExists(x,M);
      const ps=hp?periodState(x,prevMonth(M)):null,ns=periodState(x,nextMonth(M)),inBook=M>=f;
      out.push({month:M,label:mLabel(M),state:st,stored:!!p.state,closedAt:p.closedAt||null,reason:p.reason||'',yearEndId:p.yearEndId||null,inBook,
        canClose:inBook&&st==='open'&&(!hp||ps!=='open'),canReopen:inBook&&st==='closed'&&ns==='open',
        canLock:inBook&&st==='closed'&&(!hp||ps==='locked'),canUnlock:inBook&&st==='locked'&&ns!=='locked'});}
    return out;
  }
  function needMonth(x,M){if(!validMonth(M))throw err('Pick a month (YYYY-MM)');const f=firstMonthOf(x);if(M<f)throw err(`Your book starts in ${mLabel(f)}`);}
  function setPeriod(x,M,state,action,reason,extra){
    const t=now(),before=(x.periods||{})[M]?cp(x.periods[M]):{state:periodState(x,M)};
    x.periods[M]={...(x.periods[M]||{}),state,at:t,reason:cut(reason||'',300),...(extra||{})};
    audit(x,'period',M,action,{reason,before,after:{transition:`${before.state||'open'}->${state}`,...cp(x.periods[M])}});
  }
  function opClose(x,M,reason){
    needMonth(x,M);const st=periodState(x,M);if(st!=='open')throw err(`${mLabel(M)} is already ${st}`);
    const ck=checklistIn(x,M,reason);if(!ck.canClose)throw err(ck.items.filter(i=>!i.ok&&i.blocking).map(i=>i.detail));
    let yearEndId=null;
    if(M.endsWith('-12')){const Y=M.slice(0,4),p=yearEndPlan(x,Y);
      if(!p.empty)yearEndId=postIn(x,{date:`${Y}-12-31`,description:`Year-end close ${Y}`,lines:p.lines},'year-end',{why:`Closed ${mLabel(M)}`,allowArchived:true});}
    setPeriod(x,M,'closed','close',reason,{closedAt:now(),yearEndId});
    return{month:M,state:'closed',yearEndId};
  }
  function opReopen(x,M,reason){
    needMonth(x,M);const rs=String(reason||'').trim();if(!rs)throw err('Give a reason to reopen a month');
    const st=periodState(x,M);if(st==='locked')throw err(`${mLabel(M)} is locked; unlock it first`);if(st!=='closed')throw err(`${mLabel(M)} is already open`);
    const nx=nextMonth(M);if(periodState(x,nx)!=='open')throw err(`Reopen ${mLabel(nx)} first`);
    setPeriod(x,M,'open','reopen',rs,{reopenedAt:now(),yearEndId:null});
    const voided=[];
    if(M.endsWith('-12')){const d=`${M.slice(0,4)}-12-31`;
      for(const v of Object.values(x.vouchers))if(isPosted(v)&&kindOfV(v)==='year-end'&&v.date===d){voidIn(x,v.id,`Reopened ${mLabel(M)}: ${rs}`,{system:true});voided.push(v.id);}}
    return{month:M,state:'open',voided};
  }
  function opLock(x,M){
    needMonth(x,M);const st=periodState(x,M);if(st==='open')throw err(`Close ${mLabel(M)} before locking it`);if(st==='locked')throw err(`${mLabel(M)} is already locked`);
    if(prevExists(x,M)&&periodState(x,prevMonth(M))!=='locked')throw err(`Lock ${mLabel(prevMonth(M))} first`);
    setPeriod(x,M,'locked','lock','',{lockedAt:now()});return{month:M,state:'locked'};
  }
  function opUnlock(x,M,reason){
    needMonth(x,M);const rs=String(reason||'').trim();if(!rs)throw err('Give a reason to unlock a month');
    if(periodState(x,M)!=='locked')throw err(`${mLabel(M)} is not locked`);
    if(periodState(x,nextMonth(M))==='locked')throw err(`Unlock ${mLabel(nextMonth(M))} first`);
    setPeriod(x,M,'closed','unlock',rs,{});return{month:M,state:'closed'};
  }

  /* ── Checking a journal before it posts (whole, before anything is written) ── */
  function validateIn(x,v,o){
    o=o||{};const e=[];
    if(!v||typeof v!=='object')return['No journal'];
    if(!validDate(v.date))e.push('Enter a valid date (YYYY-MM-DD)');
    const ls=Array.isArray(v.lines)?v.lines:[];
    if(ls.length<2)e.push('A journal needs at least two lines');
    let sum=0,dr=0,zero=false;
    ls.forEach((l,i)=>{
      const n=i+1;
      if(!l||l.account==null||l.account===''){e.push(`Line ${n}: choose an account`);return;}
      const a=accOf(x,String(l.account));
      if(!a)e.push(`Line ${n}: account ${l.account} is not in your book`);
      else if(!isPostable(a))e.push(`Line ${n}: ${l.account} is a parent account (a header); post to one of the accounts under it`);
      else if(a.archivedAt&&!o.allowArchived)e.push(`Line ${n}: ${l.account} is archived`);
      const q=lineAmt(l);
      if(q.both)e.push(`Line ${n}: enter either a debit or a credit, not both`);
      else if(typeof q.amount!=='number'||!isFinite(q.amount)||q.amount!==Math.round(q.amount))e.push(`Line ${n}: the amount must be whole rupiah`);
      else if(!q.amount){e.push(`Line ${n}: the amount is zero`);zero=true;}
      else{sum+=q.amount;if(q.amount>0)dr+=q.amount;}
      if(l.fx!=null){const f=l.fx;
        if(!f||!/^[A-Z]{3}$/.test(String(f.ccy||''))||!(Math.abs(+f.amount)>0)||!(+f.rate>0))e.push(`Line ${n}: a foreign amount needs a currency, an amount and a rate`);
        else if(isFinite(q.amount)&&Math.abs(Math.round(Math.abs(+f.amount)*f.rate)-Math.abs(q.amount))>1)e.push(`Line ${n}: ${f.ccy} ${f.amount} at ${f.rate} is not ${Math.abs(q.amount)}`);}
    });
    if(ls.length>=2&&sum!==0&&!e.some(m=>/whole rupiah|not both/.test(m)))e.push(`Debits and credits differ by ${Math.abs(sum)}`);
    if(ls.length>=2&&!dr&&!zero&&!e.some(m=>/whole rupiah|not both/.test(m)))e.push('The journal total is zero');
    if(o.period!==false&&validDate(v.date)){const M=v.date.slice(0,7),st=periodState(x,M);
      if(st!=='open')e.push(`${mLabel(M)} is ${st}; reopen it in Books › Periods to post into it`);}
    return e;
  }
  function draftErrors(v){
    const e=[];if(!v||typeof v!=='object')return['No journal'];
    if(!validDate(v.date))e.push('Enter a valid date (YYYY-MM-DD)');
    const ls=Array.isArray(v.lines)?v.lines:[];if(ls.length<2)e.push('A draft needs at least two lines');
    ls.forEach((l,i)=>{const q=lineAmt(l);if(!l||l.account==null||String(l.account).trim()==='')e.push(`Line ${i+1}: choose an account`);
      if(q.both)e.push(`Line ${i+1}: enter either a debit or a credit, not both`);
      else if(!isFinite(q.amount)||q.amount!==Math.round(q.amount))e.push(`Line ${i+1}: the amount must be whole rupiah`);});
    return e;
  }
  function warningsOf(v){
    const w=[];if(v&&validDate(v.date)){const d=Date.parse(v.date+'T00:00:00Z'),t=Date.parse(todayISO()+'T00:00:00Z');if((t-d)/864e5>BACKDATE_DAYS)w.push('backdated');}
    return w;
  }

  /* ── Journal operations on any ledger object (the live API wraps them) ── */
  function newIdIn(x,date){const d=String(date).replace(/-/g,'');let id;do{id=`v-${d}-${Math.floor(Math.random()*65536).toString(16).padStart(4,'0')}`;}while(x.vouchers[id]);return id;}
  function extras(y,v,o){if(o&&o.why)y.why=cut(o.why,200);if(v.prompt)y.prompt=cut(v.prompt,2000);if(v.ref)y.ref=cut(v.ref,120);if(v.batch)y.batch=cut(v.batch,60);}
  function postIn(x,v,kind,o){
    o=o||{};const errs=validateIn(x,v,{allowArchived:!!o.allowArchived});if(errs.length)throw err(errs);
    const t=now(),id=newIdIn(x,v.date);
    const y={id,kind,status:'posted',number:null,refNo:cut(v.refNo!=null?v.refNo:v.number,40),type:cut(v.type,40),date:v.date,description:cut(v.description,500),
      lines:normLines(v.lines),createdAt:t,updatedAt:t,postedAt:t,at:t,history:[],chartVer:stampOf(x)};
    extras(y,v,o);y.number=takeNo(x,v.date.slice(0,4));x.vouchers[id]=y;
    audit(x,'journal',id,'post',{reason:o.why,after:jContent(y)});return id;
  }
  function opPost(x,v,o){o=o||{};const kind=userKind(o.kind||o.origin);if(!kind)throw err('That kind of journal is made by the app itself');return postIn(x,v,kind,o);}
  function opSaveDraft(x,v,o){
    o=o||{};const e=draftErrors(v);if(e.length)throw err(e);const t=now();
    if(o.id){const cur=x.vouchers[o.id];if(!cur||cur.status==='deleted')throw err('No such journal');
      if(cur.status!=='draft')throw err(`This journal is ${cur.status}; only a draft is saved as a draft`);
      const b=jContent(cur);cur.date=v.date;if(v.description!=null)cur.description=cut(v.description,500);cur.lines=normLines(v.lines);
      if(v.refNo!=null)cur.refNo=cut(v.refNo,40);extras(cur,v,o);cur.updatedAt=t;cur.at=t;cur.chartVer=stampOf(x);
      audit(x,'journal',o.id,'save',{reason:o.why,before:b,after:jContent(cur)});return o.id;}
    const kind=userKind(o.kind||o.origin);if(!kind)throw err('That kind of journal is made by the app itself');
    const id=newIdIn(x,v.date),y={id,kind,status:'draft',number:null,refNo:cut(v.refNo!=null?v.refNo:v.number,40),type:cut(v.type,40),date:v.date,
      description:cut(v.description,500),lines:normLines(v.lines),createdAt:t,updatedAt:t,postedAt:null,at:t,history:[],chartVer:stampOf(x)};
    extras(y,v,o);x.vouchers[id]=y;audit(x,'journal',id,'save',{reason:o.why,after:jContent(y)});return id;
  }
  function opPostDraft(x,id,o){
    o=o||{};const cur=x.vouchers[id];if(!cur||cur.status==='deleted')throw err('No such journal');
    if(cur.status!=='draft')throw err(`This journal is already ${cur.status}`);
    const errs=validateIn(x,cur,{});if(errs.length)throw err(errs);
    const t=now(),b=jContent(cur);cur.status='posted';cur.number=takeNo(x,cur.date.slice(0,4));cur.postedAt=t;cur.updatedAt=t;cur.at=t;
    audit(x,'journal',id,'post',{reason:o.why,before:b,after:jContent(cur)});return id;
  }
  function opDeleteDraft(x,id,why){
    const cur=x.vouchers[id];if(!cur||cur.status==='deleted')throw err('No such journal');
    if(cur.status!=='draft')throw err('Only a draft can be deleted; void a posted journal instead');
    const t=now(),b=jContent(cur);cur.status='deleted';cur.deletedAt=t;cur.updatedAt=t;cur.at=t;
    audit(x,'journal',id,'delete-draft',{reason:why,before:b});return true;
  }
  function opCopy(x,id){
    const cur=x.vouchers[id];if(!cur||cur.status==='deleted')throw err('No such journal');
    const lines=(cur.lines||[]).map(l=>{const o={account:l.account,amount:l.amount,memo:l.memo||''};if(l.fx)o.fx={...l.fx};return o;});
    return opSaveDraft(x,{date:todayISO(),description:cur.description||'',lines},{kind:'manual',why:`Copy of ${cur.number||cur.refNo||cur.id}`});
  }
  function before(v){return{date:v.date,description:v.description||'',lines:cp(v.lines),status:v.status,number:v.number||null};}
  function opEdit(x,id,v,why){
    const cur=x.vouchers[id];if(!cur||cur.status==='deleted')throw err('No such journal');
    if(cur.status==='draft')throw err('This is a draft; save it with Save draft');
    if(cur.status!=='posted')throw err('A void journal can’t be edited');
    if(kindOfV(cur)==='year-end')throw err('A year-end journal can’t be changed by hand; reopen December instead');
    const om=String(cur.date).slice(0,7),os=periodState(x,om);if(os!=='open')throw err(`This journal is in ${mLabel(om)}, which is ${os}`);
    const next={date:v&&v.date!=null?v.date:cur.date,lines:v&&v.lines!=null?v.lines:cur.lines};
    const errs=validateIn(x,next,{});if(errs.length)throw err(errs);
    const t=now(),b=jContent(cur);cur.history=[...(cur.history||[]),{at:t,why:cut(why||'Edited',200),before:before(cur)}];
    cur.date=next.date;cur.lines=normLines(next.lines);
    if(v&&v.description!=null)cur.description=cut(v.description,500);if(v&&v.refNo!=null)cur.refNo=cut(v.refNo,40);
    cur.updatedAt=t;cur.at=t;cur.chartVer=stampOf(x);audit(x,'journal',id,'edit',{reason:why,before:b,after:jContent(cur)});return id;
  }
  function voidIn(x,id,why,o){
    o=o||{};const cur=x.vouchers[id];if(!cur||cur.status==='deleted')throw err('No such journal');
    if(cur.status==='void')return false;
    if(cur.status==='draft')throw err('This is a draft; delete it instead');
    if(!o.system){if(kindOfV(cur)==='year-end')throw err('A year-end journal can’t be voided by hand; reopen December instead');
      const om=String(cur.date).slice(0,7),os=periodState(x,om);if(os!=='open')throw err(`This journal is in ${mLabel(om)}, which is ${os}`);}
    const t=now(),b=jContent(cur);cur.history=[...(cur.history||[]),{at:t,why:cut(why||'Voided',200),before:before(cur)}];
    cur.status='void';cur.updatedAt=t;cur.at=t;audit(x,'journal',id,'void',{reason:why,before:b,after:jContent(cur),id:o.auditId});return true;
  }

  /* ── Accounts ── */
  const CODE_RE=/^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$/;
  function usedCodes(x){const s=new Set();for(const v of Object.values(x.vouchers))if(v&&v.status!=='deleted')for(const l of v.lines||[])s.add(String(l.account));return s;}
  function balanceOf(x,code){let b=0;for(const v of Object.values(x.vouchers))if(isPosted(v))for(const l of v.lines||[])if(String(l.account)===code)b+=l.amount||0;return b;}
  function parentProblem(x,code,kind,p){
    if(p==null||p==='')return null;const pa=accOf(x,p);
    if(!pa)return`The parent ${p} is not in your book`;if(pa.kind!==kind)return`The parent ${p} is ${pa.kind}; it must be ${kind} too`;
    if(pa.archivedAt)return`The parent ${p} is archived`;
    if(code){let q=p,n=0;while(q&&n++<50){if(q===code)return'That parent would make a loop';q=(accOf(x,q)||{}).parent||null;}}
    return null;
  }
  function opAddAccount(x,acc){
    const id=String(acc&&(acc.id!=null?acc.id:acc.code)||'').trim();
    if(!CODE_RE.test(id))throw err('Enter an account code (letters, digits and dots, up to 20)');
    if(x.accounts[id])throw err(`${id} is already in your book`);
    const kind=acc.kind||acc.type;if(!KINDS.includes(kind))throw err('Choose a type: asset, liability, equity, income or expense');
    const parent=acc.parent!=null&&acc.parent!==''?String(acc.parent):null,pp=parentProblem(x,id,kind,parent);if(pp)throw err(pp);
    const bs=kind==='asset'||kind==='liability',gs=groupsOf(x);
    const group=bs?(acc.group&&(gs.some(g=>g.id===acc.group)||GROUPS_DEFAULT.some(g=>g.id===acc.group))?acc.group:(parent&&accOf(x,parent).group)||(kind==='asset'?'other_assets':'other_liabilities')):null;
    const postable=acc.postable!=null?!!acc.postable:acc.isParent!=null?!acc.isParent:true,t=now();
    x.accounts[id]={id,name:cut(acc.name,80)||id,kind,type:cut(acc.accType!=null?acc.accType:(acc.type!==kind?acc.type:''),60),parent,postable,isParent:!postable,
      suspended:!!acc.suspended,archivedAt:null,order:acc.order!=null?acc.order:null,ccy:String(acc.ccy||'IDR').toUpperCase().slice(0,3)||'IDR',
      side:bs?sideOfGroup(x,group,kind):null,group,investment:bs?(acc.investment!=null?!!acc.investment:INVESTMENT_GROUPS.has(group)):null,active:true,
      origin:'app',createdAt:t,at:t,chartVer:stampOf(x)};
    audit(x,'account',id,'add',{after:cp(x.accounts[id])});return id;
  }
  const EDITABLE=['name','parent','postable','group','ccy','investment','suspended','order','type'];
  function opEditAccount(x,code,patch,why){
    const cur=accOf(x,code);if(!cur)throw err(`${code} is not in your book`);patch=patch||{};
    if((patch.id!=null&&String(patch.id)!==code)||(patch.code!=null&&String(patch.code)!==code))throw err('The code of an account can’t be changed');
    if(patch.kind!=null&&patch.kind!==cur.kind)throw err('The type of an account can’t be changed after it is created');
    const next={...cur};
    if('isParent'in patch&&!('postable'in patch))patch={...patch,postable:!patch.isParent};
    for(const k of EDITABLE)if(k in patch)next[k]=patch[k];
    if('parent'in patch){next.parent=patch.parent!=null&&patch.parent!==''?String(patch.parent):null;const pp=parentProblem(x,code,cur.kind,next.parent);if(pp)throw err(pp);}
    next.postable=!!next.postable;next.isParent=!next.postable;
    if(isPostable(cur)&&!next.postable&&usedCodes(x).has(code))throw err(`${code} has entries, so it can’t become a header`);
    next.name=cut(next.name,80)||code;next.ccy=String(next.ccy||'IDR').toUpperCase().slice(0,3)||'IDR';
    const bs=cur.kind==='asset'||cur.kind==='liability';
    if(bs&&'group'in patch){if(!(groupsOf(x).some(g=>g.id===next.group)||GROUPS_DEFAULT.some(g=>g.id===next.group)))throw err('Choose a Net worth group');next.side=sideOfGroup(x,next.group,cur.kind);}
    const keys=['name','parent','postable','group','side','ccy','investment','suspended','order','type'];
    const b={},a={};for(const k of keys)if(JSON.stringify(cur[k])!==JSON.stringify(next[k])){b[k]=cur[k]==null?null:cur[k];a[k]=next[k]==null?null:next[k];}
    if(!Object.keys(a).length)return code;
    next.at=now();next.chartVer=stampOf(x);x.accounts[code]=next;audit(x,'account',code,'edit',{reason:why,before:b,after:a});return code;
  }
  function opArchiveAccount(x,code,why){
    const cur=accOf(x,code);if(!cur)throw err(`${code} is not in your book`);if(cur.archivedAt)return false;
    if((x.settings||{}).retainedEarnings===code)throw err(`${code} is your Retained earnings account`);
    const kids=Object.values(x.accounts).filter(a=>a&&a.parent===code&&!a.archivedAt);if(kids.length)throw err(`${code} has accounts under it that are not archived`);
    const b=balanceOf(x,code);if(b)throw err(`${code} still has a balance of ${Math.abs(b)}`);
    const t=now();x.accounts[code]={...cur,archivedAt:t,at:t};audit(x,'account',code,'archive',{reason:why,before:{archivedAt:null},after:{archivedAt:t}});return true;
  }
  function opSetRetained(x,code){
    const a=accOf(x,code);if(!a)throw err(`${code} is not in your book`);
    if(a.kind!=='equity'||!isPostable(a)||a.archivedAt)throw err('Retained earnings must be a postable, non-archived equity account');
    const b=cp(x.settings),t=now();x.settings={...x.settings,retainedEarnings:code,at:t,chartVer:stampOf(x)};
    audit(x,'settings','retainedEarnings','edit',{before:{retainedEarnings:b.retainedEarnings||null},after:{retainedEarnings:code}});return code;
  }

  /* ── Migration et-ledger/1 → /2 (in place, nothing deleted) and its gate ── */
  function migrate1(x1){
    const o=norm(cp(x1)),t=now();o.schema=SCHEMA;
    for(const a of Object.values(o.accounts)){if(!a)continue;a.postable=isPostable(a);a.isParent=!a.postable;if(a.archivedAt===undefined)a.archivedAt=null;a.chartVer=0;}
    const list=Object.values(o.vouchers).filter(Boolean);
    for(const v of list){v.kind=ORIGIN_KIND[v.origin]||'manual';v.refNo=v.number||'';v.number=null;v.lines=normLines(v.lines);
      if(v.postedAt===undefined)v.postedAt=v.status==='posted'||v.status==='void'?(v.createdAt||v.at||null):null;v.chartVer=0;}
    // Numbers by date, then id, per calendar year: posted and void ones (a void journal keeps its number).
    let numbered=0;
    for(const v of list.filter(v=>(v.status==='posted'||v.status==='void')&&validDate(v.date)).sort((p,q)=>cmp(p.date,q.date)||cmp(p.id,q.id))){v.number=takeNo(o,v.date.slice(0,4));numbered++;}
    // Accurate vouchers that were waiting for review become drafts (the review list stays as it was).
    let drafts=0;
    for(const[id,p]of Object.entries(o.pending)){if(!p||p.status!=='pending'||!p.voucher||o.vouchers[id])continue;const pv=p.voucher;
      o.vouchers[id]={...cp(pv),id,kind:'accurate',status:'draft',number:null,refNo:pv.number||'',lines:normLines(pv.lines),postedAt:null,createdAt:t,updatedAt:t,at:t,history:[],feedSig:contentSig(pv),chartVer:0};drafts++;}
    let first=null;for(const v of list)if(isPosted(v)&&validDate(v.date)){const m=v.date.slice(0,7);if(!first||m<first)first=m;}
    o.settings={retainedEarnings:null,firstMonth:first,at:t};
    o.migration={from:SCHEMA1,at:t,journals:list.length,numbered,drafts,backupAt:null};
    audit(o,'book','',`migrate`,{reason:'Moved to the et-ledger/2 book',after:{journals:list.length,numbered,drafts}});
    return o;
  }
  function diffMaps(a,b,push){for(const k of new Set([...Object.keys(a||{}),...Object.keys(b||{})])){const p=(a||{})[k]||0,q=(b||{})[k]||0;if(p!==q)push(k,p,q);}}
  // Every month: balances and activity of the migrated book (posted journals only) = the /1 book's.
  function migrationDiffs(x1,x2){
    const c1=coreOf(norm(cp(x1))),c2=coreOf(x2),out=[];
    if(JSON.stringify(c1.months)!==JSON.stringify(c2.months))out.push({what:'months',was:c1.months.length,now:c2.months.length});
    for(const m of c1.months){
      diffMaps(c1.balances[m],c2.balances[m],(k,p,q)=>out.push({what:'balance',month:m,account:k,was:p,now:q}));
      diffMaps(c1.activity[m],c2.activity[m],(k,p,q)=>out.push({what:'activity',month:m,account:k,was:p,now:q}));
    }
    const n1=Object.values(x1.vouchers||{}).filter(isPosted).length,n2=Object.values(x2.vouchers).filter(isPosted).length;
    if(n1!==n2)out.push({what:'posted journals',was:n1,now:n2});
    return out;
  }
  function toV2(x){
    if(x&&x.schema===SCHEMA)return{ok:true,x:norm(x),migrated:false};
    const y=migrate1(x),d=migrationDiffs(x,y);
    return d.length?{ok:false,diffs:d,x1:x}:{ok:true,x:y,migrated:true,x1:x};
  }

  /* ── Re-coding the chart to the ERP structure ── */
  function resolveIn(x,code){let c=String(code);for(const r of(x&&x.recodes)||[])if(r&&r.map&&Object.prototype.hasOwnProperty.call(r.map,c))c=r.map[c];return c;}
  function codeMapOf(x){
    const out={};for(const r of(x&&x.recodes)||[]){const m=(r&&r.map)||{};
      for(const k of Object.keys(out))if(Object.prototype.hasOwnProperty.call(m,out[k]))out[k]=m[out[k]];
      for(const[a,b]of Object.entries(m))if(!(a in out))out[a]=b;}
    for(const k of Object.keys(out))if(out[k]===k)delete out[k];return out;
  }
  const has=(re,...s)=>s.some(t=>re.test(String(t||'')));
  // The standard leaf an account belongs under, from its type, Net worth group, currency and name.
  function leafFor(a){
    const n=String(a.name||'').toLowerCase(),t=String(a.type||'').toLowerCase(),ccy=String(a.ccy||'IDR').toUpperCase(),g=a.group||TYPE_GROUP[a.type]||null;
    const R=(leaf,reason,low)=>({leaf,reason,confidence:low?'low':'high'});
    if(a.kind==='asset'){
      if(has(/accum|depreciat|penyusutan|amortis/,n,t))return has(/build|house|home|rumah|bangunan/,n)?R('1222','Accumulated depreciation of a building'):has(/car|vehicle|motor|kendaraan|mobil/,n)?R('1223','Accumulated depreciation of a vehicle'):has(/furnit|equip|perabot|peralatan|computer|laptop/,n)?R('1224','Accumulated depreciation of equipment'):R('1229','Accumulated depreciation',true);
      if(g==='cash'||has(/cash|bank|kas\b/,t)){
        if(has(/e-?wallet|ovo|gopay|go-pay|\bdana\b|shopeepay|linkaja|flazz|e-?money|brizzi|stored value/,n))return R('1113','E-wallet');
        if(has(/\bcash\b|tunai|\bkas\b|petty|on hand/,n)&&!has(/bank/,n))return ccy!=='IDR'?R('1112','Cash in a foreign currency'):R('1111','Cash on hand');
        return ccy!=='IDR'?R('1131',`Bank account in ${ccy}`):R('1121','Bank account in rupiah');}
      if(g==='deposits'){if(has(/bond|obligasi|\bsbn\b|\bori\d*|\bsr\d|\bst\d|sukuk|government|treasury/,n))return R('1313','Bonds and government securities');
        if(has(/money.?market|pasar uang/,n))return R('1142','Money-market fund');return R('1141','Time deposit',!has(/deposit|deposito|\btd\b/,n));}
      if(g==='stocks'){if(has(/fund|reksa|etf/,n))return R('1311','Mutual fund');if(has(/crypto|bitcoin|\bbtc\b|\beth\b|coin/,n))return R('1314','Crypto');
        if(has(/bond|obligasi/,n))return R('1313','Bonds');return R('1312','Shares or a brokerage account',!has(/stock|share|saham|broker|sekuritas|securities|equity/,n));}
      if(g==='business')return R('1321','Business stake');
      if(g==='property'||has(/fixed/,t)){if(has(/\bland\b|tanah|plot/,n))return R('1211','Land');if(has(/house|home|apartment|apartemen|rumah|building|condo|villa/,n))return R('1212','Building or home');
        if(has(/\bcar\b|vehicle|motor|kendaraan|mobil/,n))return R('1213','Vehicle');if(has(/furnit|equip|laptop|computer|perabot|peralatan/,n))return R('1214','Furniture or equipment');return R('1219','Other fixed asset',true);}
      if(g==='receivables'){if(has(/tax|pajak|pph|ppn/,n,t))return R('1171','Prepaid tax');if(has(/prepaid|dibayar di muka/,n))return R('1161','Prepaid expense');
        if(has(/advance|uang muka|deposit|jaminan/,n))return R('1162','Advance or deposit paid');if(has(/loan|pinjam|lent|hutang ke|borrowed by/,n))return R('1151','Loan given');
        if(has(/reimburs|claim|klaim/,n))return R('1152','Reimbursement or claim');return R('1159','Other receivable',true);}
      if(g==='other_assets'){if(has(/prepaid/,n))return R('1161','Prepaid expense');if(has(/advance|deposit|uang muka/,n))return R('1162','Advance or deposit paid');return R('1499','Other asset',true);}
      return R('1499','Other asset',true);
    }
    if(a.kind==='liability'){
      if(g==='cards'||has(/credit card|kartu kredit|\bcc\b/,n))return R('2111','Credit card');
      const long=has(/long/,t)||has(/jangka panjang|long[- ]term/,n);
      if(g==='loans'||has(/loan|pinjam|kpr|mortgage|leasing|paylater|pay later|cicilan|instal/,n)){
        if(has(/mortgage|\bkpr\b|home loan|house/,n))return R('2211','Mortgage');if(has(/car loan|vehicle|motor|kendaraan|leasing/,n))return R('2212','Vehicle loan');
        if(has(/paylater|pay later|cicilan|instal|bnpl/,n))return R('2123','Pay-later or instalments');
        if(long)return R('2219','Long-term loan');if(has(/family|friend|keluarga|teman|person/,n))return R('2122','Loan from family or friends');return R('2121','Short-term loan');}
      if(has(/tax|pajak/,n))return R('2132','Tax payable');if(has(/accru|yang masih harus/,n))return R('2131','Accrued expense');
      if(has(/deposit|advance|uang muka|titipan/,n))return R('2191','Deposit or advance received');return R('2199','Other payable',true);
    }
    if(a.kind==='equity'){if(has(/retained|laba ditahan|saldo laba/,n))return R('3201','Retained earnings');
      if(has(/opening|saldo awal|capital|modal/,n))return R('3101','Opening balance equity');if(has(/revalu/,n))return R('3301','Revaluation reserve');return R('3309','Other equity',true);}
    if(a.kind==='income'){
      if(has(/salary|gaji|wage|upah|payroll/,n))return R('4101','Salary');if(has(/bonus|\bthr\b|allowance|tunjangan|incentive/,n))return R('4102','Bonus or allowance');
      if(has(/\brent|sewa/,n))return R('4301','Rental income');if(has(/interest|bunga|jasa giro/,n))return R('7101','Interest income');if(has(/dividen/,n))return R('7102','Dividend income');
      if(has(/\bfx\b|forex|exchange|kurs/,n))return has(/unreal/,n)?R('7202','Unrealised FX gains'):R('7201','FX gains');
      if(has(/gain|capital|investment|return|keuntungan|revalu|market/,n))return has(/unreal|revalu|market/,n)?R('7302','Unrealised investment gains'):R('7301','Investment gains');
      if(has(/business|usaha|profit|sales|penjualan|bagi hasil|share/,n))return R('4201','Business income');if(has(/\bfee|commission|komisi|honor/,n))return R('4202','Fees or commissions');
      if(has(/gift|hadiah|hibah|angpao/,n))return R('4901','Gifts received');return R('4909','Other income',true);
    }
    // expense
    if(has(/deprec|penyusutan/,n))return R('6801','Depreciation');if(has(/interest|bunga/,n)&&!has(/tax|pajak/,n))return R('8101','Interest paid');
    if(has(/bank fee|bank charge|admin|biaya bank|card fee|annual fee|\bfees?\b.*bank|bank.*\bfees?\b/,n))return R('8102','Bank or card fees');
    if(has(/\bfx\b|forex|exchange|kurs/,n))return has(/unreal/,n)?R('8202','Unrealised FX losses'):R('8201','FX losses');
    if(has(/tax|pajak|pph/,n))return has(/interest|final|deposit|dividen|bunga/,n)?R('9102','Final tax on interest and investments'):has(/withh|potong/,n)?R('9103','Tax withheld'):R('9101','Income tax');
    if(has(/investment loss|capital loss|\bloss\b|rugi/,n))return R('8301','Investment losses');
    const E=[[/food|dining|restaurant|makan|cafe|coffee/,'6101','Food and dining'],[/grocer|supermarket/,'6102','Groceries'],[/household|rumah tangga|cleaning|laundry|maid|pembantu/,'6103','Household'],
      [/fuel|bensin|\bbbm\b|petrol/,'6202','Fuel'],[/\btoll|\btol\b|parking|parkir/,'6203','Tolls and parking'],[/vehicle|stnk|bengkel|car maint|car service/,'6204','Vehicle upkeep'],
      [/transport|taxi|ride|grab|gojek|train|\bbus\b|commut/,'6201','Transport'],[/\brent\b|sewa/,'6301','Rent'],[/electric|listrik|\bpln\b|water|pdam|utilit/,'6302','Utilities'],
      [/telecom|phone|internet|pulsa|wifi|mobile/,'6303','Telecom'],[/repair|maintenance|renovat|perbaikan/,'6304','Home maintenance'],
      [/tech|subscription|langganan|software|cloud|streaming/,'6402','Tech and subscriptions'],[/shopping|cloth|fashion|belanja/,'6401','Shopping'],
      [/personal care|salon|barber|cosmetic|beauty/,'6403','Personal care'],[/health|medical|doctor|hospital|clinic|pharma|obat|dental|kesehatan/,'6501','Health'],
      [/insurance|asuransi|premi/,'6502','Insurance'],[/entertain|movie|cinema|hiburan|concert/,'6601','Entertainment'],[/sport|gym|fitness|olahraga|golf/,'6602','Sports'],
      [/travel|holiday|vacation|hotel|flight|airline|liburan/,'6603','Travel'],[/foreign|luar negeri|overseas/,'6604','Foreign spending'],
      [/educat|school|sekolah|course|tuition|kursus/,'6701','Education'],[/family|keluarga|parents|orang tua|\bchild|\banak/,'6702','Family support'],
      [/relig|donat|zakat|charity|church|mosque|temple|perpuluhan|sedekah|infaq|tithe/,'6703','Religion and donations'],[/gift|hadiah|kado/,'6704','Gifts given'],
      [/ad hoc|adhoc|one-off|one off/,'6901','One-off spending']];
    for(const[re,leaf,why]of E)if(re.test(n))return R(leaf,why);
    return R('6909','Other living expense',true);
  }
  function stdIndex(std){return new Map((std||[]).map(s=>[s.code,s]));}
  function isStdCode(S,code,kind){
    const s=S.get(code);if(s)return s.type===kind;const m=/^(\d{4})\.\d{2}$/.exec(code);const p=m&&S.get(m[1]);return!!(p&&p.postable&&p.type===kind);
  }
  function ancestors(S,code){const out=[];let s=S.get(code);while(s&&s.parent){out.push(s.parent);s=S.get(s.parent);}return out;}
  // → [{old, new, name, kind, reason, confidence}] for every account. Postable accounts (and any with
  // lines) go to .nn children of their standard leaf (nn from 01 in old-code order); headers go to
  // the nearest standard header that holds every account under them.
  function recodeProposal(x,std){
    const S=stdIndex(std),used=usedCodes(x),accs=Object.values(x.accounts).filter(Boolean).sort((p,q)=>cmpCode(p.id,q.id));
    const out=new Map(),byLeaf=new Map(),taken=new Set();
    for(const a of accs)if(isStdCode(S,a.id,a.kind)&&(isPostable(a)||used.has(a.id))){
      const f=leafFor(a),base=a.id.split('.')[0],same=f.leaf===base;
      out.set(a.id,{old:a.id,new:a.id,name:a.name,kind:a.kind,reason:same?'Already an ERP code':`Keeps its code, which is an ERP code; by its name it would go under ${f.leaf}`,confidence:same?'high':'low'});taken.add(a.id);}
    for(const a of accs){if(out.has(a.id)||!(isPostable(a)||used.has(a.id)))continue;
      const f=leafFor(a);(byLeaf.get(f.leaf)||byLeaf.set(f.leaf,[]).get(f.leaf)).push({a,f});}
    for(const[leaf,list]of byLeaf){let nn=1;
      for(const{a,f}of list){let c;do{c=`${leaf}.${p2(nn++)}`;}while(taken.has(c));taken.add(c);
        out.set(a.id,{old:a.id,new:c,name:a.name,kind:a.kind,reason:f.reason,confidence:f.confidence,leaf});}}
    // Headers: the deepest standard header above every account under them.
    const kids=new Map();for(const a of accs)if(a.parent)(kids.get(a.parent)||kids.set(a.parent,[]).get(a.parent)).push(a.id);
    const below=id=>{const r=[],st=[...(kids.get(id)||[])];while(st.length){const k=st.pop();if(out.has(k))r.push(out.get(k).new);for(const q of kids.get(k)||[])st.push(q);}return r;};
    const CLASS={asset:'1000',liability:'2000',equity:'3000',income:'4000',expense:'6000'};
    for(const a of accs){if(out.has(a.id))continue;const ts=below(a.id);let pick=null;
      if(ts.length){const chain=c=>{const m=/^(\d{4})\.\d{2}$/.exec(c),base=m?m[1]:c;return[...(m?[base]:[]),...ancestors(S,base)].filter(h=>S.has(h)&&!S.get(h).postable);};
        const sets=ts.map(chain);pick=(sets[0]||[]).find(h=>sets.every(s=>s.includes(h)))||null;}
      const nw=pick&&S.get(pick).type===a.kind?pick:CLASS[a.kind]||'1000';
      out.set(a.id,{old:a.id,new:nw,name:a.name,kind:a.kind,reason:ts.length?'Header: the standard header above its accounts':'Header with no accounts under it',confidence:'high',header:true});}
    return accs.map(a=>out.get(a.id));
  }
  // Applies an old → new map (unlisted accounts keep their code) on a copy of x; nothing changes
  // unless, for every month, each old account's balance and activity equal its new account's, and
  // the totals per type match. → {ok, x, diffs, map(changed codes only), errors}
  function recodeIn(x,map,std,o){
    o=o||{};const errors=[],t=now(),ver=stampOf(x)+1,used=usedCodes(x),S=stdIndex(std);
    const full={};for(const a of Object.values(x.accounts))if(a)full[a.id]=map&&map[a.id]!=null&&String(map[a.id]).trim()?String(map[a.id]).trim():a.id;
    for(const[k,v]of Object.entries(full))if(!CODE_RE.test(v))errors.push(`${k}: ${v} is not a valid code`);
    const targets=new Map();for(const[k,v]of Object.entries(full))(targets.get(v)||targets.set(v,[]).get(v)).push(k);
    for(const[v,ks]of targets){const real=ks.filter(k=>used.has(k)||isPostable(x.accounts[k]));if(real.length>1)errors.push(`${real.join(' and ')} would both become ${v}`);}
    const next={};
    if(o.addStandard!==false)for(const s of std||[])next[s.code]=accFromStd(s,t,ver);
    const fromOld=new Set(),order=Object.values(x.accounts).filter(Boolean).sort((p,q)=>(isPostable(q)||used.has(q.id)?1:0)-(isPostable(p)||used.has(p.id)?1:0)||cmpCode(p.id,q.id));
    for(const a of order){const nc=full[a.id],ex=next[nc],real=isPostable(a)||used.has(a.id);
      if(ex&&ex.kind!==a.kind){errors.push(`${a.id} is ${a.kind} but ${nc} is ${ex.kind}`);continue;}
      if(ex&&!real){if(!ex.oldCode&&nc!==a.id)ex.oldCode=a.id;continue;}   // a header without lines joins the standard header
      if(ex&&fromOld.has(nc)){errors.push(`${a.id} would take ${nc}, already taken`);continue;}
      const y={...cp(a),id:nc,order:null,chartVer:ver,at:t};if(nc!==a.id)y.oldCode=a.oldCode||a.id;
      if(ex){y.parent=ex.parent;if(!y.group&&ex.group){y.group=ex.group;y.side=ex.side;}}else y.parent=null;
      y._old=a.id;next[nc]=y;fromOld.add(nc);}
    for(const y of Object.values(next)){if(!y._old)continue;const a=x.accounts[y._old];
      const m=/^(.+)\.(\d{2})$/.exec(y.id);
      if(m&&next[m[1]]&&m[1]!==y.id)y.parent=m[1];
      else if(!S.has(y.id))y.parent=a.parent&&next[full[a.parent]]?full[a.parent]:null;
      if(y.parent===y.id)y.parent=null;
      if(!y.group&&(y.kind==='asset'||y.kind==='liability')){let q=y.parent;while(q&&next[q]){if(next[q].group){y.group=next[q].group;y.side=next[q].side;break;}q=next[q].parent;}}}
    // A standard leaf that gets .nn children becomes a header (it has no lines of its own).
    for(const y of Object.values(next)){if(!y._old)continue;const p=y.parent&&next[y.parent];if(p&&!p._old&&p.postable){p.postable=false;p.isParent=true;}}
    for(const y of Object.values(next)){const p=y.parent&&next[y.parent];if(p&&p.kind!==y.kind)errors.push(`${y.id} (${y.kind}) can’t sit under ${p.id} (${p.kind})`);
      let q=y.parent,n=0;while(q&&n++<60){if(q===y.id){errors.push(`${y.id} would sit under itself`);break;}q=(next[q]||{}).parent;}
      y.isParent=!isPostable(y);delete y._old;}
    if(errors.length)return{ok:false,errors,diffs:[],map:{}};
    const z=cp(x);z.accounts=next;
    const R=c=>Object.prototype.hasOwnProperty.call(full,c)?full[c]:c;
    for(const v of Object.values(z.vouchers)){if(!v)continue;v.lines=(v.lines||[]).map(l=>({...l,account:R(String(l.account))}));v.chartVer=ver;}
    if(z.settings.retainedEarnings)z.settings.retainedEarnings=R(z.settings.retainedEarnings);z.settings.chartVer=ver;
    for(const[m,mo]of Object.entries(z.market||{})){const n={};for(const[c,e]of Object.entries(mo||{})){const k=R(c);if(!n[k]||atOf(e)>atOf(n[k]))n[k]={...e,chartVer:ver};}z.market[m]=n;}
    const changed={};for(const[k,v]of Object.entries(full))if(k!==v)changed[k]=v;
    z.recodes=[...(z.recodes||[]),{id:`rc-${Date.now().toString(36)}-${rid(4)}`,at:t,map:changed,count:Object.keys(changed).length}];
    // The gate.
    const c1=coreOf(x),c2=coreOf(z),diffs=[];
    if(JSON.stringify(c1.months)!==JSON.stringify(c2.months))diffs.push({what:'months',was:c1.months.length,now:c2.months.length});
    const kindOld=k=>(x.accounts[k]||{}).kind||'?',kindNew=k=>(z.accounts[k]||{}).kind||'?';
    for(const m of c1.months){for(const box of['balances','activity']){const a=c1[box][m]||{},b=c2[box][m]||{},seen=new Set();
        for(const[k,v]of Object.entries(a)){const nk=R(k);seen.add(nk);if((b[nk]||0)!==v)diffs.push({what:box,month:m,account:k,new:nk,was:v,now:b[nk]||0});}
        for(const[k,v]of Object.entries(b))if(!seen.has(k)&&v)diffs.push({what:box,month:m,account:k,new:k,was:0,now:v});
        const ta={},tb={};for(const[k,v]of Object.entries(a))ta[kindOld(k)]=(ta[kindOld(k)]||0)+v;for(const[k,v]of Object.entries(b))tb[kindNew(k)]=(tb[kindNew(k)]||0)+v;
        diffMaps(ta,tb,(k,p,q)=>diffs.push({what:box+' total',month:m,kind:k,was:p,now:q}));}}
    if(diffs.length)return{ok:false,errors:[],diffs,map:changed};
    audit(z,'chart','','recode',{reason:o.why||'Moved to the ERP chart',after:{accounts:Object.keys(changed).length,map:changed}});
    return{ok:true,x:z,errors:[],diffs:[],map:changed};
  }

  /* ── Accurate feed: books.json only ever brings DRAFT journals ── */
  function setBooksSource(x,b){
    const s=x.source;s.book=(b.source&&b.source.book)||s.book||'';s.exportedOn=(b.source&&b.source.exportedOn)||s.exportedOn||'';
    s.balancesAsOf=maxS(s.balancesAsOf,b.source&&b.source.balancesAsOf);s.booksGeneratedAt=maxS(s.booksGeneratedAt,iso(b.generatedAt));
  }
  function mergeBooks(x,b){
    const at=iso(b.generatedAt),t=now(),r={new:0,refreshed:0,changedPosted:0,skipped:0};
    const linkedTo=new Set(Object.values(x.links||{})),bySig=new Map();
    for(const v of Object.values(x.vouchers))if(isPosted(v)&&kindOfV(v)!=='accurate'){const s=sigOf(v);if(!bySig.has(s))bySig.set(s,v.id);}
    for(const v of b.vouchers||[]){
      const key=String(v.key),id='acc|'+key,lines=normLines(v.lines).map(l=>({...l,account:resolveIn(x,l.account)}));
      const y={date:String(v.date).slice(0,10),description:cut(v.description,500),refNo:cut(v.number,40),type:cut(v.type,40),source:v.source||'',lines};
      const sig=contentSig(y),cur=x.vouchers[id];
      if(!cur){
        if(linkedTo.has(id)||(x.pending[id]&&x.pending[id].status==='accepted')){r.skipped++;continue;}   // the /1 book already had it, linked or added
        const j={id,srcKey:key,kind:'accurate',status:'draft',number:null,...y,createdAt:t,updatedAt:t,postedAt:null,at:t,history:[],feedSig:sig,feedAt:at,chartVer:stampOf(x)};
        const tw=bySig.get(sigOf(y));if(tw)j.twin=tw;
        x.vouchers[id]=j;audit(x,'journal',id,'save',{reason:'From Accurate',after:jContent(j)});r.new++;continue;}
      if(cur.feedSig===sig||cur.status==='deleted')continue;
      if(!cur.feedSig&&contentSig(cur)===sig){cur.feedSig=sig;continue;}
      if(cur.status==='draft'){const b0=jContent(cur);cur.history=[...(cur.history||[]),{at:t,why:'Accurate’s newer version',before:before(cur)}];
        Object.assign(cur,y);cur.feedSig=sig;cur.feedAt=at;cur.updatedAt=t;cur.at=t;
        audit(x,'journal',id,'save',{reason:'Accurate’s newer version',before:b0,after:jContent(cur)});r.refreshed++;continue;}
      audit(x,'journal',id,'accurate-differs',{reason:'Accurate has a different version; your book keeps its own',before:jContent(cur),after:{date:y.date,description:y.description,lines:y.lines,refNo:y.refNo}});
      cur.feedSig=sig;cur.feedAt=at;cur.at=t;if(cur.status==='posted')r.changedPosted++;
    }
    setBooksSource(x,b);
    return r;
  }
  // The /1 seed's wealth merge (creates accounts the books lack); kept for the legacy seed only.
  function fillWealth1(x,w,stamp){
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
    wealthRest(x,w,at,n,c=>c);
    return n;
  }
  function wealthRest(x,w,at,n,R){
    for(const g of w.groups||[])if(g&&g.id&&!x.groups.some(h=>h.id===g.id))x.groups.push({id:g.id,label:g.label||g.id,side:g.side==='liability'?'liability':'asset'});
    for(const[m,o]of Object.entries(w.market||{}))for(const[code0,v]of Object.entries(o||{})){
      if(v==null||isNaN(+v))continue;const code=R(code0),mm=x.market[m]||(x.market[m]={}),cur=mm[code];
      if(!cur||(at>=atOf(cur)&&cur.v!==Math.round(+v))){mm[code]={v:Math.round(+v),at,src:'snapshot',...(x.schema===SCHEMA?{chartVer:stampOf(x)}:{})};n.market++;}
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
  }
  // The wealth snapshot after the book exists: never adds an account (codes go through the re-code
  // map); fills side / group / investment / active / P&L kind only where the account has none;
  // market values and closes merged by `at`. None of it feeds a ledger balance.
  function fillWealth(x,w,stamp){
    const at=iso(w.generatedAt),n={accounts:0,market:0,closes:0,unknown:0},R=c=>resolveIn(x,String(c));
    for(const a of w.accounts||[]){const cur=x.accounts[R(a.id)];if(!cur){n.unknown++;continue;}
      let ch=false;for(const k of['side','group','investment','active'])if(cur[k]==null&&a[k]!=null){cur[k]=a[k];ch=true;}
      if(ch&&stamp>atOf(cur))cur.at=stamp;}
    for(const l of w.ledger||[]){const cur=x.accounts[R(l.id)];if(!cur){n.unknown++;continue;}
      if(cur.plKind==null&&l.kind){cur.plKind=l.kind;if(stamp>atOf(cur))cur.at=stamp;}}
    wealthRest(x,w,at,n,R);
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

  /* ── The legacy /1 seed (Accurate files + tie gate). Not used by the UI any more (Start my book
     replaces it); kept so a /1 book can be built for the migration tests and the real-data check. ── */
  function seedFrom(w,b,c){
    const x={schema:SCHEMA1,seededAt:null,updatedAt:null,currency:'IDR',source:{},accounts:{},vouchers:{},market:{},closes:[],groups:[],
      cash:{accounts:{},statements:{},txns:{},alias:{}},links:{},flags:{},pending:{},imports:[]},at=iso(b.generatedAt);
    for(const a of b.accounts||[])x.accounts[String(a.id)]=accFromBooks(a,at);
    for(const v of b.vouchers||[]){const y=vFromBooks(v,at);x.vouchers[y.id]=y;}
    setBooksSource(x,b);
    const wn=fillWealth1(x,w,iso(w.generatedAt));
    const imports=[{at:now(),kind:'books',generatedAt:at,added:Object.keys(x.vouchers).length,new:0,differs:0,missing:0,linked:0},
      {at:now(),kind:'wealth',generatedAt:iso(w.generatedAt),added:wn.market+wn.closes,new:0,differs:0,missing:0,linked:0}];
    if(c&&Array.isArray(c.txns)){const cn=mergeCash(x,c,false);imports.push({at:now(),kind:'cash',generatedAt:iso(c.generatedAt),added:cn.txns,new:0,differs:0,missing:0,linked:0});}
    x.imports=imports;
    return x;
  }
  // Every difference between the views computed from a /1 x and the imported files ([] = ties).
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
  // Legacy: builds a /1 book from the imported files (tie gate), migrates it (migration gate) and
  // uses it. Never replaces a book that exists on this device or in Drive. → {ok, reason?, count, diffs}
  async function ledgerSeed(o){
    o=o||{};if(SEEDING)return SEEDING;
    SEEDING=(async()=>{
      try{
        await ensureLedger();
        if(live())return{ok:true,already:true};
        if(STATUS==='error')return GATE={ok:false,reason:'error',at:now(),count:0,diffs:[]};
        const{w,b,c}=seedInputs();
        if(!w||!b)return GATE={ok:false,reason:'missing',at:now(),count:0,diffs:[],wealth:!!w,books:!!b};
        const x1=seedFrom(w,b,c),diffs=gateDiffs(x1,w,b);
        GATE={ok:!diffs.length,at:now(),count:diffs.length,diffs:diffs.slice(0,DIFF_SHOWN),wealthAt:w.generatedAt,booksAt:b.generatedAt};
        if(diffs.length)return GATE;
        x1.seededAt=now();const r=toV2(x1);
        if(!r.ok){GATE={ok:false,reason:'migration',at:now(),count:r.diffs.length,diffs:r.diffs.slice(0,DIFF_SHOWN)};return GATE;}
        r.x.migration={...r.x.migration,from:'seed',backupAt:null};
        L=r.x;LFOR=owner();STATUS='ready';ERROR=null;MIG_INFO={status:'seeded',at:now(),count:0};
        changed({why:'seed',quiet:o.quiet});
        return GATE;
      }finally{SEEDING=null;}
    })();
    return SEEDING;
  }

  /* ── Device merge (two copies of the book): per entry, the newer `at` wins; union of keys ── */
  function byAt(r,l){const o={...(r||{})};for(const[k,v]of Object.entries(l||{}))if(!(k in o)||atOf(v)>=atOf(o[k]))o[k]=v;return o;}
  // Accounts and market entries: the copy that knows more re-codes wins first, then the newer `at`.
  function byVerAt(r,l){const o={...(r||{})};for(const[k,v]of Object.entries(l||{})){const q=o[k];
    if(!(k in o)||(v&&q&&((v.chartVer||0)>(q.chartVer||0)||((v.chartVer||0)===(q.chartVer||0)&&atOf(v)>=atOf(q)))))o[k]=v;}return o;}
  function mergeLedgers(remote,local){
    const r=norm(cp(remote)),l=norm(cp(local)),o=emptyLedger();
    o.seededAt=minS(r.seededAt,l.seededAt);o.updatedAt=maxS(r.updatedAt,l.updatedAt);o.currency=l.currency||r.currency||'IDR';
    o.accounts=byVerAt(r.accounts,l.accounts);
    o.vouchers=byAt(r.vouchers,l.vouchers);
    for(const id of Object.keys(o.vouchers)){const a=r.vouchers[id],b=l.vouchers[id];if(!a||!b)continue;
      const seen=new Set(),h=[];for(const e of[...(a.history||[]),...(b.history||[])]){const k=e.at+'|'+e.why;if(!seen.has(k)){seen.add(k);h.push(e);}}
      // Edited on both devices: the newer version wins, and the other one goes into the history.
      const win=o.vouchers[id],lose=win===a?b:a,lc=JSON.stringify(vContent(lose));
      const known=new Set((win.history||[]).map(e=>e.at+'|'+e.why)),edited=(lose.history||[]).some(e=>e&&!known.has(e.at+'|'+e.why));
      if(edited&&lc!==JSON.stringify(vContent(win))&&!h.some(e=>e&&e.before&&JSON.stringify(vContent(e.before))===lc))
        h.push({at:atOf(lose)||now(),why:CONCURRENT,before:vContent(lose)});
      o.vouchers[id]={...win,history:h.sort((p,q)=>cmp(p.at,q.at))};}
    o.periods=byAt(r.periods,l.periods);
    o.settings=atOf(l.settings)>=atOf(r.settings)?l.settings:r.settings;
    const ids=new Set();o.audit=[...r.audit,...l.audit].filter(e=>e&&e.id&&!ids.has(e.id)&&ids.add(e.id)).sort((p,q)=>cmp(p.at,q.at)||cmp(p.id,q.id));
    for(const y of new Set([...Object.keys(r.numbering),...Object.keys(l.numbering)]))o.numbering[y]=Math.max(+r.numbering[y]||0,+l.numbering[y]||0);
    const rids=new Set();o.recodes=[...r.recodes,...l.recodes].filter(e=>e&&e.id&&!rids.has(e.id)&&rids.add(e.id)).sort((p,q)=>cmp(p.at,q.at));
    o.migration=l.migration||r.migration?{...(r.migration||{}),...(l.migration||{}),backupAt:maxS((r.migration||{}).backupAt,(l.migration||{}).backupAt)}:null;
    for(const m of new Set([...Object.keys(r.market),...Object.keys(l.market)]))o.market[m]=byVerAt(r.market[m],l.market[m]);
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
    applyRecodes(o);renumberCollisions(o);healDuplicatePosts(o);
    return o;
  }
  // A copy from a device that had not seen a re-code yet: its accounts, lines and market values move
  // to the new codes (an old-code account whose new one exists is dropped as the older copy).
  function applyRecodes(o){
    const n=o.recodes.length;if(!n)return;
    const mapFrom=(cv,c)=>{for(let i=cv;i<n;i++){const m=o.recodes[i].map||{};if(Object.prototype.hasOwnProperty.call(m,c))c=m[c];}return c;};
    for(const[k,a]of Object.entries(o.accounts)){if(!a||(a.chartVer||0)>=n)continue;const c=mapFrom(a.chartVer||0,k);
      if(c!==k){delete o.accounts[k];if(!o.accounts[c])o.accounts[c]={...a,id:c,oldCode:a.oldCode||k,chartVer:n};}else a.chartVer=n;}
    for(const v of Object.values(o.vouchers)){if(!v||(v.chartVer||0)>=n)continue;const cv=v.chartVer||0;v.lines=(v.lines||[]).map(l=>({...l,account:mapFrom(cv,String(l.account))}));v.chartVer=n;}
    for(const mo of Object.values(o.market)){for(const[k,e]of Object.entries(mo||{})){if(!e||(e.chartVer||0)>=n)continue;const c=mapFrom(e.chartVer||0,k);delete mo[k];if(!mo[c]||atOf(e)>atOf(mo[c]))mo[c]={...e,chartVer:n};}}
    const s=o.settings||{};if((s.chartVer||0)<n&&s.retainedEarnings){o.settings={...s,retainedEarnings:mapFrom(s.chartVer||0,s.retainedEarnings),chartVer:n};}
  }
  // Two devices posting in the same year while apart can both take the same number. The journal
  // posted first keeps it; the other gets the next free number of its year, with an audit note.
  function renumberCollisions(o){
    const by=new Map();let n=0;
    for(const v of Object.values(o.vouchers))if(v&&v.number&&(v.status==='posted'||v.status==='void'))(by.get(v.number)||by.set(v.number,[]).get(v.number)).push(v);
    for(const[num,vs]of by){if(vs.length<2)continue;
      vs.sort((p,q)=>cmp(String(p.postedAt||p.createdAt||''),String(q.postedAt||q.createdAt||''))||cmp(p.id,q.id));
      for(const v of vs.slice(1)){const y=(NUM_RE.exec(num)||[])[1]||String(v.date).slice(0,4),nn=takeNo(o,y),t=now();
        o.vouchers[v.id]={...v,number:nn,at:t,updatedAt:t,history:[...(v.history||[]),{at:t,why:'Renumbered: another device took the same number',before:before(v)}]};
        audit(o,'journal',v.id,'renumber',{id:`renumber|${v.id}|${num}`,reason:'Another device posted a journal with the same number',before:{number:num},after:{number:nn}});n++;}}
    return n;
  }
  const CONCURRENT='edited on another device at the same time',DUPLICATE='duplicate post from another device';
  function vContent(v){return{date:v.date,description:v.description||'',status:v.status||'posted',
    lines:(v.lines||[]).map(l=>({account:String(l.account),amount:Math.round(l.amount||0),memo:l.memo||'',...(l.fx?{fx:{ccy:l.fx.ccy,amount:l.fx.amount,rate:l.fx.rate}}:{})}))};}
  // Income and month-end journals carry the receipt id / 'month-end:YYYY-MM' as ref; only one may be
  // posted per ref. Two devices posting at once leave two: keep the newest, void the other (history
  // kept), so the book heals itself on the next merge.
  const REF_KINDS=['income','month-end'];
  function healDuplicatePosts(x){
    const by=new Map();let n=0;
    for(const v of Object.values(x.vouchers||{}))if(isPosted(v)&&v.ref&&REF_KINDS.includes(kindOfV(v))){const k=kindOfV(v)+'|'+v.ref;(by.get(k)||by.set(k,[]).get(k)).push(v);}
    for(const vs of by.values()){if(vs.length<2)continue;
      vs.sort((p,q)=>cmp(String(q.createdAt||q.at||''),String(p.createdAt||p.at||''))||cmp(q.id,p.id));
      for(const v of vs.slice(1)){const t=now();
        x.vouchers[v.id]={...v,status:'void',updatedAt:t,at:t,history:[...(v.history||[]),{at:t,why:DUPLICATE,before:vContent(v)}]};
        if(Array.isArray(x.audit))audit(x,'journal',v.id,'void',{id:`heal|${v.id}`,reason:DUPLICATE,before:jContent(v),after:jContent(x.vouchers[v.id])});n++;}}
    return n;
  }
  // The posted journal for a ref (an income receipt id or 'month-end:YYYY-MM'), or null.
  function findByRef(ref,kind){const x=live();if(!x||!ref)return null;let best=null;const k=kind?ORIGIN_KIND[kind]||kind:null;
    for(const v of Object.values(x.vouchers))if(isPosted(v)&&v.ref===ref&&(!k||kindOfV(v)===k)&&(!best||String(v.createdAt||v.at||'')>String(best.createdAt||best.at||'')))best=v;
    return best;}
  // A cheap fingerprint: which entries exist and when each last changed.
  function fp(x){
    const p=[];for(const k of['accounts','vouchers','flags','pending','periods'])for(const[id,v]of Object.entries(x[k]||{}))p.push(k+':'+id+':'+atOf(v));
    for(const[m,o]of Object.entries(x.market||{}))for(const[c,v]of Object.entries(o||{}))p.push('m:'+m+':'+c+':'+atOf(v));
    for(const c of x.closes||[])p.push('c:'+c.month+':'+atOf(c));
    for(const k of['accounts','statements','txns'])for(const[id,v]of Object.entries(((x.cash||{})[k])||{}))p.push('cash'+k+':'+id+':'+atOf(v));
    p.push('L'+Object.keys(x.links||{}).length,'I'+(x.imports||[]).length,'A'+Object.keys((x.cash||{}).alias||{}).length,
      'U'+(x.audit||[]).length,'R'+(x.recodes||[]).length,'S'+atOf(x.settings),'B'+((x.migration||{}).backupAt||''));
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
  function cachePut(){if(L&&L.seededAt&&!MIG_BLOCK&&L.schema===SCHEMA)return idb('readwrite',st=>st.put({owner:LFOR,ledger:L},cacheKey(LFOR)));return Promise.resolve(null);}
  async function cacheGet(me){
    const c=await idb('readonly',st=>st.get(cacheKey(me)));if(c)return c;
    const old=await idb('readonly',st=>st.get('current'));return old&&old.owner===me?old:null;
  }
  function block(why){
    BLOCKED=why;ERROR=why;STATUS='error';
    if(typeof showBanner==='function')showBanner('ledgerfile','warn','triangle-alert','Your book’s file in Google Drive can’t be read by this version of the app, so nothing is saved over it. Reload the app; if it stays, restore from a backup.');
    return'blocked';
  }
  // The /1 book could not be migrated: keep it as it is, read-only, and say so.
  function migBlock(x1,diffs){
    MIG_BLOCK={count:diffs.length,diffs:diffs.slice(0,DIFF_SHOWN),at:now()};MIG_INFO={status:'blocked',...MIG_BLOCK};
    L=norm(cp(x1));L.schema=SCHEMA1;LFOR=owner();VER++;ERROR='Your book could not be moved to the new format';STATUS='error';
    if(typeof showBanner==='function')showBanner('ledgermigrate','warn','triangle-alert',`Your book could not be moved to the new format (${diffs.length} difference${diffs.length===1?'':'s'}), so it is read-only and nothing is saved. Your old file is untouched.`);
    return'blocked';
  }
  // A /1 or /2 object from storage → a /2 book, or null when it was blocked.
  function intake(x,where){
    const r=toV2(x);
    if(!r.ok){migBlock(x,r.diffs);return null;}
    if(r.migrated){if(!V1RAW||where==='drive')V1RAW=cp(x);MIG_INFO={status:'migrated',at:now(),count:0,from:where};}
    else if(where==='drive')V1RAW=null;   // Drive already holds a /2 book: another device migrated (and kept the backup)
    return r.x;
  }
  const BAD={};
  async function readJson(id){try{return await driveReadJson(id);}catch(e){if(e instanceof SyntaxError)return BAD;throw e;}}
  // Every ledger.json in the app folder, oldest first (two devices seeding at once can make two).
  async function listFiles(){
    const f=await driveFindFileByName(FILE);if(!f)return[];
    if(f.more&&typeof driveListFilesByName==='function'){const fs=await driveListFilesByName(FILE);if(Array.isArray(fs)&&fs.length)return fs;}
    return[f];
  }
  // Before the first /2 save: the /1 copy goes to ledger-v1-backup.json (an existing backup is kept).
  async function backupV1(){
    if(!V1RAW)return;
    const f=await driveFindFileByName(BACKUP_FILE);
    if(!f)await driveUploadJson(null,BACKUP_FILE,V1RAW);
    L.migration={...(L.migration||{}),backupAt:now(),backupKept:!!f};V1RAW=null;
  }
  async function driveSave(){
    if(BLOCKED||MIG_BLOCK)return'blocked';
    if(!accessToken||!L||!L.seededAt)return'skip';
    if(!fileId){const f=(await listFiles())[0];if(f){fileId=f.id;revId=null;}}
    if(fileId){const rev=await driveGetRevision(fileId);
      if(rev!==revId){const remote=await readJson(fileId);
        if(remote===BAD||!validLedger(remote))return block('ledger.json in Drive is not a readable book');
        const y=intake(remote,'drive');if(!y)return'blocked';
        revId=rev;const before=fp(L);L=mergeLedgers(y,L);if(fp(L)!==before){VER++;cachePut();afterOutsideChange();}}}
    if(V1RAW)await backupV1();
    const saved=await driveUploadJson(fileId,FILE,L);fileId=saved.id;revId=saved.headRevisionId;cachePut();return'pushed';
  }
  function scheduleSave(){
    clearTimeout(SAVE_T);if(!accessToken)return;
    SAVE_T=setTimeout(()=>{SAVE_T=null;ledgerFlush();},1500);
  }
  // Saves to Drive now (and returns when done); for tests and before a backup.
  function ledgerFlush(){
    clearTimeout(SAVE_T);SAVE_T=null;
    const run=(SAVING||Promise.resolve()).then(()=>driveSave()).then(r=>{ERROR=MIG_BLOCK?ERROR:null;return r;},e=>{ERROR=String(e&&e.message||e);return'error';});
    SAVING=run.finally(()=>{if(SAVING===run)SAVING=null;});
    return run;
  }
  async function driveSync(){
    const fs=await listFiles(),f=fs[0];let remote=null;
    if(f){remote=await readJson(f.id);
      if(remote===BAD||!validLedger(remote)){block('ledger.json in Drive is not a readable book');return'blocked';}
      fileId=f.id;revId=f.headRevisionId;
      remote=intake(remote,'drive');if(!remote)return'blocked';
      // More than one file: merge every readable one into the oldest; the others stay as they are.
      let extra=0;for(const g of fs.slice(1)){try{const o=await driveReadJson(g.id);if(validLedger(o)){const r=toV2(o);if(r.ok){remote=mergeLedgers(r.x,remote);extra++;}}}catch(_){}}
      if(extra){const im=remote.imports||[],last=im[im.length-1];
        if(!(last&&last.kind==='drive-files'&&last.files===extra))remote.imports=[...im,{at:now(),kind:'drive-files',files:extra,added:0,differs:0,missing:0,linked:0}];revId=null;}}
    if(remote){const had=L&&L.schema===SCHEMA?L:null;L=had?mergeLedgers(remote,had):norm(remote);LFOR=owner();VER++;cachePut();
      if((had&&fp(L)!==fp(norm(remote)))||revId===null||V1RAW)await driveSave();return'pulled';}
    if(L&&L.seededAt){await driveSave();return'pushed';}
    return'none';
  }
  function afterOutsideChange(){try{runHooks('ledgerChanged','sync');}catch(_){}if(typeof renderAll==='function')renderAll();}
  // Loads the book once per sign-in (device cache, then Drive). Safe to call on every render.
  function ensureLedger(){
    if(BUSY)return BUSY;
    const me=owner();
    if(LFOR!==me){resetLedger();LFOR=me;}
    const needLocal=!LOCAL_DONE,needDrive=typeof accessToken!=='undefined'&&!!accessToken&&!DRIVE_TRIED&&!MIG_BLOCK;
    if(!needLocal&&!needDrive)return Promise.resolve(L);
    if(!L)STATUS='loading';
    const wasLive=!!live();
    BUSY=(async()=>{
      try{
        if(needLocal){LOCAL_DONE=true;const c=await cacheGet(me);
          if(c&&c.owner===me&&validLedger(c.ledger)&&c.ledger.seededAt){const y=intake(c.ledger,'device');if(y){L=L&&L.schema===SCHEMA?mergeLedgers(y,L):y;VER++;}}}
        if(needDrive&&!MIG_BLOCK){DRIVE_TRIED=true;try{await driveSync();if(!MIG_BLOCK)ERROR=null;}catch(e){ERROR=String(e&&e.message||e);}}
      }catch(e){ERROR=String(e&&e.message||e);}
      STATUS=BLOCKED||MIG_BLOCK?'error':live()?'ready':ERROR?'error':'none';BUSY=null;
      if(live()&&!wasLive)afterOutsideChange();
      return L;
    })();
    return BUSY;
  }
  function resetLedger(){clearTimeout(SAVE_T);SAVE_T=null;L=null;LFOR='';STATUS='idle';ERROR=null;BLOCKED=null;MIG_BLOCK=null;V1RAW=null;MIG_INFO=null;
    if(typeof hideBanner==='function'){hideBanner('ledgerfile');hideBanner('ledgermigrate');}LOCAL_DONE=false;DRIVE_TRIED=false;BUSY=null;fileId=null;revId=null;VER++;GATE=null;}

  function changed(o){
    o=o||{};L.updatedAt=now();VER++;cachePut();scheduleSave();
    try{runHooks('ledgerChanged',o.why||'');}catch(_){}
    if(!o.quiet&&typeof renderAll==='function')renderAll();
  }
  function need(){
    if(MIG_BLOCK)throw err('Your book could not be moved to the new format, so it is read-only');
    const x=live();if(!x)throw err('Your book is not set up yet');return x;
  }
  // Runs an operation on the live book; nothing changes when it throws.
  function run(why,fn,quiet){const x=need();const r=fn(x);VER++;changed({why,quiet});return r;}

  /* ── Imports (called by index.html after it accepted a file) ── */
  function goReview(){hideBanner('ledger');setTab('settings');setTimeout(()=>{const e=document.getElementById('set-book');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});},60);}
  function importIn(x,kind,data,from){
    let r;
    if(kind==='books')r=mergeBooks(x,data);
    else if(kind==='wealth')r=fillWealth(x,data,now());
    else if(kind==='cash')r=mergeCash(x,data,true);
    else return null;
    x.imports.push({at:now(),kind,generatedAt:iso(data.generatedAt),from:from||'',added:r.txns||r.market||r.new||0,new:r.new||0,refreshed:r.refreshed||0,
      changedPosted:r.changedPosted||0,differs:0,missing:0,linked:0,...(r.remapped?{remapped:r.remapped}:{})});
    return r;
  }
  async function ledgerOnImport(kind,data,from,quiet){
    try{
      await ensureLedger();
      const x=live();if(!x||MIG_BLOCK)return null;
      const r=importIn(x,kind,data,from);if(!r)return null;
      changed({why:'import'});
      if(kind==='books'&&(r.new||r.refreshed)){
        const bits=[r.new?`${r.new} new draft${r.new===1?'':'s'} from Accurate`:'',r.refreshed?`${r.refreshed} draft${r.refreshed===1?'':'s'} refreshed`:''].filter(Boolean);
        showBanner('ledger','info','info',bits.join(' · '),'Review',goReview);
      }
      return r;
    }catch(e){console.error('Ledger import failed',e);return null;}
  }
  // Same import, run on a file directly (tests and the real-data check; no copy is stored in STATE).
  function ledgerImport(kind,data){return run('import',x=>importIn(x,kind,data,'direct'),true);}

  /* ── Start my book: the standard chart (or the imported books' chart) + optional opening journal ── */
  function standardChart(){
    if(!STD)STD=fetch('data/standard-coa.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .then(d=>{if(!d||!Array.isArray(d.accounts)||!d.accounts.length)throw new Error('empty');return d.accounts;})
      .catch(e=>{STD=null;throw err('Couldn’t load the standard chart of accounts. Check your connection and try again.');});
    return STD.then(cp);
  }
  async function ledgerStart(o){
    o=o||{};await ensureLedger();
    if(MIG_BLOCK)throw err('Your book could not be moved to the new format, so it is read-only');
    if(live())throw err('Your book is already set up');
    if(!owner())throw err('Sign in first');
    if(STATUS==='error')throw err('Couldn’t check your Drive for a book. Try again when you’re online.');
    const x=emptyLedger(),t=now();
    if(o.chart==='from-books'){const b=o.books||seedInputs().b;if(!b||!Array.isArray(b.accounts))throw err('Import the books first');
      for(const a of b.accounts){const y=accFromBooks(a,t);y.postable=!y.isParent;y.archivedAt=null;y.chartVer=0;x.accounts[y.id]=y;}
      setBooksSource(x,b);}
    else{const std=o.std||await standardChart();for(const s of std)x.accounts[s.code]=accFromStd(s,t,0);
      if(x.accounts['3201']&&isPostable(x.accounts['3201']))x.settings.retainedEarnings='3201';}
    const op=o.opening||null;
    x.settings.firstMonth=op&&validDate(op.date)?op.date.slice(0,7):thisMonth();x.settings.at=t;
    x.seededAt=t;
    audit(x,'book','','start',{after:{chart:o.chart==='from-books'?'from-books':'standard',accounts:Object.keys(x.accounts).length}});
    let openingId=null;
    if(op)openingId=postIn(x,{date:op.date,description:op.description||'Opening balances',lines:op.lines},'opening',{why:'Opening balances'});   // throws before anything is kept
    L=x;LFOR=owner();STATUS='ready';ERROR=null;
    changed({why:'start'});
    return{ok:true,accounts:Object.keys(x.accounts).length,openingId};
  }

  /* ── Public API (contract docs/v4-books.md) ── */
  function ledgerValidate(v,o){const x=live();if(!x)return['Your book is not set up yet'];if(MIG_BLOCK)return['Your book is read-only'];return validateIn(x,v,o);}
  function ledgerPost(v,o){return run('post',x=>opPost(x,v,o));}
  function ledgerSaveDraft(v,o){return run('draft',x=>opSaveDraft(x,v,o));}
  function ledgerPostDraft(id,o){return run('post',x=>opPostDraft(x,id,o));}
  function ledgerPostDrafts(ids,o){
    return run('post',x=>{const list=ids==null?Object.values(x.vouchers).filter(v=>v&&v.status==='draft'&&(!o||!o.kind||kindOfV(v)===o.kind)).sort((p,q)=>cmp(p.date,q.date)||cmp(p.id,q.id)).map(v=>v.id):[].concat(ids);
      const posted=[],failed=[];for(const id of list){try{opPostDraft(x,id,o);posted.push(id);}catch(e){failed.push({id,errors:e.errors||[String(e.message||e)]});}}
      return{posted,failed};});
  }
  function ledgerDeleteDraft(id,why){return run('delete',x=>opDeleteDraft(x,id,why));}
  function ledgerCopy(id){return run('draft',x=>opCopy(x,id));}
  function ledgerEdit(id,v,why){return run('edit',x=>opEdit(x,id,v,why));}
  function ledgerVoid(id,why){const x=need();const r=voidIn(x,id,why,{});if(r){VER++;changed({why:'void'});}return r;}
  function ledgerAddAccount(acc){return run('account',x=>opAddAccount(x,acc));}
  function ledgerEditAccount(code,patch,why){return run('account',x=>opEditAccount(x,code,patch,why));}
  function ledgerArchiveAccount(code,why){const x=need();const r=opArchiveAccount(x,code,why);if(r){VER++;changed({why:'account'});}return r;}
  function ledgerSetRetainedEarnings(code){return run('settings',x=>opSetRetained(x,code));}
  function ledgerClosePeriod(M,reason){return run('period',x=>opClose(x,M,reason));}
  function ledgerReopenPeriod(M,reason){return run('period',x=>opReopen(x,M,reason));}
  function ledgerLockPeriod(M){return run('period',x=>opLock(x,M));}
  function ledgerUnlockPeriod(M,reason){return run('period',x=>opUnlock(x,M,reason));}
  function ledgerCloseChecklist(M,reason){return checklistIn(lx(),M,reason);}
  function ledgerPeriods(year){return periodsOf(lx(),year);}
  function ledgerPeriodState(M){const x=live();return x?periodState(x,M):'open';}
  function ledgerJournal(id){const x=live();const v=x&&x.vouchers[id];return v&&v.status!=='deleted'?cp(v):null;}
  function ledgerAudit(f){
    const x=live();if(!x)return[];f=f||{};
    return(x.audit||[]).filter(e=>e&&(!f.entity||e.entity===f.entity)&&(!f.ref||e.ref===String(f.ref))&&(!f.from||e.at>=f.from)&&(!f.to||e.at<=f.to+'~')).map(cp).reverse();
  }
  function ledgerSettings(){const x=live();return x?{...cp(x.settings),firstMonth:firstMonthOf(x)}:null;}
  async function ledgerRecodeProposal(){const x=lx();const std=await standardChart();return recodeProposal(x,std);}
  async function ledgerRecode(map,o){
    const x=need(),std=await standardChart(),r=recodeIn(x,map||{},std,o);
    if(!r.ok){const e=err(r.errors.length?r.errors:[`${r.diffs.length} difference${r.diffs.length===1?'':'s'} after re-coding; nothing changed`]);e.diffs=r.diffs.slice(0,DIFF_SHOWN);e.count=r.diffs.length;throw e;}
    L=r.x;VER++;changed({why:'recode'});return{changed:Object.keys(r.map).length,map:cp(r.map)};
  }
  function ledgerCodeMap(){const x=live();return x?codeMapOf(x):{};}
  function ledgerResolveCode(code){const x=live();return x?resolveIn(x,code):String(code);}
  function ledgerAccurateDrafts(){const v=ledgerView('journals');return v?v.filter(j=>j.status==='draft'&&j.kind==='accurate'):[];}
  function ledgerExport(){const x=live();if(!x)throw err('Your book is not set up yet');return cp(x);}
  // Merges a backup (or another copy) into the book: per entry, the newer change wins; nothing in
  // the book is replaced wholesale and nothing is removed. A /1 backup is migrated first.
  function ledgerMergeIn(obj,from){
    if(!validLedger(obj))throw err('That is not an ExpenseTrack book backup');
    if(MIG_BLOCK)throw err('Your book could not be moved to the new format, so it is read-only');
    const r=toV2(obj);if(!r.ok)throw err(`That backup couldn’t be moved to the new format (${r.diffs.length} differences)`);
    const cur=live(),base=cur||null;
    if(!base&&STATUS!=='none'&&STATUS!=='ready')throw err('Your book is still loading');
    const beforeV=base?Object.keys(base.vouchers).length:0,beforeA=base?Object.keys(base.accounts).length:0;
    L=base?mergeLedgers(r.x,base):r.x;
    if(!L.seededAt)L.seededAt=now();LFOR=owner();STATUS='ready';
    L.imports.push({at:now(),kind:'backup',generatedAt:iso(obj.updatedAt||obj.seededAt||now()),from:cut(from,40),added:Object.keys(L.vouchers).length-beforeV,new:0,differs:0,missing:0,linked:0});
    changed({why:'merge'});
    return{vouchers:Object.keys(L.vouchers).length-beforeV,accounts:Object.keys(L.accounts).length-beforeA};
  }
  function ledgerCounts(){
    const x=live();if(!x)return null;
    const vs=Object.values(x.vouchers).filter(Boolean),c=s=>vs.filter(v=>v.status===s).length;
    return{vouchers:c('posted'),posted:c('posted'),drafts:c('draft'),void:c('void'),accurateDrafts:vs.filter(v=>v.status==='draft'&&kindOfV(v)==='accurate').length,
      accounts:Object.keys(x.accounts).length,lines:Object.keys(x.cash.txns).length,statements:Object.keys(x.cash.statements).length,
      audit:(x.audit||[]).length,lastImport:x.imports.length?x.imports[x.imports.length-1]:null};
  }
  // True when the account came from Accurate's chart (so an account added in the app is not "pending").
  // A code of the current chart is looked up directly; only a code the chart no longer has (an old
  // code from before a re-code) goes through the re-code maps, so a reused old code can't mislead it.
  function ledgerInAccurate(code){const x=live();if(!x)return false;const k=String(code);const a=x.accounts[k]||x.accounts[resolveIn(x,k)];return!!(a&&a.origin==='accurate');}
  function ledgerMigration(){return MIG_INFO?cp(MIG_INFO):L&&L.migration?{status:'migrated',...cp(L.migration)}:{status:'none'};}

  /* ── Settings › Your book ── */
  const money=n=>`<span class="amt">${fmtIDR(n)}</span>`;
  const day=d=>d?fmtDayLong(new Date(d+'T00:00:00')):'—';
  const KIND_WORD={books:'books',wealth:'wealth snapshot',cash:'cash movements',backup:'backup','drive-files':'two book files in Drive merged'};
  function ledgerSettingsHTML(){
    const x=live(),cnt=ledgerCounts();
    const head=sub=>cardHead('book-open','Your book',sub);
    if(MIG_BLOCK){const m=MIG_BLOCK;
      return`<section class="card" id="set-book">${head('Kept in its own file in your private Drive app folder')}<div class="setting-row"><div><div class="li-title">Read-only: the book could not be moved to the new format</div><div class="li-sub">${m.count} difference${m.count===1?'':'s'} between your book and the moved copy, so nothing was changed and nothing is saved. Your old file is untouched.</div></div><span class="badge warn">Read-only</span></div>
        <div class="list">${m.diffs.map(d=>`<div class="list-item"><div class="li-body"><div class="li-title">${escH(d.month?monthLabel(d.month):d.what)}${d.account?` · ${escH(d.account)}`:''}</div><div class="li-sub">${escH(d.what)}: before ${money(d.was||0)} · after ${money(d.now||0)}</div></div></div>`).join('')}</div></section>`;}
    if(!x){
      const st=STATUS==='loading'||SEEDING;
      const body=st?`<div class="setting-row"><div><div class="li-title">Checking your book…</div><div class="li-sub">Looking on this device and in your Drive</div></div></div>`
        :`<div class="setting-row"><div><div class="li-title">Not set up yet</div><div class="li-sub">${STATUS==='error'?'Couldn’t check your Drive for a book. Try again when you’re online.':'Start your own book from the standard chart of accounts, with your opening balances as a journal if you like.'}</div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-primary" id="lgStartBtn" onclick="ledgerUi.startSheet()">${ic('plus')}Start my book</button></div></div>`;
      return`<section class="card" id="set-book">${head('Kept in its own file in your private Drive app folder')}${body}</section>`;
    }
    const li=cnt.lastImport,mg=x.migration,re=x.settings.retainedEarnings,ra=re&&x.accounts[re],rc=(x.recodes||[]).filter(r=>r&&r.count);
    let body=`<div class="setting-row"><div><div class="li-title">Set up ${escH(fmtDateTime(x.seededAt))}</div><div class="li-sub">${cnt.posted} posted journal${cnt.posted===1?'':'s'}${cnt.drafts?` · ${cnt.drafts} draft${cnt.drafts===1?'':'s'}`:''}${cnt.void?` · ${cnt.void} void`:''} · ${cnt.accounts} accounts · ${cnt.lines} statement line${cnt.lines===1?'':'s'}</div></div><span class="badge good">In use</span></div>
      <div class="setting-row"><div><div class="li-title">Retained earnings</div><div class="li-sub">${ra?`${escH(re)} ${escH(ra.name)}`:'Not picked yet (needed to close December; pick it in Books › Periods)'}</div></div></div>
      ${rc.length?`<div class="setting-row" id="lgChartRow"><div><div class="li-title">On the ERP chart</div><div class="li-sub">Moved ${escH(fmtDateTime(rc[rc.length-1].at))} · ${rc.reduce((s,r)=>s+r.count,0)} accounts got new codes; old codes are kept</div></div><span class="badge good">Done</span></div>`
        :`<div class="setting-row" id="lgChartRow"><div><div class="li-title">Move to the ERP chart</div><div class="li-sub">Your accounts get the ERP’s numbering (1000 Assets … 9000 Income tax). Balances don’t change.</div></div><button class="btn btn-secondary" id="lgRecodeBtn" onclick="ledgerUi.recodeSheet()">Move to the ERP chart</button></div>`}
      ${mg&&mg.from?`<div class="setting-row"><div><div class="li-title">Moved to the new book format</div><div class="li-sub">${escH(fmtDateTime(mg.at))} · ${mg.numbered||0} journals numbered${mg.backupAt?` · old file kept as ${BACKUP_FILE}`:''}</div></div></div>`:''}
      <div class="setting-row"><div><div class="li-title">Last import</div><div class="li-sub">${li?`${escH(KIND_WORD[li.kind]||li.kind)} · ${escH(fmtDateTime(li.at))}${li.new?` · ${li.new} new`:''}`:'None yet'}</div></div></div>`;
    const D=ledgerAccurateDrafts();
    if(!D.length)body+=`<p class="help">No drafts from Accurate. A new Accurate export only ever brings draft journals; nothing posts by itself.</p>`;
    else body+=`<div class="setting-row" id="lgDrafts"><div><div class="li-title">Drafts from Accurate (${D.length})</div><div class="li-sub">Not in your book until you post them</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-ghost" id="lgReview" onclick="ledgerUi.reviewDrafts()">Review in Journals</button><button class="btn btn-secondary" onclick="ledgerUi.postAll()">${ic('plus')}Post all</button></div></div>
      <div class="list">${D.slice(0,DIFF_SHOWN).map(p=>`<div class="list-item"><div class="li-body"><div class="li-title">${escH(p.description||p.refNo||'Journal')}</div><div class="li-sub">${day(p.date)}${p.refNo?` · ${escH(p.refNo)}`:''} · ${money(p.debit)}${p.errors&&p.errors.length?` · <span class="neg">${escH(p.errors[0])}</span>`:''}${p.twin?' · same as a posted journal':''}</div></div><button class="btn btn-ghost btn-sm" onclick="ledgerUi.post('${escAttr(p.id)}')">Post</button></div>`).join('')}</div>
      ${D.length>DIFF_SHOWN?`<p class="help">…and ${D.length-DIFF_SHOWN} more (Post all posts them too).</p>`:''}`;
    return`<section class="card" id="set-book">${head('The app’s own book, in its own file in your private Drive app folder. Accurate exports only bring drafts.')}${body}</section>`;
  }
  // Settings › Your book sheets (UX §11.10b, §11.10c): Start my book with optional opening balances,
  // and Move to the ERP chart. Everything they change goes through ledgerStart / ledgerRecode.
  const uiErr=e=>e&&e.errors&&e.errors.length?e.errors.join(' · '):String(e&&e.message||e);
  const rupiah=v=>{const n=String(v==null?'':v).replace(/[^\d]/g,'');return n?+n:0;};
  const KIND_NAME={asset:'Asset',liability:'Liability',equity:'Equity',income:'Income',expense:'Expense'};
  const ui={
    async start(chart){try{const r=await ledgerStart({chart});toast(`Your book is set up · ${r.accounts} accounts`);}catch(e){toast(e.errors&&e.errors[0]||e.message);}renderAll();},
    post(id){try{ledgerPostDraft(id);toast('Posted');}catch(e){toast(e.errors&&e.errors[0]||e.message);}},
    postAll(){const r=ledgerPostDrafts(null,{kind:'accurate'});toast(`${r.posted.length} posted${r.failed.length?` · ${r.failed.length} need fixing first`:''}`);if(!ledgerAccurateDrafts().length)hideBanner('ledger');},
    reviewDrafts(){if(typeof openJournals==='function')openJournals({status:'draft',jkind:'accurate'});},
    seed(){return ledgerSeed({quiet:false});},
    async startSheet(){
      const{b}=seedInputs();let std=null;
      try{std=await standardChart();}catch(e){if(!b){toast(uiErr(e));return null;}}
      const charts={standard:std?std.filter(a=>a.postable).map(a=>({code:a.code,name:a.name,kind:a.type})).sort((p,q)=>cmpCode(p.code,q.code)):null,
        'from-books':b?b.accounts.filter(a=>a&&!a.isParent).map(a=>({code:String(a.id),name:a.name,kind:a.kind})).sort((p,q)=>cmpCode(p.code,q.code)):null};
      let chart=std?'standard':'from-books';const lines=[{account:'',debit:'',credit:''},{account:'',debit:'',credit:''}];
      const body=`<div class="bk-form" id="lgStart">
        <div class="field"><span class="label">Chart of accounts</span>
          ${std?`<label class="check"><input type="radio" name="lgChart" value="standard" checked> The standard chart: the ERP’s numbering, 1000 Assets … 9000 Income tax</label>`:''}
          ${b?`<label class="check"><input type="radio" name="lgChart" value="from-books"${std?'':' checked'}> My imported chart (from the Accurate books file)</label>`:''}</div>
        <label class="check"><input type="checkbox" id="lgOpenOn"> Add opening balances (a journal on your start date)</label>
        <div id="lgOpen" class="bk-form" hidden>
          <div class="row2"><div class="field"><label class="label" for="lgOpDate">Date</label><input class="input" type="date" id="lgOpDate" value="${thisMonth()}-01"></div>
            <div class="field"><label class="label" for="lgOpDesc">Description</label><input class="input" id="lgOpDesc" value="Opening balances" autocomplete="off"></div></div>
          <div class="lg-lines" id="lgLines"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="lgAddLine">${ic('plus','s16')}Add line</button><button class="btn btn-ghost btn-sm" id="lgBalance" hidden></button></div>
          <div class="lg-tot" id="lgTot" role="status"></div>
          <p class="help" style="margin:0">What you own goes on the debit side, what you owe on the credit side; the difference is your opening equity.</p></div>
        <div class="help err" id="lgErr" role="alert" hidden></div></div>`;
      const s=openSheet({title:'Start my book',wide:true,body,foot:`<button class="btn btn-secondary" id="lgCancel">Cancel</button><button class="btn btn-primary" id="lgGo">Start my book</button>`});
      const q=id=>s.sheet.querySelector(id);
      const eqOf=()=>{const l=charts[chart]||[];return l.find(a=>a.code==='3101')||l.find(a=>a.kind==='equity')||null;};
      const opts=sel=>`<option value="">Choose an account…</option>${(charts[chart]||[]).map(a=>`<option value="${escH(a.code)}"${a.code===sel?' selected':''}>${escH(a.code)} · ${escH(a.name)}</option>`).join('')}`;
      const fmtIn=v=>{const n=rupiah(v);return n?fmtNum(n):'';};
      const filled=()=>lines.filter(l=>l.account||rupiah(l.debit)||rupiah(l.credit));
      const check=()=>{
        const on=q('#lgOpenOn').checked,go=q('#lgGo'),tot=q('#lgTot');let ok=true,msg='';
        if(on){const f=filled();let dr=0,cr=0;
          for(const l of f){const d=rupiah(l.debit),c=rupiah(l.credit);dr+=d;cr+=c;
            if(!l.account){ok=false;msg=msg||'Choose an account on every line';}else if(d&&c){ok=false;msg=msg||'A line has both a debit and a credit';}else if(!d&&!c){ok=false;msg=msg||'A line has no amount';}}
          if(f.length<2){ok=false;msg=msg||'Enter at least two lines';}
          if(dr!==cr){ok=false;msg=msg||`Off by Rp ${fmtNum(Math.abs(dr-cr))}`;}else if(!dr){ok=false;msg=msg||'Enter the amounts';}
          tot.innerHTML=`<span>Debits <span class="amt" id="lgDr" data-raw="${dr}">Rp ${fmtNum(dr)}</span></span><span>Credits <span class="amt" id="lgCr" data-raw="${cr}">Rp ${fmtNum(cr)}</span></span>${ok?'<span class="badge good" id="lgBal">Balanced</span>':`<span class="badge bad" id="lgBal">${escH(msg)}</span>`}`;}
        go.disabled=!ok;return ok;};
      const drawLines=()=>{q('#lgLines').innerHTML=lines.map((l,i)=>`<div class="lg-line" data-i="${i}"><select class="input" data-f="account" aria-label="Account ${i+1}">${opts(l.account)}</select>
          <input class="input" data-f="debit" inputmode="numeric" placeholder="Debit" aria-label="Debit ${i+1}" value="${escH(fmtIn(l.debit))}"><input class="input" data-f="credit" inputmode="numeric" placeholder="Credit" aria-label="Credit ${i+1}" value="${escH(fmtIn(l.credit))}">
          <button class="icon-btn" data-rm="${i}" aria-label="Remove line ${i+1}" ${lines.length<=2?'disabled':''}>${ic('x')}</button></div>`).join('');
        const eq=eqOf(),bb=q('#lgBalance');if(eq){bb.hidden=false;bb.textContent=`Put the difference on ${eq.code} ${eq.name}`;}else bb.hidden=true;check();};
      s.sheet.querySelectorAll('input[name="lgChart"]').forEach(r=>r.addEventListener('change',()=>{chart=r.value;for(const l of lines)if(!(charts[chart]||[]).some(a=>a.code===l.account))l.account='';drawLines();}));
      q('#lgOpenOn').addEventListener('change',e=>{q('#lgOpen').hidden=!e.target.checked;check();});
      q('#lgLines').addEventListener('input',e=>{const row=e.target.closest('.lg-line'),f=e.target.dataset.f;if(!row||!f)return;const l=lines[+row.dataset.i];l[f]=f==='account'?e.target.value:(rupiah(e.target.value)||'');check();});
      q('#lgLines').addEventListener('change',e=>{const row=e.target.closest('.lg-line'),f=e.target.dataset.f;if(!row||!f)return;if(f==='account'){lines[+row.dataset.i].account=e.target.value;check();}else e.target.value=fmtIn(e.target.value);});
      q('#lgLines').addEventListener('click',e=>{const b2=e.target.closest('[data-rm]');if(!b2||b2.disabled)return;lines.splice(+b2.dataset.rm,1);drawLines();});
      q('#lgAddLine').addEventListener('click',()=>{lines.push({account:'',debit:'',credit:''});drawLines();});
      q('#lgBalance').addEventListener('click',()=>{const eq=eqOf();if(!eq)return;let dr=0,cr=0;
        for(const l of lines){if(l.account===eq.code)continue;dr+=rupiah(l.debit);cr+=rupiah(l.credit);}
        let l=lines.find(y=>y.account===eq.code);
        if(!l){l=lines.find(y=>!y.account&&!rupiah(y.debit)&&!rupiah(y.credit));if(!l){l={};lines.push(l);}l.account=eq.code;}
        l.debit=cr>dr?cr-dr:'';l.credit=dr>cr?dr-cr:'';drawLines();});
      q('#lgCancel').addEventListener('click',()=>s.close(true));
      q('#lgGo').addEventListener('click',async()=>{
        if(!check())return;const on=q('#lgOpenOn').checked,er=q('#lgErr'),go=q('#lgGo');er.hidden=true;go.disabled=true;
        const opening=on?{date:q('#lgOpDate').value,description:q('#lgOpDesc').value.trim()||'Opening balances',
          lines:filled().map(l=>({account:l.account,debit:rupiah(l.debit),credit:rupiah(l.credit),memo:'Opening balance'}))}:null;
        try{const r=await ledgerStart({chart,...(opening?{opening}:{})});s.close(true);toast(`Your book is set up · ${r.accounts} accounts${r.openingId?' · opening balances posted':''}`);renderAll();}
        catch(e){er.innerHTML=`${ic('triangle-alert','s16')}<span>${escH(uiErr(e))}</span>`;er.hidden=false;go.disabled=false;}
      });
      drawLines();return s;
    },
    async recodeSheet(){
      let prop,std;
      try{[prop,std]=await Promise.all([ledgerRecodeProposal(),standardChart()]);}catch(e){toast(uiErr(e));return null;}
      const S=new Map(std.map(a=>[a.code,a])),val=new Map(prop.map(r=>[r.old,r.new]));
      const nCheck=prop.filter(r=>r.confidence==='low').length;
      const vOf=r=>String(val.get(r.old)==null?'':val.get(r.old)).trim();
      // The standard header a new code sits under (its type decides what may go there).
      const under=v=>{const m=/^(.+)\.(\d{2})$/.exec(v),sd=S.get(v),base=m&&S.get(m[1]);
        if(sd){const p=sd.parent&&S.get(sd.parent);return{t:sd.type,text:p?`Under ${p.code} ${p.name}`:`${sd.code} ${sd.name}`,hdr:!sd.postable};}
        if(base)return{t:base.type,text:`Under ${base.code} ${base.name}`,hdr:false};
        return{t:null,text:'Not a standard code; it sits at the top level',hdr:false};};
      const problem=r=>{const v=vOf(r);
        if(!v)return'Enter a new code';
        if(!/^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$/.test(v))return'Letters, digits and dots only, up to 20';
        if(!r.header&&prop.filter(y=>!y.header&&vOf(y)===v).length>1)return'Two accounts would get this code';
        const u=under(v);if(u.t&&u.t!==r.kind)return`That code is for ${KIND_NAME[u.t].toLowerCase()} accounts; this one is ${(KIND_NAME[r.kind]||r.kind).toLowerCase()}`;
        if(!r.header&&u.hdr)return'That is a header; pick a code under it';
        return'';};
      const rowHTML=r=>`<tr data-old="${escH(r.old)}" data-conf="${r.confidence}"><td class="bk-acc"><div class="merchant-name"><span class="bk-code">${escH(r.old)}</span>${escH(r.name)}</div><div class="merchant-sub"><span>${escH(KIND_NAME[r.kind]||r.kind)}${r.header?' · header':''}</span><span>${escH(r.reason||'')}</span></div></td>
        <td><input class="input" data-old="${escH(r.old)}" aria-label="New code for ${escH(r.old)}" value="${escH(r.new)}" autocomplete="off"><span class="help" data-help></span><span class="help err" data-err hidden></span></td>
        <td>${r.confidence==='low'?'<span class="badge warn">Check</span>':'<span class="badge good">Sure</span>'}</td></tr>`;
      const changes=()=>prop.filter(r=>vOf(r)!==r.old).length;
      const body=`<p class="muted" style="margin:0 0 12px">Your accounts get the ERP’s numbering (1000 Assets … 9000 Income tax). Balances don’t change. Old codes are kept, so Month-end and Accurate still match.</p>
        <div class="bk-chips" style="margin:0 0 12px" role="group" aria-label="Show"><button class="chip" data-only="all" aria-pressed="true">All (${prop.length})</button><button class="chip" data-only="check" aria-pressed="false">To check (${nCheck})</button></div>
        <div class="table-wrap"><table class="data lg-rc" id="lgRecode"><thead><tr><th scope="col">Account</th><th scope="col">New code</th><th scope="col"><span class="sr-only">Confidence</span></th></tr></thead><tbody>${prop.map(rowHTML).join('')}</tbody></table></div>
        <p class="help" id="lgRcCount" style="margin-top:8px"></p>
        <div id="lgRcErr" role="alert" hidden></div>`;
      const s=openSheet({title:'Move to the ERP chart',wide:true,body,foot:`<button class="btn btn-secondary" id="lgRcCancel">Cancel</button><button class="btn btn-primary" id="lgRcGo">Move my chart</button>`});
      const q=id=>s.sheet.querySelector(id);
      const refresh=()=>{let bad=0;
        for(const tr of s.sheet.querySelectorAll('#lgRecode tbody tr')){const r=prop.find(y=>y.old===tr.dataset.old);if(!r)continue;
          const p=problem(r),e=tr.querySelector('[data-err]'),h=tr.querySelector('[data-help]');
          e.hidden=!p;e.textContent=p;h.textContent=p?'':under(vOf(r)).text;if(p){tr.setAttribute('data-bad','1');bad++;}else tr.removeAttribute('data-bad');}
        const n=changes();q('#lgRcGo').disabled=!!bad||!n;
        q('#lgRcCount').textContent=bad?`${bad} code${bad===1?' needs':'s need'} fixing first`:n?`${n} account${n===1?'':'s'} will get a new code`:'Your chart already uses the ERP numbering; nothing to move';};
      q('#lgRecode').addEventListener('input',e=>{const o=e.target.dataset.old;if(o==null)return;val.set(o,e.target.value);refresh();});
      s.sheet.querySelectorAll('[data-only]').forEach(b=>b.addEventListener('click',()=>{const only=b.dataset.only;
        s.sheet.querySelectorAll('[data-only]').forEach(y=>y.setAttribute('aria-pressed',String(y===b)));
        s.sheet.querySelectorAll('#lgRecode tbody tr').forEach(tr=>{tr.hidden=only==='check'&&tr.dataset.conf!=='low';});}));
      q('#lgRcCancel').addEventListener('click',()=>s.close(true));
      q('#lgRcGo').addEventListener('click',async()=>{
        const map={};for(const r of prop){const v=vOf(r);if(v!==r.old)map[r.old]=v;}
        const go=q('#lgRcGo'),box=q('#lgRcErr');go.disabled=true;box.hidden=true;
        try{const r=await ledgerRecode(map);
          if(typeof remapStateCodes==='function'){try{remapStateCodes(ledgerCodeMap());}catch(e){console.error('remapStateCodes failed',e);}}
          s.close(true);toast(`${r.changed} accounts moved · balances unchanged`);renderAll();}
        catch(e){const d=e.diffs||[];
          box.innerHTML=`<div class="help err" style="margin-top:12px">${ic('triangle-alert','s16')}<span>Nothing was moved. ${escH(uiErr(e))}</span></div>
            ${d.length?`<div class="list" id="lgRcDiffs">${d.map(y=>`<div class="list-item"><div class="li-body"><div class="li-title">${escH(y.month?monthLabel(y.month):y.what)} · ${escH(y.account?`${y.account}${y.new&&y.new!==y.account?' → '+y.new:''}`:(KIND_NAME[y.kind]||y.kind||''))}</div><div class="li-sub">${escH(y.what)}: before ${money(y.was||0)} · after ${money(y.now||0)}</div></div></div>`).join('')}</div>${e.count>d.length?`<p class="help">…and ${e.count-d.length} more</p>`:''}`:''}`;
          box.hidden=false;go.disabled=false;}
      });
      refresh();return s;
    }
  };

  registerIcon('book-open','<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>');
  // Load the device copy (and Drive's) once someone is signed in, before the first render needs it.
  registerHook('beforeRender',()=>{if(owner()&&STATUS==='idle')ensureLedger();});

  const ops={post:opPost,saveDraft:opSaveDraft,postDraft:opPostDraft,deleteDraft:opDeleteDraft,copy:opCopy,edit:opEdit,void:voidIn,
    addAccount:opAddAccount,editAccount:opEditAccount,archiveAccount:opArchiveAccount,setRetainedEarnings:opSetRetained,
    close:opClose,reopen:opReopen,lock:opLock,unlock:opUnlock};
  Object.assign(window,{LEDGER:()=>live(),ledgerStatus:()=>BLOCKED||MIG_BLOCK?'error':live()?'ready':STATUS,ledgerBlocked:()=>BLOCKED||(MIG_BLOCK?'Your book could not be moved to the new format, so it is read-only':null),
    ledgerFindByRef:findByRef,ensureLedger,ledgerSeeded:()=>!!live(),ledgerView,
    ledgerValidate,ledgerWarnings:warningsOf,ledgerPost,ledgerSaveDraft,ledgerPostDraft,ledgerPostDrafts,ledgerDeleteDraft,ledgerCopy,ledgerEdit,ledgerVoid,ledgerJournal,
    ledgerAddAccount,ledgerEditAccount,ledgerArchiveAccount,ledgerSetRetainedEarnings,ledgerSettings,
    ledgerPeriods,ledgerPeriodState,ledgerCloseChecklist,ledgerClosePeriod,ledgerReopenPeriod,ledgerLockPeriod,ledgerUnlockPeriod,
    ledgerAudit,ledgerStart,ledgerStandardChart:standardChart,ledgerRecodeProposal,ledgerRecode,ledgerCodeMap,ledgerResolveCode,ledgerAccurateDrafts,ledgerMigration,
    ledgerExport,ledgerMergeIn,ledgerSeed,ledgerGate:()=>cp(GATE),ledgerOnImport,ledgerImport,ledgerFlush,ledgerCounts,
    ledgerInAccurate,ledgerCashIdRemap:cashIdRemap,ledgerRemapCashRefs:remapCashRefs,ledgerSettingsHTML,resetLedger,
    // Retired with v4 (the Accurate feed only brings drafts); kept so older callers don't break.
    ledgerPending:()=>[],ledgerAcceptPending:()=>0,ledgerFlags:()=>[],ledgerTakeAccurate:()=>false,ledgerDismissFlag:()=>false,ledgerAfterBooksLoad:()=>{},
    ledgerUi:ui,
    // Pure helpers on any ledger object (x null = the live book for the reports).
    ledgerLib:{tb:tbOf,gl:glOf,pl:plOf,bs:bsOf,validate:validateIn,warnings:warningsOf,periodState,firstMonth:firstMonthOf,periods:periodsOf,checklist:checklistIn,yearEndPlan,
      migrate:migrate1,migrationDiffs,toV2,recodeProposal,recode:recodeIn,codeMap:codeMapOf,resolveCode:resolveIn,leafFor,ops,
      healDuplicatePosts,renumberCollisions,applyRecodes,seedFrom,gateDiffs,mergeLedgers,mergeBooks,mergeCash,fillWealth,coreOf,wViewOf,booksViewOf,cashViewOf,journalsViewOf,
      sigOf,contentSig,emptyLedger,SCHEMA}});
})();
