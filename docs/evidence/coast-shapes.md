# Real atlas coasts over an unchanged rules world

**Final head: within the frame and start budgets.** The final-head measurements and fixes are in [the final-head section](#final-head-measurements-and-fixes); the sections it supersedes are marked historical. The aim is a living, recognisable old atlas at middle and closest zoom, not a different navigation map. No dependency, save-format change, outside art, or simulation change is introduced.

Visual baseline: `c02aec7ebaa68132f9add8652b977ce2b57bb028` (trade rules merged). The branch is rebased onto main `c40d8c7d918447d9eea6f83c905cfd78dc85a591` (completed-frame picking); performance uses that current main, not the older visual baseline.

## Source and drawing

The drawing uses **Natural Earth 1:10m land**, public domain, at the same pinned revision as the existing map sources: `ca96624a56bd078437bca8184e78163e5039ad19`. The downloaded GeoJSON's SHA-256 is `1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416`.

`node scripts/map/build-coast.ts` projects and clips that source, simplifies it to **0.1 km**, packs coordinates in **25 m units**, normalises topology after packing, and stores each ring as one flat list of every point's step from the one before. The last step matters: the first packed trial inverted thin inlets, which the new crossing test caught. The final asset contains **501 land pieces, 358 scenery islands and 39,371 outline points**. Runtime unpacks it lazily at **0.6 px/km**. Crossing that threshold forces a restroke even inside the ordinary 25% stroke-zoom tolerance.

Paper, terrain, wash masks, sea lines and coast ink use this one art outline. The entire cached terrain is clipped, not just its tint, so old relief and fields cannot leak into a newly recovered bay. Its mask inherits the cached art's camera transform. No lake source, outline or shore function changes.

Modern Natural Earth coasts are accepted by the design; this is not a claim to reconstruct classical deltas or ancient relative sea levels.

## Measured geographic accuracy

Regenerate [the complete report](coast-shapes-metrics.json) with:

```sh
node scripts/coast-shapes-metrics.ts
npx prettier --write docs/evidence/coast-shapes-metrics.json
```

Distances use nearest **segments**, not vertices. Samples are evenly spaced by 0.25 km of arc length, rather than disproportionately weighting dense vertices. The continuous maximum has a conservative extra 0.125 km: distance to a fixed set is 1-Lipschitz, and every point is at most half a sample interval from a sample. Frame edges are excluded.

| Distance to the unsimplified 1:10m source       |   Before |    After |
| ----------------------------------------------- | -------: | -------: |
| Drawn shoreline median                          | 0.688 km | 0.005 km |
| Drawn shoreline p95                             | 2.611 km | 0.048 km |
| Drawn shoreline sampled maximum                 | 7.357 km | 7.927 km |
| Source → drawing p95, including omitted islands | 8.503 km | 0.057 km |

The **maximum does not improve everywhere**. The physical-world bound wins where the source requires a deeper bay: the after maximum is near **34.841°E, 36.866°N in Cilicia**, shown in the extra capture. It is not hidden inside an average.

Requested views, p95 distance in metres (before is the actual coarse outline at middle zoom and the inherited ripple outline at closest zoom):

| View                     | Before | After |
| ------------------------ | -----: | ----: |
| Cyclades                 |  1,522 |    38 |
| Nile delta               |  2,814 |    66 |
| Peloponnese              |  2,170 |    34 |
| Bosporus                 |  2,774 | 1,182 |
| Hellespont               |  2,165 |   941 |
| Messina                  |  2,137 |   741 |
| Gulf of Tunis / Carthage |  2,653 |   361 |
| Dalmatia                 |  1,411 |    38 |
| Brittany                 |  2,831 |    55 |
| Whole Aegean, 1 px/km    |  2,259 |    63 |
| Whole Italy, 0.66 px/km  |  2,454 |    47 |
| Rhodos island            |  2,267 |    42 |
| Gades                    |  2,440 | 1,538 |

These are fill-boundary measurements. The report separately measures actual coast-ink simplification at 4, 1 and 0.66 px/km; ink p95 at the whole-Italy zoom is about 0.28 km, not the raw outline's 0.048 km.

## Drawn versus walked

The chosen continuous **filled-shore bound is 8.15 km**, in both directions, for coast shared with the physical world. Measured upper bounds are **8.137 km drawn → physical**, and **7.418 km physical → drawn**. The largest drawn-side displacement lies near **20.837°E, 39.093°N on the Ionian/Ambracian coast**, also captured.

Actual simplified ink-centre bounds are **8.150 / 8.301 / 8.793 km** at **4 / 1 / 0.66 px/km**. Across every active atlas zoom, the 0.75 px ink simplification adds at most `0.75 / 0.6 = 1.25 km`, giving a conservative **9.4 km ink-centre bound**. Stroke width is not a change to the filled land surface.

Decisions taken for safety:

- Keep the inherited physical-coast art within **6 km of every rules city** and **8 km of each harbour**; retain the existing bounded natural ripples rather than returning to ruler-straight coast. A city which that inherited art would submerge gets its original physical land within 1 km.
- Keep it within **26 km at the Bosporus**, **40 km at the Hellespont**, **20 km at Messina**, and **24 km at the Gibraltar crossing**. Frame joins retain an 8 km band. These places deliberately do **not** claim full 1:10m fidelity. Their before/after pairs show the compromise.
- Elsewhere, allow real detail only inside an 8 km band of the physical sea coast. Cilicia illustrates where that cap prevents a fully accurate source bay.
- Never change an army, convoy, column or city's stored position. The renderer fits a figure's complete ground contact to the displayed surface; land figures must also stay on physical land. Exact horizontal-edge queries reject subpixel water cuts and cancel internal province seams. Sprite count is retained, hits move with figures, and affected army selection boxes are rebuilt in one pass.
- Prefer full-sized symbols within 12 km of their original contact. An over-wide symbol can shrink if no full-sized contact fits. Convoy followers which the original formation extrapolated inland can regroup around their interpolated army anchor. Impossible placement throws explicitly, rather than silently dropping a unit. Siege works and wakes stop at the appropriate surface.
- Apply the same rule to refugee cart markers between 0.6 and 0.9 px/km, not just to figures. A real Alexandria → Pelusium evacuation reproduced an unfitted cart on drawn water; its dense, independent contact regression covers 0.61, 0.75 and 0.89 px/km.
- Decorative town/village ornaments and ambient boats with no safe contact are not shown. They have no rules entities; their underlying map coordinates do not move. All 80 rules-city centres remain on drawn land. Rhodos has no city or named-settlement record in this map; the separate actual island-city capture is **Knosos on Crete**, rather than inventing a new city on a tiny isle.

### City symbols and their attachments

Full-size inspection caught a pre-existing defect: Carthago's castle base crossed water in **both** the before and after image. Keeping its centre on land was insufficient. City symbols now fit the complete ground stroke, including its 0.6 px round caps and vertical half-thickness. An exact rectangle query checks every critical polygon row, including horizontal shores, internal seams and holes between the strip's two edges. Towers remain elevated artwork, not ground contacts.

Cities stay full-size. Their cartographic search radius is `12 km + half-symbol-width / zoom`; the conservative maximum over active zooms is **39.67 km**, not a change to any city coordinate. Measured real-rank insets in the four sampled views are:

| Zoom, px/km | Moved glyphs |         Largest inset | Place     |
| ----------- | -----------: | --------------------: | --------- |
| 0.6         |           27 |  15.889 km / 9.533 px | Byzantion |
| 0.66        |           27 | 15.714 km / 10.371 px | Byzantion |
| 1           |           26 | 13.736 km / 13.736 px | Caralis   |
| 4           |           20 | 11.188 km / 44.750 px | Carthago  |

These are symbol insets, **not shoreline displacement**. They correct a glyph whose screen-sized base already overhung the physical coast. Labels and visible-glyph hit regions follow the symbol. The original physical-city command target remains a lower-priority fallback, behind visible cities, armies and battles; province picking and order coordinates remain unchanged. Therefore this PR does not claim that every UI hit box is identical.

Scene construction receives temporary city-position views so wall breaches, captured-city flags, sack flames and storm origins follow the same displayed city. Original state identities remain in pacing/caches, and the temporary views never reach simulation, saves or targeting. Visibility is evaluated at each city's **original** position, including both sides of a sight boundary. Ambient city smoke shares the displayed position.

The existing army scene distinguishes rooftop standards at 1.5 men's heights from battlefield-victory standards at 1.3. The coastal adapter preserves the former and still grounds the latter; this is a regression-covered compatibility rule, not newly added semantic metadata. `blaze` is elevated city-burning art; camp fires use the separate `fire` art. No army-scene file changes were needed. Tests check the completed postfit scene, not just the scene before surface fitting.

### Offshore scenery

Decision: include missing real offshore islands of **0.5–100 km²** as plain, uninhabited atlas scenery, to restore the archipelagos without inventing provinces. They are disjoint from physical land and have no province or land-order target. The browser regression paints Lampedusa as land, clicks it, and checks that a selected army's land order is refused as sea.

Scenery is explicitly outside the shared-shore bound: Lampedusa's outline can lie **137.78 km from the old physical coast**. That is new, inaccessible scenery, not land an army can reach. Specks below 0.5 km² are omitted; consequently the all-source maximum still includes the omitted Alboran speck, about **56.68 km** from any drawn shore. Larger missing land requires a separate physical-map decision.

## Invariance and review

`data/map/map.json` is byte-identical to the baseline (`git diff c02aec7 -- data/map/map.json` is empty). New tests serialize the whole map and outlines before/after drawing, rebuild and deep-compare navigation meshes and harbours, and compare coastal province hits at anchors and offsets on both sides. No save record or schema changes.

The independent read-only reviewer found these reachable issues, all corrected:

1. The new terrain mask was a sibling of the camera-transformed art. It is now a child and shares its transform; the reviewer independently checked the transform. Browser pixels remain part of final verification.
2. Refugee markers below figure zoom were not fitted. Their full cart contact and scaling now use the same shoreline guard, with a real evacuation-path regression.
3. Point sampling missed a 0.46 px inlet at 0.89 zoom. Production fitting now checks continuous spans; the regression independently samples every 0.02 px. The reviewer closed this finding after inspection and the reported focused test pass.
4. City-centre-only protection left the inherited castle-base defect. Full ground-stroke fitting now covers all 80 cities, every rank, and middle/closest zooms. Attached breaches/effects, original visibility and input immutability have explicit regressions.
5. An intermediate targeting implementation treated invisible city anchors like visible glyphs. Anchors are now separate, lower-priority fallbacks; tests cover the glyph, old anchor, another visible city, an army and a battle.
6. The first uniform-cell span optimisation could certify an internal province seam containing a narrow water cut. The certificate now rejects every seam cell as well as every nonuniform cell; both crossing directions have a default-seams regression, retaining the original no-seams assertions. The reviewer independently reproduced the defect and confirmed the fix.

The held-pacer transition regression exposed stale shoreline placement before main's completed-frame change; placement uses the current camera's surface, while held frames retain their completed picking snapshot. After the rebase, a cold-sheet banner could appear before the figure scene was ready without being fitted. All displayable banners are now fitted at atlas zooms; an actual painted-faction-pixel and click regression blocks first sheet decoding and checks that fallback.

No confirmed review finding remains. Browser pixels, published media and performance are separate verification gates, not attributed to the read-only reviewer.

## Historical: runtime and download at `201312e` on `c40d8c7` (superseded)

These measurements are of the head this pull request was taken over at. They failed the frame budget and are kept as a record only; the final head's are in the next section.

Matched production builds: baseline current main `c40d8c7`, final renderer source `2ce5fd7`. One local software-Chromium browser at a time; other builders explicitly held GPU/heavy CPU. These are local production-preview checks, not deployed measurements. Older-main, provisional and aborted readings are not substituted for this final-source comparison.

Ten fresh page contexts per build, `draw=full`, navigation to visible HUD, in milliseconds:

- Before: **2608.907, 1834.238, 1861.887, 1880.248, 1820.209, 1830.693, 1822.630, 1863.706, 1834.213, 1827.378**.
- After: **2663.017, 1900.085, 2016.082, 1954.525, 2105.610, 2013.992, 2003.700, 2013.416, 1960.214, 1919.833**.
- Means: **1918.411 → 2055.047 ms, +7.122%: passes the 10% startup budget**. First/cold starts are retained; no readings were dropped.

Commands: `node scripts/profile-startup.ts --base <production-preview> --draw full --rounds 10`, before then after. Resource URLs are recorded after the timed HUD boundary. Gzip is computed with Node's default `gzipSync` for each actually requested file, plus `index.html`, not for every emitted chunk and not from Vite's size-summary column. Both starts request the same fourteen unchanged files plus their respective entry JS, including the byte-identical physical map asset.

| Requested gzip bytes                         |      Before |       After |
| -------------------------------------------- | ----------: | ----------: |
| Entry JavaScript                             |     191,364 |     422,499 |
| Other fourteen files, including physical map |     499,140 |     499,139 |
| **Total**                                    | **690,504** | **921,638** |

The addition is **231,134 gzip bytes (+33.473%)**. This is a deliberate roughly 226 KiB tradeoff for 39,510 fine coast points, recovered bays and 358 missing islands, with source-distance p95 improving from 2.611 km to 0.048 km. The other-file difference is one gzip byte in generated HTML; the physical map is byte-identical. No dependency, font or outside art was added. These are reproducible gzip payload sizes, not HTTP-header bytes or a claim about deployed compression configuration.

Final three-round drawn-frame measurements at exact middle **1 px/km** and Aegean closest **4 px/km**, summarised as the median of each round's median/p95:

| View           | Before median / p95, ms | After median / p95, ms |              Change | Budget   |
| -------------- | ----------------------: | ---------------------: | ------------------: | -------- |
| Middle         |             23.9 / 25.8 |            26.5 / 29.2 | +10.879% / +13.178% | **FAIL** |
| Aegean closest |             19.8 / 22.3 |            21.8 / 25.4 | +10.101% / +13.901% | **FAIL** |

Every round is retained, in order (median / p95, ms):

- Middle before: **22.7 / 25.0; 26.2 / 30.6; 23.9 / 25.8**. After: **29.4 / 32.2; 26.5 / 29.2; 26.0 / 28.3**.
- Closest before: **19.8 / 21.9; 19.7 / 22.3; 22.4 / 24.9**. After: **23.2 / 25.4; 21.8 / 27.3; 21.7 / 24.2**.
- Frame-interval medians: middle **16.7 → 33.3 ms**, closest **16.7 → 16.7 ms**; interval p95 is **33.4 ms** throughout.

Command: `node e2e/frame-bench.ts --rounds 3 --days 0 --only full --zooms middle,aegean-closest` (add `--root /tmp/coast-main-c40` for the built baseline). Software flags: `--use-angle=swiftshader --enable-unsafe-swiftshader`, Chromium **158.0.8127.18**, 28 armies at day 1. The harness corrects the rounded wheel-notch remainder and rejects an incorrect actual zoom; previously labels of 1/4 could mean 0.9573/3.8821. Warmup (1.5 s), measurement window (5 s), software flags and controls are unchanged for both builds.

The preceding complete `aa43e81` run also failed (middle 26.3 / 30.7 ms, closest 21.7 / 23.9 ms). A bounded optimisation added a uniform-raster certificate to exact span checks; mixed, edge and seam cells still take the exact intersection path. The first trial missed seam cells, so its incomplete performance run was aborted and is **not acceptance evidence**. The corrected final run above still fails. No budget waiver, test weakening, retries or further local optimisation loop is claimed. Browsers and preview servers were stopped after that run; the PR remains draft for this blocker even if CI is green.

## Historical: verification and captures before the takeover (superseded)

- `npm run check`: passed, no Svelte/type/lint/format errors.
- `npm test -- --maxWorkers=1`: **1,141 tests in 106 files passed** (70.20 s) before the final rooftop-standard/fallback delta; that delta's complete CI unit run passed **1,143 / 106**.
- Focused city/surface, picking and continuous-strip checks: **43 passed**. The expanded 27-test ground file, including every 0.05 px/km intermediate zoom from 0.6 through 4, passed locally (1.90 s); pre-optimisation full CI passed **1,147 tests / 106 files**. Final `2ce5fd7` area-index and ground checks: **34 passed (2.02 s)**, followed by passing `npm run check` and `npm run build`. After main's rebase, CI is the full-suite check of record; no unrelated local heavy rerun is presented as proof.
- `npm run build`: passed; the pre-existing large-chunk warning remains.
- Local isolated final production-preview browser checks: **5 passed (22.7 s)**—forced held-pacer atlas/widest transitions in both directions, ordinary detail transitions, offshore land pixels/non-targetability/order refusal, context restoration and all four minor-city kinds. The held-pacer test fails against the frozen old `d7a8959` build with the exact CI error and passes against `0d85c53`; it verifies that no new coast or zoom is drawn before the fence is released.
- Pre-rebase CI `43646575871` passed verify/e2e/captures. Rebased `aa43e81` CI passed verify and all browser shards, including the cold-sheet coastal banner regression; its later media jobs were cancelled by the next source push. Final-head CI and exact published-media links are recorded on [PR #59](https://github.com/ramtinJ95/first-game/pull/59). Earlier inspected screenshots exposed the city-base defect and are not claimed as final-source proof. No Nexus preview is available in this local lane.

`npm run capture -- coast-shapes` records the eleven requested geographic views plus Rhodos, the existing island city Knosos, Gades and both measured worst places, and matched Carthage siege, convoy and refugee ground fixtures: **38 screenshots and a clip**. Before is pinned to `c02aec7`; after is captured first so the clip shows the new art. Screenshots are published by CI, never committed as repository media.

## Final-head measurements and fixes

Taken over at `201312e`. Frames were measured with main at `ab61f1f` and the branch at `b55981e`; starts with main at `55e6293` and the branch rebased on it. Nothing under `src/render` changed on main between `ab61f1f` and the final base `a160d41` except two tests, and the branch's commits after `b55981e` are rebases and documentation. Raw readings: [coast-shapes-final.json](coast-shapes-final.json).

### Method, and why not the five-second meter

The pylon has two cores and draws in SwiftShader at 2 to 3 frames a second. The `?frames` meter's 5 s window then holds 2 to 15 frames, so its p95 is the slowest frame, and main measured against itself moved 50 to 88 % in p95. Building the terrain at the middle zoom also takes about three minutes here, while `e2e/frame-bench.ts` waits 120 s and swallows its own timeout, so a reading there can measure terrain still being built.

Each reading here opens the built page with `?frames&draw=full`, zooms as `frame-bench.ts` does (`middle`, 1 px/km; `aegean-closest`, 4 px/km), waits for the terrain to report ready, waits 1.5 s, and then records every animation frame for 120 s (200 to 330 frames). The interval is the time between frames. A drawn frame's time is the length of its animation callback on frames that issued draw calls, the span `main.ts` reports to the meter. Median and p95 are by nearest rank, as the meter computes them. The meter's own last 5 s were recorded beside each reading and agree on the median. Main was built twice (A and B) to measure the baseline's steadiness, and each round rotates the order of the three builds. Every reading had its terrain ready and no page error.

| View, rounds | Metric, ms      | Main A | Main B | Main A to B | Branch | Branch to mean of main |
| ------------ | --------------- | -----: | -----: | ----------: | -----: | ---------------------: |
| Middle, 6    | interval median |  400.0 |  400.0 |       0.0 % |  400.0 |                  0.0 % |
| Middle, 6    | interval p95    |  641.6 |  558.3 |     −13.0 % |  541.7 |                 −9.7 % |
| Middle, 6    | drawn median    |  390.5 |  392.4 |      +0.5 % |  390.9 |                 −0.1 % |
| Middle, 6    | drawn p95       |  538.5 |  549.7 |      +2.1 % |  540.8 |                 −0.6 % |
| Closest, 3   | interval median |  349.9 |  333.4 |      −4.7 % |  333.4 |                 −2.4 % |
| Closest, 3   | interval p95    |  883.3 |  733.3 |     −17.0 % |  416.6 |                −48.5 % |
| Closest, 3   | drawn median    |  340.7 |  333.5 |      −2.1 % |  332.1 |                 −1.5 % |
| Closest, 3   | drawn p95       |  891.9 |  738.8 |     −17.2 % |  418.3 |                −48.7 % |

Each cell is the median over its rounds. The first three middle rounds alone put the branch's drawn p95 at +32.9 %, with single rounds of main ranging from 517 to 1,461 ms. Three more rounds of the same builds were run rather than the earlier set reported, and all six are in the table and the raw file. An earlier matched set at main `0b22fa4` (five middle rounds, two closest) agreed: medians within 1.6 %, closest p95 below main. Every long gap between frames in either build is a drawn frame of the same length, not an idle main thread.

**Starts.** Ten fresh pages per build, navigation to the visible top bar, `node scripts/profile-startup.ts --draw full`, in blocks of five as main, branch, branch, main. Each block checked that the server returned its own build's entry script. The first attempt did not: a preview server left running served main to both sides. Main averaged **8,195.0 ms**, the branch **8,199.8 ms** (+0.06 %).

**Download.** Gzip of each file the first start requested, plus `index.html`: **692,111 B on main, 811,532 B on the branch, +119,421 B (+17.3 %)**. At `201312e` the addition was 231,134 B. The coast asset itself went from 225,598 to 114,618 gzip bytes by storing steps between points instead of absolute coordinates, with the same 39,371 points.

### The simplification

| Source tolerance | Pieces | Outline points | Asset gzip, absolute | With steps |
| ---------------- | -----: | -------------: | -------------------: | ---------: |
| 0.1 km (kept)    |    501 |         39,371 |              225,598 |    114,618 |
| 0.2 km           |    465 |         32,536 |              190,061 |            |
| 0.25 km          |    465 |         30,071 |              177,096 |     93,947 |
| 0.35 km          |    460 |         26,266 |              156,669 |            |

Most points come from the inherited and protected coast, so a coarser 1:10m tolerance removes only part of them: 0.25 km keeps 76 % of the points and loses 36 pieces. With steps, it saves another 20,671 gzip bytes. The frame cost did not depend on the outline's density once the strokes were culled (below), so 0.1 km was kept and nothing visible was given up.

### Where the frame time went, and the fix

Every restroke traced the whole world's 1:10m coast: six water lines of two wide strokes each, the coast ink, and the land fills. At 1 px/km that is 204,492 water-line points against main's 60,236, and 35,205 ink points against 5,624. On a software rasteriser the cost per zoom step was 2.3 to 3.5 million more vertices than main from 0.6 px/km on. Only the sea and ink textures show those strokes, and each covers the view and one `SEA_MARGIN`. They are now stroked for the view and two margins, and stroked again once the view leaves that (`strokeCoast` in `renderer.ts`). That leaves about 73k water-line segments at the middle zoom, against the 60k main strokes for the whole world, and about 43k at the closest, against main's 67k. A browser test pans three views' width at the closest zoom and compares 32 px blocks with the same view restroked; with the restroke on pan removed, the worst block differs by 23 to 32 levels against a limit of 6, and with it by 0.3.

The terrain's cached art had a mask of the atlas land over its whole art, inside which the ground was clipped again by a mask of the same shape. One mask now clips the whole art at atlas zooms. Below 0.6 px/km the ground alone is clipped, as on main. Dropping the second mask saved 2 to 4 s over wheel notches 7 to 13 on this pylon.

Over the fourteen wheel notches of `e2e/wheel.spec.ts` the branch now takes 45 to 46 s on this pylon against main's 52 to 53 s. Main pays about 13 s at the fourteenth notch, deriving and triangulating its inherited natural coast, which the branch replaces with the prebuilt outline.

### The three failures at `201312e`

1. **Frame budget.** As above. The coast strokes were whole-world on every restroke, and the terrain was masked twice.
2. **Wheel timeout.** Not a hang caused by the coast. On this pylon main's own wheel test timed out on every run before pull request 68, and CI's annotations show the same timeout in seven runs of other branches since pull request 58. The branch's extra cost per zoom step was real, though: the whole-world strokes. After the fix, the branch completes the fourteen notches faster than main. Since pull request 68 the test passed on the branch three runs out of three, 23.0 to 23.9 s. One run straight after a build timed out, and main did the same twice on this pylon.
3. **`No safe drawing surface for standard.0`.** A banner chose its surface from today's activity alone, while it is drawn between yesterday's place and today's. On the day an army lands, its banner crosses the sea from the convoy to the shore, so it was fitted to land up to 18 km away, past the 12 km search. Rome's own crossing to Carthago lands 14 km from usable land. The hundred-army fixture also stood 58 idle armies in the open sea, which the rules never do; in two years of AI play no idle army stood at sea. The fix is `fitBanner`: an army that is or was embarked today is afloat exactly where its point is off the physical land, so the banner rides the water to the shore. The fixture now stands its armies on the land nearest Roma. The read-only reviewer then found three more crashes of the same kind, all reachable in play and all fixed. An embarking army's ships had only its inland banner to regroup by, so ships now regroup at their convoy. The rules march armies over lakes, so a lake counts as land for fitting. Refugees trailing back across the sea had nothing to regroup by, so they regroup at their column. Each has a unit test built from a real order through `tick` that throws on the old code. The reviewer's last bounded sweep found none further: 747 evacuation checks, 234 coastal and island siege checks, 288 battle, retreat and map-edge checks, 4,366 banner positions.

The scenery test asked `provinceAt` about 4,631 island points and ran past its 5 s limit on the check machine. `provinceAt` now skips rings whose bounding box misses the point. Its answers are identical on 20,080 points, and the test takes 0.57 s.

### Final-head verification and captures

- `npm run check`: no errors. Unit tests under `src/render`, with `scripts/map/build-coast.test.ts`: 218 passed. `scripts/map/build-coast.test.ts` rebuilds the asset identically; this pylon needs about 100 s for that against the hook's 60 s, so it was confirmed with a local copy given a longer hook and passes in CI.
- CI at `b55981e`, run 43682314420: verify, all eight browser shards, e2e, frame benches, memory, all six capture shards, capture and publish-media passed.
- The published folder's `README.md` names the head its images show. The views the owner asked for were each opened at full size: the Cyclades, the Nile delta, the Peloponnese, the Bosporus, the Hellespont, the Strait of Messina, the Gulf of Tunis at Carthago, the Dalmatian coast, Brittany, the whole Aegean, the whole of Italy, and the hundred-army fixture, whose armies all stand on land.
