const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'intelligence.ts'), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(javascript, { module: mod, exports: mod.exports, require, console, Date, Math, Number, String, Object, Array, Set, Map, JSON }, { filename: 'intelligence.js' });

const { computeListingSignal } = mod.exports;
const now = Date.now();
const at = hoursAgo => new Date(now - hoursAgo * 3600000).toISOString();
const listing = observations => ({
  id: 'regression', listing_id: 'regression', title: 'Toyota master window switch', url: 'https://example.test/listing/regression', active: true,
  last_observed_at: observations[observations.length - 1].captured_at, consecutive_failures: 0, metadata: {}, observations,
});

// Regression: a 30-minute manual revisit must not become a new independent evidence window
// or drive a 140+ views/day extrapolation.
const burst = computeListingSignal(listing([
  { captured_at: at(50), views: 6 },
  { captured_at: at(18.1), views: 7 },
  { captured_at: at(0.51), views: 11 },
  { captured_at: at(0), views: 14 },
]));
assert.equal(burst.observationCount, 4);
assert.equal(burst.independentObservationCount, 3);
assert.equal(burst.compressedObservationCount, 1);
assert.equal(burst.label, 'WATCHING');
assert.ok(burst.velocity < 20, `burst velocity should be bounded by independent windows, got ${burst.velocity}`);
assert.ok(burst.confidence < 90, `three independent windows should not imply near-certainty, got ${burst.confidence}`);

// Regression: a seconds-apart render/capture burst must never become daily velocity evidence.
const microBurst = computeListingSignal(listing([
  { captured_at: at(0.0064), views: 16 }, // ~23 seconds ago
  { captured_at: at(0.0040), views: 16 }, // ~14 seconds before latest
  { captured_at: at(0), views: 19 },
]));
assert.equal(microBurst.observationCount, 3);
assert.equal(microBurst.independentObservationCount, 1);
assert.equal(microBurst.velocity, null);
assert.equal(microBurst.label, 'TOO EARLY');

// A genuinely repeated, well-spaced standalone trend can still graduate to GOOD.
const sustained = computeListingSignal(listing([
  { captured_at: at(48), views: 4 },
  { captured_at: at(32), views: 7 },
  { captured_at: at(16), views: 11 },
  { captured_at: at(0), views: 18 },
]));
assert.equal(sustained.independentObservationCount, 4);
assert.equal(sustained.compressedObservationCount, 0);
assert.equal(sustained.label, 'GOOD');
assert.ok(sustained.velocityIntervalHours >= 12);

// A minimum-length 3h interval is retained but deliberately damped to 35% trust.
const shortWindow = computeListingSignal(listing([
  { captured_at: at(15), views: 10 },
  { captured_at: at(3), views: 12 },
  { captured_at: at(0), views: 15 },
]));
assert.equal(shortWindow.independentObservationCount, 3);
assert.equal(shortWindow.velocityIntervalHours, 3);
assert.equal(shortWindow.velocityTrust, 0.35);
assert.ok(shortWindow.velocity < shortWindow.rawRecentVelocity);

console.log('intelligence temporal-evidence regression tests passed');

// Stronger marketplace intent should raise engagement without bypassing temporal evidence gates.
const intentRich = computeListingSignal(listing([
  { captured_at: at(24), views: 10, watchers: 1, bids: 0, question_count: 1, purchase_intent_questions: 0 },
  { captured_at: at(12), views: 13, watchers: 2, bids: 1, question_count: 3, purchase_intent_questions: 1 },
  { captured_at: at(0), views: 16, watchers: 4, bids: 2, question_count: 5, purchase_intent_questions: 2 },
]));
assert.ok(intentRich.engagementScore >= 50, `buyer-intent score should reflect watchers/bids/Q&A, got ${intentRich.engagementScore}`);
assert.equal(intentRich.purchaseIntentQuestions, 2);
assert.equal(intentRich.questionCount, 5);
assert.notEqual(intentRich.label, 'MUST_HAVE', 'buyer intent must not bypass repeated evidence requirements');

console.log('marketplace-intent regression tests passed');
