import { GraphicsContext } from 'pixi.js';
import { INK, PAPER } from './palette.ts';

/** A city's rank decides the size of its drawing. */
export type CityRank = 'capital' | 'greatPowerCity' | 'minorCity';

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

function ground(g: GraphicsContext, halfWidth: number, y: number) {
  g.moveTo(-halfWidth, y).lineTo(halfWidth, y).stroke({ color: INK, width: 1.2, cap: 'round' });
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
  ground(capital, 16, 9);

  const city = new GraphicsContext();
  wall(city, -7, 0, 7, 6);
  tower(city, -10, -4, 4, 6);
  tower(city, 6, -4, 4, 6);
  temple(city, 0, 0, 7);
  gate(city, 0, 6, 2.2, 3.4);
  ground(city, 10.5, 7);

  const town = new GraphicsContext();
  wall(town, -5, 0, 5, 5);
  tower(town, -2.5, -5, 5, 5);
  gate(town, 0, 5, 1.8, 2.8);
  ground(town, 6.5, 6);

  return { capital, greatPowerCity: city, minorCity: town };
}
