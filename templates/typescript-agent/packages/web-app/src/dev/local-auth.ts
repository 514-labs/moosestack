import { importPKCS8, SignJWT } from "jose";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const localTenantSchema = z.object({
  tenantId: z.string().min(1),
});
const LOCAL_ID_TOKEN_TTL_SECONDS = 60 * 60;

export const LOCAL_TENANTS = [
  {
    id: "acme",
    name: "ACME Fleet",
    email: "ops@acme.example",
    description: "Brake alerts and support volumes rising in the north-east.",
  },
  {
    id: "globex",
    name: "Globex Mobility",
    email: "control@globex.example",
    description:
      "Seattle hub is close to capacity with healthy battery trends.",
  },
] as const;

export type LocalTenant = (typeof LOCAL_TENANTS)[number];

let localPrivateKeyPromise: Promise<CryptoKey> | undefined;

function getLocalPrivateKeyPem(): string {
  const value = process.env.LOCAL_DEV_JWT_PRIVATE_KEY;
  if (!value) {
    throw new Error(
      "LOCAL_DEV_JWT_PRIVATE_KEY is not set. Run `pnpm env:prepare` to generate local auth keys.",
    );
  }

  return value.replace(/\\n/g, "\n");
}

function getLocalPrivateKey(): Promise<CryptoKey> {
  if (!localPrivateKeyPromise) {
    localPrivateKeyPromise = importPKCS8(getLocalPrivateKeyPem(), "RS256");
  }

  return localPrivateKeyPromise;
}

function getLocalTenant(tenantId: string): LocalTenant | undefined {
  return LOCAL_TENANTS.find((tenant) => tenant.id === tenantId);
}

async function issueLocalTenantToken(tenant: LocalTenant): Promise<string> {
  const privateKey = await getLocalPrivateKey();

  return await new SignJWT({
    tenant_id: tenant.id,
    email: tenant.email,
    name: tenant.name,
    scope: "agent:query",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("typescript-agent-local")
    .setAudience("typescript-agent")
    .setSubject(`local-${tenant.id}`)
    .setExpirationTime(`${LOCAL_ID_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}

export function createLocalTenantProvider() {
  return Credentials({
    id: "local-tenant",
    name: "Local tenant",
    credentials: {
      tenantId: { label: "Tenant", type: "text" },
    },
    async authorize(credentials) {
      const parsed = localTenantSchema.safeParse(credentials);
      if (!parsed.success) {
        return null;
      }

      const tenant = getLocalTenant(parsed.data.tenantId);
      if (!tenant) {
        return null;
      }

      return {
        id: `local-${tenant.id}`,
        name: tenant.name,
        email: tenant.email,
        tenantId: tenant.id,
        tenantName: tenant.name,
        provider: "local",
        idToken: await issueLocalTenantToken(tenant),
        idTokenExpiresAt: Date.now() + LOCAL_ID_TOKEN_TTL_SECONDS * 1000,
      };
    },
  });
}
