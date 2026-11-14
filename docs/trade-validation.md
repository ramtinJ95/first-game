# Trade validation

## Verdict

- **Rules slowest-day guard met:** all three alternating comparisons with main are within +10%; every measured head maximum is lower. Median and p95 costs are also reported, not hidden.
- **Passive Rome survival restored:** 2/20 early defeats, at the allowed maximum of two; main has 0/20. The all-AI control remains 0/20.
- Trade share 35.9–37.2%, treasury cap zero days in years 2–5, suitable payback 1.13–2.03 years, and the most valuable partner's war costs at least 14.8% of net income.
- **Owner decision:** accept the measured 88-day decision interval for PR51, rather than the original 60. The next slice, goods required by troops and buildings, adds choices. The raw harness still prints its original 60-day target as not met.
- Every previously met world, AI and peace guard remains met. The largest-power distribution was already not met on main (Persia leads 13/20); after trade it leads 9/20. This is not claimed as a newly met target.
- **Frame guard not established locally:** the software-GPU measurements below are variable and include increases above a tenth. They are not waived or described as a pass. Other software renderers and test workers shared the host; CI frame results must be read separately from this inconclusive comparison.

## Source and verification

The current branch is rebased onto main `bd2d05d`. Baseline simulation tables were rerun on peace main `9ee0cb1`; `24630b8` changes rendering and `bd2d05d` changes warnings/UI plus read-only battle-force event annotations, not state transitions or AI choices. Feature tables were recorded with the completed consent and free-strength fixes at `9ef87d0`.

The subsequent geometry and quote-pruning optimizations were compared directly with that revision for **109,500 paired days**: seeds 1–20, all-AI for ten years and passive Rome for five. Orders, events and rejections match every day; complete JSON states match every year. Thus the optimizations preserve every trajectory behind the world, AI and peace tables below. Unit tests additionally preserve every feasible road among all 6,400 city pairs at both land limits, and compare AI choices with exhaustive quotes across 48 seed, budget and administration cases.

Commands: `npm run sim:world`, `npm run sim:ai`, `npm run sim:peace`, and `npm run sim -- trade`, all with their default 20 seeds. World and peace run ten years; AI runs both five-year controls. Checks, unit and browser outcomes are listed in the PR description for its exact head.

## Cause of the four early losses, before the fix

This causal trace is pinned to `822e2d8` versus `a98a2de`, before the later main peace changes. Carthage takes Roma in all four failing seeds. Figures below are actual credited arrival gold before declaring war, not forecast income.

| Seed | Rome defeated | Carthage declares, trade / old main | Minor-funded arrival gold | Carthaginian recruit orders, trade / old main |
| ---- | ------------- | ----------------------------------- | ------------------------- | --------------------------------------------- |
| 7    | 690           | 291 / 452                           | 3,732.3                   | 4 / 2                                         |
| 18   | 673           | 283 / 561                           | 3,906.8                   | 4 / 2                                         |
| 19   | 705           | 293 / 609                           | 3,635.8                   | 4 / 2                                         |
| 20   | 721           | 320 / 1058                          | 3,394.8                   | 4 / 2                                         |

Carthage paid **zero opening costs** for those incoming, minor-funded routes. Faster recruitment brought forward the existing raw-army twice-as-strong pressure trigger. Seven of the eight relevant Carthaginian/Macedonian declarations use that fallback. Calling old main's war selector on the same trade states still chooses Rome in all eight: the new partner penalty is not the decisive trigger, and no Roman partnership was cut.

The smallest lever is commitment accounting: pressure now uses the **uncommitted strength already calculated for normal war selection**, instead of counting the same army against an existing front and again against Rome. The twice-as-strong threshold, trade income and recruitment prices are unchanged. Passive human invitations remain unaccepted; an AI-controlled player gives an explicit consent order.

Both outside-review acceptance defects are fixed: queued war intentions withdraw invitations before consent; acceptance rechecks reserves after already-chosen spending. The actual faction's war policy is used, not a great-power policy for minors. Known truce expiry and already-trained reinforcements are checked for next-day war without predicting battle rolls. Failed commitments lapse without payment and announce the reason.

## Slowest-day investigation and results

Profiling preceded game changes. The original instrumented peak was seed 1, day 7: about 38 ms in monthly trade selection, roughly 35 ms of that in geometry/pathfinding. Athenai and Lugdunum each held about 1,210 gold, below their 1,500 reserve alone, yet searched city pairs before rejecting the budget. Paths were **already cached** per world/endpoints/mode; the missing early affordability test caused the unnecessary cold work.

After budget and straight-distance cost bounds, the remaining repeatable peak was seed 1, day 922. It made 31 land searches, about 6.1 ms, of which 23 could not fit the 2,250 km march limit: Balkan/Italian armies searched all the way round the Mediterranean to African ports before rejecting the detour. This was not a cache flush (1,170 cached roads, below the 50,000 bound). A conservative circle-limited connectivity index now rejects those impossible walks, retaining the ordinary pathfinder and exact length check for all possible candidates. The trace's guard cost was 1.13 ms cold, 0.075 ms warm.

The next cold peak, day 1,004, searched 44 paths, including 26 sea paths, while choosing one route. Return per cost is bounded by goods × administrative share / 740; once its rounded maximum and capped income have been reached, further quotes cannot win. That bound now avoids losing candidates without changing the original first-tie winner. Daily hostility indexing also reads actual wars instead of an endpoint/army-owner Cartesian product.

`node scripts/bench-trade.ts` warms seed 21 for a year and measures complete AI plus immutable ticks for 5,475 days (seeds 1–3, five years each). Copy it unchanged to another checkout's `scripts/` to compare sources. It prints the peak's seed/day and AI/tick split. `node --cpu-prof --cpu-prof-interval=100 scripts/bench-trade.ts` records a CPU profile; profiling overhead is not used as the acceptance timing. The comparisons below use current main `bd2d05d`, alternate main/head order, and run without this worker's other CPU/GPU tests. No failed earlier trial is passed off as the final result.

| Round | Main median / p95 / max ms | Trade median / p95 / max ms | Slowest-day change |
| ----- | -------------------------- | --------------------------- | ------------------ |
| 1     | 0.898 / 1.640 / 5.230      | 1.035 / 1.719 / 4.340       | -17.0%             |
| 2     | 0.876 / 1.567 / 5.001      | 1.044 / 1.737 / 4.504       | -9.9%              |
| 3     | 0.899 / 1.597 / 5.395      | 1.077 / 1.799 / 4.409       | -18.3%             |

## Frame evidence, not a cleared guard

The existing `e2e/frame-bench.ts` was reused with the same six-day world, treasuries, armies and camera. Main removes only goods and trade records; the rules build adds its two live route markers; the look build adds the drawn merchants. The look view actually contains four merchant sprites at middle zoom and three at closest zoom. Full drawing uses the same SwiftShader flags and original warm-up/sampling windows. Order is main/rules/look, then look/rules/main. Rendering sources are on `24630b8`; the subsequent rebase adds UI/warning code, not renderer changes.

