import type { MooseUtils } from "@514labs/moose-lib";
import type express from "express";

export type MooseRequest = express.Request & { moose?: MooseUtils };

export interface TenantMooseContext {
  moose: MooseUtils;
  tenantId: string;
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

  return {
    moose,
    tenantId,
  };
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
