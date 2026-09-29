import { assert, assertEquals } from "@std/assert";
import { RateLimiter } from "../shared/rateLimit.ts";
import { Fixtures, serviceUrl, startServices, suiteOptions } from "./helpers.ts";

const AUTH = serviceUrl("auth");
const PASSWORD = "correct-horse-battery";

// sanitizeOps off: while this test sleeps, I/O started outside it (by the
// shared test process) can finish, which the op sanitizer misreports as a leak.
Deno.test({
  name: "RateLimiter blocks after max hits and unblocks when the window ends",
  sanitizeOps: false,
}, async () => {
  const limiter = new RateLimiter(2, 100);
  assertEquals(limiter.retryAfter("k"), 0);
  limiter.hit("k");
  limiter.hit("k");
  assert(limiter.retryAfter("k") > 0);
  assertEquals(limiter.retryAfter("other"), 0);
  await new Promise((r) => setTimeout(r, 120));
  assertEquals(limiter.retryAfter("k"), 0);
});

Deno.test("RateLimiter.reset clears a key", () => {
  const limiter = new RateLimiter(1, 60_000);
  limiter.hit("k");
  assert(limiter.retryAfter("k") > 0);
  limiter.reset("k");
  assertEquals(limiter.retryAfter("k"), 0);
});

Deno.test({ name: "auth rate limits", ...suiteOptions }, async (t) => {
  const services = await startServices(["auth"], {
    env: {
      RATE_LIMIT_LOGIN_FAILURES: "3",
      RATE_LIMIT_REGISTER_PER_IP: "3",
      RATE_LIMIT_REFRESH_PER_IP: "3",
    },
  });
  const fx = new Fixtures();
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${AUTH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, retryAfter: res.headers.get("Retry-After"), body: await res.json() };
  };
  const register = (name: string) =>
    post("/auth/register", { email: fx.email(name), password: PASSWORD, full_name: "Rate Limited" });
  const login = (email: string, password: string) => post("/auth/login", { email, password });

  try {
    // Two of the three registrations this IP is allowed.
    const alice = await register("alice");
    const bob = await register("bob");
    assertEquals([alice.status, bob.status], [201, 201]);

    await t.step("login: blocked after 3 failures, even with the right password", async () => {
      for (let i = 0; i < 3; i += 1) {
        assertEquals((await login(fx.email("alice"), "wrong-password")).status, 401);
      }
      const blocked = await login(fx.email("alice"), "wrong-password");
      assertEquals(blocked.status, 429);
      assert(Number(blocked.retryAfter) > 0, "Retry-After header");
      assertEquals((await login(fx.email("alice"), PASSWORD)).status, 429);
      // Changing the email's case doesn't get around it.
      assertEquals((await login(fx.email("alice").toUpperCase(), PASSWORD)).status, 429);
    });

    await t.step("login: limits are per account, and success resets the count", async () => {
      assertEquals((await login(fx.email("bob"), "wrong-password")).status, 401);
      assertEquals((await login(fx.email("bob"), PASSWORD)).status, 200);
      // Counter reset: two more failures stay below the limit.
      for (let i = 0; i < 2; i += 1) {
        assertEquals((await login(fx.email("bob"), "wrong-password")).status, 401);
      }
      assertEquals((await login(fx.email("bob"), PASSWORD)).status, 200);
    });

    await t.step("login: unknown emails are limited the same way", async () => {
      for (let i = 0; i < 3; i += 1) {
        assertEquals((await login(fx.email("nobody"), "whatever")).status, 401);
      }
      assertEquals((await login(fx.email("nobody"), "whatever")).status, 429);
    });

    await t.step("register: 3 per IP, then 429", async () => {
      assertEquals((await register("carol")).status, 201);
      const blocked = await register("dave");
      assertEquals(blocked.status, 429);
      assert(Number(blocked.retryAfter) > 0);
    });

    await t.step("refresh: 3 per IP per minute, then 429", async () => {
      let token = bob.body.refreshToken;
      for (let i = 0; i < 3; i += 1) {
        const res = await post("/auth/refresh", { refreshToken: token });
        assertEquals(res.status, 200);
        token = res.body.refreshToken;
      }
      assertEquals((await post("/auth/refresh", { refreshToken: token })).status, 429);
    });
  } finally {
    await fx.cleanup();
    await services.stop();
  }
});
