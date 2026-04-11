import { Hono } from "hono/mod.ts";
import { hash, compare } from "bcrypt";
import { z } from "zod";
import { query } from "../shared/db.ts";
import { generateTokens } from "../shared/jwt.ts";

const app = new Hono();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2),
  role: z.enum(["buyer", "seller"]).default("buyer"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /auth/register
app.post("/auth/register", async (c) => {
  try {
    const body = await c.req.json();
    const data = registerSchema.parse(body);

    // Check if email already exists
    const existing = await query(
      "SELECT id FROM users WHERE email = $1",
      [data.email]
    );
    if (existing.rows.length > 0) {
      return c.json({ error: "Email already registered" }, 409);
    }

    const passwordHash = await hash(data.password);

    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, created_at`,
      [data.email, passwordHash, data.full_name, data.role]
    );

    const user = result.rows[0] as Record<string, unknown>;
    const { accessToken, refreshToken } = await generateTokens(
      user.id as string,
      user.role as string
    );

    // Store refresh token
    await query(
      `INSERT INTO sessions (user_id, refresh_token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshToken]
    );

    return c.json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      accessToken,
      refreshToken,
    }, 201);

  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /auth/login
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

    const { accessToken, refreshToken } = await generateTokens(
      user.id as string,
      user.role as string
    );

    await query(
      `INSERT INTO sessions (user_id, refresh_token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshToken]
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

// POST /auth/logout
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

// GET /auth/me — protected route to verify token works
app.get("/auth/me", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const { verifyToken } = await import("../shared/jwt.ts");
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

console.log("Auth service running on http://localhost:8001");
Deno.serve({ port: 8001 }, app.fetch);