| Round | Zoom           | Main drawn median / p95 ms | Rules drawn median / p95 ms | Look drawn median / p95 ms |
| ----- | -------------- | -------------------------- | --------------------------- | -------------------------- |
| 1     | full @ middle  | 52.6 / 65.7                | 63.2 / 73.2                 | 49.6 / 58.4                |
| 1     | full @ closest | 48.6 / 55.8                | 71.9 / 99.5                 | 47.1 / 51.6                |
| 2     | full @ middle  | 50.8 / 63.9                | 45.5 / 52.2                 | 48.8 / 64.2                |
| 2     | full @ closest | 44.5 / 48.9                | 55.2 / 68.9                 | 52.2 / 64.5                |

The main closest-zoom baseline itself varies, and concurrent software renderers/test workers were observed. This does **not** establish a ≤10% regression bound. Green functional browser checks or a green CI frame smoke job are not substituted for that missing comparative result.

A further trial started at low host load on the `bd2d05d` builds and explicitly verified that the game clock advanced during each window and the look's exact figure sheets were ready. Load increased during the trial. Each cell below is **delivered interval median/p95; drawn work median/p95**, in ms.

| Zoom    | Main                   | Rules                  | Look                   |
| ------- | ---------------------- | ---------------------- | ---------------------- |
| Middle  | 33.3 / 50; 34.0 / 35.9 | 33.4 / 50; 38.4 / 40.9 | 50 / 66.7; 49.9 / 54.4 |
| Closest | 33.4 / 50; 36.8 / 39.7 | 33.4 / 50; 39.7 / 43.0 | 50 / 50.1; 47.6 / 51.4 |

The rules build's delivered interval stayed within 0.3%, with unchanged interval p95. Its drawn work still exceeds a tenth at middle zoom, and the look's intervals regress. This is mixed evidence, not a cleared rendering budget or an owner waiver.

## Trade targets

Peaceful Rome; other factions give no orders (same control as sim:buildings).
Policy: best affordable route first, otherwise cheapest available building; no recruitment or wars.
Trade share is gross expected receipts / (taxes + trade) on day 1095; war loss uses net income.

| seed | trade % Y3 | cap days Y2–5 | median decision gap | payback years min–max | largest partner war loss % | decisions |
| ---- | ---------- | ------------- | ------------------- | --------------------- | -------------------------- | --------- |
| 1    | 37.2       | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 2    | 37.2       | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 3    | 37.2       | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 4    | 37.2       | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 5    | 37.2       | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 6    | 37.2       | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 7    | 37.2       | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 8    | 37.2       | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 9    | 37.2       | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 10   | 37.2       | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 11   | 37.2       | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 12   | 37.2       | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 13   | 37.2       | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 14   | 37.2       | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 15   | 37.2       | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 16   | 35.9       | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |
| 17   | 35.9       | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |
| 18   | 35.9       | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |
| 19   | 35.9       | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |
| 20   | 35.9       | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |

| target                             | result          | met     |
| ---------------------------------- | --------------- | ------- |
| Trade 20–40% at Y3                 | 35.9–37.2%      | met     |
| Cap fewer than 30 days Y2–5        | max 0           | met     |
| Median decision gap ≤60 days       | median 88       | NOT met |
| Suitable routes repay in 1–3 years | 1.13–2.03 years | met     |
| Partner war cuts income ≥10%       | min 14.8%       | met     |

## World before

## The world after 10 years, seeds 1 to 20

| seed | rome | carthage | macedon | egypt | persia | largest     | alive | sieges | begun again after leaving | marches repeated | armies lost to sallies (men) | longest quiet war, with an army that could fight                            |
| ---- | ---- | -------- | ------- | ----- | ------ | ----------- | ----- | ------ | ------------------------- | ---------------- | ---------------------------- | --------------------------------------------------------------------------- |
| 1    | 0    | 18       | 0       | 16    | 20     | persia 20   | 3     | 215    | 0                         | 126              | 0 (3078)                     | 208 days, macedon from day 1519; could take: 13 days, macedon from day 511  |
| 2    | 7    | 12       | 9       | 24    | 13     | egypt 24    | 5     | 218    | 3                         | 99               | 0 (3577)                     | 4 days, carthage from day 308; could take: 4 days, carthage from day 308    |
| 3    | 7    | 10       | 4       | 13    | 23     | persia 23   | 5     | 235    | 1                         | 74               | 0 (3915)                     | 50 days, macedon from day 2244; could take: 9 days, rome from day 1711      |
| 4    | 10   | 16       | 6       | 0     | 18     | persia 18   | 4     | 209    | 2                         | 134              | 0 (2982)                     | 137 days, egypt from day 2876; could take: 13 days, rome from day 3562      |
| 5    | 5    | 19       | 8       | 19    | 7      | carthage 19 | 5     | 219    | 3                         | 85               | 0 (2920)                     | 9 days, egypt from day 1095; could take: 9 days, egypt from day 1095        |
| 6    | 0    | 18       | 15      | 14    | 16     | carthage 18 | 4     | 213    | 0                         | 89               | 0 (3074)                     | 51 days, rome from day 2723; could take: 7 days, egypt from day 1696        |
| 7    | 17   | 13       | 4       | 13    | 11     | rome 17     | 5     | 207    | 2                         | 66               | 0 (2129)                     | 17 days, rome from day 1000; could take: 9 days, persia from day 725        |
| 8    | 17   | 15       | 0       | 4     | 18     | persia 18   | 4     | 193    | 0                         | 86               | 0 (940)                      | 93 days, macedon from day 1363; could take: 51 days, egypt from day 275     |
| 9    | 13   | 13       | 11      | 17    | 7      | egypt 17    | 5     | 232    | 0                         | 92               | 0 (3719)                     | 37 days, carthage from day 308; could take: 12 days, egypt from day 552     |
| 10   | 12   | 9        | 8       | 13    | 17     | persia 17   | 5     | 227    | 0                         | 106              | 0 (3019)                     | 81 days, persia from day 1166; could take: 10 days, carthage from day 248   |
| 11   | 11   | 14       | 0       | 1     | 26     | persia 26   | 4     | 194    | 0                         | 111              | 0 (2149)                     | 212 days, egypt from day 3379; could take: 14 days, egypt from day 2636     |
| 12   | 12   | 11       | 11      | 1     | 19     | persia 19   | 5     | 215    | 5                         | 72               | 0 (2435)                     | 18 days, egypt from day 1844; could take: 1 days, egypt from day 223        |
| 13   | 16   | 11       | 1       | 13    | 17     | persia 17   | 5     | 216    | 2                         | 73               | 0 (3197)                     | 66 days, persia from day 790; could take: 7 days, macedon from day 3464     |
| 14   | 0    | 16       | 1       | 14    | 14     | carthage 16 | 4     | 220    | 4                         | 76               | 0 (2759)                     | 221 days, rome from day 2516; could take: 12 days, carthage from day 245    |
| 15   | 0    | 4        | 13      | 12    | 22     | persia 22   | 4     | 201    | 0                         | 120              | 0 (2158)                     | 98 days, rome from day 1785; could take: 7 days, persia from day 3017       |
| 16   | 0    | 16       | 7       | 7     | 20     | persia 20   | 4     | 204    | 2                         | 89               | 0 (4074)                     | 14 days, rome from day 1142; could take: 14 days, rome from day 1142        |
| 17   | 15   | 12       | 1       | 7     | 18     | persia 18   | 5     | 168    | 3                         | 172              | 0 (2213)                     | 224 days, macedon from day 1307; could take: 29 days, rome from day 534     |
| 18   | 1    | 13       | 11      | 1     | 21     | persia 21   | 5     | 171    | 1                         | 75               | 0 (1939)                     | 168 days, egypt from day 2756; could take: 24 days, rome from day 536       |
| 19   | 6    | 17       | 7       | 0     | 32     | persia 32   | 4     | 197    | 0                         | 111              | 0 (2658)                     | 7 days, carthage from day 2611; could take: 7 days, carthage from day 2611  |
| 20   | 3    | 23       | 0       | 12    | 14     | carthage 23 | 4     | 213    | 3                         | 65               | 0 (3456)                     | 135 days, macedon from day 1714; could take: 20 days, macedon from day 1332 |

