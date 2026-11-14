import { GraphicsContext } from 'pixi.js';
import type { City, CityRank } from '../sim/state/city.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { Sight } from '../sim/sight.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { symbolGrowth } from './camera.ts';
import { coastalSurface, fitCoastalSprite } from './coastal-ground.ts';
import { groundSpan } from './figures/sheet.ts';
import { INK, PAPER } from './palette.ts';

const LINE = { color: INK, width: 1, join: 'miter' } as const;

function tower(g: GraphicsContext, x: number, top: number, width: number, bottom: number) {
  g.rect(x, top, width, bottom - top)
    .fill(PAPER)
    .stroke(LINE);
  const merlon = width / 3;
  g.rect(x, top - 1.6, merlon, 1.6).fill(INK);
  g.rect(x + width - merlon, top - 1.6, merlon, 1.6).fill(INK);
}

function wall(g: GraphicsContext, left: number, top: number, right: number, bottom: number) {
  g.rect(left, top, right - left, bottom - top)
    .fill(PAPER)
    .stroke(LINE);
  for (let x = left + 1; x + 1.4 <= right - 1; x += 2.8) g.rect(x, top - 1.3, 1.4, 1.3).fill(INK);
}

function gate(g: GraphicsContext, x: number, bottom: number, width: number, height: number) {
  g.moveTo(x - width / 2, bottom)
    .lineTo(x - width / 2, bottom - height + width / 2)
    .arc(x, bottom - height + width / 2, width / 2, Math.PI, 0)
    .lineTo(x + width / 2, bottom)
    .closePath()
    .fill(INK);
}

function temple(g: GraphicsContext, x: number, base: number, width: number) {
  const columns = base - width * 0.45;
  g.rect(x - width / 2, base - 1.2, width, 1.2).fill(INK);
  for (let i = 0; i < 4; i++) {
    const cx = x - width / 2 + 1 + (i * (width - 2)) / 3;
    g.moveTo(cx, base - 1.2)
      .lineTo(cx, columns)
      .stroke({ color: INK, width: 0.9 });
  }
  g.poly([x - width / 2 - 1, columns, x, columns - width * 0.38, x + width / 2 + 1, columns])
    .fill(PAPER)
    .stroke(LINE);
}

const CITY_GROUND = {
  capital: { halfWidth: 16, y: 9 },
  greatPowerCity: { halfWidth: 10.5, y: 7 },
  minorCity: { halfWidth: 6.5, y: 6 },
} as const;

function ground(g: GraphicsContext, rank: CityRank) {
  const { halfWidth, y } = CITY_GROUND[rank];
  g.moveTo(-halfWidth, y).lineTo(halfWidth, y).stroke({ color: INK, width: 1.2, cap: 'round' });
}

/** Fit the castle's ground line, not its elevated towers, without moving its rules position. */
export function fitCitySymbol(
  at: MapPoint,
  rank: CityRank,
  land: ReturnType<typeof coastalSurface>,
  scale: number,
) {
  const grow = symbolGrowth(scale);
  const contact = CITY_GROUND[rank];
  const size = ((contact.halfWidth + 0.6) * grow) / groundSpan('standard');
  const solid = Object.assign((p: MapPoint) => land(p), {
    span: (left: number, right: number, y: number) =>
      land.box(left, right, y - 0.6 * grow, y + 0.6 * grow),
  });
  const placed = fitCoastalSprite(
    {
      key: 'standard.0',
      x: at.x,
      y: at.y + contact.y * grow,
      size,
      mirror: false,
      alpha: 1,
      rotation: 0,
      depth: at.y,
    },
    solid,
    scale,
    solid,
    undefined,
    false,
    12 + ((contact.halfWidth + 0.6) * grow) / scale,
  );
  const growth = (placed.size / size) * grow;
  return { x: placed.x, y: placed.y - contact.y * growth, growth };
}

/** Scene-only city positions; effects keep their original visibility and the rules stay untouched. */
export function cityDrawingView(
  state: DeepReadonly<GameState>,
  sight: Sight,
  position: (city: DeepReadonly<City>) => MapPoint,
) {
  const originals = new Map<MapPoint, MapPoint>();
  const cities = Object.fromEntries(
    Object.values(state.cities).map((city) => {
      const at = position(city);
      originals.set(at, city.position);
      return [city.id, { ...city, position: at }];
    }),
  );
  return {
    state: { ...state, cities },
    sight: { ...sight, sees: (at: MapPoint) => sight.sees(originals.get(at) ?? at) },
  };
}

/** Walled towns drawn in ink on paper, built once and shared by every city of a rank. */
export function citySymbols(): Record<CityRank, GraphicsContext> {
  const capital = new GraphicsContext();
  wall(capital, -11, -1, 11, 8);
  tower(capital, -15, -6, 5, 8);
  tower(capital, 10, -6, 5, 8);
  tower(capital, -3, -4, 6, 8);
  temple(capital, 0, -4, 9);
  gate(capital, 0, 8, 2.6, 4.5);
  ground(capital, 'capital');

  const city = new GraphicsContext();
  wall(city, -7, 0, 7, 6);
  tower(city, -10, -4, 4, 6);
  tower(city, 6, -4, 4, 6);
  temple(city, 0, 0, 7);
  gate(city, 0, 6, 2.2, 3.4);
  ground(city, 'greatPowerCity');

  const town = new GraphicsContext();
  wall(town, -5, 0, 5, 5);
  tower(town, -2.5, -5, 5, 5);
  gate(town, 0, 5, 1.8, 2.8);
  ground(town, 'minorCity');

  return { capital, greatPowerCity: city, minorCity: town };
}
