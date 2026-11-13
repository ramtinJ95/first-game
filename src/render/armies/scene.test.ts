import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../../sim/fixture.ts';
import { enslave } from '../../sim/orders/enslave.ts';
import { sack } from '../../sim/orders/sack.ts';
import { population } from '../../sim/systems/population.ts';
import type { ArmyId } from '../../sim/ids.ts';
import type { Sight } from '../../sim/sight.ts';
import type { Formation } from '../../sim/state/formation.ts';
import type { GameState } from '../../sim/state/game-state.ts';
import type { MapPoint } from '../../sim/state/map-point.ts';
import { BURN_DAYS, buildScene, FIGURE_SCALE, type SceneInput } from './scene.ts';

const viewport = { width: 1280, height: 720 };

function sight(state: GameState, hidden: readonly ArmyId[] = []): Sight {
  return {
    faction: state.player,
    provinces: new Set(),
    circles: [],
    armies: new Set(
      Object.keys(state.armies).filter((id) => !hidden.includes(id as ArmyId)) as ArmyId[],
    ),
    convoys: new Set(),
    refugeeColumns: new Set(),
    battles: new Set(),
    sees: () => true,
  };
}

function input(
  previous: GameState,
  current: GameState,
  overrides: Partial<SceneInput> = {},
): SceneInput {
  const army = current.armies[FIXTURE.romanArmy]?.activity;
  const centre = army && army.kind !== 'embarked' ? army.position : { x: 0, y: 0 };
  return {
    previous,
    current,
    progress: 0.5,
    camera: { centre, scale: 4 },
    viewport,
    previousSight: sight(previous),
    sight: sight(current),
    motion: 3.2,
    now: 7.1,
    growth: 1.8,
    ...overrides,
  };
}

const figuresOf = (scene: ReturnType<typeof buildScene>, army: ArmyId) =>
  scene.sprites.filter((s) => s.army === army);

const troopOf = (key: string) => key.split('.')[0];

/** The Roman army marching from its place to `to`, a day into its march. */
function marching(to: MapPoint): [GameState, GameState] {
  const previous = buildFixture();
  const current = buildFixture();
  const at = { x: 2516.3, y: 2340.8 };
  const step = { x: at.x + Math.sign(to.x - at.x) * 25, y: at.y };
  const before = previous.armies[FIXTURE.romanArmy];
  const now = current.armies[FIXTURE.romanArmy];
  if (!before || !now) throw new Error('fixture lacks the Roman army');
  before.activity = { kind: 'marching', position: at, waypoints: [to] };
  now.activity = { kind: 'marching', position: step, waypoints: [to] };
  current.day = (previous.day + 1) as GameState['day'];
  return [previous, current];
}

