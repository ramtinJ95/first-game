# PR53 builder handover

PR53 stays **draft: do not merge**. The base is already the actual #51 squash,
`c02aec7ebaa68132f9add8652b977ce2b57bb028`; no further rebase was needed. This
handover adds no new browser, benchmark, build or unit run on the work Mac.

## Last measured result

App `b9624ba` (bounded route cache, **before the untested trimming candidate**)
against main `c02aec7`. Three alternating pairs, median of three per metric;
full SwiftShader, 1280×720, exact 1/4 px/km, same six-played-day world, paused
through setup, then day 7→13 in every sample. All readings are included.

| Zoom    | Rules interval median/p95; drawn median/p95 (ms) | Look (ms)            | Verdict against +10%                                |
| ------- | ------------------------------------------------ | -------------------- | --------------------------------------------------- |
| Middle  | 16.7/33.4; 21.7/23.4                             | 16.7/33.4; 23.2/29.7 | FAIL: drawn p95 +26.9%; other metrics 0%, 0%, +6.9% |
| Closest | 16.7/33.4; 22.1/24.2                             | 16.7/33.4; 23.4/25.4 | PASS: 0%, 0%, +5.9%, +5.0%                          |

Raw readings, exact single-frame WebGL traces, nearby CPU profiles and summaries:
[`evidence/trade-frames`](evidence/trade-frames). Earlier failed matrices remain
in [trade-validation.md](trade-validation.md); they were not relabelled as passes.

## Run the matched comparison on the build machine

Use Node 26+, installed Chromium and an otherwise idle host. Do not run builds,
tests, captures, another browser or another benchmark alongside a sample. These
commands are instructions for the next builder, **not runs performed here**.
Start in a fresh checkout of `feat/trade-look`:

```sh
git fetch origin main feat/trade-look
git worktree add ../trade-rules-c02 c02aec7ebaa68132f9add8652b977ce2b57bb028
git worktree add ../trade-cache-measured b9624ba490de4f2801b7c638c4bdde265f9a8e38
npm ci
npx playwright install chromium
(cd ../trade-rules-c02 && npm ci && npm run build)
(cd ../trade-cache-measured && npm ci && npm run build)

# Reproduce the last measured, untrimmed cache candidate first.
node scripts/trade-frame-bench.mjs --rules ../trade-rules-c02 --head ../trade-cache-measured --out /tmp/trade-cache-proof > /tmp/trade-cache-proof.log 2>&1
cat /tmp/trade-cache-proof/summary.json
```

The portable driver was copied from the measured temporary driver and
syntax/format checked only; its new portable CLI has **not** been browser-run.
It uses each checkout's frame bench and save format, injecting the same receipt,
exact-zoom and readiness protocol into old control sources. A failed source
anchor raises an error; do not replace that with a quiet fallback. It writes all
group logs, partial `comparison.json`, and (only on completion) `summary.json`.
Exit 1 also denotes a numerical failure. Three alternating pairs normally take
about nine minutes per selected/unselected condition. Do not parallelize them.

Before measuring the current trimming candidate, validate its actual build:

```sh
npm run check
npm test
npm run build
# Ensure no stale preview is listening on Playwright's port 4173.
npm run e2e -- e2e/trade.spec.ts e2e/trade-look.spec.ts

node scripts/trade-frame-bench.mjs --rules ../trade-rules-c02 --head . --out /tmp/trade-trim-selected > /tmp/trade-trim-selected.log 2>&1
cat /tmp/trade-trim-selected/summary.json
node scripts/trade-frame-bench.mjs --rules ../trade-rules-c02 --head . --out /tmp/trade-trim-unselected --unselected > /tmp/trade-trim-unselected.log 2>&1
cat /tmp/trade-trim-unselected/summary.json
```

Acceptance: **all four** interval/drawn median/p95 changes at **both** zooms must
be at most +10%, using the predeclared median of three and every valid reading.
Keep failures. A green CI frame smoke or unit suite is not this relative proof.

### What makes a run invalid

- Lost Roma selection or not exactly two selected paths; zero paths in an ON
  case versus two in an OFF case invalidated the old marker ablation. Unselected
  mode deliberately expects zero selected paths.
- Unequal look merchant scenes: the fixed fixture must draw **4 at middle and
  3 at closest**, with exact-resolution sheets ready, consistently between
  repeats/candidates. The rules renderer intentionally draws **zero** merchant
  figures; do not require baseline and look counts to equal each other.
- Day-only save waiting: the opening world can already be day 7 before async
  `File.text()` completes. Pause/flush the predecessor, require a changed latest
  state equal to the drawn state, and keep the loaded fixture at day 7 through
  setup. Explicitly resume before sampling; a no-page drop preserves pause.
