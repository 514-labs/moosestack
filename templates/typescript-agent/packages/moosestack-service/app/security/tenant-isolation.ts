import { TENANT_ID_CLAIM } from "../auth/claims";

export const TENANT_ID_COLUMN = "tenant_id";
export { TENANT_ID_CLAIM };

export const TENANT_ROW_POLICY_CONFIG = Object.freeze({
  column: TENANT_ID_COLUMN,
  claim: TENANT_ID_CLAIM,
});
