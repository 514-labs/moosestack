type RawQueryParam = string | string[] | undefined;

/**
 * Extracts the first value from a Next.js query parameter (which can be a
 * string, array, or undefined) and returns a decoded string.
 */
export function extractDecodedParam(raw: RawQueryParam): string | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    return undefined;
  }

  return decodeValue(value);
}

function decodeValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
