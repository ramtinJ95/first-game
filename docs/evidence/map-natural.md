# Natural shores and regional close-up audit

Second part of map round four (brief items 2–4); atlas ownership/startup are separate in PR #49. The pinned visual baseline is `bfb5617`; the branch is rebased onto `a98a2de`. No rule, province outline, city coordinate, dependency, font, or external art changes. A deep comparison of every non-lake map record against baseline is identical.

## Lakes

The shared terrain simplifier used a **2 km** tolerance on Natural Earth 10m lakes. Tatta (called Lake Tuz in the data) lost most of its source bays. The build now preserves lakes at **0.1 km**, then clips/rounds as before. That restores three source lakes previously simplified below the area floor: Jezioro Dąbie, Schweriner See and Upper Lough Erne. There are **29 lake records**, some with multiple polygons.

Every outer and island shore uses the same seeded, bounded detailed outline for its fill, stencil mask, ink and water lines. All geographic control points remain exactly in place; detailing stays **within 0.6 km** of the source shore. The lake is never translated. Narrow inlets constrain the detail by a quarter of the clearance over each entire chord, including nearby island shores; distant-edge culling keeps construction cheap. The drawing deliberately caps sample displacement rather than inventing unchecked bays. Urmia’s islands now cut the fill/mask as well as receiving shore ink.

Regression bounds: no contiguous shore stays within **20 m of one straight chord for over 3 km**. This checks actual straight runs, not merely short collinear segments. Every detailed ring is checked for proper intersections, and holes for containment. Narrow-inlet and 300 m island-clearance fixtures are included.

| Lake                  | Source points before → after | Longest straight run before → drawn after (km) |
| --------------------- | ---------------------------- | ---------------------------------------------- |
| (unnamed)             | 76 → 431                     | 29.96 → 2.57                                   |
| Beyşehir              | 11 → 37                      | 25.44 → 1.74                                   |
| Bodensee              | 13 → 57                      | 14.85 → 2.10                                   |
| Dead Sea              | 17 → 61                      | 21.73 → 2.14                                   |
| Eğirdir               | 10 → 36                      | 17.36 → 2.03                                   |
| Great Bitter Lake     | 9 → 53                       | 16.20 → 1.89                                   |
| Jezioro Dąbie         | restored → 30                | absent → 1.98                                  |
| Kaliningradskiy Zaliv | 11 → 39                      | 26.31 → 1.76                                   |
| Lago di Bracciano     | 5 → 16                       | 10.73 → 1.46                                   |
| Lago di Como          | 13 → 62                      | 14.09 → 2.02                                   |
| Lago di Garda         | 12 → 56                      | 30.12 → 2.21                                   |
| Lake Balaton          | 14 → 61                      | 34.01 → 2.58                                   |
| Lake Geneva           | 10 → 36                      | 31.26 → 2.03                                   |
| Lake Hammar           | 40 → 179                     | 19.97 → 2.62                                   |
| Lake Razazah          | 23 → 112                     | 28.38 → 2.81                                   |
| Lake Sevan            | 19 → 80                      | 29.78 → 2.54                                   |
| Lake Skadar           | 13 → 49                      | 16.37 → 2.09                                   |
| Lake Tuz              | 15 → 72                      | 44.78 → 2.81                                   |
| Lake Urmia            | 46 → 235                     | 34.33 → 2.26                                   |
| Lake Van              | 46 → 223                     | 25.88 → 2.90                                   |
| Lough Derg            | 10 → 50                      | 12.00 → 1.79                                   |
| Lough Neagh           | 12 → 62                      | 15.85 → 1.99                                   |
| Lough Ree             | 9 → 56                       | 12.38 → 2.42                                   |
| Müritz                | 6 → 41                       | 10.92 → 1.42                                   |
| Sarygamysh Köli       | 22 → 101                     | 34.82 → 2.53                                   |
| Schweriner See        | restored → 36                | absent → 1.70                                  |
| Sea of Galilee        | 5 → 22                       | 15.59 → 2.53                                   |
| Upper Lough Erne      | restored → 30                | absent → 1.39                                  |
| Zalew Wislany         | 9 → 46                       | 29.65 → 2.02                                   |

Map bytes: 1,043,745 → 1,073,209 raw; 349,012 → 358,297 with Node gzip defaults (**+9,285 gzip bytes**). That is a deliberate, small download increase for real source detail; no pre-rendered art is shipped.

## Relief and the other repeated symbols

