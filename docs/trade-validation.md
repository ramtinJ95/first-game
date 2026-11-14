# Trade validation

Baseline world tables were recorded on `0031bb7`; tooling `a3ac1ba` and guide `a98a2de` do not change those economy/AI rules. The feature was rebased onto `a98a2de`. Timing baseline was rerun from that checkout. All simulation tables use seeds 1–20; world/peace run ten years and AI runs both five-year controls.

## Verdict and unresolved targets

- Trade share 35.9–37.2%, treasury cap zero days in years 2–5, suitable payback 1.13–2.03 years, and the most valuable partner's war costs at least 14.8% of net income.
- **Decision interval NOT met:** median 88 days rather than 60.
- Main's year-10 largest-power and three-survivor gates remain met in 20/20 seeds. AI growth and minor independence gates remain met in both controls; peace retains no decade-long war and a minimum 365-day return to war.
- **One previously met AI guard regresses:** a passive Rome falls before year 3 in 4/20 seeds (main 0/20; threshold at most 2). The all-AI control remains 0/20. This is a known failure, not a completed preservation claim.
- **Timing NOT met:** the repeatable 5,475-day rules-plus-AI benchmark measured 7.916 → 12.478 ms slowest day (+57.6%); median 1.275 → 1.700 ms and p95 2.952 → 3.602 ms. These local runs share a machine with other builders and show noise, but the observed regression is not dismissed. Existing `sim:movement` fails unchanged main with `not every army set out`, so it supplies no successful timing baseline.

## Tuning stopped at the world trade-off

The first AI rule spent gold beyond a short reserve. It preserved early survival but missed the unthreatened-growth guard (108/124, 87%). Keeping the next recruit's price as well restored growth (83/89 all-AI; 108/111 passive Rome), but passive Rome's early-loss guard regressed. I retained the military reserve rather than silently letting trade starve recruitment, and preserved the long-world size and survival gates.

A lower base-income trial, 0.8 instead of 1.15, still left three early losses, worsened median decisions to 108 days, and cut the minimum measured partner-war loss to 7.2%. It did not repair the world guard and broke another target, so it was rejected. The selected 1.15 rules and all shortfalls above are submitted for owner judgment; this is not an assertion that the entire numeric brief is satisfied.

## Timing method

`node scripts/bench-trade.ts`, copied unchanged to the baseline checkout, warms up a separate seed then measures seeds 1–3 for five years. It includes the day's complete AI and immutable tick, not an idle no-route baseline. Paths are readonly and shared between days; records are copied. Hostility is checked once per endpoint-owner/army-owner pair, and faction schedules/slot counts are reused. These optimizations are covered by frozen-state and raid tests.

## Trade targets: selected rules

| seed                               | trade % Y3      | cap days Y2–5 | median decision gap | payback years min–max | largest partner war loss % | decisions |
| ---------------------------------- | --------------- | ------------- | ------------------- | --------------------- | -------------------------- | --------- |
| 1                                  | 37.2            | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 2                                  | 37.2            | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 3                                  | 37.2            | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 4                                  | 37.2            | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 5                                  | 37.2            | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 6                                  | 37.2            | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 7                                  | 37.2            | 0             | 88                  | 1.13–1.13             | 14.8                       | 23        |
| 8                                  | 37.2            | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 9                                  | 37.2            | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 10                                 | 37.2            | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 11                                 | 37.2            | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 12                                 | 37.2            | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 13                                 | 37.2            | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 14                                 | 37.2            | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 15                                 | 37.2            | 0             | 87                  | 1.13–1.13             | 14.8                       | 23        |
| 16                                 | 35.9            | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |
| 17                                 | 35.9            | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |
| 18                                 | 35.9            | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |
| 19                                 | 35.9            | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |
| 20                                 | 35.9            | 0             | 90                  | 1.13–2.03             | 15.2                       | 23        |
| target                             | result          | met           |
| ---                                | ---             | ---           |
| Trade 20–40% at Y3                 | 35.9–37.2%      | met           |
| Cap fewer than 30 days Y2–5        | max 0           | met           |
| Median decision gap ≤60 days       | median 88       | NOT met       |
| Suitable routes repay in 1–3 years | 1.13–2.03 years | met           |
| Partner war cuts income ≥10%       | min 14.8%       | met           |

## World before (0031bb7)

## The world after 10 years, seeds 1 to 20

