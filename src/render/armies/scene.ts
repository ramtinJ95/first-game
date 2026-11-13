import type { DeepReadonly } from '../../sim/deep-readonly.ts';
import type { ArmyId, BattleId, CityId, FactionId, FormationId } from '../../sim/ids.ts';
import type { Sight } from '../../sim/sight.ts';
import type { Army, Stance } from '../../sim/state/army.ts';
import type { Battle } from '../../sim/state/battle.ts';
import type { City, CityRank } from '../../sim/state/city.ts';
import type { Formation } from '../../sim/state/formation.ts';
import type { GameState } from '../../sim/state/game-state.ts';
import type { MapPoint } from '../../sim/state/map-point.ts';
import { CITY_DEFENCES } from '../../sim/systems/sieges.ts';
import { TROOPS, type Troop } from '../../sim/troops.ts';
import { mapToScreen, type Camera, type Size } from '../camera.ts';
import type { Box } from '../labels.ts';
import { MOTIONS, MOUNTED, type FigureKind, type Motion } from '../figures/motions.ts';
import { OWNED, SHARED, artKey, figureKey, groundSpan, type GroundArt } from '../figures/sheet.ts';
import { factionColour, MINOR_COLOUR, POWER_COLOURS } from '../palette.ts';
import { figuresFor } from './count.ts';
import {
  block,
  column,
  extent,
  lineUp,
  parade,
  STANCE_LOOK,
  type Block,
  type Place,
  type Placed,
} from './layout.ts';
import { FADE_FROM, FALL_DAYS, STEP_DAYS, formationDay, type FormationDay } from './losses.ts';
import { seeded } from './seed.ts';
import { alongTrail, dayPath, trailLength } from './trail.ts';

/** The colours the sheet paints, in its order: the five powers, then every minor city. */
export const SHEET_COLOURS: readonly number[] = [...Object.values(POWER_COLOURS), MINOR_COLOUR];

/** Below this zoom, in px per km, an army is its flag. From it, its figures. */
export const FIGURE_SCALE = 0.9;
/** A man's height on screen at FIGURE_SCALE and at the closest zoom of 4 px per km. */
const HEIGHT_AT = { near: 54, far: 13 } as const;
const HEIGHT_POWER = Math.log(HEIGHT_AT.near / HEIGHT_AT.far) / Math.log(4 / FIGURE_SCALE);

/** A man's height on screen in px at a zoom, or 0 where armies are flags. */
export function figureHeight(scale: number): number {
  if (scale < FIGURE_SCALE) return 0;
  return HEIGHT_AT.far * (scale / FIGURE_SCALE) ** HEIGHT_POWER;
}

/** Offsets on the ground are drawn with their north-south part shortened, so a block reads as lying flat. */
const GROUND_Y = 0.62;

/** The share of an arrival day spent walking the road; the rest forms the army up. */
const ARRIVE = 0.7;
/** The days a sacked city burns and smokes after its sack, dying down over the last two. */
export const BURN_DAYS = 6;
/** Cycles per second of the motion clock, which runs with the game's days. */
const RATE: Record<Motion, number> = { stand: 0.25, march: 1.5, fight: 0.95, run: 1.9, fall: 1 };
const LINE_GAP_KM = 0;

export interface Sprite {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  /** A man's height in px at this sprite's scale. */
  readonly size: number;
  readonly mirror: boolean;
  readonly alpha: number;
  readonly rotation: number;
  /** Draw order: lower first. */
  readonly depth: number;
  /** The army a click on this sprite selects, and the box it answers to. */
  readonly army?: ArmyId;
  readonly hit?: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

export interface Scene {
  /** A man's height in px, or 0 where armies are flags. */
  readonly height: number;
  readonly sprites: Sprite[];
  /** Lines on the water behind ships, in screen px. */
  readonly wakes: { readonly points: readonly MapPoint[]; readonly alpha: number }[];
  /** Rings of ditch and bank round besieged cities, in screen px, already flattened. */
  readonly works: { readonly points: readonly MapPoint[] }[];
  /** Cities with worn walls, for the breaches drawn over their symbol. */
  readonly breaches: {
    readonly city: CityId;
    readonly x: number;
    readonly y: number;
    readonly share: number;
    readonly rank: CityRank;
    readonly growth: number;
  }[];
  /** Where each battle is drawn in map km, when it is moved clear of a city. */
  readonly battleAnchors: Map<BattleId, MapPoint>;
  /** The screen box round each army's figures, for its selection ring. */
  readonly armyBoxes: Map<ArmyId, { left: number; top: number; right: number; bottom: number }>;
}

export interface SceneInput {
  readonly previous: DeepReadonly<GameState>;
  readonly current: DeepReadonly<GameState>;
  readonly progress: number;
  readonly camera: Camera;
  readonly viewport: Size;
  readonly previousSight: Sight;
  readonly sight: Sight;
  /** Seconds of the motion clock: it runs with the game's days and stops while the game is paused. */
  readonly motion: number;
  /** Seconds of real time, which keeps fires, smoke, flags, and men at ease alive while paused. */
  readonly now: number;
  /** How much the city symbols have grown at this zoom. */
  readonly growth: number;
  /** Whether a screen point lies on land, so a camp is not pitched in the sea. */
  readonly land?: (screen: MapPoint) => boolean;
  /** Where each city's name is drawn on screen, which an army at the city keeps clear of. */
  readonly names?: ReadonlyMap<CityId, Box>;
  /** The town and village symbols and names drawn on screen, which a siege camp keeps clear of. */
  readonly keepClear?: readonly Box[];
}

type State = DeepReadonly<GameState>;
/** A city an army stands at, on screen: its x and how far its symbol and name reach to each side. */
interface Beside {
  readonly x: number;
  readonly clear: { readonly left: number; readonly right: number };
  /** Which side of the city its name stands on, or 0 above or below it. */
  readonly nameSide: number;
}
type Mode =
  | { kind: 'line'; anchor: MapPoint; facing: MapPoint; camp: boolean }
  | {
      kind: 'march';
      trail: MapPoint[];
      heading: MapPoint;
      /** Beaten and falling back: the ranks are loose. */
      beaten: boolean;
      /** Left a battle today, and runs before it falls into a walk. */
      fled: boolean;
    }
  | {
      kind: 'battle';
      battle: DeepReadonly<Battle>;
      anchor: MapPoint;
      facing: MapPoint;
      across: number;
      stance: Stance;
    }
  | { kind: 'siege'; city: DeepReadonly<City>; from: number; to: number }
  | { kind: 'sea' };

const RIGHT: MapPoint = { x: 1, y: 0 };
const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
const frac = (x: number) => x - Math.floor(x);

/**
 * A fighting horseman rides a loop round his place: forward and back by `radius` about a
 * centre `back` of it behind, and up and down the screen by `across`, in men's heights.
 * `along` is the reach of that loop behind and in front of his place.
 */
const CAVALRY_LOOP = {
  radius: 0.55,
  back: 0.4,
  across: 0.4,
  along: [-(1 + 0.4) * 0.55, (1 - 0.4) * 0.55],
} as const;
/** How far, in men's heights, a skirmishing line sways back from its place and returns. */
const SWAY = 0.5;
/** A storm's ladders and climbers are drawn over every rank of the siege. */
const STORM_DEPTH = 1e6;
/** How far `ladderArt` leans towards the wall for each pixel of its height, and its height in figure units of 100. */
const LADDER_LEAN = 0.12;
const LADDER_LENGTH = 0.7;
/** A climber's height as a share of a man's, so the ladder shows round him. */
const CLIMBER_SIZE = 0.6;
const STORM_ARROWS = 14;
/** How far the ring stands back from the wall on the day of a storm, in men's heights. */
const STORM_STEP_BACK = 0.8;
/** One man fights at the head of each ladder and one climbs below him, as shares of its length. */
const CLIMBERS = [
  { from: 0.82, span: 0.04, motion: 'fight' },
  { from: 0.25, span: 0.3, motion: 'march' },
] as const;
const CITY_HALF_WIDTH: Record<CityRank, number> = {
  capital: 16,
  greatPowerCity: 10.5,
  minorCity: 6.5,
};

export function colourIndex(state: State, faction: FactionId): number {
  return Math.max(0, SHEET_COLOURS.indexOf(factionColour(state, faction)));
}

function formationsOf(state: State, army: DeepReadonly<Army>): DeepReadonly<Formation>[] {
  return army.formations.flatMap((id) => state.formations[id] ?? []);
}

function frameOf(motion: Motion, phase: number): number {
  const { frames, loop } = MOTIONS[motion];
  return loop
    ? Math.floor(frac(phase) * frames) % frames
    : Math.min(frames - 1, Math.floor(phase * frames));
}

/** Everything the map draws for armies, battles, sieges, convoys, and columns this frame. */
export function buildScene(input: SceneInput): Scene {
  const height = figureHeight(input.camera.scale);
  const scene: Scene = {
    height,
    sprites: [],
    wakes: [],
    works: [],
    breaches: [],
    armyBoxes: new Map(),
    battleAnchors: new Map(),
  };
  if (height === 0) return scene;
  const ctx = new Context(input, height, scene);
  ctx.cities();
  ctx.armies();
  ctx.convoys();
  ctx.columns();
  scene.sprites.sort((a, b) => a.depth - b.depth);
  return scene;
}

interface FormationPlan {
  readonly id: FormationId | 'command';
  readonly troop: Troop;
  readonly day: FormationDay;
}

class Context {
  readonly input: SceneInput;
  readonly h: number;
  readonly scene: Scene;
  readonly margin: number;
  /** Fighting figures by battle and side, so arrows fly from one line to the other. */
  readonly battleLines = new Map<
    BattleId,
    {
      side: number;
      shooters: { x: number; y: number; troop: Troop }[];
      front: { x: number; y: number }[];
    }[]
  >();

