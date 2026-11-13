import type { MultiPolygon, Point, Province, Settlement, SettlementId } from '../../src/sim/map.ts';
import { boxOf, contains, distance, roundPoint, type Box } from './geometry.ts';
import type { Plane } from './projection.ts';
import type { LonLat } from './sources.ts';

/** The span runs from the first period's lower bound to the last period's upper bound. */
export const PERIODS = ['classical', 'hellenistic-republican', 'roman'] as const;
export const SETTLEMENT_TYPES: readonly string[] = ['settlement', 'urban', 'fortified-settlement'];
export const TOWN_TYPES: readonly string[] = ['urban', 'fortified-settlement'];
/** A place that another place lies at or in makes it a town. */
export const SITE_CONNECTIONS: readonly string[] = ['at', 'in', 'part_of_physical', 'port_of'];
export const MAX_PER_PROVINCE = 30;
export const KM2_PER_SETTLEMENT = 6000;
export const MIN_SPACING_KM = 20;
export const MIN_CITY_SPACING_KM = 25;

export interface PleiadesFiles {
  places: string;
  locationPoints: string;
  placeTypes: string;
  connections: string;
  timePeriods: string;
}

export interface SettlementCandidate {
  pleiadesId: number;
  /** The plain name, or undefined when the source gives only part of one. */
  name: string | undefined;
  at: LonLat;
  town: boolean;
  /** Other Pleiades places that lie at or in this one. */
  sites: number;
}

export function quotaOf(provinceArea: number): number {
  return Math.min(MAX_PER_PROVINCE, Math.ceil(provinceArea / KM2_PER_SETTLEMENT));
}

/** Places that pass every rule that does not need the map. */
export function readCandidates(files: PleiadesFiles): SettlementCandidate[] {
  const [from, to] = periodSpan(readCsv(files.timePeriods));

  const types = new Map<string, Set<string>>();
  for (const row of readCsv(files.placeTypes)) {
    const id = field(row, 'place_id');
    types.set(id, (types.get(id) ?? new Set()).add(field(row, 'place_type')));
  }

  const attested = new Set<string>();
  for (const row of readCsv(files.locationPoints)) {
    if (field(row, 'association_certainty') !== 'certain') continue;
    const after = year(field(row, 'year_after_which'));
    const before = year(field(row, 'year_before_which'));
    // Pleiades periods share their bounds, so an interval that only touches the span lies in the
    // neighbouring period.
    if (after !== undefined && before !== undefined && after < to && before > from) {
      attested.add(field(row, 'place_id'));
    }
  }

  const sitesAt = new Map<string, Set<string>>();
  for (const row of readCsv(files.connections)) {
    if (!SITE_CONNECTIONS.includes(field(row, 'connection_type'))) continue;
    const target = field(row, 'connects_to');
    const id = target.slice(target.lastIndexOf('/') + 1);
    sitesAt.set(id, (sitesAt.get(id) ?? new Set()).add(field(row, 'place_id')));
  }

  return readCsv(files.places).flatMap((row): SettlementCandidate[] => {
    const id = field(row, 'id');
    const title = field(row, 'title');
    const kinds = types.get(id) ?? new Set<string>();
    const name = plainName(title);
    if (
      !SETTLEMENT_TYPES.some((type) => kinds.has(type)) ||
      field(row, 'location_precision') !== 'precise' ||
      title.includes('?') ||
      title.startsWith('Unnamed') ||
      name === '' ||
      !attested.has(id)
    ) {
      return [];
    }
    const lon = Number(field(row, 'representative_longitude'));
    const lat = Number(field(row, 'representative_latitude'));
    const pleiadesId = Number(id);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isInteger(pleiadesId)) {
      throw new Error(`Pleiades place ${id} has no representative point`);
    }
    const sites = sitesAt.get(id)?.size ?? 0;
    const town = TOWN_TYPES.some((type) => kinds.has(type)) || sites > 0;
    return [{ pleiadesId, name, at: [lon, lat], town, sites }];
  });
}

/**
 * A Pleiades title as the plain name a map writes. The title's first form is read, and the
 * editors' marks go: brackets round a name no ancient source gives, a star on a reconstructed
 * form, and a word in brackets after the name, such as "(settlement)" or "(or Ricciacus)".
 * Letters in brackets inside a word are kept, so "Al(l)ifae" is "Allifae" and "(H)Emesa" is
 * "Hemesa". A name the source cuts short, such as "Aquae S(...)", has no plain form.
 */
