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
- `findPath(mesh, from, to, surface)` in `src/sim/world/find-path.ts` returns the waypoints of a short path on `'land'` or `'sea'`, or undefined. It keeps one set of working arrays per mesh between calls, so a search allocates no scratch. `surfaceAt` and `connected` answer cheaper questions.
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
- An army without an unbroken formation does not start or join a battle. Only idle armies regain morale: `MORALE_RECOVERY` a day in the field, and `REFUGE_RECOVERY` within `REFUGE_KM` of a city of their owner that no siege holds, so a beaten army that reached a safe city can face the enemy that follows it. `npm run sim:battles -- --chase` plays that chase.
- `removeArmy(state, army, cause)` in `src/sim/armies.ts` is the one way an army leaves the game, and it emits `armyDestroyed` with the cause.

### Cities

- Each faction holds `stores` of gold, food, and manpower. Gold and food go below zero when upkeep outruns them. While a store is below zero, each formation of the owner loses 1% of its men a day for each short store, and while food is short its cities shrink.
- Every man under arms costs gold and eats food each day (`UPKEEP_PER_MAN`). Every person of a city eats `FOOD_PER_PERSON`, in unrest or not, while unrest cuts what the city grows, so a freshly taken city costs food before it feeds its owner. A food deficit drains the store day by day before anyone deserts, so the player sees it coming in the balance.
- Food grows only up to `GRANARY_DAYS` of what the faction's people and men eat, and manpower only up to `MANPOWER_SHARE` of its people less its men under arms and in training, so a large army leaves few men to call up. `limitsOf(state)` gives both. A gain stops at the limit, and a store already above it, such as manpower from enslaving, is kept.
- `economy` in `src/sim/systems/economy.ts` musters finished recruits, adds each city's output to its owner, and takes army upkeep. Its rates sit at its top. `dailyBalances(state)` gives each faction's income less upkeep for budgeting.
- `population` in `src/sim/systems/population.ts` grows or shrinks each city, counts unrest down, and settles each refugee column that stands at its destination.
- `changeCityOwner(state, city, owner)` in `src/sim/cities.ts` is the one way a city changes owner. It starts `UNREST_DAYS` of unrest and drops the recruits the old owner was raising there. A city in unrest produces less and cannot recruit.
- The cost and training days of each troop are its `recruit` row in `TROOPS`. A recruit costs as much manpower as it has men.
- A besieged city musters every recruit it trains at once, at full strength, into an idle army of its owner at the city, which then fights the besiegers. `musterEarly` in `economy.ts` does it, each day of a siege and before a storm. A besieged city starts no new training, so no recruit is ever lost with a city. `earlyMusters(before, after)` in `src/sim/cities.ts` lists the cities that mustered early between two days, for an alert.
- `npm run sim:economy` plays the new game for three years without orders and prints each great power's stores and balance.

### Sieges

