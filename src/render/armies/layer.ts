import { CanvasSource, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { CityRank } from '../../sim/state/city.ts';
import { layoutSheet, sheetArt, sheetRows, sheetSvg, type SheetLayout } from '../figures/sheet.ts';
import { INK, PAPER } from '../palette.ts';
import { SHEET_COLOURS, type Scene, type Sprite as SceneSprite } from './scene.ts';

/** Broken water behind a ship, lighter than the sea. */
const FOAM = 0xf3f1e4;

/**
 * The sizes, in device px per man's height, that sheets are painted at. A figure is
 * drawn from the smallest sheet at least as large as it is on screen, so it is shrunk
 * by at most a third and never enlarged, and stays crisp at every zoom and density.
 */
export const SHEET_SIZES = [14, 20, 29, 42, 60, 84, 120] as const;

export function sheetSizeFor(pixels: number): number {
  return SHEET_SIZES.find((size) => size >= pixels * 0.98) ?? 120;
}

/** What one sheet holds: the art every faction shares, or the owned art in one colour. */
type Part = 'shared' | number;

interface Sheet {
  readonly layout: SheetLayout;
  readonly part: Part;
  readonly source: CanvasSource;
  readonly textures: Map<string, Texture>;
  painted: boolean;
}

// The art is posed when a sheet is first needed, so a page that never zooms in to
// figures never pays for it.
let posed: ReturnType<typeof sheetArt> | undefined;
const art = () => (posed ??= sheetArt());
const layouts = new Map<string, SheetLayout>();

function layoutFor(size: number, owned: boolean): SheetLayout {
  const key = `${size}:${owned}`;
  let layout = layouts.get(key);
  if (!layout) {
    layout = layoutSheet(art(), owned, size, size > 60 ? 4096 : 2048);
    layouts.set(key, layout);
  }
  return layout;
}

/** A size is painted only once the zoom has rested at it this long, so a zoom does not stall on every size it passes. */
const REST_MS = 250;

const partOf = (key: string): { part: Part; cell: string } => {
  const at = key.indexOf('@');
  return at < 0
    ? { part: 'shared', cell: key }
    : { part: Number(key.slice(at + 1)), cell: key.slice(0, at) };
};

/** A band of a sheet painted in one task: about this many px of rows at a time. */
const BAND_PX = 160;

/**
 * Paints a sheet band by band, yielding between bands, so that no paint holds the
 * page's main thread long enough to miss frames. Each paint is timed as the
 * user-timing measure `sheet`.
 */
async function paint(sheet: Sheet, canvas: HTMLCanvasElement) {
  const start = performance.now();
  const colour = sheet.part === 'shared' ? 0 : (SHEET_COLOURS[sheet.part] ?? 0);
  const { layout } = sheet;
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('armies: no 2D canvas context');
  const rows = sheetRows(layout);
  for (let i = 0; i < rows.length;) {
    const top = rows[i] as number;
    let j = i + 1;
    while (j < rows.length && (rows[j] as number) - top < BAND_PX) j++;
    const bottom = rows[j] ?? layout.height;
    const svg = sheetSvg(layout, art(), colour, top, bottom);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      context.drawImage(image, 0, top);
    } finally {
      URL.revokeObjectURL(url);
    }
    await new Promise((done) => setTimeout(done, 0));
    i = j;
  }
  sheet.source.resize(layout.width, layout.height);
  sheet.source.update();
  performance.measure('sheet', { start, detail: { size: layout.size, part: sheet.part } });
}

/**
 * Draws a scene, and returns the sprites it drew, which are the ones a click can pick:
 * wakes and siege works as lines, and every figure, tent, fire, ship, and arrow as one
 * sprite from a sheet, in the scene's order. Each size and colour is its own sheet,
 * painted only when a sprite in view needs it.
 */
