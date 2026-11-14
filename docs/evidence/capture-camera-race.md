# Camera completion and the order-paths capture race

The goal is a green `main` on every merge: a red capture must mean a real fault, not a slower runner.

## Proven cause

The failed `order-paths` trace from [main run 43630767755](https://github.com/ramtinJ95/first-game/actions/runs/43630767755), artifact `captures-4`, shows the last selection at zoom `2.0000` with `data-figures="0"` and three completed frames. At the timeout it has 37 figures and 99 completed frames, but the wrong selection has already opened Mediolanum's city panel.

This is a cold-sheet race, not just a guess about stale city boxes. The first close scene exists before its asynchronously painted figure sheets are available. Previously that scene hid the banners and disabled their hit targets immediately. A click before sheet painting finished found neither an army figure nor a banner, so it fell through to the city/province. A slower first close frame widens that window; waiting 200 ms after a wheel event cannot close it.

On `df0623b`, delaying the first `HTMLImageElement.decode()` by 5,000 ms reproduced the same scenario, stack (`selectArmy`, called from line 81), zero-figure close frame, and Mediolanum selection. The delay is an adversarial test condition, not a production wait or a fix. Only the army-sheet painter uses `Image.decode()` in the renderer.

A second, player-facing fault was independently reproduced: wheel or pan input changes the live camera before a new frame is visible, while picking used a mixture of that camera, old figures, and city boxes. Clicking an army still visible in the previous frame could therefore select the land behind it. This affects real input, not just automation.

Review also identified a completion-polling gap: the GPU can finish a submitted frame before the next animation callback records it. A deterministic regression reproduced a miss when a frame's fence becomes ready and a click follows in the same task, before another draw poll. Both input handlers now settle an already-signalled fence non-blockingly before reading the snapshot. GPU completion is the contract here; a fence is not a physical-display presentation timestamp.

## Contract and scope

- Camera mutations have a revision. `untilDrawn` waits for both the requested state and view revision in a GPU-completed frame whose visible scene sprites have been painted. `loadSave`, zoom, pan, close-up and jump use that one acknowledgment.
- Multi-notch zoom sends its inputs as a batch, then acknowledges the requested final view. Waiting for every intermediate notch needlessly paints transient terrain and figure-sheet sizes: the first integration run timed out the long atlas tour at the existing 12-minute job limit. Batching preserves every input and the final readiness check without increasing that limit.
- The atlas tour also batches each zoom around a safe target anchor instead of requiring a completed close scene every three notches. Unsafe anchors retain the staged zoom and pull. A bounded diagnostic made steady progress through 123 readiness barriers in two minutes, without a page error; this was excessive intermediate work, not evidence of a deadlock.
- CI run `43642625882` completed the full atlas tour in 495.8 s, then reached four subsequent captures before the shard's unchanged 12-minute budget expired. Its old 177.2 s scheduling weight was stale after factual completion waits. The measured weight is updated so the existing longest-first scheduler can isolate that cost; no timeout or shard count changes.
- The next run completed every capture, but its stage-three shard exhausted the same budget during artifact upload. Stage-three took 463.2 s against a stale 296.8 s scheduling weight; that measured weight is refreshed too. This is balancing actual acknowledged-view work, not retrying a failed assertion or relaxing a readiness check.
- Native wheel input quantizes CSS coordinates: a requested anchor `(416.44, 482.78967)` arrived at `(416, 482)`. The helper now sends integer CSS coordinates and uses those same values in its camera model, rather than amplifying a subpixel mismatch over successive zooms. World coordinates, scales and wheel deltas remain untouched. Sub-threshold drags do not advance the model or accidentally click the map.
- Readiness predicates are synchronous Booleans. Metadata is awaited before a one-RAF revision snapshot, then the completed revisions are polled. An asynchronous predicate returning a Promise resolved with `false` was experimentally shown to return before missing metadata appeared; the new blank-canvas regression prevents that false acknowledgment.
- The renderer snapshots camera, viewport and all pick geometry together at frame completion. Left clicks and right-click orders use that snapshot while another view is pending.
- `openGame` also waits for its first completed map: the top bar alone does not mean a pickable frame exists. The first PR run exposed two immediate post-open clicks that previously relied on the live-camera fallback; its trace showed no completed-frame metadata at the city click. Both now use the same readiness contract rather than picking unseen land.
- Flags remain visible and pickable during cold sheet painting, then give way to the ready figures. No simulation rule, sprite painter, or route drawing changed.
- The sweep found 26 camera-moving capture scenarios and 21 existing browser cases in six files using camera helpers. Eight scenarios and 20 of those cases click the map after a move; these are exposed callers, not 28 separately reproduced failures. `map` and `fog` had private camera implementations and now reuse the shared helpers. Raw input remains only in input-order tests, coast-cache invalidation, and intentional frame measurements, none followed by an ordinary map-selection click.
- The newly merged `trade-rules` capture and two trade browser tests were inspected on `c02aec7`: none moves the camera, and each already waits with `untilDrawn` after loading.
- The three before/after captures bind entry, camera, save and draw-wait helpers from their pinned revision at `withBaseline`. Old renderers do not publish the new view protocol; no compatibility fallback is added to current readiness waits.

## Verification

`e2e/camera-drawn.spec.ts` holds the first sheet decode until explicitly released, checks that the camera helper has not returned, selects the visible fallback flag, releases painting, and checks the final selection beside Mediolanum. Four further cases issue a pan/zoom and a click in one task, at banner and figure zooms, with a real active pointer. The held-GPU regression checks right-click orders against the visible point and verifies that releasing the fence lets the pending view complete. Another case finishes a submitted frame between draw polls and clicks its flag immediately; the eighth holds the first GPU frame and checks that game entry waits before allowing its first city click. Two additional cases exercise missing renderer metadata and fractional native input/model agreement, including a sub-threshold drag. These tests add no settling sleeps, retries or timeout increases.

The browser regressions use the normal test drawing; the full exported `order-paths` scenario is separately stress-run in fresh browser contexts with its first sheet decode delayed by 5,000 ms, full drawing, SwiftShader, and real screenshots at each scenario shot. The final repeated-run result and check commands are recorded in the pull request.

The `map` capture's pan measurements now include completed-view waits through the shared helper, so those measurement numbers should not be compared directly with its earlier unacknowledged sweeps. Dedicated `e2e/frame-bench.ts` measurements retain their raw input path.
