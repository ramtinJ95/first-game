### Adding a system

1. Write `src/sim/systems/<name>.ts`, which exports a `System`, `(state: GameState, world: World) => void`. A system that needs no geometry may leave out `world`. It changes the state it is given.
2. Add it to `SYSTEMS` in `src/sim/systems.ts`, at its place in the day: homecoming, movement, battles, sieges, economy, construction, population. `advanceDay` stays last.
3. Write `src/sim/systems/<name>.test.ts`, which starts from `buildFixture()` and ends each test with `expectConsistent(state)`.

The AI is not a system. It is a pure function from the state to a list of orders, and the clock adds those orders to the next tick.

A field that only your system needs goes into the kind's schema in `src/sim/state/`. A field that old saves lack needs a default with `v.optional(schema, default)`, or a new immutable JSON file in `src/sim/save-changes/` describing what it adds. See [independent changes](independent-changes.md).
