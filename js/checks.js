/* ExpenseTrack — Checks page (round 2, UX §11.14).
   Statement matching in one place, laid out like a statement: pick an account and one of its
   statement periods, and the sheet shows one row per transaction with what the statement says
   and what the app has, side by side, so what is "not in yet" stands out. Totals at the foot.

   This file is the page only. Every row, total and decision comes from js/statements.js
   (window.ETStatements: checksModel, checkCounts, sortLine(s), sortPayer, unsortLine,
   unsortPayer, decide, undoMatch / redoMatch, removeAdded / restoreAdded, openStmt); the Income
   form is the core's openIncome(null, prefill). If this file fails to load the app works as
   before: the review and statement lists stay under Credit cards › History and the "Check" chip
   opens them there.

   Loaded right after js/statements.js. Contract: docs/v2-interfaces.md. No personal data in this
   file: the repo is public. */
(function(){
  'use strict';
  const S=window.ETStatements;
  if(!S||typeof S.checksModel!=='function'||typeof registerPage!=='function')return;

  // View state, per viewer and never saved: the chosen account and period, the filter, Select.
  let SEL=null,FILTER='all',SELECT=false,FLASH=null;
  const PICK=new Set();
  registerHook('beforeRender',()=>{if(ACTIVE_TAB!=='checks'){SELECT=false;PICK.clear();FLASH=null;}});

  if(!document.getElementById('chk-styles')){
    const s=document.createElement('style');s.id='chk-styles';
    s.textContent=`.chk-answer{display:flex;align-items:center;gap:8px;font-size:20px;line-height:28px;font-weight:600;color:var(--text-1);margin:0 0 4px}
.chk-answer svg.i{width:20px;height:20px;color:var(--good);flex-shrink:0}
.chk-top{margin-bottom:16px}
.chk-pick-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.chk-pick-row .chip .nav-count{margin-left:2px}
.chk-period{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:16px}
.chk-period select.input{width:auto;max-width:100%;height:36px}
.chk-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.chk-sheet{font-size:14px}
.chk-tr{display:grid;grid-template-columns:64px minmax(0,1fr) 120px 170px 340px;gap:4px 12px;align-items:center;padding:10px 8px;border-top:1px solid var(--border)}
.chk-sheet.sel .chk-tr{grid-template-columns:24px 64px minmax(0,1fr) 120px 170px 340px}
.chk-head{display:contents}
.chk-th{font-size:11px;line-height:14px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);border-top:0;padding-top:4px;padding-bottom:6px}
.chk-th .chk-num{text-align:right}
.chk-date{color:var(--text-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.chk-desc{min-width:0}.chk-desc .li-title,.chk-desc .li-sub{display:block}
.chk-num{text-align:right;font-variant-numeric:tabular-nums;min-width:0}
.chk-num .amt{font-weight:600;white-space:nowrap}
.chk-as{display:block;font-size:12px;line-height:16px;color:var(--text-2);overflow-wrap:anywhere}
.chk-miss{color:var(--warn);font-weight:600}
.chk-lbl{display:none}
.chk-acts{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}
.chk-tr.open,.chk-tr.diff{background:var(--warn-soft)}
.chk-tr.chk-flash{box-shadow:inset 3px 0 0 var(--warn)}
.chk-pickbox{width:20px;height:20px}
.chk-phone{display:none}
.chk-foot{border-top:2px solid var(--border-strong)}
.chk-foot .chk-tr{border-top:0;font-weight:500}
.chk-diff.bad-diff{color:var(--warn);font-weight:600}
.chk-none{padding:16px 8px;color:var(--text-2);border-top:1px solid var(--border)}
#chkSheetCard .bulkbar{margin:0 0 4px;border-radius:var(--radius-sm);border-bottom:0}
@media (max-width:1199px){
  .chk-th{display:none}
  .chk-tr,.chk-sheet.sel .chk-tr{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-areas:"head head" "stmt app" "acts acts";padding:12px 4px;align-items:start}
  .chk-head{display:flex;gap:10px;grid-area:head;min-width:0;align-items:flex-start}
  .chk-cell-stmt{grid-area:stmt;text-align:left}.chk-cell-app{grid-area:app;text-align:left}
  .chk-acts{grid-area:acts;justify-content:flex-start}
  .chk-acts:empty{display:none}
  .chk-lbl{display:block;font-size:11px;line-height:14px;color:var(--text-3)}
  .chk-foot .chk-tr{grid-template-areas:"head head" "stmt app" "acts acts"}
  .chk-foot .chk-acts{justify-content:flex-start}
}
@media (max-width:767px){.chk-wide{display:none}.chk-phone{display:inline-flex}}`;
    document.head.appendChild(s);
  }
  // Lucide "list-checks" (24×24).
  registerIcon('list-checks','<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>');

  const day=iso=>iso?fmtDay(new Date(iso+'T00:00:00')):'—';
  const plural=(n,one,many)=>`${n} ${n===1?one:(many||one+'s')}`;
  // §14.1: money out with a minus sign, money in with a plus in the good colour.
  const signed=n=>n>0?`<span class="amt good">+${fmtIDR(n)}</span>`:`<span class="amt">−${fmtIDR(-n)}</span>`;
  const hasBook=()=>typeof W==='function'&&!!W();
  const INC_HINT='Income needs your book: set it up in Settings › Your book';
  const model=()=>S.checksModel();

  // The account and period on screen: the owner's choice while it exists; else the newest period
  // with something open; else the newest closed statement.
  function current(M){
    const acc=SEL&&M.accounts.find(a=>a.id===SEL.acc),per=acc&&acc.periods.find(p=>p.id===SEL.pid);
    if(acc&&per)return{acc,per};
    if(acc){const p=acc.periods.find(p=>p.open)||acc.periods.find(p=>p.real&&p.closed)||acc.periods[0];SEL={acc:acc.id,pid:p.id};return{acc,per:p};}
    let best=null;
    for(const a of M.accounts)for(const p of a.periods)if(p.open&&(!best||p.end>best.per.end))best={acc:a,per:p};
    if(!best)for(const a of M.accounts)for(const p of a.periods)if(p.real&&p.closed&&(!best||p.end>best.per.end))best={acc:a,per:p};
    if(!best&&M.accounts.length)best={acc:M.accounts[0],per:M.accounts[0].periods[0]};
    if(best)SEL={acc:best.acc.id,pid:best.per.id};
    return best;
  }
  const statusOf=p=>p.linked&&p.status?(p.status==='reconciled'?['good','Reconciled']:['warn',plural(p.diffs,'difference')])
    :p.open?['warn',`${p.open} not in yet`]:['good','All in'];
  const visible=p=>FILTER==='open'?p.rows.filter(r=>r.open||r.kind==='income'):p.rows;

  /* ── One row ── */
  function btn(r,a){
    const k=escAttr(r.id),ln=r.line,name=escH(r.desc);
    switch(a){
      case'spend':return`<button class="btn btn-secondary btn-sm" data-act="spend" onclick="ETStatements.sortLine('${k}','spend')">Add to spending</button>`;
      case'income':return`<button class="btn btn-secondary btn-sm" data-act="income" onclick="ETChecks.income('${k}')"${hasBook()?'':` disabled title="${escH(INC_HINT)}"`}>Add to income</button>`;
      case'own':return`<button class="btn btn-ghost btn-sm" data-act="own" onclick="ETStatements.sortLine('${k}','own')">Between my accounts</button>`;
      case'ignore':return`<button class="btn btn-ghost btn-sm chk-wide" data-act="ignore" onclick="ETStatements.sortLine('${k}','ignore')">Ignore</button>`;
      case'undoMatch':return`<button class="btn btn-ghost btn-sm" data-act="undoMatch" onclick="ETStatements.undoMatch('${escAttr(r.alert)}')">Undo</button>`;
      case'useStmt':return`<button class="btn btn-ghost btn-sm" data-act="useStmt" onclick="ETStatements.redoMatch('${escAttr(r.alert)}')">Use statement</button>`;
      case'remove':return`<button class="btn btn-ghost btn-sm" data-act="remove" onclick="ETStatements.removeAdded('${k}')">Remove</button>`;
      case'addBack':return`<button class="btn btn-ghost btn-sm" data-act="addBack" onclick="ETStatements.restoreAdded('${k}')">Add back</button>`;
      case'exclude':return`<button class="btn btn-secondary btn-sm" data-act="exclude" onclick="ETStatements.decide('${k}','exclude')">Exclude</button>`;
      case'keep':return`<button class="btn btn-ghost btn-sm" data-act="keep" onclick="ETStatements.decide('${k}','keep')">Keep</button>`;
      case'undoDecide':return`<button class="btn btn-ghost btn-sm" data-act="undoDecide" onclick="ETStatements.decide('${k}',null)">Undo</button>`;
      case'unsortLine':return`<button class="btn btn-ghost btn-sm" data-act="unsort" onclick="ETStatements.unsortLine('${k}')">Undo</button>`;
      case'unsortPayer':return`<button class="btn btn-ghost btn-sm" data-act="unsort" onclick="ETStatements.unsortPayer('${k}')">Undo for this payer</button>`;
      case'openIncome':return`<button class="btn btn-ghost btn-sm" data-act="openIncome" onclick="ETChecks.openIncomeEntry('${k}')">Open in Income</button>`;
    }
    return'';
  }
  function rowHTML(r){
    const pick=SELECT&&r.kind==='line'&&r.open;
    let acts=SELECT?'':r.acts.map(a=>btn(r,a)).join('');
    // ··· : payer rules when the payer has more lines; on phones it also holds Ignore.
    if(!SELECT&&r.open&&r.kind==='line')acts+=`<button class="icon-btn sm${r.payer>1?'':' chk-phone'}" data-act="payer" onclick="ETChecks.payerMenu(this,'${escAttr(r.id)}')" aria-haspopup="menu" aria-label="More for ${escH(r.desc)}" title="More">${ic('ellipsis','s16')}</button>`;
    const stmt=r.stmt!=null?signed(r.stmt):`<span class="chk-miss">Not on statement</span>`;
    const app=(r.app!=null?signed(r.app):'')+`<span class="chk-as${r.open&&r.kind==='line'?' chk-miss':''}">${escH(r.as)}</span>`;
    const cls=['chk-tr',r.tone,FLASH===r.key?'chk-flash':''].filter(Boolean).join(' ');
    return`<div class="${cls}" role="row" data-key="${escH(r.key)}" data-kind="${r.kind}"${r.kind==='line'?` data-line="${escH(r.id)}"`:''}>
      ${SELECT?`<span role="cell">${pick?`<input type="checkbox" class="chk-pickbox"${PICK.has(r.id)?' checked':''} onchange="ETChecks.pick('${escAttr(r.id)}')" aria-label="Select ${escH(r.desc)}">`:''}</span>`:''}
      <div class="chk-head"><span class="chk-date" role="cell">${day(r.date)}</span><span class="chk-desc" role="cell"><span class="li-title">${escH(r.desc)}</span>${r.sub?`<span class="li-sub">${escH(r.sub)}</span>`:''}</span></div>
      <div class="chk-num chk-cell-stmt" role="cell"><span class="chk-lbl">Statement</span>${stmt}</div>
      <div class="chk-num chk-cell-app" role="cell"><span class="chk-lbl">In the app</span>${app}</div>
      <div class="chk-acts" role="cell">${acts}</div></div>`;
  }
  // The ignored lines on one side of the foot: the statement has them, the app deliberately not.
  function ignRow(t,id){
    if(!Math.round(t.ign||0))return'';
    return`<div class="chk-tr" role="row" id="${id}" data-ign="${Math.round(t.ign)}">${SELECT?'<span></span>':''}
      <div class="chk-head"><span class="chk-date"></span><span class="chk-desc" role="cell"><span class="li-sub">Ignored by you</span></span></div>
      <div class="chk-num chk-cell-stmt" role="cell"></div>
      <div class="chk-num chk-cell-app" role="cell"><span class="chk-lbl">Ignored</span><span class="amt">${fmtIDR(t.ign)}</span></div>
      <div class="chk-acts" role="cell"></div></div>`;
  }
  function footRow(label,t,id){
    const d=Math.round(t.diff);
    return`<div class="chk-tr" role="row" id="${id}" data-stmt="${Math.round(t.stmt)}" data-app="${Math.round(t.app)}" data-ign="${Math.round(t.ign||0)}" data-diff="${d}">${SELECT?'<span></span>':''}
      <div class="chk-head"><span class="chk-date"></span><span class="chk-desc" role="cell"><span class="li-title">${label}</span></span></div>
      <div class="chk-num chk-cell-stmt" role="cell"><span class="chk-lbl">Statement</span><span class="amt">${fmtIDR(t.stmt)}</span></div>
      <div class="chk-num chk-cell-app" role="cell"><span class="chk-lbl">In the app</span><span class="amt">${fmtIDR(t.app)}</span></div>
      <div class="chk-acts chk-diff${d?' bad-diff':''}" role="cell">${d?`Difference <span class="amt">${d<0?'−':''}${fmtIDR(Math.abs(d))}</span>`:'No difference'}</div></div>`;
  }

  /* ── Page ── */
  function render(){
    const head=pageHead('Checks','Each statement against what the app has, line by line');
    const c=typeof CM==='function'?CM():null;
    if(!c||(!(c.txns||[]).length&&!(c.statements||[]).length))
      return head+`<div class="card" id="chkEmpty">${emptyHTML('receipt','Checks needs your bank and card statements. Connect them on Cash movements.','Open Cash movements',"setTab('cash')")}</div>`;
    if(!DATA_READY)return typeof skeletonHTML==='function'?skeletonHTML():head;
    const n=S.checkCounts(),M=model(),parts=[n.lines?plural(n.lines,'line')+' to sort':'',n.alerts?plural(n.alerts,'alert')+' to check':''].filter(Boolean);
    const answer=parts.length?`<p class="chk-answer" id="chkAnswer" role="status">${parts.join(' · ')}</p>`
      :`<p class="chk-answer" id="chkAnswer" role="status">${ic('check')}Everything matches</p><p class="summary-line">No statement line is waiting to be sorted and no alert is waiting to be checked.</p>`;
    const cur=current(M);
    if(!cur)return head+`<div class="chk-top">${answer}</div><div class="card" id="chkEmpty">${emptyHTML('receipt','No rupiah statements in your sync period yet')}</div>`;
    const{acc,per}=cur;
    const amb=M.ambiguous.length?`<p class="help" id="chkAmbiguous" style="color:var(--warn);margin-bottom:12px">${ic('triangle-alert','s16','width:14px;height:14px;vertical-align:-2px')} Choose which card your ${escH(M.ambiguous.join(', '))} alerts belong to under Credit cards › History › Statement links.</p>`:'';
    const chips=M.accounts.map(a=>`<button class="chip" data-acc="${escH(a.id)}" aria-pressed="${a.id===acc.id}" onclick="ETChecks.account('${escAttr(a.id)}')"${a.open?` aria-label="${escH(a.label)}, ${a.open} open"`:''}>${ic(a.kind==='card'?'credit-card':'landmark')}${escH(a.label)}${a.open?navCountHTML(a.open):''}</button>`).join('');
    const opts=acc.periods.map(p=>{const[,t]=statusOf(p);return`<option value="${escH(p.id)}"${p.id===per.id?' selected':''}>${escH(p.label)} · ${escH(t)}</option>`;}).join('');
    const[sc,stxt]=statusOf(per);
    const picker=`<div class="chk-pick-row" role="group" aria-label="Account" id="chkAccounts">${chips}</div>
      <div class="chk-period"><label class="sr-only" for="chkPeriod">Statement</label><select class="input" id="chkPeriod" onchange="ETChecks.period(this.value)">${opts}</select>
        <span class="badge ${sc}" id="chkStatus">${escH(stxt)}</span>${per.real&&per.linked?`<button class="btn btn-ghost btn-sm" id="chkDetails" onclick="ETStatements.openStmt('${escAttr(per.id)}')">Details</button>`:''}</div>`;
    const rows=visible(per),openLines=rows.filter(r=>r.open&&r.kind==='line');
    for(const id of[...PICK])if(!openLines.some(r=>r.id===id))PICK.delete(id);
    const seg=`<div class="seg" role="group" aria-label="Show" id="chkFilter"><button aria-pressed="${FILTER==='all'}" data-f="all" onclick="ETChecks.filter('all')">All</button><button aria-pressed="${FILTER==='open'}" data-f="open" onclick="ETChecks.filter('open')">Not in yet${per.open?` · ${per.open}`:''}</button></div>`;
    const selBtn=per.rows.some(r=>r.open&&r.kind==='line')?`<button class="btn btn-ghost btn-sm sp-select" id="chkSelect" onclick="ETChecks.select()" aria-pressed="${SELECT}" title="Select several lines to ignore or mark as between your accounts">${ic('square-check','s16')}${SELECT?'Done':'Select'}</button>`:'';
    const bar=SELECT?`<div class="bulkbar" role="toolbar" aria-label="Bulk actions"><span class="grow" aria-live="polite">${PICK.size} selected</span>
        <button class="btn btn-ghost btn-sm" onclick="ETChecks.pickAll()">${openLines.length&&openLines.every(r=>PICK.has(r.id))?'Clear':'Select all shown'}</button>
        <button class="btn btn-secondary btn-sm" data-bulk="own" onclick="ETChecks.bulk('own')"${PICK.size?'':' disabled'}>Between my accounts</button>
        <button class="btn btn-secondary btn-sm" data-bulk="ignore" onclick="ETChecks.bulk('ignore')"${PICK.size?'':' disabled'}>Ignore selected</button>
        <button class="btn btn-ghost btn-sm" onclick="ETChecks.select()">Cancel</button></div>`:'';
    const hint=!hasBook()&&rows.some(r=>r.acts.includes('income'))?`<p class="help" id="chkIncHint" style="margin-bottom:4px">${ic('info','s16','width:14px;height:14px;vertical-align:-2px')} ${escH(INC_HINT)}.</p>`:'';
    const th=`<div class="chk-tr chk-th" role="row">${SELECT?'<span></span>':''}<div class="chk-head"><span role="columnheader">Date</span><span role="columnheader">Description</span></div><span class="chk-num" role="columnheader">On statement</span><span class="chk-num" role="columnheader">In the app</span><span role="columnheader" class="sr-only">Action</span></div>`;
    const body=rows.length?rows.map(rowHTML).join(''):`<div class="chk-none" id="chkNone">${FILTER==='open'?'Nothing is waiting in this statement.':'No transactions in this period.'}</div>`;
    const foot=`<div class="chk-foot" role="rowgroup">${footRow(acc.kind==='card'?'Charges':'Money out',per.out,'chkFootOut')}${ignRow(per.out,'chkFootOutIgn')}${per.in&&(per.in.stmt||per.in.app)?footRow('Money in',per.in,'chkFootIn')+ignRow(per.in,'chkFootInIgn'):''}</div>`;
    const desc=`${day(per.start)} – ${day(per.end)}${per.real?'':' · lines with no statement yet'}${per.real&&!per.closed?' · statement still open':''} · ${plural(per.rows.length,'transaction')}`;
    const sheet=`<div class="grid" id="chkSheetCard"><section class="card span-12">${cardHead('receipt',`${escH(acc.label)} · ${escH(per.label)}`,desc,`<div class="chk-tools">${seg}${selBtn}</div>`)}
      ${bar}${hint}<div class="chk-sheet${SELECT?' sel':''}" id="chkSheet" role="table" aria-label="${escH(acc.label)} statement of ${escH(per.label)}">${th}<div role="rowgroup">${body}</div>${foot}</div></section></div>`;
    return head+`<div class="chk-top">${answer}</div>`+amb+picker+sheet;
  }
  const rerender=()=>{if(ACTIVE_TAB==='checks')renderAll();};

  window.ETChecks={
    account(id){const a=model().accounts.find(x=>x.id===id);if(!a)return;const p=a.periods.find(p=>p.open)||a.periods.find(p=>p.real&&p.closed)||a.periods[0];SEL={acc:id,pid:p.id};SELECT=false;PICK.clear();FLASH=null;rerender();},
    period(pid){if(SEL){SEL={acc:SEL.acc,pid};SELECT=false;PICK.clear();FLASH=null;rerender();}},
    filter(f){FILTER=f==='open'?'open':'all';rerender();},
    select(){SELECT=!SELECT;PICK.clear();rerender();},
    pick(id){if(PICK.has(id))PICK.delete(id);else PICK.add(id);rerender();},
    pickAll(){const c=current(model());if(!c)return;const ids=visible(c.per).filter(r=>r.open&&r.kind==='line').map(r=>r.id),all=ids.every(i=>PICK.has(i));PICK.clear();if(!all)for(const i of ids)PICK.add(i);rerender();},
    bulk(as){if(!PICK.size||(as!=='own'&&as!=='ignore'))return;const ids=[...PICK];PICK.clear();SELECT=false;S.sortLines(ids,as);},
    income(id){
      const l=S.sortCandidates().find(x=>x.id===id);if(!l||!(l.amount>0))return;
      if(!hasBook()||typeof openIncome!=='function'){toast(INC_HINT);return;}
      let acc='';try{acc=(typeof meMapOf==='function'&&meMapOf(cashAcc(l.account)))||'';}catch(_){}
      openIncome(null,{date:l.date,amount:Math.round(l.amount),payer:String(l.counterparty||l.desc||'').replace(/\s+/g,' ').trim().slice(0,60),account:acc,stmtLine:l.id});
    },
    openIncomeEntry(id){const x=(STATE.income||{})[id];if(x&&typeof INC_MONTH!=='undefined')INC_MONTH=x.date.slice(0,7);setTab('income');},
    payerMenu(btn,id){
      const c=current(model()),r=c&&c.per.rows.find(x=>x.kind==='line'&&x.id===id);if(!r)return;
      const n=r.payer||0,items=[];
      if(isMobile()&&r.acts.includes('ignore'))items.push({label:'Ignore',icon:'eye-off',onSelect:()=>S.sortLine(id,'ignore')});
      if(n>1)items.push({label:`Between my accounts: all ${n} from this payer`,icon:'arrow-left-right',onSelect:()=>S.sortPayer(id,'own')},
        {label:`Ignore: all ${n} from this payer`,icon:'eye-off',onSelect:()=>S.sortPayer(id,'ignore')});
      if(items.length)openMenu(btn,{title:r.desc.slice(0,60),items});
    },
    // Open the sheet at one alert (the Spending row's "Check" chip), else at the newest undecided one.
    focus(key){
      const M=model();let hit=null;
      for(const a of M.accounts)for(const p of a.periods)for(const r of p.rows)
        if(r.kind==='alert'&&(key?r.id===key:r.open&&(!hit||p.end>hit.p.end)))hit={a,p,r};
      if(hit){SEL={acc:hit.a.id,pid:hit.p.id};FILTER='all';SELECT=false;PICK.clear();}
      FLASH=hit?hit.r.key:null;
      if(ACTIVE_TAB==='checks')renderAll();else setTab('checks');
      if(hit){FLASH=hit.r.key;renderAll();
        requestAnimationFrame(()=>{const e=document.querySelector(`#chkSheet [data-key="${CSS.escape(hit.r.key)}"]`);if(e)e.scrollIntoView({block:'center'});});}
    },
    current:()=>{const c=current(model());return c?{account:c.acc.id,period:c.per.id}:null;},
  };

  registerPage({key:'checks',label:'Checks',icon:'list-checks',group:'top',order:40,render,
    badge:()=>{try{return S.checkCounts().open;}catch(_){return 0;}}});
})();
