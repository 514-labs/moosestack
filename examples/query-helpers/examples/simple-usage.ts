/**
 * Simple TypeScript usage example
 *
 * This file demonstrates how to use the consolidated helpers in `src/query-helpers.ts`.
 *
 * It intentionally uses `declare` for the table and query executor so this example is:
 * - copy/paste friendly
 * - free of any dataset/product-specific dependencies
 * - easy to adapt to your actual API / database stack
 */

import {
  buildOrderBy,
  buildSelectFromFields,
  type QueryParams,
  type AliasConfig,
} from "../src/query-helpers";
import { OlapTable, sql } from "@514labs/moose-lib";

// 1) Define a row type (the shape of a single table record)
type ExampleRow = {
  id: string;
  owner: string;
  status: "OK" | "WARN" | "FAIL";
  createdAt: string;
};

const ExampleTable = new OlapTable<ExampleRow>("ExampleTable");

// 2) (Optional) Define user-friendly aliases for API consumers

const aliasConfig = {
  id: { alias: "ID" },
  owner: { alias: "Owner" },
  status: { alias: "Status" },
  createdAt: { alias: "Created At" },
} as const satisfies AliasConfig<ExampleRow>;

// 3) Define your API params type (typed `fields`, plus common paging/sorting params)
type ExampleParams = QueryParams<ExampleRow, typeof aliasConfig> & {
  "parameter.timeframe"?: string;
};

// 4) Use in a handler / service function
export function buildExampleQuery(params: ExampleParams) {
  const {
    fields = ["id", "owner", "status"],
    limit = "20",
    offset = "0",
  } = params;

  // Computed columns: SQL expressions with output aliases.
  // Note: expression syntax/functions depend on your database (treat these as examples).
  const computed: Array<{ expression: string; alias: string }> = [
    {
      expression: "formatDateTime(createdAt, '%Y-%m-%d')",
      alias: "Created Date",
    },
    {
      expression: "coalesce(nullif(owner, ''), 'Unknown')",
      alias: "Owner (Normalized)",
    },
  ];

  return sql`
    SELECT ${buildSelectFromFields<ExampleRow, typeof aliasConfig>(ExampleTable, fields, { aliasConfig, computed })}
    FROM ${ExampleTable as any}
    ${buildOrderBy<ExampleRow>(
      ExampleTable,
      [{ column: "createdAt", direction: "DESC" }],
      aliasConfig,
    )}
    LIMIT ${parseInt(limit, 10)}
    OFFSET ${parseInt(offset, 10)}
  `;
}
