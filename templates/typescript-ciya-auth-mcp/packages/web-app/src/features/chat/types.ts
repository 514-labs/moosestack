export interface UserContext {
  userId?: string;
  email?: string;
  name?: string;
  orgId?: string;
}

export interface AgentOptions {
  token?: string;
  userContext?: UserContext;
}
