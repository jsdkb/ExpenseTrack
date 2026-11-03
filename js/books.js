/* ExpenseTrack v2 — Books module.
   Owner: Books builder (A). Pages: coa, journals, ledger, bs, pl, tb (group 'books'), plus the
   cross-page helpers window.openLedger(code, fromDate?, toDate?) and
   window.openJournals({from?, to?, kind?}).

   Loaded by index.html after the core script, in this fixed order: books, home, statements,
   extras. Everything here runs in the page's global scope, so keep it inside the function below
   and put only deliberate cross-module helpers on window. Contract: docs/v2-interfaces.md.

   Registry API (defined in index.html):
     registerPage({key, label, short?, icon, group, order, render, afterRender?, needs?}) -> bool
       group: 'top' | 'wealth' | 'books' | 'plan'; render(page) returns the page's HTML;
       afterRender(page) runs on the next frame (draw charts into CHARTS[id] so they are cleaned up).
     registerHook(name, fn)        runHooks(name, ...args) -> array of non-null results
     registerIcon(name, svgInner)  adds a Lucide icon for ic(name)
     BOOKS() -> et-books/1 data or null    booksStatus() -> idle|loading|ready|none|error
     ensureBooks() -> Promise              reloadBooks() -> Promise (Retry after an error)
   No personal data in this file: the repo is public.

   The book is read-only here. Amounts in books.json are whole rupiah, debit positive. On screen
   every account shows its natural sign: assets and expenses debit-positive, liabilities, equity
   and income credit-positive. Balances in books.json are cumulative with no year-end closing, so
   the balance sheet carries the income statement accounts as "earnings from earlier years" (to
   December of the prior year) plus "current-year earnings" (year to date), and always balances.

   Every interactive element carries data-bk="<action>"; one delegated listener per event type
   handles them, so nothing but openLedger needs to be global. */
