import NextAuth, { type NextAuthConfig } from "next-auth";
import { createLocalTenantProvider } from "@/dev/local-auth";
import { getAuthMode, getOidcConfig, getOidcTenantClaim } from "@/env-vars";
import { extractTenantIdFromIdToken } from "@/lib/id-token";

type AuthProvider = NonNullable<NextAuthConfig["providers"]>[number];

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
  session: { strategy: "jwt" },
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
        token.providerName = user.provider ?? account?.provider;
        token.idToken = user.idToken;
      }

      if (account?.id_token) {
        token.idToken = account.id_token;
        token.providerName = account.provider;
        token.tenantId = extractTenantIdFromIdToken(account.id_token);
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
        session.user.provider = String(token.providerName ?? "unknown");
      }

      session.idToken =
        typeof token.idToken === "string" ? token.idToken : undefined;

      return session;
    },
  },
});