| seed | rome | carthage | macedon | egypt | persia | largest     | alive | sieges | begun again after leaving | marches repeated | armies lost to sallies (men) | longest quiet war, with an army that could fight                             |
| ---- | ---- | -------- | ------- | ----- | ------ | ----------- | ----- | ------ | ------------------------- | ---------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| 1    | 0    | 16       | 2       | 2     | 27     | persia 27   | 4     | 196    | 1                         | 65               | 0 (3108)                     | 99 days, rome from day 1629; could take: 14 days, rome from day 1324         |
| 2    | 0    | 22       | 12      | 12    | 16     | carthage 22 | 4     | 176    | 0                         | 62               | 0 (2403)                     | 30 days, rome from day 1715; could take: 14 days, rome from day 1545         |
| 3    | 5    | 21       | 3       | 16    | 25     | persia 25   | 5     | 238    | 1                         | 98               | 0 (3571)                     | 51 days, macedon from day 3356; could take: 16 days, egypt from day 486      |
| 4    | 18   | 10       | 3       | 13    | 25     | persia 25   | 5     | 216    | 0                         | 113              | 0 (3616)                     | 30 days, rome from day 362; could take: 7 days, rome from day 952            |
| 5    | 21   | 16       | 3       | 12    | 16     | rome 21     | 5     | 222    | 1                         | 72               | 0 (4080)                     | 59 days, macedon from day 2692; could take: 12 days, macedon from day 1749   |
| 6    | 17   | 16       | 6       | 0     | 22     | persia 22   | 4     | 216    | 1                         | 99               | 0 (3214)                     | 19 days, carthage from day 2867; could take: 19 days, carthage from day 2867 |
| 7    | 14   | 16       | 6       | 13    | 17     | persia 17   | 5     | 237    | 0                         | 102              | 0 (3387)                     | 9 days, carthage from day 1219; could take: 9 days, carthage from day 1219   |
| 8    | 13   | 16       | 0       | 1     | 22     | persia 22   | 4     | 174    | 0                         | 106              | 0 (1470)                     | 115 days, macedon from day 991; could take: 51 days, egypt from day 275      |
| 9    | 18   | 17       | 0       | 13    | 12     | rome 18     | 4     | 209    | 1                         | 92               | 0 (3000)                     | 115 days, macedon from day 2598; could take: 10 days, egypt from day 1732    |
| 10   | 8    | 12       | 6       | 13    | 15     | persia 15   | 5     | 216    | 0                         | 77               | 0 (2807)                     | 11 days, macedon from day 3446; could take: 5 days, macedon from day 404     |
| 11   | 16   | 15       | 0       | 13    | 12     | rome 16     | 4     | 195    | 0                         | 69               | 0 (2190)                     | 131 days, macedon from day 2612; could take: 7 days, rome from day 2494      |
| 12   | 0    | 13       | 14      | 0     | 27     | persia 27   | 3     | 179    | 1                         | 120              | 1 (2725)                     | 109 days, rome from day 2715; could take: 8 days, egypt from day 2758        |
| 13   | 1    | 30       | 0       | 23    | 12     | carthage 30 | 4     | 166    | 1                         | 54               | 0 (1937)                     | 162 days, macedon from day 2600; could take: 26 days, macedon from day 2351  |
| 14   | 4    | 2        | 11      | 12    | 26     | persia 26   | 5     | 239    | 2                         | 121              | 0 (4163)                     | 47 days, carthage from day 3462; could take: 7 days, rome from day 2494      |
| 15   | 9    | 10       | 1       | 13    | 24     | persia 24   | 5     | 216    | 1                         | 77               | 0 (2523)                     | 141 days, macedon from day 3358; could take: 5 days, persia from day 1519    |
| 16   | 6    | 20       | 9       | 5     | 21     | persia 21   | 5     | 211    | 1                         | 57               | 0 (3243)                     | 1 days, macedon from day 214; could take: 1 days, macedon from day 214       |
| 17   | 7    | 15       | 6       | 8     | 25     | persia 25   | 5     | 212    | 0                         | 109              | 0 (2526)                     | 34 days, persia from day 1713; could take: 29 days, rome from day 534        |
| 18   | 2    | 23       | 0       | 6     | 20     | carthage 23 | 4     | 177    | 1                         | 63               | 0 (2578)                     | 180 days, macedon from day 1979; could take: 6 days, persia from day 623     |
| 19   | 14   | 12       | 2       | 16    | 15     | egypt 16    | 5     | 211    | 0                         | 89               | 0 (1941)                     | 27 days, rome from day 2501; could take: 13 days, macedon from day 3575      |
| 20   | 15   | 10       | 1       | 12    | 21     | persia 21   | 5     | 239    | 1                         | 69               | 0 (2992)                     | 51 days, macedon from day 3566; could take: 13 days, macedon from day 2124   |

