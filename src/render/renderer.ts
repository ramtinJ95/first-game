import {
  Application,
  Container,
  DisplacementFilter,
  Graphics,
  RenderTexture,
  Sprite,
  Text,
  TilingSprite,
} from 'pixi.js';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { ArmyId, BattleId, CityId, ProvinceId, RefugeeColumnId } from '../sim/ids.ts';
import type { GameMap, MapLine, MultiPolygon } from '../sim/map.ts';
import type { City, CityRank } from '../sim/state/city.ts';
import type { Sight } from '../sim/sight.ts';
import type { Battle } from '../sim/state/battle.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import {
  clampCamera,
  fitCamera,
  mapToScreen,
  panBy,
  screenToMap,
  symbolGrowth,
  wheelFactor,
  zoomAt,
  type Camera,
  type Size,
} from './camera.ts';
import type { DrawOptions } from './draw-options.ts';
import { coversView, fitTexture } from './cached-texture.ts';
import { drawColumnMark, drawnColumns, type DrawnColumn } from './columns.ts';
import { createFog, fogCircles } from './fog.ts';
import { LABEL_PRIORITY, placeLabels, type Box, type LabelRequest } from './labels.ts';
import { BANNER, BATTLE_HIT_RADIUS, drawnArmies, type DrawnArmy } from './markers.ts';
import {
  BORDER,
  factionColour,
  WASH_STRENGTH,
  INK,
  LABEL_HALO,
  MARGIN,
  provinceOwner,
  RIVER,
  SEA,
  WATER_LINE,
} from './palette.ts';
import { paperTexture, waterTexture } from './paper.ts';
import { toPixels } from './lines.ts';
import { FramePacer } from './frame-pacer.ts';
import { cityAt, pickAt, type DrawnCity, type Pick } from './pick.ts';
import { reconcile } from './reconcile.ts';
import { citySymbols } from './symbols.ts';
import { createLife } from './terrain/life.ts';
import { createPlaces } from './terrain/places-layer.ts';
import { createTerrain } from './terrain/terrain-layer.ts';
import { createArmyLayer } from './armies/layer.ts';
import {
  buildScene,
  figureHeight,
  type Scene,
  type Sprite as SceneSprite,
} from './armies/scene.ts';

/** What one drawn frame shows: the days either side of now, and the selection. */
export interface Frame {
  readonly previous: DeepReadonly<GameState>;
  readonly current: DeepReadonly<GameState>;
  /** How far the clock is from `current` towards the next day, from 0 to 1. */
  readonly progress: number;
  readonly selection: Pick | undefined;
  /** Paths of orders given but not yet applied, drawn fainter than a march under way. */
  readonly planned?: readonly (readonly MapPoint[])[];
  /** The player's armies whose waiting order replaces the march they are on, which is then not drawn. */
  readonly replaced?: ReadonlySet<ArmyId>;
  /** What the player sees on each of the two days. Only armies and battles in `sight` are drawn. */
  readonly previousSight: Sight;
  readonly sight: Sight;
}

/** A right click: the map point, what it points at, and where on the canvas it was. */
export interface Command {
  readonly point: MapPoint;
  readonly pick: Pick | undefined;
  /** The city whose drawn symbol or name the click is on or close to. */
  readonly city: CityId | undefined;
  readonly screen: MapPoint;
}

export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly map: GameMap;
  /** A click that did not drag: what it points at, or nothing at sea. */
  readonly onPick: (pick: Pick | undefined) => void;
  readonly onCommand?: (command: Command) => void;
  /** What to leave out of the picture. Leaving it out draws all of it. */
  readonly drawing?: DrawOptions;
  /**
   * Waits after each drawn frame until the graphics card has finished it, so the time
   * `draw` takes is the frame's whole cost. For measuring only: it stalls the pipeline.
   */
  readonly waitForGpu?: boolean;
}