describe('buildScene', () => {
  test('the same two days and clocks always give the same picture', () => {
    const state = buildFixture();
    expect(buildScene(input(state, state))).toEqual(
      buildScene(input(buildFixture(), buildFixture())),
    );
  });

  test('an army is its flag below the figure zoom, and figures from it', () => {
    const state = buildFixture();
    const far = buildScene(
      input(state, state, { camera: { centre: { x: 2516, y: 2340 }, scale: FIGURE_SCALE * 0.9 } }),
    );
    expect(far.sprites).toEqual([]);
    const near = buildScene(
      input(state, state, { camera: { centre: { x: 2516, y: 2340 }, scale: FIGURE_SCALE } }),
    );
    expect(figuresOf(near, FIXTURE.romanArmy).length).toBeGreaterThan(0);
  });

  test('each formation shows one figure per 50 men, and the army its standard and its general', () => {
    const state = buildFixture();
    const keys = figuresOf(buildScene(input(state, state)), FIXTURE.romanArmy).map((s) =>
      troopOf(s.key),
    );
    expect(keys.filter((k) => k === 'spearmen')).toHaveLength(24);
    expect(keys.filter((k) => k === 'lightCavalry')).toHaveLength(6);
    expect(keys.filter((k) => k === 'bearer')).toHaveLength(1);
    expect(keys.filter((k) => k === 'general')).toHaveLength(1);
  });

  test('two formations of the same army stand in different places, and each figure off a ruled grid', () => {
    const state = buildFixture();
    const sprites = figuresOf(buildScene(input(state, state)), FIXTURE.romanArmy);
    const spears = sprites.filter((s) => troopOf(s.key) === 'spearmen');
    const horse = sprites.filter((s) => troopOf(s.key) === 'lightCavalry');
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(
      Math.hypot(
        mean(spears.map((s) => s.x)) - mean(horse.map((s) => s.x)),
        mean(spears.map((s) => s.y)) - mean(horse.map((s) => s.y)),
      ),
    ).toBeGreaterThan(10);
    const columns = new Set(spears.map((s) => s.x.toFixed(1)));
    expect(columns.size).toBeGreaterThan(spears.length / 2);
  });

  test('a marching army faces along its path and walks', () => {
    const [east0, east1] = marching({ x: 2700, y: 2340.8 });
    const east = figuresOf(buildScene(input(east0, east1)), FIXTURE.romanArmy);
    expect(east.every((s) => !s.mirror)).toBe(true);
    expect(east.filter((s) => s.key.includes('.march.')).length).toBeGreaterThan(east.length * 0.9);
    const [west0, west1] = marching({ x: 2300, y: 2340.8 });
    const west = figuresOf(buildScene(input(west0, west1)), FIXTURE.romanArmy);
    expect(west.every((s) => s.mirror)).toBe(true);
  });

  test('a march moves with the clock: the head is further along later in the day', () => {
    const [previous, current] = marching({ x: 2700, y: 2340.8 });
    const camera = { centre: { x: 2530, y: 2340 }, scale: 4 };
    const general = (progress: number) =>
      figuresOf(buildScene(input(previous, current, { progress, camera })), FIXTURE.romanArmy).find(
        (s) => troopOf(s.key) === 'general',
      );
    expect((general(0.8)?.x ?? 0) - (general(0.2)?.x ?? 0)).toBeCloseTo(0.6 * 25 * 4, 0);
  });

  test('a paused game keeps marching figures still, while men at ease and fires go on moving', () => {
    const [previous, current] = marching({ x: 2700, y: 2340.8 });
    const a = buildScene(input(previous, current, { now: 1 }));
    const b = buildScene(input(previous, current, { now: 2.3 }));
    const marchers = (scene: typeof a) =>
      figuresOf(scene, FIXTURE.romanArmy).filter((s) => s.key.includes('.march.'));
    expect(marchers(a)).toEqual(marchers(b));
    const state = buildFixture();
    const still = (now: number) =>
      buildScene(input(state, state, { now })).sprites.map((s) => s.key);
    expect(still(1)).not.toEqual(still(2.3));
  });

  test('an army out of sight is neither drawn nor pickable', () => {
    const state = buildFixture();
    const hidden = sight(state, [FIXTURE.romanArmy]);
    const scene = buildScene(input(state, state, { sight: hidden, previousSight: hidden }));
    expect(figuresOf(scene, FIXTURE.romanArmy)).toEqual([]);
    expect(scene.sprites.some((s) => s.army === FIXTURE.romanArmy)).toBe(false);
  });

  test("a day's losses fall during the day, and a wiped formation is gone the next day", () => {
    const previous = buildFixture();
    const current = buildFixture();
    current.day = (previous.day + 1) as GameState['day'];
    const army = current.armies[FIXTURE.romanArmy];
    if (!army) throw new Error('fixture lacks the Roman army');
    army.formations = [FIXTURE.hastati];
    Reflect.deleteProperty(current.formations, FIXTURE.equites);
    const late = buildScene(input(previous, current, { progress: 0.75 })).sprites;
    expect(
      late.filter((s) => troopOf(s.key) === 'lightCavalry').every((s) => s.key.includes('.fall.')),
    ).toBe(true);
    expect(late.filter((s) => troopOf(s.key) === 'lightCavalry')).toHaveLength(6);
    const next = buildScene(input(current, current)).sprites;
    expect(next.filter((s) => troopOf(s.key) === 'lightCavalry')).toEqual([]);
  });
});

describe('a fallen city', () => {
  test('burns on the day its sack is applied, and not on the day it is enslaved', () => {
    const fallen = buildFixture();
    const capua = fallen.cities[FIXTURE.capua];
    const army = fallen.armies[FIXTURE.romanArmy];
    if (!capua || !army) throw new Error('fixture lacks Capua or the Roman army');
    army.activity = { kind: 'idle', position: { ...capua.position } };
    capua.fellOn = fallen.day;
    capua.unrestDays = 90;
    const after = (apply: (state: GameState) => unknown) => {
      const next = structuredClone(fallen);
      apply(next);
      population(next);
      next.day = (fallen.day + 1) as GameState['day'];
      return next;
    };
    const order = { faction: FIXTURE.rome, city: FIXTURE.capua };
    const camera = { centre: capua.position, scale: 4 };
    const blazes = (next: GameState) =>
      buildScene(input(fallen, next, { camera })).sprites.filter((s) => s.key.startsWith('blaze.'));
    expect(blazes(after((s) => sack(s, { kind: 'sack', ...order })))).not.toHaveLength(0);
    expect(
      blazes(after((s) => enslave(s, { kind: 'enslave', ...order }, fixtureWorld()))),
    ).toHaveLength(0);
  });

  test('burns and smokes for the days after its sack, and is quiet once they pass', () => {
    const later = (days: number) => {
      const state = buildFixture();
      const capua = state.cities[FIXTURE.capua];
      if (!capua) throw new Error('fixture lacks Capua');
      capua.sackedOn = state.day;
      // Without armies, so the only smoke in view is the city's.
      state.armies = {};
      state.formations = {};
      state.day = (state.day + 1 + days) as GameState['day'];
      const scene = buildScene(
        input(state, state, { camera: { centre: capua.position, scale: 4 } }),
      );
      return {
        flames: scene.sprites.filter((s) => s.key.startsWith('blaze.') && s.alpha > 0).length,
        smoke: scene.sprites.filter((s) => s.key.startsWith('smoke.') && s.alpha > 0).length,
      };
    };
    expect(later(3).flames).toBeGreaterThan(0);
    expect(later(3).smoke).toBeGreaterThan(0);
    expect(later(BURN_DAYS)).toEqual({ flames: 0, smoke: 0 });
  });
});

