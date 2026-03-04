import { OlapTable } from "./olapTable";
import { View } from "./view";
import { MaterializedView } from "./materializedView";
import { getMooseInternal, isClientOnlyMode } from "../internal";

/**
 * Configuration for a SelectRowPolicy.
 *
 * Defines a ClickHouse row policy that filters rows based on a column value
 * matched against a JWT claim via `getSetting()`.
 */
export interface SelectRowPolicyConfig {
  /** Tables and/or views the policy applies to */
  tables: (OlapTable<any> | View | MaterializedView<any>)[];

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
  name: string;

  /** The policy configuration */
  config: SelectRowPolicyConfig;

  constructor(name: string, config: SelectRowPolicyConfig) {
    this.name = name;
    this.config = config;

    const selectRowPolicies = getMooseInternal().selectRowPolicies;
    if (!isClientOnlyMode() && selectRowPolicies.has(this.name)) {
      throw new Error(`SelectRowPolicy with name ${this.name} already exists`);
    }
    selectRowPolicies.set(this.name, this);
  }

  /** Resolved table names for serialization (versioned ClickHouse names) */
  get tableNames(): string[] {
    return this.config.tables.map((t) =>
      t instanceof OlapTable ? t.generateTableName() : t.name,
    );
  }
}
