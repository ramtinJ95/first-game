import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { readCities, writeCities, type City } from './cities.ts';

const CACHE_DIR = resolve(import.meta.dirname, '../../.cache/map/pleiades');
const ATTEMPTS = 6;

export interface PleiadesPlace {
  id: number;
  title: string;
  lon: number;
  lat: number;
}

export async function fetchPlace(id: number): Promise<PleiadesPlace> {
  const file = join(CACHE_DIR, `${id}.json`);
  if (!existsSync(file)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, await download(`https://pleiades.stoa.org/places/${id}/json`));
  }
  const record = JSON.parse(readFileSync(file, 'utf8')) as {
    title?: unknown;
    reprPoint?: unknown;
  };
  const point = record.reprPoint;
  if (
    typeof record.title !== 'string' ||
    !Array.isArray(point) ||
    typeof point[0] !== 'number' ||
    typeof point[1] !== 'number'
  ) {
    throw new Error(`Pleiades place ${id} has no title or representative point`);
  }
  return { id, title: record.title, lon: point[0], lat: point[1] };
}

async function download(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.text();
      // The proxy in front of Pleiades returns sporadic 502s; anything else is final.
      if (response.status !== 502 || attempt === ATTEMPTS) {
        throw new Error(`${url} answered ${response.status}`);
      }
    } catch (error) {
      if (attempt === ATTEMPTS) throw error;
    }
    await delay(1000 * attempt);
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
  const cities = readCities();
  const updated: City[] = [];
  const moved: string[] = [];
  for (const city of cities) {
    const place = await fetchPlace(city.pleiadesId);
    if (place.lon !== city.lon || place.lat !== city.lat) moved.push(`${city.id} (${place.title})`);
    updated.push({ ...city, lon: place.lon, lat: place.lat });
    console.log(`${city.id.padEnd(24)} ${String(place.id).padEnd(10)} ${place.title}`);
  }
  if (values.check) {
    if (moved.length > 0) {
      console.error(`coordinates differ from Pleiades for: ${moved.join(', ')}`);
      process.exit(1);
    }
    console.log(`all ${cities.length} cities match their Pleiades records`);
  } else {
    await writeCities(updated);
    console.log(`wrote ${cities.length} cities, ${moved.length} coordinates updated`);
  }
}
