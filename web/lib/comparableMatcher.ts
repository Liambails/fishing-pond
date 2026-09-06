/*
 * COBALT V3.9.8 structured comparable-product matcher.
 *
 * Identity is hierarchical: fitment + part family + subtype/role are primary.
 * Cosine similarity and price compatibility are supporting evidence only.
 */

export type ComparableDecision='AUTO_LINK'|'REVIEW'|'REJECT';
export type PartIdentity={family:string|null;subtype:string|null;role:string|null;position:string|null;master:boolean;tokens:string[]};
export type MatchComponents={fitment:number;subtype:number;role:number;partNumber:number|null;text:number;price:number|null};
export type ComparableScore={
  decision:ComparableDecision;
  score:number;
  cosine:number;
  priceCompatibility:number|null;
  reasons:string[];
  blocker:string;
  components:MatchComponents;
  identity:{product:PartIdentity;listing:PartIdentity};
  shape:{make:string|null;model:string|null;chassis:string|null;partFamily:string|null;years:string|null};
};
export type MatchContext={productIdentity?:PartIdentity|null;marketMedianPrice?:number|null;sourceListingId?:string|null};

export const MATCHER_VERSION='hybrid-v2';
const norm=(v:any)=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const words=(v:any)=>norm(v).split(/\s+/).filter(Boolean);
const hasPhrase=(text:string,phrase:string)=>` ${norm(text)} `.includes(` ${norm(phrase)} `);
const cap=(v:string)=>v?`${v[0].toUpperCase()}${v.slice(1)}`:v;
const clamp01=(n:number)=>Math.max(0,Math.min(1,n));

const MAKES=['toyota','mazda','suzuki','honda','nissan','mitsubishi','subaru','ford','holden','hyundai','kia','bmw','audi','volkswagen','lexus'];
const MODEL_ALIASES:Record<string,string[]>= {
  aqua:['aqua','prius c'], prius:['prius'], corolla:['corolla'], yaris:['yaris'], vitz:['vitz'], camry:['camry'], wish:['wish'],
  swift:['swift'], axela:['axela','mazda 3','mazda3'], demio:['demio','mazda 2','mazda2'], fit:['fit','jazz'], sienta:['sienta'], porte:['porte']
};

export function normalizePartFamily(value:any){
  const t=norm(value); if(!t)return null;
  if(t.includes('window')&&t.includes('switch'))return 'window_control';
  if(t.includes('combination')&&t.includes('switch'))return 'combination_switch';
  if(t.includes('wiper')&&t.includes('switch'))return 'wiper_switch';
  if(t.includes('headlight')&&t.includes('switch'))return 'headlight_switch';
  if(t.includes('ignition'))return 'ignition_switch';
  if(t.includes('seatbelt')||t.includes('seat belt'))return 'seat_belt';
  if(t.includes('console')&&t.includes('switch'))return 'center_console_switch';
  if(t.includes('mirror')&&t.includes('switch'))return 'mirror_control';
  return t.replace(/\s+/g,'_');
}

function rawSnapshot(obs:any){const r=obs?.raw_snapshot;if(!r)return {};if(typeof r==='string'){try{return JSON.parse(r)||{}}catch{return {}}}return r||{}}
function rawDescription(obs:any){return String(rawSnapshot(obs)?.description||'')}
function metadata(listing:any){const m=listing?.metadata;if(!m)return {};if(typeof m==='string'){try{return JSON.parse(m)}catch{return {}}}return m}
function compactText(listing:any,obs:any){
  const m=metadata(listing);
  return [listing?.title,obs?.vehicle,m.vehicle,obs?.chassis,m.chassis,obs?.years,obs?.part_type,m.part_type,obs?.part_number,...normalizeCandidateArray(obs?.part_number_candidates)].filter(Boolean).join(' ');
}
function evidenceText(listing:any,obs:any){return `${compactText(listing,obs)} ${rawDescription(obs)}`}
function normalizeCandidateArray(v:any):any[]{if(Array.isArray(v))return v;if(typeof v==='string'){try{const p=JSON.parse(v);return Array.isArray(p)?p:[]}catch{return []}}return []}
function inferMake(text:string){const t=norm(text);return MAKES.find(x=>hasPhrase(t,x))||null}
function inferModel(text:string){const t=norm(text);for(const [canonical,aliases] of Object.entries(MODEL_ALIASES)){if(aliases.some(a=>hasPhrase(t,a)))return canonical}return null}
function inferChassis(text:string){const m=String(text||'').toUpperCase().match(/\b[A-Z]{1,4}\d{2,3}\b/g)||[];return m[0]||null}
function normalizeChassis(value:any){return inferChassis(String(value||''))||String(value||'').trim().toUpperCase()||null}
function yearRange(v:any):[number,number]|null{const nums=String(v||'').match(/\b(?:19|20)\d{2}\b/g)?.map(Number)||[];if(!nums.length)return null;return [Math.min(...nums),Math.max(...nums)]}
function rangesOverlap(a:[number,number]|null,b:[number,number]|null){return !a||!b?null:Math.max(a[0],b[0])<=Math.min(a[1],b[1])}
function productModelCanonical(v:any){const n=norm(v);for(const [k,a] of Object.entries(MODEL_ALIASES)){if(n===k||a.map(norm).includes(n))return k}return n||null}

