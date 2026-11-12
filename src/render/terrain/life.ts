import { Container, Graphics } from 'pixi.js';
import type { GameMap } from '../../sim/map.ts';
import type { Sight } from '../../sim/sight.ts';
import { mapToScreen, type Camera, type Size } from '../camera.ts';
import { INK, PAPER } from '../palette.ts';
import { DETAIL, detailAlpha } from './detail.ts';
import { mix } from './draw.ts';
import type { Land } from './marks.ts';
import { hash01 } from './random.ts';

const SMOKE = mix(PAPER, 0x5a4e40, 0.55);
const SMOKE_SHADE = mix(PAPER, 0x3e352c, 0.75);
const SAIL_SHADE = mix(PAPER, 0x8a6a44, 0.35);
const HULL = mix(INK, 0x6b4423, 0.3);
const WAKE = 0x3f6b78;
/** Seconds a puff of smoke takes to rise and fade, and how many rise from one hearth at once. */
const PUFF_SECONDS = 7;
const PUFFS = 5;
/** Seconds for a boat to sail out and back. */
const SAIL_SECONDS = 90;

interface Hearth {
  readonly x: number;
  readonly y: number;
  /** Height of the rooftops above the point, in pixels at the base symbol size. */
  readonly rise: number;
  readonly phase: number;
}

interface Boat {
  readonly x: number;
  readonly y: number;
  /** The way the boat sails, a unit vector along the shore, and how far it goes each way in km. */
  readonly dx: number;
  readonly dy: number;
  readonly reach: number;
  readonly phase: number;
}

/**
 * Finds open water off a port: the sea point within 25 km of the city with the most sea
 * around it, and a heading along the shore from which the boat stays at sea.
 */
function boatSpot(land: Land, map: GameMap, x: number, y: number, phase: number): Boat | undefined {
  const sea = (px: number, py: number) =>
    px > 0 &&
    py > 0 &&
    px < map.width &&
    py < map.height &&
    !land.land.inside(px, py) &&
    !land.lakes.inside(px, py);
  let best: { x: number; y: number; score: number } | undefined;
  for (const distance of [7, 10, 14, 19, 25]) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = x + Math.cos(a) * distance;
      const py = y + Math.sin(a) * distance;
      if (!sea(px, py)) continue;
      let score = 0;
      for (let n = 0; n < 8; n++) {
        const b = (n / 8) * Math.PI * 2;
        if (sea(px + Math.cos(b) * 4, py + Math.sin(b) * 4)) score++;
      }
      if (!best || score > best.score) best = { x: px, y: py, score };
    }
    if (best && best.score >= 7) break;
  }
  if (!best) return undefined;
  const ox = best.x - x;
  const oy = best.y - y;
  const length = Math.hypot(ox, oy);
  const dx = -oy / length;
  const dy = ox / length;
  let reach = 0;
  for (const step of [1, 2, 3, 4, 5, 6]) {
    if (
      !sea(best.x + dx * step, best.y + dy * step) ||
      !sea(best.x - dx * step, best.y - dy * step)
    )
      break;
    reach = step;
  }
  return { x: best.x, y: best.y, dx, dy, reach, phase };
}

export interface Life {
  /**
   * Draws the smoke and the boats for this moment, only where the player sees, so a
   * boat in the fog never passes for a hidden convoy. Returns true while they show.
   */
  update(camera: Camera, viewport: Size, now: number, sight: Pick<Sight, 'sees'>): boolean;
}

/**
 * Slow movement at a close zoom, on the wall clock and not the game's: smoke that rises
 * from each city and town, and a small boat that sails to and fro off each port.
 */
