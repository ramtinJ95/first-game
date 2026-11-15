# Trade validation

## Verdict

- **Rules slowest-day guard met:** all three alternating comparisons with main are within +10%; every measured head maximum is lower. Median and p95 costs are also reported, not hidden.
- **Passive Rome survival restored:** 0/20 early defeats against an allowed maximum of two; main also has 0/20. The all-AI control remains 0/20.
- Trade share 35.9–37.2%, treasury cap zero days in years 2–5, suitable payback 1.13–2.03 years, and the most valuable partner's war costs at least 14.8% of net income.
- **Owner decision:** accept the measured 88-day decision interval for PR51, rather than the original 60. The next slice, goods required by troops and buildings, adds choices. The raw harness still prints its original 60-day target as not met.
- Every previously met world, AI and peace guard remains met. The largest-power distribution was already not met on main (Persia leads 9/20); after trade Carthage leads 11/20. This is not claimed as a newly met target.
- **Rules frame guard met in the tested views:** all four median/p95 comparisons are within +10% at both zooms over three balanced rounds on automatic merges with current main #57.
- **Look frame guard NOT met:** the slow frames came from the goods suffix pushing a resting army off land, so `landShift` ran about 28,000 land tests per frame. With that shift remembered, three rounds against main `aef5b10` keep every median and every per-frame p95 within +10%, selected and unselected. With Roma selected the 5-second meter's p95 is still over: +62% interval and +60% drawn at middle, +11% and +14% at closest. The cause of that tail is not established. See [trade frame checks](trade-handover.md).

## Rules delivery source and verification

This section records the #51 delivery. Its subsequent merge and the #53 rendering follow-up are recorded below.

The branch is based on main `9895ab1`, including the second-front peace correction in #55 and warning changes in #56. Baseline tables were rerun on that exact main. Feature tables are fresh runs with the final pressure-reservation correction at `c2016ba`, not extrapolated from older peace rules. Check/build and all 1,100 rules tests pass; the look stack passes 1,113 tests and five trade browser tests on its isolated production build.