Targets:

- The largest power holds at most half the 80 cities: 20/20. met (at least 16).
- At least three powers alive: 20/20. met (at least 16).
- Seeds each power is the largest: rome 1, carthage 4, macedon 0, egypt 2, persia 13. NOT met (none more than 8).
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Sieges begun: 4167. Begun again by the same power within 30 days of ordering its besiegers away from the city: 31.
- The same march ordered again within 30 days: 1921.
- Wars declared by a great power: 1796, of which 20 were declared less than a year before the end and had seen no act yet, and are left out of what follows. Of the other 1776: days until it first fought, besieged, or marched on the enemy: median 1, 90th percentile 81. Never within a year, or before the war ended: 93.
- Attacks a great power lost to the same enemy within 50 km and 90 days of one it lost before: 149.
- Changes of stance by one army in one battle, over 2001 army-battles: median 1, most 2, none in 440.
- Armies lost to sallies: 0. Men lost to sallies: 56391.
- Longest stretch a power at war had an idle army that could reach an enemy city, no army on the move, and gave no order: median 66 days, longest 224 days.
- The same, counting only days on which its idle armies together had the men to take an enemy city they had a route to: median 10 days, longest 51 days.

## The first city each power takes, seeds 1 to 5

| seed | power    | city               | battle on day | days fought | lost, power / defender | siege from day | fell on day |
| ---- | -------- | ------------------ | ------------- | ----------- | ---------------------- | -------------- | ----------- |
| 1    | rome     | Hippo Regius       | no battle     |             |                        | 320            | 363         |
| 1    | carthage | Cirta              | no battle     |             |                        | 190            | 206         |
| 1    | macedon  | Ambrakia           | no battle     |             |                        | 185            | 209         |
| 1    | egypt    | Ammon              | 194           | 1           | 14 / 172               | 195            | 219         |
| 1    | persia   | Artaxata           | 229           | 1           | 30 / 171               | 230            | 260         |
| 2    | rome     | Augusta Vindelicum | 279           | 1           | 16 / 172               | 280            | 306         |
| 2    | carthage | Caralis            | 191           | 1           | 32 / 171               | 191            | 255         |
| 2    | macedon  | Ambrakia           | 186           | 1           | 32 / 171               | 185            | 219         |
| 2    | egypt    | Ammon              | no battle     |             |                        | 195            | 219         |
| 2    | persia   | Artaxata           | 229           | 1           | 16 / 172               | 230            | 266         |
| 3    | rome     | Augusta Vindelicum | 279           | 1           | 16 / 172               | 280            | 327         |
| 3    | carthage | Caralis            | 191           | 1           | 16 / 172               | 191            | 229         |
| 3    | macedon  | Ambrakia           | no battle     |             |                        | 185            | 194         |
| 3    | egypt    | Antiocheia         | 216           | 1           | 21 / 171               | 217            | 261         |
| 3    | persia   | Artaxata           | 229           | 1           | 30 / 171               | 230            | 268         |
| 4    | rome     | Augusta Vindelicum | no battle     |             |                        | 206            | 230         |
| 4    | carthage | Caralis            | 191           | 1           | 28 / 171               | 191            | 215         |
| 4    | macedon  | Athenai            | 190           | 1           | 28 / 171               | 191            | 214         |
| 4    | egypt    | Antiocheia         | 216           | 1           | 32 / 171               | 217            | 248         |
| 4    | persia   | Babylon            | 210           | 1           | 26 / 171               | 211            | 244         |
| 5    | rome     | Augusta Vindelicum | 205           | 1           | 14 / 172               | 206            | 229         |
| 5    | carthage | Caralis            | no battle     |             |                        | 191            | 202         |
| 5    | macedon  | Athenai            | no battle     |             |                        | 191            | 202         |
| 5    | egypt    | Ammon              | no battle     |             |                        | 195            | 219         |
| 5    | persia   | Artaxata           | 229           | 1           | 21 / 171               | 230            | 261         |

## World after

## The world after 10 years, seeds 1 to 20

