import type { FactionId } from './ids.ts';
import type { PowerId } from './map.ts';
import type { GameState } from './state/game-state.ts';

const ORDINALS = [
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
  'Eleventh',
  'Twelfth',
  'Thirteenth',
  'Fourteenth',
  'Fifteenth',
  'Sixteenth',
  'Seventeenth',
  'Eighteenth',
  'Nineteenth',
  'Twentieth',
];

/** "First" for 1, and "21st" past the words. */
export function ordinal(n: number): string {
  const word = ORDINALS[n - 1];
  if (word) return word;
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/**
 * How each great power names its armies, from the period: Rome numbers its legions,
 * Carthage names a host for the noble who leads it, Macedon a phalanx for its
 * commander, Egypt a host for a god as the pharaohs named their divisions, and Persia
 * opens with the king's guard and then raises the host of a satrapy. A power that has
 * used every name starts again with "Second".
 */
const MANNERS: Record<PowerId, { readonly form: string; readonly names: readonly string[] }> = {
  rome: { form: 'Legion', names: [] },
  carthage: {
    form: 'Host of',
    names: [
      'Hanno',
      'Hamilcar',
      'Hasdrubal',
      'Himilco',
      'Mago',
      'Bomilcar',
      'Gisco',
      'Adherbal',
      'Carthalo',
      'Maharbal',
      'Bostar',
      'Hannibal',
    ],
  },
  macedon: {
    form: 'Phalanx of',
    names: [
      'Antigonus',
      'Demetrius',
      'Philip',
      'Craterus',
      'Amyntas',
      'Coenus',
      'Meleager',
      'Leonnatus',
      'Perdiccas',
      'Polyperchon',
      'Cassander',
      'Perseus',
    ],
  },
  egypt: {
    form: 'Host of',
    names: [
      'Amun',
      'Ra',
      'Ptah',
      'Set',
      'Horus',
      'Thoth',
      'Osiris',
      'Montu',
      'Sobek',
      'Khonsu',
      'Anubis',
      'Neith',
    ],
  },
  persia: {
    form: 'Host of',
    names: [
      'the Immortals',
      'Parsa',
      'Media',
      'Susiana',
      'Babylon',
      'Bactria',
      'Sogdia',
      'Aria',
      'Arachosia',
      'Carmania',
      'Hyrcania',
      'Drangiana',
    ],
  },
};

/** The name the `count`th army raised by a faction gets, counting from 1. */
export function armyName(state: GameState, owner: FactionId, count: number): string {
  const faction = state.factions[owner];
  const manner = Object.hasOwn(MANNERS, owner) ? MANNERS[owner as PowerId] : undefined;
  if (!manner || faction?.kind === 'minor') {
    const city = faction?.name ?? owner;
    return count === 1 ? `Army of ${city}` : `${ordinal(count)} Army of ${city}`;
  }
  if (manner.names.length === 0) return `${ordinal(count)} ${manner.form}`;
  const round = Math.floor((count - 1) / manner.names.length);
  const name = `${manner.form} ${manner.names[(count - 1) % manner.names.length]}`;
  return round === 0 ? name : `${ordinal(round + 1)} ${name}`;
}

/** Counts a new army of the faction and gives it its name, which it keeps for life. */
export function nameNewArmy(state: GameState, owner: FactionId): string {
  const faction = state.factions[owner];
  const count = (faction?.armiesRaised ?? 0) + 1;
  if (faction) faction.armiesRaised = count;
  return armyName(state, owner, count);
}