- A city holds its `rank`, `walls`, `garrison`, and `foodDays`. `CITY_DEFENCES` in `src/sim/systems/sieges.ts` gives each rank's full values, which `newGame` sets. A siege's damage stays on the city, and a city not under siege recovers a `1 / RECOVERY_DAYS` share of each full value a day.
- `sieges` runs after `battles`. An idle army with an unbroken formation within `SIEGE_DISTANCE` of a city whose owner it is at war with besieges it.
- A siege holds the blockade only while the besiegers' men are at least `BLOCKADE_ODDS` times the garrison. Below that, the food does not fall and the garrison sallies, killing `SALLY_SHARE` of its own number of besiegers a day, so a token force cannot starve a city. Later armies join the same siege. `siege.besiegers` is in order of arrival, and the first one's faction takes the city. An army leaves a siege by `moveArmy`, by being pulled into a battle, or when its owner is short of gold or food. `leaveSiege` and `removeArmy` in `src/sim/armies.ts` keep an army and its siege in agreement.
- Each day of a blockade the food falls by one day. With no food left, hunger takes `HUNGER_SHARE` of the full garrison. The walls lose `WALL_WEAR_PER_THOUSAND_MEN` for each thousand besiegers. The city falls when its garrison is gone or, once its walls are down, on a `GIVE_UP_CHANCE` roll, but never while an unbroken field army of its owner stands at it, and no storm is allowed then either.
- `storm` resolves at once in the order. It takes the city when the attack, with luck, is more than `STORM_ODDS` times the defence, which is the garrison raised by the walls. The stormers lose `STORM_KILL` of the defence in men either way, so storming intact walls costs a clearly stronger army a fifth to a third of its men and always fails for an army under 1.2 times the defence.
- `cityFalls` is the one way a siege takes a city. The winning besiegers leave `OCCUPATION_SHARE` of the city's full garrison from their own men as its new garrison, never more than half of them. It calls `changeCityOwner` and opens the fate with `city.fellOn`.
- `sack` and `enslave` are open for `FATE_DAYS` while an army of the owner stands at the city. Their shares sit in `SACK` and `ENSLAVE` in `src/sim/cities.ts`. Captives go to the faction's own capital from the map while it holds it, and to its most populous other city after it is lost. A sack sets `city.sackedOn`, and the city yields `SACK.poorOutput` of its gold for `SACK.poorDays` after it.
- Each fate is the best choice in its own situation. Occupy a city you mean to hold while your stores are sound: it out-earns a sack within a year and keeps the people who pay for it. Sack a city when gold is short now, to pay an army before it deserts or to recruit before an enemy arrives, or when you do not expect to hold it: the gold comes at once, and the city is poor for years. Enslave when manpower is short and gold is not, or to take people out of a city you may lose: a quarter of the captives become manpower at once, more than the occupied city raises in a year, and the rest move to your capital.
- `changeCityOwner` calls `defeatFaction(state, faction)` in `src/sim/defeat.ts` when the old owner holds no city left. It removes the faction's armies, convoys, and refugee columns, empties its stores, ends its wars, and sets `defeatedOn`. The record stays. Orders from a defeated faction, and wars declared on it, are refused.
- `npm run sim:sieges` plays the cases in `scripts/sim-sieges.ts` through `tick` and prints the tuning table.

### The clock and the panels

`src/app/clock.ts` turns real time into ticks and queues orders until the next tick. Panels never read the clock or the live state. They read `view.current` from `src/app/view.svelte.ts`, a `$state.raw` snapshot that is published about ten times a second. A click in a panel becomes an order through the clock.

### Faction AI

- `decideOrders(state, world, faction): Order[]` in `src/sim/ai/decide.ts` gives the orders one faction gives today. It takes a `DeepReadonly<GameState>`, never writes it, and draws no random numbers. Ties go to the lower id, so the same state gives the same orders. `decideAll(state, world, skip = [state.player])` gives the orders of every other faction that is not defeated, in faction id order.
- The clock calls it. `createClock` takes `decide(state)`, and each tick plays the player's queued orders and then `decide(state)` on the day being played. `src/app/main.ts` passes `(state) => decideAll(state, world)`.
- Every threshold is a named constant in `src/sim/ai/thresholds.ts`. Budget: `RESERVE_DAYS`, `MIN_BALANCE_SHARE`, `TROOP_MIX`. War: `WAR_ODDS`, `PEACE_WAR_ODDS`, `RIVAL_ODDS`, `RIVAL_PRESSURE_ODDS`, `WAR_DISTANCE_KM`, `WAR_REACH_KM`, `WAR_FRONT_KM`. Offence: `GARRISON_ODDS`, `ATTACK_ODDS`, `DEFENDER_KM`, `SEA_KM_FACTOR`, `STORM_MIN_CHANCE`, `STORM_MAX_LOSS`, `MARCH_MORALE`, `RALLY_WAIT_DAYS`. Defence: `RETREAT_ODDS`, `RELIEF_ODDS`, `RELIEF_KM`, `CAPITAL_GUARD_KM`. Fates: `ENSLAVE_BELOW_MANPOWER`. Minors: `MINOR_DEFICIT_DAYS`. The doc comment on each rule's function in `src/sim/ai` states the rule.
- A great power's day runs in this order: retreats, fates, storms, army movements (capital guard, relief, offence), one recruit, at most one declaration of war. A minor gives orders only at war. It recruits its cheapest troop, keeps its armies at its city once their morale is back to `MARCH_MORALE`, and retreats from a battle it is losing. A minor starts with stores for its cheapest troop and a year of that troop's upkeep (`STARTING_STORES` in `new-game.ts`), so at war it fields a formation that meets the first besieger.
- A power weighs a neighbour by that neighbour's armies on land within `WAR_FRONT_KM` of its nearest city plus that city's garrison, so a rival whose armies are away invites war. It holds back all of an enemy's armies for each war it fights. Against a rival great power it needs no more than `RIVAL_ODDS`. A power at war with no great power also presses a great-power neighbour that has kept to its homeland once its armies outweigh that neighbour's `RIVAL_PRESSURE_ODDS` times, so a player who stays at home is threatened. An army sets out for a city only with `GARRISON_ODDS` times its garrison, and leaves for the muster city a siege that cannot hold the blockade. The muster city is never a besieged one.
- No order joins two armies. A recruit joins the idle army at its city, so a power gathers by keeping an army at the muster city while recruits train, and sends separate armies at one target so they besiege and fight together.
- The AI caches each collection's sorted order, each faction's enemies, each army's strength, and the day's balances in `WeakMap`s keyed by the record objects. Never change a state's collections after the AI has read it.
- `npm run sim:ai [-- --seeds 20 --years 5]` plays the new game with every faction under the AI, then with Rome giving no orders, and prints the tables the thresholds were tuned on. `scripts/sim-ai-conquest.ts` adds the conquest and economy section by year and the five targets for a world that lasts, each marked met or not.
- `npm run sim:opening` plays the scripted Roman opening on 5 seeds: war on the nearest minor city on day 1 with the starting army. `npm run sim:recruit` has Rome raise every troop it can afford for two years and counts the days it waits on gold and on manpower.

