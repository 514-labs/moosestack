import { render } from "@/components";

const rawMeta = {
  "---Schema---": {
    title: "Schema",
    type: "separator",
  },
  "model-table": {
    title: "Modeling Tables",
  },
  "model-materialized-view": {
    title: "Modeling Materialized Views",
  },
  "model-view": {
    title: "Modeling Views",
  },
  "supported-types": {
    title: "Supported Types",
  },
  ttl: {
    title: "TTL (Time-to-Live)",
  },
  "schema-optimization": {
    title: "Schema Optimization",
  },
  indexes: {
    title: "Secondary & Data-skipping Indexes",
  },
  "---Remote DB---": {
    title: "Remote ClickHouse",
    type: "separator",
  },
  "external-tables": {
    title: "External Tables",
  },
  "db-pull": {
    title: "Syncing External Tables",
  },
  "---Migrations---": {
    title: "Migrations",
    type: "separator",
  },
  "apply-migrations": {
    title: "Local Development",
  },
  "planned-migrations": {
    title: "Server Migrations",
  },
  "planned-migrations-library": {
    title: "CLI Migrations",
  },
  "schema-versioning": {
    title: "Table Versioning",
  },
  "schema-change": {
    title: "Failed Migrations",
  },
  "---Accessing Data---": {
    title: "Accessing Data",
    type: "separator",
  },
  "insert-data": {
    title: "Inserting Data",
  },
  "read-data": {
    title: "Reading Data",
  },
};

// Process the raw meta object to generate the final meta object with proper rendering
export default render(rawMeta);
