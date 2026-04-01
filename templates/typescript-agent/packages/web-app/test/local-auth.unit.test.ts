import { ACCESS_ROLE_ADMIN_DEBUG, ACCESS_ROLE_TENANT } from "agent-contracts";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalAccessProvider,
  getLocalMockPassword,
  getLocalMockUser,
} from "../src/dev/local-auth";

const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCz1giCZPtooM/5
5jY5iQQZDzdwyIWx9zllksKLlN4MajxN4WvLMEz61+HaXjBC+XOfHif8zEn3288+
Ou67joV/g1y0zG9p34majIv1yNp4FiMLAK6CHmWeQalrNzm7JGi2nMoRh+X/NqY5
npN5ERrxT2qc/VFCvhOYKJANuuMP2+qc7Z23v4k6qVLwcS/4ySeB1Zm54qvD8mao
vacjsQ51iPfJQsyKhe7HKSuT0M+hgDvyyvJMWohijX/2ySTM2edTjXqlL4u3hpor
gRE96KFXzWv6HaenuPV6UAk3VlN0kmr5+eYa+1ZaCIfZfcmZfT8AcYWCGsJ7vQbT
lNV7mVmBAgMBAAECggEAGUOtaFw1cap97VapMYYNPFQF7uNM3QalWp62lBNy6n2W
QT60/ROpDOh9Q0dOMmqHEsiSx5IPpjGMOOrglRrdqF9VC9VYpaAQ3dR26S2xe4No
ougSnBcXIZeJ7JUSmDbyOw1l2fakmikcSyX7A9wiU9pbWPjBjMXVTOAN9M/XjGeV
IW0GmrfySYGOXp5KQT6gOGvePlyPtNfK1bwcI0eRkXt7t1sGM67OO8ZQR7pKb52M
g6kcihUxID/6I8bBDaEGKFK6FVoe2tiq1qFjLFSuOBJN6BlQ8BFrLbBq/9w7rEHY
wOlXB/iTDKna3iuQ/Cqw+/iEaGVErIdtptwrUewq0QKBgQDyDHMzMSkY4lg7OPbc
ndGowGv9xzkSm5lK7S5aK8auKiDJpvSf2PbmH6vLpCmIninYOTm9+PrlTHtawoDw
6gH3DC/IScFwpZzyGbt9jJ2BStld4cJ3mwsaNCQCjeLUVvA2a4dEfOJMF/wZ45QD
zJ5LWpMZxj1nz9p1cJHXE063HQKBgQC+M5r5j7hcVzV8XZ8rsM3NeE+X043f9yzS
89am0rh/kt07w02aXUgiMNvTmn+02Fn5CBIoebI9XQ3TIYREHRCcaNGMbdTPuDMR
/3hI4Jf9lFIs5EyWzk2BbvH6XUl37a73q5zQIGcWg2usqPcA5Kcy26EvEN+Tnx6m
O4GATznKtQKBgQDppXb2bXf8W1FMKZqyL22Y9dXIrSy8d5KrrvPVevhYWrY3sX/l
ZSw/y0asVpT5GaPO4r6IUPTvrrpMTADnjRvEe/EL55ZgxJ0RXiGL+dZ4XeYhJ7Hu
fq1i5/3ysT/KNPm/rmBujhZr2aMy4mmYmUYb+xyP/rp7oTqBrt44vJx5SQKBgHhR
yO2qXyP6/xjHWNOYqvgZ7a/L4moVwMNKATXTA2egjlcp+0N1UxZd9hHsIHFUk8YX
tvTn1zs+TGqNP1CfWky3eiftqrwkeBoglAT2HvAJDdrcKR8VLq58cpLAxKMbNp3y
b+axOMVjKZA16tsjyilACrztXaHS/N6Hsipq89IpAoGAKND+C3aMOtlGkXRkL6wU
H2a1XmfPmZSsTStvoDvsEyLQz5LVQfqvobQSaAT5SLpjG8HpcznyBBJPbKkhURBm
23M4LQaz76TSdINCALfq3sYUG4Cn5er9R4EGT+SepSY7qEHbDB7g94XOW96LWf2w
DtgtOtWLI162YXWv/oHbs7M=
-----END PRIVATE KEY-----`;

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
    process.env.LOCAL_DEV_JWT_PRIVATE_KEY = TEST_PRIVATE_KEY.replaceAll(
      "\n",
      "\\n",
    );
    process.env.LOCAL_MOCK_PASSWORD_ORG_A_USER = "org-a-test-password";
    process.env.LOCAL_MOCK_PASSWORD_ORG_B_USER = "org-b-test-password";
    process.env.LOCAL_MOCK_PASSWORD_ADMIN = "admin-test-password";
  });

  afterEach(() => {
    delete process.env.LOCAL_DEV_JWT_PRIVATE_KEY;
    delete process.env.LOCAL_MOCK_PASSWORD_ORG_A_USER;
    delete process.env.LOCAL_MOCK_PASSWORD_ORG_B_USER;
    delete process.env.LOCAL_MOCK_PASSWORD_ADMIN;
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
      email: "admin@templae.com",
      password: "admin-test-password",
    });

    expect(user).toMatchObject({
      email: "admin@templae.com",
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
});
