import type { DefaultSession } from "next-auth";
import "next-auth";
import "next-auth/jwt";

type AccessRole = "tenant" | "admin_debug";

declare module "next-auth" {
  interface Session {
    idToken?: string;
    user: NonNullable<DefaultSession["user"]> & {
      id: string;
      accessRole: AccessRole;
      orgId?: string;
      orgName?: string;
      provider: string;
    };
  }

  interface User {
    accessRole?: AccessRole;
    orgId?: string;
    orgName?: string;
    provider?: string;
    idToken?: string;
    idTokenExpiresAt?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    accessRole?: AccessRole;
    orgId?: string;
    orgName?: string;
    provider?: string;
    idToken?: string;
    idTokenExpiresAt?: number;
  }
}
