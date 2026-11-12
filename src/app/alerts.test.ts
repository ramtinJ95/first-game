import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import type { Day } from '../sim/state/day.ts';
import { alertsBetween, type Alert } from './alerts.ts';

const world = fixtureWorld();
const f = FIXTURE;

/** Plays days until `done` holds or the days run out, and gathers every day's alerts. */
function play(state: GameState, orders: Order[], done: (state: GameState) => boolean, days = 60) {
  const alerts: Alert[] = [];
  let current = state;
  for (let i = 0; i < days; i++) {
    const next = tick(current, i === 0 ? orders : [], world).state;
    alerts.push(...alertsBetween(current, next));
    current = next;
    if (done(current)) break;
  }
  return { state: current, alerts };
}

function atWar(state: GameState, a = f.rome, b = f.carthage) {
  state.wars[warKey(a, b)] = { since: state.day };
}

/** Puts Carthage's army 15 km from Rome's, at war, with the given strength on each side. */
function facingOff(romanMen: number, punicMen: number) {
  const state = buildFixture();
  atWar(state);
  const punic = state.armies[f.punicArmy];
  const roman = state.armies[f.romanArmy];
  if (!punic || !roman || roman.activity.kind !== 'idle') throw new Error('fixture changed');
  const at = roman.activity.position;
  punic.activity = { kind: 'idle', position: { x: at.x + 15, y: at.y } };
  for (const id of roman.formations) {
    const formation = state.formations[id];
    if (formation) formation.men = Math.round(romanMen / roman.formations.length);
  }
  const spears = state.formations[f.citizenSpears];
  if (spears) spears.men = punicMen;
  return state;
}

const ofKind = (alerts: Alert[], kind: Alert['kind']) => alerts.filter((a) => a.kind === kind);

