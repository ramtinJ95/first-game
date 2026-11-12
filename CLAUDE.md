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

`tick(state, orders, world)` in `src/sim/tick.ts` plays one day. It never changes its input. It copies the state, applies the orders in the given order, then runs `SYSTEMS` in list order on the copy, and returns `{ state, rejected, events }`. Every order handler and every system receives the same `world`. Inside a tick, orders and systems change that copy in place. Outside the rules, a state is frozen once a tick returns it. The clock, the panels, and the renderer can keep and compare references to it without copying, and the renderer can draw between the previous and the current day.

### The day's events

`tick` also returns `events`, the `DayEvent`s of the day in the order they happened: a battle began or ended, an army retreated, was destroyed, or lost men to desertion, and a war was declared. `src/sim/events.ts` defines them. An event carries what a reader needs, such as owners, a position, and men, because the records it names may be gone by the end of the day.

- Rules code calls `emit(state, event)` where the change happens. The events are kept beside the tick's copy of the state, never in it, so they are not saved and a loaded game has none. `emit` outside a recorded day drops the event, so tests that call an order handler directly need nothing.
- A script that plays the tick's steps itself wraps them in `recordEvents(state, run)`, as `scripts/sim-ai.ts` does.
- A new kind of news is a new variant of `DayEvent`, emitted at the one place the change happens.

### The world

`buildWorld(map)` in `src/sim/world/world.ts` builds the `World` once from the parsed map: `{ map, mesh, harbours }`. It is never saved and never changes during play. The page builds it at start and hands it to the clock, and tests take `fixtureWorld()` from `src/sim/fixture.ts`, which is built from the committed `data/map/map.json`. A rule that needs geometry reads the world, never a copy of the map in the state.

- `mesh` is a constrained Delaunay triangulation of the map extent, with the coastline and the map edge as walls, on the map's 0.1 km lattice so it is the same on every machine. Each triangle is land, sea, or off the map. Triangles that reach each other across open edges share a `component`.
- `findPath(mesh, from, to, surface)` in `src/sim/world/find-path.ts` returns the waypoints of a short path on `'land'` or `'sea'`, or undefined. `surfaceAt` and `connected` answer cheaper questions.
- `harbours` maps each port city to the sea point nearest it, where convoys leave and land.

### Movement

- `src/sim/march.ts` names the speeds `MARCH_KM_PER_DAY`, `CONVOY_KM_PER_DAY`, and `REFUGEE_KM_PER_DAY`. `startMarch` is the one way to set an army marching: it finds the land path, or returns why there is none.
- A marching army, a convoy, and a refugee column hold the `waypoints` still ahead. The path is found once, when the march starts, and `src/sim/systems/movement.ts` follows it. Movement runs first in the day.
- A retreating army walks its path like a marching one, but takes no order and fights no battle until it arrives and stands idle.
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

Known faults in the source data. Check them before you draw or label terrain.

- Natural Earth's English name for the whole Apennines is "Appennino Ligure", which is only their northern end.
- Natural Earth lists IJsselmeer, a modern polder lake, and Syvash, a lagoon of the Sea of Azov, as lakes. The build drops both by name.

### Battles

