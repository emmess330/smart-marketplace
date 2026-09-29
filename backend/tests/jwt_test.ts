import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { generateTokens, verifyToken } from "../shared/jwt.ts";

Deno.test("access token verifies as an access token", async () => {
  const { accessToken } = await generateTokens("user-1", "buyer");
  const payload = await verifyToken(accessToken);
  assertEquals(payload.sub, "user-1");
  assertEquals(payload.role, "buyer");
});

Deno.test("refresh token is rejected where an access token is expected", async () => {
  const { refreshToken } = await generateTokens("user-1", "buyer");
  await assertRejects(() => verifyToken(refreshToken));
});

Deno.test("refresh token verifies only when a refresh token is expected", async () => {
  const { accessToken, refreshToken } = await generateTokens("user-1", "buyer");
  assertEquals((await verifyToken(refreshToken, "refresh")).sub, "user-1");
  await assertRejects(() => verifyToken(accessToken, "refresh"));
});

Deno.test("tokens issued in the same second are unique", async () => {
  const a = await generateTokens("user-1", "buyer");
  const b = await generateTokens("user-1", "buyer");
  assertNotEquals(a.accessToken, b.accessToken);
  assertNotEquals(a.refreshToken, b.refreshToken);
});

Deno.test("tampered token is rejected", async () => {
  const { accessToken } = await generateTokens("user-1", "buyer");
  const [header, payload, signature] = accessToken.split(".");
  const forged = btoa(JSON.stringify({ ...JSON.parse(atob(payload)), role: "seller" }))
    .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  await assertRejects(() => verifyToken(`${header}.${forged}.${signature}`));
});
