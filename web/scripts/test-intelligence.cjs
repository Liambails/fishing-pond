const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

function loadTsModule(filename, deps={}) {
  const source = fs.readFileSync(filename, 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  const localRequire = name => Object.prototype.hasOwnProperty.call(deps,name) ? deps[name] : require(name);
  vm.runInNewContext(javascript, { module: mod, exports: mod.exports, require: localRequire, console, Date, Math, Number, String, Object, Array, Set, Map, JSON }, { filename });
  return mod.exports;
}
const genericSimilarity = loadTsModule(path.join(__dirname, '..', 'lib', 'genericSimilarity.ts'));
const intelligence = loadTsModule(path.join(__dirname, '..', 'lib', 'intelligence.ts'), {'./genericSimilarity': genericSimilarity});

const { computeListingSignal } = intelligence;
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
// V3.10.4: Why prioritises real buyer behaviour and reports counter changes.
const buyerMovement = computeListingSignal(listing([
  { captured_at: at(24), views: 10, watchers: 2, bids: 0, question_count: 0 },
  { captured_at: at(12), views: 14, watchers: 3, bids: 1, question_count: 0 },
  { captured_at: at(0), views: 18, watchers: 6, bids: 3, question_count: 1, purchase_intent_questions: 1 },
]));
assert.equal(buyerMovement.watcherChange, 3);
assert.equal(buyerMovement.bidChange, 2);
assert.match(buyerMovement.reason, /bidding increased by 2/i);
assert.match(buyerMovement.reason, /new watchlist/i);


// V3.9.17: GOOD is never available with only three independent observations,
// even when attention/buyer intent or peer context is strong.
assert.notEqual(intentRich.label, 'GOOD', 'three independent observations must never unlock GOOD');
console.log('four-window GOOD gate regression test passed');

// V3.9.18: a transient missing price must not erase previously captured price evidence.
const priceCarryForward = computeListingSignal(listing([
  { captured_at: at(12), views: 10, buy_now_nzd: 55.20 },
  { captured_at: at(6), views: 13, buy_now_nzd: 55.20 },
  { captured_at: at(0), views: 16, buy_now_nzd: null, asking_price_nzd: null, current_bid_nzd: null },
]));
assert.equal(priceCarryForward.price, 55.20);
assert.equal(priceCarryForward.priceIsLatest, false);
console.log('last-known price carry-forward regression test passed');

// V3.9.19: relisted counters reset into a new lifecycle episode. Old 27 views -> new 2 views
// must never be interpreted as a negative current-period change or inflate current evidence.
const relisted = computeListingSignal({
  id: 'relist-regression', listing_id: 'relist-regression', title: 'Toyota Aqua master window switch', url: 'https://example.test/listing/relist', active: true, metadata: {}, lifecycle_episode: 2,
  observations: [
    { captured_at: at(30), lifecycle_episode: 1, views: 22 },
    { captured_at: at(18), lifecycle_episode: 1, views: 27 },
    { captured_at: at(6), lifecycle_episode: 2, views: 2 },
    { captured_at: at(0), lifecycle_episode: 2, views: 5 },
  ],
  last_observed_at: at(0),
});
assert.equal(relisted.observationCount, 2, 'current signal must use only the active lifecycle episode');
assert.equal(relisted.independentObservationCount, 2);
assert.ok(relisted.lastViewChange === 3 || relisted.lastViewChange === null, `new episode should measure 2 -> 5, got ${relisted.lastViewChange}`);
console.log('relist episode reset regression test passed');

// V3.10.10: COBALT's own instrumented Playwright detail visits are a
// conservative possible contribution to Trade Me's cumulative view counter.
// They must not be treated as independent buyer demand.
const observerBase = {
  id: 'observer-regression',
  listing_id: 'observer-regression',
  title: 'Generic marketplace product',
  url: 'https://example.test/listing/observer-regression',
  active: true,
  metadata: {},
  last_observed_at: at(0),
};

// Raw +1 with one known COBALT visit => zero external-view lower bound.
const observerOnly = computeListingSignal({
  ...observerBase,
  observations: [
    { captured_at: at(12), views: 10 },
    { captured_at: at(0), views: 11 },
  ],
  acquisition_events: [
    {
      occurred_at: at(6),
      operation: 'listing_detail',
      source: 'playwright',
      status: 'success',
      diagnostics: { observer_view_candidate: true },
    },
  ],
});

assert.equal(observerOnly.rawLastViewChange, 1);
assert.equal(observerOnly.possibleObserverViewsLastInterval, 1);
assert.equal(observerOnly.lastViewChange, 0);
assert.equal(observerOnly.velocity, 0);

// Raw +9 with one known COBALT visit => eight external possible views.
const mixedTraffic = computeListingSignal({
  ...observerBase,
  observations: [
    { captured_at: at(12), views: 10 },
    { captured_at: at(0), views: 19 },
  ],
  acquisition_events: [
    {
      occurred_at: at(6),
      operation: 'listing_detail',
      source: 'playwright',
      status: 'success',
      diagnostics: { observer_view_candidate: true },
    },
  ],
});

assert.equal(mixedTraffic.rawLastViewChange, 9);
assert.equal(mixedTraffic.possibleObserverViewsLastInterval, 1);
assert.equal(mixedTraffic.lastViewChange, 8);
assert.ok(
  mixedTraffic.marketplaceRawRecentVelocity > mixedTraffic.rawRecentVelocity,
  'raw marketplace velocity should remain available for audit while corrected velocity drives intelligence'
);

// Historical/partial acquisition telemetry must NOT be subtracted unless
// it explicitly carries observer_view_candidate=true.
const legacyTelemetry = computeListingSignal({
  ...observerBase,
  observations: [
    { captured_at: at(12), views: 10 },
    { captured_at: at(0), views: 11 },
  ],
  acquisition_events: [
    {
      occurred_at: at(6),
      operation: 'listing_detail',
      source: 'playwright',
      status: 'success',
      diagnostics: {},
    },
  ],
});

assert.equal(legacyTelemetry.rawLastViewChange, 1);
assert.equal(legacyTelemetry.possibleObserverViewsLastInterval, 0);
assert.equal(legacyTelemetry.lastViewChange, 1);

console.log('observer-view contamination regression tests passed');
