import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArmyId, BattleId, CityId, FactionId, ProvinceId } from '../sim/ids.ts';
import { parseMap, type GameMap } from '../sim/map.ts';
import { fitCamera, mapToScreen, type Camera } from './camera.ts';
import type { DrawnArmy, DrawnBattle } from './markers.ts';
import { CITY_HIT_MARGIN, cityAt, isletAt, pickAt, provinceAt, type DrawnCity } from './pick.ts';

const MAP = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../data/map/map.json'), 'utf8')),
);

const cityOf = (id: string) => {
  const province = MAP.provinces.find((p) => p.id === id);
  if (!province) throw new Error(`no province ${id}`);
  return { x: province.city[0], y: province.city[1] };
};

describe('provinceAt', () => {
  it('finds the province around a point on its land', () => {
    expect(provinceAt(MAP, cityOf('roma'))).toBe('roma');
    expect(provinceAt(MAP, cityOf('persepolis'))).toBe('persepolis');
  });

  it('finds nothing at sea', () => {
    expect(provinceAt(MAP, { x: 2400, y: 2500 })).toBeUndefined();
    expect(provinceAt(MAP, { x: 3700, y: 3400 })).toBeUndefined();
    expect(provinceAt(MAP, { x: 10, y: 10 })).toBeUndefined();
  });

  it('finds a province made of several pieces from a point on any piece', () => {
    expect(MAP.provinces.find((p) => p.id === 'caralis')?.outline.length).toBeGreaterThan(1);
    expect(provinceAt(MAP, cityOf('caralis'))).toBe('caralis');
    expect(provinceAt(MAP, { x: 2250, y: 2250 })).toBe('caralis');
  });

  it('finds the province of a point on an island', () => {
    expect(provinceAt(MAP, cityOf('syracusae'))).toBe('syracusae');
    expect(provinceAt(MAP, cityOf('salamis'))).toBe('salamis');
    expect(provinceAt(MAP, cityOf('knosos'))).toBe('knosos');
  });

  it('finds nothing in a hole of a province', () => {
    const square = (x: number, y: number, size: number): [number, number][] => [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ];
    const lake: GameMap = {
      ...MAP,
      provinces: [
        {
          ...(MAP.provinces[0] as GameMap['provinces'][number]),
          id: 'ring' as ProvinceId,
          outline: [[square(0, 0, 100), square(40, 40, 20)]],
        },
      ],
    };
    expect(provinceAt(lake, { x: 10, y: 10 })).toBe('ring');
    expect(provinceAt(lake, { x: 50, y: 50 })).toBeUndefined();
  });
});

describe('islets off Carthago at the closest zoom', () => {
  const viewport = { width: 1280, height: 720 };
  const click = (point: { x: number; y: number }) => {
    const camera = { centre: point, scale: 4 };
    return pickAt(MAP, camera, viewport, [], mapToScreen(camera, viewport, point));
  };

  it('selects nothing on an islet the map draws but the rules do not know', () => {
    // Zembra, 52 km north-east of Carthago, is drawn land and in no province.
    const zembra = { x: 2276.8, y: 2842.4 };
    expect(isletAt(MAP, zembra)).toBe(true);
    expect(click(zembra)).toBeUndefined();
  });

  it("selects Carthago's province on Cossyra, which the rules give to Carthago, 146 km out", () => {
    const cossyra = { x: 2372.4, y: 2898.2 };
    expect(isletAt(MAP, cossyra)).toBe(false);
    expect(click(cossyra)).toEqual({ kind: 'province', province: 'carthago' });
  });

  it('opens a city only within its hit margin of its symbol', () => {
    const symbol = { left: 600, right: 640, top: 340, bottom: 370 };
    const cities: DrawnCity[] = [{ id: 'carthago' as CityId, symbol, label: undefined }];
    expect(cityAt(cities, { x: 620, y: 355 })).toBe('carthago');
    expect(cityAt(cities, { x: 640 + CITY_HIT_MARGIN, y: 355 })).toBe('carthago');
    expect(cityAt(cities, { x: 640 + CITY_HIT_MARGIN + 1, y: 355 })).toBeUndefined();
  });
});

