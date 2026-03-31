import {
  buildRowPolicyOptionsFromClaims,
  MOOSE_RLS_SETTING_PREFIX,
  type MooseUtils,
  type RowPolicyOptions,
} from "@514labs/moose-lib";
import type express from "express";
import { TENANT_ROW_POLICY_CONFIG } from "../../security/tenant-isolation";

const ROW_POLICY_CONFIG = Object.freeze({
  [`${MOOSE_RLS_SETTING_PREFIX}${TENANT_ROW_POLICY_CONFIG.column}`]:
    TENANT_ROW_POLICY_CONFIG.claim,
});

export type MooseRequest = express.Request & { moose?: MooseUtils };

export interface TenantMooseContext {
  moose: MooseUtils;
  tenantId: string;
  rowPolicyOptions: RowPolicyOptions;
}

export function getTenantMooseContext(
  req: express.Request,
): TenantMooseContext | undefined {
  const moose = (req as MooseRequest).moose;

  if (!moose?.jwt || typeof moose.jwt.tenant_id !== "string") {
    return undefined;
  }

  const tenantId = moose.jwt.tenant_id.trim();
  if (!tenantId) {
    return undefined;
  }

  const rowPolicyOptions = buildRowPolicyOptionsFromClaims(
    ROW_POLICY_CONFIG,
    moose.jwt,
  );

  return {
    moose,
    tenantId,
    rowPolicyOptions,
  };
}

export function assertTenantMooseContext(
  req: express.Request,
): TenantMooseContext {
  const context = getTenantMooseContext(req);

  if (!context) {
    throw new Error(
      "Tenant context missing after requireTenantMoose middleware.",
    );
  }

  return context;
}

export function respondUnauthorized(res: express.Response): express.Response {
  return res.status(401).json({
    error: "Unauthorized",
    details: "A valid OIDC-issued JWT with a tenant_id claim is required.",
  });
}

export function requireTenantMoose(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): express.Response | undefined {
  if (!getTenantMooseContext(req)) {
    return respondUnauthorized(res);
  }

  next();
}