### Renderer

- `createRenderer({ canvas, map, onPick })` in `src/render/renderer.ts` is the boundary. `src/app/main.ts` calls `draw({ previous, current, progress, selection, planned, previousSight, sight })` once per animation frame, and the renderer calls `onPick` with what a click points at. It reads the state and never writes it.
- `provinceAt(map, point)` in `src/render/pick.ts` finds the province under a map point, or nothing at sea. `pickAt` checks drawn figures and ships first, then army banners, and then calls it. Both are pure, so tests and any later rule use the same function.
- `src/render/camera.ts` holds the pan and zoom maths with no PixiJS import. `drawnArmies` in `src/render/markers.ts` places each banner between the previous and the current day by the clock's progress.
- The map is drawn as named layers, in this order from the bottom: `paper`, `sea` (fill, water lines, and the moving swell), `terrain` (the land's paper, desert ground, the green strips of desert rivers and the Nile delta clipped to land, wood ground, then the owners' washes, then fields, the regional texture, and three tiers of mountains, hills, trees, dunes, and stipple), `borders`, `riversAndCoast` (lakes with their own water lines, cached in a texture with the terrain, then rivers and the coast), `fog` (the shade and hatching over what the player cannot see), `grain` (the paper texture, printed over the drawing), `settlements` (`towns` with the town and village symbols, then `cities`, then `life` with smoke and boats, then `armies`, the figures), `markers`, `selection`, `labels` (city, peak, town, and village names, over everything so nothing covers a name). `LAYERS` in `renderer.ts` is that list. Add to a layer and keep the order.
- The terrain and the places live in `src/render/terrain/`. `marks.ts` places every drawing as plain data in km, a `Mark`, from the map's terrain areas, peaks, rivers, and settlements. `Land` holds the map's areas as rasters (`area-index.ts`): 4 km cells answer "inside?" fast, and a chamfer distance on 8 km cells answers "how deep?" and "how far from the edge?". `draw.ts` turns marks into PixiJS drawings, `terrain-layer.ts` builds them chunk by chunk, `places-layer.ts` places towns, villages, and names, and `life.ts` draws the smoke and boats.
- A drawing is seeded from its position. `scatter` in `scatter.ts` gives each cell of a fine lattice one candidate at a hashed spot with a hashed priority, and keeps it when no candidate of higher priority stands within their spacing. That rule reads only nearby cells, so the same map always draws the same way and chunks drawn apart meet with no seam. Each mark's own details come from `stream(seed)` in `random.ts`. Nothing in the renderer calls `Math.random`.
- The terrain is drawn into a texture 256 px larger than the view on each side and shown as one sprite, like the sea, so an idle frame costs one sprite. It draws again when the zoom changes, a pan passes the margin, or a chunk or tier fades. The wide tier is built when the renderer starts. Each other tier is cut into square chunks (`TIERS` in `marks.ts`). A chunk is placed and drawn the first time it comes into view, in slices of 12 ms on a timer between frames, so building runs at the speed of the main thread however slow the frames are. It fades in over 260 ms and is kept. The canvas carries `data-terrain="busy"` while chunks are missing or fading and `"ready"` after, which the capture waits for. Chunks out of view are hidden. Once the camera rests for 250 ms, the chunks around the view and those of the next finer tier are built ahead.
- `DETAIL` in `src/render/terrain/detail.ts` is the zoom rule, in px per km: the widest zoom of a 1280 px view is about 0.17 and the closest is 4. Desert and wood ground and lakes show at every zoom. Wide relief (ranges as ranges) shows to 0.66 and is gone by 0.92. Small tree marks in the woods and dunes and stipple in the deserts fade in from 0.26 to 0.4 and hand over to the middle tier with the wide relief. Middle relief with trees, dunes, stipple, and the named peaks fades in from 0.66 to 0.92 and out from 1.75 to 2.4. Close relief with hatched shading fades in from 1.75 to 2.4. Towns fade in from 0.75 to 1.05 and their names from 1.5 to 2. Villages fade in from 1.7 to 2.3 and their names from 2.7 to 3.3. Peak names fade in from 1.4 to 1.9. Fields, orchards, and tracks, and the smoke and boats, fade in from 2.2 to 3. A symbol or name that gains its place fades in over 220 ms, and one that loses it hides at once, so names never overlap.
- Mountains stand along ridges that run parallel to a range's outline, larger and denser deeper in the range and near a high peak, and leave a valley along each river. Forest trees stand in woods, clumps of overlapping round patches that are denser deeper in the forest. Woods whose ecoregion name is Mediterranean get cypresses, conifer woods get pointed trees, and the rest get round crowns. Sand seas get more dunes than stony deserts.
- A city always wins a place over a town, and a town over a village (`claimSymbols` in `places.ts`). Names go through `placeLabels` with `LABEL_PRIORITY`: a great power's capital, any city, a peak, a town, a village. A name tries eight spots round its symbol and keeps clear of the symbols, the banners of armies that stand still, and the battle markers. A great power's capital is always named: with no free spot it takes the first one that clears the names already placed.
- Smoke and boats run on `performance.now()`, not on the game clock, and draw only while the life band shows and only where the player sees, so a boat in the fog never passes for a hidden convoy.
- City symbols are drawn in code in `src/render/symbols.ts`, one per `city.rank`: a great power's capital, its other cities, and a minor city. They grow up to 2.5 times at the closest zoom, and the town and village symbols grow by the same factor (`symbolGrowth` in `src/render/camera.ts`), so a city stays larger than a town and a town than a village.
- The selection lives in `src/app/main.ts` and reaches panels as `view.current.selection`. It is not game state.
- Dropping a save file on the page loads it through `loadGame` and `clock.load`.

