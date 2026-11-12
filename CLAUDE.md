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

### The tick contract

`tick(state, orders, world)` in `src/sim/tick.ts` plays one day. It never changes its input. It copies the state, applies the orders in the given order, then runs `SYSTEMS` in list order on the copy, and returns `{ state, rejected }`. Every order handler and every system receives the same `world`. Inside a tick, orders and systems change that copy in place. Outside the rules, a state is frozen once a tick returns it. The clock, the panels, and the renderer can keep and compare references to it without copying, and the renderer can draw between the previous and the current day.

### The world

`buildWorld(map)` in `src/sim/world/world.ts` builds the `World` once from the parsed map: `{ map, mesh, harbours }`. It is never saved and never changes during play. The page builds it at start and hands it to the clock, and tests take `fixtureWorld()` from `src/sim/fixture.ts`, which is built from the committed `data/map/map.json`. A rule that needs geometry reads the world, never a copy of the map in the state.

- `mesh` is a constrained Delaunay triangulation of the map extent, with the coastline and the map edge as walls, on the map's 0.1 km lattice so it is the same on every machine. Each triangle is land, sea, or off the map. Triangles that reach each other across open edges share a `component`.
- `findPath(mesh, from, to, surface)` in `src/sim/world/find-path.ts` returns the waypoints of a short path on `'land'` or `'sea'`, or undefined. `surfaceAt` and `connected` answer cheaper questions.
- `harbours` maps each port city to the sea point nearest it, where convoys leave and land.

### Movement

- `src/sim/march.ts` names the speeds `MARCH_KM_PER_DAY`, `CONVOY_KM_PER_DAY`, and `REFUGEE_KM_PER_DAY`. `startMarch` is the one way to set an army marching: it finds the land path, or returns why there is none. `nearestReachableCity` picks the nearest city of a faction by straight line among those a land route reaches.
- A marching army, a convoy, and a refugee column hold the `waypoints` still ahead. The path is found once, when the march starts, and `src/sim/systems/movement.ts` follows it. Movement runs first in the day.
- `moveArmy` replaces any march, `halt` stops one, and `embark` puts an army within 10 km of its faction's port city or that city's harbour aboard a convoy to another port. A convoy lands its armies idle at the destination harbour. `evacuate` gives a new refugee column its land path, and the column ends its walk at its destination with no waypoints, where `population` settles it.
- `npm run sim:paths` reruns the path-finding experiment, `npm run sim:movement` prints the route table and the tick times, and `npm run map:routes` draws routes on the map preview into `captures/movement/`.

### Adding a system

1. Write `src/sim/systems/<name>.ts`, which exports a `System`, `(state: GameState, world: World) => void`. A system that needs no geometry may leave out `world`. It changes the state it is given.
2. Add it to `SYSTEMS` in `src/sim/systems.ts`, at its place in the day: movement, battles, sieges, economy, population. `advanceDay` stays last.
3. Write `src/sim/systems/<name>.test.ts`, which starts from `buildFixture()` and ends each test with `expectConsistent(state)`.

The AI is not a system. It is a pure function from the state to a list of orders, and the clock adds those orders to the next tick.

A field that only your system needs goes into the kind's schema in `src/sim/state/`. A field that old saves lack needs a default with `v.optional(schema, default)`, or a raise of `SAVE_FORMAT` in `src/sim/save.ts`.

### Adding an order

1. Write `src/sim/orders/<name>.ts`. It exports the order's interface, with `kind` and `faction`, and a handler `(state, order, world) => string | undefined`. The handler checks everything before it writes anything. It returns a reason to reject, or `undefined` after it has applied the order. `ownedArmy` in `orders/owned-army.ts` does the ownership check.
2. Add the handler to `ORDER_HANDLERS` in `src/sim/orders/orders.ts`. The `Order` union derives from that table.

### New game

`newGame(map, { seed, player })` in `src/sim/new-game.ts` builds day 1 from the parsed map. The page fetches `data/map/map.json`, parses it with `parseMap`, and runs that state. `buildFixture()` stays the small state for unit tests.

- A province keeps the map's province id. Its city has the same id.
- A great power's faction id is its power id from the map, such as `rome`. Each independent city is its own minor faction, whose id is the city's province id. `kind` tells a `greatPower` from a `minor`.
- Armies and formations get their ids from `allocateId`.
- Starting populations and the starting army are the tables `STARTING_POPULATION` and `STARTING_FORMATIONS` in `new-game.ts`.

The map is static data outside the state. Outlines, neighbours, coastline, and rivers never go into the state. Rules code that needs geometry reads the `World`, which holds the map.

The map also holds terrain areas, peaks, and settlements. A settlement is a named place with no people and no rules. The rules that choose them sit at the top of `scripts/map/terrain.ts` and `scripts/map/settlements.ts`.

### Battles

- `areAtWar(state, a, b)` in `src/sim/wars.ts` says whether two factions are at war. Every rule that asks uses it. `state.wars` maps `warKey(a, b)` to the war. The key is the JSON pair of the two faction ids in ascending order, so a pair is stored once and a faction is never at war with itself. Only orders such as `declareWar` change it.
- `TROOPS` in `src/sim/troops.ts` holds every number a battle uses for a troop: category, attack, defence, discipline, and bonuses against categories. `formation.troop` accepts only its keys.
- To add a troop type, add one row to `TROOPS` and nothing else. Add a matchup for it to `scripts/sim-battles.ts`, run `npm run sim:battles`, and put the table in the pull request. Renaming or removing a troop breaks old saves and needs a raise of `SAVE_FORMAT`.
- `src/sim/systems/battles.ts` names `ENGAGEMENT_DISTANCE`, the stance effects, and the tuning numbers at its top. `retreatFromBattle` is the one way out of a battle, so a lane that pulls an army out calls it. It marches the army to its nearest city that a land route reaches, and the army surrenders when there is none.
- A beaten army marches home with every formation at morale 0. An army without an unbroken formation does not start or join a battle. Only idle armies regain morale.

