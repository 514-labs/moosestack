import {
  ACCESS_ROLE_ADMIN_DEBUG,
  ACCESS_ROLE_TENANT,
  type AccessRole,
} from "agent-contracts";
import { importPKCS8, SignJWT } from "jose";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const localIdentitySchema = z.object({
  identityId: z.string().min(1),
});
const LOCAL_ID_TOKEN_TTL_SECONDS = 60 * 60;

export const LOCAL_IDENTITIES = [
  {
    id: "tenant_a",
    name: "Tenant A",
    email: "tenant-a@example.local",
    accessRole: ACCESS_ROLE_TENANT,
    tenantId: "tenant_a",
    tenantName: "Tenant A",
    description: "Brake alerts and support volumes rising in the north-east.",
  },
  {
    id: "tenant_b",
    name: "Tenant B",
    email: "tenant-b@example.local",
    accessRole: ACCESS_ROLE_TENANT,
    tenantId: "tenant_b",
    tenantName: "Tenant B",
    description:
      "Seattle hub is close to capacity with healthy battery trends.",
  },
  {
    id: "admin_debug",
    name: "Admin Debug",
    email: "admin-debug@example.local",
    accessRole: ACCESS_ROLE_ADMIN_DEBUG,
    description:
      "Local-only debug identity with read access across both seeded tenants.",
  },
] as const;

export type LocalIdentity = (typeof LOCAL_IDENTITIES)[number];

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

function getLocalIdentity(identityId: string): LocalIdentity | undefined {
  return LOCAL_IDENTITIES.find((identity) => identity.id === identityId);
}

function getLocalIdentityScope(accessRole: AccessRole): string {
  return accessRole === ACCESS_ROLE_ADMIN_DEBUG ?
      "agent:query admin:debug"
    : "agent:query";
}

async function issueLocalIdentityToken(
  identity: LocalIdentity,
): Promise<string> {
  const privateKey = await getLocalPrivateKey();

  return await new SignJWT({
    ...(identity.tenantId ? { tenant_id: identity.tenantId } : {}),
    email: identity.email,
    name: identity.name,
    scope: getLocalIdentityScope(identity.accessRole),
    access_role: identity.accessRole,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("typescript-agent-local")
    .setAudience("typescript-agent")
    .setSubject(`local-${identity.id}`)
    .setExpirationTime(`${LOCAL_ID_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}

export function createLocalIdentityProvider() {
  return Credentials({
    id: "local-identity",
    name: "Local identity",
    credentials: {
      identityId: { label: "Identity", type: "text" },
    },
    async authorize(credentials) {
      const parsed = localIdentitySchema.safeParse(credentials);
      if (!parsed.success) {
        return null;
      }

      const identity = getLocalIdentity(parsed.data.identityId);
      if (!identity) {
        return null;
      }

      return {
        id: `local-${identity.id}`,
        name: identity.name,
        email: identity.email,
        tenantId: identity.tenantId,
        tenantName: identity.tenantName,
        provider: "local",
        accessRole: identity.accessRole,
        idToken: await issueLocalIdentityToken(identity),
        idTokenExpiresAt: Date.now() + LOCAL_ID_TOKEN_TTL_SECONDS * 1000,
      };
    },
  });
}
