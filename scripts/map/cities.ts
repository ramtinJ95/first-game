import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format } from 'prettier';
import { isStartingOwner, type StartingOwner } from '../../src/sim/map.ts';

export const CITIES_FILE = resolve(import.meta.dirname, '../../data/map/cities.json');

export interface City {
  id: string;
  name: string;
  pleiadesId: number;
  lon: number;
  lat: number;
  owner: StartingOwner;
  capital: boolean;
  port: boolean;
}

export function parseCities(raw: unknown): City[] {
  if (!Array.isArray(raw)) throw new Error('the city list must be an array');
  const cities = raw.map((entry: unknown, index) => parseCity(entry, index));
  const ids = new Set<string>();
  for (const city of cities) {
    if (ids.has(city.id)) throw new Error(`duplicate city id ${city.id}`);
    ids.add(city.id);
  }
  return cities;
}

function parseCity(entry: unknown, index: number): City {
  const fail = (why: string): never => {
    throw new Error(`city ${index}: ${why}`);
  };
  if (typeof entry !== 'object' || entry === null) return fail('not an object');
  const { id, name, pleiadesId, lon, lat, owner, capital, port } = entry as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) return fail('id must be kebab-case');
  if (typeof name !== 'string' || name === '') return fail('name must be a string');
  if (typeof pleiadesId !== 'number' || !Number.isInteger(pleiadesId)) {
    return fail('pleiadesId must be an integer');
  }
  if (typeof lon !== 'number' || lon < -180 || lon > 180) return fail('lon out of range');
  if (typeof lat !== 'number' || lat < -90 || lat > 90) return fail('lat out of range');
  if (!isStartingOwner(owner)) return fail(`unknown owner ${String(owner)}`);
  if (typeof capital !== 'boolean' || typeof port !== 'boolean') {
    return fail('capital and port must be booleans');
  }
  return { id, name, pleiadesId, lon, lat, owner, capital, port };
}

export function readCities(path = CITIES_FILE): City[] {
  return parseCities(JSON.parse(readFileSync(path, 'utf8')));
}

export async function writeCities(cities: City[], path = CITIES_FILE): Promise<void> {
  writeFileSync(path, await format(JSON.stringify(cities), { parser: 'json' }));
}