| seed | rome | carthage | macedon | egypt | persia | largest     | alive | sieges | begun again after leaving | marches repeated | armies lost to sallies (men) | longest quiet war, with an army that could fight                            |
| ---- | ---- | -------- | ------- | ----- | ------ | ----------- | ----- | ------ | ------------------------- | ---------------- | ---------------------------- | --------------------------------------------------------------------------- |
| 1    | 0    | 31       | 0       | 16    | 6      | carthage 31 | 3     | 176    | 2                         | 29               | 0 (2640)                     | 87 days, macedon from day 1621; could take: 14 days, macedon from day 434   |
| 2    | 15   | 13       | 0       | 16    | 13     | egypt 16    | 4     | 216    | 1                         | 99               | 0 (2253)                     | 35 days, macedon from day 1241; could take: 18 days, macedon from day 1084  |
| 3    | 3    | 20       | 4       | 15    | 14     | carthage 20 | 5     | 228    | 1                         | 93               | 0 (3579)                     | 212 days, rome from day 2045; could take: 8 days, macedon from day 2962     |
| 4    | 5    | 27       | 0       | 18    | 11     | carthage 27 | 4     | 234    | 4                         | 109              | 0 (3745)                     | 28 days, macedon from day 1743; could take: 11 days, carthage from day 943  |
| 5    | 13   | 11       | 7       | 11    | 18     | persia 18   | 5     | 246    | 3                         | 81               | 0 (3552)                     | 5 days, macedon from day 2531; could take: 5 days, macedon from day 2531    |
| 6    | 13   | 14       | 2       | 5     | 24     | persia 24   | 5     | 223    | 1                         | 74               | 0 (3226)                     | 113 days, persia from day 1677; could take: 17 days, rome from day 866      |
| 7    | 11   | 10       | 17      | 11    | 16     | macedon 17  | 5     | 242    | 4                         | 107              | 0 (4812)                     | 5 days, macedon from day 3198; could take: 5 days, macedon from day 3198    |
| 8    | 5    | 10       | 15      | 13    | 11     | macedon 15  | 5     | 244    | 1                         | 96               | 0 (3891)                     | 12 days, macedon from day 1523; could take: 12 days, macedon from day 1523  |
| 9    | 6    | 17       | 2       | 9     | 20     | persia 20   | 5     | 235    | 0                         | 154              | 0 (3186)                     | 88 days, macedon from day 2170; could take: 15 days, macedon from day 2840  |
| 10   | 8    | 13       | 3       | 25    | 1      | egypt 25    | 5     | 204    | 2                         | 119              | 0 (2573)                     | 211 days, macedon from day 2888; could take: 17 days, macedon from day 1913 |
| 11   | 0    | 25       | 0       | 6     | 32     | persia 32   | 3     | 179    | 0                         | 96               | 0 (2590)                     | 164 days, macedon from day 1151; could take: 39 days, persia from day 1982  |
| 12   | 15   | 19       | 1       | 8     | 21     | persia 21   | 5     | 249    | 4                         | 105              | 0 (4169)                     | 109 days, macedon from day 3290; could take: 6 days, rome from day 312      |
| 13   | 1    | 28       | 6       | 11    | 20     | carthage 28 | 5     | 219    | 1                         | 68               | 0 (3257)                     | 66 days, macedon from day 1875; could take: 6 days, macedon from day 1935   |
| 14   | 0    | 21       | 0       | 3     | 28     | persia 28   | 3     | 189    | 3                         | 43               | 0 (3325)                     | 71 days, rome from day 2447; could take: 4 days, rome from day 1944         |
| 15   | 0    | 16       | 0       | 19    | 23     | persia 23   | 3     | 192    | 1                         | 114              | 0 (3382)                     | 66 days, rome from day 1227; could take: 23 days, carthage from day 2514    |
| 16   | 7    | 21       | 9       | 8     | 15     | carthage 21 | 5     | 244    | 6                         | 97               | 0 (3795)                     | 8 days, carthage from day 1484; could take: 8 days, carthage from day 1484  |
| 17   | 5    | 4        | 14      | 19    | 16     | egypt 19    | 5     | 219    | 0                         | 88               | 0 (2261)                     | 88 days, rome from day 1285; could take: 2 days, rome from day 722          |
| 18   | 0    | 17       | 7       | 17    | 21     | persia 21   | 4     | 220    | 2                         | 104              | 0 (3146)                     | 240 days, rome from day 2650; could take: 36 days, egypt from day 281       |
| 19   | 20   | 12       | 2       | 9     | 21     | persia 21   | 5     | 239    | 4                         | 88               | 0 (4632)                     | 50 days, rome from day 868; could take: 5 days, rome from day 436           |
| 20   | 1    | 19       | 13      | 20    | 8      | egypt 20    | 5     | 246    | 1                         | 93               | 0 (3202)                     | 86 days, rome from day 2365; could take: 8 days, rome from day 714          |

Targets:

- The largest power holds at most half the 80 cities: 20/20. met (at least 16).
- At least three powers alive: 20/20. met (at least 16).
- Seeds each power is the largest: rome 0, carthage 5, macedon 2, egypt 4, persia 9. NOT met (none more than 8).
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Sieges begun: 4444. Begun again by the same power within 30 days of ordering its besiegers away from the city: 41.
- The same march ordered again within 30 days: 1857.
- Wars declared by a great power: 1898, of which 17 were declared less than a year before the end and had seen no act yet, and are left out of what follows. Of the other 1881: days until it first fought, besieged, or marched on the enemy: median 1, 90th percentile 83. Never within a year, or before the war ended: 100.
- Attacks a great power lost to the same enemy within 50 km and 90 days of one it lost before: 143.
- Changes of stance by one army in one battle, over 2298 army-battles: median 1, most 2, none in 504.
- Armies lost to sallies: 0. Men lost to sallies: 67216.
- Longest stretch a power at war had an idle army that could reach an enemy city, no army on the move, and gave no order: median 71 days, longest 240 days.
- The same, counting only days on which its idle armies together had the men to take an enemy city they had a route to: median 8 days, longest 39 days.

## The first city each power takes, seeds 1 to 5

| seed | power    | city               | battle on day | days fought | lost, power / defender | siege from day | fell on day |
| ---- | -------- | ------------------ | ------------- | ----------- | ---------------------- | -------------- | ----------- |
| 1    | rome     | Ambrakia           | no battle     |             |                        | 194            | 215         |
| 1    | carthage | Capua              | no battle     |             |                        | 184            | 225         |
| 1    | macedon  | Ariminum           | no battle     |             |                        | 197            | 250         |
| 1    | egypt    | Ammon              | 160           | 1           | 14 / 172               | 161            | 192         |
| 1    | persia   | Artaxata           | 192           | 1           | 23 / 171               | 193            | 230         |
| 2    | rome     | Ambrakia           | 182           | 1           | 30 / 171               | 183            | 228         |
| 2    | carthage | Caralis            | 136           | 1           | 25 / 171               | 136            | 178         |
| 2    | macedon  | Ariminum           | no battle     |             |                        | 183            | 237         |
| 2    | egypt    | Ammon              | no battle     |             |                        | 146            | 157         |
| 2    | persia   | Artaxata           | 204           | 1           | 16 / 172               | 205            | 238         |
| 3    | rome     | Ambrakia           | no battle     |             |                        | 184            | 193         |
| 3    | carthage | Capua              | no battle     |             |                        | 175            | 228         |
| 3    | macedon  | Ariminum           | no battle     |             |                        | 185            | 226         |
| 3    | egypt    | Damaskos           | no battle     |             |                        | 163            | 175         |
| 3    | persia   | Artaxata           | 201           | 1           | 23 / 171               | 202            | 234         |
| 4    | rome     | Augusta Vindelicum | no battle     |             |                        | 161            | 176         |
| 4    | carthage | Caralis            | 141           | 1           | 28 / 171               | 141            | 184         |
| 4    | macedon  | Athenai            | 157           | 1           | 26 / 171               | 158            | 178         |
| 4    | egypt    | Damaskos           | 151           | 1           | 28 / 171               | 152            | 179         |
| 4    | persia   | Babylon            | 173           | 1           | 30 / 171               | 174            | 230         |
| 5    | rome     | Augusta Vindelicum | 163           | 1           | 32 / 171               | 164            | 193         |
| 5    | carthage | Caralis            | no battle     |             |                        | 134            | 147         |
| 5    | macedon  | Athenai            | no battle     |             |                        | 156            | 165         |
| 5    | egypt    | Ammon              | no battle     |             |                        | 143            | 152         |
| 5    | persia   | Artaxata           | 201           | 1           | 26 / 171               | 202            | 252         |

