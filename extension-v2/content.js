(() => {
  const ROOT_ID='fishing-pond-root-v2'; let capturing=false;
  const isListing=()=>/\/listing\/\d+/.test(location.pathname);
  const settings=()=>new Promise(r=>chrome.storage.sync.get({endpoint:'http://127.0.0.1:8765/capture',token:''},r));
  function remove(){document.getElementById(ROOT_ID)?.remove();}
  function mount(){
    if(!isListing()){remove();return;} if(document.getElementById(ROOT_ID))return;
    const root=document.createElement('div');root.id=ROOT_ID;root.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
    const sh=root.attachShadow({mode:'open'});sh.innerHTML=`<style>.p{display:flex;flex-direction:column;align-items:flex-end;gap:7px}.s{display:none;max-width:380px;background:#090d12;color:#fff;padding:9px 12px;border-radius:10px;font-size:13px;box-shadow:0 8px 25px #0005}.s.show{display:block}button{border:0;border-radius:999px;padding:12px 17px;background:#2764ff;color:#fff;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 8px 25px #0004}button:disabled{opacity:.65}</style><div class="p"><div class="s"></div><button>Fishing Pond · Capture</button></div>`;
    const b=sh.querySelector('button'),s=sh.querySelector('.s');let timer;
    const status=(m,hold=false)=>{clearTimeout(timer);s.textContent=m;s.classList.add('show');if(!hold)timer=setTimeout(()=>s.classList.remove('show'),3000);};
    const capture=async()=>{
      if(capturing)return;capturing=true;b.disabled=true;b.textContent='Capturing…';
      try{
        const data=await window.FishingPondCollect(); if(!data?.listing_id)throw new Error('Listing not ready');
        const cfg=await settings(); const headers={'Content-Type':'application/json'}; if(cfg.token)headers['X-Fishing-Pond-Token']=cfg.token;
        const resp=await fetch(cfg.endpoint,{method:'POST',headers,body:JSON.stringify(data)}); const result=await resp.json().catch(()=>({}));
        if(!resp.ok||!result.ok)throw new Error(result.error||`HTTP ${resp.status}`);
        b.textContent='Saved ✓';status(`Saved #${data.listing_id}`);setTimeout(()=>{b.textContent='Fishing Pond · Capture';b.disabled=false;},1000);
      }catch(e){b.textContent='Fishing Pond · Capture';b.disabled=false;status(`Error: ${e.message}`,true);}finally{capturing=false;}
    };
    b.addEventListener('click',capture);chrome.runtime.onMessage.addListener(msg=>{if(msg?.type==='capture')capture();});document.documentElement.appendChild(root);
  }
  mount(); let last=location.href; new MutationObserver(()=>{if(location.href!==last){last=location.href;remove();setTimeout(mount,120);}}).observe(document.documentElement,{childList:true,subtree:true});
})();