- The largest power holds at most half the 80 cities: 20/20. met (at least 16).
- At least three powers alive: 20/20. met (at least 16).
- Seeds each power is the largest: rome 3, carthage 3, macedon 0, egypt 1, persia 13. NOT met (none more than 8).
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 1.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 1, of which the menu gives no way to their owner's nearest city: 0.
- Sieges begun: 4145. Begun again by the same power within 30 days of ordering its besiegers away from the city: 13.
- The same march ordered again within 30 days: 1714.
- Wars declared by a great power: 1806, of which 13 were declared less than a year before the end and had seen no act yet, and are left out of what follows. Of the other 1793: days until it first fought, besieged, or marched on the enemy: median 1, 90th percentile 69. Never within a year, or before the war ended: 130.
- Attacks a great power lost to the same enemy within 50 km and 90 days of one it lost before: 181.
- Changes of stance by one army in one battle, over 2073 army-battles: median 1, most 2, none in 463.
- Armies lost to sallies: 1. Men lost to sallies: 57474.
- Longest stretch a power at war had an idle army that could reach an enemy city, no army on the move, and gave no order: median 51 days, longest 180 days.
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
| 3    | rome     | Augusta Vindelicum | 279           | 1           | 19 / 171               | 280            | 312         |
| 3    | carthage | Caralis            | 191           | 1           | 16 / 172               | 191            | 229         |
| 3    | macedon  | Ambrakia           | no battle     |             |                        | 185            | 194         |
| 3    | egypt    | Antiocheia         | 216           | 1           | 21 / 171               | 217            | 250         |
| 3    | persia   | Artaxata           | 229           | 1           | 30 / 171               | 230            | 262         |
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
| 1    | 23   | 0        | 19      | 0     | 20     | rome 23     | 3     | 236    | 1                         | 100              | 0 (3046)                     | 18 days, macedon from day 3573; could take: 18 days, macedon from day 3573  |
| 2    | 7    | 17       | 12      | 6     | 21     | persia 21   | 5     | 230    | 4                         | 97               | 0 (4225)                     | 43 days, rome from day 1855; could take: 6 days, carthage from day 237      |
| 3    | 8    | 20       | 16      | 5     | 14     | carthage 20 | 5     | 246    | 0                         | 146              | 0 (3407)                     | 11 days, egypt from day 371; could take: 11 days, egypt from day 371        |
| 4    | 0    | 26       | 0       | 7     | 29     | persia 29   | 3     | 235    | 0                         | 151              | 0 (2921)                     | 108 days, rome from day 1966; could take: 14 days, carthage from day 999    |
| 5    | 0    | 19       | 13      | 0     | 26     | persia 26   | 3     | 207    | 2                         | 104              | 0 (3538)                     | 76 days, rome from day 1118; could take: 6 days, rome from day 1523         |
| 6    | 12   | 8        | 12      | 12    | 20     | persia 20   | 5     | 260    | 0                         | 103              | 0 (3432)                     | 1 days, macedon from day 155; could take: 1 days, macedon from day 155      |
| 7    | 0    | 14       | 21      | 10    | 18     | macedon 21  | 4     | 234    | 3                         | 71               | 0 (3323)                     | 67 days, rome from day 2923; could take: 11 days, rome from day 165         |
| 8    | 1    | 10       | 12      | 14    | 18     | persia 18   | 5     | 223    | 3                         | 91               | 0 (2165)                     | 62 days, rome from day 1356; could take: 10 days, rome from day 166         |
| 9    | 14   | 14       | 4       | 21    | 14     | egypt 21    | 5     | 249    | 3                         | 87               | 0 (4289)                     | 43 days, egypt from day 1155; could take: 7 days, persia from day 558       |
| 10   | 19   | 9        | 12      | 8     | 21     | persia 21   | 5     | 243    | 0                         | 131              | 0 (3403)                     | 49 days, persia from day 1077; could take: 15 days, persia from day 1215    |
| 11   | 0    | 18       | 6       | 22    | 17     | egypt 22    | 4     | 223    | 1                         | 149              | 0 (3756)                     | 55 days, rome from day 1855; could take: 15 days, macedon from day 3038     |
| 12   | 5    | 23       | 9       | 2     | 21     | carthage 23 | 5     | 230    | 1                         | 80               | 0 (4416)                     | 89 days, rome from day 1323; could take: 18 days, persia from day 1480      |
| 13   | 4    | 14       | 19      | 4     | 24     | persia 24   | 5     | 252    | 0                         | 147              | 0 (2084)                     | 1 days, carthage from day 184; could take: 1 days, carthage from day 184    |
| 14   | 4    | 15       | 8       | 13    | 21     | persia 21   | 5     | 256    | 2                         | 114              | 0 (5335)                     | 12 days, persia from day 1108; could take: 8 days, persia from day 822      |
| 15   | 12   | 15       | 9       | 19    | 4      | egypt 19    | 5     | 261    | 2                         | 153              | 0 (2352)                     | 12 days, macedon from day 409; could take: 5 days, rome from day 2328       |
| 16   | 7    | 18       | 11      | 11    | 24     | persia 24   | 5     | 261    | 1                         | 110              | 0 (5198)                     | 28 days, macedon from day 402; could take: 6 days, macedon from day 196     |
| 17   | 10   | 10       | 11      | 18    | 13     | egypt 18    | 5     | 238    | 2                         | 113              | 0 (3332)                     | 76 days, persia from day 692; could take: 4 days, carthage from day 3460    |
| 18   | 0    | 32       | 0       | 9     | 14     | carthage 32 | 3     | 199    | 1                         | 102              | 0 (2735)                     | 132 days, macedon from day 1045; could take: 11 days, rome from day 1541    |
| 19   | 4    | 21       | 12      | 12    | 16     | carthage 21 | 5     | 226    | 2                         | 104              | 0 (3860)                     | 16 days, rome from day 371; could take: 9 days, macedon from day 1200       |
| 20   | 16   | 12       | 0       | 11    | 23     | persia 23   | 4     | 236    | 5                         | 94               | 0 (3920)                     | 121 days, macedon from day 2082; could take: 41 days, macedon from day 1105 |