### Panels

- `src/ui/Hud.svelte` is the one root the page mounts. It lays out one grid over the map: the top bar, the overview under it, and the alerts at the bottom left, with the side column of the army, city, and battle panels at the right edge. Below 720 px the side column becomes a sheet at the bottom. The grid lets clicks through to the map, and only the panels take them. The clock, the stores, and the speed buttons are never covered. The refusal notice and the right-click menu float above it. Panels read `view.current` and act only through `Actions` in `src/ui/actions.ts`, which issue orders to the clock, select, and move the camera.
- A panel prop that holds the game state is named `game`, because Svelte reads `$state` next to a local named `state` as a store.
- A right click reaches `onCommand` in `src/app/main.ts`. The renderer names the city whose symbol or label the click is on or within 10 px of, as `Command.city`, and a symbol wins over a label. `planCommand` in `src/app/command.ts` then decides what the click does with the selected army: march to the city or the point, or, when the army stands at one of its ports and the click is on another port, a menu of the ways by sea and by land that the rules allow, with their days. It plays each order on a copy of the state through `executeOrder`, so what it offers and refuses is the rules' answer, and it refuses at once in words what the rules would refuse.
- An army the panels call "at" a city stands within `AT_CITY_KM` in `src/app/names.ts`, which is `SIEGE_DISTANCE`, so an army at an enemy city at war besieges it. The army panel says why an idle army at a foreign city does not besiege it.
- The clock keeps one waiting order per army and slot: a movement slot (`moveArmy`, `halt`, `embark`, `retreat`) and a stance slot. A new order replaces the one in its slot. Orders that name no army wait side by side. The top bar counts the armies with an order waiting.
- The battle panel shows the stance buttons and the retreat for each of the player's armies in the battle, through `StanceControls.svelte`, which the army panel shares. Each stance's line comes from `STANCE_EFFECTS`. The army and city panels list the other armies in sight at the same place.
- The top bar's Overview opens a list of the player's cities, armies, and wars (`overviewOf` in `src/ui/describe.ts`). A click on a row calls `actions.show`, which selects and centres the map. A city's rank line comes from `rankText`, which reads the starting owner from the map. Once the player is defeated, `overviewOf` gives only the day the realm fell, and the panel lists nothing.
- The renderer also takes `onCommand` for a right click and offers `focus(point)` for an alert's click. In the `markers` layer it draws the player's march and sea paths, the paths of orders still waiting, and a battle marker that `pickAt` selects after banners and before provinces. An army at sea is drawn at its convoy.
- `alertsOfDay(before, after, events)` in `src/app/alerts.ts` works out the alerts of a day, and the clock's `onDay` feeds it every tick with the tick's events. News of something that happened, such as a battle, a retreat, a lost army, desertion, or a declaration of war, comes from the events, so a battle that begins and ends inside one tick is still told. Only standing changes, such as a city's owner, a new siege, a mustered formation, an arrival, or an empty store, are read by comparing the two days. Alerts are page state, not game state. To add a kind, add it to `AlertKind` and one test to `alerts.test.ts`.
- `groupAlerts` folds the alerts of one kind with the same text at one place on one day into one line with a count. The page runs it after `alertsInSight`. A besieged city that musters its recruits early (`earlyMusters`) is one `musteredEarly` alert, to its owner and to the player besieging it, in place of the muster line of each formation it mustered early. A recruit that was due that day anyway keeps its own line.
- An alert covers the player's own armies and wars, and the battles, lost armies, and desertion of others that the player sees. The end of a battle gives its days and each side's losses. Desertion is told on the first day the owner is short. `alertsInSight` drops the rest. An alert selects a battle or an army only while it still exists.
- The city panel gives an own city's gold and harvest from `cityBalance` in `src/ui/describe.ts`, which runs `dailyBalances` on a realm of that city alone, so it restates no rate. `sackText`, `storeNote` (a store at its `limitsOf` limit, or the days a falling store lasts), and `weakSiegeText` (besiegers fewer than `BLOCKADE_ODDS` times the garrison, with the men still needed) are the other lines, each with its unit test. `weakSiegeText` says nothing while a besieger is out of sight.
- `reasonText` in `src/app/names.ts` turns a rule's refusal into words a player reads. The notice shows it for four seconds.
- The view times each refresh as the user-timing measure `panels`. The `panels` capture scenario reads it.
- `e2e/support.ts` builds saves for browser tests and capture scenarios, such as a battle or a fallen city. Tests drop them on the page and then play through the panels.

