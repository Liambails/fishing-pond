'use client';
import {ChangeEvent,useEffect,useMemo,useRef,useState} from 'react';
import {formatNZShort} from '../lib/time';

const short=(s:any)=>s?formatNZShort(s):'—';
const num=(v:any)=>v==null?'—':Number(v).toLocaleString();
const norm=(s:any)=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase();

function parseCsv(text:string){
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch;continue}
  if(ch==='"'){quoted=true;continue}
  if(ch===','){row.push(cell);cell='';continue}
  if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';continue}
  if(ch!=='\r')cell+=ch;
 }
 row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 if(!rows.length)return {terms:[] as string[],error:'CSV is empty.'};
 const headers=rows[0].map(x=>norm(x));const idx=headers.indexOf('search_term');
 if(idx<0)return {terms:[] as string[],error:'CSV must contain a search_term column. Use the COBALT template.'};
 const seen=new Set<string>(),terms:string[]=[];
 for(const r of rows.slice(1)){const t=String(r[idx]||'').trim().replace(/\s+/g,' ');const k=norm(t);if(t.length>=2&&!seen.has(k)){seen.add(k);terms.push(t)}}
 return {terms,error:''};
}

function UploadIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}

export default function SearchWatches(){
 const [data,setData]=useState<any>({watches:[],runs:[]});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[term,setTerm]=useState('');
 const [uploadOpen,setUploadOpen]=useState(false),[uploadTerms,setUploadTerms]=useState<string[]>([]),[uploadName,setUploadName]=useState(''),[uploadError,setUploadError]=useState(''),[uploadResult,setUploadResult]=useState('');
 const fileRef=useRef<HTMLInputElement>(null);
 async function refresh(){try{setError('');const r=await fetch('/api/search-watches',{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to load search terms');setData(j)}catch(e:any){setError(e?.message||String(e))}finally{setLoading(false)}}
 useEffect(()=>{refresh();const id=window.setInterval(refresh,30000);return()=>window.clearInterval(id)},[]);
 const runsByWatch=useMemo(()=>{const m=new Map<string,any[]>();for(const r of data.runs||[]){const k=String(r.watch_id);m.set(k,[...(m.get(k)||[]),r])}return m},[data.runs]);
 const existing=useMemo(()=>new Set((data.watches||[]).map((w:any)=>norm(w.search_term))),[data.watches]);
 const filtered=useMemo(()=>{const q=norm(term);if(!q)return data.watches||[];return (data.watches||[]).filter((w:any)=>norm(`${w.search_term} ${w.name||''}`).includes(q))},[data.watches,term]);
 const exactExists=existing.has(norm(term));
 async function add(){const clean=term.trim().replace(/\s+/g,' ');if(clean.length<2||exactExists)return;setBusy(true);setError('');try{const r=await fetch('/api/search-watches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({searchTerm:clean,intervalHours:6,maxPages:3,rowsPerPage:100})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to add search term');setTerm('');await refresh()}catch(e:any){setError(e?.message||String(e))}finally{setBusy(false)}}
 async function action(id:string,action:string){setBusy(true);setError('');try{const r=await fetch('/api/search-watches',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,action})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to update search term');await refresh()}catch(e:any){setError(e?.message||String(e))}finally{setBusy(false)}}
 async function remove(id:string){if(!confirm('Delete this search term? Listings already discovered will be kept.'))return;setBusy(true);setError('');try{const r=await fetch('/api/search-watches',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({id})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to delete search term');await refresh()}catch(e:any){setError(e?.message||String(e))}finally{setBusy(false)}}
 function downloadTemplate(){const blob=new Blob(['search_term\n'],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='cobalt-search-terms-template.csv';a.click();URL.revokeObjectURL(u)}
 async function chooseFile(e:ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0];setUploadResult('');setUploadError('');setUploadTerms([]);setUploadName(f?.name||'');if(!f)return;try{const parsed=parseCsv(await f.text());if(parsed.error)setUploadError(parsed.error);else if(!parsed.terms.length)setUploadError('No search terms found in the CSV.');else setUploadTerms(parsed.terms)}catch{setUploadError('Unable to read that CSV file.')}}
 async function bulkAdd(){if(!uploadTerms.length)return;setBusy(true);setUploadError('');setUploadResult('');try{const r=await fetch('/api/search-watches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({searchTerms:uploadTerms,intervalHours:6,maxPages:3,rowsPerPage:100})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to import search terms');setUploadResult(`${j.added||0} added · ${j.skipped||0} already existed / duplicate`);setUploadTerms([]);if(fileRef.current)fileRef.current.value='';await refresh()}catch(e:any){setUploadError(e?.message||String(e))}finally{setBusy(false)}}
 return <main className="searchTermsPage">
  <div className="searchTermsHeader"><div><span className="windowKicker">COBALT / DISCOVERY</span><h1>Search Terms</h1><p>Each term is searched on Trade Me on the scheduler. New listing IDs are added to the normal Observation Queue; known listings are deduplicated.</p></div><a className="classicButton" href="/">Back to dashboard</a></div>
  <section className="panelSection searchWatchSection">
   <div className="simpleSearchComposer"><div className="searchTermInputWrap"><span className="searchGlyph">⌕</span><input autoFocus value={term} onChange={e=>setTerm(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')add()}} placeholder="Search existing terms or add a new term…" aria-label="Search or add search term"/></div><button className="classicButton primaryButton" disabled={busy||term.trim().length<2||exactExists} onClick={add}>{exactExists?'Added':'Add'}</button><button className="classicButton uploadIconButton" title="Bulk import CSV" aria-label="Bulk import CSV" onClick={()=>{setUploadOpen(true);setUploadError('');setUploadResult('')}}><UploadIcon/></button></div>
   <div className="searchWatchHelp">Type to filter existing terms. If the exact term already exists, COBALT simply leaves it alone. Default cadence: every 6 hours, up to 3 rendered result pages per run.</div>
   {error&&<div className="inlineNote errorNote">{error}</div>}
   {loading?<div className="emptyCell">Loading search terms…</div>:<div className="dataFrame searchWatchFrame"><table><thead><tr><th>Search term</th><th>Status</th><th>Runs</th><th>Last run</th><th>Results</th><th>Total new</th><th>Known last run</th><th>Queued last run</th><th>Pages</th><th>Next run</th><th></th></tr></thead><tbody>{filtered.map((w:any)=>{const rs=runsByWatch.get(String(w.id))||[];const latest=rs[0];const totalNew=rs.reduce((n:number,r:any)=>n+Number(r.new_count||0),0);const failed=(latest?.status||w.last_status)==='failed';return <tr key={w.id}><td><b>{w.name||w.search_term}</b><div className="secondary">Trade Me · every {w.interval_hours}h · up to {w.max_pages} pages</div>{failed&&<div className="secondary apiErrorText">{latest?.error_type||'error'} · {latest?.error_message||w.last_error}</div>}</td><td><span className={`watchStatus ${w.active?'active':'paused'}`}>{w.active?(failed?'ACTIVE · ERROR':'ACTIVE'):'PAUSED'}</span></td><td>{num(rs.length)}</td><td>{short(latest?.started_at||w.last_run_at)}</td><td>{num(latest?.result_count)}</td><td>{num(totalNew)}</td><td>{num(latest?.known_count)}</td><td>{num(latest?.queued_for_observation)}</td><td>{latest?`${latest.pages_succeeded||0}/${latest.pages_attempted||0}`:'—'}</td><td>{short(w.next_run_at)}</td><td><div className="actionRow"><button className="smallBtn" disabled={busy} onClick={()=>action(w.id,'run_now')}>Run next wake</button><button className="smallBtn" disabled={busy} onClick={()=>action(w.id,w.active?'pause':'resume')}>{w.active?'Pause':'Resume'}</button><button className="smallBtn dangerButton" disabled={busy} onClick={()=>remove(w.id)}>Delete</button></div></td></tr>})}{!filtered.length&&<tr><td colSpan={11} className="emptyCell">{term.trim()?`No search terms match “${term.trim()}”. You can add it above.`:'No search terms yet.'}</td></tr>}</tbody></table></div>}
  </section>
  {uploadOpen&&<div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setUploadOpen(false)}}><div className="bulkImportModal" role="dialog" aria-modal="true" aria-labelledby="bulk-import-title"><div className="bulkImportHeader"><div><span className="windowKicker">COBALT / BULK INPUT</span><h2 id="bulk-import-title">Import search terms</h2></div><button className="modalClose" onClick={()=>setUploadOpen(false)} aria-label="Close">×</button></div><p>Upload a CSV using the COBALT template. Only the <code>search_term</code> column is required. Blank rows and duplicates are ignored automatically.</p><div className="templateRow"><button className="classicButton" onClick={downloadTemplate}>Download CSV template</button><span>Header: <code>search_term</code></span></div><label className="csvDrop"><input ref={fileRef} type="file" accept=".csv,text/csv" onChange={chooseFile}/><span className="csvDropIcon"><UploadIcon/></span><b>{uploadName||'Choose CSV file'}</b><span>{uploadTerms.length?`${uploadTerms.length} unique terms ready to import`:'CSV only · one search term per row'}</span></label>{uploadTerms.length>0&&<div className="bulkPreview"><b>Preview</b>{uploadTerms.slice(0,6).map(t=><div key={t}>{t}</div>)}{uploadTerms.length>6&&<div className="secondary">+ {uploadTerms.length-6} more</div>}</div>}{uploadError&&<div className="inlineNote errorNote">{uploadError}</div>}{uploadResult&&<div className="inlineNote successNote">{uploadResult}</div>}<div className="bulkImportActions"><button className="classicButton" onClick={()=>setUploadOpen(false)}>Close</button><button className="classicButton primaryButton" disabled={busy||!uploadTerms.length} onClick={bulkAdd}>{busy?'Importing…':`Import ${uploadTerms.length||''} terms`}</button></div></div></div>}
 </main>
}
