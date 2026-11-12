# Game design

Status on 2026-11-12: the design below is agreed and the foundation is being built. The game has no name yet.

This document records what we decided, why, and what we set aside. Change it when a decision changes.

## The game in one paragraph

A single-player grand strategy game that runs in the browser. You rule one of five classical powers on a real map that reaches from Iberia to the Iranian plateau. You grow cities, raise armies, trade, make treaties, and take land. Everything happens in real time on the one map, battles included, so the difficulty comes from watching several fronts at once. You march armies to meet a threat, and you move people out of a city before it falls.

The game is original. Civilization 5, Knights of Honor 2, and Rome: Total War 2 are reference points for mechanics and period. The game copies no names, art, or maps from them.

## Game design decisions

### Setting

- **Map extent.** The Mediterranean world, from Iberia to Persia and from Britain to the Nile, extended east across the Iranian plateau. Persia has a full homeland and does not sit on the map edge. We set aside a whole Old World map and a full globe because they multiply content and dilute the period.
- **Era.** A loosely historical sandbox. The map, cities, and cultures are real, but there is no exact start date. Each great power starts as a comparable regional state in its homeland. We set aside the historical starts of 500 BC, 280 BC, and 60 BC because each one makes Persia either a subject people, a lone superpower, or one half of a two-sided contest.
- **Great powers.** Rome, Carthage, Macedon, Egypt, and Persia. Independent minor cities fill the land between them. Persia is a first-class faction and is playable from the first build.
- **Faction differences.** All factions share the same buildings, economy, and basic troop types. Each great power adds a signature of two or three unique units, one unique building, and one standing bonus. Persia, for example, could field cataphracts and horse archers and build royal roads that speed movement.

### Map and time

- **Provinces with free-moving armies.** The map is divided into provinces, and each province is anchored by one city. When the city changes owner, the province changes owner. Armies are markers that march continuously across the terrain. You can see a threat approach, intercept it, or leave ahead of it. We set aside a hex grid and province-to-province movement because both make interception coarse.
- **Clock.** The clock runs continuously with speed settings. You can pause at any time and give orders while paused.
- **Fog of war.** You see enemy markers only within sight range of your land, your armies, and your allies. The evacuation decision depends on how early you see an army.

### War

- **Armies are lists of formations.** A formation is one body of one troop type, such as spearmen or light cavalry. Battles resolve formation by formation.
- **Battles.** When hostile armies meet, they lock together on the map and the battle runs over game days. Losses and morale depend on numbers, troop types, terrain, the general, and fortifications. You steer a battle with an army-wide stance, with reinforcements, and with retreat. The stances are hold the line, all-out assault, and skirmish and withdraw.
- **Room for direct control later.** A stance is one order applied to all formations in an army. Direct command of single formations on the map can come later by exposing the formations, without new battle rules.
- **Sieges.** A walled city must be besieged. A siege runs over game days and wears down walls, garrison, and food. A relief army can break the siege from outside. The attacker can storm the walls early at a cost in men.
- **Fate of a captured city.** The winner chooses to occupy the city, to sack it for gold at the cost of population and buildings, or to enslave part of the population and take them home.
- **Tuning target.** Conquest must feel rewarding without being trivial. A siege lasts weeks of game time, not years. Storming is a sound choice for a clearly stronger army. An occupied city pays off soon after it falls. Playtests set the numbers.
- **Generals.** A general is a skill number on an army for now.
- **The sea.** An army embarks at a port city and crosses the water as a transport convoy. A convoy is slow and fights badly. War fleets come in a later stage. Fleets fight sea battles, capture convoys, blockade ports, and protect sea trade.

### Country

- **Population.** Each city has a population number. Population drives taxes, food use, production, and recruits. Population groups by class and culture are out of scope until we ask for them.
- **Evacuation.** You order part of a city's population to leave. The people form a refugee column, which is a slow marker that walks to a city you choose. Enemy armies can catch the column. People who left cannot be sacked or enslaved.
- **Economy.** A country runs on gold, food, and manpower. Provinces hold trade goods such as iron, horses, timber, grain, and luxuries. Some troops and buildings need a specific good. Each city builds from a short list of buildings. Armies cost gold and food as upkeep. There are no supply lines yet.
- **Trade.** Trade runs along routes between cities. Caravans and ships move on the map, earn gold for both ends, and can be raided or blockaded.
- **Unrest.** A freshly conquered city has a period of unrest.
- **Diplomacy.** Factions are at war or at peace. They can sign a trade agreement, a non-aggression pact, an alliance, and a tribute or vassal treaty. A peace deal can transfer provinces or gold. Each AI faction holds an opinion of you that moves with your actions.
- **Progression.** A tree of 20 to 30 advances in three branches, which are military, economy, and statecraft. You research one advance at a time with research income from cities and buildings. All advances stay inside the classical era.
- **Victory.** You win when you hold a set share of all provinces, including your own capital and several great capitals such as Rome, Carthage, Alexandria, and Persepolis. The game announces the win and lets you continue. You lose when your last city falls.

