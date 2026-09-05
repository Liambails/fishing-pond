/*
 * COBALT comparable-product matcher.
 *
 * Design: structured blocking + deterministic domain features + cosine text
 * similarity. Cosine is intentionally a supporting signal rather than the sole
 * decision maker: automotive titles can be semantically similar while referring
 * to different parts or fitments.
 */

export type ComparableDecision='AUTO_LINK'|'REVIEW'|'REJECT';
export type ComparableScore={
  decision:ComparableDecision;
  score:number;
  cosine:number;
  reasons:string[];
  blocker:string;
  shape:{make:string|null;model:string|null;chassis:string|null;partFamily:string|null;years:string|null};
};

const norm=(v:any)=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const words=(v:any)=>norm(v).split(/\s+/).filter(Boolean);
const hasPhrase=(text:string,phrase:string)=>` ${norm(text)} `.includes(` ${norm(phrase)} `);
const cap=(v:string)=>v?`${v[0].toUpperCase()}${v.slice(1)}`:v;

const MAKES=['toyota','mazda','suzuki','honda','nissan','mitsubishi','subaru','ford','holden','hyundai','kia','bmw','audi','volkswagen','lexus'];
const MODEL_ALIASES:Record<string,string[]>= {
  aqua:['aqua','prius c'],
  prius:['prius'],
  corolla:['corolla'],
  yaris:['yaris'],
  vitz:['vitz'],
  camry:['camry'],
  wish:['wish'],
  swift:['swift'],
  axela:['axela','mazda 3','mazda3'],
  demio:['demio','mazda 2','mazda2'],
  fit:['fit','jazz'],
};

export function normalizePartFamily(value:any){
  const t=norm(value);
  if(!t)return null;
  if((t.includes('master')&&t.includes('window'))||(t.includes('main')&&t.includes('window')))return 'window_master_switch';
  if(t.includes('window')&&t.includes('switch'))return 'window_switch';
  if(t.includes('combination')&&t.includes('switch'))return 'combination_switch';
  if(t.includes('wiper')&&t.includes('switch'))return 'wiper_switch';
  if(t.includes('headlight')&&t.includes('switch'))return 'headlight_switch';
  if(t.includes('ignition'))return 'ignition_switch';
  if((t.includes('seatbelt')||t.includes('seat belt')))return 'seat_belt';
  if(t.includes('console')&&t.includes('switch'))return 'center_console_switch';
  return t.replace(/\s+/g,'_');
}

function rawDescription(obs:any){
  const r=obs?.raw_snapshot;
  if(!r)return '';
  if(typeof r==='string'){try{return String(JSON.parse(r)?.description||'')}catch{return ''}}
  return String(r.description||'');
}
function metadata(listing:any){
  const m=listing?.metadata;
  if(!m)return {};
  if(typeof m==='string'){try{return JSON.parse(m)}catch{return {}}}
  return m;
}
function compactText(listing:any,obs:any){
  const m=metadata(listing);
  return [listing?.title,obs?.vehicle,m.vehicle,obs?.chassis,m.chassis,obs?.years,obs?.part_type,m.part_type,obs?.part_number,...(Array.isArray(obs?.part_number_candidates)?obs.part_number_candidates:[])].filter(Boolean).join(' ');
}
function evidenceText(listing:any,obs:any){return `${compactText(listing,obs)} ${rawDescription(obs)}`}

function inferMake(text:string){const t=norm(text);return MAKES.find(x=>hasPhrase(t,x))||null}
function inferModel(text:string){const t=norm(text);for(const [canonical,aliases] of Object.entries(MODEL_ALIASES)){if(aliases.some(a=>hasPhrase(t,a)))return canonical}return null}
function inferChassis(text:string){
  const m=String(text||'').toUpperCase().match(/\b[A-Z]{1,4}\d{2,3}\b/g)||[];
  return m[0]||null;
}
function normalizeChassis(value:any){return inferChassis(String(value||''))||String(value||'').trim().toUpperCase()||null}

