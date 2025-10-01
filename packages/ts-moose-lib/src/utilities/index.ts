export * from "./dataParser";

type HasFunctionField<T> =
  T extends object ?
    {
      [K in keyof T]: T[K] extends Function ? true : false;
    }[keyof T] extends false ?
      false
    : true
  : false;

/**
 * `Date & ...` is considered "nonsensible intersection" by typia,
 * causing JSON schema to fail.
 * This helper type recursively cleans up the intersection type tagging.
 */
export type StripDateIntersection<T> =
  T extends Date ?
    Date extends T ?
      Date
    : T
  : T extends ReadonlyArray<infer U> ?
    ReadonlyArray<U> extends T ?
      ReadonlyArray<StripDateIntersection<U>>
    : Array<StripDateIntersection<U>>
  : T extends Array<infer U> ? Array<StripDateIntersection<U>>
  : // do not touch other classes
  true extends HasFunctionField<T> ? T
  : T extends object ? { [K in keyof T]: StripDateIntersection<T[K]> }
  : T;
