import { describe, expect, test } from 'vitest';
import { playTrial, type ArmySpec, type Matchup } from '../battle-trial.ts';
import { buildFixture, FIXTURE } from '../fixture.ts';
import type { ArmyId, FactionId, FormationId } from '../ids.ts';
import { executeOrder } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import { saveGame } from '../save.ts';
import type { ArmyActivity, Stance } from '../state/army.ts';
import type { GameState } from '../state/game-state.ts';
import { tick } from '../tick.ts';
import { ENGAGEMENT_DISTANCE, MORALE_RECOVERY } from './battles.ts';

const CAPUA = { x: 1300, y: 660 };
const CARTHAGO = { x: 1150, y: 900 };
const STORES = { gold: 10_000, food: 10_000, manpower: 0 };
const FAR_AWAY: ArmyActivity = { kind: 'idle', position: { x: 0, y: 0 } };

function atWar(seed = 1): GameState {
  const state = buildFixture(seed);
  expect(
    executeOrder(state, { kind: 'declareWar', faction: FIXTURE.rome, against: FIXTURE.carthage }),
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
    formations: [formation],
    stance: 'holdTheLine',
    generalSkill: 3,
    activity,
  };
  return armyId;
}

function menOf(state: GameState, id: ArmyId): number {
  return army(state, id).formations.reduce((sum, f) => sum + (state.formations[f]?.men ?? 0), 0);
}

function playUntilPeace(state: GameState, maxDays = 100): GameState {
  for (let day = 0; day < maxDays && Object.keys(state.battles).length > 0; day += 1) {
    state = tick(state, []).state;
    expectConsistent(state);
  }
  return state;
}

