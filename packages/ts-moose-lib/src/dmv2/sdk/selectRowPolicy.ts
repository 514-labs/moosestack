import { OlapTable } from "./olapTable";
import { getMooseInternal, isClientOnlyMode } from "../internal";

/**
 * Configuration for a SelectRowPolicy.
 *
 * Defines a ClickHouse row policy that filters rows based on a column value
 * matched against a JWT claim via `getSetting()`.
 */
export interface SelectRowPolicyConfig {
  /** Tables the policy applies to (ClickHouse row policies only support tables, not views) */
  tables: readonly OlapTable<any>[];

  /** Column to filter on (e.g., "org_id") */
  column: string;

  /** JWT claim name that provides the filter value (e.g., "org_id") */
  claim: string;
}

/**
 * Represents a ClickHouse Row Policy as a first-class Moose primitive.
 *
 * When defined, Moose generates `CREATE ROW POLICY` DDL that uses
 * `getSetting('custom_moose_rls_{column}')` for dynamic per-query tenant scoping.
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
export class SelectRowPolicy {
  /** @internal */
  public readonly kind = "SelectRowPolicy";

  /** The name of the row policy */
  readonly name: string;

  /** The policy configuration */
  readonly config: Readonly<SelectRowPolicyConfig>;

  constructor(name: string, config: SelectRowPolicyConfig) {
    if (!name.trim()) {
      throw new Error("SelectRowPolicy name must not be empty");
    }
    if (!config.tables.length) {
      throw new Error(`SelectRowPolicy '${name}': tables must not be empty`);
    }
    for (const table of config.tables) {
      if (table.config.database) {
        throw new Error(
          `SelectRowPolicy '${name}': table '${table.name}' uses a custom database. ` +
            `Row policies currently only support tables in the default database.`,
        );
      }
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
      tables: Object.freeze([...config.tables]),
    });

    const selectRowPolicies = getMooseInternal().selectRowPolicies;
    if (!isClientOnlyMode() && selectRowPolicies.has(this.name)) {
      throw new Error(`SelectRowPolicy with name ${this.name} already exists`);
    }
    selectRowPolicies.set(this.name, this);
  }

  /** Resolved table names for serialization (versioned ClickHouse names) */
  get tableNames(): string[] {
    return this.config.tables.map((t) => t.generateTableName());
  }
}
