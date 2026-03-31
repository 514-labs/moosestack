import {
  buildRowPolicyOptionsFromClaims,
  MOOSE_RLS_SETTING_PREFIX,
  type MooseUtils,
  type RowPolicyOptions,
} from "@514labs/moose-lib";
import {
  ACCESS_ROLE_ADMIN_DEBUG,
  ACCESS_ROLE_TENANT,
  type AccessRole,
} from "agent-contracts";
import type express from "express";
import { ORG_ROW_POLICY_CONFIG } from "../security/tenant-isolation";
import { ACCESS_ROLE_CLAIM, ORG_ID_CLAIM } from "./claims";

const ROW_POLICY_CONFIG = Object.freeze({
  [`${MOOSE_RLS_SETTING_PREFIX}${ORG_ROW_POLICY_CONFIG.column}`]:
    ORG_ROW_POLICY_CONFIG.claim,
});

export type MooseRequest = express.Request & { moose?: MooseUtils };

interface BaseAccessContext {
  moose: MooseUtils;
  accessRole: AccessRole;
  rowPolicyOptions?: RowPolicyOptions;
}

export interface OrgAccessContext extends BaseAccessContext {
  kind: "org";
  accessRole: typeof ACCESS_ROLE_TENANT;
  orgId: string;
  rowPolicyOptions: RowPolicyOptions;
}

export interface AdminDebugAccessContext extends BaseAccessContext {
  kind: "admin";
  accessRole: typeof ACCESS_ROLE_ADMIN_DEBUG;
}

export type AuthenticatedAccessContext =
  | OrgAccessContext
  | AdminDebugAccessContext;

function getOrgIdFromJwt(moose: MooseUtils): string | undefined {
  const orgIdValue = moose.jwt?.[ORG_ID_CLAIM];

  if (typeof orgIdValue !== "string") {
    return undefined;
  }

  const orgId = orgIdValue.trim();
  return orgId.length > 0 ? orgId : undefined;
}

function isAdminDebugJwt(moose: MooseUtils): boolean {
  return moose.jwt?.[ACCESS_ROLE_CLAIM] === ACCESS_ROLE_ADMIN_DEBUG;
}

export function getAuthenticatedAccessContext(
  req: express.Request,
): AuthenticatedAccessContext | undefined {
  const moose = (req as MooseRequest).moose;
  if (!moose?.jwt) {
    return undefined;
  }

  const orgId = getOrgIdFromJwt(moose);
  if (orgId) {
    return {
      kind: "org",
      accessRole: ACCESS_ROLE_TENANT,
      moose,
      orgId,
      rowPolicyOptions: buildRowPolicyOptionsFromClaims(
        ROW_POLICY_CONFIG,
        moose.jwt,
      ),
    };
  }

  if (isAdminDebugJwt(moose)) {
    return {
      kind: "admin",
      accessRole: ACCESS_ROLE_ADMIN_DEBUG,
      moose,
    };
  }

  return undefined;
}

export function assertAuthenticatedAccessContext(
  req: express.Request,
): AuthenticatedAccessContext {
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
