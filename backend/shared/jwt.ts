import { create, verify, getNumericDate } from "djwt/mod.ts";

const secret = Deno.env.get("JWT_SECRET");
if (!secret || secret === "your-super-secret-key-change-this") {
  throw new Error(
    "JWT_SECRET is not set (or is still the .env.example placeholder). " +
      "Set a real random value in backend/.env before starting this service.",
  );
}

async function getKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export type TokenType = "access" | "refresh";

export async function generateTokens(userId: string, role: string) {
  const key = await getKey();

  // `token_type` stops a long-lived refresh token being accepted where an
  // access token is expected (both share the same key and claims otherwise).
  // `jti` makes every token unique, so two logins in the same second don't
  // collide on sessions.refresh_token's UNIQUE constraint.
  const accessToken = await create(
    { alg: "HS256", typ: "JWT" },
    {
      sub: userId,
      role,
      token_type: "access",
      jti: crypto.randomUUID(),
      exp: getNumericDate(60 * 60),
    },
    key
  );

  const refreshToken = await create(
    { alg: "HS256", typ: "JWT" },
    {
      sub: userId,
      role,
      token_type: "refresh",
      jti: crypto.randomUUID(),
      exp: getNumericDate(60 * 60 * 24 * 7),
    },
    key
  );

  return { accessToken, refreshToken };
}

export async function verifyToken(token: string, expectedType: TokenType = "access") {
  const key = await getKey();
  const payload = await verify(token, key);
  if (payload.token_type !== expectedType) {
    throw new Error(`Expected a ${expectedType} token`);
  }
  return payload;
}