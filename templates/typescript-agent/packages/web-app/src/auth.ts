import NextAuth, { type NextAuthConfig } from "next-auth";
import { createLocalTenantProvider } from "@/dev/local-auth";
import { getAuthMode, getOidcConfig, getOidcTenantClaim } from "@/env-vars";
import { extractTenantIdFromIdToken } from "@/lib/id-token";

type AuthProvider = NonNullable<NextAuthConfig["providers"]>[number];
const SESSION_MAX_AGE_SECONDS = 60 * 60;

const providers: AuthProvider[] = [];

if (getAuthMode() === "local") {
  providers.push(createLocalTenantProvider());
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
      if (account?.provider === "local-tenant") {
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
        token.tenantId = user.tenantId;
        token.tenantName = user.tenantName ?? user.name ?? "";
        token.provider = user.provider ?? account?.provider;
        token.idToken = user.idToken;
        token.idTokenExpiresAt = user.idTokenExpiresAt;
      }

      if (account?.id_token) {
        token.idToken = account.id_token;
        token.provider = account.provider;
        token.tenantId = extractTenantIdFromIdToken(account.id_token);
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
        session.user.tenantId = String(token.tenantId ?? "");
        session.user.tenantName = String(
          token.tenantName ?? session.user.name ?? "",
        );
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
