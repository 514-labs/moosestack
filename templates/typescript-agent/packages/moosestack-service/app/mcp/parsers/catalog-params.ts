// Bedrock tool schemas are stricter than Anthropic/OpenAI. Keep these as
// string inputs with manual validation instead of z.enum() so the MCP tool
// schemas stay portable across providers.
const CATALOG_COMPONENT_TYPES = ["tables", "materialized_views"] as const;
const CATALOG_FORMATS = ["summary", "detailed"] as const;

export type CatalogComponentType = (typeof CATALOG_COMPONENT_TYPES)[number];
export type CatalogFormat = (typeof CATALOG_FORMATS)[number];

export function parseCatalogComponentType(
  value: string | undefined,
): CatalogComponentType | undefined {
  if (!value) {
    return undefined;
  }

  if (CATALOG_COMPONENT_TYPES.includes(value as CatalogComponentType)) {
    return value as CatalogComponentType;
  }

  throw new Error(
    `Invalid component_type: ${value}. Allowed values: ${CATALOG_COMPONENT_TYPES.join(", ")}.`,
  );
}

export function parseCatalogFormat(value: string | undefined): CatalogFormat {
  if (!value) {
    return "summary";
  }

  if (CATALOG_FORMATS.includes(value as CatalogFormat)) {
    return value as CatalogFormat;
  }

  throw new Error(
    `Invalid format: ${value}. Allowed values: ${CATALOG_FORMATS.join(", ")}.`,
  );
}
