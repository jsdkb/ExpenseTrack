/* ExpenseTrack v2 — Home module.
   Owner: Home builder (B). Page: home (group 'top', order 5): the wealth overview — net worth, real
   savings, the wealth bridge, liquidity, debts, coming up and data freshness.
   Integration, not this module, makes Home the landing page.

   Loaded by index.html after the core script, in this fixed order: books, home, statements,
   extras. Everything here runs in the page's global scope, so keep it inside the function below
   and put only deliberate cross-module helpers on window. Contract: docs/v2-interfaces.md.

   Definitions (owner decision): real savings = net worth change month on month. The bridge splits
   that change into Income − Expenses + Market revaluation + Other, and Other is always the
   remainder, so the parts add up to the change exactly (whole rupiah).
   - Book months (in the wealth snapshot): income / expenses from books.json activity of income /
     expense accounts that month, else the snapshot's pnl row. Market revaluation only when the
     Market view is on and BOTH month-ends have market values; otherwise the pair is valued at
     book value and revaluation is 0.
   - Months after the snapshot: net worth from the in-app month-end positions (STATE.monthEnd),
     a row left empty keeps the previous month's figure. Income = statement money in (Rupiah) +
     typed income that is neither ticked Posted nor matched to a statement line; expenses =
     statement money out. Internal moves and investments are never income or spending (the cash
     groups from cashType/cashMeta decide). Marked provisional.

   Reads (core globals): W, wAccounts, wMonths, wValue, hasMarket, wGroup, NW_VIEW, nwViewSeg,
   BOOKS, booksStatus, CM, cashTotals, cashMonths, cashAcc, cashMeta, incList, incLinks, STATE,
   SYNC, CHARTS, runHooks. Optional from other modules: window.openLedger(code, from, to),
   window.openJournals({from, to, kind}) and hook 'homeComingUp'.
   No personal data in this file: the repo is public. */
