import { describe, expect, test } from 'vitest';
import {
  buildTrial,
  playTrial,
  TRIAL_ARMIES,
  type ArmySpec,
  type Matchup,
} from '../battle-trial.ts';
import { buildFixture, FIXTURE } from '../fixture.ts';
import type { ArmyId, CityId, FactionId, FormationId, SiegeId } from '../ids.ts';
import { executeOrder } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import { saveGame } from '../save.ts';
import type { ArmyActivity, Stance } from '../state/army.ts';
import type { GameState } from '../state/game-state.ts';
import { tick } from '../tick.ts';
import { fixtureWorld } from '../fixture.ts';
import { marchDays } from '../march.ts';
import { newGame } from '../new-game.ts';
import { removeRecord } from '../records.ts';
import { ENGAGEMENT_DISTANCE, MAX_RETREAT_DAYS, MORALE_RECOVERY, REFORM_DAYS } from './battles.ts';

const ROMA = { x: 2511.3, y: 2335.8 };
const CAPUA = { x: 2638.8, y: 2448.3 };
const CARTHAGO = { x: 2229.9, y: 2865.1 };
const world = fixtureWorld();
const STORES = { gold: 10_000, food: 10_000, manpower: 0 };
const FAR_AWAY: ArmyActivity = { kind: 'idle', position: { x: 0, y: 0 } };

function atWar(seed = 1): GameState {
  const state = buildFixture(seed);
  expect(
    executeOrder(
      state,
      { kind: 'declareWar', faction: FIXTURE.rome, against: FIXTURE.carthage },
      world,
    ),
  ).toBeUndefined();
  return state;
}

function army(state: GameState, id: ArmyId) {
  const found = state.armies[id];
  if (!found) throw new Error(`army ${id} is missing`);
  return found;
}

function place(state: GameState, id: ArmyId, activity: ArmyActivity) {
  army(state, id).activity = activity;
}

function addArmy(
  state: GameState,
  id: string,
  men: number,
  activity: ArmyActivity,
  owner: FactionId = FIXTURE.rome,
) {
  const armyId = id as ArmyId;
  const formation = `${id}-spearmen` as FormationId;
  state.formations[formation] = { id: formation, army: armyId, troop: 'spearmen', men, morale: 1 };
  state.armies[armyId] = {
    id: armyId,
    owner,
    name: 'Test Army',
    formations: [formation],
    stance: 'holdTheLine',
    generalSkill: 3,
    activity,
  };
  return armyId;
}

function setMen(state: GameState, id: FormationId, men: number) {
  const formation = state.formations[id];
  if (!formation) throw new Error(`formation ${id} is missing`);
  formation.men = men;
}

function menOf(state: GameState, id: ArmyId): number {
  return army(state, id).formations.reduce((sum, f) => sum + (state.formations[f]?.men ?? 0), 0);
}

function playUntilPeace(state: GameState, maxDays = 100): GameState {
  for (let day = 0; day < maxDays && Object.keys(state.battles).length > 0; day += 1) {
    state = tick(state, [], world).state;
    expectConsistent(state);
  }
  return state;
}

