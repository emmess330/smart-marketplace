import { create, verify, getNumericDate } from "djwt/mod.ts";

const secret = Deno.env.get("JWT_SECRET") || "dev-secret-change-in-production";

async function getKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function generateTokens(userId: string, role: string) {
  const key = await getKey();

  const accessToken = await create(
    { alg: "HS256", typ: "JWT" },
    { sub: userId, role, exp: getNumericDate(60 * 60) },
    key
  );

  const refreshToken = await create(
    { alg: "HS256", typ: "JWT" },
    { sub: userId, role, exp: getNumericDate(60 * 60 * 24 * 7) },
    key
  );

  return { accessToken, refreshToken };
}

export async function verifyToken(token: string) {
  const key = await getKey();
  return await verify(token, key);
}