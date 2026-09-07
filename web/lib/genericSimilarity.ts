/**
 * Category-agnostic similarity primitives for COBALT.
 *
 * This module intentionally knows nothing about vehicles, toys, watches, kitchenware, etc.
 * It works from marketplace category paths, product-facing metadata and listing text so the
 * same admission/suppression machinery can be reused as COBALT expands into new verticals.
 */

const GENERIC_STOP_WORDS=new Set([
  'a','an','and','are','as','at','be','by','for','from','in','into','is','it','of','on','or','the','to','with',
  'new','used','sale','buy','now','free','shipping','genuine','quality','replacement','compatible','fits','fit'
]);

export function normalizeText(value:any){
  return String(value??'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
}
export function textTokens(value:any){
  return normalizeText(value).split(/\s+/).filter(Boolean).filter(x=>(x.length>1||/^\d$/.test(x))&&!GENERIC_STOP_WORDS.has(x));
}
function objectValue(value:any):string{
  if(value==null)return '';
  if(Array.isArray(value))return value.map(objectValue).join(' ');
  if(typeof value==='object')return Object.entries(value).filter(([k])=>!/(token|secret|url|image|seller|location|capture|source|timestamp|date|error)/i.test(k)).map(([,v])=>objectValue(v)).join(' ');
  if(['string','number'].includes(typeof value))return String(value);
  return '';
}
export function categoryPathOf(listing:any){
  const md=listing?.metadata&&typeof listing.metadata==='object'?listing.metadata:{};
  const raw=md.category_path??md.breadcrumbs??listing?.category_path??[];
  const vals=Array.isArray(raw)?raw:String(raw||'').split(/[>/|]/);
  return vals.map(normalizeText).filter(Boolean);
}
export function listingDocument(listing:any,extra:any={}){
  const md=listing?.metadata&&typeof listing.metadata==='object'?listing.metadata:{};
  const productMetadata={
    category:md.category,product_type:md.product_type,product_family:md.product_family,brand:md.brand,make:md.make,
    model:md.model,series:md.series,variant:md.variant,part_type:md.part_type,material:md.material,size:md.size,
    colour:md.colour,color:md.color,attributes:md.attributes,specs:md.specs,identity:md.identity
  };
  return [listing?.title,categoryPathOf(listing).join(' '),objectValue(productMetadata),objectValue(extra)].filter(Boolean).join(' ');
}
export function codeTokens(value:any){
  const out=new Set<string>();
  for(const raw of String(value??'').match(/\b[A-Za-z0-9][A-Za-z0-9._-]{3,}\b/g)||[]){
    const t=normalizeText(raw).replace(/\s+/g,'');
    if(t.length>=4&&/[a-z]/.test(t)&&/\d/.test(t))out.add(t);
  }
  return out;
}
function jaccard(a:Set<string>,b:Set<string>){
  if(!a.size||!b.size)return 0;
  let overlap=0;for(const x of a)if(b.has(x))overlap++;
  return overlap/(a.size+b.size-overlap);
}
function categorySimilarity(a:string[],b:string[]){
  if(!a.length||!b.length)return 0;
  let prefix=0;while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
  const jac=jaccard(new Set(a),new Set(b));
  return Math.max(jac,prefix/Math.max(a.length,b.length));
}
export function buildIdf(documents:string[]){
  const df=new Map<string,number>();const docs=documents.map(d=>new Set(textTokens(d)));
  for(const set of docs)for(const t of set)df.set(t,(df.get(t)||0)+1);
  const n=Math.max(1,docs.length);const idf=new Map<string,number>();
  for(const [t,c] of df)idf.set(t,Math.log((n+1)/(c+1))+1);
  return idf;
}
export function tfidfCosine(a:string,b:string,idf?:Map<string,number>){
  const aa=textTokens(a),bb=textTokens(b);if(!aa.length||!bb.length)return 0;
  const weights=idf||buildIdf([a,b]);
  const vector=(xs:string[])=>{const tf=new Map<string,number>();for(const t of xs)tf.set(t,(tf.get(t)||0)+1);const out=new Map<string,number>();for(const [t,c] of tf)out.set(t,c*(weights.get(t)||1));return out};
  const x=vector(aa),y=vector(bb);let dot=0,xx=0,yy=0;
  for(const v of x.values())xx+=v*v;for(const v of y.values())yy+=v*v;for(const [k,v] of x)dot+=v*(y.get(k)||0);
  return xx&&yy?dot/(Math.sqrt(xx)*Math.sqrt(yy)):0;
}
export type GenericSimilarity={score:number;cosine:number;tokenOverlap:number;category:number;identifierOverlap:boolean;reasons:string[]};
export function genericListingSimilarity(a:any,b:any,idf?:Map<string,number>,extraA:any={},extraB:any={}):GenericSimilarity{
  const ad=listingDocument(a,extraA),bd=listingDocument(b,extraB);
  const cosine=tfidfCosine(ad,bd,idf);const tokenOverlap=jaccard(new Set(textTokens(ad)),new Set(textTokens(bd)));
  const category=categorySimilarity(categoryPathOf(a),categoryPathOf(b));
  const ac=codeTokens(ad),bc=codeTokens(bd);let identifierOverlap=false;for(const x of ac)if(bc.has(x)){identifierOverlap=true;break}
  let score=.68*cosine+.20*tokenOverlap+.12*category;
  if(identifierOverlap)score=Math.min(1,score+.12);
  const reasons:string[]=[];
  if(cosine>=.55)reasons.push(`semantic text ${(cosine*100).toFixed(0)}%`);
  if(tokenOverlap>=.35)reasons.push(`token overlap ${(tokenOverlap*100).toFixed(0)}%`);
  if(category>=.5)reasons.push(`category overlap ${(category*100).toFixed(0)}%`);
  if(identifierOverlap)reasons.push('shared model/reference identifier');
  return {score:Number(score.toFixed(4)),cosine:Number(cosine.toFixed(4)),tokenOverlap:Number(tokenOverlap.toFixed(4)),category:Number(category.toFixed(4)),identifierOverlap,reasons};
}
export function isStrongGenericMatch(m:GenericSimilarity){
  // Conservative admission gate: similarity may suppress future work only when there is
  // strong textual identity plus category/identifier support. No vertical-specific rules.
  return Boolean((m.score>=.70&&m.cosine>=.62&&(m.category>=.35||m.identifierOverlap))||(m.cosine>=.86&&m.tokenOverlap>=.55));
}
