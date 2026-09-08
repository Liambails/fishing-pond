const assert=require('node:assert/strict');

function qualifyStandalone(s){
 const independent=Number(s.independentObservationCount||0),span=Number(s.evidenceDetails?.spanHours||s.spanHours||0),velocity=Number(s.velocity||0),interval=Number(s.velocityIntervalHours||0),confidence=Number(s.confidence||0),intent=Number(s.engagementScore||0),watchers=Number(s.watchers||0),bids=Number(s.bids||0),purchaseQs=Number(s.purchaseIntentQuestions||0),sold=Boolean(s.soldDetected),views24=Number(s.views24h||0),lastDelta=Number(s.lastViewChange||0);
 const buyerIntent=sold||bids>=1||watchers>=2||purchaseQs>=1||intent>=50;
 const sparseEarly=independent>=2&&span>=8&&interval>=8&&confidence>=34&&lastDelta>=5&&velocity>=9;
 const normalEarly=independent>=3&&span>=10&&interval>=6&&confidence>=44&&(views24>=4||velocity>=5||lastDelta>=3)&&(buyerIntent||velocity>=7||views24>=6);
 const qualifies=sparseEarly||normalEarly;
 if(!qualifies)return {qualifies:false};
 const demandScore=Math.min(100,Math.round(Math.min(38,Math.max(0,views24)*3.5)+Math.min(26,Math.max(0,velocity)*2.1)+Math.min(18,intent*.28)+Math.min(10,watchers*2)+Math.min(10,bids*5)+Math.min(8,purchaseQs*3)+(sold?12:0)));
 const strong=independent>=3&&span>=16&&interval>=8&&demandScore>=52&&(views24>=8||velocity>=8||lastDelta>=5)&&(buyerIntent||independent>=4||velocity>=10);
 const sourceNow=independent>=4&&span>=24&&interval>=10&&demandScore>=62&&(views24>=14||velocity>=12)&&(sold||bids>=2||purchaseQs>=2||views24>=18||velocity>=15);
 return {qualifies:true,sourcingStage:sourceNow?'SOURCE_NOW':strong?'STRONG_LEAD':'EARLY_LEAD',demandScore,sparseEarly};
}
function qualifyFamily({positive,mature,span,medianPace,total24,max24,demand,bids=0,purchaseQs=0,sold=0,medianAge=span,medianIndependent=0}){
 if(positive<2||span<6||medianAge<6||(medianPace<1.25&&total24<4))return null;
 let stage='EARLY_LEAD'; const buyerSignals=bids+purchaseQs+sold;
 const matureTwo=positive>=2&&mature>=2&&span>=12&&medianAge>=10&&demand>=45&&(medianPace>=2.25||total24>=8);
 const sparseButStrong=positive>=2&&medianIndependent>=2&&span>=14&&medianAge>=12&&demand>=50&&(medianPace>=4||total24>=12);
 const broadFamily=positive>=3&&mature>=2&&span>=10&&medianAge>=8&&demand>=43&&(medianPace>=2||total24>=9);
 const buyerBacked=positive>=2&&span>=8&&medianAge>=8&&demand>=50&&buyerSignals>0&&(medianPace>=1.5||total24>=6);
 if(matureTwo||sparseButStrong||broadFamily||buyerBacked)stage='STRONG_LEAD';
 const deepFamily=positive>=3&&mature>=3&&span>=20&&medianAge>=16&&demand>=68&&(medianPace>=4||total24>=18)&&(buyerSignals>0||max24>=8);
 const exceptionalPair=positive>=2&&mature>=2&&span>=24&&medianAge>=20&&demand>=76&&total24>=22&&max24>=10;
 if(deepFamily||exceptionalPair)stage='SOURCE_NOW';
 return stage;
}

