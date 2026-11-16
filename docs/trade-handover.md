# Trade frame checks

The drawn trade look must cost at most 10% more per frame than main, at middle
(1 px/km) and closest (4 px/km) zoom, in frame interval and drawn time, median and
p95. This page says what made the look slow, what fixed it, what has been measured
since, and what is left.

## A selected city and the seventh play-through

The seventh play-through drew 48 frames in a minute with Roma selected and 91 with nothing
selected, with gaps up to 8.3 s. `e2e/trade-minute-bench.ts` plays that minute: Rome opens
its three routes from Roma on day 1 (the road to Mogontiacum, the lanes to Carthago and
Massalia; a new game's 1,500 gold pays for one, so the world holds 7,000), speed 2, a
120 px/s pan, 60 s at the closest and the middle zoom, Roma selected and not, three
alternating rounds, without `?frames`, so the frame pacer holds frames as in a game. It
counts the frames the GPU finished and the longest gap between two.

**Cause, traced.** Selecting a city opens the city panel. `createView` republished a fresh
snapshot every 100 ms, so `cityBuildings`, `recruitForecast`, `cityGuards` and the panel's
other derived values ran ten times a second while the state changed twice. In a Chrome trace
of 30 s at the closest zoom the page's main thread was busy 11.7 s with Roma selected and
6.2 s without; timer work was 2.0 s against 0.1 s, and the renderer's `draw` 1.0 s in both.
No frame rebuilt or uploaded trade ink. On two cores that main thread takes its time from
SwiftShader. The cost predates the trade look: `d1a58a1` loses frames when selected too.

**Fix.** The view publishes a snapshot only when one of its fields, or its frame's, is a new
value (`sameSnapshot` in `src/app/view.svelte.ts`); `main.ts` keeps the standing and a
fate's modal by state, as it keeps sight. The panels now run once a day played, not five.

Medians of three rounds on this pylon (2 cores, SwiftShader, 1280×720), each round in
brackets. `main` is `d528f01`, the branch its change on that `main`.

| Build     | Zoom    | Roma selected: frames, longest gap | Nothing selected: frames, longest gap |
| --------- | ------- | ---------------------------------- | ------------------------------------- |
| `d1a58a1` | closest | 81 (81, 87, 78), 1.31 s            | 82 (75, 93, 82), 1.32 s               |
| `d1a58a1` | middle  | 64 (48, 76, 64), 2.03 s            | 58 (57, 58, 72), 1.90 s               |
| `main`    | closest | 83 (78, 83, 94), 1.17 s            | 94 (86, 94, 108), 1.02 s              |
| `main`    | middle  | 66 (62, 66, 79), 1.94 s            | 72 (63, 72, 74), 1.81 s               |
| branch    | closest | 83 (80, 83, 92), 1.08 s            | 91 (91, 85, 106), 1.07 s              |
| branch    | middle  | 68 (55, 77, 68), 2.51 s            | 68 (57, 68, 100), 1.84 s              |
| branch    | middle  | 83 (74, 91, 83), 1.74 s            | 76 (80, 76, 75), 1.78 s               |

The last row is three more rounds at the final head. One build against itself spreads by
more than a tenth: nothing selected drew 85 to 106 frames at closest and 57 to 100 at middle
in the same session. So the matrix cannot tell a few percent; the median frame interval of
alternating 30 s runs can. There, at closest, nothing selected took 616 to 634 ms and Roma
selected 654 to 669 ms on the branch (`main` 730 against 669, and 766 against 707): drawing a
selection still costs about 7 %, shared by compositing the panel, the highlight's fill and
the route ink (each removed alone saved 1.5 to 3 %; all three, all of it). Making the panel
opaque, dropping its corners and shadow, or leaving out the highlight fill at closest each
saved nothing measurable, so the look is unchanged.

On a GPU (inference, not measured): fills and a composited panel cost little there, while
forecasts of tens of milliseconds ten times a second stall a 5 ms frame, so the panel's
republish is the cost a player would feel and is the one removed.

CI's `frame-benches` job runs `--alternate 4 --segment 4 --budget`: at closest and middle,
one page each, four 4 s sweeps of the pan select nothing, Roma, Roma, nothing, so each
selection gets two sweeps, 8 s and about 13 frames. The frame rule compares frame rates (the
frames between each sweep's first and last, over the time they span), so a sweep's edges do
not move it by a frame; the gap and panel rules are as in the full minute. One page and
that order put the host's drift on both selections alike, and the run takes about a minute
(63 s in CI).

It is not a stable pass on this pylon. On the unchanged head the step passed 3 of 5 runs
counting frames and 2 of 4 comparing rates: once Roma selected drew 1.55 frames a second
against a floor of 1.57 at closest, and twice its longest middle gap was 2 to 4 % over the
tenth (1,844 against 1,815 ms, 2,018 against 1,974 ms). Roma selected's longest middle gap
was the longer one in every run. A selected city still costs about 7 % of a frame in
software GL, near the tenth, and 8 s a side cannot separate the two reliably. The long
middle frames are GPU time (no main-thread task over 110 ms in a trace of them). Drawing
the selected routes each frame instead of from their cached texture did not shorten them,
so that was not done. On `main` the step fails on its panels every time, 5.1 and 4.9
refreshes a day.

## Merchants a player sees

A route drew one merchant, at its crossing. Rome's road to Mogontiacum is 971 km, 61 days a
crossing, and the closest view is 320 km wide, so near Roma the caravan was in view a few
days a crossing; at middle zoom a merchant is about 12 px, and ships at the end of a
crossing sat under their port. A route now draws a merchant every 200 km of its round trip,
half each way (`merchantPoses` in `src/render/trade.ts`): 10 on the Mogontiacum road, 6 on
each lane. In the bench world at middle zoom the map draws 30 merchant figures (12 ships, 6
caravans, with their walkers); at closest over Roma, 11 to 16. The `merchants` capture plays
the game on from day 2 and shows them at both zooms, Roma selected and not.

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

## Verdict: not established on this host

The budget is set in `scripts/trade-frame-bench.mjs`: three alternating rounds, a
1.5-second warm-up and a 5-second meter window from day 7, with Roma selected and
with nothing selected. All four figures must be within +10% at both zooms.

On main `3605308`, the look `bddb7a9` (the current changes, before the rebase onto
`d1a58a1`, which changed no renderer code) passes with Roma selected: every figure
is within +10% at both zooms. With nothing selected its medians are within +10% and
its p95s are not: +26.9% interval and +36.9% drawn at middle, +14.8% and +24.0% at
closest. Main against itself in the same session gave up to +11.1% interval and
+18.5% drawn in middle p95, and an earlier session up to 35% at closest. A p95 here
is the slowest or second slowest of about twelve frames; one round's p95 for one
build ranged from 450 to 867 ms.

So on this host the committed protocol does not settle the p95s either way. Settling
them needs a steadier host, or the owner's decision to accept the measured medians,
which are within +10% in every run.

### The committed protocol on `3605308`

The driver ran unchanged except its 180-second limit on each browser run, which only
guards against a hung process, raised to 1,800 seconds in an uncommitted copy,
because one side's setup takes about 7.5 minutes on this VM.

| Run                    | Zoom    | Interval median | Interval p95 | Drawn median | Drawn p95 |
| ---------------------- | ------- | --------------- | ------------ | ------------ | --------- |
| look, Roma selected    | middle  | -3.8%           | -6.4%        | +0.1%        | -1.1%     |
| look, Roma selected    | closest | +7.7%           | +3.5%        | +6.5%        | +3.2%     |
| look, nothing selected | middle  | +8.7%           | +26.9%       | +8.4%        | +36.9%    |
| look, nothing selected | closest | -4.0%           | +14.8%       | +0.5%        | +24.0%    |
| main against itself    | middle  | 0.0%            | +11.1%       | -0.9%        | +18.5%    |
| main against itself    | closest | 0.0%            | 0.0%         | -0.5%        | -6.8%     |

Unselected p95 per round, middle interval: look 683.3, 550 and 449.9 ms; main 450.1,
416.6 and 433.4 ms. Readings and logs are in
[`evidence/trade-frames/3605308-committed-protocol`](evidence/trade-frames/3605308-committed-protocol).

### The committed protocol on `aef5b10`, before the plain-name fallback

Each side ran the committed driver unchanged except one line: its 180-second limit
on each browser run, which only guards against a hung process, was raised to 1,800
seconds in an uncommitted copy, because one side's setup alone takes about 7.5
minutes on this VM. The windows, rounds and scene guards are as committed.

| Run                 | Zoom    | Interval median | Interval p95 | Drawn median | Drawn p95 |
| ------------------- | ------- | --------------- | ------------ | ------------ | --------- |
| look against main   | middle  | +4.0%           | 0.0%         | +4.4%        | -0.5%     |
| look against main   | closest | +7.4%           | +20.6%       | +3.9%        | +15.5%    |
| main against itself | middle  | +8.0%           | +12.9%       | +1.2%        | +9.1%     |
| main against itself | closest | -3.7%           | -31.1%       | -0.6%        | -35.1%    |

The look's closest p95 per round was 550, 683.2 and 1,266.6 ms, against main's
566.7, 516.7 and 1,166.6 ms. The unselected run was stopped when main moved; the
trace below has it within +10% throughout. Readings and logs are in
[`evidence/trade-frames/aef5b10-committed-protocol`](evidence/trade-frames/aef5b10-committed-protocol).

## Every frame traced, three rounds on main `aef5b10`

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

This meter reading is not the committed protocol's: the trace replaces the 5-second
window with 60 seconds and reads the meter at its end, after the page has handed the
traced frames over.

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

- About 7 % of a closest frame in software GL for drawing a selected city's panel,
  outline and route ink.

- A steadier host for the committed protocol, or the owner's decision on the closest
  p95 above.
- Why the look's frames at the end of a 60-second traced window are slower with Roma
  selected.