export function createLife(map: GameMap, land: Land, parent: Container): Life {
  const graphics = new Graphics();
  parent.addChild(graphics);
  const hearths: Hearth[] = [
    ...map.provinces.map((p) => ({
      x: p.city[0],
      y: p.city[1],
      rise: p.capital ? 7 : 4,
      phase: hash01(Math.round(p.city[0]), Math.round(p.city[1]), 61),
    })),
    ...map.settlements
      .filter((s) => s.rank === 'town')
      .map((s) => ({
        x: s.at[0],
        y: s.at[1],
        rise: 3,
        phase: hash01(Math.round(s.at[0]), Math.round(s.at[1]), 61),
      })),
  ];
  let boats: Boat[] | undefined;

  return {
    update(camera, viewport, now, sight) {
      const alpha = detailAlpha(DETAIL.life, camera.scale);
      graphics.clear();
      graphics.visible = alpha > 0;
      if (alpha <= 0) return false;
      boats ??= map.provinces
        .filter((p) => p.port)
        .flatMap(
          (p) =>
            boatSpot(land, map, p.city[0], p.city[1], hash01(Math.round(p.city[0]), 7, 62)) ?? [],
        );
      const seconds = now / 1000;
      const grow = Math.min(1.8, 1 + 0.35 * Math.log2(camera.scale / 0.6));
      const inView = (at: { x: number; y: number }) =>
        at.x > -40 && at.y > -60 && at.x < viewport.width + 40 && at.y < viewport.height + 20;
      for (const hearth of hearths) {
        const at = mapToScreen(camera, viewport, hearth);
        if (!inView(at) || !sight.sees(hearth)) continue;
        const top = at.y - hearth.rise * grow;
        for (let n = 0; n < PUFFS; n++) {
          const t = (seconds / PUFF_SECONDS + hearth.phase + n / PUFFS) % 1;
          const px = at.x + 2 * grow + Math.sin(t * 5 + hearth.phase * 9) * 1.6 + t * 9;
          const py = top - t * 26;
          const r = 1.2 + t * 3.4;
          const a = alpha * 0.6 * (1 - t) * Math.min(1, t * 6);
          graphics
            .circle(px + r * 0.25, py + r * 0.2, r)
            .fill({ color: SMOKE_SHADE, alpha: a * 0.7 });
          graphics.circle(px, py, r * 0.85).fill({ color: SMOKE, alpha: a });
        }
      }
      for (const boat of boats) {
        const sway = Math.sin(((seconds / SAIL_SECONDS + boat.phase) % 1) * Math.PI * 2);
        const km = {
          x: boat.x + boat.dx * boat.reach * sway,
          y: boat.y + boat.dy * boat.reach * sway,
        };
        const at = mapToScreen(camera, viewport, km);
        if (!inView(at) || !sight.sees(km)) continue;
        const bob = Math.sin(seconds * 1.7 + boat.phase * 20) * 0.6;
        const facing =
          Math.cos(((seconds / SAIL_SECONDS + boat.phase) % 1) * Math.PI * 2) * boat.dx >= 0
            ? 1
            : -1;
        const s = 0.9 * grow;
        const x = at.x;
        const y = at.y + bob;
        graphics
          .poly([x - 6 * s, y, x + 6 * s, y, x + 4 * s, y + 2.4 * s, x - 4 * s, y + 2.4 * s])
          .fill({ color: HULL, alpha })
          .stroke({ width: 0.7, color: INK, alpha, join: 'round' });
        graphics
          .moveTo(x - 5.4 * s, y + 0.7 * s)
          .lineTo(x + 5.4 * s, y + 0.7 * s)
          .stroke({ width: 0.6, color: PAPER, alpha: alpha * 0.6 });
        graphics
          .moveTo(x, y)
          .lineTo(x, y - 9 * s)
          .stroke({ width: 1, color: INK, alpha });
        const tip = x + 0.6 + 5 * s * facing;
        graphics
          .poly([x + 0.6, y - 8.5 * s, tip, y - 1.5 * s, x + 0.6, y - 1.5 * s])
          .fill({ color: PAPER, alpha });
        graphics
          .poly([
            x + 0.6,
            y - 8.5 * s,
            x + 0.6 + 2.2 * s * facing,
            y - 1.5 * s,
            x + 0.6,
            y - 1.5 * s,
          ])
          .fill({ color: SAIL_SHADE, alpha });
        graphics
          .poly([x + 0.6, y - 8.5 * s, tip, y - 1.5 * s, x + 0.6, y - 1.5 * s])
          .stroke({ width: 0.8, color: INK, alpha, join: 'round' });
        graphics
          .moveTo(x - 9 * s, y + 3.2 * s)
          .quadraticCurveTo(x, y + 2.4 * s, x + 9 * s, y + 3.2 * s)
          .stroke({ width: 0.7, color: WAKE, alpha: alpha * 0.7 });
      }
      return true;
    },
  };
}