describe('engagement', () => {
  test('armies of factions at war within the engagement distance start a battle', () => {
    const state = atWar();
    place(state, FIXTURE.punicArmy, {
      kind: 'idle',
      position: { x: 2516.3 + ENGAGEMENT_DISTANCE, y: 2340.8 },
    });
    const next = tick(state, [], world).state;
    const [battle] = Object.values(next.battles);
    expect(battle).toMatchObject({
      attackers: [FIXTURE.punicArmy],
      defenders: [FIXTURE.romanArmy],
      startedOn: 1,
    });
    expect(army(next, FIXTURE.romanArmy).activity).toMatchObject({
      kind: 'inBattle',
      battle: battle?.id,
    });
    expectConsistent(next);
  });

  test('armies of factions at peace pass each other', () => {
    const state = buildFixture();
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2517.3, y: 2340.8 } });
    const next = tick(state, [], world).state;
    expect(next.battles).toEqual({});
    expect(army(next, FIXTURE.punicArmy).activity.kind).toBe('idle');
    expectConsistent(next);
  });

  test('armies at war farther apart than the engagement distance do not fight', () => {
    const state = atWar();
    place(state, FIXTURE.punicArmy, {
      kind: 'idle',
      position: { x: 2516.3 + ENGAGEMENT_DISTANCE + 1, y: 2340.8 },
    });
    expect(tick(state, [], world).state.battles).toEqual({});
    expectConsistent(state);
  });

  test('a marching army attacks an idle one', () => {
    const state = atWar();
    place(state, FIXTURE.romanArmy, {
      kind: 'marching',
      position: { x: 2516.3, y: 2340.8 },
      waypoints: [{ x: 2600, y: 2340.8 }],
    });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2521.3, y: 2340.8 } });
    const next = tick(state, [], world).state;
    expect(Object.values(next.battles)[0]).toMatchObject({
      attackers: [FIXTURE.romanArmy],
      defenders: [FIXTURE.punicArmy],
    });
    expectConsistent(next);
  });

  test('a third army that comes within range joins the side it is not at war with', () => {
    let state = atWar();
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2521.3, y: 2340.8 } });
    state = tick(state, [], world).state;
    const [battle] = Object.values(state.battles);
    if (!battle) throw new Error('no battle started');
    const reserve = addArmy(state, 'reserve', 800, {
      kind: 'marching',
      position: { x: battle.position.x, y: battle.position.y + ENGAGEMENT_DISTANCE },
      waypoints: [battle.position],
    });
    state = tick(state, [], world).state;
    expect(state.battles[battle.id]?.defenders).toEqual([FIXTURE.romanArmy, reserve]);
    expect(army(state, reserve).activity).toMatchObject({ kind: 'inBattle', battle: battle.id });
    expectConsistent(state);
  });

  test('reserves of both sides that reach a running battle together join it', () => {
    let state = atWar();
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2521.3, y: 2340.8 } });
    state = tick(state, [], world).state;
    const [battle] = Object.values(state.battles);
    if (!battle) throw new Error('no battle started');
    const roman = addArmy(state, 'roman-reserve', 500, { kind: 'idle', position: battle.position });
    const punic = addArmy(
      state,
      'punic-reserve',
      500,
      { kind: 'idle', position: battle.position },
      FIXTURE.carthage,
    );
    state = tick(state, [], world).state;
    expect(Object.keys(state.battles)).toEqual([battle.id]);
    expect(state.battles[battle.id]).toMatchObject({
      attackers: [FIXTURE.punicArmy, punic],
      defenders: [FIXTURE.romanArmy, roman],
    });
    expectConsistent(state);
  });

  test('reserves of both sides beside a battle that starts today join it instead of starting another', () => {
    const state = atWar();
    place(state, FIXTURE.romanArmy, { kind: 'idle', position: { x: 2521.3, y: 2340.8 } });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2521.3, y: 2340.8 } });
    const roman = addArmy(state, 'roman-reserve', 500, {
      kind: 'idle',
      position: { x: 2521.3, y: 2340.8 },
    });
    const punic = addArmy(
      state,
      'punic-reserve',
      500,
      { kind: 'idle', position: { x: 2521.3, y: 2340.8 } },
      FIXTURE.carthage,
    );
    const next = tick(state, [], world).state;
    const battles = Object.values(next.battles);
    expect(battles).toHaveLength(1);
    expect(battles[0]).toMatchObject({
      attackers: [FIXTURE.punicArmy, punic],
      defenders: [FIXTURE.romanArmy, roman],
    });
    expectConsistent(next);
  });

  test('a reserve beside a battle that starts today joins it on its first day', () => {
    const state = atWar();
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2516.3, y: 2340.8 } });
    const reserve = addArmy(state, 'reserve', 3000, {
      kind: 'idle',
      position: { x: 2516.3, y: 2340.8 },
    });
    const next = tick(state, [], world).state;
    const [battle] = Object.values(next.battles);
    expect([...(battle?.attackers ?? []), ...(battle?.defenders ?? [])].sort()).toEqual(
      [FIXTURE.punicArmy, FIXTURE.romanArmy, reserve].sort(),
    );
    expectConsistent(next);
  });

  test('an enemy in reach of an army that another battle took today joins that battle and does not walk past', () => {
    const state = atWar();
    place(state, FIXTURE.punicArmy, FAR_AWAY);
    const bait = addArmy(
      state,
      'army-a-bait',
      100,
      { kind: 'idle', position: { x: 2516.3 - 5, y: 2340.8 } },
      FIXTURE.carthage,
    );
    const passer = addArmy(
      state,
      'army-z-passer',
      1000,
      { kind: 'idle', position: { x: 2516.3 + ENGAGEMENT_DISTANCE - 1, y: 2340.8 } },
      FIXTURE.carthage,
    );
    const next = tick(state, [], world).state;
    const [battle] = Object.values(next.battles);
    expect(Object.values(next.battles)).toHaveLength(1);
    expect([...(battle?.attackers ?? []), ...(battle?.defenders ?? [])].sort()).toEqual(
      [bait, passer, FIXTURE.romanArmy].sort(),
    );
    expectConsistent(next);
  });

  test('a third army joins only a side whose enemies are all its enemies', () => {
    const state = atWar();
    const egypt = 'egypt' as FactionId;
    const persia = 'persia' as FactionId;
    state.factions[egypt] = {
      id: egypt,
      name: 'Egypt',
      kind: 'greatPower',
      stores: STORES,
      defeatedOn: null,
    };
    state.factions[persia] = {
      id: persia,
      name: 'Persia',
      kind: 'greatPower',
      stores: STORES,
      defeatedOn: null,
    };
    executeOrder(state, { kind: 'declareWar', faction: egypt, against: FIXTURE.carthage }, world);
    executeOrder(state, { kind: 'declareWar', faction: persia, against: FIXTURE.rome }, world);
    place(state, FIXTURE.romanArmy, { kind: 'idle', position: { x: 2521.3, y: 2340.8 } });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2521.3, y: 2340.8 } });
    const egyptian = addArmy(
      state,
      'egyptian',
      1000,
      { kind: 'idle', position: { x: 2526.3, y: 2340.8 } },
      egypt,
    );
    const persian = addArmy(
      state,
      'persian',
      1000,
      { kind: 'idle', position: { x: 2526.3, y: 2340.8 } },
      persia,
    );
    const next = tick(state, [], world).state;
    expect(Object.values(next.battles)[0]).toMatchObject({
      attackers: [FIXTURE.punicArmy],
      defenders: [FIXTURE.romanArmy, egyptian],
    });
    expect(army(next, persian).activity.kind).toBe('idle');
    expectConsistent(next);
  });
});

