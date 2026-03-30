import { describe, expect, it } from "vitest";

import {
  parseCatalogComponentType,
  parseCatalogFormat,
} from "../app/mcp/parsers/catalog-params";

describe("catalog-params", () => {
  it("accepts supported component type and format values", () => {
    expect(parseCatalogComponentType("tables")).toBe("tables");
    expect(parseCatalogComponentType("materialized_views")).toBe(
      "materialized_views",
    );
    expect(parseCatalogFormat("summary")).toBe("summary");
    expect(parseCatalogFormat("detailed")).toBe("detailed");
  });

  it("falls back to defaults when optional values are omitted", () => {
    expect(parseCatalogComponentType(undefined)).toBeUndefined();
    expect(parseCatalogFormat(undefined)).toBe("summary");
  });

  it("rejects unsupported values", () => {
    expect(() => parseCatalogComponentType("views")).toThrow(
      /Allowed values: tables, materialized_views/,
    );
    expect(() => parseCatalogFormat("json")).toThrow(
      /Allowed values: summary, detailed/,
    );
  });
});
