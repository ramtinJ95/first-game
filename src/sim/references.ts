import type { DeepReadonly } from './deep-readonly.ts';
import type { GameState } from './state/game-state.ts';
import { warSides } from './state/war.ts';

/** The counter number in an id shaped like one `allocateId` hands out, such as `army-3`. */
export function serialOf(id: string): number | undefined {
  const serial = /^[a-zA-Z]+-(\d+)$/.exec(id)?.[1];
  return serial === undefined ? undefined : Number(serial);
}

/**
 * Lists every id in the state that points at a missing record or at a record that
 * does not point back. An empty list means the records agree with each other.
 */
export function findBrokenReferences(state: DeepReadonly<GameState>): string[] {
  const problems: string[] = [];
  const get = <K extends string, V>(records: Readonly<Record<K, V>>, id: K): V | undefined =>
    Object.hasOwn(records, id) ? records[id] : undefined;
  const unique = (ids: readonly string[], owner: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      expect(!seen.has(id), `${owner} lists ${id} twice`);
      seen.add(id);
    }
  };
  const expect = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };

  const collections = {
    factions: state.factions,
    provinces: state.provinces,
    cities: state.cities,
    armies: state.armies,
    formations: state.formations,
    convoys: state.convoys,
    refugeeColumns: state.refugeeColumns,
    battles: state.battles,
    sieges: state.sieges,
  };
  for (const [name, records] of Object.entries(collections)) {
    for (const [key, record] of Object.entries(records)) {
      expect(record.id === key, `${name}.${key} holds a record with id ${record.id}`);
      const serial = serialOf(key);
      expect(
        serial === undefined || serial < state.nextSerial,
        `${name}.${key} is not below nextSerial ${state.nextSerial}, so a new id could repeat it`,
      );
    }
  }

  expect(
    get(state.factions, state.player) !== undefined,
    `player faction ${state.player} does not exist`,
  );

  for (const province of Object.values(state.provinces)) {
    expect(
      get(state.cities, province.city)?.province === province.id,
      `province ${province.id} names city ${province.city}, which does not name it back`,
    );
  }
  for (const city of Object.values(state.cities)) {
    expect(
      get(state.factions, city.owner) !== undefined,
      `city ${city.id} has unknown owner ${city.owner}`,
    );
    expect(
      get(state.provinces, city.province)?.city === city.id,
      `city ${city.id} names province ${city.province}, which does not name it back`,
    );
  }

  for (const army of Object.values(state.armies)) {
    expect(
      get(state.factions, army.owner) !== undefined,
      `army ${army.id} has unknown owner ${army.owner}`,
    );
    unique(army.formations, `army ${army.id}`);
    for (const id of army.formations) {
      expect(
        get(state.formations, id)?.army === army.id,
        `army ${army.id} lists formation ${id}, which does not name it back`,
      );
    }
    const { activity } = army;
    if (activity.kind === 'inBattle') {
      const battle = get(state.battles, activity.battle);
      expect(
        !!battle && [...battle.attackers, ...battle.defenders].includes(army.id),
        `army ${army.id} is in battle ${activity.battle}, which does not list it`,
      );
    } else if (activity.kind === 'besieging') {
      expect(
        !!get(state.sieges, activity.siege)?.besiegers.includes(army.id),
        `army ${army.id} besieges in siege ${activity.siege}, which does not list it`,
      );
    } else if (activity.kind === 'embarked') {
      expect(
        !!get(state.convoys, activity.convoy)?.armies.includes(army.id),
        `army ${army.id} is embarked in convoy ${activity.convoy}, which does not list it`,
      );
    }
  }
  for (const formation of Object.values(state.formations)) {
    expect(
      !!get(state.armies, formation.army)?.formations.includes(formation.id),
      `formation ${formation.id} names army ${formation.army}, which does not list it`,
    );
  }

  for (const convoy of Object.values(state.convoys)) {
    expect(
      get(state.factions, convoy.owner) !== undefined,
      `convoy ${convoy.id} has unknown owner ${convoy.owner}`,
    );
    unique(convoy.armies, `convoy ${convoy.id}`);
    for (const id of convoy.armies) {
      const activity = get(state.armies, id)?.activity;
      expect(
        activity?.kind === 'embarked' && activity.convoy === convoy.id,
        `convoy ${convoy.id} carries army ${id}, which is not embarked in it`,
      );
    }
  }
  for (const column of Object.values(state.refugeeColumns)) {
    expect(
      get(state.factions, column.owner) !== undefined,
      `refugee column ${column.id} has unknown owner`,
    );
    expect(
      get(state.cities, column.from) !== undefined,
      `refugee column ${column.id} left unknown city ${column.from}`,
    );
    expect(
      get(state.cities, column.to) !== undefined,
      `refugee column ${column.id} walks to unknown city ${column.to}`,
    );
  }
  for (const battle of Object.values(state.battles)) {
    unique([...battle.attackers, ...battle.defenders], `battle ${battle.id}`);
    for (const id of [...battle.attackers, ...battle.defenders]) {
      const activity = get(state.armies, id)?.activity;
      expect(
        activity?.kind === 'inBattle' && activity.battle === battle.id,
        `battle ${battle.id} lists army ${id}, which is not in it`,
      );
    }
  }
  const besieged = new Set<string>();
  for (const siege of Object.values(state.sieges)) {
    expect(
      get(state.cities, siege.city) !== undefined,
      `siege ${siege.id} is at unknown city ${siege.city}`,
    );
    expect(!besieged.has(siege.city), `city ${siege.city} has more than one siege`);
    besieged.add(siege.city);
    unique(siege.besiegers, `siege ${siege.id}`);
    for (const id of siege.besiegers) {
      const activity = get(state.armies, id)?.activity;
      expect(
        activity?.kind === 'besieging' && activity.siege === siege.id,
        `siege ${siege.id} lists army ${id}, which is not besieging in it`,
      );
    }
  }

  for (const key of Object.keys(state.wars)) {
    const sides = warSides(key);
    expect(!!sides, `war ${key} does not name two different factions in ascending order`);
    for (const faction of sides ?? []) {
      const record = get(state.factions, faction);
      expect(record !== undefined, `war ${key} names unknown faction ${faction}`);
      expect(record?.defeatedOn == null, `war ${key} names ${faction}, which is out of the game`);
    }
  }

  const defeated = new Set(
    Object.values(state.factions)
      .filter((faction) => faction.defeatedOn !== null)
      .map((faction) => faction.id as string),
  );
  const holdings = [
    ...Object.values(state.cities).map((r) => ['city', r.id, r.owner] as const),
    ...Object.values(state.armies).map((r) => ['army', r.id, r.owner] as const),
    ...Object.values(state.convoys).map((r) => ['convoy', r.id, r.owner] as const),
    ...Object.values(state.refugeeColumns).map((r) => ['refugee column', r.id, r.owner] as const),
  ];
  for (const [kind, id, owner] of holdings) {
    expect(!defeated.has(owner), `${kind} ${id} belongs to ${owner}, which is out of the game`);
  }

  return problems;
}

/** Throws with every broken link. Every system test and order test ends with it. */
export function expectConsistent(state: DeepReadonly<GameState>): void {
  const broken = findBrokenReferences(state);
  if (broken.length > 0) throw new Error(`The state has broken links: ${broken.join('; ')}`);
}