describe('the end of a battle', () => {
  test('the winner stands where it fought and the beaten army retreats to its nearest safe city', () => {
    let state = atWar();
    const outnumbered = addArmy(state, 'outnumbered', 400, {
      kind: 'idle',
      position: { x: 2633.8, y: 2443.3 },
    });
    place(state, FIXTURE.romanArmy, FAR_AWAY);
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2628.8, y: 2438.3 } });
    state = playUntilPeace(tick(state, [], world).state);

    expect(state.battles).toEqual({});
    expect(army(state, FIXTURE.punicArmy).activity).toEqual({
      kind: 'idle',
      position: { x: 2628.8, y: 2438.3 },
    });
    const retreat = army(state, outnumbered).activity;
    expect(retreat).toMatchObject({ kind: 'retreating', position: { x: 2633.8, y: 2443.3 } });
    expect(retreat.kind === 'retreating' && retreat.waypoints.at(-1)).toEqual(ROMA);
    expect(menOf(state, outnumbered)).toBeGreaterThan(0);
    expectConsistent(state);
  });

  test('a beaten army beside its own besieged city goes past it to safety and is alive 30 days later', () => {
    let state = atWar();
    place(state, FIXTURE.romanArmy, FAR_AWAY);
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: CAPUA.x + 3, y: CAPUA.y } });
    state = tick(state, [], world).state;
    expect(Object.values(state.sieges).map((siege) => siege.city)).toEqual([FIXTURE.capua]);
    const beaten = addArmy(state, 'beaten', 600, {
      kind: 'idle',
      position: { x: CAPUA.x - 3, y: CAPUA.y },
    });
    const battlesFought = new Set<string>();
    for (let day = 0; day < 30; day += 1) {
      state = tick(state, [], world).state;
      const activity = state.armies[beaten]?.activity;
      if (activity?.kind === 'inBattle') battlesFought.add(activity.battle);
      expectConsistent(state);
    }
    expect(battlesFought.size).toBe(1);
    expect(state.armies[beaten]).toBeDefined();
    expect(menOf(state, beaten)).toBeGreaterThan(200);
    const at = army(state, beaten).activity;
    expect(at.kind === 'idle' && at.position).toEqual(ROMA);
  });

  test('a beaten army does not turn and fight again while it retreats', () => {
    let state = atWar();
    const outnumbered = addArmy(state, 'outnumbered', 400, {
      kind: 'idle',
      position: { x: 2521.3, y: 2345.8 },
    });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2521.3, y: 2345.8 } });
    place(state, FIXTURE.romanArmy, FAR_AWAY);
    state = playUntilPeace(tick(state, [], world).state);
    expect(army(state, outnumbered).activity.kind).toBe('retreating');
    for (let day = 0; day < 5; day += 1) {
      state = tick(state, [], world).state;
      expect(state.battles).toEqual({});
    }
    expectConsistent(state);
  });

  test('a retreating army takes no orders until it arrives', () => {
    let state = atWar();
    const outnumbered = addArmy(state, 'outnumbered', 400, {
      kind: 'idle',
      position: { x: 2521.3, y: 2345.8 },
    });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2521.3, y: 2345.8 } });
    place(state, FIXTURE.romanArmy, FAR_AWAY);
    state = playUntilPeace(tick(state, [], world).state);
    const { rejected } = tick(
      state,
      [
        { kind: 'moveArmy', faction: FIXTURE.rome, army: outnumbered, to: CAPUA },
        { kind: 'halt', faction: FIXTURE.rome, army: outnumbered },
      ],
      world,
    );
    expect(rejected.map((r) => r.order.kind)).toEqual(['moveArmy', 'halt']);
    expectConsistent(state);
  });

  test("the enemy's horsemen cut down more of a beaten army as it breaks", () => {
    const lostToPursuit = (troop: 'spearmen' | 'lightCavalry') => {
      let state = atWar();
      place(state, FIXTURE.romanArmy, FAR_AWAY);
      const winner = addArmy(state, 'winner', 3000, {
        kind: 'idle',
        position: { x: 2521.3, y: 2345.8 },
      });
      const formation = state.formations[`${winner}-spearmen` as FormationId];
      if (formation) formation.troop = troop;
      place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2526.3, y: 2345.8 } });
      setMen(state, FIXTURE.citizenSpears, 1000);
      let lost = 0;
      for (let day = 0; day < 30 && lost === 0; day += 1) {
        const result = tick(state, [], world);
        state = result.state;
        for (const event of result.events) if (event.kind === 'armyRetreated') lost = event.lost;
      }
      return lost;
    };
    expect(lostToPursuit('lightCavalry')).toBeGreaterThan(2 * lostToPursuit('spearmen'));
  });

  test('a winner that was marching takes up its march again', () => {
    let state = atWar();
    place(state, FIXTURE.punicArmy, FAR_AWAY);
    expect(
      executeOrder(
        state,
        { kind: 'moveArmy', faction: FIXTURE.rome, army: FIXTURE.romanArmy, to: CAPUA },
        world,
      ),
    ).toBeUndefined();
    const blocking = addArmy(
      state,
      'blocking',
      300,
      { kind: 'idle', position: { x: 2538.8, y: 2360.6 } },
      FIXTURE.carthage,
    );
    state = playUntilPeace(tick(state, [], world).state);
    expect(army(state, blocking).activity.kind).toBe('retreating');
    const winner = army(state, FIXTURE.romanArmy).activity;
    expect(winner.kind === 'marching' && winner.waypoints.at(-1)).toEqual(CAPUA);
    expectConsistent(state);
  });

  test('an army with no men left is removed with its formations', () => {
    let state = atWar();
    const doomed = addArmy(state, 'doomed', 3, {
      kind: 'idle',
      position: { x: 2521.3, y: 2345.8 },
    });
    place(state, FIXTURE.romanArmy, FAR_AWAY);
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2521.3, y: 2345.8 } });
    const result = tick(state, [], world);
    state = result.state;

    expect(state.armies[doomed]).toBeUndefined();
    expect(state.formations['doomed-spearmen' as FormationId]).toBeUndefined();
    expect(state.battles).toEqual({});
    expect(army(state, FIXTURE.punicArmy).activity.kind).toBe('idle');
    expect(result.events.map((event) => event.kind)).toEqual([
      'battleBegan',
      'armyDestroyed',
      'battleEnded',
    ]);
    expectConsistent(state);
  });

  test('only a small remnant can be wiped out in one day', () => {
    const firstDay = (men: number) => {
      const state = atWar();
      place(state, FIXTURE.romanArmy, FAR_AWAY);
      addArmy(state, 'host', 20_000, { kind: 'idle', position: { x: 2521.3, y: 2345.8 } });
      const small = addArmy(
        state,
        'small',
        men,
        {
          kind: 'idle',
          position: { x: 2526.3, y: 2345.8 },
        },
        FIXTURE.carthage,
      );
      place(state, FIXTURE.punicArmy, FAR_AWAY);
      return tick(state, [], world).state.armies[small];
    };
    expect(firstDay(40)).toBeUndefined();
    expect(firstDay(300)).toBeDefined();
  });

  test('a beaten army with no safe city retreats into the field, away from the enemy', () => {
    let state = atWar();
    for (const city of Object.values(state.cities)) city.owner = FIXTURE.rome;
    addArmy(state, 'legion', 4000, { kind: 'idle', position: { x: 2521.3, y: 2345.8 } });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2531.3, y: 2345.8 } });
    state = playUntilPeace(tick(state, [], world).state);
    const retreat = army(state, FIXTURE.punicArmy).activity;
    expect(retreat.kind).toBe('retreating');
    const end = retreat.kind === 'retreating' ? retreat.waypoints.at(-1) : undefined;
    expect(end && Math.hypot(end.x - 2521.3, end.y - 2345.8)).toBeGreaterThan(90);
    expectConsistent(state);
  });

  test('a beaten army with no land to retreat over surrenders', () => {
    let state = atWar();
    const islet = { x: 2117.5, y: 2587.5 };
    place(state, FIXTURE.romanArmy, FAR_AWAY);
    addArmy(state, 'legion', 4000, { kind: 'idle', position: islet });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: islet.x + 1, y: islet.y } });
    const men = menOf(state, FIXTURE.punicArmy);
    const ended = [];
    for (let day = 0; day < 30 && ended.length === 0; day += 1) {
      const result = tick(state, [], world);
      state = result.state;
      ended.push(...result.events.filter((event) => event.kind === 'battleEnded'));
    }
    expect(state.armies[FIXTURE.punicArmy]).toBeUndefined();
    expect(state.formations[FIXTURE.citizenSpears]).toBeUndefined();
    expect(ended).toMatchObject([{ winner: 'defenders', attackers: { lost: men } }]);
    expectConsistent(state);
  });

  test('formations of an idle army in the field regain morale each day', () => {
    const state = buildFixture();
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2300, y: 2800 } });
    const next = tick(state, [], world).state;
    expect(next.formations[FIXTURE.citizenSpears]?.morale).toBeCloseTo(0.9 + MORALE_RECOVERY);
    expect(tick(next, [], world).state.formations[FIXTURE.citizenSpears]?.morale).toBeCloseTo(
      0.9 + 2 * MORALE_RECOVERY,
    );
    expectConsistent(next);
  });

  test('a broken army at a city of its own that no siege holds regains a fifth of its morale a day', () => {
    const state = buildFixture();
    const spears = state.formations[FIXTURE.citizenSpears];
    if (!spears) throw new Error('fixture changed');
    spears.morale = 0;
    const next = tick(state, [], world).state;
    expect(next.formations[FIXTURE.citizenSpears]?.morale).toBeCloseTo(0.2);
    expect(tick(next, [], world).state.formations[FIXTURE.citizenSpears]?.morale).toBeCloseTo(0.4);
    expectConsistent(next);
  });

  test('a broken army at its own besieged city regains morale only at the pace of the field', () => {
    // Besiegers at peace with Carthage fight no battle with it today, so the day shows recovery alone.
    const state = buildFixture();
    const spears = state.formations[FIXTURE.citizenSpears];
    if (!spears) throw new Error('fixture changed');
    spears.morale = 0;
    const siege = 'siege-carthago' as SiegeId;
    addArmy(
      state,
      'besiegers',
      3000,
      { kind: 'besieging', position: { x: 2229.9, y: 2875.1 }, siege },
      FIXTURE.syracusaeFaction,
    );
    state.sieges[siege] = {
      id: siege,
      city: FIXTURE.carthago,
      besiegers: ['besiegers' as ArmyId],
      startedOn: state.day,
    };
    const next = tick(state, [], world).state;
    expect(next.formations[FIXTURE.citizenSpears]?.morale).toBeCloseTo(MORALE_RECOVERY);
    expectConsistent(next);
  });
});

