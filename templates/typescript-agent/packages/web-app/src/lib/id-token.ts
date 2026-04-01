import { decodeJwt } from "jose";
import { getOidcOrgClaim } from "@/env-vars";

export function extractOrgIdFromIdToken(idToken: string): string | undefined {
  const claim = getOidcOrgClaim();
  try {
    const claims = decodeJwt(idToken);
    const value = claims[claim];

    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
