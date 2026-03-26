import { importPKCS8, SignJWT } from "jose";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const LOCAL_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
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

const localTenantSchema = z.object({
  tenantId: z.string().min(1),
});

export const LOCAL_TENANTS = [
  {
    id: "acme",
    name: "ACME Fleet",
    email: "ops@acme.example",
    description: "Brake alerts and support volumes rising in the north-east.",
  },
  {
    id: "globex",
    name: "Globex Mobility",
    email: "control@globex.example",
    description:
      "Seattle hub is close to capacity with healthy battery trends.",
  },
] as const;

export type LocalTenant = (typeof LOCAL_TENANTS)[number];

let localPrivateKeyPromise: Promise<CryptoKey> | undefined;

function getLocalPrivateKey(): Promise<CryptoKey> {
  if (!localPrivateKeyPromise) {
    localPrivateKeyPromise = importPKCS8(LOCAL_PRIVATE_KEY, "RS256");
  }

  return localPrivateKeyPromise;
}

function getLocalTenant(tenantId: string): LocalTenant | undefined {
  return LOCAL_TENANTS.find((tenant) => tenant.id === tenantId);
}

async function issueLocalTenantToken(tenant: LocalTenant): Promise<string> {
  const privateKey = await getLocalPrivateKey();

  return await new SignJWT({
    tenant_id: tenant.id,
    email: tenant.email,
    name: tenant.name,
    scope: "agent:query",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("typescript-agent-local")
    .setAudience("typescript-agent")
    .setSubject(`local-${tenant.id}`)
    .setExpirationTime("1h")
    .sign(privateKey);
}

export function createLocalTenantProvider() {
  return Credentials({
    id: "local-tenant",
    name: "Local tenant",
    credentials: {
      tenantId: { label: "Tenant", type: "text" },
    },
    async authorize(credentials) {
      const parsed = localTenantSchema.safeParse(credentials);
      if (!parsed.success) {
        return null;
      }

      const tenant = getLocalTenant(parsed.data.tenantId);
      if (!tenant) {
        return null;
      }

      return {
        id: `local-${tenant.id}`,
        name: tenant.name,
        email: tenant.email,
        tenantId: tenant.id,
        tenantName: tenant.name,
        provider: "local",
        idToken: await issueLocalTenantToken(tenant),
      };
    },
  });
}
