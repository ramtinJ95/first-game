# Village-name contrast

WCAG sRGB relative-luminance ratios, solid glyph cores, fully faded in at closest zoom. Floor **7:1 against the immediate opaque halo** on every ground. It is not a claim that dark ink alone contrasts with dark tree/relief ink; those rows explicitly show why the backing is required. Anti-aliased glyph edges and the 220 ms entrance fade are not solid cores.

Village ink changes from #675640 to #3b2816. Towns already used that ink. Both small-settlement ranks now use weight 600 so their thin italic glyphs have solid cores, with the existing opaque #f4ead0, 3 px round halo retained. Villages remain 10 px italic, below 11 px towns, 12 px normal-weight italic city names and 14 px bold upright capitals. City styles, label priorities and fades are unchanged. A bolder glyph can change its measured width and hence which nearby label wins a place.

Ink/halo contrast: **5.88 → 11.68:1**. Regenerate with `node scripts/village-contrast.ts`.

| Ground/drawing colour | Bare ink/ground before → after | Lowest ink/ground over all close owner washes, after | Ink/halo, every ground |
| --------------------- | ------------------------------ | ---------------------------------------------------- | ---------------------- |
| paper                 | 5.32 → 10.58                   | 6.21                                                 | 11.68                  |
| sea                   | 4.05 → 8.05                    | 5.02                                                 | 11.68                  |
| reliefInk             | 1.76 → 1.13                    | 1.13                                                 | 11.68                  |
| reliefLight           | 5.89 → 11.71                   | 6.74                                                 | 11.68                  |
| reliefShade           | 2.64 → 5.25                    | 3.58                                                 | 11.68                  |
| reliefDeep            | 1.84 → 3.65                    | 2.76                                                 | 11.68                  |
| hillShade             | 3.89 → 7.74                    | 4.86                                                 | 11.68                  |
| desert                | 4.96 → 9.84                    | 5.32                                                 | 11.68                  |
| dune                  | 2.21 → 4.39                    | 3.11                                                 | 11.68                  |
| stipple               | 1.64 → 3.25                    | 2.51                                                 | 11.68                  |
| woodEdge              | 4.88 → 9.69                    | 5.75                                                 | 11.68                  |
| woodRim               | 4.55 → 9.03                    | 5.43                                                 | 11.68                  |
| wood                  | 4.30 → 8.54                    | 5.22                                                 | 11.68                  |
| cultivatedEdge        | 4.54 → 9.01                    | 5.42                                                 | 11.68                  |
| cultivated            | 3.72 → 7.39                    | 4.67                                                 | 11.68                  |
| crownLight            | 3.55 → 7.06                    | 4.49                                                 | 11.68                  |
| coniferLight          | 2.77 → 5.50                    | 3.75                                                 | 11.68                  |
| duneShade             | 2.56 → 5.09                    | 3.47                                                 | 11.68                  |
| crown                 | 2.53 → 5.02                    | 3.49                                                 | 11.68                  |
| conifer               | 1.80 → 3.57                    | 2.74                                                 | 11.68                  |
| cypress               | 1.43 → 2.83                    | 2.34                                                 | 11.68                  |
| crownShade            | 1.40 → 2.77                    | 2.29                                                 | 11.68                  |
| treeInk               | 1.89 → 1.05                    | 1.05                                                 | 11.68                  |
| furrow                | 2.64 → 5.25                    | 3.58                                                 | 11.68                  |
| track                 | 1.77 → 3.51                    | 2.68                                                 | 11.68                  |
| foldLight             | 5.80 → 11.53                   | 6.67                                                 | 11.68                  |
| foldShade             | 3.12 → 6.19                    | 4.04                                                 | 11.68                  |
| foldDeep              | 2.17 → 4.32                    | 3.10                                                 | 11.68                  |
| foldInk               | 1.61 → 1.24                    | 1.24                                                 | 11.68                  |
| dryGround             | 4.10 → 8.15                    | 4.99                                                 | 11.68                  |
| aridGround            | 3.35 → 6.66                    | 4.28                                                 | 11.68                  |
| saltEdge              | 5.46 → 10.85                   | 6.32                                                 | 11.68                  |
| saltRim               | 5.82 → 11.56                   | 6.65                                                 | 11.68                  |
| salt                  | 6.12 → 12.15                   | 6.95                                                 | 11.68                  |
| saltCrack             | 2.33 → 4.63                    | 3.32                                                 | 11.68                  |
| crop-grain            | 3.54 → 7.02                    | 4.41                                                 | 11.68                  |
| crop-stubble          | 3.00 → 5.95                    | 3.91                                                 | 11.68                  |
| crop-green            | 2.70 → 5.35                    | 3.63                                                 | 11.68                  |
| crop-fallow           | 3.28 → 6.52                    | 4.22                                                 | 11.68                  |
