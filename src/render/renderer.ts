import {
  Application,
  Container,
  DisplacementFilter,
  Graphics,
  Sprite,
  Text,
  TilingSprite,
} from 'pixi.js';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { ArmyId, CityId, ProvinceId } from '../sim/ids.ts';
import type { GameMap, MapLine, MultiPolygon } from '../sim/map.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import {
  clampCamera,
  fitCamera,
  mapToScreen,
  panBy,
  screenToMap,
  wheelFactor,
  zoomAt,
  type Camera,
  type Size,
} from './camera.ts';
import { placeLabels, type Box, type LabelRequest } from './labels.ts';
import { BANNER, drawnArmies, type DrawnArmy } from './markers.ts';
import {
  BORDER,
  factionColour,
  INK,
  LABEL_HALO,
  MARGIN,
  PAPER,
  provinceOwner,
  RIVER,
  SEA,
  WATER_LINE,
} from './palette.ts';
import { paperTexture, waterTexture } from './paper.ts';
import { toPixels } from './lines.ts';
import { pickAt, type Pick } from './pick.ts';
import { reconcile } from './reconcile.ts';
import { citySymbols, type CityRank } from './symbols.ts';

/** What one drawn frame shows: the days either side of now, and the selection. */
export interface Frame {
  readonly previous: DeepReadonly<GameState>;
  readonly current: DeepReadonly<GameState>;
  /** How far the clock is from `current` towards the next day, from 0 to 1. */
  readonly progress: number;
  readonly selection: Pick | undefined;
}

export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly map: GameMap;
  /** A click that did not drag: what it points at, or nothing at sea. */
  readonly onPick: (pick: Pick | undefined) => void;
}

export interface Renderer {
  draw(frame: Frame): void;
  destroy(): void;
}

/**
 * The map's layers from the bottom up. `world` layers move and scale with the camera
 * and are drawn in km. The others are drawn in screen pixels, so symbols, names, and
 * banners keep their size at every zoom. Later units add to a layer and keep the order.
 */
const LAYERS = [
  { name: 'paper', world: true },
  { name: 'sea', world: true },
  { name: 'land', world: true },
  { name: 'terrain', world: true },
  { name: 'washes', world: true },
  { name: 'borders', world: true },
  { name: 'riversAndCoast', world: true },
  { name: 'grain', world: false },
  { name: 'settlements', world: false },
  { name: 'labels', world: false },
  { name: 'markers', world: false },
  { name: 'selection', world: false },
] as const;
type LayerName = (typeof LAYERS)[number]['name'];

/** System serif faces, so the page fetches no font. */
const SERIF = [
  'Palatino Linotype',
  'Palatino',
  'Book Antiqua',
  'Georgia',
  'Times New Roman',
  'serif',
];
/** Light enough that terrain drawn under the wash still shows. */
const WASH_ALPHA = 0.3;
const DRAG_THRESHOLD = 4;
/**
 * Lines keep a fixed width on screen. Rebuilding their geometry costs a few
 * milliseconds, so it waits until the zoom has drifted this far from the last build.
 */
const RESTROKE_RATIO = 1.25;
/** Distances of the water lines from the coast in screen pixels, and their strength. */
const WATER_LINES = [
  { distance: 30, strength: 0.12 },
  { distance: 23, strength: 0.18 },
  { distance: 17, strength: 0.26 },
  { distance: 12, strength: 0.36 },
  { distance: 7.5, strength: 0.48 },
  { distance: 3.8, strength: 0.62 },
] as const;
const WATER_LINE_WIDTH = 0.9;
/**
 * The sea's drift: how far it bends in pixels, the size of its swell, its speed, and
 * how often it steps. The map draws only when something changed, and the swell is
 * the one thing that changes on its own, so its step sets the idle frame rate.
 */
const SWELL = { bend: 2.2, scale: 2.5, pixelsPerSecond: { x: 7, y: 4 }, stepMs: 80 } as const;

