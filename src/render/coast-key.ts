import type { GameMap } from '../sim/map.ts';

/** Guard a prebuilt art asset against being applied to a different physical world. */
export function coastKey(map: GameMap): string {
  const text = JSON.stringify([
    map.extent,
    map.coastline,
    map.provinces.map((p) => [p.id, p.city, p.port, p.outline]),
  ]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