- The largest power holds at most half the 80 cities: 20/20. met (at least 16).
- At least three powers alive: 20/20. met (at least 16).
- Seeds each power is the largest: rome 1, carthage 4, macedon 1, egypt 4, persia 10. NOT met (none more than 8).
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Sieges begun: 4745. Begun again by the same power within 30 days of ordering its besiegers away from the city: 33.
- The same march ordered again within 30 days: 2247.
- Wars declared by a great power: 1920, of which 15 were declared less than a year before the end and had seen no act yet, and are left out of what follows. Of the other 1905: days until it first fought, besieged, or marched on the enemy: median 1, 90th percentile 62. Never within a year, or before the war ended: 151.
- Attacks a great power lost to the same enemy within 50 km and 90 days of one it lost before: 155.
- Changes of stance by one army in one battle, over 2402 army-battles: median 1, most 2, none in 527.
- Armies lost to sallies: 0. Men lost to sallies: 70737.
- Longest stretch a power at war had an idle army that could reach an enemy city, no army on the move, and gave no order: median 43 days, longest 132 days.
- The same, counting only days on which its idle armies together had the men to take an enemy city they had a route to: median 9 days, longest 41 days.

## The first city each power takes, seeds 1 to 5

| seed | power    | city                | battle on day | days fought | lost, power / defender | siege from day | fell on day |
| ---- | -------- | ------------------- | ------------- | ----------- | ---------------------- | -------------- | ----------- |
| 1    | rome     | Augusta Vindelicum  | 208           | 1           | 25 / 171               | 209            | 257         |
| 1    | carthage | Cirta               | no battle     |             |                        | 161            | 185         |
| 1    | macedon  | Ambrakia            | no battle     |             |                        | 158            | 178         |
| 1    | egypt    | Ammon               | 160           | 1           | 14 / 172               | 161            | 184         |
| 1    | persia   | Artaxata            | 192           | 1           | 32 / 171               | 193            | 226         |
| 2    | rome     | Augusta Vindelicum  | 205           | 1           | 32 / 171               | 206            | 237         |
| 2    | carthage | Caralis             | 149           | 1           | 23 / 171               | 149            | 180         |
| 2    | macedon  | Ambrakia            | 147           | 1           | 25 / 171               | 146            | 178         |
| 2    | egypt    | Ammon               | no battle     |             |                        | 154            | 178         |
| 2    | persia   | Artaxata            | 204           | 1           | 32 / 171               | 205            | 245         |
| 3    | rome     | Herakleia Lynkestis | no battle     |             |                        | 235            | 298         |
| 3    | carthage | Caralis             | 153           | 1           | 16 / 172               | 153            | 197         |
| 3    | macedon  | Ambrakia            | no battle     |             |                        | 144            | 153         |
| 3    | egypt    | Damaskos            | no battle     |             |                        | 163            | 178         |
| 3    | persia   | Artaxata            | 201           | 1           | 26 / 171               | 202            | 237         |
| 4    | rome     | Augusta Vindelicum  | no battle     |             |                        | 206            | 229         |
| 4    | carthage | Caralis             | 141           | 1           | 28 / 171               | 141            | 185         |
| 4    | macedon  | Athenai             | 157           | 1           | 26 / 171               | 158            | 179         |
| 4    | egypt    | Damaskos            | 151           | 1           | 28 / 171               | 152            | 180         |
| 4    | persia   | Babylon             | 173           | 1           | 26 / 171               | 174            | 219         |
| 5    | rome     | Caralis             | no battle     |             |                        | 181            | 182         |
| 5    | carthage | Caralis             | no battle     |             |                        | 149            | 158         |
| 5    | macedon  | Athenai             | no battle     |             |                        | 156            | 169         |
| 5    | egypt    | Ammon               | no battle     |             |                        | 143            | 156         |
| 5    | persia   | Artaxata            | 201           | 1           | 25 / 171               | 202            | 235         |

## AI before (both all-AI and passive-Rome controls)

## Every faction under the AI

