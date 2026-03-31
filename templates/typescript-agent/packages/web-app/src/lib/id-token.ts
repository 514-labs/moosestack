import { decodeJwt } from "jose";
import { getOidcTenantClaim } from "@/env-vars";

export function extractTenantIdFromIdToken(
  idToken: string,
): string | undefined {
  const claim = getOidcTenantClaim();
  try {
    const claims = decodeJwt(idToken);
    const value = claims[claim];

    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