function yearRange(v:any):[number,number]|null{
  const nums=String(v||'').match(/\b(?:19|20)\d{2}\b/g)?.map(Number)||[];
  if(!nums.length)return null; return [Math.min(...nums),Math.max(...nums)];
}
function rangesOverlap(a:[number,number]|null,b:[number,number]|null){return !a||!b?null:Math.max(a[0],b[0])<=Math.min(a[1],b[1])}
function productModelCanonical(v:any){const n=norm(v);for(const [k,a] of Object.entries(MODEL_ALIASES)){if(n===k||a.map(norm).includes(n))return k}return n||null}

export function listingShape(listing:any,obs:any){
  const m=metadata(listing); const concise=compactText(listing,obs); const full=evidenceText(listing,obs);
  const vehicle=String(obs?.vehicle||m.vehicle||'');
  return {
    make:inferMake(vehicle)||inferMake(concise),
    model:inferModel(vehicle)||inferModel(concise),
    chassis:normalizeChassis(obs?.chassis||m.chassis||inferChassis(concise)),
    partFamily:normalizePartFamily(obs?.part_type||m.part_type||listing?.title),
    years:String(obs?.years||m.years||'' )||null,
    concise,full
  };
}

function tfVector(text:string){
  const stop=new Set(['for','the','a','an','and','or','with','suitable','fits','fit','used','new','jdm','rhd','right','hand','driver','controller','button','toyota']);
  const out=new Map<string,number>();
  for(const w of words(text)){if(w.length<2||stop.has(w))continue;out.set(w,(out.get(w)||0)+1)}
  return out;
}
export function cosineSimilarity(a:string,b:string){
  const x=tfVector(a),y=tfVector(b); if(!x.size||!y.size)return 0;
  let dot=0,xx=0,yy=0; for(const v of x.values())xx+=v*v;for(const v of y.values())yy+=v*v;
  for(const [k,v] of x){dot+=v*(y.get(k)||0)}
  return xx&&yy?dot/(Math.sqrt(xx)*Math.sqrt(yy)):0;
}
function partNumbers(obs:any){
  const vals=[obs?.part_number,...(Array.isArray(obs?.part_number_candidates)?obs.part_number_candidates:[])].filter(Boolean).map((x:any)=>norm(x).replace(/\s/g,''));
  return new Set(vals.filter((x:string)=>x.length>=5));
}
function productPartTokens(product:any){
  // Product titles occasionally contain a supplier/material code; it is a bonus only, never a gate.
  const matches=String(product?.display_name||'').match(/\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gi)||[];
  return new Set(matches.map((x:string)=>norm(x).replace(/\s/g,'')));
}
function conflictKnownMake(product:any,shape:any){return Boolean(product?.vehicle_make&&shape.make&&norm(product.vehicle_make)!==norm(shape.make))}
function conflictKnownModel(product:any,shape:any){return Boolean(product?.vehicle_model&&shape.model&&productModelCanonical(product.vehicle_model)!==shape.model)}
function chassisEvidence(product:any,shape:any){
  const expected=norm(normalizeChassis(product?.chassis)).replace(/\s/g,''); if(!expected)return {match:false,known:false};
  const full=norm(shape.full).replace(/\s/g,''); return {match:full.includes(expected),known:Boolean(shape.chassis)};
}