export function inferPartIdentity(text:any,explicitPartType?:any):PartIdentity{
  const t=norm(`${explicitPartType||''} ${text||''}`);
  let family=normalizePartFamily(explicitPartType||text);
  if(!family&&t.includes('window')&&t.includes('switch'))family='window_control';
  const master=family==='window_control'&&(hasPhrase(t,'master switch')||hasPhrase(t,'master power window')||hasPhrase(t,'window master')||hasPhrase(t,'main window'));
  let subtype:string|null=null;
  if(family==='window_control'){
    if(master)subtype='master_window_switch';
    else if(t.includes('window')&&t.includes('switch'))subtype='single_window_switch';
  } else if(family) subtype=family;
  let position:string|null=null;
  if(/\b(rh|right hand|right front|front right)\b/.test(t))position='front_right';
  else if(/\b(lh|left hand|left front|front left)\b/.test(t))position='front_left';
  else if(/\b(right rear|rear right)\b/.test(t))position='rear_right';
  else if(/\b(left rear|rear left)\b/.test(t))position='rear_left';
  let role:string|null=null;
  if(master&&(position==='front_right'||hasPhrase(t,'driver')||hasPhrase(t,'driver master')))role='driver_master';
  else if(master)role='master';
  else if(position)role=position;
  else if(family==='center_console_switch')role='console';
  else if(family==='combination_switch'||family==='wiper_switch'||family==='headlight_switch')role='stalk';
  const tokens=[family,subtype,role,position].filter(Boolean) as string[];
  return {family,subtype,role,position,master,tokens:[...new Set(tokens)]};
}

export function listingShape(listing:any,obs:any){
  const m=metadata(listing);const concise=compactText(listing,obs);const full=evidenceText(listing,obs);const vehicle=String(obs?.vehicle||m.vehicle||'');
  const identity=inferPartIdentity(full,obs?.part_type||m.part_type||listing?.title);
  return {make:inferMake(vehicle)||inferMake(concise),model:inferModel(vehicle)||inferModel(concise),chassis:normalizeChassis(obs?.chassis||m.chassis||inferChassis(concise)),partFamily:identity.family,years:String(obs?.years||m.years||'')||null,concise,full,identity};
}