## AI before: both controls

## Every faction under the AI

20 seeds, 5 years. Means over the seeds. Cities: start, then after each year. Storms and battles are won/lost.

| power    | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms  | battles  |
| -------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | ------- | -------- |
| rome     | 4.0 → 4.8 → 6.3 → 7.4 → 8.1 → 7.9    | 2,874 | 3,695 | 8,039  | 4,186    | 8.8  | 14.4  | 10.6 | 18.2   | 4.7/0.0 | 13.2/3.7 |
| carthage | 4.0 → 5.8 → 7.2 → 9.1 → 9.6 → 10.7   | 3,637 | 3,841 | 9,707  | 4,971    | 11.6 | 16.0  | 9.3  | 19.8   | 6.4/0.0 | 14.7/3.9 |
| macedon  | 4.0 → 6.0 → 6.3 → 6.3 → 6.4 → 6.1    | 2,577 | 2,729 | 7,256  | 3,419    | 8.6  | 13.8  | 11.7 | 18.5   | 4.9/0.0 | 13.5/6.0 |
| egypt    | 4.0 → 6.1 → 8.0 → 7.6 → 8.7 → 8.2    | 3,016 | 3,612 | 8,453  | 4,336    | 9.8  | 15.5  | 11.4 | 20.8   | 6.0/0.0 | 17.1/7.6 |
| persia   | 4.0 → 6.0 → 8.2 → 10.8 → 12.5 → 14.9 | 3,810 | 3,644 | 11,585 | 6,859    | 11.6 | 17.2  | 6.3  | 19.9   | 8.5/0.0 | 19.6/3.1 |

- Orders given: 16,532. Rejected: 439 (2.66%).
  - 428 × offerPeace: An offer of peace was already made today in this war; it waits for an answer
  - 2 × retreat: army # is not in a battle
  - 2 × moveArmy: faction numantia is out of the game
  - 2 × declareWar: persia is already at war with egypt
  - 1 × declareWar: rome is already at war with egypt
  - 1 × moveArmy: faction lutetia is out of the game
  - 1 × offerPeace: rome is not at war with cyrene
  - 1 × offerPeace: faction iol-caesarea is out of the game
  - 1 × moveArmy: faction hierosolyma is out of the game
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 23,406 of 182,500 power-days of the powers the AI runs.
  - 17762 × too few men alone to blockade the garrison of every city it reaches, gathering
  - 1992 × resting, morale below MARCH_MORALE
  - 1862 × waiting for recruits that muster within RALLY_WAIT_DAYS
  - 1047 × other
  - 412 × guarding the capital, the weakest army there
  - 331 × every enemy city it reaches is besieged under another power's lead
- Decisions per day, all factions: mean 0.60 ms, p99 2.29 ms, max 8.20 ms. One tick: mean 0.68 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 214 days, longest 331 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,555. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 79.0%.
- Armies that lost a battle and were still alive 30 days later: 823 of 1,617 (50.9%).
- Marches ordered: 6,804. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,633. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
  - broke to a city: 127 of 143 alive (88.8%). Lost: 11 × gone, 4 × battle, 1 × defeat.
  - broke to the field: 428 of 1,144 alive (37.4%). Lost: 707 × defeat, 8 × battle, 1 × gone.
  - destroyed in the battle: 0 of 10 alive (0.0%). Lost: 10 × battle.
  - surrendered: 0 of 1 alive (0.0%). Lost: 1 × surrender.
  - withdrew to a city: 142 of 168 alive (84.5%). Lost: 26 × gone.
  - withdrew to the field: 126 of 151 alive (83.4%). Lost: 21 × defeat, 2 × gone, 2 × surrender.

### Conquest and economy by year

Medians over the 20 seeds, taken at the end of each year. Stores are each power's, read in the order rome, carthage, macedon, egypt, persia. Captures, fates, and storm losses add up the year's events over all seeds.

| year | independent of 60 | cities per power    | gold                                  | food                                   | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | ------------------- | ------------------------------------- | -------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 52                | 5 / 6 / 6 / 6 / 6   | 2,982 / 3,629 / 3,998 / 3,717 / 3,391 | 2,556 / 3,179 / 3,373 / 3,174 / 2,949  | 2,300 / 3,009 / 3,196 / 3,084 / 2,946 | 0% / 12% / 88% of 201          | 18% (25)               | 102 / 0 / 99              | 28                | 1             |
| 2    | 44                | 6 / 7 / 7 / 8 / 8   | 3,012 / 3,616 / 2,911 / 3,193 / 3,073 | 4,695 / 6,014 / 5,701 / 6,326 / 6,425  | 2,998 / 3,222 / 3,162 / 3,475 / 3,720 | 0% / 30% / 70% of 307          | 18% (87)               | 291 / 8 / 8               | 163               | 48            |
| 3    | 40                | 8 / 9 / 7 / 8 / 11  | 3,601 / 3,502 / 2,739 / 3,037 / 3,734 | 6,516 / 7,691 / 6,893 / 7,218 / 8,804  | 3,161 / 3,889 / 3,316 / 3,595 / 4,886 | 0% / 42% / 58% of 359          | 18% (147)              | 352 / 3 / 4               | 256               | 71            |
| 4    | 34                | 9 / 10 / 7 / 9 / 12 | 2,998 / 3,698 / 2,918 / 3,237 / 3,889 | 7,479 / 8,498 / 7,224 / 7,969 / 10,191 | 3,556 / 3,918 / 3,387 / 4,329 / 5,966 | 0% / 53% / 47% of 330          | 19% (166)              | 321 / 6 / 3               | 246               | 73            |
| 5    | 33                | 8 / 10 / 7 / 8 / 15 | 3,814 / 3,860 / 2,967 / 3,259 / 3,599 | 8,039 / 9,561 / 7,811 / 8,159 / 11,904 | 3,957 / 4,954 / 3,602 / 4,516 / 6,600 | 0% / 56% / 44% of 339          | 18% (183)              | 333 / 5 / 1               | 290               | 93            |

Targets over the seeds:

- Half the 60 minor cities independent at the end of year 2: median 44, lowest 39, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 33, lowest 21, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 84 of 88 such power-years grew, 4 did not. met (met at 90% or more). Those that did not: carthage in year 5 2, carthage in year 4 1, persia in year 5 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.

## Rome gives no orders

20 seeds, 5 years. Means over the seeds. Cities: start, then after each year. Storms and battles are won/lost.

