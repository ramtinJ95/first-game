# Map startup and frame evidence

Measured 2026-11-14 on the shared work Mac, Chromium 158.0.8127.18, 1280 × 720, ANGLE SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`). Baseline is unmodified `bfb5617`; after includes atlas ownership and the eight-texture cap. These local software-browser measurements are not a claim about deployed or physical-GPU performance. The baseline block varied considerably under shared-machine load; all ten samples, including cold starts, are retained. CI shard and frame comparisons belong to the PR.

## Ten starts each

Boundary: navigation through visible top bar, as `openGame` measures. A fresh browser context per start; the browser stays running across each block. `draw=test` uses 0.5 resolution, no grain/swell/antialiasing; `draw=full` is the actual game drawing. Both before and after use the same flags and drawing. Test-mode series also record a CDP CPU profile; full-mode series use only the WebGL link counter.

| Start       | Test before | Test after | Full before | Full after |
| ----------- | ----------- | ---------- | ----------- | ---------- |
| 1           | 6614        | 3341       | 11796       | 3661       |
| 2           | 4485        | 2367       | 5980        | 2288       |
| 3           | 6106        | 2343       | 5098        | 2490       |
| 4           | 5797        | 2348       | 5132        | 2313       |
| 5           | 5628        | 2353       | 4746        | 2597       |
| 6           | 4468        | 2093       | 4795        | 2843       |
| 7           | 3972        | 2364       | 5048        | 2851       |
| 8           | 3391        | 2357       | 4095        | 3062       |
| 9           | 3354        | 2332       | 4243        | 3373       |
| 10          | 3909        | 2107       | 4166        | 2928       |
| mean (ms)   | 4772.5      | 2400.3     | 5510.0      | 2840.7     |
| median (ms) | 4476.6      | 2350.4     | 4921.6      | 2846.9     |

The ≤3.8 s target is met by the after series; the table exposes cold-start outliers rather than discarding them. Reproduce against built preview servers with `node scripts/profile-startup.ts --base http://localhost:4173 --draw test --rounds 10 --profile /tmp/start.cpuprofile`, and again with `--draw full` (omit `--profile` for the full series). Raw numeric evidence is in `map-startup.json`.

## Where the time went

The CPU profile points to WebGL program linking, not wash rasterisation. The synchronized `LINK_STATUS` counter gives these median totals (ms):

| Drawing | Before | After  |
| ------- | ------ | ------ |
| Test    | 2684.5 | 1193.0 |
| Full    | 3453.5 | 1498.0 |

CPU work below is measured by user-timing boundaries. The baseline step series used the same source with timing-only instrumentation; the navigation series above uses the unmodified baseline build. Terrain includes Land/tint, and createWash includes rasterise: nested rows are not additive. Texture rows measure CPU generation; first-use shader work is recorded separately above.

| CPU step, median ms | Before | After |
| ------------------- | ------ | ----- |
| pixi-init           | 31.1   | 27.4  |
| water-texture       | 6.6    | 6.5   |
| terrain             | 375.9  | 372.5 |
| land                | 286.6  | 285.0 |
| ground-tint         | 16.9   | 16.4  |
| wash-create         | 46.0   | 44.9  |
| wash-rasterise      | 45.1   | 44.1  |
| borders             | 19.1   | 18.3  |
| fog                 | 2.1    | 2.0   |
| paper-texture       | 4.8    | 4.7   |
| wash-paint          | 50.3   | 48.6  |

Pixi sees 32 texture samplers in SwiftShader and builds branch-heavy batch/graphics shaders. This atlas predominantly draws ink and a handful of cached surfaces. Its WebGL limits extension caps batches at eight before shader construction, including context restoration. A ninth texture starts another batch; nothing is omitted. A full-resolution paused map drawn from the same unmodified baseline with 32 versus eight samplers was pixel-identical: **0 differing channels out of 3,686,400 RGBA channels**. The browser regression test independently checks that the production renderer actually uses eight. Context restoration was inspected, not browser-tested.

Build-time alternative: the exact province/desert raster is 1,908 × 1,138 cells, **13,027,824 raw bytes / 602,511 gzip bytes**, to save only about 45 ms of rasterisation. That is substantially more than the existing map’s ~360 KB gzip download. Initial paint is ~50 ms and must still run after conquest. Keep generation; do not add that download or frozen ownership data. No external art, font, or dependency is added.

## Local frame check

Three rounds, AI day 301, widest zoom; same existing frame-bench script and drawing.

| Drawing | Drawn median before → after | Drawn p95 before → after | Interval median before → after |
| ------- | --------------------------- | ------------------------ | ------------------------------ |
| Full    | 85.8 → 52.0 ms              | 96.7 → 64.9 ms           | 83.3 → 16.7 ms                 |
| Test    | 20.7 → 12.0 ms              | 428.4 → 418.7 ms         | 16.7 → 16.7 ms                 |

The unchanged wheel behaviour test passes without `test.slow()` (15.7 s, normal 30 s limit). `npm run check`, 782 unit tests, production build, and both affected browser tests passed locally. CI is the check of record; see the PR for the exact head and its results.
