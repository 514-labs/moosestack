# Dashboard Migration Prompt Template (AI Copilot)

Paste this into your AI copilot. Replace placeholders and make sure the filled context pack is referenced via `@`.

```text
You are a senior product/data engineer migrating a dashboard/report from a <POSTGRES|MYSQL|MSSQL|...>-backed implementation to ClickHouse (MooseStack).

Context (source of truth):
- Full component context pack: @context/migrations/COMPONENT_NAME.md

Hard requirements / guardrails:
1) Do not change the frontend contract:
   - Request shape, response shape, and auth/tenancy behavior must remain compatible.
2) Parity first, then optimize:
   - First produce a ClickHouse SQL parity version of the existing OLTP logic and validate against golden cases.
   - Then redesign for OLAP best practices (do not keep OLTP-style just-in-time joins/CTE orchestration as the long-term serving query).
3) OLAP mindset:
   - Shift joins/reshaping/reusable derived fields to write time via Materialized Views (serving tables).
   - Keep query-time work to slicing/grouping/sorting/pagination over serving-ready tables.
4) Every claim must be grounded:
   - If you reference a field, filter, auth rule, or edge case, cite where it appears in the context pack.

What to deliver (explicit outputs):
A) Parity plan + evidence
   - The exact parity SQL (or staged parity queries) you will run in ClickHouse.
   - A list of golden test cases you will use, and the observed outputs for each case.
   - Any tolerances (if exact match is impossible) and why.

B) OLAP modeling plan (write-time transforms)
   - Identify which parts of the OLTP read path are OLAP anti-patterns (JIT joins, repeated CTE reshaping, stored-procedure-like pipelines).
   - Propose the Materialized View(s) and backing table(s) needed.
   - Specify the schema of each serving table (columns, types, keys/order-by).
   - Explain what moves to write time vs what remains at query time.

C) Serving interface (Query Layer)
   - Define a QueryModel over the serving table (raw or MV-backed).
   - Expose the minimal dimensions/metrics/filters/sortable fields required by the dashboard.
   - Wire a thin handler that uses the QueryModel to fulfill the existing endpoint contract.

D) Verification
   - Show the exact validation steps you ran (queries/curl requests).
   - Confirm parity for golden cases.
   - Call out any remaining risks.

Execution approach (recommended order):
1) Extract: from the context pack, list the contract + golden cases.
2) Build parity SQL in ClickHouse and validate outputs.
3) Identify OLTP read-time anti-patterns and redesign as MV(s).
4) Re-run validation against MV-backed serving tables.
5) Implement the Query Layer model + thin handler on top of the serving table.
6) Re-run golden cases end-to-end.

Format your response as:
## Assumptions (from context pack)
## Parity SQL + results
## OLAP modeling plan (MVs + serving tables)
## Query Layer plan (QueryModel + handler)
## Test plan + evidence
## Open questions / risks
```