| power          | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms  | battles  |
| -------------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | ------- | -------- |
| rome (passive) | 4.0 → 4.0 → 2.9 → 0.4 → 0.1 → 0.1    | 0     | 451   | 199    | 149      | 0.0  | 0.0   | 4.0  | 0.0    | 0.0/0.0 | 1.1/5.9  |
| carthage       | 4.0 → 6.4 → 8.4 → 11.3 → 13.4 → 14.6 | 4,966 | 4,208 | 12,980 | 8,109    | 10.9 | 14.6  | 4.1  | 16.9   | 5.8/0.0 | 18.3/2.0 |
| macedon        | 4.0 → 6.4 → 7.7 → 8.8 → 8.8 → 9.3    | 3,279 | 3,242 | 9,151  | 4,798    | 9.2  | 14.3  | 9.0  | 18.2   | 6.0/0.0 | 15.8/3.9 |
| egypt          | 4.0 → 6.2 → 7.2 → 7.9 → 7.8 → 8.3    | 3,051 | 3,573 | 8,143  | 4,169    | 10.1 | 14.6  | 10.4 | 18.9   | 5.7/0.0 | 15.1/5.9 |
| persia         | 4.0 → 6.0 → 8.3 → 10.9 → 12.8 → 14.1 | 4,120 | 3,735 | 11,609 | 7,217    | 10.7 | 16.2  | 6.1  | 18.6   | 8.3/0.0 | 18.3/2.5 |

- Orders given: 12,636. Rejected: 261 (2.07%).
  - 250 × offerPeace: An offer of peace was already made today in this war; it waits for an answer
  - 2 × declareWar: persia is already at war with egypt
  - 1 × declareWar: persia is already at war with carthage
  - 1 × moveArmy: faction salamis is out of the game
  - 1 × moveArmy: faction massalia is out of the game
  - 1 × moveArmy: faction rhagai is out of the game
  - 1 × moveArmy: faction pergamon is out of the game
  - 1 × moveArmy: faction tanais is out of the game
  - 1 × moveArmy: faction cidamus is out of the game
  - 1 × moveArmy: faction phasis is out of the game
  - 1 × moveArmy: faction prophthasia is out of the game
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 18,172 of 146,000 power-days of the powers the AI runs.
  - 14319 × too few men alone to blockade the garrison of every city it reaches, gathering
  - 1554 × waiting for recruits that muster within RALLY_WAIT_DAYS
  - 1063 × resting, morale below MARCH_MORALE
  - 699 × every enemy city it reaches is besieged under another power's lead
  - 442 × other
  - 95 × guarding the capital, the weakest army there
- Decisions per day, all factions: mean 0.44 ms, p99 1.77 ms, max 4.76 ms. One tick: mean 0.58 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 195 days, longest 281 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,366. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 80.6%.
- Armies that lost a battle and were still alive 30 days later: 641 of 1,403 (45.7%).
- Marches ordered: 5,038. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,404. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
  - broke to a city: 147 of 160 alive (91.9%). Lost: 9 × gone, 4 × battle.
  - broke to the field: 310 of 1,005 alive (30.8%). Lost: 682 × defeat, 13 × battle.
  - destroyed in the battle: 0 of 14 alive (0.0%). Lost: 14 × battle.
  - withdrew to a city: 110 of 130 alive (84.6%). Lost: 20 × gone.
  - withdrew to the field: 74 of 94 alive (78.7%). Lost: 20 × defeat.
- Seeds where a power declares war on Rome: 20/20.

### Conquest and economy by year

Medians over the 20 seeds, taken at the end of each year. Stores are each power's, read in the order rome, carthage, macedon, egypt, persia. Captures, fates, and storm losses add up the year's events over all seeds.

| year | independent of 60 | cities per power    | gold                                  | food                                  | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | ------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 51                | 4 / 6 / 6 / 6 / 6   | 8,739 / 3,792 / 3,937 / 3,652 / 3,432 | 3,582 / 3,279 / 3,431 / 3,129 / 2,985 | 2,835 / 3,254 / 3,194 / 3,139 / 3,026 | 0% / 8% / 92% of 179           | 20% (15)               | 99 / 0 / 80               | 2                 | 0             |
| 2    | 46                | 3 / 8 / 8 / 7 / 8   | 8,896 / 3,666 / 3,578 / 3,415 / 3,136 | 3,973 / 6,765 / 6,380 / 6,198 / 6,712 | 3,089 / 3,744 / 3,400 / 3,378 / 3,637 | 0% / 39% / 61% of 222          | 19% (86)               | 221 / 1 / 0               | 112               | 61            |
| 3    | 41                | 0 / 11 / 9 / 9 / 11 | 0 / 3,138 / 3,517 / 3,216 / 3,780     | 0 / 9,876 / 7,448 / 7,135 / 8,581     | 0 / 4,522 / 3,503 / 3,841 / 4,748     | 0% / 50% / 50% of 269          | 19% (131)              | 263 / 6 / 0               | 172               | 58            |
| 4    | 38                | 0 / 13 / 9 / 8 / 13 | 0 / 4,037 / 3,058 / 3,215 / 3,449     | 0 / 11,931 / 8,112 / 7,597 / 10,064   | 0 / 6,748 / 3,948 / 3,671 / 6,204     | 0% / 56% / 44% of 258          | 19% (138)              | 251 / 7 / 0               | 185               | 64            |
| 5    | 34                | 0 / 16 / 9 / 8 / 14 | 0 / 4,079 / 3,284 / 3,451 / 3,715     | 0 / 13,443 / 8,467 / 8,471 / 11,215   | 0 / 8,770 / 4,321 / 3,680 / 7,040     | 0% / 57% / 43% of 264          | 19% (146)              | 259 / 2 / 3               | 196               | 41            |

Targets over the seeds:

- Half the 60 minor cities independent at the end of year 2: median 46, lowest 42, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 34, lowest 26, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 139 of 143 such power-years grew, 4 did not. met (met at 90% or more). Those that did not: carthage in year 5 3, carthage in year 4 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 19/20, year 5 20/20; in every year from year 2: 19/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.

Seed 1 played twice ends in the same state: yes.

## AI after: both controls

## Every faction under the AI

20 seeds, 5 years. Means over the seeds. Cities: start, then after each year. Storms and battles are won/lost.

| power    | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms   | battles  |
| -------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | -------- | -------- |
| rome     | 4.0 → 4.4 → 5.4 → 5.6 → 5.5 → 6.0    | 2,884 | 3,470 | 6,746  | 3,205    | 8.8  | 12.2  | 10.2 | 16.2   | 3.9/0.0  | 13.5/3.9 |
| carthage | 4.0 → 6.2 → 8.7 → 10.3 → 12.3 → 13.4 | 4,687 | 4,375 | 11,476 | 4,604    | 12.8 | 19.3  | 9.9  | 24.2   | 8.9/0.0  | 19.7/4.6 |
| macedon  | 4.0 → 5.4 → 6.4 → 6.4 → 6.0 → 5.5    | 2,272 | 2,924 | 6,300  | 2,536    | 9.8  | 13.9  | 12.5 | 18.6   | 5.7/0.0  | 14.0/7.4 |
| egypt    | 4.0 → 6.5 → 7.2 → 9.3 → 9.7 → 10.3   | 3,769 | 3,990 | 9,289  | 4,244    | 12.0 | 18.3  | 12.0 | 24.3   | 8.7/0.0  | 20.6/6.6 |
| persia   | 4.0 → 6.2 → 9.1 → 11.8 → 14.0 → 14.6 | 4,048 | 4,045 | 11,973 | 5,982    | 12.3 | 20.1  | 9.5  | 24.0   | 11.4/0.0 | 22.7/5.8 |

