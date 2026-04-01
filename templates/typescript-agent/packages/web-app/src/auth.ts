import { ACCESS_ROLE_ADMIN_DEBUG, ACCESS_ROLE_TENANT, type AccessRole } from "agent-contracts";
import NextAuth, { type NextAuthConfig } from "next-auth";
import { createLocalAccessProvider } from "@/dev/local-auth";
import { getAuthMode, getOidcConfig, getOidcOrgClaim } from "@/env-vars";
import { extractOrgIdFromIdToken } from "@/lib/id-token";
import { issueOidcAccessToken } from "@/lib/oidc-token";

type AuthProvider = NonNullable<NextAuthConfig["providers"]>[number];
const SESSION_MAX_AGE_SECONDS = 60 * 60;

const providers: AuthProvider[] = [];

if (getAuthMode() === "local") {
  providers.push(createLocalAccessProvider());
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
      if (account?.provider === "local-access") {
        return true;
      }

      if (!account?.id_token) {
        return false;
      }

      const orgId = extractOrgIdFromIdToken(account.id_token);
      if (!orgId) {
        console.error(`OIDC sign-in rejected: missing ${getOidcOrgClaim()} claim`);
        return false;
      }

      return !!user;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.userId = user.id;
        token.accessRole = resolveAccessRole(user.accessRole);
        token.orgId = user.orgId;
        token.orgName = user.orgName ?? user.name ?? user.orgId ?? "";
        token.provider = user.provider ?? account?.provider;
        token.idToken = user.idToken;
        token.idTokenExpiresAt = user.idTokenExpiresAt;
      }

      if (account?.id_token) {
        const orgId = extractOrgIdFromIdToken(account.id_token);
        const userEmail = typeof token.email === "string" ? token.email : "unknown";
        const userName = typeof token.name === "string" ? token.name : userEmail;
        const userSub = String(token.sub ?? account.providerAccountId ?? "");

        token.idToken = await issueOidcAccessToken(orgId ?? "", userEmail, userName, userSub);
        token.provider = account.provider;
        token.accessRole = ACCESS_ROLE_TENANT;
        token.orgId = orgId;
        token.orgName =
          typeof token.orgName === "string" && token.orgName.trim()
            ? token.orgName
            : typeof token.name === "string" && token.name.trim()
              ? token.name
              : (orgId ?? "");
        token.idTokenExpiresAt =
          typeof account.expires_at === "number"
            ? account.expires_at * 1000
            : Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.userId ?? token.sub ?? "");
        session.user.accessRole = resolveAccessRole(token.accessRole);
        session.user.orgId =
          typeof token.orgId === "string" && token.orgId.trim() ? token.orgId : undefined;
        session.user.orgName =
          typeof token.orgName === "string" && token.orgName.trim() ? token.orgName : undefined;
        session.user.provider = String(token.provider ?? "unknown");
      }

      session.idToken =
        typeof token.idToken === "string" &&
        (!token.idTokenExpiresAt || token.idTokenExpiresAt > Date.now())
          ? token.idToken
          : undefined;

      return session;
    },
  },
});

function resolveAccessRole(value: unknown): AccessRole {
  return value === ACCESS_ROLE_ADMIN_DEBUG ? ACCESS_ROLE_ADMIN_DEBUG : ACCESS_ROLE_TENANT;
}
