import { ORG_ID_CLAIM } from "../auth/claims";

export const ORG_ID_COLUMN = "org_id";
export { ORG_ID_CLAIM };

export const ORG_ROW_POLICY_CONFIG = Object.freeze({
  column: ORG_ID_COLUMN,
  claim: ORG_ID_CLAIM,
});
