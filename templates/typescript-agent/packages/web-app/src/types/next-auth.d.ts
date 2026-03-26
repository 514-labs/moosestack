import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    idToken?: string;
    user: {
      id: string;
      tenantId: string;
      tenantName: string;
      provider: string;
    } & NonNullable<Session["user"]>;
  }

  interface User {
    tenantId?: string;
    tenantName?: string;
    provider?: string;
    idToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    tenantId?: string;
    tenantName?: string;
    providerName?: string;
    idToken?: string;
  }
}