describe('the length of a battle', () => {
  const MIX: ArmySpec['troops'] = {
    spearmen: 1500,
    swordsmen: 900,
    archers: 300,
    lightCavalry: 300,
  };
  const days = (b: ArmySpec['troops']) =>
    Array.from(
      { length: 50 },
      (_, seed) => playTrial({ name: '', a: { troops: MIX }, b: { troops: b } }, seed + 1).days,
    ).sort((x, y) => x - y);

  test('armies of about the same strength fight for 6 to 12 days', () => {
    const even = days(MIX);
    expect(even[25]).toBeGreaterThanOrEqual(6);
    expect(even[25]).toBeLessThanOrEqual(12);
  });

  test('a side outnumbered two to one holds for at least 3 days', () => {
    const half = Object.fromEntries(Object.entries(MIX).map(([troop, men]) => [troop, men / 2]));
    expect(days(half)[0]).toBeGreaterThanOrEqual(3);
  });

  test("numbers outweigh the best general's skill", () => {
    const more = Object.fromEntries(Object.entries(MIX).map(([troop, men]) => [troop, men * 1.2]));
    const results = Array.from({ length: 50 }, (_, seed) =>
      playTrial(
        { name: '', a: { troops: MIX, generalSkill: 10 }, b: { troops: more, generalSkill: 0 } },
        seed + 1,
      ),
    );
    expect(results.filter((r) => r.winner === 'b').length).toBeGreaterThan(40);
  });
});