| power    | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms  | battles  |
| -------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | ------- | -------- |
| rome     | 4.0 → 4.9 → 6.4 → 7.2 → 8.1 → 8.5    | 3,137 | 3,642 | 8,097  | 4,069    | 10.6 | 13.4  | 9.0  | 18.2   | 4.7/0.0 | 13.3/4.1 |
| carthage | 4.0 → 6.0 → 7.8 → 9.9 → 11.4 → 12.7  | 3,722 | 4,396 | 10,949 | 6,424    | 11.7 | 16.1  | 7.4  | 19.5   | 6.8/0.0 | 17.9/3.4 |
| macedon  | 4.0 → 6.0 → 6.1 → 7.2 → 7.4 → 6.9    | 2,678 | 3,461 | 7,611  | 3,829    | 8.9  | 13.9  | 11.0 | 17.6   | 5.1/0.0 | 13.9/6.3 |
| egypt    | 4.0 → 6.1 → 8.0 → 8.4 → 8.8 → 8.9    | 3,119 | 3,214 | 8,810  | 4,500    | 10.1 | 15.8  | 10.9 | 20.9   | 6.0/0.0 | 20.3/7.9 |
| persia   | 4.0 → 6.0 → 8.6 → 10.7 → 12.7 → 14.1 | 3,946 | 3,344 | 11,701 | 7,208    | 11.4 | 16.0  | 5.9  | 18.5   | 8.4/0.0 | 20.0/5.0 |

- Orders given: 16,329. Rejected: 418 (2.56%).
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 22,111 of 182,500 power-days of the powers the AI runs.
- Decisions per day, all factions: mean 0.98 ms, p99 4.76 ms, max 28.99 ms. One tick: mean 1.19 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 1.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 1, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 206 days, longest 285 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,703. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 78.2%.
- Armies that lost a battle and were still alive 30 days later: 854 of 1,767 (48.3%).
- Marches ordered: 6,576. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,776. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:

### Conquest and economy by year

| year | independent of 60 | cities per power    | gold                                  | food                                    | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | ------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 52                | 5 / 6 / 6 / 6 / 6   | 2,970 / 3,641 / 3,821 / 3,732 / 3,440 | 2,561 / 3,242 / 3,384 / 3,176 / 2,985   | 2,300 / 3,141 / 3,178 / 3,135 / 3,018 | 0% / 11% / 89% of 197          | 19% (22)               | 100 / 0 / 97              | 18                | 1             |
| 2    | 43                | 7 / 8 / 6 / 8 / 8   | 3,121 / 3,591 / 3,326 / 3,077 / 2,912 | 4,688 / 6,427 / 5,531 / 6,407 / 6,639   | 2,861 / 3,330 / 3,244 / 3,449 / 3,553 | 0% / 34% / 66% of 292          | 18% (94)               | 284 / 3 / 5               | 136               | 42            |
| 3    | 37                | 8 / 10 / 8 / 9 / 11 | 3,576 / 3,697 / 3,188 / 3,379 / 3,230 | 6,665 / 8,965 / 6,818 / 7,699 / 8,758   | 3,257 / 4,676 / 3,417 / 4,131 / 4,688 | 0% / 47% / 53% of 344          | 19% (160)              | 332 / 2 / 10              | 213               | 73            |
| 4    | 33                | 8 / 11 / 7 / 9 / 13 | 3,116 / 3,459 / 3,792 / 3,366 / 3,538 | 7,491 / 9,681 / 7,081 / 8,541 / 10,535  | 3,645 / 4,990 / 3,752 / 4,212 / 6,076 | 0% / 54% / 46% of 319          | 18% (165)              | 315 / 3 / 1               | 220               | 83            |
| 5    | 30                | 9 / 13 / 8 / 9 / 15 | 3,885 / 4,377 / 3,678 / 3,641 / 3,343 | 8,085 / 10,936 / 7,519 / 8,699 / 11,877 | 3,629 / 6,113 / 3,672 / 3,987 / 7,645 | 0% / 55% / 45% of 350          | 18% (178)              | 341 / 8 / 1               | 295               | 115           |

- Half the 60 minor cities independent at the end of year 2: median 43, lowest 38, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 30, lowest 18, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 101 of 105 such power-years grew, 4 did not. met (met at 90% or more). Those that did not: rome in year 1 2, rome in year 3 1, carthage in year 4 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.

## Rome gives no orders

| power          | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms  | battles  |
| -------------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | ------- | -------- |
| rome (passive) | 4.0 → 4.0 → 2.9 → 0.4 → 0.1 → 0.0    | 0     | 0     | 0      | 0        | 0.0  | 0.0   | 4.0  | 0.0    | 0.0/0.0 | 0.9/5.7  |
| carthage       | 4.0 → 6.4 → 8.6 → 11.0 → 13.5 → 15.6 | 4,367 | 4,148 | 13,402 | 8,439    | 10.8 | 16.5  | 4.9  | 19.3   | 7.2/0.0 | 19.3/3.1 |
| macedon        | 4.0 → 6.4 → 7.5 → 8.9 → 8.7 → 8.9    | 3,207 | 3,328 | 8,749  | 4,856    | 9.5  | 13.8  | 9.0  | 17.3   | 6.1/0.0 | 15.4/5.5 |
| egypt          | 4.0 → 6.2 → 7.7 → 8.5 → 8.8 → 9.0    | 3,010 | 3,376 | 8,759  | 4,879    | 10.0 | 15.9  | 11.0 | 20.0   | 6.5/0.0 | 16.9/7.3 |
| persia         | 4.0 → 6.0 → 8.3 → 10.9 → 12.3 → 13.5 | 3,825 | 3,713 | 11,311 | 6,885    | 11.2 | 17.1  | 7.7  | 20.7   | 8.9/0.0 | 21.9/4.9 |

