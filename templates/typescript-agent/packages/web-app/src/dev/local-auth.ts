import {
  ACCESS_ROLE_ADMIN_DEBUG,
  ACCESS_ROLE_TENANT,
  type AccessRole,
} from "agent-contracts";
import { importPKCS8, SignJWT } from "jose";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const localCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const LOCAL_ID_TOKEN_TTL_SECONDS = 60 * 60;

export const LOCAL_MOCK_USERS = [
  {
    id: "org-a-user-1",
    name: "user1@orgA.com",
    email: "user1@orgA.com",
    passwordEnvVar: "LOCAL_MOCK_PASSWORD_ORG_A_USER",
    accessRole: ACCESS_ROLE_TENANT,
    orgId: "org_a",
    orgName: "Org A",
    description: "Organization-scoped access for Org A.",
  },
  {
    id: "org-b-user-2",
    name: "user2@orgB.com",
    email: "user2@orgB.com",
    passwordEnvVar: "LOCAL_MOCK_PASSWORD_ORG_B_USER",
    accessRole: ACCESS_ROLE_TENANT,
    orgId: "org_b",
    orgName: "Org B",
    description: "Organization-scoped access for Org B.",
  },
  {
    id: "admin",
    name: "admin@templae.com",
    email: "admin@templae.com",
    passwordEnvVar: "LOCAL_MOCK_PASSWORD_ADMIN",
    accessRole: ACCESS_ROLE_ADMIN_DEBUG,
    description:
      "Local-only admin access with read visibility across both seeded organizations.",
  },
] as const;

export type LocalMockUser = (typeof LOCAL_MOCK_USERS)[number];

let localPrivateKeyPromise: Promise<CryptoKey> | undefined;

export function isAdminDebugEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

function isLocalMockUserEnabled(mockUser: LocalMockUser): boolean {
  return (
    mockUser.accessRole !== ACCESS_ROLE_ADMIN_DEBUG || isAdminDebugEnabled()
  );
}

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

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function getLocalMockPassword(mockUser: LocalMockUser): string {
  const value = process.env[mockUser.passwordEnvVar]?.trim();
  if (!value) {
    throw new Error(
      `${mockUser.passwordEnvVar} is not set. Run \`pnpm env:prepare\` to generate local mock passwords.`,
    );
  }

  return value;
}

export function getLocalMockUser(email: string): LocalMockUser | undefined {
  const normalizedEmail = normalizeEmail(email);

  return LOCAL_MOCK_USERS.find(
    (mockUser) =>
      isLocalMockUserEnabled(mockUser) &&
      normalizeEmail(mockUser.email) === normalizedEmail,
  );
}

export function getVisibleLocalMockUsers(): LocalMockUser[] {
  return LOCAL_MOCK_USERS.filter(isLocalMockUserEnabled);
}

function isValidLocalPassword(
  mockUser: LocalMockUser,
  password: string,
): boolean {
  return password === getLocalMockPassword(mockUser);
}

function getLocalAccessScope(accessRole: AccessRole): string {
  return accessRole === ACCESS_ROLE_ADMIN_DEBUG ?
      "agent:query admin:debug"
    : "agent:query";
}

async function issueLocalAccessToken(mockUser: LocalMockUser): Promise<string> {
  const privateKey = await getLocalPrivateKey();
  const orgClaims =
    mockUser.accessRole === ACCESS_ROLE_TENANT ?
      { org_id: mockUser.orgId }
    : {};

  return await new SignJWT({
    ...orgClaims,
    email: mockUser.email,
    name: mockUser.name,
    scope: getLocalAccessScope(mockUser.accessRole),
    access_role: mockUser.accessRole,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("typescript-agent-local")
    .setAudience("typescript-agent")
    .setSubject(`local-${mockUser.id}`)
    .setExpirationTime(`${LOCAL_ID_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}

export function createLocalAccessProvider() {
  return Credentials({
    id: "local-access",
    name: "Local login",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const parsed = localCredentialsSchema.safeParse(credentials);
      if (!parsed.success) {
        return null;
      }

      const mockUser = getLocalMockUser(parsed.data.email);
      if (!mockUser) {
        return null;
      }

      if (!isValidLocalPassword(mockUser, parsed.data.password)) {
        return null;
      }

      return {
        id: `local-${mockUser.id}`,
        name: mockUser.name,
        email: mockUser.email,
        ...(mockUser.accessRole === ACCESS_ROLE_TENANT ?
          {
            orgId: mockUser.orgId,
            orgName: mockUser.orgName,
          }
        : {}),
        provider: "local",
        accessRole: mockUser.accessRole,
        idToken: await issueLocalAccessToken(mockUser),
        idTokenExpiresAt: Date.now() + LOCAL_ID_TOKEN_TTL_SECONDS * 1000,
      };
    },
  });
}
