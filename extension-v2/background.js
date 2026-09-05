async function sendCapture(tab){if(!tab?.id||!tab?.url?.includes('trademe.co.nz/'))return;try{await chrome.tabs.sendMessage(tab.id,{type:'capture'});}catch{}}
chrome.action.onClicked.addListener(sendCapture);
chrome.commands.onCommand.addListener(async c=>{if(c!=='capture-current-listing')return;const [tab]=await chrome.tabs.query({active:true,currentWindow:true});sendCapture(tab);});
