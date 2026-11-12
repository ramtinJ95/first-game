import type { GameState } from './state/game-state.ts';

/**
 * Lists every id in the state that points at a missing record or at a record that
 * does not point back. An empty list means the records agree with each other.
 */
export function findBrokenReferences(state: GameState): string[] {
  const problems: string[] = [];
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
    }
  }

  expect(state.player in state.factions, `player faction ${state.player} does not exist`);

  for (const province of Object.values(state.provinces)) {
    expect(
      state.cities[province.city]?.province === province.id,
      `province ${province.id} names city ${province.city}, which does not name it back`,
    );
  }
  for (const city of Object.values(state.cities)) {
    expect(city.owner in state.factions, `city ${city.id} has unknown owner ${city.owner}`);
    expect(
      state.provinces[city.province]?.city === city.id,
      `city ${city.id} names province ${city.province}, which does not name it back`,
    );
  }

  for (const army of Object.values(state.armies)) {
    expect(army.owner in state.factions, `army ${army.id} has unknown owner ${army.owner}`);
    for (const id of army.formations) {
      expect(
        state.formations[id]?.army === army.id,
        `army ${army.id} lists formation ${id}, which does not name it back`,
      );
    }
    const { activity } = army;
    if (activity.kind === 'inBattle') {
      const battle = state.battles[activity.battle];
      expect(
        !!battle && [...battle.attackers, ...battle.defenders].includes(army.id),
        `army ${army.id} is in battle ${activity.battle}, which does not list it`,
      );
    } else if (activity.kind === 'besieging') {
      expect(
        !!state.sieges[activity.siege]?.besiegers.includes(army.id),
        `army ${army.id} besieges in siege ${activity.siege}, which does not list it`,
      );
    } else if (activity.kind === 'embarked') {
      expect(
        !!state.convoys[activity.convoy]?.armies.includes(army.id),
        `army ${army.id} is embarked in convoy ${activity.convoy}, which does not list it`,
      );
    }
  }
  for (const formation of Object.values(state.formations)) {
    expect(
      !!state.armies[formation.army]?.formations.includes(formation.id),
      `formation ${formation.id} names army ${formation.army}, which does not list it`,
    );
  }

  for (const convoy of Object.values(state.convoys)) {
    expect(convoy.owner in state.factions, `convoy ${convoy.id} has unknown owner ${convoy.owner}`);
    for (const id of convoy.armies) {
      const activity = state.armies[id]?.activity;
      expect(
        activity?.kind === 'embarked' && activity.convoy === convoy.id,
        `convoy ${convoy.id} carries army ${id}, which is not embarked in it`,
      );
    }
  }
  for (const column of Object.values(state.refugeeColumns)) {
    expect(column.owner in state.factions, `refugee column ${column.id} has unknown owner`);
    expect(
      column.from in state.cities,
      `refugee column ${column.id} left unknown city ${column.from}`,
    );
    expect(
      column.to in state.cities,
      `refugee column ${column.id} walks to unknown city ${column.to}`,
    );
  }
  for (const battle of Object.values(state.battles)) {
    for (const id of [...battle.attackers, ...battle.defenders]) {
      const activity = state.armies[id]?.activity;
      expect(
        activity?.kind === 'inBattle' && activity.battle === battle.id,
        `battle ${battle.id} lists army ${id}, which is not in it`,
      );
    }
  }
  for (const siege of Object.values(state.sieges)) {
    expect(siege.city in state.cities, `siege ${siege.id} is at unknown city ${siege.city}`);
    for (const id of siege.besiegers) {
      const activity = state.armies[id]?.activity;
      expect(
        activity?.kind === 'besieging' && activity.siege === siege.id,
        `siege ${siege.id} lists army ${id}, which is not besieging in it`,
      );
    }
  }

  return problems;
}