// Standalone: small datasets should surface only when movement is unmistakable and well spaced.
assert.equal(qualifyStandalone({independentObservationCount:1,evidenceDetails:{spanHours:12},lastViewChange:10,velocity:20,velocityIntervalHours:12,confidence:60}).qualifies,false,'one check can never source a product');
assert.equal(qualifyStandalone({independentObservationCount:2,evidenceDetails:{spanHours:4},lastViewChange:8,velocity:18,velocityIntervalHours:4,confidence:50}).qualifies,false,'two checks too close together are a burst, not a lead');
assert.equal(qualifyStandalone({independentObservationCount:2,evidenceDetails:{spanHours:10},lastViewChange:5,velocity:10,velocityIntervalHours:10,confidence:40}).sourcingStage,'EARLY_LEAD','two well-spaced exceptional checks may create a sparse early lead');
assert.equal(qualifyStandalone({independentObservationCount:2,evidenceDetails:{spanHours:12},lastViewChange:2,velocity:4,velocityIntervalHours:12,confidence:45}).qualifies,false,'two modest checks remain too uncertain');
assert.equal(qualifyStandalone({independentObservationCount:3,evidenceDetails:{spanHours:12},views24h:6,lastViewChange:3,velocity:7,velocityIntervalHours:6,confidence:48}).sourcingStage,'EARLY_LEAD','three sustained checks create a research lead');
assert.equal(qualifyStandalone({independentObservationCount:3,evidenceDetails:{spanHours:18},views24h:9,lastViewChange:5,velocity:10,velocityIntervalHours:9,confidence:60}).sourcingStage,'STRONG_LEAD','three high-velocity checks across most of a day can become strong without buyer fields');
assert.equal(qualifyStandalone({independentObservationCount:4,evidenceDetails:{spanHours:26},views24h:11,lastViewChange:4,velocity:9,velocityIntervalHours:12,confidence:68}).sourcingStage,'STRONG_LEAD','four mature checks with healthy movement remain strong');
assert.equal(qualifyStandalone({independentObservationCount:4,evidenceDetails:{spanHours:30},views24h:19,lastViewChange:7,velocity:16,velocityIntervalHours:12,confidence:80}).sourcingStage,'SOURCE_NOW','exceptional standalone attention across more than a day can source now without unavailable Trade Me buyer fields');
assert.equal(qualifyStandalone({independentObservationCount:5,evidenceDetails:{spanHours:72},views24h:3,lastViewChange:1,velocity:2,velocityIntervalHours:24,confidence:82,watchers:1}).qualifies,false,'lots of observations cannot rescue weak demand');

// Corroborated families: corroboration lets us use fewer points, but elapsed time still matters.
assert.equal(qualifyFamily({positive:2,mature:0,span:5,medianAge:5,medianIndependent:2,medianPace:8,total24:14,max24:8,demand:55}),null,'even two fast listings need six hours of evidence');
assert.equal(qualifyFamily({positive:2,mature:0,span:8,medianAge:8,medianIndependent:2,medianPace:2,total24:5,max24:3,demand:40}),'EARLY_LEAD','two related listings moving for eight hours justify supplier search');
assert.equal(qualifyFamily({positive:2,mature:0,span:15,medianAge:13,medianIndependent:2,medianPace:4.5,total24:13,max24:7,demand:52}),'STRONG_LEAD','two sparse but well-spaced fast corroborating listings can become strong');
assert.equal(qualifyFamily({positive:2,mature:2,span:13,medianAge:12,medianIndependent:3,medianPace:2.5,total24:9,max24:5,demand:47}),'STRONG_LEAD','two mature related listings no longer require a third comparable');
assert.equal(qualifyFamily({positive:3,mature:2,span:11,medianAge:9,medianIndependent:3,medianPace:2.2,total24:10,max24:4,demand:45}),'STRONG_LEAD','three corroborating listings compensate for a shorter observation history');
assert.equal(qualifyFamily({positive:2,mature:1,span:12,medianAge:10,medianIndependent:2.5,medianPace:1.7,total24:7,max24:4,demand:51,bids:1}),'STRONG_LEAD','real buyer evidence can strengthen a modest but corroborated family');
assert.equal(qualifyFamily({positive:3,mature:3,span:22,medianAge:18,medianIndependent:4,medianPace:4.5,total24:20,max24:9,demand:70}),'SOURCE_NOW','deep family evidence with a strong best listing can source now');
assert.equal(qualifyFamily({positive:2,mature:2,span:28,medianAge:24,medianIndependent:4,medianPace:5,total24:24,max24:12,demand:78}),'SOURCE_NOW','an exceptional two-listing family can source now after a full day of mature evidence');
assert.equal(qualifyFamily({positive:5,mature:5,span:72,medianAge:60,medianIndependent:6,medianPace:.8,total24:3,max24:1,demand:35}),null,'large datasets with weak recent movement must not create opportunities');

// Concrete V3.9.22 regression: the Vitz left/right tail-light pattern that motivated calibration.
assert.equal(qualifyFamily({positive:2,mature:2,span:40,medianAge:40,medianIndependent:5,medianPace:9.8,total24:22,max24:12,demand:56}),'STRONG_LEAD','Vitz left/right tail-light pair must trigger supplier research');
console.log('V3.9.22 opportunity calibration tests passed (standalone + family, sparse + mature + large-data cases).');
