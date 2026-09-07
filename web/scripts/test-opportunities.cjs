const assert=require('node:assert/strict');

function qualify(s){
 const independent=Number(s.independentObservationCount||0),span=Number(s.evidenceDetails?.spanHours||0),velocity=Number(s.velocity||0),interval=Number(s.velocityIntervalHours||0),confidence=Number(s.confidence||0),intent=Number(s.engagementScore||0),watchers=Number(s.watchers||0),bids=Number(s.bids||0),purchaseQs=Number(s.purchaseIntentQuestions||0),sold=Boolean(s.soldDetected);
 const enoughHistory=independent>=4&&span>=30&&interval>=12&&confidence>=60;
 const strongBehaviour=sold||bids>=1||watchers>=3||purchaseQs>=1||intent>=55||velocity>=12;
 const qualifies=enoughHistory&&velocity>=6&&strongBehaviour;
 if(!qualifies)return {qualifies:false};
 const demandScore=Math.min(100,Math.round(Math.min(42,velocity*3)+Math.min(28,intent*.35)+Math.min(12,watchers*2.5)+Math.min(12,bids*6)+Math.min(9,purchaseQs*3)+(sold?15:0)));
 const strong=independent>=5&&span>=48&&confidence>=72&&velocity>=8&&(sold||bids>=2||intent>=65||velocity>=14)&&demandScore>=72;
 return {qualifies:true,strength:strong?'STRONG':'EMERGING',demandScore};
}

assert.equal(qualify({independentObservationCount:3,evidenceDetails:{spanHours:50},velocity:15,velocityIntervalHours:14,confidence:80,watchers:8}).qualifies,false,'three independent windows must not produce standalone opportunity');
assert.equal(qualify({independentObservationCount:4,evidenceDetails:{spanHours:36},velocity:7,velocityIntervalHours:12,confidence:64,watchers:3}).strength,'EMERGING','sustained standalone listing with buyer intent should emerge');
assert.equal(qualify({independentObservationCount:5,evidenceDetails:{spanHours:54},velocity:15,velocityIntervalHours:13,confidence:78,engagementScore:70,watchers:7,bids:2,purchaseIntentQuestions:2}).strength,'STRONG','deep, high-intent standalone evidence should become strong');
assert.equal(qualify({independentObservationCount:5,evidenceDetails:{spanHours:60},velocity:7,velocityIntervalHours:11.5,confidence:80,bids:3}).qualifies,false,'sub-12h latest interval must remain ineligible');
assert.equal(qualify({independentObservationCount:5,evidenceDetails:{spanHours:60},velocity:7,velocityIntervalHours:13,confidence:80}).qualifies,false,'ordinary velocity with no strong buyer-intent evidence should not alert');
console.log('Standalone opportunity regression tests passed.');
