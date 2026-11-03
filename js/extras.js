/* ExpenseTrack v2 — Extras module.
   Pages: budgets, goals (group 'plan'); invest, spt (group 'wealth', need the wealth snapshot).
   Keeps STATE.budgets / STATE.goals (shapes in docs/v2-interfaces.md §3; every entry has `at`,
   removals are dated tombstones). Loaded by index.html after the core script and the other v2
   modules; everything stays inside the function below. Inline handlers and tests reach the few
   deliberate entry points through window.EXTRAS. No personal data in this file: the repo is public. */
(function(){
  'use strict';
  const X=window.EXTRAS={};

  /* ── Small helpers ───────────────────────────────────────────────── */
  const stamp=()=>new Date().toISOString();
  const pad=n=>String(n).padStart(2,'0');
  const mkey=(y,m)=>{const d=new Date(y,m-1,1);return`${d.getFullYear()}-${pad(d.getMonth()+1)}`;};
  const shiftM=(k,n)=>{const[y,m]=k.split('-').map(Number);return mkey(y,m+n);};
  const diffM=(a,b)=>{const[ya,ma]=a.split('-').map(Number),[yb,mb]=b.split('-').map(Number);return(yb-ya)*12+(mb-ma);};
  const curMonth=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  const daysIn=(y,m)=>new Date(y,m,0).getDate();
  const fmtN=n=>Math.round(n).toLocaleString('id-ID');
  const money=n=>`<span class="amt">${fmtIDR(n)}</span>`;
  const moneyS=n=>`<span class="amt">${fmtIDRShort(n)}</span>`;
  const signed=(n,short)=>`${n<0?'−':'+'}${(short?fmtIDRShort:fmtIDR)(Math.abs(n))}`;
  const pctTxt=p=>(p<0?'−':'')+fmtPct(Math.abs(p));
  const rid=()=>'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

  registerIcon('target','<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>');
  registerIcon('gauge','<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>');
  registerIcon('chart-line','<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>');
  registerIcon('file-text','<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>');

  // Styles for the four pages: the core stylesheet in index.html ("v2 modules" section).

  /* Sheet row for a Rp amount: formatted, with the "Rp" prefix inside the field (§8.5). */
  const rpInput=(id,val,attrs)=>`<div class="input-affix"><span class="affix">Rp</span><input class="input ex-money" id="${id}" inputmode="numeric" autocomplete="off" value="${val==null?'':escH(fmtN(val))}" ${attrs||''}></div>`;

  /* ══════════════════════════════════════════════════════════════════
     BUDGETS
     Spent = the Spending page's own numbers: txInBounds (the transaction set after hidden rows,
     edits, splits and manual rows) filtered to amount > 0, summed by categoryTotals. Only the
     page's temporary UI filters (bank, category, merchant chips) are cleared, so a budget never
     changes because a chip is selected on Spending.
     ══════════════════════════════════════════════════════════════════ */
  function neutral(fn){
    const s={b:ACTIVE_BANK,c:ACTIVE_CATEGORIES,m:ACTIVE_MERCHANT};
    ACTIVE_BANK='all';ACTIVE_CATEGORIES=new Set();ACTIVE_MERCHANT=null;
    try{return fn();}finally{ACTIVE_BANK=s.b;ACTIVE_CATEGORIES=s.c;ACTIVE_MERCHANT=s.m;}
  }
  // {category: spent} for one month. The current month runs to the end of `now`, like Spending's "This month".
  function spentIn(month,now){
    const[y,m]=month.split('-').map(Number);
    const end=month===curMonth(now)?endOfDay(now):new Date(y,m,0,23,59,59,999);
    return neutral(()=>{const out={};for(const[c,d]of categoryTotals(txInBounds([new Date(y,m-1,1),end]).filter(t=>(t.amount||0)>0)))out[c]=d.total;return out;});
  }
  // Pace = what a steady spender would have used by today; projected = spent ÷ elapsed days × days in
  // the month (on day 1 the projection is the spend itself, as on Spending's "so far" card).
  function budMath(budget,spent,day,dim){
    const pace=Math.round(budget*day/dim),projected=Math.round(day>=2?spent/day*dim:spent);
    return{pace,projected,pct:budget?spent/budget*100:0,over:spent-budget,projOver:projected-budget,
      status:spent>budget?'over':projected>budget?'watch':'ok'};
  }
  function budList(){
    const o=STATE.budgets||{};
    return Object.keys(o).filter(c=>o[c]&&!o[c].deleted&&o[c].monthly>0).map(c=>({cat:c,monthly:o[c].monthly,since:o[c].since||''}));
  }
  function budCompute(now){
    now=now||new Date();
    const cm=curMonth(now),day=now.getDate(),dim=daysIn(now.getFullYear(),now.getMonth()+1);
    const hist=[-6,-5,-4,-3,-2,-1].map(n=>shiftM(cm,n));
    const spent={};[...hist,cm].forEach(m=>{spent[m]=spentIn(m,now);});
    const list=budList();
    const rows=list.map(b=>{const s=spent[cm][b.cat]||0;return{...b,spent:s,...budMath(b.monthly,s,day,dim)};}).sort((a,b)=>b.pct-a.pct||a.cat.localeCompare(b.cat));
    const budgeted=new Set(list.map(b=>b.cat));
    const unbudgeted=Object.entries(spent[cm]).filter(([c])=>!budgeted.has(c)).sort((a,b)=>b[1]-a[1]);
    const sum=k=>rows.reduce((s,r)=>s+r[k],0);
    const tot={budget:sum('monthly'),spent:sum('spent'),pace:sum('pace'),projected:sum('projected'),
      over:rows.filter(r=>r.status==='over').length,watch:rows.filter(r=>r.status==='watch').length};
    return{now,cm,day,dim,hist,spent,rows,unbudgeted,tot};
  }
  X.spentIn=spentIn;X.budMath=budMath;X.budCompute=budCompute;

  function budCategories(){
    const all=new Set(Object.keys(CATEGORIES));
    for(const t of ALL_TRANSACTIONS)if(t.category)all.add(t.category);
    return[...all];
  }
  X.budSet=function(cat,el){
    const n=meParse(el.value);
    if(Number.isNaN(n)){el.classList.add('invalid');return;}
    if(!n||n<=0){X.budRemove(cat);return;}
    const b=STATE.budgets||(STATE.budgets={}),prev=b[cat];
    b[cat]={monthly:Math.round(n),since:(prev&&!prev.deleted&&prev.since)||curMonth(new Date()),at:stamp()};
    scheduleDriveSave();renderAll();
  };
  X.budRemove=function(cat){
    const b=STATE.budgets||(STATE.budgets={}),prev=b[cat];
    if(!prev||prev.deleted)return;
    b[cat]={deleted:true,at:stamp()};scheduleDriveSave();renderAll();
    toast(`Removed the ${cat} budget`,{action:'Undo',onAction:()=>{(STATE.budgets||(STATE.budgets={}))[cat]={...prev,at:stamp()};scheduleDriveSave();renderAll();}});
  };
  X.budAdd=function(cat,suggest){
    const have=new Set(budList().map(b=>b.cat)),cats=budCategories().filter(c=>!have.has(c)||c===cat).sort((a,b)=>a.localeCompare(b));
    if(!cats.length){toast('Every category already has a budget');return;}
    openSheet({title:'Add budget',body:`<div class="form-grid">
      <div class="field full"><label class="label" for="bdCat">Category</label><select class="input" id="bdCat">${cats.map(c=>`<option value="${escH(c)}"${c===cat?' selected':''}>${escH(c)}</option>`).join('')}</select></div>
      <div class="field full"><label class="label" for="bdAmt">Monthly budget</label>${rpInput('bdAmt',suggest||null,'placeholder="0"')}
        <div class="help${suggest?'':'" style="display:none'}" id="bdHint">${suggest?'Suggested from your average spend in the last three full months.':''}</div>
        <div class="help err" id="bdErr" style="display:none">${ic('triangle-alert','s16')}Enter an amount above zero.</div></div>
    </div>`,
      foot:`<button class="btn btn-secondary" onclick="closeTopSheet(true)">Cancel</button><button class="btn btn-primary" onclick="EXTRAS.budSave()">Add budget</button>`,focus:'#bdAmt',onEnter:()=>X.budSave()});
  };
  X.budSave=function(){
    const cat=$('bdCat').value,n=meParse($('bdAmt').value),bad=!(n>0);
    $('bdErr').style.display=bad?'':'none';$('bdAmt').classList.toggle('invalid',bad);if(bad)return;
    (STATE.budgets||(STATE.budgets={}))[cat]={monthly:Math.round(n),since:curMonth(new Date()),at:stamp()};
    closeTopSheet(true);scheduleDriveSave();renderAll();toast(`Budget set for ${cat}`);
  };
  // Average of the last three full months, rounded to the nearest 100 rb, to pre-fill the sheet.
  X.budSuggest=function(cat){
    const d=budCompute(),v=d.hist.slice(-3).map(m=>d.spent[m][cat]||0),avg=v.reduce((s,x)=>s+x,0)/3;
    return avg>0?Math.round(avg/100000)*100000||100000:null;
  };

  function statusBadge(r){
    return r.status==='over'?'<span class="badge bad">Over budget</span>':r.status==='watch'?'<span class="badge warn">On pace to overspend</span>':'<span class="badge good">On track</span>';
  }
  function overText(r){
    return r.over>0?`<span class="amt delta bad">${fmtIDR(r.over)} over</span>`:`<span class="amt">${fmtIDR(-r.over)} left</span>`;
  }
  function budRowHTML(r){
    const pct=Math.round(r.pct),w=Math.min(100,r.pct),tick=Math.min(100,100*r.day/r.dim),c=escAttr(r.cat);
    return`<tr>
      <td class="merchant ex-full">${catChip(r.cat)}</td>
      <td class="ex-in ex-full" data-label="Monthly budget">${rpInput('bd-'+r.cat.replace(/\W/g,'_'),r.monthly,`aria-label="Monthly budget for ${escH(r.cat)}" onchange="EXTRAS.budSet('${c}',this)"`)}</td>
      <td class="num amt" data-label="Spent">${fmtIDR(r.spent)}</td>
      <td data-label="Used" style="min-width:100px"><div class="ex-bar"><div class="progress${r.status==='over'?' over':''}" role="progressbar" aria-valuenow="${Math.min(100,pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escH(r.cat)} budget used"><i style="width:${w}%"></i></div><span class="ex-tick" style="left:${tick}%" title="Where a steady spender would be today"></span></div><span class="ex-pct">${pct}% used</span></td>
      <td class="num amt" data-label="Expected by today">${fmtIDR(r.pace)}</td>
      <td class="num amt" data-label="Projected month end">${fmtIDR(r.projected)}</td>
      <td class="num" data-label="Over / under">${overText(r)}</td>
      <td data-label="Status">${statusBadge(r)}</td>
      <td class="ex-full"><button class="btn btn-ghost btn-sm" onclick="EXTRAS.budRemove('${c}')" aria-label="Remove the ${escH(r.cat)} budget" title="Remove budget">${ic('trash-2','s16')}<span class="only-sm">Remove</span></button></td></tr>`;
  }
  function renderBudgets(){
    const d=budCompute(),t=d.tot,mName=d.now.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
    const head=pageHead('Budgets',`A monthly limit per spending category · ${escH(mName)}, day ${d.day} of ${d.dim}`,
      `<button class="btn btn-primary" onclick="EXTRAS.budAdd()">${ic('plus')}Add budget</button>${hideBtn()}`);
    if(!d.rows.length){
      const un=d.unbudgeted.length?budUnbudgetedCard(d):'';
      return`${head}<div class="card" style="text-align:center;padding:40px 24px"><span class="empty-ring">${ic('gauge','s24')}</span>
        <h2 class="card-title" style="font-size:18px;line-height:24px;margin:16px 0 6px">Set your first budget</h2>
        <p class="muted" style="max-width:460px;margin:0 auto 18px">Pick a category and a monthly amount. This page then shows how much of it is used, whether you are on pace and where the month is heading.</p>
        <button class="btn btn-primary" onclick="EXTRAS.budAdd()">${ic('plus')}Add budget</button></div>${un?`<div class="grid" style="margin-top:12px">${un}</div>`:''}`;
    }
    const projDelta=t.projected-t.budget;
    const kpis=[
      kpiCard({icon:'wallet',label:'Budgeted per month',value:kpiMoney(t.budget),sub:`<span class="vs">${d.rows.length} categor${d.rows.length===1?'y':'ies'}</span>`}),
      kpiCard({icon:'chart-pie',label:'Spent so far',value:kpiMoney(t.spent),sub:`<span class="vs">${t.budget?Math.round(t.spent/t.budget*100):0}% of budget · expected <span class="amt">${fmtIDRShort(t.pace)}</span> by today</span>`}),
      kpiCard({icon:'calendar',label:'Projected month end',value:kpiMoney(t.projected),sub:`<span class="delta ${projDelta>0?'bad':'good'} amt">${projDelta>0?fmtIDRShort(projDelta)+' over':fmtIDRShort(-projDelta)+' under'}</span>`}),
      kpiCard({icon:'triangle-alert',label:'Over budget',value:`<span>${t.over}</span><span class="faint" style="font-size:16px"> of ${d.rows.length}</span>`,sub:`<span class="vs">${t.watch} more on pace to overspend</span>`}),
    ].join('');
    const table=`<div class="table-wrap"><table class="data ex-rows" id="bdTable"><thead><tr><th scope="col">Category</th><th scope="col">Monthly budget</th><th scope="col" class="num">Spent</th><th scope="col">Used</th><th scope="col" class="num">Expected by today</th><th scope="col" class="num">Projected month end</th><th scope="col" class="num">Over / under</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead><tbody>${d.rows.map(budRowHTML).join('')}</tbody></table></div>
      <p class="ex-note">The tick on each bar is where a steady spender would be today (budget × day ${d.day} ÷ ${d.dim}). Projected month end = spent ÷ ${d.day} days × ${d.dim} days. Spending counts the same transactions as the Spending page.</p>`;
    return`${head}<div class="grid">${kpis}</div>
      <div class="grid"><section class="card flush span-12" id="bdCard">${cardHead('gauge','This month',escH(mName)+' · edit a budget in place')}${table}</section></div>
      ${d.unbudgeted.length?`<div class="grid">${budUnbudgetedCard(d)}</div>`:''}
      <div class="grid">${budHistoryCard(d)}</div>`;
  }
  function budUnbudgetedCard(d){
    const rows=d.unbudgeted.slice(0,8).map(([c,v])=>`<div class="list-item">${catSquare(c,true)}<div class="li-body"><div class="li-title">${escH(c)}</div><div class="li-sub"><span class="amt">${fmtIDR(v)}</span> this month</div></div>
      <button class="btn btn-secondary btn-sm" onclick="EXTRAS.budAdd('${escAttr(c)}',EXTRAS.budSuggest('${escAttr(c)}'))">${ic('plus','s16')}Set budget</button></div>`).join('');
    return`<section class="card span-12">${cardHead('tag','No budget yet','Categories with spending this month')}<div class="list">${rows}</div></section>`;
  }
  function budHistoryCard(d){
    if(!d.rows.length)return'';
    const over=(r,m)=>(!r.since||m>=r.since)&&(d.spent[m][r.cat]||0)>r.monthly;
    const th=d.hist.map(m=>`<th scope="col" class="num">${escH(monthLabel(m))}</th>`).join('');
    const body=d.rows.map(r=>`<tr><td class="merchant">${catChip(r.cat)}</td><td class="num amt">${fmtIDRShort(r.monthly)}</td>${d.hist.map(m=>{const v=d.spent[m][r.cat]||0;return`<td class="num"><span class="amt${over(r,m)?' delta bad':''}">${fmtIDRShort(v)}</span></td>`;}).join('')}</tr>`).join('');
    const list=d.rows.map(r=>`<div class="list-item" style="align-items:flex-start">${catSquare(r.cat,true)}<div class="li-body"><div class="li-title">${escH(r.cat)} <span class="faint" style="font-weight:400">· budget <span class="amt">${fmtIDRShort(r.monthly)}</span></span></div>
      <div class="ex-minis">${d.hist.map(m=>`<span>${escH(monthLabel(m))} <span class="amt${over(r,m)?' bad':''}">${fmtIDRShort(d.spent[m][r.cat]||0)}</span></span>`).join('')}</div></div></div>`).join('');
    return`<section class="card flush span-12" id="bdHist">${cardHead('chart-column','Last 6 months',`Spent per category · ${escH(monthLabel(d.hist[0]))} to ${escH(monthLabel(d.hist[5]))} · over budget in red`)}
      <div class="table-wrap hide-sm"><table class="data"><thead><tr><th scope="col">Category</th><th scope="col" class="num">Budget</th>${th}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="only-sm" style="padding:0 var(--card-pad) var(--card-pad)"><div class="list">${list}</div></div></section>`;
  }
  registerPage({key:'budgets',label:'Budgets',icon:'gauge',group:'plan',order:10,render:renderBudgets});

  /* ══════════════════════════════════════════════════════════════════
     GOALS
     Progress is measured on month-end book balances from the wealth snapshot:
       networth → net worth (assets − liabilities)       liquid → Cash & bank + Deposits groups
       saving   → net-worth change since the goal was created (baseline = end of the month before
                  the creation month; the first book month when that is earlier)
       account  → sum of the chosen accounts' balances
     Required pace = remaining ÷ months from the latest book month to the target month.
     Your pace = average monthly change of the same measure over the last 6 book months.
     ══════════════════════════════════════════════════════════════════ */
  const GOAL_KINDS={networth:'Net worth',liquid:'Cash & deposits',saving:'Saving',account:'Chosen accounts'};
  const goalList=()=>(Array.isArray(STATE.goals)?STATE.goals:[]).filter(g=>g&&g.id&&!g.deleted);
  function goalSeries(g){
    return wMonths().map((m,i)=>{
      const t=wTotals(i,'book');
      if(g.kind==='networth'||g.kind==='saving')return t.net;
      if(g.kind==='liquid')return(t.groups.cash||0)+(t.groups.deposits||0);
      return(g.accounts||[]).reduce((s,id)=>{const a=wAcc(id);return s+(a?wValue(a,i,'book'):0);},0);
    });
  }
  function goalCalc(g){
    const ms=wMonths();if(!ms.length)return null;
    const ser=goalSeries(g),li=ms.length-1,latest=ms[li].month,now=ser[li];
    let progress=now,baseIdx=null;
    if(g.kind==='saving'){
      const since=g.since||String(g.at||'').slice(0,7)||latest,baseKey=shiftM(since,-1);
      baseIdx=0;ms.forEach((m,i)=>{if(m.month<=baseKey)baseIdx=i;});
      if(since>latest)baseIdx=li;                       // created after the book's last month: nothing counted yet
      progress=now-ser[baseIdx];
    }
    const n=Math.min(6,li),avg=n>0?(ser[li]-ser[li-n])/n:null;
    const monthsLeft=diffM(latest,g.by),remaining=Math.max(0,g.target-progress);
    const required=monthsLeft>0?remaining/monthsLeft:remaining;
    let status;
    if(remaining<=0)status='achieved';
    else if(monthsLeft<=0)status='overdue';
    else if(avg!=null&&avg>=required)status='on';
    else status='behind';
    const eta=remaining>0&&avg>0?shiftM(latest,Math.ceil(remaining/avg)):null;
    return{latest,progress,pct:g.target>0?progress/g.target*100:0,remaining,monthsLeft,required,avg,months6:n,status,eta,baseMonth:baseIdx!=null?ms[baseIdx].month:null};
  }
  X.goalCalc=goalCalc;X.goalList=goalList;
  const GSTAT={achieved:['good','Goal reached'],on:['good','On track'],behind:['warn','Behind'],overdue:['bad','Past its date']};
  function goalCardHTML(g){
    const c=goalCalc(g);if(!c)return'';
    const[cls,txt]=GSTAT[c.status],w=Math.max(0,Math.min(100,c.pct));
    const accs=g.kind==='account'?(g.accounts||[]).map(id=>{const a=wAcc(id);return a?a.name:id;}).join(', '):'';
    return`<section class="card span-6 ex-goal" id="goal-${escH(g.id)}">
      <div class="ex-goal-top"><div style="min-width:0">${`<div class="eyebrow">${escH(GOAL_KINDS[g.kind]||g.kind)}</div>`}<h3>${escH(g.name)}</h3>${accs?`<div class="help">${escH(accs)}</div>`:''}</div>
        <div style="display:flex;gap:8px;align-items:center"><span class="badge ${cls}">${txt}</span><button class="icon-btn sm" onclick="EXTRAS.goalEdit('${escAttr(g.id)}')" aria-label="Edit goal ${escH(g.name)}" title="Edit">${ic('pencil')}</button></div></div>
      <div><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-bottom:6px"><span>${money(c.progress)} <span class="faint">of</span> ${money(g.target)}</span><span style="font-weight:600">${Math.round(c.pct)}%</span></div>
        <div class="progress${c.status==='overdue'?' over':''}" role="progressbar" aria-valuenow="${Math.round(w)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escH(g.name)} progress"><i style="width:${w}%"></i></div></div>
      <dl class="ex-facts">
        <div><dt>Target month</dt><dd>${escH(monthLabel(g.by,true))}${c.monthsLeft>0?` <span class="faint" style="font-weight:400">· ${c.monthsLeft} mo left</span>`:''}</dd></div>
        <div><dt>Still to go</dt><dd class="amt">${fmtIDR(c.remaining)}</dd></div>
        <div><dt>Needed per month</dt><dd class="amt">${c.remaining>0?fmtIDR(c.required):'—'}</dd></div>
        <div><dt>Your pace · last ${c.months6||0} mo</dt><dd class="amt${c.avg!=null&&c.remaining>0?(c.status==='on'?' good':' bad'):''}">${c.avg==null?'—':signed(c.avg)+' /mo'}</dd></div>
      </dl>
      ${c.eta&&c.status!=='achieved'?`<div class="help">At your pace: ${escH(monthLabel(c.eta,true))}</div>`:''}</section>`;
  }
  function renderGoals(){
    const head=pageHead('Goals','Targets for net worth, savings and chosen accounts',`<button class="btn btn-primary" onclick="EXTRAS.goalEdit()">${ic('plus')}Add goal</button>${hideBtn()}`);
    if(!W())return`${head}<div class="card" style="text-align:center;padding:40px 24px"><span class="empty-ring">${ic('target','s24')}</span>
      <h2 class="card-title" style="font-size:18px;line-height:24px;margin:16px 0 6px">Goals need your wealth snapshot</h2>
      <p class="muted" style="max-width:460px;margin:0 auto 18px">Progress is measured on month-end balances from your accounting book. Connect the snapshot on the Net worth page first.</p>
      <button class="btn btn-primary" onclick="setTab('networth')">Open Net worth</button></div>`;
    const gs=goalList();
    if(!gs.length)return`${head}<div class="card" style="text-align:center;padding:40px 24px"><span class="empty-ring">${ic('target','s24')}</span>
      <h2 class="card-title" style="font-size:18px;line-height:24px;margin:16px 0 6px">Set your first goal</h2>
      <p class="muted" style="max-width:460px;margin:0 auto 18px">For example a net-worth target by a date. The page then shows what you need to set aside each month and whether your recent pace gets you there.</p>
      <button class="btn btn-primary" onclick="EXTRAS.goalEdit()">${ic('plus')}Add goal</button></div>`;
    return`${head}<div class="grid">${gs.map(goalCardHTML).join('')}</div>
      <p class="ex-note">Progress uses month-end book values as of ${escH(monthLabel(wMonths()[wMonths().length-1].month,true))}. Your pace is the average monthly change of the same measure over the last 6 months; a goal is on track when that pace is at least what is needed per month.</p>`;
  }
  X.goalEdit=function(id){
    if(!W()){toast('Import the wealth snapshot first');return;}
    const cur=id?goalList().find(g=>g.id===id):null;
    const g=cur||{kind:'networth',name:'',target:null,by:shiftM(curMonth(new Date()),12),accounts:[]};
    const accs=wAccounts().filter(a=>a.active||(g.accounts||[]).includes(a.id));
    openSheet({title:cur?'Edit goal':'Add goal',body:`<div class="form-grid">
      <div class="field full"><label class="label" for="glName">Name</label><input class="input" id="glName" type="text" maxlength="60" value="${escH(g.name)}" placeholder="e.g. Net worth target"><div class="help err" id="glNameErr" style="display:none">${ic('triangle-alert','s16')}Enter a name.</div></div>
      <div class="field full"><label class="label" for="glKind">What to measure</label><select class="input" id="glKind" onchange="EXTRAS.goalKindSync()">${Object.entries(GOAL_KINDS).map(([k,l])=>`<option value="${k}"${k===g.kind?' selected':''}>${l}</option>`).join('')}</select>
        <div class="help" id="glKindHelp"></div></div>
      <div class="field"><label class="label" for="glTarget">Target amount</label>${rpInput('glTarget',g.target,'placeholder="0"')}<div class="help err" id="glTargetErr" style="display:none">${ic('triangle-alert','s16')}Enter an amount above zero.</div></div>
      <div class="field"><label class="label" for="glBy">By (month)</label><input class="input" id="glBy" type="month" value="${escH(g.by)}"><div class="help err" id="glByErr" style="display:none">${ic('triangle-alert','s16')}Pick a month.</div></div>
      <div class="field full" id="glAccF"><span class="label">Accounts</span><div class="ex-check-list" id="glAccs">${accs.map(a=>`<label class="check"><input type="checkbox" value="${escH(a.id)}"${(g.accounts||[]).includes(a.id)?' checked':''}> ${escH(a.name)} <span class="faint">${escH(a.id)}</span></label>`).join('')}</div>
        <div class="help err" id="glAccErr" style="display:none">${ic('triangle-alert','s16')}Choose at least one account.</div></div>
    </div>`,
      foot:`${cur?`<button class="btn btn-ghost" style="color:var(--bad);margin-right:auto" onclick="EXTRAS.goalDelete('${escAttr(cur.id)}')">Delete</button>`:''}<button class="btn btn-secondary" onclick="closeTopSheet(true)">Cancel</button><button class="btn btn-primary" onclick="EXTRAS.goalSave('${cur?escAttr(cur.id):''}')">${cur?'Save':'Add goal'}</button>`,
      focus:'#glName'});
    X.goalKindSync();
  };
  X.goalKindSync=function(){
    const k=$('glKind').value;
    $('glAccF').style.display=k==='account'?'':'none';
    $('glKindHelp').textContent={networth:'Assets minus liabilities, book value.',liquid:'Cash & bank plus Deposits groups.',saving:'How much your net worth grows from now on; the target is the amount to add.',account:'The summed balance of the accounts you tick.'}[k]||'';
  };
  X.goalSave=function(id){
    const name=String($('glName').value||'').trim().slice(0,60),kind=$('glKind').value,t=meParse($('glTarget').value),by=$('glBy').value;
    const accounts=kind==='account'?[...document.querySelectorAll('#glAccs input:checked')].map(i=>i.value):[];
    const flag=(el,bad)=>{$(el).style.display=bad?'':'none';return bad;};
    let bad=flag('glNameErr',!name);bad=flag('glTargetErr',!(t>0))||bad;bad=flag('glByErr',!/^\d{4}-\d{2}$/.test(by))||bad;bad=flag('glAccErr',kind==='account'&&!accounts.length)||bad;
    if(bad)return;
    const list=Array.isArray(STATE.goals)?STATE.goals:(STATE.goals=[]),old=id?list.find(g=>g.id===id):null,at=stamp();
    const g={id:old?old.id:rid(),name,kind,target:Math.round(t),by,...(kind==='account'?{accounts}:{}),since:old&&old.since?old.since:curMonth(new Date()),at};
    if(old)list[list.indexOf(old)]=g;else list.push(g);
    closeTopSheet(true);scheduleDriveSave();renderAll();toast(old?'Goal saved':'Goal added');
  };
  X.goalDelete=function(id){
    const list=Array.isArray(STATE.goals)?STATE.goals:[],i=list.findIndex(g=>g.id===id);if(i<0)return;
    const prev=list[i];list[i]={id,deleted:true,at:stamp()};
    closeTopSheet(true);scheduleDriveSave();renderAll();
    toast(`Deleted ${prev.name}`,{action:'Undo',onAction:()=>{const l=STATE.goals||[],j=l.findIndex(g=>g.id===id);if(j>=0)l[j]={...prev,at:stamp()};scheduleDriveSave();renderAll();}});
  };
  registerPage({key:'goals',label:'Goals',icon:'target',group:'plan',order:20,render:renderGoals});

  /* ══════════════════════════════════════════════════════════════════
     INVESTMENT RETURNS
     Cost = book value (what the ledger carries); market = the latest recorded market value
     (month-end close in the app, or the snapshot). Gain = market − book in the same month.
     ══════════════════════════════════════════════════════════════════ */
  // Same lookup order as the core's wValue(): the app's month-end entry first, then the snapshot.
  function mkOf(id,month){
    const me=((STATE.monthEnd||{})[month]||{}).market||{};
    if(me[id]&&me[id].v!=null)return me[id].v;
    const sm=(W().market||{})[month];
    return sm&&sm[id]!=null?sm[id]:null;
  }
  // Modified Dietz: (end − start − flows) ÷ (start + flows/2), flows = change in book value.
  function dietz(ms,me,bs,be){
    if(!(ms>0))return null;
    const c=be-bs,den=ms+c/2;
    return den>0?(me-ms-c)/den*100:null;
  }
  function invData(){
    const ms=wMonths();if(!W()||!ms.length)return null;
    const li=ms.length-1,book=(a,i)=>wValue(a,i,'book');
    const accs=wAccounts().filter(a=>a.investment);
    const holdings=accs.map(a=>{
      let first=-1,last=-1;
      for(let i=0;i<ms.length;i++)if(mkOf(a.id,ms[i].month)!=null){if(first<0)first=i;last=i;}
      const h={a,first,last,bookNow:book(a,li),cost:null,market:null,gain:null,pct:null,asOf:null,ret:null};
      if(last>=0){h.cost=book(a,last);h.market=mkOf(a.id,ms[last].month);h.gain=h.market-h.cost;h.pct=h.cost?h.gain/h.cost*100:null;h.asOf=ms[last].month;
        if(first<last)h.ret=dietz(mkOf(a.id,ms[first].month),h.market,book(a,first),h.cost);}
      return h;
    }).filter(h=>h.bookNow||h.last>=0);
    const valued=holdings.filter(h=>h.last>=0),bookOnly=holdings.filter(h=>h.last<0);
    const tot={cost:valued.reduce((s,h)=>s+h.cost,0),market:valued.reduce((s,h)=>s+h.market,0)};
    tot.gain=tot.market-tot.cost;tot.pct=tot.cost?tot.gain/tot.cost*100:null;
    tot.bookOnly=bookOnly.reduce((s,h)=>s+h.bookNow,0);
    const months=ms.map((m,i)=>{
      const v=holdings.filter(h=>mkOf(h.a.id,m.month)!=null);
      const bookAll=holdings.reduce((s,h)=>s+book(h.a,i),0);
      const row={month:m.month,i,n:v.length,total:holdings.length,book:bookAll,market:null,gain:null,mom:null};
      if(v.length){row.cost=v.reduce((s,h)=>s+book(h.a,i),0);row.market=v.reduce((s,h)=>s+mkOf(h.a.id,m.month),0);row.gain=row.market-row.cost;
        if(i>0){const both=v.filter(h=>mkOf(h.a.id,ms[i-1].month)!=null);if(both.length)row.mom=both.reduce((s,h)=>s+mkOf(h.a.id,m.month)-mkOf(h.a.id,ms[i-1].month),0);}}
      return row;
    });
    // Portfolio return: from the first to the last month with a market value, over the holdings valued in both.
    let ret=null;
    const vm=months.filter(r=>r.n);
    if(vm.length>1){
      const f=vm[0],l=vm[vm.length-1],both=holdings.filter(h=>mkOf(h.a.id,ms[f.i].month)!=null&&mkOf(h.a.id,ms[l.i].month)!=null);
      if(both.length){const sum=(fn)=>both.reduce((s,h)=>s+fn(h),0);
        ret={from:f.month,to:l.month,pct:dietz(sum(h=>mkOf(h.a.id,ms[f.i].month)),sum(h=>mkOf(h.a.id,ms[l.i].month)),sum(h=>book(h.a,f.i)),sum(h=>book(h.a,l.i))),n:both.length};}
    }
    return{holdings,valued,bookOnly,tot,months,ret};
  }
  X.invData=invData;
  const gainSpan=(n,short)=>`<span class="amt delta ${n>0?'good':n<0?'bad':'neutral'}">${n>0?'▲ ':n<0?'▼ ':''}${n===0?fmtIDR(0):signed(n,short)}</span>`;
  const gainPct=p=>p==null?'—':`<span class="delta ${p>0?'good':p<0?'bad':'neutral'}">${pctTxt(p)}</span>`;
  function renderInvest(){
    const d=invData();
    if(!d)return`${pageHead('Investment returns','Cost against market value')}${wealthEmptyHTML()}`;
    const head=pageHead('Investment returns',`Cost (book value) against recorded market value · ${wealthSourceLine()}`,hideBtn());
    if(!d.holdings.length)return`${head}<div class="card">${emptyHTML('trending-up','No investment accounts in the snapshot yet')}</div>`;
    const t=d.tot;
    const kpis=[
      kpiCard({icon:'wallet',label:'Cost (book value)',value:kpiMoney(t.cost),sub:`<span class="vs">${d.valued.length} holding${d.valued.length===1?'':'s'} with a market value</span>`}),
      kpiCard({icon:'chart-line',label:'Market value',value:kpiMoney(t.market),sub:`<span class="vs">latest recorded per holding</span>`}),
      kpiCard({icon:'trending-up',label:'Unrealised gain',value:kpiMoney(t.gain),sub:`${gainPct(t.pct)} <span class="vs">on cost</span>`}),
      kpiCard({icon:'calendar',label:d.ret?`Return since ${monthLabel(d.ret.from)}`:'Return since first market month',value:d.ret&&d.ret.pct!=null?`<span class="delta ${d.ret.pct>=0?'good':'bad'}">${pctTxt(d.ret.pct)}</span>`:'<span class="faint">—</span>',
        sub:`<span class="vs">${d.ret?`${d.ret.n} holding${d.ret.n===1?'':'s'} · simple, see method`:'needs market values in two months'}</span>`}),
    ].join('');
    const row=h=>h.last>=0
      ?`<tr><td class="merchant ex-full"><div class="merchant-name">${escH(h.a.name)}</div><div class="merchant-sub">${escH(wGroup(h.a.group).label)} · ${escH(h.a.id)}${h.asOf!==wMonths()[wMonths().length-1].month?` · <span class="badge warn">market as of ${escH(monthLabel(h.asOf))}</span>`:''}</div></td>
        <td class="num amt" data-label="Cost (book)">${fmtIDR(h.cost)}</td><td class="num amt" data-label="Market">${fmtIDR(h.market)}</td>
        <td class="num" data-label="Gain">${gainSpan(h.gain)}</td><td class="num" data-label="Gain %">${gainPct(h.pct)}</td>
        <td class="num" data-label="Return since first">${gainPct(h.ret)}</td></tr>`
      :`<tr><td class="merchant ex-full"><div class="merchant-name">${escH(h.a.name)}</div><div class="merchant-sub">${escH(wGroup(h.a.group).label)} · ${escH(h.a.id)} · <span class="badge">Book only</span></div></td>
        <td class="num amt" data-label="Cost (book)">${fmtIDR(h.bookNow)}</td><td class="num faint" data-label="Market">—</td><td class="num faint" data-label="Gain">—</td><td class="num faint" data-label="Gain %">—</td><td class="num faint" data-label="Return since first">—</td></tr>`;
    const holdings=`<div class="table-wrap"><table class="data ex-rows" id="ivHoldings"><thead><tr><th scope="col">Holding</th><th scope="col" class="num">Cost (book)</th><th scope="col" class="num">Market</th><th scope="col" class="num">Gain</th><th scope="col" class="num">Gain %</th><th scope="col" class="num">Return since first</th></tr></thead>
      <tbody>${[...d.valued,...d.bookOnly].map(row).join('')}
      <tr class="ex-total"><td class="ex-full">Total with a market value</td><td class="num amt" data-label="Cost (book)">${fmtIDR(t.cost)}</td><td class="num amt" data-label="Market">${fmtIDR(t.market)}</td><td class="num" data-label="Gain">${gainSpan(t.gain)}</td><td class="num" data-label="Gain %">${gainPct(t.pct)}</td><td class="num">${d.ret?gainPct(d.ret.pct):'—'}</td></tr>
      ${d.bookOnly.length?`<tr><td class="ex-full">Book only (no market value yet)</td><td class="num amt" data-label="Cost (book)">${fmtIDR(t.bookOnly)}</td><td></td><td></td><td></td><td></td></tr>`:''}</tbody></table></div>`;
    const mrow=r=>r.n
      ?`<tr><td class="ex-full">${escH(monthLabel(r.month))}${r.n<r.total?` <span class="badge">${r.n} of ${r.total} valued</span>`:''}</td><td class="num amt" data-label="Book (all)">${fmtIDR(r.book)}</td><td class="num amt" data-label="Market (valued)">${fmtIDR(r.market)}</td><td class="num" data-label="Unrealised gain">${gainSpan(r.gain)}</td><td class="num" data-label="Market change vs last month">${r.mom==null?'<span class="faint">—</span>':gainSpan(r.mom)}</td></tr>`
      :`<tr><td class="ex-full">${escH(monthLabel(r.month))} <span class="badge">Book only</span></td><td class="num amt" data-label="Book (all)">${fmtIDR(r.book)}</td><td class="num faint" data-label="Market (valued)">—</td><td class="num faint" data-label="Unrealised gain">—</td><td class="num faint" data-label="Market change vs last month">—</td></tr>`;
    const months=`<div class="table-wrap"><table class="data ex-rows" id="ivMonths"><thead><tr><th scope="col">Month</th><th scope="col" class="num">Book (all holdings)</th><th scope="col" class="num">Market (valued holdings)</th><th scope="col" class="num">Unrealised gain</th><th scope="col" class="num">Market change vs last month</th></tr></thead><tbody>${[...d.months].reverse().slice(0,12).map(mrow).join('')}</tbody></table></div>`;
    return`${head}<div class="grid">${kpis}</div>
      <div class="grid"><section class="card flush span-12">${cardHead('chart-line','Holdings','Gain = market value − book value in the latest month with a market value')}${holdings}</section></div>
      <div class="grid"><section class="card flush span-12">${cardHead('calendar','Month by month','Last 12 months · a month with no market value shows book only')}${months}</section></div>
      <p class="ex-note">Method: unrealised gain is market value minus book value in the same month, so it is what you would realise at today’s market value before costs and tax. Return since first = modified Dietz over the months with a market value: (end − start − net money added) ÷ (start + half the money added), where money added is the change in book value. It is an approximation, not XIRR. Market values come from your month-end entries; months without one are book only.</p>`;
  }
  registerPage({key:'invest',label:'Investment returns',short:'Returns',icon:'chart-line',group:'wealth',order:35,needs:'wealth',render:renderInvest});

  /* ══════════════════════════════════════════════════════════════════
     SPT PACK (annual tax return worksheet)
     Year-end balances from the wealth snapshot (book value, market value where recorded), the
     "Declared in tax return" ticks from Accounts, receivables with their age, and the currency mix.
     Read-only: nothing here is written back to the books.
     ══════════════════════════════════════════════════════════════════ */
  let SPT_YEAR=null;
  const defaultSptYear=()=>new Date().getFullYear()-1;
  function sptYears(){
    const ys=new Set(wMonths().map(m=>+m.month.slice(0,4)));ys.add(defaultSptYear());
    return[...ys].sort((a,b)=>b-a);
  }
  function sptData(year){
    const ms=wMonths();if(!W()||!ms.length)return null;
    year=+year;
    const key=`${year}-12`;let mi=ms.findIndex(m=>m.month===key),warn=null;
    if(mi<0){
      for(let i=ms.length-1;i>=0;i--)if(ms[i].month.startsWith(year+'-')){mi=i;break;}
      warn=mi<0?'none':'partial';
    }
    const out={year,key,warn,month:mi>=0?ms[mi].month:null,mi};
    if(mi<0)return out;
    const declared=STATE.declared||{},groups=W().groups;
    const gi=id=>{const i=groups.findIndex(g=>g.id===id);return i<0?99:i;};
    const rows=wAccounts().map(a=>{const book=wValue(a,mi,'book'),market=a.side==='asset'?mkOf(a.id,out.month):null;
      return{id:a.id,name:a.name,group:a.group,groupLabel:wGroup(a.group).label,side:a.side,ccy:a.ccy||'IDR',book,market,declared:!!declared[a.id]};})
      .filter(r=>r.book||r.market).sort((a,b)=>gi(a.group)-gi(b.group)||a.id.localeCompare(b.id));
    out.assets=rows.filter(r=>r.side==='asset');out.liabs=rows.filter(r=>r.side!=='asset');
    const sum=(l,k)=>l.reduce((s,r)=>s+(r[k]||0),0);
    out.totals={assets:sum(out.assets,'book'),liabs:sum(out.liabs,'book'),
      assetsMarket:out.assets.reduce((s,r)=>s+(r.market!=null?r.market:r.book),0),marketRows:out.assets.filter(r=>r.market!=null).length};
    out.totals.net=out.totals.assets-out.totals.liabs;
    // Receivables: age = months since the balance last became non-zero (the current unbroken run), at the year end.
    out.recv=out.assets.filter(r=>r.group==='receivables').map(r=>{
      let s=mi;while(s>0&&wValue(wAcc(r.id),s-1,'book'))s--;
      return{...r,since:ms[s].month,age:diffM(ms[s].month,out.month),atLeast:s===0};
    });
    out.totals.recv=sum(out.recv,'book');
    const byC={};out.assets.forEach(r=>{byC[r.ccy]=(byC[r.ccy]||0)+r.book;});
    out.ccy=Object.entries(byC).sort((a,b)=>b[1]-a[1]).map(([ccy,v])=>({ccy,value:v,share:out.totals.assets?v/out.totals.assets:0}));
    out.declaredCount=rows.filter(r=>r.declared).length;out.rowCount=rows.length;
    return out;
  }
  X.sptData=sptData;
  X.sptYear=function(y){SPT_YEAR=+y;renderAll();};
  const decl=(r)=>`<input type="checkbox" ${r.declared?'checked':''} onclick="toggleDeclared('${escAttr(r.id)}',event)" aria-label="Declared in tax return: ${escH(r.name)}" title="Declared in tax return">`;
  function sptTable(id,list,withMarket,totalLabel,total,totalMarket){
    let body='',lastG=null;
    for(const r of list){
      if(r.group!==lastG){lastG=r.group;body+=`<tr class="group-row"><th scope="rowgroup" colspan="${withMarket?6:5}">${escH(r.groupLabel)}</th></tr>`;}
      body+=`<tr><td class="sel-col ex-full" data-label="Declared">${decl(r)}</td><td class="merchant ex-full"><div class="merchant-name">${escH(r.name)}</div><div class="merchant-sub">${escH(r.id)}</div></td>
        <td data-label="Currency">${escH(r.ccy)}</td><td class="num amt" data-label="Dec balance (book)">${fmtIDR(r.book)}</td>${withMarket?`${r.market!=null?`<td class="num amt" data-label="Market">${fmtIDR(r.market)}</td>`:'<td class="num hide-sm"><span class="faint">—</span></td>'}`:''}</tr>`;
    }
    return`<div class="table-wrap"><table class="data ex-rows" id="${id}"><thead><tr><th scope="col">Declared</th><th scope="col">Account</th><th scope="col">Currency</th><th scope="col" class="num">Dec balance (book)</th>${withMarket?'<th scope="col" class="num">Market</th>':''}</tr></thead>
      <tbody>${body}<tr class="ex-total"><td class="ex-full" colspan="3">${escH(totalLabel)}</td><td class="num amt" data-label="Book">${fmtIDR(total)}</td>${withMarket?`<td class="num amt" data-label="At market where recorded">${fmtIDR(totalMarket)}</td>`:''}</tr></tbody></table></div>`;
  }
  function renderSpt(){
    if(!W())return`${pageHead('SPT pack','Year-end balances for the annual tax return')}${wealthEmptyHTML()}`;
    if(SPT_YEAR==null)SPT_YEAR=defaultSptYear();
    const d=sptData(SPT_YEAR),years=sptYears();
    const sel=`<label class="ex-year"><span class="sr-only">Tax year</span><select class="input" aria-label="Tax year" onchange="EXTRAS.sptYear(this.value)">${years.map(y=>`<option value="${y}"${y===SPT_YEAR?' selected':''}>Tax year ${y}</option>`).join('')}</select></label>`;
    const head=pageHead('SPT pack',`December ${SPT_YEAR} balances for the annual tax return`,
      `${sel}<button class="btn btn-secondary" onclick="EXTRAS.sptDownload()"${d.mi<0?' disabled':''}>${ic('download')}Download Excel</button>${hideBtn()}`);
    const warn=d.warn==='none'?`<div class="banner warn" style="border-radius:var(--radius-sm);margin-bottom:12px;padding:10px 14px">${ic('triangle-alert')}<span class="msg">Your book has no months for ${SPT_YEAR} yet, so there are no year-end balances to show.</span></div>`
      :d.warn==='partial'?`<div class="banner warn" style="border-radius:var(--radius-sm);margin-bottom:12px;padding:10px 14px">${ic('triangle-alert')}<span class="msg">December ${SPT_YEAR} is not in your book yet. These are the balances at ${escH(monthLabel(d.month,true))}, the last month it has for ${SPT_YEAR}.</span></div>`:'';
    if(d.mi<0)return`${head}${warn}<div class="card">${emptyHTML('file-text','Nothing to show for this tax year')}</div>`;
    const T=d.totals;
    const kpis=[
      kpiCard({icon:'wallet',label:'Harta (assets)',value:kpiMoney(T.assets),sub:`<span class="vs">${d.assets.length} accounts${T.marketRows?` · <span class="amt">${fmtIDRShort(T.assetsMarket)}</span> at market where recorded`:''}</span>`}),
      kpiCard({icon:'receipt',label:'Utang (liabilities)',value:kpiMoney(T.liabs),sub:`<span class="vs">${d.liabs.length} accounts</span>`}),
      kpiCard({icon:'trending-up',label:'Net (book)',value:kpiMoney(T.net),sub:`<span class="vs">${escH(monthLabel(d.month,true))}</span>`}),
      kpiCard({icon:'square-check',label:'Declared in tax return',value:`<span>${d.declaredCount}</span><span class="faint" style="font-size:16px"> of ${d.rowCount}</span>`,sub:`<span class="vs">tick accounts below, or on Accounts</span>`}),
    ].join('');
    const recvRows=d.recv.map(r=>`<tr><td class="merchant ex-full"><div class="merchant-name">${escH(r.name)}</div><div class="merchant-sub">${escH(r.id)}</div></td><td class="num amt" data-label="Balance">${fmtIDR(r.book)}</td>
      <td data-label="Non-zero since">${escH(monthLabel(r.since))}${r.atLeast?' <span class="badge">or earlier</span>':''}</td><td class="num" data-label="Age">${r.atLeast?'at least ':''}${r.age} month${r.age===1?'':'s'}</td></tr>`).join('');
    const recv=d.recv.length?`<div class="table-wrap"><table class="data ex-rows" id="sptRecv"><thead><tr><th scope="col">Receivable</th><th scope="col" class="num">Balance</th><th scope="col">Non-zero since</th><th scope="col" class="num">Age at ${escH(monthLabel(d.month))}</th></tr></thead><tbody>${recvRows}<tr class="ex-total"><td class="ex-full">Total receivables</td><td class="num amt" data-label="Balance">${fmtIDR(T.recv)}</td><td></td><td></td></tr></tbody></table></div>`:emptyHTML('receipt','No receivables at this year end');
    const cols=['#5B5BF0','#22D3EE','#34D399','#F59E0B','#EC4899','#94A3B8','#A3E635'];
    const ccy=d.ccy.length?`<div class="stackbar" role="img" aria-label="${escH(d.ccy.map(c=>`${c.ccy} ${fmtPct(c.share*100)}`).join(', '))}">${d.ccy.map((c,i)=>`<i style="width:${c.share*100}%;background:${cols[i%cols.length]}"></i>`).join('')}</div>
      <div class="legend">${d.ccy.map((c,i)=>`<span class="legend-item"><i style="background:${cols[i%cols.length]}"></i>${escH(c.ccy)} · <span class="amt">${fmtIDRShort(c.value)}</span> · ${fmtPct(c.share*100)}</span>`).join('')}</div>`:emptyHTML('globe','No assets');
    return`${head}${warn}<div class="grid">${kpis}</div>
      <div class="grid"><section class="card flush span-12">${cardHead('landmark','Harta · assets',`Balances at ${escH(monthLabel(d.month,true))}`)}${sptTable('sptAssets',d.assets,true,'Total Harta',T.assets,T.assetsMarket)}</section></div>
      <div class="grid"><section class="card flush span-12">${cardHead('receipt','Utang · liabilities','Amounts owed at year end')}${d.liabs.length?sptTable('sptLiabs',d.liabs,false,'Total Utang',T.liabs):emptyHTML('square-check','No liabilities at this year end')}</section></div>
      <div class="grid"><section class="card flush span-12">${cardHead('receipt','Receivables owed to you','Age = months since the balance last became non-zero, counted to the year end')}${recv}</section></div>
      <div class="grid"><section class="card span-12" id="sptCcy">${cardHead('globe','Currency exposure','Share of assets by account currency, in rupiah equivalent')}${ccy}</section></div>
      <p class="ex-note">Book values come from your accounting book; market values only where a month-end close recorded one. Foreign-currency accounts are shown in rupiah as the book carries them. The Excel file has the same sections with totals; it does not change anything in the book.</p>`;
  }

  /* Excel export: spt-<year>.xlsx — Summary, Harta, Utang, Receivables, Currency. Numbers are real
     numbers (thousands format), headers frozen, totals as values so any reader sees the same figures. */
  async function sptWorkbook(d){
    const E=await xlLib(),wb=new E.Workbook();
    const NUM='#,##0',HDR={bold:true},FILL={type:'pattern',pattern:'solid',fgColor:{argb:'FFE7E6E6'}};
    const sheet=(name,cols)=>{
      const ws=wb.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});
      ws.columns=cols.map(c=>({header:c.h,width:c.w,style:c.fmt?{numFmt:c.fmt}:{}}));
      const r=ws.getRow(1);r.font=HDR;r.eachCell(c=>{c.fill=FILL;c.border={bottom:{style:'thin'}};});
      return ws;
    };
    const total=(ws,label,vals)=>{const r=ws.addRow(vals);r.font=HDR;r.getCell(1).value=label;r.eachCell(c=>{c.border={top:{style:'thin'}};});};
    const sum=ws=>{
      ws.addRow(['Tax year',String(d.year)]);ws.addRow(['Balances as of',d.month]);
      if(d.warn)ws.addRow(['Warning',d.warn==='partial'?`December ${d.year} is not in the book yet; the last month for ${d.year} is used`:'']);
    };
    const s=sheet('Summary',[{h:'Item',w:34},{h:'Value',w:22,fmt:NUM}]);
    sum(s);
    s.addRow(['Total Harta (assets, book)',d.totals.assets]);s.addRow(['Total Harta at market where recorded',d.totals.assetsMarket]);
    s.addRow(['Total Utang (liabilities, book)',d.totals.liabs]);s.addRow(['Net (book)',d.totals.net]);
    s.addRow(['Total receivables',d.totals.recv]);s.addRow(['Accounts declared in tax return',d.declaredCount]);s.addRow(['Accounts listed',d.rowCount]);
    const acctCols=[{h:'Account',w:40},{h:'Code',w:12},{h:'Group',w:22},{h:'Currency',w:10},{h:'Dec balance (book Rp)',w:22,fmt:NUM}];
    const line=(ws,r,m)=>{const row=ws.addRow([r.name,r.id,r.groupLabel,r.ccy,r.book,...(m?[r.market!=null?r.market:null]:[]),r.declared?'Yes':'No']);row.getCell(2).numFmt='@';};
    const h=sheet('Harta',[...acctCols,{h:'Market (Rp)',w:20,fmt:NUM},{h:'Declared in SPT',w:16}]);
    d.assets.forEach(r=>line(h,r,true));total(h,'Total Harta',['Total Harta','','','',d.totals.assets,d.totals.assetsMarket,'']);
    const u=sheet('Utang',[...acctCols,{h:'Declared in SPT',w:16}]);
    d.liabs.forEach(r=>line(u,r,false));total(u,'Total Utang',['Total Utang','','','',d.totals.liabs,'']);
    const rc=sheet('Receivables',[{h:'Account',w:40},{h:'Code',w:12},{h:'Balance (Rp)',w:20,fmt:NUM},{h:'Non-zero since',w:16},{h:'Age (months)',w:14,fmt:'0'},{h:'Age note',w:22},{h:'Declared in SPT',w:16}]);
    d.recv.forEach(r=>{const row=rc.addRow([r.name,r.id,r.book,r.since,r.age,r.atLeast?'at least (older than the book)':'',r.declared?'Yes':'No']);row.getCell(2).numFmt='@';});
    total(rc,'Total receivables',['Total receivables','',d.totals.recv,'','','','']);
    const cx=sheet('Currency',[{h:'Currency',w:14},{h:'Assets, Rp equivalent',w:24,fmt:NUM},{h:'Share of assets',w:16,fmt:'0.0%'}]);
    d.ccy.forEach(c=>cx.addRow([c.ccy,c.value,c.share]));
    total(cx,'Total',['Total',d.ccy.reduce((a,c)=>a+c.value,0),d.ccy.reduce((a,c)=>a+c.share,0)]);
    cx.getRow(cx.rowCount).getCell(3).numFmt='0.0%';cx.getRow(cx.rowCount).getCell(2).numFmt=NUM;
    return wb;
  }
  X.sptWorkbook=async function(year){const d=sptData(year==null?SPT_YEAR:year);if(!d||d.mi<0)throw new Error('No balances for that year');return{wb:await sptWorkbook(d),d};};
  X.sptDownload=async function(){
    const d=sptData(SPT_YEAR);if(!d||d.mi<0){toast('No year-end balances for '+SPT_YEAR);return;}
    let wb;try{wb=await sptWorkbook(d);}catch(e){toast(e.message||'Could not build the Excel file');return;}
    const buf=await wb.xlsx.writeBuffer(),name=`spt-${d.year}.xlsx`;
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast(`Saved ${name}`);
  };
  registerPage({key:'spt',label:'SPT pack',icon:'file-text',group:'wealth',order:60,needs:'wealth',render:renderSpt});
})();