describe('the retreat order', () => {
  function inBattle(at: { x: number; y: number }) {
    const state = atWar();
    place(state, FIXTURE.romanArmy, { kind: 'idle', position: at });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: at.x + 5, y: at.y } });
    return tick(state, [], world).state;
  }

  test('pulls the army out at a price in men, and the enemy holds the field', () => {
    const before = inBattle({ x: CARTHAGO.x - 60, y: CARTHAGO.y + 20 });
    const men = before.formations[FIXTURE.citizenSpears]?.men ?? 0;
    const { state, rejected, events } = tick(
      before,
      [{ kind: 'retreat', faction: FIXTURE.carthage, army: FIXTURE.punicArmy }],
      world,
    );
    expect(rejected).toEqual([]);
    expect(state.battles).toEqual({});
    const retreat = army(state, FIXTURE.punicArmy).activity;
    expect(retreat.kind === 'retreating' && retreat.waypoints.at(-1)).toEqual(CARTHAGO);
    expect(state.formations[FIXTURE.citizenSpears]?.men).toBe(men - Math.round(men * 0.15));
    expect(army(state, FIXTURE.romanArmy).activity.kind).toBe('idle');
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'armyRetreated', army: FIXTURE.punicArmy, ordered: true }),
    );
    expectConsistent(state);
  });

  test('saves men that fighting on until the army breaks would cost', () => {
    const kept = (retreatOnDay: number | undefined) =>
      Array.from({ length: 20 }, (_, seed) => {
        let state = atWar(seed + 1);
        place(state, FIXTURE.romanArmy, FAR_AWAY);
        addArmy(state, 'host', 6000, { kind: 'idle', position: { x: 2521.3, y: 2345.8 } });
        place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2526.3, y: 2345.8 } });
        setMen(state, FIXTURE.citizenSpears, 3000);
        for (let day = 1; day <= 30; day += 1) {
          const orders =
            day === retreatOnDay && army(state, FIXTURE.punicArmy).activity.kind === 'inBattle'
              ? [{ kind: 'retreat', faction: FIXTURE.carthage, army: FIXTURE.punicArmy } as const]
              : [];
          state = tick(state, orders, world).state;
        }
        return state.armies[FIXTURE.punicArmy] ? menOf(state, FIXTURE.punicArmy) : 0;
      }).reduce((sum, men) => sum + men, 0);
    expect(kept(2)).toBeGreaterThan(kept(undefined));
  });

  test('is rejected for an army that is not in a battle', () => {
    const state = atWar();
    const order = { kind: 'retreat', faction: FIXTURE.rome, army: FIXTURE.romanArmy } as const;
    expect(executeOrder(state, order, world)?.reason).toBe('army army-roman is not in a battle');
    expectConsistent(state);
  });

  test("is rejected for another faction's army", () => {
    const state = inBattle({ x: 2516.3, y: 2340.8 });
    const before = structuredClone(state);
    const order = { kind: 'retreat', faction: FIXTURE.rome, army: FIXTURE.punicArmy } as const;
    expect(executeOrder(state, order, world)?.reason).toBe(
      'army army-punic belongs to carthage, not rome',
    );
    expect(state).toEqual(before);
    expectConsistent(state);
  });
});

