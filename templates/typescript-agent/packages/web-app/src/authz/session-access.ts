import {
  ACCESS_ROLE_ADMIN_DEBUG,
  ACCESS_ROLE_TENANT,
  type AccessRole,
} from "agent-contracts";
import type { Session } from "next-auth";

interface BaseSessionAccess {
  accessRole: AccessRole;
  identityName: string;
  scopeBadge: string;
  scopeDescription: string;
  traceScopeId: string;
}

export interface TenantSessionAccess extends BaseSessionAccess {
  kind: "tenant";
  accessRole: typeof ACCESS_ROLE_TENANT;
  tenantId: string;
  tenantName: string;
}

export interface AdminDebugSessionAccess extends BaseSessionAccess {
  kind: "admin";
  accessRole: typeof ACCESS_ROLE_ADMIN_DEBUG;
}

export type SessionAccess = TenantSessionAccess | AdminDebugSessionAccess;

function resolveIdentityName(session: Session): string {
  const explicitName = session.user.name?.trim();
  if (explicitName) {
    return explicitName;
  }

  const tenantName = session.user.tenantName?.trim();
  if (tenantName) {
    return tenantName;
  }

  return session.user.accessRole === ACCESS_ROLE_ADMIN_DEBUG ?
      "Admin Debug"
    : "Tenant user";
}

export function getSessionAccess(
  session: Session | null | undefined,
): SessionAccess | undefined {
  if (!session?.user) {
    return undefined;
  }

  if (session.user.accessRole === ACCESS_ROLE_ADMIN_DEBUG) {
    return {
      kind: "admin",
      accessRole: ACCESS_ROLE_ADMIN_DEBUG,
      identityName: resolveIdentityName(session),
      scopeBadge: "Admin debug access",
      scopeDescription:
        "Authenticated as the local debug admin. Authorization is unrestricted across the seeded dataset.",
      traceScopeId: ACCESS_ROLE_ADMIN_DEBUG,
    };
  }

  if (
    session.user.accessRole === ACCESS_ROLE_TENANT &&
    typeof session.user.tenantId === "string" &&
    session.user.tenantId.trim()
  ) {
    const tenantId = session.user.tenantId.trim();
    const tenantName = session.user.tenantName?.trim() || tenantId;

    return {
      kind: "tenant",
      accessRole: ACCESS_ROLE_TENANT,
      tenantId,
      tenantName,
      identityName: resolveIdentityName(session),
      scopeBadge: `${tenantName} only`,
      scopeDescription: `Authenticated as ${tenantName}. Authorization is limited to ${tenantName} data.`,
      traceScopeId: tenantId,
    };
  }

  return undefined;
}

export function isAdminSessionAccess(
  access: SessionAccess,
): access is AdminDebugSessionAccess {
  return access.kind === "admin";
}