- Orders given: 21,462. Rejected: 514 (2.39%).
  - 503 × offerPeace: An offer of peace was already made today in this war; it waits for an answer
  - 4 × retreat: army # is not in a battle
  - 1 × declareWar: persia is already at war with carthage
  - 1 × moveArmy: faction phasis is out of the game
  - 1 × declareWar: faction athenai is out of the game
  - 1 × moveArmy: faction rhagai is out of the game
  - 1 × moveArmy: faction tarsos is out of the game
  - 1 × openTrade: Karmana has no free route slot
  - 1 × moveArmy: faction hierosolyma is out of the game
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 25,455 of 182,500 power-days of the powers the AI runs.
  - 19428 × too few men alone to blockade the garrison of every city it reaches, gathering
  - 2530 × waiting for recruits that muster within RALLY_WAIT_DAYS
  - 2016 × resting, morale below MARCH_MORALE
  - 917 × other
  - 285 × guarding the capital, the weakest army there
  - 279 × every enemy city it reaches is besieged under another power's lead
- Decisions per day, all factions: mean 0.83 ms, p99 2.85 ms, max 11.95 ms. One tick: mean 0.89 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 203 days, longest 395 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,801. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 76.2%.
- Armies that lost a battle and were still alive 30 days later: 886 of 1,866 (47.5%).
- Marches ordered: 8,266. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,864. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
  - broke to a city: 137 of 159 alive (86.2%). Lost: 20 × gone, 2 × defeat.
  - broke to the field: 404 of 1,248 alive (32.4%). Lost: 822 × defeat, 15 × battle, 6 × gone, 1 × surrender.
  - destroyed in the battle: 0 of 23 alive (0.0%). Lost: 23 × battle.
  - surrendered: 0 of 3 alive (0.0%). Lost: 3 × surrender.
  - withdrew to a city: 182 of 212 alive (85.8%). Lost: 30 × gone.
  - withdrew to the field: 163 of 221 alive (73.8%). Lost: 54 × defeat, 3 × gone, 1 × surrender.

### Conquest and economy by year

Medians over the 20 seeds, taken at the end of each year. Stores are each power's, read in the order rome, carthage, macedon, egypt, persia. Captures, fates, and storm losses add up the year's events over all seeds.

| year | independent of 60 | cities per power     | gold                                  | food                                    | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | -------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 51                | 4 / 7 / 5 / 7 / 6    | 2,222 / 3,454 / 3,518 / 3,088 / 2,620 | 2,483 / 2,862 / 2,591 / 2,869 / 2,861   | 2,301 / 2,257 / 2,392 / 2,505 / 2,635 | 0% / 14% / 86% of 246          | 18% (34)               | 118 / 5 / 123             | 76                | 6             |
| 2    | 44                | 5 / 9 / 7 / 7 / 9    | 3,622 / 3,587 / 3,599 / 3,612 / 3,832 | 4,508 / 5,942 / 4,561 / 5,524 / 6,292   | 2,654 / 2,761 / 2,740 / 2,790 / 2,934 | 0% / 44% / 56% of 344          | 19% (148)              | 298 / 3 / 43              | 181               | 64            |
| 3    | 38                | 6 / 10 / 6 / 9 / 12  | 3,527 / 4,188 / 3,793 / 3,490 / 3,889 | 5,187 / 8,513 / 5,890 / 8,208 / 9,583   | 2,793 / 3,220 / 2,682 / 3,075 / 4,193 | 0% / 53% / 47% of 359          | 18% (183)              | 328 / 5 / 26              | 228               | 82            |
| 4    | 34                | 5 / 13 / 7 / 10 / 14 | 3,178 / 4,138 / 3,565 / 3,866 / 3,865 | 5,409 / 10,155 / 6,888 / 9,219 / 10,954 | 2,725 / 4,086 / 2,898 / 3,794 / 4,987 | 0% / 61% / 39% of 359          | 18% (213)              | 333 / 8 / 18              | 276               | 81            |
| 5    | 31                | 5 / 13 / 6 / 11 / 15 | 3,651 / 4,394 / 2,993 / 3,821 / 4,017 | 6,250 / 11,840 / 6,853 / 9,769 / 11,895 | 2,902 / 4,709 / 2,456 / 4,134 / 5,983 | 0% / 54% / 46% of 366          | 18% (192)              | 350 / 7 / 9               | 319               | 98            |

Targets over the seeds:

- Half the 60 minor cities independent at the end of year 2: median 44, lowest 36, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 31, lowest 22, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 78 of 84 such power-years grew, 6 did not. met (met at 90% or more). Those that did not: carthage in year 3 2, rome in year 2 1, carthage in year 4 1, carthage in year 5 1, persia in year 3 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.

## Rome gives no orders

20 seeds, 5 years. Means over the seeds. Cities: start, then after each year. Storms and battles are won/lost.

| power          | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms   | battles  |
| -------------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | -------- | -------- |
| rome (passive) | 4.0 → 4.0 → 1.3 → 0.0 → 0.0 → 0.0    | 0     | 0     | 0      | 0        | 0.0  | 0.0   | 4.0  | 0.0    | 0.0/0.0  | 0.4/5.6  |
| carthage       | 4.0 → 7.0 → 9.6 → 13.5 → 14.3 → 14.9 | 4,959 | 4,371 | 13,506 | 6,754    | 11.8 | 20.0  | 9.2  | 24.2   | 9.8/0.0  | 24.7/5.0 |
| macedon        | 4.0 → 6.6 → 8.2 → 8.9 → 9.2 → 9.3    | 3,120 | 3,427 | 9,204  | 4,570    | 11.2 | 17.2  | 12.0 | 22.2   | 7.9/0.0  | 17.7/8.6 |
| egypt          | 4.0 → 6.6 → 7.5 → 8.8 → 10.1 → 10.9  | 3,316 | 3,310 | 9,656  | 4,450    | 11.5 | 19.5  | 12.6 | 25.0   | 9.5/0.0  | 21.3/6.0 |
| persia         | 4.0 → 6.2 → 9.7 → 11.8 → 13.7 → 13.9 | 3,895 | 3,501 | 11,893 | 6,095    | 11.5 | 21.4  | 11.5 | 25.3   | 11.6/0.0 | 22.4/6.3 |

