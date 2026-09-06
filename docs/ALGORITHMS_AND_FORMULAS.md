# COBALT — algorithms and formulas

This document describes the deterministic calculations in the current V3.9.8 codebase. When thresholds/formulas change, update this file in the same commit.

## 1. View velocity

For observations `a` and `b`:

```text
days = (b.captured_at - a.captured_at) / 24h
view_delta = b.views - a.views
velocity = view_delta / days
```

A negative view delta is treated as a counter/parser/reset anomaly and returns no velocity; it is **not** negative demand.

`recentVelocity` uses the latest two valid view observations. `previousVelocity` uses the preceding interval. Whole-history velocity remains available but is not the primary attention signal.

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

Evidence quality increases with observation count, evidence span, and recency, and decreases with recent collection failures:

```text
evidence = clamp(
  min(60, observation_count * 16)
  + min(20, span_hours / 24 * 8)
  + freshness_bonus
  - consecutive_failures * 12
)
```

Freshness bonus is 20 when refreshed within ~30h, 10 within ~54h, otherwise 0.

### Queue states

- `TOO EARLY` — insufficient repeated evidence.
- `WATCHING` — promising/strong early attention without enough confirmation.
- `LOW SIGNAL` — enough early evidence, weak attention.
- `GOOD` — attention >=72 with repeated evidence, confidence and corroboration/standalone confirmation.
- `MUST_HAVE` — internal strict state: attention >=88, confidence >=80, >=4 observations, >=30h span, and peer corroboration.

`GOOD` generally requires >=3 observations, >=20h evidence span and confidence >=55, plus either peer corroboration or a stronger standalone confirmation. An isolated listing can qualify after >=4 observations with sustained recent velocity.

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
