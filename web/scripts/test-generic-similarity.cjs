const assert=require('assert');const fs=require('fs');const path=require('path');const ts=require('typescript');const vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'..','lib','genericSimilarity.ts'),'utf8');const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const mod={exports:{}};vm.runInNewContext(javascript,{module:mod,exports:mod.exports,require,console,Math,String,Object,Array,Set,Map},{filename:'genericSimilarity.js'});
const {buildIdf,genericListingSimilarity,isStrongGenericMatch,isTrustedComparable,listingDocument}=mod.exports;
const cat=['motors','car-parts-accessories','electrics'];
const colorado={title:'Electric Power Master Window Switch 2 Button For Holden Colorado RG 2012~2020',metadata:{category_path:cat}};
const colorado2={title:'Holden Colorado RG 2012-2020 2 Button Master Power Window Switch',metadata:{category_path:cat}};
const colorado4={title:'Electric Power Master Window Switch 4 Button For Holden Colorado RG 2012~2020',metadata:{category_path:cat}};
const toyota={title:'Toyota Aqua NHP10 Master Power Window Switch 2012-2020',metadata:{category_path:cat}};
const pan={title:'Stainless Steel 28cm Induction Frying Pan with Lid',metadata:{category_path:['home-living','kitchen','cookware','frying-pans']}};
const pan2={title:'28 cm Stainless Induction Fry Pan + Glass Lid',metadata:{category_path:['home-living','kitchen','cookware','frying-pans']}};
const ravRight={title:'Toyota RAV4 (MXAA52) Right / Drivers Front Exterior Door Handle',metadata:{category_path:['motors','car-parts-accessories','exterior']}};
const ravLeft={title:'Toyota RAV4 (MXAA52) Left / Passenger Front Exterior Door Handle',metadata:{category_path:['motors','car-parts-accessories','exterior']}};
const ox730={title:'MITSUBISHI OUTLANDER Oxygen/Lambda Sensor - OX730',metadata:{category_path:cat}};
const ox730generic={title:'OXYGEN SENSOR OX730',metadata:{category_path:cat}};
const ox492={title:'MITSUBISHI OUTLANDER Oxygen/Lambda Sensor - OX492',metadata:{category_path:cat}};
const mp163={title:'MITSUBISHI OUTLANDER MAP Sensor - MP163',metadata:{category_path:cat}};
const partsA={title:'MASTER Window Switch Suitable For TOYOTA - 84820-60080 - NZ Seller - PARTSNZ',metadata:{category_path:cat}};
const partsB={title:'MASTER Window Switch Suitable For TOYOTA - 84820-60120 - NZ Seller - PARTSNZ',metadata:{category_path:cat}};
const hiace={title:'Master Window Switch for Toyota Hiace',metadata:{category_path:cat}};
const note={title:'NISSAN NOTE E11 MASTER WINDOW SWITCH',metadata:{category_path:cat}};
const vitzTailL={title:'Toyota Vitz SCP90 Left Passenger Tail Light KOITO 52-185',metadata:{category_path:['motors','car-parts-accessories','exterior']}};
const vitzTailR={title:'Toyota Vitz SCP90 Right Driver Tail Light KOITO 52-185',metadata:{category_path:['motors','car-parts-accessories','exterior']}};
const vitzHead={title:'TOYOTA VITZ SCP90 Right Headlight ichikoh 52-183',metadata:{category_path:['motors','car-parts-accessories','exterior']}};
const laptop8={title:'Lenovo ThinkPad T14 Gen 5 8GB 512GB Laptop',metadata:{category_path:['computers','laptops']}};
const laptop16={title:'Lenovo ThinkPad T14 Gen 5 16GB 512GB Laptop',metadata:{category_path:['computers','laptops']}};

const all=[colorado,colorado2,colorado4,toyota,pan,pan2,ravRight,ravLeft,ox730,ox730generic,ox492,mp163,partsA,partsB,hiace,note,vitzTailL,vitzTailR,vitzHead,laptop8,laptop16];
const idf=buildIdf(all.map(listingDocument));
const sim=(a,b)=>genericListingSimilarity(a,b,idf);

const sameVehicle=sim(colorado,colorado2),wrongVehicle=sim(colorado,toyota),kitchen=sim(pan,pan2);
assert.ok(sameVehicle.score>wrongVehicle.score,`Colorado family should outrank unrelated vehicle switch (${sameVehicle.score} vs ${wrongVehicle.score})`);
assert.ok(isStrongGenericMatch(sameVehicle),'near-duplicate Colorado listing should qualify for strong generic match');
assert.ok(!isStrongGenericMatch(wrongVehicle),'different vehicle family must not be suppressed just because both are window switches');
assert.ok(kitchen.score>=.40&&kitchen.score>sim(pan,toyota).score,'generic matcher should still rank same-category non-automotive products above unrelated products');

const paired=sim(ravRight,ravLeft);
assert.ok(paired.score>=.82,`left/right paired equivalent should stay a strong comparable (${JSON.stringify(paired)})`);
const tailPair=sim(vitzTailL,vitzTailR);
assert.ok(tailPair.score>=.90&&isTrustedComparable(tailPair),`same reference left/right tail lights should be trusted (${JSON.stringify(tailPair)})`);
const wrongLamp=sim(vitzTailL,vitzHead);
assert.ok(wrongLamp.score<.68,`tail light and headlight with conflicting identifiers must not look commercially comparable (${JSON.stringify(wrongLamp)})`);

const exactRef=sim(ox730,ox730generic),wrongRef=sim(ox730,ox492),wrongSensor=sim(ox730,mp163);
assert.ok(exactRef.score>=.80&&isTrustedComparable(exactRef),`shared OX730 should dominate wording differences (${JSON.stringify(exactRef)})`);
assert.ok(wrongRef.score<.70&&!isTrustedComparable(wrongRef),`OX730 vs OX492 should be rejected as pricing comparables (${JSON.stringify(wrongRef)})`);
assert.ok(wrongSensor.score<.62,`oxygen sensor vs MAP sensor should remain weak (${JSON.stringify(wrongSensor)})`);

const templateConflict=sim(partsA,partsB);
assert.ok(templateConflict.score<.68&&!isTrustedComparable(templateConflict),`seller boilerplate must not overpower conflicting part numbers (${JSON.stringify(templateConflict)})`);
const buttonConflict=sim(colorado4,colorado);
assert.ok(buttonConflict.attributeConflicts.length>0&&!isTrustedComparable(buttonConflict),`4-button vs 2-button should be treated as a material variant conflict (${JSON.stringify(buttonConflict)})`);
const specConflict=sim(laptop8,laptop16);
assert.ok(specConflict.attributeConflicts.some(x=>x.includes('gb'))&&!isTrustedComparable(specConflict),`8GB vs 16GB should be a generic specification conflict (${JSON.stringify(specConflict)})`);
const genericWrongModel=sim(hiace,note);
assert.ok(genericWrongModel.score<.65,`same generic product phrase across unrelated models should remain moderate/weak (${JSON.stringify(genericWrongModel)})`);
console.log('V3.10.7 category-agnostic product-identity similarity regression tests passed');
