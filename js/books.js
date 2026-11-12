/* ExpenseTrack v4 — Books module: the owner's ERP books screens, read from the app's own book.
   Pages (group 'books'): coa, journals, ledger, bs, pl, tb, periods, audit. Cross-page helpers:
   window.openLedger(code, fromDate?, toDate?), window.openJournals({from?, to?, kind?, status?, jkind?}),
   window.openVoucher(idOrKey).

   Every figure comes from the engine in js/ledger.js (contract docs/v4-books.md): ledgerLib.tb / gl /
   pl / bs over posted journal lines by date, ledgerView('journals'), ledgerPeriods, the close
   checklist and the audit trail. Drafts and void journals never change a figure; the income
   statement leaves year-end journals out. Nothing here re-does the accounting: the pages lay out
   what the engine returns (UX-GUIDELINE.md §11.10b).

   Signs: the trial balance and the general ledger show raw amounts (debit +, credit −), as the
   ERP does; the statements and the chart of accounts show each account's natural sign.

   Loaded by index.html after js/ledger.js. Everything stays inside this function; only the helpers
   above go on window. Every interactive element on a page carries data-bk="<action>" and one
   delegated listener per event type handles them. Filters are remembered per page for the session.
   No personal data in this file: the repo is public. */
(function(){
  'use strict';

  /* ── Icons ── */
  registerIcon('list-tree','<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>');
  registerIcon('book-open','<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>');
  registerIcon('file-text','<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>');
  registerIcon('scale','<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>');
  registerIcon('history','<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>');
  registerIcon('archive','<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>');
  registerIcon('arrow-up','<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>');
  registerIcon('arrow-down','<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>');
  registerIcon('arrow-up-down','<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>');
  registerIcon('lock-open','<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>');
  registerIcon('ban','<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>');

  /* ── Styles for v4 (tokens only; light and dark come from the core variables) ── */
  const BK_CSS=`
    .bk-presets{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%;min-width:0}
    .bk-presets::-webkit-scrollbar{display:none}
    .bk-presets .chip{flex:0 0 auto}
    .bk-dates{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0;max-width:100%}
    .bk-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:-6px 0 14px}
    .bk-chips .chip{height:28px;font-size:13px}
    .bk-derr{flex:1 1 100%;margin:-2px 0 0}
    .bk-derr[hidden]{display:none}
    th .bk-sort{display:inline-flex;align-items:center;gap:4px;font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;padding:0}
    th .bk-sort svg.i{width:16px;height:16px;color:var(--text-3)}
    th[aria-sort="ascending"] .bk-sort svg.i,th[aria-sort="descending"] .bk-sort svg.i{color:var(--accent)}
    th.num .bk-sort{flex-direction:row-reverse}
    table.data td.bk-no{font-variant-numeric:tabular-nums;color:var(--text-2);white-space:nowrap}
    .bk-draftno{font-style:italic;color:var(--text-3)}
    .badge.info{background:var(--info-soft);color:var(--info)}
    .badge.bk-void{text-decoration:line-through}
    table.data tr.bk-zero td{color:var(--text-3)}
    table.data .bk-cmp{color:var(--text-2)}
    .bk-good{color:var(--good)}.bk-bad{color:var(--bad)}
    .bk-pct{font-size:12px;color:var(--text-3);margin-left:6px;white-space:nowrap}
    .bk-cmpsub{justify-content:flex-end;gap:4px;font-weight:400}
    table.data td.bk-nm{padding-left:calc(16px + var(--lvl,0) * 20px)}
    table.data tr.bk-hdr td{font-weight:600}
    table.data td.bk-tick{text-align:center;color:var(--good)}
    .bk-acts{display:flex;gap:2px;justify-content:flex-end}
    .bk-acts .icon-btn{width:36px;height:36px}
    table.data tr.bk-confirm td{background:var(--surface-2)}
    .bk-confirm .bk-check{border-top:none;flex-wrap:wrap}
    table.data tr.bk-diff td{background:var(--warn-soft)}
    .bk-val{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
    .bk-net{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px var(--card-pad);font-size:16px;font-weight:700;flex-wrap:wrap}
    .bk-net .bk-net-v{font-variant-numeric:tabular-nums;text-align:right}
    .bk-year{display:inline-flex;align-items:center;gap:4px}
    .bk-year .bk-yr{font-weight:600;min-width:52px;text-align:center;font-variant-numeric:tabular-nums}
    .bk-pacts{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
    .bk-locknote{display:flex;gap:8px;align-items:center;padding:10px 12px;border-radius:var(--radius-sm);background:var(--info-soft);color:var(--text-1);font-size:13px;margin:0 0 12px}
    .bk-errs{margin:0 0 12px;display:flex;flex-direction:column;gap:4px}
    .bk-gl+.bk-gl{margin-top:0}
    .bk-form{display:grid;gap:12px}
    .bk-form .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .lg-lines{display:flex;flex-direction:column;gap:8px}
    .lg-line{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 36px;gap:6px;align-items:center}
    .lg-tot{display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--text-2)}
    .lg-rc td .input{width:140px;max-width:100%}
    .lg-rc .help{display:block;margin-top:2px}
    @media (max-width:767px){
      .bk-bar .bk-presets{flex:1 1 100%}
      .bk-dates{flex:1 1 100%}
      .bk-dates .input{flex:1 1 110px;width:auto!important;min-width:0}
      .bk-form .row2{grid-template-columns:1fr}
      .lg-line{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 36px}
      .lg-line select{grid-column:1/-1}
      .lg-rc td .input{width:100%}
    }`;
  if(!document.getElementById('bk-v4-css')){const s=document.createElement('style');s.id='bk-v4-css';s.textContent=BK_CSS;document.head.appendChild(s);}

  /* ── Small helpers ── */
  const PAGE_KEYS=['coa','journals','ledger','bs','pl','tb','periods','audit'];
  const KIND_LABEL={asset:'Asset',liability:'Liability',equity:'Equity',income:'Income',expense:'Expense'};
  const KINDS=['asset','liability','equity','income','expense'];
  const JKIND={manual:['Manual',''],ai:['AI','accent'],'month-end':['Month-end',''],income:['Income',''],opening:['Opening',''],'year-end':['Year-end',''],accurate:['From Accurate','']};
  const JSTAT={draft:['Draft','info'],posted:['Posted','good'],void:['Void','bk-void']};
  const sgn=k=>(k==='asset'||k==='expense')?1:-1;
  const isPL=k=>k==='income'||k==='expense';
  const cmpCode=(a,b)=>String(a).localeCompare(String(b),'en',{numeric:true});
  const attr=s=>escH(s);
  const p2=n=>String(n).padStart(2,'0');
  const money=n=>(n=Math.round(n||0),`<span class="amt">${n<0?'−'+fmtIDR(-n):fmtIDR(n)}</span>`);
  const plain=n=>n?`<span class="amt">${fmtIDR(n)}</span>`:'';
  const dLong=iso=>iso?fmtDayLong(new Date(iso+'T00:00:00')):'—';
  const dShort=iso=>iso?fmtDay(new Date(iso+'T00:00:00')):'—';
  const todayISO=()=>{const d=new Date();return`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;};
  const addDays=(iso,k)=>{const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+k);return d.toISOString().slice(0,10);};
  const mStart=iso=>iso.slice(0,8)+'01';
  const mEnd=iso=>meMonthEnd(iso.slice(0,7));
  function validD(d){if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;const t=new Date(d+'T00:00:00Z');return!isNaN(t)&&t.toISOString().slice(0,10)===d;}
  function shiftMonths(iso,k){let y=+iso.slice(0,4),m=+iso.slice(5,7)+k;while(m<1){m+=12;y--;}while(m>12){m-=12;y++;}
    const M=`${y}-${p2(m)}`,e=+meMonthEnd(M).slice(8,10);return`${M}-${p2(Math.min(+iso.slice(8,10),e))}`;}
  const shiftKeepEnd=(iso,k)=>iso===mEnd(iso)?mEnd(shiftMonths(iso,k)):shiftMonths(iso,k);
  function rangeLabel(f,t){
    if(!f&&!t)return'All dates';if(!f)return`Up to ${dLong(t)}`;if(!t)return`From ${dLong(f)}`;
    if(f===t)return dLong(f);
    return f.slice(0,4)===t.slice(0,4)?`${dLong(f).replace(/ \d{4}$/,'')} – ${dLong(t)}`:`${dLong(f)} – ${dLong(t)}`;
  }
  const emptyBk=(icon,text,label,action,extra)=>`<div class="empty">${ic(icon,'s40')}<div class="e-title">${escH(text)}</div>${label?`<button class="btn btn-ghost btn-sm" data-bk="${action}"${extra||''}>${escH(label)}</button>`:''}</div>`;
  const errText=e=>e&&e.errors&&e.errors.length?e.errors.join(' · '):String(e&&e.message||e);
  const EN=()=>typeof etEntry==='object'&&etEntry?etEntry:null;

  /* ── Date presets (ERP lib/datePresets.ts, calendar year) ── */
  const RANGE_P=[['today','Today'],['thisMonth','This month'],['lastMonth','Last month'],['thisYear','This year']];
  const ASOF_P=[['today','Today'],['endLastMonth','End of last month'],['endLastYear','End of last year']];
  function rangeFor(p){const t=todayISO();
    switch(p){case'today':return[t,t];case'thisMonth':return[mStart(t),t];
      case'lastMonth':{const e=addDays(mStart(t),-1);return[mStart(e),e];}case'thisYear':return[t.slice(0,4)+'-01-01',t];}return null;}
  function asOfFor(p){const t=todayISO();
    switch(p){case'today':return t;case'endLastMonth':return addDays(mStart(t),-1);case'endLastYear':return`${+t.slice(0,4)-1}-12-31`;}return null;}
  const matchRange=(f,t)=>(RANGE_P.find(([p])=>{const r=rangeFor(p);return r[0]===f&&r[1]===t;})||[null])[0];
  const matchAsOf=a=>(ASOF_P.find(([p])=>asOfFor(p)===a)||[null])[0];

  /* ── Compare with: the earlier range (or as-of date) ── */
  const CMP=[['off','Off'],['prev','Previous period'],['yoy','Same period last year'],['custom','Custom']];
  function cmpRange(f){
    const{from,to}=f;if(!from||!to)return null;
    if(f.cmp==='custom')return validD(f.cf)&&validD(f.ct)&&f.cf<=f.ct?[f.cf,f.ct]:null;
    if(f.cmp==='yoy')return[shiftKeepEnd(from,-12),shiftKeepEnd(to,-12)];
    if(f.cmp==='prev'){
      if(from.slice(0,7)===to.slice(0,7)&&from.endsWith('-01'))return[shiftMonths(from,-1),shiftKeepEnd(to,-1)];       // a month → the month before
      if(from.slice(0,4)===to.slice(0,4)&&from.slice(5)==='01-01')return[shiftMonths(from,-12),shiftKeepEnd(to,-12)]; // a year → the year before
      const n=Math.round((Date.parse(to)-Date.parse(from))/864e5)+1;return[addDays(from,-n),addDays(from,-1)];        // same number of days just before
    }
    return null;
  }
  function cmpAsOf(f){
    if(f.cmp==='custom')return validD(f.cAsOf)?f.cAsOf:null;
    if(f.cmp==='yoy')return shiftKeepEnd(f.asOf,-12);
    if(f.cmp==='prev')return f.asOfP==='endLastYear'?`${+f.asOf.slice(0,4)-1}-12-31`:shiftKeepEnd(f.asOf,-1);
    return null;
  }
  const pctOf=(ch,prev)=>!prev?'—':`${ch<0?'−':ch>0?'+':''}${Math.abs(ch/Math.abs(prev)*100).toFixed(1)}%`;
  // dir: 'up' when a rise is clearly good, 'down' when a fall is, null when neither.
  function chgHTML(cur,prev,dir){
    const ch=cur-prev,tone=!ch||!dir?'':((ch>0)===(dir==='up')?'bk-good':'bk-bad');
    return`<span class="${tone}" data-chg="${ch}">${ch>0?'+':''}${money(ch)}</span><span class="bk-pct">${pctOf(ch,prev)}</span>`;
  }
  // The amount cell(s) of a statement row: one column, or with Compare on, the compared figure and
  // the change as columns (web) or a sub-line under the amount (phones).
  function amtTDs(cur,prev,on,dir,cls){
    cls=cls||'';
    if(!on)return`<td class="num ${cls}" data-raw="${cur}">${money(cur)}</td>`;
    return`<td class="num ${cls}" data-raw="${cur}">${money(cur)}<div class="merchant-sub only-sm flex bk-cmpsub">vs ${money(prev)} · ${chgHTML(cur,prev,dir)}</div></td>
      <td class="num bk-cmp hide-sm" data-cmp="${prev}">${money(prev)}</td><td class="num hide-sm">${chgHTML(cur,prev,dir)}</td>`;
  }
  const amtTHs=(on,label,cmpLabel)=>`<th scope="col" class="num">${escH(label)}</th>${on?`<th scope="col" class="num bk-cmp hide-sm">${escH(cmpLabel)}</th><th scope="col" class="num hide-sm">Change</th>`:''}`;

  /* ── Page filters (remembered per page for the session) and UI state ── */
  const DEF={
    coa:()=>({q:'',arch:false,kind:'',asOf:todayISO(),asOfP:'today'}),
    journals:()=>({q:'',status:'',jkind:'',acc:'',from:'',to:'',preset:null}),
    ledger:()=>{const[f,t]=rangeFor('thisYear');return{acc:'',from:f,to:t,preset:'thisYear'};},
    tb:()=>{const[f,t]=rangeFor('thisYear');return{from:f,to:t,preset:'thisYear',cmp:'off',cf:'',ct:''};},
    pl:()=>{const[f,t]=rangeFor('thisYear');return{from:f,to:t,preset:'thisYear',cmp:'off',cf:'',ct:''};},
    bs:()=>({asOf:todayISO(),asOfP:'today',cmp:'off',cAsOf:''}),
    audit:()=>({q:'',entity:'',from:'',to:'',preset:null}),
  };
  const F={};
  const st=p=>F[p]||(F[p]=DEF[p]());
  const U={journals:{page:0,sort:null,sel:null},audit:{page:0},ledger:{more:new Set()},coa:{confirm:null,err:''},periods:{year:null},pend:{}};
  const PAGE_SIZE=50;
  function resetPage(p){if(U[p]&&'page'in U[p])U[p].page=0;}

  /* ── The book: gate, account index ── */
  function bookReady(){return typeof ledgerSeeded==='function'&&ledgerSeeded()&&!!(BOOKS()&&BOOKS().fromLedger);}
  function gateHTML(title){
    if(bookReady())return null;
    const s=typeof ledgerStatus==='function'?ledgerStatus():'none';
    if(s==='loading'||(s==='idle'&&typeof USER_EMAIL==='string'&&USER_EMAIL)){
      const sk=(w,h,mt)=>`<div class="skel" style="width:${w};height:${h}px${mt?`;margin-top:${mt}px`:''}"></div>`;
      return`${pageHead(title,'Loading your book…')}<div class="card" id="bkState" data-state="loading" aria-busy="true" aria-label="Loading">${sk('35%',14)}${[1,2,3,4,5,6].map(()=>sk('100%',18,14)).join('')}</div>`;
    }
    if(s==='error'){const why=typeof ledgerBlocked==='function'&&ledgerBlocked();
      return`${pageHead(title,'')}<div class="card" id="bkState" data-state="error">${cardHead('triangle-alert','Couldn’t load your book','')}
        <p class="muted" style="margin:0 0 12px">${escH(why||'Couldn’t reach Google Drive for your book. Check your connection and retry.')}</p>
        <button class="btn btn-ghost btn-sm" data-bk="retry">${ic('refresh-cw','s16')}Retry</button></div>`;}
    return`${pageHead(title,'Your own book, kept in your private Drive app folder')}
      <div class="card" id="bkState" data-state="none" style="text-align:center;padding:48px 24px">
        <span class="empty-ring">${ic('book-open','s24')}</span>
        <h2 class="card-title" style="font-size:18px;line-height:24px;margin:16px 0 6px">Start your book</h2>
        <p class="muted" style="max-width:500px;margin:0 auto 20px">These pages read your own book: the chart of accounts and the journals you post. Start it from the standard chart of accounts, with your opening balances if you like.</p>
        <button class="btn btn-primary" data-bk="start">${ic('plus')}Start my book</button></div>`;
  }
  let AX={src:null};
  function ax(){
    const b=BOOKS();if(AX.src===b)return AX;
    const acc=new Map();for(const a of b.accounts)acc.set(String(a.code||a.id),{...a,code:String(a.code||a.id)});
    const kids=new Map();
    for(const a of acc.values())if(a.parent&&acc.has(String(a.parent))&&String(a.parent)!==a.code)(kids.get(String(a.parent))||kids.set(String(a.parent),[]).get(String(a.parent))).push(a.code);
    const depth=c=>{let d=0,x=acc.get(c),n=0;while(x&&x.parent&&acc.has(String(x.parent))&&n++<30){d++;x=acc.get(String(x.parent));}return d;};
    const codes=[...acc.keys()].sort(cmpCode),dep=new Map(codes.map(c=>[c,depth(c)]));
    AX={src:b,acc,kids,codes,dep,leaves:new Map()};return AX;
  }
  const accOf=c=>ax().acc.get(String(c))||null;
  const nameOf=c=>{const a=accOf(c);return a?a.name:String(c);};
  const kindOf=c=>{const a=accOf(c);return a?a.kind:'asset';};
  function leavesOf(c){
    const A=ax();if(A.leaves.has(c))return A.leaves.get(c);
    const out=[],walk=x=>{const k=A.kids.get(x);if(k&&k.length)k.forEach(walk);else out.push(x);};walk(c);
    if(!out.includes(c))out.push(c);A.leaves.set(c,out);return out;
  }
  const journals=()=>(typeof ledgerView==='function'&&ledgerView('journals'))||[];
  function findJournal(k){if(k==null)return null;k=String(k);return journals().find(j=>j.id===k)||journals().find(j=>j.key===k)||null;}
  // Account options for a picker: every account (or postable only), by code, indented by level.
  function accOptions(sel,o){
    o=o||{};const A=ax();let h=o.blank!=null?`<option value="">${escH(o.blank)}</option>`:'';
    h+=o.extra||'';
    for(const c of A.codes){const a=A.acc.get(c);if(o.postable&&!a.postable)continue;if(a.archived&&c!==sel&&!o.archived)continue;
      h+=`<option value="${attr(c)}"${c===sel?' selected':''}>${o.postable?'':'  '.repeat(A.dep.get(c)||0)}${escH(c)} · ${escH(a.name)}${a.archived?' (archived)':''}</option>`;}
    return h;
  }
  const kindBadge=k=>{const[t,tone]=JKIND[k]||[k,''];return`<span class="badge${tone?' '+tone:''}" data-kind="${attr(k)}">${escH(t)}</span>`;};
  const statBadge=s=>{const[t,tone]=JSTAT[s]||[s,''];return`<span class="badge${tone?' '+tone:''}" data-status="${attr(s)}">${escH(t)}</span>`;};
  const numHTML=j=>j.number?escH(j.number):'<span class="bk-draftno">(draft)</span>';

  /* ── Filter bar parts ── */
  function searchBox(p,ph){return`<input class="input bk-search" type="search" data-bk="q" data-p="${p}" placeholder="${attr(ph)}" aria-label="${attr(ph)}" value="${attr(st(p).q)}">`;}
  function presetChips(p,kind){
    const f=st(p),list=kind==='asof'?ASOF_P:RANGE_P,cur=kind==='asof'?f.asOfP:f.preset;
    return`<div class="bk-presets" role="group" aria-label="${kind==='asof'?'Quick as-of dates':'Quick date ranges'}">${list.map(([v,l])=>`<button class="chip" data-bk="preset" data-p="${p}" data-v="${v}" aria-pressed="${cur===v}">${escH(l)}</button>`).join('')}</div>`;
  }
  function dateFields(p,kind){
    const f=st(p),pd=U.pend[p]||{};
    if(kind==='asof')return`<span class="bk-dates"><input class="input bk-date" type="date" data-bk="dasof" data-p="${p}" aria-label="As of" value="${attr(pd.asOf!=null?pd.asOf:f.asOf)}">
      <button class="btn btn-secondary btn-sm" data-bk="dshow" data-p="${p}" data-kind="asof">Show</button></span>`;
    const fr=pd.from!=null?pd.from:f.from,to=pd.to!=null?pd.to:f.to,bad=fr&&to&&fr>to;
    return`<span class="bk-dates"><input class="input bk-date" type="date" data-bk="dfrom" data-p="${p}" aria-label="From" value="${attr(fr)}"><span class="muted">to</span>
      <input class="input bk-date" type="date" data-bk="dto" data-p="${p}" aria-label="To" value="${attr(to)}">
      <button class="btn btn-secondary btn-sm" data-bk="dshow" data-p="${p}" data-kind="range"${bad?' disabled':''}>Show</button></span>
      <div class="help err bk-derr" id="bkDerr-${p}" role="alert"${bad?'':' hidden'}>${ic('triangle-alert','s16')}<span>The start date is after the end date</span></div>`;
  }
  function cmpControls(p,kind){
    const f=st(p);
    const sel=`<select class="input" data-bk="cmp" data-p="${p}" aria-label="Compare with">${CMP.map(([v,l])=>`<option value="${v}"${f.cmp===v?' selected':''}>${v==='off'?'Compare: Off':escH(l)}</option>`).join('')}</select>`;
    if(f.cmp!=='custom')return sel;
    if(kind==='asof')return sel+`<input class="input bk-date" type="date" data-bk="casof" data-p="${p}" aria-label="Compare with as of" value="${attr(f.cAsOf)}">`;
    return sel+`<span class="bk-dates"><input class="input bk-date" type="date" data-bk="cfrom" data-p="${p}" aria-label="Compare from" value="${attr(f.cf)}"><span class="muted">to</span><input class="input bk-date" type="date" data-bk="cto" data-p="${p}" aria-label="Compare to" value="${attr(f.ct)}"></span>`;
  }
  // Each filter that differs from the page's default shows as a removable chip.
  function chipList(p){
    const f=st(p),d=DEF[p](),out=[];
    if(f.q)out.push(['q',`Search: ${f.q}`]);
    if('status'in f&&f.status)out.push(['status',`Status: ${JSTAT[f.status]?JSTAT[f.status][0]:f.status}`]);
    if('jkind'in f&&f.jkind)out.push(['jkind',`Kind: ${JKIND[f.jkind]?JKIND[f.jkind][0]:f.jkind}`]);
    if('entity'in f&&f.entity)out.push(['entity',`What: ${ENTITY[f.entity]||f.entity}`]);
    if('acc'in f&&f.acc)out.push(['acc',`Account: ${f.acc.startsWith('kind:')?'any '+f.acc.slice(5)+' account':f.acc+' '+nameOf(f.acc)}`]);
    if('from'in f&&(f.from!==d.from||f.to!==d.to))out.push(['dates',`Dates: ${rangeLabel(f.from,f.to)}`]);
    if('asOf'in f&&f.asOf!==d.asOf)out.push(['asof',`As of: ${dLong(f.asOf)}`]);
    if('arch'in f&&f.arch)out.push(['arch','Showing archived']);
    if('kind'in f&&f.kind)out.push(['kind',`Type: ${KIND_LABEL[f.kind]}`]);
    if('cmp'in f&&f.cmp!=='off')out.push(['cmp',`Compare: ${CMP.find(c=>c[0]===f.cmp)[1]}`]);
    return out;
  }
  function chipsHTML(p){
    const l=chipList(p);if(!l.length)return'';
    return`<div class="bk-chips" id="bkChips">${l.map(([k,t])=>`<button class="chip removable" data-bk="unchip" data-p="${p}" data-k="${k}" aria-label="Remove filter ${attr(t)}">${escH(t)}${ic('x')}</button>`).join('')}
      ${l.length>=2?`<button class="btn btn-ghost btn-sm" data-bk="clearall" data-p="${p}">Clear all filters</button>`:''}</div>`;
  }
  function unchip(p,k){
    const f=st(p),d=DEF[p]();
    const keys={dates:['from','to','preset'],asof:['asOf','asOfP'],cmp:['cmp','cf','ct','cAsOf']}[k]||[k];
    for(const x of keys)if(x in d)f[x]=d[x];
    delete U.pend[p];resetPage(p);
  }
  function clearAll(p){F[p]=DEF[p]();delete U.pend[p];resetPage(p);}
  const xlBtn=r=>`<button class="btn btn-secondary btn-sm" data-bk="xl" data-r="${r}">${ic('download','s16')}Download Excel</button>`;
  const statusLine=(ok,title,sub,id)=>`<div class="bk-check"${id?` id="${id}"`:''} data-ok="${ok?1:0}">${ic(ok?'square-check':'triangle-alert')}<span class="li-body"><span class="li-title" style="display:block">${title}</span>${sub?`<span class="li-sub" style="display:block">${sub}</span>`:''}</span><span class="badge ${ok?'good':'bad'}">${ok?'OK':'Check'}</span></div>`;
  function report(fn,fallback){try{return fn();}catch(e){console.warn('Books report',e);return fallback;}}

  /* ── Excel (ExcelJS via the core's on-demand loader xlLib) ── */
  async function xlReport(o){
    let X;try{X=await xlLib();}catch(e){toast(e.message);return false;}
    const wb=new X.Workbook(),ws=wb.addWorksheet(o.sheet,{views:[{state:'frozen',ySplit:3,xSplit:o.xSplit!=null?o.xSplit:2}]});
    const isNum=c=>o.numCols?o.numCols.includes(c):c>=3,isPct=c=>(o.pctCols||[]).includes(c);
    ws.columns=o.widths.map(w=>({width:w}));
    ws.getCell('A1').value=o.title;ws.getCell('A1').font={bold:true,size:14};
    ws.getCell('A2').value=o.sub;ws.getCell('A2').font={italic:true,color:{argb:'FF555555'}};
    const hr=ws.getRow(3);o.head.forEach((h,i)=>{const c=hr.getCell(i+1);c.value=h;c.font={bold:true};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE7E6E6'}};c.border={bottom:{style:'thin'}};if(isNum(i+1)||isPct(i+1))c.alignment={horizontal:'right'};});
    o.rows.forEach((r,k)=>{
      const row=ws.getRow(4+k);row.values=r.v;
      for(let i=1;i<=r.v.length;i++){if(isPct(i))row.getCell(i).numFmt='0.0%';else if(isNum(i))row.getCell(i).numFmt='#,##0;-#,##0;0';}
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
  // Compare columns for an Excel row: [compared, change, change as a fraction or '—'].
  const xlCmp=(cur,prev)=>[prev,cur-prev,prev?(cur-prev)/Math.abs(prev):'—'];

  /* ══ Journals ══ */
  function jAccSet(v){
    if(!v)return null;
    if(v.startsWith('kind:')){const k=v.slice(5);return new Set(ax().codes.filter(c=>kindOf(c)===k));}
    return accOf(v)?new Set(leavesOf(v)):null;
  }
  let JC={src:null,key:null,list:null};
  function jFiltered(){
    const f=st('journals'),all=journals(),key=JSON.stringify(f)+'|'+JSON.stringify(U.journals.sort);
    if(JC.src===all&&JC.key===key)return JC.list;
    const terms=f.q.trim().toLowerCase().split(/\s+/).filter(Boolean),accSet=jAccSet(f.acc);
    const out=[];
    for(let i=all.length-1;i>=0;i--){const j=all[i];   // the view is oldest first: newest first by default
      if(f.status&&j.status!==f.status)continue;if(f.jkind&&j.kind!==f.jkind)continue;
      if(f.from&&j.date<f.from)continue;if(f.to&&j.date>f.to)continue;
      if(terms.length){const t=`${j.number||''} ${j.refNo||''} ${j.description||''}`.toLowerCase();if(!terms.every(x=>t.includes(x)))continue;}
      if(accSet&&!j.lines.some(l=>accSet.has(String(l.account))))continue;
      out.push(j);}
    const s=U.journals.sort;
    if(s){const m=s.dir==='asc'?1:-1;
      const val={number:j=>j.number||'',date:j=>j.date,amount:j=>j.debit}[s.k];
      out.sort((a,b)=>{const x=val(a),y=val(b);
        if(s.k==='number'&&(!x||!y))return(!x)-(!y);   // drafts (no number) last either way
        return(x<y?-1:x>y?1:0)*m||(a.date<b.date?1:a.date>b.date?-1:0);});}
    JC={src:all,key,list:out};return out;
  }
  function sortTH(p,k,label,num){
    const s=U[p].sort,on=s&&s.k===k,dir=on?s.dir:null;
    return`<th scope="col"${num?' class="num"':''} aria-sort="${on?(dir==='asc'?'ascending':'descending'):'none'}"><button class="bk-sort" data-bk="sort" data-p="${p}" data-k="${k}">${escH(label)}${ic(on?(dir==='asc'?'arrow-up':'arrow-down'):'arrow-up-down')}</button></th>`;
  }
  // Dates and amounts sort descending first, text ascending; a third click returns to the default.
  function cycleSort(p,k){
    const first=k==='number'||k==='code'?'asc':'desc',s=U[p].sort;
    if(!s||s.k!==k)U[p].sort={k,dir:first};
    else if(s.dir===first)U[p].sort={k,dir:first==='asc'?'desc':'asc'};
    else U[p].sort=null;
    resetPage(p);
  }
  function lockNote(j){
    if(!j||typeof ledgerPeriodState!=='function')return'';
    const M=String(j.date).slice(0,7),s=ledgerPeriodState(M);if(s==='open')return'';
    return`<div class="bk-locknote" id="bkLock" data-state="${s}">${ic('lock','s16')}<span>${escH(monthLabel(M,true))} is ${s}. Reopen it in <button class="bk-link" data-bk="goperiods" data-y="${M.slice(0,4)}">Periods</button> to change entries.</span></div>`;
  }
  function voucherHTML(j){
    if(!j)return emptyHTML('book-open','Select a journal to see its lines');
    let dr=0,cr=0;
    const rows=(j.lines||[]).map(l=>{const a=Math.round(l.amount||0),c=String(l.account),known=!!accOf(c);if(a>0)dr+=a;else cr-=a;
      return`<tr><td class="bk-acc"><div class="merchant-name"><span class="bk-code">${escH(c)}</span>${escH(known?nameOf(c):'Not in your chart')}</div>
        <div class="merchant-sub">${l.memo?`<span>${escH(l.memo)}</span>`:''}${l.fx?`<span class="badge">${escH(l.fx.ccy)} ${escH(String(l.fx.amount))} @ ${escH(String(l.fx.rate))}</span>`:''}${known?`<button class="bk-link" data-bk="led" data-code="${attr(c)}" data-from="${attr(j.date.slice(0,4)+'-01-01')}" data-to="${attr(j.date)}">Ledger${ic('chevron-right')}</button>`:''}</div></td>
        <td class="num hide-sm">${plain(a>0?a:0)}</td><td class="num hide-sm">${plain(a<0?-a:0)}</td><td class="num only-sm"><span class="bk-dc">${a<0?'Cr':'Dr'}</span>${plain(Math.abs(a))}</td></tr>`;}).join('');
    const bal=dr===cr&&dr>0,en=EN();
    const tools=en&&typeof en.voucherTools==='function'?en.voucherTools(j)||'':'';
    const lock=/\ben-lock\b/.test(tools)?'':lockNote(j);
    const errs=j.status==='draft'&&j.errors&&j.errors.length?`<div class="bk-errs" id="bkVErrs">${j.errors.map(e=>`<div class="help err">${ic('triangle-alert','s16')}<span>${escH(e)}</span></div>`).join('')}</div>`:'';
    const batch=en&&typeof en.batchBadge==='function'?en.batchBadge(j)||'':'';
    return`<div class="bk-vhead" id="bkVHead" data-id="${attr(j.id)}" data-status="${attr(j.status)}"><div class="eyebrow">${escH(dLong(j.date))}${j.refNo?` · ${escH(j.refNo)}`:''}</div>
        <div class="bk-vtitle" id="bkVNum">${numHTML(j)}</div>
        <div class="muted" style="overflow-wrap:anywhere">${escH(j.description||'')}</div>
        <div class="bk-badges">${kindBadge(j.kind)}${statBadge(j.status)}${batch}</div></div>
      ${lock}${errs}
      <div class="table-wrap"><table class="data" id="bkVLines" data-id="${attr(j.id)}"><thead><tr><th scope="col">Account</th><th scope="col" class="num hide-sm">Debit</th><th scope="col" class="num hide-sm">Credit</th><th scope="col" class="num only-sm">Amount</th></tr></thead>
        <tbody>${rows}</tbody><tfoot><tr class="bk-tot"><td>Total ${bal?'<span class="badge good">Balanced</span>':'<span class="badge bad">Not balanced</span>'}</td>
        <td class="num hide-sm" id="bkVDr" data-raw="${dr}">${plain(dr)}</td><td class="num hide-sm" id="bkVCr" data-raw="${cr}">${plain(cr)}</td><td class="num only-sm"><span class="bk-dc">${bal?'Dr = Cr':'Dr'}</span>${plain(dr)}</td></tr></tfoot></table></div>${tools}`;
  }
  function openVoucherSheet(id){const j=findJournal(id);if(!j)return;openSheet({title:'Journal',body:voucherHTML(j),wide:true});}
  function jRowHTML(j){
    const sel=U.journals.sel===j.id,en=EN();
    return`<tr class="clickable${sel?' selected':''}" data-bk="jopen" data-id="${attr(j.id)}" data-status="${attr(j.status)}" tabindex="0">
      <td class="bk-no">${numHTML(j)}</td><td class="date">${escH(dShort(j.date))}</td>
      <td class="merchant"><div class="merchant-name" style="font-weight:500">${escH(j.description||'—')}</div><div class="merchant-sub">${j.refNo?`<span>${escH(j.refNo)}</span>`:''}${en&&en.batchBadge?en.batchBadge(j):''}<span>${j.lines.length} lines</span></div></td>
      <td><div class="bk-badges">${kindBadge(j.kind)}${statBadge(j.status)}</div></td><td class="num" data-raw="${j.debit}" style="white-space:nowrap">${plain(j.debit)}</td></tr>`;
  }
  function jItemHTML(j){
    return`<button class="list-item" data-bk="jopen" data-id="${attr(j.id)}" data-status="${attr(j.status)}"><span class="li-body"><span class="li-title" style="display:block">${escH(j.description||'—')}</span>
      <span class="li-sub" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${escH(dShort(j.date))} · ${numHTML(j)} ${kindBadge(j.kind)}${j.status!=='posted'?statBadge(j.status):''}</span></span><span class="li-amt">${plain(j.debit)}</span></button>`;
  }
  function jListHTML(){
    const list=jFiltered(),n=list.length,pages=Math.max(1,Math.ceil(n/PAGE_SIZE)),u=U.journals;
    if(u.page>=pages)u.page=pages-1;if(u.page<0)u.page=0;
    if(!n){const any=chipList('journals').length;
      return`<div style="padding:0 var(--card-pad) var(--card-pad)" id="bkJEmpty">${any?emptyBk('search','No journals match','Clear all filters','clearall',' data-p="journals"'):emptyBk('book-open','No journals yet',EN()&&EN().open?'New journal':'','jnew')}</div>`;}
    const s=u.page*PAGE_SIZE,page=list.slice(s,s+PAGE_SIZE);
    const pager=`<div class="bk-pager"><span class="help" id="bkJCount" data-n="${n}">${(s+1).toLocaleString('en-GB')}–${(s+page.length).toLocaleString('en-GB')} of ${n.toLocaleString('en-GB')} journals</span>
      <span class="btns"><button class="btn btn-secondary btn-sm" data-bk="page" data-p="journals" data-d="-1" ${u.page===0?'disabled':''}>${ic('chevron-left','s16')}Previous</button>
      <button class="btn btn-secondary btn-sm" data-bk="page" data-p="journals" data-d="1" ${u.page>=pages-1?'disabled':''}>Next${ic('chevron-right','s16')}</button></span></div>`;
    return`<div class="table-wrap hide-sm"><table class="data" id="bkJTable"><thead><tr>${sortTH('journals','number','Number')}${sortTH('journals','date','Date')}<th scope="col">Description</th><th scope="col">Kind · status</th>${sortTH('journals','amount','Amount',true)}</tr></thead>
      <tbody>${page.map(jRowHTML).join('')}</tbody></table></div>
      <div class="list bk-list only-sm" style="padding:0 var(--card-pad)">${page.map(jItemHTML).join('')}</div>${pager}`;
  }
  function renderJournals(){
    const g=gateHTML('Journals');if(g)return g;
    const f=st('journals'),en=EN();
    if(f.acc&&!f.acc.startsWith('kind:')&&!accOf(f.acc))f.acc='';
    const status=`<select class="input" data-bk="status" data-p="journals" aria-label="Status"><option value="">All statuses</option>${Object.entries(JSTAT).map(([k,[l]])=>`<option value="${k}"${f.status===k?' selected':''}>${l}</option>`).join('')}</select>`;
    const kind=`<select class="input" data-bk="jkind" data-p="journals" aria-label="Kind"><option value="">All kinds</option>${Object.entries(JKIND).map(([k,[l]])=>`<option value="${k}"${f.jkind===k?' selected':''}>${l}</option>`).join('')}</select>`;
    const kinds=['income','expense'].map(k=>`<option value="kind:${k}"${f.acc==='kind:'+k?' selected':''}>Any ${k} account</option>`).join('');
    const acc=`<select class="input me-select" data-bk="acc" data-p="journals" aria-label="Account">${accOptions(f.acc,{blank:'All accounts',extra:kinds})}</select>`;
    let sel=U.journals.sel?findJournal(U.journals.sel):null;if(!sel)U.journals.sel=null;
    const drafts=f.status==='draft'?jFiltered().filter(j=>j.status==='draft'):[];
    const postAll=drafts.length&&typeof ledgerPostDrafts==='function'?`<button class="btn btn-secondary btn-sm" data-bk="jpostall" id="bkJPostAll">${ic('plus','s16')}Post all (${drafts.length})</button>`:'';
    const newBtn=en&&typeof en.open==='function'?(typeof en.newEntryBtn==='function'?en.newEntryBtn('btn-primary'):`<button class="btn btn-primary btn-sm" data-bk="jnew">${ic('plus','s16')}New journal</button>`):'';
    return`${pageHead('Journals','Every journal in your book: drafts, posted and void. Only posted journals count in the reports.',`${newBtn}${xlBtn('journals')}${hideBtn()}`)}
      <div class="bk-bar">${searchBox('journals','Search number or description')}${status}${kind}${acc}${presetChips('journals','range')}${dateFields('journals','range')}</div>
      ${chipsHTML('journals')}
      <div class="grid"><section class="card flush span-7">${cardHead('book-open','Journals','Newest first · amount = total debits',postAll)}<div id="bkJList">${jListHTML()}</div></section>
        <section class="card span-5 hide-sm bk-panel" id="bkVPanel">${voucherHTML(sel)}</section></div>`;
  }
  function jRefreshList(){const el=$('bkJList');if(el)el.innerHTML=jListHTML();else renderAll();}
  function jSelect(id){
    const j=findJournal(id);if(!j)return;
    U.journals.sel=j.id;
    const en=EN();
    if(j.status==='draft'&&en&&typeof en.openDraft==='function'){en.openDraft(j.id);}
    else if(isMobile()){openVoucherSheet(j.id);return;}
    const p=$('bkVPanel');if(!p){if(ACTIVE_TAB==='journals')renderAll();return;}
    p.innerHTML=voucherHTML(j);
    document.querySelectorAll('#bkJTable tr.selected').forEach(r=>r.classList.remove('selected'));
    const r=document.querySelector(`#bkJTable tr[data-id="${CSS.escape(j.id)}"]`);if(r)r.classList.add('selected');
  }
  function xlJournals(){
    const list=jFiltered().slice().reverse(),f=st('journals'),rows=[];let dr=0,cr=0;
    for(const j of list)for(const l of j.lines){const a=Math.round(l.amount||0),c=String(l.account);if(j.status==='posted'){if(a>0)dr+=a;else cr-=a;}
      rows.push({v:[j.date,j.number||'(draft)',j.refNo||'',j.description||'',(JKIND[j.kind]||[j.kind])[0],(JSTAT[j.status]||[j.status])[0],c,accOf(c)?nameOf(c):c,l.memo||'',a>0?a:null,a<0?-a:null,l.fx?`${l.fx.ccy} ${l.fx.amount} @ ${l.fx.rate}`:'']});}
    rows.push({v:['','','','Total of posted journals','','','','','',dr,cr,''],s:'grand'});
    const per=f.from||f.to?`${f.from||'start'}_${f.to||'end'}`:'all';
    const fl=chipList('journals').map(c=>c[1]).join(' · ');
    return xlReport({file:`journals-${per}.xlsx`,sheet:'Journals',xSplit:0,numCols:[10,11],
      title:`Journals · ${rangeLabel(f.from,f.to)}`,sub:`${list.length} journal${list.length===1?'':'s'}${fl?' · '+fl:''} · amounts in Rp, debit and credit per line`,
      head:['Date','Number','Accurate no.','Description','Kind','Status','Account','Account name','Memo','Debit','Credit','Foreign amount'],widths:[12,16,14,40,14,10,12,32,30,18,18,24],rows});
  }

  /* ══ General ledger ══ */
  function glTable(a,from,limit,id){
    const rows=a.rows,shown=limit?rows.slice(0,limit):rows;
    const tr=shown.map(r=>`<tr class="clickable" data-bk="vopen" data-id="${attr(r.id)}" tabindex="0"><td class="date">${escH(dShort(r.date))}</td>
        <td class="bk-no hide-sm">${escH(r.number||'')}</td>
        <td class="merchant"><div class="merchant-name" style="font-weight:500">${escH(r.description||'—')}</div><div class="merchant-sub"><span class="only-sm">${escH(r.number||'')}</span>${r.memo&&r.memo!==r.description?`<span>${escH(r.memo)}</span>`:''}</div></td>
        <td class="num hide-sm">${plain(r.debit)}</td><td class="num hide-sm">${plain(r.credit)}</td><td class="num only-sm">${money(r.debit-r.credit)}</td><td class="num" data-raw="${r.running}">${money(r.running)}</td></tr>`).join('');
    const more=shown.length<rows.length?`<div class="table-foot"><button class="btn btn-ghost btn-sm" data-bk="glmore" data-code="${attr(a.code)}">Show all (${(rows.length-shown.length).toLocaleString('en-GB')} more)</button></div>`:'';
    return`<div class="table-wrap"><table class="data bk-gltable"${id?` id="${id}"`:''} data-code="${attr(a.code)}"><thead><tr><th scope="col">Date</th><th scope="col" class="hide-sm">Number</th><th scope="col">Description</th><th scope="col" class="num hide-sm">Debit</th><th scope="col" class="num hide-sm">Credit</th><th scope="col" class="num only-sm">Change</th><th scope="col" class="num">Running</th></tr></thead>
      <tbody><tr class="bk-open"><td class="date">${from?escH(dShort(from)):''}</td><td class="hide-sm"></td><td>Opening</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="only-sm"></td><td class="num bk-opening" data-raw="${a.opening}">${money(a.opening)}</td></tr>
        ${tr||`<tr><td colspan="7" class="muted">No entries in this range</td></tr>`}</tbody>
      <tfoot><tr class="bk-tot"><td class="date">Closing</td><td class="hide-sm"></td><td></td><td class="num hide-sm bk-tdr" data-raw="${a.debit}">${plain(a.debit)}</td><td class="num hide-sm bk-tcr" data-raw="${a.credit}">${plain(a.credit)}</td><td class="only-sm"></td><td class="num bk-closing" data-raw="${a.closing}">${money(a.closing)}</td></tr></tfoot></table></div>${more}`;
  }
  function renderLedger(){
    const g=gateHTML('General ledger');if(g)return g;
    const f=st('ledger');if(f.acc&&!accOf(f.acc))f.acc='';
    const d=report(()=>ledgerLib.gl(null,f.acc||null,f.from||null,f.to||null),{accounts:[]});
    const acc=`<select class="input me-select" data-bk="acc" data-p="ledger" aria-label="Account">${accOptions(f.acc,{blank:'All accounts',postable:true,archived:true})}</select>`;
    const cards=d.accounts.map(a=>`<section class="card flush span-12 bk-gl" data-code="${attr(a.code)}">${cardHead('file-text',`${escH(a.code)} · ${escH(a.name)}`,`${escH(KIND_LABEL[a.kind]||'Not in your chart')} · ${escH(rangeLabel(f.from,f.to))} · debit +, credit −`)}
        ${glTable(a,f.from,U.ledger.more.has(a.code)?0:200)}</section>`).join('');
    return`${pageHead('General ledger','Each account’s entries with a running balance, from posted journals.',`${xlBtn('ledger')}${hideBtn()}`)}
      <div class="bk-bar">${acc}${presetChips('ledger','range')}${dateFields('ledger','range')}</div>${chipsHTML('ledger')}
      <div class="grid" id="bkGL">${cards||`<section class="card span-12">${emptyHTML('inbox','No entries in this range')}</section>`}</div>`;
  }
  function xlLedger(){
    const f=st('ledger'),d=report(()=>ledgerLib.gl(null,f.acc||null,f.from||null,f.to||null),{accounts:[]}),rows=[];
    for(const a of d.accounts){rows.push({v:[a.code,a.name],s:'sec'});
      rows.push({v:['',f.from||'','','Opening',null,null,a.opening],s:'tot'});
      for(const r of a.rows)rows.push({v:['',r.date,r.number||'',r.description||'',r.debit||null,r.credit||null,r.running]});
      rows.push({v:['',f.to||'','','Closing',a.debit,a.credit,a.closing],s:'grand'});}
    return xlReport({file:`ledger-${f.acc||'all'}-${f.from||'start'}_${f.to||'end'}.xlsx`.replace(/[^\w.-]/g,'_'),sheet:'General ledger',xSplit:0,numCols:[5,6,7],
      title:`General ledger · ${f.acc?`${f.acc} ${nameOf(f.acc)}`:'All accounts'}`,sub:`${rangeLabel(f.from,f.to)} · amounts in Rp · debit +, credit −`,
      head:['Account','Date','Number','Description','Debit','Credit','Running'],widths:[14,12,16,44,18,18,20],rows});
  }

  /* ══ Trial balance ══ */
  function tbData(){
    const f=st('tb'),t=report(()=>ledgerLib.tb(null,f.from||null,f.to||null),null),cr=cmpRange(f);
    const c=f.cmp!=='off'&&cr?report(()=>ledgerLib.tb(null,cr[0],cr[1]),null):null;
    return{f,t,c,cr};
  }
  function renderTB(){
    const g=gateHTML('Trial balance');if(g)return g;
    const{f,t,c,cr}=tbData();if(!t)return`${pageHead('Trial balance','')}<div class="card">${emptyHTML('triangle-alert','Pick a valid date range')}</div>`;
    const on=!!c,cm=new Map(on?c.rows.map(r=>[r.code,r]):[]);
    const codes=on?[...new Set([...t.rows.map(r=>r.code),...c.rows.map(r=>r.code)])].sort(cmpCode):t.rows.map(r=>r.code);
    const tm=new Map(t.rows.map(r=>[r.code,r])),z={opening:0,debit:0,credit:0,closing:0};
    const cmpLabel=on?`Closing ${rangeLabel(cr[0],cr[1])}`:'';
    const rows=codes.map(code=>{const r=tm.get(code)||{...z,code,name:(cm.get(code)||{}).name||code,kind:(cm.get(code)||{}).kind},q=cm.get(code)||z;
      const zero=!r.opening&&!r.debit&&!r.credit&&!r.closing&&(!on||!q.closing);
      return`<tr class="clickable${zero?' bk-zero':''}" data-bk="tbled" data-code="${attr(code)}" data-row="${attr(code)}" tabindex="0"><td class="bk-no hide-sm">${escH(code)}</td>
        <td class="bk-acc"><div class="merchant-name"><span class="bk-code only-sm">${escH(code)}</span>${escH(r.name)}${r.unknown?' <span class="badge warn">Not in your chart</span>':''}</div><div class="merchant-sub only-sm flex" style="gap:6px;flex-wrap:wrap"><span>Opening ${money(r.opening)}</span><span>Dr ${money(r.debit)}</span><span>Cr ${money(r.credit)}</span></div></td>
        <td class="num hide-sm" data-k="opening" data-raw="${r.opening}">${money(r.opening)}</td><td class="num hide-sm" data-k="debit" data-raw="${r.debit}">${plain(r.debit)}</td><td class="num hide-sm" data-k="credit" data-raw="${r.credit}">${plain(r.credit)}</td>
        ${amtTDs(r.closing,q.closing,on,null,'bk-cl')}</tr>`;}).join('');
    const T=t.totals,CT=on?c.totals:z;
    return`${pageHead('Trial balance','Opening, debits, credits and closing per account, from posted journals.',`${xlBtn('tb')}${hideBtn()}`)}
      <div class="bk-bar">${presetChips('tb','range')}${dateFields('tb','range')}${cmpControls('tb','range')}</div>${chipsHTML('tb')}
      <div class="grid"><section class="card span-12" id="bkTBChecks">
          ${statusLine(t.balanced,'Debits and credits balance',`Debits ${money(T.debit)} · credits ${money(T.credit)}`,'bkTBBal')}
          ${statusLine(t.openingBalanced,'Opening balances balance',t.openingBalanced?'Every balance before the start date nets to zero':`Off by ${money(Math.abs(T.opening))}`,'bkTBOpen')}</section></div>
      <div class="grid"><section class="card flush span-12">${cardHead('square-check',escH(rangeLabel(f.from,f.to)),'Raw amounts: debit +, credit − · tap a row for its ledger')}
        <div class="table-wrap"><table class="data bk-stmt" id="bkTB"><thead><tr><th scope="col" class="hide-sm">Code</th><th scope="col">Name</th><th scope="col" class="num hide-sm">Opening</th><th scope="col" class="num hide-sm">Debit</th><th scope="col" class="num hide-sm">Credit</th>${amtTHs(on,'Closing',cmpLabel)}</tr></thead>
        <tbody>${rows}</tbody><tfoot><tr class="bk-grand" id="bkTBTot"><td class="hide-sm"></td><td>Total</td><td class="num hide-sm" data-k="opening" data-raw="${T.opening}">${money(T.opening)}</td><td class="num hide-sm" data-k="debit" data-raw="${T.debit}">${plain(T.debit)}</td><td class="num hide-sm" data-k="credit" data-raw="${T.credit}">${plain(T.credit)}</td>${amtTDs(T.closing,CT.closing,on,null,'bk-cl')}</tr></tfoot></table></div></section></div>`;
  }
  function openTBLedger(code){
    const f=st('tb'),d=report(()=>ledgerLib.gl(null,code,f.from||null,f.to||null),{accounts:[]}),a=d.accounts[0];if(!a)return;
    openSheet({title:`${a.code} · ${a.name}`,wide:true,body:`<p class="help" style="margin:0 0 8px">${escH(rangeLabel(f.from,f.to))} · debit +, credit −</p>${glTable(a,f.from,0,'bkTBLedger')}
      <div style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-bk="led" data-code="${attr(code)}" data-from="${attr(f.from)}" data-to="${attr(f.to)}">Open in General ledger${ic('chevron-right','s16')}</button></div>`});
  }
  function xlTB(){
    const{f,t,c,cr}=tbData();if(!t)return false;const on=!!c,cm=new Map(on?c.rows.map(r=>[r.code,r]):[]),tm=new Map(t.rows.map(r=>[r.code,r]));
    const codes=on?[...new Set([...t.rows.map(r=>r.code),...c.rows.map(r=>r.code)])].sort(cmpCode):t.rows.map(r=>r.code),z={opening:0,debit:0,credit:0,closing:0};
    const rows=codes.map(code=>{const r=tm.get(code)||{...z,name:(cm.get(code)||{}).name||code,kind:(cm.get(code)||{}).kind},q=cm.get(code)||z;
      return{v:[code,r.name,KIND_LABEL[r.kind]||'',r.opening,r.debit,r.credit,r.closing,...(on?xlCmp(r.closing,q.closing):[])]};});
    const T=t.totals;rows.push({v:['','Total','',T.opening,T.debit,T.credit,T.closing,...(on?xlCmp(T.closing,c.totals.closing):[])],s:'grand'});
    rows.push({v:['',`Debits and credits balance: ${t.balanced?'yes':'NO'} · opening balances balance: ${t.openingBalanced?'yes':'NO'}`]});
    return xlReport({file:`trial-balance-${f.from}_${f.to}.xlsx`,sheet:'Trial balance',numCols:[4,5,6,7,...(on?[8,9]:[])],pctCols:on?[10]:[],
      title:`Trial balance · ${rangeLabel(f.from,f.to)}`,sub:`Amounts in Rp · raw amounts, debit +, credit −${on?` · compared with ${rangeLabel(cr[0],cr[1])}`:''}`,
      head:['Code','Account','Type','Opening','Debit','Credit','Closing',...(on?[`Closing ${rangeLabel(cr[0],cr[1])}`,'Change','Change %']:[])],widths:[12,40,11,18,18,18,18,...(on?[22,18,11]:[])],rows});
  }

  /* ══ Income statement ══ */
  function plData(){
    const f=st('pl'),p=report(()=>ledgerLib.pl(null,f.from||null,f.to||null),null),cr=cmpRange(f);
    const c=f.cmp!=='off'&&cr?report(()=>ledgerLib.pl(null,cr[0],cr[1]),null):null;
    const merge=(a,b)=>{const m=new Map();for(const r of a)m.set(r.code,{code:r.code,name:r.name,cur:r.amount,prev:0});for(const r of b||[]){const x=m.get(r.code)||{code:r.code,name:r.name,cur:0,prev:0};x.prev=r.amount;m.set(r.code,x);}return[...m.values()].sort((x,y)=>cmpCode(x.code,y.code));};
    return p&&{f,p,c,cr,inc:merge(p.income,c&&c.income),exp:merge(p.expense,c&&c.expense)};
  }
  function plSection(id,title,icon,rows,tot,ctot,on,dir,cmpLabel,link){
    const body=rows.map(r=>`<tr class="clickable bk-row" data-bk="led" data-code="${attr(r.code)}" data-from="${attr(link.from)}" data-to="${attr(link.to)}" data-row="${attr(r.code)}" tabindex="0">
        <td class="bk-no hide-sm">${escH(r.code)}</td><td class="bk-acc"><div class="merchant-name"><span class="bk-code only-sm">${escH(r.code)}</span>${escH(r.name)}</div></td>${amtTDs(r.cur,r.prev,on,dir)}</tr>`).join('');
    return`<section class="card flush span-12" id="${id}">${cardHead(icon,title,'')}
      <div class="table-wrap"><table class="data bk-stmt"><thead><tr><th scope="col" class="hide-sm">Code</th><th scope="col">Name</th>${amtTHs(on,'Amount',cmpLabel)}</tr></thead>
      <tbody>${body||`<tr><td colspan="${on?5:3}" class="muted">Nothing in this range</td></tr>`}</tbody>
      <tfoot><tr class="bk-tot" data-tot="${id}"><td class="hide-sm"></td><td>Total ${escH(title.toLowerCase())}</td>${amtTDs(tot,ctot,on,dir)}</tr></tfoot></table></div></section>`;
  }
  function renderPL(){
    const g=gateHTML('Income statement');if(g)return g;
    const d=plData();if(!d)return`${pageHead('Income statement','')}<div class="card">${emptyHTML('triangle-alert','Pick a valid date range')}</div>`;
    const{f,p,c,cr}=d,on=!!c,cmpLabel=on?rangeLabel(cr[0],cr[1]):'',link={from:f.from,to:f.to};
    const net=p.net,loss=net<0,cnet=on?c.net:0;
    const netCmp=on?`<div class="merchant-sub flex bk-cmpsub" style="font-size:13px">vs ${money(cnet)} (${escH(cmpLabel)}) · ${chgHTML(net,cnet,'up')}</div>`:'';
    return`${pageHead('Income statement','Income and expenses over a date range, from posted journals. Year-end closing entries never count here.',`${xlBtn('pl')}${hideBtn()}`)}
      <div class="bk-bar">${presetChips('pl','range')}${dateFields('pl','range')}${cmpControls('pl','range')}</div>${chipsHTML('pl')}
      <div class="grid">${plSection('bkPLInc','Income','chart-column',d.inc,p.totalIncome,on?c.totalIncome:0,on,'up',cmpLabel,link)}</div>
      <div class="grid">${plSection('bkPLExp','Expenses','receipt',d.exp,p.totalExpense,on?c.totalExpense:0,on,'down',cmpLabel,link)}</div>
      <div class="grid"><section class="card flush span-12"><div class="bk-net" id="bkPLNet" data-raw="${net}" data-loss="${loss?1:0}"><span>${loss?'Net loss':'Net profit'} · ${escH(rangeLabel(f.from,f.to))}</span>
        <span class="bk-net-v${loss?' bk-bad':''}">${money(Math.abs(net))}${netCmp}</span></div></section></div>`;
  }
  function xlPL(){
    const d=plData();if(!d)return false;const{f,p,c,cr}=d,on=!!c;
    const row=(code,name,cur,prev,s)=>({v:[code,name,cur,...(on?xlCmp(cur,prev):[])],s});
    const rows=[{v:['INCOME'],s:'sec'},...d.inc.map(r=>row(r.code,r.name,r.cur,r.prev)),row('','Total income',p.totalIncome,on?c.totalIncome:0,'tot'),
      {v:['EXPENSES'],s:'sec'},...d.exp.map(r=>row(r.code,r.name,r.cur,r.prev)),row('','Total expenses',p.totalExpense,on?c.totalExpense:0,'tot'),
      row('',p.net<0?'Net loss (shown negative)':'Net profit',p.net,on?c.net:0,'grand')];
    return xlReport({file:`income-statement-${f.from}_${f.to}.xlsx`,sheet:'Income statement',numCols:[3,...(on?[4,5]:[])],pctCols:on?[6]:[],
      title:`Income statement · ${rangeLabel(f.from,f.to)}`,sub:`Amounts in Rp · income and expenses shown positive; net = income − expenses · year-end closing entries left out${on?` · compared with ${rangeLabel(cr[0],cr[1])}`:''}`,
      head:['Code','Account','Amount',...(on?[rangeLabel(cr[0],cr[1]),'Change','Change %']:[])],widths:[12,46,20,...(on?[22,18,11]:[])],rows});
  }

  /* ══ Balance sheet ══ */
  function bsData(){
    const f=st('bs'),b=report(()=>ledgerLib.bs(null,f.asOf),null),ca=f.cmp!=='off'?cmpAsOf(f):null,c=ca?report(()=>ledgerLib.bs(null,ca),null):null;
    const merge=(a,x)=>{const m=new Map();for(const r of a)m.set(r.code,{code:r.code,name:r.name,cur:r.amount,prev:0,unknown:r.unknown});for(const r of x||[]){const y=m.get(r.code)||{code:r.code,name:r.name,cur:0,prev:0};y.prev=r.amount;m.set(r.code,y);}return[...m.values()].sort((p,q)=>cmpCode(p.code,q.code));};
    return b&&{f,b,c,ca,A:merge(b.assets,c&&c.assets),L:merge(b.liabilities,c&&c.liabilities),E:merge(b.equity,c&&c.equity)};
  }
  // The two earnings lines; a negative one is relabelled as a loss, shown positive.
  function earnRows(d){
    const{b,c}=d,out=[],pr=b.unclosedPriorEarnings,cy=b.currentYearEarnings,cpr=c?c.unclosedPriorEarnings:0,ccy=c?c.currentYearEarnings:0;
    if(pr||cpr)out.push({calc:'prior',name:pr<0?'Unclosed prior-year loss':'Unclosed prior-year earnings',loss:pr<0,cur:pr,prev:cpr});
    out.push({calc:'cy',name:cy<0?'Current-year loss':'Current-year earnings',loss:cy<0,cur:cy,prev:ccy});
    return out;
  }
  function bsRows(list,link,on,dir){
    return list.map(r=>`<tr class="clickable bk-row" data-bk="led" data-code="${attr(r.code)}" data-from="${attr(link.from)}" data-to="${attr(link.to)}" data-row="${attr(r.code)}" tabindex="0">
      <td class="bk-no hide-sm">${escH(r.code)}</td><td class="bk-acc"><div class="merchant-name"><span class="bk-code only-sm">${escH(r.code)}</span>${escH(r.name)}${r.unknown?' <span class="badge warn">Not in your chart</span>':''}</div></td>${amtTDs(r.cur,r.prev,on,dir)}</tr>`).join('');
  }
  function renderBS(){
    const g=gateHTML('Balance sheet');if(g)return g;
    const d=bsData();if(!d)return`${pageHead('Balance sheet','')}<div class="card">${emptyHTML('triangle-alert','Pick a valid date')}</div>`;
    const{f,b,c,ca}=d,on=!!c,cmpLabel=on?dLong(ca):'',link={from:b.fyStart,to:b.asOf},nc=on?5:3;
    const tot=(id,label,cur,prev,dir,grand)=>`<tr class="${grand?'bk-grand':'bk-tot'}" data-tot="${id}"><td class="hide-sm"></td><td>${escH(label)}</td>${amtTDs(cur,prev,on,dir)}</tr>`;
    const sec=label=>`<tr class="bk-sec"><th scope="rowgroup" colspan="${nc}">${escH(label)}</th></tr>`;
    const head=`<thead><tr><th scope="col" class="hide-sm">Code</th><th scope="col">Name</th>${amtTHs(on,'Amount',cmpLabel)}</tr></thead>`;
    const earn=earnRows(d).map(r=>{const s=r.loss?-1:1;
      return`<tr class="bk-row" data-calc="${r.calc}"><td class="hide-sm"></td><td class="bk-acc"><div class="merchant-name${r.loss?' bk-bad':''}">${escH(r.name)}</div></td>${amtTDs(s*r.cur,s*r.prev,on,r.loss?'down':'up',r.loss?'bk-bad':'')}</tr>`;}).join('');
    const ok=b.balanced;
    return`${pageHead('Balance sheet','What you own, owe and are worth on a date, from posted journals.',`${xlBtn('bs')}${hideBtn()}`)}
      <div class="bk-bar">${presetChips('bs','asof')}${dateFields('bs','asof')}${cmpControls('bs','asof')}</div>${chipsHTML('bs')}
      <div class="grid"><section class="card span-12">${statusLine(ok,ok?'Balanced':'Not balanced',ok?`Assets equal liabilities plus equity on ${escH(dLong(b.asOf))}`:`Assets ${money(b.totalAssets)} · liabilities and equity ${money(b.totalLE)}`,'bkBSCheck')}</section></div>
      <div class="grid" id="bkBS">
        <section class="card flush span-6" id="bkBSA">${cardHead('scale','Assets',`As of ${escH(dLong(b.asOf))}`)}
          <div class="table-wrap"><table class="data bk-stmt">${head}<tbody>${bsRows(d.A,link,on,null)||`<tr><td colspan="${nc}" class="muted">No assets</td></tr>`}</tbody>
          <tfoot>${tot('A','Total assets',b.totalAssets,on?c.totalAssets:0,null,true)}</tfoot></table></div></section>
        <section class="card flush span-6" id="bkBSLE">${cardHead('scale','Liabilities and equity',`As of ${escH(dLong(b.asOf))}`)}
          <div class="table-wrap"><table class="data bk-stmt">${head}<tbody>${sec('Liabilities')}${bsRows(d.L,link,on,null)}${tot('L','Total liabilities',b.totalLiabilities,on?c.totalLiabilities:0,null)}
            ${sec('Equity')}${bsRows(d.E,link,on,null)}${earn}${tot('E','Total equity',b.totalEquity,on?c.totalEquity:0,'up')}</tbody>
          <tfoot>${tot('LE','Total liabilities and equity',b.totalLE,on?c.totalLE:0,null,true)}</tfoot></table></div></section></div>`;
  }
  function xlBS(){
    const d=bsData();if(!d)return false;const{f,b,c,ca}=d,on=!!c;
    const row=(code,name,cur,prev,s)=>({v:[code,name,cur,...(on?xlCmp(cur,prev):[])],s});
    const er=earnRows(d).map(r=>{const s=r.loss?-1:1;return row('',r.name,s*r.cur,s*r.prev);});
    const rows=[{v:['ASSETS'],s:'sec'},...d.A.map(r=>row(r.code,r.name,r.cur,r.prev)),row('','Total assets',b.totalAssets,on?c.totalAssets:0,'grand'),
      {v:['LIABILITIES'],s:'sec'},...d.L.map(r=>row(r.code,r.name,r.cur,r.prev)),row('','Total liabilities',b.totalLiabilities,on?c.totalLiabilities:0,'tot'),
      {v:['EQUITY'],s:'sec'},...d.E.map(r=>row(r.code,r.name,r.cur,r.prev)),...er,row('','Total equity',b.totalEquity,on?c.totalEquity:0,'tot'),
      row('','Total liabilities and equity',b.totalLE,on?c.totalLE:0,'grand'),{v:['',b.balanced?'Balanced':'NOT balanced']}];
    return xlReport({file:`balance-sheet-${b.asOf}.xlsx`,sheet:'Balance sheet',numCols:[3,...(on?[4,5]:[])],pctCols:on?[6]:[],
      title:`Balance sheet as of ${dLong(b.asOf)}`,sub:`Amounts in Rp · liabilities and equity shown positive${on?` · compared with ${dLong(ca)}`:''}`,
      head:['Code','Account','Amount',...(on?[dLong(ca),'Change','Change %']:[])],widths:[12,46,20,...(on?[20,18,11]:[])],rows});
  }

  /* ══ Chart of accounts ══ */
  // Amount at the as-of date, natural sign: balance-sheet accounts their balance, income and
  // expense accounts the year to date (both from the trial balance); a header sums the accounts under it.
  function coaAmounts(asOf){
    const t=report(()=>ledgerLib.tb(null,asOf.slice(0,4)+'-01-01',asOf),{rows:[]}),raw=new Map();
    for(const r of t.rows){const a=accOf(r.code),k=a?a.kind:r.kind;raw.set(r.code,sgn(k)*(isPL(k)?r.closing-r.opening:r.closing));}
    const A=ax(),out=new Map();
    const walk=c=>{if(out.has(c))return out.get(c);const ks=A.kids.get(c);let v=raw.get(c)||0;if(ks)for(const k of ks)v+=walk(k);out.set(c,v);return v;};
    for(const c of A.codes)walk(c);return out;
  }
  const COA_CELLS=[['asset','Own'],['liability','Owe'],['equity','Equity'],['income','Earned'],['expense','Spent']];
  function coaStrip(f,amt){
    const tot={};for(const c of ax().codes){const a=accOf(c);if(a.postable)tot[a.kind]=(tot[a.kind]||0)+(amt.get(c)||0);}
    const short=n=>`<span class="amt">${n<0?'−':''}${fmtIDRShort(Math.abs(n))}</span>`;
    const ytd=`${dLong(f.asOf.slice(0,4)+'-01-01').replace(/ \d{4}$/,'')} – ${dShort(f.asOf)}`;
    return`<div class="grid"><div class="card strip bk-strip span-12" role="group" aria-label="Show one type">${COA_CELLS.map(([k,l])=>{const on=f.kind===k,v=tot[k]||0;
      return`<button class="strip-cell k-${k}" data-bk="coa-kind" data-k="${k}" aria-pressed="${on}" title="${on?'Show every type':`Show only ${escH(KIND_LABEL[k].toLowerCase())} accounts`}">
        <span class="eyebrow">${l}</span><span class="strip-val" data-raw="${v}">${short(v)}</span><span class="strip-sub">${isPL(k)?escH(ytd):`On ${escH(dShort(f.asOf))}`}</span></button>`;}).join('')}</div></div>`;
  }
  function coaList(f){
    const q=f.q.trim().toLowerCase();
    return ax().codes.filter(c=>{const a=accOf(c);if(a.archived&&!f.arch)return false;if(f.kind&&a.kind!==f.kind)return false;
      return!q||c.toLowerCase().includes(q)||String(a.name).toLowerCase().includes(q);});
  }
  function renderCOA(){
    const g=gateHTML('Chart of accounts');if(g)return g;
    const f=st('coa'),amt=coaAmounts(f.asOf),list=coaList(f),A=ax(),u=U.coa;
    const canEdit=typeof ledgerEditAccount==='function';
    const rows=list.map(c=>{const a=A.acc.get(c),v=amt.get(c)||0,hdr=!a.postable;
      const acts=canEdit?`<div class="bk-acts hide-sm"><button class="icon-btn" data-bk="coa-edit" data-code="${attr(c)}" aria-label="Edit ${attr(c)}" title="Edit">${ic('pencil')}</button>
          ${a.archived?'':`<button class="icon-btn" data-bk="coa-arch" data-code="${attr(c)}" aria-label="Archive ${attr(c)}" title="Archive">${ic('archive')}</button>`}
          <button class="icon-btn" data-bk="coa-hist" data-code="${attr(c)}" aria-label="History of ${attr(c)}" title="History">${ic('history')}</button></div>
        <button class="icon-btn only-sm" data-bk="coa-more" data-code="${attr(c)}" aria-label="Actions for ${attr(c)}">${ic('ellipsis')}</button>`:'';
      const badges=[a.suspended?'<span class="badge">Suspended</span>':'',a.archived?'<span class="badge">Archived</span>':'',a.ccy&&a.ccy!=='IDR'?`<span class="badge">${escH(a.ccy)}</span>`:'',a.oldCode?`<span class="help">was ${escH(a.oldCode)}</span>`:''].join('');
      let h=`<tr class="clickable${hdr?' bk-hdr':''}" data-bk="led" data-code="${attr(c)}" data-row="${attr(c)}" tabindex="0">
        <td class="bk-no hide-sm">${escH(c)}</td>
        <td class="bk-acc bk-nm" style="--lvl:${A.dep.get(c)||0}"><div class="merchant-name">${escH(a.name)}</div><div class="merchant-sub"><span class="only-sm">${escH(c)} · ${escH(KIND_LABEL[a.kind])}${hdr?' · header':''}</span>${badges}</div></td>
        <td class="hide-sm">${escH(KIND_LABEL[a.kind]||a.kind)}</td><td class="num" data-raw="${v}">${money(v)}</td>
        <td class="bk-tick hide-sm" data-postable="${a.postable?1:0}">${a.postable?ic('check'):''}</td><td class="bk-tick hide-sm" data-archived="${a.archived?1:0}">${a.archived?ic('check'):''}</td><td>${acts}</td></tr>`;
      if(u.confirm===c)h+=`<tr class="bk-confirm" id="bkArchConfirm" data-code="${attr(c)}"><td colspan="7"><div class="bk-check">${ic('archive')}<span class="li-body"><span class="li-title" style="display:block">Archive ${escH(c)} ${escH(a.name)}?</span>
          <span class="li-sub" style="display:block">It leaves the account pickers and can’t take entries. There is no restore.</span>${u.err?`<span class="help err" id="bkArchErr">${ic('triangle-alert','s16')}<span>${escH(u.err)}</span></span>`:''}</span>
          <button class="btn btn-ghost btn-sm" data-bk="coa-arch-no">Cancel</button><button class="btn btn-danger btn-sm" data-bk="coa-arch-go" data-code="${attr(c)}">Archive</button></div></td></tr>`;
      return h;}).join('');
    const total=A.codes.length,nArch=A.codes.filter(c=>accOf(c).archived).length;
    const desc=`${list.length===total?`${total} accounts`:`${list.length} of ${total} accounts`} · amounts as of ${escH(dLong(f.asOf))}`;
    const newBtn=typeof ledgerAddAccount==='function'?`<button class="btn btn-secondary btn-sm" data-bk="coa-new">${ic('plus','s16')}New account</button>`:'';
    return`${pageHead('Chart of accounts','Every account in your book, by code. Tap one to see its entries.',`${newBtn}${xlBtn('coa')}${hideBtn()}`)}
      <div class="bk-bar">${searchBox('coa','Search code or name')}<label class="check"><input type="checkbox" data-bk="arch" data-p="coa" ${f.arch?'checked':''}> Show archived${nArch?` (${nArch})`:''}</label>${presetChips('coa','asof')}${dateFields('coa','asof')}</div>
      ${chipsHTML('coa')}${coaStrip(f,amt)}
      <div class="grid"><section class="card flush span-12">${cardHead('list-tree','Accounts',desc)}
        ${rows?`<div class="table-wrap"><table class="data bk-stmt bk-coa" id="bkCoa"><thead><tr><th scope="col" class="hide-sm">Code</th><th scope="col">Name</th><th scope="col" class="hide-sm">Type</th><th scope="col" class="num">Amount</th><th scope="col" class="hide-sm">Postable</th><th scope="col" class="hide-sm">Archived</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
          :`<div style="padding:0 var(--card-pad) var(--card-pad)">${emptyBk('search','No account matches','Clear all filters','clearall',' data-p="coa"')}</div>`}
        <p class="help bk-foot">Amounts read the normal way: what you own, owe, earned or spent shows positive; income and expenses are the year to date. A minus means the opposite, e.g. an overdrawn account. Headers (bold) add up the accounts under them and take no entries.</p>
      </section></div>`;
  }
  function usedCodes(){const s=new Set();for(const j of journals())for(const l of j.lines)s.add(String(l.account));return s;}
  function archiveReason(msg){
    if(/balance/.test(msg)){const n=+(msg.match(/(\d+)\s*$/)||[])[1];return`Can’t archive: it still has a balance${n?` of Rp ${fmtNum(n)}`:''}. Bring it to zero first.`;}
    if(/under it/.test(msg))return'Can’t archive: it has accounts under it that are not archived. Archive those first.';
    if(/Retained earnings/.test(msg))return'Can’t archive: it is your Retained earnings account. Pick another one in Periods first.';
    return msg;
  }
  function openAccountForm(code){
    const a=code?accOf(code):null,used=usedCodes(),A=ax();
    const parentOpts=kind=>{const bad=new Set(code?leavesOfAll(code):[]);
      return`<option value="">None (top level)</option>`+A.codes.filter(c=>{const x=A.acc.get(c);return x.kind===kind&&!x.archived&&!bad.has(c);})
        .map(c=>`<option value="${attr(c)}"${a&&a.parent===c?' selected':''}>${'  '.repeat(A.dep.get(c)||0)}${escH(c)} · ${escH(A.acc.get(c).name)}</option>`).join('');};
    const kind0=a?a.kind:'asset',lines=!!(a&&used.has(code));
    const body=`<div class="bk-form" id="bkAccForm">
      <div class="row2"><div class="field"><label class="label" for="bkAfCode">Code</label><input class="input" id="bkAfCode" autocomplete="off" value="${attr(code||'')}" ${a?'readonly aria-readonly="true"':''} placeholder="e.g. 1121.03"></div>
        <div class="field"><label class="label" for="bkAfKind">Type</label><select class="input" id="bkAfKind" ${a?'disabled':''}>${KINDS.map(k=>`<option value="${k}"${k===kind0?' selected':''}>${KIND_LABEL[k]}</option>`).join('')}</select></div></div>
      ${a?'<p class="help" style="margin:-4px 0 0">Code and type are fixed once an account is created.</p>':''}
      <div class="field"><label class="label" for="bkAfName">Name</label><input class="input" id="bkAfName" autocomplete="off" value="${attr(a?a.name:'')}"></div>
      <div class="field"><label class="label" for="bkAfParent">Parent (a header of the same type)</label><select class="input" id="bkAfParent">${parentOpts(kind0)}</select></div>
      <div class="row2"><div class="field"><label class="label" for="bkAfCcy">Currency</label><input class="input" id="bkAfCcy" maxlength="3" autocomplete="off" value="${attr(a?a.ccy||'IDR':'IDR')}"></div>
        <label class="check" style="align-self:end;min-height:40px"><input type="checkbox" id="bkAfPost" ${!a||a.postable?'checked':''} ${lines&&a.postable?'disabled':''}> Can take entries (postable)</label></div>
      ${lines&&a.postable?'<p class="help" style="margin:-4px 0 0">This account has entries, so it can’t become a header.</p>':''}
      ${a?'<div class="field"><label class="label" for="bkAfWhy">Why the change (optional)</label><input class="input" id="bkAfWhy" autocomplete="off"></div>':''}
      <div class="help err" id="bkAfErr" role="alert" hidden></div></div>`;
    const s=openSheet({title:a?`Edit ${code}`:'New account',body,foot:`<button class="btn btn-secondary" data-bk-x="cancel">Cancel</button><button class="btn btn-primary" id="bkAfSave">${a?'Save changes':'Add account'}</button>`,focus:a?'#bkAfName':'#bkAfCode'});
    const q=id=>s.sheet.querySelector(id);
    q('[data-bk-x="cancel"]').addEventListener('click',()=>s.close(true));
    if(!a)q('#bkAfKind').addEventListener('change',e=>{q('#bkAfParent').innerHTML=parentOpts(e.target.value);});
    q('#bkAfSave').addEventListener('click',()=>{
      const er=q('#bkAfErr');er.hidden=true;
      try{
        const v={name:q('#bkAfName').value.trim(),parent:q('#bkAfParent').value||null,postable:q('#bkAfPost').checked,ccy:(q('#bkAfCcy').value.trim()||'IDR').toUpperCase()};
        if(a){ledgerEditAccount(code,v,(q('#bkAfWhy')||{}).value||'');toast(`${code} saved`);}
        else{const id=ledgerAddAccount({code:q('#bkAfCode').value.trim(),kind:q('#bkAfKind').value,...v});toast(`${id} added`);}
        s.close(true);renderAll();
      }catch(e){er.innerHTML=`${ic('triangle-alert','s16')}<span>${escH(errText(e))}</span>`;er.hidden=false;}
    });
  }
  function leavesOfAll(c){const A=ax(),out=[c],st=[...(A.kids.get(c)||[])];while(st.length){const k=st.pop();out.push(k);for(const x of A.kids.get(k)||[])st.push(x);}return out;}
  const ACTION={save:'Saved as draft',post:'Posted',edit:'Edited',void:'Voided','delete-draft':'Draft deleted',renumber:'Renumbered','accurate-differs':'Accurate’s version differs',
    add:'Added',archive:'Archived',close:'Closed',reopen:'Reopened',lock:'Locked',unlock:'Unlocked',recode:'Moved to the ERP chart',migrate:'Moved to the new book format',start:'Book started'};
  const ENTITY={journal:'Journals',account:'Accounts',period:'Periods',chart:'Chart',settings:'Settings',book:'Book'};
  function openAccountHistory(code){
    const a=accOf(code),list=typeof ledgerAudit==='function'?ledgerAudit({entity:'account',ref:code}):[];
    const fields=o=>o?Object.entries(o).filter(([k])=>k!=='at'&&k!=='chartVer').map(([k,v])=>`${k}: ${v==null?'—':typeof v==='object'?JSON.stringify(v):v}`).join(' · '):'';
    const body=list.length?`<ol class="list" id="bkAccHist">${list.map(e=>`<li class="list-item" data-action="${attr(e.action)}"><div class="li-body"><div class="li-title">${escH(ACTION[e.action]||e.action)}${e.reason?` · ${escH(e.reason)}`:''}</div>
        <div class="li-sub">${escH(fmtDateTime(e.at))}${e.action==='edit'?` · before: ${escH(fields(e.before))} → after: ${escH(fields(e.after))}`:''}</div></div></li>`).join('')}</ol>`
      :`<p class="muted" id="bkAccHist">No changes recorded for this account since the book started.${a&&a.oldCode?` It was ${escH(a.oldCode)} before the move to the ERP chart.`:''}</p>`;
    openSheet({title:`History · ${code} ${a?a.name:''}`,body});
  }
  function xlCOA(){
    const f=st('coa'),amt=coaAmounts(f.asOf),A=ax();
    const rows=coaList(f).map(c=>{const a=A.acc.get(c);return{v:[c,a.name,KIND_LABEL[a.kind],amt.get(c)||0,a.postable?'Yes':'No',a.archived?'Yes':'',a.oldCode||''],s:a.postable?'acc':'par',indent:A.dep.get(c)||0};});
    return xlReport({file:`chart-of-accounts-${f.asOf}.xlsx`,sheet:'Chart of accounts',numCols:[4],
      title:'Chart of accounts',sub:`Amounts as of ${dLong(f.asOf)}, natural sign (income and expenses: the year to date)`,
      head:['Code','Name','Type','Amount','Postable','Archived','Old code'],widths:[14,46,12,20,10,10,14],rows});
  }

  /* ══ Periods ══ */
  function periodYear(){
    const s=typeof ledgerSettings==='function'&&ledgerSettings(),y0=+((s&&s.firstMonth)||todayISO()).slice(0,4),y1=+todayISO().slice(0,4)+1;
    let y=U.periods.year||+todayISO().slice(0,4);y=Math.max(y0,Math.min(y1,y));U.periods.year=y;return{y,y0,y1};
  }
  const mLab=M=>monthLabel(M,true);
  const prevM=M=>meShift(M,-1),nextM=M=>meShift(M,1);
  function renderPeriods(){
    const g=gateHTML('Periods');if(g)return g;
    const{y,y0,y1}=periodYear(),rows=ledgerPeriods(y),set=ledgerSettings()||{},re=set.retainedEarnings||'';
    const eq=ax().codes.filter(c=>{const a=accOf(c);return a.kind==='equity'&&a.postable&&!a.archived;});
    const reSel=`<label class="label" for="bkRE" style="margin-right:6px">Retained earnings</label><select class="input" id="bkRE" data-bk="re" style="width:auto;max-width:100%">${re?'':'<option value="">Pick an equity account…</option>'}${eq.map(c=>`<option value="${attr(c)}"${c===re?' selected':''}>${escH(c)} · ${escH(nameOf(c))}</option>`).join('')}</select>`;
    const btn=(act,label,ok,why,M,cls)=>`<button class="btn ${cls||'btn-secondary'} btn-sm" data-bk="${act}" data-m="${M}"${ok?'':` disabled title="${attr(why)}" aria-label="${attr(label+': '+why)}"`}>${escH(label)}</button>`;
    const tr=rows.map(r=>{const M=r.month,dec=M.endsWith('-12');
      const badge=r.state==='locked'?`<span class="badge good">${ic('lock','s16')}Locked</span>`:r.state==='closed'?'<span class="badge info">Closed</span>':'<span class="badge">Open</span>';
      let acts='';
      if(!r.inBook)acts='<span class="help">Before your book starts</span>';
      else if(r.state==='open')acts=btn('pclose','Close month',r.canClose,`Close ${mLab(prevM(M))} first`,M,'btn-primary');
      else if(r.state==='closed')acts=btn('preopen','Reopen',r.canReopen,`Reopen ${mLab(nextM(M))} first`,M)+btn('plock','Lock',r.canLock,`Lock ${mLab(prevM(M))} first`,M);
      else acts=btn('punlock','Unlock',r.canUnlock,`Unlock ${mLab(nextM(M))} first`,M);
      const ye=r.yearEndId?`<button class="bk-link" data-bk="vopen" data-id="${attr(r.yearEndId)}" id="bkYE-${y}">View year-end entry${ic('chevron-right')}</button>`:'';
      return`<tr data-m="${M}" data-state="${r.state}"><td><div class="merchant-name" style="font-weight:500">${escH(mLab(M))}${dec?' <span class="muted">· year end</span>':''}</div><div class="merchant-sub"><span class="only-sm">${escH(dShort(M+'-01'))} – ${escH(dShort(meMonthEnd(M)))}</span>${ye}</div></td>
        <td class="hide-sm">${escH(dShort(M+'-01'))} – ${escH(dShort(meMonthEnd(M)))}</td><td>${badge}</td><td class="hide-sm">${r.state!=='open'&&r.closedAt?escH(fmtDateTime(r.closedAt)):''}</td><td><div class="bk-pacts">${acts}</div></td></tr>`;}).join('');
    const stepper=`<div class="bk-year" role="group" aria-label="Year"><button class="icon-btn sm" data-bk="pyear" data-d="-1" aria-label="Earlier year" ${y<=y0?'disabled':''}>${ic('chevron-left')}</button><span class="bk-yr" id="bkYear">${y}</span><button class="icon-btn sm" data-bk="pyear" data-d="1" aria-label="Later year" ${y>=y1?'disabled':''}>${ic('chevron-right')}</button></div>`;
    return`${pageHead('Periods','Close each month once it is done. A closed month takes no new or changed entries until you reopen it.',hideBtn())}
      <div class="bk-bar">${stepper}<span class="bk-grow"></span><span style="display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0;max-width:100%">${reSel}</span></div>
      <div class="grid"><section class="card flush span-12">${cardHead('calendar-check',`${y}`,'Close goes oldest month first; reopen goes newest first. Closing December makes the year-end entry.')}
        <div class="table-wrap"><table class="data" id="bkPeriods"><thead><tr><th scope="col">Month</th><th scope="col" class="hide-sm">Dates</th><th scope="col">State</th><th scope="col" class="hide-sm">Closed on</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${tr}</tbody></table></div></section></div>`;
  }
  function closeItemsHTML(M,reason){
    const ck=ledgerCloseChecklist(M,reason),t=report(()=>ledgerLib.tb(null,M+'-01',meMonthEnd(M)),{balanced:true,openingBalanced:true,totals:{debit:0,credit:0,opening:0}});
    const it=c=>ck.items.find(i=>i.code===c)||{ok:true,detail:''},row=(code,ok,title,sub)=>`<div class="bk-check" data-code="${code}" data-ok="${ok?1:0}">${ic(ok?'square-check':'triangle-alert')}<span class="li-body"><span class="li-title" style="display:block">${escH(title)}</span>${sub?`<span class="li-sub" style="display:block">${sub}</span>`:''}</span><span class="badge ${ok?'good':'bad'}">${ok?'✓':'✗'}</span></div>`;
    const pv=it('previous'),dr=it('drafts');
    let h=row('previous',pv.ok,'Previous month closed',escH(pv.detail))+row('drafts',dr.ok,'No drafts in the month',escH(dr.detail))
      +row('tb',t.balanced,'Trial balance balances',`Debits ${money(t.totals.debit)} · credits ${money(t.totals.credit)}`)
      +row('opening',t.openingBalanced,'Opening balances balance',t.openingBalanced?'The balances before the month net to zero':`Off by ${money(Math.abs(t.totals.opening))}`);
    if(M.endsWith('-12')){const r=it('retained');h+=row('retained',r.ok,'Retained earnings account',escH(r.detail));}
    return{ck,h,drafts:(dr.count||0)>0};
  }
  function openCloseSheet(M){
    const dec=M.endsWith('-12');
    let x=closeItemsHTML(M,'');
    const body=`<div id="bkCloseList">${x.h}</div>
      <div class="field" id="bkCloseWhyF" style="margin-top:12px"${x.drafts?'':' hidden'}><label class="label" for="bkCloseWhy">Why close with drafts in it</label><textarea class="input" id="bkCloseWhy" rows="2" placeholder="e.g. waiting for the bank’s statement"></textarea><p class="help">The drafts stay drafts; they are never counted.</p></div>
      ${dec?'<p class="help" id="bkCloseYE" style="margin-top:12px">This makes the year-end entry: every income and expense account is moved into Retained earnings.</p>':''}
      <div class="help err" id="bkCloseErr" role="alert" hidden></div>`;
    const s=openSheet({title:`Close ${mLab(M)}`,body,foot:`<button class="btn btn-secondary" data-bk-x="cancel">Cancel</button><button class="btn btn-primary" id="bkCloseGo"${x.ck.canClose?'':' disabled'}>Close month</button>`,confirmDiscard:false});
    const q=id=>s.sheet.querySelector(id),why=q('#bkCloseWhy');
    q('[data-bk-x="cancel"]').addEventListener('click',()=>s.close(true));
    why.addEventListener('input',()=>{x=closeItemsHTML(M,why.value);q('#bkCloseList').innerHTML=x.h;q('#bkCloseGo').disabled=!x.ck.canClose;});
    q('#bkCloseGo').addEventListener('click',()=>{
      try{const r=ledgerClosePeriod(M,why.value.trim());s.close(true);
        toast(`${mLab(M)} closed${r.yearEndId?' · year-end entry made':''}`,r.yearEndId?{action:'View year-end entry',onAction:()=>openVoucher(r.yearEndId)}:undefined);renderAll();}
      catch(e){const er=q('#bkCloseErr');er.innerHTML=`${ic('triangle-alert','s16')}<span>${escH(errText(e))}</span>`;er.hidden=false;}
    });
  }
  function openReasonSheet(M,act){
    const re=act==='reopen',dec=M.endsWith('-12');
    const body=`<div class="field"><label class="label" for="bkWhy">Why ${re?'reopen':'unlock'} ${escH(mLab(M))}</label><textarea class="input" id="bkWhy" rows="2"></textarea></div>
      ${re&&dec?'<p class="help" id="bkReopenYE" style="margin-top:8px">Its year-end entry will be voided (kept with its history). Closing December again makes a new one.</p>':''}
      ${re?'':'<p class="help" style="margin-top:8px">An unlocked month is closed again: it can be reopened.</p>'}
      <div class="help err" id="bkWhyErr" role="alert" hidden></div>`;
    const s=openSheet({title:`${re?'Reopen':'Unlock'} ${mLab(M)}`,body,foot:`<button class="btn btn-secondary" data-bk-x="cancel">Cancel</button><button class="btn btn-primary" id="bkWhyGo" disabled>${re?'Reopen month':'Unlock month'}</button>`,focus:'#bkWhy'});
    const q=id=>s.sheet.querySelector(id),why=q('#bkWhy'),go=q('#bkWhyGo');
    q('[data-bk-x="cancel"]').addEventListener('click',()=>s.close(true));
    why.addEventListener('input',()=>{go.disabled=!why.value.trim();});
    go.addEventListener('click',()=>{
      try{if(re){const r=ledgerReopenPeriod(M,why.value.trim());toast(`${mLab(M)} reopened${r.voided&&r.voided.length?' · year-end entry voided':''}`);}
        else{ledgerUnlockPeriod(M,why.value.trim());toast(`${mLab(M)} unlocked`);}
        s.close(true);renderAll();}
      catch(e){const er=q('#bkWhyErr');er.innerHTML=`${ic('triangle-alert','s16')}<span>${escH(errText(e))}</span>`;er.hidden=false;}
    });
  }

  /* ══ Audit trail ══ */
  function auditItem(e){
    if(e.entity==='journal'){const o=e.after||e.before||{},j=typeof ledgerJournal==='function'?ledgerJournal(e.ref):null;const n=o.number||(j&&j.number);return n||`(draft) ${(o.description||(j&&j.description)||'').slice(0,40)}`;}
    if(e.entity==='period')return/^\d{4}-\d{2}$/.test(e.ref)?mLab(e.ref):e.ref;
    if(e.entity==='settings')return e.ref==='retainedEarnings'?'Retained earnings':e.ref;
    if(e.entity==='account')return e.ref;
    return ENTITY[e.entity]||e.entity;
  }
  let AC={key:null,list:null};
  function auditList(){
    const f=st('audit'),all=typeof ledgerAudit==='function'?ledgerAudit({entity:f.entity||undefined,from:f.from||undefined,to:f.to||undefined}):[];
    const terms=f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if(!terms.length)return all.map(e=>({e,item:auditItem(e)}));
    return all.map(e=>({e,item:auditItem(e)})).filter(({e,item})=>{const t=`${item} ${e.ref} ${ACTION[e.action]||e.action} ${e.reason||''}`.toLowerCase();return terms.every(x=>t.includes(x));});
  }
  function renderAudit(){
    const g=gateHTML('Audit trail');if(g)return g;
    const f=st('audit'),list=auditList(),n=list.length,u=U.audit,pages=Math.max(1,Math.ceil(n/PAGE_SIZE));
    if(u.page>=pages)u.page=pages-1;if(u.page<0)u.page=0;
    const s=u.page*PAGE_SIZE,page=list.slice(s,s+PAGE_SIZE);
    AC={list:page};
    const what=`<select class="input" data-bk="entity" data-p="audit" aria-label="What"><option value="">Everything</option>${Object.entries(ENTITY).map(([k,l])=>`<option value="${k}"${f.entity===k?' selected':''}>${l}</option>`).join('')}</select>`;
    const rows=page.map(({e,item},i)=>`<tr data-entity="${attr(e.entity)}" data-action="${attr(e.action)}"><td class="date" style="white-space:nowrap">${escH(fmtDateTime(e.at))}</td><td class="hide-sm">${escH((ENTITY[e.entity]||e.entity).replace(/s$/,''))}</td>
        <td><div class="merchant-name" style="font-weight:500">${escH(item)}</div><div class="merchant-sub only-sm"><span>${escH(ACTION[e.action]||e.action)}</span>${e.reason?`<span>${escH(e.reason)}</span>`:''}</div></td>
        <td class="hide-sm">${escH(ACTION[e.action]||e.action)}</td><td class="hide-sm" style="overflow-wrap:anywhere">${escH(e.reason||'')}</td>
        <td class="num"><button class="btn btn-ghost btn-sm" data-bk="aview" data-i="${i}">View</button></td></tr>`).join('');
    const pager=n>PAGE_SIZE?`<div class="bk-pager"><span class="help" id="bkACount" data-n="${n}">${s+1}–${s+page.length} of ${n}</span><span class="btns"><button class="btn btn-secondary btn-sm" data-bk="page" data-p="audit" data-d="-1" ${u.page===0?'disabled':''}>${ic('chevron-left','s16')}Newer</button><button class="btn btn-secondary btn-sm" data-bk="page" data-p="audit" data-d="1" ${u.page>=pages-1?'disabled':''}>Older${ic('chevron-right','s16')}</button></span></div>`
      :`<div class="bk-pager"><span class="help" id="bkACount" data-n="${n}">${n} change${n===1?'':'s'}</span></div>`;
    return`${pageHead('Audit trail','Every change to a journal, an account, a period or the chart: when, what, why, and before and after.',hideBtn())}
      <div class="bk-bar">${searchBox('audit','Search item, action or reason')}${what}${presetChips('audit','range')}${dateFields('audit','range')}</div>${chipsHTML('audit')}
      <div class="grid"><section class="card flush span-12">${cardHead('history','Changes','Newest first')}
        ${n?`<div class="table-wrap"><table class="data" id="bkAudit"><thead><tr><th scope="col">When</th><th scope="col" class="hide-sm">What</th><th scope="col">Item</th><th scope="col" class="hide-sm">Action</th><th scope="col" class="hide-sm">Why</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody>${rows}</tbody></table></div>${pager}`
          :`<div style="padding:0 var(--card-pad) var(--card-pad)">${emptyBk('search','No changes match',chipList('audit').length?'Clear all filters':'','clearall',' data-p="audit"')}</div>`}</section></div>`;
  }
  function fmtVal(k,v){
    if(v==null||v==='')return'—';
    if(k==='lines'&&Array.isArray(v))return v.map(l=>{const a=Math.round(l.amount||0);return`${l.account} · ${a<0?'Cr':'Dr'} ${fmtIDR(Math.abs(a))}${l.memo?` · ${l.memo}`:''}`;}).join('\n');
    if(typeof v==='object')return JSON.stringify(v);
    return String(v);
  }
  function openAuditView(i){
    const x=AC.list&&AC.list[+i];if(!x)return;const{e,item}=x,b=e.before||{},a=e.after||{};
    const keys=[...new Set([...Object.keys(b),...Object.keys(a)])].filter(k=>k!=='chartVer').sort();
    const rows=keys.map(k=>{const p=fmtVal(k,b[k]),q=fmtVal(k,a[k]),ch=p!==q;
      return`<tr${ch?' class="bk-diff" data-changed="1"':''}><td>${escH(k)}</td><td class="bk-val">${escH(e.before?p:'—')}</td><td class="bk-val">${escH(e.after?q:'—')}</td></tr>`;}).join('');
    openSheet({title:`${ACTION[e.action]||e.action} · ${item}`,wide:true,body:`<p class="muted" style="margin:0 0 8px">${escH(fmtDateTime(e.at))}${e.reason?` · Why: ${escH(e.reason)}`:''}</p>
      ${rows?`<div class="table-wrap"><table class="data" id="bkAuditDiff"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">No details recorded.</p>'}`});
  }

  /* ── Navigation helpers for every page ── */
  function go(k){if(typeof closeAllSheets==='function')closeAllSheets();if(ACTIVE_TAB===k){renderAll();window.scrollTo(0,0);}else setTab(k);}
  function openLedger(code,fromDate,toDate){
    const f=st('ledger');f.acc=code==null?'':String(code);
    if(fromDate||toDate){f.from=fromDate||'';f.to=toDate||'';f.preset=f.from&&f.to?matchRange(f.from,f.to):null;}
    else Object.assign(f,{from:DEF.ledger().from,to:DEF.ledger().to,preset:'thisYear'});
    delete U.pend.ledger;U.ledger.more.clear();go('ledger');
  }
  window.openLedger=openLedger;
  // Journals filtered to a date range and, optionally, to journals touching any income (or
  // expense) account (kind), a status or a journal kind (jkind). Other filters are cleared.
  function openJournals(o){
    o=o||{};const f=F.journals=DEF.journals();
    f.from=o.from||'';f.to=o.to||'';f.preset=f.from&&f.to?matchRange(f.from,f.to):null;
    if(o.kind==='income'||o.kind==='expense')f.acc='kind:'+o.kind;
    if(o.status&&JSTAT[o.status])f.status=o.status;if(o.jkind&&JKIND[o.jkind])f.jkind=o.jkind;
    U.journals.page=0;U.journals.sel=null;delete U.pend.journals;go('journals');
  }
  window.openJournals=openJournals;
  // Journals with one journal open (filters cleared): a journal id (draft, posted or void) or a key.
  function openVoucher(key){
    F.journals=DEF.journals();U.journals.page=0;U.journals.sort=null;delete U.pend.journals;
    const j=findJournal(key);U.journals.sel=j?j.id:null;
    if(j){const list=jFiltered(),i=list.findIndex(x=>x.id===j.id);if(i>=0)U.journals.page=Math.floor(i/PAGE_SIZE);}
    go('journals');
    if(isMobile()&&U.journals.sel)setTimeout(()=>openVoucherSheet(U.journals.sel),60);
  }
  window.openVoucher=openVoucher;

  /* ── Events (one delegated listener per type) ── */
  function applyPreset(p,v){
    const f=st(p);
    if(ASOF_P.some(x=>x[0]===v)&&'asOf'in f){f.asOfP=v;f.asOf=asOfFor(v);}
    else{const r=rangeFor(v);if(f.preset===v&&p==='journals'){f.from=f.to='';f.preset=null;}else{f.from=r[0];f.to=r[1];f.preset=v;}}
    delete U.pend[p];resetPage(p);renderAll();
  }
  function applyDates(p,kind){
    const f=st(p),pd=U.pend[p]||{};
    if(kind==='asof'){const a=pd.asOf!=null?pd.asOf:f.asOf;if(!validD(a)){toast('Enter a valid date');return;}f.asOf=a;f.asOfP=matchAsOf(a);}
    else{const fr=pd.from!=null?pd.from:f.from,to=pd.to!=null?pd.to:f.to;
      if((fr&&!validD(fr))||(to&&!validD(to))){toast('Enter valid dates');return;}if(fr&&to&&fr>to)return;
      if(p!=='journals'&&p!=='audit'&&(!fr||!to)){toast('Enter both dates');return;}
      f.from=fr;f.to=to;f.preset=fr&&to?matchRange(fr,to):null;}
    delete U.pend[p];resetPage(p);renderAll();
  }
  function pendInput(el){
    const p=el.dataset.p,pd=U.pend[p]||(U.pend[p]={}),k={dfrom:'from',dto:'to',dasof:'asOf'}[el.dataset.bk];pd[k]=el.value;
    if(k==='asOf')return;
    const f=st(p),fr=pd.from!=null?pd.from:f.from,to=pd.to!=null?pd.to:f.to,bad=!!(fr&&to&&fr>to);
    const er=$('bkDerr-'+p),b=document.querySelector(`button[data-bk="dshow"][data-p="${p}"]`);
    if(er)er.hidden=!bad;if(b)b.disabled=bad;
  }
  function act(el,ev){
    const a=el.dataset.bk,p=el.dataset.p;
    switch(a){
      case'retry':if(typeof ensureLedger==='function')Promise.resolve(ensureLedger()).finally(renderAll);return;
      case'start':if(typeof ledgerUi==='object'&&ledgerUi&&typeof ledgerUi.startSheet==='function')ledgerUi.startSheet();else setTab('settings');return;
      case'preset':applyPreset(p,el.dataset.v);return;
      case'dshow':applyDates(p,el.dataset.kind);return;
      case'unchip':unchip(p,el.dataset.k);renderAll();return;
      case'clearall':clearAll(p);renderAll();return;
      case'sort':cycleSort(p,el.dataset.k);if(p==='journals')jRefreshList();else renderAll();return;
      case'page':U[p].page+=Number(el.dataset.d);if(p==='journals'){jRefreshList();const c=$('bkJList');if(c&&c.getBoundingClientRect().top<0)c.scrollIntoView({block:'start'});}else renderAll();return;
      case'led':ev&&ev.stopPropagation();openLedger(el.dataset.code,el.dataset.from||null,el.dataset.to||null);return;
      case'jopen':jSelect(el.dataset.id);return;
      case'vopen':if(ACTIVE_TAB==='journals'&&!isMobile()&&$('bkVPanel')){if(typeof closeAllSheets==='function')closeAllSheets();jSelect(el.dataset.id);}else openVoucherSheet(el.dataset.id);return;
      case'jnew':{const en=EN();if(en&&typeof en.open==='function')en.open();return;}
      case'jpostall':{const ids=jFiltered().filter(j=>j.status==='draft').map(j=>j.id);if(!ids.length)return;
        try{const r=ledgerPostDrafts(ids);toast(`${r.posted.length} posted${r.failed.length?` · ${r.failed.length} need fixing first`:''}`);}catch(e){toast(errText(e));}renderAll();return;}
      case'goperiods':if(el.dataset.y)U.periods.year=+el.dataset.y;go('periods');return;
      case'glmore':U.ledger.more.add(el.dataset.code);renderAll();return;
      case'tbled':openTBLedger(el.dataset.code);return;
      case'coa-kind':{const f=st('coa');f.kind=f.kind===el.dataset.k?'':el.dataset.k;renderAll();return;}
      case'coa-new':openAccountForm(null);return;
      case'coa-edit':ev&&ev.stopPropagation();openAccountForm(el.dataset.code);return;
      case'coa-hist':ev&&ev.stopPropagation();openAccountHistory(el.dataset.code);return;
      case'coa-arch':ev&&ev.stopPropagation();U.coa.confirm=el.dataset.code;U.coa.err='';renderAll();return;
      case'coa-arch-no':U.coa.confirm=null;U.coa.err='';renderAll();return;
      case'coa-arch-go':{const c=el.dataset.code;
        try{ledgerArchiveAccount(c,'Archived from the chart of accounts');U.coa.confirm=null;U.coa.err='';toast(`${c} archived`);}
        catch(e){U.coa.err=archiveReason(errText(e));}renderAll();return;}
      case'coa-more':{ev&&ev.stopPropagation();const c=el.dataset.code,acc=accOf(c);
        openMenu(el,{title:`${c} · ${acc?acc.name:''}`,items:[{label:'Edit',icon:'pencil',onSelect:()=>openAccountForm(c)},...(acc&&!acc.archived?[{label:'Archive',icon:'archive',onSelect:()=>{U.coa.confirm=c;U.coa.err='';renderAll();}}]:[]),{label:'History',icon:'history',onSelect:()=>openAccountHistory(c)}]});return;}
      case'pyear':U.periods.year+=Number(el.dataset.d);renderAll();return;
      case'pclose':openCloseSheet(el.dataset.m);return;
      case'preopen':openReasonSheet(el.dataset.m,'reopen');return;
      case'punlock':openReasonSheet(el.dataset.m,'unlock');return;
      case'plock':try{ledgerLockPeriod(el.dataset.m);toast(`${mLab(el.dataset.m)} locked`);}catch(e){toast(errText(e));}renderAll();return;
      case'aview':openAuditView(el.dataset.i);return;
      case'xl':{const fn={bs:xlBS,pl:xlPL,tb:xlTB,journals:xlJournals,ledger:xlLedger,coa:xlCOA}[el.dataset.r];if(fn&&bookReady()){el.disabled=true;Promise.resolve(fn()).finally(()=>{el.disabled=false;});}return;}
    }
  }
  function onChange(el){
    const a=el.dataset.bk,p=el.dataset.p,f=p?st(p):null;
    switch(a){
      case'status':case'jkind':case'acc':case'entity':f[a]=el.value;resetPage(p);if(p==='ledger')U.ledger.more.clear();break;
      case'arch':f.arch=el.checked;break;
      case'cmp':f.cmp=el.value;break;
      case'cfrom':f.cf=el.value;break;case'cto':f.ct=el.value;break;case'casof':f.cAsOf=el.value;break;
      case're':try{ledgerSetRetainedEarnings(el.value);toast(`Retained earnings: ${el.value}`);}catch(e){toast(errText(e));}break;
      default:return;
    }
    renderAll();
  }
  const CHANGE=new Set(['status','jkind','acc','entity','arch','cmp','cfrom','cto','casof','re']);
  const INPUTS=new Set(['q','dfrom','dto','dasof']);
  const onPage=()=>PAGE_KEYS.includes(ACTIVE_TAB)||ACTIVE_TAB==='accounts';
  document.addEventListener('click',e=>{
    const el=e.target.closest&&e.target.closest('[data-bk]');if(!el||CHANGE.has(el.dataset.bk)||INPUTS.has(el.dataset.bk))return;
    if(el.disabled)return;
    if(!bookReady()&&!['retry','start'].includes(el.dataset.bk))return;
    act(el,e);
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const el=e.target;if(!el||!el.matches||!el.matches('tr[data-bk]'))return;
    e.preventDefault();if(bookReady())act(el,e);
  });
  document.addEventListener('change',e=>{const el=e.target.closest&&e.target.closest('[data-bk]');if(el&&CHANGE.has(el.dataset.bk)&&onPage()&&bookReady())onChange(el);});
  let qT=null;
  document.addEventListener('input',e=>{
    const el=e.target;if(!el||!el.dataset||!onPage())return;const a=el.dataset.bk;
    if(a==='dfrom'||a==='dto'||a==='dasof'){pendInput(el);return;}
    if(a!=='q')return;
    const p=el.dataset.p,val=el.value;clearTimeout(qT);
    qT=setTimeout(()=>{st(p).q=val;resetPage(p);
      if(p==='journals'){jRefreshList();const ch=$('bkChips'),nc=chipsHTML('journals');if(ch)ch.outerHTML=nc||'<span id="bkChips" hidden></span>';else renderAll();return;}
      const pos=el.selectionStart;renderAll();const n=document.querySelector(`[data-bk="q"][data-p="${p}"]`);if(n){n.focus();try{n.setSelectionRange(pos,pos);}catch(_){}}},250);
  });
  // Enter in a typed date field = Show.
  document.addEventListener('keydown',e=>{const el=e.target;if(e.key!=='Enter'||!el||!el.dataset||!['dfrom','dto','dasof'].includes(el.dataset.bk)||!onPage())return;
    const b=document.querySelector(`button[data-bk="dshow"][data-p="${el.dataset.p}"]`);if(b&&!b.disabled){e.preventDefault();b.click();}});

  /* ── Pages and hooks ── */
  registerPage({key:'coa',label:'Chart of accounts',icon:'list-tree',group:'books',order:10,needs:'books',render:renderCOA});
  registerPage({key:'journals',label:'Journals',icon:'book-open',group:'books',order:20,needs:'books',render:renderJournals});
  registerPage({key:'ledger',label:'General ledger',short:'Ledger',icon:'file-text',group:'books',order:30,needs:'books',render:renderLedger});
  registerPage({key:'bs',label:'Balance sheet',icon:'scale',group:'books',order:40,needs:'books',render:renderBS});
  registerPage({key:'pl',label:'Income statement',icon:'chart-column',group:'books',order:50,needs:'books',render:renderPL});
  registerPage({key:'tb',label:'Trial balance',icon:'square-check',group:'books',order:60,needs:'books',render:renderTB});
  registerPage({key:'periods',label:'Periods',icon:'calendar-check',group:'books',order:70,needs:'books',render:renderPeriods});
  registerPage({key:'audit',label:'Audit trail',icon:'history',group:'books',order:80,needs:'books',render:renderAudit});
  // Accounts page: a ledger link under each account the book has.
  registerHook('accountsExtraCol',a=>bookReady()&&a&&accOf(String(a.id))?`<button class="bk-link" data-bk="led" data-code="${attr(String(a.id))}" aria-label="Open ledger for ${attr(String(a.id))}">Ledger${ic('chevron-right')}</button>`:null);
})();