describe('stances', () => {
  const MIX: ArmySpec['troops'] = {
    spearmen: 1500,
    swordsmen: 900,
    archers: 300,
    lightCavalry: 300,
  };
  const SEEDS = 100;

  function averages(a: Stance, b: Stance) {
    const matchup: Matchup = {
      name: '',
      a: { troops: MIX, stance: a },
      b: { troops: MIX, stance: b },
    };
    const results = Array.from({ length: SEEDS }, (_, seed) => playTrial(matchup, seed + 1));
    for (const { state } of results) expectConsistent(state);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / SEEDS;
    return {
      days: mean(results.map((r) => r.days)),
      keptA: mean(results.map((r) => r.kept.a)),
      keptB: mean(results.map((r) => r.kept.b)),
      aWins: results.filter((r) => r.winner === 'a').length / SEEDS,
    };
  }

  const hold = averages('holdTheLine', 'holdTheLine');

  test('allOutAssault costs both sides more men and ends the battle sooner', () => {
    const assault = averages('allOutAssault', 'allOutAssault');
    expect(assault.days).toBeLessThan(hold.days);
    expect(assault.keptA).toBeLessThan(hold.keptA);
    expect(assault.keptB).toBeLessThan(hold.keptB);
  });

  test('skirmishAndWithdraw on both sides costs both fewer men', () => {
    const skirmish = averages('skirmishAndWithdraw', 'skirmishAndWithdraw');
    expect(skirmish.keptA).toBeGreaterThan(hold.keptA);
    expect(skirmish.keptB).toBeGreaterThan(hold.keptB);
  });

  test.each([
    ['holdTheLine', 'allOutAssault'],
    ['allOutAssault', 'skirmishAndWithdraw'],
    ['skirmishAndWithdraw', 'holdTheLine'],
  ] as const)('in an even battle %s beats %s', (mine, theirs) => {
    expect(averages(mine, theirs).aWins).toBeGreaterThan(0.65);
  });

  test('the right stance gives a side outnumbered 1.3 to 1 a fair chance', () => {
    const more = Object.fromEntries(Object.entries(MIX).map(([troop, men]) => [troop, men * 1.3]));
    const wins = (a: Stance, b: Stance) =>
      Array.from({ length: SEEDS }, (_, seed) =>
        playTrial(
          { name: '', a: { troops: MIX, stance: a }, b: { troops: more, stance: b } },
          seed + 1,
        ),
      ).filter((r) => r.winner === 'a').length / SEEDS;
    expect(wins('skirmishAndWithdraw', 'holdTheLine')).toBeGreaterThanOrEqual(0.3);
    expect(wins('holdTheLine', 'holdTheLine')).toBe(0);
  });
});

