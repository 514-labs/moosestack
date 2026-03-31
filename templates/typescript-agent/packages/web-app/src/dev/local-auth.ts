import {
  ACCESS_ROLE_ADMIN_DEBUG,
  ACCESS_ROLE_TENANT,
  type AccessRole,
} from "agent-contracts";
import { importPKCS8, SignJWT } from "jose";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const localAccessSchema = z.object({
  selectionId: z.string().min(1),
});
const LOCAL_ID_TOKEN_TTL_SECONDS = 60 * 60;

export const LOCAL_ACCESS_OPTIONS = [
  {
    id: "org_a",
    name: "Org A",
    email: "org-a@example.local",
    accessRole: ACCESS_ROLE_TENANT,
    orgId: "org_a",
    orgName: "Org A",
    description: "Brake alerts and support volumes rising in the north-east.",
  },
  {
    id: "org_b",
    name: "Org B",
    email: "org-b@example.local",
    accessRole: ACCESS_ROLE_TENANT,
    orgId: "org_b",
    orgName: "Org B",
    description:
      "Seattle hub is close to capacity with healthy battery trends.",
  },
  {
    id: "admin_debug",
    name: "Admin Debug",
    email: "admin-debug@example.local",
    accessRole: ACCESS_ROLE_ADMIN_DEBUG,
    description:
      "Local-only debug access with read visibility across both seeded organizations.",
  },
] as const;

export type LocalAccessOption = (typeof LOCAL_ACCESS_OPTIONS)[number];

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

function getLocalAccessOption(
  selectionId: string,
): LocalAccessOption | undefined {
  return LOCAL_ACCESS_OPTIONS.find((option) => option.id === selectionId);
}

function getLocalAccessScope(accessRole: AccessRole): string {
  return accessRole === ACCESS_ROLE_ADMIN_DEBUG ?
      "agent:query admin:debug"
    : "agent:query";
}

async function issueLocalAccessToken(
  accessOption: LocalAccessOption,
): Promise<string> {
  const privateKey = await getLocalPrivateKey();
  const orgClaims =
    accessOption.accessRole === ACCESS_ROLE_TENANT ?
      { org_id: accessOption.orgId }
    : {};

  return await new SignJWT({
    ...orgClaims,
    email: accessOption.email,
    name: accessOption.name,
    scope: getLocalAccessScope(accessOption.accessRole),
    access_role: accessOption.accessRole,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("typescript-agent-local")
    .setAudience("typescript-agent")
    .setSubject(`local-${accessOption.id}`)
    .setExpirationTime(`${LOCAL_ID_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}

export function createLocalAccessProvider() {
  return Credentials({
    id: "local-access",
    name: "Local access",
    credentials: {
      selectionId: { label: "Access option", type: "text" },
    },
    async authorize(credentials) {
      const parsed = localAccessSchema.safeParse(credentials);
      if (!parsed.success) {
        return null;
      }

      const accessOption = getLocalAccessOption(parsed.data.selectionId);
      if (!accessOption) {
        return null;
      }

      return {
        id: `local-${accessOption.id}`,
        name: accessOption.name,
        email: accessOption.email,
        ...(accessOption.accessRole === ACCESS_ROLE_TENANT ?
          {
            orgId: accessOption.orgId,
            orgName: accessOption.orgName,
          }
        : {}),
        provider: "local",
        accessRole: accessOption.accessRole,
        idToken: await issueLocalAccessToken(accessOption),
        idTokenExpiresAt: Date.now() + LOCAL_ID_TOKEN_TTL_SECONDS * 1000,
      };
    },
  });
}