### Cities

- Each faction holds `stores` of gold, food, and manpower. Gold and food go below zero when upkeep outruns them. While a store is below zero, each formation of the owner loses 1% of its men a day for each short store, and while food is short its cities shrink.
- `economy` in `src/sim/systems/economy.ts` musters finished recruits, adds each city's output to its owner, and takes army upkeep. Its rates sit at its top. `dailyBalances(state)` gives each faction's income less upkeep for budgeting.
- `population` in `src/sim/systems/population.ts` grows or shrinks each city, counts unrest down, and settles each refugee column that stands at its destination.
- `changeCityOwner(state, city, owner)` in `src/sim/cities.ts` is the one way a city changes owner. It starts `UNREST_DAYS` of unrest and drops the recruits the old owner was raising there. A city in unrest produces less and cannot recruit.
- The cost and training days of each troop are its `recruit` row in `TROOPS`. A recruit costs as much manpower as it has men.
- `npm run sim:economy` plays the new game for three years without orders and prints each great power's stores and balance.

### Sieges

- A city holds its `rank`, `walls`, `garrison`, and `foodDays`. `CITY_DEFENCES` in `src/sim/systems/sieges.ts` gives each rank's full values, which `newGame` sets. A siege's damage stays on the city, and a city not under siege recovers a `1 / RECOVERY_DAYS` share of each full value a day.
- `sieges` runs after `battles`. An idle army with an unbroken formation within `SIEGE_DISTANCE` of a city whose owner it is at war with besieges it. Later armies join the same siege. `siege.besiegers` is in order of arrival, and the first one's faction takes the city. An army leaves a siege by `moveArmy`, by being pulled into a battle, or when its owner is short of gold or food. `leaveSiege` and `removeArmy` in `src/sim/armies.ts` keep an army and its siege in agreement.
- Each day the food falls by one day. With no food left, hunger takes `HUNGER_SHARE` of the full garrison. The walls lose `WALL_WEAR_PER_THOUSAND_MEN` for each thousand besiegers. The city falls when its garrison is gone or, once its walls are down, on a `GIVE_UP_CHANCE` roll. The garrison never attacks.
- `storm` resolves at once in the order. `cityFalls` is the one way a siege takes a city. It calls `changeCityOwner` and opens the fate with `city.fellOn`.
- `sack` and `enslave` are open for `FATE_DAYS` while an army of the owner stands at the city. Their shares sit in `SACK` and `ENSLAVE` in `src/sim/cities.ts`. Captives go to the faction's own capital from the map while it holds it, and to its most populous other city after it is lost.
- `changeCityOwner` calls `defeatFaction(state, faction)` in `src/sim/defeat.ts` when the old owner holds no city left. It removes the faction's armies, convoys, and refugee columns, empties its stores, ends its wars, and sets `defeatedOn`. The record stays. Orders from a defeated faction, and wars declared on it, are refused.
- `npm run sim:sieges` plays the cases in `scripts/sim-sieges.ts` through `tick` and prints the tuning table.

### The clock and the panels

`src/app/clock.ts` turns real time into ticks and queues orders until the next tick. Panels never read the clock or the live state. They read `view.current` from `src/app/view.svelte.ts`, a `$state.raw` snapshot that is published about ten times a second. A click in a panel becomes an order through the clock.

## Code and tests

- TypeScript strict. No `any`.
- Write a comment only for a reason the code cannot show.
- Tests assert behaviour that a player or a caller can observe, not internals.

## Commands

| Command                                       | Does                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                 | Vite dev server                                                                                                 |
| `npm run build`                               | Production build to `dist/`                                                                                     |
| `npm run check`                               | svelte-check, the sim type check, ESLint, Prettier                                                              |
| `npm test`                                    | Vitest unit tests                                                                                               |
| `npm run e2e`                                 | Playwright tests against the built page, Chromium only                                                          |
| `npm run sim:battles [-- --log <row> <seed>]` | Play the battle matchups over many seeds and print the tuning table, or one battle day by day                   |
| `npm run sim:economy`                         | Play the new game for three years without orders and print each great power's economy at the end of each year   |
| `npm run sim:paths`                           | Compare grid and navigation-mesh path finding with the exact shortest path                                      |
| `npm run sim:movement`                        | Print long routes, their marching days and path times, and the tick time with every army marching               |
| `npm run map:routes`                          | Draw long routes on the map preview into `captures/movement/`                                                   |
| `npm run sim:sieges`                          | Play the siege, storm, relief, and fate cases and print the tuning table                                        |
| `npm run capture [-- <scenario>]`             | Build, then write screenshots, `clip.gif`, video, and trace to `captures/<scenario>/`                           |
| `npm run capture:publish`                     | Push the PNG and GIF files to the `pr-assets` branch and print Markdown for the pull request                    |
| `npm run capture:fetch`                       | Pull this branch's media from `pr-assets` into `captures/`, declare it as Nexus outputs, and print the Markdown |

To show a new view, add a scenario file to `scripts/capture/scenarios/`. It default-exports `defineScenario({ name, title, run })`. `run` gets the Playwright `page` and `shot(name, title)`. The whole run becomes the clip.

CI runs `npm run capture` on every pull request and publishes the media to `pr-assets` under the branch name. The run summary holds the Markdown. If your machine cannot install Chromium, push the branch, wait for CI, and run `npm run capture:fetch`. CI keeps the full video, the trace, and the Playwright report as run artifacts.

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
