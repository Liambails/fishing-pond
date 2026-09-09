'use client';
import {useEffect,useMemo,useState} from 'react';
import {formatNZShort} from '../lib/time';

const short=(s:any)=>s?formatNZShort(s):'—';
const num=(v:any)=>v==null?'—':Number(v).toLocaleString();

export default function SearchWatches(){
 const [data,setData]=useState<any>({watches:[],runs:[]});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[term,setTerm]=useState('');
 async function refresh(){
  try{setError('');const r=await fetch('/api/search-watches',{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to load search terms');setData(j)}catch(e:any){setError(e?.message||String(e))}finally{setLoading(false)}
 }
 useEffect(()=>{refresh();const id=window.setInterval(refresh,30000);return()=>window.clearInterval(id)},[]);
 const runsByWatch=useMemo(()=>{const m=new Map<string,any[]>();for(const r of data.runs||[]){const k=String(r.watch_id);m.set(k,[...(m.get(k)||[]),r])}return m},[data.runs]);
 async function add(){
  if(term.trim().length<2)return;setBusy(true);setError('');
  try{const r=await fetch('/api/search-watches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({searchTerm:term.trim(),intervalHours:6,maxPages:3,rowsPerPage:100})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to add search term');setTerm('');await refresh()}catch(e:any){setError(e?.message||String(e))}finally{setBusy(false)}
 }
 async function action(id:string,action:string){setBusy(true);setError('');try{const r=await fetch('/api/search-watches',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,action})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to update search term');await refresh()}catch(e:any){setError(e?.message||String(e))}finally{setBusy(false)}}
 async function remove(id:string){if(!confirm('Delete this search term? Listings already discovered will be kept.'))return;setBusy(true);setError('');try{const r=await fetch('/api/search-watches',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({id})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to delete search term');await refresh()}catch(e:any){setError(e?.message||String(e))}finally{setBusy(false)}}
 return <main className="searchTermsPage">
  <div className="searchTermsHeader"><div><span className="windowKicker">COBALT / DISCOVERY</span><h1>Search Terms</h1><p>Each term is searched on Trade Me on the scheduler. New listing IDs are added to the normal Observation Queue; known listings are deduplicated.</p></div><a className="classicButton" href="/">Back to dashboard</a></div>
  <section className="panelSection searchWatchSection">
   <div className="simpleSearchComposer"><input autoFocus value={term} onChange={e=>setTerm(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')add()}} placeholder="e.g. Toyota Aqua NHP10" aria-label="Search term"/><button className="classicButton primaryButton" disabled={busy||term.trim().length<2} onClick={add}>Add</button></div>
   <div className="searchWatchHelp">Default cadence: every 6 hours, up to 3 rendered result pages per run. Discovery is category-agnostic; COBALT observes whatever the search returns and lets the normal similarity and Opportunity engines decide what matters.</div>
   {error&&<div className="inlineNote errorNote">{error}</div>}
   <div className="dataFrame searchWatchFrame"><table><thead><tr><th>Search term</th><th>Status</th><th>Runs</th><th>Last run</th><th>Results</th><th>Total new</th><th>Known last run</th><th>Queued last run</th><th>Pages</th><th>Next run</th><th></th></tr></thead><tbody>{(data.watches||[]).map((w:any)=>{const rs=runsByWatch.get(String(w.id))||[];const latest=rs[0];const totalNew=rs.reduce((n:number,r:any)=>n+Number(r.new_count||0),0);const failed=(latest?.status||w.last_status)==='failed';return <tr key={w.id}><td><b>{w.name||w.search_term}</b><div className="secondary">Trade Me · every {w.interval_hours}h · up to {w.max_pages} pages</div>{failed&&<div className="secondary apiErrorText">{latest?.error_type||'error'} · {latest?.error_message||w.last_error}</div>}</td><td><span className={`watchStatus ${w.active?'active':'paused'}`}>{w.active?(failed?'ACTIVE · ERROR':'ACTIVE'):'PAUSED'}</span></td><td>{num(rs.length)}</td><td>{short(latest?.started_at||w.last_run_at)}</td><td>{num(latest?.result_count)}</td><td>{num(totalNew)}</td><td>{num(latest?.known_count)}</td><td>{num(latest?.queued_for_observation)}</td><td>{latest?`${latest.pages_succeeded||0}/${latest.pages_attempted||0}`:'—'}</td><td>{short(w.next_run_at)}</td><td><div className="actionRow"><button className="smallBtn" disabled={busy} onClick={()=>action(w.id,'run_now')}>Run next wake</button><button className="smallBtn" disabled={busy} onClick={()=>action(w.id,w.active?'pause':'resume')}>{w.active?'Pause':'Resume'}</button><button className="smallBtn dangerButton" disabled={busy} onClick={()=>remove(w.id)}>Delete</button></div></td></tr>})}{!(data.watches||[]).length&&<tr><td colSpan={11} className="emptyCell">No search terms yet.</td></tr>}</tbody></table></div>
  </section>
 </main>
}
