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
import { ACCESS_ROLE_CLAIM, TENANT_ID_CLAIM } from "./claims";
import { TENANT_ROW_POLICY_CONFIG } from "../security/tenant-isolation";

const ROW_POLICY_CONFIG = Object.freeze({
  [`${MOOSE_RLS_SETTING_PREFIX}${TENANT_ROW_POLICY_CONFIG.column}`]:
    TENANT_ROW_POLICY_CONFIG.claim,
});

export type MooseRequest = express.Request & { moose?: MooseUtils };

interface BaseAccessContext {
  moose: MooseUtils;
  accessRole: AccessRole;
  rowPolicyOptions?: RowPolicyOptions;
}

export interface TenantAccessContext extends BaseAccessContext {
  kind: "tenant";
  accessRole: typeof ACCESS_ROLE_TENANT;
  tenantId: string;
  rowPolicyOptions: RowPolicyOptions;
}

export interface AdminDebugAccessContext extends BaseAccessContext {
  kind: "admin";
  accessRole: typeof ACCESS_ROLE_ADMIN_DEBUG;
}

export type AuthenticatedAccessContext =
  | TenantAccessContext
  | AdminDebugAccessContext;

function getTenantIdFromJwt(moose: MooseUtils): string | undefined {
  const tenantIdValue = moose.jwt?.[TENANT_ID_CLAIM];

  if (typeof tenantIdValue !== "string") {
    return undefined;
  }

  const tenantId = tenantIdValue.trim();
  return tenantId.length > 0 ? tenantId : undefined;
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

  const tenantId = getTenantIdFromJwt(moose);
  if (tenantId) {
    return {
      kind: "tenant",
      accessRole: ACCESS_ROLE_TENANT,
      moose,
      tenantId,
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
      "A valid JWT is required. Use a tenant-scoped token with tenant_id, or use the local Admin Debug identity.",
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

export function isTenantAccessContext(
  context: AuthenticatedAccessContext,
): context is TenantAccessContext {
  return context.kind === "tenant";
}
