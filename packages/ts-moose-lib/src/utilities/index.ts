import { IsTuple } from "typia/lib/typings/IsTuple";

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
  : T extends ReadonlyArray<unknown> ?
    IsTuple<T> extends true ? StripDateFromTuple<T>
    : T extends ReadonlyArray<infer U> ?
      ReadonlyArray<U> extends T ?
        ReadonlyArray<StripDateIntersection<U>>
      : Array<StripDateIntersection<U>>
    : T extends Array<infer U> ? Array<StripDateIntersection<U>>
    : T // this catchall should be unreachable
  : // do not touch other classes
  true extends HasFunctionField<T> ? T
  : T extends object ? { [K in keyof T]: StripDateIntersection<T[K]> }
  : T;

// infer fails in a recursive definition if an intersection type tag is present
type StripDateFromTuple<T extends readonly any[]> =
  T extends (
    [
      infer T1,
      infer T2,
      infer T3,
      infer T4,
      infer T5,
      infer T6,
      infer T7,
      infer T8,
      infer T9,
      infer T10,
    ]
  ) ?
    [
      StripDateIntersection<T1>,
      StripDateIntersection<T2>,
      StripDateIntersection<T3>,
      StripDateIntersection<T4>,
      StripDateIntersection<T5>,
      StripDateIntersection<T6>,
      StripDateIntersection<T7>,
      StripDateIntersection<T8>,
      StripDateIntersection<T9>,
      StripDateIntersection<T10>,
    ]
  : T extends (
    [
      infer T1,
      infer T2,
      infer T3,
      infer T4,
      infer T5,
      infer T6,
      infer T7,
      infer T8,
      infer T9,
    ]
  ) ?
    [
      StripDateIntersection<T1>,
      StripDateIntersection<T2>,
      StripDateIntersection<T3>,
      StripDateIntersection<T4>,
      StripDateIntersection<T5>,
      StripDateIntersection<T6>,
      StripDateIntersection<T7>,
      StripDateIntersection<T8>,
      StripDateIntersection<T9>,
    ]
  : T extends (
    [
      infer T1,
      infer T2,
      infer T3,
      infer T4,
      infer T5,
      infer T6,
      infer T7,
      infer T8,
    ]
  ) ?
    [
      StripDateIntersection<T1>,
      StripDateIntersection<T2>,
      StripDateIntersection<T3>,
      StripDateIntersection<T4>,
      StripDateIntersection<T5>,
      StripDateIntersection<T6>,
      StripDateIntersection<T7>,
      StripDateIntersection<T8>,
    ]
  : T extends (
    [infer T1, infer T2, infer T3, infer T4, infer T5, infer T6, infer T7]
  ) ?
    [
      StripDateIntersection<T1>,
      StripDateIntersection<T2>,
      StripDateIntersection<T3>,
      StripDateIntersection<T4>,
      StripDateIntersection<T5>,
      StripDateIntersection<T6>,
      StripDateIntersection<T7>,
    ]
  : T extends [infer T1, infer T2, infer T3, infer T4, infer T5, infer T6] ?
    [
      StripDateIntersection<T1>,
      StripDateIntersection<T2>,
      StripDateIntersection<T3>,
      StripDateIntersection<T4>,
      StripDateIntersection<T5>,
      StripDateIntersection<T6>,
    ]
  : T extends [infer T1, infer T2, infer T3, infer T4, infer T5] ?
    [
      StripDateIntersection<T1>,
      StripDateIntersection<T2>,
      StripDateIntersection<T3>,
      StripDateIntersection<T4>,
      StripDateIntersection<T5>,
    ]
  : T extends [infer T1, infer T2, infer T3, infer T4] ?
    [
      StripDateIntersection<T1>,
      StripDateIntersection<T2>,
      StripDateIntersection<T3>,
      StripDateIntersection<T4>,
    ]
  : T extends [infer T1, infer T2, infer T3] ?
    [
      StripDateIntersection<T1>,
      StripDateIntersection<T2>,
      StripDateIntersection<T3>,
    ]
  : T extends [infer T1, infer T2] ?
    [StripDateIntersection<T1>, StripDateIntersection<T2>]
  : T extends [infer T1] ? [StripDateIntersection<T1>]
  : [];
