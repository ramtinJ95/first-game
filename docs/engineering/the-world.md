### The world

`buildWorld(map)` in `src/sim/world/world.ts` builds the `World` once from the parsed map: `{ map, mesh, harbours }`. It is never saved and never changes during play. The page builds it at start and hands it to the clock, and tests take `fixtureWorld()` from `src/sim/fixture.ts`, which is built from the committed `data/map/map.json`. A rule that needs geometry reads the world, never a copy of the map in the state.

- `mesh` is a constrained Delaunay triangulation of the map extent, with the coastline and the map edge as walls, on the map's 0.1 km lattice so it is the same on every machine. Each triangle is land, sea, or off the map. Triangles that reach each other across open edges share a `component`.
- `findPath(mesh, from, to, surface)` in `src/sim/world/find-path.ts` returns the waypoints of a short path on `'land'` or `'sea'`, or undefined. It keeps one set of working arrays per mesh between calls, so a search allocates no scratch. `surfaceAt` and `connected` answer cheaper questions.
- `harbours` maps each port city to the sea point nearest it, where convoys leave and land.
