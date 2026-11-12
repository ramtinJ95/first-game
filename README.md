# first-game

An original single-player grand strategy game for the browser, set in the classical era. You rule one of five powers, Rome, Carthage, Macedon, Egypt, or Persia, on a real map from Iberia to the Iranian plateau. Battles, sieges, and evacuations all happen in pausable real time on that one map. The rules are pure TypeScript, PixiJS draws the map, and Svelte draws the panels. [`docs/design.md`](docs/design.md) holds the agreed design.

## Run it

You need Node 26. The version is pinned in `.nvmrc`.

```sh
npm ci
npm run dev
```

Open the URL that Vite prints.

Other commands:

```sh
npm run check     # svelte-check, sim type check, ESLint, Prettier
npm test          # unit tests
npm run build     # production build in dist/
npx playwright install chromium
npm run e2e       # browser tests against the built page
npm run capture   # screenshots and a GIF clip in captures/
```

`CLAUDE.md` lists the conventions for contributors.

## Map data

`npm run build:map` builds `data/map/map.json` from the city list in `data/map/cities.json` and from pinned copies of free geographic data. Natural Earth (public domain) gives the land, coast, rivers, lakes, peaks, and the names of mountain ranges and deserts. ETOPO1 elevation (NOAA, public domain) outlines the mountains and hills. RESOLVE Ecoregions 2017 (CC BY 4.0) outlines the forests. Pleiades (CC BY 3.0) gives the cities, towns, and villages. [`data/map/ATTRIBUTION.md`](data/map/ATTRIBUTION.md) gives the credits and licences.
