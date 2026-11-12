# Working in this repository

Read `docs/design.md` before any work. It is the agreed design. When a task conflicts with it, stop and say so in the pull request.

## Layers

- `src/sim/` holds the game rules in pure TypeScript. It imports nothing from `src/render`, `src/ui`, `src/app`, `pixi.js`, or `svelte`, and it uses no DOM globals. `npm run check` enforces both rules through ESLint and `tsconfig.sim.json`.
- `src/render/` holds the PixiJS map renderer. It reads the state and never writes it.
- `src/ui/` holds the Svelte panels.
- `src/app/` wires the page together.
- `scripts/` holds build-time and tooling scripts. Node runs them as `.ts` files directly.
- Unit tests sit beside the code as `*.test.ts`. Playwright tests sit in `e2e/`.

## Rules code

- The game state is plain data that survives a round trip through JSON. It holds no classes and no functions.
- Ids are branded types.
- All randomness comes from the seeded generator in the state.
- The player and the AI change the state only through orders.
- Each system is one file under `src/sim/systems/`, with its tests beside it.

## The rules module

- `src/sim/state/` holds one file per kind of record. Each file defines a valibot schema and derives the type from it, so the schema is the one source of the shape and also the check that loading a save runs. `game-state.ts` gathers the collections. Each collection maps an id to its record.
- An army's `activity` is a tagged union (idle, marching, in battle, besieging, embarked). Add a variant instead of an optional field.
- Records that point at each other must agree. `findBrokenReferences` in `src/sim/references.ts` lists every disagreement. Loading rejects a save that has any. Assert an empty list in the tests of a system that creates or links records.
- New records get their ids from `allocateId` in `src/sim/ids.ts`, which counts in the state.
- Randomness comes from `nextRandom` and `nextInt` in `src/sim/rng.ts`, which advance `state.rng`. Never call `Math.random`.
- `buildFixture()` in `src/sim/fixture.ts` returns a fresh tiny valid state, and `FIXTURE` names its ids. Use it in tests.

### The tick contract

`tick(state, orders)` in `src/sim/tick.ts` plays one day. It never changes its input. It copies the state, applies the orders in the given order, then runs `SYSTEMS` in list order on the copy, and returns `{ state, rejected }`. Inside a tick, orders and systems change that copy in place. Outside the rules, a state is frozen once a tick returns it. The clock, the panels, and the renderer can keep and compare references to it without copying, and the renderer can draw between the previous and the current day.

### Adding a system

1. Write `src/sim/systems/<name>.ts`, which exports a `System`, `(state: GameState) => void`. It changes the state it is given.
2. Add it to `SYSTEMS` in `src/sim/systems.ts`, at its place in the day: movement, battles, sieges, economy, population. `advanceDay` stays last.
3. Write `src/sim/systems/<name>.test.ts`, which starts from `buildFixture()`.

A field that only your system needs goes into the kind's schema in `src/sim/state/`. A field that old saves lack needs a default with `v.optional(schema, default)`, or a raise of `SAVE_FORMAT` in `src/sim/save.ts`.

### Adding an order

1. Write `src/sim/orders/<name>.ts`. It exports the order's interface, with `kind` and `faction`, and a handler `(state, order) => string | undefined`. The handler checks everything before it writes anything. It returns a reason to reject, or `undefined` after it has applied the order. `ownedArmy` in `orders/owned-army.ts` does the ownership check.
2. Add the handler to `ORDER_HANDLERS` in `src/sim/orders/orders.ts`. The `Order` union derives from that table.

### The clock and the panels

`src/app/clock.ts` turns real time into ticks and queues orders until the next tick. Panels never read the clock or the live state. They read `view.current` from `src/app/view.svelte.ts`, a `$state.raw` snapshot that is published about ten times a second. A click in a panel becomes an order through the clock.

## Code and tests

- TypeScript strict. No `any`.
- Write a comment only for a reason the code cannot show.
- Tests assert behaviour that a player or a caller can observe, not internals.

## Commands

| Command                           | Does                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server                                                                                                 |
| `npm run build`                   | Production build to `dist/`                                                                                     |
| `npm run check`                   | svelte-check, the sim type check, ESLint, Prettier                                                              |
| `npm test`                        | Vitest unit tests                                                                                               |
| `npm run e2e`                     | Playwright tests against the built page, Chromium only                                                          |
| `npm run capture [-- <scenario>]` | Build, then write screenshots, `clip.gif`, video, and trace to `captures/<scenario>/`                           |
| `npm run capture:publish`         | Push the PNG and GIF files to the `pr-assets` branch and print Markdown for the pull request                    |
| `npm run capture:fetch`           | Pull this branch's media from `pr-assets` into `captures/`, declare it as Nexus outputs, and print the Markdown |

To show a new view, add a scenario file to `scripts/capture/scenarios/`. It default-exports `defineScenario({ name, title, run })`. `run` gets the Playwright `page` and `shot(name, title)`. The whole run becomes the clip.

CI runs `npm run capture` on every pull request and publishes the media to `pr-assets` under the branch name. The run summary holds the Markdown. If your machine cannot install Chromium, push the branch, wait for CI, and run `npm run capture:fetch`. CI keeps the full video, the trace, and the Playwright report as run artifacts.

## Git

- One branch per unit. Open a pull request to `main`. Never push to `main`. Squash merge only.
- Use Conventional Commit titles, such as `feat(sim): add movement system`.
- Add no `Co-Authored-By` trailers and no generated-by footers.
- Never commit captured media. `capture:publish` stores it on the `pr-assets` branch.
- Nexus runs `.nexus/check` (install, `npm run check`, `npm test`, `npm run build`) in a fresh pylon before it lands a pull request. A pull request that changes `.nexus/check` or `.nexus/setup` gets a hold that the owner must waive, so leave both files alone unless your brief says otherwise.

## Pull request description

Use these sections in this order: Why, What changed, Scope, Blast Radius, Verification.

- Verification lists each command you ran and its real outcome.
- A pull request that changes anything visible embeds the screenshots and at least one clip from `npm run capture`. It names its Nexus preview URL. `npm run capture` and `npm run capture:fetch` declare the media as Nexus outputs.
- A pull request that changes only rules shows the test output.

## Scope

Stay inside the paths the brief names. Note unrelated problems in the pull request and do not fix them there.
