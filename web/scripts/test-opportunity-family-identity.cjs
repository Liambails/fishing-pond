const fs=require('fs');
const vm=require('vm');
const ts=require('typescript');
const assert=require('assert');

let src=fs.readFileSync('lib/opportunities.ts','utf8');
src += '\nexport const __familyIdentityTest={productTypeOf,identityCompatible,unionClusters};\n';

const js=ts.transpileModule(src,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,
  target:ts.ScriptTarget.ES2022,
  esModuleInterop:true,
}}).outputText;

const mod={exports:{}};
const sandbox={
  module:mod,
  exports:mod.exports,
  console,
  process,
  Date,
  Math,
  Set,
  Map,
  URL,
  TextEncoder,
  TextDecoder,
  require:(id)=>{
    if(id.includes('pagedQuery'))return {
      fetchPaged:async()=>[],
    };
    if(id.includes('genericSimilarity'))return {
      listingDocument:(r)=>String(r?.title||''),
      buildIdf:()=>new Map(),
      genericListingSimilarity:()=>({score:1,cosine:1,tokenOverlap:1,identifierOverlap:false,conflicts:[]}),
      isTrustedComparable:()=>true,
    };
    if(id.includes('intelligence'))return {computeListingSignals:()=>[]};
    if(id.includes('supabase'))return {adminClient:()=>{throw new Error('DB not available in family identity test')}};
    return require(id);
  },
};
vm.runInNewContext(js,sandbox,{filename:'opportunities.test.cjs'});
const {productTypeOf,identityCompatible,unionClusters}=mod.exports.__familyIdentityTest;

const row=(title)=>({title,active:true,metadata:{},observations:[],signal:{independentObservationCount:8,confidence:99}});

const good=[
  ['Toyota RAV4 (ACA33) Right / Drivers Front Exterior Door Handle','Toyota RAV4 (MXAA52) Left/ Passenger Front Exterior Door Handle'],
  ['NISSAN NOTE E11 MASTER WINDOW SWITCH','Nissan Note E11 2005-2008 Window Master Switch'],
];
for(const [a,b] of good)assert.equal(identityCompatible(row(a),row(b)),true,`expected compatible: ${a} <> ${b}`);

const bad=[
  ['Toyota RAV4 (ACA33) Right / Drivers Front Exterior Door Handle','Toyota Vitz SCP90 RR Quarter Glass'],
  ['Toyota RAV4 (ACA33) Right / Drivers Front Exterior Door Handle','FUEL DOOR For TOYOTA RAV4'],
  ['Toyota RAV4 (ACA33) Right / Drivers Front Exterior Door Handle','TAILGATE HANDLE For TOYOTA RAV4'],
  ['NISSAN NOTE WIPER SWITCH E11 04-12','NISSAN NOTE E11 MASTER WINDOW SWITCH'],
  ['NISSAN NOTE WIPER SWITCH E11 04-12','2007 Nissan Note E11 - Right Headlight'],
  ['2014 Suzuki Swift ZC72S - Master Power Window Switch','2014 Suzuki Swift ZC72S - Wiper Switch'],
  ['2014 Suzuki Swift ZC72S - Master Power Window Switch','2014 Suzuki Swift ZC72S - Indicator Switch'],
];
for(const [a,b] of bad)assert.equal(identityCompatible(row(a),row(b)),false,`expected hard split: ${a} <> ${b}`);

const mixed=[
 row('Toyota RAV4 (ACA33) Right / Drivers Front Exterior Door Handle'),
 row('Toyota RAV4 (MXAA52) Left/ Passenger Front Exterior Door Handle'),
 row('FUEL DOOR For TOYOTA RAV4'),
 row('Toyota Vitz SCP90 RR Quarter Glass'),
 row('TAILGATE HANDLE For TOYOTA RAV4'),
];
const groups=unionClusters(mixed);
assert.equal(groups.length,4,'RAV4 mixed fixture should form door-handle + fuel-door + quarter-glass + tailgate-handle groups');
assert.equal(groups.filter(g=>g.some(x=>/door handle/i.test(x.title)&&!/tailgate/i.test(x.title))).find(g=>g.length===2)?.length,2,'two exterior door handles should stay together');

assert.equal(productTypeOf('Nissan Note E11 2005-2008 Window Master Switch'),'Master power window switch');
assert.equal(productTypeOf('TAILGATE HANDLE For TOYOTA RAV4'),'Tailgate handle');
assert.equal(productTypeOf('FUEL DOOR For TOYOTA RAV4'),'Fuel door');
assert.equal(productTypeOf('Toyota Vitz SCP90 RR Quarter Glass'),'Quarter glass');

console.log('V3.10.11 production family-identity hard-split regressions passed');