describe('an army arriving', () => {
  test('walks the last of its road round the corner before it forms up', () => {
    const previous = buildFixture();
    const current = buildFixture();
    current.day = (previous.day + 1) as GameState['day'];
    const from = { x: 2500, y: 2340 };
    const corner = { x: 2525, y: 2340 };
    const destination = { x: 2525, y: 2315 };
    const before = previous.armies[FIXTURE.romanArmy];
    const now = current.armies[FIXTURE.romanArmy];
    if (!before || !now) throw new Error('fixture lacks the Roman army');
    before.activity = { kind: 'marching', position: from, waypoints: [corner, destination] };
    now.activity = { kind: 'idle', position: destination };
    const camera = { centre: corner, scale: 4 };
    // Halfway through the walk, the head of the column stands at the corner, not on the
    // straight line from where the army stood to where it rests.
    const general = buildScene(input(previous, current, { camera, progress: 0.35 })).sprites.find(
      (s) => s.key.startsWith('general.'),
    );
    const at = { x: 640, y: 360 };
    expect(Math.hypot((general?.x ?? 0) - at.x, (general?.y ?? 0) - at.y)).toBeLessThan(12);
    expect(general?.key).toContain('.march.');
  });
});

describe('a refugee column', () => {
  test('shows one walker per 1,000 people, with an ox cart beside every four', () => {
    const state = buildFixture();
    const roma = state.cities[FIXTURE.roma];
    if (!roma) throw new Error('fixture lacks Roma');
    const at = { x: roma.position.x + 20, y: roma.position.y };
    const id = 'refugee-column-1' as keyof GameState['refugeeColumns'];
    state.refugeeColumns[id] = {
      id,
      owner: FIXTURE.rome,
      people: 4000,
      from: FIXTURE.roma,
      to: FIXTURE.capua,
      position: at,
      waypoints: [{ x: at.x + 40, y: at.y }],
    };
    const seen = { ...sight(state), refugeeColumns: new Set([id]) };
    const sprites = buildScene(
      input(state, state, { camera: { centre: at, scale: 4 }, sight: seen, previousSight: seen }),
    ).sprites;
    expect(sprites.filter((s) => s.key.startsWith('refugee'))).toHaveLength(4);
    expect(sprites.filter((s) => s.key.startsWith('cart.'))).toHaveLength(1);
  });
});

describe('a retreating army', () => {
  test('walks its path like a march, and runs only on the day it leaves a battle', () => {
    const [previous, current] = marching({ x: 2700, y: 2340.8 });
    const before = previous.armies[FIXTURE.romanArmy];
    const now = current.armies[FIXTURE.romanArmy];
    if (!before || before.activity.kind !== 'marching' || !now || now.activity.kind !== 'marching')
      throw new Error('fixture lacks the marching Roman army');
    before.activity = { ...before.activity, kind: 'retreating' };
    now.activity = { ...now.activity, kind: 'retreating' };
    const figures = figuresOf(
      buildScene(input(previous, current, { progress: 0.3 })),
      FIXTURE.romanArmy,
    );
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.every((s) => s.key.includes('.march.') && !s.mirror)).toBe(true);
  });
});

