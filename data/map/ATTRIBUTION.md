# Map data attribution

The map in `map.json` is built by `npm run build:map` from two free sources.

## Natural Earth

Land, coastlines, and rivers come from [Natural Earth](https://www.naturalearthdata.com/), the 1:50m `land` and `rivers_lake_centerlines` layers, read from the [`nvkelso/natural-earth-vector`](https://github.com/nvkelso/natural-earth-vector) repository at commit `ca96624a56bd078437bca8184e78163e5039ad19`.

Natural Earth is in the public domain. Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.

## Pleiades

The ancient city names and locations in `cities.json` come from [Pleiades](https://pleiades.stoa.org/). Each city's `pleiadesId` names the place record at `https://pleiades.stoa.org/places/<pleiadesId>`, and its longitude and latitude are that record's representative point.

Pleiades content is licensed under [Creative Commons Attribution 3.0 (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/). Cite it as: Pleiades: A Gazetteer of Past Places, the Pleiades contributors, https://pleiades.stoa.org/.
