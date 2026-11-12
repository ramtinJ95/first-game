/** The state as the renderer and the panels see it: nothing in it can be assigned. */
export type DeepReadonly<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends (infer U)[]
    ? readonly DeepReadonly<U>[]
    : { readonly [K in keyof T]: DeepReadonly<T[K]> };
