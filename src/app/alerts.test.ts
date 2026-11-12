import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import type { Day } from '../sim/state/day.ts';
import { alertsOfDay, type Alert } from './alerts.ts';

const world = fixtureWorld();
const f = FIXTURE;

/** Plays days until `done` holds or the days run out, and gathers every day's alerts. */
function play(state: GameState, orders: Order[], done: (state: GameState) => boolean, days = 60) {
  const alerts: Alert[] = [];
  let current = state;
  for (let i = 0; i < days; i++) {
    const { state: next, events } = tick(current, i === 0 ? orders : [], world);
    alerts.push(...alertsOfDay(current, next, events));
    current = next;
    if (done(current)) break;
  }
  return { state: current, alerts };
}

function atWar(state: GameState, a = f.rome, b = f.carthage) {
  state.wars[warKey(a, b)] = { since: state.day };
}

/** Puts Carthage's army 5 km west of Rome's, at war, with the given strength on each side. */
function facingOff(romanMen: number, punicMen: number) {
  const state = buildFixture();
  atWar(state);
  const punic = state.armies[f.punicArmy];
  const roman = state.armies[f.romanArmy];
  if (!punic || !roman || roman.activity.kind !== 'idle') throw new Error('fixture changed');
  const at = roman.activity.position;
  punic.activity = { kind: 'idle', position: { x: at.x - 5, y: at.y } };
  for (const id of roman.formations) {
    const formation = state.formations[id];
    if (formation) formation.men = Math.round(romanMen / roman.formations.length);
  }
  const spears = state.formations[f.citizenSpears];
  if (spears) spears.men = punicMen;
  return state;
}

const ofKind = (alerts: Alert[], kind: Alert['kind']) => alerts.filter((a) => a.kind === kind);

describe('alertsOfDay', () => {
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
    expect(ended.map((a) => a.tone)).toEqual(['good']);
    expect(ended[0]?.text).toMatch(
      /^You held the field at Roma after \d+ days?\. You lost \d+ men, Carthage lost \d+\.$/,
    );
    expect(ended[0]?.focus?.select).toEqual({ kind: 'army', army: f.romanArmy });
  });

  it('tells which enemy held the field when the player broke', () => {
    const { alerts } = play(facingOff(900, 1500), [], (s) => Object.keys(s.battles).length === 0);
    const ended = ofKind(alerts, 'battleEnded');
    expect(ended.map((a) => a.tone)).toEqual(['bad']);
    expect(ended[0]?.text).toMatch(
      /^Carthage held the field at Roma after \d+ days?\. You lost \d+ men, Carthage lost \d+\.$/,
    );
    expect(ofKind(alerts, 'armyRetreated').map((a) => a.text)).toEqual([
      expect.stringMatching(
        /^Your army broke at Roma, losing \d+ men to the pursuit, and falls back /,
      ),
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
    expect(alertsOfDay(marching, halted, [])).toEqual([]);
  });

  it('tells of a battle that began and ended inside one day, and of the army it destroyed', () => {
    const { state, alerts } = play(facingOff(1500, 40), [], () => true);
    expect(state.armies[f.punicArmy]).toBeUndefined();
    expect(Object.keys(state.battles)).toEqual([]);
    expect(alerts.map((a) => [a.kind, a.text])).toEqual([
      ['battleBegan', 'Battle at Roma against Carthage'],
      ['armyDestroyed', 'An army of Carthage was destroyed in battle near Roma'],
      [
        'battleEnded',
        expect.stringMatching(
          /^You held the field at Roma after 1 day\. You lost \d+ men, Carthage lost 40\.$/,
        ),
      ],
    ]);
    expect(alerts[0]?.focus).toEqual({ at: expect.any(Object) });
  });

  it("tells of the player's own army destroyed in a battle of one day", () => {
    const { alerts } = play(facingOff(40, 1500), [], () => true);
    expect(ofKind(alerts, 'armyDestroyed').map((a) => [a.text, a.tone])).toEqual([
      ['Your army was destroyed in battle at Roma', 'bad'],
    ]);
  });

  it('tells that a beaten army with no safe city of its own falls back into the field', () => {
    const state = facingOff(900, 1500);
    for (const city of Object.values(state.cities)) city.owner = f.carthage;
    const { alerts } = play(state, [], (s) => Object.keys(s.battles).length === 0);
    expect(ofKind(alerts, 'armyRetreated').map((a) => a.text)).toEqual([
      expect.stringMatching(/, and falls back into the field (near|in the field)/),
    ]);
  });

  it('tells when a power declares war on the player, and when the player declares one', () => {
    const declared = play(
      buildFixture(),
      [{ kind: 'declareWar', faction: f.carthage, against: f.rome }],
      () => true,
    );
    expect(declared.alerts).toEqual([
      { kind: 'warDeclared', day: 2, tone: 'bad', text: 'Carthage declared war on you' },
    ]);
    const declaring = play(
      buildFixture(),
      [{ kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction }],
      () => true,
    );
    expect(declaring.alerts.map((a) => a.text)).toEqual(['You declared war on Syracusae']);
  });

  it('tells when men first desert an army of the player, and not each day after', () => {
    const state = buildFixture();
    const stores = state.factions[f.rome]?.stores;
    const hastati = state.formations[f.hastati];
    if (!stores || !hastati) throw new Error('fixture changed');
    stores.gold = 0;
    hastati.men = 50_000;
    const { alerts } = play(state, [], () => false, 5);
    const deserted = ofKind(alerts, 'armyDeserted');
    expect(deserted.map((a) => [a.day, a.focus?.select])).toEqual([
      [2, { kind: 'army', army: f.romanArmy }],
    ]);
    expect(deserted[0]?.text).toMatch(/^\d+ men deserted your army at Roma$/);
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
    expect(ofKind(alertsOfDay(before, after, []), 'armyArrived')).toHaveLength(1);
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
    expect(alertsOfDay(before, after, [])).toEqual([
      {
        kind: 'cityChangedOwner',
        day: 2,
        tone: 'bad',
        text: 'Capua fell to Carthage',
        focus: { at: capua.position, select: { kind: 'province', province: f.campania } },
      },
    ]);
    expect(alertsOfDay(after, before, []).map((a) => [a.text, a.tone])).toEqual([
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
    expect(alertsOfDay(before, after, []).map((a) => [a.kind, a.text, a.focus])).toEqual([
      ['storeRanOut', 'Gold ran out: your formations desert each day', undefined],
      ['storeRanOut', 'Manpower ran out: no troops can be raised', undefined],
    ]);
    expect(alertsOfDay(after, after, [])).toEqual([]);
  });
});
