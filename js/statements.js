/* ExpenseTrack v2 — Statements module.
   Owner: Statements builder (C). Adds no page: it extends built-in pages through hooks —
   txnBadges(tx), cardsHistory(cards), accountsExtraCol(acc), homeComingUp() — and the
   'transactions' transform, and keeps STATE.stmtFix / STATE.cardMap (docs/v2-interfaces.md §3, §6).

   Two jobs:
   1. Corrected spending. Email-alert transactions are checked against the bank and card statements
      in the cash file (STATE.cash). A matched alert takes the statement's rupiah amount, a charge
      that is only on the statement is added, and an alert missing from a closed statement goes to a
      review list. Matching is recomputed from the data every time (it is deterministic); only the
      owner's decisions (undo a fix, exclude/keep an alert, card links, manual sources) are stored.
   2. Statement calendar: last statement, learned cycle day, expected next statement, card due date
      and amount, and late / due-soon / manual-download / only-when-used flags for every statement
      account. "Expected" is arrival-aware: a statement is dated at its period end but reaches the
      owner a few days later (learned from `receivedAt`, else a default lag per kind).

   Loaded by index.html after the core script, in this fixed order: books, home, statements,
   extras. Everything here runs in the page's global scope, so keep it inside the function below
   and put only deliberate cross-module helpers on window (ETStatements). Contract:
   docs/v2-interfaces.md. No personal data in this file: the repo is public. */