The conspicuous Persian “hills” include the dry-range folds. Folds now have broader seeded size, aspect, inclination and spacing variation around their geographic strike; hills gain independent height/width/skew and inclination variation. A real hill-depth field (36 km reach, sampled on a 12 km lattice) supplies the hill strike. Pictorial caps project that axial heading into a readable inclination and cannot turn upside down; top-down folds retain the full range heading. Existing chunk overhangs remain valid and have expanded coverage tests.

The fixed Anatolia sample contains 152 hills with **56.6°** seeded inclination spread. The plateau sample contains 230 folds with **71.0°** variation around the range strike and **3.19×** length range. Tests require at least 45° angular spread and over 2× fold-size/nearest-spacing range. Synthetic horizontal/vertical relief proves that the heading actually responds to terrain rather than only to the seed.

Other symbols audited in all seven views: trees already have seeded crown/species/size variation and irregular wood clumps; keeping their trunks upright is intentional. Dunes already follow a coherent wind field with seeded length/angle/spacing variation. Farm rings already have a grain per settlement, but delta fields shared a near-fixed fallback angle: they now vary coherently by local tract and river direction. No marsh symbol existed; the new pools/reeds/palms vary shape, angle, size and count from their position seed.

## The seven regions, at 4 px/km

Gaul is the best ecological mosaic; Italy is the strongest inhabited/relief view. The two worst were **the Nile delta and the steppe**, not simply the places with the fewest trees. Their appropriate detail is water agriculture and open pastoral country, not imported forests.

| Region           | What it lacked beside the best views                                                                                   | Decision/change                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Gaul             | Rich woods, streams and named places already; clearings have less farm-edge structure than the most inhabited views.   | Keep its ecological mosaic; no gratuitous density increase.                                                                               |
| Italy            | Strong cities, army, coast and relief; open spaces have less of Gaul’s vegetation mosaic.                              | Keep it as the inhabited reference; hills gain readable seeded variation.                                                                 |
| Nile delta       | A near-uniform carpet of similarly angled crop tiles, with little visible wet ground or irrigation.                    | Fill: river-connected irrigation branches, irregular reed pools, small palms, and varied farm-tract grain.                                |
| Anatolia         | Good hamlets, tracks and woods, but repeated hill caps made the plain mechanically patterned.                          | Terrain-aligned hill inclination/shape/size variation; retain its existing settlement network.                                            |
| Persian plateau  | Folds were near-identical diagonal ovals at nearly constant spacing; hamlets and qanats already supplied human detail. | Broader, terrain-led fold angle/size/aspect/spacing variation. Do not turn arid land into forest.                                         |
| Black Sea steppe | Mostly tiny ground dots and occasional streams; little visible grazing or human use away from named places.            | Fill: seeded meadow ribbons, small pastoral camps, pens and flocks on watered open dry plains.                                            |
| Iberia           | Many hamlets and tracks, but little woodland mosaic and repeated hill caps.                                            | New hill variety and eligible meadow detail improve its dry plains; not one of the two sparsest views, so no invented broad forest layer. |

The fixed delta sample has **14 river-attached channels and 19 marsh/palm pools**, besides its existing fields and orchards. The steppe sample has **89 meadow ribbons and six pastoral camps**. These are code-drawn atlas ornaments, not game settlements, resources, units, or new navigable water. They fade with the existing close fields tier. Deterministic placement reads the existing land/river/cover data, not geographic rectangles. Marshes stay in cultivated coastal fans; camps keep off woods, mountains, hills, cities and farm rings.

## Verification and review

- After the `a98a2de` rebase and `npm ci`, `npm run check`, **836 unit tests**, production build, and all 20 full-drawing capture views passed locally. All normal limits/retries remain unchanged.
- Unit checks cover source-detail retention, maximum straight shore run, anchor/deviation bounds, whole-map topology/holes, actual relief response, angle/size/spacing spread, rural density, river attachment, land placement, chunk overhang and no-seam repeatability.
- `map-natural` captures the seven regions and Tatta/Urmia/Garda, before/after, from the identical day-1 views at closest zoom. Before is built from the pinned main archive, not a simulated “old style”.
- Its capture scheduling weight starts at an explicit 240 s estimate (123.4 s locally for both builds and all 20 views); no timeout or retry changes.
- Reviewer found two P2 defects: the initially zero-reach hill index produced constant headings; unconstrained ripples crossed Geneva/Van shores. Both were fixed, with independent zero-crossing verification across all 29 lakes and the new orientation/topology regressions. Final review approved.
- During concurrent reviewer/local unit work, the existing terrain-layer test hit its normal 5 s limit. No limit was raised; distant-edge clearance culling reduced construction work, and the complete default-worker suite then passed.
- Published images, exact head CI results, and CI frame comparison are recorded in the PR. Physical-GPU/deployed behaviour is not claimed.
