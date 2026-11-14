# Real atlas coasts over an unchanged rules world

Baseline: `c02aec7ebaa68132f9add8652b977ce2b57bb028` (trade rules merged). The aim is a living, recognisable old atlas at middle and closest zoom, not a different navigation map. No dependency, save-format change, outside art, or simulation change is introduced.

## Source and drawing

The drawing uses **Natural Earth 1:10m land**, public domain, at the same pinned revision as the existing map sources: `ca96624a56bd078437bca8184e78163e5039ad19`. The downloaded GeoJSON's SHA-256 is `1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416`.

`node scripts/map/build-coast.ts` projects and clips that source, simplifies it to **0.1 km**, packs coordinates in **25 m units**, and normalises topology after packing. The last step matters: the first packed trial inverted thin inlets, which the new crossing test caught. The final asset contains **501 land pieces, 358 scenery islands and 39,510 coast points**. Runtime unpacks it lazily at **0.6 px/km**. Crossing that threshold forces a restroke even inside the ordinary 25% stroke-zoom tolerance.

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
| Rhodos island settlement |  2,267 |    42 |
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
- Decorative town/village ornaments and ambient boats with no safe contact are not shown. They have no rules entities; their underlying map coordinates do not move. All 80 rules-city centres remain on drawn land. Rhodos is a named island settlement in this map, not an additional rules-city province.

### Offshore scenery

Decision: include missing real offshore islands of **0.5–100 km²** as plain, uninhabited atlas scenery, to restore the archipelagos without inventing provinces. They are disjoint from physical land and have no province or land-order target. The browser regression paints Lampedusa as land, clicks it, and checks that a selected army's land order is refused as sea.

Scenery is explicitly outside the shared-shore bound: Lampedusa's outline can lie **137.78 km from the old physical coast**. That is new, inaccessible scenery, not land an army can reach. Specks below 0.5 km² are omitted; consequently the all-source maximum still includes the omitted Alboran speck, about **56.68 km** from any drawn shore. Larger missing land requires a separate physical-map decision.

## Invariance and review

`data/map/map.json` is byte-identical to the baseline (`git diff c02aec7 -- data/map/map.json` is empty). New tests serialize the whole map and outlines before/after drawing, rebuild and deep-compare navigation meshes and harbours, and compare coastal province hits at anchors and offsets on both sides. No save record or schema changes.

The independent read-only reviewer found three reachable issues, all corrected:

1. The new terrain mask was a sibling of the camera-transformed art. It is now a child and shares its transform; the reviewer independently checked the transform. Browser pixels remain part of final verification.
2. Refugee markers below figure zoom were not fitted. Their full cart contact and scaling now use the same shoreline guard, with a real evacuation-path regression.
3. Point sampling missed a 0.46 px inlet at 0.89 zoom. Production fitting now checks continuous spans; the regression independently samples every 0.02 px. The reviewer closed this finding after inspection and the reported focused test pass.

No confirmed review finding remains. Browser pixels, published media and performance are separate verification gates, not attributed to the read-only reviewer.

## Verification and captures

- `npm run check`: passed, no Svelte/type/lint/format errors.
- `npm test -- --maxWorkers=1`: **1,134 tests in 106 files passed** (82.77 s).
- Focused post-review geometry, surface, invariance and source-rebuild tests passed; after the one-pass selection-box optimisation, all 17 coastal-ground tests passed again.
- `npm run build`: passed; the pre-existing large-chunk warning remains.
- Final browser/performance measurements and CI publication are pending the coordinated single-browser slot; this document will be completed with their actual outcomes before the pull request is marked ready.

`npm run capture -- coast-shapes` records the eleven requested geographic views plus Rhodos, Gades and both measured worst places, and matched Carthage siege, convoy and refugee ground fixtures. Before is pinned to `c02aec7`; after is captured first so the clip shows the new art. Screenshots are published by CI, never committed as repository media.
