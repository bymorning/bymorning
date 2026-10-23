/** Mutable editor data, preserving branded scalar identity and JSON array operations. */
export type DeepMutable<A> = A extends string | number | boolean | bigint | symbol | null | undefined
  ? A
  : A extends (...args: never[]) => unknown
  ? A
  : A extends ReadonlyMap<infer K, infer V>
    ? Map<DeepMutable<K>, DeepMutable<V>>
    : A extends ReadonlyArray<infer I>
      ? DeepMutable<I>[]
      : A extends object
        ? { -readonly [K in keyof A]: DeepMutable<A[K]> }
        : A