(function(){
  'use strict';

  /* ── Dates (ISO 'YYYY-MM-DD' strings; day numbers are UTC so time zones never shift a day) ── */
  const DAY=86400000;
  const pad=n=>String(n).padStart(2,'0');
  const isoOf=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayISO=()=>isoOf(new Date());
  const ymd=iso=>String(iso).slice(0,10).split('-').map(Number);
  const dn=iso=>{const[y,m,d]=ymd(iso);return Math.round(Date.UTC(y,m-1,d)/DAY);};
  const isoFromDn=n=>{const d=new Date(n*DAY);return`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;};
  const addDays=(iso,n)=>isoFromDn(dn(iso)+n);
  const dim=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();           // days in month m (1-12)
  function addMonths(iso,k){const[y,m,d]=ymd(iso);const t=(y*12+(m-1))+k,Y=Math.floor(t/12),M=t%12+1;return`${Y}-${pad(M)}-${pad(Math.min(d,dim(Y,M)))}`;}
  const txISO=t=>{const d=txDateOf(t);return isNaN(d.getTime())?null:isoOf(d);};
  const dayLabel=iso=>iso?fmtDay(new Date(iso+'T00:00:00')):'—';
  const cmp=(a,b)=>a<b?-1:a>b?1:0;

  /* ── Statement arrival constants (the only place they live; see "Arrival-aware expected date") ── */
  const LAG_DEFAULT={bank:7,card:1,other:3};     // days from statement date to arrival; bank = account dated on a month end
  const LATE_GRACE=3, WINDOW_PERIODS=6, LAG_MAX=45;

  const live=v=>!!v&&typeof v==='object'&&!v.deleted;
  const gross=t=>t.splitInfo?t.splitInfo.originalAmount:t.amount;
  const isFX=t=>!!(t.currency&&t.currency!=='IDR');
  const typeOf=l=>typeof cashType==='function'?cashType(l):l.type;
  const groupOf=ty=>typeof cashMeta==='function'?cashMeta(ty).g:'out';

  /* ── Which statement account an email bank belongs to ──
     Auto: same bank name and kind (card alerts ↔ card statements, debit alerts ↔ bank accounts),
     rupiah only. STATE.cardMap[bank] overrides it: an account id, or '' for "not linked". */
  const BANK_KIND={'Maybank':'card','OCBC CC':'card','BCA':'account','OCBC':'account'};
  const kindOfBank=b=>BANK_KIND[b]||(/\bcc$/i.test(b)?'card':'account');
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const bankBase=b=>norm(String(b).replace(/\s*cc$/i,''));
  const accBase=a=>norm(String(a.id).split(':')[0].replace(/-(cc|account)$/i,''));
  function autoCandidates(bank,accounts){
    const k=kindOfBank(bank),b=bankBase(bank);
    return accounts.filter(a=>(a.kind||'account')===k&&(a.currency||'IDR')==='IDR'&&accBase(a)===b).map(a=>a.id).sort();
  }
  function linkFor(bank,accounts,cardMap){
    const m=(cardMap||{})[bank],c=autoCandidates(bank,accounts);
    if(m==='')return{link:null,auto:c,set:true};
    if(typeof m==='string'&&accounts.some(a=>a.id===m))return{link:m,auto:c,set:true};
    return{link:c.length===1?c[0]:null,auto:c,set:false,ambiguous:c.length>1};
  }

  // Email rows that take part: parsed card/debit alerts (not billing reminders, app notices or
  // manual entries) with a rupiah amount, or a foreign-currency alert.
  function eligible(t){
    return!!t&&!!t.id&&!t.stmtAdded&&t.type==='transaction'&&!!t.bank&&t.bank!=='Manual'&&!t.manual
      &&(isFX(t)?(t.amountOrig>0||gross(t)>0):(gross(t)||0)>0);
  }
  // A number in the statement line's text equal to the alert's foreign amount (for an FX alert
  // that has no rupiah estimate yet).
  function descHasAmount(desc,orig){
    if(!(orig>0))return false;
    for(const raw of String(desc||'').match(/\d[\d.,]*/g)||[]){
      let s=raw.replace(/[.,]$/,'');const i=Math.max(s.lastIndexOf('.'),s.lastIndexOf(','));
      if(i>=0&&s.length-i-1===2)s=s.slice(0,i).replace(/[.,]/g,'')+'.'+s.slice(i+1);else s=s.replace(/[.,]/g,'');
      if(Math.abs(parseFloat(s)-orig)<0.005)return true;
    }
    return false;
  }
  // null = not a candidate; otherwise the relative amount gap (0 = exact).
  function amountGap(t,x){
    if(!isFX(t))return Math.round(gross(t)||0)===Math.round(x.amt)?0:null;
    const est=gross(t);
    if(est>0){const g=Math.abs(x.amt-est)/x.amt;return g<=0.03?g:null;}
    return descHasAmount(x.l.desc,t.amountOrig)?0:null;
  }
  // Statement lines that count as spending when no alert matches them: money out, not a refund,
  // card payment, own transfer or investment (cash types, so the owner's re-tags apply).
  function chargeLine(l){const ty=typeOf(l);return l.amount<0&&ty!=='refund'&&groupOf(ty)==='out';}

  function periodsOf(cash,today){
    const per={};
    const sts=[...(cash.statements||[])].sort((a,b)=>cmp(a.date,b.date)||cmp(String(a.id),String(b.id)));
    for(const s of sts){
      const list=per[s.account]||(per[s.account]=[]),prev=list[list.length-1];
      const start=s.periodStart||(prev?addDays(prev.end,1):addDays(addMonths(s.date,-1),1));
      list.push({id:s.id||(s.account+'|'+s.date),account:s.account,start,end:s.date,s,closed:s.date<=today});
    }
    return per;
  }

  /* ── Reconcile: pure over (transactions, cash, decisions); returns what apply() changes ── */
  function reconcile(txns,o){
    o=o||{};
    const cash=o.cash,fix=o.fix||{},cardMap=o.cardMap||{},today=o.today||todayISO(),hs=o.historyStart||'0000-00-00';
    const R={today,banks:[],links:{},auto:{},ambiguous:{},setLinks:{},accounts:[],stmts:{},matches:[],added:[],review:[]};
    if(!cash||!Array.isArray(cash.accounts)||!Array.isArray(cash.statements))return R;
    const accounts=cash.accounts,accById=new Map(accounts.map(a=>[a.id,a]));
    const per=periodsOf(cash,today);
    const periodOf=(acc,iso)=>(per[acc]||[]).find(p=>p.start<=iso&&iso<=p.end)||null;
    const elig=(txns||[]).filter(eligible);
    R.banks=[...new Set(elig.map(t=>t.bank))].sort();
    const banksOf={};
    for(const b of R.banks){
      const L=linkFor(b,accounts,cardMap);
      R.links[b]=L.link;R.auto[b]=L.auto;R.setLinks[b]=L.set;if(L.ambiguous)R.ambiguous[b]=L.auto;
      if(L.link)(banksOf[L.link]||(banksOf[L.link]=[])).push(b);
    }
    const linesBy={};for(const l of cash.txns||[])(linesBy[l.account]||(linesBy[l.account]=[])).push(l);
    for(const accId of Object.keys(banksOf).sort()){
      const acc=accById.get(accId),card=acc.kind==='card',banks=banksOf[accId],P=per[accId]||[];
      if(!P.length)continue;
      R.accounts.push(accId);
      for(const p of P)if(p.end>=hs)R.stmts[p.id]={id:p.id,account:accId,label:acc.label||accId,kind:acc.kind||'account',
        start:p.start,end:p.end,closed:p.closed,dueDate:p.s.dueDate||null,minPayment:p.s.minPayment!=null?p.s.minPayment:null,
        closing:p.s.closing,charges:0,before:0,after:0,fixes:0,diffs:0,matched:0,exact:0,pending:0};
      // Transfers are never card charges (e.g. app transfers parsed from the same bank's mail).
      const E=elig.filter(t=>banks.includes(t.bank)&&!(card&&t.category==='Transfer')).map(t=>({t,key:t.id,iso:txISO(t)})).filter(e=>e.iso);
      const L=(linesBy[accId]||[]).filter(l=>l.amount<0&&(l.currency||'IDR')==='IDR'&&l.date>=hs)
        .map(l=>({l,p:periodOf(accId,l.date),amt:-l.amount,d:dn(l.date)})).filter(x=>x.p);
      const Lby=new Map(L.map(x=>[x.l.id,x])),Eby=new Map(E.map(e=>[e.key,e]));
      const usedE=new Set(),usedL=new Set();
      // An undone fix keeps its pair, so the line is neither re-matched nor added.
      for(const[key,v]of Object.entries(fix.match||{}).sort((a,b)=>cmp(a[0],b[0]))){
        if(!live(v)||!v.off)continue;const e=Eby.get(key),x=Lby.get(v.line);
        if(!e||!x||usedE.has(key)||usedL.has(x.l.id))continue;
        usedE.add(key);usedL.add(x.l.id);R.matches.push({key,t:e.t,line:x.l,stmtId:x.p.id,account:accId,amount:x.amt,orig:gross(e.t),off:true});
      }
      const byDay=new Map();for(const x of L){if(usedL.has(x.l.id))continue;(byDay.get(x.d)||byDay.set(x.d,[]).get(x.d)).push(x);}
      const pairs=[];
      for(const e of E){
        if(usedE.has(e.key))continue;const ed=dn(e.iso);
        for(let d=ed-3;d<=ed+3;d++)for(const x of byDay.get(d)||[]){const g=amountGap(e.t,x);if(g!=null)pairs.push({e,x,gap:Math.abs(ed-d),g});}
      }
      // One-to-one, greedy: smallest date gap first, then amount gap, then ids (deterministic).
      pairs.sort((a,b)=>a.gap-b.gap||a.g-b.g||cmp(a.e.key,b.e.key)||cmp(a.x.l.id,b.x.l.id));
      for(const p of pairs){
        if(usedE.has(p.e.key)||usedL.has(p.x.l.id))continue;usedE.add(p.e.key);usedL.add(p.x.l.id);
        R.matches.push({key:p.e.key,t:p.e.t,line:p.x.l,stmtId:p.x.p.id,account:accId,amount:p.x.amt,orig:gross(p.e.t),off:false});
      }
      // Alerts missing from a closed statement. An alert in the last 3 days of the newest closed
      // statement may still post on the next one, so it waits for that statement.
      const closed=P.filter(p=>p.closed),lastClosed=closed.length?closed[closed.length-1]:null;
      for(const e of E){
        if(usedE.has(e.key)||!lastClosed||e.iso<P[0].start||e.iso<hs||dn(e.iso)+3>dn(lastClosed.end))continue;
        const p=periodOf(accId,e.iso),dv=(fix.review||{})[e.key];
        R.review.push({key:e.key,t:e.t,account:accId,stmtId:(p||lastClosed).id,orig:gross(e.t),decision:live(dv)&&(dv.decision==='exclude'||dv.decision==='keep')?dv.decision:null});
      }
      // Charges only on the statement.
      for(const x of L){
        if(usedL.has(x.l.id)||!x.p.closed||!chargeLine(x.l))continue;
        const av=(fix.added||{})[x.l.id];
        R.added.push({line:x.l,stmtId:x.p.id,account:accId,bank:banks[0],amount:x.amt,type:typeOf(x.l),excluded:!!(live(av)&&av.excluded)});
      }
      // Per statement: the statement's charges against the alerts, before and after the fixes.
      for(const x of L){const st=R.stmts[x.p.id];if(st&&(usedL.has(x.l.id)||chargeLine(x.l)))st.charges+=x.amt;}
    }
    for(const m of R.matches){
      const st=R.stmts[m.stmtId];if(!st)continue;const o0=m.orig||0,same=Math.round(o0)===Math.round(m.amount);
      st.matched++;st.before+=o0;
      if(m.off){st.after+=o0;if(!same)st.diffs++;}
      else{st.after+=m.t.splitInfo?o0:m.amount;if(same)st.exact++;else st.fixes++;}
    }
    for(const a of R.added){const st=R.stmts[a.stmtId];if(!st)continue;if(a.excluded)st.diffs++;else{st.after+=a.amount;st.fixes++;}}
    for(const r of R.review){
      const st=R.stmts[r.stmtId];if(!st)continue;const o0=r.orig||0;st.before+=o0;
      if(r.decision==='exclude')st.fixes++;else{st.after+=o0;st.diffs++;if(!r.decision)st.pending++;}
    }
    for(const st of Object.values(R.stmts)){
      if(!st.diffs&&Math.round(st.after)!==Math.round(st.charges))st.diffs=1;   // e.g. a split row matched
      st.status=st.diffs?'diff':'reconciled';
    }
    return R;
  }

  /* ── Apply / strip. Corrections live on the transaction objects (tx.stmt keeps the original).
     The cache never holds them (core saveCache runs unapply on a copy of every row), but a re-run
     on the live list after a decision does, so every run first strips the previous run's changes. ── */
  // One row back to the alert as it was before apply(): null for an added row. Changes `t` itself.
  function unapply(t){
    if(!t||t.stmtAdded)return null;
    const s=t.stmt;
    if(s){if(Object.prototype.hasOwnProperty.call(s,'set')&&t.amount===s.set)t.amount=s.orig;delete t.stmt;}
    return t;
  }
  function strip(list){return(list||[]).map(unapply).filter(Boolean);}
  function addedTx(a){
    const l=a.line,name=String(l.counterparty||l.desc||'Statement charge').replace(/\s+/g,' ').trim(),at=l.date+'T12:00:00';
    const clean=typeof cleanMerchant==='function'?cleanMerchant(name):name;
    return{id:'stmt:'+l.id,merchantRaw:String(l.desc||name),merchantClean:clean,
      category:a.type==='transfer-out'?'Transfer':(typeof categorize==='function'?categorize(l.counterparty||l.desc):'Others'),
      bank:a.bank,amount:a.amount,amountStr:'IDR '+fmtNum(a.amount),status:'Approved',txDate:at,msgDate:at,type:'transaction',
      stmtAdded:true,stmt:{kind:'added',line:l.id,stmtId:a.stmtId,account:a.account,cashType:a.type}};
  }
  function apply(R,txns){
    for(const m of R.matches){
      const t=m.t;
      if(m.off){t.stmt={kind:'off',line:m.line.id,stmtId:m.stmtId,account:m.account,stmtAmount:m.amount};continue;}
      const orig=t.amount,set=t.splitInfo?orig:m.amount;
      t.stmt={kind:'match',line:m.line.id,stmtId:m.stmtId,account:m.account,stmtAmount:m.amount,orig,set};t.amount=set;
    }
    for(const r of R.review){
      const t=r.t;
      if(r.decision==='exclude'){t.stmt={kind:'excluded',stmtId:r.stmtId,account:r.account,orig:t.amount,set:0};t.amount=0;}
      else t.stmt={kind:r.decision==='keep'?'kept':'review',stmtId:r.stmtId,account:r.account};
    }
    const add=R.added.filter(a=>!a.excluded).map(addedTx);
    // The owner's own rules and edits apply to added rows exactly as to email rows (keyed by id).
    for(const fn of['applyDateCategoryRules','applyMerchantCats','applyCatOverrides','applySubDecisions','applyNotes','applyMerchantAutoNotes','applyTxEdits','applySplits'])
      if(typeof window[fn]==='function')try{window[fn](add);}catch(e){console.error('Statements: '+fn+' failed',e);}
    return txns.concat(add);
  }

  let LAST=reconcile([],{}),SIG=null;
  const opts=()=>({cash:CM(),fix:STATE.stmtFix||{},cardMap:STATE.cardMap||{},today:todayISO(),historyStart:typeof HISTORY_START==='string'?HISTORY_START:''});
  const sig=()=>{const c=CM();return[c?`${c.generatedAt}#${(c.txns||[]).length}#${(c.statements||[]).length}`:'',
    JSON.stringify(STATE.stmtFix||{}),JSON.stringify(STATE.cardMap||{}),JSON.stringify(STATE.cashTypeOverrides||{}),
    JSON.stringify(STATE.cashPayerRules||{}),todayISO()].join('|');};
  function run(list){const base=strip(list);LAST=reconcile(base,opts());const out=apply(LAST,base);SIG=sig();CAL=null;return out;}

  registerTransform('transactions',run,unapply);

  // Re-run on the live lists after a decision, a new cash file, a re-tag or a merged Drive state.
  function refresh(){
    const hidden=getHidden();
    const raw=run(ALL_TRANSACTIONS_RAW);
    const added=raw.filter(t=>t.stmtAdded&&!hidden.has(t.id));
    ALL_TRANSACTIONS_RAW=raw;
    ALL_TRANSACTIONS=ALL_TRANSACTIONS.filter(t=>!t.stmtAdded).concat(added).sort(sortByDateDesc);
  }
  // Inputs can change without a reload (cash import, Drive merge), so check before each render.
  registerHook('beforeRender',()=>{if(DATA_READY&&SIG!==sig())refresh();});

  /* ── Decisions (STATE.stmtFix; dated entries, removals are dated tombstones) ── */
  const fixMap=sub=>{const f=STATE.stmtFix||(STATE.stmtFix={});return f[sub]||(f[sub]={});};
  const stamp=()=>new Date().toISOString();
  function put(sub,key,val){fixMap(sub)[key]={...val,at:stamp()};}
  function snapshot(entries){return entries.map(([sub,key])=>[sub,key,fixMap(sub)[key]]);}
  function restore(snap){for(const[sub,key,v]of snap)put(sub,key,live(v)?{...v}:{deleted:true});commit();}
  function commit(msg,snap){
    scheduleDriveSave();refresh();renderAll();updateSheet();
    if(msg)toast(msg,snap?{action:'Undo',onAction:()=>restore(snap)}:undefined);
  }
  const findMatch=key=>LAST.matches.find(m=>m.key===key);
  const API={
    undoMatch(key){const m=findMatch(key);if(!m)return;const s=snapshot([['match',key]]);
      put('match',key,{stmtId:m.stmtId,line:m.line.id,amount:m.amount,off:true});commit('Back to the alert amount',s);},
    redoMatch(key){const s=snapshot([['match',key]]);put('match',key,{deleted:true});commit('Statement amount used',s);},
    removeAdded(id){const a=LAST.added.find(x=>x.line.id===id);if(!a)return;const s=snapshot([['added',id]]);
      put('added',id,{stmtId:a.stmtId,excluded:true});commit('Removed from your spending',s);},
    restoreAdded(id){const s=snapshot([['added',id]]);put('added',id,{deleted:true});commit('Added back from the statement',s);},
    decide(key,decision){const s=snapshot([['review',key]]);
      if(decision==='exclude'||decision==='keep')put('review',key,{decision});else put('review',key,{deleted:true});
      commit(decision==='exclude'?'Excluded from your totals':decision==='keep'?'Kept in your totals':'Back in the review list',s);},
    undoAll(stmtId){
      const ms=LAST.matches.filter(m=>m.stmtId===stmtId&&!m.off&&Math.round(m.orig||0)!==Math.round(m.amount));
      const as=LAST.added.filter(a=>a.stmtId===stmtId&&!a.excluded),rs=LAST.review.filter(r=>r.stmtId===stmtId&&r.decision==='exclude');
      if(!ms.length&&!as.length&&!rs.length)return;
      const s=snapshot([...ms.map(m=>['match',m.key]),...as.map(a=>['added',a.line.id]),...rs.map(r=>['review',r.key])]);
      for(const m of ms)put('match',m.key,{stmtId:m.stmtId,line:m.line.id,amount:m.amount,off:true});
      for(const a of as)put('added',a.line.id,{stmtId:a.stmtId,excluded:true});
      for(const r of rs)put('review',r.key,{deleted:true});
      commit('Fixes for this statement undone',s);},
    reapplyAll(stmtId){
      const ms=LAST.matches.filter(m=>m.stmtId===stmtId&&m.off),as=LAST.added.filter(a=>a.stmtId===stmtId&&a.excluded);
      if(!ms.length&&!as.length)return;
      const s=snapshot([...ms.map(m=>['match',m.key]),...as.map(a=>['added',a.line.id])]);
      for(const m of ms)put('match',m.key,{deleted:true});for(const a of as)put('added',a.line.id,{deleted:true});
      commit('Statement fixes applied again',s);},
    setLink(bank,v){STATE.cardMap=STATE.cardMap||{};STATE.cardMap[bank]=v==='__none'?'':v;
      commit(v==='__none'?`${bank} alerts are no longer checked against a statement`:`${bank} alerts now checked against ${accLabel(v)}`);},
    setManual(id,on){put('manual',id,on?{on:true}:{deleted:true});commit(on?'Download reminder on':'Download reminder off');},
    setWhenUsed(id,on){put('whenUsed',id,on?{on:true}:{deleted:true});commit(on?'Marked as only sending a statement when used':'Back to a statement every month');},
    openStmt,
    // For tests and other modules (read-only).
    reconcile,strip,unapply,apply,calendar,calendarRows:()=>calRows(),cycleDay,expectedNext,comingUp,LAG_DEFAULT,LATE_GRACE,WINDOW_PERIODS,last:()=>LAST,refresh,
  };
  window.ETStatements=API;

  const accLabel=id=>{const c=CM(),a=c&&c.accounts.find(x=>x.id===id);return a?(a.label||a.id):String(id||'');};

  /* ── Statement calendar ── */
  // Cycle day = median day of month of past statements; a statement on a month's last day counts
  // as 31 ("end of month"), so the next one clamps to 30 / 28 / 29.
  function cycleDay(dates){
    const v=(dates||[]).map(iso=>{const[y,m,d]=ymd(iso);return d===dim(y,m)?31:d;}).sort((a,b)=>a-b);
    return v.length?v[Math.floor((v.length-1)/2)]:null;
  }
  function expectedNext(last,cd){const[y,m]=ymd(last),t=y*12+m,Y=Math.floor(t/12),M=t%12+1;return`${Y}-${pad(M)}-${pad(Math.min(cd,dim(Y,M)))}`;}
  const MON={jan:1,feb:2,mar:3,apr:4,may:5,mei:5,jun:6,jul:7,aug:8,agu:8,agt:8,sep:9,oct:10,okt:10,nov:11,dec:12,des:12};
  function looseDate(s){
    s=String(s||'').trim();let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return`${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    m=s.match(/^(\d{1,2})[-/ .](\d{1,2}|[A-Za-z]{3,})[-/ .](\d{2,4})/);if(!m)return null;
    const mo=/^\d+$/.test(m[2])?+m[2]:MON[m[2].slice(0,3).toLowerCase()];let y=+m[3];if(y<100)y+=2000;
    return mo>=1&&mo<=12&&+m[1]>=1&&+m[1]<=dim(y,mo)?`${y}-${pad(mo)}-${pad(+m[1])}`:null;
  }
  // Rupiah owed on a card statement. Cards tie as opening − lines = closing (the Bank Statements
  // pipeline), so a positive closing is owed and a negative one is in credit (core cardOwed).
  function owedOf(p){const c=p.s.closing;return c==null?null:cardOwed(c);}

  /* ── Was a card's due paid? A card's own payment line only arrives with its NEXT statement, so the
     evidence is on the bank side: bank-account lines typed card-payment between the card statement
     date and the due date + PAY_GRACE days. A bank line belongs to a card when its text carries the
     card's last four digits; else when its amount is that card's due amount or minimum; else when
     its text names the card's bank and only one card of that bank is due. Without bank statements
     covering the due date + grace (every bank account that pays cards), the payment is
     "not confirmed yet" — never "overdue". ── */
  const PAY_GRACE=3;
  const last4=id=>{const m=String(id).match(/(\d{4})(?!.*\d{4})/);return m?m[1]:null;};
  const srcBase=a=>norm(String(a.source||String(a.id).split(':')[0]).replace(/-?(cc|account)$/i,''));
  function bankPayments(cash,cards,today){
    const accById=new Map(cash.accounts.map(a=>[a.id,a])),isBank=id=>{const a=accById.get(id);return!!a&&(a.kind||'account')==='account';};
    const payLines=(cash.txns||[]).filter(l=>isBank(l.account)&&l.amount<0&&typeOf(l)==='card-payment');
    // Bank accounts that pay cards (all bank accounts when none has yet) and how far their statements go.
    const payers=new Set(payLines.map(l=>l.account)),banks=cash.accounts.filter(a=>(a.kind||'account')==='account'&&(!payers.size||payers.has(a.id)));
    const upTo=new Map();for(const st of cash.statements||[])if(banks.some(b=>b.id===st.account)&&(!upTo.has(st.account)||st.date>upTo.get(st.account)))upTo.set(st.account,st.date);
    const coveredTo=banks.length&&banks.every(b=>upTo.has(b.id))?banks.map(b=>upTo.get(b.id)).sort()[0]:null;
    const got=new Map(cards.map(c=>[c.a.id,{amount:0,lines:[]}]));
    for(const l of payLines){
      const amt=-l.amount,txt=String(l.desc||'')+' '+String(l.counterparty||''),digits=txt.replace(/\D/g,' '),nt=norm(txt);
      const inWin=cards.filter(c=>c.last<l.date&&l.date<=addDays(c.due.date,PAY_GRACE));
      let to=inWin.filter(c=>c.l4&&new RegExp('(^|\\D)'+c.l4+'(\\D|$)').test(digits));
      if(!to.length)to=inWin.filter(c=>[c.due.amount,c.due.min].some(v=>v!=null&&v>0&&Math.abs(v-amt)<1));
      // The paying account's own bank name in its text says nothing about which card was paid.
      if(!to.length){const own=srcBase(accById.get(l.account)),byName=inWin.filter(c=>c.base&&c.base!==own&&nt.includes(c.base));if(byName.length===1)to=byName;}
      if(to.length===1){const g=got.get(to[0].a.id);g.amount+=amt;g.lines.push(l.id);}
    }
    return{got,coveredTo};
  }
  /* ── Arrival-aware expected date ──
     A statement is dated at its period end but arrives later: bank-account statements about a week
     after a month-end, card statements about a day after theirs. Expected ARRIVAL = expected statement
     date + the account's lag. Lag = median(receivedAt − statement date) when the history carries
     receivedAt, else the default for the account kind (all constants here, nowhere else). When the
     history varies, the expectation is a window (earliest–latest over the last WINDOW_PERIODS
     periods), and a statement is late only LATE_GRACE days after the window ends. */
  const defaultLag=(kind,cd)=>kind==='card'?LAG_DEFAULT.card:kind==='account'&&cd===31?LAG_DEFAULT.bank:LAG_DEFAULT.other;
  const validIso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v);
  const lagOf=p=>{const r=p.s&&p.s.receivedAt;if(!validIso(r))return null;const v=dn(r)-dn(p.end);return v>=0&&v<=LAG_MAX?v:null;};
  function median(v){const a=[...v].sort((x,y)=>x-y),n=a.length;return n%2?a[(n-1)/2]:Math.round((a[n/2-1]+a[n/2])/2);}
  const nominalDay=iso=>{const[y,m,d]=ymd(iso);return d===dim(y,m)?31:d;};
  const dateIn=(y,m,day)=>`${y}-${pad(m)}-${pad(Math.min(day,dim(y,m)))}`;
  // Expected arrival window for the statement dated `stmtDate`, from the account's last periods.
  function arrivalFor(P,kind,cd,stmtDate){
    const got=P.map(lagOf).filter(v=>v!=null),learned=got.length>0,lag=learned?median(got):defaultLag(kind,cd);
    const[y,m]=ymd(stmtDate);let from=addDays(stmtDate,lag),to=from;
    for(const p of P.slice(-WINDOW_PERIODS)){
      const l=lagOf(p),a=addDays(dateIn(y,m,nominalDay(p.end)),l!=null?l:lag);
      if(a<from)from=a;if(a>to)to=a;}
    return{from,to,lag,learned,n:got.length,fixed:from===to};
  }
  const monthsBetween=(a,b)=>{const[ya,ma]=ymd(a),[yb,mb]=ymd(b);return(yb*12+mb)-(ya*12+ma);};
  // Two or more gaps of 2+ cycles between statements (the stretch up to now counts as one): a hint
  // that the account only sends a statement in months it was used. Never switched on automatically.
  function looksWhenUsed(P,today,lag){
    let gaps=0;for(let i=1;i<P.length;i++)if(monthsBetween(P[i-1].end,P[i].end)>=2)gaps++;
    if(monthsBetween(P[P.length-1].end,addDays(today,-(lag+LATE_GRACE)))>=2)gaps++;
    return gaps>=2;
  }
  const MONTH_NAME=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function rangeText(from,to,today){
    const[y1,m1,d1]=ymd(from),[y2,m2,d2]=ymd(to),yr=y=>y!==ymd(today)[0]?' '+y:'';
    if(from===to)return`${d1} ${MONTH_NAME[m1-1]}${yr(y1)}`;
    if(y1===y2&&m1===m2)return`${d1}–${d2} ${MONTH_NAME[m1-1]}${yr(y1)}`;
    return`${d1} ${MONTH_NAME[m1-1]}${yr(y1)} – ${d2} ${MONTH_NAME[m2-1]}${yr(y2)}`;
  }
  const roughText=(iso,today)=>{const[y,m,d]=ymd(iso);return`${d<=10?'early':d<=20?'mid':'late'} ${MONTH_NAME[m-1]}${y!==ymd(today)[0]?' '+y:''}`;};
  // The wording used wherever the next statement is shown (the caller adds "Next").
  function nextTextOf(r,today){
    if(r.whenUsed)return`~${rangeText(r.arrival.from,r.arrival.to,today)}, only if the ${r.kind==='card'?'card':'account'} was used`;
    if(r.manual)return`${roughText(r.arrival.from,today)} · you download this from the bank’s app`;
    return`~${rangeText(r.arrival.from,r.arrival.to,today)}`;
  }
  const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
  function reasonOf(r){
    const a=r.arrival,days=plural(a.lag,'day');
    const base=a.learned?`Arrival learned from ${plural(a.n,'statement')}: about ${days} after the statement date`
      :`No arrival dates on file yet: assuming ${days} after the statement date`;
    const spread=a.fixed?'':` · window from the last ${Math.min(r.statements,WINDOW_PERIODS)} statements`;
    const tail=r.whenUsed?' · only sends a statement in months it was used, so never flagged late'
      :r.manual?' · you download this one yourself'
      :` · flagged late ${LATE_GRACE} days after the window`;
    return base+spread+tail;
  }
  function calendar(o){
    o=o||{};const cash=o.cash,today=o.today||todayISO(),fix=o.fix||{},rows=[];
    if(!cash||!Array.isArray(cash.accounts)||!Array.isArray(cash.statements))return rows;
    const per=periodsOf(cash,today),lines=cash.txns||[],man=fix.manual||{},wu=fix.whenUsed||{};
    const base=[];
    for(const a of cash.accounts){
      const P=per[a.id]||[];if(!P.length)continue;
      const lastP=P[P.length-1],last=lastP.end;
      let due=null;
      if(a.kind==='card'){
        if(lastP.s.dueDate)due={date:lastP.s.dueDate,amount:owedOf(lastP),min:lastP.s.minPayment!=null?lastP.s.minPayment:null,from:'statement'};
        else{const b=(o.billing||[]).filter(x=>x.account===a.id&&x.date&&x.date>last).sort((x,y)=>cmp(y.date,x.date))[0];
          if(b)due={date:b.date,amount:null,min:null,from:'email'};}
      }
      base.push({a,P,lastP,last,due,l4:last4(a.id),base:srcBase(a)});
    }
    const bp=bankPayments(cash,base.filter(x=>x.due),today);
    for(const{a,P,last,due}of base){
      const cd=cycleDay(P.map(p=>p.end)),kind=a.kind||'account',tn=dn(today);
      let expected=expectedNext(last,cd),arrival=arrivalFor(P,kind,cd,expected);
      const manual=live(man[a.id])&&!!man[a.id].on,whenUsed=live(wu[a.id])&&!!wu[a.id].on;
      // An account that only sends a statement in months it was used: look ahead to the next cycle
      // that can still arrive instead of the next one in line.
      if(whenUsed)for(let i=0;i<36&&dn(arrival.to)<tn;i++){expected=expectedNext(expected,cd);arrival=arrivalFor(P,kind,cd,expected);}
      let paid=false,overdue=false,unconfirmed=false,payment=null;
      if(due){
        // The card's own payment lines after the statement (if the file already has them) also count.
        const own=lines.filter(l=>l.account===a.id&&l.amount>0&&l.date>last&&typeOf(l)==='card-payment').reduce((s,l)=>s+l.amount,0);
        const bank=bp.got.get(a.id)||{amount:0,lines:[]},pay=own+bank.amount;
        const need=due.min!=null?due.min:due.amount;
        paid=due.amount===0||(need!=null&&need>0&&pay>=need)||(need==null&&pay>0);
        payment={amount:pay,lines:bank.lines,from:bank.amount?'bank':own?'card':null};
        if(!paid&&due.date<today){
          const covered=!!bp.coveredTo&&bp.coveredTo>=addDays(due.date,PAY_GRACE);
          if(covered)overdue=true;else unconfirmed=true;
        }
      }
      const late=!whenUsed&&tn>dn(arrival.to)+LATE_GRACE,dueIn=due?dn(due.date)-tn:null;
      const status=overdue?'overdue':manual&&!whenUsed&&tn>=dn(expected)?'manual':late?'late':due&&!paid&&dueIn>=0&&dueIn<=7?'due-soon':unconfirmed?'unconfirmed':whenUsed?'when-used':'on-time';
      // pay: the card payment's own state, whatever the statement timing says (status may be 'late').
      const pay=!due?null:due.amount===0?'nothing-owed':paid?'paid':overdue?'overdue':unconfirmed?'unconfirmed':'due';
      const row={id:a.id,label:a.label||a.id,kind,last,cycleDay:cd,expected,arrival,statements:P.length,due,paid,overdue,unconfirmed,payment,pay,manual,whenUsed,
        suggestWhenUsed:!whenUsed&&looksWhenUsed(P,today,arrival.lag),status,dueIn,
        daysLate:late?tn-dn(arrival.to):0,minPayment:due?due.min:null};
      row.nextText=nextTextOf(row,today);row.reason=reasonOf(row);
      rows.push(row);
    }
    return rows.sort((x,y)=>cmp(x.kind==='card'?1:0,y.kind==='card'?1:0)||cmp(x.label,y.label));
  }
  // Home "Coming up": the next 14 days, plus what is already overdue.
  const KIND_ORDER={missing:0,manual:1,due:2,statement:3};
  const mk=(r,date,kind,label,amount)=>{const x={date,kind,account:r.label,accountId:r.id,label};if(amount!=null)x.amount=amount;return x;};
  function comingUp(rows,today){
    today=today||todayISO();const tn=dn(today),end=tn+14,out=[];
    for(const r of rows||[]){
      const e=dn(r.expected),w=r.arrival||{from:r.expected,to:r.expected},wf=dn(w.from),wt=dn(w.to);
      const it=(date,kind,label,amount,extra)=>{const x={date,kind,account:r.label,accountId:r.id,label,...(extra||{})};if(amount!=null)x.amount=amount;out.push(x);};
      // An account that only sends a statement in months it was used has nothing to chase; a due date still shows below.
      if(r.whenUsed){/* nothing to expect */}
      else if(r.manual){if(e<=end)it(r.expected,'manual',`Download the ${r.label} statement`);}
      else if(tn>wt+LATE_GRACE)it(w.to,'missing',`${r.label} statement is late`);
      else if(wf<=end)it(wf>tn?w.from:today,'statement',`${r.label} statement expected`,null,{window:rangeText(w.from,w.to,today),until:w.to});
      // A passed due that isn't paid stays listed (overdue / not confirmed yet) until it is paid or
      // the next statement brings a new due date; a paid or nothing-owed one drops out.
      if(r.due&&!r.paid){const d=dn(r.due.date),st=r.overdue?'overdue':r.unconfirmed?'unconfirmed':'due';
        if(st==='overdue')out.push({...mk(r,r.due.date,'due',`${r.label} payment overdue`,r.due.amount),status:st});
        else if(st==='unconfirmed')out.push({...mk(r,r.due.date,'due',`${r.label} payment not confirmed yet`,r.due.amount),status:st});
        else if(d>=tn&&d<=end)out.push({...mk(r,r.due.date,'due',`${r.label} payment due`,r.due.amount),status:st});}
    }
    return out.sort((a,b)=>cmp(a.date,b.date)||KIND_ORDER[a.kind]-KIND_ORDER[b.kind]||cmp(a.label,b.label));
  }
  let CAL=null;
  function calRows(){
    const s=sig()+'|'+(typeof BILLING!=='undefined'?BILLING.length:0);if(CAL&&CAL.sig===s)return CAL.rows;
    const c=CM(),billing=[];
    if(c){
      // Billing reminders never reach the transaction lists; the core keeps them in BILLING.
      const src=(typeof BILLING!=='undefined'?BILLING:[]).filter(t=>t&&t.type==='billing'&&t.dueDate);
      for(const t of src){const L=linkFor(t.bank||'Maybank',c.accounts,STATE.cardMap);const d=looseDate(t.dueDate);if(L.link&&d)billing.push({account:L.link,date:d});}
    }
    const rows=calendar({cash:c,today:todayISO(),fix:STATE.stmtFix||{},billing});
    CAL={sig:s,rows};return rows;
  }
  const STATUS={'on-time':['good','On time'],'due-soon':['warn','Due soon'],late:['bad','Statement late'],manual:['warn','Download due'],overdue:['bad','Payment not found'],
    unconfirmed:['','Payment not confirmed yet'],'when-used':['','Only when used']};
  function statusBadge(r){
    const[cls,txt]=STATUS[r.status]||['',''];
    const label=r.status==='due-soon'?(r.dueIn===0?'Due today':`Due in ${r.dueIn} day${r.dueIn===1?'':'s'}`):r.status==='late'?`Late ${r.daysLate} days`:txt;
    return`<span class="badge ${cls}">${escH(label)}</span>`;
  }
  // Hint (never applied on its own): the history has repeated gaps, so the account may only send a statement in months it was used.
  const hintBadge=r=>r.suggestWhenUsed?`<span class="badge stmt-hint" title="Statements have skipped 2 or more months more than once. Switch this on under Credit cards › History › Statement links if this account only sends a statement in months it was used.">Only when used?</span>`:'';
  // The card payment's state, shown beside the timing badge when that one doesn't already say it.
  const PAY={paid:['good','Paid'],'nothing-owed':['','Nothing owed'],overdue:['bad','Payment not found'],unconfirmed:['','Payment not confirmed yet']};
  function payBadge(r){
    if(!r.pay||!PAY[r.pay]||r.status===r.pay)return'';
    const[cls,txt]=PAY[r.pay];return`<span class="badge${cls?' '+cls:''} stmt-pay" data-pay="${escH(r.pay)}">${escH(txt)}</span>`;
  }

  /* ── Hooks ── */
  const badge=(cls,text,title)=>`<span class="badge${cls?' '+cls:''}" style="margin-left:4px" title="${escH(title)}">${escH(text)}</span>`;
  registerHook('txnBadges',t=>{
    const s=t&&t.stmt;if(!s)return null;
    if(s.kind==='match')return badge('good','Statement ✓',s.set!==s.orig?`Statement amount. The alert said ${s.orig==null?'no rupiah amount':fmtIDR(s.orig)}`:'Matches the statement');
    if(s.kind==='added')return badge('accent','From statement','On the statement but not in your email alerts, so it was added');
    if(s.kind==='review')return badge('warn','Not on statement','Not found on the closed statement. Review it under Credit cards › History');
    if(s.kind==='excluded')return badge('','Excluded','Not on the statement; excluded from your totals');
    return null;
  });

  registerHook('homeComingUp',()=>{try{return comingUp(calRows(),todayISO());}catch(e){console.error('Statements comingUp failed',e);return[];}});

  registerHook('accountsExtraCol',acc=>{
    if(!acc||!CM()||typeof meStmtAccounts!=='function')return null;
    const ids=new Set(meStmtAccounts(acc.id).map(c=>c.id));if(!ids.size)return null;
    const today=todayISO();
    return calRows().filter(r=>ids.has(r.id)).map(r=>{
      const due=r.due&&!r.paid&&r.due.date>=today?` · Due ${dayLabel(r.due.date)}${r.due.amount!=null?` <span class="amt">${fmtIDR(r.due.amount)}</span>`:''}`:'';
      return`<span class="stmt-next">Next statement ${escH(r.nextText)}${due}</span>${r.status!=='on-time'?statusBadge(r):''}${payBadge(r)}${hintBadge(r)}`;
    }).join('')||null;
  });

  registerHook('cardsHistory',cards=>{
    const c=CM();if(!c||!(c.statements||[]).length)return null;
    const R=LAST,all=typeof CCP_CARD==='undefined'||CCP_CARD==='all',keys=new Set((cards||[]).map(x=>x.key));
    const ids=new Set();for(const b of R.banks)if(R.links[b]&&(all||keys.has(b)))ids.add(R.links[b]);
    return reviewCard(R,ids)+stmtCard(R,ids)+calendarCard()+setupCard(R);
  });

  const section=(head,body,cls)=>`<div class="grid"><section class="card ${cls||''} span-12">${head}${body}</section></div>`;
  const money=n=>n==null?'—':`<span class="amt">${fmtIDR(n)}</span>`;
  const txName=t=>escH(t.merchantClean||t.merchantRaw||'—');

  function reviewCard(R,ids){
    const pend=R.review.filter(r=>!r.decision&&ids.has(r.account)).sort((a,b)=>cmp(txISO(b.t),txISO(a.t)));
    if(!pend.length)return'';
    const rows=pend.slice(0,30).map(r=>{const st=R.stmts[r.stmtId],k=escAttr(r.key);
      return`<div class="list-item" style="flex-wrap:wrap">
        <span class="li-body" style="flex:1 1 200px"><span class="li-title" style="display:block">${txName(r.t)}</span>
          <span class="li-sub" style="display:block">${dayLabel(txISO(r.t))} · ${escH(r.t.bank)} · not on the ${escH(st?st.label:accLabel(r.account))} statement of ${dayLabel(st&&st.end)}</span></span>
        <span style="font-weight:600;white-space:nowrap">${r.t.amount>0?money(r.t.amount):escH(r.t.amountStr||'—')}</span>
        <span style="display:flex;gap:8px"><button class="btn btn-secondary btn-sm" onclick="ETStatements.decide('${k}','exclude')">Exclude</button>
          <button class="btn btn-ghost btn-sm" onclick="ETStatements.decide('${k}','keep')">Keep</button></span></div>`;}).join('');
    return section(cardHead('triangle-alert','Check these alerts',`${pend.length} alert${pend.length===1?'':'s'} not found on a closed statement · they still count until you exclude them`),
      `<div class="list" id="stmtReview">${rows}</div>${pend.length>30?`<p class="help" style="margin-top:8px">Showing the newest 30.</p>`:''}`);
  }

  function stmtCard(R,ids){
    const amb=Object.keys(R.ambiguous).filter(b=>!R.setLinks[b]);
    const sts=Object.values(R.stmts).filter(s=>ids.has(s.account)&&s.closed).sort((a,b)=>cmp(b.end,a.end)||cmp(a.label,b.label));
    const note=amb.length?`<p class="help" style="color:var(--warn);margin-bottom:8px">${ic('triangle-alert','s16','width:14px;height:14px;vertical-align:-2px')} Choose which card your ${escH(amb.join(', '))} alerts belong to under “Statement links” below.</p>`:'';
    if(!sts.length)return section(cardHead('receipt','Statements vs alerts','Each closed statement checked against your email alerts'),
      note+emptyHTML('receipt',R.accounts.length?'No closed statements in your sync period yet':'No email alerts are linked to a statement yet'));
    const rows=sts.slice(0,24).map(s=>{
      const st=s.status==='reconciled'?`<span class="badge good">Reconciled</span>`:`<span class="badge warn">${s.diffs} difference${s.diffs===1?'':'s'}</span>`;
      return`<button class="list-item" onclick="ETStatements.openStmt('${escAttr(s.id)}')" aria-label="${escH(s.label)} statement of ${dayLabel(s.end)}: ${s.status==='reconciled'?'reconciled':s.diffs+' differences'}. Open">
        <span class="li-body"><span class="li-title" style="display:block">${escH(s.label)} · ${dayLabel(s.end)}</span>
          <span class="li-sub" style="display:block">${dayLabel(s.start)} – ${dayLabel(s.end)} · Statement ${money(s.charges)} · Alerts after fixes ${money(s.after)}${s.fixes?` · ${s.fixes} fix${s.fixes===1?'':'es'}`:''}</span></span>
        ${st}${ic('chevron-right','s16')}</button>`;}).join('');
    return section(cardHead('receipt','Statements vs alerts','Charges on each closed statement against your email alerts after the fixes · tap one for details'),
      note+`<div class="list" id="stmtList">${rows}</div>`);
  }

  function calendarCard(){
    const rows=calRows();if(!rows.length)return'';
    const list=rows.map(r=>{
      const due=r.due?` · Due ${dayLabel(r.due.date)}${r.due.amount!=null?` ${money(r.due.amount)}`:''}${r.due.min!=null?` (min ${money(r.due.min)})`:''}${r.paid?' · paid':''}`:'';
      return`<div class="list-item"><span class="li-body"><span class="li-title" style="display:block">${escH(r.label)}${r.manual?' <span class="badge">Manual</span>':''}${r.whenUsed?' <span class="badge">Only when used</span>':''}</span>
        <span class="li-sub" style="display:block">Last ${dayLabel(r.last)} · Next expected ${escH(r.nextText)}${due}</span>
        <span class="li-sub stmt-reason" style="display:block">${escH(r.reason)}</span></span>${statusBadge(r)}${payBadge(r)}${hintBadge(r)}</div>`;}).join('');
    return section(cardHead('calendar','Statement calendar',`When each statement should arrive, learned from the account’s history · late ${LATE_GRACE} days after the expected window`),`<div class="list" id="stmtCal">${list}</div>`);
  }

  function setupCard(R){
    const c=CM(),accs=[...c.accounts].sort((a,b)=>cmp(a.label||a.id,b.label||b.id));
    const banks=R.banks.map(b=>{
      const cur=R.links[b],set=R.setLinks[b],amb=!set&&R.ambiguous[b],bq=escAttr(b);
      const sub=cur?(set?'Linked by you':'Linked automatically'):amb?'Several statements fit · choose one':set?'Not checked against a statement':'No matching statement found';
      const opts=(amb?`<option value="" disabled selected>Choose a statement…</option>`:'')
        +accs.map(a=>`<option value="${escH(a.id)}"${cur===a.id?' selected':''}>${escH(a.label||a.id)}</option>`).join('')
        +`<option value="__none"${!cur&&!amb?' selected':''}>Not linked</option>`;
      return`<div class="setting-row" style="flex-wrap:wrap"><div style="flex:1 1 180px;min-width:0"><div class="li-title">${escH(b)} alerts</div><div class="li-sub"${amb?' style="color:var(--warn)"':''}>${sub}</div></div>
        <select class="input" style="width:260px;max-width:100%" aria-label="Statement for ${escH(b)} alerts" onchange="ETStatements.setLink('${bq}',this.value)">${opts}</select></div>`;}).join('');
    const man=(STATE.stmtFix||{}).manual||{};
    const manual=accs.filter(a=>c.statements.some(s=>s.account===a.id)).map(a=>`<label class="check" style="padding:6px 0"><input type="checkbox"${live(man[a.id])&&man[a.id].on?' checked':''} onchange="ETStatements.setManual('${escAttr(a.id)}',this.checked)"> ${escH(a.label||a.id)}</label>`).join('');
    const wuMap=(STATE.stmtFix||{}).whenUsed||{},sug=new Set(calRows().filter(r=>r.suggestWhenUsed).map(r=>r.id));
    const whenUsed=accs.filter(a=>c.statements.some(s=>s.account===a.id)).map(a=>`<label class="check" style="padding:6px 0"><input type="checkbox"${live(wuMap[a.id])&&wuMap[a.id].on?' checked':''} onchange="ETStatements.setWhenUsed('${escAttr(a.id)}',this.checked)"> ${escH(a.label||a.id)}${sug.has(a.id)?' <span class="badge stmt-hint">Only when used?</span>':''}</label>`).join('');
    return section(cardHead('settings','Statement links','Which statement each bank’s email alerts are checked against, and which statements you download yourself'),
      `${banks?`<div id="stmtLinks">${banks}</div>`:`<p class="help">No email alerts yet.</p>`}
      <div class="eyebrow" style="margin:16px 0 4px">Statements you download yourself</div>
      <p class="help" style="margin-bottom:4px">These get a download reminder instead of a “late” flag.</p>
      <div style="display:flex;flex-direction:column" id="stmtManual">${manual}</div>
      <div class="eyebrow" style="margin:16px 0 4px">Only sends a statement when used</div>
      <p class="help" style="margin-bottom:4px">Some cards issue a statement only in months they were used. These are never flagged late or missing, and show nothing under Coming up. We suggest it when a statement has skipped 2 or more months more than once, but never switch it on for you.</p>
      <div style="display:flex;flex-direction:column" id="stmtWhenUsed">${whenUsed}</div>`);
  }

  /* ── Statement detail sheet (every fix with its own undo, plus undo all) ── */
  let SHEET=null;
  function stmtBody(id){
    const R=LAST,s=R.stmts[id];if(!s)return emptyHTML('receipt','This statement is no longer in your data');
    const ms=R.matches.filter(m=>m.stmtId===id),changed=ms.filter(m=>Math.round(m.orig||0)!==Math.round(m.amount));
    const as=R.added.filter(a=>a.stmtId===id),rs=R.review.filter(r=>r.stmtId===id);
    const row=(title,sub,amount,btn)=>`<div class="list-item" style="flex-wrap:wrap"><span class="li-body" style="flex:1 1 180px"><span class="li-title" style="display:block">${title}</span><span class="li-sub" style="display:block">${sub}</span></span><span style="font-weight:600;white-space:nowrap">${amount}</span>${btn}</div>`;
    const b=(label,call)=>`<button class="btn btn-ghost btn-sm" onclick="${call}">${label}</button>`;
    const fixRows=changed.map(m=>{const k=escAttr(m.key);
      return row(txName(m.t),`${dayLabel(txISO(m.t))} · alert ${m.orig?fmtIDR(m.orig):(escH(m.t.amountStr||'no rupiah amount'))} · statement ${fmtIDR(m.amount)}${m.off?' · using the alert':''}`,
        money(m.off?m.orig:m.amount),m.off?b('Use statement',`ETStatements.redoMatch('${k}')`):b('Undo',`ETStatements.undoMatch('${k}')`));}).join('');
    const addRows=as.map(a=>{const k=escAttr(a.line.id);
      return row(escH(a.line.counterparty||a.line.desc||'Statement charge'),`${dayLabel(a.line.date)} · ${escH(cashMeta(a.type).label)}${a.excluded?' · removed':' · added from the statement'}`,
        money(a.amount),a.excluded?b('Add back',`ETStatements.restoreAdded('${k}')`):b('Remove',`ETStatements.removeAdded('${k}')`));}).join('');
    const revRows=rs.map(r=>{const k=escAttr(r.key),amt=r.orig>0?money(r.orig):escH(r.t.amountStr||'—');
      const btns=r.decision?b('Undo',`ETStatements.decide('${k}',null)`):`<span style="display:flex;gap:8px">${b('Exclude',`ETStatements.decide('${k}','exclude')`)}${b('Keep',`ETStatements.decide('${k}','keep')`)}</span>`;
      return row(txName(r.t),`${dayLabel(txISO(r.t))} · not on this statement${r.decision==='exclude'?' · excluded':r.decision==='keep'?' · kept':''}`,amt,btns);}).join('');
    const part=(title,html)=>html?`<div class="eyebrow" style="margin:16px 0 2px">${title}</div><div class="list">${html}</div>`:'';
    const badgeHTML=s.status==='reconciled'?`<span class="badge good">Reconciled</span>`:`<span class="badge warn">${s.diffs} difference${s.diffs===1?'':'s'}</span>`;
    return`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${badgeHTML}<span class="muted">${dayLabel(s.start)} – ${dayLabel(s.end)}</span></div>
      <div class="list" style="margin-top:8px">
        ${row('Statement charges','Spending lines on the statement',money(s.charges),'')}
        ${row('Alerts before fixes','What your email alerts said',money(s.before),'')}
        ${row('Alerts after fixes','What Daily spending, Spending and Credit cards now count',money(s.after),'')}</div>
      <p class="help" style="margin-top:8px">${s.exact} alert${s.exact===1?'':'s'} matched the statement exactly.</p>
      ${part('Amounts fixed',fixRows)}${part('Only on the statement',addRows)}${part('Alerts not on the statement',revRows)}`;
  }
  function stmtFoot(id){
    const R=LAST,on=R.matches.some(m=>m.stmtId===id&&!m.off&&Math.round(m.orig||0)!==Math.round(m.amount))||R.added.some(a=>a.stmtId===id&&!a.excluded)||R.review.some(r=>r.stmtId===id&&r.decision==='exclude');
    const off=R.matches.some(m=>m.stmtId===id&&m.off)||R.added.some(a=>a.stmtId===id&&a.excluded);
    const k=escAttr(id);
    return`${off?`<button class="btn btn-secondary" onclick="ETStatements.reapplyAll('${k}')">Apply all fixes</button>`:''}
      <button class="btn btn-secondary" onclick="ETStatements.undoAll('${k}')"${on?'':' disabled'}>Undo all for this statement</button>`;
  }
  function openStmt(id){
    const s=LAST.stmts[id];
    const api=openSheet({title:s?`${s.label} · ${dayLabel(s.end)}`:'Statement',body:stmtBody(id),foot:stmtFoot(id),wide:true,confirmDiscard:false,onClose:()=>{if(SHEET&&SHEET.api===api)SHEET=null;}});
    SHEET={api,id};
  }
  function updateSheet(){
    if(!SHEET||!document.contains(SHEET.api.el))return;
    const body=SHEET.api.sheet.querySelector('.sheet-body'),foot=SHEET.api.sheet.querySelector('.sheet-foot');
    if(body)body.innerHTML=stmtBody(SHEET.id);if(foot)foot.innerHTML=stmtFoot(SHEET.id);
  }
})();
