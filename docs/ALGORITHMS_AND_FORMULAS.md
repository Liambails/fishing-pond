# COBALT — algorithms and formulas

This document describes the deterministic calculations in the current V3.9.11 codebase. When thresholds/formulas change, update this file in the same commit.

## 0. Capture episodes

A complete capture from the same source family within 3 minutes of the previous observation for the same listing is treated as the same **collection episode**. The database observation row is updated to the freshest values rather than inserting another analytics row. Compact samples are retained in `raw_snapshot._capture_episode` for diagnostics.

This is an ingest-layer guardrail. It prevents browser retries, SPA rerenders, and rapid manual recaptures from advancing cadence or creating multiple evidence points. A source-family change (for example manual extension → scheduled worker) or listing-ended state change always creates a separate observation.

## 1. View velocity

COBALT preserves every raw observation, but attention scoring uses **independent evidence windows**. Starting from the freshest view observation and walking backwards, an earlier capture is independent only when it is at least 3 hours away from the next selected capture. A close manual revisit therefore updates the freshest state without acting like another full piece of evidence.

For independent observations `a` and `b`:

```text
hours = (b.captured_at - a.captured_at) / 1h
view_delta = b.views - a.views
raw_velocity = view_delta / (hours / 24)
```

A negative view delta is treated as a counter/parser/reset anomaly and returns no velocity; it is **not** negative demand.

Short independent intervals are deliberately damped before they can influence attention:

```text
3h interval  -> 35% trust
3h..12h      -> trust rises linearly from 35% to 100%
12h+         -> 100% trust
trusted_velocity = raw_velocity * trust
```

`recentVelocity` uses the latest two independent view observations. `previousVelocity` uses the preceding independent interval. Whole-history velocity remains available but is not the primary attention signal. Raw observations still appear in view history.

## 2. Listing attention score

The queue computes components on a 0–100 scale and dynamically renormalizes when optional data is unavailable.

Nominal weights:

```text
40% recent view velocity
20% close-adjusted attention
10% acceleration/deceleration
10% watcher/bid engagement
10% relative velocity vs comparable peers
10% evidence quality
```

### Velocity component

For recent views/day `v > 0`:

```text
velocity_score = 100 * (1 - exp(-v / 6))
```

`v <= 0` scores 0; unavailable velocity is omitted.

### Acceleration component

Uses `recent_velocity / previous_velocity` with deterministic bands. Roughly: >=3x -> 100, >=2x -> 85, >=1.5x -> 70, >=1.15x -> 58, near-steady -> 50, and progressively lower scores as activity decelerates.

### Close component

Close timing is context, not demand. It multiplies the already-observed velocity score:

```text
<= 24h remaining:  1.18x
<= 72h:            1.10x
<= 168h:           1.03x
later:              0.95x
```

The result is capped at 100. Clearly malformed close dates are ignored.

### Engagement component

When exposed by the marketplace:

```text
engagement = clamp(watchers * 10 + bids * 22, 0, 100)
```

If neither field exists, the component is omitted and weights renormalize.

### Relative peer component

Listings are grouped by inferred make/model/chassis/part key for queue-level peer comparison. Recent velocity is compared with the peer median and converted into deterministic score bands. This is separate from the richer Product CRM hybrid-v2 comparable matcher.

### Evidence component

Evidence quality uses **independent evidence-window count**, not raw capture count. Current count scores are 18, 36, 54, 68, 78 and 84 points for 1, 2, 3, 4, 5 and 6+ independent windows respectively. Evidence span adds up to 10 points over 48 hours, freshness adds 8 points within ~30h or 4 within ~54h, and each current collection failure removes 12 points.

Raw captures inside the same <3h window remain visible in history and are reported as close-together captures, but they do not increase confidence. Final listing confidence is capped at 99%.

### Queue states

- `TOO EARLY` — insufficient repeated evidence.
- `WATCHING` — promising/strong early attention without enough confirmation.
- `LOW SIGNAL` — enough early evidence, weak attention.
- `GOOD` — attention >=72 with repeated evidence, confidence and corroboration/standalone confirmation.
- `MUST_HAVE` — internal strict state: attention >=88, confidence >=80, >=4 observations, >=30h span, and peer corroboration.

