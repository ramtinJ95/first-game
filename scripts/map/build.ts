import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { POWERS, TERRAIN_KINDS, type GameMap, type StartingOwner } from '../../src/sim/map.ts';
import { buildMap, MAP_FILE, serializeMap, type MapBuild } from './build-map.ts';
import { readCities } from './cities.ts';
import { area } from './geometry.ts';
import { writePreview } from './preview.ts';
import * as settlementRules from './settlements.ts';
import { loadSources } from './sources.ts';
import * as terrainRules from './terrain.ts';

const { values } = parseArgs({ options: { preview: { type: 'boolean', default: false } } });

const started = performance.now();
const cities = readCities();
const sources = await loadSources();
const loaded = performance.now();
const build = buildMap(cities, sources);
const built = performance.now();
const text = serializeMap(build.map);
writeFileSync(MAP_FILE, text);

report(build);
console.log(
  `\nwrote ${relative(process.cwd(), MAP_FILE)}: ${(Buffer.byteLength(text) / 1024).toFixed(0)} KiB, ` +
    `build ${((built - loaded) / 1000).toFixed(1)} s, total ${((performance.now() - started) / 1000).toFixed(1)} s`,
);
if (values.preview) console.log(`wrote ${relative(process.cwd(), await writePreview(build.map))}`);

function report({ map, moves, merges, joins }: MapBuild): void {
  const km2 = (value: number) => `${Math.round(value).toLocaleString('en')} km²`;
  console.log(
    `${map.provinces.length} provinces, ${map.coastline.length} coastlines, ${map.rivers.length} river lines`,
  );

  console.log('\nstarting owners:');
  const owners: StartingOwner[] = [...POWERS, 'independent'];
  for (const owner of owners) {
    const held = map.provinces.filter((province) => province.owner === owner);
    const total = held.reduce((sum, province) => sum + province.area, 0);
    console.log(
      `  ${owner.padEnd(12)} ${String(held.length).padStart(3)} provinces ${km2(total).padStart(16)}`,
    );
  }

  const islands = map.provinces
    .filter((province) => province.island)
    .map((province) => province.id);
  console.log(`\nislands (${islands.length}): ${islands.join(', ')}`);

  console.log(`\ncities moved onto land (${moves.length}):`);
  for (const move of moves) console.log(`  ${move.id.padEnd(22)} ${move.distance.toFixed(1)} km`);

  console.log(`\norphan pieces merged (${merges.length}):`);
  for (const merge of [...merges].sort((a, b) => b.area - a.area)) {
    console.log(
      `  ${km2(merge.area).padStart(14)} cut from ${merge.from} -> ${merge.to} (border ${merge.border.toFixed(0)} km)`,
    );
  }

  const joined = joins.reduce((sum, join) => sum + join.area, 0);
  console.log(
    `\nland without a city joined to the nearest province (${joins.length}, ${km2(joined)}), largest:`,
  );
  for (const join of [...joins].sort((a, b) => b.area - a.area).slice(0, 10)) {
    const [lon, lat] = join.at;
    const where = `${Math.abs(lat).toFixed(1)}${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(1)}${lon < 0 ? 'W' : 'E'}`;
    console.log(
      `  ${km2(join.area).padStart(14)} near ${where} -> ${join.to} (${join.distance.toFixed(0)} km away)`,
    );
  }

  console.log('\narea / median neighbour area, top 10:');
  for (const { id, area, ratio } of areaRatios(map).slice(0, 10)) {
    console.log(`  ${id.padEnd(22)} ${km2(area).padStart(14)} ${ratio.toFixed(2)}x`);
  }

  console.log(`\nterrain rules: ${rules(terrainRules)}`);
  for (const kind of TERRAIN_KINDS) {
    const areas = map.terrain.filter((terrain) => terrain.kind === kind);
    const polygons = areas.reduce((sum, terrain) => sum + terrain.outline.length, 0);
    const total = areas.reduce((sum, terrain) => sum + area(terrain.outline), 0);
    console.log(
      `  ${kind.padEnd(10)} ${String(areas.length).padStart(3)} areas ${String(polygons).padStart(4)} polygons ${km2(total).padStart(16)}`,
    );
  }
  const lakes = map.terrain.filter((terrain) => terrain.kind === 'lake');
  console.log(
    `${map.peaks.length} peaks, ${lakes.reduce((sum, lake) => sum + lake.outline.length, 0)} lakes`,
  );

  console.log(`\nsettlement rules: ${rules(settlementRules)}`);
  const towns = map.settlements.filter((settlement) => settlement.rank === 'town').length;
  console.log(
    `${towns} towns, ${map.settlements.length - towns} villages, ${map.settlements.length} settlements`,
  );
  const held = map.provinces
    .map((province) => ({
      id: province.id,
      count: map.settlements.filter((settlement) => settlement.province === province.id).length,
      quota: settlementRules.quotaOf(province.area),
    }))
    .sort((a, b) => a.count - b.count);
  const fewest = held[0]?.count;
  const most = held[held.length - 1]?.count;
  const holding = (count: number | undefined) =>
    held.filter((province) => province.count === count).map((province) => province.id);
  console.log(`fewest in a province: ${fewest} (${holding(fewest).join(', ')})`);
  console.log(`most in a province: ${most} (${holding(most).join(', ')})`);
  const short = held.filter((province) => province.count < province.quota);
  console.log(`provinces short of their quota: ${short.length} of ${held.length}`);
}

/** The module's upper-case constants, such as `SIMPLIFY_KM=2` or `LAKE_CLASSES=Lake|Alkaline Lake`. */
function rules(module: Record<string, unknown>): string {
  return Object.entries(module)
    .flatMap(([name, value]) => {
      if (!/^[A-Z0-9_]+$/.test(name)) return [];
      if (typeof value === 'number') return [`${name}=${value}`];
      return Array.isArray(value) ? [`${name}=${value.join('|')}`] : [];
    })
    .join(', ');
}

function areaRatios(map: GameMap): { id: string; area: number; ratio: number }[] {
  const areaOf = new Map(map.provinces.map((province) => [province.id, province.area]));
  return map.provinces
    .filter((province) => province.neighbours.length > 0)
    .map((province) => {
      const areas = province.neighbours.map((id) => areaOf.get(id) ?? 0).sort((a, b) => a - b);
      const mid = areas.length / 2;
      const median =
        areas.length % 2
          ? (areas[Math.floor(mid)] ?? 0)
          : ((areas[mid - 1] ?? 0) + (areas[mid] ?? 0)) / 2;
      return { id: province.id, area: province.area, ratio: province.area / median };
    })
    .sort((a, b) => b.ratio - a.ratio);
}
