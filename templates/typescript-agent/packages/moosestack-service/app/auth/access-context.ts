import type { MooseUtils } from "@514labs/moose-lib";
import { ACCESS_ROLE_ADMIN_DEBUG, ACCESS_ROLE_TENANT, type AccessRole } from "agent-contracts";
import type express from "express";
import { ACCESS_ROLE_CLAIM, ORG_ID_CLAIM } from "./claims";

export type MooseRequest = express.Request & { moose?: MooseUtils };

interface BaseAccessContext {
  moose: MooseUtils;
  accessRole: AccessRole;
}

export interface OrgAccessContext extends BaseAccessContext {
  kind: "org";
  accessRole: typeof ACCESS_ROLE_TENANT;
  orgId: string;
}

export interface AdminDebugAccessContext extends BaseAccessContext {
  kind: "admin";
  accessRole: typeof ACCESS_ROLE_ADMIN_DEBUG;
}

export type AuthenticatedAccessContext = OrgAccessContext | AdminDebugAccessContext;

function getOrgIdFromJwt(moose: MooseUtils): string | undefined {
  const orgIdValue = moose.jwt?.[ORG_ID_CLAIM];

  if (typeof orgIdValue !== "string") {
    return undefined;
  }

  const orgId = orgIdValue.trim();
  return orgId.length > 0 ? orgId : undefined;
}

function getAccessRoleFromJwt(moose: MooseUtils): AccessRole | undefined {
  const accessRole = moose.jwt?.[ACCESS_ROLE_CLAIM];

  if (accessRole !== ACCESS_ROLE_TENANT && accessRole !== ACCESS_ROLE_ADMIN_DEBUG) {
    return undefined;
  }

  return accessRole;
}

export function getAuthenticatedAccessContext(
  req: express.Request,
): AuthenticatedAccessContext | undefined {
  const moose = (req as MooseRequest).moose;
  if (!moose?.jwt) {
    return undefined;
  }

  const accessRole = getAccessRoleFromJwt(moose);
  const orgId = getOrgIdFromJwt(moose);
  if (accessRole === ACCESS_ROLE_TENANT && orgId) {
    return {
      kind: "org",
      accessRole: ACCESS_ROLE_TENANT,
      moose,
      orgId,
    };
  }

  if (accessRole === ACCESS_ROLE_ADMIN_DEBUG) {
    return {
      kind: "admin",
      accessRole: ACCESS_ROLE_ADMIN_DEBUG,
      moose,
    };
  }

  return undefined;
}

export function assertAuthenticatedAccessContext(req: express.Request): AuthenticatedAccessContext {
  const context = getAuthenticatedAccessContext(req);

  if (!context) {
    throw new Error(
      "Authenticated access context missing after requireAuthenticatedMoose middleware.",
    );
  }

  return context;
}

export function respondUnauthorized(res: express.Response): express.Response {
  return res.status(401).json({
    error: "Unauthorized",
    details:
      "A valid JWT is required. Use an organization-scoped token with org_id, or use the local Admin Debug access option.",
  });
}

export function requireAuthenticatedMoose(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): express.Response | undefined {
  if (!getAuthenticatedAccessContext(req)) {
    return respondUnauthorized(res);
  }

  next();
}

export function isOrgAccessContext(
  context: AuthenticatedAccessContext,
): context is OrgAccessContext {
  return context.kind === "org";
}
