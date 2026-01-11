/**
 * Simple TypeScript usage example
 *
 * This file demonstrates how to use the query helpers with a MooseStack API.
 */

import { Api, OlapTable, sql } from "@514labs/moose-lib";
import {
  buildOrderBy,
  buildSelectFromFields,
  type QueryParams,
  type ColumnConfig,
} from "@514labs/moose-lib";

// 1. Define a row type (the shape of a single table record)
type ExampleRow = {
  id: string;
  owner: string;
  status: "OK" | "WARN" | "FAIL";
  createdAt: string;
};

// 2. Define column configuration (aliases, display names, etc.)
const columnConfig = {
  id: { alias: "ID" },
  owner: { alias: "Owner" },
  status: { alias: "Status" },
  createdAt: { alias: "Created At" },
} as const satisfies ColumnConfig<ExampleRow>;

// 3. Define your API params type (typed `fields`, plus common paging/sorting params)
type ExampleParams = QueryParams<ExampleRow, typeof columnConfig>;

// 4. Create the table reference
const ExampleTable = new OlapTable<ExampleRow>("example_table");

// 5. Create the API
export const ExampleApi = new Api<ExampleParams, Record<string, any>[]>(
  "example",
  async (params, { client, sql: sqlTag }) => {
    const {
      fields = ["id", "owner", "status"],
      limit = "20",
      offset = "0",
    } = params;

    const query = sqlTag`
      SELECT ${buildSelectFromFields<ExampleRow, typeof columnConfig>(
        ExampleTable,
        fields,
        { columnConfig },
      )}
      FROM ${ExampleTable}
      ${buildOrderBy<ExampleRow>(
        ExampleTable,
        [{ column: "createdAt", direction: "DESC" }],
        columnConfig,
      )}
      LIMIT ${parseInt(limit, 10)}
      OFFSET ${parseInt(offset, 10)}
    `;

    const result = await client.query.execute(query);
    return result.json();
  },
);

/**
 * Example HTTP requests:
 *
 * # Default fields
 * GET /api/example
 *
 * # Select specific fields (use repeated params for arrays)
 * GET /api/example?fields=id&fields=owner
 *
 * # Using aliases
 * GET /api/example?fields=ID&fields=Owner
 *
 * # With pagination
 * GET /api/example?fields=id&fields=status&limit=10&offset=0
 *
 * Example response:
 * [
 *   {
 *     "ID": "abc-123",
 *     "Owner": "john",
 *     "Status": "OK",
 *     "Created At": "2024-01-15T10:30:00Z"
 *   }
 * ]
 */
