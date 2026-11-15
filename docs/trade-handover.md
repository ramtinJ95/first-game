# Trade frame checks

The drawn trade look must cost at most 10% more per frame than main, at middle
(1 px/km) and closest (4 px/km) zoom, in frame interval and drawn time, median and
p95. This page says what made the look slow, what fixed it, what has been measured
since, and what is left.

## What made the look slow

The goods suffix widens a city label, as in `ROMA · grain`. The first legion, resting
at Roma, stands beside its city's name. The wider name moved its clear box right
by 54 px. Both land probes on that side then failed, the army fell to the sea side,
and `landShift` searched rings of candidate shifts: about 28,000 to 32,000 land tests
in every scene build, against 417 on main. Scene builds rose from 0.5 ms to about
5 ms. With the goods suffix turned off, the look made 426 land tests per build.

The fix remembers each shift by camera, viewport, figure height and the samples
tested, for the land test it was asked of (`Context.landShift` in
`src/render/armies/scene.ts`). An army at rest asks for the same shift on every
frame. The land test must keep its answers, so the renderer passes `buildScene` one
`onOpenLand` for its life. The unit test `scene.test.ts` checks that a resting army
is placed once and keeps its place.

The earlier work on selected-route ink, the bounded route texture and the trimmed
sprite stays. The trimmed sprite drew the same pixels as the untrimmed one at
middle, closest, panned and resized views, and in a paired in-page toggle it was
about 10% faster in GPU time.

## Measured on main `aef5b10`

One round, 60-second windows of every drawn frame (about 150 frames per side), on
builds made from the measured commits. Main is `aef5b10`. The look is `0860908`.
"Before the fix" is `ef7bcc5`, the trimmed look without the land-shift memory.
SwiftShader on a 2-core VM, so frames take about 400 ms and GPU completion
dominates. Changes are against main in the same round.

| Look           | Zoom    | Interval median | Interval p95 | Drawn median | Drawn p95 | Land tests per frame |
| -------------- | ------- | --------------- | ------------ | ------------ | --------- | -------------------- |
| After the fix  | middle  | +2.7%           | +6.9%        | +3.0%        | +3.9%     | 143 (main 417)       |
| After the fix  | closest | +5.5%           | +6.5%        | +6.2%        | +7.4%     | 135 (main 414)       |
| Before the fix | middle  | +6.5%           | +12.5%       | +6.0%        | +8.4%     | 28,367 (main 417)    |
| Before the fix | closest | +7.0%           | +5.3%        | +7.1%        | +12.6%    | 423 (main 414)       |

All eight figures after the fix are within +10% in this round. One round is not
the predeclared median of three. The bench's own 5-second meter put the middle p95
of the same run at +29% interval and +25% drawn. On this host, two identical builds
differ by up to 9% in medians and by up to 39% (per-frame trace) or 99% (5-second
meter) in p95, so this run cannot settle a p95 within a tenth.

Raw frames, the bench logs and the summary are in
[`evidence/trade-frames/aef5b10`](evidence/trade-frames/aef5b10). Each frame
records its CPU time, scene build time, land tests, draws, indices and texture
uploads. No frame in the window uploaded a texture or repainted a cache.

### Method

The comparison drives each checkout's own `e2e/frame-bench.ts` from
`scripts/trade-frame-bench.mjs`, with the same six-day trade world (`tradingRome`),
Roma selected and two selected routes. A temporary, uncommitted patch records each
frame into `globalThis.__ft`: in `renderer.ts` the time from the settled frame to
`app.render()` (CPU), the scene build and the land tests, and in `main.ts` the whole
frame. A WebGL hook counts draws, indices, buffer writes and texture uploads. Every
checkout is rebuilt (`npm run build`) after it is checked out and patched, because
the bench serves each checkout's `dist/`.

## What makes a run invalid

- A stale build. The bench serves `dist/` through `vite preview`, so a checkout moved
  to a new commit measures its old build until it is built again.
- A world from another commit. The fixture comes from the checkout that runs the
  bench, so run it from the look checkout being measured.
- Lost Roma selection or not exactly two selected paths. Unselected mode expects zero.
- Unequal merchant scenes. On `aef5b10` the fixture draws 4 merchants at both zooms
  when the window starts on day 7. The count is read there, because merchants travel
  during the window: on `0b22fa4` the count after a 60-second window was 3 at closest
  in 13 of 14 runs and 4 once. Whether the old documented 3 at closest came from that
  later reading or from the world changing was not separated. The rules renderer
  draws no merchants.
- Wrong camera (it must report `1.0000` and `4.0000`), busy terrain, pending figure
  sheets, or a clock that does not advance.
- Another heavy process during a sample: a build, the unit suite, another browser or
  a capture. On this VM a bench beside `npm test` crashed Chromium, and an
  out-of-memory kill ended an earlier matrix.
- Interrupted matrices, changed windows, retries or raised timeouts. Keep failures.

## Left for a follow-up

- The full three-round matrix, selected and unselected, on main at the time, ideally
  on a faster idle host where the 5-second meter's p95 is steadier.