describe('determinism', () => {
  function campaign(seed: number) {
    let state = atWar(seed);
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 2521.3, y: 2345.8 } });
    for (let day = 1; day <= 30; day += 1) {
      const orders =
        day === 3
          ? [
              {
                kind: 'setStance',
                faction: FIXTURE.rome,
                army: FIXTURE.romanArmy,
                stance: 'allOutAssault',
              } as const,
            ]
          : [];
      state = tick(state, orders, world).state;
    }
    expectConsistent(state);
    return saveGame(state);
  }

  test('the same seed and orders give the same battle', () => {
    expect(campaign(11)).toBe(campaign(11));
  });

  test('another seed gives another battle', () => {
    expect(campaign(12)).not.toBe(campaign(11));
  });
});

describe('a retreat overseas', () => {
  /**
   * The power's starting army, cut to a few men, fights the enemy's starting army at the
   * enemy's city across the sea, on the new game, and is beaten.
   */
  function beatenAt(power: string, enemy: string, at: string): GameState {
    let state = newGame(world.map, { seed: 1, player: 'rome' });
    const ours = power as FactionId;
    const theirs = enemy as FactionId;
    expect(
      executeOrder(state, { kind: 'declareWar', faction: ours, against: theirs }, world),
    ).toBeUndefined();
    const where = state.cities[at as CityId]?.position;
    if (!where) throw new Error(`no city ${at}`);
    const [loser, ...others] = Object.values(state.armies).filter((a) => a.owner === ours);
    const winner = Object.values(state.armies).find((a) => a.owner === theirs);
    if (!loser || !winner) throw new Error('no armies');
    for (const other of others) other.activity = FAR_AWAY;
    for (const id of loser.formations.slice(1)) removeRecord(state.formations, id);
    loser.formations = loser.formations.slice(0, 1);
    const formation = state.formations[loser.formations[0] as FormationId];
    if (formation) formation.men = 500;
    loser.activity = { kind: 'idle', position: { x: where.x - 4, y: where.y } };
    winner.activity = { kind: 'idle', position: { x: where.x - 2, y: where.y } };
    for (let day = 0; day < 60 && army(state, loser.id).activity.kind !== 'retreating'; day += 1) {
      const result = tick(state, [], world);
      state = result.state;
      if (!state.armies[loser.id])
        throw new Error(
          `${power} lost its army at ${at}: ${JSON.stringify(result.events.filter((e) => e.kind !== 'battleBegan'))}`,
        );
    }
    return state;
  }

  function retreatOf(state: GameState, power: string) {
    const beaten = Object.values(state.armies).find(
      (a) => a.owner === power && a.activity.kind === 'retreating',
    );
    const activity = beaten?.activity;
    if (activity?.kind !== 'retreating') throw new Error(`no army of ${power} retreats`);
    return {
      days: marchDays(activity.position, activity.waypoints),
      to: activity.waypoints.at(-1),
    };
  }

  test.each([
    ['rome', 'carthage', 'hadrumetum', 'capua'],
    ['carthage', 'rome', 'roma', 'carthago'],
  ])(
    '%s, beaten by %s at %s, falls back within the bound and not round the sea to %s',
    (power, enemy, at, home) => {
      const state = beatenAt(power, enemy, at);
      const { days, to } = retreatOf(state, power);
      expect(days).toBeLessThanOrEqual(MAX_RETREAT_DAYS);
      const city = state.cities[home as CityId]?.position;
      expect(to && city && Math.hypot(to.x - city.x, to.y - city.y)).toBeGreaterThan(500);
      expectConsistent(state);
    },
  );
});

