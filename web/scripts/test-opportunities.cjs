const assert=require('node:assert/strict');

function qualify(s){
 const independent=Number(s.independentObservationCount||0),span=Number(s.evidenceDetails?.spanHours||0),velocity=Number(s.velocity||0),interval=Number(s.velocityIntervalHours||0),confidence=Number(s.confidence||0),intent=Number(s.engagementScore||0),watchers=Number(s.watchers||0),bids=Number(s.bids||0),purchaseQs=Number(s.purchaseIntentQuestions||0),sold=Boolean(s.soldDetected),views24=Number(s.views24h||0),lastDelta=Number(s.lastViewChange||0);
 const enoughHistory=independent>=3&&span>=12&&interval>=6&&confidence>=48;
 const meaningfulMovement=views24>=4||velocity>=5||lastDelta>=3;
 const buyerIntent=sold||bids>=1||watchers>=2||purchaseQs>=1||intent>=50;
 const qualifies=enoughHistory&&meaningfulMovement&&(buyerIntent||velocity>=7||views24>=6);
 if(!qualifies)return {qualifies:false};
 const demandScore=Math.min(100,Math.round(Math.min(38,Math.max(0,views24)*3.5)+Math.min(24,Math.max(0,velocity)*2)+Math.min(18,intent*.28)+Math.min(10,watchers*2)+Math.min(10,bids*5)+Math.min(8,purchaseQs*3)+(sold?12:0)));
 const sourcingStage=independent>=4&&span>=24&&interval>=12&&demandScore>=72&&(views24>=8||velocity>=9)&&(buyerIntent||views24>=12)?'STRONG_LEAD':'EARLY_LEAD';
 const sourceNow=independent>=4&&span>=30&&interval>=12&&demandScore>=84&&(sold||bids>=2||purchaseQs>=2||views24>=15||velocity>=14);
 return {qualifies:true,strength:sourceNow||sourcingStage==='STRONG_LEAD'?'STRONG':'EMERGING',sourcingStage:sourceNow?'SOURCE_NOW':sourcingStage,demandScore};
}

assert.equal(qualify({independentObservationCount:2,evidenceDetails:{spanHours:30},views24h:20,velocity:15,velocityIntervalHours:12,confidence:80,watchers:8}).qualifies,false,'two checks are still too early for a standalone sourcing lead');
assert.equal(qualify({independentObservationCount:3,evidenceDetails:{spanHours:18},views24h:7,lastViewChange:3,velocity:7,velocityIntervalHours:7,confidence:60,watchers:2}).sourcingStage,'EARLY_LEAD','three sustained checks may create an early research lead');
assert.equal(qualify({independentObservationCount:4,evidenceDetails:{spanHours:36},views24h:10,lastViewChange:4,velocity:10,velocityIntervalHours:12,confidence:70,watchers:3,bids:1,engagementScore:55}).sourcingStage,'STRONG_LEAD','sustained movement plus buyer evidence should become a strong lead');
assert.equal(qualify({independentObservationCount:4,evidenceDetails:{spanHours:40},views24h:18,lastViewChange:7,velocity:15,velocityIntervalHours:13,confidence:82,bids:2,purchaseIntentQuestions:2,engagementScore:70}).sourcingStage,'SOURCE_NOW','exceptional sustained evidence should make supplier research a priority');
assert.equal(qualify({independentObservationCount:3,evidenceDetails:{spanHours:18},views24h:2,velocity:2,velocityIntervalHours:7,confidence:60}).qualifies,false,'ordinary movement should not create noise');
console.log('Sourcing opportunity regression tests passed.');

function qualifyFamily({positive,mature,span,medianPace,total24,max24,demand,bids=0,purchaseQs=0,sold=0}){
 if(positive<2||span<8||(medianPace<1.5&&total24<6))return null;
 let stage='EARLY_LEAD';
 if((positive>=3&&mature>=2&&span>=18&&demand>=55&&(medianPace>=3||total24>=12))||(positive>=2&&demand>=65&&(bids>0||purchaseQs>0||sold>0)))stage='STRONG_LEAD';
 if(positive>=4&&mature>=3&&span>=24&&demand>=78&&(medianPace>=5||total24>=22)&&(sold>0||bids>=2||purchaseQs>=2||max24>=10))stage='SOURCE_NOW';
 return stage;
}
assert.equal(qualifyFamily({positive:2,mature:0,span:14,medianPace:2.5,total24:7,max24:4,demand:42}),'EARLY_LEAD','two related moving listings should be allowed to create a research lead');
assert.equal(qualifyFamily({positive:3,mature:2,span:22,medianPace:4,total24:15,max24:7,demand:61}),'STRONG_LEAD','three sustained related listings should become a strong lead');
assert.equal(qualifyFamily({positive:5,mature:4,span:35,medianPace:6,total24:28,max24:12,demand:82}),'SOURCE_NOW','deep corroborated family movement should prioritize supplier research');
console.log('Cross-listing sourcing-stage regression tests passed.');
