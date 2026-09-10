/**
 * Category-agnostic product-identity similarity primitives for COBALT.
 *
 * V3.10.7 changes the meaning of `score`: it is now a conservative estimate of
 * comparable-product confidence rather than a raw "these titles look alike" score.
 * Broad text/category similarity is still useful for candidate retrieval, but shared
 * distinctive identifiers, discriminative tokens and explicit contradictions decide
 * whether two listings should be trusted as commercial/pricing comparables.
 *
 * Nothing in this module knows about vehicles specifically. The same machinery is
 * intended to work for marketplace model numbers, SKUs, capacities, sizes and variants.
 */

const GENERIC_STOP_WORDS=new Set([
  'a','an','and','are','as','at','be','by','for','from','in','into','is','it','of','on','or','the','to','with',
  'new','used','sale','buy','now','free','shipping','genuine','quality','replacement','compatible','fits','fit',
  'suitable','seller','stock','available','brand','fast','delivery','nz','nzd'
]);

// Side words are useful display/context evidence but normally describe paired variants.
// They should not make an otherwise equivalent product look unrelated. Variant-specific
// differences are handled separately through identifiers and structured attributes.
const PAIR_VARIANT_WORDS=new Set([
  'left','right','lh','rh','lhs','rhs','driver','drivers','passenger','passengers'
]);