describe('a change of stance', () => {
  const MIX: ArmySpec['troops'] = {
    spearmen: 1500,
    swordsmen: 900,
    archers: 300,
    lightCavalry: 300,
  };
  const world = fixtureWorld();
  const lostOnDayOne = (changed: boolean) => {
    const state = buildTrial(
      { name: '', a: { troops: MIX, stance: 'holdTheLine' }, b: { troops: MIX } },
      1,
    );
    if (changed) {
      const order = {
        kind: 'setStance',
        faction: FIXTURE.rome,
        army: TRIAL_ARMIES.a,
        stance: 'skirmishAndWithdraw',
      } as const;
      expect(executeOrder(state, order, world)).toBeUndefined();
    } else {
      const army = state.armies[TRIAL_ARMIES.a];
      if (army) army.stance = 'skirmishAndWithdraw';
    }
    const next = tick(state, [], world).state;
    expectConsistent(next);
    const men = (id: ArmyId) =>
      (next.armies[id]?.formations ?? []).reduce(
        (sum, f) => sum + (next.formations[f]?.men ?? 0),
        0,
      );
    return { a: 3000 - men(TRIAL_ARMIES.a), b: 3000 - men(TRIAL_ARMIES.b) };
  };

  test('records the day of the change, and an order for the stance an army holds changes nothing', () => {
    const state = buildFixture();
    const order = { kind: 'setStance', faction: FIXTURE.rome, army: FIXTURE.romanArmy } as const;
    expect(executeOrder(state, { ...order, stance: 'holdTheLine' }, world)).toBeUndefined();
    expect(state.armies[FIXTURE.romanArmy]?.stanceChangedOn).toBeUndefined();
    expect(executeOrder(state, { ...order, stance: 'allOutAssault' }, world)).toBeUndefined();
    expect(state.armies[FIXTURE.romanArmy]?.stanceChangedOn).toBe(state.day);
    expectConsistent(state);
  });

  test(`an army re-forming after a change is beaten for ${REFORM_DAYS} days, even by the stance its new one beats`, () => {
    const settled = lostOnDayOne(false);
    expect(settled.a).toBeLessThan(settled.b);
    const reforming = lostOnDayOne(true);
    expect(reforming.a).toBeGreaterThan(reforming.b);
  });

  test('an army that changes its stance every day loses an even battle to one that holds', () => {
    const results = Array.from({ length: 40 }, (_, seed) => {
      let state = buildTrial({ name: '', a: { troops: MIX }, b: { troops: MIX } }, seed + 1);
      const cycle: readonly Stance[] = ['skirmishAndWithdraw', 'allOutAssault', 'holdTheLine'];
      for (let day = 0; day < 60; day++) {
        const stance = cycle[day % cycle.length] as Stance;
        const orders = [
          { kind: 'setStance', faction: FIXTURE.rome, army: TRIAL_ARMIES.a, stance } as const,
        ];
        state = tick(state, orders, world).state;
        if (day > 0 && Object.keys(state.battles).length === 0) break;
      }
      return state.armies[TRIAL_ARMIES.b]?.activity.kind === 'idle';
    });
    expect(results.filter(Boolean).length).toBeGreaterThan(30);
  });
});
