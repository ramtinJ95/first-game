import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import Ending from './Ending.svelte';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import { standingOf } from '../sim/outcome.ts';
import { ALL_PAUSES } from '../app/pauses.ts';
import type { FrameActions } from './frame-actions.ts';

it('renders defeat as a named native dialog with modal semantics and recovery choices', () => {
  const game = buildFixture();
  const { body } = render(Ending, {
    props: {
      game,
      frame: {
        powers: [],
        modal: undefined,
        saves: {},
        pauseOnFate: true,
        pauses: ALL_PAUSES,
        standing: standingOf(game, fixtureWorld(), FIXTURE.rome),
      },
      ending: { kind: 'lost', on: game.day, city: undefined, by: undefined },
      actions: {} as FrameActions,
    },
  });
  expect(body).toMatch(/<dialog[^>]+aria-modal="true"[^>]+aria-labelledby="ending-title"/);
  expect(body).toMatch(/id="ending-title"[^>]*>Rome has fallen/);
  expect(body).toContain('Watch on');
  expect(body).toContain('Load a file');
  expect(body).toContain('Start again');
});