export function compareListingToProduct(product:any,listing:any,obs:any):ComparableScore{
  const shape=listingShape(listing,obs);
  const pFamily=normalizePartFamily(product?.part_type||product?.display_name);
  const reasons:string[]=[];
  const blocker=[norm(product?.vehicle_make),productModelCanonical(product?.vehicle_model),norm(product?.chassis),pFamily].filter(Boolean).join('|');

  if(pFamily&&shape.partFamily&&pFamily!==shape.partFamily)return {decision:'REJECT',score:0,cosine:0,reasons:[`part family conflicts (${shape.partFamily} vs ${pFamily})`],blocker,shape};
  const chassis=chassisEvidence(product,shape);
  const expectedModel=productModelCanonical(product?.vehicle_model);
  const fullHasExpectedModel=Boolean(expectedModel&&(shape.model===expectedModel||MODEL_ALIASES[expectedModel]?.some(a=>hasPhrase(shape.full,a))));
  const fullHasExpectedMake=Boolean(product?.vehicle_make&&hasPhrase(shape.full,product.vehicle_make));
  // Multi-fit aftermarket listings often put another compatible vehicle in the title. A conflicting
  // concise-title model is therefore not fatal when the expected model/chassis is explicitly present
  // elsewhere in the collected fitment evidence.
  if(conflictKnownMake(product,shape)&&!fullHasExpectedMake&&!chassis.match)return {decision:'REJECT',score:0,cosine:0,reasons:['vehicle make conflicts'],blocker,shape};
  if(conflictKnownModel(product,shape)&&!fullHasExpectedModel&&!chassis.match)return {decision:'REJECT',score:0,cosine:0,reasons:['vehicle model conflicts'],blocker,shape};

  const productDoc=[product?.vehicle_make,product?.vehicle_model,product?.chassis,product?.part_type,product?.display_name].filter(Boolean).join(' ');
  const cosine=cosineSimilarity(productDoc,shape.concise);
  let score=0;

  if(pFamily&&shape.partFamily===pFamily){score+=.38;reasons.push('same normalized part family')}
  const makeMatch=Boolean(product?.vehicle_make&&(shape.make===norm(product.vehicle_make)||hasPhrase(shape.full,product.vehicle_make)));
  if(makeMatch){score+=.08;reasons.push('same vehicle make')}
  const pModel=productModelCanonical(product?.vehicle_model);
  const modelMatch=Boolean(pModel&&(shape.model===pModel||MODEL_ALIASES[pModel]?.some(a=>hasPhrase(shape.full,a))));
  if(modelMatch){score+=.16;reasons.push('same vehicle model')}
  if(chassis.match){score+=.18;reasons.push('same chassis / fitment code')}

  const pNums=productPartTokens(product),lNums=partNumbers(obs); const overlap=[...pNums].filter(x=>lNums.has(x));
  if(overlap.length){score+=.08;reasons.push(`part/reference code overlaps: ${overlap.slice(0,2).join(', ')}`)}

  const pr=yearRange(product?.years),lr=yearRange(shape.years); const yr=rangesOverlap(pr,lr);
  if(yr===true){score+=.04;reasons.push('year ranges overlap')}
  else if(yr===false){score-=.06;reasons.push('year ranges conflict')}

  score+=Math.min(.16,cosine*.16); if(cosine>=.45)reasons.push(`title/field cosine ${cosine.toFixed(2)}`);

  // Auto-link only when the domain-critical identity is present. Text similarity alone cannot create a market peer.
  const critical=Boolean(pFamily&&shape.partFamily===pFamily&&(modelMatch||chassis.match));
  const final=Math.max(0,Math.min(1,score));
  const decision:ComparableDecision=critical&&final>=.70?'AUTO_LINK':critical&&final>=.58?'REVIEW':'REJECT';
  return {decision,score:Number(final.toFixed(4)),cosine:Number(cosine.toFixed(4)),reasons,blocker,shape:{make:shape.make?cap(shape.make):null,model:shape.model?cap(shape.model):null,chassis:shape.chassis,partFamily:shape.partFamily,years:shape.years}};
}

async function latestObservation(db:any,listingId:string){
  const {data}=await db.from('observations').select('*').eq('listing_uuid',listingId).order('captured_at',{ascending:false}).limit(1).maybeSingle(); return data||null;
}

async function candidateProducts(db:any,listing:any,obs:any){
  const shape=listingShape(listing,obs);
  if(!shape.partFamily)return [];
  let q=db.from('products').select('*').is('archived_at',null).limit(200);
  // Database blocking: chassis is strongest; vehicle pair is the fallback. This avoids all-vs-all comparisons as COBALT grows.
  if(shape.chassis)q=q.eq('chassis',shape.chassis);
  else if(shape.make&&shape.model)q=q.ilike('vehicle_make',shape.make).ilike('vehicle_model',shape.model);
  else return [];
  const {data}=await q; return data||[];
}

