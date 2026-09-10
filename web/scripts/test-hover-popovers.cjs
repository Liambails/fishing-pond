const fs=require('node:fs');
const assert=require('node:assert/strict');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','components','Dashboard.tsx'),'utf8');

assert.match(src,/const HOVER_OPEN_DELAY_MS=500;/,'hover popovers must require 500ms intent');
assert.match(src,/const HOVER_CLOSE_DELAY_MS=50;/,'hover popovers must close effectively immediately');
assert.match(src,/openTimer\.current=setTimeout\(\(\)=>setOpen\(true\),HOVER_OPEN_DELAY_MS\)/,'history/listing/info popovers use shared hover-open delay');
assert.match(src,/notificationWrap" onMouseEnter=\{scheduleNotificationOpen\} onMouseLeave=\{scheduleNotificationClose\}/,'sourcing opportunity popup uses hover intent and immediate hover-out dismissal');
assert.match(src,/notificationOpenTimer\.current=setTimeout\(\(\)=>setNotificationOpen\(true\),HOVER_OPEN_DELAY_MS\)/,'notification popup uses shared open delay');
assert.match(src,/notificationCloseTimer\.current=setTimeout\(\(\)=>setNotificationOpen\(false\),HOVER_CLOSE_DELAY_MS\)/,'notification popup uses shared close delay');
assert.match(src,/function ListingFactsLink/,'listing hover evidence inspector remains available');
assert.match(src,/function InfoTip/,'info hover popup remains available');
assert.match(src,/function HoverHistory/,'history hover popup remains available');
console.log('hover popover intent/dismissal regression tests passed');
