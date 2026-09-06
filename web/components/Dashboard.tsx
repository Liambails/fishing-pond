'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {formatNZActivity,formatNZDateTime,formatNZShort} from '../lib/time';

type Props={products:any[]; listings:any[]; interventions:any[]; systemEvents:any[]; aiEnabled:boolean};
const fmt=(n:any,prefix='')=>n==null?'—':prefix+Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const date=(s:any)=>s?formatNZDateTime(s):'—';
const shortDate=(s:any)=>s?formatNZShort(s):'—';
const closeText=(signal:any,nowMs:number|null)=>{if(!signal?.closeDate||nowMs==null)return '—';const ms=Date.parse(signal.closeDate)-nowMs;if(!Number.isFinite(ms))return '—';if(ms<=0)return 'Ended';const h=ms/3600000;return h<48?`${Math.ceil(h)}h left`:`${Math.ceil(h/24)}d left`};
const obsNewest=(x:any)=>[...(x?.observations||[])].filter((o:any)=>o.captured_at).sort((a:any,b:any)=>Date.parse(b.captured_at)-Date.parse(a.captured_at));
const obsPrice=(o:any)=>o?.buy_now_nzd??o?.asking_price_nzd??o?.current_bid_nzd??null;
const listingResearchId=(x:any)=>`CB-${String(x?.marketplace||'TM').toUpperCase().includes('TRADE')?'TM':String(x?.marketplace||'MP').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3)}-${x?.listing_id||String(x?.id||'').slice(0,8)}`;
const productResearchId=(p:any)=>`CB-P-${String(p?.id||'').replaceAll('-','').slice(0,8).toUpperCase()}`;
const stageLabel=(s:any)=>String(s||'incomplete').replaceAll('_',' ');
const durationText=(seconds:any)=>{const n=Number(seconds);if(!Number.isFinite(n)||n<0)return '—';if(n<60)return `${Math.round(n)}s`;if(n<3600)return `${Math.floor(n/60)}m ${Math.round(n%60)}s`;return `${Math.floor(n/3600)}h ${Math.round((n%3600)/60)}m`;};
const pctMatch=(v:any)=>v==null?'—':`${Math.round(Number(v)*100)}%`;
const matchComponents=(reason:any)=>{const r=typeof reason==='string'?(()=>{try{return JSON.parse(reason)}catch{return {}}})():reason||{};return r.components||{};};
const MatchBreakdown=({reason}:{reason:any})=>{const c=matchComponents(reason);if(!Object.keys(c).length)return null;return <span className="matchBreakdown"><span>fit {pctMatch(c.fitment)}</span><span>subtype {pctMatch(c.subtype)}</span><span>role {pctMatch(c.role)}</span><span>part {pctMatch(c.partNumber)}</span><span>text {pctMatch(c.text)}</span><span>price {pctMatch(c.price)}</span></span>};

function NullValue(){return <span className="nullValue">NULL</span>}
function HoverHistory({label,children,rows,empty='No history collected yet.'}:{label:string;children:any;rows:any[];empty?:string}){
 const [open,setOpen]=useState(false);
 const [pos,setPos]=useState<{top:number;left:number}|null>(null);
 const anchorRef=useRef<HTMLSpanElement|null>(null);
 const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const cancelClose=()=>{if(closeTimer.current){clearTimeout(closeTimer.current);closeTimer.current=null}};
 const show=()=>{cancelClose();setOpen(true)};
 const hideSoon=()=>{cancelClose();closeTimer.current=setTimeout(()=>setOpen(false),120)};
 useEffect(()=>{
   if(!open)return;
   const place=()=>{
     const el=anchorRef.current;if(!el)return;
     const r=el.getBoundingClientRect();
     const width=Math.min(330,Math.max(220,window.innerWidth-24));
     const left=Math.max(12,Math.min(r.left,window.innerWidth-width-12));
     const estimatedHeight=Math.min(305,44+Math.max(1,rows.length)*42);
     const roomBelow=window.innerHeight-r.bottom;
     const top=roomBelow>=Math.min(estimatedHeight,220)?r.bottom+6:Math.max(12,r.top-estimatedHeight-6);
     setPos({top,left});
   };
   place();
   window.addEventListener('resize',place);
   window.addEventListener('scroll',place,true);
   return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)};
 },[open,rows.length]);
 useEffect(()=>()=>cancelClose(),[]);
 const popover=open&&pos&&typeof document!=='undefined'?createPortal(
   <span className="historyPopover historyPopoverPortal" style={{top:pos.top,left:pos.left}} onMouseEnter={cancelClose} onMouseLeave={hideSoon}>
     <span className="historyTitle">{label}</span>
     <span className="historyScroll">{rows.length?rows:<span className="historyEmpty">{empty}</span>}</span>
   </span>,document.body):null;
 return <><span ref={anchorRef} className="historyAnchor" tabIndex={0} onMouseEnter={show} onFocus={show} onMouseLeave={hideSoon} onBlur={hideSoon}>{children}<span className="historyEye" aria-hidden="true"></span></span>{popover}</>
}
function InfoTip({children}:{children:any}){return <span className="infoTip" tabIndex={0}>i<span className="infoBubble">{children}</span></span>}

