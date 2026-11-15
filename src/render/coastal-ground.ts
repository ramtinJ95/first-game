import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { ArmyId } from '../sim/ids.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import type { Scene, Sprite } from './armies/scene.ts';
import { groundSpan, type GroundArt } from './figures/sheet.ts';
import type { AreaIndex } from './terrain/area-index.ts';

type Land = ((point: MapPoint) => boolean) & {
  span?: (left: number, right: number, y: number, wanted: boolean) => boolean;
};
const AIR = new Set(['smoke', 'dust', 'arrow', 'javelin', 'blaze']);

/**
 * The rendered surface and its exact continuous ground-contact query. Lakes count as
 * land, as they do for the rules that march armies over them; the coast is what moved.
 */
export function coastalSurface(
  coast: () => AreaIndex,
  toMap: (screen: MapPoint) => MapPoint,
  physical?: AreaIndex,
): Land & { box(left: number, right: number, top: number, bottom: number): boolean } {
  return Object.assign(
    (screen: MapPoint) => {
      const p = toMap(screen);
      return coast().inside(p.x, p.y) && (!physical || physical.inside(p.x, p.y));
    },
    {
      box(left: number, right: number, top: number, bottom: number) {
        const a = toMap({ x: left, y: top }),
          b = toMap({ x: right, y: bottom });
        return (
          coast().boxInside(a.x, b.x, a.y, b.y) &&
          (!physical || physical.boxInside(a.x, b.x, a.y, b.y))
        );
      },
      span(left: number, right: number, y: number, wanted: boolean) {
        const a = toMap({ x: left, y }),
          b = toMap({ x: right, y });
        if (wanted)
          return (
            coast().spanInside(a.x, b.x, a.y) && (!physical || physical.spanInside(a.x, b.x, a.y))
          );
        return (
          coast().spanInside(a.x, b.x, a.y, false) ||
          (!!physical && physical.spanInside(a.x, b.x, a.y, false))
        );
      },
    },
  );
}

function lineFits(a: MapPoint, b: MapPoint, fits: Land, lift = 0): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  for (let i = 0; i <= steps; i++) {
    const point = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    if (!fits(point) || (lift !== 0 && !fits({ x: point.x, y: point.y + lift }))) return false;
  }
  return true;
}

function dryRuns(points: readonly MapPoint[], land: Land): { points: MapPoint[] }[] {
  const runs: { points: MapPoint[] }[] = [];
  let run: MapPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as MapPoint,
      b = points[i] as MapPoint;
    if (Math.hypot(b.x - a.x, b.y - a.y) <= 40 && lineFits(a, b, land, 1.5)) {
      if (!run.length) run.push(a);
      run.push(b);
    } else {
      if (run.length > 1) runs.push({ points: run });
      run = [];
    }
  }
  if (run.length > 1) runs.push({ points: run });
  return runs;
}

/** Sample the entire ground contact, not just feet at either end across a little inlet. */
export function groundFits(sprite: Sprite, land: Land): boolean {
  const art = sprite.key.split('.')[0] as GroundArt;
  if (AIR.has(art)) return true;
  const sea = art === 'ship';
  const half = groundSpan(art) * sprite.size;
  if (land.span)
    return (
      land.span(sprite.x - half, sprite.x + half, sprite.y, !sea) &&
      (!sea || land.span(sprite.x - half, sprite.x + half, sprite.y + sprite.size * 0.12, false))
    );
  const steps = Math.max(2, Math.ceil(half * 8));
  for (let i = 0; i <= steps; i++) {
    const x = sprite.x - half + (2 * half * i) / steps;
    if (land({ x, y: sprite.y }) === sea) return false;
    if (sea && land({ x, y: sprite.y + sprite.size * 0.12 }) === sea) return false;
  }
  return true;
}

