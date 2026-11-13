import { describe, expect, it } from 'vitest';
import { changeCityOwner, FATE_DAYS } from '../sim/cities.ts';
import { defeatFaction } from '../sim/defeat.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import type { Day } from '../sim/state/day.ts';
import type { ArmyId, ConvoyId, FormationId, SiegeId } from '../sim/ids.ts';
import { sightOf } from '../sim/sight.ts';
import {
  alertsOfDay,
  groupAlerts,
  sightingsOfDay,
  weakSiegeNews,
  type Alert,
  type WeakSiege,
} from './alerts.ts';
import { alertsInSight } from './sighted.ts';

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
        day: 1,
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
      [
        'armyDestroyed',
        expect.stringMatching(/^An army of Carthage was destroyed in battle (at|near) Roma$/),
      ],
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

  it('tells the end of a battle between others that the player saw, though its centre lies out of sight', () => {
    const state = buildFixture();
    atWar(state, f.carthage, f.syracusaeFaction);
    const roman = state.armies[f.romanArmy];
    const punic = state.armies[f.punicArmy];
    if (!roman || !punic) throw new Error('fixture changed');
    roman.activity = { kind: 'idle', position: { x: 2069.9, y: 2895.1 } };
    punic.activity = { kind: 'idle', position: { x: 2164.9, y: 2895.1 } };
    const greek = 'army-greek' as ArmyId;
    const spears = 'formation-greek' as FormationId;
    state.formations[spears] = { id: spears, army: greek, troop: 'spearmen', men: 900, morale: 1 };
    state.armies[greek] = {
      id: greek,
      owner: f.syracusaeFaction,
      name: 'Test Army',
      formations: [spears],
      stance: 'holdTheLine',
      generalSkill: 3,
      activity: { kind: 'idle', position: { x: 2184.9, y: 2895.1 } },
    };
    let current = state;
    const told: Alert[] = [];
    for (let day = 0; day < 30 && told.length === 0; day++) {
      const { state: next, events } = tick(current, [], world);
      const seen = alertsInSight(
        alertsOfDay(current, next, events),
        sightOf(current, world, f.rome),
        sightOf(next, world, f.rome),
      );
      told.push(...ofKind(seen, 'battleEnded'));
      current = next;
    }
    const [battle] = told;
    expect(battle?.text).toMatch(
      /^Carthage beat Syracusae .+ after \d+ days?\. Carthage lost \d+, Syracusae lost \d+\.$/,
    );
    expect(
      battle && sightOf(current, world, f.rome).sees(battle.focus?.at ?? roman.activity.position),
    ).toBe(false);
  });

  it('tells when a power declares war on the player, and when the player declares one', () => {
    const declared = play(
      buildFixture(),
      [{ kind: 'declareWar', faction: f.carthage, against: f.rome }],
      () => true,
    );
    expect(declared.alerts).toEqual([
      { kind: 'warDeclared', day: 1, tone: 'bad', text: 'Carthage declared war on you' },
    ]);
    const declaring = play(
      buildFixture(),
      [{ kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction }],
      () => true,
    );
    expect(declaring.alerts.map((a) => a.text)).toEqual(['You declared war on Syracusae']);
  });

  it('tells of a battle between others that ended with neither side on the field, with both losses', () => {
    const state = buildFixture();
    const alerts = alertsOfDay(state, state, [
      {
        kind: 'battleEnded',
        battle: 'battle-1' as never,
        position: { x: 2229.9, y: 2865.1 },
        startedOn: 1 as Day,
        days: 4,
        winner: 'none',
        standing: [],
        attackers: { factions: [f.carthage], lost: 700 },
        defenders: { factions: [f.syracusaeFaction], lost: 650 },
      },
    ]);
    expect(alerts.map((a) => a.text)).toEqual([
      'The battle at Carthago ended with neither side holding the field after 4 days. Carthage lost 700, Syracusae lost 650.',
    ]);
  });

  it("tells when men first desert another faction's army in sight, and not out of sight", () => {
    const deserting = (romanAt: { x: number; y: number }) => {
      const state = buildFixture();
      const stores = state.factions[f.carthage]?.stores;
      const spears = state.formations[f.citizenSpears];
      const roman = state.armies[f.romanArmy];
      if (!stores || !spears || !roman) throw new Error('fixture changed');
      stores.gold = 0;
      spears.men = 50_000;
      roman.activity = { kind: 'idle', position: romanAt };
      const told: Alert[] = [];
      let current = state;
      for (let day = 0; day < 3; day++) {
        const { state: next, events } = tick(current, [], world);
        told.push(
          ...alertsInSight(
            ofKind(alertsOfDay(current, next, events), 'armyDeserted'),
            sightOf(current, world, f.rome),
            sightOf(next, world, f.rome),
          ),
        );
        current = next;
      }
      return told.map((a) => [a.day, a.tone, a.text]);
    };
    expect(deserting({ x: 2164.9, y: 2895.1 })).toEqual([
      [1, 'neutral', expect.stringMatching(/^\d+ men deserted an army of Carthage at Carthago$/)],
    ]);
    const roma = buildFixture().cities[f.roma]?.position;
    if (!roma) throw new Error('fixture changed');
    expect(deserting(roma)).toEqual([]);
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
      [1, { kind: 'army', army: f.romanArmy }],
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
    expect(mustered.map((a) => [a.text, a.day])).toEqual([['Skirmishers mustered at Roma', 11]]);
    expect(mustered[0]?.focus?.select).toEqual({ kind: 'army', army: f.romanArmy });
  });

  it('tells of six formations that muster at one city on one day in one line with a count', () => {
    const recruit: Order = { kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' };
    const state = buildFixture();
    const stores = state.factions[f.rome]?.stores;
    if (stores) Object.assign(stores, { gold: 20_000, manpower: 10_000 });
    const { alerts } = play(state, Array(6).fill(recruit), () => false, 30);
    const lines = groupAlerts(ofKind(alerts, 'formationMustered'));
    expect(lines.map((a) => [a.text, a.count])).toEqual([['Spearmen mustered at Roma', 6]]);
  });

  it('keeps alerts of one kind at different places on separate lines', () => {
    const at = (x: number) => ({ at: { x, y: 0 } });
    const alert = {
      kind: 'armyArrived',
      day: 3 as Day,
      tone: 'neutral',
      text: 'Your army arrived',
    } as const;
    const lines = groupAlerts([
      { ...alert, focus: at(1) },
      { ...alert, focus: at(2) },
      { ...alert, focus: at(1) },
    ]);
    expect(lines.map((a) => [a.focus?.at.x, a.count])).toEqual([
      [1, 2],
      [2, undefined],
    ]);
  });

  it("tells when the player's besieged city musters its recruits early, in place of each muster", () => {
    const state = buildFixture();
    atWar(state);
    const roma = state.cities[f.roma];
    const roman = state.armies[f.romanArmy];
    const punic = state.armies[f.punicArmy];
    const capua = state.cities[f.capua];
    if (!roma || !roman || !punic || !capua) throw new Error('fixture changed');
    roma.recruits = [
      { troop: 'spearmen', readyOn: 40 as Day },
      { troop: 'spearmen', readyOn: 40 as Day },
      { troop: 'archers', readyOn: 45 as Day },
    ];
    roman.activity = { kind: 'idle', position: { ...capua.position } };
    punic.activity = { kind: 'idle', position: { x: roma.position.x + 5, y: roma.position.y } };
    const { alerts } = play(state, [], (s) => Object.keys(s.sieges).length > 0);
    expect(ofKind(alerts, 'musteredEarly').map((a) => [a.text, a.tone, a.focus?.select])).toEqual([
      [
        'Besieged Roma mustered its recruits early: 2 Spearmen and Archers. It cannot fall or be stormed while they stand',
        'good',
        { kind: 'province', province: f.latium },
      ],
    ]);
    expect(ofKind(alerts, 'formationMustered')).toEqual([]);
  });

  it('still tells of a recruit that was due anyway on the day its besieged city musters early', () => {
    const state = buildFixture();
    atWar(state);
    const roma = state.cities[f.roma];
    const roman = state.armies[f.romanArmy];
    const punic = state.armies[f.punicArmy];
    const capua = state.cities[f.capua];
    if (!roma || !roman || !punic || !capua) throw new Error('fixture changed');
    roma.recruits = [
      { troop: 'spearmen', readyOn: 40 as Day },
      { troop: 'archers', readyOn: state.day },
    ];
    roman.activity = { kind: 'idle', position: { ...capua.position } };
    punic.activity = { kind: 'idle', position: { x: roma.position.x + 5, y: roma.position.y } };
    const { alerts } = play(state, [], (s) => Object.keys(s.sieges).length > 0);
    expect(ofKind(alerts, 'musteredEarly').map((a) => a.text)).toEqual([
      'Besieged Roma mustered its recruits early: Spearmen. It cannot fall or be stormed while they stand',
    ]);
    expect(ofKind(alerts, 'formationMustered').map((a) => a.text)).toEqual([
      'Archers mustered at Roma',
    ]);
  });

  it('tells when a city the player besieges musters its recruits, and not of a siege of others', () => {
    const besieged = (owner: typeof f.rome) => {
      const state = buildFixture();
      atWar(state, owner, f.syracusaeFaction);
      const army = state.armies[owner === f.rome ? f.romanArmy : f.punicArmy];
      const syracusae = state.cities[f.syracusae];
      if (!army || !syracusae) throw new Error('fixture changed');
      syracusae.recruits = [{ troop: 'spearmen', readyOn: 40 as Day }];
      army.activity = { kind: 'idle', position: { ...syracusae.position } };
      return play(state, [], (s) => Object.keys(s.sieges).length > 0).alerts;
    };
    expect(ofKind(besieged(f.rome), 'musteredEarly').map((a) => [a.text, a.tone])).toEqual([
      [
        'Syracusae mustered its recruits against your siege: Spearmen. It cannot fall or be stormed while they stand',
        'bad',
      ],
    ]);
    expect(ofKind(besieged(f.carthage), 'musteredEarly')).toEqual([]);
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
        day: 1,
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

  it("dates a city's fall on the day the rules record it, the day the defeat screen names", () => {
    const state = buildFixture();
    atWar(state, f.rome, f.syracusaeFaction);
    const roman = state.armies[f.romanArmy];
    const syracusae = state.cities[f.syracusae];
    if (!roman || !syracusae) throw new Error('fixture changed');
    roman.activity = { kind: 'idle', position: { ...syracusae.position } };
    syracusae.garrison = 0;
    const { state: next, events } = tick(state, [], world);
    const fell = next.cities[f.syracusae]?.fellOn;
    expect(fell).toBe(state.day);
    expect(ofKind(alertsOfDay(state, next, events), 'cityChangedOwner').map((a) => a.day)).toEqual([
      fell,
    ]);
  });

  it('tells when an evacuation leaves its city and when its people settle at the other', () => {
    const { alerts, state } = play(
      buildFixture(),
      [{ kind: 'evacuate', faction: f.rome, city: f.roma, to: f.capua, share: 0.1 }],
      (s) => Object.keys(s.refugeeColumns).length === 0,
      60,
    );
    expect(Object.keys(state.refugeeColumns)).toEqual([]);
    expect(
      alerts
        .filter((a) => a.kind === 'columnLeft' || a.kind === 'columnArrived')
        .map((a) => [a.kind, a.tone, a.text]),
    ).toEqual([
      ['columnLeft', 'neutral', '4,000 people left Roma for Capua'],
      ['columnArrived', 'good', '4,000 people from Roma settled in Capua'],
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

  it('raises no store alert on the day the player is defeated', () => {
    const before = buildFixture();
    const after = buildFixture();
    defeatFaction(after, f.rome);
    expect(ofKind(alertsOfDay(before, after, []), 'storeRanOut')).toEqual([]);
  });

  it("tells when a building of the player's is finished, and not of another faction's", () => {
    const state = buildFixture();
    const roma = state.cities[f.roma];
    const carthago = state.cities[f.carthago];
    if (!roma || !carthago) throw new Error('fixture changed');
    roma.construction = { building: 'forum', daysLeft: 1 };
    carthago.construction = { building: 'temple', daysLeft: 1 };
    const { state: next, events } = tick(state, [], world);
    const told = alertsInSight(
      alertsOfDay(state, next, events),
      sightOf(state, world, f.rome),
      sightOf(next, world, f.rome),
    );
    expect(ofKind(told, 'buildingFinished').map((a) => [a.text, a.tone, a.focus?.select])).toEqual([
      ['Forum finished at Roma', 'good', { kind: 'province', province: f.latium }],
    ]);
  });

  it('tells the sacker what the sack destroyed, and the old owner what was at work when its city fell', () => {
    const sacked = buildFixture();
    const roman = sacked.armies[f.romanArmy];
    const syracusae = sacked.cities[f.syracusae];
    if (!roman || !syracusae) throw new Error('fixture changed');
    syracusae.buildings = ['forum', 'towers'];
    roman.activity = { kind: 'idle', position: { ...syracusae.position } };
    changeCityOwner(sacked, f.syracusae, f.rome);
    syracusae.fellOn = sacked.day;
    const sack = play(sacked, [{ kind: 'sack', faction: f.rome, city: f.syracusae }], () => true);
    expect(ofKind(sack.alerts, 'buildingsLost').map((a) => [a.text, a.tone])).toEqual([
      ['Sack of Syracusae destroyed its Forum and Towers', 'neutral'],
    ]);

    const besieged = buildFixture();
    atWar(besieged);
    const punic = besieged.armies[f.punicArmy];
    const capua = besieged.cities[f.capua];
    if (!punic || !capua) throw new Error('fixture changed');
    capua.construction = { building: 'barracks', daysLeft: 10 };
    capua.garrison = 0;
    punic.activity = { kind: 'idle', position: { ...capua.position } };
    const fall = play(besieged, [], (s) => s.cities[f.capua]?.owner === f.carthage);
    expect(ofKind(fall.alerts, 'buildingsLost').map((a) => [a.text, a.tone])).toEqual([
      ['Capua fell with its Barracks unfinished', 'bad'],
    ]);
  });

  it('tells once that a captured city is occupied when its days to choose a fate pass, and not after a sack or a choice to occupy', () => {
    const fallen = () => {
      const state = buildFixture();
      const roman = state.armies[f.romanArmy];
      const syracusae = state.cities[f.syracusae];
      if (!roman || !syracusae) throw new Error('fixture changed');
      roman.activity = { kind: 'idle', position: { ...syracusae.position } };
      changeCityOwner(state, f.syracusae, f.rome);
      syracusae.fellOn = state.day;
      return state;
    };
    const occupiedOn = new Map([[f.syracusae, fallen().day]]);
    const chosen = fallen();
    const told: Alert[] = [];
    let at = chosen;
    for (let i = 0; i < FATE_DAYS + 5; i++) {
      const { state: next, events } = tick(at, [], world);
      told.push(...alertsOfDay(at, next, events, occupiedOn));
      at = next;
    }
    expect(ofKind(told, 'fateLapsed')).toEqual([]);
    const left = play(fallen(), [], () => false, FATE_DAYS + 5);
    expect(ofKind(left.alerts, 'fateLapsed').map((a) => [a.day, a.text])).toEqual([
      [FATE_DAYS + 1, 'No fate was chosen for Syracusae: you occupy it as it stands'],
    ]);
    const sacked = play(
      fallen(),
      [{ kind: 'sack', faction: f.rome, city: f.syracusae }],
      () => false,
      FATE_DAYS + 5,
    );
    expect(ofKind(sacked.alerts, 'fateLapsed')).toEqual([]);
  });
});

describe('sightingsOfDay', () => {
  /** Carthage's army or fleet out of Rome's sight one day, and 130 km from Roma the next. */
  function sighted(how: 'march' | 'sail', to: 'roma' | 'carthago', war = true) {
    const before = buildFixture();
    if (war) atWar(before);
    const roma = before.cities[f.roma]?.position;
    const carthago = before.cities[f.carthago]?.position;
    const punic = before.armies[f.punicArmy];
    if (!roma || !carthago || !punic) throw new Error('fixture changed');
    const after = structuredClone(before);
    after.day = (before.day + 1) as Day;
    const near = { x: roma.x, y: roma.y + 130 };
    const end = to === 'roma' ? roma : carthago;
    const away = (state: GameState) => {
      const army = state.armies[f.punicArmy];
      if (army) army.activity = { kind: 'marching', position: { ...carthago }, waypoints: [end] };
    };
    away(before);
    if (how === 'march') {
      const army = after.armies[f.punicArmy];
      if (army) army.activity = { kind: 'marching', position: near, waypoints: [end] };
    } else {
      const convoy = 'convoy-1' as ConvoyId;
      after.convoys[convoy] = {
        id: convoy,
        owner: f.carthage,
        position: near,
        armies: [f.punicArmy],
        waypoints: [end],
      };
      const army = after.armies[f.punicArmy];
      if (army) army.activity = { kind: 'embarked', convoy };
    }
    return sightingsOfDay(
      before,
      after,
      sightOf(before, world, f.rome),
      sightOf(after, world, f.rome),
      world,
    );
  }

  it('tells once of an enemy army or fleet that comes into sight on its way to the player, with its men and target', () => {
    expect(sighted('march', 'roma').map((a) => [a.kind, a.tone, a.text, a.day])).toEqual([
      ['enemySighted', 'bad', 'An army of Carthage with 1,500 men is marching on Roma', 1],
    ]);
    expect(sighted('sail', 'roma').map((a) => [a.text, a.focus?.select])).toEqual([
      [
        'A fleet of Carthage with 1,500 men is sailing for Roma',
        { kind: 'army', army: f.punicArmy },
      ],
    ]);
  });

  it('says nothing of an enemy heading elsewhere, or of a power at peace', () => {
    expect(sighted('march', 'carthago')).toEqual([]);
    expect(sighted('sail', 'carthago')).toEqual([]);
    expect(sighted('march', 'roma', false)).toEqual([]);
  });
});

describe('weakSiegeNews', () => {
  it('tells on the first day that a siege of the player is too weak, and once when its besiegers have lost a third of their men', () => {
    let state = buildFixture();
    atWar(state, f.rome, f.syracusaeFaction);
    const roman = state.armies[f.romanArmy];
    const syracusae = state.cities[f.syracusae];
    if (!roman || !syracusae) throw new Error('fixture changed');
    roman.activity = { kind: 'idle', position: { ...syracusae.position } };
    for (const id of roman.formations) {
      const formation = state.formations[id];
      if (formation) formation.men = 300;
    }
    let watched = new Map<SiegeId, WeakSiege>();
    const told: Alert[] = [];
    for (let i = 0; i < 12; i++) {
      const next = tick(state, [], world).state;
      const news = weakSiegeNews(state, next, watched);
      told.push(...news.alerts);
      watched = news.watched;
      state = next;
    }
    expect(told.map((a) => [a.kind, a.day, a.text])).toEqual([
      [
        'siegeTooWeak',
        1,
        'Your siege of Syracusae is too weak to starve it: 540 men against a garrison of 1,200, whose sallies kill besiegers each day',
      ],
      [
        'siegeBled',
        expect.any(Number),
        expect.stringMatching(
          /^Your besiegers at Syracusae have lost a third of their men in a siege too weak to starve it: \d+ lost, \d+ left$/,
        ),
      ],
    ]);
  });

  it('counts an army that leaves the siege as no loss to the sallies', () => {
    const state = buildFixture();
    atWar(state, f.rome, f.syracusaeFaction);
    const roman = state.armies[f.romanArmy];
    const syracusae = state.cities[f.syracusae];
    if (!roman || !syracusae) throw new Error('fixture changed');
    roman.activity = { kind: 'idle', position: { ...syracusae.position } };
    for (const id of roman.formations) {
      const formation = state.formations[id];
      if (formation) formation.men = 300;
    }
    const first = tick(state, [], world).state;
    const siege = Object.values(first.sieges)[0];
    const army = first.armies[f.romanArmy];
    if (!siege || !army) throw new Error('no siege began');
    // A second Roman army of the same men stands in the siege, and the next day marches off.
    const both = structuredClone(first);
    const second = {
      ...structuredClone(army),
      id: 'army-2' as ArmyId,
      formations: [] as FormationId[],
    };
    for (const id of army.formations) {
      const formation = both.formations[id];
      if (!formation) continue;
      const copy = { ...formation, id: `${id}-2` as FormationId, army: second.id };
      both.formations[copy.id] = copy;
      second.formations.push(copy.id);
    }
    both.armies[second.id] = second;
    both.sieges[siege.id] = { ...siege, besiegers: [army.id, second.id] };
    const told = weakSiegeNews(first, both, new Map());
    expect(ofKind(told.alerts, 'siegeTooWeak')).toHaveLength(1);
    const after = structuredClone(both);
    after.sieges[siege.id] = { ...siege, besiegers: [army.id] };
    const gone = after.armies[second.id];
    if (gone) gone.activity = { kind: 'idle', position: { x: 0, y: 0 } };
    expect(weakSiegeNews(both, after, told.watched).alerts).toEqual([]);
  });

  it('does not blame the sallies for the dead of a failed storm', () => {
    const state = buildFixture();
    atWar(state, f.rome, f.syracusaeFaction);
    const roman = state.armies[f.romanArmy];
    const syracusae = state.cities[f.syracusae];
    if (!roman || !syracusae) throw new Error('fixture changed');
    roman.activity = { kind: 'idle', position: { ...syracusae.position } };
    for (const id of roman.formations) {
      const formation = state.formations[id];
      if (formation) formation.men = 550;
    }
    // Without walls a failed storm kills about half the garrison's number, which leaves men.
    Object.assign(syracusae, { walls: 0, garrison: 1190 });
    const first = tick(state, [], world).state;
    const told = weakSiegeNews(state, first, new Map());
    const stormed = tick(
      first,
      [{ kind: 'storm', faction: f.rome, city: f.syracusae }],
      world,
    ).state;
    expect(stormed.cities[f.syracusae]?.owner).toBe(f.syracusaeFaction);
    const news = weakSiegeNews(first, stormed, told.watched).alerts;
    expect(news.map((a) => a.kind)).toEqual(['siegeBled']);
    expect(news[0]?.text).not.toMatch(/[Ss]all/);
  });

  it('says nothing of a siege strong enough to cut the food', () => {
    const state = buildFixture();
    atWar(state, f.rome, f.syracusaeFaction);
    const roman = state.armies[f.romanArmy];
    const syracusae = state.cities[f.syracusae];
    if (!roman || !syracusae) throw new Error('fixture changed');
    roman.activity = { kind: 'idle', position: { ...syracusae.position } };
    const next = tick(state, [], world).state;
    expect(Object.keys(next.sieges)).toHaveLength(1);
    expect(weakSiegeNews(state, next, new Map()).alerts).toEqual([]);
  });
});
