/** The part of WebGL 2 that a fence needs, so a test can stand in for it. */
export interface FenceGl {
  readonly SYNC_GPU_COMMANDS_COMPLETE: number;
  readonly SYNC_STATUS: number;
  readonly UNSIGNALED: number;
  fenceSync(condition: number, flags: number): WebGLSync | null;
  getSyncParameter(sync: WebGLSync, name: number): unknown;
  deleteSync(sync: WebGLSync): void;
  flush(): void;
  isContextLost(): boolean;
}

/**
 * Starts a frame on the GPU only once it has finished the one before. A slow GPU takes
 * longer to draw a frame than the page takes to ask for the next, and unpaced frames
 * queue up, so a click or a screenshot waits behind seconds of them.
 *
 * `ready()` says whether the GPU has finished the last fenced frame. A frame that is not
 * ready must send the GPU nothing, not even a render into a texture, or the queue grows
 * while it waits.
 */
export class FramePacer {
  readonly #gl: FenceGl | undefined;
  #fence: WebGLSync | null = null;

  constructor(gl: FenceGl | undefined) {
    this.#gl = gl;
  }

  ready(): boolean {
    const gl = this.#gl;
    if (!gl || !this.#fence) return true;
    // A lost context drops its fences, which then never signal, so a fence that cannot
    // be read is let go rather than waited on.
    const status = gl.isContextLost() ? null : gl.getSyncParameter(this.#fence, gl.SYNC_STATUS);
    if (status === gl.UNSIGNALED) return false;
    if (status !== null) gl.deleteSync(this.#fence);
    this.#fence = null;
    return true;
  }

  /** Call after the frame's draw calls, to fence them. */
  rendered() {
    const gl = this.#gl;
    if (!gl) return;
    this.#fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }
}