- `areAtWar(state, a, b)` in `src/sim/wars.ts` says whether two factions are at war. Every rule that asks uses it. `state.wars` maps `warKey(a, b)` to the war. The key is the JSON pair of the two faction ids in ascending order, so a pair is stored once and a faction is never at war with itself. Only orders such as `declareWar` change it.
- `TROOPS` in `src/sim/troops.ts` holds every number a battle uses for a troop: category, attack, defence, discipline, and bonuses against categories. `formation.troop` accepts only its keys.
- To add a troop type, add one row to `TROOPS` and nothing else. Add a matchup for it to `scripts/sim-battles.ts`, run `npm run sim:battles`, and put the table in the pull request. Renaming or removing a troop breaks old saves and needs a raise of `SAVE_FORMAT`.
- `src/sim/systems/battles.ts` names `ENGAGEMENT_DISTANCE`, the stance effects, and the tuning numbers at its top. `npm run sim:battles` prints the length of each matchup. Two armies of about the same strength fight 6 to 12 days, a side outnumbered two to one holds at least 3, and a formation loses at most `MAX_DAILY_LOSS` of its men a day or `REMNANT_MEN`, so only a remnant dies on its first day.
- `GENERAL_EFFECT` is what one point of general's skill adds to blows and morale, so the best general against none does not make up for a fifth more men. The AI's strength estimate reads the same constant. Every new army, at the start or raised by recruits, has a general of `STARTING_GENERAL_SKILL`.
- `retreatFromBattle(state, world, army, ordered)` is the one way out of a battle, so a lane that pulls an army out calls it. Every formation leaves at morale 0. Ordered out, each loses `RETREAT_LOSS` of its men. Beaten, each loses what the pursuit cuts down: `PURSUIT_BASE` plus `PURSUIT_PER_RIDER` for each unbroken enemy horseman per man of the army, up to `PURSUIT_MAX`.
- The army retreats to the nearest city of its owner that a land route reaches, that is not besieged, that has no enemy army within `ENGAGEMENT_DISTANCE`, and that lies at least `SAFE_KM` from every army it fought. With no such city it goes `FIELD_RETREAT_KM` into the field, as directly away from those armies as the land allows. With neither it surrenders. It is `retreating` until it arrives, so it fights no battle on the way. Once it stands idle, an enemy that marched after it can fight it again.
- When a battle ends, an army that holds the field takes up the march it was on when the battle took it (`inBattle.march`), so an order to march survives a battle on the way. An army that was idle or besieging stands where it fought.
- An army without an unbroken formation does not start or join a battle. Only idle armies regain morale.
- `removeArmy(state, army, cause)` in `src/sim/armies.ts` is the one way an army leaves the game, and it emits `armyDestroyed` with the cause.

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

### Faction AI

- `decideOrders(state, world, faction): Order[]` in `src/sim/ai/decide.ts` gives the orders one faction gives today. It takes a `DeepReadonly<GameState>`, never writes it, and draws no random numbers. Ties go to the lower id, so the same state gives the same orders. `decideAll(state, world, skip = [state.player])` gives the orders of every other faction that is not defeated, in faction id order.
- The clock calls it. `createClock` takes `decide(state)`, and each tick plays the player's queued orders and then `decide(state)` on the day being played. `src/app/main.ts` passes `(state) => decideAll(state, world)`.
- Every threshold is a named constant in `src/sim/ai/thresholds.ts`. Budget: `RESERVE_DAYS`, `MIN_BALANCE_SHARE`, `TROOP_MIX`. War: `WAR_ODDS`, `PEACE_WAR_ODDS`, `WAR_DISTANCE_KM`, `WAR_REACH_KM`. Offence: `ATTACK_ODDS`, `DEFENDER_KM`, `SEA_KM_FACTOR`, `STORM_MIN_CHANCE`, `STORM_MAX_LOSS`, `MARCH_MORALE`, `RALLY_WAIT_DAYS`. Defence: `RETREAT_ODDS`, `RELIEF_ODDS`, `RELIEF_KM`, `CAPITAL_GUARD_KM`. Fates: `ENSLAVE_BELOW_MANPOWER`. Minors: `MINOR_DEFICIT_DAYS`. The doc comment on each rule's function in `src/sim/ai` states the rule.
- A great power's day runs in this order: retreats, fates, storms, army movements (capital guard, relief, offence), one recruit, at most one declaration of war. A minor gives orders only at war. It recruits its cheapest troop, keeps its armies at its city once their morale is back to `MARCH_MORALE`, and retreats from a battle it is losing.
- No order joins two armies. A recruit joins the idle army at its city, so a power gathers by keeping an army at the muster city while recruits train, and sends separate armies at one target so they besiege and fight together.
- The AI caches each collection's sorted order, each faction's enemies, each army's strength, and the day's balances in `WeakMap`s keyed by the record objects. Never change a state's collections after the AI has read it.
- `npm run sim:ai [-- --seeds 20 --years 5]` plays the new game with every faction under the AI, then with Rome giving no orders, and prints the tables the thresholds were tuned on.

### Renderer

