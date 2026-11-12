# Map data attribution

The map in `map.json` is built by `npm run build:map` from the free sources below. `scripts/map/sources.ts` pins each one by commit and sha256.

## Natural Earth

Land, coastlines, and rivers come from [Natural Earth](https://www.naturalearthdata.com/), the 1:50m `land` and `rivers_lake_centerlines` layers. Mountain range and desert names, desert outlines, peaks, and lakes come from the 1:10m `geography_regions_polys`, `geography_regions_elevation_points`, and `lakes` layers. All five are read from the [`nvkelso/natural-earth-vector`](https://github.com/nvkelso/natural-earth-vector) repository at commit `ca96624a56bd078437bca8184e78163e5039ad19`.

Natural Earth is in the public domain. Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.

## ETOPO1 elevation

The outlines of mountains and hills come from ETOPO1, NOAA National Centers for Environmental Information, which is in the public domain. Cite it as: Amante, C. and B.W. Eakins, 2009. ETOPO1 1 Arc-Minute Global Relief Model. NOAA Technical Memorandum NESDIS NGDC-24, doi:10.7289/V5C8276M.

The build reads `etopo10_ice_g_i2.bin`, the ice-surface model median-filtered to 10 arc-minutes, from the [`g2e/etopo10`](https://github.com/g2e/etopo10) repository at commit `983b031cd3e01ff0dd1a7933a4213efc718da662`. That repository is MIT-licensed, © 2017 Garrett Euler.

## RESOLVE Ecoregions 2017

Forest outlines and names come from RESOLVE Ecoregions 2017, licensed under [Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Cite it as: Dinerstein, E. et al. (2017). An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm. BioScience 67(6): 534–545. doi:10.1093/biosci/bix014.

The build reads the per-ecoregion files under `teow/` in the [`CatalogueOfLife/col-gazetteers`](https://github.com/CatalogueOfLife/col-gazetteers) repository at commit `d96828acebaa8576fd5f9c1b06bc44dd2955adbe`. The build changes the data. It keeps only the temperate broadleaf, temperate conifer, and boreal forest ecoregions without the forest steppes, projects and simplifies their outlines, trims the overlaps that simplifying leaves between neighbours, and clips them to the land inside the map.

## Pleiades

The ancient city names and locations in `cities.json` come from [Pleiades](https://pleiades.stoa.org/). Each city's `pleiadesId` names the place record at `https://pleiades.stoa.org/places/<pleiadesId>`, and its longitude and latitude are that record's representative point.

The towns and villages in `map.json` come from the Pleiades GIS package, the `places`, `location_points`, `places_place_types`, `connections`, and `time_periods` tables, read from the [`isawnyu/pleiades.datasets`](https://github.com/isawnyu/pleiades.datasets) repository at commit `ff9639804f66e521b63d2208a00b60602ec787cf`. Each settlement's `pleiadesId` names its place record in the same way.

Pleiades content is licensed under [Creative Commons Attribution 3.0 (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/). Cite it as: Pleiades: A Gazetteer of Past Places, the Pleiades contributors, https://pleiades.stoa.org/.
