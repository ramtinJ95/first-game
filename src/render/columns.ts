import { Graphics } from 'pixi.js';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId, RefugeeColumnId } from '../sim/ids.ts';
import type { Sight } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { INK, PAPER } from './palette.ts';

export interface DrawnColumn {
  readonly id: RefugeeColumnId;
  readonly owner: FactionId;
  readonly position: MapPoint;
}

/**
 * Where to draw each refugee column in sight, `progress` of the way from where it stood on
 * the previous day to where it stands now, as banners are placed. A column new today
 * stands at its current place.
 */
export function drawnColumns(
  previous: DeepReadonly<GameState>,
  current: DeepReadonly<GameState>,
  progress: number,
  sight: Sight,
): DrawnColumn[] {
  return Object.values(current.refugeeColumns)
    .filter((column) => sight.refugeeColumns.has(column.id))
    .map((column) => {
      const to = column.position;
      const from = previous.refugeeColumns[column.id]?.position ?? to;
      return {
        id: column.id,
        owner: column.owner,
        position: {
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        },
      };
    });
}

const WOOD = 0x9c7442;
const WOOD_SHADE = 0x6e4f2c;
const WOOD_LIT = 0xc9a36c;

/**
 * A refugee column's mark at the zooms where an army is its flag: an ox cart piled with
 * a bundle in the owner's colour, inked round with a lit and a shaded side, its wheels on
 * the column's place. It is smaller than a banner, so the two never pass for each other.
 */
export function drawColumnMark(g: Graphics, colour: number): Graphics {
  const shade = (c: number) =>
    ((((c >> 16) & 0xff) * 0.7) << 16) | ((((c >> 8) & 0xff) * 0.7) << 8) | ((c & 0xff) * 0.7);
  return g
    .clear()
    .ellipse(0, 1, 11, 2.2)
    .fill({ color: INK, alpha: 0.18 })
    .roundRect(-8, -10, 13, 6, 1.5)
    .fill(colour)
    .stroke({ width: 1, color: INK })
    .poly([-2, -10, 5, -10, 5, -4, -2, -4])
    .fill(shade(colour))
    .moveTo(-6, -9)
    .lineTo(-3, -9)
    .stroke({ width: 1, color: PAPER, alpha: 0.7, cap: 'round' })
    .rect(-9, -5, 15, 3)
    .fill(WOOD)
    .stroke({ width: 1, color: INK })
    .rect(-9, -5, 15, 1)
    .fill(WOOD_LIT)
    .moveTo(6, -3.5)
    .lineTo(11, -3)
    .stroke({ width: 1.2, color: WOOD_SHADE, cap: 'round' })
    .circle(-5, -1, 2.6)
    .fill(WOOD_SHADE)
    .stroke({ width: 1, color: INK })
    .circle(3, -1, 2.6)
    .fill(WOOD_SHADE)
    .stroke({ width: 1, color: INK })
    .circle(-5, -1, 0.8)
    .fill(INK)
    .circle(3, -1, 0.8)
    .fill(INK);
}
