import * as v from 'valibot';
import type { FactionId } from './ids.ts';
import type { PowerId } from './map.ts';
import type { Stance } from './state/army.ts';

export type TroopCategory = 'infantry' | 'missile' | 'cavalry';

export interface TroopStats {
  category: TroopCategory;
  /** Men this troop kills per man and day, relative to the other troops. */
  attack: number;
  /** Divides the men it loses. */
  defence: number;
  /** Divides the morale it loses. */
  discipline: number;
  /** Multiplies its attack against a category. A missing category counts as 1. */
  bonus: Partial<Record<TroopCategory, number>>;
  /** Divides the men it loses to a category. A missing category counts as 1. */
  guard: Partial<Record<TroopCategory, number>>;
  /** Multiplies its blows and divides the men it loses while its army holds a stance. A missing stance counts as 1. */
  stance: Partial<Record<Stance, number>>;
  /** Multiplies the march of an army whose every formation is of this troop or faster. */
  pace: number;
  /** One recruited formation: its men, which also cost as much manpower, its gold, and its days of training. */
  recruit: { men: number; gold: number; days: number };
  /** The great power that alone raises it, and the shared troop it stands in for. Absent for a shared troop. */
  signature?: { power: PowerId; resembles: SharedTroop };
}

const SHARED_TABLE = {
  spearmen: {
    category: 'infantry',
    attack: 1,
    defence: 1.2,
    discipline: 1,
    bonus: { cavalry: 2.5 },
    guard: {},
    stance: {},
    pace: 1,
    recruit: { men: 1000, gold: 2400, days: 15 },
  },
  swordsmen: {
    category: 'infantry',
    attack: 1.4,
    defence: 1,
    discipline: 1.1,
    bonus: {},
    guard: {},
    stance: {},
    pace: 1,
    recruit: { men: 1000, gold: 3200, days: 20 },
  },
  skirmishers: {
    category: 'missile',
    attack: 0.9,
    defence: 0.7,
    discipline: 0.8,
    bonus: { infantry: 1.2 },
    guard: {},
    stance: {},
    pace: 1,
    recruit: { men: 500, gold: 900, days: 10 },
  },
  archers: {
    category: 'missile',
    attack: 1.1,
    defence: 0.6,
    discipline: 0.8,
    bonus: { infantry: 1.3 },
    guard: {},
    stance: {},
    pace: 1,
    recruit: { men: 500, gold: 1200, days: 15 },
  },
  lightCavalry: {
    category: 'cavalry',
    attack: 1,
    defence: 0.8,
    discipline: 0.9,
    bonus: { missile: 2.5 },
    guard: {},
    stance: {},
    pace: 1,
    recruit: { men: 400, gold: 1800, days: 20 },
  },
  heavyCavalry: {
    category: 'cavalry',
    attack: 1.8,
    defence: 1.1,
    discipline: 1.2,
    bonus: { infantry: 1.2, missile: 1.5 },
    guard: {},
    stance: {},
    pace: 1,
    recruit: { men: 400, gold: 2800, days: 30 },
  },
} satisfies Record<string, TroopStats>;

export type SharedTroop = keyof typeof SHARED_TABLE;