- `createRenderer({ canvas, map, onPick })` in `src/render/renderer.ts` is the boundary. `src/app/main.ts` calls `draw({ previous, current, progress, selection, planned, previousSight, sight })` once per animation frame, and the renderer calls `onPick` with what a click points at. It reads the state and never writes it.
- `provinceAt(map, point)` in `src/render/pick.ts` finds the province under a map point, or nothing at sea. `pickAt` checks army banners first and then calls it. Both are pure, so tests and any later rule use the same function.
- `src/render/camera.ts` holds the pan and zoom maths with no PixiJS import. `drawnArmies` in `src/render/markers.ts` places each banner between the previous and the current day by the clock's progress.
- The map is drawn as named layers, in this order from the bottom: `paper`, `sea` (fill, water lines, and the moving swell), `land`, `terrain` (desert ground, the green strips of desert rivers and the Nile delta clipped to land, wood ground, then fields, the regional texture, and three tiers of mountains, hills, trees, dunes, and stipple), `washes` (owner colours at 42 % alpha with multiply blending, so the paper takes the colour and the terrain's ink stays as dark as on unowned land), `borders`, `riversAndCoast` (lakes with their own water lines, cached in a texture with the terrain, then rivers and the coast), `fog` (the shade and hatching over what the player cannot see), `grain` (the paper texture, printed over the drawing), `settlements` (`towns` with the town and village symbols, then `cities`, then `life` with smoke and boats), `labels` (city, peak, town, and village names), `markers`, `selection`. `LAYERS` in `renderer.ts` is that list. Add to a layer and keep the order.
- The terrain and the places live in `src/render/terrain/`. `marks.ts` places every drawing as plain data in km, a `Mark`, from the map's terrain areas, peaks, rivers, and settlements. `Land` holds the map's areas as rasters (`area-index.ts`): 4 km cells answer "inside?" fast, and a chamfer distance on 8 km cells answers "how deep?" and "how far from the edge?". `draw.ts` turns marks into PixiJS drawings, `terrain-layer.ts` builds them chunk by chunk, `places-layer.ts` places towns, villages, and names, and `life.ts` draws the smoke and boats.
- A drawing is seeded from its position. `scatter` in `scatter.ts` gives each cell of a fine lattice one candidate at a hashed spot with a hashed priority, and keeps it when no candidate of higher priority stands within their spacing. That rule reads only nearby cells, so the same map always draws the same way and chunks drawn apart meet with no seam. Each mark's own details come from `stream(seed)` in `random.ts`. Nothing in the renderer calls `Math.random`.
- The terrain is drawn into a texture 256 px larger than the view on each side and shown as one sprite, like the sea, so an idle frame costs one sprite. It draws again when the zoom changes, a pan passes the margin, or a chunk or tier fades. The wide tier is built when the renderer starts. Each other tier is cut into square chunks (`TIERS` in `marks.ts`). A chunk is placed and drawn the first time it comes into view, for up to 8 ms of a frame and always at least one chunk, fades in over 260 ms, and is kept. The canvas carries `data-terrain="busy"` while chunks are missing or fading and `"ready"` after, which the capture waits for. Chunks out of view are hidden. Once the camera rests for 250 ms, the chunks around the view and those of the next finer tier are built ahead.
- `DETAIL` in `src/render/terrain/detail.ts` is the zoom rule, in px per km: the widest zoom of a 1280 px view is about 0.17 and the closest is 4. Desert and wood ground and lakes show at every zoom. Wide relief (ranges as ranges) shows to 0.66 and is gone by 0.92. Small tree marks in the woods and dunes and stipple in the deserts fade in from 0.26 to 0.4 and hand over to the middle tier with the wide relief. Middle relief with trees, dunes, stipple, and the named peaks fades in from 0.66 to 0.92 and out from 1.75 to 2.4. Close relief with hatched shading fades in from 1.75 to 2.4. Towns fade in from 0.75 to 1.05 and their names from 1.5 to 2. Villages fade in from 1.7 to 2.3 and their names from 2.7 to 3.3. Peak names fade in from 1.4 to 1.9. Fields, orchards, and tracks, and the smoke and boats, fade in from 2.2 to 3. A symbol or name that gains its place fades in over 220 ms, and one that loses it hides at once, so names never overlap.
- Mountains stand along ridges that run parallel to a range's outline, larger and denser deeper in the range and near a high peak, and leave a valley along each river. Forest trees stand in woods, clumps of overlapping round patches that are denser deeper in the forest. Woods whose ecoregion name is Mediterranean get cypresses, conifer woods get pointed trees, and the rest get round crowns. Sand seas get more dunes than stony deserts.
- A city always wins a place over a town, and a town over a village (`claimSymbols` in `places.ts`). Names go through `placeLabels` with `LABEL_PRIORITY`: a great power's capital, any city, a peak, a town, a village.
- Smoke and boats run on `performance.now()`, not on the game clock, and draw only while the life band shows and only where the player sees, so a boat in the fog never passes for a hidden convoy.
- City symbols are drawn in code in `src/render/symbols.ts`, one per `city.rank`: a great power's capital, its other cities, and a minor city. They grow up to 1.8 times at the closest zoom.
- The selection lives in `src/app/main.ts` and reaches panels as `view.current.selection`. It is not game state.
- Dropping a save file on the page loads it through `loadGame` and `clock.load`.

### Panels

- `src/ui/Hud.svelte` is the one root the page mounts. It lays out one grid over the map: the top bar, the overview under it, and the alerts at the bottom left, with the side column of the army, city, and battle panels at the right edge. Below 720 px the side column becomes a sheet at the bottom. The grid lets clicks through to the map, and only the panels take them. The clock, the stores, and the speed buttons are never covered. The refusal notice and the right-click menu float above it. Panels read `view.current` and act only through `Actions` in `src/ui/actions.ts`, which issue orders to the clock, select, and move the camera.
- A panel prop that holds the game state is named `game`, because Svelte reads `$state` next to a local named `state` as a store.
- A right click reaches `onCommand` in `src/app/main.ts`. The renderer names the city whose symbol or label the click is on or within 10 px of, as `Command.city`, and a symbol wins over a label. `planCommand` in `src/app/command.ts` then decides what the click does with the selected army: march to the city or the point, or, when the army stands at one of its ports and the click is on another port, a menu of the ways by sea and by land that the rules allow, with their days. It plays each order on a copy of the state through `executeOrder`, so what it offers and refuses is the rules' answer, and it refuses at once in words what the rules would refuse.
- An army the panels call "at" a city stands within `AT_CITY_KM` in `src/app/names.ts`, which is `SIEGE_DISTANCE`, so an army at an enemy city at war besieges it. The army panel says why an idle army at a foreign city does not besiege it.
- The clock keeps one waiting order per army and slot: a movement slot (`moveArmy`, `halt`, `embark`, `retreat`) and a stance slot. A new order replaces the one in its slot. Orders that name no army wait side by side. The top bar counts the armies with an order waiting.
- The battle panel shows the stance buttons and the retreat for each of the player's armies in the battle, through `StanceControls.svelte`, which the army panel shares. Each stance's line comes from `STANCE_EFFECTS`. The army and city panels list the other armies in sight at the same place.
- The top bar's Overview opens a list of the player's cities, armies, and wars (`overviewOf` in `src/ui/describe.ts`). A click on a row calls `actions.show`, which selects and centres the map. A city's rank line comes from `rankText`, which reads the starting owner from the map.
- The renderer also takes `onCommand` for a right click and offers `focus(point)` for an alert's click. In the `markers` layer it draws the player's march and sea paths, the paths of orders still waiting, and a battle marker that `pickAt` selects after banners and before provinces. An army at sea is drawn at its convoy.
- `alertsOfDay(before, after, events)` in `src/app/alerts.ts` works out the alerts of a day, and the clock's `onDay` feeds it every tick with the tick's events. News of something that happened, such as a battle, a retreat, a lost army, desertion, or a declaration of war, comes from the events, so a battle that begins and ends inside one tick is still told. Only standing changes, such as a city's owner, a new siege, a mustered formation, an arrival, or an empty store, are read by comparing the two days. Alerts are page state, not game state. To add a kind, add it to `AlertKind` and one test to `alerts.test.ts`.
- An alert covers the player's own armies and wars, and the battles, lost armies, and desertion of others that the player sees. The end of a battle gives its days and each side's losses. Desertion is told on the first day the owner is short. `alertsInSight` drops the rest. An alert selects a battle or an army only while it still exists.
- `reasonText` in `src/app/names.ts` turns a rule's refusal into words a player reads. The notice shows it for four seconds.
- The view times each refresh as the user-timing measure `panels`. The `panels` capture scenario reads it.
- `e2e/support.ts` builds saves for browser tests and capture scenarios, such as a battle or a fallen city. Tests drop them on the page and then play through the panels.

### Fog of war

- `sightOf(state, world, faction)` in `src/sim/sight.ts` says what a faction sees: the `armies`, `convoys`, `refugeeColumns`, and `battles` in sight, and `sees(point)`. A faction sees the land of its own provinces and within `SIGHT_KM` of its cities, its armies on land, and its convoys. It always sees its own things. A battle with any part in sight is seen with every army in it. The map, the cities, and their owners are always known.
- Sight is only what the player is shown. The rules and the AI never call it.
- `src/app/main.ts` computes the player's sight once per day's state and hands it to the renderer as `sight` and `previousSight`, and to panels as `view.current.sight`. The renderer draws and picks only armies and battles in sight. `seesPick` and `alertsInSight` in `src/app/sighted.ts` keep the selection, a panel's selection, and the alerts to what the player sees, so a selection that leaves sight is cleared and a click on an alert selects nothing hidden. A new panel or alert shows nothing outside `view.current.sight`.
- `src/render/fog.ts` draws the `fog` layer. Its mask is drawn in km into a texture, so a pan only moves it. The land part is blurred when ownership changes, and each sight circle is a soft disc placed between the two days by the clock's progress.

## Code and tests

- TypeScript strict. No `any`.
- Write a comment only for a reason the code cannot show.
- Tests assert behaviour that a player or a caller can observe, not internals.

Browser tests draw the test drawing, because a browser test checks behaviour and not the picture, and CI draws in software. `playwright.config.ts` stores `draw=test` in the page's local storage, and `?draw=test` does the same by hand. `TEST_DRAWING` in `src/render/draw-options.ts` lists what it leaves out: the paper grain, the moving swell, and antialiasing, and it draws at half resolution, so a page draws only when something changes and a frame costs a fifth of the full one in software. A page opened with `?draw=full` draws everything, as the game and `npm run capture` do, and the smoke test does so. A browser test waits for the state it needs, such as a day, a panel, or a text, and never for a fixed time or a count of days in a count of seconds. To know the day by which something happens, play the state forward with the rules in the test, as `firstDayWhen` in `e2e/fog-game.ts` does. `?frames` shows the frame interval and the time of each drawn frame, median and p95 over 5 s, and `node e2e/frame-bench.ts` prints that for each layer and switch (`hide=<layer>`, `swell=off`, `antialias=off`, `resolution=<n>`) after `npm run build`.

## Commands

| Command                                       | Does                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                 | Vite dev server                                                                                                                                             |
| `npm run build`                               | Production build to `dist/`                                                                                                                                 |
| `npm run check`                               | svelte-check, the sim type check, ESLint, Prettier                                                                                                          |
| `npm test`                                    | Vitest unit tests                                                                                                                                           |
| `npm run e2e`                                 | Playwright tests against the built page, Chromium only                                                                                                      |
| `npm run sim:battles [-- --log <row> <seed>]` | Play the battle matchups over many seeds and print the tuning table, or one battle day by day                                                               |
| `npm run sim:economy`                         | Play the new game for three years without orders and print each great power's economy at the end of each year                                               |
| `npm run sim:paths`                           | Compare grid and navigation-mesh path finding with the exact shortest path                                                                                  |
| `npm run sim:movement`                        | Print long routes, their marching days and path times, and the tick time with every army marching                                                           |
| `npm run map:routes`                          | Draw long routes on the map preview into `captures/movement/`                                                                                               |
| `npm run sim:sieges`                          | Play the siege, storm, relief, and fate cases and print the tuning table                                                                                    |
| `npm run sim:ai [-- --seeds <n> --years <n>]` | Play the new game under the AI, with every faction and with a passive Rome, and print the tuning tables, battle lengths, and beaten armies alive 30 days on |
| `npm run capture [-- <scenario>]`             | Build, then write screenshots, `clip.gif`, video, and trace to `captures/<scenario>/`                                                                       |
| `npm run capture:publish`                     | Push the PNG and GIF files to the `pr-assets` branch and print Markdown for the pull request                                                                |
| `npm run capture:fetch`                       | Pull this branch's media from `pr-assets` into `captures/`, declare it as Nexus outputs, and print the Markdown                                             |

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