- Orders given: 19,075. Rejected: 312 (1.64%).
  - 296 × offerPeace: An offer of peace was already made today in this war; it waits for an answer
  - 2 × moveArmy: faction syene is out of the game
  - 2 × moveArmy: faction pergamon is out of the game
  - 1 × moveArmy: faction rhagai is out of the game
  - 1 × retreat: army # is not in a battle
  - 1 × moveArmy: faction phasis is out of the game
  - 1 × declareWar: persia is already at war with macedon
  - 1 × moveArmy: faction petra is out of the game
  - 1 × setStance: faction cirta is out of the game
  - 1 × retreat: faction cirta is out of the game
  - 1 × declareWar: macedon is already at war with egypt
  - 1 × offerPeace: faction lepcis-magna is out of the game
  - 1 × declareWar: egypt is already at war with carthage
  - 1 × openTrade: Karmana has no free route slot
  - 1 × declareWar: persia is already at war with carthage
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 20,895 of 146,000 power-days of the powers the AI runs.
  - 14555 × too few men alone to blockade the garrison of every city it reaches, gathering
  - 2529 × waiting for recruits that muster within RALLY_WAIT_DAYS
  - 1759 × resting, morale below MARCH_MORALE
  - 1073 × other
  - 795 × every enemy city it reaches is besieged under another power's lead
  - 184 × guarding the capital, the weakest army there
- Decisions per day, all factions: mean 0.63 ms, p99 2.33 ms, max 6.85 ms. One tick: mean 0.76 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 175 days, longest 361 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,721. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 75.8%.
- Armies that lost a battle and were still alive 30 days later: 843 of 1,758 (48.0%).
- Marches ordered: 7,670. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,756. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
  - broke to a city: 183 of 203 alive (90.1%). Lost: 16 × gone, 3 × battle, 1 × defeat.
  - broke to the field: 362 of 1,159 alive (31.2%). Lost: 779 × defeat, 17 × battle, 1 × gone.
  - destroyed in the battle: 0 of 24 alive (0.0%). Lost: 24 × battle.
  - surrendered: 0 of 1 alive (0.0%). Lost: 1 × surrender.
  - withdrew to a city: 175 of 208 alive (84.1%). Lost: 33 × gone.
  - withdrew to the field: 123 of 163 alive (75.5%). Lost: 38 × defeat, 2 × gone.
- Seeds where a power declares war on Rome: 20/20.

### Conquest and economy by year

Medians over the 20 seeds, taken at the end of each year. Stores are each power's, read in the order rome, carthage, macedon, egypt, persia. Captures, fates, and storm losses add up the year's events over all seeds.

| year | independent of 60 | cities per power      | gold                                  | food                                  | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | --------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 50                | 4 / 7 / 7 / 7 / 6     | 8,739 / 3,306 / 3,436 / 3,161 / 2,701 | 3,582 / 3,130 / 3,302 / 2,900 / 2,891 | 2,835 / 2,601 / 2,800 / 2,442 / 2,687 | 0% / 18% / 82% of 214          | 19% (38)               | 115 / 0 / 99              | 9                 | 3             |
| 2    | 44                | 1 / 10 / 8 / 8 / 10   | 8,810 / 4,756 / 4,336 / 3,644 / 3,561 | 3,894 / 6,616 / 6,472 / 5,553 / 6,388 | 3,439 / 3,404 / 3,418 / 2,779 / 2,892 | 0% / 43% / 57% of 295          | 19% (122)              | 278 / 2 / 15              | 176               | 95            |
| 3    | 38                | 0 / 13 / 10 / 9 / 12  | 0 / 4,095 / 3,674 / 3,237 / 3,598     | 0 / 11,428 / 8,237 / 8,296 / 9,630    | 0 / 4,347 / 3,983 / 3,332 / 4,009     | 0% / 57% / 43% of 318          | 18% (178)              | 312 / 1 / 5               | 183               | 73            |
| 4    | 32                | 0 / 14 / 10 / 11 / 14 | 0 / 4,455 / 4,009 / 3,805 / 4,036     | 0 / 12,590 / 8,690 / 9,039 / 11,047   | 0 / 5,743 / 4,247 / 4,163 / 5,147     | 0% / 64% / 36% of 326          | 18% (203)              | 320 / 3 / 3               | 239               | 90            |
| 5    | 31                | 0 / 15 / 10 / 12 / 14 | 0 / 4,272 / 3,740 / 3,490 / 3,454     | 0 / 13,526 / 9,087 / 9,928 / 11,844   | 0 / 7,160 / 4,230 / 4,163 / 5,952     | 0% / 58% / 42% of 407          | 18% (232)              | 394 / 7 / 6               | 376               | 92            |

Targets over the seeds:

- Half the 60 minor cities independent at the end of year 2: median 44, lowest 40, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 31, lowest 25, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 100 of 108 such power-years grew, 8 did not. met (met at 90% or more). Those that did not: carthage in year 5 3, carthage in year 4 3, carthage in year 2 1, persia in year 3 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 2/20. met.

Seed 1 played twice ends in the same state: yes.

## Peace before

Seeds 1 to 20, 10 years, every faction under the AI.

| Wars                            | Begun | Ended in peace | Ended in a death | Still running | Median days | Longest days | Peace as things stand / gold / cities |
| ------------------------------- | ----- | -------------- | ---------------- | ------------- | ----------- | ------------ | ------------------------------------- |
| All                             | 1856  | 1029           | 771              | 56            | 116         | 414          | 313 / 650 / 66                        |
| Great power against great power | 891   | 837            | 14               | 40            | 145         | 414          | 137 / 634 / 66                        |
| With a minor                    | 965   | 192            | 757              | 16            | 72          | 236          | 176 / 16 / 0                          |

Great-power pairs at war for all 10 years: 0
Days from a peace to the same pair's next war: 694 returns, shortest 365, median 410
Most wars between one pair in one seed: 7

| Power    | Median days at peace | Fewest | Most |
| -------- | -------------------- | ------ | ---- |
| rome     | 598                  | 251    | 1242 |
| carthage | 548                  | 252    | 972  |
| macedon  | 535                  | 249    | 1213 |
| egypt    | 767                  | 382    | 2041 |
| persia   | 806                  | 439    | 1353 |

## Peace after

Seeds 1 to 20, 10 years, every faction under the AI.

| Wars                            | Begun | Ended in peace | Ended in a death | Still running | Median days | Longest days | Peace as things stand / gold / cities |
| ------------------------------- | ----- | -------------- | ---------------- | ------------- | ----------- | ------------ | ------------------------------------- |
| All                             | 1961  | 1073           | 833              | 55            | 113         | 535          | 342 / 682 / 49                        |
| Great power against great power | 902   | 842            | 17               | 43            | 136         | 535          | 139 / 654 / 49                        |
| With a minor                    | 1059  | 231            | 816              | 12            | 73          | 226          | 203 / 28 / 0                          |

Great-power pairs at war for all 10 years: 0
Days from a peace to the same pair's next war: 724 returns, shortest 365, median 398
Most wars between one pair in one seed: 7

| Power    | Median days at peace | Fewest | Most |
| -------- | -------------------- | ------ | ---- |
| rome     | 505                  | 218    | 1119 |
| carthage | 388                  | 147    | 706  |
| macedon  | 407                  | 150    | 901  |
| egypt    | 510                  | 210    | 778  |
| persia   | 630                  | 345    | 1018 |
