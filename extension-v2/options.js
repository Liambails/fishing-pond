chrome.storage.sync.get({endpoint:'https://fishing-pond-seven.vercel.app/api/ingest',token:''},v=>{endpoint.value=v.endpoint;token.value=v.token;});
save.onclick=()=>chrome.storage.sync.set({endpoint:endpoint.value.trim(),token:token.value.trim()},()=>{status.textContent='Saved';setTimeout(()=>status.textContent='',1500);});
