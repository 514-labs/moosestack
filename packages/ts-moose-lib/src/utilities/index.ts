export * from "./dataParser";

type HasFunctionField<T> =
  T extends object ?
    {
      [K in keyof T]: T[K] extends Function ? true : false;
    }[keyof T] extends false ?
      false
    : true
  : false;

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
  : true extends HasFunctionField<T> ?
    T // do not touch other classes
  : T extends object ? { [K in keyof T]: StripDateIntersection<T[K]> }
  : T;
