(() => {
  const ROOT_ID='fishing-pond-root';
  const API='http://127.0.0.1:8765/capture';
  let capturing=false;
  const isListing=()=>/\/listing\/\d+/.test(location.pathname);
  function remove(){document.getElementById(ROOT_ID)?.remove();}
  function mount(){
    if(!isListing()){remove();return;} if(document.getElementById(ROOT_ID))return;
    const root=document.createElement('div');root.id=ROOT_ID;root.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
    const sh=root.attachShadow({mode:'open'});sh.innerHTML=`<style>.p{display:flex;flex-direction:column;align-items:flex-end;gap:7px}.s{display:none;max-width:360px;background:#111;color:#fff;padding:9px 12px;border-radius:10px;font-size:13px;box-shadow:0 8px 25px #0004}.s.show{display:block}button{border:0;border-radius:999px;padding:12px 17px;background:#111;color:#fff;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 8px 25px #0004}button:disabled{opacity:.65}</style><div class="p"><div class="s"></div><button>Fishing Pond · Capture</button></div>`;
    const b=sh.querySelector('button'),s=sh.querySelector('.s');let timer;
    const status=(m,hold=false)=>{clearTimeout(timer);s.textContent=m;s.classList.add('show');if(!hold)timer=setTimeout(()=>s.classList.remove('show'),2600);};
    const capture=async()=>{
      if(capturing)return;capturing=true;b.disabled=true;b.textContent='Capturing…';
      try{const r=await window.FishingPondCollect(); if(!r?.listing_id)throw new Error('Listing not ready'); const resp=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)});const data=await resp.json().catch(()=>({}));if(!resp.ok||!data.ok)throw new Error(data.error||'Local server not responding'); const warn=data.warning_count?` · ${data.warning_count} warning${data.warning_count===1?'':'s'}`:'';b.textContent=data.updated?'Updated ✓':'Saved ✓';status(`${data.updated?'Updated':'Saved'} #${data.listing_id}${warn}`);setTimeout(()=>{b.textContent='Fishing Pond · Capture';b.disabled=false;},1000);}catch(e){b.textContent='Fishing Pond · Capture';b.disabled=false;status(`Error: ${e.message}`,true);}finally{capturing=false;}
    };
    b.addEventListener('click',capture); chrome.runtime.onMessage.addListener((msg)=>{if(msg?.type==='capture')capture();}); document.documentElement.appendChild(root);
  }
  mount(); let last=location.href; new MutationObserver(()=>{if(location.href!==last){last=location.href;remove();setTimeout(mount,120);}}).observe(document.documentElement,{childList:true,subtree:true}); window.addEventListener('popstate',()=>{remove();setTimeout(mount,100);});
})();