function tfVector(text:string){
  const stop=new Set(['for','the','a','an','and','or','with','suitable','fits','fit','used','new','jdm','rhd','right','hand','controller','button','toyota']);
  const out=new Map<string,number>();for(const w of words(text)){if(w.length<2||stop.has(w))continue;out.set(w,(out.get(w)||0)+1)}return out;
}
export function cosineSimilarity(a:string,b:string){const x=tfVector(a),y=tfVector(b);if(!x.size||!y.size)return 0;let dot=0,xx=0,yy=0;for(const v of x.values())xx+=v*v;for(const v of y.values())yy+=v*v;for(const [k,v] of x)dot+=v*(y.get(k)||0);return xx&&yy?dot/(Math.sqrt(xx)*Math.sqrt(yy)):0}
function partNumbers(obs:any){
  const vals=[obs?.part_number,...normalizeCandidateArray(obs?.part_number_candidates)].filter(Boolean).map((x:any)=>norm(x).replace(/\s/g,''));
  return new Set(vals.filter((x:string)=>x.length>=5));
}
function productPartTokens(product:any){const matches=String(product?.display_name||'').match(/\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gi)||[];return new Set(matches.map((x:string)=>norm(x).replace(/\s/g,'')))}
function conflictKnownMake(product:any,shape:any){return Boolean(product?.vehicle_make&&shape.make&&norm(product.vehicle_make)!==norm(shape.make))}
function conflictKnownModel(product:any,shape:any){return Boolean(product?.vehicle_model&&shape.model&&productModelCanonical(product.vehicle_model)!==shape.model)}
function chassisEvidence(product:any,shape:any){const expected=norm(normalizeChassis(product?.chassis)).replace(/\s/g,'');if(!expected)return {match:false,known:false};const full=norm(shape.full).replace(/\s/g,'');return {match:full.includes(expected),known:Boolean(shape.chassis)}}
function observationPrice(obs:any){const n=obs?.buy_now_nzd??obs?.asking_price_nzd??obs?.current_bid_nzd??null;const x=Number(n);return Number.isFinite(x)&&x>0?x:null}
function priceCompatibility(price:number|null,medianPrice:number|null|undefined){
  if(!price||!medianPrice||medianPrice<=0)return null;
  const distance=Math.abs(Math.log(price/medianPrice));
  return clamp01(Math.exp(-1.7*distance));
}
function identityCompatibility(productIdentity:PartIdentity,listingIdentity:PartIdentity){
  const sameFamily=Boolean(productIdentity.family&&listingIdentity.family&&productIdentity.family===listingIdentity.family);
  const subtypeKnown=Boolean(productIdentity.subtype&&listingIdentity.subtype);
  const subtypeMatch=subtypeKnown&&productIdentity.subtype===listingIdentity.subtype;
  const subtypeConflict=subtypeKnown&&!subtypeMatch;
  const roleKnown=Boolean(productIdentity.role&&listingIdentity.role);
  const roleMatch=roleKnown&&productIdentity.role===listingIdentity.role;
  const roleConflict=roleKnown&&!roleMatch;
  return {sameFamily,subtypeKnown,subtypeMatch,subtypeConflict,roleKnown,roleMatch,roleConflict};
}