- Wrong camera (must report `1.0000`/`4.0000`), busy terrain, pending sheets,
  clock not advancing, different viewport/drawing flags, or a stale build/server.
- A sample overlapping another CPU/GPU-heavy process, browser, test or capture.
  The earlier shutdown-overlapped diagnostic pair is not acceptance evidence.
- Interrupted/incomplete matrices, timeouts or changed warm-up/sample windows.
  Keep diagnostics and label the interruption; do not select a lucky subset,
  add retries, increase timeouts or rerun unchanged failures until green.

## Frame-cost work so far

1. Old selected paths submitted about 55.4k extra indices: look 83,376 versus
   rules 27,972 in the original closest single-frame trace. CPU profiles were
   dominated by GPU completion, not merchant scene creation. No animation freeze
   or speculative merchant scene cache was justified.
2. Phase-preserving clipping before dash generation and retaining static route
   geometry cut the look trace to 52,236 indices (−37.35%). The complete initial
   matrix still failed both zooms; see the retained raw tables.
3. Reusing #57's existing `cacheDrawing` reduced static selected paths to one
   sprite. The final matched-day matrix above passes closest but fails middle
   drawn p95. Covered pans/resizes, uncovered repaint, zoom and context restore
   were checked on the untrimmed cache; six scoped browser tests and 1,129 unit
   tests passed before the latest harness/cropping work.
4. Corrected the benchmark: rounded wheel notches actually produced
   0.9573/3.8821 instead of 1/4. Added a final exact step, load receipt witness,
   paused camera setup and explicit resume. These are protocol fixes applied to
   both sources, not a changed sampling window or numerical waiver.
5. The marker ON/OFF diagnostic had mismatched scenes, then one receipt-guard
   timeout. It is **noncausal** and was not used as acceptance. Later matched
   controls passed their receipt/scene guards, but the isolated timeout's cause
   was not established.
6. The original cold replay included #57's first natural-coast restroke/masks
   above scale 1.75: about 2.62 s rules versus 2.61 s old look, 32 offscreen draws
   each. Merchant sheets were still pending in that cold frame. Warm profiles
   separately verify merchants; do not claim this cold frame had them drawn.

## Profile finding and next candidate

The fresh exact middle single frame spent **19.8 of 21.9 ms in GPU completion
`readPixels`**, with 2.1 ms JS/submission, 29,202 indices, 13 draws, one offscreen
swell pass, zero uploads, two selected routes and four merchants. Closest was
22.8 ms, including 21.4 ms GPU wait. These are **not p95 frames**, so the p95 tail
is not causally explained by these traces.

The separate **untested** sprite-trimming commit is the next experiment. It
retains the existing full render texture for coverage but gives its displayed
sprite a shared-source `Texture` with tight `frame`/`orig`/`trim` bounds. About
81% of the middle screen quad lies outside the conservative ink AABB, so it
targets avoidable GPU fragment work without changing ink, animation or quality.
This is a hypothesis, not a promised speedup. It changes no shared cache helper.

The helper resets the sprite to its full texture on repaint; identity detects
when to rebuild the trimmed view. Covered pans/resizes reuse it. Owned view
textures are destroyed without destroying the cache's shared source. Empty ink
hides the quad. Four-pixel padding includes the halo and antialiasing fringe.

Still required: run the new pure bounds tests; type/lint/build checks; review
trimmed UV/geometry and shared-source lifecycle at resolutions 0.5/1/2; compare
isolated paused ink pixels against untrimmed `b9624ba`; exercise covered/uncovered
pan, resize, zoom, context restoration and closure; then fresh matched selected
and unselected matrices. No trimming tests or post-trim budget have run here.

## Other unfinished look work

- **Paused top-bar gold clarification is done**, not pending: `b9624ba` adds
  “Orders wait while paused. Opening gold is paid when the clock runs.” The
  browser test checks the unchanged 5,000 HUD gold after queuing. The rules
  capture has a third queued-payment screenshot, but fresh media is still due.
- Recapture `npm run capture -- trade-look trade-rules` on the final validated
  build: six look PNGs, three rules/payment PNGs and both clips. Inspect every
  full-size screenshot and both clips through closest ship/final raid/payment
  HUD. Old embedded `f45d07c` media predates the cache and trimming work.
- Publish only these two scenarios to immutable `pr-assets`, not the source
  branch; update embeds. The 90-second recording cap is not a test timeout.
- The final exact feature head still needs green `verify`/`e2e` and relevant
  review; do not reuse old-head green jobs as proof. This push's trimming commit
  is intentionally untested and the portable runner was not browser-run here.
- Budget is not waived. Keep draft until it passes and fresh shots/clip are
  available for owner inspection. No additional rules/AI balance changes needed.
- No Nexus preview URL is available: the installed CLI rejected output
  registration (`unknown command output`). Do not invent a preview URL.
