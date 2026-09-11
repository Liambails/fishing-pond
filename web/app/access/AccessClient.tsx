'use client';

import {FormEvent,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';

type State='idle'|'checking'|'success'|'error';

export default function AccessClient(){
 const [pin,setPin]=useState('');
 const [state,setState]=useState<State>('idle');
 const [message,setMessage]=useState('Awaiting operator credentials.');
 const [slow,setSlow]=useState(false);
 const inputRef=useRef<HTMLInputElement>(null);
 const search=useSearchParams();

 useEffect(()=>{inputRef.current?.focus()},[]);

 async function submit(e:FormEvent){
  e.preventDefault();
  if(state==='checking'||state==='success')return;
  if(!/^\d{4}$/.test(pin)){
   setState('error');setMessage('DENIED · Enter the 4-digit access PIN.');inputRef.current?.focus();return;
  }
  setState('checking');setMessage('VERIFYING · Validating PIN and issuing secure session…');setSlow(false);
  const slowTimer=window.setTimeout(()=>setSlow(true),900);
  try{
   const r=await fetch('/api/access',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({pin})});
   let j:any={};try{j=await r.json()}catch{}
   if(!r.ok){
    window.clearTimeout(slowTimer);
    setState('error');
    setMessage(r.status===401?'DENIED · Incorrect access PIN.':r.status===503?'SYSTEM · Access gate configuration is incomplete.':`ERROR · ${j.error||'Unable to verify access.'}`);
    setPin('');window.setTimeout(()=>inputRef.current?.focus(),0);return;
   }
   window.clearTimeout(slowTimer);
   try{localStorage.setItem('cobalt_access_granted','1')}catch{}
   setState('success');setMessage('ACCESS GRANTED · Secure session established. Opening COBALT…');
   const next=search.get('next');
   const target=next&&next.startsWith('/')&&!next.startsWith('//')?next:'/';
   // Hard navigation guarantees the new HttpOnly cookie is present on the protected request.
   window.setTimeout(()=>window.location.replace(target),420);
  }catch{
   window.clearTimeout(slowTimer);
   setState('error');setMessage('NETWORK ERROR · Could not reach the authentication endpoint.');
  }
 }

 const tone=state==='success'?'#63e6a6':state==='error'?'#ff7a90':state==='checking'?'#72c7ff':'#7f9bb3';
 return <main style={{minHeight:'100vh',background:'radial-gradient(circle at 50% 15%,#10263a 0,#091521 38%,#050b12 100%)',color:'#c7d9e8',display:'grid',placeItems:'center',padding:24,fontFamily:'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace'}}>
  <style>{`@keyframes cobaltBlink{50%{opacity:.25}} @keyframes cobaltScan{0%{transform:translateY(-100%)}100%{transform:translateY(900%)}} @keyframes cobaltPulse{50%{box-shadow:0 0 28px rgba(73,177,255,.2)}}`}</style>
  <section style={{width:'100%',maxWidth:560,border:'1px solid #28506b',background:'rgba(4,13,21,.94)',boxShadow:'0 24px 90px rgba(0,0,0,.5)',position:'relative',overflow:'hidden'}}>
   <div aria-hidden="true" style={{position:'absolute',inset:0,pointerEvents:'none',background:'repeating-linear-gradient(180deg,rgba(255,255,255,.018) 0,rgba(255,255,255,.018) 1px,transparent 1px,transparent 4px)'}}/>
   <div style={{height:3,background:'#2d91d2'}}/>
   <header style={{display:'flex',justifyContent:'space-between',gap:16,padding:'15px 18px',borderBottom:'1px solid #18354a',background:'#081723'}}>
    <div><span style={{color:'#68c6ff',fontWeight:800}}>COBALT</span><span style={{color:'#466b84'}}> // ACCESS NODE</span></div>
    <div style={{fontSize:12,color:'#587a91'}}>PROD · AUTH/01</div>
   </header>
   <form onSubmit={submit} style={{padding:'34px 30px 30px',position:'relative'}}>
    <div style={{fontSize:12,color:'#4a7d9c',marginBottom:12}}>MOTERA RESEARCH LAB / RESTRICTED CONSOLE</div>
    <h1 style={{fontSize:24,lineHeight:1.25,margin:'0 0 8px',color:'#e8f4ff',letterSpacing:'-.4px'}}>Operator authentication required</h1>
    <p style={{margin:'0 0 26px',fontSize:13,lineHeight:1.7,color:'#7794a9'}}>Enter the 4-digit PIN to establish a persistent encrypted browser session.</p>
    <label htmlFor="cobalt-pin" style={{display:'block',fontSize:12,color:'#5c91b2',marginBottom:8}}>$ authenticate --pin</label>
    <div style={{display:'flex',gap:10,alignItems:'stretch'}}>
     <input ref={inputRef} id="cobalt-pin" aria-label="COBALT access PIN" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={4} disabled={state==='checking'||state==='success'} value={pin} onChange={e=>{setPin(e.target.value.replace(/\D/g,'').slice(0,4));if(state==='error'){setState('idle');setMessage('Awaiting operator credentials.')}}} style={{minWidth:0,flex:1,boxSizing:'border-box',height:54,background:'#02070c',border:`1px solid ${state==='error'?'#8e3547':state==='success'?'#277958':'#28506b'}`,outline:'none',color:'#dff4ff',fontSize:28,fontWeight:800,letterSpacing:14,textAlign:'center',padding:'0 4px 0 18px',caretColor:'#72c7ff'}}/>
     <button type="submit" disabled={state==='checking'||state==='success'||pin.length!==4} style={{width:150,border:'1px solid #286d99',background:state==='success'?'#123f31':state==='error'?'#391521':'#0d3450',color:'#d9f1ff',fontFamily:'inherit',fontSize:12,fontWeight:800,letterSpacing:.5,padding:'0 15px',cursor:state==='checking'||state==='success'||pin.length!==4?'default':'pointer',opacity:(pin.length!==4&&state==='idle')?0.48:1}}>{state==='checking'?'VERIFYING…':state==='success'?'GRANTED ✓':'EXECUTE ↵'}</button>
    </div>
    <div role="status" aria-live="polite" style={{marginTop:18,borderTop:'1px solid #143047',paddingTop:16,minHeight:48}}>
     <div style={{display:'flex',gap:10,alignItems:'flex-start',fontSize:12,lineHeight:1.6,color:tone}}>
      <span style={{animation:state==='checking'?'cobaltBlink .8s steps(1,end) infinite':'none'}}>●</span>
      <div><div>{message}</div>{state==='checking'&&slow&&<div style={{color:'#587a91',marginTop:3}}>Handshake is taking longer than usual. Waiting for Vercel response…</div>}</div>
     </div>
    </div>
    <div style={{marginTop:22,display:'flex',justifyContent:'space-between',gap:18,fontSize:10,color:'#3e6077'}}><span>COOKIE: HTTPONLY · 180D</span><span>SESSION: SAME-SITE</span></div>
   </form>
  </section>
 </main>
}