export async function matchListingIncrementally(db:any,listing:any,obs:any){
  if(!listing?.id||listing?.metadata?.ownership==='own')return {autoLinked:0,review:0};
  const products=await candidateProducts(db,listing,obs); let autoLinked=0,review=0;
  for(const product of products){
    const m=compareListingToProduct(product,listing,obs);
    if(m.decision==='AUTO_LINK'){
      await db.from('product_listings').upsert({product_id:product.id,listing_uuid:listing.id,role:'competitor',match_score:m.score,match_method:'hybrid-v1',match_reason:{reasons:m.reasons,cosine:m.cosine,shape:m.shape}},{onConflict:'product_id,listing_uuid'});
      if(!listing.product_id)await db.from('listings').update({product_id:product.id}).eq('id',listing.id).is('product_id',null);
      await db.from('product_match_candidates').upsert({product_id:product.id,listing_uuid:listing.id,score:m.score,status:'auto_linked',method:'hybrid-v1',reason:{reasons:m.reasons,cosine:m.cosine,shape:m.shape},updated_at:new Date().toISOString()},{onConflict:'product_id,listing_uuid'});
      autoLinked++;
    }else if(m.decision==='REVIEW'){
      await db.from('product_match_candidates').upsert({product_id:product.id,listing_uuid:listing.id,score:m.score,status:'review',method:'hybrid-v1',reason:{reasons:m.reasons,cosine:m.cosine,shape:m.shape},updated_at:new Date().toISOString()},{onConflict:'product_id,listing_uuid'}); review++;
    }
  }
  return {autoLinked,review};
}

export async function reconcileProduct(db:any,product:any){
  const observationRows:any[]=[];
  // Backfill/reconciliation uses indexed structured evidence first. This prevents an O(products × listings)
  // full comparison when the database becomes large.
  if(product?.chassis){
    const {data}=await db.from('observations').select('*').eq('chassis',normalizeChassis(product.chassis)).order('captured_at',{ascending:false}).limit(5000);
    observationRows.push(...(data||[]));
  }
  if(product?.vehicle_make&&product?.vehicle_model){
    const vehicleNeedle=`%${String(product.vehicle_make).trim()}%${String(product.vehicle_model).trim()}%`;
    const {data}=await db.from('observations').select('*').ilike('vehicle',vehicleNeedle).order('captured_at',{ascending:false}).limit(5000);
    observationRows.push(...(data||[]));
  }
  const latest=new Map<string,any>();
  for(const o of observationRows){const old=latest.get(o.listing_uuid);if(!old||Date.parse(o.captured_at)>Date.parse(old.captured_at))latest.set(o.listing_uuid,o)}
  const ids=[...latest.keys()]; if(!ids.length)return {scanned:0,autoLinked:0,review:0,rejected:0};
  const {data:listings}=await db.from('listings').select('*').in('id',ids).eq('active',true);
  let autoLinked=0,review=0,rejected=0,scanned=0;
  for(const listing of listings||[]){
    if(listing?.metadata?.ownership==='own')continue;
    const obs=latest.get(listing.id); if(!obs)continue; scanned++;
    const m=compareListingToProduct(product,listing,obs);
    if(m.decision==='AUTO_LINK'){
      await db.from('product_listings').upsert({product_id:product.id,listing_uuid:listing.id,role:'competitor',match_score:m.score,match_method:'hybrid-v1',match_reason:{reasons:m.reasons,cosine:m.cosine,shape:m.shape}},{onConflict:'product_id,listing_uuid'});
      if(!listing.product_id)await db.from('listings').update({product_id:product.id}).eq('id',listing.id).is('product_id',null);
      await db.from('product_match_candidates').upsert({product_id:product.id,listing_uuid:listing.id,score:m.score,status:'auto_linked',method:'hybrid-v1',reason:{reasons:m.reasons,cosine:m.cosine,shape:m.shape},updated_at:new Date().toISOString()},{onConflict:'product_id,listing_uuid'});autoLinked++;
    }else if(m.decision==='REVIEW'){
      await db.from('product_match_candidates').upsert({product_id:product.id,listing_uuid:listing.id,score:m.score,status:'review',method:'hybrid-v1',reason:{reasons:m.reasons,cosine:m.cosine,shape:m.shape},updated_at:new Date().toISOString()},{onConflict:'product_id,listing_uuid'});review++;
    }else rejected++;
  }
  return {scanned,autoLinked,review,rejected};
}