`GOOD` generally requires >=3 independent evidence windows, >=20h evidence span and confidence >=55. Peer-corroborated promotion also requires the recent independent interval to span at least 6h. An isolated listing requires >=4 independent evidence windows, recent trusted velocity >=6 views/day, and a fully trusted recent interval of at least 12h. `MUST_HAVE` uses the same independent-window discipline.

### Observation Queue decision lifecycle and ordering

The Observation Queue is a decision inbox rather than an all-history table. A listing resolves to one of three operational states:

```text
active     -> unresolved marketplace research
promoted   -> used to create/link a Product
dismissed  -> deliberately removed from active consideration
```

`All` is a view across all three states. If `metadata.observation_queue_status` is absent, a listing with `product_id` is treated as `promoted`; otherwise it is treated as `active`. Dismiss/restore writes `observation_queue_status` and `observation_queue_decided_at` into existing `listings.metadata` JSONB. Promoting a listing writes `product_id`, marks the queue state `promoted`, and retains the source-listing provenance. No schema migration is required.

The default **Most promising** order is deterministic. The internal priority is:

```text
priority = signal_weight * 10000
         + confidence * 50
         + clamped_velocity * 20
         + independent_evidence_count * 25
         + positive_views_24h * 5
```

Where signal weights are `MUST_HAVE=5`, `GOOD=4`, `WATCHING=3`, `LOW SIGNAL=2`, `TOO EARLY=1`; confidence is clamped to 0–100, velocity to -20..100, independent evidence count to 0–10, and positive 24h view growth to 0–100. Signal class intentionally dominates the ordering. Ties fall back to the most recently observed listing. Alternate queue orders are Velocity, Confidence, and Newest.

The dashboard's **Promising** counter currently counts active `MUST_HAVE`, `GOOD`, and `WATCHING` listings.

## 3. Adaptive observation cadence

Initial learning ladder:

```text
n <= 1 observations -> 6h
n == 2              -> 6h
n == 3              -> 12h
```

Mature cadence (`n >= 4`):

```text
views/day >= 12 OR bid_delta >= 2                  -> 6h
views/day >= 6 OR bid_delta >= 1 OR watcher_delta >= 2 -> 8h
views/day >= 2 OR watcher_delta >= 1               -> 12h
own listing without stronger band                   -> 12h
otherwise                                            -> 24h
```

This cadence is evidence-driven, not anti-detection behavior.

## 4. Failure backoff

Ordinary/transient failures:

```text
failure 1 -> retry ~6h
failure 2 -> retry ~12h
failure 3 -> pause automatic scheduling; manual recovery required
```

Explicit CAPTCHA/access-denied/human-verification/unusual-traffic states pause immediately for manual recovery. A later successful observation resets failure state.

## 5. Comparable matcher — hybrid-v2

The Product CRM matcher uses structured identity plus fuzzy evidence.

### Structured part identity

Identity hierarchy:

```text
family -> subtype -> role/position
```

Example:

```text
window_control -> master_window_switch -> driver_master
```

Description text is included so phrases such as `RH FRONT (MASTER SWITCH)` can resolve role/subtype even when the title is generic.

### Hard/critical gates

- incompatible part family -> reject;
- known subtype conflict -> hard reject;
- vehicle make/model conflicts reject unless explicit expected fitment/chassis evidence resolves the apparent conflict;
- text similarity and price cannot override these gates.

### Structured score contributions

Current maximum positive contributions before clamps/penalties:

```text
same normalized part family       +0.24
same subtype                      +0.22
same role                         +0.09
same vehicle make                 +0.07
same vehicle model                +0.13
same chassis                      +0.15
part/reference overlap            +0.08
year overlap                      +0.03
text cosine                       up to +0.12
price compatibility               up to +0.03
```

Important penalties include role conflict, non-overlapping known reference codes, year conflict, and weak/outlier price compatibility.

### Cosine similarity