(function(){
  'use strict';
  const STALE_BOOK=40,STALE_STMT=35,STALE_GMAIL=7,AHEAD=14;
  let SEL=null,OPEN=null,LAST=null;

  /* ── Small helpers ── */
  const R=Math.round,pad=n=>String(n).padStart(2,'0');
  const mKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  const dKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  function mShift(k,n){const[y,m]=k.split('-').map(Number);return mKey(new Date(y,m-1+n,1));}
  function mEnd(k){const[y,m]=k.split('-').map(Number);return`${k}-${pad(new Date(y,m,0).getDate())}`;}
  function today(){return dKey(new Date());}
  function addDays(iso,n){const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);return dKey(d);}
  function daysBetween(a,b){return Math.round((Date.parse(b+'T00:00:00')-Date.parse(a+'T00:00:00'))/864e5);}
  function lastFinished(){return mShift(mKey(new Date()),-1);}
  const dayLong=iso=>fmtDayLong(new Date(iso+'T00:00:00'));
  const dayShort=iso=>fmtDay(new Date(iso+'T00:00:00'));
  function money(n,short){return`<span class="amt">${short?fmtIDRShort(n):fmtIDR(n)}</span>`;}
  function signedText(n,short){const a=Math.abs(n);return(n>0?'+':n<0?'−':'')+(short?fmtIDRShort(a):fmtIDR(a));}
  function signed(n,short){return`<span class="amt">${signedText(n,short)}</span>`;}
  function esc(s){return escAttr(s);}
  function viewName(){return NW_VIEW==='market'?'market':'book';}

  /* ── Net worth points: one per month-end, book months first, then provisional ones ── */
  function hasPos(st){return!!(st&&st.pos&&Object.values(st.pos).some(p=>p&&p.v!=null));}
  function hasMk(st){return!!(st&&st.market&&Object.values(st.market).some(x=>x&&x.v!=null));}
  function totals(p,val,accs){let assets=0,liab=0;const src=val==='market'?p.market:p.book;
    for(const a of accs){const v=src[a.id]||0;if(a.side==='asset')assets+=v;else liab+=v;}return{assets,liab,net:assets-liab};}
  function buildPoints(){
    const w=W();if(!w||!Array.isArray(w.months)||!w.months.length)return[];
    const accs=wAccounts(),pts=[];
    wMonths().forEach((m,i)=>{const book={},market={};for(const a of accs){book[a.id]=wValue(a,i,'book');market[a.id]=wValue(a,i,'market');}
      pts.push({month:m.month,kind:'book',mi:i,mk:hasMarket(i),book,market,carried:[]});});
    const store=STATE.monthEnd||{},end=lastFinished();
    for(let k=mShift(pts[pts.length-1].month,1);k<=end;k=mShift(k,1)){
      const st=store[k];
      if(!hasPos(st)){pts.push({month:k,kind:'prov',missing:true});continue;}
      let prev=null;for(let j=pts.length-1;j>=0;j--)if(!pts[j].missing){prev=pts[j];break;}
      const book={},market={},carried=[];
      for(const a of accs){const p=st.pos[a.id];let v;
        if(p&&p.v!=null)v=p.v;else{v=prev?prev.book[a.id]||0:0;if(v)carried.push(a.id);}   // empty row: last month's figure
        book[a.id]=v;const mk=a.side==='asset'&&st.market?st.market[a.id]:null;market[a.id]=mk&&mk.v!=null?mk.v:v;}
      pts.push({month:k,kind:'prov',mk:hasMk(st),book,market,carried,st});
    }
    while(pts.length&&pts[pts.length-1].missing)pts.pop();
    for(const p of pts)if(!p.missing)p.tot={book:totals(p,'book',accs),market:totals(p,'market',accs)};
    return pts;
  }
  function linked(pts,i){return i>0&&!pts[i].missing&&!pts[i-1].missing&&pts[i].month===mShift(pts[i-1].month,1);}
  // Market only when both month-ends have market values; any other pair is valued at book.
  function pairVal(pts,i){return NW_VIEW==='market'&&pts[i].mk&&pts[i-1].mk?'market':'book';}
  function delta(pts,i){if(!linked(pts,i))return null;const v=pairVal(pts,i);return R(pts[i].tot[v].net)-R(pts[i-1].tot[v].net);}

  /* ── Income and expenses ── */
  let KIND_FOR=null,KIND={},NAME={};
  function bookIndex(B){if(KIND_FOR!==B){KIND_FOR=B;KIND={};NAME={};for(const a of B.accounts){KIND[a.id]=a.kind;NAME[a.id]=a.name;}}}
  const sumV=xs=>R(xs.reduce((t,x)=>t+x.v,0));
  function plBook(month){
    const B=BOOKS();
    if(B&&B.activity&&Array.isArray(B.months)&&B.months.includes(month)){
      bookIndex(B);const act=B.activity[month]||{},inc=[],exp=[],eq=[];
      for(const[code,v]of Object.entries(act)){if(!v)continue;const k=KIND[code],row={code,name:NAME[code]||code};
        if(k==='income')inc.push({...row,v:-v});else if(k==='expense')exp.push({...row,v});else if(k==='equity')eq.push({...row,v:-v});}
      const by=(a,b)=>Math.abs(b.v)-Math.abs(a.v);
      return{src:'books',income:sumV(inc),expense:sumV(exp),inc:inc.sort(by),exp:exp.sort(by),eq:eq.sort(by)};
    }
    const w=W(),r=(w&&Array.isArray(w.pnl)?w.pnl:[]).find(x=>x.month===month);
    if(r)return{src:'pnl',income:R(r.income||0),expense:R(r.expense||0)};
    return{src:null,income:0,expense:0};
  }
  function plProv(month){
    const c=CM(),out={src:c?'cash':null,income:0,expense:0,stmtIn:0,typedIn:0,inTypes:[],outTypes:[],typed:[],posted:0,matched:0,asOf:c&&c.asOf||null};
    if(c){const t=cashTotals(month);out.stmtIn=R(t.in);out.expense=R(t.out);
      for(const[ty,v]of Object.entries(t.byType)){const m=cashMeta(ty);if(!R(v))continue;
        if(m.g==='in')out.inTypes.push({ty,name:m.label,v:R(v)});else if(m.g==='out')out.outTypes.push({ty,name:m.label,v:R(-v)});}
      const by=(a,b)=>b.v-a.v;out.inTypes.sort(by);out.outTypes.sort(by);}
    // Typed income counts unless ticked Posted, or matched to a statement line already counted above.
    const links=c&&typeof incLinks==='function'?incLinks():{};
    const typed=typeof incList==='function'?incList().filter(x=>x.date&&x.date.slice(0,7)===month):[];
    for(const x of typed){if(x.posted)out.posted++;else if(links[x.id])out.matched++;else out.typed.push(x);}
    out.typedIn=R(out.typed.reduce((s,x)=>s+(+x.amount||0),0));
    out.income=out.stmtIn+out.typedIn;
    return out;
  }
  function bridgeAt(pts,i){
    if(!linked(pts,i))return null;
    const p=pts[i],q=pts[i-1],val=pairVal(pts,i);
    const open=R(q.tot[val].net),close=R(p.tot[val].net),change=close-open;
    const pl=p.kind==='book'?plBook(p.month):plProv(p.month);
    const reval=val==='market'?R(p.tot.market.net-p.tot.book.net)-R(q.tot.market.net-q.tot.book.net):0;
    const income=pl.income,expense=pl.expense,other=change-income+expense-reval;
    return{month:p.month,prev:q.month,kind:p.kind,val,open,close,change,income,expense,reval,other,pl,carried:p.carried.length};
  }
  function avgExpense(pts){
    const xs=[];for(let i=pts.length-1;i>=0&&xs.length<6;i--){if(pts[i].kind!=='book')continue;const pl=plBook(pts[i].month);if(pl.src)xs.push(pl.expense);}
    if(xs.length)return{v:xs.reduce((a,b)=>a+b,0)/xs.length,n:xs.length,src:'book'};
    if(CM()){const cur=mKey(new Date()),ms=cashMonths().filter(m=>m<cur).slice(-6);
      if(ms.length)return{v:ms.reduce((s,m)=>s+cashTotals(m).out,0)/ms.length,n:ms.length,src:'statements'};}
    return null;
  }
  // A month whose change is mostly equity moves (the bridge's Other): |Other| > half the month's
  // |change| and > twice the median month's |change|. It still counts as real savings (= net-worth
  // change, the owner's rule); it is only flagged, so a capital injection isn't read as saving.
  const EQ_SHARE=0.5,EQ_VS_MEDIAN=2;
  function markEquity(sav,bridges){
    const by=new Map(bridges.map(b=>[b.month,b])),xs=sav.filter(r=>r.v!=null).map(r=>Math.abs(r.v)).sort((a,b)=>a-b);
    const med=xs.length?xs[Math.floor((xs.length-1)/2)]:0;
    for(const r of sav){const b=by.get(r.month),o=b?Math.abs(b.other):0;
      r.eq=!!(b&&r.v!=null&&o>=1&&o>EQ_SHARE*Math.abs(b.change)&&o>EQ_VS_MEDIAN*med);}
  }
  function model(){
    const pts=buildPoints(),L=pts.length-1;
    const sav=pts.map((p,i)=>({month:p.month,kind:p.kind,v:p.missing?null:delta(pts,i),val:linked(pts,i)?pairVal(pts,i):null}));
    const bridges=pts.map((_,i)=>bridgeAt(pts,i)).filter(Boolean);
    markEquity(sav,bridges);
    return{pts,L,sav,bridges};
  }
  const EQ_TXT='mostly equity moves — not saved from income';
  const eqBadge='<span class="badge warn" title="Most of this month\u2019s change came from equity moves (Other), not from income less spending">Mostly equity moves</span>';
  const eqFoot=n=>`Includes ${n} month${n===1?'':'s'} that ${n===1?'is':'are'} mostly equity moves — not saved from income.`;

  /* ── Coming up, card dues, freshness ── */
  function comingRaw(){return runHooks('homeComingUp').filter(x=>x&&typeof x.date==='string'&&/^\d{4}-\d{2}-\d{2}/.test(x.date)).map(x=>({...x,date:x.date.slice(0,10)}));}
  // Next 14 days; a missing statement stays listed until it arrives.
  function comingItems(raw){const t=today(),hi=addDays(t,AHEAD);
    return raw.filter(x=>x.date<=hi&&(x.date>=t||x.kind==='missing')).sort((a,b)=>a.date.localeCompare(b.date)||String(a.label||'').localeCompare(String(b.label||'')));}
  const MON={jan:1,feb:2,mar:3,apr:4,may:5,mei:5,jun:6,jul:7,aug:8,agu:8,agt:8,ags:8,sep:9,oct:10,okt:10,nov:11,dec:12,des:12};
  // Due dates in billing emails come as free text: 25-10-2026, 25/10/26, 2026-10-25, 25 Okt 2026, 25-Oct.
  function parseDue(s,ref){
    s=String(s||'').trim().toLowerCase();if(!s)return null;
    const refD=ref?new Date(ref):new Date(),ok=(y,m,d)=>m>=1&&m<=12&&d>=1&&d<=31?`${y}-${pad(m)}-${pad(d)}`:null;
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return ok(+m[1],+m[2],+m[3]);
    m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);if(m)return ok(m[3].length===2?2000+(+m[3]):+m[3],+m[2],+m[1]);
    m=s.match(/^(\d{1,2})[-\s]?([a-z]{3})[a-z]*[-\s]?(\d{2,4})?/);
    if(m&&MON[m[2]]){let y=m[3]?(m[3].length===2?2000+(+m[3]):+m[3]):refD.getFullYear();
      if(!m[3]&&MON[m[2]]<refD.getMonth()+1-1)y++;return ok(y,MON[m[2]],+m[1]);}
    return null;
  }
  function dueItems(raw){
    const out=[];
    for(const x of raw)if(x.kind==='due')out.push({date:x.date,label:x.label||x.account||'Card',amount:x.amount!=null&&!isNaN(+x.amount)?+x.amount:null,src:'hook'});
    const c=CM();
    if(!out.length&&c){const last={};for(const s of c.statements){if(!s.dueDate||cashAcc(s.account).kind!=='card')continue;if(!last[s.account]||s.date>last[s.account].date)last[s.account]=s;}
      // A card's closing is what is owed (positive); a negative closing is in credit (cardOwed, core).
      for(const s of Object.values(last))out.push({date:s.dueDate,label:cashAcc(s.account).label,amount:cardOwed(s.closing),src:'statement'});}
    if(!out.length&&typeof BILLING!=='undefined'){const seen=new Set();
      for(const t of BILLING){if(!t||t.type!=='billing'||!t.dueDate)continue;const d=parseDue(t.dueDate,t.msgDate);if(!d||seen.has(d))continue;seen.add(d);
        out.push({date:d,label:(t.bank||'Card')+' billing email',amount:t.amount>0?t.amount:null,src:'email'});}}
    return out;
  }
  function nextDue(raw){
    const xs=dueItems(raw),t=today(),fut=xs.filter(x=>x.date>=t).sort((a,b)=>a.date.localeCompare(b.date));
    const pick=(list,past)=>{const d=list[0].date,items=list.filter(x=>x.date===d),known=items.filter(x=>x.amount!=null);
      return{date:d,items,amount:known.length?R(known.reduce((s,x)=>s+x.amount,0)):null,past,src:items[0].src};};
    if(fut.length)return pick(fut,false);
    const past=xs.filter(x=>x.date<t&&daysBetween(x.date,t)<=31).sort((a,b)=>b.date.localeCompare(a.date));
    return past.length?pick(past,true):null;
  }
  function freshRows(){
    const t=today(),rows=[],B=BOOKS(),w=W();
    const bm=(B&&B.source&&B.source.balancesAsOf)||(w&&w.source&&w.source.asOf)||null;
    if(bm){const d=mEnd(String(bm).slice(0,7)),age=daysBetween(d,t);rows.push({key:'book',label:'Book balances',date:d,age,stale:age>STALE_BOOK,sub:B?'Books file':'Wealth snapshot'});}
    else rows.push({key:'book',label:'Book balances',date:null,age:null,stale:false,sub:'Not imported yet'});
    if(B&&B.source&&B.source.glAsOf){const d=String(B.source.glAsOf).slice(0,10),age=daysBetween(d,t);rows.push({key:'gl',label:'General ledger',date:d,age,stale:age>STALE_BOOK,sub:'Newest voucher'});}
    else if(booksStatus()==='loading')rows.push({key:'gl',label:'General ledger',date:null,age:null,stale:false,sub:'Loading the books…'});
    const c=CM();
    if(c){const last={};for(const s of c.statements)if(!last[s.account]||s.date>last[s.account])last[s.account]=s.date;
      for(const a of c.accounts){const d=last[a.id]||null,age=d?daysBetween(d,t):null;
        rows.push({key:'stmt',account:a.id,label:a.label||a.id,date:d,age,stale:d?age>STALE_STMT:true,sub:d?(a.kind==='card'?'Last card statement':'Last statement'):'No statement yet'});}}
    else rows.push({key:'stmt',label:'Bank and card statements',date:null,age:null,stale:false,sub:'Not imported yet'});
    const g=(typeof SYNC!=='undefined'&&SYNC.lastSynced)||STATE.cachedAt||null;
    if(g){const d=dKey(new Date(g)),age=daysBetween(d,t);rows.push({key:'gmail',label:'Gmail alerts',date:d,age,stale:age>STALE_GMAIL,sub:'Last sync '+relTime(g)});}
    else rows.push({key:'gmail',label:'Gmail alerts',date:null,age:null,stale:false,sub:'Not synced yet'});
    return rows;
  }

  /* ── Rendering ── */
  function deltaLine(v,base,label){
    if(v==null)return'';
    const pct=base?v/Math.abs(base)*100:null,cls=pct!=null&&Math.abs(pct)<=2?'neutral':v>=0?'good':'bad';
    return`<div class="summary-line"><span class="delta ${cls}">${v>0?'▲':v<0?'▼':''} ${signed(v,true)}${pct!=null?` · ${fmtPct(pct)}`:''}</span> <span class="vs">${label}</span></div>`;
  }
  function ytd(M){
    const p=M.pts[M.L],y=+p.month.slice(0,4),anchor=`${y-1}-12`,ai=M.pts.findIndex(x=>x.month===anchor);
    if(ai<0)return null;let s=0,eq=0;for(let i=ai+1;i<=M.L;i++){const d=M.sav[i].v;if(d==null)return null;s+=d;if(M.sav[i].eq)eq++;}
    return{v:s,anchor,base:M.pts[ai].tot[viewName()].net,eq};
  }
  function nwCardHTML(M){
    const p=M.pts[M.L],t=p.tot[viewName()],d=M.sav[M.L],y=ytd(M),prov=p.kind==='prov';
    const prevNet=M.L>0&&!M.pts[M.L-1].missing&&d.val?M.pts[M.L-1].tot[d.val].net:null;
    const basis=d.val==='book'&&NW_VIEW==='market'?' · book value':'';
    return`<section class="card span-5" id="homeNW" aria-label="Net worth">
      ${cardHead('trending-up','Net worth',`${monthLabel(p.month,true)} · ${NW_VIEW==='market'?'market value where recorded':'book value'}`,`${prov?'<span class="badge warn">Provisional</span>':''}<button class="btn btn-ghost btn-sm" onclick="setTab('networth')">Details</button>`)}
      <div class="display"><span class="amt"><span class="cur">Rp</span>${fmtNum(t.net)}</span></div>
      ${deltaLine(d.v,prevNet,`vs ${monthLabel(M.pts[M.L-1]?M.pts[M.L-1].month:p.month)}${basis}`)}
      ${y?deltaLine(y.v,y.base,`since ${dayLong(mEnd(y.anchor))} · real savings this year${y.eq?'*':''}`):''}
      ${y&&y.eq?`<p class="h-foot" id="homeNWEq">* Real savings this year: ${escH(eqFoot(y.eq).replace(/^I/,'i'))}</p>`:''}
      ${prov?`<p class="help" style="margin-top:6px">Provisional — book not posted yet. From your ${escH(monthLabel(p.month,true))} month-end figures${p.carried.length?`; ${p.carried.length} account${p.carried.length===1?'':'s'} kept at last month’s figure`:''}.</p>`:''}
      <dl class="facts"><div><dt class="eyebrow">Assets</dt><dd class="amt">${fmtIDRShort(t.assets)}</dd></div><div><dt class="eyebrow">Liabilities</dt><dd class="amt">${fmtIDRShort(t.liab)}</dd></div></dl>
    </section>`;
  }
  function savRows(M){return M.sav.slice(-12);}
  function savingsCardHTML(M){
    const rows=savRows(M),vals=rows.filter(r=>r.v!=null);
    const avg=k=>{const xs=rows.slice(-k).filter(r=>r.v!=null);return xs.length?{v:xs.reduce((s,r)=>s+r.v,0)/xs.length,n:xs.length,eq:xs.filter(r=>r.eq).length}:null;};
    const best=vals.length?vals.reduce((a,b)=>b.v>a.v?b:a):null,worst=vals.length?vals.reduce((a,b)=>b.v<a.v?b:a):null;
    const nEq=vals.filter(r=>r.eq).length,eqOf=o=>!!o&&(o.eq===true||o.eq>0);
    const stat=(label,o,sub)=>`<div><dt class="eyebrow">${label}${eqOf(o)?'*':''}</dt><dd class="${o?(o.v>=0?'good':'bad'):''}">${o?signed(o.v,true):'—'}</dd>${sub?`<div class="h-sub">${sub}</div>`:''}</div>`;
    const a3=avg(3),a6=avg(6),a12=avg(12),nTxt=(o,k)=>o&&o.n<k?`${o.n} mo so far`:'';
    const basis=NW_VIEW==='market'?'market value where both month-ends have one, else book value':'book value';
    const anyProv=rows.some(r=>r.kind==='prov'&&r.v!=null);
    const label=vals.length?`Net worth change per month; latest ${monthLabel(vals[vals.length-1].month)} ${signedText(vals[vals.length-1].v,true)}`:'No month-on-month change yet';
    return`<section class="card span-7" id="homeSavings" aria-label="Real savings">
      ${cardHead('piggy-bank','Real savings',`Net worth change each month · ${basis}`,vals.length?tableToggle('homeSavings'):'')}
      ${vals.length?`<div class="chart-readout" id="homeSavReadout" aria-live="polite"></div>
      <div class="chart-box"><canvas id="homeSavChart" role="img" aria-label="${escH(amountsHidden()?'Net worth change per month':label)}"></canvas></div>
      <div class="legend"><span class="legend-item"><i style="background:var(--good)"></i>Net worth up</span><span class="legend-item"><i style="background:var(--bad)"></i>Net worth down</span>${anyProv?'<span class="legend-item"><i style="background:transparent;border:1.5px solid var(--text-3)"></i>Provisional</span>':''}${nEq?'<span class="legend-item"><i style="background:transparent;border:2px solid var(--warn)"></i>Mostly equity moves</span>':''}</div>
      <div class="chart-table"><table class="data"><thead><tr><th scope="col">Month</th><th scope="col" class="num">Change</th><th scope="col">Basis</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${monthLabel(r.month)}</td><td class="num amt">${r.v==null?'—':signedText(r.v)}</td><td>${r.v==null?'—':(r.kind==='prov'?'Provisional · ':'')+(r.val==='market'?'Market':'Book')}${r.eq?' '+eqBadge:''}</td></tr>`).join('')}</tbody></table></div>
      <dl class="h-stats">${stat('3-mo average',a3,nTxt(a3,3))}${stat('6-mo average',a6,nTxt(a6,6))}${stat('12-mo average',a12,nTxt(a12,12))}${stat('Best month',best,best?monthLabel(best.month):'')}${stat('Worst month',worst,worst?monthLabel(worst.month):'')}</dl>
      ${nEq?`<p class="h-foot" id="homeSavEq">* ${escH(eqFoot(nEq))}</p>`:''}`
      :emptyHTML('piggy-bank','Two month-ends are needed to show a change')}
    </section>`;
  }

  /* Wealth bridge: a waterfall from opening to closing net worth. */
  function bridgeRows(b){
    const steps=[['income','Income',b.income],['expense','Expenses',-b.expense],['reval','Market revaluation',b.reval],['other','Other',b.other]];
    let run=b.open;const pos=[b.open];for(const s of steps){run+=s[2];pos.push(run);}
    const lo=Math.min(...pos),hi=Math.max(...pos),span=hi-lo||1,x=v=>(v-lo)/span*92+4;
    return{steps,pos,x};
  }
  function partSub(b,k){
    const pl=b.pl;
    if(k==='income'||k==='expense'){
      if(b.kind==='prov')return pl.src?`Statements${pl.asOf&&pl.asOf<mEnd(b.month)?` through ${dayShort(pl.asOf)}`:''}${k==='income'?' + typed income':''}`:(k==='income'?'Typed income · no statements imported':'No statements imported');
      return pl.src==='books'?`From your books · ${(k==='income'?pl.inc:pl.exp).length} accounts`:pl.src==='pnl'?'From the snapshot’s income statement':'No income statement for this month';
    }
    if(k==='reval')return NW_VIEW!=='market'?'Book view · Market view includes it':b.val==='market'?'Investments at market value':'No market values at both month-ends · book value';
    return b.kind==='prov'?'Not on a statement yet, accounts without statements, cash':'Equity moves, accounts outside income and expenses, rounding';
  }
  function detailRowsHTML(rows,from,to,limit){
    const top=rows.slice(0,limit||8),rest=rows.slice(top.length),led=typeof window.openLedger==='function';
    return`<div class="list">${top.map(r=>{const inner=`<span class="li-body"><span class="li-title" style="display:block">${escH(r.name)}</span>${r.sub?`<span class="li-sub" style="display:block">${r.sub}</span>`:''}</span><span class="amt" style="font-weight:600;white-space:nowrap">${signedText(r.v,false)}</span>`;
      return r.code&&led?`<button class="list-item" onclick="etHome.ledger('${esc(r.code)}','${from}','${to}')" aria-label="Open the ledger of ${escH(r.name)}">${inner}</button>`:`<div class="list-item">${inner}</div>`;}).join('')}
      ${rest.length?`<div class="list-item"><span class="li-body"><span class="li-sub">${rest.length} more</span></span><span class="amt" style="font-weight:600">${signedText(rest.reduce((s,r)=>s+r.v,0))}</span></div>`:''}</div>`;
  }
  function detailHTML(b,k){
    const pl=b.pl,from=`${b.month}-01`,to=mEnd(b.month);
    const j=typeof window.openJournals==='function'?`<button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="etHome.journals('${k}','${b.month}')">${ic('receipt','s16')}See the vouchers</button>`:'';
    const cashBtn=g=>CM()?`<button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="etHome.cash('${b.month}','${g}')">${ic('arrow-left-right','s16')}Open cash movements</button>`:'';
    let body='';
    if(k==='income'||k==='expense'){
      if(b.kind==='prov'){
        const rows=(k==='income'?pl.inTypes:pl.outTypes).map(r=>({name:r.name,v:k==='income'?r.v:-r.v}));
        if(k==='income')for(const x of pl.typed)rows.push({name:`Typed income · ${x.payer||'receipt'}`,sub:`${escH(dayShort(x.date))} · not posted yet`,v:R(+x.amount||0)});
        const left=k==='income'&&(pl.posted||pl.matched)?`<p class="help" style="margin-top:6px">Left out so nothing counts twice: ${[pl.posted?`${pl.posted} typed receipt${pl.posted===1?'':'s'} ticked Posted`:'',pl.matched?`${pl.matched} already on a statement`:''].filter(Boolean).join(' · ')}.</p>`:'';
        body=(rows.length?detailRowsHTML(rows,from,to,10):`<p class="help">${k==='income'?'No money in':'No money out'} in this month’s statements.</p>`)+left+cashBtn(k==='income'?'in':'out');
      }else if(pl.src==='books'){
        const rows=(k==='income'?pl.inc:pl.exp).map(r=>({code:r.code,name:r.name,sub:escH(r.code),v:k==='income'?r.v:-r.v}));
        body=(rows.length?detailRowsHTML(rows,from,to):`<p class="help">Nothing booked to ${k==='income'?'income':'expense'} accounts this month.</p>`)+j;
      }else body=`<p class="help">${pl.src==='pnl'?'This figure is the snapshot’s income statement total. Import books.json to see it by account.':'The book has no income statement for this month, so the whole change shows under Other.'}</p>`;
    }else if(k==='other'){
      if(b.kind==='prov')body=`<p class="help">Everything the statements and typed income don’t explain: card spending not on a statement yet, cash, accounts without statements, and any difference in the figures you typed for the month-end${b.carried?` (${b.carried} account${b.carried===1?'':'s'} kept at last month’s figure)`:''}.</p>`;
      else if(pl.src==='books'){
        const rows=pl.eq.map(r=>({code:r.code,name:r.name,sub:escH(r.code)+' · equity',v:r.v})),rest=b.other-sumV(pl.eq);
        if(rest)rows.push({name:'Not explained by the book’s accounts',sub:'Snapshot vs books, accounts added in the app, rounding',v:rest});
        body=rows.length?detailRowsHTML(rows,from,to):'<p class="help">Nothing else moved.</p>';
      }else body=`<p class="help">${pl.src==='pnl'?'The change not covered by the income statement: equity moves, accounts outside income and expenses, rounding. Import books.json to see it by account.':'Without an income statement for this month, the whole change shows here.'}</p>`;
    }
    return`<div class="hb-detail" id="homeBridgeDetail">${body}</div>`;
  }
  function bridgeCardHTML(M){
    const bs=M.bridges;
    if(!bs.length)return`<section class="card span-7" id="homeBridge" aria-label="Wealth bridge">${cardHead('chart-column','Wealth bridge','What moved your net worth')}${emptyHTML('chart-column','Two month-ends are needed to explain a change')}</section>`;
    let b=bs.find(x=>x.month===SEL)||bs[bs.length-1];
    const sel=`<label class="sr-only" for="homeBridgeMonth">Month</label><select class="input h-sel" id="homeBridgeMonth" onchange="etHome.month(this.value)">${bs.slice().reverse().map(x=>`<option value="${x.month}"${x.month===b.month?' selected':''}>${monthLabel(x.month)}${x.kind==='prov'?' · provisional':''}</option>`).join('')}</select>`;
    const g=bridgeRows(b),track=(a,c)=>{const l=g.x(Math.min(a,c)),w=Math.max(0.8,Math.abs(g.x(c)-g.x(a)));return a===c?'':`<i style="left:${l}%;width:${w}%;background:${c>a?'var(--good)':'var(--bad)'}"></i>`;};
    const totalRow=(label,sub,v,at)=>`<div class="hb-row hb-total" data-part="${at===0?'open':'close'}"><span class="hb-name">${label}<small>${sub}</small></span><span class="hb-track" aria-hidden="true"><i class="mk" style="left:calc(${g.x(v)}% - 1.5px)"></i></span><span class="hb-val">${money(v,true)}</span></div>`;
    const stepRow=(s,i)=>{const[k,label,v]=s,click=k!=='reval',exp=OPEN===k;
      const inner=`<span class="hb-name">${label}<small>${escH(partSub(b,k))}</small></span><span class="hb-track" aria-hidden="true">${track(g.pos[i],g.pos[i+1])}</span><span class="hb-val">${signed(v,true)}${click?ic('chevron-down'):''}</span>`;
      return(click?`<button class="hb-row" data-part="${k}" aria-expanded="${exp}" aria-controls="homeBridgeDetail" onclick="etHome.open('${k}')">${inner}</button>`:`<div class="hb-row" data-part="${k}">${inner}</div>`)+(exp?detailHTML(b,k):'');};
    const prov=b.kind==='prov';
    const srcLine=prov?'':b.pl.src==='books'?'Income and expenses from your books.':b.pl.src==='pnl'?'Income and expenses from the snapshot’s income statement.':'';
    return`<section class="card span-7" id="homeBridge" aria-label="Wealth bridge">
      ${cardHead('chart-column','Wealth bridge',`What moved your net worth in ${escH(monthLabel(b.month,true))}`,sel)}
      ${prov?`<div class="h-note">${ic('info')}<span><b>Provisional — book not posted yet.</b> Net worth from your month-end figures; income and spending from your statements and typed income.</span></div>`:''}
      <div class="hb-list">
        ${totalRow('Opening net worth',escH(dayLong(mEnd(b.prev))),b.open,0)}
        ${g.steps.map(stepRow).join('')}
        ${totalRow('Closing net worth',escH(dayLong(mEnd(b.month)))+(prov?' · provisional':''),b.close,4)}
      </div>
      <div class="hb-change" data-part="change"><span>Real savings · ${escH(monthLabel(b.month))}</span><span class="${b.change>=0?'good':'bad'}">${signed(b.change,true)}</span></div>
      <p class="help" style="margin-top:10px">${srcLine} ${b.val==='market'?'Valued at market where recorded.':'Valued at book value.'} Card payments, moves between your accounts and investment purchases are never income or spending.</p>
    </section>`;
  }
  function accRowsHTML(list){
    return`<div class="list">${list.map(({a,v})=>`<button class="list-item" onclick="etHome.acc('${esc(a.id)}')"><span class="li-body"><span class="li-title" style="display:block">${escH(a.name)}</span><span class="li-sub" style="display:block">${escH(wGroup(a.group).label)}</span></span><span class="amt" style="font-weight:600;white-space:nowrap">${fmtIDRShort(v)}</span></button>`).join('')}</div>`;
  }
  function liquidityHTML(M){
    const p=M.pts[M.L],vals=p[viewName()],accs=wAccounts();
    const list=accs.filter(a=>a.side==='asset'&&(a.group==='cash'||a.group==='deposits')).map(a=>({a,v:vals[a.id]||0})).filter(x=>Math.abs(x.v)>=1).sort((x,y)=>y.v-x.v);
    const sum=g=>list.filter(x=>x.a.group===g).reduce((s,x)=>s+x.v,0),cash=sum('cash'),dep=sum('deposits'),liquid=cash+dep;
    const avg=avgExpense(M.pts),run=avg&&avg.v>0?liquid/avg.v:null;
    return`<section class="card span-4" id="homeLiquidity" aria-label="Liquidity">
      ${cardHead('wallet','Liquidity',`Cash and deposits · ${escH(monthLabel(p.month,true))}${p.kind==='prov'?' · provisional':''}`)}
      <div class="h-big">${money(liquid)}</div>
      <div class="summary-line" style="margin-top:4px">${run!=null?`<b class="amt h-runway">${run.toLocaleString('en-GB',{maximumFractionDigits:1})} months</b> of spending <span class="vs">at ${money(avg.v,true)} a month (${avg.n}-month average, ${avg.src==='book'?'book':'statements'})</span>`:'<span class="vs">Runway needs a month of expenses from the book or statements</span>'}</div>
      <dl class="facts" style="margin-top:12px"><div><dt class="eyebrow">${escH(wGroup('cash').label)}</dt><dd class="amt">${fmtIDRShort(cash)}</dd></div><div><dt class="eyebrow">${escH(wGroup('deposits').label)}</dt><dd class="amt">${fmtIDRShort(dep)}</dd></div></dl>
      ${list.length?accRowsHTML(list.slice(0,5))+(list.length>5?`<p class="help">${list.length-5} more on Accounts</p>`:''):`<p class="help" style="margin-top:8px">No cash or deposit accounts in the snapshot.</p>`}
    </section>`;
  }
  function dueHTML(raw){
    const d=nextDue(raw);if(!d)return`<div class="h-due"><div class="eyebrow">Next card due</div><p class="help">No due date from statements or billing emails yet.</p></div>`;
    const n=daysBetween(today(),d.date),when=d.past?`was due ${dayShort(d.date)}`:n===0?'due today':`due ${dayShort(d.date)} · in ${n} day${n===1?'':'s'}`;
    const cls=d.past?'faint':n<=7?'warn':'';
    return`<div class="h-due" id="homeNextDue"><div class="eyebrow">Next card due</div>
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-top:6px"><span class="${cls}" style="font-weight:600">${escH(when)}</span>${d.amount!=null?`<span style="font-weight:600">${money(d.amount)}</span>`:''}</div>
      <div class="li-sub">${escH(d.items.map(x=>x.label).join(' · '))} · ${d.src==='hook'?'statement calendar':d.src==='statement'?'from the statement':'from the billing email'}</div></div>`;
  }
  function debtsHTML(M,raw){
    const p=M.pts[M.L],vals=p.book;
    const list=wAccounts().filter(a=>a.side!=='asset'&&(a.group==='cards'||a.group==='loans')).map(a=>({a,v:vals[a.id]||0})).filter(x=>Math.abs(x.v)>=1).sort((x,y)=>y.v-x.v);
    const total=list.reduce((s,x)=>s+x.v,0),sum=g=>list.filter(x=>x.a.group===g).reduce((s,x)=>s+x.v,0);
    return`<section class="card span-4" id="homeDebts" aria-label="Debts">
      ${cardHead('credit-card','Debts',`Cards and loans · ${escH(monthLabel(p.month,true))}${p.kind==='prov'?' · provisional':''}`)}
      <div class="h-big">${money(total)}</div>
      <dl class="facts" style="margin-top:12px"><div><dt class="eyebrow">${escH(wGroup('cards').label)}</dt><dd class="amt">${fmtIDRShort(sum('cards'))}</dd></div><div><dt class="eyebrow">${escH(wGroup('loans').label)}</dt><dd class="amt">${fmtIDRShort(sum('loans'))}</dd></div></dl>
      ${list.length?accRowsHTML(list.slice(0,5)):'<p class="help" style="margin-top:8px">No card or loan balances in the snapshot.</p>'}
      ${dueHTML(raw)}
    </section>`;
  }
  const KIND_ICON={statement:'receipt',due:'calendar',missing:'triangle-alert',manual:'download'};
  function comingHTML(raw){
    const xs=comingItems(raw),t=today();
    const when=x=>{const n=daysBetween(t,x.date);if(n<0)return`<span class="warn">${-n} day${n===-1?'':'s'} late · ${escH(dayShort(x.date))}</span>`;
      const s=n===0?'Today':n===1?'Tomorrow':`In ${n} days · ${dayShort(x.date)}`;return x.kind==='due'&&n<=7?`<span class="warn">${escH(s)}</span>`:escH(s);};
    return`<section class="card span-5" id="homeComing" aria-label="Coming up">
      ${cardHead('calendar','Coming up','Statements and dues in the next 14 days')}
      ${xs.length?`<div class="list">${xs.map(x=>`<div class="list-item" data-kind="${escH(x.kind||'')}"><span class="cat-square sm" style="background:${x.kind==='missing'?'var(--warn-soft)':'var(--surface-2)'};color:${x.kind==='missing'?'var(--warn)':'var(--text-2)'}">${ic(KIND_ICON[x.kind]||'calendar')}</span>
        <span class="li-body"><span class="li-title" style="display:block">${escH(x.label||x.account||'')}</span><span class="li-sub" style="display:block">${when(x)}${x.account&&x.label?` · ${escH(x.account)}`:''}</span></span>
        ${x.amount!=null&&!isNaN(+x.amount)?`<span style="font-weight:600;white-space:nowrap">${money(+x.amount)}</span>`:''}</div>`).join('')}</div>`
        :emptyHTML('calendar-check','Nothing due in the next 14 days')}
    </section>`;
  }
  function freshHTML(){
    const rows=freshRows();
    return`<section class="card span-4" id="homeFresh" aria-label="Data freshness">
      ${cardHead('clock','Data freshness','How current each source is')}
      <div class="list">${rows.map(r=>`<div class="list-item" data-key="${r.key}"${r.stale?' data-stale="1"':''}><span class="li-body"><span class="li-title" style="display:block">${escH(r.label)}</span>
        <span class="li-sub" style="display:block">${escH(r.sub)}${r.date&&r.key!=='gmail'?` · ${escH(dayLong(r.date))}${r.age!=null?` · ${r.age} d ago`:''}`:''}</span></span>
        ${r.stale?'<span class="badge warn">Stale</span>':r.date?'':'<span class="badge">Missing</span>'}</div>`).join('')}</div>
      <p class="help" style="margin-top:8px">Stale: book over ${STALE_BOOK} days old, a statement over ${STALE_STMT} days, Gmail over ${STALE_GMAIL} days.</p>
    </section>`;
  }
  function connectHTML(){
    return`<div class="grid"><section class="card span-12" id="homeConnect" style="text-align:center;padding:40px 24px">
      <span class="empty-ring">${ic('trending-up','s24')}</span>
      <h2 class="card-title" style="font-size:18px;line-height:24px;margin:16px 0 6px">Connect your wealth snapshot</h2>
      <p class="muted" style="max-width:520px;margin:0 auto 20px">Home shows your net worth, real savings and what moved them once the monthly snapshot of your accounting book is in. Connect its folder on this computer, or import the file.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        ${typeof fsSupported==='function'&&fsSupported()?`<button class="btn btn-primary" onclick="connectWealthFolder()">${ic('download')}Connect snapshot folder</button>`:''}
        <button class="btn ${typeof fsSupported==='function'&&fsSupported()?'btn-secondary':'btn-primary'}" onclick="importWealthFile()">Import snapshot file…</button>
      </div></section></div>`;
  }
  function render(){
    const w=W(),M=w?model():null,raw=comingRaw();LAST=M;
    const ok=M&&M.pts.length;
    const head=pageHead('Home',ok?`Your wealth at a glance · ${wealthSourceLine()}`:'Your wealth at a glance',ok?`${nwViewSeg()}${hideBtn()}`:hideBtn());
    if(!ok)return`${head}${connectHTML()}<div class="grid">${comingHTML(raw).replace('span-5','span-6')}${freshHTML().replace('span-4','span-6')}</div>`;
    const p=M.pts[M.L],mkMissing=NW_VIEW==='market'&&!p.mk;
    return`${head}<div class="only-sm" style="margin-bottom:12px">${nwViewSeg()}</div>
      ${mkMissing?`<div class="h-note info">${ic('info')}<span>No market values recorded for ${escH(monthLabel(p.month,true))} yet — showing book values.</span></div>`:''}
      <div class="grid">${nwCardHTML(M)}${savingsCardHTML(M)}</div>
      <div class="grid">${bridgeCardHTML(M)}${comingHTML(raw)}</div>
      <div class="grid">${liquidityHTML(M)}${debtsHTML(M,raw)}${freshHTML()}</div>`;
  }
  function savReadout(r){const el=$('homeSavReadout');if(el&&r)el.innerHTML=`${escH(monthLabel(r.month))}${r.kind==='prov'?' · provisional':''} · <b class="amt">${amountsHidden()?'•••':signedText(r.v,true)}</b>${r.eq?' '+eqBadge:''}`;}
  function afterRender(){
    const el=$('homeSavChart');if(!el||!LAST)return;
    if(CHARTS.homeSav){try{CHARTS.homeSav.destroy();}catch(_){}}
    const rows=savRows(LAST),mobile=isMobile(),good=cssVar('--good'),bad=cssVar('--bad'),warn=cssVar('--warn');
    const col=r=>r.v>=0?good:bad,last=[...rows].reverse().find(r=>r.v!=null);
    savReadout(last);
    CHARTS.homeSav=new Chart(el,{type:'bar',data:{labels:rows.map(r=>monthLabel(r.month).replace(/ \d{4}$/,'')),datasets:[{data:rows.map(r=>r.v),
        backgroundColor:rows.map(r=>r.v==null?'transparent':r.kind==='prov'?hexA(col(r),0.25):col(r)),borderColor:rows.map(r=>r.v==null?'transparent':r.eq?warn:col(r)),
        borderWidth:rows.map(r=>r.eq?2:r.kind==='prov'?1.5:0),borderRadius:6,borderSkipped:false,maxBarThickness:mobile?18:28}]},
      options:{responsive:true,maintainAspectRatio:false,...animOnce(),
        onClick:(e,els)=>{if(els.length){const r=rows[els[0].index];if(r&&r.v!=null)H.month(r.month);}},
        onHover:(e,els)=>{if(els.length){const r=rows[els[0].index];if(r&&r.v!=null)savReadout(r);}},
        plugins:{tooltip:{enabled:!mobile,displayColors:false,callbacks:{title:it=>monthLabel(rows[it[0].dataIndex].month,true)+(rows[it[0].dataIndex].kind==='prov'?' · provisional':'')+(rows[it[0].dataIndex].eq?' · '+EQ_TXT:''),
          label:c=>amountsHidden()?'•••':signedText(c.parsed.y)}}},
        scales:{x:{grid:{display:false},border:{display:false},ticks:{maxTicksLimit:mobile?6:12,maxRotation:0}},y:{border:{display:false},ticks:{maxTicksLimit:5,callback:moneyTick}}}}});
  }
  // Re-draw only the bridge card (keeps the chart and the scroll position), then put focus back.
  function patchBridge(focusSel){
    const el=$('homeBridge');if(!el||!LAST){renderAll();return;}
    el.outerHTML=bridgeCardHTML(LAST);
    if(focusSel){const f=document.querySelector('#homeBridge '+focusSel);if(f)f.focus();}
  }
  const H={
    month(m){SEL=m;OPEN=null;patchBridge('#homeBridgeMonth');},
    open(k){OPEN=OPEN===k?null:k;patchBridge(`[data-part="${k}"]`);},
    ledger(code,from,to){if(typeof window.openLedger==='function')window.openLedger(code,from,to);},
    journals(kind,month){if(typeof window.openJournals==='function')window.openJournals({from:`${month}-01`,to:mEnd(month),kind});},
    acc(code){if(typeof window.openLedger==='function'){window.openLedger(code);return;}ACC_SEL=code;setTab('accounts');},
    cash(month,g){CM_MONTH=month;CM_FILTER=g==='in'||g==='out'?g:'all';CM_TYPE=null;CM_LIMIT=50;setTab('cash');},
    // For tests and other modules: plain data, no HTML.
    model(){const M=model();return{points:M.pts.filter(p=>!p.missing).map(p=>({month:p.month,kind:p.kind,market:p.mk,book:R(p.tot.book.net),marketNet:R(p.tot.market.net),carried:p.carried.length})),
      savings:M.sav.map(s=>({month:s.month,kind:s.kind,v:s.v,val:s.val,eq:!!s.eq})),
      bridges:M.bridges.map(b=>({month:b.month,prev:b.prev,kind:b.kind,val:b.val,open:b.open,close:b.close,change:b.change,income:b.income,expense:b.expense,reval:b.reval,other:b.other,src:b.pl.src,
        typedIn:b.pl.typedIn,stmtIn:b.pl.stmtIn,equity:b.pl.eq?sumV(b.pl.eq):null}))};},
    fresh(){return freshRows();},
    coming(){return comingItems(comingRaw());},
    due(){return nextDue(comingRaw());},
    parseDue,
  };
  window.etHome=H;

  /* ── Icons (the styles are in the core stylesheet, "v2 modules" section) ── */
  registerIcon('piggy-bank','<path d="M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z"/><path d="M16 10h.01"/><path d="M2 8v1a2 2 0 0 0 2 2h1"/>');
  registerIcon('clock','<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>');
  registerPage({key:'home',label:'Home',short:'Home',icon:'house',group:'top',order:5,render,afterRender});
})();