### Fog of war

- `sightOf(state, world, faction)` in `src/sim/sight.ts` says what a faction sees: the `armies`, `convoys`, `refugeeColumns`, and `battles` in sight, and `sees(point)`. A faction sees the land of its own provinces and within `SIGHT_KM` of its cities, its armies on land, and its convoys. It always sees its own things. A battle with any part in sight is seen with every army in it. The map, the cities, and their owners are always known.
- Sight is only what the player is shown. The rules and the AI never call it.
- A defeated player who watches on sees the whole map: `sightFor` in `src/app/main.ts` gives `sightOfAll` from `src/app/sighted.ts` once the player's `defeatedOn` is set. The top bar then says the realm has fallen in place of the stores, and the defeat's emptying of the stores raises no `storeRanOut` alert.
- `src/app/main.ts` computes the player's sight once per day's state and hands it to the renderer as `sight` and `previousSight`, and to panels as `view.current.sight`. The renderer draws and picks only armies and battles in sight. `seesPick` and `alertsInSight` in `src/app/sighted.ts` keep the selection, a panel's selection, and the alerts to what the player sees, so a selection that leaves sight is cleared and a click on an alert selects nothing hidden. A new panel or alert shows nothing outside `view.current.sight`.
- A wash is an owner's colour laid on the paper at `WASH_STRENGTH` (`washTint` in `src/render/palette.ts`), drawn as a multiply into the terrain's cached texture over the ground and under the relief, trees, and fields, so the paper takes the colour and every drawing keeps its ink and its lit and shaded sides. A blue multiplied straight onto the yellow paper turns the grey of the sea and the fog, which is why the tint is worked out from the colour. A change of owner calls `terrain.repaint()`.
- `src/render/fog.ts` draws the `fog` layer. The fog lifts once the player is defeated, who then sees the whole map. Its mask is drawn in km into a texture, so a pan only moves it. The land part is blurred when ownership changes, and each sight circle is a soft disc placed between the two days by the clock's progress.