/** How far in from each edge of the view something covers it, in screen px. */
export interface Insets {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Renderer {
  /** Draws the frame if anything in it changed, and says whether it did. */
  draw(frame: Frame): boolean;
  /**
   * Centres the view on a map point, zooming in to at least FOCUS_SCALE. With `covered`,
   * the screen px the open panels cover along each edge, it centres the point in the
   * part of the map they leave clear.
   */
  focus(point: MapPoint, covered?: Insets): void;
  destroy(): void;
}

/**
 * The map's layers from the bottom up. `world` layers move and scale with the camera
 * and are drawn in km. The others are drawn in screen pixels, so symbols, names, and
 * banners keep their size at every zoom. Later units add to a layer and keep the order.
 */
export const LAYERS = [
  { name: 'paper', world: true },
  { name: 'sea', world: false },
  { name: 'terrain', world: true },
  { name: 'borders', world: true },
  { name: 'riversAndCoast', world: true },
  { name: 'fog', world: false },
  { name: 'grain', world: false },
  { name: 'settlements', world: false },
  { name: 'markers', world: false },
  { name: 'selection', world: false },
  { name: 'labels', world: false },
] as const;
export type LayerName = (typeof LAYERS)[number]['name'];

/** System serif faces, so the page fetches no font. */
const SERIF = [
  'Palatino Linotype',
  'Palatino',
  'Book Antiqua',
  'Georgia',
  'Times New Roman',
  'serif',
];
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
/** Pixels of sea drawn beyond each edge of the view, so a pan can slide the drawing. */
const SEA_MARGIN = 256;
/**
 * The sea's drift: how far it bends in pixels, the size of its swell, its speed, and
 * how often it steps. The map draws only when something changed, and the swell is
 * the one thing that changes on its own, so its step sets the idle frame rate.
 */
const SWELL = { bend: 2.2, scale: 2.5, pixelsPerSecond: { x: 7, y: 4 }, stepMs: 80 } as const;
/** The zoom that an alert's click brings the view to at least, so the place is legible. */
const FOCUS_SCALE = 0.8;
/** How often a still scene is built again, so men at ease, fires, smoke, and flags move. */
const ALIVE_MS = 90;
/** How far a pan may move the built scene before it is built again. */
const PAN_REBUILD_PX = 200;
const ROUTE_DASH = { dash: 7, gap: 5 } as const;

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
  if (a?.kind === 'battle' && b?.kind === 'battle') return a.battle === b.battle;
  return a === b;
}

function sameArmies(
  a: readonly (DrawnArmy | DrawnColumn)[],
  b: readonly (DrawnArmy | DrawnColumn)[],
): boolean {
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

/** Strokes a dashed line through screen points, carrying the dash across corners. */
function dashLine(g: Graphics, points: readonly MapPoint[]): Graphics {
  const period = ROUTE_DASH.dash + ROUTE_DASH.gap;
  let along = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as MapPoint;
    const b = points[i] as MapPoint;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let t = 0;
    while (t < length) {
      const phase = along % period;
      const step = Math.min(
        length - t,
        phase < ROUTE_DASH.dash ? ROUTE_DASH.dash - phase : period - phase,
      );
      if (phase < ROUTE_DASH.dash) {
        g.moveTo(a.x + ((b.x - a.x) * t) / length, a.y + ((b.y - a.y) * t) / length);
        g.lineTo(
          a.x + ((b.x - a.x) * (t + step)) / length,
          a.y + ((b.y - a.y) * (t + step)) / length,
        );
      }
      t += step;
      along += step;
    }
  }
  return g;
}