  constructor(input: SceneInput, h: number, scene: Scene) {
    this.input = input;
    this.h = h;
    this.scene = scene;
    this.margin = 8 * h + 120;
  }

  screen(point: MapPoint): MapPoint {
    return mapToScreen(this.input.camera, this.input.viewport, point);
  }

  inView(point: MapPoint, extra = 0): boolean {
    const { width, height } = this.input.viewport;
    const m = this.margin + extra;
    return point.x > -m && point.y > -m && point.x < width + m && point.y < height + m;
  }

  /**
   * Whether the ground a picture covers at a screen point is land: a figure's feet or a
   * horse's hooves, or a tent's base, at either side of it, so nothing on a coast stands
   * half in the sea. `size` is the sprite's height, a man's height unless given.
   */
  dry(x: number, y: number, art: GroundArt, size = this.h): boolean {
    const land = this.input.land;
    if (!land) return true;
    const half = groundSpan(art) * size;
    return land({ x, y }) && land({ x: x - half, y }) && land({ x: x + half, y });
  }

  /** Whether a tent of either kind stands on land at a spot, since one of a camp's tents becomes the command tent. */
  tentDry(p: MapPoint): boolean {
    return this.dry(p.x, p.y, 'tent') && this.dry(p.x, p.y, 'commandTent');
  }

