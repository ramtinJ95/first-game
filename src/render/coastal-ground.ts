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

/** The rendered surface and its exact continuous ground-contact query. */
export function coastalSurface(
  coast: () => AreaIndex,
  lakes: AreaIndex,
  toMap: (screen: MapPoint) => MapPoint,
  physical?: AreaIndex,
): Land & { box(left: number, right: number, top: number, bottom: number): boolean } {
  return Object.assign(
    (screen: MapPoint) => {
      const p = toMap(screen);
      return (
        coast().inside(p.x, p.y) &&
        !lakes.inside(p.x, p.y) &&
        (!physical || physical.inside(p.x, p.y))
      );
    },
    {
      box(left: number, right: number, top: number, bottom: number) {
        const a = toMap({ x: left, y: top }),
          b = toMap({ x: right, y: bottom });
        return (
          coast().boxInside(a.x, b.x, a.y, b.y) &&
          lakes.boxInside(a.x, b.x, a.y, b.y, false) &&
          (!physical || physical.boxInside(a.x, b.x, a.y, b.y))
        );
      },
      span(left: number, right: number, y: number, wanted: boolean) {
        const a = toMap({ x: left, y }),
          b = toMap({ x: right, y });
        if (wanted)
          return (
            coast().spanInside(a.x, b.x, a.y) &&
            lakes.spanInside(a.x, b.x, a.y, false) &&
            (!physical || physical.spanInside(a.x, b.x, a.y))
          );
        return (
          coast().spanInside(a.x, b.x, a.y, false) ||
          lakes.spanInside(a.x, b.x, a.y) ||
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
            depth: sprite.depth + dy,
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