- Orders given: 13,233. Rejected: 261 (1.97%).
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 17,870 of 146,000 power-days of the powers the AI runs.
- Decisions per day, all factions: mean 0.52 ms, p99 2.20 ms, max 8.24 ms. One tick: mean 0.76 ms.
- Seeds where at least three powers hold more cities than at the start: 19/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 211 days, longest 334 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,485. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 79.8%.
- Armies that lost a battle and were still alive 30 days later: 721 of 1,500 (48.1%).
- Marches ordered: 5,312. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,511. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
- Seeds where a power declares war on Rome: 20/20.

### Conquest and economy by year

| year | independent of 60 | cities per power     | gold                                  | food                                  | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | -------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 51                | 4 / 6 / 6 / 6 / 6    | 8,739 / 3,792 / 3,937 / 3,652 / 3,429 | 3,582 / 3,279 / 3,431 / 3,129 / 2,985 | 2,835 / 3,254 / 3,185 / 3,139 / 3,026 | 0% / 8% / 92% of 179           | 20% (15)               | 99 / 0 / 80               | 2                 | 0             |
| 2    | 45                | 3 / 9 / 8 / 8 / 8    | 8,896 / 3,704 / 3,393 / 3,158 / 3,217 | 3,973 / 6,807 / 6,406 / 6,341 / 6,558 | 2,943 / 3,758 / 3,450 / 3,472 / 3,621 | 0% / 38% / 62% of 234          | 18% (88)               | 234 / 0 / 0               | 113               | 57            |
| 3    | 41                | 0 / 11 / 9 / 9 / 11  | 0 / 3,331 / 3,066 / 3,649 / 3,220     | 0 / 9,842 / 7,577 / 7,553 / 8,723     | 0 / 4,674 / 3,717 / 3,929 / 4,599     | 0% / 51% / 49% of 258          | 19% (129)              | 256 / 2 / 0               | 164               | 57            |
| 4    | 36                | 0 / 15 / 9 / 10 / 12 | 0 / 3,760 / 3,121 / 3,467 / 3,724     | 0 / 12,608 / 8,341 / 8,490 / 10,068   | 0 / 6,121 / 4,268 / 4,402 / 5,697     | 0% / 60% / 40% of 316          | 19% (184)              | 307 / 8 / 1               | 244               | 65            |
| 5    | 32                | 0 / 15 / 9 / 9 / 15  | 0 / 3,925 / 3,512 / 3,221 / 3,828     | 0 / 13,950 / 8,947 / 8,700 / 11,777   | 0 / 8,139 / 4,818 / 4,668 / 7,033     | 0% / 60% / 40% of 279          | 19% (157)              | 274 / 4 / 1               | 206               | 76            |

- Half the 60 minor cities independent at the end of year 2: median 45, lowest 42, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 32, lowest 27, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 126 of 130 such power-years grew, 4 did not. met (met at 90% or more). Those that did not: carthage in year 5 2, persia in year 4 1, persia in year 5 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.
  Seed 1 played twice ends in the same state: yes.

## AI after (both controls)

## Every faction under the AI

| power    | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms   | battles  |
| -------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | -------- | -------- |
| rome     | 4.0 → 5.1 → 6.1 → 6.1 → 5.9 → 5.7    | 2,438 | 3,511 | 7,143  | 3,620    | 8.7  | 13.0  | 11.4 | 17.7   | 4.4/0.0  | 11.9/4.3 |
| carthage | 4.0 → 6.2 → 8.5 → 10.8 → 12.5 → 13.9 | 4,509 | 4,074 | 11,507 | 5,176    | 13.7 | 19.3  | 9.4  | 24.2   | 10.0/0.0 | 20.4/5.6 |
| macedon  | 4.0 → 6.6 → 7.3 → 8.7 → 9.3 → 9.2    | 3,277 | 3,645 | 8,727  | 4,293    | 10.1 | 18.2  | 13.1 | 23.8   | 7.5/0.0  | 16.6/5.0 |
| egypt    | 4.0 → 6.5 → 7.4 → 9.0 → 9.9 → 10.5   | 3,593 | 3,622 | 9,651  | 4,531    | 12.9 | 18.1  | 11.7 | 24.0   | 8.0/0.0  | 21.0/7.8 |
| persia   | 4.0 → 6.2 → 9.4 → 11.3 → 13.2 → 14.4 | 4,105 | 3,725 | 11,570 | 6,135    | 13.2 | 18.7  | 8.4  | 22.2   | 11.0/0.0 | 23.0/4.3 |

