export * from "./dataParser";

export type StripDateIntersection<T> =
  T extends Date ?
    Date extends T ?
      Date
    : T
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<StripDateIntersection<U>>
  : T extends Array<infer U> ? Array<StripDateIntersection<U>>
  : T extends object ? { [K in keyof T]: StripDateIntersection<T[K]> }
  : T;