describe('alertsBetween', () => {
  it('tells of a battle that began against the player, and selects it', () => {
    const { state, alerts } = play(facingOff(1500, 1500), [], () => true);
    const [battle] = Object.values(state.battles);
    expect(battle).toBeDefined();
    expect(ofKind(alerts, 'battleBegan')).toEqual([
      {
        kind: 'battleBegan',
        day: 2,
        tone: 'neutral',
        text: 'Battle at Roma against Carthage',
        focus: { at: battle?.position, select: { kind: 'battle', battle: battle?.id } },
      },
    ]);
  });

  it('tells that the player held the field when the enemy broke', () => {
    const { state, alerts } = play(
      facingOff(1500, 900),
      [],
      (s) => Object.keys(s.battles).length === 0,
    );
    expect(Object.keys(state.battles)).toEqual([]);
    const ended = ofKind(alerts, 'battleEnded');
    expect(ended.map((a) => [a.text, a.tone])).toEqual([['You held the field at Roma', 'good']]);
    expect(ended[0]?.focus?.select).toEqual({ kind: 'army', army: f.romanArmy });
  });

  it('tells which enemy held the field when the player broke', () => {
    const { alerts } = play(facingOff(900, 1500), [], (s) => Object.keys(s.battles).length === 0);
    expect(ofKind(alerts, 'battleEnded').map((a) => [a.text, a.tone])).toEqual([
      ['Carthage held the field at Roma', 'bad'],
    ]);
  });

  it('tells once that an army arrived at the end of its march, and not when it halts', () => {
    const roman = buildFixture().armies[f.romanArmy];
    if (roman?.activity.kind !== 'idle') throw new Error('fixture changed');
    const to = { x: roman.activity.position.x + 60, y: roman.activity.position.y + 40 };
    const move: Order = { kind: 'moveArmy', faction: f.rome, army: f.romanArmy, to };
    const arrived = play(buildFixture(), [move], () => false, 8);
    expect(arrived.state.armies[f.romanArmy]?.activity.kind).toBe('idle');
    const alerts = ofKind(arrived.alerts, 'armyArrived');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.text).toMatch(/^Your army arrived near /);
    expect(alerts[0]?.focus?.select).toEqual({ kind: 'army', army: f.romanArmy });

    const marching = tick(buildFixture(), [move], world).state;
    const halted = tick(
      marching,
      [{ kind: 'halt', faction: f.rome, army: f.romanArmy }],
      world,
    ).state;
    expect(halted.armies[f.romanArmy]?.activity.kind).toBe('idle');
    expect(alertsBetween(marching, halted)).toEqual([]);
  });

  it('does not call a retreat holding the field, even once it reached a home close by', () => {
    const state = facingOff(1500, 1500);
    const roman = state.armies[f.romanArmy];
    if (roman?.activity.kind !== 'idle') throw new Error('fixture changed');
    const home = state.cities[f.roma]?.position;
    if (!home) throw new Error('fixture changed');
    const field = { x: home.x + 8, y: home.y };
    roman.activity = { kind: 'idle', position: field };
    const punic = state.armies[f.punicArmy];
    if (punic) punic.activity = { kind: 'idle', position: { x: field.x + 10, y: field.y } };
    const fighting = tick(state, [], world).state;
    expect(fighting.armies[f.romanArmy]?.activity.kind).toBe('inBattle');
    const retreated = tick(
      fighting,
      [{ kind: 'retreat', faction: f.rome, army: f.romanArmy }],
      world,
    ).state;
    expect(Object.keys(retreated.battles)).toEqual([]);
    const reachedHome = structuredClone(retreated);
    const back = reachedHome.armies[f.romanArmy];
    if (!back) throw new Error('the army surrendered');
    back.activity = { kind: 'idle', position: { ...home } };
    for (const after of [retreated, reachedHome]) {
      expect(ofKind(alertsBetween(fighting, after), 'battleEnded').map((a) => a.text)).toEqual([
        'Carthage held the field at Roma',
      ]);
    }
  });

  it('tells of an arrival from a march shorter than a day, which is never seen marching', () => {
    const roman = buildFixture().armies[f.romanArmy];
    if (roman?.activity.kind !== 'idle') throw new Error('fixture changed');
    const to = { x: roman.activity.position.x + 8, y: roman.activity.position.y + 4 };
    const before = buildFixture();
    const after = tick(
      before,
      [{ kind: 'moveArmy', faction: f.rome, army: f.romanArmy, to }],
      world,
    ).state;
    expect(after.armies[f.romanArmy]?.activity.kind).toBe('idle');
    expect(ofKind(alertsBetween(before, after), 'armyArrived')).toHaveLength(1);
  });

  it('tells that a raised formation mustered, at its city', () => {
    const recruit: Order = { kind: 'recruit', faction: f.rome, city: f.roma, troop: 'skirmishers' };
    const { alerts } = play(buildFixture(), [recruit], () => false, 12);
    const mustered = ofKind(alerts, 'formationMustered');
    expect(mustered.map((a) => [a.text, a.day])).toEqual([['Skirmishers mustered at Roma', 12]]);
    expect(mustered[0]?.focus?.select).toEqual({ kind: 'army', army: f.romanArmy });
  });

  it("tells of a city the player gains or loses, and of no other faction's", () => {
    const before = buildFixture();
    const after = buildFixture();
    after.day = 2 as Day;
    const capua = after.cities[f.capua];
    const syracusae = after.cities[f.syracusae];
    if (!capua || !syracusae) throw new Error('fixture changed');
    capua.owner = f.carthage;
    syracusae.owner = f.carthage;
    expect(alertsBetween(before, after)).toEqual([
      {
        kind: 'cityChangedOwner',
        day: 2,
        tone: 'bad',
        text: 'Capua fell to Carthage',
        focus: { at: capua.position, select: { kind: 'province', province: f.campania } },
      },
    ]);
    expect(alertsBetween(after, before).map((a) => [a.text, a.tone])).toEqual([
      ['Capua fell to Rome', 'good'],
    ]);
  });

  it('tells of a siege the player began', () => {
    const state = buildFixture();
    atWar(state, f.rome, f.syracusaeFaction);
    const roman = state.armies[f.romanArmy];
    const syracusae = state.cities[f.syracusae];
    if (!roman || !syracusae) throw new Error('fixture changed');
    roman.activity = { kind: 'idle', position: { ...syracusae.position } };
    const { alerts } = play(state, [], () => true);
    expect(ofKind(alerts, 'siegeBegan').map((a) => [a.text, a.focus?.select])).toEqual([
      ['Your army besieges Syracusae', { kind: 'province', province: f.sicilia }],
    ]);
  });

  it('tells when a store of the player runs out, and not while it stays out', () => {
    const before = buildFixture();
    const after = buildFixture();
    const stores = after.factions[f.rome]?.stores;
    if (!stores) throw new Error('fixture changed');
    stores.gold = -4;
    stores.manpower = 0;
    expect(alertsBetween(before, after).map((a) => [a.kind, a.text, a.focus])).toEqual([
      ['storeRanOut', 'Gold ran out: your formations desert each day', undefined],
      ['storeRanOut', 'Manpower ran out: no troops can be raised', undefined],
    ]);
    expect(alertsBetween(after, after)).toEqual([]);
  });
});