- Orders given: 21,817. Rejected: 480 (2.20%).
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 22,990 of 182,500 power-days of the powers the AI runs.
- Decisions per day, all factions: mean 1.32 ms, p99 4.79 ms, max 27.43 ms. One tick: mean 1.37 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 209 days, longest 358 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,852. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 78.1%.
- Armies that lost a battle and were still alive 30 days later: 883 of 1,906 (46.3%).
- Marches ordered: 8,460. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,915. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:

### Conquest and economy by year

| year | independent of 60 | cities per power      | gold                                  | food                                    | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | --------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 50                | 6 / 6 / 7 / 6 / 6     | 3,138 / 3,805 / 3,039 / 3,487 / 2,571 | 2,915 / 2,982 / 3,272 / 3,011 / 2,907   | 2,788 / 2,542 / 2,640 / 2,448 / 2,716 | 0% / 18% / 82% of 256          | 18% (43)               | 133 / 0 / 123             | 47                | 5             |
| 2    | 41                | 6 / 9 / 8 / 7 / 10    | 3,130 / 4,103 / 4,010 / 3,598 / 4,225 | 5,437 / 5,804 / 5,691 / 5,727 / 6,480   | 2,977 / 2,833 / 2,847 / 2,923 / 3,074 | 0% / 42% / 58% of 364          | 18% (151)              | 335 / 3 / 26              | 200               | 65            |
| 3    | 34                | 6 / 11 / 10 / 9 / 12  | 3,381 / 4,487 / 3,678 / 3,848 / 4,048 | 6,436 / 8,775 / 8,204 / 7,821 / 9,388   | 3,178 / 3,525 / 2,942 / 3,258 / 4,098 | 0% / 53% / 47% of 371          | 19% (190)              | 360 / 2 / 9               | 229               | 58            |
| 4    | 29                | 6 / 12 / 10 / 10 / 13 | 3,510 / 4,183 / 3,684 / 3,910 / 4,072 | 6,722 / 10,236 / 8,610 / 8,936 / 10,707 | 3,275 / 4,121 / 3,717 / 3,810 / 5,035 | 0% / 61% / 39% of 378          | 18% (226)              | 363 / 7 / 8               | 279               | 75            |
| 5    | 26                | 5 / 14 / 9 / 12 / 15  | 3,449 / 4,282 / 3,794 / 3,486 / 3,711 | 6,868 / 11,601 / 8,967 / 9,667 / 11,244 | 3,136 / 5,448 / 4,147 / 4,319 / 5,710 | 0% / 56% / 44% of 377          | 18% (206)              | 369 / 7 / 1               | 321               | 121           |

- Half the 60 minor cities independent at the end of year 2: median 41, lowest 38, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 26, lowest 19, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 83 of 89 such power-years grew, 6 did not. met (met at 90% or more). Those that did not: macedon in year 3 1, macedon in year 4 1, rome in year 5 1, carthage in year 5 1, persia in year 4 1, persia in year 5 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.

## Rome gives no orders

| power          | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms   | battles  |
| -------------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | -------- | -------- |
| rome (passive) | 4.0 → 4.0 → 1.2 → 0.0 → 0.0 → 0.0    | 0     | 0     | 0      | 0        | 0.0  | 0.0   | 4.0  | 0.0    | 0.0/0.0  | 0.7/5.8  |
| carthage       | 4.0 → 6.9 → 9.4 → 12.7 → 15.1 → 16.3 | 4,936 | 4,589 | 14,138 | 7,667    | 12.4 | 18.9  | 6.6  | 22.1   | 9.5/0.0  | 23.4/4.4 |
| macedon        | 4.0 → 6.6 → 8.4 → 9.5 → 9.9 → 9.7    | 3,749 | 3,467 | 9,771  | 4,829    | 11.3 | 16.9  | 11.2 | 22.2   | 7.4/0.0  | 18.0/4.8 |
| egypt          | 4.0 → 6.6 → 8.6 → 10.4 → 10.4 → 11.2 | 3,535 | 3,918 | 10,274 | 4,856    | 11.6 | 20.4  | 13.2 | 25.0   | 10.6/0.0 | 22.4/8.2 |
| persia         | 4.0 → 6.2 → 8.6 → 11.4 → 13.8 → 14.6 | 4,177 | 4,228 | 11,833 | 5,920    | 12.8 | 20.5  | 9.9  | 24.1   | 12.2/0.0 | 23.3/5.5 |

- Orders given: 18,728. Rejected: 307 (1.64%).
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 19,541 of 146,000 power-days of the powers the AI runs.
- Decisions per day, all factions: mean 0.93 ms, p99 3.09 ms, max 8.48 ms. One tick: mean 1.03 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 173 days, longest 361 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,751. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 78.5%.
- Armies that lost a battle and were still alive 30 days later: 801 of 1,793 (44.7%).
- Marches ordered: 7,431. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,777. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
- Seeds where a power declares war on Rome: 20/20.

### Conquest and economy by year