/** The rules' positions do not move. Fit only drawn ground contacts onto their surface. */
export function fitCoastalSprite(
  sprite: Sprite,
  land: Land,
  scale: number,
  walkable: Land = land,
  anchor?: MapPoint,
  allowShrink = true,
  reachKm = 12,
): Sprite {
  const fits = (sprite: Sprite) =>
    groundFits(sprite, land) &&
    (sprite.key.startsWith('ship.') || walkable === land || groundFits(sprite, walkable));
  if (fits(sprite)) return sprite;
  // A ship's atlas symbol is much wider than a real narrow channel. Shrink only
  // when the full symbol cannot fit locally; never hide a convoy or put it on land.
  for (const shrink of allowShrink ? [1, 0.75, 0.5, 0.25, 0.125, 0.0625, 0.03125] : [1]) {
    for (const origin of anchor ? [sprite, anchor] : [sprite]) {
      for (let ring = 0; ring <= 24; ring++) {
        for (let k = 0; k < (ring ? 24 : 1); k++) {
          const angle = (k * Math.PI) / 12;
          const dx = Math.cos(angle) * ring * (reachKm / 24) * scale;
          const dy = Math.sin(angle) * ring * (reachKm / 24) * scale;
          const candidate = {
            ...sprite,
            x: origin.x + dx,
            y: origin.y + dy,
            size: sprite.size * shrink,
            depth: sprite.depth + origin.y + dy - sprite.y,
          };
          if (!fits(candidate)) continue;
          const hit = sprite.hit;
          return {
            ...candidate,
            ...(hit
              ? {
                  hit: {
                    left: candidate.x + (hit.left - sprite.x) * shrink,
                    right: candidate.x + (hit.right - sprite.x) * shrink,
                    top: candidate.y + (hit.top - sprite.y) * shrink,
                    bottom: candidate.y + (hit.bottom - sprite.y) * shrink,
                  },
                }
              : {}),
          };
        }
      }
    }
  }
  throw new Error(`No safe drawing surface for ${sprite.key} at ${sprite.x},${sprite.y}`);
}

/**
 * A banner stands on the surface its army is on. On the day an army embarks or lands its
 * banner is drawn between yesterday's place and today's, across the shore, so it is
 * afloat exactly where that point is off the physical land.
 */
export function fitBanner(
  army: { readonly id: ArmyId; readonly position: MapPoint },
  previous: DeepReadonly<GameState>,
  current: DeepReadonly<GameState>,
  physical: AreaIndex,
  screen: MapPoint,
  land: Land,
  scale: number,
  walkable: Land,
): MapPoint {
  const afloat =
    (current.armies[army.id]?.activity.kind === 'embarked' ||
      previous.armies[army.id]?.activity.kind === 'embarked') &&
    !physical.inside(army.position.x, army.position.y);
  const fitted = fitCoastalSprite(
    {
      key: afloat ? 'ship.0' : 'standard.0',
      ...screen,
      size: 0,
      mirror: false,
      alpha: 1,
      rotation: 0,
      depth: screen.y,
    },
    land,
    scale,
    walkable,
  );
  return { x: fitted.x, y: fitted.y };
}

/**
 * Where a sprite that does not fit on its own spot regroups: by its army's banner, a ship
 * by its convoy, which is at sea or in harbour while the banner may still be walking to
 * the port, and a refugee by the nearest column, whose people trail back to the city they
 * left in a straight line that can cross the sea.
 */
export function sceneAnchor(
  current: DeepReadonly<GameState>,
  armies: readonly { readonly id: ArmyId; readonly position: MapPoint }[],
  columns: readonly MapPoint[],
  toScreen: (point: MapPoint) => MapPoint,
): (sprite: Sprite) => MapPoint | undefined {
  return (sprite) => {
    if (!sprite.army) {
      if (!/^(refugee|cart\.)/.test(sprite.key)) return undefined;
      let nearest: MapPoint | undefined;
      for (const column of columns) {
        const at = toScreen(column);
        if (
          !nearest ||
          Math.hypot(at.x - sprite.x, at.y - sprite.y) <
            Math.hypot(nearest.x - sprite.x, nearest.y - sprite.y)
        )
          nearest = at;
      }
      return nearest;
    }
    const activity = current.armies[sprite.army]?.activity;
    const convoy =
      sprite.key.startsWith('ship.') && activity?.kind === 'embarked'
        ? current.convoys[activity.convoy]
        : undefined;
    if (convoy) return toScreen(convoy.position);
    const army = armies.find((a) => a.id === sprite.army);
    return army && toScreen(army.position);
  };
}