export default function Dashboard({products,listings,interventions:initialErrors,systemEvents:initialSystemEvents,aiEnabled}:Props){
 const [selected,setSelected]=useState<any>(null);
 const [errors,setErrors]=useState(initialErrors);
 const [systemEvents,setSystemEvents]=useState(initialSystemEvents);
 const [checks,setChecks]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const [productFilter,setProductFilter]=useState('ALL');
 const [queueFreshness,setQueueFreshness]=useState('ALL');
 const [queueSignal,setQueueSignal]=useState('ALL');
 const [queueSearch,setQueueSearch]=useState('');
 const [issueFilter,setIssueFilter]=useState('OPEN');
 const [issueKind,setIssueKind]=useState('ALL');
 const [dailyBrief,setDailyBrief]=useState<any>(null);
 const [selectionReview,setSelectionReview]=useState<any>(null);
 const [clock,setClock]=useState<Date|null>(null);
 const [opsOpen,setOpsOpen]=useState(false);
 const [opsLoading,setOpsLoading]=useState(false);
 const [opsData,setOpsData]=useState<any>(null);
 const [deleteTarget,setDeleteTarget]=useState<any>(null);
 const [deleteConfirmed,setDeleteConfirmed]=useState(false);
 const [ownMarketplace,setOwnMarketplace]=useState('Trade Me');
 const [ownListingUrl,setOwnListingUrl]=useState('');
 const [crmStage,setCrmStage]=useState('incomplete');
 const [supplierName,setSupplierName]=useState('');
 const [supplierStatus,setSupplierStatus]=useState('not_contacted');
 const [supplierContact,setSupplierContact]=useState('');
 const [supplierPlatform,setSupplierPlatform]=useState('Alibaba');
 const [supplierProfileUrl,setSupplierProfileUrl]=useState('');
 const [supplierEmail,setSupplierEmail]=useState('');
 const [supplierPhone,setSupplierPhone]=useState('');
 const [supplierMessaging,setSupplierMessaging]=useState('');
 const [supplierUnitCost,setSupplierUnitCost]=useState('');
 const [supplierQuoteCurrency,setSupplierQuoteCurrency]=useState('USD');
 const [supplierMoq,setSupplierMoq]=useState('');
 const [supplierSampleCost,setSupplierSampleCost]=useState('');
 const [supplierSampleShipping,setSupplierSampleShipping]=useState('');
 const [supplierLeadTimeDays,setSupplierLeadTimeDays]=useState('');
 const [landedCost,setLandedCost]=useState('');
 const [crmNotes,setCrmNotes]=useState('');
 const productsRef=useRef<HTMLElement|null>(null);
 const observationRef=useRef<HTMLElement|null>(null);
 function scrollTo(el:HTMLElement|null){if(!el)return;requestAnimationFrame(()=>el.scrollIntoView({behavior:'smooth',block:'start'}));}
 function openObservation(mode:'ALL'|'NEW'|'PROSPECT'){
   if(mode==='NEW'){setQueueFreshness('FRESH');setQueueSignal('ALL')}
   else if(mode==='PROSPECT'){setQueueFreshness('ALL');setQueueSignal('PROSPECT')}
   else {setQueueFreshness('ALL');setQueueSignal('ALL')}
   requestAnimationFrame(()=>scrollTo(observationRef.current));
 }
 async function openAutomationLog(){
   setOpsOpen(true);setOpsLoading(true);
   try{
     const r=await fetch('/api/system/status',{cache:'no-store'});
     const j=await r.json();
     if(!r.ok)throw new Error(j.error||'Unable to load automation status');
     setOpsData(j);
   }catch(e:any){setOpsData({ok:false,error:e?.message||String(e)})}
   finally{setOpsLoading(false)}
 }
 const opsLabel=(source:any,kind:any)=>{
   const s=String(source||'').toLowerCase();
   if(kind==='manual'||s.includes('manual')||s.includes('extension'))return 'MANUAL';
   if(kind==='scheduler'||s.includes('scheduler-check'))return 'AUTO CHECK';
   if(s.includes('github-actions')||s.includes('worker'))return 'AUTO WORKER';
   return 'SYSTEM';
 };
 const activityDetails=(row:any)=>Array.isArray(row?.details)?row.details:[];
 function openProduct(p:any){
   setSelected(p);setOwnListingUrl('');setOwnMarketplace(p.ownListings?.[0]?.marketplace||'Trade Me');
   setCrmStage(p.status||'incomplete');setSupplierName(p.supplier_name||'');setSupplierStatus(p.supplier_status||'not_contacted');
   setSupplierContact(p.supplier_contact_name||'');setSupplierPlatform(p.supplier_platform||'Alibaba');setSupplierProfileUrl(p.supplier_profile_url||'');
   setSupplierEmail(p.supplier_email||'');setSupplierPhone(p.supplier_phone||'');setSupplierMessaging(p.supplier_messaging||'');
   setSupplierUnitCost(p.supplier_unit_cost==null?'':String(p.supplier_unit_cost));setSupplierQuoteCurrency(p.supplier_quote_currency||'USD');setSupplierMoq(p.supplier_moq==null?'':String(p.supplier_moq));
   setSupplierSampleCost(p.supplier_sample_cost==null?'':String(p.supplier_sample_cost));setSupplierSampleShipping(p.supplier_sample_shipping==null?'':String(p.supplier_sample_shipping));setSupplierLeadTimeDays(p.supplier_lead_time_days==null?'':String(p.supplier_lead_time_days));
   setLandedCost(p.landed_cost_nzd==null?'':String(p.landed_cost_nzd));setCrmNotes(p.crm_notes||'');
 }

 const openCollectionIssues=(()=>{const seen=new Set<string>();return errors.filter(x=>(x.status||'open')==='open').sort((a,b)=>Date.parse(b.occurred_at||'')-Date.parse(a.occurred_at||'')).filter(x=>{const key=String(x.listing_uuid||x.listing_id||x.id);if(seen.has(key))return false;seen.add(key);return true;})})();
 const attention=openCollectionIssues.length+systemEvents.filter(x=>(x.status||'open')==='open'&&['error','critical','warning'].includes(x.severity)).length;
 const nowMs=clock?.getTime()??null;
 const new24=nowMs==null?0:listings.filter(x=>x.first_seen&&nowMs-Date.parse(x.first_seen)<86400000).length;
 const scoredProducts=products.filter(p=>p.readyForScoring&&p.metrics?.verdict);
 const strongProducts=scoredProducts.filter(p=>['STRONG','SCALE'].includes(p.metrics?.verdict)).length;
 const watchProducts=scoredProducts.filter(p=>['PROMISING','WATCH'].includes(p.metrics?.verdict)).length;
 const goodListings=listings.filter(x=>x.signal?.label==='GOOD').length;
 const watchingListings=listings.filter(x=>x.signal?.label==='WATCHING').length;
 const prospects=goodListings+watchingListings;
 const fallbackBrief=`${products.length} product${products.length===1?' is':'s are'} in My Products. ${scoredProducts.length?`${strongProducts} currently look strong and ${watchProducts} need watching.`:'None are being scored yet because your own listings still need enough tracking data.'} The observation queue has ${goodListings} good and ${watchingListings} watching listing${goodListings+watchingListings===1?'':'s'}.`;

 async function loadDailyBrief(force=false){if(!aiEnabled){setDailyBrief({summary:fallbackBrief,cached:true,ai:false});return}try{const r=await fetch('/api/ai/daily-summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({force})});const j=await r.json();setDailyBrief(r.ok?j:{summary:fallbackBrief,ai:false,error:j.error})}catch{setDailyBrief({summary:fallbackBrief,ai:false})}}
 useEffect(()=>{loadDailyBrief(false)},[]);
 useEffect(()=>{setClock(new Date());const t=setInterval(()=>setClock(new Date()),1000);return()=>clearInterval(t)},[]);
 useEffect(()=>{
   const mustHave=listings.filter(x=>!x.product_id&&x.signal?.label==='MUST_HAVE').map(x=>x.id);
   if(!mustHave.length)return;
   fetch('/api/products/auto-promote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({listingIds:mustHave})}).then(r=>r.ok?r.json():null).then(j=>{if(j?.createdProducts>0)location.reload()}).catch(()=>{});
 },[]);

 const filteredProducts=products.filter(p=>productFilter==='ALL'||(productFilter==='INCOMPLETE'?!p.readyForScoring:p.metrics?.verdict===productFilter));
 const filteredListings=listings.filter(l=>{
   const fresh24=nowMs!=null&&l.first_seen&&nowMs-Date.parse(l.first_seen)<86400000;
   if(queueFreshness==='FRESH'&&!fresh24)return false;
   if(queueFreshness==='STALE'&&fresh24)return false;
   if(queueSignal==='PROSPECT'&&!['GOOD','WATCHING'].includes(l.signal?.label))return false;
   if(!['ALL','PROSPECT'].includes(queueSignal)&&l.signal?.label!==queueSignal)return false;
   if(queueSearch){const q=queueSearch.toLowerCase();if(!`${l.listing_id} ${l.title||''} ${l.seller||''}`.toLowerCase().includes(q))return false;}
   return true;
 });
 const lineageListings=(()=>{
   const visible=new Map(filteredListings.map((l:any)=>[String(l.id),l]));
   const children=new Map<string,any[]>();
   for(const l of filteredListings){
     if(l.relisted_from&&visible.has(String(l.relisted_from))){
       const key=String(l.relisted_from);children.set(key,[...(children.get(key)||[]),l]);
     }
   }
   for(const rows of children.values())rows.sort((a:any,b:any)=>Date.parse(a.first_seen||'')-Date.parse(b.first_seen||''));
   const out:{listing:any;depth:number}[]=[];const visited=new Set<string>();
   const walk=(l:any,depth:number)=>{const id=String(l.id);if(visited.has(id))return;visited.add(id);out.push({listing:l,depth});for(const c of children.get(id)||[])walk(c,depth+1)};
   const roots=filteredListings.filter((l:any)=>!l.relisted_from||!visible.has(String(l.relisted_from)));
   for(const root of roots)walk(root,0);
   for(const l of filteredListings)walk(l,0);
   return out;
 })();
 const dedupedCollectionIssues=(()=>{const seen=new Set<string>();return [...errors].sort((a,b)=>Date.parse(b.occurred_at||'')-Date.parse(a.occurred_at||'')).filter(x=>{const key=String(x.listing_uuid||x.listing_id||x.id);if(seen.has(key))return false;seen.add(key);return true;});})();
 const combinedIssues=[...dedupedCollectionIssues.map(x=>({...x,_kind:'COLLECTION'})),...systemEvents.map(x=>({...x,_kind:'SYSTEM',error_type:x.event_type,error_message:x.message,occurred_at:x.occurred_at}))].filter(x=>issueFilter==='ALL'||(x.status||'open').toUpperCase()===issueFilter).filter(x=>issueKind==='ALL'||x._kind===issueKind).sort((a,b)=>Date.parse(b.occurred_at||'')-Date.parse(a.occurred_at||''));

 async function createProduct(){if(!checks.length)return;setBusy(true);const r=await fetch('/api/products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({listingIds:checks})});setBusy(false);if(r.ok)location.reload();else alert(await r.text())}
 async function resolveIssue(x:any,status:'resolved'|'dismissed'){await fetch('/api/interventions',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:x.id,status,kind:x._kind})});if(x._kind==='SYSTEM')setSystemEvents(v=>v.map(e=>e.id===x.id?{...e,status}:e));else setErrors(v=>v.map(e=>e.id===x.id?{...e,status}:e))}
 async function decideComparable(productId:string,listingId:string,action:'accept'|'reject'){setBusy(true);const r=await fetch('/api/products/reconcile',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({productId,listingId,action})});setBusy(false);if(r.ok)location.reload();else alert(await r.text())}
 async function analyze(){if(!selected||!selected.readyForScoring)return;setBusy(true);const r=await fetch('/api/ai/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:selected.id})});const j=await r.json();setBusy(false);if(!r.ok)return alert(j.error||'AI analysis failed');setSelected({...selected,ai_summary:j.summary,ai_analysis:j.analysis})}
 async function reviewSelected(){if(!checks.length||!aiEnabled)return;setBusy(true);setSelectionReview(null);const r=await fetch('/api/ai/listing-review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({listingIds:checks})});const j=await r.json();setBusy(false);if(!r.ok)return alert(j.error||'AI review failed');setSelectionReview(j)}
 async function attachOwnListing(){if(!selected||!ownListingUrl.trim())return;setBusy(true);const r=await fetch('/api/products/own-listing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:selected.id,marketplace:ownMarketplace,listingUrl:ownListingUrl.trim()})});const j=await r.json();setBusy(false);if(!r.ok)return alert(j.error||'Unable to attach marketplace listing');location.reload()}
 async function saveCrm(){if(!selected)return;setBusy(true);const r=await fetch('/api/products',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({productId:selected.id,action:'update_crm',status:crmStage,supplierName,supplierStatus,supplierContactName:supplierContact,supplierPlatform,supplierProfileUrl,supplierEmail,supplierPhone,supplierMessaging,supplierUnitCost,supplierQuoteCurrency,supplierMoq,supplierSampleCost,supplierSampleShipping,supplierLeadTimeDays,landedCostNzd:landedCost,crmNotes})});const j=await r.json();setBusy(false);if(!r.ok)return alert(j.error||'Unable to save product');location.reload()}
 async function archiveProduct(){if(!deleteTarget)return;const activeOwn=(deleteTarget.ownListings||[]).filter((x:any)=>x.active!==false);const needsConfirm=activeOwn.length>0;if(needsConfirm&&!deleteConfirmed)return;setBusy(true);const r=await fetch('/api/products',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({productId:deleteTarget.id,action:'archive',marketplaceClosedConfirmed:needsConfirm?deleteConfirmed:false})});const j=await r.json();setBusy(false);if(!r.ok)return alert(j.error||'Unable to remove product');setDeleteTarget(null);setDeleteConfirmed(false);location.reload()}

 return <main className="appShell">
  <header className="appHeader"><div><div className="brandSmall">MOTERA RESEARCH LAB</div><div className="brandTitle cobaltWordmark">COBALT <span>V3.9.9</span></div></div><div className="headerMeta headerClock">{clock?formatNZDateTime(clock,true):'—'}</div></header>

  <section className="overviewSection">
   <div className="overviewTitleRow"><div className="overviewHeading"><h1>Overview</h1></div></div>
   <p className="overviewText">{dailyBrief?.summary||fallbackBrief}</p>
   <div className="summaryStrip"><button className="metricLink" onClick={()=>scrollTo(productsRef.current)}><b>{products.length}</b> Products</button><button className="metricLink" onClick={()=>openObservation('ALL')}><b>{listings.length}</b> listings being observed</button><button className="metricLink" onClick={()=>openObservation('NEW')}><b>{new24}</b> New listings in 24h</button><button className={`metricLink ${attention>0?'hasIssues':''}`} onClick={()=>requestAnimationFrame(()=>document.getElementById('issues-to-resolve')?.scrollIntoView({behavior:'smooth',block:'start'}))}><b>{attention}</b> Issues to resolve</button><button className="metricLink" onClick={()=>openObservation('PROSPECT')}><b>{prospects}</b> Prospect listings</button><button className="metricLink automationMetric" onClick={openAutomationLog}><b>↻</b> Automation logs</button></div>
   {!aiEnabled&&<div className="inlineNote">AI summaries are off locally. Add <code>OPENAI_API_KEY</code> to <code>web/.env.local</code> and restart the dev server.</div>}
  </section>

  <section ref={productsRef} className="panelSection sectionAnchor">
   <div className="sectionBar"><div><h2>My Products ({products.length})</h2><div className="sectionHint">A CRM for products you may actually source and sell. Market research stays separate from your own listing performance.</div></div><div className="filters"><label>Outcome <select value={productFilter} onChange={e=>setProductFilter(e.target.value)}><option value="ALL">All</option><option value="INCOMPLETE">Incomplete / collecting</option><option>STRONG</option><option>PROMISING</option><option>WATCH</option><option>WEAK</option></select></label></div></div>
   <div className="dataFrame productFrame"><table><thead><tr><th>Product</th><th>Outcome <InfoTip>Outcome is only shown after your own marketplace listing has at least 3 observations covering roughly 24 hours. Before that COBALT will not judge the product.</InfoTip></th><th>Score <InfoTip>A simple performance score for your own listing versus the typical view-growth rate of the competitor listings attached to this product. Around 50 means roughly keeping pace; higher means your listing is gaining views faster. It is not a sales count.</InfoTip></th><th>Demand <InfoTip>How much marketplace attention comparable listings appear to be getting. It uses repeated views and other available public signals; it does not mean confirmed sales.</InfoTip></th><th>Competition <InfoTip>How attractive the competitive situation looks. Higher means the market appears less crowded or more favorable based on the competitor listings we are tracking.</InfoTip></th><th>Suggested price <InfoTip>A test price based on a similarity-weighted benchmark of comparable competitor listings. Higher-confidence matches influence the price more strongly. It is a recommendation, not an automatic price change.</InfoTip></th><th>Your listing</th><th>Confidence <InfoTip>How much evidence COBALT has for the decision. It rises as your own listing and comparable listings collect repeated observations over time.</InfoTip></th><th>Stage <InfoTip>Your commercial workflow: incomplete, sourcing, sampling, test selling, selling, scale, hold or kill.</InfoTip></th><th></th></tr></thead><tbody>{filteredProducts.map(p=><tr key={p.id}>
    <td><div className="productTitleLine"><b>{p.name}</b>{!p.readyForScoring&&<span className="incompleteTag">Incomplete</span>}</div><div className="secondary"><span className="researchId">{productResearchId(p)}</span> · {p.metrics.listingCount} competitor listing{p.metrics.listingCount===1?'':'s'} · {p.metrics.sellerCount} seller{p.metrics.sellerCount===1?'':'s'}</div></td>
    <td>{p.readyForScoring&&p.metrics.verdict?<span className={`statusTag ${p.metrics.verdict}`}>{p.metrics.verdict}</span>:<NullValue/>}</td>
    <td>{p.readyForScoring&&p.metrics.score!=null?<b>{fmt(p.metrics.score)}</b>:<NullValue/>}</td>
    <td>{p.readyForScoring?<>{fmt(p.metrics.demand)}/100</>:<NullValue/>}</td>
    <td>{p.readyForScoring?<>{fmt(p.metrics.competition)}/100</>:<NullValue/>}</td>
    <td>{p.metrics.suggestedPrice!=null?<b>{fmt(p.metrics.suggestedPrice,'$')}</b>:<NullValue/>}</td>
    <td>{p.ownPrimary?<><b>{p.ownPrimary.marketplace||'Marketplace'}</b><div className="secondary">{p.ownObservationCount} observation{p.ownObservationCount===1?'':'s'}{p.readyForScoring?' · ready':' · collecting'}</div></>:<span className="setupNeeded">Add listing</span>}</td>
    <td>{p.readyForScoring&&p.metrics.confidence!=null?<>{fmt(p.metrics.confidence)}%</>:<NullValue/>}</td>
    <td>{stageLabel(p.status)}</td>
    <td><div className="productActions"><button className="classicButton" onClick={()=>openProduct(p)}>Overview</button><button className="classicButton dangerButton" onClick={()=>{setDeleteTarget(p);setDeleteConfirmed(false)}}>Delete</button></div></td>
   </tr>)}{!filteredProducts.length&&<tr><td colSpan={10} className="emptyCell">No products match this filter.</td></tr>}</tbody></table></div>
  </section>

  <section ref={observationRef} className="panelSection observationSection sectionAnchor">
   <div className="sectionBar"><div><h2>Observation queue ({listings.length})</h2><div className="sectionHint">Use repeated marketplace observations to decide which competitor products deserve promotion into My Products.</div></div><div className="actionRow"><button className="classicButton" disabled={!checks.length||!aiEnabled||busy} onClick={reviewSelected}>AI review selected{checks.length?` (${checks.length})`:''}</button><button className="classicButton primaryButton" disabled={!checks.length||busy} onClick={createProduct}>Create product from selected{checks.length?` (${checks.length})`:''}</button></div></div>
   <div className="filterBar"><label>New <select value={queueFreshness} onChange={e=>setQueueFreshness(e.target.value)}><option value="ALL">All</option><option value="FRESH">New &lt;24h</option><option value="STALE">Older ≥24h</option></select></label><label>Signal <select value={queueSignal} onChange={e=>setQueueSignal(e.target.value)}><option value="ALL">All</option><option>GOOD</option><option>WATCHING</option><option>LOW SIGNAL</option><option>TOO EARLY</option></select></label><label className="searchLabel">Search <input value={queueSearch} onChange={e=>setQueueSearch(e.target.value)} placeholder="listing, title or seller"/></label></div>
   {selectionReview&&<div className="aiReview"><div className="aiReviewHead"><b>AI review of selected listings</b><button className="linkButton" onClick={()=>setSelectionReview(null)}>close</button></div><p>{selectionReview.summary}</p><div className="reviewGrid"><div><b>Why it may be worth promoting</b><p>{selectionReview.analysis?.reasons||'—'}</p></div><div><b>Risks / missing evidence</b><p>{selectionReview.analysis?.risks||'—'}</p></div><div><b>Next action</b><p>{selectionReview.analysis?.next_action||'—'}</p></div></div></div>}
   <div className="dataFrame queueFrame"><table className="queueTable"><thead><tr><th></th><th>Listing</th><th>Title / seller</th><th>Price</th><th>Views</th><th>Closes</th><th>Bid activity</th><th>Velocity <InfoTip>How quickly the listing is gaining views based on repeated observations.</InfoTip></th><th>Signal</th><th>Why</th><th>Last check</th><th>Next check</th><th>Failures</th></tr></thead><tbody>{lineageListings.map(({listing:x,depth})=>{
    const history=obsNewest(x);
    const priceRows=history.filter((o:any)=>obsPrice(o)!=null).map((o:any,i:number)=><span className="historyRow" key={`p-${o.captured_at}-${i}`}><b>{fmt(obsPrice(o),'$')}</b><small>{shortDate(o.captured_at)}</small></span>);
    const viewRows=history.filter((o:any)=>o.views!=null).map((o:any,i:number)=><span className="historyRow" key={`v-${o.captured_at}-${i}`}><b>{fmt(o.views)}</b><small>{shortDate(o.captured_at)}</small></span>);
    const bidRows=history.filter((o:any)=>o.bids!=null||o.current_bid_nzd!=null).map((o:any,i:number)=><span className="historyRow" key={`b-${o.captured_at}-${i}`}><b>{o.current_bid_nzd!=null?`${fmt(o.current_bid_nzd,'$')} current bid`:o.bids===0?'No bids':`${o.bids} bid${o.bids===1?'':'s'}`}</b><small>{o.bids!=null&&o.current_bid_nzd!=null?`${o.bids} bid${o.bids===1?'':'s'} · `:''}{shortDate(o.captured_at)}</small></span>);
    const positive24=Number(x.signal?.views24h||0)>0;const tooEarly=x.signal?.label==='TOO EARLY';const isOwn=x.metadata?.ownership==='own';
    const isNewIdRelist=Boolean(x.relisted_from);const episode=Number(x.lifecycle_episode||1);const isSameIdRelist=episode>1;const isRelist=isNewIdRelist||isSameIdRelist;
    return <tr key={x.id} className={`queueRow ${depth>0?'relistChildRow':''} queue-${String(x.signal?.label||'TOO EARLY').replaceAll(' ','-').replaceAll('_','-')}`}><td><input type="checkbox" checked={checks.includes(x.id)} onChange={e=>setChecks(v=>e.target.checked?[...v,x.id]:v.filter(i=>i!==x.id))}/></td><td><div className={`listingLineage ${depth>0?'hasParent':''}`} style={{'--lineage-depth':Math.min(depth,4)} as any}>{depth>0&&<span className="lineageBranch" aria-hidden="true"/>}<div><div className="listingIdLine"><a href={x.url} target="_blank" rel="noreferrer">#{x.listing_id}</a>{isOwn&&<span className="ownTag">OWN</span>}{isRelist&&<span className="relistTag" title={isNewIdRelist?`Relisted from an earlier marketplace listing${x.relist_match_confidence!=null?` · ${Math.round(Number(x.relist_match_confidence)*100)}% lineage confidence`:''}`:`Same marketplace listing, lifecycle episode ${episode}`}>{isNewIdRelist?'RELIST':`RELIST · EP ${episode}`}</span>}</div><div className="secondary researchId">{listingResearchId(x)}</div>{isNewIdRelist&&<div className="secondary relistFrom">↳ new marketplace ID · linked to parent</div>}</div></div></td><td><b>{x.title||'—'}</b><div className="secondary">{x.seller||'unknown seller'} <span className="middleDot">·</span> Observations: {x.signal?.observationCount||0}</div></td><td><HoverHistory label="Price history" rows={priceRows}><span className="hoverValue">{fmt(x.signal?.price,'$')}</span></HoverHistory></td><td><HoverHistory label="View history" rows={viewRows}><span className="hoverValue"><b>{fmt(x.signal?.views)}</b>{x.signal?.views24h!=null&&<span className={positive24?'viewsDelta positive':'viewsDelta'}>{positive24?'↑':'→'} {Math.abs(Number(x.signal.views24h))} views in last 24h</span>}</span></HoverHistory></td><td><span className={x.signal?.closeDate&&nowMs!=null&&Date.parse(x.signal.closeDate)<=nowMs?'endedText':''}>{closeText(x.signal,nowMs)}</span>{x.signal?.closeDate&&<div className="secondary">{shortDate(x.signal.closeDate)}</div>}</td><td><HoverHistory label="Bid history" rows={bidRows} empty="This marketplace has not exposed bid activity for this listing yet."><span className="hoverValue">{x.signal?.currentBid!=null?<b>{fmt(x.signal.currentBid,'$')}</b>:x.signal?.bids===0?'No bids':x.signal?.bids!=null?`${x.signal.bids} bid${x.signal.bids===1?'':'s'}`:'—'}</span></HoverHistory></td><td>{x.signal?.velocity==null?'—':`${x.signal.velocity>=0?'+':''}${fmt(x.signal.velocity)}/day`}</td><td>{x.final_verdict?<><span className="signalText finalizedSignal">{String(x.final_verdict).replaceAll('_',' ')}</span><div className="secondary">Finalized · {x.closure_reason||'ended'}</div></>:<><span className={`signalText signal-${String(x.signal?.label||'').replaceAll(' ','-')}`}>{x.signal?.label||'—'}</span><div className="secondary">{fmt(x.signal?.confidence)}% confidence</div></>}</td><td className="whyCell">{tooEarly?<NullValue/>:<><div>{x.signal?.reason||'—'}</div><div className="confidenceWhy">{x.signal?.confidenceReason||''}</div></>}</td><td>{shortDate(x.last_observed_at||x.last_seen||x.first_seen)}</td><td>{x.active===false?<><span className="endedText">Stopped</span><div className="secondary">{x.closure_reason||'inactive'}</div></>:<>{shortDate(x.next_observation_at)}<div className="secondary">{x.cadence_reason||`${x.observation_interval_hours||24}h cadence`}</div></>}</td><td>{x.consecutive_failures||0}</td></tr>
   })}{!lineageListings.length&&<tr><td colSpan={13} className="emptyCell">No listings match the current filters.</td></tr>}</tbody></table></div>
  </section>

  <section id="issues-to-resolve" className="panelSection issuePanel sectionAnchor"><div className="sectionBar"><div><h2>Issues to resolve ({attention})</h2><div className="sectionHint">Collection and application problems affecting the dashboard.</div></div></div><div className="filterBar"><label>Status <select value={issueFilter} onChange={e=>setIssueFilter(e.target.value)}><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option><option value="ALL">All</option></select></label><label>Type <select value={issueKind} onChange={e=>setIssueKind(e.target.value)}><option value="ALL">All</option><option value="COLLECTION">Marketplace collection</option><option value="SYSTEM">Application / system</option></select></label></div><div className="issueList">{combinedIssues.slice(0,50).map(x=><div className="issueRow" key={`${x._kind}-${x.id}`}><div className="issueType">{x._kind==='SYSTEM'?'SYSTEM':'COLLECT'}</div><div className="issueMain"><b>{x.error_type||'error'}</b>{x.marketplace&&<> · {x.marketplace}</>}{x.listing_id&&<> · #{x.listing_id}</>}<div className="secondary issueMessage">{x.error_message||'Unknown error'}</div>{x._kind==='COLLECTION'&&<div className="manualRecoveryHint">{['captcha','access_denied','human_verification','unusual_traffic'].includes(String(x.error_type||'').toLowerCase())?'Automatic collection paused because the marketplace presented a verification/access challenge. ':Number(x.consecutive_failures||0)>=3?'Automatic collection paused after 3 consecutive failures. ':Number(x.consecutive_failures||0)>0?`Automatic retry ${Math.min(Number(x.consecutive_failures||0)+1,3)}/3 is pending. `:''}Manual recovery: open the listing in your normal browser, complete any marketplace verification if required, then click <b>COBALT · Capture</b>. A successful capture continues this same listing history and automatically reschedules it.</div>}<div className="secondary">{date(x.occurred_at)}</div></div><div className="issueActions">{x._kind==='COLLECTION'&&x.requested_url&&<a className="classicButton primaryButton" href={x.requested_url} target="_blank" rel="noreferrer">Open for manual capture</a>}<button className="classicButton" onClick={()=>resolveIssue(x,'resolved')}>Resolve</button><button className="classicButton" onClick={()=>resolveIssue(x,'dismissed')}>Dismiss</button></div></div>)}{!combinedIssues.length&&<div className="emptyCell">No issues match the current filters.</div>}</div></section>

  <footer className="utilityFooter"><span>Navigation</span><a href="https://motera.co.nz" target="_blank" rel="noreferrer"><i className="navIcon">⌂</i>Motera</a><a href="https://www.alibaba.com" target="_blank" rel="noreferrer"><i className="navIcon">A</i>Alibaba</a><a href="https://www.trademe.co.nz" target="_blank" rel="noreferrer"><i className="navIcon">TM</i>Trade Me</a><a href="https://github.com/Liambails/fishing-pond" target="_blank" rel="noreferrer"><i className="navIcon">GH</i>GitHub</a><span className="legacyTag">COBALT · formerly Fishing Pond</span></footer>

  {opsOpen&&<div className="modalBack" onMouseDown={e=>{if(e.target===e.currentTarget)setOpsOpen(false)}}><div className="modal opsModal"><div className="modalTitleBar"><div><span className="windowKicker">AUTOMATION / DATABASE</span><h2>COBALT activity log</h2></div><button className="windowClose" onClick={()=>setOpsOpen(false)}>×</button></div><div className="modalBody">
   <div className="opsIntro"><div><b>Automatic vs manual collection</b><span>Scheduler wake-ups, automatic browser runs and explicit extension captures are shown separately. Times below are New Zealand time.</span></div><button className="smallBtn" disabled={opsLoading} onClick={openAutomationLog}>{opsLoading?'Refreshing…':'Refresh'}</button></div>
   {opsLoading&&!opsData&&<div className="emptyState">Loading automation history…</div>}
   {opsData?.error&&<div className="inlineNote errorNote">{opsData.error}</div>}
   {opsData?.automation_health&&<><h3 className="opsSubhead">Automation health</h3><div className={`opsHealth ${String(opsData.automation_health.state||'UNKNOWN').toLowerCase()}`}>
    <div className="opsHealthLead"><b>{opsData.automation_health.state}</b><span>{opsData.automation_health.state==='HEALTHY'?'Scheduler heartbeats are arriving normally.':opsData.automation_health.state==='UNKNOWN'?'No V3.9.4 scheduler heartbeat has been recorded yet.':'Scheduler timing or overdue work needs attention.'}</span></div>
    <div className="opsHealthGrid"><div><span>Last scheduler wake</span><b>{opsData.automation_health.last_scheduler_at?shortDate(opsData.automation_health.last_scheduler_at):'—'}</b></div><div><span>Heartbeat age</span><b>{durationText(opsData.automation_health.scheduler_age_seconds)}</b></div><div><span>Missed expected windows</span><b>{opsData.automation_health.missed_expected_windows??'—'}</b></div><div><span>Due listings</span><b>{opsData.automation_health.due_listings}</b></div><div><span>Oldest overdue</span><b>{durationText(opsData.automation_health.oldest_overdue_seconds)}</b></div><div className="lastWorkerHealthCell"><span>Last successful worker</span><b>{opsData.automation_health.last_successful_worker_at?shortDate(opsData.automation_health.last_successful_worker_at):'—'}</b>{opsData.automation_health.last_scheduler_at&&<span className={`schedulerActivityPill ${String(opsData.automation_health.state||'unknown').toLowerCase()}`} title="Latest scheduler heartbeat, including checks where no listing needed collection."><span className="schedulerEye" aria-hidden="true"></span>{opsData.automation_health.state==='HEALTHY'?'Scheduler active':opsData.automation_health.state==='DEGRADED'?'Scheduler delayed':opsData.automation_health.state==='CRITICAL'?'Scheduler stale':'Scheduler seen'} · {formatNZActivity(opsData.automation_health.last_scheduler_at)}</span>}</div><div><span>Scheduler stage</span><b>{stageLabel(opsData.automation_health.last_scheduler_stage||'—')}</b></div><div><span>Worker version</span><b>{opsData.automation_health.last_scheduler_version||'—'}</b></div></div>
    {opsData.automation_health.overdue_listing_ids?.length>0&&<div className="opsOverdue"><b>Overdue listing IDs</b><span>{opsData.automation_health.overdue_listing_ids.slice(0,20).map((x:any)=>`#${x}`).join(' · ')}</span></div>}
    {!opsData.scheduler_table_available&&<div className="inlineNote errorNote">Scheduler forensic table is unavailable. Apply migration 010_scheduler_forensics.sql before relying on automation health.</div>}
   </div></>}
   {opsData?.counts&&<><h3 className="opsSubhead">Database table counts</h3><div className="opsCounts">{Object.entries(opsData.counts).map(([k,v]:any)=><div className="opsCount" key={k}><b>{v==null?'—':Number(v).toLocaleString()}</b><span>{String(k).replaceAll('_',' ')}</span></div>)}</div></>}
   {opsData?.activity&&<><h3 className="opsSubhead">Latest activity</h3><div className="opsLegend"><span><i className="opsDot auto"></i>AUTO CHECK = GitHub scheduler woke up</span><span><i className="opsDot worker"></i>AUTO WORKER = Python browser collector ran</span><span><i className="opsDot manual"></i>MANUAL = Chrome extension capture</span></div><div className="opsLog">
    {opsData.activity.map((row:any,i:number)=>{
      const details=activityDetails(row);const label=opsLabel(row.source,row.kind);const failed=Number(row.failed||0)>0;
      return <div className={`opsLogRow ${failed?'failed':''}`} key={`${row.started_at}-${i}`}>
       <div className="opsTime">{shortDate(row.started_at)}</div>
       <div className={`opsSource ${label.replaceAll(' ','-').toLowerCase()}`}>{label}</div>
       <div className="opsMessage">
        {row.kind==='scheduler'?<><b>{row.status==='failed'?'Scheduler failed':Number(row.due_count||0)>0?`${row.due_count} due`:'Nothing due'}</b><span> · {stageLabel(row.stage||'check')}</span>{row.github_run_id&&<span> · GitHub #{row.github_run_id}</span>}{row.error_message&&<div className="opsDetails"><span className="detailFail">{row.error_type||'error'} · {String(row.error_message).slice(0,180)}</span></div>}</>:
         <><b>{row.succeeded||0}/{row.attempted||0} succeeded</b>{row.failed?` · ${row.failed} failed`:''}
          {details.length>0&&<div className="opsDetails">{details.slice(0,12).map((d:any,j:number)=>{
            const l=(opsData.listings||[]).find((x:any)=>String(x.listing_id)===String(d.listing_id));
            return <span key={j} className={d.ok===false?'detailFail':'detailOk'}>{d.ok===false?'Failed':'Success'} {d.listing_id?`#${d.listing_id}`:''}{d.views!=null?` · ${d.views} views`:''}{d.error?` · ${String(d.error).slice(0,110)}`:''}{d.ok===false&&l?.url&&<> · <a href={l.url} target="_blank" rel="noreferrer">open to retry</a></>}</span>
          })}</div>}
         </>}
       </div>
      </div>
    })}
   </div></>}
  </div></div></div>}

  {selected&&<div className="modalBack" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><div className="modal crmModal"><div className="modalTitleBar"><div><span className="windowKicker">PRODUCT CRM</span><h2>{selected.name}</h2></div><button className="windowClose" onClick={()=>setSelected(null)}>×</button></div><div className="modalBody">
   <div className="crmStatusBand"><div><b>{selected.readyForScoring?'Scoring active':'Not scoring yet'}</b><span>{selected.readyForScoring?'Your listing has enough repeated observations for comparison.':selected.ownPrimary?`Your listing has ${selected.ownObservationCount}/3 observations. COBALT waits for at least 3 observations across roughly 24 hours before showing an outcome.`:'Add your own marketplace listing first. That is the most important next step because it lets COBALT measure how your actual listing performs.'}</span></div>{selected.readyForScoring?<span className={`statusTag ${selected.metrics.verdict}`}>{selected.metrics.verdict}</span>:<span className="incompleteTag">Incomplete</span>}</div>

   {!selected.ownPrimary&&<div className="setupBox"><div className="boxTitle">1. Add your marketplace listing</div><p>This turns the product from a research candidate into something COBALT can track as your own commercial listing.</p><div className="setupForm"><label>Marketplace <select value={ownMarketplace} onChange={e=>setOwnMarketplace(e.target.value)}><option>Trade Me</option></select></label><label className="setupUrl">Listing URL <input value={ownListingUrl} onChange={e=>setOwnListingUrl(e.target.value)} placeholder="Paste your own marketplace listing URL"/></label><button className="classicButton primaryButton" disabled={busy||!ownListingUrl.trim()} onClick={attachOwnListing}>{busy?'Adding…':'Add listing & start tracking'}</button></div></div>}

   <div className="twoColumn crmTopGrid"><div className="infoBox"><div className="boxTitle">Your listing</div>{selected.ownPrimary?<table className="miniTable"><tbody><tr><td>Marketplace</td><td>{selected.ownPrimary.marketplace}</td></tr><tr><td>Listing</td><td><a href={selected.ownPrimary.url} target="_blank" rel="noreferrer">#{selected.ownPrimary.listing_id}</a></td></tr><tr><td>Observations</td><td>{selected.ownObservationCount}</td></tr><tr><td>Current views</td><td>{fmt(selected.ownPrimary.signal?.views)}</td></tr><tr><td>Views / day</td><td>{selected.ownPrimary.signal?.velocity==null?<NullValue/>:`${selected.ownPrimary.signal.velocity>=0?'+':''}${fmt(selected.ownPrimary.signal.velocity)}/day`}</td></tr><tr><td>Current price</td><td>{fmt(selected.ownPrimary.signal?.price,'$')}</td></tr></tbody></table>:<div className="emptyCrm">No own listing attached yet.</div>}</div><div className="infoBox"><div className="boxTitle">Research listing that created this product</div>{selected.sourceListing?<table className="miniTable"><tbody><tr><td>Title</td><td className="crmTitleCell">{selected.sourceListing.title}</td></tr><tr><td>Marketplace</td><td>{selected.sourceListing.marketplace}</td></tr><tr><td>Listing</td><td><a href={selected.sourceListing.url} target="_blank" rel="noreferrer">#{selected.sourceListing.listing_id}</a></td></tr><tr><td>Views</td><td>{fmt(selected.sourceListing.signal?.views)}</td></tr><tr><td>Views / day</td><td>{selected.sourceListing.signal?.velocity==null?<NullValue/>:`${selected.sourceListing.signal.velocity>=0?'+':''}${fmt(selected.sourceListing.signal.velocity)}/day`}</td></tr></tbody></table>:<div className="emptyCrm">Source listing unavailable.</div>}</div></div>

   {selected.readyForScoring&&<div className="decisionHeader"><span className={`statusTag ${selected.metrics.verdict}`}>{selected.metrics.verdict}</span><b>{selected.metrics.score}/100</b><span>{selected.metrics.confidence}% confidence</span><span className="decisionExplain">Score compares how quickly your own listing is gaining views with the typical competitor listing attached to this product. Around 50 means roughly keeping pace.</span></div>}

   <div className="twoColumn"><div className="infoBox"><div className="boxTitle">Market benchmark</div><table className="miniTable"><tbody><tr><td>Comparable listings</td><td>{selected.metrics.listingCount}</td></tr><tr><td>Sellers</td><td>{selected.metrics.sellerCount}</td></tr><tr><td>Similarity-weighted market price <InfoTip>Higher-confidence comparable listings influence this benchmark more strongly. A 98% comparable listing counts more than a 76% comparable listing, while hard fitment/part-family gates still decide whether a listing belongs in the group at all.</InfoTip></td><td>{fmt(selected.metrics.weightedMarketPrice??selected.metrics.medianPrice,'$')}</td></tr><tr><td>Weighted typical range</td><td>{selected.metrics.weightedPriceRange?`${fmt(selected.metrics.weightedPriceRange.min,'$')}–${fmt(selected.metrics.weightedPriceRange.max,'$')}`:<NullValue/>}</td></tr><tr><td>Raw median (reference)</td><td>{fmt(selected.metrics.medianPrice,'$')}</td></tr><tr><td>Suggested test price <InfoTip>Calculated from the similarity-weighted market benchmark, rather than treating every accepted comparable as equally informative.</InfoTip></td><td><b>{fmt(selected.metrics.suggestedPrice,'$')}</b></td></tr><tr><td>Median competitor views</td><td>{fmt(selected.metrics.medianViews)}</td></tr></tbody></table></div><div className="infoBox"><div className="boxTitle">Commercial progress</div><div className="crmForm compactCrm"><label>Stage<select value={crmStage} onChange={e=>setCrmStage(e.target.value)}><option value="incomplete">Incomplete</option><option value="tracking">Tracking own listing</option><option value="sourcing">Sourcing</option><option value="sampling">Sampling</option><option value="sample">Sample received</option><option value="test_selling">Test selling</option><option value="selling">Selling</option><option value="scale">Scale</option><option value="hold">Hold</option><option value="kill">Kill</option></select></label><label>Supplier status<select value={supplierStatus} onChange={e=>setSupplierStatus(e.target.value)}><option value="not_contacted">Not contacted</option><option value="contacted">Contacted</option><option value="quoted">Quoted</option><option value="sample_ordered">Sample ordered</option><option value="sample_received">Sample received</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><label>Landed cost NZD<input type="number" step="0.01" value={landedCost} onChange={e=>setLandedCost(e.target.value)} placeholder="optional"/></label></div></div></div>

   <div className="infoBox supplierBox"><div className="boxTitle">Supplier details</div><div className="supplierForm"><label>Supplier / company<input value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="e.g. Guangzhou ABC Auto Parts"/></label><label>Contact person<input value={supplierContact} onChange={e=>setSupplierContact(e.target.value)} placeholder="e.g. Lina Hu"/></label><label>Platform<select value={supplierPlatform} onChange={e=>setSupplierPlatform(e.target.value)}><option>Alibaba</option><option>1688</option><option>Made-in-China</option><option>Global Sources</option><option>WeChat</option><option>Direct</option><option>Other</option></select></label><label>Supplier/profile URL<input value={supplierProfileUrl} onChange={e=>setSupplierProfileUrl(e.target.value)} placeholder="https://..."/></label><label>Email<input type="email" value={supplierEmail} onChange={e=>setSupplierEmail(e.target.value)} placeholder="supplier@example.com"/></label><label>Phone<input value={supplierPhone} onChange={e=>setSupplierPhone(e.target.value)} placeholder="+86 ..."/></label><label>WhatsApp / WeChat<input value={supplierMessaging} onChange={e=>setSupplierMessaging(e.target.value)} placeholder="number or ID"/></label><label>Quote currency<select value={supplierQuoteCurrency} onChange={e=>setSupplierQuoteCurrency(e.target.value)}><option>USD</option><option>CNY</option><option>NZD</option><option>AUD</option><option>EUR</option><option>GBP</option></select></label><label>Unit cost<input type="number" step="0.01" value={supplierUnitCost} onChange={e=>setSupplierUnitCost(e.target.value)} placeholder="quoted unit cost"/></label><label>MOQ<input type="number" step="1" min="0" value={supplierMoq} onChange={e=>setSupplierMoq(e.target.value)} placeholder="minimum order"/></label><label>Sample cost<input type="number" step="0.01" value={supplierSampleCost} onChange={e=>setSupplierSampleCost(e.target.value)} placeholder="sample unit cost"/></label><label>Sample shipping<input type="number" step="0.01" value={supplierSampleShipping} onChange={e=>setSupplierSampleShipping(e.target.value)} placeholder="shipping quote"/></label><label>Lead time (days)<input type="number" step="1" min="0" value={supplierLeadTimeDays} onChange={e=>setSupplierLeadTimeDays(e.target.value)} placeholder="e.g. 7"/></label><label className="crmNotesLabel supplierNotes">Notes<textarea value={crmNotes} onChange={e=>setCrmNotes(e.target.value)} placeholder="Quote details, fitment claims, sample result, packaging, warranty, negotiation notes…"/></label><div className="supplierSaveRow"><span className="secondary">Keep the supplier record with the product so sourcing decisions do not get lost in chat or email.</span><button className="classicButton primaryButton" disabled={busy} onClick={saveCrm}>{busy?'Saving…':'Save progress'}</button></div></div></div>

   {selected.readyForScoring?<><div className="compactMetrics"><div><span>Demand <InfoTip>Marketplace attention among comparable listings.</InfoTip></span><b>{selected.metrics.demand}/100</b></div><div><span>Competition <InfoTip>How favorable the competitive situation appears.</InfoTip></span><b>{selected.metrics.competition}/100</b></div><div><span>Margin <InfoTip>Estimated room between market price and your landed cost, when a landed cost is known.</InfoTip></span><b>{selected.metrics.margin}/100</b></div><div><span>Fitment <InfoTip>How confident we are that the part/application match is correct. This still needs real fitment evidence.</InfoTip></span><b>{selected.metrics.fitment}/100</b></div><div><span>Supplier <InfoTip>How ready the supplier side is based on the information entered into the product.</InfoTip></span><b>{selected.metrics.supplier}/100</b></div><div><span>Risk <InfoTip>Operational risk such as weak evidence, fitment uncertainty or sourcing uncertainty.</InfoTip></span><b>{selected.metrics.risk}/100</b></div></div><div className="analysisBox"><div className="boxTitle">Decision summary</div><p>{selected.ai_summary||'Enough own-listing data is now available for COBALT to compare your listing with the market. Generate an AI analysis for a plain-English interpretation of the evidence.'}</p><button className="classicButton" disabled={!aiEnabled||busy} onClick={analyze}>{busy?'Analyzing…':selected.ai_summary?'Refresh AI analysis':'Generate AI analysis'}</button></div></>:<div className="nullPanel"><b>Decision metrics are intentionally blank.</b><span>COBALT will not call this product WEAK, STRONG or anything else until your own listing has enough tracking history.</span></div>}

   <details className="classicDetails"><summary>All competitor listings ({selected.listings.length})</summary><div className="competitorList">{selected.listings.map((l:any)=><div className="competitorRow" key={l.id}><div className="competitorMain"><div><a href={l.url} target="_blank" rel="noreferrer">#{l.listing_id} · {l.title}</a> — {l.seller||'unknown seller'}{l.comparableMatch?.match_score!=null&&<span className="secondary"> · {Math.round(Number(l.comparableMatch.match_score)*100)}% comparable · {l.comparableMatch.match_method||'matched'}</span>}</div><MatchBreakdown reason={l.comparableMatch?.match_reason}/></div><button className="smallBtn rejectComparable" disabled={busy} onClick={()=>decideComparable(selected.id,l.id,'reject')}>Not comparable</button></div>)}</div></details>
   {selected.reviewMatches?.length>0 ? (
    <details className="classicDetails"><summary>Possible competitors to review ({selected.reviewMatches.length})</summary><div className="competitorList">{selected.reviewMatches.map((m:any)=><div className="competitorRow" key={m.listing_uuid}><div className="competitorMain"><div><a href={m.listing.url} target="_blank" rel="noreferrer">#{m.listing.listing_id} · {m.listing.title}</a> — {Math.round(Number(m.score)*100)}% match</div><MatchBreakdown reason={m.reason}/></div><div className="competitorActions"><button className="smallBtn" disabled={busy} onClick={()=>decideComparable(selected.id,m.listing_uuid,'accept')}>Accept</button><button className="smallBtn rejectComparable" disabled={busy} onClick={()=>decideComparable(selected.id,m.listing_uuid,'reject')}>Reject</button></div></div>)}</div></details>
   ) : null}
  </div></div></div>}

  {deleteTarget&&<div className="modalBack confirmBack" onMouseDown={e=>{if(e.target===e.currentTarget){setDeleteTarget(null);setDeleteConfirmed(false)}}}><div className="confirmModal"><div className="modalTitleBar"><div><span className="windowKicker">REMOVE PRODUCT</span><h2>{deleteTarget.name}</h2></div><button className="windowClose" onClick={()=>{setDeleteTarget(null);setDeleteConfirmed(false)}}>×</button></div><div className="modalBody"><p>COBALT will hide this product from My Products but keep the research and observation history.</p>{(deleteTarget.ownListings||[]).filter((x:any)=>x.active!==false).length>0&&<label className="confirmCheck"><input type="checkbox" checked={deleteConfirmed} onChange={e=>setDeleteConfirmed(e.target.checked)}/><span>I confirm my {[...new Set((deleteTarget.ownListings||[]).filter((x:any)=>x.active!==false).map((x:any)=>x.marketplace))].join(' / ')} listing has been closed or deleted.</span></label>}<div className="confirmActions"><button className="classicButton" onClick={()=>{setDeleteTarget(null);setDeleteConfirmed(false)}}>Cancel</button><button className="classicButton dangerButton" disabled={busy||((deleteTarget.ownListings||[]).filter((x:any)=>x.active!==false).length>0&&!deleteConfirmed)} onClick={archiveProduct}>{busy?'Removing…':'Remove from My Products'}</button></div></div></div></div>}
 </main>
}
