import { ACCESS_ROLE_ADMIN_DEBUG, ACCESS_ROLE_TENANT, type AccessRole } from "agent-contracts";
import type { Session } from "next-auth";

interface BaseSessionAccess {
  accessRole: AccessRole;
  displayName: string;
  scopeBadge: string;
  scopeDescription: string;
  accessScopeId: string;
}

export interface OrgSessionAccess extends BaseSessionAccess {
  kind: "org";
  accessRole: typeof ACCESS_ROLE_TENANT;
  orgId: string;
  orgName: string;
}

export interface AdminDebugSessionAccess extends BaseSessionAccess {
  kind: "admin";
  accessRole: typeof ACCESS_ROLE_ADMIN_DEBUG;
}

export type SessionAccess = OrgSessionAccess | AdminDebugSessionAccess;

function resolveDisplayName(session: Session): string {
  const explicitName = session.user.name?.trim();
  if (explicitName) {
    return explicitName;
  }

  const orgName = session.user.orgName?.trim();
  if (orgName) {
    return orgName;
  }

  return session.user.accessRole === ACCESS_ROLE_ADMIN_DEBUG
    ? "Admin Debug"
    : "Organization access";
}

export function getSessionAccess(session: Session | null | undefined): SessionAccess | undefined {
  if (!session?.user) {
    return undefined;
  }

  if (session.user.accessRole === ACCESS_ROLE_ADMIN_DEBUG) {
    return {
      kind: "admin",
      accessRole: ACCESS_ROLE_ADMIN_DEBUG,
      displayName: resolveDisplayName(session),
      scopeBadge: "Admin debug access",
      scopeDescription:
        "Authenticated as the local debug admin. Authorization is unrestricted across the seeded dataset.",
      accessScopeId: ACCESS_ROLE_ADMIN_DEBUG,
    };
  }

  if (
    session.user.accessRole === ACCESS_ROLE_TENANT &&
    typeof session.user.orgId === "string" &&
    session.user.orgId.trim()
  ) {
    const orgId = session.user.orgId.trim();
    const orgName = session.user.orgName?.trim() || orgId;

    return {
      kind: "org",
      accessRole: ACCESS_ROLE_TENANT,
      orgId,
      orgName,
      displayName: resolveDisplayName(session),
      scopeBadge: `${orgName} only`,
      scopeDescription: `Authenticated as ${orgName}. Authorization is limited to ${orgName} data.`,
      accessScopeId: orgId,
    };
  }

  return undefined;
}

export function isAdminSessionAccess(access: SessionAccess): access is AdminDebugSessionAccess {
  return access.kind === "admin";
}