/** How far a town or village may stand inland of its own place, and how small it may grow. */
export const PLACE_REACH_KM = 12;
const PLACE_SIZES = [1, 0.75, 0.5] as const;

/**
 * Where a town or village ornament stands with its whole ground line on drawn land: at
 * its place, or the nearest spot inland within PLACE_REACH_KM, full-sized before smaller.
 * The way there stays on the rules' land, so an island town never crosses to the mainland.
 * Undefined when nothing fits, and the place is then not drawn at this zoom.
 */
export function fitPlace(
  at: MapPoint,
  halfWidth: number,
  lift: number,
  land: { box(left: number, right: number, top: number, bottom: number): boolean },
  rulesLand: (screen: MapPoint) => boolean,
  scale: number,
): { x: number; y: number; growth: number } | undefined {
  const reach = PLACE_REACH_KM * scale;
  const rings = Math.max(1, Math.ceil(reach / 2));
  const along = (to: MapPoint) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - at.x, to.y - at.y) / 2));
    for (let i = 1; i <= steps; i++)
      if (
        !rulesLand({ x: at.x + ((to.x - at.x) * i) / steps, y: at.y + ((to.y - at.y) * i) / steps })
      )
        return false;
    return true;
  };
  for (const growth of PLACE_SIZES) {
    const half = halfWidth * growth;
    const base = lift * growth;
    for (let ring = 0; ring <= rings; ring++) {
      const radius = (ring * reach) / rings;
      const around = ring ? Math.max(8, Math.ceil((2 * Math.PI * radius) / 2)) : 1;
      for (let k = 0; k < around; k++) {
        const angle = (2 * Math.PI * k) / around;
        const spot = { x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius };
        const y = spot.y + base;
        if (!land.box(spot.x - half, spot.x + half, y - 0.5 * growth, y + 0.5 * growth)) continue;
        if (ring && !along(spot)) continue;
        return { ...spot, growth };
      }
    }
  }
  return undefined;
}

export function fitCoastalScene(
  scene: Scene,
  land: Land,
  scale: number,
  walkable: Land = land,
  anchor?: (sprite: Sprite) => MapPoint | undefined,
): Scene {
  let moved = false;
  const placed = scene.sprites.map((sprite) => {
    // The scene gives rooftop standards 1.5 men's heights, field victories 1.3.
    // Keep that existing distinction here rather than editing the owned army scene.
    // The real burning/captured-city regression exercises the complete postfit path.
    if (!sprite.army && sprite.key.startsWith('standard.') && sprite.size === scene.height * 1.5)
      return sprite;
    const fitted = fitCoastalSprite(sprite, land, scale, walkable, anchor?.(sprite));
    moved ||= fitted !== sprite;
    return fitted;
  });
  const sprites = moved ? placed.sort((a, b) => a.depth - b.depth) : scene.sprites;
  let armyBoxes = scene.armyBoxes;
  if (moved) {
    const fitted: Scene['armyBoxes'] = new Map();
    for (const { army, hit } of sprites) {
      if (!army || !hit || !scene.armyBoxes.has(army)) continue;
      const box = fitted.get(army);
      if (!box) fitted.set(army, { ...hit });
      else {
        box.left = Math.min(box.left, hit.left);
        box.right = Math.max(box.right, hit.right);
        box.top = Math.min(box.top, hit.top);
        box.bottom = Math.max(box.bottom, hit.bottom);
      }
    }
    armyBoxes = new Map([...scene.armyBoxes, ...fitted]);
  }
  return {
    ...scene,
    sprites,
    armyBoxes,
    works: scene.works.flatMap(({ points }) => dryRuns(points, walkable)),
    wakes: scene.wakes.filter((wake) =>
      wake.points
        .slice(1)
        .every((b, i) => lineFits(wake.points[i] as MapPoint, b, (p) => !land(p))),
    ),
  };
}