function mix(from: number, to: number, t: number): number {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/** Traces every ring of an outline, `scale` pixels per km. */
function traceOutline(g: Graphics, outline: MultiPolygon, scale: number): Graphics {
  for (const polygon of outline) {
    for (const ring of polygon) {
      const flat = toPixels(ring, scale, 0.5);
      if (flat.length >= 6) g.poly(flat, true);
    }
  }
  return g;
}

function fillOutline(
  g: Graphics,
  outline: MultiPolygon,
  color: number,
  alpha = 1,
  scale = 1,
): Graphics {
  for (const [outer, ...holes] of outline) {
    if (!outer) continue;
    g.poly(toPixels(outer, scale, 0)).fill({ color, alpha });
    for (const hole of holes) g.poly(toPixels(hole, scale, 0)).cut();
  }
  return g;
}

/** Traces open lines, `scale` pixels per km, with points at least `minStep` px apart. */
function traceLines(
  g: Graphics,
  lines: readonly MapLine[],
  scale: number,
  minStep: number,
): Graphics {
  for (const line of lines) {
    const flat = toPixels(line, scale, minStep);
    if (flat.length < 4) continue;
    g.moveTo(flat[0] as number, flat[1] as number);
    for (let i = 2; i < flat.length; i += 2) g.lineTo(flat[i] as number, flat[i + 1] as number);
  }
  return g;
}

function sameSelection(a: Pick | undefined, b: Pick | undefined): boolean {
  if (a?.kind === 'province' && b?.kind === 'province') return a.province === b.province;
  if (a?.kind === 'army' && b?.kind === 'army') return a.army === b.army;
  return a === b;
}

function sameArmies(a: readonly DrawnArmy[], b: readonly DrawnArmy[]): boolean {
  return (
    a.length === b.length &&
    a.every((army, i) => {
      const other = b[i];
      return (
        other?.id === army.id &&
        other.owner === army.owner &&
        other.position.x === army.position.x &&
        other.position.y === army.position.y
      );
    })
  );
}

function drawBanner(g: Graphics, colour: number): Graphics {
  const { pole, flagWidth: w, flagHeight: h } = BANNER;
  return g
    .clear()
    .circle(0, 0, 2)
    .fill(INK)
    .moveTo(0, 0)
    .lineTo(0, -pole - 2)
    .stroke({ width: 1.6, color: INK, cap: 'round' })
    .poly([1, -pole, 1 + w, -pole, w - 4, -pole + h / 2, 1 + w, -pole + h, 1, -pole + h])
    .fill(colour)
    .stroke({ width: 1, color: INK, join: 'round' });
}

export async function createRenderer({ canvas, map, onPick }: RendererOptions): Promise<Renderer> {
  const app = new Application();
  await app.init({
    canvas,
    resizeTo: window,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    background: MARGIN,
    autoStart: false,
  });
  canvas.dataset['renderer'] = app.renderer.name;
  const viewport = (): Size => ({ width: app.screen.width, height: app.screen.height });

  const layers = Object.fromEntries(
    LAYERS.map(({ name }) => {
      const layer = new Container({ label: name });
      app.stage.addChild(layer);
      return [name, layer];
    }),
  ) as Record<LayerName, Container>;
  const worldLayers = LAYERS.filter((layer) => layer.world).map(({ name }) => layers[name]);

  const capitals = new Set(
    map.provinces.filter((p) => p.capital && p.owner !== 'independent').map((p) => p.id),
  );
  const outlines = new Map(map.provinces.map((p) => [p.id, p.outline]));

  layers.paper.addChild(new Graphics().rect(0, 0, map.width, map.height).fill(MARGIN));

  const swell = new Sprite(waterTexture());
  const waterLines = new Graphics();
  layers.sea.addChild(new Graphics().poly(map.extent.flat()).fill(SEA), waterLines, swell);
  layers.sea.filters = [new DisplacementFilter({ sprite: swell, scale: SWELL.bend })];

  const land = new Graphics();
  for (const province of map.provinces) fillOutline(land, province.outline, PAPER);
  layers.land.addChild(land);

  const washes = new Map<ProvinceId, Graphics>();
  for (const province of map.provinces) {
    const wash = fillOutline(new Graphics(), province.outline, 0xffffff);
    wash.alpha = WASH_ALPHA;
    washes.set(province.id, wash);
    layers.washes.addChild(wash);
  }

  const borders = new Graphics();
  layers.borders.addChild(borders);
  const inkLines = new Graphics();
  layers.riversAndCoast.addChild(inkLines);

  const grain = new TilingSprite({ texture: paperTexture(), width: 1, height: 1 });
  layers.grain.addChild(grain);

  const symbols = citySymbols();
  const extents = Object.fromEntries(
    Object.entries(symbols).map(([rank, { bounds }]) => [
      rank,
      {
        halfWidth: Math.max(-bounds.minX, bounds.maxX),
        halfHeight: Math.max(-bounds.minY, bounds.maxY),
      },
    ]),
  ) as Record<CityRank, { halfWidth: number; halfHeight: number }>;
  const cityLayer = new Container({ label: 'cities' });
  const townLayer = new Container({ label: 'towns' });
  layers.settlements.addChild(townLayer, cityLayer);

  const highlight = new Graphics();
  const armyRing = new Graphics();
  layers.selection.addChild(highlight, armyRing);

  const cities = new Map<CityId, { symbol: Graphics; label: Text; rank: CityRank }>();
  const banners = new Map<ArmyId, { graphics: Graphics; colour: number }>();

  let camera: Camera = fitCamera(viewport(), map);
  let cameraMoved = true;
  let strokedAt = 0;
  let shown: DeepReadonly<GameState> | undefined;
  let highlighted: { selection: Pick | undefined; scale: number } | undefined;
  let armies: DrawnArmy[] = [];
  let swellAt = -Infinity;

  function restroke(scale: number) {
    strokedAt = scale;
    const round = { cap: 'round', join: 'round' } as const;
    const flat = { cap: 'butt', join: 'bevel' } as const;
    waterLines.clear();
    for (const { distance, strength } of WATER_LINES) {
      const step = Math.max(1, distance / 4);
      traceLines(waterLines, map.coastline, scale, step).stroke({
        width: 2 * distance + WATER_LINE_WIDTH,
        color: mix(SEA, WATER_LINE, strength),
        ...flat,
      });
      traceLines(waterLines, map.coastline, scale, step).stroke({
        width: 2 * distance - WATER_LINE_WIDTH,
        color: SEA,
        ...flat,
      });
    }
    borders.clear();
    for (const province of map.provinces) traceOutline(borders, province.outline, scale);
    borders.stroke({ width: 0.8, color: BORDER, ...round });
    inkLines.clear();
    traceLines(
      inkLines,
      map.rivers.map((river) => river.line),
      scale,
      0.75,
    ).stroke({ width: 1.1, color: RIVER, alpha: 0.9, ...round });
    traceLines(inkLines, map.coastline, scale, 0.75).stroke({ width: 1.5, color: INK, ...round });
    inkLines.poly(toPixels(map.extent, scale, 0)).stroke({ width: 2.5, color: INK, join: 'round' });
    for (const line of [waterLines, borders, inkLines]) line.scale.set(1 / scale);
  }

  function recolour(state: DeepReadonly<GameState>) {
    for (const [province, wash] of washes) {
      const owner = provinceOwner(state, province);
      const colour = owner ? factionColour(state, owner) : 0xffffff;
      if (wash.tint !== colour) wash.tint = colour;
    }
  }

  function rankOf(state: DeepReadonly<GameState>, city: DeepReadonly<City>): CityRank {
    if (capitals.has(city.province)) return 'capital';
    return state.factions[city.owner]?.kind === 'greatPower' ? 'greatPowerCity' : 'minorCity';
  }

  function labelText(city: DeepReadonly<City>): string {
    return capitals.has(city.province) ? city.name.toUpperCase() : city.name;
  }

  function syncSettlements(state: DeepReadonly<GameState>) {
    reconcile(cities, Object.values(state.cities), (city) => city.id, {
      create(city) {
        const rank = rankOf(state, city);
        const capital = rank === 'capital';
        const label = new Text({
          text: labelText(city),
          style: {
            fontFamily: SERIF,
            fontSize: capital ? 14 : 12,
            fontWeight: capital ? 'bold' : 'normal',
            fontStyle: capital ? 'normal' : 'italic',
            letterSpacing: capital ? 1.5 : 0.2,
            fill: INK,
            stroke: { color: LABEL_HALO, width: 3, join: 'round' },
          },
        });
        const symbol = new Graphics(symbols[rank]);
        cityLayer.addChild(symbol);
        layers.labels.addChild(label);
        return { symbol, label, rank };
      },
      update(drawn, city) {
        const rank = rankOf(state, city);
        if (drawn.rank !== rank) {
          drawn.symbol.context = symbols[rank];
          drawn.rank = rank;
        }
        const text = labelText(city);
        if (drawn.label.text !== text) drawn.label.text = text;
      },
      remove({ symbol, label }) {
        symbol.destroy();
        label.destroy();
      },
    });
  }

  function layoutCities(state: DeepReadonly<GameState>) {
    const view = viewport();
    const requests: LabelRequest[] = [];
    const symbolBoxes: Box[] = [];
    for (const city of Object.values(state.cities)) {
      const drawn = cities.get(city.id);
      if (!drawn) continue;
      const { symbol, label, rank } = drawn;
      const { halfWidth, halfHeight } = extents[rank];
      const at = mapToScreen(camera, view, city.position);
      label.visible = false;
      symbol.visible =
        at.x > -halfWidth &&
        at.y > -halfHeight &&
        at.x < view.width + halfWidth &&
        at.y < view.height + halfHeight;
      if (!symbol.visible) continue;
      symbol.position.set(at.x, at.y);
      symbolBoxes.push({
        left: at.x - halfWidth,
        top: at.y - halfHeight,
        right: at.x + halfWidth,
        bottom: at.y + halfHeight,
      });
      requests.push({
        id: city.id,
        anchor: at,
        clearance: { x: halfWidth, y: halfHeight },
        width: label.width,
        height: label.height,
        capital: rank === 'capital',
        population: city.population,
      });
    }
    for (const [id, box] of placeLabels(requests, symbolBoxes, view)) {
      const label = cities.get(id as CityId)?.label;
      if (!label) continue;
      label.visible = true;
      label.position.set(box.left, box.top);
    }
  }

  function drawHighlight(selection: Pick | undefined) {
    highlight.clear();
    if (selection?.kind !== 'province') return;
    const outline = outlines.get(selection.province);
    if (!outline) return;
    const { scale } = camera;
    fillOutline(highlight, outline, 0xffffff, 0.18, scale);
    traceOutline(highlight, outline, scale).stroke({ width: 5, color: LABEL_HALO, join: 'round' });
    traceOutline(highlight, outline, scale).stroke({ width: 2.2, color: INK, join: 'round' });
  }

  function placeBanners(state: DeepReadonly<GameState>, selection: Pick | undefined) {
    reconcile(banners, armies, (army) => army.id, {
      create(army) {
        const colour = factionColour(state, army.owner);
        const graphics = drawBanner(new Graphics(), colour);
        layers.markers.addChild(graphics);
        return { graphics, colour };
      },
      update(banner, army) {
        const colour = factionColour(state, army.owner);
        if (banner.colour === colour) return;
        drawBanner(banner.graphics, colour);
        banner.colour = colour;
      },
      remove: ({ graphics }) => graphics.destroy(),
    });
    const view = viewport();
    armyRing.clear();
    for (const [index, army] of armies.entries()) {
      const banner = banners.get(army.id);
      if (!banner) continue;
      const at = mapToScreen(camera, view, army.position);
      banner.graphics.position.set(at.x, at.y);
      // pickAt tests banners from the last drawn down, so the drawing order must
      // follow `armies` even when a banner is created after others.
      if (layers.markers.getChildIndex(banner.graphics) !== index) {
        layers.markers.setChildIndex(banner.graphics, index);
      }
      if (selection?.kind === 'army' && selection.army === army.id) {
        const cx = at.x + BANNER.flagWidth / 2;
        const cy = at.y - BANNER.pole + BANNER.flagHeight / 2;
        armyRing.circle(cx, cy, 17).stroke({ width: 4, color: LABEL_HALO });
        armyRing.circle(cx, cy, 17).stroke({ width: 2, color: INK });
      }
    }
  }

  function applyCamera() {
    const { width, height } = viewport();
    const x = width / 2 - camera.centre.x * camera.scale;
    const y = height / 2 - camera.centre.y * camera.scale;
    for (const layer of worldLayers) {
      layer.scale.set(camera.scale);
      layer.position.set(x, y);
    }
    highlight.position.set(x, y);
    swell.scale.set(SWELL.scale / camera.scale);
    grain.width = width;
    grain.height = height;
    grain.tilePosition.set(x, y);
    if (Math.abs(Math.log(camera.scale / strokedAt)) > Math.log(RESTROKE_RATIO)) {
      restroke(camera.scale);
    }
  }

  function moveSwell(nowMs: number) {
    const seconds = nowMs / 1000;
    const tile = swell.texture.width * SWELL.scale;
    const drift = {
      x: (seconds * SWELL.pixelsPerSecond.x) % tile,
      y: (seconds * SWELL.pixelsPerSecond.y) % tile,
    };
    const at = screenToMap(camera, viewport(), { x: -tile + drift.x, y: -tile + drift.y });
    swell.position.set(at.x, at.y);
  }

  const listening = new AbortController();
  const { signal } = listening;
  const local = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  let drag: { pointer: number; x: number; y: number; moved: boolean } | undefined;
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      drag = { pointer: event.pointerId, ...local(event), moved: false };
      canvas.setPointerCapture(event.pointerId);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerId !== drag?.pointer) return;
      const at = local(event);
      if (!drag.moved && Math.hypot(at.x - drag.x, at.y - drag.y) < DRAG_THRESHOLD) return;
      camera = panBy(camera, at.x - drag.x, at.y - drag.y, viewport(), map);
      cameraMoved = true;
      drag = { ...drag, ...at, moved: true };
      canvas.style.cursor = 'grabbing';
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerId !== drag?.pointer) return;
      if (!drag.moved) onPick(pickAt(map, camera, viewport(), armies, local(event)));
      drag = undefined;
      canvas.style.cursor = 'grab';
    },
    { signal },
  );
  canvas.addEventListener(
    'pointercancel',
    () => {
      drag = undefined;
      canvas.style.cursor = 'grab';
    },
    { signal },
  );
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : 1;
      camera = zoomAt(camera, local(event), wheelFactor(event.deltaY * lines), viewport(), map);
      cameraMoved = true;
    },
    { signal, passive: false },
  );
  const onResize = () => {
    camera = clampCamera(camera, viewport(), map);
    cameraMoved = true;
  };
  app.renderer.on('resize', onResize);

  return {
    draw({ previous, current, progress, selection }) {
      const now = performance.now();
      let dirty = cameraMoved;
      if (current !== shown) {
        recolour(current);
        syncSettlements(current);
        shown = current;
        dirty = true;
      }
      if (cameraMoved) applyCamera();
      if (dirty) layoutCities(current);
      if (
        !highlighted ||
        highlighted.scale !== camera.scale ||
        !sameSelection(selection, highlighted.selection)
      ) {
        drawHighlight(selection);
        highlighted = { selection, scale: camera.scale };
        dirty = true;
      }
      cameraMoved = false;
      const next = drawnArmies(previous, current, progress);
      if (!sameArmies(armies, next)) {
        armies = next;
        dirty = true;
      }
      if (now - swellAt >= SWELL.stepMs) {
        swellAt = now;
        dirty = true;
      }
      if (!dirty) return;
      moveSwell(now);
      placeBanners(current, selection);
      app.render();
    },
    destroy() {
      listening.abort();
      app.renderer.off('resize', onResize);
      app.destroy(true, { children: true, texture: true });
    },
  };
}