Main `df0623b` (#57) then changed rendering. Its `src/sim` and `scripts/sim*` have an empty diff against `9895ab1`, so the simulation baseline is unchanged. Both PRs remain mergeable; as instructed they were not rebased merely to absorb it. Temporary automatic merges with #57 pass check/build, 1,109 rules tests and 1,122 look tests. All five trade/look browser tests also pass on that merged production build. The frame comparison and latest captures use this actual merged render target, not the earlier renderer.

The geometry and quote-pruning optimizations were separately compared with `9ef87d0` for **109,500 paired days**: seeds 1–20, all-AI for ten years and passive Rome for five. Orders, events and rejections matched daily; complete JSON states matched yearly. That is evidence for the optimizations, not a claim that the later pressure-policy correction preserves old trajectories. Unit tests also preserve every feasible road among all 6,400 city pairs at both land limits and compare AI choices with exhaustive quotes across 48 seed, budget and administration cases.

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

The first correction used the **uncommitted field strength already calculated for normal war selection**, rather than counting armies twice against existing fronts. It restored the old-base result to 2/20, but was incomplete.

### Completing the correction after main #55

On the new main, the intermediate feature `5acdad8` fails in seeds 7, 18 and 19, on days 693, 663 and 705. The added failure is seed 7. Both old and new feature versions declare Carthage's war on day 303 and Macedon's on day 318: #55 did **not** bring those declarations forward. It changes Egypt's peace wish on day 388, delays the Egypt–Hierosolyma treaty from 397 to 448, and adds a battle on 414 that advances the shared RNG stream. Roman formations first diverge on 419; the resulting campaigns bring Carthage to Roma sooner.

The declaration still exposes a real commitment gap. On day 303, all three Carthaginian armies march on Cidamus, whose garrison has 1,200 men. Its surviving field army has zero morale, so the intermediate accounting reserves zero strength and counts Carthage at 2.068× Rome. Finishing that conquest and leaving its occupation garrison reduces Carthage to 1.814× Rome on day 328.

Pressure therefore now reserves the **greater of each existing front's field strength and its city's existing `BLOCKADE_ODDS` garrison requirement**. This is a planning heuristic using the same garrison strength points as normal war scoring, not an exact allocation of soldiers. A broken or absent field army no longer makes an unfinished conquest free. Normal war selection, the 2× threshold, trade income, recruitment prices and #55's peace protections are unchanged. Both new absent/broken-army regression tests fail when pressure uses the old reservation, and pass with the correction. Fresh full runs restore early defeats to **0/20 in both controls**.

Passive human invitations remain unaccepted; an AI-controlled player gives an explicit consent order.

Both outside-review acceptance defects are fixed: queued war intentions withdraw invitations before consent; acceptance rechecks reserves after already-chosen spending. The actual faction's war policy is used, not a great-power policy for minors. Known truce expiry and already-trained reinforcements are checked for next-day war without predicting battle rolls. Failed commitments lapse without payment and announce the reason.

## Slowest-day investigation and results

Profiling preceded game changes. The original instrumented peak was seed 1, day 7: about 38 ms in monthly trade selection, roughly 35 ms of that in geometry/pathfinding. Athenai and Lugdunum each held about 1,210 gold, below their 1,500 reserve alone, yet searched city pairs before rejecting the budget. Paths were **already cached** per world/endpoints/mode; the missing early affordability test caused the unnecessary cold work.

After budget and straight-distance cost bounds, the remaining repeatable peak was seed 1, day 922. It made 31 land searches, about 6.1 ms, of which 23 could not fit the 2,250 km march limit: Balkan/Italian armies searched all the way round the Mediterranean to African ports before rejecting the detour. This was not a cache flush (1,170 cached roads, below the 50,000 bound). A conservative circle-limited connectivity index now rejects those impossible walks, retaining the ordinary pathfinder and exact length check for all possible candidates. The trace's guard cost was 1.13 ms cold, 0.075 ms warm.

The next cold peak, day 1,004, searched 44 paths, including 26 sea paths, while choosing one route. Return per cost is bounded by goods × administrative share / 740; once its rounded maximum and capped income have been reached, further quotes cannot win. That bound now avoids losing candidates without changing the original first-tie winner. Daily hostility indexing also reads actual wars instead of an endpoint/army-owner Cartesian product.

`node scripts/bench-trade.ts` warms seed 21 for a year and measures complete AI plus immutable ticks for 5,475 days (seeds 1–3, five years each). Copy it unchanged to another checkout's `scripts/` to compare sources. It prints the peak's seed/day and AI/tick split. `node --cpu-prof --cpu-prof-interval=100 scripts/bench-trade.ts` records a CPU profile; profiling overhead is not used as the acceptance timing. The comparisons below use current main `9895ab1` and feature `c2016ba`, alternate main/head order, and run without this worker's other CPU/GPU tests. No failed earlier trial is passed off as the final result.

| Round | Main median / p95 / max ms | Trade median / p95 / max ms | Slowest-day change |
| ----- | -------------------------- | --------------------------- | ------------------ |
| 1     | 0.898 / 2.026 / 4.951      | 1.097 / 1.848 / 4.507       | -9.0%              |
| 2     | 0.904 / 2.062 / 4.993      | 1.108 / 1.837 / 4.317       | -13.5%             |
| 3     | 0.906 / 2.074 / 4.969      | 1.100 / 1.850 / 4.299       | -13.5%             |

## Original frame comparison (before #51 merged)

The existing `e2e/frame-bench.ts` measures the same six-day world, treasuries, armies and camera in all three production builds. Baseline is main `df0623b` (#57). Rules `c2016ba` and look `518ce71` were each automatically merged with that main in temporary worktrees, without committing or rebasing the PR branches, which GitHub reports mergeable. Main removes only goods and trade records; rules adds live route markers; the look adds merchant figures. Each window verifies that the clock advances and the look actually draws merchants, with exact-resolution sheets ready. Full drawing, SwiftShader flags, and the original 1.5-second warm-up plus 5-second sampling window are unchanged.

All simulation, unit, browser and capture jobs owned by this worker had finished before this comparison. Three rounds rotate main/rules/look, rules/look/main, then look/main/rules, placing each build first, middle and last once. As in the existing harness, acceptance compares the **median of three rounds**, without deleting readings. Each cell is delivered interval median/p95; drawn work median/p95, in ms.

| Round | Zoom    | Main                     | Rules                    | Look                     |
| ----- | ------- | ------------------------ | ------------------------ | ------------------------ |
| 1     | middle  | 16.7 / 33.4; 21.1 / 22.8 | 16.7 / 33.4; 22.8 / 25   | 33.3 / 33.4; 27.9 / 30.5 |
| 1     | closest | 16.7 / 33.4; 23 / 25.1   | 16.7 / 33.4; 22.7 / 24.7 | 33.3 / 33.4; 26.6 / 28.9 |
| 2     | middle  | 16.8 / 33.4; 24.5 / 26.9 | 33.2 / 33.4; 25 / 26.9   | 16.8 / 33.4; 24.7 / 26.7 |
| 2     | closest | 16.7 / 33.4; 23.7 / 26.4 | 33.3 / 33.4; 25 / 27.3   | 33.3 / 33.4; 25.1 / 27.7 |
| 3     | middle  | 16.7 / 33.4; 23.3 / 25.3 | 16.7 / 33.4; 23.4 / 25.8 | 16.7 / 33.4; 23.8 / 25.6 |
| 3     | closest | 16.7 / 33.4; 21.7 / 23.7 | 16.7 / 33.4; 21.8 / 25.6 | 16.7 / 33.4; 21.9 / 24.3 |

| Zoom    | Build | Three-round interval median / p95 | Three-round drawn median / p95 | Change vs main: interval median / p95; drawn median / p95 | ≤10% all four |
| ------- | ----- | --------------------------------- | ------------------------------ | --------------------------------------------------------- | ------------- |
| middle  | main  | 16.7 / 33.4                       | 23.3 / 25.3                    | 0.0% / 0.0% / 0.0% / 0.0%                                 | met           |
| middle  | rules | 16.7 / 33.4                       | 23.4 / 25.8                    | 0.0% / 0.0% / 0.4% / 2.0%                                 | met           |
| middle  | look  | 16.8 / 33.4                       | 24.7 / 26.7                    | 0.6% / 0.0% / 6.0% / 5.5%                                 | met           |
| closest | main  | 16.7 / 33.4                       | 23 / 25.1                      | 0.0% / 0.0% / 0.0% / 0.0%                                 | met           |
| closest | rules | 16.7 / 33.4                       | 22.7 / 25.6                    | 0.0% / 0.0% / -1.3% / 2.0%                                | met           |
| closest | look  | 33.3 / 33.4                       | 25.1 / 27.7                    | 99.4% / 0.0% / 9.1% / 10.4%                               | NOT met       |

Earlier software trials were not a pass: a low-starting-load trial measured main drawn medians 34.0/36.8 ms, rules 38.4/39.7, and look 49.9/47.6 at middle/closest zoom while load rose. CDP profiles then put about 94–95% of samples in synchronized GPU `readPixels`; the trader routine had about 3.8 ms self time over a 6.65-second window. A same-look-source ablation omitting only merchant figures was inconsistent: forward middle zoom was 38.0 ms without figures versus 42.3 with them, but reverse was 37.4 versus 37.1; closest figures were 36.5/37.7 versus 37.4/35.2 without. This did not justify a speculative scene-cache rewrite, and no renderer optimization was made from it. An initial comparison on the pre-#57 renderer was stopped explicitly when #57 landed; those incomplete old-target readings are not mixed into this complete new-target comparison. These earlier results are disclosed, not relabelled as successful controls.

The CI frame job is a separate smoke measurement of each revision’s day-301 AI world on a Linux software GPU, not a matched-state relative budget assertion. Green functional browser or frame jobs alone do not prove this comparison. The table applies to these two tested moving-merchant views and builds, not every future map workload or physical GPU.

## PR53 frame follow-up

After #51 merged as `c02aec7`, #53 was cleanly rebased onto that actual squash commit
(`729102f` before the optimization edits). The rules control's complete tree at
`4cea1c0` is identical to `c02aec7`. The owner requested the same +10% limit for all
four interval/drawn median/p95 metrics, at both zooms, **against these merged rules**,
with selected routes and merchants on screen. Unselected views are also checked
for regressions. The original failed comparison above is retained, not relabelled.

### Drawn-frame profiles

Before editing the renderer, an exact single-drawn-frame WebGL trace of the closest
selected-city view submitted 83,376 indices in look versus 27,972 in rules: about
55,400 extra indices from selected trade paths. The look drew two selected routes
and three merchant sprites with their exact-resolution sheets ready. It had 14
draw calls, one offscreen swell pass, and no texture uploads. Offscreen road/sea
dashes were rebuilt and submitted on every frame. The nearby-window CPU profile
was dominated by synchronized GPU waiting, not trader scene construction; this did
not justify freezing or speculatively caching merchant animation.

A separate cold replay on the pinned **pre-optimization** sources enters 4 px/km
directly from the wide map, including #57's natural-coast restroke above 1.75 and
its first mask paints. Its one drawn frame takes 2,621.8 ms in rules and 2,605.2 ms
in look, each with 32 offscreen draws. These are first-paint diagnostics, not the
steady-state budget sample. Merchant sheets are still pending in that cold frame
(zero drawn merchant sprites); the warm trace above separately verifies real
merchants. The shared cold work is not passed off as a trade-specific regression.

### Clipping and retained geometry: failed candidate

The first candidate clipped moving paths before making their seven-pixel dashes
and five-pixel gaps, preserving phase through skipped lengths and corners. Both
halo and ink reused those segments. Selected trade geometry was retained until
its view or route changed. A warm frame fell from 83,376 to 52,236 indices, with
the same two paths and three merchants. That reduction alone was **not enough**.

Three alternating pairs use rules/look, look/rules, then rules/look. Each build
loads the same initial six-played-day world, treasuries, armies and camera, and
runs at speed 1. Full SwiftShader drawing and the original 1,500 ms warm-up plus
5,000 ms sample are unchanged. The clock must advance, and merchants and ready
sheets are checked. No other tests owned by this worker run during sampling; a
peer's one-worker unit suite overlapped the first rules run, so this is not called
a wholly idle host. All readings remain included. Each cell is interval
median/p95; drawn median/p95, in ms.

| Round | Build | Middle                   | Closest                  |
| ----- | ----- | ------------------------ | ------------------------ |
| 1     | rules | 16.8 / 33.4; 23.9 / 28.4 | 33.3 / 33.4; 25.7 / 29.9 |
| 1     | look  | 33.3 / 33.4; 26.9 / 30.4 | 33.3 / 33.4; 28.1 / 31.4 |
| 2     | look  | 33.3 / 33.4; 25 / 27.2   | 33.3 / 33.4; 25.5 / 27.5 |
| 2     | rules | 16.7 / 33.4; 22.5 / 24.5 | 16.7 / 33.4; 22.5 / 24.6 |
| 3     | rules | 16.7 / 33.4; 21.9 / 23.5 | 16.7 / 33.4; 22 / 24.6   |
| 3     | look  | 16.7 / 33.4; 23.4 / 25.8 | 33.3 / 33.4; 25.6 / 27.1 |

| Zoom    | Rules median-of-three    | Look median-of-three     | Change: interval median/p95; drawn median/p95 | All four ≤10% |
| ------- | ------------------------ | ------------------------ | --------------------------------------------- | ------------- |
| middle  | 16.7 / 33.4; 22.5 / 24.5 | 33.3 / 33.4; 25 / 27.2   | +99.4% / 0.0%; +11.1% / +11.0%                | NOT met       |
| closest | 16.7 / 33.4; 22.5 / 24.6 | 33.3 / 33.4; 25.6 / 27.5 | +99.4% / 0.0%; +13.8% / +11.8%                | NOT met       |

### Bounded route-texture candidate: budget still not met

The remaining selected-route graphic still submits 24,624 indices on every warm
frame. The next candidate reuses #57's existing `cacheDrawing` primitive instead
of adding another cache framework: full world-space source art with pixel-sized
strokes is painted into a view texture with a 256 px margin. Covered pans and
resizes reuse it; zooms, changed routes, uncovered views and context restoration
repaint it. One sprite replaces the static route vertices, hidden entirely when
no routes are selected. Moving army paths and merchant animation are not cached.
Dash length, widths, halo and colours stay unchanged; raster reuse during a covered
pan follows the existing coast-ink behavior.

This candidate (`b9624ba`) passed static checks/build, all 1,129 unit tests and six
affected browser tests. The browser checks include isolated route ink, covered
resize, exact pixels across WebGL restoration, and clearing closed routes. Scoped
read-only review found no actionable cache ownership or transform issue. A fresh
warm frame at exactly 4 px/km submits 27,678 indices, 13 draws, one swell offscreen
pass and zero uploads, with two selected routes and three merchants. This is a
vertex reduction, not proof of the frame budget.

The benchmark's rounded wheel notches previously reached 0.9573/3.8821 rather than
the advertised 1/4 px/km. A final fractional wheel step now reaches the exact
camera target, asserted from the renderer before sampling; the 1,500/5,000 ms
windows are unchanged. An incomplete nominal-zoom cache run is not acceptance
evidence. The complete exact-zoom selected comparison follows, with every reading:

| Round | Build | Middle                   | Closest                  |
| ----- | ----- | ------------------------ | ------------------------ |
| 1     | rules | 16.7 / 33.4; 23.3 / 25.9 | 33.3 / 33.4; 24.6 / 28.5 |
| 1     | look  | 33.3 / 33.4; 25.1 / 27.8 | 33.3 / 33.4; 25 / 29.1   |
| 2     | look  | 33.2 / 33.4; 24.4 / 27.5 | 33.3 / 33.4; 24.5 / 28.5 |
| 2     | rules | 16.7 / 33.4; 23.2 / 25.5 | 33.3 / 33.4; 26 / 28.3   |
| 3     | rules | 16.8 / 33.4; 24.2 / 26.5 | 16.7 / 33.4; 22.4 / 25.7 |
| 3     | look  | 16.7 / 33.4; 23.4 / 25.3 | 16.7 / 33.4; 23.8 / 25.8 |

| Zoom    | Rules median-of-three    | Look median-of-three     | Change: interval median/p95; drawn median/p95 | All four ≤10% |
| ------- | ------------------------ | ------------------------ | --------------------------------------------- | ------------- |
| middle  | 16.7 / 33.4; 23.3 / 25.9 | 33.2 / 33.4; 24.4 / 27.5 | +98.8% / 0.0%; +4.7% / +6.2%                  | NOT met       |
| closest | 33.3 / 33.4; 24.6 / 28.3 | 33.3 / 33.4; 24.5 / 28.5 | 0.0% / 0.0%; −0.4% / +0.7%                    | met           |

No unselected acceptance matrix was run after this failure. A later ON/OFF marker
layer ablation had zero selected paths in its ON scenes versus two in its OFF
scenes; its fourth case stopped on the merchant guard. That is an invalid scene
comparison, not evidence that transparent sprite area is the cost. No cropping
change was made from it. A save-day wait can match the opening game's day before
an asynchronous file drop is received; whether that caused these particular
scenes remains unconfirmed. The harness now pauses and flushes the old game and
requires a changed, drawn state after the drop, in addition to the fixture day.
Further profiling also checks the selected city and route count before sampling.
PR53 remains draft: neither numerical failure nor an invalid ablation is a pass.

### Final matched-day control and untested trimming handover

The earlier setup let the clock run during camera/terrain preparation. The final
protocol instead pauses the predecessor, witnesses receipt of a changed drawn
state, keeps day 7 paused through exact camera and sheet readiness, and explicitly
resumes immediately before the unchanged 1,500/5,000 ms window. All twelve final
views advance from day 7 to 13. Look has two selected routes and four merchant
sprites at middle, three at closest, in every reading. All three alternating pairs
are retained; a separate overlapping diagnostic pair is not acceptance evidence.

The tested app is **`b9624ba`**, before sprite trimming, against the complete
`c02aec7` rules tree. Median-of-three results, in milliseconds:

| Zoom    | Rules interval med/p95; drawn med/p95 | Look                     | Change: interval med/p95; drawn med/p95 | Verdict |
| ------- | ------------------------------------- | ------------------------ | --------------------------------------- | ------- |
| middle  | 16.7 / 33.4; 21.7 / 23.4              | 16.7 / 33.4; 23.2 / 29.7 | 0% / 0%; +6.9% / +26.9%                 | FAIL    |
| closest | 16.7 / 33.4; 22.1 / 24.2              | 16.7 / 33.4; 23.4 / 25.4 | 0% / 0%; +5.9% / +5.0%                  | PASS    |

The complete raw readings and profiles are committed under
[`docs/evidence/trade-frames`](evidence/trade-frames). The fresh single drawn
middle frame is 21.9 ms: 19.8 ms in synchronized GPU completion (`readPixels`),
2.1 ms in JS/submission, 29,202 indices, 13 draws, one swell offscreen pass, zero
uploads, two routes and four merchants. Closest is 22.8 ms, including 21.4 ms GPU
wait. These are typical frames, **not captured p95 frames**; they do not prove the
tail's root cause.

The next candidate trims the cached route sprite to conservative visible dash
bounds, keeping the full private cache texture for coverage. Pure geometry puts
about 81% of its middle-zoom screen quad outside the ink's bounding rectangle.
This is a GPU fill hypothesis, not an isolated causal timing result. No merchant
animation, route ink or quality reduction is intended. **The trimming candidate
and its new tests have not been run or built.** Its commit is explicitly labelled
untested. There is no post-trim budget result.

The trimming candidate was measured later and kept. [Trade frame checks](trade-handover.md)
has the cause of the slow frames, the fix, the result on `aef5b10`, the method and
what makes a run invalid. `scripts/trade-frame-bench.mjs` drives that comparison.

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
| 1    | 14   | 8        | 6       | 20    | 12     | egypt 20    | 5     | 207    | 2                         | 155              | 0 (1394)                     | 70 days, macedon from day 3581; could take: 13 days, macedon from day 511   |
| 2    | 3    | 25       | 7       | 7     | 20     | carthage 25 | 5     | 213    | 3                         | 69               | 0 (3336)                     | 5 days, rome from day 2586; could take: 5 days, rome from day 2586          |
| 3    | 18   | 0        | 14      | 17    | 19     | persia 19   | 4     | 198    | 0                         | 60               | 0 (4196)                     | 24 days, macedon from day 777; could take: 24 days, macedon from day 777    |
| 4    | 0    | 19       | 16      | 0     | 23     | persia 23   | 3     | 166    | 4                         | 62               | 0 (2902)                     | 206 days, egypt from day 2290; could take: 5 days, egypt from day 3351      |
| 5    | 17   | 13       | 1       | 13    | 22     | persia 22   | 5     | 221    | 0                         | 69               | 0 (2485)                     | 192 days, macedon from day 3093; could take: 1 days, carthage from day 202  |
| 6    | 0    | 18       | 3       | 13    | 19     | persia 19   | 4     | 215    | 2                         | 89               | 0 (2742)                     | 88 days, macedon from day 3448; could take: 14 days, rome from day 1364     |
| 7    | 0    | 22       | 1       | 18    | 14     | carthage 22 | 4     | 179    | 2                         | 49               | 0 (2353)                     | 172 days, macedon from day 3189; could take: 14 days, rome from day 834     |
| 8    | 13   | 19       | 0       | 12    | 12     | carthage 19 | 4     | 177    | 0                         | 66               | 0 (898)                      | 225 days, macedon from day 1602; could take: 51 days, egypt from day 275    |
| 9    | 1    | 18       | 15      | 14    | 13     | carthage 18 | 5     | 204    | 0                         | 88               | 0 (2817)                     | 110 days, rome from day 2964; could take: 10 days, egypt from day 1799      |
| 10   | 14   | 13       | 5       | 8     | 13     | rome 14     | 5     | 240    | 1                         | 109              | 0 (3268)                     | 86 days, persia from day 1585; could take: 9 days, macedon from day 1198    |
| 11   | 6    | 14       | 12      | 11    | 15     | persia 15   | 5     | 212    | 0                         | 109              | 0 (3207)                     | 162 days, macedon from day 835; could take: 25 days, persia from day 2854   |
| 12   | 0    | 15       | 12      | 3     | 24     | persia 24   | 4     | 206    | 2                         | 91               | 0 (2130)                     | 69 days, rome from day 2474; could take: 14 days, rome from day 2433        |
| 13   | 9    | 22       | 0       | 17    | 13     | carthage 22 | 4     | 201    | 2                         | 63               | 0 (3425)                     | 14 days, egypt from day 925; could take: 14 days, egypt from day 925        |
| 14   | 4    | 19       | 8       | 3     | 23     | persia 23   | 5     | 239    | 2                         | 119              | 0 (2980)                     | 26 days, macedon from day 1679; could take: 26 days, macedon from day 1679  |
| 15   | 0    | 19       | 0       | 11    | 18     | carthage 19 | 3     | 183    | 2                         | 83               | 0 (2846)                     | 138 days, macedon from day 2222; could take: 14 days, macedon from day 1810 |
| 16   | 5    | 15       | 0       | 16    | 20     | persia 20   | 4     | 185    | 1                         | 70               | 0 (3634)                     | 122 days, macedon from day 2818; could take: 12 days, macedon from day 2682 |
| 17   | 16   | 22       | 0       | 13    | 6      | carthage 22 | 4     | 184    | 1                         | 63               | 0 (1889)                     | 139 days, persia from day 2233; could take: 29 days, rome from day 534      |
| 18   | 10   | 15       | 0       | 15    | 19     | persia 19   | 4     | 181    | 0                         | 94               | 0 (2157)                     | 90 days, macedon from day 1676; could take: 14 days, carthage from day 416  |
| 19   | 13   | 5        | 7       | 17    | 16     | egypt 17    | 5     | 219    | 6                         | 123              | 0 (2440)                     | 6 days, rome from day 650; could take: 5 days, persia from day 1723         |
| 20   | 6    | 11       | 13      | 17    | 14     | egypt 17    | 5     | 254    | 2                         | 78               | 0 (5069)                     | 38 days, carthage from day 1698; could take: 8 days, carthage from day 1728 |

Targets:

- The largest power holds at most half the 80 cities: 20/20. met (at least 16).
- At least three powers alive: 20/20. met (at least 16).
- Seeds each power is the largest: rome 1, carthage 7, macedon 0, egypt 3, persia 9. NOT met (none more than 8).
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Sieges begun: 4084. Begun again by the same power within 30 days of ordering its besiegers away from the city: 32.
- The same march ordered again within 30 days: 1709.
- Wars declared by a great power: 1750, of which 19 were declared less than a year before the end and had seen no act yet, and are left out of what follows. Of the other 1731: days until it first fought, besieged, or marched on the enemy: median 1, 90th percentile 75. Never within a year, or before the war ended: 106.
- Attacks a great power lost to the same enemy within 50 km and 90 days of one it lost before: 168.
- Changes of stance by one army in one battle, over 2045 army-battles: median 1, most 2, none in 438.
- Armies lost to sallies: 0. Men lost to sallies: 56168.
- Longest stretch a power at war had an idle army that could reach an enemy city, no army on the move, and gave no order: median 88 days, longest 225 days.
- The same, counting only days on which its idle armies together had the men to take an enemy city they had a route to: median 14 days, longest 51 days.

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
| 1    | 0    | 21       | 0       | 15    | 17     | carthage 21 | 3     | 221    | 0                         | 111              | 0 (5353)                     | 145 days, macedon from day 2026; could take: 13 days, macedon from day 1704 |
| 2    | 2    | 21       | 12      | 12    | 17     | carthage 21 | 5     | 224    | 1                         | 165              | 0 (3229)                     | 80 days, rome from day 2313; could take: 11 days, persia from day 1305      |
| 3    | 4    | 19       | 11      | 10    | 16     | carthage 19 | 5     | 236    | 0                         | 129              | 0 (2795)                     | 15 days, rome from day 2169; could take: 6 days, egypt from day 393         |
| 4    | 14   | 15       | 5       | 1     | 31     | persia 31   | 5     | 266    | 3                         | 190              | 0 (3420)                     | 126 days, egypt from day 3394; could take: 8 days, egypt from day 691       |
| 5    | 4    | 19       | 15      | 6     | 20     | persia 20   | 5     | 264    | 3                         | 115              | 0 (3177)                     | 1 days, carthage from day 147; could take: 1 days, carthage from day 147    |
| 6    | 0    | 28       | 5       | 14    | 11     | carthage 28 | 4     | 225    | 2                         | 123              | 0 (2325)                     | 83 days, rome from day 571; could take: 14 days, carthage from day 495      |
| 7    | 0    | 27       | 13      | 14    | 9      | carthage 27 | 4     | 232    | 1                         | 137              | 0 (4896)                     | 77 days, egypt from day 2801; could take: 14 days, rome from day 2672       |
| 8    | 3    | 3        | 17      | 11    | 27     | persia 27   | 5     | 240    | 1                         | 101              | 0 (4163)                     | 14 days, rome from day 1001; could take: 14 days, rome from day 1001        |
| 9    | 8    | 14       | 13      | 11    | 17     | persia 17   | 5     | 240    | 3                         | 142              | 0 (3506)                     | 9 days, egypt from day 599; could take: 3 days, egypt from day 605          |
| 10   | 0    | 17       | 11      | 16    | 14     | carthage 17 | 4     | 195    | 1                         | 108              | 2 (3921)                     | 68 days, macedon from day 1617; could take: 14 days, egypt from day 487     |
| 11   | 2    | 11       | 7       | 11    | 23     | persia 23   | 5     | 226    | 0                         | 99               | 0 (2730)                     | 112 days, rome from day 3415; could take: 11 days, persia from day 3626     |
| 12   | 6    | 18       | 7       | 11    | 25     | persia 25   | 5     | 241    | 1                         | 87               | 0 (4569)                     | 27 days, rome from day 277; could take: 6 days, rome from day 312           |
| 13   | 16   | 18       | 7       | 14    | 8      | carthage 18 | 5     | 268    | 5                         | 127              | 0 (3045)                     | 8 days, persia from day 2424; could take: 8 days, persia from day 2424      |
| 14   | 0    | 29       | 0       | 11    | 11     | carthage 29 | 3     | 212    | 2                         | 101              | 1 (3808)                     | 134 days, macedon from day 2392; could take: 5 days, macedon from day 2521  |
| 15   | 0    | 15       | 0       | 20    | 18     | egypt 20    | 3     | 220    | 3                         | 108              | 0 (3772)                     | 92 days, macedon from day 2560; could take: 10 days, egypt from day 2390    |
| 16   | 2    | 17       | 14      | 5     | 19     | persia 19   | 5     | 261    | 2                         | 144              | 0 (3975)                     | 9 days, macedon from day 3358; could take: 9 days, macedon from day 3358    |
| 17   | 0    | 24       | 6       | 18    | 13     | carthage 24 | 4     | 209    | 0                         | 69               | 0 (1889)                     | 38 days, rome from day 674; could take: 19 days, persia from day 828        |
| 18   | 0    | 14       | 11      | 0     | 27     | persia 27   | 3     | 197    | 0                         | 104              | 0 (3191)                     | 119 days, persia from day 721; could take: 36 days, egypt from day 281      |
| 19   | 3    | 19       | 3       | 8     | 10     | carthage 19 | 5     | 193    | 1                         | 68               | 1 (3317)                     | 135 days, macedon from day 2507; could take: 14 days, macedon from day 3448 |
| 20   | 0    | 27       | 0       | 15    | 12     | carthage 27 | 3     | 207    | 0                         | 86               | 0 (3252)                     | 87 days, rome from day 1235; could take: 26 days, egypt from day 2016       |

Targets:

- The largest power holds at most half the 80 cities: 20/20. met (at least 16).
- At least three powers alive: 20/20. met (at least 16).
- Seeds each power is the largest: rome 0, carthage 11, macedon 0, egypt 1, persia 8. NOT met (none more than 8).
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Sieges begun: 4577. Begun again by the same power within 30 days of ordering its besiegers away from the city: 29.
- The same march ordered again within 30 days: 2314.
- Wars declared by a great power: 1812, of which 11 were declared less than a year before the end and had seen no act yet, and are left out of what follows. Of the other 1801: days until it first fought, besieged, or marched on the enemy: median 1, 90th percentile 74. Never within a year, or before the war ended: 108.
- Attacks a great power lost to the same enemy within 50 km and 90 days of one it lost before: 164.
- Changes of stance by one army in one battle, over 2597 army-battles: median 1, most 2, none in 554.
- Armies lost to sallies: 4. Men lost to sallies: 70333.
- Longest stretch a power at war had an idle army that could reach an enemy city, no army on the move, and gave no order: median 77 days, longest 145 days.
- The same, counting only days on which its idle armies together had the men to take an enemy city they had a route to: median 11 days, longest 36 days.

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
| 4    | persia   | Babylon            | 173           | 1           | 30 / 171               | 174            | 220         |
| 5    | rome     | Augusta Vindelicum | 163           | 1           | 32 / 171               | 164            | 193         |
| 5    | carthage | Caralis            | no battle     |             |                        | 134            | 147         |
| 5    | macedon  | Athenai            | no battle     |             |                        | 156            | 165         |
| 5    | egypt    | Ammon              | no battle     |             |                        | 143            | 152         |
| 5    | persia   | Artaxata           | 201           | 1           | 26 / 171               | 202            | 243         |

## AI before: both controls

## Every faction under the AI

20 seeds, 5 years. Means over the seeds. Cities: start, then after each year. Storms and battles are won/lost.

| power    | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms  | battles  |
| -------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | ------- | -------- |
| rome     | 4.0 → 5.1 → 6.4 → 7.4 → 8.0 → 7.6    | 3,036 | 3,318 | 7,740  | 4,053    | 9.0  | 12.9  | 9.3  | 16.4   | 4.3/0.0 | 11.2/3.7 |
| carthage | 4.0 → 5.9 → 7.2 → 9.1 → 10.4 → 11.5  | 3,874 | 3,629 | 9,982  | 5,290    | 11.6 | 15.8  | 8.3  | 20.1   | 5.8/0.0 | 18.9/3.7 |
| macedon  | 4.0 → 6.0 → 6.5 → 6.5 → 6.4 → 7.4    | 2,531 | 3,547 | 7,645  | 3,800    | 8.8  | 14.8  | 11.4 | 19.3   | 5.3/0.0 | 14.0/6.0 |
| egypt    | 4.0 → 6.1 → 7.5 → 8.9 → 9.3 → 9.6    | 3,256 | 3,399 | 9,161  | 4,893    | 9.8  | 15.7  | 10.2 | 20.9   | 6.4/0.0 | 16.9/6.7 |
| persia   | 4.0 → 6.0 → 8.2 → 10.3 → 12.1 → 13.7 | 3,834 | 3,597 | 11,136 | 6,698    | 11.6 | 16.0  | 6.4  | 18.6   | 9.2/0.0 | 18.6/2.9 |

- Orders given: 16,335. Rejected: 409 (2.50%).
  - 394 × offerPeace: An offer of peace was already made today in this war; it waits for an answer
  - 3 × declareWar: persia is already at war with egypt
  - 2 × retreat: army # is not in a battle
  - 2 × offerPeace: Macedon has # gold, not the # the terms ask
  - 1 × acceptPeace: faction carthago-nova is out of the game
  - 1 × moveArmy: faction petra is out of the game
  - 1 × offerPeace: faction lepcis-magna is out of the game
  - 1 × moveArmy: faction phasis is out of the game
  - 1 × moveArmy: faction numantia is out of the game
  - 1 × moveArmy: faction lutetia is out of the game
  - 1 × moveArmy: faction massalia is out of the game
  - 1 × recruit: heavyCavalry cost # gold, but egypt has #
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 23,454 of 182,500 power-days of the powers the AI runs.
  - 18506 × too few men alone to blockade the garrison of every city it reaches, gathering
  - 1818 × resting, morale below MARCH_MORALE
  - 1643 × waiting for recruits that muster within RALLY_WAIT_DAYS
  - 719 × other
  - 434 × guarding the capital, the weakest army there
  - 334 × every enemy city it reaches is besieged under another power's lead
- Decisions per day, all factions: mean 0.64 ms, p99 2.76 ms, max 7.17 ms. One tick: mean 0.68 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 215 days, longest 358 days.
- Seeds where a great power ends a year with gold or food below zero: 1/20.
- Battles: 1,582. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 79.5%.
- Armies that lost a battle and were still alive 30 days later: 799 of 1,642 (48.7%).
- Marches ordered: 6,550. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,650. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
  - broke to a city: 111 of 125 alive (88.8%). Lost: 11 × gone, 2 × defeat, 1 × battle.
  - broke to the field: 410 of 1,186 alive (34.6%). Lost: 758 × defeat, 6 × gone, 12 × battle.
  - destroyed in the battle: 0 of 8 alive (0.0%). Lost: 8 × battle.
  - surrendered: 0 of 1 alive (0.0%). Lost: 1 × surrender.
  - withdrew to a city: 160 of 181 alive (88.4%). Lost: 21 × gone.
  - withdrew to the field: 118 of 141 alive (83.7%). Lost: 5 × gone, 18 × defeat.

### Conquest and economy by year

Medians over the 20 seeds, taken at the end of each year. Stores are each power's, read in the order rome, carthage, macedon, egypt, persia. Captures, fates, and storm losses add up the year's events over all seeds.

| year | independent of 60 | cities per power    | gold                                  | food                                    | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | ------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 51                | 5 / 6 / 6 / 6 / 6   | 3,054 / 3,829 / 3,962 / 3,732 / 3,440 | 2,561 / 3,242 / 3,384 / 3,176 / 2,985   | 2,304 / 3,242 / 3,180 / 3,135 / 3,018 | 0% / 12% / 89% of 200          | 18% (23)               | 101 / 0 / 99              | 20                | 1             |
| 2    | 44                | 7 / 8 / 7 / 8 / 8   | 2,824 / 3,124 / 3,118 / 3,193 / 3,083 | 4,695 / 6,193 / 5,735 / 6,088 / 6,543   | 2,745 / 2,971 / 3,086 / 3,323 / 3,735 | 0% / 33% / 67% of 303          | 19% (97)               | 289 / 8 / 6               | 169               | 42            |
| 3    | 39                | 8 / 9 / 7 / 9 / 11  | 3,147 / 4,112 / 2,538 / 3,273 / 3,594 | 6,466 / 7,652 / 6,652 / 7,741 / 8,666   | 3,355 / 3,685 / 3,586 / 4,158 / 4,635 | 0% / 48% / 52% of 366          | 19% (169)              | 351 / 9 / 6               | 239               | 84            |
| 4    | 34                | 9 / 10 / 7 / 9 / 12 | 3,312 / 3,710 / 2,965 / 3,193 / 3,877 | 7,204 / 9,076 / 6,970 / 8,340 / 9,751   | 3,511 / 4,292 / 3,205 / 4,242 / 5,981 | 0% / 53% / 47% of 316          | 19% (160)              | 304 / 10 / 2              | 236               | 70            |
| 5    | 30                | 9 / 12 / 9 / 9 / 14 | 3,256 / 3,556 / 3,507 / 3,184 / 3,549 | 8,059 / 10,199 / 7,671 / 9,183 / 11,094 | 4,052 / 5,170 / 3,738 / 4,407 / 7,000 | 0% / 54% / 46% of 317          | 18% (168)              | 302 / 10 / 5              | 246               | 89            |

Targets over the seeds:

- Half the 60 minor cities independent at the end of year 2: median 44, lowest 39, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 30, lowest 22, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 94 of 102 such power-years grew, 8 did not. met (met at 90% or more). Those that did not: carthage in year 4 3, carthage in year 5 2, rome in year 4 1, carthage in year 3 1, egypt in year 4 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.

## Rome gives no orders

20 seeds, 5 years. Means over the seeds. Cities: start, then after each year. Storms and battles are won/lost.

| power          | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms  | battles  |
| -------------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | ------- | -------- |
| rome (passive) | 4.0 → 4.0 → 2.8 → 0.4 → 0.0 → 0.0    | 0     | 0     | 0      | 0        | 0.0  | 0.0   | 4.0  | 0.0    | 0.0/0.0 | 0.9/5.4  |
| carthage       | 4.0 → 6.4 → 8.6 → 11.3 → 13.9 → 15.5 | 4,207 | 4,032 | 13,067 | 8,288    | 10.4 | 16.7  | 5.2  | 18.8   | 7.3/0.0 | 17.7/3.0 |
| macedon        | 4.0 → 6.4 → 7.5 → 9.0 → 8.2 → 8.5    | 3,413 | 3,364 | 8,736  | 4,815    | 9.7  | 13.7  | 9.2  | 17.6   | 5.4/0.0 | 16.3/4.3 |
| egypt          | 4.0 → 6.2 → 7.6 → 8.0 → 8.3 → 9.1    | 3,255 | 3,578 | 8,623  | 4,622    | 10.5 | 15.8  | 10.7 | 20.3   | 6.3/0.0 | 15.9/5.7 |
| persia         | 4.0 → 6.0 → 8.4 → 10.8 → 13.0 → 13.9 | 3,720 | 3,759 | 11,467 | 7,056    | 10.9 | 17.2  | 7.3  | 20.4   | 8.3/0.0 | 20.6/3.4 |

- Orders given: 13,053. Rejected: 249 (1.91%).
  - 240 × offerPeace: An offer of peace was already made today in this war; it waits for an answer
  - 2 × moveArmy: faction sarmizegetusa is out of the game
  - 1 × declareWar: persia is already at war with egypt
  - 1 × moveArmy: faction rhagai is out of the game
  - 1 × storm: macedon has no army in the siege of salona that can storm, unbroken and supplied
  - 1 × retreat: army # is not in a battle
  - 1 × storm: persia has no army in the siege of pergamon that can storm, unbroken and supplied
  - 1 × storm: egypt has no army in the siege of lepcis-magna that can storm, unbroken and supplied
  - 1 × storm: macedon has no army in the siege of knosos that can storm, unbroken and supplied
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 17,680 of 146,000 power-days of the powers the AI runs.
  - 13337 × too few men alone to blockade the garrison of every city it reaches, gathering
  - 1621 × waiting for recruits that muster within RALLY_WAIT_DAYS
  - 1162 × resting, morale below MARCH_MORALE
  - 1076 × every enemy city it reaches is besieged under another power's lead
  - 350 × other
  - 134 × guarding the capital, the weakest army there
- Decisions per day, all factions: mean 0.51 ms, p99 2.13 ms, max 5.46 ms. One tick: mean 0.65 ms.
- Seeds where at least three powers hold more cities than at the start: 18/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 201 days, longest 334 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,424. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 80.5%.
- Armies that lost a battle and were still alive 30 days later: 668 of 1,463 (45.7%).
- Marches ordered: 5,292. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,466. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
  - broke to a city: 148 of 163 alive (90.8%). Lost: 12 × gone, 3 × battle.
  - broke to the field: 328 of 1,051 alive (31.2%). Lost: 697 × defeat, 24 × battle, 2 × gone.
  - destroyed in the battle: 0 of 15 alive (0.0%). Lost: 15 × battle.
  - surrendered: 0 of 1 alive (0.0%). Lost: 1 × surrender.
  - withdrew to a city: 107 of 126 alive (84.9%). Lost: 19 × gone.
  - withdrew to the field: 85 of 107 alive (79.4%). Lost: 21 × defeat, 1 × gone.
- Seeds where a power declares war on Rome: 20/20.

### Conquest and economy by year

Medians over the 20 seeds, taken at the end of each year. Stores are each power's, read in the order rome, carthage, macedon, egypt, persia. Captures, fates, and storm losses add up the year's events over all seeds.

| year | independent of 60 | cities per power    | gold                                  | food                                  | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | ------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 51                | 4 / 6 / 6 / 6 / 6   | 8,739 / 3,792 / 3,950 / 3,652 / 3,432 | 3,582 / 3,279 / 3,431 / 3,129 / 2,985 | 2,835 / 3,254 / 3,194 / 3,139 / 3,026 | 0% / 8% / 92% of 179           | 20% (15)               | 99 / 0 / 80               | 2                 | 0             |
| 2    | 45                | 3 / 9 / 8 / 8 / 8   | 8,896 / 3,581 / 3,564 / 3,346 / 3,217 | 3,973 / 6,792 / 6,505 / 6,296 / 6,696 | 2,943 / 3,720 / 3,509 / 3,472 / 3,635 | 0% / 38% / 62% of 228          | 19% (86)               | 228 / 0 / 0               | 108               | 54            |
| 3    | 41                | 0 / 11 / 9 / 8 / 11 | 0 / 3,354 / 3,307 / 3,563 / 3,592     | 0 / 9,438 / 7,616 / 7,478 / 8,895     | 0 / 4,744 / 3,832 / 3,912 / 4,677     | 0% / 51% / 49% of 266          | 18% (131)              | 259 / 6 / 1               | 175               | 54            |
| 4    | 37                | 0 / 15 / 9 / 9 / 14 | 0 / 3,172 / 3,258 / 3,042 / 3,579     | 0 / 12,344 / 8,293 / 7,791 / 10,429   | 0 / 6,829 / 4,188 / 3,988 / 6,461     | 0% / 52% / 48% of 301          | 19% (153)              | 294 / 6 / 1               | 221               | 65            |
| 5    | 33                | 0 / 15 / 9 / 9 / 14 | 0 / 4,041 / 3,041 / 3,730 / 3,677     | 0 / 13,490 / 8,778 / 8,679 / 11,653   | 0 / 8,775 / 4,324 / 4,565 / 7,546     | 0% / 57% / 43% of 290          | 18% (161)              | 282 / 6 / 2               | 218               | 59            |

Targets over the seeds:

- Half the 60 minor cities independent at the end of year 2: median 45, lowest 42, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 33, lowest 27, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 130 of 133 such power-years grew, 3 did not. met (met at 90% or more). Those that did not: persia in year 5 1, macedon in year 5 1, carthage in year 5 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.

Seed 1 played twice ends in the same state: yes.

## AI after: both controls

## Every faction under the AI

20 seeds, 5 years. Means over the seeds. Cities: start, then after each year. Storms and battles are won/lost.

| power    | cities                               | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms   | battles  |
| -------- | ------------------------------------ | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | -------- | -------- |
| rome     | 4.0 → 4.4 → 5.7 → 5.3 → 5.2 → 4.9    | 2,094 | 2,994 | 5,797  | 2,718    | 7.4  | 12.3  | 11.4 | 16.5   | 4.5/0.0  | 11.3/6.9 |
| carthage | 4.0 → 6.3 → 9.2 → 10.6 → 12.6 → 14.0 | 4,449 | 4,071 | 11,747 | 4,803    | 12.6 | 20.5  | 10.5 | 25.5   | 10.3/0.0 | 21.8/6.4 |
| macedon  | 4.0 → 5.6 → 6.8 → 7.7 → 6.9 → 7.4    | 2,862 | 3,701 | 7,696  | 3,465    | 10.2 | 16.5  | 13.2 | 21.7   | 6.5/0.0  | 17.7/5.7 |
| egypt    | 4.0 → 6.4 → 7.4 → 9.1 → 10.3 → 10.3  | 3,694 | 3,772 | 9,626  | 4,510    | 11.9 | 19.2  | 12.9 | 25.5   | 9.5/0.0  | 22.4/7.3 |
| persia   | 4.0 → 6.2 → 9.2 → 11.3 → 12.8 → 14.1 | 4,111 | 3,950 | 11,482 | 5,910    | 12.9 | 19.3  | 9.3  | 22.6   | 11.1/0.0 | 23.1/6.7 |

- Orders given: 22,210. Rejected: 483 (2.17%).
  - 466 × offerPeace: An offer of peace was already made today in this war; it waits for an answer
  - 2 × retreat: army # is not in a battle
  - 1 × declareWar: rome is already at war with persia
  - 1 × offerPeace: persia is not at war with tarsos
  - 1 × offerPeace: faction tarsos is out of the game
  - 1 × acceptPeace: mogontiacum offers rome no peace
  - 1 × moveArmy: faction knosos is out of the game
  - 1 × recruit: heavyCavalry cost # gold, but persia has #
  - 1 × moveArmy: faction phasis is out of the game
  - 1 × declareWar: persia is already at war with carthage
  - 1 × declareWar: faction athenai is out of the game
  - 1 × acceptPeace: faction salamis is out of the game
  - 1 × openTrade: Burdigala has no free route slot
  - 1 × declareWar: persia is already at war with macedon
  - 1 × openTrade: Karmana has no free route slot
  - 1 × declareWar: persia is already at war with egypt
  - 1 × moveArmy: faction hierosolyma is out of the game
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 23,361 of 182,500 power-days of the powers the AI runs.
  - 17514 × too few men alone to blockade the garrison of every city it reaches, gathering
  - 2538 × waiting for recruits that muster within RALLY_WAIT_DAYS
  - 2296 × resting, morale below MARCH_MORALE
  - 652 × other
  - 195 × every enemy city it reaches is besieged under another power's lead
  - 166 × guarding the capital, the weakest army there
- Decisions per day, all factions: mean 0.61 ms, p99 1.50 ms, max 8.69 ms. One tick: mean 0.69 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 250 days, longest 462 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,920. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 75.6%.
- Armies that lost a battle and were still alive 30 days later: 990 of 2,008 (49.3%).
- Marches ordered: 8,779. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,989. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
  - broke to a city: 143 of 182 alive (78.6%). Lost: 35 × gone, 4 × battle.
  - broke to the field: 470 of 1,324 alive (35.5%). Lost: 826 × defeat, 21 × battle, 4 × gone, 3 × surrender.
  - destroyed in the battle: 0 of 29 alive (0.0%). Lost: 29 × battle.
  - surrendered: 0 of 4 alive (0.0%). Lost: 4 × surrender.
  - withdrew to a city: 196 of 221 alive (88.7%). Lost: 24 × gone, 1 × battle.
  - withdrew to the field: 181 of 248 alive (73.0%). Lost: 63 × defeat, 4 × gone.

### Conquest and economy by year

Medians over the 20 seeds, taken at the end of each year. Stores are each power's, read in the order rome, carthage, macedon, egypt, persia. Captures, fates, and storm losses add up the year's events over all seeds.

| year | independent of 60 | cities per power     | gold                                  | food                                    | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | -------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 51                | 4 / 7 / 5 / 7 / 6    | 2,434 / 3,454 / 3,299 / 3,088 / 2,566 | 2,483 / 2,944 / 2,573 / 2,872 / 2,870   | 2,340 / 2,248 / 2,387 / 2,443 / 2,648 | 0% / 14% / 86% of 244          | 18% (34)               | 118 / 4 / 122             | 68                | 5             |
| 2    | 43                | 5 / 10 / 7 / 8 / 9   | 3,308 / 3,697 / 3,623 / 3,275 / 3,832 | 4,453 / 5,609 / 4,760 / 5,707 / 6,415   | 2,631 / 2,825 / 2,786 / 2,794 / 2,965 | 0% / 46% / 54% of 362          | 18% (164)              | 314 / 5 / 43              | 176               | 63            |
| 3    | 37                | 5 / 9 / 9 / 9 / 12   | 3,127 / 4,097 / 3,469 / 3,989 / 3,791 | 5,300 / 8,153 / 6,952 / 7,894 / 9,146   | 2,753 / 3,435 / 2,773 / 3,208 / 3,784 | 0% / 56% / 44% of 398          | 18% (213)              | 368 / 10 / 20             | 281               | 87            |
| 4    | 33                | 4 / 12 / 7 / 11 / 13 | 3,259 / 4,823 / 3,227 / 3,463 / 3,679 | 5,846 / 10,437 / 7,394 / 9,093 / 10,344 | 2,607 / 4,332 / 3,339 / 3,503 / 4,877 | 0% / 58% / 42% of 370          | 17% (212)              | 358 / 3 / 9               | 294               | 109           |
| 5    | 31                | 3 / 15 / 7 / 10 / 14 | 3,529 / 3,986 / 3,904 / 3,883 / 3,802 | 5,414 / 12,226 / 7,037 / 9,580 / 11,076 | 2,451 / 4,793 / 3,007 / 4,261 / 6,292 | 0% / 58% / 42% of 382          | 19% (212)              | 364 / 7 / 11              | 325               | 109           |

Targets over the seeds:

- Half the 60 minor cities independent at the end of year 2: median 43, lowest 34, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 31, lowest 20, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 67 of 70 such power-years grew, 3 did not. met (met at 90% or more). Those that did not: rome in year 2 1, persia in year 5 1, rome in year 5 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.

## Rome gives no orders

20 seeds, 5 years. Means over the seeds. Cities: start, then after each year. Storms and battles are won/lost.

| power          | cities                                | men   | gold  | food   | manpower | wars | taken | lost | sieges | storms   | battles  |
| -------------- | ------------------------------------- | ----- | ----- | ------ | -------- | ---- | ----- | ---- | ------ | -------- | -------- |
| rome (passive) | 4.0 → 4.0 → 3.0 → 0.6 → 0.3 → 0.2     | 75    | 473   | 209    | 160      | 0.0  | 0.0   | 3.8  | 0.0    | 0.0/0.0  | 0.7/4.7  |
| carthage       | 4.0 → 7.0 → 10.5 → 13.1 → 15.3 → 16.7 | 4,833 | 4,319 | 14,100 | 7,722    | 11.9 | 20.1  | 7.4  | 23.5   | 10.0/0.0 | 22.9/5.4 |
| macedon        | 4.0 → 6.6 → 7.7 → 9.0 → 8.9 → 9.0     | 3,335 | 3,262 | 9,312  | 4,360    | 11.4 | 18.0  | 13.0 | 23.1   | 7.8/0.0  | 17.2/7.4 |
| egypt          | 4.0 → 6.6 → 7.8 → 8.8 → 9.3 → 9.7     | 3,367 | 3,666 | 8,816  | 4,356    | 10.4 | 19.0  | 13.3 | 25.3   | 9.2/0.0  | 21.1/7.4 |
| persia         | 4.0 → 6.2 → 9.7 → 12.1 → 13.7 → 14.8  | 4,351 | 4,149 | 12,061 | 6,150    | 12.5 | 19.6  | 8.8  | 23.4   | 11.2/0.0 | 24.2/4.9 |

- Orders given: 18,757. Rejected: 295 (1.57%).
  - 283 × offerPeace: An offer of peace was already made today in this war; it waits for an answer
  - 3 × declareWar: macedon is already at war with carthage
  - 2 × moveArmy: faction sarmizegetusa is out of the game
  - 1 × moveArmy: faction rhagai is out of the game
  - 1 × moveArmy: faction petra is out of the game
  - 1 × moveArmy: faction syene is out of the game
  - 1 × moveArmy: faction sinope is out of the game
  - 1 × declareWar: egypt is already at war with carthage
  - 1 × moveArmy: faction hierosolyma is out of the game
  - 1 × openTrade: Karmana has no free route slot
- Stall days, on which a power with an idle army and a reachable enemy city gave no order: 17,037 of 146,000 power-days of the powers the AI runs.
  - 12129 × too few men alone to blockade the garrison of every city it reaches, gathering
  - 2208 × waiting for recruits that muster within RALLY_WAIT_DAYS
  - 1868 × resting, morale below MARCH_MORALE
  - 472 × every enemy city it reaches is besieged under another power's lead
  - 239 × other
  - 121 × guarding the capital, the weakest army there
- Decisions per day, all factions: mean 0.52 ms, p99 1.52 ms, max 28.89 ms. One tick: mean 0.67 ms.
- Seeds where at least three powers hold more cities than at the start: 20/20.
- Seeds where a power holds more than half the 80 cities: 0/20.
- Seeds with at least four great powers alive after two years: 20/20.
- Armies idle beside an enemy army or an enemy city at war for more than 30 days: 0.
- Armies idle overseas, where no march reaches a city of their owner, for more than 30 days: 0, of which the menu gives no way to their owner's nearest city: 0.
- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds 194 days, longest 367 days.
- Seeds where a great power ends a year with gold or food below zero: 0/20.
- Battles: 1,717. Days fought: 10th percentile 1, median 1, 90th percentile 2. Over in one day: 75.9%.
- Armies that lost a battle and were still alive 30 days later: 818 of 1,778 (46.0%).
- Marches ordered: 7,408. Longest 90 days. Longer than 90 days: 0. Longest march any army still had ahead on any day: 89 days.
- Retreats: 1,773. Longest 19 days. Longer than 19 days: 0.
- Beaten armies by where they went, alive 30 days later, and how the rest were lost:
  - broke to a city: 152 of 180 alive (84.4%). Lost: 25 × gone, 3 × battle.
  - broke to the field: 372 of 1,192 alive (31.2%). Lost: 803 × defeat, 15 × battle, 2 × gone.
  - destroyed in the battle: 0 of 23 alive (0.0%). Lost: 23 × battle.
  - surrendered: 0 of 1 alive (0.0%). Lost: 1 × surrender.
  - withdrew to a city: 164 of 208 alive (78.8%). Lost: 44 × gone.
  - withdrew to the field: 130 of 174 alive (74.7%). Lost: 44 × defeat.
- Seeds where a power declares war on Rome: 20/20.

### Conquest and economy by year

Medians over the 20 seeds, taken at the end of each year. Stores are each power's, read in the order rome, carthage, macedon, egypt, persia. Captures, fates, and storm losses add up the year's events over all seeds.

| year | independent of 60 | cities per power      | gold                                  | food                                  | manpower                              | captures siege/storm/surrender | storm loss, median (n) | fates occupy/sack/enslave | power takes power | power battles |
| ---- | ----------------- | --------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------ | ---------------------- | ------------------------- | ----------------- | ------------- |
| 1    | 50                | 4 / 7 / 7 / 7 / 6     | 8,739 / 3,039 / 3,436 / 3,161 / 2,702 | 3,582 / 3,146 / 3,302 / 2,900 / 2,891 | 2,835 / 2,620 / 2,800 / 2,442 / 2,687 | 0% / 18% / 82% of 214          | 19% (38)               | 114 / 0 / 100             | 8                 | 3             |
| 2    | 42                | 3 / 11 / 8 / 8 / 9    | 8,906 / 3,686 / 3,852 / 3,430 / 3,379 | 3,987 / 7,138 / 5,890 / 5,708 / 6,467 | 2,921 / 3,376 / 3,111 / 2,837 / 2,972 | 0% / 48% / 52% of 353          | 18% (167)              | 331 / 1 / 21              | 188               | 60            |
| 3    | 37                | 0 / 14 / 9 / 9 / 12   | 0 / 3,961 / 3,560 / 3,918 / 3,650     | 0 / 10,941 / 7,584 / 7,744 / 9,779    | 0 / 4,818 / 3,624 / 3,513 / 4,210     | 0% / 54% / 46% of 303          | 18% (162)              | 290 / 7 / 6               | 202               | 91            |
| 4    | 34                | 0 / 16 / 9 / 9 / 14   | 0 / 4,354 / 3,297 / 3,753 / 4,158     | 0 / 12,537 / 8,150 / 8,448 / 11,042   | 0 / 6,138 / 3,850 / 3,831 / 4,962     | 0% / 61% / 39% of 329          | 19% (199)              | 321 / 4 / 4               | 254               | 105           |
| 5    | 30                | 0 / 17 / 10 / 10 / 15 | 0 / 4,311 / 3,559 / 3,973 / 4,211     | 0 / 14,086 / 8,766 / 8,774 / 11,792   | 0 / 7,768 / 4,412 / 4,627 / 6,147     | 0% / 61% / 39% of 332          | 18% (195)              | 325 / 6 / 1               | 273               | 89            |

Targets over the seeds:

- Half the 60 minor cities independent at the end of year 2: median 42, lowest 36, seeds at or above 30: 20/20. met.
- A fifth independent at the end of year 5: median 30, lowest 23, seeds at or above 12: 20/20. met.
- A power the AI runs that is never at war that year with a stronger power grows that year: 115 of 119 such power-years grew, 4 did not. met (met at 90% or more). Those that did not: persia in year 4 2, macedon in year 4 1, carthage in year 5 1.
- Powers take cities from each other or fight each other, in seeds: year 2 20/20, year 3 20/20, year 4 20/20, year 5 20/20; in every year from year 2: 20/20. met (met at 90% or more of seeds).
- Seeds where a power is wiped out before year 3: 0/20. met.

Seed 1 played twice ends in the same state: yes.

## Peace before

Seeds 1 to 20, 10 years, every faction under the AI.

| Wars                            | Begun | Ended in peace | Ended in a death | Still running | Median days | Longest days | Peace as things stand / gold / cities |
| ------------------------------- | ----- | -------------- | ---------------- | ------------- | ----------- | ------------ | ------------------------------------- |
| All                             | 1812  | 923            | 830              | 59            | 118         | 368          | 81 / 791 / 51                         |
| Great power against great power | 844   | 784            | 17               | 43            | 143         | 368          | 51 / 682 / 51                         |
| With a minor                    | 968   | 139            | 813              | 16            | 74          | 294          | 30 / 109 / 0                          |

Great-power pairs at war for all 10 years: 0
Days from a peace to the same pair's next war: 657 returns, shortest 365, median 390
Most wars between one pair in one seed: 7

| Power    | Median days at peace | Fewest | Most |
| -------- | -------------------- | ------ | ---- |
| rome     | 594                  | 309    | 1263 |
| carthage | 573                  | 240    | 1068 |
| macedon  | 576                  | 195    | 1064 |
| egypt    | 696                  | 429    | 1189 |
| persia   | 1007                 | 508    | 1496 |

## Peace after

Seeds 1 to 20, 10 years, every faction under the AI.

| Wars                            | Begun | Ended in peace | Ended in a death | Still running | Median days | Longest days | Peace as things stand / gold / cities |
| ------------------------------- | ----- | -------------- | ---------------- | ------------- | ----------- | ------------ | ------------------------------------- |
| All                             | 1875  | 1004           | 823              | 48            | 119         | 332          | 94 / 854 / 56                         |
| Great power against great power | 884   | 826            | 20               | 38            | 143         | 332          | 54 / 716 / 56                         |
| With a minor                    | 991   | 178            | 803              | 10            | 76          | 234          | 40 / 138 / 0                          |

Great-power pairs at war for all 10 years: 0
Days from a peace to the same pair's next war: 697 returns, shortest 365, median 394
Most wars between one pair in one seed: 7

| Power    | Median days at peace | Fewest | Most |
| -------- | -------------------- | ------ | ---- |
| rome     | 570                  | 257    | 1436 |
| carthage | 486                  | 157    | 772  |
| macedon  | 389                  | 217    | 823  |
| egypt    | 536                  | 196    | 841  |
| persia   | 573                  | 393    | 1306 |

## Routes a player can keep and improve

Main `55e6293` against `feat/trade-routes-differ` on top of it. The world, AI and peace commands are the defaults: 20 seeds, ten years for the world and peace, five for each AI control.

The trade targets of `npm run sim -- trade` are identical row for row on both: trade 35.9–37.2 % at year 3, no capped days, suitable routes repay in 1.13–2.03 years, and a partner war cuts income by at least 14.8 %. The peaceful Rome of that harness opens routes in peace, so the handover rule never acts and it does not improve routes.

| `sim:world` target                                | main, seeds 1–20 | branch, seeds 1–20  | main, seeds 21–40  | branch, seeds 21–40 |
| ------------------------------------------------- | ---------------- | ------------------- | ------------------ | ------------------- |
| The largest power holds at most half the cities   | 20/20            | 20/20               | 20/20              | 20/20               |
| At least three powers alive                       | 20/20            | 20/20               | 20/20              | 20/20               |
| No power the largest in more than 8 seeds         | met: Persia 7    | NOT met: Carthage 9 | NOT met: Persia 12 | NOT met: Persia 11  |
| Armies idle beside an enemy for more than 30 days | 0                | 0                   | 2                  | 2                   |
| Armies idle overseas for more than 30 days        | 0                | 0                   | 0                  | 0                   |

The leader count is the one target the branch misses that main meets on seeds 1–20. Main misses it on seeds 21–40, the other half the design checks, by more. Each world parts from the other at the first decision that differs, so one route of Rome's that survives in the branch reshapes every later war; the leader changes in most seeds between the two runs. Across the 40 seeds the most any power leads is 19 on main and 17 on the branch.

A first version of the rule kept every route through a change of owner. It broke the `sim:ai` target that a power at peace with every stronger power grows that year: 112 of 129 power-years, under the 90 % needed, because a conqueror inherited its victim's trade. The rule now keeps only the routes whose other end is the player's, and every `sim:ai` target is met on both:

| `sim:ai` target, every faction under the AI               | main             | branch           |
| --------------------------------------------------------- | ---------------- | ---------------- |
| Half the 60 minor cities independent at the end of year 2 | 20/20, median 42 | 20/20, median 43 |
| A fifth independent at the end of year 5                  | 19/20, median 22 | 20/20, median 22 |
| A power at peace with every stronger power grows          | 106 of 112       | 96 of 102        |
| Powers take cities from each other or fight from year 2   | 20/20            | 20/20            |
| A power wiped out before year 3                           | 0/20             | 0/20             |

The passive-Rome control is identical on both, since a Rome that gives no orders holds no routes.

`sim:world` and `sim:ai` start every game with Rome as `state.player` while every faction, Rome included, is played by the AI. So in their tables on the branch, Rome's routes take the player's exception and survive a partner's change of owner; they are not a control with no exception.

| `sim:peace` target, seeds 1–20 over ten years | main       | branch     |
| --------------------------------------------- | ---------- | ---------- |
| Wars between great powers that end in peace   | 622 of 655 | 599 of 633 |
| Great-power pairs at war for all ten years    | 0          | 0          |
| Shortest return to war after a peace          | 365 days   | 365 days   |
| Longest war between great powers              | 376 days   | 582 days   |

Both meet every peace target. The longest war between great powers is longer on the branch, 582 days against 376, and far from the ten years the target rules out.

## The cautious Rome over ten years

`node scripts/sim/trade-judge.ts` plays seeds 1–20 for ten years, or until Rome is defeated. Every faction plays the AI, Rome included, except Rome's trade: monthly, before any other spending and keeping 600 gold, Rome opens its best route by return per gold. `--heed` makes Rome heed what #67 tells it: it skips a partner at war or a besieged end, and declares no war on a partner whose routes have not repaid. `--improve` makes Rome, with no route to open, buy the improvement that repays soonest, if within three years. Lost gold is what Rome paid to open or improve routes that closed or left its hands before their receipts repaid it, less those receipts. `scripts/sim/trade-ledger.ts` settles each day: an opening counts from its `tradeOpened` event at the price it was quoted, so a route the same day closes still enters. On the branch's saves receipts are the route's own tally of the gold Rome kept, after its treasury's limit. On main, which keeps no tally, they are an estimate: each arrival's pay, but no more than the treasury's gain that day, so an arrival into a full treasury repays nothing. The same files run on both.

| Cautious Rome, seeds 1–20, ten years | routes opened | closed before repaying | gold lost | trade decisions | longest stretch without one, median / most | day-1 paybacks min / median / max |
| ------------------------------------ | ------------: | ---------------------: | --------: | --------------: | ------------------------------------------ | --------------------------------- |
| main, blind (the tester's case)      |         1,082 |                    698 |   744,473 |           1,177 | 330 / 1,410 days                           | 1.13 / 1.13 / 2.03 years          |
| main, heeding #67                    |           922 |                    472 |   452,131 |           1,078 | 330 / 750 days                             | 1.13 / 1.13 / 2.03 years          |
| branch, heeding                      |           788 |                    322 |   308,513 |             911 | 510 / 811 days                             | 1.13 / 1.13 / 2.03 years          |
| branch, heeding and improving        |           552 |                    319 |   405,771 |           1,400 | 390 / 907 days                             | 1.13 / 1.13 / 2.03 years          |

| Gold lost, by what closed the route     | main, blind | main, heeding | branch, heeding | branch, improving |
| --------------------------------------- | ----------: | ------------: | --------------: | ----------------: |
| A city changed owner                    |     413,150 |       307,825 |         160,820 |           217,929 |
| The partner declared war on Rome        |     197,873 |       144,307 |         132,832 |           167,647 |
| Rome declared war on the partner        |     133,450 |             0 |               0 |                 0 |
| A partner city fell to an enemy of Rome |           0 |             0 |          14,860 |            20,194 |

Telling the risk and heeding it cuts the gold lost from 744,473 to 452,131. Keeping the player's routes through a partner's peaceful change of owner cuts it to 308,513, 59 % below the tester's case; the losses that remain to a change of owner are Rome's own cities falling. The improving Rome loses more because it invests more in routes that later close: its lost gold includes improvements.

Improvements shorten the quiet stretch but do not end it. The median gap between decisions is 30 days in every run, the harness's monthly turn, and on main many of those decisions buy back a route that died. Once routes stop dying, the longest stretch without a decision grows from a median of 330 days on main to 510; improvements bring it back to 390, since each route takes only two and then nothing new comes up. The spread of paybacks on day 1 is unchanged, since prices are as on main.