Text is normalized into token-frequency vectors. For vectors `x` and `y`:

```text
cosine(x,y) = (x · y) / (||x|| * ||y||)
```

Cosine is capped supporting evidence (`min(0.12, cosine * 0.12)`). It cannot establish identity by itself.

### Price compatibility

Price is compared to the current accepted-market median using log-distance:

```text
distance = abs(log(candidate_price / market_median))
price_compatibility = exp(-1.7 * distance)
```

Then:

```text
compatibility >= 0.72 -> +0.03
compatibility < 0.35  -> -0.06
compatibility < 0.52  -> -0.03
```

No market median -> price component omitted. Price never rescues a subtype/fitment mismatch.

### Decision thresholds

Auto-link/review require **critical structured identity**:

```text
same family
AND same subtype
AND (same model OR same chassis)
```

Then:

```text
score >= 0.70 -> AUTO_LINK
score >= 0.56 -> REVIEW
otherwise     -> REJECT
```

Manual reject/accept overrides are durable and take precedence over later automatic reconciliation.

## 6. Similarity-weighted market pricing

Only accepted comparable listings enter product pricing.

Comparable price weight for a scored automatic match:

```text
weight = clamp((match_score - 0.60) / 0.38, 0.25, 1.00)
```

Calibration examples:

```text
~98% match -> ~1.00 weight
~91% match -> ~0.82
~76% match -> ~0.42
```

Manual accepted matches use 0.90. Legacy/explicit links without V3.9 provenance use 0.75.

Market outputs:

- weighted median = market anchor;
- weighted 20th percentile = typical low;
- weighted 80th percentile = typical high;
- raw median retained as a reference.

Suggested test price:

```text
suggested_test_price = market_anchor * 0.86
```

## 7. Product opportunity score

For accepted active comparables, current deterministic product score is:

```text
score = clamp(
  demand      * 0.28
  + competition * 0.14
  + margin      * 0.22
  + evidence    * 0.16
  + fitment     * 0.10
  + supplier    * 0.10
  - risk        * 0.08
)
```

Current verdict bands:

```text
>= 80 -> STRONG
>= 67 -> PROMISING
>= 52 -> WATCH
else  -> WEAK
```

Demand uses average recent comparable velocity, median views and comparable breadth. Margin uses the similarity-weighted pricing anchor when available. Fitment/supplier/risk are explicit product inputs rather than inferred sales proof.

## 8. Relist identity

Relist matching is separate from product-comparable matching. It compares a newly seen/reopened offer against recently closed offers using observable evidence such as:

- same seller;
- normalized part family/structured identity;
- chassis/model/fitment;
- part/reference overlap;
- title cosine;
- description cosine;
- price proximity;
- timing after closure.

Views are deliberately **not** identity proof because counters can reset between lifecycle episodes.

## 9. Interpretation rules

- Views measure attention, not completed sales.
- Close timing can contextualize observed attention but must not create demand by itself.
- Repeated relists by one seller must not inflate independent seller count.
- Product pricing must use accepted comparables only.
- Structured automotive identity outranks fuzzy text and price similarity.

## Cross-listing opportunity detection (V3.9.12)

Opportunity detection deliberately requires corroboration across listings. A listing is eligible for clustering only when it has at least two independent observation windows and positive trusted view velocity. A family is surfaced only when at least three comparable listings have positive movement and the median trusted velocity is at least 3.5 views/day.

Clustering combines:

- marketplace/category compatibility;
- normalized title-token overlap;
- product-type agreement;
- make/brand and model/family agreement when present;
- shared model/platform/chassis codes;
- shared exact part/reference numbers.

Exact part/reference-number matches are weighted more strongly than semantic text. This prevents text similarity alone from declaring two technically incompatible variants identical.

`STRONG` currently requires at least five positive comparable listings, median velocity at least 6/day, and median listing-confidence at least 45. Otherwise a qualifying family is `EMERGING`.

A notification is generated for a new opportunity and for material strengthening, rather than on every scheduler pass. Material strengthening includes a signal-strength change, at least three additional positive listings, or roughly a 50% increase in median velocity. Dismissed opportunities are suppressed from ordinary strengthening notifications.