### The frame round the game

- The page opens on the start screen with the clock paused. Choosing a power runs `newGame` as that power, paused, with the camera on its capital and the guide open. "Continue" loads the save written last. `?play=<power>` skips the start screen and the guide and opens a running game at the widest zoom.
- `outcomeOf(state, world, faction)` in `src/sim/outcome.ts` says whether a faction plays on, has won, or has lost. `VICTORY` holds the numbers: 40% of all provinces and 3 great capitals, its own among them. `standingOf` says how far the faction stands from them. The rule is a pure function of the state, and nothing in the rules acts on it.
- `turningPoints(before, after, world)` in `src/app/turning-points.ts` finds the days the page stops for: the loss, the win, and a city the player took whose fate is open. The clock's `onDay` feeds it. The page queues them as modals in `src/app/modals.ts`, one in front at a time, and stops the clock after the frame's days. Closing the last modal runs a game that a modal stopped. The win is announced once a game.
- `fateChoices` in `src/app/fates.ts` plays the sack and enslave orders on a copy of the day, so the fate prompt shows the rules' own numbers. A panel never restates a rule's number.
- `src/app/saves.ts` keeps two browser slots, `manual` and `auto`. The game writes `auto` on the first day of each 30-day month after the first, and never for a player who has lost. Each slot holds the text of `saveGame`, so loading one runs every check of `loadGame`, and a refused save shows the same notice as a dropped file.
- `src/ui/frame-actions.ts` is what the start screen, the guide, the defeat and victory screens, the fate prompt, and the Game menu may do. `GAME_NAME` there is a working title.

### Armies on the map

- The figures are SVG art built in code in `src/render/figures/`: `human.ts` is a man on foot, `horse.ts` a horse, and `things.ts` the ship, tents, fires, smoke, dust, arrows, javelins, ladders, stakes, the ox cart, and the standard. Each body part, shield, weapon, and horse part is a shape on a joint. `motions.ts` poses every kind in `KINDS`, the six troops of `TROOPS`, the general, the standard bearer, and two refugees, for each motion in `MOTIONS`: `stand`, `march`, `fight`, `run`, and `fall`. Walking, running, and the horse's walk and gallop are cycles over the joints, so they loop exactly. The weapon actions (thrust, cut, throw, loose, charge, lead) and the fall are keyframes. A paint list fills shapes with fixed colours or with a shade of the owner's colour, so one list paints every faction.
- `sheet.ts` packs every frame of every picture into a sheet, one copy per colour in `SHEET_COLOURS` (the five powers and the minors' grey). `src/render/armies/layer.ts` rasterises one sheet per size in `SHEET_SIZES` (14 to 120 device px per man's height) and per colour, lazily, once the zoom rests at a size and a sprite in view needs that colour, and draws each figure as a sprite of the smallest sheet at least as large as it is on screen. A figure is never enlarged and is shrunk by at most a third. The `figures` capture scenario shows the plate.
- `buildScene` in `src/render/armies/scene.ts` is a pure function from the two days, the clock's progress, the camera, the sight of both days, and two clocks to the sprites, wakes, siege works, and wall breaches of the frame. The renderer only copies it into PixiJS. It draws only the armies, convoys, and columns in `sight`, and a click picks only what it drew. Its unit tests start from `buildFixture()`.
- The figures draw in the `settlements` layer above the city symbols, so city names stay readable over them. A battle that would cover a city is drawn just clear of it, and its marker follows.
- Below `FIGURE_SCALE` (0.9 px per km) an army is its flag, as before. From it, a man stands 13 px tall, growing to 54 px at the closest zoom, and the flags give way to figures. A battle's marker then stands above its fighting.
- `figuresFor(men)` in `armies/count.ts` gives each formation one figure per `MEN_PER_FIGURE` (50) men, rounded up, to at most `FIGURE_CAP` (30). The army adds its standard bearer, and its general when `generalSkill` is above 0. A convoy shows one ship per 400 men, up to six, and a refugee column one walker per 1,000 people, 3 to 12, with an ox cart in every five.
- A block stands four files deep for foot, three for archers, skirmishers, and horse, and as many ranks long as its figures need, each figure a seeded step off its mark. At rest the blocks stand in two lanes behind the standard and the general. Beside a city they face it from its landward side and stand clear of its symbol and its name, on the side away from the name when there is land there. On the road they march in column along the path walked that day. In battle each side forms a line at the battle's place, the two lines facing each other across it, with the foot in the centre, the horse on the wings, and the archers and skirmishers behind. A besieging army takes its share of a ring round the city's landward side, with tents, fires, stakes, and a ditch.
- `formationDay` in `armies/losses.ts` turns a formation's two days into its falls and its rout. The figures the day loses fall among the front ranks early in the day and fade at its end, while the figures at the back step into their places. A formation whose morale reaches 0 turns and runs at a seeded time, and stands broken behind the line while its army fights on.
- The scene reads facts and draws nothing the rules do not hold. A camp is pitched when an army stood idle at the same place on both days. A storm shows on the day a siege's armies lost heavily and stayed at the siege or took the city: ladders from the first rank of the ring to the front wall with men climbing them, drawn over the ranks. A sacked city burns and smokes for `BURN_DAYS` (6) from `City.sackedOn`, dying down over the last two. The new owner's flag stands over a fallen city until its fate is chosen.
- Marching, fighting, rowing, and the flight of arrows follow the motion clock in `renderer.ts`. It runs with the game's days, faster at a higher speed, and stops while the game is paused. Men at ease, fires, smoke, dust, flags, and the bob of ships follow real time, so a paused map is still alive. The figures of a formation are out of step by a seeded phase and rate.
- `e2e/support.ts` builds the saves the capture scenarios `zooms`, `march`, `battle`, `siege`, `crossing`, `column`, and `speed` start from. `speed` prints the frame cost.

