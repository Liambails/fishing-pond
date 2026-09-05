chrome.storage.sync.get({endpoint:'http://127.0.0.1:8765/capture',token:''},v=>{endpoint.value=v.endpoint;token.value=v.token;});
save.onclick=()=>chrome.storage.sync.set({endpoint:endpoint.value.trim(),token:token.value.trim()},()=>{status.textContent='Saved';setTimeout(()=>status.textContent='',1500);});