export function createArmyLayer(resolution: number, onPainted: () => void) {
  const root = new Container({ label: 'armies', isRenderGroup: true });
  const marks = new Graphics();
  const figures = new Container({ label: 'figures' });
  root.addChild(marks, figures);
  const sheets = new Map<string, Sheet>();
  const pool: Sprite[] = [];
  let queue = Promise.resolve();
  let wanted = { size: 0, since: 0 };
  let ready = true;

  function sheetFor(size: number, part: Part): Sheet {
    const key = `${size}:${part}`;
    const existing = sheets.get(key);
    if (existing) return existing;
    const layout = layoutFor(size, part !== 'shared');
    // The canvas gets its size when it is painted, so a sheet asked for costs nothing until then.
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const source = new CanvasSource({ resource: canvas, resolution: 1, scaleMode: 'linear' });
    const sheet: Sheet = { layout, part, source, textures: new Map(), painted: false };
    sheets.set(key, sheet);
    queue = queue
      .then(() => paint(sheet, canvas))
      .then(() => {
        sheet.painted = true;
        onPainted();
      });
    return sheet;
  }

  /** The painted sheet nearest in size to `size` for a part, if any. */
  function painted(size: number, part: Part): Sheet | undefined {
    let best: Sheet | undefined;
    for (const sheet of sheets.values()) {
      if (!sheet.painted || sheet.part !== part) continue;
      const gap = Math.abs(sheet.layout.size - size);
      if (!best || gap < Math.abs(best.layout.size - size)) best = sheet;
    }
    return best;
  }

  function texture(
    sheet: Sheet,
    key: string,
  ): { texture: Texture; anchorX: number; anchorY: number } | undefined {
    const cell = sheet.layout.cells.get(key);
    if (!cell) return undefined;
    let found = sheet.textures.get(key);
    if (!found) {
      found = new Texture({
        source: sheet.source,
        frame: new Rectangle(cell.x, cell.y, cell.width, cell.height),
      });
      sheet.textures.set(key, found);
    }
    return { texture: found, anchorX: cell.anchorX, anchorY: cell.anchorY };
  }

  return {
    root,
    get ready() {
      return ready;
    },
    draw(scene: Scene) {
      marks.clear();
      for (const wake of scene.wakes) {
        const [first, ...rest] = wake.points;
        if (!first) continue;
        marks.moveTo(first.x, first.y);
        for (const point of rest) marks.lineTo(point.x, point.y);
        marks.stroke({ width: 1.6, color: FOAM, alpha: wake.alpha, cap: 'round', join: 'round' });
      }
      for (const { points } of scene.works) {
        for (const [width, colour, alpha, lift] of [
          [3.2, 0x9c8152, 0.5, 1.5],
          [1.1, INK, 0.7, 0],
        ] as const) {
          const [first, ...rest] = points;
          if (!first) continue;
          marks.moveTo(first.x, first.y + lift);
          let last = first;
          for (const point of rest) {
            // A gap where the land share jumps across water, so the ditch never crosses the sea.
            if (Math.hypot(point.x - last.x, point.y - last.y) > 40)
              marks.moveTo(point.x, point.y + lift);
            else marks.lineTo(point.x, point.y + lift);
            last = point;
          }
          marks.stroke({ width, color: colour, alpha, cap: 'round', join: 'round' });
        }
      }
      for (const breach of scene.breaches) drawBreach(marks, breach);

      ready = true;
      let used = 0;
      const shown: SceneSprite[] = [];
      if (scene.height > 0) {
        const size = sheetSizeFor(scene.height * resolution);
        const now = performance.now();
        if (size !== wanted.size) {
          wanted = { size, since: now };
          // A paused page may not draw again by itself, so the end of the rest asks for a frame.
          setTimeout(onPainted, REST_MS + 20);
        }
        const rested = now - wanted.since >= REST_MS;
        const chosen = new Map<Part, Sheet | undefined>();
        for (const sprite of scene.sprites) {
          const { part, cell } = partOf(sprite.key);
          let sheet = chosen.get(part);
          if (!chosen.has(part)) {
            if (rested || !painted(size, part)) sheetFor(size, part);
            const exact = sheets.get(`${size}:${part}`);
            if (!exact?.painted) ready = false;
            sheet = exact?.painted ? exact : painted(size, part);
            chosen.set(part, sheet);
          }
          const found = sheet && texture(sheet, cell);
          if (!sheet || !found) continue;
          let drawn = pool[used];
          if (!drawn) {
            drawn = new Sprite(found.texture);
            pool.push(drawn);
            figures.addChild(drawn);
          }
          used++;
          // The sheet is painted in device pixels and a sprite is placed in CSS pixels.
          const scale = sprite.size / sheet.layout.size;
          drawn.texture = found.texture;
          drawn.anchor.set(found.anchorX, found.anchorY);
          drawn.position.set(sprite.x, sprite.y);
          drawn.scale.set(sprite.mirror ? -scale : scale, scale);
          drawn.rotation = sprite.rotation;
          drawn.alpha = sprite.alpha;
          drawn.visible = true;
          if (sprite.alpha > 0.05) shown.push(sprite);
        }
      }
      for (let i = used; i < pool.length; i++) (pool[i] as Sprite).visible = false;
      return shown;
    },
    destroy() {
      for (const sheet of sheets.values()) {
        for (const t of sheet.textures.values()) t.destroy();
        sheet.source.destroy();
      }
      root.destroy({ children: true });
    },
  };
}

/** Gaps in the wall and fallen stones over a city symbol, more as its walls wear down. */
function drawBreach(
  g: Graphics,
  breach: { x: number; y: number; share: number; rank: CityRank; growth: number },
) {
  const grow = breach.growth;
  const half = { capital: 11, greatPowerCity: 7, minorCity: 5 }[breach.rank] * grow;
  const gaps = breach.share > 0.66 ? 1 : breach.share > 0.33 ? 2 : 3;
  for (let i = 0; i < gaps; i++) {
    const x = breach.x - half * 0.7 + ((i + 0.5) * 1.4 * half) / gaps;
    const top = breach.y - 1.4 * grow;
    const depth = (1 - breach.share) * 5 * grow + 1;
    g.poly([
      x - 1.6 * grow,
      top - 0.6,
      x - 0.4 * grow,
      top + depth,
      x + 0.9 * grow,
      top + depth * 0.6,
      x + 1.8 * grow,
      top - 0.6,
    ])
      .fill(PAPER)
      .stroke({ width: 0.9, color: INK });
    for (let k = 0; k < 3; k++) {
      g.circle(x + (k - 1) * 1.3 * grow, breach.y + 7 * grow + (k % 2) * 0.8, 0.7 * grow).fill(INK);
    }
  }
}
