### New game

`newGame(map, { seed, player })` in `src/sim/new-game.ts` builds day 1 from the parsed map. The page fetches `data/map/map.json`, parses it with `parseMap`, and runs that state. `buildFixture()` stays the small state for unit tests.

- A province keeps the map's province id. Its city has the same id.
- A great power's faction id is its power id from the map, such as `rome`. Each independent city is its own minor faction, whose id is the city's province id. `kind` tells a `greatPower` from a `minor`.
- Armies and formations get their ids from `allocateId`.
- Starting populations and the starting army are the tables `STARTING_POPULATION` and `STARTING_FORMATIONS` in `new-game.ts`.
- Each minor is drawn from the seed as one of `MINOR_KINDS` in `new-game.ts` (a standing army, rich and walled, poor and open, leagued), with `FRONTIER_SHARES` instead of each kind's `share` beyond `FRONTIER_KM` of every great capital. A kind sets the city's population and `fortified`, the faction's stores, and its starting army. Leagued minors pair with the nearest unpaired leagued minor within `LEAGUE_KM` through `Faction.league`, which `findBrokenReferences` checks both ways. A minor declares war only to join a war on its partner, and marches to its partner's besieged city while its own is not besieged.
