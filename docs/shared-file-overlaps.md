# Shared-file overlap evidence

## Method

Source: GitHub pull-request file lists and patches for the ten most recently merged PRs at main snapshot `0031bb7`: [#43](https://github.com/ramtinJ95/first-game/pull/43), [#46](https://github.com/ramtinJ95/first-game/pull/46), [#42](https://github.com/ramtinJ95/first-game/pull/42), [#45](https://github.com/ramtinJ95/first-game/pull/45), [#41](https://github.com/ramtinJ95/first-game/pull/41), [#44](https://github.com/ramtinJ95/first-game/pull/44), [#40](https://github.com/ramtinJ95/first-game/pull/40), [#38](https://github.com/ramtinJ95/first-game/pull/38), [#39](https://github.com/ramtinJ95/first-game/pull/39), [#37](https://github.com/ramtinJ95/first-game/pull/37). The six requested feature PRs are 36, 35, 37, 39, 38, and 40. File overlap is not proof of a textual merge conflict. “After” is a conservative replay of those changes using the new extension points, not a claim that already-merged commits changed retroactively. All original behavior files remain shared unless their edits were only replaced registrations/version assertions. New shared area-guide paths are counted too.

- Save version bumps/comments move to feature-specific change files. The format-number-only assertions in 36/39 and the interpolation cleanup in 38 disappear; 40’s real war-save test remains. Only 38 still changes the save envelope itself, so neither save file remains pairwise shared.
- New simulation commands use the generic discovery command, and their usage belongs in the feature guide, not another row appended to the legacy command table. Thus 39/40 no longer edit `package.json` or a shared command table.
- 39/40 change only slot registrations in `clock.ts`; their new registration files replace those edits. 38’s actual clock-loop change stays. Handler registration changes likewise move to distinct files.
- Alert kind registration moves out, but 38/39/40 also change news behavior in `alerts.ts`: this file is deliberately **not** counted as eliminated.
- Area-guide assignments below follow each PR’s actual `CLAUDE.md` patch, including map-data versus new-game. Shared changes within the same guide still count.

## All fifteen requested pairs

| Pair                     | Before: shared files | After: shared files | Original shared files no longer shared                                                                                 | New shared guides after moving documentation                 |
| ------------------------ | -------------------: | ------------------: | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [#36 / #35](#pair-36-35) |                    1 |                   0 | `CLAUDE.md`                                                                                                            | —                                                            |
| [#36 / #37](#pair-36-37) |                    3 |                   3 | `CLAUDE.md`                                                                                                            | `docs/engineering/faction-ai.md`                             |
| [#36 / #39](#pair-36-39) |                    9 |                   7 | `CLAUDE.md`, `src/sim/save.test.ts`, `src/sim/save.ts`                                                                 | `docs/engineering/faction-ai.md`                             |
| [#36 / #38](#pair-36-38) |                   10 |                   7 | `CLAUDE.md`, `src/sim/save.test.ts`, `src/sim/save.ts`                                                                 | —                                                            |
| [#36 / #40](#pair-36-40) |                   10 |                   7 | `CLAUDE.md`, `src/sim/save.test.ts`, `src/sim/save.ts`                                                                 | —                                                            |
| [#35 / #37](#pair-35-37) |                    1 |                   0 | `CLAUDE.md`                                                                                                            | —                                                            |
| [#35 / #39](#pair-35-39) |                    1 |                   0 | `CLAUDE.md`                                                                                                            | —                                                            |
| [#35 / #38](#pair-35-38) |                    5 |                   4 | `CLAUDE.md`                                                                                                            | —                                                            |
| [#35 / #40](#pair-35-40) |                    2 |                   1 | `CLAUDE.md`                                                                                                            | —                                                            |
| [#37 / #39](#pair-37-39) |                    2 |                   2 | `CLAUDE.md`                                                                                                            | `docs/engineering/faction-ai.md`                             |
| [#37 / #38](#pair-37-38) |                   11 |                  12 | `CLAUDE.md`                                                                                                            | `docs/engineering/battles.md`, `docs/engineering/panels.md`  |
| [#37 / #40](#pair-37-40) |                    7 |                   8 | `CLAUDE.md`                                                                                                            | `docs/engineering/movement.md`, `docs/engineering/panels.md` |
| [#39 / #38](#pair-39-38) |                   15 |                  11 | `CLAUDE.md`, `src/app/clock.ts`, `src/sim/save.test.ts`, `src/sim/save.ts`                                             | —                                                            |
| [#39 / #40](#pair-39-40) |                   17 |                  11 | `CLAUDE.md`, `package.json`, `src/app/clock.ts`, `src/sim/orders/orders.ts`, `src/sim/save.test.ts`, `src/sim/save.ts` | —                                                            |
| [#38 / #40](#pair-38-40) |                   20 |                  17 | `CLAUDE.md`, `src/app/clock.ts`, `src/sim/save.test.ts`, `src/sim/save.ts`                                             | `docs/engineering/panels.md`                                 |

Total pairwise file incidences: **114 → 90**. This does not imply a proportional reduction in CI runs; genuine shared behavior still needs integration validation.

## Files touched by three or more of the last ten merged PRs

| File                              | PR count | Treatment                                                                                                              |
| --------------------------------- | -------: | ---------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                       |        7 | Area details moved to linked guides; cross-cutting rules remain.                                                       |
| `e2e/support.ts`                  |        5 | Fixture helpers remain shared; splitting exported fixtures and all consumers is a separate refactor.                   |
| `src/app/alerts.test.ts`          |        5 | Real UI, scenario, fixture, or behavior changes remain shared; splitting is not a small registration cleanup.          |
| `src/app/main.ts`                 |        5 | Real UI, scenario, fixture, or behavior changes remain shared; splitting is not a small registration cleanup.          |
| `e2e/panels.spec.ts`              |        4 | Real UI, scenario, fixture, or behavior changes remain shared; splitting is not a small registration cleanup.          |
| `src/app/alerts.ts`               |        4 | Kinds generated from feature files; news behavior still shared.                                                        |
| `src/app/clock.ts`                |        4 | Slots generated from independent typed order registrations; actual clock behavior remains.                             |
| `src/app/fates.test.ts`           |        4 | Real UI, scenario, fixture, or behavior changes remain shared; splitting is not a small registration cleanup.          |
| `src/ui/describe.test.ts`         |        4 | Real UI, scenario, fixture, or behavior changes remain shared; splitting is not a small registration cleanup.          |
| `docs/design.md`                  |        3 | Agreed design remains one document; splitting decisions would hide cross-area tradeoffs.                               |
| `package.json`                    |        3 | New simulation commands use file discovery; existing aliases remain compatible.                                        |
| `src/app/page.ts`                 |        3 | Real UI, scenario, fixture, or behavior changes remain shared; splitting is not a small registration cleanup.          |
| `src/sim/ai/decide.test.ts`       |        3 | Real rule, UI, fixture, or scenario changes remain shared; splitting is not a small registration cleanup.              |
| `src/sim/ai/decide.ts`            |        3 | Real rule, UI, fixture, or scenario changes remain shared; splitting is not a small registration cleanup.              |
| `src/sim/cities.ts`               |        3 | Real rule, UI, fixture, or scenario changes remain shared; splitting is not a small registration cleanup.              |
| `src/sim/fixture.ts`              |        3 | Real state/rule changes remain shared; not a registration-only edit.                                                   |
| `src/sim/new-game.ts`             |        3 | Real state/rule changes remain shared; not a registration-only edit.                                                   |
| `src/sim/orders/orders.ts`        |        3 | Handlers and kinds are generated from one typed registration per order; real handler behavior remains in its own file. |
| `src/sim/save.test.ts`            |        3 | Version bump/assertion contention removed with named change files; real parser tests remain.                           |
| `src/sim/save.ts`                 |        3 | Version bump/assertion contention removed with named change files; real parser tests remain.                           |
| `src/sim/systems/battles.test.ts` |        3 | Real rule, UI, fixture, or scenario changes remain shared; splitting is not a small registration cleanup.              |
| `src/sim/systems/battles.ts`      |        3 | Real rule, UI, fixture, or scenario changes remain shared; splitting is not a small registration cleanup.              |
| `src/sim/systems/economy.ts`      |        3 | Real state/rule changes remain shared; not a registration-only edit.                                                   |
| `src/ui/ArmyPanel.svelte`         |        3 | Real rule, UI, fixture, or scenario changes remain shared; splitting is not a small registration cleanup.              |
| `src/ui/CityPanel.svelte`         |        3 | Real UI, scenario, fixture, or behavior changes remain shared; splitting is not a small registration cleanup.          |
| `src/ui/Hud.svelte`               |        3 | Real UI, scenario, fixture, or behavior changes remain shared; splitting is not a small registration cleanup.          |
| `src/ui/describe.ts`              |        3 | Real rule, UI, fixture, or scenario changes remain shared; splitting is not a small registration cleanup.              |

`package.json` and `src/sim/orders/orders.ts` both reach the three-PR threshold in this snapshot. Their named extension points now use independent files; existing simulation aliases forward through the same fresh-registry dispatcher.

## Documentation replay assignments

| PR  | Destination guide(s) for its previous CLAUDE detail                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| #36 | `docs/engineering/cities.md`, `docs/engineering/faction-ai.md`, `docs/engineering/new-game.md`, `docs/engineering/sieges.md`                     |
| #35 | `docs/engineering/armies-on-the-map.md`, `docs/engineering/map-data.md`, `docs/engineering/renderer.md`                                          |
| #37 | `docs/engineering/battles.md`, `docs/engineering/faction-ai.md`, `docs/engineering/movement.md`, `docs/engineering/panels.md`                    |
| #39 | `docs/engineering/buildings.md`, `docs/engineering/faction-ai.md`                                                                                |
| #38 | `docs/engineering/battles.md`, `docs/engineering/browser-tests.md`, `docs/engineering/panels.md`, `docs/engineering/the-frame-round-the-game.md` |
| #40 | `docs/engineering/adding-a-system.md`, `docs/engineering/movement.md`, `docs/engineering/panels.md`, `docs/engineering/peace.md`                 |

## Full pair inventories

### Pair 36-35

**Before — every file both changed:** `CLAUDE.md`.

**After — every file still shared in the replay:** —.

### Pair 36-37

**Before — every file both changed:** `CLAUDE.md`, `scripts/sim-world.ts`, `src/sim/ai/armies.ts`.

**After — every file still shared in the replay:** `docs/engineering/faction-ai.md`, `scripts/sim-world.ts`, `src/sim/ai/armies.ts`.

### Pair 36-39

**Before — every file both changed:** `CLAUDE.md`, `docs/design.md`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/save.test.ts`, `src/sim/save.ts`, `src/sim/state/city.ts`, `src/sim/systems/economy.ts`, `src/sim/systems/sieges.ts`.

**After — every file still shared in the replay:** `docs/design.md`, `docs/engineering/faction-ai.md`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/state/city.ts`, `src/sim/systems/economy.ts`, `src/sim/systems/sieges.ts`.

### Pair 36-38

**Before — every file both changed:** `CLAUDE.md`, `e2e/map.spec.ts`, `src/sim/ai/conquest.test.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/save.test.ts`, `src/sim/save.ts`, `src/sim/state/faction.ts`, `src/sim/systems/economy.ts`, `src/sim/systems/sieges.test.ts`.

**After — every file still shared in the replay:** `e2e/map.spec.ts`, `src/sim/ai/conquest.test.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/state/faction.ts`, `src/sim/systems/economy.ts`, `src/sim/systems/sieges.test.ts`.

### Pair 36-40

**Before — every file both changed:** `CLAUDE.md`, `docs/design.md`, `src/sim/ai/minor.ts`, `src/sim/ai/thresholds.ts`, `src/sim/ai/war.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/references.ts`, `src/sim/save.test.ts`, `src/sim/save.ts`.

**After — every file still shared in the replay:** `docs/design.md`, `src/sim/ai/minor.ts`, `src/sim/ai/thresholds.ts`, `src/sim/ai/war.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/references.ts`.

### Pair 35-37

**Before — every file both changed:** `CLAUDE.md`.

**After — every file still shared in the replay:** —.

### Pair 35-39

**Before — every file both changed:** `CLAUDE.md`.

**After — every file still shared in the replay:** —.

### Pair 35-38

**Before — every file both changed:** `CLAUDE.md`, `scripts/capture/scenarios/stage-three.ts`, `src/render/armies/every-city.test.ts`, `src/render/armies/scene.ts`, `src/render/renderer.ts`.

**After — every file still shared in the replay:** `scripts/capture/scenarios/stage-three.ts`, `src/render/armies/every-city.test.ts`, `src/render/armies/scene.ts`, `src/render/renderer.ts`.

### Pair 35-40

**Before — every file both changed:** `CLAUDE.md`, `src/render/armies/every-city.test.ts`.

**After — every file still shared in the replay:** `src/render/armies/every-city.test.ts`.

### Pair 37-39

**Before — every file both changed:** `CLAUDE.md`, `e2e/support.ts`.

**After — every file still shared in the replay:** `docs/engineering/faction-ai.md`, `e2e/support.ts`.

### Pair 37-38

**Before — every file both changed:** `CLAUDE.md`, `e2e/panels.spec.ts`, `e2e/support.ts`, `src/app/main.ts`, `src/app/view.svelte.ts`, `src/sim/ai/decide.test.ts`, `src/sim/state/army.ts`, `src/sim/systems/battles.test.ts`, `src/ui/ArmyPanel.svelte`, `src/ui/describe.test.ts`, `src/ui/describe.ts`.

**After — every file still shared in the replay:** `docs/engineering/battles.md`, `docs/engineering/panels.md`, `e2e/panels.spec.ts`, `e2e/support.ts`, `src/app/main.ts`, `src/app/view.svelte.ts`, `src/sim/ai/decide.test.ts`, `src/sim/state/army.ts`, `src/sim/systems/battles.test.ts`, `src/ui/ArmyPanel.svelte`, `src/ui/describe.test.ts`, `src/ui/describe.ts`.

### Pair 37-40

**Before — every file both changed:** `CLAUDE.md`, `e2e/support.ts`, `src/app/command.test.ts`, `src/app/main.ts`, `src/sim/systems/battles.ts`, `src/sim/systems/movement.test.ts`, `src/ui/describe.test.ts`.

**After — every file still shared in the replay:** `docs/engineering/movement.md`, `docs/engineering/panels.md`, `e2e/support.ts`, `src/app/command.test.ts`, `src/app/main.ts`, `src/sim/systems/battles.ts`, `src/sim/systems/movement.test.ts`, `src/ui/describe.test.ts`.

### Pair 39-38

**Before — every file both changed:** `CLAUDE.md`, `e2e/support.ts`, `src/app/alerts.test.ts`, `src/app/alerts.ts`, `src/app/clock.ts`, `src/app/fates.test.ts`, `src/app/fates.ts`, `src/app/names.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/save.test.ts`, `src/sim/save.ts`, `src/sim/systems/economy.ts`, `src/ui/CityPanel.svelte`, `src/ui/FatePrompt.svelte`.

**After — every file still shared in the replay:** `e2e/support.ts`, `src/app/alerts.test.ts`, `src/app/alerts.ts`, `src/app/fates.test.ts`, `src/app/fates.ts`, `src/app/names.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/systems/economy.ts`, `src/ui/CityPanel.svelte`, `src/ui/FatePrompt.svelte`.

### Pair 39-40

**Before — every file both changed:** `CLAUDE.md`, `docs/design.md`, `e2e/support.ts`, `package.json`, `src/app/alerts.test.ts`, `src/app/alerts.ts`, `src/app/clock.ts`, `src/app/fates.test.ts`, `src/sim/ai/decide.ts`, `src/sim/cities.ts`, `src/sim/events.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/orders/orders.ts`, `src/sim/save.test.ts`, `src/sim/save.ts`, `src/sim/systems.ts`.

**After — every file still shared in the replay:** `docs/design.md`, `e2e/support.ts`, `src/app/alerts.test.ts`, `src/app/alerts.ts`, `src/app/fates.test.ts`, `src/sim/ai/decide.ts`, `src/sim/cities.ts`, `src/sim/events.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/systems.ts`.

### Pair 38-40

**Before — every file both changed:** `CLAUDE.md`, `e2e/support.ts`, `scripts/sim-sieges.ts`, `src/app/alerts.test.ts`, `src/app/alerts.ts`, `src/app/clock.ts`, `src/app/fates.test.ts`, `src/app/main.ts`, `src/app/page.ts`, `src/app/pauses.test.ts`, `src/app/turning-points.test.ts`, `src/render/armies/every-city.test.ts`, `src/sim/battle-trial.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/sim/save.test.ts`, `src/sim/save.ts`, `src/ui/Hud.svelte`, `src/ui/OverviewPanel.svelte`, `src/ui/describe.test.ts`.

**After — every file still shared in the replay:** `docs/engineering/panels.md`, `e2e/support.ts`, `scripts/sim-sieges.ts`, `src/app/alerts.test.ts`, `src/app/alerts.ts`, `src/app/fates.test.ts`, `src/app/main.ts`, `src/app/page.ts`, `src/app/pauses.test.ts`, `src/app/turning-points.test.ts`, `src/render/armies/every-city.test.ts`, `src/sim/battle-trial.ts`, `src/sim/fixture.ts`, `src/sim/new-game.ts`, `src/ui/Hud.svelte`, `src/ui/OverviewPanel.svelte`, `src/ui/describe.test.ts`.