## Code and tests

- TypeScript strict. No `any`.
- Write a comment only for a reason the code cannot show.
- Tests assert behaviour that a player or a caller can observe, not internals.

A browser test or a capture scenario enters a game through `openGame(page, { query, power })` in `e2e/support.ts`, which opens `/?play=rome` and waits for the top bar. Only a test of the start screen opens `/` itself. Browser tests draw the test drawing, because a browser test checks behaviour and not the picture, and CI draws in software. `playwright.config.ts` stores `draw=test` in the page's local storage, and `?draw=test` does the same by hand. `TEST_DRAWING` in `src/render/draw-options.ts` lists what it leaves out: the paper grain, the moving swell, and antialiasing, and it draws at half resolution, so a page draws only when something changes and a frame costs a fifth of the full one in software. A page opened with `?draw=full` draws everything, as the game and `npm run capture` do, and the smoke test does so. A browser test waits for the state it needs, such as a day, a panel, or a text, and never for a fixed time or a count of days in a count of seconds. To know the day by which something happens, play the state forward with the rules in the test, as `firstDayWhen` in `e2e/fog-game.ts` does. `?frames` shows the frame interval and the time of each drawn frame, median and p95 over 5 s, and `node e2e/frame-bench.ts` prints that for each layer and switch (`hide=<layer>`, `swell=off`, `antialias=off`, `resolution=<n>`) after `npm run build`, at the zooms `--zooms widest,middle,closest` names, and for another checkout's build with `--root <dir>`. A frame starts only once the GPU has finished the one before: `draw` places a WebGL2 fence after each frame and draws nothing while it has not signalled, so a slow GPU never queues frames and a click or a screenshot waits one frame at most. A held frame sends the GPU nothing, not even a render into a texture, and keeps every change for the next frame. It only lays the cities out again, which is CPU work, so a click picks what the screen will show (`FramePacer` in `src/render/frame-pacer.ts`). `?frames` takes the `waitForGpu` path and places no fence, so the frame bench cannot show a skip. The capture's clip takes a frame only once the map has drawn, and skips a frame it cannot take in 5 s, because a screenshot asked for while a page loads can wait out its whole timeout and hold up the scenario's own shots behind it.

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
| `npm run sim:opening`                         | Play the scripted Roman opening against the nearest minor city on 5 seeds                                                                                   |
| `npm run sim:recruit`                         | Have Rome raise every troop it can afford and count what it waits for                                                                                       |
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