describe('engagement', () => {
  test('armies of factions at war within the engagement distance start a battle', () => {
    const state = atWar();
    place(state, FIXTURE.punicArmy, {
      kind: 'idle',
      position: { x: 1245 + ENGAGEMENT_DISTANCE, y: 615 },
    });
    const next = tick(state, []).state;
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
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1246, y: 615 } });
    const next = tick(state, []).state;
    expect(next.battles).toEqual({});
    expect(army(next, FIXTURE.punicArmy).activity.kind).toBe('idle');
    expectConsistent(next);
  });

  test('armies at war farther apart than the engagement distance do not fight', () => {
    const state = atWar();
    place(state, FIXTURE.punicArmy, {
      kind: 'idle',
      position: { x: 1245 + ENGAGEMENT_DISTANCE + 1, y: 615 },
    });
    expect(tick(state, []).state.battles).toEqual({});
    expectConsistent(state);
  });

  test('a marching army attacks an idle one', () => {
    const state = atWar();
    place(state, FIXTURE.romanArmy, {
      kind: 'marching',
      position: { x: 1245, y: 615 },
      destination: CARTHAGO,
    });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 615 } });
    const next = tick(state, []).state;
    expect(Object.values(next.battles)[0]).toMatchObject({
      attackers: [FIXTURE.romanArmy],
      defenders: [FIXTURE.punicArmy],
    });
    expectConsistent(next);
  });

  test('a third army that comes within range joins the side it is not at war with', () => {
    let state = atWar();
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 615 } });
    state = tick(state, []).state;
    const [battle] = Object.values(state.battles);
    if (!battle) throw new Error('no battle started');
    const reserve = addArmy(state, 'reserve', 800, {
      kind: 'marching',
      position: { x: battle.position.x, y: battle.position.y + ENGAGEMENT_DISTANCE },
      destination: battle.position,
    });
    state = tick(state, []).state;
    expect(state.battles[battle.id]?.defenders).toEqual([FIXTURE.romanArmy, reserve]);
    expect(army(state, reserve).activity).toMatchObject({ kind: 'inBattle', battle: battle.id });
    expectConsistent(state);
  });

  test('reserves of both sides that reach a running battle together join it', () => {
    let state = atWar();
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 615 } });
    state = tick(state, []).state;
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
    state = tick(state, []).state;
    expect(Object.keys(state.battles)).toEqual([battle.id]);
    expect(state.battles[battle.id]).toMatchObject({
      attackers: [FIXTURE.punicArmy, punic],
      defenders: [FIXTURE.romanArmy, roman],
    });
    expectConsistent(state);
  });

  test('reserves of both sides beside a battle that starts today join it instead of starting another', () => {
    const state = atWar();
    place(state, FIXTURE.romanArmy, { kind: 'idle', position: { x: 1250, y: 615 } });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 615 } });
    const roman = addArmy(state, 'roman-reserve', 500, {
      kind: 'idle',
      position: { x: 1250, y: 615 },
    });
    const punic = addArmy(
      state,
      'punic-reserve',
      500,
      { kind: 'idle', position: { x: 1250, y: 615 } },
      FIXTURE.carthage,
    );
    const next = tick(state, []).state;
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
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1245, y: 615 } });
    const reserve = addArmy(state, 'reserve', 3000, {
      kind: 'idle',
      position: { x: 1245, y: 615 },
    });
    const next = tick(state, []).state;
    const [battle] = Object.values(next.battles);
    expect([...(battle?.attackers ?? []), ...(battle?.defenders ?? [])].sort()).toEqual(
      [FIXTURE.punicArmy, FIXTURE.romanArmy, reserve].sort(),
    );
    expectConsistent(next);
  });

  test('a third army joins only a side whose enemies are all its enemies', () => {
    const state = atWar();
    const egypt = 'egypt' as FactionId;
    const persia = 'persia' as FactionId;
    state.factions[egypt] = { id: egypt, name: 'Egypt', kind: 'greatPower', stores: STORES };
    state.factions[persia] = { id: persia, name: 'Persia', kind: 'greatPower', stores: STORES };
    executeOrder(state, { kind: 'declareWar', faction: egypt, against: FIXTURE.carthage });
    executeOrder(state, { kind: 'declareWar', faction: persia, against: FIXTURE.rome });
    place(state, FIXTURE.romanArmy, { kind: 'idle', position: { x: 1250, y: 615 } });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 615 } });
    const egyptian = addArmy(
      state,
      'egyptian',
      1000,
      { kind: 'idle', position: { x: 1255, y: 615 } },
      egypt,
    );
    const persian = addArmy(
      state,
      'persian',
      1000,
      { kind: 'idle', position: { x: 1255, y: 615 } },
      persia,
    );
    const next = tick(state, []).state;
    expect(Object.values(next.battles)[0]).toMatchObject({
      attackers: [FIXTURE.punicArmy],
      defenders: [FIXTURE.romanArmy, egyptian],
    });
    expect(army(next, persian).activity.kind).toBe('idle');
    expectConsistent(next);
  });
});