export function normalizeText(value:any){
  return String(value??'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
}
export function textTokens(value:any){
  return normalizeText(value).split(/\s+/).filter(Boolean).filter(x=>(x.length>1||/^\d$/.test(x))&&!GENERIC_STOP_WORDS.has(x));
}
function identityTokens(value:any){
  return textTokens(value).filter(x=>!PAIR_VARIANT_WORDS.has(x));
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
function identityDocument(listing:any,extra:any={}){
  const md=listing?.metadata&&typeof listing.metadata==='object'?listing.metadata:{};
  const productMetadata={
    product_type:md.product_type,product_family:md.product_family,brand:md.brand,make:md.make,model:md.model,
    series:md.series,variant:md.variant,part_type:md.part_type,material:md.material,size:md.size,
    colour:md.colour,color:md.color,attributes:md.attributes,specs:md.specs,identity:md.identity
  };
  // Category is deliberately excluded here. It is candidate context, not product identity.
  return [listing?.title,objectValue(productMetadata),objectValue(extra)].filter(Boolean).join(' ');
}

function compactIdentifier(raw:string){return String(raw??'').toLowerCase().normalize('NFKD').replace(/[._]+/g,'-').replace(/[^a-z0-9-]+/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'')}
function isYearLike(raw:string){
  const nums=raw.match(/\d{4}/g)||[];
  return nums.length>0&&nums.every(x=>Number(x)>=1900&&Number(x)<=2099);
}
function identifierNamespace(raw:string){
  const s=String(raw||'').toLowerCase().replace(/[^a-z0-9-]+/g,'');
  const hy=s.split('-').filter(Boolean);
  if(hy.length>=2){
    const first=hy[0];
    if(first.length>=2)return `hy:${first}`;
  }
  const alpha=s.match(/^[a-z]+/i)?.[0]||'';
  if(alpha.length>=1)return `alpha:${alpha}`;
  return '';
}
export function codeTokens(value:any){
  const out=new Set<string>();
  const source=String(value??'');
  const raws=source.match(/\b(?:[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)+|[A-Za-z]{1,8}\d[A-Za-z0-9._-]*)\b/g)||[];
  for(const raw of raws){
    if(isYearLike(raw))continue;
    const t=compactIdentifier(raw);
    if(t.length<3)continue;
    const hasLetter=/[a-z]/.test(t),hasDigit=/\d/.test(t);
    const numericHyphen=/^\d{2,}-\d{2,}$/.test(raw);
    if((hasLetter&&hasDigit)||numericHyphen)out.add(t);
  }
  return out;
}
function identifierEvidence(a:string,b:string){
  const A=codeTokens(a),B=codeTokens(b);
  const shared=[...A].filter(x=>B.has(x));
  const conflicting:string[]=[];
  if(A.size&&B.size){
    for(const x of A){
      const nx=identifierNamespace(x);if(!nx)continue;
      for(const y of B){
        if(x===y)continue;
        const ny=identifierNamespace(y);
        if(nx===ny){conflicting.push(`${x}≠${y}`);break}
      }
    }
  }
  return {a:A,b:B,shared:[...new Set(shared)],conflicting:[...new Set(conflicting)]};
}

function scalarAttributes(value:any){
  const xs=normalizeText(value).split(/\s+/).filter(Boolean);const out=new Map<string,Set<string>>();
  const add=(key:string,value:string)=>{const set=out.get(key)||new Set<string>();set.add(value);out.set(key,set)};
  for(const token of xs){
    const m=token.match(/^(\d+(?:\.\d+)?)(gb|tb|mb|mm|cm|kg|mah|hz|v|w|inch|in)$/);
    if(m)add(m[2],m[1]);
  }
  for(let i=0;i<xs.length-1;i++){
    const n=xs[i],key=xs[i+1];
    if(!/^\d+(?:\.\d+)?$/.test(n)||GENERIC_STOP_WORDS.has(key)||PAIR_VARIANT_WORDS.has(key)||/^\d+$/.test(key))continue;
    const num=Number(n);if(Number.isInteger(num)&&num>=1900&&num<=2099)continue;
    // Common variant/spec patterns such as 2 button, 16 gb, 128 mm, 4 window.
    if(key.length>=2)add(key,n);
  }
  return out;
}
function scalarConflicts(a:string,b:string){
  const A=scalarAttributes(a),B=scalarAttributes(b);const out:string[]=[];
  for(const [k,vals] of A){
    const other=B.get(k);if(!other)continue;
    const av=[...vals].sort().join('/'),bv=[...other].sort().join('/');if(av!==bv)out.push(`${k}:${av}≠${bv}`);
  }
  return out;
}

function semanticVariantConflicts(a:string,b:string){
  const A=new Set(normalizeText(a).split(/\s+/).filter(Boolean)),B=new Set(normalizeText(b).split(/\s+/).filter(Boolean));
  const out:string[]=[];
  const hasAny=(set:Set<string>,xs:string[])=>xs.some(x=>set.has(x));
  const conflict=(name:string,left:string[],right:string[])=>{
    if((hasAny(A,left)&&hasAny(B,right))||(hasAny(A,right)&&hasAny(B,left)))out.push(name);
  };
  // These are marketplace-neutral spatial/package attributes. Horizontal left/right is
  // intentionally absent: complementary sides are often equivalent pricing evidence.
  conflict('position:front≠rear',['front'],['rear']);
  conflict('position:inner≠outer',['inner','interior'],['outer','exterior']);
  conflict('position:upper≠lower',['upper','top'],['lower','bottom']);
  conflict('package:single≠pair/set',['single','individual'],['pair','set']);
  return out;
}

function jaccard(a:Set<string>,b:Set<string>){
  if(!a.size||!b.size)return 0;
  let overlap=0;for(const x of a)if(b.has(x))overlap++;
  return overlap/(a.size+b.size-overlap);
}
function weightedJaccard(a:string[],b:string[],idf?:Map<string,number>){
  const A=new Set(a),B=new Set(b);const U=new Set([...A,...B]);if(!U.size)return 0;
  let both=0,total=0;
  for(const t of U){const w=idf?.get(t)||1;total+=w;if(A.has(t)&&B.has(t))both+=w}
  return total?both/total:0;
}
function categorySimilarity(a:string[],b:string[]){
  if(!a.length||!b.length)return 0;
  let prefix=0;while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
  const jac=jaccard(new Set(a),new Set(b));
  return Math.max(jac,prefix/Math.max(a.length,b.length));
}
export function buildIdf(documents:string[]){
  const df=new Map<string,number>();const docs=documents.map(d=>new Set(identityTokens(d)));
  for(const set of docs)for(const t of set)df.set(t,(df.get(t)||0)+1);
  const n=Math.max(1,docs.length);const idf=new Map<string,number>();
  for(const [t,c] of df)idf.set(t,Math.log((n+1)/(c+1))+1);
  return idf;
}
export function tfidfCosine(a:string,b:string,idf?:Map<string,number>){
  const aa=identityTokens(a),bb=identityTokens(b);if(!aa.length||!bb.length)return 0;
  const weights=idf||buildIdf([a,b]);
  const vector=(xs:string[])=>{const tf=new Map<string,number>();for(const t of xs)tf.set(t,(tf.get(t)||0)+1);const out=new Map<string,number>();for(const [t,c] of tf)out.set(t,c*(weights.get(t)||1));return out};
  const x=vector(aa),y=vector(bb);let dot=0,xx=0,yy=0;
  for(const v of x.values())xx+=v*v;for(const v of y.values())yy+=v*v;for(const [k,v] of x)dot+=v*(y.get(k)||0);
  return xx&&yy?dot/(Math.sqrt(xx)*Math.sqrt(yy)):0;
}
export type GenericSimilarity={
  score:number;retrievalScore:number;cosine:number;tokenOverlap:number;category:number;identifierOverlap:boolean;
  sharedIdentifiers:string[];conflictingIdentifiers:string[];attributeConflicts:string[];reasons:string[]
};
export function genericListingSimilarity(a:any,b:any,idf?:Map<string,number>,extraA:any={},extraB:any={}):GenericSimilarity{
  const ad=identityDocument(a,extraA),bd=identityDocument(b,extraB);
  const cosine=tfidfCosine(ad,bd,idf);
  const tokenOverlap=weightedJaccard(identityTokens(ad),identityTokens(bd),idf);
  const category=categorySimilarity(categoryPathOf(a),categoryPathOf(b));
  const ids=identifierEvidence(ad,bd);const identifierOverlap=ids.shared.length>0;
  const attrConflicts=[...new Set([...scalarConflicts(ad,bd),...semanticVariantConflicts(ad,bd)])];

  // Retrieval stays permissive so candidate discovery remains broad. Comparable confidence is
  // stricter: category is weak context, while identifiers/contradictions can dominate the result.
  const retrievalScore=Math.max(0,Math.min(1,.66*cosine+.24*tokenOverlap+.10*category));
  let score=.72*cosine+.23*tokenOverlap+.05*category;
  if(ids.shared.length)score+=Math.min(.25,.18+.035*Math.min(2,ids.shared.length));
  if(ids.conflicting.length)score-=Math.min(.38,.30+.04*Math.min(2,ids.conflicting.length));
  else if(ids.a.size&&ids.b.size&&!ids.shared.length)score-=.12;
  if(attrConflicts.length)score-=Math.min(.22,.14+.04*Math.min(2,attrConflicts.length));
  score=Math.max(0,Math.min(1,score));

  const reasons:string[]=[];
  if(cosine>=.55)reasons.push(`identity text ${(cosine*100).toFixed(0)}%`);
  if(tokenOverlap>=.35)reasons.push(`discriminative token overlap ${(tokenOverlap*100).toFixed(0)}%`);
  if(category>=.5)reasons.push(`category context ${(category*100).toFixed(0)}%`);
  if(ids.shared.length)reasons.push(`shared identifier ${ids.shared.slice(0,2).join(', ')}`);
  if(ids.conflicting.length)reasons.push(`identifier conflict ${ids.conflicting.slice(0,2).join(', ')}`);
  if(attrConflicts.length)reasons.push(`variant/spec conflict ${attrConflicts.slice(0,2).join(', ')}`);
  return {
    score:Number(score.toFixed(4)),retrievalScore:Number(retrievalScore.toFixed(4)),cosine:Number(cosine.toFixed(4)),
    tokenOverlap:Number(tokenOverlap.toFixed(4)),category:Number(category.toFixed(4)),identifierOverlap,
    sharedIdentifiers:ids.shared,conflictingIdentifiers:ids.conflicting,attributeConflicts:attrConflicts,reasons
  };
}
export function isStrongGenericMatch(m:GenericSimilarity){
  // Precision-first admission. A high score can stand on strong discriminative text, but explicit
  // identifier/spec conflicts block suppression/commercial use even when the seller template matches.
  if(m.conflictingIdentifiers.length||m.attributeConflicts.length)return false;
  return Boolean(m.score>=.78||(m.identifierOverlap&&m.score>=.72));
}

// Commercial/pricing cohorts deliberately use a slightly stricter gate than candidate retrieval.
export function isTrustedComparable(m:GenericSimilarity){
  if(m.conflictingIdentifiers.length||m.attributeConflicts.length)return false;
  return Boolean(m.score>=.82||(m.identifierOverlap&&m.score>=.76));
}
