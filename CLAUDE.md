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
- Records that point at each other must agree: an army and its formations, a battle or a siege and its armies, a convoy and its armies, a province and its city. `findBrokenReferences` in `src/sim/references.ts` lists every disagreement. Loading rejects a save that has any. Every system test and every order test ends with `expectConsistent(state)`, which throws with that list. In development builds and in tests, the clock runs the same check after every tick and throws with the day. Production builds leave it out.
- New records get their ids from `allocateId` in `src/sim/ids.ts`, which counts in the state.
- Randomness comes from `nextRandom` and `nextInt` in `src/sim/rng.ts`, which advance `state.rng`. Never call `Math.random`.
- `buildFixture()` in `src/sim/fixture.ts` returns a fresh tiny valid state, and `FIXTURE` names its ids. Use it in tests.

## Area guides

Read the guide for the area you change. Add area-specific detail there, not here.

- [The tick contract](docs/engineering/the-tick-contract.md)
- [The day's events](docs/engineering/the-day-s-events.md)
- [The world](docs/engineering/the-world.md)
- [Movement](docs/engineering/movement.md)
- [Adding a system](docs/engineering/adding-a-system.md)
- [Adding an order](docs/engineering/adding-an-order.md)
- [New game](docs/engineering/new-game.md)
- [Map data](docs/engineering/map-data.md)
- [Battles](docs/engineering/battles.md)
- [Peace](docs/engineering/peace.md)
- [Cities](docs/engineering/cities.md)
- [Buildings](docs/engineering/buildings.md)
- [Sieges](docs/engineering/sieges.md)
- [The clock and the panels](docs/engineering/the-clock-and-the-panels.md)
- [Faction AI](docs/engineering/faction-ai.md)
- [Renderer](docs/engineering/renderer.md)
- [Panels](docs/engineering/panels.md)
- [World news](docs/engineering/world-news.md)
- [Fog of war](docs/engineering/fog-of-war.md)
- [The frame round the game](docs/engineering/the-frame-round-the-game.md)
- [Armies on the map](docs/engineering/armies-on-the-map.md)

## Code and tests

- TypeScript strict. No `any`.
- Write a comment only for a reason the code cannot show.
- Tests assert behaviour that a player or a caller can observe, not internals.

Read [browser tests and frame measurements](docs/engineering/browser-tests.md) before changing a browser test or capture.

## Commands

See [commands and capture scenarios](docs/engineering/commands.md). For file-based extension points, read [independent changes](docs/engineering/independent-changes.md).

## Git

- One branch per unit. Open a pull request to `main`. Never push to `main`. Squash merge only.
- Use Conventional Commit titles, such as `feat(sim): add movement system`.
- Add no `Co-Authored-By` trailers and no generated-by footers.
- Never commit captured media. `capture:publish` stores it on the `pr-assets` branch.
- Nexus runs `.nexus/check` (install, `npm run check`, `npm test`, `npm run build`) in a fresh pylon before it lands a pull request. A pull request that changes `.nexus/check` or `.nexus/setup` gets a hold that the owner must waive, so leave both files alone unless your brief says otherwise. Nexus runs `.nexus/resume` on every wake and after it checks out a commit on a template, where it reinstalls the packages when `package-lock.json` differs from the one last installed, and a pull request that changes it gets the same hold.

## Pull request description

Use these sections in this order: Why, What changed, Scope, Blast Radius, Verification.

- Verification lists each command you ran and its real outcome.
- A pull request that changes anything visible embeds the screenshots and at least one clip from `npm run capture`. It names its Nexus preview URL. `npm run capture` and `npm run capture:fetch` declare the media as Nexus outputs.
- A pull request that changes only rules shows the test output.

## Scope

Stay inside the paths the brief names. Note unrelated problems in the pull request and do not fix them there.