### Look

A flat, top-down map in the style of an old atlas. The base is parchment-toned with soft shaded relief. Coasts and rivers are inked lines. Each faction's land carries a translucent colour wash. Cities, armies, refugee columns, caravans, and ships are icons with banners.

The map shows mountains, hills, forests, deserts, lakes, towns, and villages as ink drawings that gain detail as you zoom in, from whole ranges and woods on the full map to single peaks, trees, and the fields around each village up close. At a close zoom a little ambient movement, such as smoke over the cities and boats off the ports, makes the world feel inhabited.

### Out of scope until asked for

Multiplayer, religion, culture, characters and dynasties, spies, detailed population groups, and supply lines.

## Stages

Each stage ends in a build you can play.

1. **The real-time war on the map.** The whole map at coarse detail, with 60 to 80 provinces and the five powers under a basic AI. Cities have population and produce gold, food, and manpower. You recruit armies, march them, cross the sea as convoys, fight battles with stances, besiege or storm cities, choose a captured city's fate, and evacuate refugee columns. Pause, speed control, and fog of war work. This stage comes first because it tests the riskiest part of the idea, which is whether managing several fronts in real time on this map is fun.
2. **Economy.** Buildings, trade goods, and trade routes on the map.
3. **Diplomacy.** The treaty set and AI opinions.
4. **War fleets.** Sea battles, blockades, and trade protection.
5. **Progression.** The advancement tree.
6. **Faction signatures.** Unique units, buildings, and bonuses.
7. **Victory.** The dominance condition.

Later work splits the coarse provinces into finer ones.

## Technology

| Layer | Choice | Reason |
| --- | --- | --- |
| Platform | TypeScript in the browser, built with Vite | A strategy game is mostly interface, and HTML and CSS are the strongest toolkit for it. A change reloads in under a second. An agent can test the rules from the command line and drive a real browser to check a feature. |
| Map renderer | PixiJS 8 | PixiJS draws with the graphics card, so pan and zoom are a camera transform. Soft fog edges and glows are filters. |
| Interface | Svelte 5, without SvelteKit | Svelte updates single values on the page when they change, which suits state that changes every tick. A one-screen game needs no routing or server rendering. |
| Rules | Plain typed data and pure functions | See the next section. |
| Tests | Vitest for rules, Playwright for the running game | Rules are tested without a browser. Features are checked in a real browser. |
| Saves | Browser storage, with export to and import from a file | The whole game state is plain data, so a save is that data written as JSON. |
| Hosting | None yet | The build output is a static folder that any static host can serve. |

### Alternatives we set aside

- **Godot, or Rust compiled to WebAssembly.** Godot centres on a visual editor that an agent cannot operate. Rust has slow compile cycles and weak toolkits for a panel-heavy interface. Neither speed advantage is needed at a scale of a few thousand objects.
- **Plain Canvas 2D, Phaser, MapLibre, and deck.gl.** Canvas 2D draws in software, and soft fog is awkward in it. Phaser brings a game loop that competes with the simulation clock. MapLibre and deck.gl are built for web maps with a tiled Mercator camera.
- **React and SolidJS.** React re-renders by component, which needs extra discipline with per-tick state. SolidJS has the smallest ecosystem of the three.
- **A Go server with a browser client.** A server makes sense for multiplayer or for a persistent world. For a pausable single-player game, a server means that every session needs a running process, a network protocol between the two halves, and two languages. The game stays browser-only. The rules sit behind a boundary that a server could host later.

## Architecture

### The rules are a pure module

The game state is one tree of plain typed records. The tree has one collection for each kind of thing: factions, provinces, cities, armies, formations, convoys, refugee columns, battles, and sieges. Each record has a typed id, and records refer to each other by id.

