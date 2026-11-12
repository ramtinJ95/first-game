import type { Troop } from '../troops.ts';

/**
 * Every number the faction AI decides by. `npm run sim:ai` plays the new game under
 * them, and `sim:battles`, `sim:economy`, and `sim:sieges` gave the starting values.
 */

/** A power keeps gold and food for this many days of its upkeep, counting recruits in training. */
export const RESERVE_DAYS = 60;
/** A recruit is raised only while the daily balance after its upkeep stays at least this share of the income. */
export const MIN_BALANCE_SHARE = 0.1;
/** The share of its men a power wants in each troop. It raises the troop furthest below its share. */
export const TROOP_MIX: Readonly<Record<Troop, number>> = {
  spearmen: 0.35,
  swordsmen: 0.2,
  archers: 0.15,
  skirmishers: 0.05,
  lightCavalry: 0.1,
  heavyCavalry: 0.15,
};

/** A power declares war when its free strength is this many times the neighbour's, before distance. */
export const WAR_ODDS = 2;
/**
 * The most odds a power needs against a rival great power, so that rivals press each
 * other, and a player who stays at home, while minor cities are still left.
 */
export const RIVAL_ODDS = 1.2;
/**
 * A power at war with no great power declares on a great-power neighbour that has kept
 * to its homeland once its own armies outweigh that neighbour's this many times.
 */
export const RIVAL_PRESSURE_ODDS = 2;
/** The odds a power at peace with everyone needs, whatever the distance, so that a long peace can end. */
export const PEACE_WAR_ODDS = 1.6;
/** The odds needed grow by their own size for each this many km between the nearest cities. */
export const WAR_DISTANCE_KM = 800;
/** A neighbour is a faction with a city this close, in a straight line, to a city of the power. */
export const WAR_REACH_KM = 700;
/**
 * A neighbour's armies on land this close to its city nearest the power count in the
 * reckoning of a war, so a neighbour whose armies are far away or at sea invites one.
 */
export const WAR_FRONT_KM = 1500;

/** An army sets out for a city when its side is this many times the enemy armies near the city. */
export const ATTACK_ODDS = 1.5;
/**
 * An army sets out for a city only while its side has this many times the city's
 * garrison in men, so that it holds the blockade with men to spare. It keeps a siege
 * while the besiegers number BLOCKADE_ODDS times the garrison.
 */
export const GARRISON_ODDS = 1.3;
/** Enemy armies this close to a city defend it. */
export const DEFENDER_KM = 100;
/** A km at sea counts as this many km of road when the AI chooses a target. */
export const SEA_KM_FACTOR = 1.5;
/** An army storms when the storm takes the city with at least this chance. */
export const STORM_MIN_CHANCE = 0.9;
/** and when it is expected to cost no more than this share of the stormers. */
export const STORM_MAX_LOSS = 0.2;
/** An idle army whose mean morale is below this rests before it marches. */
export const MARCH_MORALE = 0.7;
/** An idle army waits at a city for recruits that muster there within this many days. */
export const RALLY_WAIT_DAYS = 10;

/** An army retreats when its side's strength in a battle falls below this share of the enemy's. */
export const RETREAT_ODDS = 0.6;
/** Armies march to lift a siege of their city when together they are this many times the besiegers. */
export const RELIEF_ODDS = 1.3;
/** Armies further than this from a besieged city do not march to relieve it. */
export const RELIEF_KM = 500;
/** With an enemy army this close to the capital, an army stays at the capital or returns to it. */
export const CAPITAL_GUARD_KM = 150;

/**
 * A power sacks a city it takes while its gold is below its reserve. Otherwise it
 * enslaves one while its manpower is below this, and occupies the rest.
 */
export const ENSLAVE_BELOW_MANPOWER = 2000;

/** A minor at war raises its cheapest troop when its gold covers the cost, and its gold and food this many days of the new deficit. */
export const MINOR_DEFICIT_DAYS = 365;
