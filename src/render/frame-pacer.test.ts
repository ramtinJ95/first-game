import { describe, expect, it } from 'vitest';
import { FramePacer, type FenceGl } from './frame-pacer.ts';

/** A GPU that finishes a fence only when the test says so. */
function fakeGl() {
  const fences = new Map<object, boolean>();
  let lost = false;
  const gl: FenceGl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    UNSIGNALED: 3,
    fenceSync: () => {
      const fence = {} as WebGLSync;
      fences.set(fence, false);
      return fence;
    },
    getSyncParameter: (fence) => (lost ? null : fences.get(fence) ? 4 : 3),
    deleteSync: (fence) => fences.delete(fence),
    flush: () => undefined,
    isContextLost: () => lost,
  };
  return {
    gl,
    finish: () => fences.forEach((_, fence) => fences.set(fence, true)),
    lose: () => (lost = true),
    pending: () => fences.size,
  };
}

describe('FramePacer', () => {
  it('lets a frame start at once when the GPU has nothing to finish', () => {
    const pacer = new FramePacer(fakeGl().gl);
    expect(pacer.ready()).toBe(true);
  });

  it('holds the next frame until the GPU has finished the last, then lets it start', () => {
    const gpu = fakeGl();
    const pacer = new FramePacer(gpu.gl);
    pacer.rendered();
    expect(pacer.ready()).toBe(false);
    expect(pacer.ready()).toBe(false);
    gpu.finish();
    expect(pacer.ready()).toBe(true);
    expect(gpu.pending()).toBe(0);
    expect(pacer.ready()).toBe(true);
  });

  it('lets a lost context’s fence go instead of waiting on it for ever', () => {
    const gpu = fakeGl();
    const pacer = new FramePacer(gpu.gl);
    pacer.rendered();
    gpu.lose();
    expect(pacer.ready()).toBe(true);
  });

  it('never holds a frame when there is no WebGL 2 to fence', () => {
    const pacer = new FramePacer(undefined);
    pacer.rendered();
    expect(pacer.ready()).toBe(true);
  });
});
