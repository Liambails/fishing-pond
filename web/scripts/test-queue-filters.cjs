const assert=require('node:assert/strict');

function isRelistLineageListing(l){
 return Boolean(l?.relisted_from)||Number(l?.lifecycle_episode||1)>1||Boolean(l?.relist_successor_uuid)||String(l?.lifecycle_state||'').toLowerCase()==='relisted'||Boolean(l?.last_relisted_at);
}
function matchesRelistFilter(l,filter){
 const relisted=isRelistLineageListing(l);
 if(filter==='RELISTED')return relisted;
 if(filter==='NOT_RELISTED')return !relisted;
 return true;
}

assert.equal(matchesRelistFilter({active:true,relisted_from:'parent-uuid',lifecycle_episode:1},'RELISTED'),true,'active new-ID successor is relisted');
assert.equal(matchesRelistFilter({active:false,relist_successor_uuid:'child-uuid',lifecycle_state:'terminal_closed'},'RELISTED'),true,'ended parent with successor remains in relist lineage');
assert.equal(matchesRelistFilter({active:true,lifecycle_episode:2},'RELISTED'),true,'same-ID reopened episode is relisted');
assert.equal(matchesRelistFilter({active:true,lifecycle_episode:1},'NOT_RELISTED'),true,'ordinary active listing is not relisted');
assert.equal(matchesRelistFilter({active:false,lifecycle_state:'relist_watch'},'NOT_RELISTED'),true,'ended listing under relist watch is not falsely called relisted until a successor/episode exists');
assert.equal(matchesRelistFilter({active:false,last_relisted_at:'2026-09-09T00:00:00Z'},'RELISTED'),true,'historic relist marker keeps lineage discoverable');
assert.equal(matchesRelistFilter({},'ALL'),true,'all filter does not hide listings');
console.log('observation queue relist filter regression tests passed');