  /**
   * The nearest place within `NUDGE_RINGS` steps where the figure's ground is dry, for a
   * figure that the layout of its army could not keep on land, such as a man running from
   * a broken line toward the shore, or undefined when there is none, and it is not drawn.
   */
  nudge(x: number, y: number, kind: FigureKind): MapPoint | undefined {
    if (this.dry(x, y, kind)) return { x, y };
    for (let ring = 1; ring <= NUDGE_RINGS; ring++) {
      const r = ring * NUDGE_STEP * this.h;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const at = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * GROUND_Y };
        if (this.dry(at.x, at.y, kind)) return at;
      }
    }
    return undefined;
  }

  /** A km distance on the map in screen px. */
  px(km: number): number {
    return km * this.input.camera.scale;
  }

  push(sprite: Sprite) {
    this.scene.sprites.push(sprite);
  }

  // ---------------------------------------------------------------- modes

  mode(state: State, army: DeepReadonly<Army>, other: State, isPrevious: boolean): Mode {
    const { activity } = army;
    switch (activity.kind) {
      case 'idle': {
        const before = other.armies[army.id]?.activity;
        const camp = isPrevious
          ? false
          : before?.kind === 'idle' &&
            before.position.x === activity.position.x &&
            before.position.y === activity.position.y;
        return { kind: 'line', anchor: activity.position, facing: RIGHT, camp };
      }
      case 'marching':
      case 'retreating': {
        if (isPrevious) {
          const next = activity.waypoints[0] ?? activity.position;
          return {
            kind: 'march',
            trail: [activity.position, next],
            heading: unit(activity.position, next),
            beaten: activity.kind === 'retreating',
            fled: false,
          };
        }
        const before = other.armies[army.id]?.activity;
        const from = before && before.kind !== 'embarked' ? before.position : activity.position;
        const ahead =
          before?.kind === 'marching' || before?.kind === 'retreating'
            ? before.waypoints
            : [activity.position];
        const trail = dayPath(from, ahead, activity.position);
        // Only a beaten army retreats: a winner leaves the field on the march it was on.
        const beaten = activity.kind === 'retreating';
        return {
          kind: 'march',
          trail: trail.length > 1 ? trail : [from, activity.waypoints[0] ?? from],
          heading: unit(activity.position, activity.waypoints[0] ?? activity.position),
          beaten,
          fled: beaten && before?.kind === 'inBattle',
        };
      }
      case 'inBattle': {
        const battle = state.battles[activity.battle];
        if (!battle) return { kind: 'line', anchor: activity.position, facing: RIGHT, camp: false };
        return this.battleMode(state, battle, army);
      }
      case 'besieging': {
        const siege = state.sieges[activity.siege];
        const city = siege && state.cities[siege.city];
        if (!siege || !city)
          return { kind: 'line', anchor: activity.position, facing: RIGHT, camp: false };
        const index = Math.max(0, siege.besiegers.indexOf(army.id));
        const start = seeded(city.id) * Math.PI * 2;
        const share = (Math.PI * 2) / Math.max(1, siege.besiegers.length);
        return {
          kind: 'siege',
          city,
          from: start + index * share,
          to: start + (index + 1) * share,
        };
      }
      case 'embarked':
        return { kind: 'sea' };
    }
  }

  battleMode(
    state: State,
    battle: DeepReadonly<Battle>,
    army: DeepReadonly<Army>,
    anchor?: MapPoint,
  ): Mode {
    const centroid = (ids: readonly ArmyId[]) => {
      let x = 0;
      let count = 0;
      for (const id of ids) {
        const a = state.armies[id]?.activity;
        if (a && a.kind !== 'embarked') {
          x += a.position.x;
          count++;
        }
      }
      return count ? x / count : battle.position.x;
    };
    const attackersLeft = centroid(battle.attackers) <= centroid(battle.defenders);
    const attacker = battle.attackers.includes(army.id);
    const facingRight = attacker === attackersLeft;
    const side = attacker ? battle.attackers : battle.defenders;
    const widths = side.map((id) => {
      const other = state.armies[id];
      return other ? extent(lineUp(this.blocks(state, other, 'line', 1))).width + 0.6 : 0;
    });
    const total = widths.reduce((a, b) => a + b, 0);
    let across = -total / 2;
    for (const [i, id] of side.entries()) {
      if (id === army.id) {
        across += (widths[i] ?? 0) / 2;
        break;
      }
      across += widths[i] ?? 0;
    }
    return {
      kind: 'battle',
      battle,
      anchor: anchor ?? this.battleAnchor(state, battle),
      facing: facingRight ? RIGHT : { x: -1, y: 0 },
      across: facingRight ? across : -across,
      stance: army.stance,
    };
  }

  private anchors = new Map<string, MapPoint>();

  /**
   * Where a battle is drawn: at its place, or moved just clear of a city its lines
   * would cover, so the city and its name stay in sight, and then onto land where its
   * lines would stand in the sea. Both sides use the same point.
   */
  battleAnchor(state: State, battle: DeepReadonly<Battle>): MapPoint {
    const key = `${battle.id}:${state.day}`;
    const known = this.anchors.get(key);
    if (known) return known;
    const extentOf = (ids: readonly ArmyId[]) => {
      let width = 0;
      let depth = 0;
      for (const id of ids) {
        const army = state.armies[id];
        if (!army) continue;
        const line = extent(lineUp(this.blocks(state, army, 'line', 1)));
        width += line.width + 0.6;
        depth = Math.max(depth, line.depth);
      }
      return { width, depth };
    };
    const a = extentOf(battle.attackers);
    const d = extentOf(battle.defenders);
    const h = this.h;
    const half = {
      x: (Math.max(a.depth, d.depth) + 1.6) * h,
      y: (Math.max(a.width, d.width) / 2) * GROUND_Y * h + 1.2 * h,
    };
    const at = this.screen(battle.position);
    let shift = { x: 0, y: 0 };
    for (const city of this.citiesOf(state)) {
      const c = this.screen(city.position);
      const room = CITY_HALF_WIDTH[city.rank] * this.input.growth + 0.4 * h;
      const dx = at.x + shift.x - c.x;
      const dy = at.y + shift.y - c.y;
      if (Math.abs(dx) >= half.x + room || Math.abs(dy) >= half.y + room) continue;
      const moveX = (dx >= 0 ? 1 : -1) * (half.x + room) - dx;
      const moveY = (dy >= 0 ? 1 : -1) * (half.y + room) - dy;
      shift =
        Math.abs(moveX) <= Math.abs(moveY)
          ? { x: shift.x + moveX, y: shift.y }
          : { x: shift.x, y: shift.y + moveY };
    }
    const land = this.input.land;
    if (land) {
      // Every figure of both lines, commanders included, at the anchor so far, so one
      // shift moves the whole battle onto land.
      const scale = this.input.camera.scale;
      const near = {
        x: battle.position.x + shift.x / scale,
        y: battle.position.y + shift.y / scale,
      };
      const samples: MapPoint[] = [];
      for (const id of [...battle.attackers, ...battle.defenders]) {
        const army = state.armies[id];
        if (!army) continue;
        const layout = this.layout(
          state,
          army,
          this.battleMode(state, battle, army, near),
          'after',
        );
        if (layout instanceof LineLayout) samples.push(...layout.positions());
      }
      const extra = landShift(land, samples, h);
      shift = { x: shift.x + extra.x, y: shift.y + extra.y };
    }
    const scale = this.input.camera.scale;
    const anchor = {
      x: battle.position.x + shift.x / scale,
      y: battle.position.y + shift.y / scale,
    };
    this.anchors.set(key, anchor);
    if (state === this.input.current) this.scene.battleAnchors.set(battle.id, anchor);
    return anchor;
  }

  blocks(state: State, army: DeepReadonly<Army>, order: 'line' | 'column', spread: number) {
    return formationsOf(state, army).map((f) => ({
      troop: f.troop,
      block: block(f.troop, figuresFor(f.men), order, f.id, spread),
      id: f.id,
    }));
  }

  // ---------------------------------------------------------------- armies

  armies() {
    const { previous, current, sight, previousSight } = this.input;
    const seen = new Set<ArmyId>();
    for (const army of Object.values(current.armies)) {
      if (!sight.armies.has(army.id)) continue;
      seen.add(army.id);
      this.army(army, previous.armies[army.id]);
    }
    for (const army of Object.values(previous.armies)) {
      if (seen.has(army.id) || current.armies[army.id] || !previousSight.armies.has(army.id))
        continue;
      this.army(undefined, army);
    }
    this.projectiles();
  }

  /**
   * One army's figures between two days. Each figure is a slot of a formation: it is
   * placed as the day before placed it and as today places it, and the day's progress
   * moves it from one to the other in the way the change of activity calls for.
   */
  army(now: DeepReadonly<Army> | undefined, before: DeepReadonly<Army> | undefined) {
    const { previous, current, progress: p } = this.input;
    const record = (now ?? before) as DeepReadonly<Army>;
    const modeNow = now ? this.mode(current, now, previous, false) : undefined;
    const modeBefore = before ? this.mode(previous, before, current, true) : undefined;
    if (modeNow?.kind === 'sea' && (!modeBefore || modeBefore.kind === 'sea')) return;
    const probe = modeNow ?? modeBefore;
    if (
      !probe ||
      !this.inView(this.screen(this.anchorOf(probe)), this.reachOf(record, modeNow, modeBefore))
    )
      return;

    const colour = colourIndex(current, record.owner);
    const formationIds: FormationId[] = [...(before?.formations ?? [])];
    for (const id of now?.formations ?? []) if (!formationIds.includes(id)) formationIds.push(id);
    const plans: FormationPlan[] = [];
    for (const id of formationIds) {
      const was = before ? previous.formations[id] : undefined;
      const is = now ? current.formations[id] : undefined;
      const troop = (is ?? was)?.troop;
      if (!troop) continue;
      const files = block(troop, figuresFor((is ?? was)?.men ?? 0), 'line', id).files;
      plans.push({ id, troop, day: formationDay(was, is, current.day, files * 2) });
    }
    const command = record.generalSkill > 0 ? COMMAND_KINDS : COMMAND_KINDS.slice(0, 1);

    const beforeLayout =
      before && modeBefore ? this.layout(previous, before, modeBefore, 'before') : undefined;
    const nowLayout = now && modeNow ? this.layout(current, now, modeNow, 'after') : undefined;
    const nowLayoutBefore =
      now && modeNow ? this.layout(current, now, modeNow, 'before') : undefined;

    // An army that arrives today walks the rest of its road in column before it forms
    // up, so it does not cut across from where it stood to where it rests.
    let arrival: Layout | undefined;
    if (
      (before?.activity.kind === 'marching' || before?.activity.kind === 'retreating') &&
      now &&
      now.activity.kind !== 'embarked' &&
      (modeNow?.kind === 'line' || modeNow?.kind === 'siege')
    ) {
      const trail = dayPath(
        before.activity.position,
        before.activity.waypoints,
        now.activity.position,
      );
      const end = trail[trail.length - 1] as MapPoint;
      const heading = trail.length > 1 ? unit(trail[trail.length - 2] as MapPoint, end) : RIGHT;
      arrival = this.layout(
        previous,
        before,
        { kind: 'march', trail, heading, beaten: false, fled: false },
        'before',
      );
    }
    const transition = arrival
      ? { weight: smooth((p - ARRIVE) / (1 - ARRIVE)), rout: false }
      : this.transition(modeBefore, modeNow, p);
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    const pickable = !!now;

    const place = (
      layout: Layout | undefined,
      mode: Mode | undefined,
      id: FormationId | 'command',
      slot: number,
      at: number,
    ): Located | undefined => (layout && mode ? layout.locate(id, slot, at) : undefined);

    const draw = (kind: FigureKind, plan: FormationPlan | undefined, slot: number) => {
      const id = plan?.id ?? 'command';
      const key = `${record.id}:${id}:${slot}`;
      const day = plan?.day;
      const fall = day?.falls.find((f) => f.slot === slot);
      const step = day?.steps.find((s) => s.from === slot);
      const gone = !step && day !== undefined && slot >= day.after && !fall;
      if (gone) return;

      // Where the figure is drawn as yesterday left it and as today has it.
      const start = arrival
        ? arrival.locate(id, slot, Math.min(1, p / ARRIVE))
        : place(beforeLayout, modeBefore, id, slot, 0);
      const endSlot = step ? step.to : slot;
      let end: Located | undefined;
      if (nowLayout && modeNow && nowLayoutBefore) {
        const early = nowLayoutBefore.locate(id, slot, p);
        const late = nowLayout.locate(id, endSlot, p) ?? early;
        const shift = step ? smooth((p - step.at) / STEP_DAYS) : smooth(p);
        end = early && late ? mix(early, late, shift) : (late ?? early);
      }
      let at: Located | undefined;
      let moving = false;
      let alpha = 1;
      if (start && end) {
        at = mix(start, end, transition.weight);
        moving =
          transition.weight > 0 &&
          transition.weight < 1 &&
          Math.hypot(end.x - start.x, end.y - start.y) > 0.3 * this.h;
        // Men falling into a column face the way it marches; others face the way they move.
        if (moving)
          at = {
            ...at,
            facing:
              modeNow?.kind === 'march' ? end.facing : Math.sign(end.x - start.x) || at.facing,
          };
      } else {
        at = end ?? start;
        if (!start && end) alpha = smooth(p * 1.5);
        if (start && !end)
          alpha = modeNow?.kind === 'sea' ? 1 - smooth(p * 1.5) : fall ? 1 : 1 - smooth(p * 1.5);
      }
      if (!at) return;

      let motion: Motion = at.motion;
      let facing = at.facing;
      let phase =
        this.input.motion * RATE[motion] * (0.92 + 0.16 * seeded(key, 1)) + seeded(key, 2);
      let x = at.x;
      let y = at.y;
      if (moving) motion = 'march';
      if (step && p >= step.at && p < step.at + STEP_DAYS) motion = 'march';

      if (day?.breaksAt !== undefined && p >= day.breaksAt) {
        const fled = Math.min(1.6, (p - day.breaksAt) * 5);
        x -= at.facing * fled * this.h;
        motion = fled < 1.6 ? 'run' : 'stand';
        facing = -at.facing;
      } else if (
        day?.broken &&
        (modeNow?.kind === 'battle' || modeBefore?.kind === 'battle') &&
        modeNow?.kind !== 'march'
      ) {
        x -= at.facing * 1.6 * this.h;
        motion = 'stand';
        facing = -at.facing;
      }
      if (transition.rout && (!fall || p < fall.at)) {
        const t0 = 0.08 + seeded(key, 3) * 0.2;
        if (p >= t0) {
          motion = 'run';
          facing = -(start?.facing ?? at.facing);
        }
      }
      if (fall && p >= fall.at) {
        motion = 'fall';
        phase = (p - fall.at) / FALL_DAYS;
        if (start) {
          x = start.x + (end ? (end.x - start.x) * transition.weight : 0);
          y = start.y + (end ? (end.y - start.y) * transition.weight : 0);
        }
        if (p > FADE_FROM) alpha *= 1 - (p - FADE_FROM) / (1 - FADE_FROM);
      }
      if (motion === 'stand')
        phase = this.input.now * RATE.stand * (0.8 + 0.4 * seeded(key, 4)) + seeded(key, 2);
      if (motion === 'fight' && at.cavalryLoop) {
        const loop = this.input.motion * 0.22 + seeded(key, 5);
        const angle = loop * Math.PI * 2;
        x += at.facing * (Math.sin(angle) - CAVALRY_LOOP.back) * CAVALRY_LOOP.radius * this.h;
        y += Math.cos(angle) * CAVALRY_LOOP.across * this.h * GROUND_Y;
        facing = Math.cos(angle) >= 0 ? at.facing : -at.facing;
      }

      const ground = this.nudge(x, y, kind);
      if (!ground) return;
      x = ground.x;
      y = ground.y;
      const usable = motionFor(kind, motion);
      const frame = frameOf(usable, usable === 'fall' ? Math.min(0.999, phase) : phase);
      const mounted = MOUNTED.has(kind);
      const half = (mounted ? 0.5 : 0.2) * this.h;
      const top = (mounted ? 1.35 : 0.95) * this.h;
      const lying = usable === 'fall';
      const hit =
        pickable && !lying
          ? { left: x - half, top: y - top, right: x + half, bottom: y + 0.05 * this.h }
          : undefined;
      if (hit) {
        box.left = Math.min(box.left, hit.left);
        box.top = Math.min(box.top, hit.top);
        box.right = Math.max(box.right, hit.right);
        box.bottom = Math.max(box.bottom, hit.bottom);
      }
      this.push({
        key: `${figureKey(kind, usable, frame)}@${colour}`,
        x,
        y,
        size: this.h,
        mirror: facing < 0,
        alpha,
        rotation: 0,
        depth: y,
        ...(hit && now ? { army: now.id, hit } : {}),
      });
      if (at.battle && motion === 'fight')
        this.noteFighter(at.battle, at.side, x, y, plan?.troop, at.front);
    };

    for (const plan of plans) {
      const count = Math.max(plan.day.before, plan.day.after);
      for (let slot = 0; slot < count; slot++) draw(plan.troop, plan, slot);
    }
    command.forEach((kind, slot) => draw(kind, undefined, slot));

    if (now && box.left < Infinity) this.scene.armyBoxes.set(now.id, box);
    if (modeNow?.kind === 'line' && modeNow.camp && nowLayout)
      this.camp(nowLayout, colour, record.id);
    if (modeNow?.kind === 'siege' && nowLayout instanceof RingLayout)
      this.siegeCamp(modeNow, nowLayout, colour, record.id);
    const won =
      modeBefore?.kind === 'battle' &&
      (modeNow?.kind === 'line' || (modeNow?.kind === 'march' && !modeNow.beaten));
    if (won) this.victory(modeBefore, colour, p);
  }

  /**
   * How far in screen px any figure of the army may stand from its anchor on either day:
   * a column as long as all its formations in column, plus the road walked today. Its
   * figures stand within it of the anchor, so an army is skipped only when all are out of view.
   */
  reachOf(army: DeepReadonly<Army>, ...modes: (Mode | undefined)[]): number {
    const { previous, current, camera } = this.input;
    let length = 2;
    for (const id of army.formations) {
      const formation = current.formations[id] ?? previous.formations[id];
      if (!formation) continue;
      const column = block(formation.troop, figuresFor(formation.men), 'column', id);
      const line = block(formation.troop, figuresFor(formation.men), 'line', id);
      length += Math.max(column.depth, line.width) + 1;
    }
    let road = 0;
    for (const mode of modes) {
      if (mode?.kind === 'march') road = Math.max(road, trailLength(mode.trail) * camera.scale);
    }
    return length * this.h + road;
  }

  anchorOf(mode: Mode): MapPoint {
    switch (mode.kind) {
      case 'line':
      case 'battle':
        return mode.anchor;
      case 'march':
        return mode.trail[mode.trail.length - 1] as MapPoint;
      case 'siege':
        return mode.city.position;
      case 'sea':
        return { x: -1e9, y: -1e9 };
    }
  }

  transition(
    before: Mode | undefined,
    now: Mode | undefined,
    p: number,
  ): { weight: number; rout: boolean } {
    if (!before || !now) return { weight: 1, rout: false };
    if (before.kind === now.kind && before.kind !== 'battle') return { weight: 1, rout: false };
    if (before.kind === 'battle' && now.kind === 'battle') return { weight: 1, rout: false };
    if (now.kind === 'battle') return { weight: smooth(p / 0.55), rout: false };
    // Besiegers who took a city hold the walls for most of the day before they form up.
    if (before.kind === 'siege' && now.kind === 'line')
      return { weight: smooth((p - 0.75) / 0.25), rout: false };
    if (before.kind === 'battle' && now.kind === 'line')
      return { weight: smooth((p - 0.45) / 0.5), rout: false };
    if (before.kind === 'battle' && now.kind === 'march')
      return { weight: smooth((p - 0.35) / 0.6), rout: now.fled };
    return { weight: smooth(p / 0.6), rout: false };
  }

  // ---------------------------------------------------------------- layouts

  layout(
    state: State,
    army: DeepReadonly<Army>,
    mode: Mode,
    which: 'before' | 'after',
  ): Layout | undefined {
    const counts = new Map<FormationId, number>();
    for (const id of army.formations) {
      const is = state.formations[id];
      if (!is) continue;
      const day = which === 'after' ? is.men : (this.input.previous.formations[id] ?? is).men;
      counts.set(id, figuresFor(state === this.input.previous ? is.men : day));
    }
    const formations = army.formations.flatMap((id) => {
      const is = state.formations[id];
      if (!is) return [];
      const count = counts.get(id) ?? 0;
      return [{ id, troop: is.troop, count }];
    });
    switch (mode.kind) {
      case 'sea':
        return undefined;
      case 'line':
      case 'battle': {
        const spread = mode.kind === 'battle' ? STANCE_LOOK[mode.stance].spread : 1;
        const blocks = formations.map((f) => ({
          ...f,
          block: block(f.troop, f.count, 'line', f.id, spread),
        }));
        const placed = mode.kind === 'battle' ? lineUp(blocks) : parade(blocks);
        const depth = extent(placed).depth;
        return new LineLayout(
          this,
          mode,
          blocks,
          placed,
          depth,
          mode.kind === 'line' ? this.besideCity(state, mode.anchor) : undefined,
        );
      }
      case 'march': {
        const blocks = formations.map((f) => ({
          ...f,
          block: block(f.troop, f.count, 'column', f.id, mode.beaten ? 1.4 : 1),
        }));
        return new ColumnLayout(this, mode, blocks, column(blocks, 0.7));
      }
      case 'siege':
        return new RingLayout(this, mode, formations);
    }
  }

  /** The city an army at rest stands at, on screen, with the half width of its symbol. */
  private cityList = new Map<State, DeepReadonly<City>[]>();

  citiesOf(state: State): DeepReadonly<City>[] {
    let cities = this.cityList.get(state);
    if (!cities) {
      cities = Object.values(state.cities);
      this.cityList.set(state, cities);
    }
    return cities;
  }

  besideCity(state: State, at: MapPoint): Beside | undefined {
    for (const city of this.citiesOf(state)) {
      if (Math.abs(city.position.x - at.x) > 12 || Math.abs(city.position.y - at.y) > 12) continue;
      const x = this.screen(city.position).x;
      const half = CITY_HALF_WIDTH[city.rank] * this.input.growth;
      const name = this.input.names?.get(city.id);
      return {
        x,
        clear: {
          right: Math.max(half, name ? name.right - x : 0),
          left: Math.max(half, name ? x - name.left : 0),
        },
        nameSide: name ? Math.sign((name.left + name.right) / 2 - x) : 0,
      };
    }
    return undefined;
  }

  noteFighter(
    battle: BattleId,
    side: number,
    x: number,
    y: number,
    troop: Troop | undefined,
    front: boolean,
  ) {
    let lines = this.battleLines.get(battle);
    if (!lines) {
      lines = [];
      this.battleLines.set(battle, lines);
    }
    let line = lines.find((l) => l.side === side);
    if (!line) {
      line = { side, shooters: [], front: [] };
      lines.push(line);
    }
    if (troop && TROOPS[troop].category === 'missile') line.shooters.push({ x, y, troop });
    else if (troop === 'lightCavalry') line.shooters.push({ x, y, troop });
    if (front) line.front.push({ x, y });
  }

  // ---------------------------------------------------------------- the field

  camp(layout: Layout, colour: number, army: ArmyId) {
    const dry = (side: 1 | -1) => {
      const spots = layout.campSpots(side);
      return {
        tents: spots.tents.filter((p) => this.tentDry(p)),
        fires: spots.fires.filter((p) => this.dry(p.x, p.y, 'fire')),
        all: spots.tents.length,
      };
    };
    const behind = dry(-1);
    const spots = behind.tents.length * 2 >= behind.all ? behind : dry(1);
    spots.tents.forEach((spot, i) => {
      this.push({
        key: `${artKey(i === 0 ? 'commandTent' : 'tent')}@${colour}`,
        x: spot.x,
        y: spot.y,
        size: this.h,
        mirror: seeded(army, i) < 0.5,
        alpha: 1,
        rotation: 0,
        depth: spot.y,
      });
    });
    spots.fires.forEach((spot, i) => this.fire(spot, `${army}:${i}`, 1));
    this.arms(spots.tents.slice(1), colour, army);
  }

  siegeCamp(
    mode: Extract<Mode, { kind: 'siege' }>,
    layout: RingLayout,
    colour: number,
    army: ArmyId,
  ) {
    const field = layout.field();
    const tents = field.tents.filter((p) => this.tentDry(p));
    const fires = field.fires.filter((p) => this.dry(p.x, p.y, 'fire'));
    const stakes = field.stakes.filter((p) => this.dry(p.x, p.y, 'stakes', this.h * 0.75));
    tents.forEach((spot, i) => {
      const key = `${artKey(i === Math.floor(tents.length / 2) ? 'commandTent' : 'tent')}@${colour}`;
      this.push({
        key,
        x: spot.x,
        y: spot.y,
        size: this.h,
        mirror: seeded(army, i) < 0.5,
        alpha: 1,
        rotation: 0,
        depth: spot.y,
      });
    });
    fires.forEach((spot, i) => this.fire(spot, `${army}:siege:${i}`, 1));
    this.arms(
      tents.filter((_, i) => i % 2 === 1),
      colour,
      army,
    );
    stakes.forEach((spot, i) => {
      this.push({
        key: artKey('stakes'),
        x: spot.x,
        y: spot.y,
        size: this.h * 0.75,
        mirror: i % 2 === 1,
        alpha: 1,
        rotation: 0,
        depth: spot.y,
      });
    });
    this.scene.works.push({ points: layout.works() });
  }

  /** A stack of arms beside each tent, set off towards the army. */
  arms(tents: readonly MapPoint[], colour: number, army: ArmyId) {
    tents.forEach((tent, i) => {
      const x = tent.x + (seeded(army, 40 + i) < 0.5 ? -1 : 1) * 0.55 * this.h;
      const y = tent.y + 0.18 * this.h;
      if (!this.dry(x, y, 'arms', this.h * 0.95)) return;
      this.push({
        key: `${artKey('arms')}@${colour}`,
        x,
        y,
        size: this.h * 0.95,
        mirror: false,
        alpha: 1,
        rotation: 0,
        depth: y,
      });
    });
  }

  fire(spot: MapPoint, key: string, size: number) {
    const frame = Math.floor(frac(this.input.now * 1.6 + seeded(key)) * SHARED.fire) % SHARED.fire;
    this.push({
      key: artKey('fire', frame),
      x: spot.x,
      y: spot.y,
      size: this.h * size,
      mirror: false,
      alpha: 1,
      rotation: 0,
      depth: spot.y,
    });
    for (let i = 0; i < 3; i++) {
      const age = frac(this.input.now / 4 + seeded(key, i) + i / 3);
      this.push({
        key: artKey('smoke'),
        x: spot.x + Math.sin(age * 3 + i) * 0.15 * this.h + age * 0.4 * this.h,
        y: spot.y - (0.35 + age * 1.3) * this.h * size,
        size: this.h * (0.35 + age * 0.6) * size,
        mirror: false,
        alpha: 0.5 * Math.sin(Math.PI * age),
        rotation: 0,
        depth: 1e7 + spot.y,
      });
    }
  }

  victory(mode: Extract<Mode, { kind: 'battle' }>, colour: number, p: number) {
    const at = this.screen(mode.anchor);
    const x = at.x - mode.facing.x * 0.2 * this.h + mode.across * this.h * 0;
    const rise = smooth(p / 0.35);
    const fade = 1 - smooth((p - 0.55) / 0.3);
    if (fade <= 0) return;
    const frame = Math.floor(frac(this.input.now * 1.4) * OWNED.standard) % OWNED.standard;
    this.push({
      key: `${artKey('standard', frame)}@${colour}`,
      x,
      y: at.y + (1 - rise) * 0.9 * this.h,
      size: this.h * 1.3,
      mirror: mode.facing.x < 0,
      alpha: fade,
      rotation: 0,
      depth: at.y + 1,
    });
  }

  projectiles() {
    for (const [battle, lines] of this.battleLines) {
      for (const line of lines) {
        const enemy = lines.find((l) => l.side !== line.side);
        if (!enemy || enemy.front.length === 0) continue;
        const flights = Math.min(24, Math.ceil(line.shooters.length * 0.7));
        for (let i = 0; i < flights; i++) {
          const key = `${battle}:${line.side}:${i}`;
          const from = line.shooters[Math.floor(seeded(key, 1) * line.shooters.length)];
          const to = enemy.front[Math.floor(seeded(key, 2) * enemy.front.length)];
          if (!from || !to) continue;
          const t = frac(this.input.motion * 0.9 + seeded(key, 3));
          const javelin = from.troop !== 'archers';
          const sx = from.x;
          const sy = from.y - 0.75 * this.h;
          const ex = to.x + (seeded(key, 4) - 0.5) * 0.6 * this.h;
          const ey = to.y - 0.45 * this.h;
          const lift = (javelin ? 0.5 : 1.1) * this.h + Math.abs(ex - sx) * (javelin ? 0.15 : 0.35);
          const x = sx + (ex - sx) * t;
          const y = sy + (ey - sy) * t - lift * 4 * t * (1 - t);
          const dx = ex - sx;
          const dy = ey - sy - lift * 4 * (1 - 2 * t);
          this.push({
            key: artKey(javelin ? 'javelin' : 'arrow'),
            x,
            y,
            size: this.h * (javelin ? 0.55 : 0.6),
            mirror: false,
            alpha: Math.min(1, t * 6, (1 - t) * 8),
            rotation: Math.atan2(dy, dx),
            depth: 1e7 + y,
          });
        }
      }
      this.dust(battle, lines);
    }
  }

  dust(battle: BattleId, lines: { front: { x: number; y: number }[] }[]) {
    const front = lines.flatMap((l) => l.front);
    if (front.length === 0) return;
    const count = Math.min(18, Math.ceil(front.length / 3));
    for (let i = 0; i < count; i++) {
      const key = `${battle}:dust:${i}`;
      const spot = front[Math.floor(seeded(key, 1) * front.length)];
      if (!spot) continue;
      const age = frac(this.input.now / 3.2 + seeded(key, 2));
      this.push({
        key: artKey('dust'),
        x: spot.x + (seeded(key, 3) - 0.5) * 0.8 * this.h + age * 0.3 * this.h,
        y: spot.y - (0.2 + age * 0.9) * this.h,
        size: this.h * (0.5 + age * 0.9),
        mirror: false,
        alpha: 0.45 * Math.sin(Math.PI * age),
        rotation: 0,
        depth: 1e7 + spot.y,
      });
    }
  }

  // ---------------------------------------------------------------- cities

  cities() {
    const { previous, current, sight, progress: p } = this.input;
    for (const city of Object.values(current.cities)) {
      const at = this.screen(city.position);
      if (!this.inView(at)) continue;
      const seen = sight.sees(city.position) || city.owner === current.player;
      const growth = this.input.growth;
      const before = previous.cities[city.id];
      const full = CITY_DEFENCES[city.rank].walls;
      if (seen && city.walls < full * 0.98) {
        this.scene.breaches.push({
          city: city.id,
          x: at.x,
          y: at.y,
          share: city.walls / full,
          rank: city.rank,
          growth,
        });
      }
      const top = at.y - 12 * growth;
      const fell = before && before.owner !== city.owner;
      if (fell || city.fellOn !== null) {
        const rise = fell ? smooth((p - 0.25) / 0.6) : 1;
        const frame =
          Math.floor(frac(this.input.now * 1.4 + seeded(city.id)) * OWNED.standard) %
          OWNED.standard;
        this.push({
          key: `${artKey('standard', frame)}@${colourIndex(current, city.owner)}`,
          x: at.x + 2 * growth,
          y: top + (1 - rise) * 0.8 * this.h,
          size: this.h * 1.5,
          mirror: false,
          alpha: smooth(rise * 3),
          rotation: 0,
          depth: at.y + 2,
        });
      }
      // Days since the sack applied: 0 through the day the order is played, then rising.
      const sacked = city.sackedOn === null ? undefined : current.day - 1 - city.sackedOn + p;
      if (seen && sacked !== undefined && sacked < BURN_DAYS) {
        const kindle = smooth(sacked * 3);
        const die = 1 - smooth((sacked - (BURN_DAYS - 2)) / 2);
        this.burn(city.id, at, growth, Math.min(kindle, die));
      }
      this.storm(city, at);
    }
  }

  burn(id: CityId, at: MapPoint, growth: number, strength: number) {
    const half = 12 * growth;
    for (let i = 0; i < 4; i++) {
      const x = at.x + (seeded(id, i) - 0.5) * 1.5 * half;
      const y = at.y + 2 * growth - seeded(id, i + 7) * 6 * growth;
      const frame =
        Math.floor(frac(this.input.now * 1.8 + seeded(id, i + 3)) * SHARED.blaze) % SHARED.blaze;
      this.push({
        key: artKey('blaze', frame),
        x,
        y,
        size: this.h * (0.85 + 0.3 * seeded(id, i + 11)) * strength,
        mirror: i % 2 === 1,
        alpha: strength,
        rotation: 0,
        depth: at.y + 3 + i,
      });
    }
    for (let i = 0; i < 16; i++) {
      const age = frac(this.input.now / 7 + i / 16 + seeded(id, i + 20) * 0.05);
      const column = (i % 3) - 1;
      const x =
        at.x +
        column * half * 0.55 +
        Math.sin(age * 4 + i) * 0.15 * this.h +
        age * age * 2.4 * this.h;
      this.push({
        key: artKey('smoke'),
        x,
        y: at.y - half * 0.4 - age * 4.2 * this.h,
        size: this.h * (1.1 + age * 3),
        mirror: i % 2 === 0,
        alpha: 0.85 * strength * Math.sin(Math.PI * Math.min(1, age * 1.15)) * (1 - age * 0.3),
        rotation: 0,
        depth: 1e7 + at.y - age,
      });
    }
  }

  private storms = new Map<CityId, ArmyId | undefined>();

  /**
   * The first besieger of a city stormed today, or undefined. A storm is the day's only
   * cause of heavy losses among besiegers who stayed at the siege or took the city.
   */
  stormedBy(id: CityId): ArmyId | undefined {
    if (this.storms.has(id)) return this.storms.get(id);
    const { previous, current, sight } = this.input;
    const city = current.cities[id];
    const siege = Object.values(previous.sieges).find((s) => s.city === id);
    let before = 0;
    let after = 0;
    let stayed = Boolean(city && siege);
    for (const army of siege?.besiegers ?? []) {
      const was = previous.armies[army];
      const is = current.armies[army];
      if (!was || !sight.armies.has(army)) continue;
      // A storm leaves its armies at the siege, or beside the city it took. An army that
      // left in the day, as to a relief battle, lost its men elsewhere.
      stayed &&=
        is?.activity.kind === 'besieging' ||
        (is?.activity.kind === 'idle' && city?.owner === is.owner);
      before += formationsOf(previous, was).reduce((sum, f) => sum + f.men, 0);
      after += is ? formationsOf(current, is).reduce((sum, f) => sum + f.men, 0) : 0;
    }
    const by = stayed && before > 0 && after <= before * 0.97 ? siege?.besiegers[0] : undefined;
    this.storms.set(id, by);
    return by;
  }

  storm(city: DeepReadonly<City>, at: MapPoint) {
    const { current, progress: p } = this.input;
    const first = this.stormedBy(city.id);
    if (!first) return;
    const growth = this.input.growth;
    const half = CITY_HALF_WIDTH[city.rank] * growth;
    const fade = 1 - smooth((p - 0.85) / 0.15);
    const owner = this.input.previous.armies[first]?.owner;
    const colour = owner ? colourIndex(current, owner) : 0;
    const ladders = 2;
    // The rules resolve a storm at once, so the ladders stand from the start of the day,
    // from the first rank of the ring to the top of the front wall. They and their
    // climbers are drawn over the ranks, and each ladder carries one man small enough that
    // its rungs show above and below him, so the storm reads at a glance.
    const foot =
      at.y + (ringRadius(city.rank, growth, this.h) + STORM_STEP_BACK * this.h) * GROUND_Y;
    // The heads rise above the wall, as a ladder set against it does.
    const top = at.y - 4 * growth - 0.25 * this.h;
    const length = foot - top;
    for (let i = 0; i < ladders; i++) {
      const x = at.x + (i === 0 ? -0.5 : 0.5) * half;
      // Every ladder leans the same way, as a row set against one wall.
      const mirror = false;
      const lean = LADDER_LEAN * length;
      const base = x - lean;
      this.push({
        key: artKey('ladder'),
        x: base,
        y: foot,
        size: length / LADDER_LENGTH,
        mirror,
        alpha: fade,
        rotation: 0,
        depth: STORM_DEPTH + i * 2,
      });
      for (const [k, climber] of CLIMBERS.entries()) {
        const key = `${city.id}:storm:${i}:${k}`;
        const climb = climber.from + climber.span * frac(this.input.motion * 0.3 + seeded(key));
        const kind: FigureKind = seeded(key, 1) < 0.5 ? 'swordsmen' : 'spearmen';
        const frame = frameOf(
          climber.motion,
          this.input.motion * RATE[climber.motion] + seeded(key, 2),
        );
        this.push({
          key: `${figureKey(kind, climber.motion, frame)}@${colour}`,
          x: base + climb * lean,
          y: foot - climb * length,
          size: this.h * CLIMBER_SIZE,
          mirror,
          alpha: fade,
          rotation: 0,
          depth: STORM_DEPTH + i * 4 + 1 + k,
        });
      }
    }
    // A volley flies over the walls from the ring, so a storm reads at a glance.
    const reach = ringRadius(city.rank, growth, this.h) + (STORM_STEP_BACK + 1.6) * this.h;
    const land = this.input.land ?? (() => true);
    for (let i = 0; i < STORM_ARROWS; i++) {
      const key = `${city.id}:volley:${i}`;
      const a = Math.PI * (0.15 + 0.7 * seeded(key, 1));
      const sx = at.x + Math.cos(a) * reach;
      const sy = at.y + Math.sin(a) * reach * GROUND_Y - 0.75 * this.h;
      if (!land({ x: sx, y: sy + 0.75 * this.h })) continue;
      const ex = at.x + (seeded(key, 2) - 0.5) * 1.6 * half;
      const ey = top + 0.15 * this.h;
      const t = frac(this.input.motion * 0.9 + seeded(key, 3));
      const lift = 0.5 * this.h + Math.abs(ex - sx) * 0.15;
      const y = sy + (ey - sy) * t - lift * 4 * t * (1 - t);
      this.push({
        key: artKey('arrow'),
        x: sx + (ex - sx) * t,
        y,
        size: this.h * 0.6,
        mirror: false,
        alpha: fade * Math.min(1, t * 6, (1 - t) * 8),
        rotation: Math.atan2(ey - sy - lift * 4 * (1 - 2 * t), ex - sx),
        depth: 1e7 + y,
      });
    }
  }

  // ---------------------------------------------------------------- sea and road

  convoys() {
    const { previous, current, sight, progress: p } = this.input;
    for (const convoy of Object.values(current.convoys)) {
      if (!sight.convoys.has(convoy.id)) continue;
      const before = previous.convoys[convoy.id];
      const trail = before
        ? dayPath(before.position, before.waypoints, convoy.position)
        : [convoy.position, convoy.waypoints[0] ?? convoy.position];
      const fresh = !before;
      const head = fresh ? 0 : p * trailLength(trail);
      const startPoint = trail[0] ?? convoy.position;
      const headAt = fresh
        ? { point: startPoint, heading: unit(startPoint, convoy.waypoints[0] ?? startPoint) }
        : alongTrail(trail, head);
      if (!this.inView(this.screen(headAt.point))) continue;
      const men = convoy.armies.reduce((sum, id) => {
        const army = current.armies[id];
        return sum + (army ? formationsOf(current, army).reduce((s, f) => s + f.men, 0) : 0);
      }, 0);
      const ships = Math.max(1, Math.min(6, Math.ceil(men / 400)));
      const colour = colourIndex(current, convoy.owner);
      const length = 2.1 * this.h * 0.9;
      const kmPerPx = 1 / this.input.camera.scale;
      const army = convoy.armies[0];
      const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (let i = 0; i < ships; i++) {
        const row = Math.ceil(i / 2);
        const side = i === 0 ? 0 : i % 2 ? -1 : 1;
        const back = row * length * 0.8;
        const on = alongTrail(trail, head - back * kmPerPx, headAt.heading);
        const base = this.screen(on.point);
        const normal = { x: -on.heading.y, y: on.heading.x };
        const key = `${convoy.id}:${i}`;
        const bob = Math.sin(this.input.now * 1.4 + seeded(key) * 6) * 0.04 * this.h;
        const x = base.x + normal.x * side * length * 0.45;
        const y = base.y + normal.y * side * length * 0.45 * GROUND_Y + bob;
        const frame =
          Math.floor(frac(this.input.motion * 0.8 + seeded(key, 1)) * OWNED.ship) % OWNED.ship;
        const mirror = on.heading.x < 0;
        const alpha = fresh ? smooth(p * 2) : 1;
        const hit = {
          left: x - length / 2,
          top: y - 1.3 * this.h,
          right: x + length / 2,
          bottom: y + 0.2 * this.h,
        };
        box.left = Math.min(box.left, hit.left);
        box.top = Math.min(box.top, hit.top);
        box.right = Math.max(box.right, hit.right);
        box.bottom = Math.max(box.bottom, hit.bottom);
        this.push({
          key: `${artKey('ship', frame)}@${colour}`,
          x,
          y,
          size: this.h * 0.9,
          mirror,
          alpha,
          rotation: 0,
          depth: y,
          ...(army ? { army, hit } : {}),
        });
        const stern = {
          x: x - on.heading.x * length * 0.45,
          y: y + 0.05 * this.h - on.heading.y * length * 0.45,
        };
        for (const spread of [-1, 1]) {
          for (let k = 0; k < 4; k++) {
            const points: MapPoint[] = [];
            for (let j = 0; j <= 3; j++) {
              const t = (k + j / 3) / 4;
              const d = t * length * 1.1;
              const w = (0.12 + t * 0.55) * length * 0.5 * spread;
              const ripple = Math.sin(this.input.now * 2.2 + t * 9 + i) * 0.6;
              points.push({
                x: stern.x - on.heading.x * d + normal.x * w,
                y: stern.y - on.heading.y * d + normal.y * w * GROUND_Y + ripple,
              });
            }
            this.scene.wakes.push({ points, alpha: alpha * 0.75 * (1 - k / 4) });
          }
        }
      }
      if (army && box.left < Infinity) {
        for (const id of convoy.armies) this.scene.armyBoxes.set(id, box);
      }
    }
  }

  columns() {
    const { previous, current, sight, progress: p } = this.input;
    for (const column of Object.values(current.refugeeColumns)) {
      if (!sight.refugeeColumns.has(column.id)) continue;
      const before = previous.refugeeColumns[column.id];
      const day = before
        ? dayPath(before.position, before.waypoints, column.position)
        : [column.position];
      const walking = trailLength(day) > 0.01;
      // The road back to the city the people left: the column never reaches past it.
      const gate = current.cities[column.from]?.position;
      const trail = gate ? [gate, ...day] : day;
      const head = trailLength(trail) - (1 - p) * trailLength(day);
      const end = trail[trail.length - 1] ?? column.position;
      const heading = column.waypoints[0]
        ? unit(end, column.waypoints[0])
        : trail.length > 1
          ? unit(trail[trail.length - 2] as MapPoint, end)
          : RIGHT;
      if (!this.inView(this.screen(end))) continue;
      const walkers = Math.max(3, Math.min(12, Math.ceil(column.people / 1000)));
      // One ox cart walks with every four people, beside the walkers the rule counts.
      const line = Array.from({ length: walkers + Math.floor(walkers / 4) }, (_, i) => i % 5 === 3);
      const colour = colourIndex(current, column.owner);
      const kmPerPx = 1 / this.input.camera.scale;
      const alpha = before ? 1 : smooth(p * 2);
      let back = 0;
      for (const [i, cart] of line.entries()) {
        const key = `${column.id}:${i}`;
        back += (cart ? 0.9 : 0.36) * this.h;
        const on = alongTrail(trail, Math.max(0, head - back * kmPerPx), heading);
        const base = this.screen(on.point);
        const wander = (seeded(key) - 0.5) * 0.35 * this.h;
        const x = base.x - on.heading.y * wander;
        const y = base.y + on.heading.x * wander * GROUND_Y;
        const motion: Motion = walking ? 'march' : 'stand';
        const phase =
          (walking ? this.input.motion * RATE.march * 0.8 : this.input.now * RATE.stand) +
          seeded(key, 1);
        const key2 = cart
          ? `${artKey('cart', Math.floor(frac(phase * 0.6) * OWNED.cart) % OWNED.cart)}@${colour}`
          : `${figureKey(seeded(key, 2) < 0.5 ? 'refugee' : 'refugeeWoman', motion, frameOf(motion, phase))}@${colour}`;
        this.push({
          key: key2,
          x,
          y,
          size: this.h * (cart ? 0.85 : 0.9),
          mirror: on.heading.x < 0,
          alpha,
          rotation: 0,
          depth: y,
        });
        if (cart) back += 0.5 * this.h;
      }
    }
  }
}