The signal means repeated marketplace attention, not confirmed sales or guaranteed demand.


## V3.9.13 marketplace behavioural-intent score

COBALT keeps passive attention separate from stronger marketplace intent. View velocity is still computed with the temporal guardrails above. The latest observation may additionally contribute a bounded behavioural-intent score when Trade Me exposes the data.

Inputs include:

- watchers — stronger than a passive view because the buyer saved the listing;
- bids — very strong purchase intent;
- public Q&A — split into purchase-intent, compatibility and condition questions;
- explicit sold state — strongest conversion evidence, but only when the page explicitly states the item sold.

The implementation uses saturating contributions rather than raw linear totals so one high-count field cannot dominate the whole score. Current caps are intentionally conservative:

```text
watchers              up to 32 points
bids                  up to 42 points
purchase-intent Q&A   up to 30 points
other public Q&A      up to 14 points
explicit sold         raises intent to at least 88/100
```

The result is a 0–100 `engagementScore`/buyer-intent measure. It is one component of listing attention and product demand; it does not replace independent view evidence.

### Q&A interpretation rules

COBALT does **not** use simple positive/negative sentiment as a sourcing signal. It classifies public questions by commercial function:

```text
purchase intent       offer, reserve, buy, collect, best/lowest price
compatibility         fit, model, chassis, year, engine, part number, connector, side
condition/risk        work, fault, damage, crack, rust, leak, repair, missing, wear
```

A buyer question is evidence of buyer concern/intent, not proof of a fact. Example: `Any rust?` increases condition-question evidence but does not mark the item as rusty. Seller answers are retained in the Q&A evidence and may be used by the listing-draft AI with cautious attribution.

### Product demand integration

`computeProductMetrics()` now combines trusted view velocity and view depth with the median behavioural-intent score, purchase-intent questions and explicit sold confirmations across accepted comparable listings. The weights are heuristic and deliberately bounded while COBALT accumulates enough outcome data to calibrate them empirically.

### Opportunity integration

Cross-listing opportunities record:

```text
marketplace_demand_score
median_buyer_intent_score
question_count
purchase_intent_questions
watchers
bids
sold_confirmations
```

A product family may become `STRONG` through sustained cross-listing view movement or through a combination of corroborated movement and stronger buyer-intent evidence. No opportunity is created from Q&A alone; repeated independent listing evidence remains required.

### Listing draft generation

A Trade Me listing draft is generated once per My Product and persisted. The source snapshot contains accepted research listings, descriptions, structured identity data and public Q&A. AI may rewrite sales copy, but must not invent or silently promote uncertain identity/condition claims. Individual fields can be regenerated independently.


## V3.9.15 standalone opportunity detection

Cross-listing corroboration remains the preferred sourcing evidence, but lack of comparables must not make a genuinely unusual product invisible. A listing can therefore create a standalone opportunity when it passes a deliberately harder evidence gate.

Current minimum standalone gate:

```text
independent evidence windows >= 4
evidence span               >= 30h
latest trusted interval     >= 12h
confidence                  >= 60
trusted view velocity       >= 6/day
AND at least one of:
  explicit sold evidence
  bids >= 1
  watchers >= 3
  purchase-intent Q&A >= 1
  buyer-intent score >= 55
  velocity >= 12/day
```

The standalone marketplace-demand score is bounded to 100 and combines trusted velocity, buyer intent, watchers, bids, purchase-intent Q&A and explicit sold evidence. These are heuristic weights while outcome history is still being accumulated.

A standalone signal becomes `STRONG` only when evidence is deeper: at least 5 independent windows over 48h, confidence >=72, velocity >=8/day, demand score >=72, and at least one exceptional buying/velocity signal (explicit sold, 2+ bids, buyer-intent >=65, or velocity >=14/day).

Standalone opportunities are not created for listings that are already members of a qualifying corroborated family. The UI explicitly states that reliable comparables are not yet available. The resulting recommendation is therefore higher-uncertainty supplier research, not a claim of established market demand.
