declare module "blessed-contrib" {
  export class grid {
    constructor(options: { rows: number; cols: number; screen: any });
    set(
      row: number,
      col: number,
      rowSpan: number,
      colSpan: number,
      widget: any,
      options: any,
    ): any;
  }

  export const line: any;
  export const table: any;
  export const log: any;
}
