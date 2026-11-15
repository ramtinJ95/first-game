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

## Verdict: the budget is not met

Against main `aef5b10`, the look `866ece7` is within +10% on every median and on
every p95 of the per-frame trace, selected and unselected, at both zooms. It is
not within +10% on the p95 of the bench's own 5-second meter with Roma selected:
+62% interval and +60% drawn at middle, +11% and +14% at closest. That meter is
the measure the budget was set in, so the budget is not met. The cause of the
meter's tail is not established.

## Three rounds on main `aef5b10`

Three alternating rounds, median of three, on builds made from the measured
commits: main `aef5b10` and the look `866ece7`. Each round traces every drawn frame
for 60 seconds (about 140 frames per side) and then reads the meter. SwiftShader on
a 2-core VM, so frames take about 400 ms and GPU completion dominates.

| Roma     | Measure         | Zoom    | Interval median | Interval p95 | Drawn median | Drawn p95  |
| -------- | --------------- | ------- | --------------- | ------------ | ------------ | ---------- |
| selected | per-frame trace | middle  | +2.0%           | +4.2%        | +1.5%        | +1.0%      |
| selected | per-frame trace | closest | +5.9%           | +4.6%        | +6.0%        | +3.3%      |
| selected | 5-second meter  | middle  | +4.2%           | **+61.6%**   | +7.5%        | **+60.3%** |
| selected | 5-second meter  | closest | +4.0%           | **+10.7%**   | +6.0%        | **+13.5%** |
| none     | per-frame trace | middle  | -2.2%           | -14.0%       | -0.8%        | -12.8%     |
| none     | per-frame trace | closest | -4.6%           | -8.1%        | -3.7%        | -8.6%      |
| none     | 5-second meter  | middle  | -8.0%           | -40.0%       | -10.8%       | -38.4%     |
| none     | 5-second meter  | closest | -8.0%           | +7.1%        | -4.8%        | +7.9%      |

The look makes 143 land tests per middle frame and 135 per closest frame, against
417 and 414 on main. Its scene builds take 0.8 to 0.9 ms (main 0.6 to 0.8), and its
CPU per frame is 2.0 to 2.2 ms (main 1.6 to 1.9). No frame uploaded a texture or
repainted a cache. In the unselected run, main's third round drew fewer frames (116
and 106) than its others.

### Main against itself

The same three rounds of main against main, with the same world, show how far two
identical builds differ on this host: per-frame trace +2.5% / +26.6% interval and
+2.5% / +23.0% drawn at middle (median / p95), +8.9% / +10.1% and +9.5% / +11.4% at
closest; meter -4.0% / -28.2% and -3.7% / -26.4% at middle, 0.0% / -2.6% and
+2.4% / -12.3% at closest. The look's +62% meter p95 at middle is larger than that
spread and repeats in all three rounds.

### The meter's tail

The meter is a rolling 5-second window, read at the end of the 60 seconds, so its
p95 is the slowest or second slowest of about twelve frames on days 65 to 69. With
Roma selected, the look's middle meter p95 was 700, 817 and 700 ms in the three
rounds, against 433 ms on main each time. The traces show slow frames of 580 to
680 ms at the end of two look rounds, and one of 816 ms on main. Those frames spent
at most 18 ms in CPU, so most of their time was GPU completion. Why the look's end of
window is slower with Roma selected is not established.

### Before the fix

One round on the same main, against `ef7bcc5` (the trimmed look without the
land-shift memory): 28,367 land tests per middle frame and 6.9 ms of CPU per frame,
against 417 and 1.4 ms on main. Per-frame trace changes were +6.5% / +12.5% interval
and +6.0% / +8.4% drawn at middle (median / p95), and +7.0% / +5.3% and +7.1% /
+12.6% at closest. An earlier single round of the fixed look, `0860908`, is kept
beside it.

Raw frames, meter readings and logs are in
[`evidence/trade-frames/aef5b10-three-rounds`](evidence/trade-frames/aef5b10-three-rounds)
and [`evidence/trade-frames/aef5b10`](evidence/trade-frames/aef5b10).

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

## Left open

- The meter's p95 tail with Roma selected, above. A faster idle host would show
  whether it follows the look or the host.