The rules advance the state one game day at a time. One tick takes the current state and the orders issued since the last tick, and produces the next state. Inside a tick, the orders apply first, and then the systems run in a fixed order: movement, battles, sieges, economy, and population.

The AI is not a system. The AI is a pure function from the state to a list of orders, and the clock adds those orders to the next tick.

Four rules keep the module testable and movable:

- The rules never import the renderer or the interface.
- The player and the AI change the state only through the same list of orders. The AI cannot reach into the state.
- All randomness comes from a seeded generator that is part of the state. The same state and the same orders always give the same result.
- The state holds no functions, classes, or references to the page, so the state can be saved as JSON and loaded back.

### The clock drives the rules

A fixed-step loop on the main thread runs the ticks. A speed setting changes how many game days pass in one real second. Pause stops the ticks. Orders issued while paused wait in the list and apply on the next tick. The renderer draws between ticks and interpolates marker positions so that movement looks smooth.

### The renderer and the interface only read

The PixiJS renderer reads the state and draws it. The renderer sits behind a small boundary so that it can be replaced without a change to the rules.

The Svelte panels do not hold the live state. The live state stays plain data outside Svelte's reactivity. The panels receive read-only views of the state at a fixed refresh rate of about ten times a second. A click in a panel or on the map becomes an order.

### A build script makes the map

A Node script builds the map data file from a curated list of cities and from free geographic data. The script projects the coordinates with a regional projection, seeds one province for each city, clips the provinces to the land, and writes the province shapes, the neighbours of each province, and the city positions. It also writes terrain areas (mountains, hills, desert, forest, and lake), named peaks, and towns and villages. The game loads the output file. Nobody draws provinces by hand, and a change to the city list rebuilds the map.

Free movement uses a navigation mesh: a constrained Delaunay triangulation of the land and the sea, built from the map when the game starts, on which armies, convoys, and refugee columns find their paths. Terrain does not change movement speed yet.

### Data sources

| Source | Use | Licence |
| --- | --- | --- |
| Natural Earth | Land, coastlines, rivers, lakes, desert outlines, and the names of ranges and peaks | Public domain |
| ETOPO1 (NOAA) | The outlines of mountains and hills | Public domain |
| RESOLVE Ecoregions 2017 | Forest outlines | CC BY 4.0, attribution required |
| Pleiades | The names and locations of ancient cities, towns, and villages | CC BY 3.0, attribution required |
| Itiner-e | Roman roads. Not used yet, because the build cannot reach its hosts | CC BY 4.0, attribution required |

The game does not use AWMC geodata (ODbL) or historical-basemaps (GPL-3.0), because both carry share-alike terms. Modern coastlines and rivers differ from the ancient ones in places such as river deltas. The first builds accept that difference.

## How we build it

One coordinating agent plans the work and checks the results. Nexus threads do the work in parallel, one pull request per thread. The coordinator writes each brief, orders the queue, reads each diff, and plays each stage build. Each brief names the evidence that proves the work is done, such as a test command and its expected output.

Parallel threads need a shared base, so the work starts in sequence.

**Foundation, in order:**

1. The project skeleton: Vite, Svelte 5, TypeScript in strict mode, Vitest, Playwright, and a check that runs on every pull request.
2. The state types, the order list, the tick loop, the seeded generator, and save and load.
3. The map build script and the map data file.

**One trial unit.** One lane goes from brief to merged pull request before the others start. A flaw in the brief format then costs one thread.

**Lanes for stage one, in parallel after the foundation:**

| Lane | Contents | Starts after |
| --- | --- | --- |
| Renderer | Map, colour washes, markers, camera, fog | Foundation 2 and 3 |
| Movement | Pathfinding on land, convoys at sea | Foundation 2 and 3 |
| Battles | Formations, stances, morale, retreat | Foundation 2 |
| Cities | Population, production, recruitment, upkeep, unrest, refugee columns | Foundation 2 |
| Sieges | Siege, storm, relief, and the fate of a captured city | Battles |
| Panels | Time controls, city panel, army panel, alerts | Foundation 2 and Renderer |
| AI | Faction AI that plays through the order list | Movement, Battles, Cities, Sieges |

Each rules lane owns one system file and its tests. The state has one file for each kind of record. A lane that needs a new field adds the field to that kind's file in its own pull request.

After the lanes merge, the coordinator plays the stage-one build and tunes the numbers against the tuning target.
