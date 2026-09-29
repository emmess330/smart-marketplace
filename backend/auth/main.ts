import { Hono } from "hono/mod.ts";
import { hash, compare } from "bcrypt";
import { z } from "zod";
import { isUniqueViolation, query, withTransaction } from "../shared/db.ts";
import { verifyToken } from "../shared/jwt.ts";
import { createSession } from "../shared/session.ts";
import { createSellerProfile, StoreNameTakenError } from "../shared/sellers.ts";
import { parseJsonBody } from "../shared/validation.ts";
import { clientIp, limitFromEnv, RateLimiter, tooManyRequests } from "../shared/rateLimit.ts";
import { corsConfig } from "../shared/cors.ts";

const app = new Hono();
app.use("*", corsConfig);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2),
  role: z.enum(["buyer", "seller"]).default("buyer"),
  // Sellers only; defaults to "<full_name>'s Store".
  store_name: z.string().min(2).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const MINUTE = 60_000;

// Failed logins per email + IP: the main brute-force guard. Keying on the IP
// too means someone elsewhere can't lock a user out of their own account.
const loginFailures = new RateLimiter(limitFromEnv("RATE_LIMIT_LOGIN_FAILURES", 5), 15 * MINUTE);
// Per-IP ceilings. Generous, because many users can share one address (NAT,
// a campus network).
const loginAttemptsPerIp = new RateLimiter(limitFromEnv("RATE_LIMIT_LOGIN_PER_IP", 100), 15 * MINUTE);
const registrationsPerIp = new RateLimiter(limitFromEnv("RATE_LIMIT_REGISTER_PER_IP", 20), 60 * MINUTE);
const refreshesPerIp = new RateLimiter(limitFromEnv("RATE_LIMIT_REFRESH_PER_IP", 60), MINUTE);

app.post("/auth/register", async (c) => {
  const ip = clientIp(c);
  const wait = registrationsPerIp.retryAfter(ip);
  if (wait) return tooManyRequests(c, wait);
  registrationsPerIp.hit(ip);

  try {
    const data = await parseJsonBody(c, registerSchema);

    const existing = await query(
      "SELECT id FROM users WHERE email = $1",
      [data.email]
    );
    if (existing.rows.length > 0) {
      return c.json({ error: "Email already registered" }, 409);
    }

    const passwordHash = await hash(data.password);

    // The user, their store (for sellers) and their session are created
    // together, so a seller can never end up without a store.
    const { user, seller, accessToken, refreshToken } = await withTransaction(
      async (tx) => {
        const result = await tx(
          `INSERT INTO users (email, password_hash, full_name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, full_name, role, created_at`,
          [data.email, passwordHash, data.full_name, data.role],
        );
        const user = result.rows[0] as Record<string, unknown>;

        const seller = data.role === "seller"
          ? await createSellerProfile(
            tx,
            user.id as string,
            data.store_name ?? `${data.full_name}'s Store`,
            null,
            data.store_name === undefined,
          )
          : null;

        const tokens = await createSession(
          user.id as string,
          user.role as string,
          tx,
        );
        return { user, seller, ...tokens };
      },
    );

    return c.json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      seller,
      accessToken,
      refreshToken,
    }, 201);

  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    if (err instanceof StoreNameTakenError) {
      return c.json({ error: err.message }, 409);
    }
    // Two registrations racing past the email check above.
    if (isUniqueViolation(err, "users_email_key")) {
      return c.json({ error: "Email already registered" }, 409);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/auth/login", async (c) => {
  const ip = clientIp(c);
  const ipWait = loginAttemptsPerIp.retryAfter(ip);
  if (ipWait) return tooManyRequests(c, ipWait);
  loginAttemptsPerIp.hit(ip);

  try {
    const data = await parseJsonBody(c, loginSchema);
    const failureKey = `${data.email.toLowerCase()}|${ip}`;
    const wait = loginFailures.retryAfter(failureKey);
    if (wait) return tooManyRequests(c, wait);

    const result = await query(
      "SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1 AND is_active = true",
      [data.email]
    );

    // Unknown emails count as failures too, so the limiter doesn't reveal
    // which emails have accounts.
    if (result.rows.length === 0) {
      loginFailures.hit(failureKey);
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const user = result.rows[0] as Record<string, unknown>;
    const validPassword = await compare(data.password, user.password_hash as string);

    if (!validPassword) {
      loginFailures.hit(failureKey);
      return c.json({ error: "Invalid credentials" }, 401);
    }
    loginFailures.reset(failureKey);

    const { accessToken, refreshToken } = await createSession(
      user.id as string,
      user.role as string,
    );

    return c.json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      accessToken,
      refreshToken,
    });

  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/auth/logout", async (c) => {
  try {
    // Logging out is best-effort: a missing or unreadable body just means
    // there is no session to delete.
    const body = await c.req.json().catch(() => ({}));
    const { refreshToken } = body as { refreshToken?: unknown };
    if (typeof refreshToken === "string" && refreshToken) {
      await query("DELETE FROM sessions WHERE refresh_token = $1", [refreshToken]);
    }
    return c.json({ message: "Logged out successfully" });
  } catch {
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /auth/refresh — exchange a refresh token for a new token pair.
// Rotation: the old refresh token is consumed, so each one works once.
// The new access token carries the user's current role from the database.
app.post("/auth/refresh", async (c) => {
  const ip = clientIp(c);
  const wait = refreshesPerIp.retryAfter(ip);
  if (wait) return tooManyRequests(c, wait);
  refreshesPerIp.hit(ip);

  try {
    const { refreshToken } = await parseJsonBody(c, refreshSchema);
    try {
      await verifyToken(refreshToken, "refresh");
    } catch {
      return c.json({ error: "Invalid or expired refresh token" }, 401);
    }

    const result = await withTransaction(async (tx) => {
      // Deleting the session claims it: of several concurrent refreshes with
      // the same token, only one gets a row back.
      const session = await tx(
        `DELETE FROM sessions
         WHERE refresh_token = $1 AND expires_at > NOW()
         RETURNING user_id`,
        [refreshToken],
      );
      if (session.rows.length === 0) return null;
      const userId = (session.rows[0] as { user_id: string }).user_id;

      const userResult = await tx(
        "SELECT id, email, full_name, role FROM users WHERE id = $1 AND is_active = true",
        [userId],
      );
      if (userResult.rows.length === 0) return null;
      const user = userResult.rows[0] as Record<string, unknown>;

      await tx("DELETE FROM sessions WHERE user_id = $1 AND expires_at <= NOW()", [userId]);
      const tokens = await createSession(userId, user.role as string, tx);
      return { user, ...tokens };
    });

    if (!result) {
      return c.json({ error: "Invalid or expired refresh token" }, 401);
    }
    return c.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/auth/me", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const payload = await verifyToken(authHeader.slice(7));
    const result = await query(
      "SELECT id, email, full_name, role FROM users WHERE id = $1",
      [payload.sub]
    );
    if (result.rows.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }
    return c.json({ user: result.rows[0] });
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});

const port = Number(Deno.env.get("SERVICE_PORT") ?? 8001);
console.log(`Auth service running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);