| year | independent of 60 | cities per power      | gold                                  | food                                  | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | --------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 50                | 4 / 7 / 7 / 7 / 6     | 8,739 / 3,471 / 3,436 / 3,161 / 2,701 | 3,582 / 3,130 / 3,302 / 2,900 / 2,891 | 2,835 / 2,601 / 2,800 / 2,442 / 2,687 | 0% / 18% / 82% of 214          | 19% (38)               | 115 / 0 / 99              | 9                 | 3             |
| 2    | 44                | 1 / 10 / 8 / 9 / 9    | 8,811 / 4,298 / 4,269 / 3,487 / 3,777 | 3,901 / 6,464 / 6,383 / 6,008 / 6,511 | 3,479 / 3,253 / 3,055 / 2,883 / 2,998 | 0% / 45% / 55% of 288          | 19% (129)              | 275 / 1 / 12              | 173               | 87            |
| 3    | 36                | 0 / 12 / 10 / 11 / 12 | 0 / 3,953 / 3,715 / 3,665 / 3,504     | 0 / 11,375 / 8,033 / 9,010 / 9,735    | 0 / 4,528 / 3,489 / 3,806 / 3,397     | 0% / 63% / 37% of 311          | 19% (195)              | 304 / 2 / 5               | 151               | 38            |
| 4    | 31                | 0 / 15 / 11 / 10 / 14 | 0 / 3,945 / 3,543 / 3,713 / 3,971     | 0 / 12,912 / 9,405 / 9,350 / 10,777   | 0 / 5,929 / 4,286 / 4,469 / 4,536     | 0% / 64% / 36% of 374          | 18% (234)              | 367 / 4 / 3               | 272               | 96            |
| 5    | 28                | 0 / 15 / 11 / 12 / 15 | 0 / 4,553 / 3,373 / 3,745 / 4,239     | 0 / 13,884 / 9,701 / 10,014 / 11,703  | 0 / 7,787 / 4,648 / 4,711 / 5,818     | 0% / 60% / 40% of 343          | 18% (197)              | 338 / 4 / 1               | 290               | 89            |

- Half the 60 minor cities independent at the end of year 2: median 44, lowest 40, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 28, lowest 24, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 108 of 111 such power-years grew, 3 did not. met (met at 90% or more). Those that did not: carthage in year 5 2, carthage in year 2 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 4/20. NOT met.
  Seed 1 played twice ends in the same state: yes.

## Peace before

| Wars                                                                                 | Begun                | Ended in peace | Ended in a death | Still running | Median days | Longest days | Peace as things stand / gold / cities |
| ------------------------------------------------------------------------------------ | -------------------- | -------------- | ---------------- | ------------- | ----------- | ------------ | ------------------------------------- |
| All                                                                                  | 1869                 | 972            | 851              | 46            | 112         | 316          | 119 / 787 / 66                        |
| Great power against great power                                                      | 864                  | 813            | 12               | 39            | 121         | 316          | 95 / 652 / 66                         |
| With a minor                                                                         | 1005                 | 159            | 839              | 7             | 70          | 235          | 24 / 135 / 0                          |
| Great-power pairs at war for all 10 years: 0                                         |
| Days from a peace to the same pair's next war: 673 returns, shortest 365, median 388 |
| Most wars between one pair in one seed: 7                                            |
| Power                                                                                | Median days at peace | Fewest         | Most             |
| ---                                                                                  | ---                  | ---            | ---              |
| rome                                                                                 | 619                  | 341            | 896              |
| carthage                                                                             | 720                  | 284            | 1203             |
| macedon                                                                              | 680                  | 311            | 1166             |
| egypt                                                                                | 673                  | 414            | 1245             |
| persia                                                                               | 998                  | 648            | 1514             |

## Peace after

| Wars                                                                                 | Begun                | Ended in peace | Ended in a death | Still running | Median days | Longest days | Peace as things stand / gold / cities |
| ------------------------------------------------------------------------------------ | -------------------- | -------------- | ---------------- | ------------- | ----------- | ------------ | ------------------------------------- |
| All                                                                                  | 1983                 | 1037           | 896              | 50            | 106         | 696          | 132 / 862 / 43                        |
| Great power against great power                                                      | 899                  | 850            | 11               | 38            | 122         | 696          | 114 / 693 / 43                        |
| With a minor                                                                         | 1084                 | 187            | 885              | 12            | 70          | 260          | 18 / 169 / 0                          |
| Great-power pairs at war for all 10 years: 0                                         |
| Days from a peace to the same pair's next war: 727 returns, shortest 365, median 391 |
| Most wars between one pair in one seed: 7                                            |
| Power                                                                                | Median days at peace | Fewest         | Most             |
| ---                                                                                  | ---                  | ---            | ---              |
| rome                                                                                 | 684                  | 329            | 1784             |
| carthage                                                                             | 426                  | 172            | 918              |
| macedon                                                                              | 418                  | 175            | 934              |
| egypt                                                                                | 480                  | 182            | 928              |
| persia                                                                               | 727                  | 291            | 1335             |
