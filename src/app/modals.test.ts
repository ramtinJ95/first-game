import { describe, expect, it } from 'vitest';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { Day } from '../sim/state/day.ts';
import { enqueue, keepOpen, restoreModalResume, type Modal } from './modals.ts';

const fate = (city: string): Modal => ({ kind: 'fate', city: city as CityId });
const won: Modal = { kind: 'won', on: 5 as Day };
const guide: Modal = { kind: 'guide' };
const lost: Modal = {
  kind: 'lost',
  on: 9 as Day,
  city: 'roma' as CityId,
  by: 'carthage' as FactionId,
};

describe('the modal queue', () => {
  it.each([true, false])('restores saved automatic-resume ownership=%s independently of paused and the load screen', (resumeOnClose) => {
    expect(restoreModalResume({ saved: { paused: true, resumeOnClose }, hasModal: true, paused: true, forcePause: true })).toBe(resumeOnClose);
    expect(restoreModalResume({ saved: { paused: true, resumeOnClose }, hasModal: false, paused: true, forcePause: false })).toBe(false);
  });

  it('puts the win before the fates and the fates before the guide, each once', () => {
    let queue: Modal[] = [guide];
    for (const modal of [fate('capua'), won, fate('capua'), fate('roma'), guide]) {
      queue = enqueue(queue, modal);
    }
    expect(queue).toEqual([won, fate('capua'), fate('roma'), guide]);
  });

  it('lets a loss or the start screen replace everything that waits', () => {
    expect(enqueue([won, fate('capua'), guide], lost)).toEqual([lost]);
    expect(enqueue([lost], { kind: 'start' })).toEqual([{ kind: 'start' }]);
  });

  it('drops a fate whose city is no longer open', () => {
    const open = (city: CityId) => city === 'roma';
    expect(keepOpen([won, fate('capua'), fate('roma')], open)).toEqual([won, fate('roma')]);
  });
});
