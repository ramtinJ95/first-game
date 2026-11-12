import type { DeepReadonly } from './deep-readonly.ts';
import type { ArmyId, BattleId, ConvoyId, FactionId, ProvinceId, RefugeeColumnId } from './ids.ts';
import type { MultiPolygon, Province, Ring } from './map.ts';
import type { GameState } from './state/game-state.ts';
import type { MapPoint } from './state/map-point.ts';
import type { World } from './world/world.ts';

/**
 * How far a faction sees from each of its own things, in km. A city sees six days of
 * an army's march and an army four, so an evacuation can start before the enemy arrives.
 */
export const SIGHT_KM = { city: 150, army: 100, convoy: 60 } as const;

/** One circle of sight around a city, an army, or a convoy of the faction. */
export interface SightCircle {
  /** Names the source across days, so a drawing can follow it as it moves. */
  readonly key: string;
  readonly centre: MapPoint;
  readonly radius: number;
}

/** What one faction can see on one day. Cities and their owners are always known. */
export interface Sight {
  readonly faction: FactionId;
  /** The faction's own provinces, whose land it sees whole. */
  readonly provinces: ReadonlySet<ProvinceId>;
  readonly circles: readonly SightCircle[];
  readonly armies: ReadonlySet<ArmyId>;
  readonly convoys: ReadonlySet<ConvoyId>;
  readonly refugeeColumns: ReadonlySet<RefugeeColumnId>;
  readonly battles: ReadonlySet<BattleId>;
  sees(point: MapPoint): boolean;
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const boundsCache = new WeakMap<DeepReadonly<Province>, Bounds>();

function boundsOf(province: DeepReadonly<Province>): Bounds {
  const cached = boundsCache.get(province);
  if (cached) return cached;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [outer] of province.outline) {
    for (const point of outer ?? []) {
      const [x, y] = point as readonly [number, number];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const bounds = { minX, minY, maxX, maxY };
  boundsCache.set(province, bounds);
  return bounds;
}

function insideRing(ring: DeepReadonly<Ring>, { x, y }: MapPoint): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as readonly [number, number];
    const [xj, yj] = ring[j] as readonly [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether `point` lies on the land of `outline`, outside its holes. */
export function insideOutline(outline: DeepReadonly<MultiPolygon>, point: MapPoint): boolean {
  return outline.some(
    ([outer, ...holes]) =>
      outer !== undefined &&
      insideRing(outer, point) &&
      !holes.some((hole) => insideRing(hole, point)),
  );
}

/**
 * What `faction` sees: everything on its own provinces' land, and everything within
 * `SIGHT_KM` of its cities, its armies on land, and its convoys. It always sees its
 * own things. A battle in sight shows every army in it, so a battle half in sight is
 * seen whole. The rules never ask this. It is only what the player is shown.
 */
export function sightOf(state: DeepReadonly<GameState>, world: World, faction: FactionId): Sight {
  const provinces = new Set<ProvinceId>();
  const circles: SightCircle[] = [];
  for (const province of Object.values(state.provinces)) {
    const city = state.cities[province.city];
    if (city?.owner !== faction) continue;
    provinces.add(province.id);
    circles.push({ key: `city:${city.id}`, centre: city.position, radius: SIGHT_KM.city });
  }
  for (const army of Object.values(state.armies)) {
    if (army.owner !== faction || army.activity.kind === 'embarked') continue;
    circles.push({
      key: `army:${army.id}`,
      centre: army.activity.position,
      radius: SIGHT_KM.army,
    });
  }
  for (const convoy of Object.values(state.convoys)) {
    if (convoy.owner !== faction) continue;
    circles.push({ key: `convoy:${convoy.id}`, centre: convoy.position, radius: SIGHT_KM.convoy });
  }

  const land = world.map.provinces.filter((province) => provinces.has(province.id as ProvinceId));
  const sees = (point: MapPoint): boolean => {
    for (const { centre, radius } of circles) {
      const dx = point.x - centre.x;
      const dy = point.y - centre.y;
      if (dx * dx + dy * dy <= radius * radius) return true;
    }
    for (const province of land) {
      const b = boundsOf(province);
      if (point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) continue;
      if (insideOutline(province.outline, point)) return true;
    }
    return false;
  };

  const convoys = new Set<ConvoyId>();
  for (const convoy of Object.values(state.convoys)) {
    if (convoy.owner === faction || sees(convoy.position)) convoys.add(convoy.id);
  }
  const armies = new Set<ArmyId>();
  for (const army of Object.values(state.armies)) {
    const { activity } = army;
    const seen =
      army.owner === faction ||
      (activity.kind === 'embarked' ? convoys.has(activity.convoy) : sees(activity.position));
    if (seen) armies.add(army.id);
  }
  const battles = new Set<BattleId>();
  for (const battle of Object.values(state.battles)) {
    const sides = [...battle.attackers, ...battle.defenders];
    if (!sees(battle.position) && !sides.some((army) => armies.has(army))) continue;
    battles.add(battle.id);
    for (const army of sides) armies.add(army);
  }
  const refugeeColumns = new Set<RefugeeColumnId>();
  for (const column of Object.values(state.refugeeColumns)) {
    if (column.owner === faction || sees(column.position)) refugeeColumns.add(column.id);
  }

  return { faction, provinces, circles, armies, convoys, refugeeColumns, battles, sees };
}