describe('the end of a battle', () => {
  test('the winner stays idle where it stood and the beaten army marches to its nearest own city', () => {
    let state = atWar();
    const outnumbered = addArmy(state, 'outnumbered', 400, {
      kind: 'idle',
      position: { x: 1295, y: 655 },
    });
    place(state, FIXTURE.romanArmy, FAR_AWAY);
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1290, y: 650 } });
    state = playUntilPeace(tick(state, []).state);

    expect(state.battles).toEqual({});
    expect(army(state, FIXTURE.punicArmy).activity).toEqual({
      kind: 'idle',
      position: { x: 1290, y: 650 },
    });
    expect(army(state, outnumbered).activity).toEqual({
      kind: 'marching',
      position: { x: 1295, y: 655 },
      destination: CAPUA,
    });
    expect(menOf(state, outnumbered)).toBeGreaterThan(0);
    expectConsistent(state);
  });

  test('a beaten army does not turn and fight again while it marches away', () => {
    let state = atWar();
    const outnumbered = addArmy(state, 'outnumbered', 400, {
      kind: 'idle',
      position: { x: 1250, y: 620 },
    });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 620 } });
    place(state, FIXTURE.romanArmy, FAR_AWAY);
    state = playUntilPeace(tick(state, []).state);
    expect(army(state, outnumbered).activity.kind).toBe('marching');
    state = tick(state, []).state;
    expect(state.battles).toEqual({});
    expectConsistent(state);
  });

  test('an army with no men left is removed with its formations', () => {
    let state = atWar();
    const doomed = addArmy(state, 'doomed', 3, {
      kind: 'idle',
      position: { x: 1250, y: 620 },
    });
    place(state, FIXTURE.romanArmy, FAR_AWAY);
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 620 } });
    state = tick(state, []).state;

    expect(state.armies[doomed]).toBeUndefined();
    expect(state.formations['doomed-spearmen' as FormationId]).toBeUndefined();
    expect(state.battles).toEqual({});
    expect(army(state, FIXTURE.punicArmy).activity.kind).toBe('idle');
    expectConsistent(state);
  });

  test('a beaten army whose faction holds no city surrenders', () => {
    let state = atWar();
    const carthago = state.cities[FIXTURE.carthago];
    if (carthago) carthago.owner = FIXTURE.rome;
    addArmy(state, 'legion', 4000, { kind: 'idle', position: { x: 1250, y: 620 } });
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 620 } });
    state = playUntilPeace(tick(state, []).state);
    expect(state.armies[FIXTURE.punicArmy]).toBeUndefined();
    expect(state.formations[FIXTURE.citizenSpears]).toBeUndefined();
    expectConsistent(state);
  });

  test('formations of an idle army regain morale each day', () => {
    const state = buildFixture();
    const next = tick(state, []).state;
    expect(next.formations[FIXTURE.citizenSpears]?.morale).toBeCloseTo(0.9 + MORALE_RECOVERY);
    expect(tick(next, []).state.formations[FIXTURE.hastati]?.morale).toBe(1);
    expectConsistent(next);
  });
});

describe('the retreat order', () => {
  function inBattle() {
    const state = atWar();
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 620 } });
    return tick(state, []).state;
  }

  test('pulls the army out at a price in men, and the enemy holds the field', () => {
    const before = inBattle();
    const men = before.formations[FIXTURE.citizenSpears]?.men ?? 0;
    const { state, rejected } = tick(before, [
      { kind: 'retreat', faction: FIXTURE.carthage, army: FIXTURE.punicArmy },
    ]);
    expect(rejected).toEqual([]);
    expect(state.battles).toEqual({});
    expect(army(state, FIXTURE.punicArmy).activity).toMatchObject({
      kind: 'marching',
      destination: CARTHAGO,
    });
    expect(state.formations[FIXTURE.citizenSpears]?.men).toBe(men - Math.round(men * 0.15));
    expect(army(state, FIXTURE.romanArmy).activity.kind).toBe('idle');
    expectConsistent(state);
  });

  test('is rejected for an army that is not in a battle', () => {
    const state = atWar();
    const order = { kind: 'retreat', faction: FIXTURE.rome, army: FIXTURE.romanArmy } as const;
    expect(executeOrder(state, order)?.reason).toBe('army army-roman is not in a battle');
    expectConsistent(state);
  });

  test("is rejected for another faction's army", () => {
    const state = inBattle();
    const before = structuredClone(state);
    const order = { kind: 'retreat', faction: FIXTURE.rome, army: FIXTURE.punicArmy } as const;
    expect(executeOrder(state, order)?.reason).toBe(
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

  test('skirmishAndWithdraw costs both sides fewer men, and the skirmisher gives up the field sooner', () => {
    const skirmish = averages('skirmishAndWithdraw', 'holdTheLine');
    expect(skirmish.days).toBeLessThan(hold.days);
    expect(skirmish.keptA).toBeGreaterThan(hold.keptA);
    expect(skirmish.keptB).toBeGreaterThan(hold.keptB);
    expect(skirmish.aWins).toBeLessThan(0.1);
  });
});

describe('determinism', () => {
  function campaign(seed: number) {
    let state = atWar(seed);
    place(state, FIXTURE.punicArmy, { kind: 'idle', position: { x: 1250, y: 620 } });
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
      state = tick(state, orders).state;
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
