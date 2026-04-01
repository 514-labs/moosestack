/**
 * OlapDictionary E2E Test Resources
 *
 * These resources test OlapDictionary lifecycle and DDL generation:
 * - HASHED layout with TABLE source (simple lookup)
 * - COMPLEX_KEY_HASHED layout (composite key)
 * - LIFETIME(0) static dictionary
 * - dictGet usage in a MaterializedView
 * - DELETION_PROTECTED lifecycle
 */

import {
  OlapTable,
  OlapDictionary,
  MaterializedView,
  Key,
  DateTime,
  LifeCycle,
  sql,
} from "@514labs/moose-lib";

// ─── Source tables ────────────────────────────────────────────────────────────

/** Product catalog — source table for dictionary lookups */
interface Product {
  productId: Key<string>;
  productName: string;
  category: string;
  priceLevel: number;
  version: number;
}

export const ProductsTable = new OlapTable<Product>("DictTestProducts", {
  orderByFields: ["productId"],
});

/** Region metadata — source for composite key dictionary */
interface Region {
  countryCode: Key<string>;
  regionCode: Key<string>;
  regionName: string;
  timezone: string;
}

export const RegionsTable = new OlapTable<Region>("DictTestRegions", {
  orderByFields: ["countryCode", "regionCode"],
});

// ─── Simple HASHED dictionary (single key) ────────────────────────────────────

/** Attribute columns for the product dictionary (excludes primary key column) */
interface ProductLookup {
  productName: string;
  category: string;
  priceLevel: number;
}

/**
 * HASHED layout dictionary — simple string primary key, backed by ProductsTable.
 * Tests: TABLE source, HASHED layout, RANGE lifetime, dictGet helper.
 */
export const ProductDict = new OlapDictionary<ProductLookup>(
  "dict_test_products",
  {
    sourceTable: ProductsTable,
    primaryKey: ["productId"],
    layout: { type: "HASHED" },
    lifetime: { min: 10, max: 60 },
    defaults: { category: "Unknown", priceLevel: 0 },
  },
);

// ─── COMPLEX_KEY_HASHED dictionary (composite key) ───────────────────────────

interface RegionLookup {
  regionName: string;
  timezone: string;
}

/**
 * COMPLEX_KEY_HASHED layout dictionary — composite primary key.
 * Tests: composite key handling, tuple wrapping in dictGet.
 */
export const RegionDict = new OlapDictionary<RegionLookup>(
  "dict_test_regions",
  {
    sourceTable: RegionsTable,
    primaryKey: ["countryCode", "regionCode"],
    layout: { type: "COMPLEX_KEY_HASHED" },
    lifetime: { min: 60, max: 300 },
    defaults: { regionName: "Unknown", timezone: "UTC" },
  },
);

// ─── STATIC (LIFETIME 0) dictionary ──────────────────────────────────────────

interface StatusLookup {
  label: string;
  severity: number;
}

/** Source table for the static dictionary */
export const StatusCodesTable = new OlapTable<{
  statusCode: Key<string>;
  label: string;
  severity: number;
}>("DictTestStatusCodes", {
  orderByFields: ["statusCode"],
});

/**
 * FLAT layout + LIFETIME(0) — static dictionary, never reloaded.
 * Tests: LIFETIME(0) DDL generation, FLAT layout.
 */
export const StatusDict = new OlapDictionary<StatusLookup>(
  "dict_test_status_codes",
  {
    sourceTable: StatusCodesTable,
    primaryKey: ["statusCode"],
    layout: { type: "FLAT" },
    lifetime: 0,
  },
);

// ─── DELETION_PROTECTED dictionary ───────────────────────────────────────────

/**
 * A deletion-protected dictionary.
 * Tests: lifecycle = DELETION_PROTECTED blocks DROP, allows CREATE.
 */
export const ProtectedDict = new OlapDictionary<ProductLookup>(
  "dict_test_protected",
  {
    sourceTable: ProductsTable,
    primaryKey: ["productId"],
    layout: { type: "HASHED" },
    lifetime: 3600,
    lifeCycle: LifeCycle.DELETION_PROTECTED,
  },
);

// ─── MaterializedView using dictGet ──────────────────────────────────────────

/** Click events target schema — enriched with product names via dictionary lookup */
interface EnrichedClick {
  clickId: Key<string>;
  productId: string;
  productName: string;
  category: string;
  clickedAt: DateTime;
}

/** Raw click events source table */
export const RawClicksTable = new OlapTable<{
  clickId: Key<string>;
  productId: string;
  clickedAt: DateTime;
}>("DictTestRawClicks", {
  orderByFields: ["clickId"],
});

/**
 * MaterializedView that uses dictGet to enrich click events with product names.
 * Tests: dictGet helper integration, dictionary-as-MV-dependency ordering.
 */
export const EnrichedClicksMV = new MaterializedView<EnrichedClick>({
  tableName: "DictTestEnrichedClicks",
  materializedViewName: "DictTestEnrichedClicks_MV",
  orderByFields: ["clickId"],
  selectStatement: sql.statement`
    SELECT
      clickId,
      productId,
      ${ProductDict.get("productName", sql.fragment`productId`)} AS productName,
      ${ProductDict.get("category", sql.fragment`productId`)} AS category,
      clickedAt
    FROM ${RawClicksTable}
  `,
  selectTables: [RawClicksTable],
});