export function plainName(title: string): string | undefined {
  const first = (title.split('/')[0] ?? '').trim();
  if (first.includes('(...)')) return undefined;
  return first
    .replace(/[[\]*]/g, '')
    .replace(/\s+\([^()]*\)/g, '')
    .replace(
      /\(([^()]*)\)(\p{Lu})/gu,
      (_, letters: string, next: string) => letters + next.toLowerCase(),
    )
    .replace(/\(([^()]*)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Walks the candidates once, towns first, then by sites, then by Pleiades id, and accepts each one
 * that fits its province's quota and keeps its distance from the cities and the places already
 * accepted. Distances and containment use the rounded point that the map stores.
 */
export function chooseSettlements(
  candidates: SettlementCandidate[],
  provinces: Province[],
  plane: Plane,
  land: MultiPolygon,
): Settlement[] {
  const cityIds = new Set(provinces.map((province) => province.pleiadesId));
  const boxes = provinces.map((province) => boxOf(province.outline));
  const left = new Map(provinces.map((province) => [province.id, quotaOf(province.area)]));
  const cities = new PointGrid(MIN_CITY_SPACING_KM);
  for (const province of provinces) cities.add(province.city);
  const accepted = new PointGrid(MIN_SPACING_KM);

  const chosen: Settlement[] = [];
  const ordered = candidates
    .filter((candidate) => !cityIds.has(candidate.pleiadesId))
    .sort(
      (a, b) => Number(b.town) - Number(a.town) || b.sites - a.sites || a.pleiadesId - b.pleiadesId,
    );
  for (const candidate of ordered) {
    const at = roundPoint(plane.toPlane(candidate.at));
    if (accepted.near(at) || cities.near(at)) continue;
    const province = provinces.find(
      (p, i) => inBox(boxes[i] as Box, at) && contains(p.outline, at),
    );
    const room = province ? (left.get(province.id) ?? 0) : 0;
    if (!province || room === 0 || !contains(land, at)) continue;
    left.set(province.id, room - 1);
    accepted.add(at);
    // A place whose name the source cuts short keeps its room, so no other place takes
    // it, but stays off the map.
    if (candidate.name === undefined) continue;
    chosen.push({
      id: `s-${candidate.pleiadesId}` as SettlementId,
      name: candidate.name,
      pleiadesId: candidate.pleiadesId,
      at,
      province: province.id,
      rank: candidate.town ? 'town' : 'village',
    });
  }
  return chosen.sort((a, b) => a.pleiadesId - b.pleiadesId);
}

/** Answers "is any point closer than `spacing`?" by looking in the 3 x 3 cells around a point. */
class PointGrid {
  readonly #cells = new Map<string, Point[]>();
  readonly #spacing: number;

  constructor(spacing: number) {
    this.#spacing = spacing;
  }

  add(point: Point): void {
    const key = this.#key(
      Math.floor(point[0] / this.#spacing),
      Math.floor(point[1] / this.#spacing),
    );
    const cell = this.#cells.get(key);
    if (cell) cell.push(point);
    else this.#cells.set(key, [point]);
  }

  near(point: Point): boolean {
    const column = Math.floor(point[0] / this.#spacing);
    const row = Math.floor(point[1] / this.#spacing);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.#cells.get(this.#key(column + dx, row + dy)) ?? [];
        if (cell.some((other) => distance(point, other) < this.#spacing)) return true;
      }
    }
    return false;
  }

  #key(column: number, row: number): string {
    return `${column},${row}`;
  }
}

function inBox({ minX, minY, maxX, maxY }: Box, [x, y]: Point): boolean {
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function periodSpan(rows: Record<string, string>[]): [from: number, to: number] {
  const bounds = PERIODS.map((key) => {
    const row = rows.find((candidate) => field(candidate, 'key') === key);
    if (!row) throw new Error(`time_periods.csv has no period ${key}`);
    return [era(field(row, 'lower_bound')), era(field(row, 'upper_bound'))];
  });
  return [Math.min(...bounds.flat()), Math.max(...bounds.flat())];
}

/** `550 BC` is -550, `AD 300` and `300 AD` are 300. */
function era(text: string): number {
  const bc = /^(\d+) BC$/.exec(text);
  if (bc) return -Number(bc[1]);
  const ad = /^(?:AD (\d+)|(\d+) AD)$/.exec(text);
  if (!ad) throw new Error(`unexpected period bound ${text}`);
  return Number(ad[1] ?? ad[2]);
}

function year(text: string): number | undefined {
  if (text === '') return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`unexpected year ${text}`);
  return value;
}

function field(row: Record<string, string>, key: string): string {
  const value = row[key];
  if (value === undefined) throw new Error(`CSV row has no column ${key}`);
  return value;
}

/** RFC 4180: quoted fields may hold commas, doubled quotes, and line breaks. A BOM is skipped. */
export function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = text.startsWith('﻿') ? 1 : 0;
  while (i < text.length) {
    let value: string;
    if (text[i] === '"') {
      value = '';
      for (i++; ;) {
        const close = text.indexOf('"', i);
        if (close < 0) throw new Error(`CSV record ${rows.length + 1}: unterminated quote`);
        value += text.slice(i, close);
        i = close + 1;
        if (text[i] !== '"') break;
        value += '"';
        i++;
      }
    } else {
      const start = i;
      while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') i++;
      value = text.slice(start, i);
    }
    row.push(value);
    if (text[i] === ',') {
      i++;
      if (i === text.length) row.push('');
      continue;
    }
    if (text[i] === '\r') i++;
    if (i < text.length && text[i] !== '\n') {
      throw new Error(`CSV record ${rows.length + 1}: text after a closing quote`);
    }
    i++;
    rows.push(row);
    row = [];
  }
  if (row.length > 0) rows.push(row);
  const [header = [], ...records] = rows;
  return records.map((record, line) => {
    if (record.length !== header.length) {
      throw new Error(`CSV record ${line + 2}: ${record.length} fields, expected ${header.length}`);
    }
    return Object.fromEntries(header.map((key, k) => [key, record[k] ?? '']));
  });
}