export function compareListingToProduct(product:any,listing:any,obs:any,ctx:MatchContext={}):ComparableScore{
  const shape=listingShape(listing,obs);
  const persisted=product?.comparable_identity&&typeof product.comparable_identity==='object'?product.comparable_identity:null;
  const productIdentity:PartIdentity=ctx.productIdentity||persisted||inferPartIdentity(`${product?.display_name||''} ${product?.part_type||''}`,product?.part_type);
  const pFamily=productIdentity.family||normalizePartFamily(product?.part_type||product?.display_name);
  const reasons:string[]=[];
  const blocker=[norm(product?.vehicle_make),productModelCanonical(product?.vehicle_model),norm(product?.chassis),pFamily,productIdentity.subtype,productIdentity.role].filter(Boolean).join('|');
  const emptyComponents:MatchComponents={fitment:0,subtype:0,role:0,partNumber:null,text:0,price:null};
  const reject=(reason:string):ComparableScore=>({decision:'REJECT',score:0,cosine:0,priceCompatibility:null,reasons:[reason],blocker,components:emptyComponents,identity:{product:productIdentity,listing:shape.identity},shape:{make:shape.make?cap(shape.make):null,model:shape.model?cap(shape.model):null,chassis:shape.chassis,partFamily:shape.partFamily,years:shape.years}});

  if(pFamily&&shape.partFamily&&pFamily!==shape.partFamily)return reject(`part family conflicts (${shape.partFamily} vs ${pFamily})`);
  const identity=identityCompatibility(productIdentity,shape.identity);
  // Subtype is a domain-critical identity boundary. A single door switch is not a master switch.
  if(identity.subtypeConflict)return reject(`part subtype conflicts (${shape.identity.subtype} vs ${productIdentity.subtype})`);
  const chassis=chassisEvidence(product,shape);const expectedModel=productModelCanonical(product?.vehicle_model);
  const fullHasExpectedModel=Boolean(expectedModel&&(shape.model===expectedModel||MODEL_ALIASES[expectedModel]?.some(a=>hasPhrase(shape.full,a))));
  const fullHasExpectedMake=Boolean(product?.vehicle_make&&hasPhrase(shape.full,product.vehicle_make));
  if(conflictKnownMake(product,shape)&&!fullHasExpectedMake&&!chassis.match)return reject('vehicle make conflicts');
  if(conflictKnownModel(product,shape)&&!fullHasExpectedModel&&!chassis.match)return reject('vehicle model conflicts');

  const productDoc=[product?.vehicle_make,product?.vehicle_model,product?.chassis,product?.part_type,product?.display_name,productIdentity.subtype,productIdentity.role].filter(Boolean).join(' ');
  const cosine=cosineSimilarity(productDoc,shape.concise);
  let score=0;

  if(identity.sameFamily){score+=.24;reasons.push('same normalized part family')}
  if(identity.subtypeMatch){score+=.22;reasons.push(`same part subtype: ${productIdentity.subtype}`)}
  else if(!productIdentity.subtype||!shape.identity.subtype){score+=.05;reasons.push('part subtype incomplete')}
  if(identity.roleMatch){score+=.09;reasons.push(`same part role: ${productIdentity.role}`)}
  else if(identity.roleConflict){score-=.10;reasons.push(`part role conflicts (${shape.identity.role} vs ${productIdentity.role})`)}
  else if(productIdentity.role||shape.identity.role){score+=.01;reasons.push('part role only partially known')}

  const makeMatch=Boolean(product?.vehicle_make&&(shape.make===norm(product.vehicle_make)||hasPhrase(shape.full,product.vehicle_make)));
  const pModel=productModelCanonical(product?.vehicle_model);
  const modelMatch=Boolean(pModel&&(shape.model===pModel||MODEL_ALIASES[pModel]?.some(a=>hasPhrase(shape.full,a))));
  if(makeMatch){score+=.07;reasons.push('same vehicle make')}
  if(modelMatch){score+=.13;reasons.push('same vehicle model')}
  if(chassis.match){score+=.15;reasons.push('same chassis / fitment code')}

  const pNums=productPartTokens(product),lNums=partNumbers(obs);const overlap=[...pNums].filter(x=>lNums.has(x));
  let partNumberComponent:number|null=null;
  if(overlap.length){score+=.08;partNumberComponent=1;reasons.push(`part/reference code overlaps: ${overlap.slice(0,2).join(', ')}`)}
  else if(pNums.size&&lNums.size){partNumberComponent=.15;score-=.04;reasons.push('known part/reference codes do not overlap')}

  const pr=yearRange(product?.years),lr=yearRange(shape.years);const yr=rangesOverlap(pr,lr);
  if(yr===true){score+=.03;reasons.push('year ranges overlap')}else if(yr===false){score-=.06;reasons.push('year ranges conflict')}

  score+=Math.min(.12,cosine*.12);if(cosine>=.35)reasons.push(`title/field cosine ${cosine.toFixed(2)}`);
  const pc=priceCompatibility(observationPrice(obs),ctx.marketMedianPrice);
  if(pc!=null){
    if(pc>=.72){score+=.03;reasons.push(`price compatible with accepted market (${pc.toFixed(2)})`)}
    else if(pc<.35){score-=.06;reasons.push(`price is an outlier vs accepted market (${pc.toFixed(2)})`)}
    else if(pc<.52){score-=.03;reasons.push(`price weakly compatible with accepted market (${pc.toFixed(2)})`)}
  }

  const fitmentComponent=clamp01((makeMatch ? .20 : 0)+(modelMatch ? .35 : 0)+(chassis.match ? .45 : 0));
  const subtypeComponent=identity.subtypeMatch?1:identity.subtypeKnown?0:.45;
  const roleComponent=identity.roleMatch ? 1 : identity.roleConflict ? 0 : (productIdentity.role||shape.identity.role) ? .45 : .65;
  const components:MatchComponents={fitment:fitmentComponent,subtype:subtypeComponent,role:roleComponent,partNumber:partNumberComponent,text:cosine,price:pc};

  // Auto-link requires structured identity agreement. Text and price never create identity by themselves.
  const critical=Boolean(identity.sameFamily&&identity.subtypeMatch&&(modelMatch||chassis.match));
  const final=clamp01(score);
  const decision:ComparableDecision=critical&&final>=.70?'AUTO_LINK':critical&&final>=.56?'REVIEW':'REJECT';
  return {decision,score:Number(final.toFixed(4)),cosine:Number(cosine.toFixed(4)),priceCompatibility:pc==null?null:Number(pc.toFixed(4)),reasons,blocker,components,identity:{product:productIdentity,listing:shape.identity},shape:{make:shape.make?cap(shape.make):null,model:shape.model?cap(shape.model):null,chassis:shape.chassis,partFamily:shape.partFamily,years:shape.years}};
}