describe('pickAt', () => {
  const viewport = { width: 1280, height: 720 };
  const camera: Camera = { centre: cityOf('roma'), scale: 2 };
  const army: DrawnArmy = {
    id: 'army-1' as ArmyId,
    owner: 'rome' as FactionId,
    position: cityOf('roma'),
  };
  const foot = mapToScreen(camera, viewport, army.position);

  it('selects an army from a click on its banner before the province under it', () => {
    expect(pickAt(MAP, camera, viewport, [army], { x: foot.x + 8, y: foot.y - 24 })).toEqual({
      kind: 'army',
      army: army.id,
    });
  });

  it('selects the province from a click on the city an army stands on', () => {
    expect(pickAt(MAP, camera, viewport, [army], foot)).toEqual({
      kind: 'province',
      province: 'roma',
    });
  });

  it('selects nothing from a click on the sea', () => {
    const fit = fitCamera(viewport, MAP);
    const sea = mapToScreen(fit, viewport, { x: 2400, y: 2500 });
    expect(pickAt(MAP, fit, viewport, [army], sea)).toBeUndefined();
  });

  it('selects a battle from a click on its marker, and the banner over it before the battle', () => {
    const battle: DrawnBattle = { id: 'battle-1' as BattleId, position: army.position };
    expect(
      pickAt(MAP, camera, viewport, [army], { x: foot.x + 3, y: foot.y - 3 }, [battle]),
    ).toEqual({ kind: 'battle', battle: battle.id });
    expect(
      pickAt(MAP, camera, viewport, [army], { x: foot.x + 8, y: foot.y - 24 }, [battle]),
    ).toEqual({ kind: 'army', army: army.id });
    expect(
      pickAt(MAP, camera, viewport, [army], { x: foot.x + 40, y: foot.y + 40 }, [battle]),
    ).toEqual({ kind: 'province', province: 'roma' });
  });
});

describe('cityAt', () => {
  const box = (x: number, y: number, half: number) => ({
    left: x - half,
    top: y - half,
    right: x + half,
    bottom: y + half,
  });
  const massalia: DrawnCity = {
    id: 'massalia' as CityId,
    symbol: box(100, 100, 5),
    label: { left: 108, top: 92, right: 170, bottom: 108 },
  };
  const arelate: DrawnCity = { id: 'arelate' as CityId, symbol: box(60, 100, 5), label: undefined };

  it('keeps an inset city anchor as a fallback, behind visible glyphs and nearby armies', () => {
    const anchor = { ...massalia, symbol: box(200, 100, 5), label: undefined };
    const other = { ...arelate, symbol: box(200, 100, 5) };
    expect(cityAt([massalia], { x: 100, y: 100 }, [anchor])).toBe('massalia');
    expect(cityAt([massalia], { x: 200, y: 100 }, [anchor])).toBe('massalia');
    expect(cityAt([massalia, other], { x: 200, y: 100 }, [anchor])).toBe('arelate');
    expect(
      cityAt([massalia], { x: 200, y: 100 }, [anchor], { kind: 'army', army: 'a' as ArmyId }),
    ).toBeUndefined();
    expect(
      cityAt([massalia], { x: 200, y: 100 }, [anchor], { kind: 'battle', battle: 'b' as BattleId }),
    ).toBeUndefined();
  });

  it('finds the city from a click on its symbol, on its name, or a few pixels off either', () => {
    expect(cityAt([massalia], { x: 100, y: 100 })).toBe('massalia');
    expect(cityAt([massalia], { x: 160, y: 100 })).toBe('massalia');
    expect(cityAt([massalia], { x: 100, y: 105 + CITY_HIT_MARGIN })).toBe('massalia');
    expect(cityAt([massalia], { x: 175, y: 112 })).toBe('massalia');
  });

  it('finds nothing farther than the margin from every symbol and name', () => {
    expect(cityAt([massalia], { x: 100, y: 106 + CITY_HIT_MARGIN })).toBeUndefined();
    expect(cityAt([massalia], { x: 171 + CITY_HIT_MARGIN, y: 100 })).toBeUndefined();
    expect(cityAt([], { x: 100, y: 100 })).toBeUndefined();
  });

  it('gives a click between two cities to the nearer one', () => {
    expect(cityAt([massalia, arelate], { x: 74, y: 100 })).toBe('arelate');
    expect(cityAt([massalia, arelate], { x: 87, y: 100 })).toBe('massalia');
  });

  it("gives a click beside a city's symbol to that city, though another city's name is under it", () => {
    const below: DrawnCity = {
      id: 'arelate' as CityId,
      symbol: box(160, 115, 5),
      label: undefined,
    };
    expect(cityAt([massalia, below], { x: 160, y: 107 })).toBe('arelate');
    expect(cityAt([massalia, below], { x: 130, y: 100 })).toBe('massalia');
  });

  it('gives a click on overlapping symbols to the one centred nearer', () => {
    const close: DrawnCity = {
      id: 'arelate' as CityId,
      symbol: box(104, 100, 5),
      label: undefined,
    };
    expect(cityAt([massalia, close], { x: 101, y: 100 })).toBe('massalia');
    expect(cityAt([massalia, close], { x: 103, y: 100 })).toBe('arelate');
  });
});
