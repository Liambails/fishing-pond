(() => {
  const ROOT_ID='cobalt-root-v3'; let capturing=false;
  const isListing=()=>/\/listing\/\d+/.test(location.pathname);
  const listingIdFromUrl=()=>location.pathname.match(/\/listing\/(\d+)/)?.[1]||null;
  const settings=()=>new Promise(r=>chrome.storage.sync.get({endpoint:'https://fishing-pond-seven.vercel.app/api/ingest',token:''},r));
  function remove(){document.getElementById(ROOT_ID)?.remove();}
  function authHeaders(cfg){const headers={'Content-Type':'application/json'};if(cfg.token)headers['X-Cobalt-Token']=cfg.token;return headers;}
  function statusUrl(endpoint,listingId){
    try{const u=new URL(endpoint);u.searchParams.set('marketplace','Trade Me');u.searchParams.set('listing_id',listingId);return u.toString();}catch{return null;}
  }
  function mount(){
    if(!isListing()){remove();return;} if(document.getElementById(ROOT_ID))return;
    const root=document.createElement('div');root.id=ROOT_ID;root.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
    const sh=root.attachShadow({mode:'open'});sh.innerHTML=`<style>.p{display:flex;flex-direction:column;align-items:flex-end;gap:7px}.s{display:none;max-width:380px;background:#090d12;color:#fff;padding:9px 12px;border-radius:10px;font-size:13px;box-shadow:0 8px 25px #0005}.s.show{display:block}button{border:0;border-radius:999px;padding:12px 17px;background:#2764ff;color:#fff;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 8px 25px #0004}button:disabled{opacity:.65}</style><div class="p"><div class="s"></div><button>COBALT · Capture</button></div>`;
    const b=sh.querySelector('button'),s=sh.querySelector('.s');let timer;let savedThisPage=false;
    const status=(m,hold=false)=>{clearTimeout(timer);s.textContent=m;s.classList.add('show');if(!hold)timer=setTimeout(()=>s.classList.remove('show'),3000);};
    const setCaptureReady=()=>{if(savedThisPage)return;b.textContent='COBALT · Capture';b.disabled=false;};
    const setSaved=(label)=>{savedThisPage=true;b.textContent=label;b.disabled=true;};

    const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    const collectStable=async()=>{
      const expectedId=listingIdFromUrl();
      const delays=[0,700,1400,2400];
      let latest=null;
      for(let i=0;i<delays.length;i++){
        if(delays[i]){
          b.textContent='Waiting for views…';
          await sleep(delays[i]);
        }
        if(listingIdFromUrl()!==expectedId)throw new Error('Listing changed while capturing');
        latest=await window.CobaltCollect();
        if(!latest?.listing_id)continue;
        if(latest.views!=null)return latest;
      }
      return latest;
    };
    const refreshSavedState=async()=>{
      if(capturing||savedThisPage)return;
      const listingId=listingIdFromUrl();if(!listingId)return;
      try{
        const cfg=await settings();const url=statusUrl(cfg.endpoint,listingId);if(!url)return;
        const resp=await fetch(url,{method:'GET',headers:authHeaders(cfg)});if(!resp.ok)return;
        const result=await resp.json().catch(()=>({}));
        if(result?.ok&&result.capture_complete)setSaved('Already Saved ✓');
        else setCaptureReady();
      }catch{/* Status lookup is best-effort; capture remains available. */}
    };
    const capture=async()=>{
      if(capturing||savedThisPage)return;capturing=true;b.disabled=true;b.textContent='Capturing…';
      try{
        const data=await collectStable(); if(!data?.listing_id)throw new Error('Listing not ready'); data.capture_source='extension-manual';
        const cfg=await settings();
        const resp=await fetch(cfg.endpoint,{method:'POST',headers:authHeaders(cfg),body:JSON.stringify(data)}); const result=await resp.json().catch(()=>({}));
        if(!resp.ok||!result.ok)throw new Error(result.error||`HTTP ${resp.status}`);
        if(result.capture_complete){
          setSaved(result.already_saved?'Already Saved ✓':'Saved ✓');
          status(`${result.already_saved?'Already saved':'Saved'} ${result.marketplace||data.marketplace||'listing'} #${data.listing_id} · next ${result.next_observation_at?new Date(result.next_observation_at).toLocaleString():result.final_verdict||'stopped'}`);
        }else{
          setCaptureReady();
          const warnings=Array.isArray(result.capture_warnings)&&result.capture_warnings.length?` · missing ${result.capture_warnings.map(x=>String(x).replace(/^missing_/,'' )).join(', ')}`:'';
          status(`Partial capture${warnings}. COBALT retried the rendered page several times; leave the page open a moment and try once more.`,true);
        }
      }catch(e){setCaptureReady();status(`Error: ${e.message}`,true);}finally{capturing=false;}
    };
    b.addEventListener('click',capture);chrome.runtime.onMessage.addListener(msg=>{if(msg?.type==='capture')capture();});document.documentElement.appendChild(root);
    refreshSavedState();
    // Trade Me can perform a second render shortly after navigation. Re-check the durable server state
    // after that render so a completed capture cannot become clickable again.
    setTimeout(refreshSavedState,2600);
  }
  mount(); let last=location.href; new MutationObserver(()=>{if(location.href!==last){last=location.href;remove();setTimeout(mount,120);}}).observe(document.documentElement,{childList:true,subtree:true});
})();