async function latestObservation(db:any,listingId:string){const {data}=await db.from('observations').select('*').eq('listing_uuid',listingId).order('captured_at',{ascending:false}).limit(1).maybeSingle();return data||null}
function median(values:number[]){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
async function buildProductContext(db:any,product:any):Promise<MatchContext>{
  let productIdentity:PartIdentity|null=null;
  if(product?.source_listing_uuid){
    const {data:sourceListing}=await db.from('listings').select('*').eq('id',product.source_listing_uuid).maybeSingle();
    if(sourceListing){const sourceObs=await latestObservation(db,sourceListing.id);if(sourceObs)productIdentity=listingShape(sourceListing,sourceObs).identity}
  }
  if(!productIdentity&&product?.comparable_identity&&typeof product.comparable_identity==='object')productIdentity=product.comparable_identity;
  if(!productIdentity)productIdentity=inferPartIdentity(`${product?.display_name||''} ${product?.part_type||''}`,product?.part_type);
  if(product?.id&&JSON.stringify(product?.comparable_identity||{})!==JSON.stringify(productIdentity)){
    try{await db.from('products').update({comparable_identity:productIdentity}).eq('id',product.id)}catch{}
  }
  const {data:links}=await db.from('product_listings').select('listing_uuid').eq('product_id',product.id).eq('role','competitor');
  const ids=(links||[]).map((x:any)=>x.listing_uuid).filter(Boolean);const prices:number[]=[];
  if(ids.length){
    const {data:rows}=await db.from('observations').select('listing_uuid,captured_at,buy_now_nzd,asking_price_nzd,current_bid_nzd').in('listing_uuid',ids).order('captured_at',{ascending:false}).limit(Math.max(100,ids.length*5));
    const seen=new Set<string>();for(const o of rows||[]){if(seen.has(o.listing_uuid))continue;seen.add(o.listing_uuid);const p=observationPrice(o);if(p)prices.push(p)}
  }
  return {productIdentity,marketMedianPrice:median(prices),sourceListingId:product?.source_listing_uuid||null};
}

async function traceMatch(db:any,source:string,product:any,listing:any,m:ComparableScore){
  const stamp=new Date().toISOString();
  console.log(`[COBALT MATCH ${stamp}] ${source} | ${listing?.marketplace||'market'} #${listing?.listing_id||'?'} | ${m.decision} | score ${(m.score*100).toFixed(1)}% | cosine ${(m.cosine*100).toFixed(1)}% | ${product?.display_name||product?.part_type||product?.id}`);
  console.log(`  fitment ${(m.components.fitment*100).toFixed(0)}% · subtype ${(m.components.subtype*100).toFixed(0)}% · role ${(m.components.role*100).toFixed(0)}% · part ${m.components.partNumber==null?'—':`${(m.components.partNumber*100).toFixed(0)}%`} · text ${(m.components.text*100).toFixed(0)}% · price ${m.components.price==null?'—':`${(m.components.price*100).toFixed(0)}%`}`);
  console.log(`  reasons: ${m.reasons.join(' · ')||'none'}`);
  try{await db.from('matcher_debug_events').insert({source,matcher_version:MATCHER_VERSION,product_id:product?.id||null,product_name:product?.display_name||product?.part_type||null,listing_uuid:listing?.id||null,marketplace:listing?.marketplace||null,marketplace_listing_id:listing?.listing_id||null,listing_title:listing?.title||null,decision:m.decision,score:m.score,cosine:m.cosine,price_compatibility:m.priceCompatibility,reasons:m.reasons,shape:m.shape,components:m.components,identity:m.identity})}catch(e:any){console.warn('[COBALT MATCH] debug persistence unavailable:',e?.message||e)}
}

async function candidateProducts(db:any,listing:any,obs:any){
  const shape=listingShape(listing,obs);if(!shape.partFamily)return [];
  let q=db.from('products').select('*').is('archived_at',null).limit(200);
  if(shape.chassis)q=q.eq('chassis',shape.chassis);else if(shape.make&&shape.model)q=q.ilike('vehicle_make',shape.make).ilike('vehicle_model',shape.model);else return [];
  const {data}=await q;return data||[];
}
async function manualOverride(db:any,productId:string,listingId:string){const {data}=await db.from('product_match_candidates').select('manual_override').eq('product_id',productId).eq('listing_uuid',listingId).maybeSingle();return data?.manual_override||null}
async function unlinkAutomatic(db:any,product:any,listing:any){
  const {data:link}=await db.from('product_listings').select('match_method').eq('product_id',product.id).eq('listing_uuid',listing.id).maybeSingle();
  if(link&&String(link.match_method||'').startsWith('hybrid-')){
    await db.from('product_listings').delete().eq('product_id',product.id).eq('listing_uuid',listing.id);
    await db.from('listings').update({product_id:null}).eq('id',listing.id).eq('product_id',product.id);
  }
}
async function persistDecision(db:any,product:any,listing:any,m:ComparableScore){
  const override=await manualOverride(db,product.id,listing.id);
  const reason={reasons:m.reasons,cosine:m.cosine,priceCompatibility:m.priceCompatibility,shape:m.shape,components:m.components,identity:m.identity};
  if(override==='reject'){await unlinkAutomatic(db,product,listing);return 'manual_rejected'}
  if(override==='accept')return 'manual_accepted';
  if(m.decision==='AUTO_LINK'){
    await db.from('product_listings').upsert({product_id:product.id,listing_uuid:listing.id,role:'competitor',match_score:m.score,match_method:MATCHER_VERSION,match_reason:reason},{onConflict:'product_id,listing_uuid'});
    if(!listing.product_id)await db.from('listings').update({product_id:product.id}).eq('id',listing.id).is('product_id',null);
    await db.from('product_match_candidates').upsert({product_id:product.id,listing_uuid:listing.id,score:m.score,status:'auto_linked',method:MATCHER_VERSION,reason,updated_at:new Date().toISOString()},{onConflict:'product_id,listing_uuid'});
    return 'auto_linked';
  }
  await unlinkAutomatic(db,product,listing);
  await db.from('product_match_candidates').upsert({product_id:product.id,listing_uuid:listing.id,score:m.score,status:m.decision==='REVIEW'?'review':'rejected',method:MATCHER_VERSION,reason,updated_at:new Date().toISOString()},{onConflict:'product_id,listing_uuid'});
  return m.decision==='REVIEW'?'review':'rejected';
}

export async function matchListingIncrementally(db:any,listing:any,obs:any){
  if(!listing?.id||metadata(listing)?.ownership==='own')return {autoLinked:0,review:0,rejected:0};
  const products=await candidateProducts(db,listing,obs);let autoLinked=0,review=0,rejected=0;
  for(const product of products){const ctx=await buildProductContext(db,product);const m=compareListingToProduct(product,listing,obs,ctx);await traceMatch(db,'incremental',product,listing,m);const result=await persistDecision(db,product,listing,m);if(result==='auto_linked')autoLinked++;else if(result==='review')review++;else if(result==='rejected'||result==='manual_rejected')rejected++}
  return {autoLinked,review,rejected};
}

export async function reconcileProduct(db:any,product:any){
  const observationRows:any[]=[];
  if(product?.chassis){const {data}=await db.from('observations').select('*').eq('chassis',normalizeChassis(product.chassis)).order('captured_at',{ascending:false}).limit(5000);observationRows.push(...(data||[]))}
  if(product?.vehicle_make&&product?.vehicle_model){const vehicleNeedle=`%${String(product.vehicle_make).trim()}%${String(product.vehicle_model).trim()}%`;const {data}=await db.from('observations').select('*').ilike('vehicle',vehicleNeedle).order('captured_at',{ascending:false}).limit(5000);observationRows.push(...(data||[]))}
  const latest=new Map<string,any>();for(const o of observationRows){const old=latest.get(o.listing_uuid);if(!old||Date.parse(o.captured_at)>Date.parse(old.captured_at))latest.set(o.listing_uuid,o)}
  const ids=[...latest.keys()];if(!ids.length)return {scanned:0,autoLinked:0,review:0,rejected:0};
  const {data:listings}=await db.from('listings').select('*').in('id',ids).eq('active',true);const ctx=await buildProductContext(db,product);
  let autoLinked=0,review=0,rejected=0,scanned=0;
  for(const listing of listings||[]){if(metadata(listing)?.ownership==='own')continue;const obs=latest.get(listing.id);if(!obs)continue;scanned++;const m=compareListingToProduct(product,listing,obs,ctx);await traceMatch(db,'reconcile',product,listing,m);const result=await persistDecision(db,product,listing,m);if(result==='auto_linked')autoLinked++;else if(result==='review')review++;else rejected++}
  return {scanned,autoLinked,review,rejected};
}
