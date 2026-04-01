import { generateKeyPairSync } from "node:crypto";
import { ACCESS_ROLE_ADMIN_DEBUG, ACCESS_ROLE_TENANT } from "agent-contracts";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalAccessProvider,
  getLocalMockPassword,
  getLocalMockUser,
  getVisibleLocalMockUsers,
} from "../src/dev/local-auth";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function getProviderAuthorize() {
  const provider = createLocalAccessProvider() as {
    options?: {
      authorize?: (
        credentials: Record<string, unknown>,
        request?: Request,
      ) => Promise<Record<string, unknown> | null>;
    };
  };

  return provider.options?.authorize;
}

describe("createLocalAccessProvider", () => {
  beforeEach(() => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    process.env.LOCAL_DEV_JWT_PRIVATE_KEY = privateKey
      .export({
        type: "pkcs8",
        format: "pem",
      })
      .toString()
      .replaceAll("\n", "\\n");
    process.env.LOCAL_MOCK_PASSWORD_ORG_A_USER = "org-a-test-password";
    process.env.LOCAL_MOCK_PASSWORD_ORG_B_USER = "org-b-test-password";
    process.env.LOCAL_MOCK_PASSWORD_ADMIN = "admin-test-password";
  });

  afterEach(() => {
    delete process.env.LOCAL_DEV_JWT_PRIVATE_KEY;
    delete process.env.LOCAL_MOCK_PASSWORD_ORG_A_USER;
    delete process.env.LOCAL_MOCK_PASSWORD_ORG_B_USER;
    delete process.env.LOCAL_MOCK_PASSWORD_ADMIN;
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("issues organization-scoped local sessions for seeded org users", async () => {
    const authorize = getProviderAuthorize();

    const user = await authorize?.({
      email: "user1@orgA.com",
      password: "org-a-test-password",
    });

    expect(user).toMatchObject({
      email: "user1@orgA.com",
      orgId: "org_a",
      orgName: "Org A",
      accessRole: ACCESS_ROLE_TENANT,
      provider: "local",
    });

    const claims = decodeJwt(String(user?.idToken));
    expect(claims.org_id).toBe("org_a");
    expect(claims.access_role).toBe(ACCESS_ROLE_TENANT);
  });

  it("issues local admin sessions without organization scoping", async () => {
    const authorize = getProviderAuthorize();

    const user = await authorize?.({
      email: "admin@template.com",
      password: "admin-test-password",
    });

    expect(user).toMatchObject({
      email: "admin@template.com",
      accessRole: ACCESS_ROLE_ADMIN_DEBUG,
      provider: "local",
    });
    expect(user?.orgId).toBeUndefined();
    expect(user?.orgName).toBeUndefined();

    const claims = decodeJwt(String(user?.idToken));
    expect(claims.org_id).toBeUndefined();
    expect(claims.access_role).toBe(ACCESS_ROLE_ADMIN_DEBUG);
  });

  it("rejects invalid local passwords", async () => {
    const authorize = getProviderAuthorize();

    const user = await authorize?.({
      email: "user2@orgB.com",
      password: "wrong-password",
    });

    expect(user).toBeNull();
  });

  it("disables admin debug sign-in outside local development", async () => {
    process.env.NODE_ENV = "production";
    const authorize = getProviderAuthorize();

    const user = await authorize?.({
      email: "admin@template.com",
      password: "admin-test-password",
    });

    expect(user).toBeNull();
  });
});

describe("local mock user helpers", () => {
  it("reads the generated password from the configured env var", () => {
    process.env.LOCAL_MOCK_PASSWORD_ORG_A_USER = "org-a-test-password";
    const orgAUser = getLocalMockUser("user1@orgA.com");

    expect(orgAUser).toBeDefined();
    expect(getLocalMockPassword(orgAUser!)).toBe("org-a-test-password");
  });

  it("looks up mock users case-insensitively", () => {
    expect(getLocalMockUser("USER2@ORGB.COM")).toMatchObject({
      email: "user2@orgB.com",
      orgId: "org_b",
      passwordEnvVar: "LOCAL_MOCK_PASSWORD_ORG_B_USER",
    });
  });

  it("hides the admin debug account outside local development", () => {
    process.env.NODE_ENV = "production";

    expect(getLocalMockUser("admin@template.com")).toBeUndefined();
    expect(
      getVisibleLocalMockUsers().some((mockUser) => mockUser.email === "admin@template.com"),
    ).toBe(false);
  });
});