(function(){
  'use strict';

  /* ── Icons and styles (tokens only; light and dark come from the core variables) ── */
  registerIcon('list-tree','<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>');
  registerIcon('book-open','<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>');
  registerIcon('file-text','<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>');
  registerIcon('scale','<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>');
  // Styles: the core stylesheet in index.html ("v2 modules" section).

  /* ── Small formatting helpers ── */
  const PAGE_KEYS=['coa','journals','ledger','bs','pl','tb'];
  const KIND_LABEL={asset:'Assets',liability:'Liabilities',equity:'Equity',income:'Income',expense:'Expenses'};
  const KIND_ORDER=['asset','liability','equity','income','expense'];
  const sgn=k=>(k==='asset'||k==='expense')?1:-1;          // raw (debit +) → natural sign
  const isPL=k=>k==='income'||k==='expense';
  const money=n=>n==null?'<span class="faint">—</span>':(n=n||0,`<span class="amt">${n<0?'−'+fmtIDR(-n):fmtIDR(n)}</span>`);
  const kpiSigned=n=>(n=n||0)<0?`<span class="amt">−</span>${kpiMoney(-n)}`:kpiMoney(n);
  const plain=n=>n?`<span class="amt">${fmtIDR(n)}</span>`:'';
  const dayOf=iso=>new Date(iso+'T00:00:00');
  const dLong=iso=>fmtDayLong(dayOf(iso));
  const dShort=iso=>fmtDay(dayOf(iso));
  const decBefore=M=>`${Number(M.slice(0,4))-1}-12`;
  const firstDay=M=>M+'-01';
  const yearStart=M=>M.slice(0,4)+'-01-01';
  const attr=s=>escH(s);
  // emptyHTML with a data-bk action instead of an inline handler.
  const emptyBk=(icon,text,label,action)=>`<div class="empty">${ic(icon,'s40')}<div class="e-title">${escH(text)}</div>${label?`<button class="btn btn-ghost btn-sm" data-bk="${action}">${escH(label)}</button>`:''}</div>`;

  /* ── Index over the imported books, rebuilt only when BOOKS() returns a different object ── */
  let I=null,I_SRC=null;
  function idx(){
    const b=BOOKS();if(!b)return null;
    if(I_SRC===b&&I)return I;
    I_SRC=b;I=buildIdx(b);J_CACHE.key=null;return I;
  }
  function buildIdx(b){
    const acc=new Map(),kids=new Map(),roots=[];
    for(const a of b.accounts)if(a&&a.id!=null)acc.set(String(a.id),{...a,id:String(a.id)});
    // A line or balance on a code the chart doesn't list still shows, as its own top-level account.
    const extra=code=>{if(!acc.has(code))acc.set(code,{id:code,name:code,type:'',kind:'asset',parent:null,isParent:false,suspended:false,order:1e9,ccy:'IDR',unknown:true});};
    for(const v of b.vouchers)for(const l of v.lines||[])extra(String(l.account));
    for(const m of b.months)for(const k of Object.keys((b.balances||{})[m]||{}))extra(k);
    for(const a of acc.values()){const p=a.parent!=null&&acc.has(String(a.parent))&&String(a.parent)!==a.id?String(a.parent):null;a._p=p;
      if(p){if(!kids.has(p))kids.set(p,[]);kids.get(p).push(a.id);}else roots.push(a.id);}
    const ord=(x,y)=>{const a=acc.get(x),c=acc.get(y);return(a.order??1e9)-(c.order??1e9)||x.localeCompare(y,undefined,{numeric:true});};
    roots.sort(ord);for(const l of kids.values())l.sort(ord);
    const depth=new Map(),flat=[];
    const walk=(id,d)=>{depth.set(id,d);flat.push(id);for(const c of kids.get(id)||[])walk(c,d+1);};
    roots.forEach(r=>walk(r,0));
    const months=[...b.months].sort();
    const n=b.vouchers.length,vDr=new Array(n),vText=new Array(n),vType=new Array(n),byKey=new Map(),byAcc=new Map(),sigs=new Map(),types=new Map();
    for(let i=0;i<n;i++){
      const v=b.vouchers[i];let dr=0;const ls=v.lines||[];
      for(let j=0;j<ls.length;j++){const l=ls[j],c=String(l.account);if(l.amount>0)dr+=l.amount;let a=byAcc.get(c);if(!a)byAcc.set(c,a=[]);a.push(i,j);}
      vDr[i]=dr;vText[i]=`${v.number||''} ${v.description||''}`.toLowerCase();
      const t=[v.source,v.type].filter(Boolean).join(' · ')||'Other';vType[i]=t;types.set(t,(types.get(t)||0)+1);
      byKey.set(String(v.key),i);
      const s=sigOf(v);sigs.set(s,(sigs.get(s)||0)+1);
    }
    return{b,acc,kids,roots,depth,flat,months,vDr,vText,vType,byKey,byAcc,sigs,types,leafMemo:new Map(),rollMemo:new Map(),glCheck:null,prepMemo:null};
  }
  // The signature behind "prepared, not in the book yet" (see preparedVouchers).
  function sigOf(v){
    let dr=0;const s=new Set();
    for(const l of v.lines||[]){const a=Math.round(l.amount||0);if(a>0)dr+=a;if(a)s.add(String(l.account));}
    return`${v.date}|${dr}|${[...s].sort().join(',')}`;
  }
  function leavesOf(code){
    const m=I.leafMemo;if(m.has(code))return m.get(code);
    const out=[],walk=c=>{const k=I.kids.get(c);if(k&&k.length)k.forEach(walk);else out.push(c);};
    walk(code);m.set(code,out);return out;
  }
  function kindOf(code){const a=I.acc.get(code);return a?a.kind:'asset';}
  function accName(code){const a=I.acc.get(code);return a?a.name:code;}
  function isParentAcc(code){return(I.kids.get(code)||[]).length>0;}
  // The newest month in books.months on or before M (null before the first month: balances 0).
  function monthOnOrBefore(M){
    const ms=I.months;let lo=0,hi=ms.length-1,r=null;
    while(lo<=hi){const mid=(lo+hi)>>1;if(ms[mid]<=M){r=ms[mid];lo=mid+1;}else hi=mid-1;}
    return r;
  }
  // Raw (debit +) balance of every account at month-end M, parents rolled up from their children.
  function roll(M){
    const key=monthOnOrBefore(M)||'';
    if(I.rollMemo.has(key))return I.rollMemo.get(key);
    const bm=key?(I.b.balances[key]||{}):{},out=new Map();
    const walk=c=>{const k=I.kids.get(c);let v;if(k&&k.length){v=0;for(const x of k)v+=walk(x);}else v=Math.round(bm[c]||0);out.set(c,v);return v;};
    I.roots.forEach(walk);I.rollMemo.set(key,out);return out;
  }
  const rawAt=(code,M)=>roll(M).get(code)||0;
  const hasMonth=M=>!!I.months.length&&M>=I.months[0];
  // Natural-sign amount of the income statement accounts (net result) cumulated to month-end M.
  function plNet(M){const r=roll(M);let s=0;for(const c of I.roots)if(isPL(kindOf(c)))s+=r.get(c)||0;return s?-s:0;}

  /* ── Page state shared by every Books page ── */
  const BK={month:null,coaAll:false,coaQ:'',jPeriod:'all',jFrom:'',jTo:'',jAcc:'',jType:'',jQ:'',jPage:0,jSel:null,
    lAcc:null,lPreset:'ytd',lFrom:'',lTo:'',lLimit:300,bsView:'book',bsCol:0,plCol:1};
  const J_SIZE=50;
  let J_CACHE={key:null,list:null};
  function syncMonth(){const ms=I.months;if(!BK.month||!ms.includes(BK.month))BK.month=ms[ms.length-1]||null;return BK.month;}

  /* ── Market values (the Net worth lookup: a value recorded at an in-app close first, then the
     snapshot's W().market[month][code]). Only asset accounts have one. ── */
  function marketOf(code,M){
    if(typeof W!=='function'||!W())return null;
    const am=((STATE.monthEnd||{})[M]||{}).market||{};
    if(am[code]&&am[code].v!=null)return Math.round(am[code].v);
    const mk=(W().market||{})[M];
    return mk&&mk[code]!=null?Math.round(mk[code]):null;
  }
  function marketMonthKnown(M){
    if(typeof W!=='function'||!W())return false;
    const mi=wMonths().findIndex(m=>m.month===M);
    if(mi>=0)return hasMarket(mi);
    const am=((STATE.monthEnd||{})[M]||{}).market;return!!(am&&Object.keys(am).length);
  }

  /* ── States: loading, error, nothing imported ── */
  function sourceLine(){
    const b=BOOKS(),m=STATE.booksMeta||{};if(!b)return'';
    const gl=b.source&&b.source.glAsOf?`, entries to ${dLong(b.source.glAsOf)}`:'';
    return`From your accounting book${gl}${m.importedAt?` · imported ${fmtDateTime(m.importedAt)}`:''} · read-only`;
  }
  function gateHTML(title){
    if(BOOKS())return null;
    const st=booksStatus();
    if(st==='error')return`${pageHead(title,'')}<div class="card" id="bkState" data-state="error">${cardHead('triangle-alert','Couldn’t load your books','')}
      <p class="muted" style="margin:0 0 12px">Couldn’t reach Google Drive for your books file. Check your connection and retry.</p>
      <button class="btn btn-ghost btn-sm" data-bk="retry">${ic('refresh-cw','s16')}Retry</button></div>`;
    if(st==='none')return`${pageHead(title,'Your accounting book, read-only')}
      <div class="card" id="bkState" data-state="none" style="text-align:center;padding:48px 24px">
        <span class="empty-ring">${ic('book-open','s24')}</span>
        <h2 class="card-title" style="font-size:18px;line-height:24px;margin:16px 0 6px">Import your books</h2>
        <p class="muted" style="max-width:500px;margin:0 auto 20px">These pages read <code>books.json</code>: your chart of accounts, every voucher and the month-end balances, built on your computer next to the wealth snapshot. Import it once here; your other devices get it through your Drive. The app never changes your book.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          ${typeof fsSupported==='function'&&fsSupported()?`<button class="btn btn-primary" data-bk="connect">${ic('download')}Connect snapshot folder</button>`:''}
          <button class="btn ${typeof fsSupported==='function'&&fsSupported()?'btn-secondary':'btn-primary'}" data-bk="import">Import books file…</button>
        </div>
        <p class="help" style="margin-top:14px">File: <code>accurate-desktop-db\\exports\\&lt;book&gt;\\wealth\\books.json</code> on your computer</p></div>`;
    const sk=(w,h,mt)=>`<div class="skel" style="width:${w};height:${h}px${mt?`;margin-top:${mt}px`:''}"></div>`;
    return`${pageHead(title,'Loading your books…')}<div class="card" id="bkState" data-state="loading" aria-busy="true" aria-label="Loading">
      ${sk('35%',14)}${[1,2,3,4,5,6].map(()=>sk('100%',18,14)).join('')}</div>`;
  }

  /* ── Shared controls ── */
  function monthPicker(){
    const ms=I.months,i=ms.indexOf(BK.month);
    return`<div class="bk-month"><button class="icon-btn sm" data-bk="mstep" data-d="-1" aria-label="Earlier month" ${i<=0?'disabled':''}>${ic('chevron-left')}</button>
      <select class="input" data-bk="month" aria-label="Month-end">${[...ms].reverse().map(m=>`<option value="${attr(m)}"${m===BK.month?' selected':''}>${escH(monthLabel(m,true))}</option>`).join('')}</select>
      <button class="icon-btn sm" data-bk="mstep" data-d="1" aria-label="Later month" ${i>=ms.length-1?'disabled':''}>${ic('chevron-right')}</button></div>`;
  }
  function xlBtn(r){return`<button class="btn btn-secondary btn-sm" data-bk="xl" data-r="${r}">${ic('download','s16')}Download Excel</button>`;}
  function ledgerLink(code,from,to,hover){
    return`<button class="bk-link${hover?' bk-hover':''}" data-bk="led" data-code="${attr(code)}"${from?` data-from="${attr(from)}"`:''}${to?` data-to="${attr(to)}"`:''} aria-label="Open ledger for ${attr(code)}">Ledger${ic('chevron-right')}</button>`;
  }
  function colSeg(page,labels,cur){
    return`<div class="seg sm only-sm" role="group" aria-label="Column">${labels.map((l,i)=>`<button aria-pressed="${i===cur}" data-bk="col" data-p="${page}" data-i="${i}">${escH(l)}</button>`).join('')}</div>`;
  }
  function accOptions(sel,blank){
    let o=blank?`<option value="">${escH(blank)}</option>`:'';
    for(const k of KIND_ORDER){
      const ids=I.flat.filter(c=>kindOf(c)===k);if(!ids.length)continue;
      o+=`<optgroup label="${attr(KIND_LABEL[k])}">${ids.map(c=>`<option value="${attr(c)}"${c===sel?' selected':''}>${'  '.repeat(I.depth.get(c)||0)}${escH(c)} · ${escH(accName(c))}</option>`).join('')}</optgroup>`;
    }
    return o;
  }

  /* ── Statement rows (balance sheet, income statement) — the same rows feed the screen and Excel ── */
  // Depth-first over the chart for one kind. leafVals(code) → array of numbers (or null = no data).
  // Parent values are the sum of their children, so a roll-up always equals its children.
  function treeRows(kind,leafVals,ncol,showZero){
    const rows=[];
    const walk=(c,d)=>{
      const k=I.kids.get(c),mine=[];let vals;
      if(k&&k.length){vals=new Array(ncol).fill(0);const sub=[];for(const x of k){const r=walk(x,d+1);if(r){sub.push(...r.rows);r.vals.forEach((v,i)=>{if(v!=null&&vals[i]!=null)vals[i]+=v;});}}
        if(!sub.length&&!showZero)return null;
        mine.push({t:'acc',code:c,name:accName(c),depth:d,parent:true,vals},...sub);}
      else{if(kindOf(c)!==kind)return null;vals=leafVals(c);if(!showZero&&vals.every(v=>!v))return null;mine.push({t:'acc',code:c,name:accName(c),depth:d,parent:false,vals});}
      return{rows:mine,vals};
    };
    const tot=new Array(ncol).fill(0);
    for(const r of I.roots){if(kindOf(r)!==kind&&!isParentAcc(r))continue;const x=walk(r,0);if(!x)continue;rows.push(...x.rows);x.vals.forEach((v,i)=>{if(v!=null)tot[i]+=v;});}
    return{rows,tot};
  }
  const addV=(a,b)=>a.map((v,i)=>v==null||b[i]==null?null:v+b[i]);
  const subV=(a,b)=>a.map((v,i)=>v==null||b[i]==null?null:v-b[i]);

  function bsData(M,view){
    const cols=[M,meShift(M,-1),decBefore(M)].map(c=>({m:c,ok:hasMonth(c)}));
    const market=view==='market';
    let reval=cols.map(()=>0);
    const leaf=k=>c=>cols.map((col,i)=>{if(!col.ok)return null;const bk=sgn(k)*rawAt(c,col.m);
      if(market&&k==='asset'){const mv=marketOf(c,col.m);if(mv!=null){reval[i]+=mv-bk;return mv;}}return bk;});
    const nul=v=>cols.map((c,i)=>c.ok?v[i]:null);
    const A=treeRows('asset',leaf('asset'),3),L=treeRows('liability',leaf('liability'),3),E=treeRows('equity',leaf('equity'),3);
    const prior=nul(cols.map(c=>plNet(decBefore(c.m)))),cur=nul(cols.map(c=>plNet(c.m)-plNet(decBefore(c.m))));
    reval=nul(reval);
    const totA=nul(A.tot),totL=nul(L.tot),eqExtra=[];
    if(prior.some(v=>v))eqExtra.push({t:'acc',code:'',name:'Earnings from earlier years (not closed in the book)',depth:0,parent:false,vals:prior,calc:'prior'});
    eqExtra.push({t:'acc',code:'',name:'Current-year earnings',depth:0,parent:false,vals:cur,calc:'cy'});
    if(market&&reval.some(v=>v))eqExtra.push({t:'acc',code:'',name:'Market revaluation (outside the book)',depth:0,parent:false,vals:reval,calc:'reval'});
    let totE=nul(E.tot);for(const r of eqExtra)totE=addV(totE,r.vals);
    const totLE=addV(totL,totE),diff=subV(totA,totLE);
    const rows=[{t:'sec',name:'Assets'},...A.rows,{t:'tot',name:'Total assets',vals:totA,id:'A'},
      {t:'sec',name:'Liabilities'},...L.rows,{t:'tot',name:'Total liabilities',vals:totL,id:'L'},
      {t:'sec',name:'Equity'},...E.rows,...eqExtra,{t:'tot',name:'Total equity',vals:totE,id:'E'},
      {t:'grand',name:'Total liabilities and equity',vals:totLE,id:'LE'}];
    return{cols,rows,totA,totL,totE,totLE,diff,cur,prior,reval,
      heads:[`${monthLabel(cols[0].m)}`,`${monthLabel(cols[1].m)}`,`Start of year (${monthLabel(cols[2].m)})`]};
  }
  function plData(M){
    const ranges=[[meShift(M,-1),M,'Month'],[decBefore(M),M,'Year to date'],[meShift(M,-12),M,'Last 12 months']];
    const leaf=k=>c=>ranges.map(([s,e])=>sgn(k)*(rawAt(c,e)-rawAt(c,s)));
    const inc=treeRows('income',leaf('income'),3),exp=treeRows('expense',leaf('expense'),3);
    const net=subV(inc.tot,exp.tot);
    const rows=[{t:'sec',name:'Income'},...inc.rows,{t:'tot',name:'Total income',vals:inc.tot,id:'I'},
      {t:'sec',name:'Expenses'},...exp.rows,{t:'tot',name:'Total expenses',vals:exp.tot,id:'X'},
      {t:'grand',name:'Net result',vals:net,id:'N'}];
    const fromOf=s=>{const d=meShift(s,1);return firstDay(d);};
    return{ranges:ranges.map(([s,e,l])=>({from:fromOf(s),to:meMonthEnd(e),label:l})),rows,inc:inc.tot,exp:exp.tot,net,
      heads:[monthLabel(M),`Jan – ${monthLabel(M).replace(/ \d{4}$/,'')} ${M.slice(0,4)}`,`12 months to ${monthLabel(M)}`]};
  }
  function stmtTableHTML(d,phoneCol,link){
    const ncol=d.heads.length;
    const cls=i=>i===phoneCol?'':' bk-c-off';
    const head=`<thead><tr><th scope="col">Account</th>${d.heads.map((h,i)=>`<th scope="col" class="num${cls(i)}">${escH(h)}</th>`).join('')}</tr></thead>`;
    const body=d.rows.map(r=>{
      if(r.t==='sec')return`<tr class="bk-sec"><th scope="rowgroup" colspan="${ncol+1}">${escH(r.name)}</th></tr>`;
      const vals=r.vals.map((v,i)=>`<td class="num${cls(i)}" data-raw="${v==null?'':v}">${money(v)}</td>`).join('');
      if(r.t!=='acc')return`<tr class="${r.t==='grand'?'bk-grand':'bk-tot'}" data-tot="${r.id||''}"><td>${escH(r.name)}</td>${vals}</tr>`;
      const pad=`padding-left:${16+r.depth*16}px`;
      if(!r.code)return`<tr class="bk-row" data-calc="${r.calc||''}"><td class="bk-acc" style="${pad}"><div class="merchant-name">${escH(r.name)}</div></td>${vals}</tr>`;
      return`<tr class="clickable ${r.parent?'bk-par':'bk-row'}" data-bk="led" data-code="${attr(r.code)}"${link?` data-from="${attr(link.from)}" data-to="${attr(link.to)}"`:''} data-row="${attr(r.code)}" tabindex="0">
        <td class="bk-acc" style="${pad}"><div class="merchant-name"><span class="bk-code">${escH(r.code)}</span>${escH(r.name)}${ledgerLink(r.code,link&&link.from,link&&link.to,true)}</div></td>${vals}</tr>`;
    }).join('');
    return`<div class="table-wrap"><table class="data bk-stmt">${head}<tbody>${body}</tbody></table></div>`;
  }

  /* ── Excel (ExcelJS via the core's on-demand loader xlLib) ── */
  async function xlReport(o){
    let X;try{X=await xlLib();}catch(e){toast(e.message);return false;}
    const wb=new X.Workbook(),ws=wb.addWorksheet(o.sheet,{views:[{state:'frozen',ySplit:3,xSplit:2}]});
    ws.columns=o.widths.map(w=>({width:w}));
    ws.getCell('A1').value=o.title;ws.getCell('A1').font={bold:true,size:14};
    ws.getCell('A2').value=o.sub;ws.getCell('A2').font={italic:true,color:{argb:'FF555555'}};
    const hr=ws.getRow(3);o.head.forEach((h,i)=>{const c=hr.getCell(i+1);c.value=h;c.font={bold:true};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE7E6E6'}};c.border={bottom:{style:'thin'}};if(i>=2)c.alignment={horizontal:'right'};});
    const FMT='#,##0;-#,##0;0';
    o.rows.forEach((r,k)=>{
      const row=ws.getRow(4+k);row.values=r.v;
      for(let i=3;i<=r.v.length;i++)row.getCell(i).numFmt=FMT;
      row.getCell(1).numFmt='@';
      if(r.indent)row.getCell(2).alignment={indent:r.indent};
      if(r.s==='sec'){row.getCell(1).font={bold:true};row.getCell(2).font={bold:true};}
      if(r.s==='par')row.eachCell(c=>{c.font={bold:true};});
      if(r.s==='tot'||r.s==='grand')row.eachCell({includeEmpty:true},c=>{c.font={bold:true};c.border={top:{style:r.s==='grand'?'double':'thin'}};});
    });
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=o.file;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast(`Saved ${o.file} to your downloads`);return true;
  }
  function stmtXlRows(d){
    return d.rows.map(r=>{
      if(r.t==='sec')return{v:[r.name.toUpperCase()],s:'sec'};
      if(r.t!=='acc')return{v:['',r.name,...r.vals],s:r.t==='grand'?'grand':'tot'};
      return{v:[r.code||'',r.name,...r.vals],s:r.parent?'par':'acc',indent:r.depth};
    });
  }
  function xlBS(){
    const M=BK.month,d=bsData(M,BK.bsView);
    const rows=stmtXlRows(d);
    rows.push({v:['','Check: assets − (liabilities + equity)',...d.diff],s:'tot'});
    return xlReport({file:`balance-sheet-${M}.xlsx`,sheet:'Balance sheet',
      title:`Balance sheet as at ${dLong(meMonthEnd(M))}`,
      sub:`${BK.bsView==='market'?'Market value where recorded, book value elsewhere':'Book value'} · amounts in Rp · natural sign (credit balances of liabilities and equity shown positive)`,
      head:['Code','Account',...d.heads],widths:[12,46,20,20,24],rows});
  }
  function xlPL(){
    const M=BK.month,d=plData(M);
    return xlReport({file:`income-statement-${M}.xlsx`,sheet:'Income statement',
      title:`Income statement to ${dLong(meMonthEnd(M))}`,sub:'Amounts in Rp · income and expenses shown positive; net result = income − expenses',
      head:['Code','Account',...d.heads],widths:[12,46,20,22,24],rows:stmtXlRows(d)});
  }
  function xlTB(){
    const M=BK.month,t=tbData(M);
    const rows=t.rows.map(r=>({v:[r.code,r.name,KIND_LABEL[r.kind]||'',r.dr||null,r.cr||null,r.mdr||null,r.mcr||null]}));
    rows.push({v:['','Total','',t.dr,t.cr,t.mdr,t.mcr],s:'grand'});
    rows.push({v:['','Difference (debits − credits)','',t.dr-t.cr,null,t.mdr-t.mcr,null],s:'tot'});
    return xlReport({file:`trial-balance-${M}.xlsx`,sheet:'Trial balance',
      title:`Trial balance as at ${dLong(meMonthEnd(M))}`,sub:'Amounts in Rp · balances are cumulative from the book’s lines',
      head:['Code','Account','Kind','Debit balance','Credit balance',`Debits in ${monthLabel(M)}`,`Credits in ${monthLabel(M)}`],widths:[12,44,12,18,18,18,18],rows});
  }

  /* ── Chart of accounts ── */
  // Inactive = no movement in the 12 months up to the chosen month-end and (balance-sheet accounts)
  // a zero balance at it. A parent is inactive when every child is.
  function inactiveSet(M){
    const ms=I.months.filter(m=>m<=M).slice(-12),out=new Set(),r=roll(M);
    for(const c of I.flat){if(isParentAcc(c))continue;
      const moved=ms.some(m=>((I.b.activity||{})[m]||{})[c]);
      if(!moved&&(isPL(kindOf(c))||!(r.get(c)||0)))out.add(c);}
    const up=c=>{const k=I.kids.get(c);if(!k||!k.length)return out.has(c);let all=true;for(const x of k)if(!up(x))all=false;if(all)out.add(c);return all;};
    I.roots.forEach(up);return out;
  }
  function coaValue(c,M){const k=kindOf(c),r=rawAt(c,M);return sgn(k)*(isPL(k)?r-rawAt(c,decBefore(M)):r);}
  function renderCOA(){
    const g=gateHTML('Chart of accounts');if(g)return g;
    idx();const M=syncMonth(),q=BK.coaQ.trim().toLowerCase(),inact=inactiveSet(M);
    const susp=c=>{let x=c;while(x){const a=I.acc.get(x);if(a&&a.suspended)return true;x=a&&a._p;}return false;};
    const hidden=c=>!BK.coaAll&&(inact.has(c)||susp(c));
    const match=c=>!q||c.toLowerCase().includes(q)||String(accName(c)).toLowerCase().includes(q);
    // Show an account when it (or a descendant) passes; ancestors of a match stay visible.
    const keep=new Set();
    const walk=c=>{if(hidden(c))return false;let any=match(c);for(const x of I.kids.get(c)||[])if(walk(x))any=true;if(any)keep.add(c);return any;};
    I.roots.forEach(walk);
    const nHidden=I.flat.filter(c=>!isParentAcc(c)&&hidden(c)).length;
    const ytd=`Jan – ${monthLabel(M).replace(/ \d{4}$/,'')}`;
    let lastKind=null;
    const rows=I.flat.filter(c=>keep.has(c)).map(c=>{
      const a=I.acc.get(c),k=kindOf(c),d=I.depth.get(c)||0,v=coaValue(c,M),par=isParentAcc(c);
      let sec='';if(d===0&&k!==lastKind){lastKind=k;sec=`<tr class="bk-sec"><th scope="rowgroup" colspan="4">${escH(KIND_LABEL[k]||k)}${isPL(k)?` · ${escH(ytd)}`:''}</th></tr>`;}
      const badges=[a.suspended?'<span class="badge">Suspended</span>':'',inact.has(c)&&!par?'<span class="badge">Inactive</span>':'',a.ccy&&a.ccy!=='IDR'?`<span class="badge">${escH(a.ccy)}</span>`:'',a.unknown?'<span class="badge warn">Not in the chart</span>':''].join('');
      return sec+`<tr class="clickable ${par?'bk-par':'bk-row'}" data-bk="led" data-code="${attr(c)}" data-row="${attr(c)}" data-parent="${attr(a._p||'')}" tabindex="0">
        <td class="bk-acc" style="padding-left:${16+d*16}px"><div class="merchant-name"><span class="bk-code">${escH(c)}</span>${escH(a.name)}${ledgerLink(c,'','',true)}</div>${badges?`<div class="merchant-sub">${badges}</div>`:''}</td>
        <td class="muted hide-sm">${escH(a.type||'')}</td><td class="num" data-raw="${v}">${money(v)}</td></tr>`;
    }).join('');
    const total=I.flat.filter(c=>!isParentAcc(c)).length;
    return`${pageHead('Chart of accounts',sourceLine(),hideBtn())}
      <div class="bk-bar">${monthPicker()}
        <input class="input bk-search" type="search" data-bk="coa-q" placeholder="Search code or name" aria-label="Search accounts" value="${attr(BK.coaQ)}">
        <label class="check"><input type="checkbox" data-bk="coa-all" ${BK.coaAll?'checked':''}> Show inactive and suspended${nHidden&&!BK.coaAll?` (${nHidden})`:''}</label></div>
      <div class="grid"><section class="card flush span-12">${cardHead('list-tree','Accounts',`${total} accounts · balance at ${escH(dLong(meMonthEnd(M)))}; income and expenses year to date · assets and expenses debit-positive, liabilities, equity and income credit-positive`)}
        ${rows?`<div class="table-wrap"><table class="data bk-stmt" id="bkCoa"><thead><tr><th scope="col">Account</th><th scope="col" class="hide-sm">Type</th><th scope="col" class="num">Balance (natural sign)</th></tr></thead><tbody>${rows}</tbody></table></div>`
          :`<div style="padding:0 var(--card-pad) var(--card-pad)">${emptyBk('search',q?'No account matches that search':'No active accounts this month',BK.coaAll?'':'Show all accounts','coa-show')}</div>`}
      </section></div>`;
  }

  /* ── Prepared in the app, not in the book yet ──
     Sources, built by the same code their own pages use (no re-derivation here):
       Month-end: meVouchers(M) for every in-app close in STATE.monthEnd (meJournal for its issues).
       Income:    incVoucher(x) for every typed receipt with both accounts chosen.
     Rule: a prepared voucher counts as in the book once books.json has a voucher with the same
     date, the same total (sum of debits, whole rupiah) and the same set of accounts. Each book
     voucher matches at most one prepared voucher, so two identical receipts on one day need two
     book vouchers before both disappear. */
  function preparedAll(){
    const out=[];
    try{
      if(typeof W==='function'&&W()&&typeof meVouchers==='function'){
        for(const M of Object.keys(STATE.monthEnd||{}).filter(k=>/^\d{4}-\d{2}$/.test(k)).sort()){
          const j=meJournal(M);if(!j.lines.length||j.lines.some(l=>!l.account))continue;
          const v=meVouchers(M)[0];
          out.push({key:'prep|me|'+M,date:v.date,number:'',source:'App',type:'Month-end',description:v.description,from:'Month-end close',
            note:j.issues[0]||'',lines:v.lines.map(l=>({account:l.account,amount:l.amount,description:l.memo||''}))});
        }
      }
      if(typeof incList==='function'&&typeof incVoucher==='function'){
        for(const x of incList()){if(!x.account||!x.incomeAccount||!(x.amount>0))continue;
          const v=incVoucher(x);
          out.push({key:'prep|inc|'+x.id,date:v.date,number:'',source:'App',type:'Income',description:v.description,from:'Income',
            note:x.posted?'Ticked as posted in Accurate':x.exportedAt?'Saved for import':'Not downloaded for import yet',
            lines:v.lines.map(l=>({account:l.account,amount:l.amount,description:l.memo||''}))});}
      }
    }catch(e){console.warn('Books: prepared vouchers skipped',e);}
    return out.sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
  }
  function preparedOpen(){
    const left=new Map(I.sigs);
    return preparedAll().filter(v=>{const s=sigOf(v),n=left.get(s)||0;if(n>0){left.set(s,n-1);return false;}return true;});
  }

  /* ── Journals ── */
  function jRange(){
    if(BK.jPeriod==='custom')return[BK.jFrom||'',BK.jTo||'￿'];
    if(/^\d{4}-\d{2}$/.test(BK.jPeriod))return[firstDay(BK.jPeriod),meMonthEnd(BK.jPeriod)];
    return['','￿'];
  }
  // The account filter: one account (a parent includes its children) or every account of a kind
  // ('kind:income' / 'kind:expense', as set by openJournals or the picker's first options).
  function jAccSet(){
    const v=BK.jAcc;if(!v)return null;
    if(v.startsWith('kind:')){const k=v.slice(5);return new Set(I.flat.filter(c=>!isParentAcc(c)&&kindOf(c)===k));}
    return I.acc.has(v)?new Set(leavesOf(v)):null;
  }
  function jFiltered(){
    const key=[BK.jPeriod,BK.jFrom,BK.jTo,BK.jAcc,BK.jType,BK.jQ].join('\u0001');
    if(J_CACHE.key===key&&J_CACHE.src===I)return J_CACHE.list;
    const[from,to]=jRange(),vs=I.b.vouchers,terms=BK.jQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const accSet=jAccSet(),ty=BK.jType,out=[];
    for(let i=vs.length-1;i>=0;i--){
      const v=vs[i];if(v.date<from||v.date>to)continue;
      if(ty&&I.vType[i]!==ty)continue;
      if(terms.length){const t=I.vText[i];let ok=true;for(const x of terms)if(!t.includes(x)){ok=false;break;}if(!ok)continue;}
      if(accSet){let hit=false;for(const l of v.lines)if(accSet.has(String(l.account))){hit=true;break;}if(!hit)continue;}
      out.push(i);
    }
    J_CACHE={key,src:I,list:out};return out;
  }
  function jPrepFiltered(){
    if(BK.jType)return[];
    const[from,to]=jRange(),terms=BK.jQ.trim().toLowerCase().split(/\s+/).filter(Boolean),accSet=jAccSet();
    return preparedOpen().filter(v=>v.date>=from&&v.date<=to&&(!terms.length||terms.every(t=>v.description.toLowerCase().includes(t)))&&(!accSet||v.lines.some(l=>accSet.has(String(l.account))))).reverse();
  }
  function vTotal(v){return(v.lines||[]).reduce((s,l)=>s+(l.amount>0?Math.round(l.amount):0),0);}
  function voucherByKey(key){
    if(key==null)return null;
    if(String(key).startsWith('prep|'))return preparedAll().find(v=>v.key===key)||null;
    const i=I.byKey.get(String(key));return i==null?null:I.b.vouchers[i];
  }
  function voucherHTML(v){
    if(!v)return emptyHTML('book-open','Select a voucher to see its lines');
    const prep=String(v.key).startsWith('prep|');
    let dr=0,cr=0;
    const rows=(v.lines||[]).map(l=>{const a=Math.round(l.amount||0),c=String(l.account);if(a>0)dr+=a;else cr-=a;
      return`<tr><td class="bk-acc"><div class="merchant-name"><span class="bk-code">${escH(c)}</span>${escH(I.acc.has(c)?accName(c):c)}</div>
        <div class="merchant-sub">${l.description?`<span>${escH(l.description)}</span>`:''}${I.acc.has(c)?ledgerLink(c,'',v.date):''}</div></td>
        <td class="num hide-sm">${plain(a>0?a:0)}</td><td class="num hide-sm">${plain(a<0?-a:0)}</td><td class="num only-sm"><span class="bk-dc">${a<0?'Cr':'Dr'}</span>${plain(Math.abs(a))}</td></tr>`;}).join('');
    const bal=dr===cr;
    return`<div class="bk-vhead"><div class="eyebrow">${escH(dLong(v.date))} · ${escH([v.source,v.type].filter(Boolean).join(' · '))}</div>
        <div class="bk-vtitle">${escH(v.number||(prep?'No number yet':'No voucher number'))}</div>
        <div class="muted" style="overflow-wrap:anywhere">${escH(v.description||'')}</div>
        <div class="bk-badges">${prep?`<span class="badge warn">Prepared, not in Accurate yet</span><span class="badge">${escH(v.from)}</span>`:''}${v.note?`<span class="help">${escH(v.note)}</span>`:''}</div></div>
      <div class="table-wrap"><table class="data" id="bkVLines" data-key="${attr(v.key)}"><thead><tr><th scope="col">Account</th><th scope="col" class="num hide-sm">Debit</th><th scope="col" class="num hide-sm">Credit</th><th scope="col" class="num only-sm">Amount</th></tr></thead>
        <tbody>${rows}</tbody><tfoot><tr class="bk-tot"><td>Total ${bal?'<span class="badge good">Balanced</span>':'<span class="badge bad">Unbalanced</span>'}</td>
        <td class="num hide-sm" id="bkVDr" data-raw="${dr}">${plain(dr)}</td><td class="num hide-sm" id="bkVCr" data-raw="${cr}">${plain(cr)}</td><td class="num only-sm"><span class="bk-dc">${bal?'Dr = Cr':'Dr'}</span>${plain(dr)}</td></tr></tfoot></table></div>`;
  }
  function openVoucherSheet(key){const v=voucherByKey(key);if(!v)return;openSheet({title:'Voucher',body:voucherHTML(v),wide:true});}
  function jRowHTML(i){
    const v=I.b.vouchers[i],sel=BK.jSel===v.key;
    return`<tr class="clickable${sel?' selected':''}" data-bk="jopen" data-key="${attr(v.key)}" tabindex="0">
      <td class="date">${escH(dShort(v.date))}</td><td class="muted" style="white-space:nowrap">${escH(v.number||'—')}</td>
      <td class="merchant"><div class="merchant-name" style="font-weight:500">${escH(v.description||'—')}</div><div class="merchant-sub"><span class="badge">${escH(I.vType[i])}</span><span>${(v.lines||[]).length} lines</span></div></td>
      <td class="num">${plain(I.vDr[i])}</td></tr>`;
  }
  function jItemHTML(i){
    const v=I.b.vouchers[i];
    return`<button class="list-item" data-bk="jopen" data-key="${attr(v.key)}"><span class="li-body"><span class="li-title" style="display:block">${escH(v.description||'—')}</span>
      <span class="li-sub" style="display:block">${escH(dShort(v.date))} · ${escH(v.number||'—')} · ${escH(I.vType[i])}</span></span><span class="li-amt">${plain(I.vDr[i])}</span></button>`;
  }
  function jListHTML(){
    const list=jFiltered(),n=list.length,pages=Math.max(1,Math.ceil(n/J_SIZE));
    if(BK.jPage>=pages)BK.jPage=pages-1;if(BK.jPage<0)BK.jPage=0;
    const s=BK.jPage*J_SIZE,page=list.slice(s,s+J_SIZE);
    if(!n)return`<div style="padding:0 var(--card-pad) var(--card-pad)">${emptyBk('search','No vouchers match these filters','Clear filters','jclear')}</div>`;
    const pager=`<div class="bk-pager"><span class="help" id="bkJCount" data-n="${n}">${(s+1).toLocaleString('en-GB')}–${(s+page.length).toLocaleString('en-GB')} of ${n.toLocaleString('en-GB')} vouchers</span>
      <span class="btns"><button class="btn btn-secondary btn-sm" data-bk="jpage" data-d="-1" ${BK.jPage===0?'disabled':''}>${ic('chevron-left','s16')}Newer</button>
      <button class="btn btn-secondary btn-sm" data-bk="jpage" data-d="1" ${BK.jPage>=pages-1?'disabled':''}>Older${ic('chevron-right','s16')}</button></span></div>`;
    return`<div class="table-wrap hide-sm"><table class="data" id="bkJTable"><thead><tr><th scope="col">Date</th><th scope="col">Number</th><th scope="col">Description</th><th scope="col" class="num">Amount</th></tr></thead>
      <tbody>${page.map(jRowHTML).join('')}</tbody></table></div>
      <div class="list bk-list only-sm" style="padding:0 var(--card-pad)">${page.map(jItemHTML).join('')}</div>${pager}`;
  }
  function prepCardHTML(){
    const ps=jPrepFiltered();if(!ps.length)return'';
    return`<div class="grid"><section class="card span-12" id="bkPrep">${cardHead('receipt','Prepared in the app',`${ps.length} voucher${ps.length===1?'':'s'} not in your Accurate book yet. Each disappears here once the book has a voucher with the same date, total and accounts.`)}
      <div class="list bk-list">${ps.map(v=>`<button class="list-item" data-bk="jopen" data-key="${attr(v.key)}" data-prep="1"><span class="li-body"><span class="li-title" style="display:block">${escH(v.description)}</span>
        <span class="li-sub" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${escH(dShort(v.date))} · ${escH(v.from)} <span class="badge warn">Prepared, not in Accurate yet</span></span></span><span class="li-amt">${plain(vTotal(v))}</span></button>`).join('')}</div></section></div>`;
  }
  function renderJournals(){
    const g=gateHTML('Journals');if(g)return g;
    idx();syncMonth();
    const ms=[...I.months].reverse(),types=[...I.types.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
    if(BK.jAcc&&!BK.jAcc.startsWith('kind:')&&!I.acc.has(BK.jAcc))BK.jAcc='';if(BK.jType&&!I.types.has(BK.jType))BK.jType='';
    const period=`<select class="input" data-bk="jperiod" aria-label="Period"><option value="all"${BK.jPeriod==='all'?' selected':''}>All dates</option>
      ${ms.map(m=>`<option value="${attr(m)}"${BK.jPeriod===m?' selected':''}>${escH(monthLabel(m,true))}</option>`).join('')}<option value="custom"${BK.jPeriod==='custom'?' selected':''}>Date range…</option></select>`;
    const range=BK.jPeriod==='custom'?`<input class="input bk-date" type="date" data-bk="jfrom" aria-label="From" value="${attr(BK.jFrom)}"><input class="input bk-date" type="date" data-bk="jto" aria-label="To" value="${attr(BK.jTo)}">`:'';
    const kinds=['income','expense'].map(k=>`<option value="kind:${k}"${BK.jAcc==='kind:'+k?' selected':''}>Any ${k} account</option>`).join('');
    const acc=`<select class="input me-select" data-bk="jacc" aria-label="Account">${accOptions(BK.jAcc,'All accounts').replace('</option>','</option>'+kinds)}</select>`;
    const ty=`<select class="input" data-bk="jtype" aria-label="Type"><option value="">All types</option>${types.map(([t,n])=>`<option value="${attr(t)}"${t===BK.jType?' selected':''}>${escH(t)} (${n.toLocaleString('en-GB')})</option>`).join('')}</select>`;
    const filtered=BK.jPeriod!=='all'||BK.jAcc||BK.jType||BK.jQ;
    const sel=voucherByKey(BK.jSel);if(!sel)BK.jSel=null;
    return`${pageHead('Journals',sourceLine(),hideBtn())}
      <div class="bk-bar">${period}${range}${acc}${ty}<input class="input bk-search" type="search" data-bk="jq" placeholder="Search number or description" aria-label="Search vouchers" value="${attr(BK.jQ)}">
        ${filtered?`<button class="btn btn-ghost btn-sm" data-bk="jclear">${ic('x','s16')}Clear</button>`:''}</div>
      ${prepCardHTML()}
      <div class="grid"><section class="card flush span-7">${cardHead('book-open','Vouchers','Newest first · amount = total debits · read-only copy of your book')}<div id="bkJList">${jListHTML()}</div></section>
        <section class="card span-5 hide-sm bk-panel" id="bkVPanel">${voucherHTML(sel)}</section></div>`;
  }
  function jRefreshList(){const el=$('bkJList');if(el)el.innerHTML=jListHTML();else renderAll();}
  function jSelect(key){
    if(isMobile()){openVoucherSheet(key);return;}
    BK.jSel=key;const p=$('bkVPanel');
    if(!p){renderAll();return;}
    p.innerHTML=voucherHTML(voucherByKey(key));
    document.querySelectorAll('#bkJTable tr.selected').forEach(r=>r.classList.remove('selected'));
    const r=document.querySelector(`#bkJTable tr[data-key="${CSS.escape(String(key))}"]`);if(r)r.classList.add('selected');
  }

  /* ── General ledger ── */
  function lRange(){
    const M=BK.month;
    switch(BK.lPreset){
      case'm':return[firstDay(M),meMonthEnd(M)];
      case'12':return[firstDay(meShift(M,-11)),meMonthEnd(M)];
      case'all':return['',meMonthEnd(I.months[I.months.length-1]||M)];
      case'custom':return[BK.lFrom||'',BK.lTo||meMonthEnd(M)];
      default:return[yearStart(M),meMonthEnd(M)];
    }
  }
  function ledgerData(code,from,to){
    const leaves=leavesOf(code),pairs=[];
    for(const c of leaves){const a=I.byAcc.get(c);if(a)for(let k=0;k<a.length;k+=2)pairs.push(a[k],a[k+1]);}
    const idxs=[];for(let k=0;k<pairs.length;k+=2)idxs.push([pairs[k],pairs[k+1]]);
    if(leaves.length>1)idxs.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);
    let open=0,dr=0,cr=0;const lines=[];
    for(const[vi,li]of idxs){const v=I.b.vouchers[vi],a=Math.round(v.lines[li].amount||0);
      if(from&&v.date<from)open+=a;else if(v.date<=to){lines.push({vi,li,a});if(a>0)dr+=a;else cr-=a;}}
    return{open,dr,cr,close:open+dr-cr,lines};
  }
  function renderLedger(){
    const g=gateHTML('General ledger');if(g)return g;
    idx();const M=syncMonth();
    if(!BK.lAcc||!I.acc.has(BK.lAcc))BK.lAcc=I.flat.find(c=>!isParentAcc(c))||null;
    if(!BK.lAcc)return`${pageHead('General ledger',sourceLine())}<div class="card">${emptyHTML('list-tree','Your book has no accounts yet')}</div>`;
    const code=BK.lAcc,k=kindOf(code),s=sgn(k),[from,to]=lRange(),d=ledgerData(code,from,to);
    const side=s>0?'debit':'credit';
    const presets=[['m','Month'],['ytd','Year to date'],['12','12 months'],['all','All']];
    const seg=`<div class="seg sm" role="group" aria-label="Range">${presets.map(([p,l])=>`<button aria-pressed="${BK.lPreset===p}" data-bk="lpreset" data-p="${p}">${l}</button>`).join('')}</div>`;
    let run=d.open;const shown=d.lines.slice(0,BK.lLimit);
    const rows=shown.map(({vi,li,a})=>{run+=a;const v=I.b.vouchers[vi],l=v.lines[li];
      return`<tr class="clickable" data-bk="vsheet" data-key="${attr(v.key)}" tabindex="0"><td class="date">${escH(dShort(v.date))}</td>
        <td class="muted hide-sm" style="white-space:nowrap">${escH(v.number||'—')}</td>
        <td class="merchant"><div class="merchant-name" style="font-weight:500">${escH(l.description||v.description||'—')}</div><div class="merchant-sub"><span class="only-sm">${escH(v.number||'')}</span>${l.description&&v.description&&l.description!==v.description?`<span>${escH(v.description)}</span>`:''}${leavesOf(code).length>1?`<span class="bk-code">${escH(l.account)}</span>`:''}</div></td>
        <td class="num hide-sm">${plain(a>0?a:0)}</td><td class="num hide-sm">${plain(a<0?-a:0)}</td><td class="num only-sm">${money(s*a)}</td><td class="num">${money(s*run)}</td></tr>`;}).join('');
    const more=d.lines.length>shown.length?`<div class="table-foot"><button class="btn btn-ghost btn-sm" data-bk="lmore">Show more (${(d.lines.length-shown.length).toLocaleString('en-GB')} left)</button></div>`:'';
    // Tie to the book: when the range ends on a month-end the book has, the closing must equal
    // books.balances for that month (parents: the sum of their children).
    const tm=to.slice(0,7),tie=to===meMonthEnd(tm)&&I.months.includes(tm)?rawAt(code,tm):null;
    const tieHTML=tie==null?'':tie===d.close?`<span class="badge good" id="bkLTie" data-ok="1" title="Equals the book’s balance at ${escH(dLong(to))}">Matches the book</span>`:`<span class="badge bad" id="bkLTie" data-ok="0">Off by <span class="amt">${escH(fmtIDR(Math.abs(tie-d.close)))}</span></span>`;
    const label=`${escH(code)} · ${escH(accName(code))}`;
    return`${pageHead('General ledger',sourceLine(),hideBtn())}
      <div class="bk-bar"><select class="input me-select" data-bk="lacc" aria-label="Account">${accOptions(code)}</select>${monthPicker()}${seg}</div>
      <div class="bk-bar"><input class="input bk-date" type="date" data-bk="lfrom" aria-label="From" value="${attr(from)}"><span class="muted">to</span><input class="input bk-date" type="date" data-bk="lto" aria-label="To" value="${attr(to)}"></div>
      <div class="grid">
        ${kpiCard({label:'Opening balance',value:`<span id="bkLOpen" data-raw="${s*d.open||0}">${kpiSigned(s*d.open)}</span>`,sub:from?`Before ${escH(dLong(from))}`:'From the first entry'})}
        ${kpiCard({label:'Debits',value:kpiMoney(d.dr),sub:`${d.lines.filter(x=>x.a>0).length} lines`})}
        ${kpiCard({label:'Credits',value:kpiMoney(d.cr),sub:`${d.lines.filter(x=>x.a<0).length} lines`})}
        ${kpiCard({label:'Closing balance',value:`<span id="bkLClose" data-raw="${s*d.close||0}" data-book="${tie==null?'':s*tie||0}">${kpiSigned(s*d.close)}</span>`,sub:tieHTML||escH(dLong(to))})}
      </div>
      <div class="grid"><section class="card flush span-12">${cardHead('file-text',label,`${escH(KIND_LABEL[k]||k)} · ${from?escH(dLong(from)):'From the start'} – ${escH(dLong(to))} · balance shown ${side}-positive${isParentAcc(code)?' · includes every account under it':''}`)}
        <div class="table-wrap"><table class="data" id="bkLedger"><thead><tr><th scope="col">Date</th><th scope="col" class="hide-sm">Voucher</th><th scope="col">Description</th><th scope="col" class="num hide-sm">Debit</th><th scope="col" class="num hide-sm">Credit</th><th scope="col" class="num only-sm">Change</th><th scope="col" class="num">Balance (${side} +)</th></tr></thead>
        <tbody><tr class="bk-open"><td class="date">${from?escH(dShort(from)):''}</td><td class="hide-sm"></td><td>Opening balance</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="only-sm"></td><td class="num">${money(s*d.open)}</td></tr>
          ${rows||`<tr><td colspan="7">${emptyHTML('inbox','No entries in this range')}</td></tr>`}
          ${more?'':`<tr class="bk-tot"><td class="date">${escH(dShort(to))}</td><td class="hide-sm"></td><td>Closing balance</td><td class="num hide-sm">${plain(d.dr)}</td><td class="num hide-sm">${plain(d.cr)}</td><td class="only-sm"></td><td class="num">${money(s*d.close)}</td></tr>`}</tbody></table></div>${more}</section></div>`;
  }

  /* ── Balance sheet ── */
  function renderBS(){
    const g=gateHTML('Balance sheet');if(g)return g;
    idx();const M=syncMonth(),d=bsData(M,BK.bsView);
    const ok=d.diff[0]===0;
    const view=`<div class="seg" role="group" aria-label="Valuation"><button aria-pressed="${BK.bsView==='book'}" data-bk="bsview" data-v="book" title="Book value from your accounting book">Book</button><button aria-pressed="${BK.bsView==='market'}" data-bk="bsview" data-v="market" title="Market value where a close recorded one">Market</button></div>`;
    const noMarket=BK.bsView==='market'&&!marketMonthKnown(M);
    const check=`<div class="bk-check" id="bkBSCheck" data-ok="${ok?1:0}">${ic(ok?'square-check':'triangle-alert')}<span class="li-body"><span class="li-title" style="display:block">Assets = Liabilities + Equity</span>
      <span class="li-sub" style="display:block">${ok?'The sheet balances. Equity includes this year’s earnings so far.':`Off by <span class="amt">${fmtIDR(Math.abs(d.diff[0]))}</span>. The book’s balances don’t add up for this month; check the Trial balance.`}</span></span>
      <span class="badge ${ok?'good':'bad'}">${ok?'Balanced':'Difference'}</span></div>`;
    return`${pageHead('Balance sheet',sourceLine(),hideBtn())}
      <div class="bk-bar">${monthPicker()}${view}<span class="bk-grow"></span>${xlBtn('bs')}</div>
      ${noMarket?`<div class="banner info bk-note">${ic('info')}<span class="msg">No market values recorded for ${escH(monthLabel(M,true))} — showing book values. Market values come from the month-end close.</span></div>`:''}
      <div class="grid">
        ${kpiCard({label:`Total assets · ${monthLabel(M)}`,value:kpiSigned(d.totA[0]),sub:d.totA[1]!=null?`${money(d.totA[0]-d.totA[1])} <span class="vs">vs ${escH(monthLabel(d.cols[1].m))}</span>`:'',span:'span-4'})}
        ${kpiCard({label:'Total liabilities',value:kpiSigned(d.totL[0]),sub:d.totL[1]!=null?`${money(d.totL[0]-d.totL[1])} <span class="vs">vs ${escH(monthLabel(d.cols[1].m))}</span>`:'',span:'span-4'})}
        ${kpiCard({label:'Equity (net worth)',value:kpiSigned(d.totE[0]),sub:`Earnings this year ${money(d.cur[0])}`,span:'span-4'})}
      </div>
      <div class="grid"><section class="card flush span-12" id="bkBS">${cardHead('scale',`As at ${escH(dLong(meMonthEnd(M)))}`,`${BK.bsView==='market'?'Market value where recorded, book value elsewhere':'Book value'} · liabilities and equity shown credit-positive · click a row for its ledger`,colSeg('bs',['This month','Prev.','Start of year'],BK.bsCol))}
        ${stmtTableHTML(d,BK.bsCol,{from:yearStart(M),to:meMonthEnd(M)})}
        <div style="padding:4px var(--card-pad) var(--card-pad)">${check}</div></section></div>`;
  }

  /* ── Income statement ── */
  function renderPL(){
    const g=gateHTML('Income statement');if(g)return g;
    idx();const M=syncMonth(),d=plData(M),c=BK.plCol,r=d.ranges[c];
    return`${pageHead('Income statement',sourceLine(),hideBtn())}
      <div class="bk-bar">${monthPicker()}<span class="bk-grow"></span>${xlBtn('pl')}</div>
      <div class="grid">
        ${kpiCard({label:'Income · year to date',value:kpiMoney(d.inc[1]),sub:`${escH(monthLabel(M))}: ${money(d.inc[0])}`,span:'span-4'})}
        ${kpiCard({label:'Expenses · year to date',value:kpiMoney(d.exp[1]),sub:`${escH(monthLabel(M))}: ${money(d.exp[0])}`,span:'span-4'})}
        ${kpiCard({label:'Net result · year to date',value:`<span id="bkPLNet" data-raw="${d.net[1]}">${kpiSigned(d.net[1])}</span>`,sub:`Last 12 months: ${money(d.net[2])}`,span:'span-4'})}
      </div>
      <div class="grid"><section class="card flush span-12" id="bkPL">${cardHead('chart-column',`To ${escH(dLong(meMonthEnd(M)))}`,'Income and expenses shown positive · net result = income − expenses · click a row for its ledger',colSeg('pl',['Month','Year to date','12 months'],c))}
        ${stmtTableHTML(d,c,{from:r.from,to:r.to})}</section></div>`;
  }

  /* ── Trial balance ── */
  function tbData(M){
    // This month's movement = the change in balance since the previous month-end (= books.activity).
    const r=roll(M),p=roll(meShift(M,-1)),rows=[];
    let dr=0,cr=0,mdr=0,mcr=0;
    for(const c of I.flat){if(isParentAcc(c))continue;const v=r.get(c)||0,m=v-(p.get(c)||0);if(!v&&!m)continue;
      const row={code:c,name:accName(c),kind:kindOf(c),dr:v>0?v:0,cr:v<0?-v:0,mdr:m>0?m:0,mcr:m<0?-m:0};
      dr+=row.dr;cr+=row.cr;mdr+=row.mdr;mcr+=row.mcr;rows.push(row);}
    return{rows,dr,cr,mdr,mcr};
  }
  // Rebuild every balance from the voucher lines and compare with books.balances (once per import).
  function glCheck(){
    if(I.glCheck)return I.glCheck;
    const by=new Map();for(const v of I.b.vouchers){const m=v.date.slice(0,7);let x=by.get(m);if(!x)by.set(m,x=new Map());for(const l of v.lines){const c=String(l.account);x.set(c,(x.get(c)||0)+Math.round(l.amount||0));}}
    const run=new Map(),miss=[];let mi=0;
    const allM=[...new Set([...by.keys(),...I.months])].sort();
    for(const m of allM){const x=by.get(m);if(x)for(const[c,a]of x)run.set(c,(run.get(c)||0)+a);
      if(!I.months.includes(m))continue;mi++;
      const bm=I.b.balances[m]||{},codes=new Set([...run.keys(),...Object.keys(bm)]);
      for(const c of codes){const gl=run.get(c)||0,bk=Math.round(bm[c]||0);if(Math.abs(gl-bk)>=1)miss.push({m,c,gl,bk});}}
    return I.glCheck={miss,months:mi};
  }
  function renderTB(){
    const g=gateHTML('Trial balance');if(g)return g;
    idx();const M=syncMonth(),t=tbData(M),diff=t.dr-t.cr,bs=bsData(M,'book');
    const tbA=t.rows.filter(r=>r.kind==='asset').reduce((s,r)=>s+r.dr-r.cr,0);
    const tbLE=-t.rows.filter(r=>r.kind!=='asset').reduce((s,r)=>s+r.dr-r.cr,0);
    const gc=glCheck(),gm=gc.miss.filter(x=>x.m===M);
    const months=[...I.months].reverse().map(m=>{let d=0,c=0;for(const v of Object.values(I.b.balances[m]||{})){const a=Math.round(v);if(a>0)d+=a;else c-=a;}const bad=d!==c||gc.miss.some(x=>x.m===m);
      return`<tr class="clickable${bad?' bk-flag':''}${m===M?' selected':''}" data-bk="tbmonth" data-m="${attr(m)}" data-diff="${d-c}" tabindex="0"><td>${escH(monthLabel(m,true))}</td><td class="num hide-sm">${plain(d)}</td><td class="num hide-sm">${plain(c)}</td><td class="num">${money(d-c)}</td><td>${bad?'<span class="badge bad">Check</span>':'<span class="badge good">OK</span>'}</td></tr>`;}).join('');
    const chk=(ok,title,sub)=>`<div class="bk-check" data-ok="${ok?1:0}">${ic(ok?'square-check':'triangle-alert')}<span class="li-body"><span class="li-title" style="display:block">${title}</span><span class="li-sub" style="display:block">${sub}</span></span><span class="badge ${ok?'good':'bad'}">${ok?'OK':'Difference'}</span></div>`;
    const bookChecks=(I.b.checks||[]).length;
    const rows=t.rows.map(r=>`<tr class="clickable" data-bk="led" data-code="${attr(r.code)}" data-to="${attr(meMonthEnd(M))}" tabindex="0"><td class="bk-acc"><div class="merchant-name" style="font-weight:500"><span class="bk-code">${escH(r.code)}</span>${escH(r.name)}</div><div class="merchant-sub"><span>${escH(KIND_LABEL[r.kind]||r.kind)}</span>${ledgerLink(r.code,'',meMonthEnd(M),true)}</div></td>
      <td class="num">${plain(r.dr)}</td><td class="num">${plain(r.cr)}</td><td class="num hide-sm">${plain(r.mdr)}</td><td class="num hide-sm">${plain(r.mcr)}</td></tr>`).join('');
    return`${pageHead('Trial balance',sourceLine(),hideBtn())}
      <div class="bk-bar">${monthPicker()}<span class="bk-grow"></span>${xlBtn('tb')}</div>
      <div class="grid">
        ${kpiCard({label:'Debit balances',value:kpiMoney(t.dr),sub:`${t.rows.filter(r=>r.dr).length} accounts`,span:'span-4'})}
        ${kpiCard({label:'Credit balances',value:kpiMoney(t.cr),sub:`${t.rows.filter(r=>r.cr).length} accounts`,span:'span-4'})}
        ${kpiCard({label:'Difference',value:`<span id="bkTBDiff" data-raw="${diff}">${kpiSigned(diff)}</span>`,sub:diff===0?'<span class="delta good">Debits = credits</span>':'<span class="delta bad">Not balanced</span>',span:'span-4'})}
      </div>
      <div class="grid">
        <section class="card flush span-8">${cardHead('square-check',`As at ${escH(dLong(meMonthEnd(M)))}`,'Cumulative balances from your book’s lines, and this month’s movement · click a row for its ledger')}
          <div class="table-wrap"><table class="data bk-stmt" id="bkTB"><thead><tr><th scope="col">Account</th><th scope="col" class="num">Debit</th><th scope="col" class="num">Credit</th><th scope="col" class="num hide-sm">Dr ${escH(monthLabel(M))}</th><th scope="col" class="num hide-sm">Cr ${escH(monthLabel(M))}</th></tr></thead>
          <tbody>${rows}</tbody><tfoot><tr class="bk-grand"><td>Total</td><td class="num" data-raw="${t.dr}">${plain(t.dr)}</td><td class="num" data-raw="${t.cr}">${plain(t.cr)}</td><td class="num hide-sm">${plain(t.mdr)}</td><td class="num hide-sm">${plain(t.mcr)}</td></tr></tfoot></table></div></section>
        <section class="card span-4" id="bkTBChecks">${cardHead('info','Checks','')}
          ${chk(diff===0,'Debits equal credits',diff===0?'Every balance at this month-end nets to zero.':`Off by <span class="amt">${fmtIDR(Math.abs(diff))}</span>.`)}
          ${chk(t.mdr===t.mcr,'This month’s entries balance',`Debits <span class="amt">${fmtIDR(t.mdr)}</span> · credits <span class="amt">${fmtIDR(t.mcr)}</span>`)}
          ${chk(tbA===bs.totA[0]&&tbLE===bs.totLE[0],'Ties to the balance sheet',`Assets <span class="amt">${fmtIDR(tbA)}</span> · liabilities + equity incl. earnings <span class="amt">${fmtIDR(tbLE)}</span>`)}
          ${chk(!gm.length,'Lines rebuild the balances',gm.length?`${gm.length} account${gm.length===1?'':'s'} differ: ${gm.slice(0,3).map(x=>escH(x.c)).join(', ')}${gm.length>3?'…':''}`:`Every voucher line adds up to the book’s month-end balances.`)}
          ${bookChecks?chk(false,'Notes from the export',`${bookChecks} check${bookChecks===1?'':'s'} reported when the file was built`):''}
        </section></div>
      <div class="grid"><section class="card flush span-12">${cardHead('calendar-check','Every month','Debit and credit totals of the month-end balances; a flagged month needs a look')}
        <div class="table-wrap"><table class="data" id="bkTBMonths"><thead><tr><th scope="col">Month-end</th><th scope="col" class="num hide-sm">Debits</th><th scope="col" class="num hide-sm">Credits</th><th scope="col" class="num">Difference</th><th scope="col">Status</th></tr></thead><tbody>${months}</tbody></table></div></section></div>`;
  }

  /* ── Navigation helper for every page ── */
  function openLedger(code,fromDate,toDate){
    code=code==null?'':String(code);
    if(code)BK.lAcc=code;
    const i=idx();
    if(fromDate||toDate){
      BK.lPreset='custom';BK.lFrom=fromDate||'';
      if(toDate){BK.lTo=toDate;const m=toDate.slice(0,7);if(i&&i.months.includes(m))BK.month=m;}
      else BK.lTo='';
    }else BK.lPreset='ytd';
    BK.lLimit=300;
    if(typeof closeAllSheets==='function')closeAllSheets();
    if(ACTIVE_TAB==='ledger'){renderAll();window.scrollTo(0,0);}else setTab('ledger');
  }
  window.openLedger=openLedger;
  // Journals filtered to a date range ('YYYY-MM-DD', either end optional) and, optionally, to the
  // vouchers touching any income (or expense) account. Other filters are cleared.
  function openJournals(o){
    o=o||{};
    BK.jFrom=o.from||'';BK.jTo=o.to||'';BK.jPeriod=BK.jFrom||BK.jTo?'custom':'all';
    BK.jAcc=o.kind==='income'||o.kind==='expense'?'kind:'+o.kind:'';BK.jType='';BK.jQ='';BK.jPage=0;BK.jSel=null;
    if(typeof closeAllSheets==='function')closeAllSheets();
    if(ACTIVE_TAB==='journals'){renderAll();window.scrollTo(0,0);}else setTab('journals');
  }
  window.openJournals=openJournals;

  /* ── Events (one delegated listener per type) ── */
  // The month picker on the ledger moves a custom range back to that month's year to date.
  function setMonth(m){BK.month=m;BK.jPage=0;if(ACTIVE_TAB==='ledger'&&BK.lPreset==='custom')BK.lPreset='ytd';renderAll();}
  function act(el,ev){
    const a=el.dataset.bk;
    switch(a){
      case'month':setMonth(el.value);return;
      case'mstep':{const ms=I.months,i=ms.indexOf(BK.month)+Number(el.dataset.d);if(i>=0&&i<ms.length)setMonth(ms[i]);return;}
      case'retry':reloadBooks();renderAll();return;
      case'import':importWealthFile();return;
      case'connect':connectWealthFolder();return;
      case'coa-all':BK.coaAll=el.checked;renderAll();return;
      case'coa-show':BK.coaAll=true;renderAll();return;
      case'led':ev&&ev.stopPropagation();openLedger(el.dataset.code,el.dataset.from||null,el.dataset.to||null);return;
      case'jopen':jSelect(el.dataset.key);return;
      case'vsheet':openVoucherSheet(el.dataset.key);return;
      case'jperiod':BK.jPeriod=el.value;BK.jPage=0;renderAll();return;
      case'jfrom':BK.jFrom=el.value;BK.jPage=0;jRefreshList();return;
      case'jto':BK.jTo=el.value;BK.jPage=0;jRefreshList();return;
      case'jacc':BK.jAcc=el.value;BK.jPage=0;renderAll();return;
      case'jtype':BK.jType=el.value;BK.jPage=0;renderAll();return;
      case'jpage':BK.jPage+=Number(el.dataset.d);jRefreshList();{const c=$('bkJList');if(c&&c.getBoundingClientRect().top<0)c.scrollIntoView({block:'start'});}return;
      case'jclear':BK.jPeriod='all';BK.jFrom=BK.jTo=BK.jAcc=BK.jType=BK.jQ='';BK.jPage=0;renderAll();return;
      case'lacc':BK.lAcc=el.value;BK.lLimit=300;renderAll();return;
      case'lpreset':BK.lPreset=el.dataset.p;BK.lLimit=300;renderAll();return;
      case'lfrom':case'lto':{const[f,t]=lRange();BK.lPreset='custom';BK.lFrom=a==='lfrom'?el.value:f;BK.lTo=a==='lto'?(el.value||t):t;BK.lLimit=300;renderAll();return;}
      case'lmore':BK.lLimit+=300;renderAll();return;
      case'bsview':BK.bsView=el.dataset.v==='market'?'market':'book';renderAll();return;
      case'col':if(el.dataset.p==='bs')BK.bsCol=Number(el.dataset.i);else BK.plCol=Number(el.dataset.i);renderAll();return;
      case'tbmonth':BK.month=el.dataset.m;renderAll();return;
      case'xl':{const f={bs:xlBS,pl:xlPL,tb:xlTB}[el.dataset.r];if(f&&idx()){el.disabled=true;Promise.resolve(f()).finally(()=>{el.disabled=false;});}return;}
    }
  }
  const CHANGE=new Set(['month','coa-all','jperiod','jfrom','jto','jacc','jtype','lacc','lfrom','lto']);
  const onPage=()=>PAGE_KEYS.includes(ACTIVE_TAB)||ACTIVE_TAB==='accounts';
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-bk]');if(!el||CHANGE.has(el.dataset.bk)||el.dataset.bk==='coa-q'||el.dataset.bk==='jq')return;
    if(!I&&!idx()&&!['retry','import','connect'].includes(el.dataset.bk))return;
    if(el.disabled)return;
    act(el,e);
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const el=e.target;if(!el||!el.matches||!el.matches('tr[data-bk]'))return;
    e.preventDefault();if(idx())act(el,e);
  });
  document.addEventListener('change',e=>{const el=e.target.closest&&e.target.closest('[data-bk]');if(el&&CHANGE.has(el.dataset.bk)&&onPage()&&idx())act(el,e);});
  let qT=null;
  document.addEventListener('input',e=>{
    const el=e.target;if(!el||!el.dataset||!onPage())return;
    if(el.dataset.bk==='jq'){BK.jQ=el.value;BK.jPage=0;clearTimeout(qT);qT=setTimeout(jRefreshList,120);}
    else if(el.dataset.bk==='coa-q'){BK.coaQ=el.value;clearTimeout(qT);qT=setTimeout(()=>{const pos=el.selectionStart;renderAll();const n=document.querySelector('[data-bk="coa-q"]');if(n){n.focus();try{n.setSelectionRange(pos,pos);}catch(_){}}},150);}
  });

  /* ── Pages and hooks ── */
  registerPage({key:'coa',label:'Chart of accounts',icon:'list-tree',group:'books',order:10,needs:'books',render:renderCOA});
  registerPage({key:'journals',label:'Journals',icon:'book-open',group:'books',order:20,needs:'books',render:renderJournals});
  registerPage({key:'ledger',label:'General ledger',short:'Ledger',icon:'file-text',group:'books',order:30,needs:'books',render:renderLedger});
  registerPage({key:'bs',label:'Balance sheet',icon:'scale',group:'books',order:40,needs:'books',render:renderBS});
  registerPage({key:'pl',label:'Income statement',icon:'chart-column',group:'books',order:50,needs:'books',render:renderPL});
  registerPage({key:'tb',label:'Trial balance',icon:'square-check',group:'books',order:60,needs:'books',render:renderTB});
  // Accounts page: a ledger link under each account the book has (only once the books are loaded).
  registerHook('accountsExtraCol',a=>{const i=idx();return i&&a&&i.acc.has(String(a.id))?ledgerLink(String(a.id)):null;});
})();
