import { describe, expect, it } from 'vitest';
import { FULL_DRAWING, parseDrawOptions, TEST_DRAWING } from './draw-options.ts';

describe('parseDrawOptions', () => {
  it('draws everything with no query', () => {
    expect(parseDrawOptions('')).toEqual(FULL_DRAWING);
  });

  it('picks the test drawing with draw=test', () => {
    expect(parseDrawOptions('?draw=test')).toEqual(TEST_DRAWING);
    expect(parseDrawOptions('?draw=full')).toEqual(FULL_DRAWING);
  });

  it('leaves out each named layer, and the fog with fog=off', () => {
    expect([...parseDrawOptions('?hide=sea,labels&fog=off').hidden].sort()).toEqual([
      'fog',
      'labels',
      'sea',
    ]);
  });

  it('turns off the swell and antialiasing and sets the resolution', () => {
    expect(parseDrawOptions('?swell=off&antialias=off&resolution=0.5')).toEqual({
      hidden: new Set(),
      swell: false,
      antialias: false,
      resolution: 0.5,
      sheetBudgetMb: undefined,
      sheetOrder: 'nearest',
    });
  });

  it('measures the figure sheets under another budget or order', () => {
    expect(parseDrawOptions('?sheet-budget=128&sheets=oldest')).toMatchObject({
      sheetBudgetMb: 128,
      sheetOrder: 'oldest',
    });
    expect(parseDrawOptions('')).toMatchObject({ sheetBudgetMb: undefined, sheetOrder: 'nearest' });
  });

  it('refuses a layer, a drawing, or a resolution it does not know', () => {
    expect(() => parseDrawOptions('?hide=clouds')).toThrow('hide=clouds: no such layer');
    expect(() => parseDrawOptions('?draw=fast')).toThrow('expected draw=test or draw=full');
    expect(() => parseDrawOptions('?resolution=0')).toThrow('not > 0');
    expect(() => parseDrawOptions('?sheet-budget=0')).toThrow('sheet-budget=0: not > 0');
    expect(() => parseDrawOptions('?sheets=newest')).toThrow('expected sheets=oldest');
  });
});
