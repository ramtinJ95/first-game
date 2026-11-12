import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFixture } from '../sim/fixture.ts';
import type { Speed } from './clock.ts';
import { createView, type Snapshot } from './view.svelte.ts';

describe('view', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function source() {
    let snapshot: Snapshot = {
      state: buildFixture(),
      speed: 1,
      paused: false,
      selection: undefined,
      pending: [],
      alerts: [],
      notice: undefined,
      menu: undefined,
    };
    return {
      read: () => snapshot,
      setSpeed(speed: Speed) {
        snapshot = { ...snapshot, speed };
      },
    };
  }

  it('republishes the snapshot on its interval', () => {
    const live = source();
    const view = createView(live.read, 100);
    live.setSpeed(3);
    expect(view.current.speed).toBe(1);
    vi.advanceTimersByTime(100);
    expect(view.current.speed).toBe(3);
    view.destroy();
  });

  it('publishes at once on refresh', () => {
    const live = source();
    const view = createView(live.read, 100);
    live.setSpeed(2);
    view.refresh();
    expect(view.current.speed).toBe(2);
    view.destroy();
  });

  it('hands panels the state object itself, not a copy', () => {
    const live = source();
    const view = createView(live.read);
    expect(view.current.state).toBe(live.read().state);
    view.destroy();
  });

  it('stops republishing after destroy', () => {
    const live = source();
    const view = createView(live.read, 100);
    view.destroy();
    live.setSpeed(3);
    vi.advanceTimersByTime(1000);
    expect(view.current.speed).toBe(1);
  });
});
