### Map data

The map is static data outside the state. Outlines, neighbours, coastline, and rivers never go into the state. Rules code that needs geometry reads the `World`, which holds the map.

Province borders follow the land. `partition` in `scripts/map/provinces.ts` first cuts each land among its cities by their Voronoi cells, and `recut` in `scripts/map/borders.ts` then re-cuts every border between two provinces on one land on a 2 km raster. Each province's claim spreads from the land it keeps, a cell goes to the claim that reaches it at the lowest cost, and the cost tolls each river crossed (`RIVER_CROSSING_KM`) and each metre climbed (`CLIMB_KM_PER_M`), so a border near a river runs along it and one near a range follows its watershed. A seeded meander for each pair of provinces (`MEANDER_KM`), a seeded noise in the pace, and a small seeded tremor of the traced line (`TREMOR_KM`) make the rest an irregular hand-drawn line.

- Land changes province only within `MAX_BORDER_MOVE_KM` (50) of a straight border, only within `REACH_SHARE` of a small province's size, and only to the province across its nearest straight border. A city keeps `CITY_KEEP_KM` round it. Land with no city joins a province as the straight cut has it, so islands keep their owners. The build writes what moved per province, and `npm run build:map -- --borders` lists every province.
- The raster's borders are traced once into chains between the points where three provinces meet, so two provinces share every point of their border. Where a border crosses or comes within 0.15 km of the coast, the point goes into both lines (`stitchCoast`), and `conform` puts back any vertex a clip drops, so every edge of an outline is an edge of one other province, of the coastline, or of the map's edge, and a path that hugs the coast never leaves the provinces.
- The re-cut moves about 3 % of the land and changed a few neighbour pairs where four provinces nearly meet. The game reads neither province areas nor the neighbour lists. The outlines decide what a faction sees and which province a point is in.

The map also holds terrain areas, peaks, and settlements. A settlement is a named place with no people and no rules. The rules that choose them sit at the top of `scripts/map/terrain.ts` and `scripts/map/settlements.ts`.

- A place is written by the name it bore in antiquity, read from Pleiades' own name records (`usualName` in `settlements.ts`): its title when one of its names in an ancient language, or dated in the game's periods and out of use by `MODERN_FROM`, has the same letters, or else the first such name, Latin before Greek. A place with no ancient name, such as one Pleiades knows only by a modern village or a "tepe", is not a candidate, so its room goes to a place with one. A test over the built map rejects any name with an editor's mark, accents, or a modern word such as "Tell" or "Col.".
- Natural Earth names the peaks in modern languages, so a peak's name is drawn only from `PEAK_NAMES` in `src/render/terrain/places.ts`, its classical name, and a peak not in it is drawn with none.

Known faults in the source data. Check them before you draw or label terrain.

- Natural Earth's English name for the whole Apennines is "Appennino Ligure", which is only their northern end.
- Natural Earth lists IJsselmeer, a modern polder lake, and Syvash, a lagoon of the Sea of Azov, as lakes. The build drops both by name.
