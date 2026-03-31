import {
  ACCESS_ROLE_ADMIN_DEBUG,
  ACCESS_ROLE_TENANT,
  type AccessRole,
} from "agent-contracts";
import NextAuth, { type NextAuthConfig } from "next-auth";
import { createLocalIdentityProvider } from "@/dev/local-auth";
import { getAuthMode, getOidcConfig, getOidcTenantClaim } from "@/env-vars";
import { extractTenantIdFromIdToken } from "@/lib/id-token";

type AuthProvider = NonNullable<NextAuthConfig["providers"]>[number];
const SESSION_MAX_AGE_SECONDS = 60 * 60;

const providers: AuthProvider[] = [];

if (getAuthMode() === "local") {
  providers.push(createLocalIdentityProvider());
}

const oidcConfig = getOidcConfig();
if (oidcConfig) {
  const oidcProvider = {
    id: "oidc",
    name: "OIDC",
    type: "oidc",
    issuer: oidcConfig.issuer,
    clientId: oidcConfig.clientId,
    clientSecret: oidcConfig.clientSecret,
  } satisfies AuthProvider;

  providers.push(oidcProvider);
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  jwt: {
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  providers,
  callbacks: {
    async signIn({ account, user }) {
      if (account?.provider === "local-identity") {
        return true;
      }

      if (!account?.id_token) {
        return false;
      }

      const tenantId = extractTenantIdFromIdToken(account.id_token);
      if (!tenantId) {
        console.error(
          `OIDC sign-in rejected: missing ${getOidcTenantClaim()} claim`,
        );
        return false;
      }

      return !!user;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.userId = user.id;
        token.accessRole = resolveAccessRole(user.accessRole);
        token.tenantId = user.tenantId;
        token.tenantName = user.tenantName ?? user.name ?? user.tenantId ?? "";
        token.provider = user.provider ?? account?.provider;
        token.idToken = user.idToken;
        token.idTokenExpiresAt = user.idTokenExpiresAt;
      }

      if (account?.id_token) {
        const tenantId = extractTenantIdFromIdToken(account.id_token);
        token.idToken = account.id_token;
        token.provider = account.provider;
        token.accessRole = ACCESS_ROLE_TENANT;
        token.tenantId = tenantId;
        token.tenantName =
          typeof token.tenantName === "string" && token.tenantName.trim() ?
            token.tenantName
          : typeof token.name === "string" && token.name.trim() ? token.name
          : (tenantId ?? "");
        token.idTokenExpiresAt =
          typeof account.expires_at === "number" ?
            account.expires_at * 1000
          : Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.userId ?? token.sub ?? "");
        session.user.accessRole = resolveAccessRole(token.accessRole);
        session.user.tenantId =
          typeof token.tenantId === "string" && token.tenantId.trim() ?
            token.tenantId
          : undefined;
        session.user.tenantName =
          typeof token.tenantName === "string" && token.tenantName.trim() ?
            token.tenantName
          : undefined;
        session.user.provider = String(token.provider ?? "unknown");
      }

      session.idToken =
        (
          typeof token.idToken === "string" &&
          (!token.idTokenExpiresAt || token.idTokenExpiresAt > Date.now())
        ) ?
          token.idToken
        : undefined;

      return session;
    },
  },
});

function resolveAccessRole(value: unknown): AccessRole {
  return value === ACCESS_ROLE_ADMIN_DEBUG ?
      ACCESS_ROLE_ADMIN_DEBUG
    : ACCESS_ROLE_TENANT;
}