const SIGNATURE_TABLE = {
  legionaries: {
    category: 'infantry',
    attack: 1.3,
    defence: 1.1,
    discipline: 1.15,
    bonus: {},
    guard: {},
    stance: { holdTheLine: 1.15 },
    pace: 1,
    recruit: { men: 1000, gold: 3400, days: 20 },
    signature: { power: 'rome', resembles: 'swordsmen' },
  },
  triarii: {
    category: 'infantry',
    attack: 0.9,
    defence: 1.3,
    discipline: 1.8,
    bonus: { cavalry: 2.5 },
    guard: {},
    stance: {},
    pace: 1,
    recruit: { men: 800, gold: 2600, days: 25 },
    signature: { power: 'rome', resembles: 'spearmen' },
  },
  warElephants: {
    category: 'cavalry',
    attack: 2.4,
    defence: 1.5,
    discipline: 0.7,
    bonus: { infantry: 2 },
    guard: {},
    stance: {},
    pace: 1,
    recruit: { men: 400, gold: 3600, days: 30 },
    signature: { power: 'carthage', resembles: 'heavyCavalry' },
  },
  numidianHorse: {
    category: 'cavalry',
    attack: 0.9,
    defence: 0.8,
    discipline: 0.9,
    bonus: { missile: 2.5 },
    guard: {},
    stance: {},
    pace: 1.2,
    recruit: { men: 400, gold: 2000, days: 20 },
    signature: { power: 'carthage', resembles: 'lightCavalry' },
  },
  phalangites: {
    category: 'infantry',
    attack: 1,
    defence: 1.2,
    discipline: 1,
    bonus: { cavalry: 2.5 },
    guard: { cavalry: 1.8, missile: 0.75 },
    stance: {},
    pace: 1,
    recruit: { men: 1000, gold: 2500, days: 20 },
    signature: { power: 'macedon', resembles: 'spearmen' },
  },
  companionCavalry: {
    category: 'cavalry',
    attack: 2.1,
    defence: 1.1,
    discipline: 1.3,
    bonus: { infantry: 1.4, missile: 1.5 },
    guard: {},
    stance: {},
    pace: 1,
    recruit: { men: 400, gold: 3200, days: 30 },
    signature: { power: 'macedon', resembles: 'heavyCavalry' },
  },
  nileArchers: {
    category: 'missile',
    attack: 1.1,
    defence: 0.6,
    discipline: 0.8,
    bonus: { infantry: 1.3 },
    guard: { infantry: 1.5 },
    stance: {},
    pace: 1,
    recruit: { men: 500, gold: 1300, days: 20 },
    signature: { power: 'egypt', resembles: 'archers' },
  },
  chariots: {
    category: 'cavalry',
    attack: 1.2,
    defence: 0.9,
    discipline: 0.9,
    bonus: { missile: 3 },
    guard: { infantry: 0.8 },
    stance: {},
    pace: 1.2,
    recruit: { men: 300, gold: 2000, days: 25 },
    signature: { power: 'egypt', resembles: 'lightCavalry' },
  },
  cataphracts: {
    category: 'cavalry',
    attack: 1.6,
    defence: 1.7,
    discipline: 1.2,
    bonus: { infantry: 1.2, missile: 1.5 },
    guard: { missile: 1.5 },
    stance: {},
    pace: 1,
    recruit: { men: 400, gold: 3800, days: 30 },
    signature: { power: 'persia', resembles: 'heavyCavalry' },
  },
  horseArchers: {
    category: 'cavalry',
    attack: 1,
    defence: 0.8,
    discipline: 0.9,
    bonus: { infantry: 1.3 },
    guard: { infantry: 1.4 },
    stance: {},
    pace: 1,
    recruit: { men: 400, gold: 2200, days: 25 },
    signature: { power: 'persia', resembles: 'lightCavalry' },
  },
} satisfies Record<string, TroopStats & { signature: { power: PowerId; resembles: SharedTroop } }>;

const TABLE = { ...SHARED_TABLE, ...SIGNATURE_TABLE };

export type Troop = keyof typeof TABLE;

/** Every troop: the shared six and each great power's own. Every number a battle, a march, or a recruitment uses for a troop lives here. */
export const TROOPS: Readonly<Record<Troop, TroopStats>> = TABLE;

export const SHARED_TROOPS = Object.keys(SHARED_TABLE) as SharedTroop[];

/** The fastest pace of any troop, which sets how close armies must come to fight. */
export const FASTEST_PACE = Math.max(...Object.values(TROOPS).map((troop) => troop.pace));

/** The troops a faction may raise: the shared ones and, for a great power, its own. */
export function troopsFor(faction: FactionId): Troop[] {
  return (Object.keys(TROOPS) as Troop[]).filter((troop) => {
    const { signature } = TROOPS[troop];
    return !signature || signature.power === faction;
  });
}

export const TroopSchema = v.picklist(Object.keys(TABLE) as [Troop, ...Troop[]]);
