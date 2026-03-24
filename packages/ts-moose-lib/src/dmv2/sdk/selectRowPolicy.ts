import { OlapTable } from "./olapTable";
import { getMooseInternal, isClientOnlyMode } from "../internal";

/** Extract the row type from an OlapTable instance. */
type RowOf<T> = T extends OlapTable<infer R> ? R : never;

/**
 * Configuration for a SelectRowPolicy.
 *
 * Defines a ClickHouse row policy that filters rows based on a column value
 * matched against a JWT claim via `getSetting()`.
 *
 * The `column` field is type-checked against the columns shared by all
 * tables — a typo will be caught at compile time.
 */
export interface SelectRowPolicyConfig<
  Tables extends readonly OlapTable<any>[] = readonly OlapTable<any>[],
> {
  /** Tables the policy applies to. Policies propagate through regular Views automatically. */
  tables: readonly [...Tables];

  /** Column to filter on (e.g., "org_id"). Must exist in every table. */
  column: keyof RowOf<Tables[number]> & string;

  /** JWT claim name that provides the filter value (e.g., "org_id") */
  claim: string;
}

/**
 * Represents a ClickHouse Row Policy as a first-class Moose primitive.
 *
 * When defined, Moose generates `CREATE ROW POLICY` DDL that uses
 * `getSetting('SQL_moose_rls_{column}')` for dynamic per-query tenant scoping.
 *
 * @example
 * ```typescript
 * export const tenantIsolation = new SelectRowPolicy("tenant_isolation", {
 *   tables: [DataEventTable],
 *   column: "org_id",
 *   claim: "org_id",
 * });
 * ```
 */
export class SelectRowPolicy<
  Tables extends readonly OlapTable<any>[] = readonly OlapTable<any>[],
> {
  /** @internal */
  public readonly kind = "SelectRowPolicy";

  /** The name of the row policy */
  readonly name: string;

  /** The policy configuration */
  readonly config: Readonly<SelectRowPolicyConfig<Tables>>;

  constructor(name: string, config: SelectRowPolicyConfig<Tables>) {
    if (!name.trim()) {
      throw new Error("SelectRowPolicy name must not be empty");
    }
    if (!config.tables.length) {
      throw new Error(`SelectRowPolicy '${name}': tables must not be empty`);
    }
    if (!config.column.trim()) {
      throw new Error(`SelectRowPolicy '${name}': column must not be empty`);
    }
    if (!config.claim.trim()) {
      throw new Error(`SelectRowPolicy '${name}': claim must not be empty`);
    }

    this.name = name;
    this.config = Object.freeze({
      ...config,
      tables: Object.freeze([...config.tables]) as unknown as readonly [
        ...Tables,
      ],
    });

    const selectRowPolicies = getMooseInternal().selectRowPolicies;
    if (!isClientOnlyMode() && selectRowPolicies.has(this.name)) {
      throw new Error(`SelectRowPolicy with name ${this.name} already exists`);
    }
    selectRowPolicies.set(this.name, this);
  }

  /** Resolved table references for serialization */
  get tableRefs(): { name: string; database?: string }[] {
    return this.config.tables.map((t) => ({
      name: t.generateTableName(),
      ...(t.config.database ? { database: t.config.database } : {}),
    }));
  }
}
