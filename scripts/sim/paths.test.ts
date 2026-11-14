import { expect, it, vi } from 'vitest';

const { main } = vi.hoisted(() => ({ main: vi.fn() }));
vi.mock('../movement/experiment.ts', () => ({ main }));

it('runs the path experiment when dispatched through its command wrapper', async () => {
  await import('./paths.ts');
  expect(main).toHaveBeenCalledExactlyOnceWith();
});