/** Two crossed swords in ink on a paper disc, centred on the battle. */
function drawBattleMarker(g: Graphics): Graphics {
  g.circle(0, 0, 11).fill(LABEL_HALO).stroke({ width: 1.5, color: INK });
  for (const side of [-1, 1]) {
    g.moveTo(-6 * side, 6)
      .lineTo(6 * side, -6)
      .stroke({ width: 2, color: INK, cap: 'round' });
    g.moveTo(-7.5 * side, 2.5)
      .lineTo(-2.5 * side, 7.5)
      .stroke({ width: 1.6, color: INK, cap: 'round' });
  }
  return g;
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

export async function createRenderer({
  canvas,
  map,
  onPick,
  onCommand,
  drawing,
  waitForGpu = false,
}: RendererOptions): Promise<Renderer> {
  const app = new Application();
  await app.init({
    canvas,
    resizeTo: window,
    antialias: drawing?.antialias ?? true,
    autoDensity: true,
    resolution: drawing?.resolution ?? (window.devicePixelRatio || 1),
    background: MARGIN,
    autoStart: false,
  });
  canvas.dataset['renderer'] = app.renderer.name;
  const viewport = (): Size => ({ width: app.screen.width, height: app.screen.height });

  const layers = Object.fromEntries(
    LAYERS.map(({ name }) => {
      const layer = new Container({ label: name });
      layer.visible = !drawing?.hidden.has(name);
      app.stage.addChild(layer);
      return [name, layer];
    }),
  ) as Record<LayerName, Container>;
  const worldLayers = LAYERS.filter((layer) => layer.world).map(({ name }) => layers[name]);

  const outlines = new Map(map.provinces.map((p) => [p.id, p.outline]));

  layers.paper.addChild(new Graphics().rect(0, 0, map.width, map.height).fill(MARGIN));

  // The sea's drawing is many wide strokes. It is drawn into a texture only when the
  // camera moves, so the swell that runs every frame bends one sprite, not the strokes.
  // A pan slides the texture and draws it again only after moving SEA_MARGIN pixels.
  const waterLines = new Graphics();
  const seaMask = new Graphics().poly(map.extent.flat()).fill(0xffffff);
  waterLines.mask = seaMask;
  const seaArt = new Container();
  seaArt.addChild(new Graphics().poly(map.extent.flat()).fill(SEA), waterLines, seaMask);
  const seaRoot = new Container();
  seaRoot.addChild(seaArt);
  let seaTexture = RenderTexture.create({
    width: viewport().width + 2 * SEA_MARGIN,
    height: viewport().height + 2 * SEA_MARGIN,
    resolution: app.renderer.resolution,
    antialias: true,
  });
  const seaSprite = new Sprite(seaTexture);
  let seaDrawn: { x: number; y: number; scale: number } | undefined;
  const swell = new Sprite(waterTexture());
  swell.scale.set(SWELL.scale);
  layers.sea.addChild(seaSprite, swell);
  const swellOn = drawing?.swell ?? true;
  if (swellOn) {
    layers.sea.filters = [new DisplacementFilter({ sprite: swell, scale: SWELL.bend })];
    layers.sea.filterArea = app.screen;
  } else {
    swell.visible = false;
  }

  const terrain = createTerrain(map, layers.terrain, app.renderer);

  const washes = new Map<ProvinceId, Graphics>();
  for (const province of map.provinces) {
    const wash = fillOutline(new Graphics(), province.outline, 0xffffff);
    wash.alpha = 0;
    washes.set(province.id, wash);
    terrain.washes.addChild(wash);
  }

  const borders = new Graphics();
  layers.borders.addChild(borders);
  // The map build clips rivers and the coastline to the extent, so they need no mask.
  // A stencil mask here cost over a third of each frame drawn without a graphics card.
  const inkLines = new Graphics();
  const frame = new Graphics();
  layers.riversAndCoast.addChild(terrain.lakes, inkLines, frame);

  const fog = createFog(app.renderer, map);
  layers.fog.addChild(fog.root);
  const fogShown = layers.fog.visible;

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
  const lifeLayer = new Container({ label: 'life' });
  layers.settlements.addChild(townLayer, cityLayer, lifeLayer);
  const places = createPlaces(map, townLayer, layers.labels);
  const life = createLife(map, terrain.land, lifeLayer);

  const routes = new Graphics();
  const battleLayer = new Container({ label: 'battles' });
  const bannerLayer = new Container({ label: 'banners' });
  const armyLayer = createArmyLayer(app.renderer.resolution, () => {
    sheetPainted = true;
  });
  // The figures stand over the city symbols and under the city names, so a name stays
  // readable when an army, a battle, or a siege stands at its city.
  layers.settlements.addChild(armyLayer.root);
  const columnLayer = new Container({ label: 'columns' });
  const columnMarks = new Map<RefugeeColumnId, { graphics: Graphics; colour: number }>();
  layers.markers.addChild(routes, battleLayer, columnLayer, bannerLayer);

  const highlight = new Graphics();
  const armyRing = new Graphics();
  layers.selection.addChild(highlight, armyRing);

  const cities = new Map<CityId, { symbol: Graphics; label: Text; rank: CityRank }>();
  const banners = new Map<ArmyId, { graphics: Graphics; colour: number }>();
  const battleMarkers = new Map<BattleId, Graphics>();

  let camera: Camera = fitCamera(viewport(), map);
  let cameraMoved = true;
  let strokedAt = 0;
  let shown: DeepReadonly<GameState> | undefined;
  let laidOut: DeepReadonly<GameState> | undefined;
  // Each game state the page hands over gets a number, and the canvas says the latest it
  // was given and the latest it has drawn, so a test or a capture can wait until the
  // map shows a state it loaded: a click picks what the map last drew.
  const stateIds = new WeakMap<object, number>();
  let lastStateId = 0;
  function stateId(state: object): number {
    let id = stateIds.get(state);
    if (id === undefined) {
      id = ++lastStateId;
      stateIds.set(state, id);
    }
    return id;
  }
  let highlighted: { selection: Pick | undefined; scale: number } | undefined;
  let armies: DrawnArmy[] = [];
  let columns: DrawnColumn[] = [];
  let drawnCities: DrawnCity[] = [];
  /** Where each city's name stands relative to the city, which the army scene depends on. */
  let nameSides = '';
  /** The town and village symbols and names drawn, which a siege camp keeps clear of. */
  let drawnPlaces: Box[] = [];
  let plannedShown: Frame['planned'];
  let seenBy: Sight | undefined;
  let seenBattles: DeepReadonly<Battle>[] = [];
  let swellAt = -Infinity;
  let sheetPainted = false;
  let scene: Scene | undefined;
  /** The sprites last drawn, so a click picks only what is on the screen. */
  let drawnFigures: readonly SceneSprite[] = [];
  let built:
    | {
        previous: DeepReadonly<GameState>;
        current: DeepReadonly<GameState>;
        progress: number;
        sight: Sight;
        scale: number;
        centre: MapPoint;
        width: number;
        height: number;
        at: number;
        cost: number;
        nameSides: string;
      }
    | undefined;
  /** How far the camera has panned since the scene was built, in screen px. */
  const sceneShift = () =>
    built
      ? {
          x: (built.centre.x - camera.centre.x) * camera.scale,
          y: (built.centre.y - camera.centre.y) * camera.scale,
        }
      : { x: 0, y: 0 };
  /** The figures a click can pick, where they stand on screen now. */
  const figuresShown = () => {
    if (!scene || scene.height === 0) return [];
    const { x, y } = sceneShift();
    return drawnFigures.flatMap((sprite) =>
      sprite.army && sprite.hit
        ? [
            {
              army: sprite.army,
              hit: {
                left: sprite.hit.left + x,
                right: sprite.hit.right + x,
                top: sprite.hit.top + y,
                bottom: sprite.hit.bottom + y,
              },
            },
          ]
        : [],
    );
  };
  /** Seconds of motion: it runs with the game's days, faster at a higher speed, and stops while paused. */
  let motion = 0;
  let clockAt: { day: number; now: number } | undefined;

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
    terrain.restroke(scale);
    frame.clear();
    frame.poly(toPixels(map.extent, scale, 0)).stroke({ width: 2.5, color: INK, join: 'round' });
    for (const line of [waterLines, borders, inkLines, frame]) line.scale.set(1 / scale);
  }

  function recolour(state: DeepReadonly<GameState>) {
    for (const [province, wash] of washes) {
      const owner = provinceOwner(state, province);
      const colour = owner ? factionColour(state, owner) : 0xffffff;
      const alpha = owner ? WASH_STRENGTH : 0;
      if (wash.tint === colour && wash.alpha === alpha) continue;
      wash.tint = colour;
      wash.alpha = alpha;
      terrain.repaint();
    }
  }

  function labelText(city: DeepReadonly<City>): string {
    return city.rank === 'capital' ? city.name.toUpperCase() : city.name;
  }

  function syncSettlements(state: DeepReadonly<GameState>) {
    reconcile(cities, Object.values(state.cities), (city) => city.id, {
      create(city) {
        const { rank } = city;
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
        const { rank } = city;
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

  /**
   * The banners of armies in sight that stand still today and the battle markers, which
   * names keep clear of. A marching banner passes under the names instead, so they do
   * not jump about as it goes by.
   */
  function standingMarkers(state: DeepReadonly<GameState>): Box[] {
    const view = viewport();
    const boxes: Box[] = [];
    if (figureHeight(camera.scale) === 0) {
      for (const army of Object.values(state.armies)) {
        const { activity } = army;
        if (!seenBy?.armies.has(army.id) || !('position' in activity)) continue;
        if (activity.kind === 'marching' || activity.kind === 'retreating') continue;
        const foot = mapToScreen(camera, view, activity.position);
        boxes.push({
          left: foot.x - 4,
          top: foot.y - BANNER.pole - 3,
          right: foot.x + BANNER.flagWidth + 3,
          bottom: foot.y,
        });
      }
    }
    for (const battle of battlesShown()) {
      const at = mapToScreen(camera, view, battle.position);
      boxes.push({
        left: at.x - BATTLE_HIT_RADIUS,
        top: at.y - BATTLE_HIT_RADIUS,
        right: at.x + BATTLE_HIT_RADIUS,
        bottom: at.y + BATTLE_HIT_RADIUS,
      });
    }
    return boxes;
  }

  function layoutCities(state: DeepReadonly<GameState>) {
    const view = viewport();
    const requests: LabelRequest[] = [];
    const symbolBoxes: Box[] = [];
    for (const city of Object.values(state.cities)) {
      const drawn = cities.get(city.id);
      if (!drawn) continue;
      const { symbol, label, rank } = drawn;
      const grow = symbolGrowth(camera.scale);
      const halfWidth = extents[rank].halfWidth * grow;
      const halfHeight = extents[rank].halfHeight * grow;
      symbol.scale.set(grow);
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
        priority: rank === 'capital' ? LABEL_PRIORITY.capital : LABEL_PRIORITY.city,
        population: city.population,
      });
    }
    const settled = places.layout(camera, view, symbolBoxes);
    const placed = placeLabels(
      [...requests, ...settled.requests],
      [...symbolBoxes, ...settled.boxes, ...standingMarkers(state)],
      view,
    );
    places.placeLabels(placed);
    drawnPlaces = [
      ...settled.boxes,
      ...settled.requests.flatMap(({ id }) => {
        const box = placed.get(id);
        return box ? [box] : [];
      }),
    ];
    for (const [id, box] of placed) {
      const label = cities.get(id as CityId)?.label;
      if (!label) continue;
      label.visible = true;
      label.position.set(box.left, box.top);
    }
    drawnCities = requests.map(({ id }, i) => ({
      id: id as CityId,
      symbol: symbolBoxes[i] as Box,
      label: placed.get(id),
    }));
    const side = (from: number, to: number) => (Math.abs(to - from) < 1 ? 0 : Math.sign(to - from));
    nameSides = requests
      .map(({ id, anchor }) => {
        const box = placed.get(id);
        if (!box) return '';
        return `${id}:${side(anchor.x, (box.left + box.right) / 2)}:${side(anchor.y, (box.top + box.bottom) / 2)}`;
      })
      .join(',');
    // A siege camp keeps clear of the places round its city, so a place near a siege that
    // gains or loses its symbol or name lays the camp out again. Places elsewhere do not,
    // so a pan that brings places into view does not rebuild the scene.
    const reach = 3 * figureHeight(camera.scale) + 120;
    const sieged = Object.values(state.sieges).flatMap((siege) => {
      const city = state.cities[siege.city];
      return city ? [mapToScreen(camera, view, city.position)] : [];
    });
    const nearSiege = (box: Box) =>
      sieged.some(
        (c) =>
          box.right > c.x - reach &&
          box.left < c.x + reach &&
          box.bottom > c.y - reach &&
          box.top < c.y + reach,
      );
    nameSides += `|${drawnPlaces
      .filter(nearSiege)
      .map(
        (b) =>
          `${Math.round(b.left - (sieged[0]?.x ?? 0))},${Math.round(b.top - (sieged[0]?.y ?? 0))}`,
      )
      .join(',')}`;
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
        bannerLayer.addChild(graphics);
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
      if (bannerLayer.getChildIndex(banner.graphics) !== index) {
        bannerLayer.setChildIndex(banner.graphics, index);
      }
      if (bannerLayer.visible && selection?.kind === 'army' && selection.army === army.id) {
        const cx = at.x + BANNER.flagWidth / 2;
        const cy = at.y - BANNER.pole + BANNER.flagHeight / 2;
        armyRing.circle(cx, cy, 17).stroke({ width: 4, color: LABEL_HALO });
        armyRing.circle(cx, cy, 17).stroke({ width: 2, color: INK });
      }
    }
  }

  /** A refugee column's mark, at the zooms where an army is its flag. */
  function placeColumns(state: DeepReadonly<GameState>) {
    reconcile(columnMarks, columns, (column) => column.id, {
      create(column) {
        const colour = factionColour(state, column.owner);
        const graphics = drawColumnMark(new Graphics(), colour);
        columnLayer.addChild(graphics);
        return { graphics, colour };
      },
      update(mark, column) {
        const colour = factionColour(state, column.owner);
        if (mark.colour === colour) return;
        drawColumnMark(mark.graphics, colour);
        mark.colour = colour;
      },
      remove: ({ graphics }) => graphics.destroy(),
    });
    const view = viewport();
    for (const column of columns) {
      const at = mapToScreen(camera, view, column.position);
      columnMarks.get(column.id)?.graphics.position.set(at.x, at.y);
    }
  }

  function placeBattles(selection: Pick | undefined) {
    reconcile(battleMarkers, seenBattles, (battle) => battle.id, {
      create() {
        const graphics = drawBattleMarker(new Graphics());
        battleLayer.addChild(graphics);
        return graphics;
      },
      update() {},
      remove: (graphics) => graphics.destroy(),
    });
    const view = viewport();
    for (const battle of battlesShown()) {
      const at = mapToScreen(camera, view, battle.position);
      battleMarkers.get(battle.id)?.position.set(at.x, at.y);
      if (selection?.kind === 'battle' && selection.battle === battle.id) {
        armyRing.circle(at.x, at.y, BATTLE_HIT_RADIUS + 3).stroke({ width: 4, color: LABEL_HALO });
        armyRing.circle(at.x, at.y, BATTLE_HIT_RADIUS + 3).stroke({ width: 2, color: INK });
      }
    }
  }

  /**
   * The player's marches and crossings from where each army is drawn now, and the
   * paths of orders still waiting for the next day. Other factions' plans stay hidden.
   */
  function drawRoutes(
    state: DeepReadonly<GameState>,
    selection: Pick | undefined,
    planned: Frame['planned'],
    replaced: Frame['replaced'],
  ) {
    const view = viewport();
    const toScreen = (point: MapPoint) => mapToScreen(camera, view, point);
    routes.clear();
    const stroke = (points: MapPoint[], width: number, alpha: number) => {
      if (points.length < 2) return;
      dashLine(routes, points).stroke({ width: width + 3, color: LABEL_HALO, alpha, cap: 'round' });
      dashLine(routes, points).stroke({ width, color: INK, alpha, cap: 'round' });
    };
    for (const army of armies) {
      const record = state.armies[army.id];
      if (!record || record.owner !== state.player || replaced?.has(army.id)) continue;
      const { activity } = record;
      const ahead =
        activity.kind === 'marching'
          ? activity.waypoints
          : activity.kind === 'embarked'
            ? state.convoys[activity.convoy]?.waypoints
            : undefined;
      if (!ahead) continue;
      const selected = selection?.kind === 'army' && selection.army === army.id;
      stroke([army.position, ...ahead].map(toScreen), selected ? 2.4 : 1.6, selected ? 0.95 : 0.7);
    }
    for (const path of planned ?? []) stroke(path.map(toScreen), 1.6, 0.45);
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
    grain.width = width;
    grain.height = height;
    grain.tilePosition.set(x, y);
    fog.place(x, y, camera.scale, width, height);
    if (Math.abs(Math.log(camera.scale / strokedAt)) > Math.log(RESTROKE_RATIO)) {
      restroke(camera.scale);
    }
    if (
      !seaDrawn ||
      seaDrawn.scale !== camera.scale ||
      !coversView(seaTexture, x - seaDrawn.x - SEA_MARGIN, y - seaDrawn.y - SEA_MARGIN, {
        width,
        height,
      })
    ) {
      const size = { width: width + 2 * SEA_MARGIN, height: height + 2 * SEA_MARGIN };
      seaTexture = fitTexture(seaTexture, size.width, size.height, app.renderer.resolution);
      seaSprite.texture = seaTexture;
      seaArt.scale.set(camera.scale);
      seaArt.position.set(x + SEA_MARGIN, y + SEA_MARGIN);
      app.renderer.render({ container: seaRoot, target: seaTexture, clear: true });
      seaDrawn = { x, y, scale: camera.scale };
    }
    seaSprite.position.set(x - seaDrawn.x - SEA_MARGIN, y - seaDrawn.y - SEA_MARGIN);
  }

  function moveSwell(nowMs: number) {
    const seconds = nowMs / 1000;
    const tile = swell.texture.width * SWELL.scale;
    const drift = {
      x: (seconds * SWELL.pixelsPerSecond.x) % tile,
      y: (seconds * SWELL.pixelsPerSecond.y) % tile,
    };
    swell.position.set(-tile + drift.x, -tile + drift.y);
  }

  const gl = 'gl' in app.renderer ? app.renderer.gl : undefined;
  const pacer = new FramePacer(gl instanceof WebGL2RenderingContext ? gl : undefined);

  const pixel = new Uint8Array(4);
  function finish() {
    if ('gl' in app.renderer) {
      app.renderer.gl.readPixels(
        0,
        0,
        1,
        1,
        WebGLRenderingContext.RGBA,
        WebGLRenderingContext.UNSIGNED_BYTE,
        pixel,
      );
    }
  }

  const onLand = (screen: MapPoint) => {
    const point = screenToMap(camera, viewport(), screen);
    return terrain.land.open(point.x, point.y);
  };
  /** At the zooms that draw figures, a battle's marker stands above its fighting. */
  const battleLift = () =>
    scene && scene.height > 0 ? (1.75 * scene.height + 14) / camera.scale : 0;
  const battlesShown = () => {
    const lift = battleLift();
    if (lift === 0) return seenBattles;
    // At figure zooms a battle is drawn where the scene placed it, clear of any city.
    return seenBattles.map((b) => {
      const at = scene?.battleAnchors.get(b.id) ?? b.position;
      return { id: b.id, position: { x: at.x, y: at.y - lift } };
    });
  };
  const bannersShown = () => (scene && scene.height > 0 ? [] : armies);

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
      if (!drag.moved) {
        const screen = local(event);
        const pick = pickAt(
          map,
          camera,
          viewport(),
          bannersShown(),
          screen,
          battlesShown(),
          figuresShown(),
        );
        // A city's name can stand over a neighbouring province, so a click on it, or on
        // its symbol, picks the city's own province.
        const city = !pick || pick.kind === 'province' ? cityAt(drawnCities, screen) : undefined;
        const province = city && map.provinces.find((p) => (p.id as string) === city)?.id;
        onPick(province ? { kind: 'province', province } : pick);
      }
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
    'contextmenu',
    (event) => {
      event.preventDefault();
      if (!onCommand) return;
      const screen = local(event);
      onCommand({
        point: screenToMap(camera, viewport(), screen),
        pick: pickAt(
          map,
          camera,
          viewport(),
          bannersShown(),
          screen,
          battlesShown(),
          figuresShown(),
        ),
        city: cityAt(drawnCities, screen),
        screen,
      });
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
  /** The size of the frame the pacer waits on, which becomes `data-drawn-size` once it is done. */
  let fenced: string | undefined;
  let finishedFrames = 0;
  /** Says on the canvas that the GPU has finished a frame of this size, and how many it has. */
  const finished = (size: string) => {
    finishedFrames += 1;
    canvas.dataset['drawnSize'] = size;
    canvas.dataset['drawnFrames'] = String(finishedFrames);
  };
  const onResize = () => {
    camera = clampCamera(camera, viewport(), map);
    cameraMoved = true;
  };
  app.renderer.on('resize', onResize);

  return {
    draw({ previous, current, progress, selection, planned, replaced, previousSight, sight }) {
      const given = String(stateId(current));
      if (canvas.dataset['latestState'] !== given) canvas.dataset['latestState'] = given;
      // While the GPU still draws the last frame, this one sends it nothing and keeps every
      // change for the next, but lays the cities out again, which costs the GPU nothing,
      // so a click picks what the screen will show.
      if (!pacer.ready()) {
        if (cameraMoved || current !== laidOut) layoutCities(current);
        laidOut = current;
        return false;
      }
      if (fenced) finished(fenced);
      fenced = undefined;
      const now = performance.now();
      let dirty = cameraMoved;
      if (current !== shown) {
        recolour(current);
        syncSettlements(current);
        // A defeated player watches on with no sight of their own. The fog then lifts
        // rather than shade the whole map, so the owners' colours stay plain.
        layers.fog.visible = fogShown && current.factions[current.player]?.defeatedOn == null;
        shown = current;
        dirty = true;
      }
      if (sight !== seenBy) {
        seenBy = sight;
        seenBattles = Object.values(current.battles).filter((b) => sight.battles.has(b.id));
        dirty = true;
      }
      if (cameraMoved) applyCamera();
      const terrainNow = terrain.update(camera, viewport(), now);
      if (terrainNow.busy || terrainNow.redrawn) dirty = true;
      const terrainState = terrainNow.busy ? 'busy' : 'ready';
      if (canvas.dataset['terrain'] !== terrainState) canvas.dataset['terrain'] = terrainState;
      if (dirty) layoutCities(current);
      laidOut = current;
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
      if (
        layers.fog.visible &&
        fog.update(sight.provinces, fogCircles(previousSight, sight, progress))
      ) {
        dirty = true;
      }
      const next = drawnArmies(previous, current, progress).filter((army) =>
        sight.armies.has(army.id),
      );
      if (!sameArmies(armies, next)) {
        armies = next;
        dirty = true;
      }
      const nextColumns = drawnColumns(previous, current, progress, sight);
      if (!sameArmies(columns, nextColumns)) {
        columns = nextColumns;
        dirty = true;
      }
      if (planned !== plannedShown) {
        plannedShown = planned;
        dirty = true;
      }
      if (swellOn && now - swellAt >= SWELL.stepMs) {
        swellAt = now;
        dirty = true;
      }
      if (places.step(now)) dirty = true;
      const day = current.day + progress;
      if (clockAt) {
        const seconds = (now - clockAt.now) / 1000;
        const days = day - clockAt.day;
        const rate = seconds > 0 && days > 0 && days < 2 ? days / seconds : 0;
        motion += seconds * (Math.min(rate, 1) + 0.35 * Math.max(0, rate - 1));
      }
      clockAt = { day, now };
      const height = figureHeight(camera.scale);
      const view = viewport();
      const stale =
        !built ||
        built.scale !== camera.scale ||
        built.width !== view.width ||
        built.height !== view.height ||
        // An army at a city stands clear of its name, so a name that moves round its
        // city moves the army too, where a pan alone only slides the built scene.
        built.nameSides !== nameSides ||
        sheetPainted ||
        // A pan moves the built scene; once it has moved far, armies culled from it come into view.
        Math.hypot(sceneShift().x, sceneShift().y) > PAN_REBUILD_PX;
      const newDay =
        built &&
        (built.current !== current || built.previous !== previous || built.sight !== sight);
      // Without the swell the page draws only when something changes, so men at ease,
      // fires, and smoke then move only with the clock.
      const moving =
        built && (built.progress !== progress || (swellOn && now - built.at >= ALIVE_MS));
      // A scene of many armies costs milliseconds to build, so between builds a pan
      // moves the built scene, and a rebuild for motion alone waits for twice what the
      // last one cost. A new day or new sight is drawn at once.
      const due = !built || now - built.at >= 2 * built.cost;
      if (
        (height > 0 || (scene && scene.height > 0) || sheetPainted) &&
        (stale || newDay || (moving && due))
      ) {
        const start = performance.now();
        scene = buildScene({
          previous,
          current,
          progress,
          camera,
          viewport: view,
          previousSight,
          sight,
          motion,
          now: now / 1000,
          growth: symbolGrowth(camera.scale),
          land: onLand,
          names: new Map(drawnCities.flatMap(({ id, label }) => (label ? [[id, label]] : []))),
          keepClear: drawnPlaces,
        });
        drawnFigures = armyLayer.draw(scene);
        canvas.dataset['figures'] = String(drawnFigures.filter((sprite) => sprite.army).length);
        built = {
          previous,
          current,
          progress,
          sight,
          scale: camera.scale,
          centre: camera.centre,
          width: view.width,
          height: view.height,
          at: now,
          cost: performance.now() - start,
          nameSides,
        };
        sheetPainted = false;
        dirty = true;
      }
      if (built) {
        const shift = sceneShift();
        if (armyLayer.root.x !== shift.x || armyLayer.root.y !== shift.y) {
          armyLayer.root.position.set(shift.x, shift.y);
          dirty = true;
        }
      }
      if (!dirty) return false;
      life.update(camera, viewport(), now, sight);
      moveSwell(now);
      bannerLayer.visible = !scene || scene.height === 0;
      columnLayer.visible = bannerLayer.visible;
      drawRoutes(current, selection, planned, replaced);
      placeBanners(current, selection);
      placeColumns(current);
      placeBattles(selection);
      if (scene && scene.height > 0 && selection?.kind === 'army') {
        const box = scene.armyBoxes.get(selection.army);
        if (box) {
          const shift = sceneShift();
          const cx = (box.left + box.right) / 2 + shift.x;
          const cy = box.bottom - 2 + shift.y;
          const rx = (box.right - box.left) / 2 + 8;
          const ry = Math.max(8, (box.bottom - box.top) * 0.35);
          armyRing.ellipse(cx, cy, rx, ry).stroke({ width: 4, color: LABEL_HALO, alpha: 0.9 });
          armyRing.ellipse(cx, cy, rx, ry).stroke({ width: 1.6, color: INK });
        }
      }
      if (layers.fog.visible) fog.paint();
      app.render();
      // The size of the last frame the GPU has finished, which the screen shows, so a test
      // or a capture knows the map has followed a resize. The element's size says it at once.
      const size = `${app.screen.width}x${app.screen.height}`;
      if (waitForGpu) {
        finish();
        finished(size);
      } else {
        pacer.rendered();
        fenced = size;
      }
      canvas.dataset['drawnState'] = String(stateId(current));
      return true;
    },
    focus(point, covered = { left: 0, top: 0, right: 0, bottom: 0 }) {
      const scale = Math.max(camera.scale, FOCUS_SCALE);
      const centre = {
        x: point.x - (covered.left - covered.right) / 2 / scale,
        y: point.y - (covered.top - covered.bottom) / 2 / scale,
      };
      camera = clampCamera({ centre, scale }, viewport(), map);
      cameraMoved = true;
    },
    destroy() {
      terrain.destroy();
      listening.abort();
      app.renderer.off('resize', onResize);
      seaRoot.destroy({ children: true });
      seaTexture.destroy(true);
      fog.destroy();
      armyLayer.destroy();
      app.destroy(true, { children: true, texture: true });
    },
  };
}
