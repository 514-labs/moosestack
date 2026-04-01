import "server-only";
import { ACCESS_ROLE_TENANT } from "agent-contracts";
import { importPKCS8, SignJWT } from "jose";

const OIDC_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

let oidcPrivateKeyPromise: Promise<CryptoKey> | undefined;

function getOidcPrivateKeyPem(): string {
  const value = process.env.LOCAL_DEV_JWT_PRIVATE_KEY;
  if (!value) {
    throw new Error(
      "LOCAL_DEV_JWT_PRIVATE_KEY is not set. Run `pnpm env:prepare` to generate local auth keys.",
    );
  }

  return value.replace(/\\n/g, "\n");
}

function getOidcPrivateKey(): Promise<CryptoKey> {
  if (!oidcPrivateKeyPromise) {
    oidcPrivateKeyPromise = importPKCS8(getOidcPrivateKeyPem(), "RS256");
  }

  return oidcPrivateKeyPromise;
}

export async function issueOidcAccessToken(
  orgId: string,
  userEmail: string,
  userName: string,
  userSub: string,
): Promise<string> {
  const privateKey = await getOidcPrivateKey();

  return await new SignJWT({
    org_id: orgId,
    email: userEmail,
    name: userName,
    scope: "agent:query",
    access_role: ACCESS_ROLE_TENANT,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("typescript-agent-local")
    .setAudience("typescript-agent")
    .setSubject(userSub)
    .setExpirationTime(`${OIDC_ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}