describe('the day a battle ends', () => {
  /** Rome and Carthage in battle on the day before, Rome east of Carthage, and the two days. */
  function battleDays(leave: 'marching' | 'retreating'): [GameState, GameState] {
    const previous = buildFixture();
    const battle = 'battle-1' as keyof GameState['battles'];
    const at = { x: 2516.3, y: 2340.8 };
    const punicAt = { x: at.x - 10, y: at.y };
    const roman = previous.armies[FIXTURE.romanArmy];
    const punic = previous.armies[FIXTURE.punicArmy];
    if (!roman || !punic) throw new Error('fixture lacks the armies');
    roman.activity = { kind: 'inBattle', position: at, battle, march: [{ x: at.x + 80, y: at.y }] };
    punic.activity = { kind: 'inBattle', position: punicAt, battle, march: [] };
    previous.battles[battle] = {
      id: battle,
      position: { x: at.x - 5, y: at.y },
      attackers: [FIXTURE.romanArmy],
      defenders: [FIXTURE.punicArmy],
      startedOn: previous.day,
      sides: {
        attackers: { factions: [FIXTURE.rome], lost: 0 },
        defenders: { factions: [FIXTURE.carthage], lost: 0 },
      },
    };
    const current = structuredClone(previous);
    current.day = (previous.day + 1) as GameState['day'];
    Reflect.deleteProperty(current.battles, battle);
    const army = current.armies[leave === 'marching' ? FIXTURE.romanArmy : FIXTURE.punicArmy];
    const other = current.armies[leave === 'marching' ? FIXTURE.punicArmy : FIXTURE.romanArmy];
    if (!army || !other || army.activity.kind !== 'inBattle' || other.activity.kind !== 'inBattle')
      throw new Error('armies left the battle');
    const from = army.activity.position;
    const step = leave === 'marching' ? 20 : -20;
    army.activity = {
      kind: leave,
      position: { x: from.x + step, y: from.y },
      waypoints: [{ x: from.x + 4 * step, y: from.y }],
    };
    other.activity = { kind: 'idle', position: other.activity.position };
    if (leave === 'retreating') {
      for (const id of army.formations) {
        const formation = current.formations[id];
        if (formation) formation.morale = 0;
      }
    }
    return [previous, current];
  }

  const late = (previous: GameState, current: GameState, army: ArmyId) =>
    figuresOf(
      buildScene(
        input(previous, current, {
          progress: 0.8,
          camera: { centre: { x: 2530, y: 2340 }, scale: 4 },
        }),
      ),
      army,
    );

  test('a winner that takes up its march again marches off in column, under its raised standard', () => {
    const [previous, current] = battleDays('marching');
    const scene = buildScene(
      input(previous, current, {
        progress: 0.3,
        camera: { centre: { x: 2530, y: 2340 }, scale: 4 },
      }),
    );
    expect(scene.sprites.some((s) => s.key.startsWith('standard.'))).toBe(true);
    const figures = late(previous, current, FIXTURE.romanArmy);
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.some((s) => s.key.includes('.run.'))).toBe(false);
    expect(figures.filter((s) => s.key.includes('.march.')).length).toBeGreaterThan(
      figures.length * 0.8,
    );
    expect(figures.every((s) => !s.mirror)).toBe(true);
  });

  test('a beaten army that retreats turns and runs from the field', () => {
    const [previous, current] = battleDays('retreating');
    const camera = { centre: { x: 2510, y: 2340 }, scale: 4 };
    const figures = figuresOf(
      buildScene(input(previous, current, { progress: 0.3, camera })),
      FIXTURE.punicArmy,
    );
    expect(figures.filter((s) => s.key.includes('.run.')).length).toBeGreaterThan(
      figures.length * 0.8,
    );
    const scene = buildScene(input(previous, current, { progress: 0.3, camera }));
    const standards = scene.sprites.filter((s) => s.key.startsWith('standard.'));
    // The standard raised over the field is the winner's, in Rome's colour, not Carthage's.
    expect(standards.every((s) => s.key.endsWith('@0'))).toBe(true);
  });
});

describe('culling', () => {
  test('a long column whose head is out of view still draws its rear ranks in view', () => {
    const [previous, current] = marching({ x: 3200, y: 2340.8 });
    for (const state of [previous, current]) {
      const army = state.armies[FIXTURE.romanArmy];
      if (!army) throw new Error('fixture lacks the Roman army');
      army.formations = [];
      for (let i = 0; i < 8; i++) {
        const id = `formation-long-${i}` as Formation['id'];
        state.formations[id] = { id, army: army.id, troop: 'spearmen', men: 1500, morale: 1 };
        army.formations.push(id);
      }
      Reflect.deleteProperty(state.formations, FIXTURE.hastati);
      Reflect.deleteProperty(state.formations, FIXTURE.equites);
    }
    const head = current.armies[FIXTURE.romanArmy]?.activity;
    if (!head || head.kind !== 'marching') throw new Error('not marching');
    // The head stands 1,500 px east of the middle of the view, far beyond its edge.
    const camera = { centre: { x: head.position.x - 1500 / 4, y: head.position.y }, scale: 4 };
    const figures = figuresOf(
      buildScene(input(previous, current, { progress: 1, camera })),
      FIXTURE.romanArmy,
    );
    expect(figures.some((s) => s.x > 0 && s.x < viewport.width)).toBe(true);
  });
});
