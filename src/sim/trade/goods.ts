import type { StartingOwner } from '../map.ts';
import type { MapPoint } from '../state/map-point.ts';

export const GOODS = ['grain', 'iron', 'horses', 'timber', 'luxuries'] as const;
export type Good = (typeof GOODS)[number];

const HOMELAND: Record<StartingOwner, readonly Good[]> = {
  rome: ['grain', 'iron', 'timber'],
  carthage: ['grain', 'timber', 'luxuries'],
  macedon: ['grain', 'iron', 'horses'],
  egypt: ['grain', 'horses', 'luxuries'],
  persia: ['iron', 'horses', 'luxuries'],
  independent: GOODS,
};

/** A local seeded hash, not the world's random stream: goods never redraw minor cities. */
export function goodAt(seed: number, owner: StartingOwner, point: MapPoint): Good {
  const local = HOMELAND[owner];
  let hash = (seed ^ Math.round(point.x * 17) ^ Math.round(point.y * 31)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return local[hash % local.length] as Good;
}