function unit(a: MapPoint, b: MapPoint): MapPoint {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return d < 1e-9 ? RIGHT : { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** A figure kind that lacks a motion uses the nearest one it has. */
function motionFor(kind: FigureKind, motion: Motion): Motion {
  if (kind === 'bearer' && motion === 'fight') return 'stand';
  if ((kind === 'refugee' || kind === 'refugeeWoman') && motion !== 'stand') return 'march';
  return motion;
}

interface Located {
  readonly x: number;
  readonly y: number;
  /** +1 facing right on screen, -1 facing left. */
  readonly facing: number;
  readonly motion: Motion;
  readonly battle?: BattleId;
  readonly side: number;
  readonly front: boolean;
  readonly cavalryLoop: boolean;
}

function mix(a: Located, b: Located, t: number): Located {
  return { ...(t < 0.5 ? a : b), x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

interface Layout {
  locate(id: FormationId | 'command', slot: number, progress: number): Located | undefined;
  /** Where tents and fires stand: behind the army, or with `side` 1 in front of it. */
  campSpots(side: 1 | -1): { tents: MapPoint[]; fires: MapPoint[] };
}

type Blocks = readonly { id: FormationId; troop: Troop; count: number; block: Block }[];

/** A line at rest or in battle: blocks placed about a mark, facing one way. */
class LineLayout implements Layout {
  private readonly ctx: Context;
  private readonly mode: Extract<Mode, { kind: 'line' | 'battle' }>;
  private readonly blocks: Map<FormationId, { block: Block; at: Place; troop: Troop }>;
  private readonly depth: number;
  /** The way the line faces, and how far its mark is shifted on screen, in px. */
  private readonly facing: MapPoint;
  private shift: MapPoint;

  constructor(
    ctx: Context,
    mode: Extract<Mode, { kind: 'line' | 'battle' }>,
    blocks: Blocks,
    placed: readonly Placed[],
    depth: number,
    beside?: Beside,
  ) {
    this.ctx = ctx;
    this.mode = mode;
    this.depth = depth;
    this.facing = mode.facing;
    this.shift = { x: 0, y: 0 };
    if (beside) {
      // An army at a city stands beside it, facing it, so the city and its name stay in
      // sight and the camp is pitched behind the army on the side with land. It takes the
      // side away from the name when there is land there.
      const anchor = ctx.screen(mode.anchor);
      const land = ctx.input.land ?? (() => true);
      const reach = (side: number) => (side > 0 ? beside.clear.right : beside.clear.left);
      const hasLand = (side: number) =>
        land({ x: beside.x + side * (reach(side) + (depth + 3.3) * ctx.h), y: anchor.y });
      const sides = beside.nameSide > 0 ? [-1, 1] : [1, -1];
      const side = sides.find(hasLand) ?? (sides[0] as number);
      this.shift = { x: beside.x + side * (reach(side) + 1.45 * ctx.h) - anchor.x, y: 0 };
      this.facing = { x: -side, y: 0 };
    }
    this.blocks = new Map();
    placed.forEach((p, i) => {
      const id = blocks.find((b) => b.block === p.block)?.id ?? blocks[i]?.id;
      if (id) this.blocks.set(id, { block: p.block, at: p.at, troop: p.troop });
    });
    // A battle's lines are kept on land by its anchor, which both sides share.
    if (mode.kind === 'line' && ctx.input.land) {
      const samples = this.positions();
      const extra = landShift(ctx.input.land, samples, ctx.h);
      this.shift = { x: this.shift.x + extra.x, y: this.shift.y + extra.y };
    }
  }

  /**
   * The ground every figure of the army covers, its seeded step included, with its
   * commanders: its feet, or a horse's hooves, at either side of where it stands.
   */
  positions(): MapPoint[] {
    const points: MapPoint[] = [];
    const { h } = this.ctx;
    const cover = (at: MapPoint, kind: FigureKind) => {
      const half = groundSpan(kind) * h;
      points.push({ x: at.x - half, y: at.y }, at, { x: at.x + half, y: at.y });
    };
    COMMAND_KINDS.forEach((kind, slot) => {
      const at = this.locate('command', slot);
      if (at) cover(at, kind);
    });
    for (const [id, { block, troop }] of this.blocks) {
      // The reach of a skirmisher's sway and of a horseman's loop at every moment, from
      // the place the figure moves about, so one shift keeps it on land at every phase
      // and the battle never moves as the figures do.
      const sways = this.sways(troop) ? [0, -SWAY] : [0];
      for (let slot = 0; slot < block.places.length; slot++) {
        const at = this.stand(id, slot, true);
        if (!at) continue;
        const loop: { along: number; across: number }[] = at.cavalryLoop
          ? [...CAVALRY_LOOP.along, -CAVALRY_LOOP.back * CAVALRY_LOOP.radius].flatMap((along) =>
              [-CAVALRY_LOOP.across, 0, CAVALRY_LOOP.across].map((across) => ({ along, across })),
            )
          : [{ along: 0, across: 0 }];
        for (const sway of sways) {
          for (const { along, across } of loop) {
            cover(
              { x: at.x + at.facing * (along + sway) * h, y: at.y + across * h * GROUND_Y },
              troop,
            );
          }
        }
      }
    }
    return points;
  }

  private point(along: number, across: number): MapPoint {
    const { mode, ctx } = this;
    const h = ctx.h;
    const f = this.facing;
    const r = { x: -f.y, y: f.x };
    const mark = ctx.screen(mode.anchor);
    const anchor = { x: mark.x + this.shift.x, y: mark.y + this.shift.y };
    const gap = mode.kind === 'battle' ? STANCE_LOOK[mode.stance].gap + 0.18 + LINE_GAP_KM : 0;
    const a = along - gap;
    const c = across + (mode.kind === 'battle' ? mode.across : 0);
    return {
      x: anchor.x + (f.x * a + r.x * c) * h,
      y: anchor.y + (f.y * a + r.y * c) * h * GROUND_Y,
    };
  }

  private sways(troop: Troop): boolean {
    const { mode } = this;
    return (
      mode.kind === 'battle' &&
      mode.stance === 'skirmishAndWithdraw' &&
      TROOPS[troop].category !== 'missile'
    );
  }

  locate(id: FormationId | 'command', slot: number): Located | undefined {
    return this.stand(id, slot, false);
  }

  /** `still` leaves out the skirmishers' sway, which moves with the motion clock. */
  private stand(id: FormationId | 'command', slot: number, still: boolean): Located | undefined {
    const { mode } = this;
    const facing = this.facing.x < 0 ? -1 : 1;
    const battle = mode.kind === 'battle' ? mode.battle.id : undefined;
    const side = facing;
    if (id === 'command') {
      const along = mode.kind === 'battle' ? -this.depth - 0.7 : 0.75;
      const p = this.point(along, slot === 0 ? 0.15 : -0.35);
      const motion: Motion = mode.kind === 'battle' && slot === 1 ? 'fight' : 'stand';
      return {
        ...p,
        facing,
        motion,
        side,
        front: false,
        cavalryLoop: false,
        ...(battle ? { battle } : {}),
      };
    }
    const entry = this.blocks.get(id);
    const place = entry?.block.places[slot];
    if (!entry || !place) return undefined;
    const rank = Math.floor(slot / entry.block.files);
    const category = TROOPS[entry.troop].category;
    let along = entry.at.along + place.along;
    if (this.sways(entry.troop) && !still) {
      along -= (SWAY / 2) * (1 + Math.sin(this.ctx.input.motion * 0.4 + entry.at.across));
    }
    if (mode.kind === 'battle' && mode.stance === 'allOutAssault' && rank === 0) along += 0.08;
    const p = this.point(along, entry.at.across + place.across);
    const fighting =
      mode.kind === 'battle' &&
      (category === 'missile' ||
        category === 'cavalry' ||
        rank < (mode.stance === 'allOutAssault' ? 3 : 2));
    return {
      ...p,
      facing,
      motion: fighting ? 'fight' : 'stand',
      side,
      front: mode.kind === 'battle' && rank === 0 && category === 'infantry',
      cavalryLoop: fighting && category === 'cavalry',
      ...(battle ? { battle } : {}),
    };
  }

  campSpots(side: 1 | -1) {
    const behind = side < 0 ? -this.depth - 0.9 : 2.2;
    let width = 0;
    for (const { block, at } of this.blocks.values())
      width = Math.max(width, Math.abs(at.across) + block.width / 2);
    const tents: MapPoint[] = [this.point(behind - 0.2, 0)];
    const count = Math.max(1, this.blocks.size);
    for (let i = 0; i < count; i++) {
      const across = -width + ((i + 0.5) * 2 * width) / count;
      tents.push(this.point(behind - 0.6 * (i % 2), across + (Math.abs(across) < 0.6 ? 0.9 : 0)));
    }
    const fires = [
      this.point(behind + 0.45 * -side, -0.5),
      ...(count > 2 ? [this.point(behind + 0.45 * -side, width * 0.6)] : []),
    ];
    return { tents, fires };
  }
}

/** An army on the road: the column follows the path walked, its head at the army's place. */
class ColumnLayout implements Layout {
  private readonly ctx: Context;
  private readonly mode: Extract<Mode, { kind: 'march' }>;
  private readonly blocks: Map<FormationId, { block: Block; at: Place }>;

  constructor(
    ctx: Context,
    mode: Extract<Mode, { kind: 'march' }>,
    blocks: Blocks,
    placed: readonly Placed[],
  ) {
    this.ctx = ctx;
    this.mode = mode;
    this.blocks = new Map();
    placed.forEach((p, i) => {
      const id = blocks[i]?.id;
      if (id) this.blocks.set(id, { block: p.block, at: p.at });
    });
  }

  locate(id: FormationId | 'command', slot: number, progress: number): Located | undefined {
    const { ctx, mode } = this;
    const length = trailLength(mode.trail);
    const head = progress * length;
    let along: number;
    let across: number;
    if (id === 'command') {
      along = 0.35 - slot * 0.45;
      across = slot === 0 ? 0 : 0.15;
    } else {
      const entry = this.blocks.get(id);
      const place = entry?.block.places[slot];
      if (!entry || !place) return undefined;
      along = entry.at.along + place.along - 0.4;
      across = place.across;
    }
    const km = (along * ctx.h) / ctx.input.camera.scale;
    // A trail the army has not walked yet, as on the day a save is loaded, still runs
    // the way its path leads.
    const on = alongTrail(
      length > 0.01 ? mode.trail : [mode.trail[0] as MapPoint],
      head + km,
      mode.heading,
    );
    const base = ctx.screen(on.point);
    const r = { x: -on.heading.y, y: on.heading.x };
    return {
      x: base.x + r.x * across * ctx.h,
      y: base.y + r.y * across * ctx.h * GROUND_Y,
      facing: on.heading.x < 0 ? -1 : 1,
      motion: length > 0.01 ? (mode.fled && progress < 0.6 ? 'run' : 'march') : 'stand',
      side: 0,
      front: false,
      cavalryLoop: false,
    };
  }

  campSpots() {
    return { tents: [], fires: [] };
  }
}

/** Rings of candidate shifts tried, each `LAND_STEP` figure heights further out, in 16 directions. */
const LAND_RINGS = 12;
const LAND_STEP = 0.5;
/** The standard bearer and the general, in the order of their slots. */
const COMMAND_KINDS: readonly FigureKind[] = ['bearer', 'general'];
/** Rings of places tried for one figure the layout left off land, each `NUDGE_STEP` men's heights out. */
const NUDGE_RINGS = 4;
const NUDGE_STEP = 0.35;

/**
 * The smallest shift on screen, in px, that brings every sample point onto land, or the
 * one that brings the most onto land when none brings them all. It is zero when every
 * point already stands on land, so an army inland never moves.
 */
export function landShift(
  land: (screen: MapPoint) => boolean,
  samples: readonly MapPoint[],
  h: number,
): MapPoint {
  const dry = (dx: number, dy: number) =>
    samples.reduce((n, p) => n + (land({ x: p.x + dx, y: p.y + dy }) ? 1 : 0), 0);
  let best = { x: 0, y: 0 };
  let most = dry(0, 0);
  if (most === samples.length) return best;
  for (let ring = 1; ring <= LAND_RINGS; ring++) {
    const r = ring * LAND_STEP * h;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const shift = { x: Math.cos(a) * r, y: Math.sin(a) * r * GROUND_Y };
      const count = dry(shift.x, shift.y);
      if (count === samples.length) return shift;
      if (count > most) {
        most = count;
        best = shift;
      }
    }
  }
  return best;
}

/** How far from a besieged city's centre, in px, the first rank of the ring stands. */
function ringRadius(rank: CityRank, growth: number, h: number): number {
  return CITY_HALF_WIDTH[rank] * growth + 4 + 0.45 * h;
}

/** The rows of a siege ring, in men's heights out from its first rank: stakes, ditch, men, tents. */
const RING_ROWS = [0.55, 0.78, 1.05, 1.35, 1.65, 2.35, 2.7];
/** The fewest of the ring's 72 angles a siege keeps to; with fewer it rings the whole city. */
const RING_MIN_ANGLES = 6;

/** Besiegers in their share of a ring round the city, facing its walls. */
class RingLayout implements Layout {
  private readonly ctx: Context;
  private readonly mode: Extract<Mode, { kind: 'siege' }>;
  private readonly order: Map<FormationId, number>;
  private readonly total: number;

  constructor(
    ctx: Context,
    mode: Extract<Mode, { kind: 'siege' }>,
    formations: readonly { id: FormationId; count: number }[],
  ) {
    this.ctx = ctx;
    this.mode = mode;
    this.order = new Map();
    let index = 0;
    for (const f of formations) {
      this.order.set(f.id, index);
      index += f.count;
    }
    this.total = Math.max(1, index);
  }

  /** On the day of a storm the ring stands back from the wall, so the ladders show against it. */
  radius() {
    const back = this.ctx.stormedBy(this.mode.city.id) ? STORM_STEP_BACK * this.ctx.h : 0;
    return ringRadius(this.mode.city.rank, this.ctx.input.growth, this.ctx.h) + back;
  }

  private landAngles: number[] | undefined;

  /**
   * The ring is shared out over the angles at which every row of it, from the stakes to
   * the tents, stands on land and clear of the towns, villages, and names near the city,
   * so a city on a coast is ringed on its landward side, no tent stands in the sea, and
   * the places round the city stay readable. Where too little of the ring is clear of
   * the places, it keeps to the land alone.
   */
  private onLand(angle: number): number {
    const start = seeded(this.mode.city.id) * Math.PI * 2;
    if (!this.landAngles) {
      const { ctx } = this;
      const h = ctx.h;
      const c = ctx.screen(this.mode.city.position);
      const radius = this.radius();
      const name = ctx.input.names?.get(this.mode.city.id);
      const places = [...(ctx.input.keepClear ?? []), ...(name ? [name] : [])];
      const covers = (p: MapPoint) =>
        places.some(
          (b) =>
            p.x + 0.5 * h > b.left &&
            p.x - 0.5 * h < b.right &&
            p.y > b.top &&
            p.y - 1.3 * h < b.bottom,
        );
      const rows = RING_ROWS.map((r) => radius + r * h);
      const samples = 72;
      const dry: number[] = [];
      const clear: number[] = [];
      for (let i = 0; i < samples; i++) {
        const a = start + (i / samples) * Math.PI * 2;
        const points = rows.map((r) => ({
          x: c.x + Math.cos(a) * r,
          y: c.y + Math.sin(a) * r * GROUND_Y,
        }));
        if (!points.every((p) => ctx.tentDry(p))) continue;
        dry.push(a);
        if (!points.some(covers)) clear.push(a);
      }
      this.landAngles = clear.length >= RING_MIN_ANGLES ? clear : dry;
    }
    const angles = this.landAngles;
    if (angles.length < RING_MIN_ANGLES || angles.length === 72) return angle;
    const u = frac((angle - start) / (Math.PI * 2)) * angles.length;
    const i = Math.floor(u);
    const a = angles[i % angles.length] as number;
    const b = angles[(i + 1) % angles.length] as number;
    const step = (Math.PI * 2) / 72;
    return b - a > 0 && b - a < step * 1.5 ? a + (b - a) * (u - i) : a + step * (u - i) * 0.5;
  }

  private ring(angle: number, radius: number): MapPoint {
    const c = this.ctx.screen(this.mode.city.position);
    const a = this.onLand(angle);
    return { x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius * GROUND_Y };
  }

  locate(id: FormationId | 'command', slot: number): Located | undefined {
    const { mode, ctx } = this;
    const h = ctx.h;
    const span = mode.to - mode.from;
    let angle: number;
    let radius: number;
    if (id === 'command') {
      angle = mode.from + span * (0.5 + slot * 0.04);
      radius = this.radius() + 2.0 * h;
    } else {
      const start = this.order.get(id);
      if (start === undefined) return undefined;
      const index = start + slot;
      const rows = 3;
      const perRow = Math.ceil(this.total / rows);
      angle =
        mode.from +
        (span * ((index % perRow) + 0.5 + (Math.floor(index / perRow) % 2) * 0.5)) / perRow;
      radius =
        this.radius() +
        (1.05 + Math.floor(index / perRow) * 0.3 + (seeded(id, slot) - 0.5) * 0.1) * h;
    }
    const p = this.ring(angle, radius);
    const c = ctx.screen(mode.city.position);
    return {
      ...p,
      facing: c.x >= p.x ? 1 : -1,
      motion: 'stand',
      side: 0,
      front: false,
      cavalryLoop: false,
    };
  }

  campSpots() {
    return { tents: [], fires: [] };
  }

  /** Tents, fires, and the stakes of the works, for the whole share of this army. */
  field(): { tents: MapPoint[]; fires: MapPoint[]; stakes: MapPoint[] } {
    const { mode, ctx } = this;
    const h = ctx.h;
    const span = mode.to - mode.from;
    const tentRadius = this.radius() + 2.35 * h;
    const tents: MapPoint[] = [];
    const fires: MapPoint[] = [];
    const tentCount = Math.max(2, Math.floor((span * tentRadius) / (0.95 * h)));
    for (let i = 0; i < tentCount; i++)
      tents.push(
        this.ring(mode.from + (span * (i + 0.5)) / tentCount, tentRadius + (i % 2) * 0.35 * h),
      );
    for (let i = 0; i < Math.max(1, Math.floor(tentCount / 3)); i++)
      fires.push(this.ring(mode.from + (span * (i * 3 + 1.5)) / tentCount, tentRadius - 0.55 * h));
    const stakeRadius = this.radius() + 0.55 * h;
    const stakes: MapPoint[] = [];
    const stakeCount = Math.max(3, Math.floor((span * stakeRadius) / (0.42 * h)));
    for (let i = 0; i < stakeCount; i++)
      stakes.push(this.ring(mode.from + (span * (i + 0.5)) / stakeCount, stakeRadius));
    return { tents, fires, stakes };
  }

  /** The ditch of the works along this army's share of the ring. */
  works(): MapPoint[] {
    const { mode } = this;
    const radius = this.radius() + 0.78 * this.ctx.h;
    const points: MapPoint[] = [];
    for (let i = 0; i <= 24; i++)
      points.push(this.ring(mode.from + ((mode.to - mode.from) * i) / 24, radius));
    return points;
  }
}

export { RingLayout };
