const assert=require('assert');const fs=require('fs');const path=require('path');const ts=require('typescript');const vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'..','lib','genericSimilarity.ts'),'utf8');const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const mod={exports:{}};vm.runInNewContext(javascript,{module:mod,exports:mod.exports,require,console,Math,String,Object,Array,Set,Map},{filename:'genericSimilarity.js'});
const {buildIdf,genericListingSimilarity,isStrongGenericMatch,listingDocument}=mod.exports;
const colorado={title:'Electric Power Master Window Switch 2 Button For Holden Colorado RG 2012~2020',metadata:{category_path:['motors','car-parts-accessories','holden','electrics']}};
const colorado2={title:'Holden Colorado RG 2012-2020 2 Button Master Power Window Switch',metadata:{category_path:['motors','car-parts-accessories','holden','electrics']}};
const toyota={title:'Toyota Aqua NHP10 Master Power Window Switch 2012-2020',metadata:{category_path:['motors','car-parts-accessories','toyota','electrics']}};
const pan={title:'Stainless Steel 28cm Induction Frying Pan with Lid',metadata:{category_path:['home-living','kitchen','cookware','frying-pans']}};
const pan2={title:'28 cm Stainless Induction Fry Pan + Glass Lid',metadata:{category_path:['home-living','kitchen','cookware','frying-pans']}};
const docs=[colorado,colorado2,toyota,pan,pan2].map(listingDocument);const idf=buildIdf(docs);
const sameVehicle=genericListingSimilarity(colorado,colorado2,idf);const wrongVehicle=genericListingSimilarity(colorado,toyota,idf);const kitchen=genericListingSimilarity(pan,pan2,idf);
assert.ok(sameVehicle.score>wrongVehicle.score,`Colorado family should outrank unrelated vehicle switch (${sameVehicle.score} vs ${wrongVehicle.score})`);
assert.ok(isStrongGenericMatch(sameVehicle),'near-duplicate Colorado listing should qualify for strong generic match');
assert.ok(!isStrongGenericMatch(wrongVehicle),'different vehicle family must not be suppressed just because both are window switches');
assert.ok(isStrongGenericMatch(kitchen),'generic matcher should also work outside vehicle parts');

const vitzLeft={title:'Toyota Vitz (SCP90) Left / Passenger Tail Light (KOITO 52-185)',metadata:{category_path:['motors','car-parts-accessories','toyota','exterior']}};
const vitzRight={title:'Toyota Vitz (SCP90) Right / Driver Tail Light (KOITO 52-143)',metadata:{category_path:['motors','car-parts-accessories','toyota','exterior']}};
const vitzIdf=buildIdf([listingDocument(vitzLeft),listingDocument(vitzRight),listingDocument(toyota),listingDocument(pan)]);
const vitzPair=genericListingSimilarity(vitzLeft,vitzRight,vitzIdf);
assert.ok(vitzPair.score>=.56&&vitzPair.cosine>=.48&&(vitzPair.category>=.20||vitzPair.identifierOverlap),`Vitz left/right tail lights should enter the same opportunity family (${JSON.stringify(vitzPair)})`);

console.log('category-agnostic similarity regression tests passed');
