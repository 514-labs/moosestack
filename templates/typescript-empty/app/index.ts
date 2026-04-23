// Welcome to your new Moose analytical backend! 🦌

// Getting Started Guide:

// 1. Data Modeling
// First, plan your data structure and create your data models.
// Declare a ClickHouse table with `OlapTable<T>`.
// → See: docs.fiveonefour.com/moose/building/data-modeling
//   Learn about type definitions and data validation

// 2. Set Up Ingestion
// Receive data via HTTP POST by composing three primitives:
//   - `OlapTable<T>`  — the persistent ClickHouse destination
//   - `Stream<T>`     — a buffering Redpanda topic (`destination: <OlapTable>`)
//   - `IngestApi<T>`  — the HTTP endpoint (`destination: <Stream>`)
// → See: docs.fiveonefour.com/moose/building/ingestion
//   Learn about data formats, validation, and dead-letter queues

// 3. Create Workflows
// Build data processing pipelines to transform and analyze your data
// → See: docs.fiveonefour.com/moose/building/workflows
//   Learn about task scheduling and data processing

// 4. Configure Consumption APIs
// Set up typed query endpoints with `Api<T, R = any>`, or define
// materialized tables with `MaterializedView<T>` and logical `View`s.
// → See: docs.fiveonefour.com/moose/building/consumption-apis

// Need help? Check out the quickstart guide:
// → docs.fiveonefour.com/moose/getting-started/quickstart
