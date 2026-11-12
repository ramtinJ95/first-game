import * as v from 'valibot';

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
}

const TABLE = {
  spearmen: {
    category: 'infantry',
    attack: 1,
    defence: 1.2,
    discipline: 1,
    bonus: { cavalry: 2.5 },
  },
  swordsmen: { category: 'infantry', attack: 1.4, defence: 1, discipline: 1.1, bonus: {} },
  skirmishers: {
    category: 'missile',
    attack: 0.9,
    defence: 0.7,
    discipline: 0.8,
    bonus: { infantry: 1.2 },
  },
  archers: {
    category: 'missile',
    attack: 1.1,
    defence: 0.6,
    discipline: 0.8,
    bonus: { infantry: 1.3 },
  },
  lightCavalry: {
    category: 'cavalry',
    attack: 1,
    defence: 0.8,
    discipline: 0.9,
    bonus: { missile: 2.5 },
  },
  heavyCavalry: {
    category: 'cavalry',
    attack: 1.8,
    defence: 1.1,
    discipline: 1.2,
    bonus: { infantry: 1.2, missile: 1.5 },
  },
} satisfies Record<string, TroopStats>;

export type Troop = keyof typeof TABLE;

/** The shared base troops. Every number a battle uses for a troop lives here. */
export const TROOPS: Readonly<Record<Troop, TroopStats>> = TABLE;

export const TroopSchema = v.picklist(Object.keys(TABLE) as [Troop, ...Troop[]]);
