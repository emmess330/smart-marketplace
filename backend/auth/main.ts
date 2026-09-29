import { Hono } from "hono/mod.ts";
import { hash, compare } from "bcrypt";
import { z } from "zod";
import { isUniqueViolation, query, withTransaction } from "../shared/db.ts";
import { verifyToken } from "../shared/jwt.ts";
import { createSession } from "../shared/session.ts";
import { createSellerProfile, StoreNameTakenError } from "../shared/sellers.ts";
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

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

app.post("/auth/register", async (c) => {
  try {
    const body = await c.req.json();
    const data = registerSchema.parse(body);

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
  try {
    const body = await c.req.json();
    const data = loginSchema.parse(body);

    const result = await query(
      "SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1 AND is_active = true",
      [data.email]
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const user = result.rows[0] as Record<string, unknown>;
    const validPassword = await compare(data.password, user.password_hash as string);

    if (!validPassword) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

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
    const body = await c.req.json();
    const { refreshToken } = body;
    if (refreshToken) {
      await query("DELETE FROM sessions WHERE refresh_token = $1", [refreshToken]);
    }
    return c.json({ message: "Logged out successfully" });
  } catch {
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