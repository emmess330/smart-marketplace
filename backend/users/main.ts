import { Hono } from "hono/mod.ts";
import { z } from "zod";
import { isUniqueViolation, query, withTransaction } from "../shared/db.ts";
import { createSession } from "../shared/session.ts";
import { createSellerProfile, StoreNameTakenError } from "../shared/sellers.ts";
import { authMiddleware, type AuthVariables } from "../shared/middleware.ts";
import { parseJsonBody, uuidParams } from "../shared/validation.ts";
import { corsConfig } from "../shared/cors.ts";

const app = new Hono<{ Variables: AuthVariables }>();
app.use("*", corsConfig);
const updateProfileSchema = z.object({
  full_name: z.string().min(2).optional(),
  email: z.string().email().optional(),
});

const sellerProfileSchema = z.object({
  store_name: z.string().min(2),
  store_description: z.string().optional(),
});

// GET /users/me — get own full profile
app.get("/users/me", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");

    const userResult = await query(
      "SELECT id, email, full_name, role, is_active, created_at FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }

    const user = userResult.rows[0] as Record<string, unknown>;

    // If seller, include store info
    let seller = null;
    if (user.role === "seller") {
      const sellerResult = await query(
        "SELECT id, store_name, store_description, is_verified, created_at FROM sellers WHERE user_id = $1",
        [userId]
      );
      if (sellerResult.rows.length > 0) {
        seller = sellerResult.rows[0];
      }
    }

    return c.json({ user, seller });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PUT /users/me — update own profile
app.put("/users/me", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const data = await parseJsonBody(c, updateProfileSchema);

    const fields: string[] = [];
    const params: unknown[] = [];

    if (data.full_name) { params.push(data.full_name); fields.push(`full_name = $${params.length}`); }
    if (data.email) {
      // Check email not taken by someone else
      const existing = await query(
        "SELECT id FROM users WHERE email = $1 AND id != $2",
        [data.email, userId]
      );
      if (existing.rows.length > 0) {
        return c.json({ error: "Email already in use" }, 409);
      }
      params.push(data.email);
      fields.push(`email = $${params.length}`);
    }

    if (fields.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    params.push(userId);
    const result = await query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${params.length}
       RETURNING id, email, full_name, role`,
      params
    );

    return c.json({ user: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

class SellerExistsError extends Error {}

// POST /users/seller — create seller profile for existing user
app.post("/users/seller", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const data = await parseJsonBody(c, sellerProfileSchema);

    const { seller, accessToken, refreshToken } = await withTransaction(
      async (tx) => {
        const existing = await tx(
          "SELECT id FROM sellers WHERE user_id = $1",
          [userId],
        );
        if (existing.rows.length > 0) {
          throw new SellerExistsError();
        }

        const seller = await createSellerProfile(
          tx,
          userId,
          data.store_name,
          data.store_description || null,
        );

        // The caller's current token still says "buyer"; issue a fresh pair
        // so seller-only endpoints work without logging in again.
        const tokens = await createSession(userId, "seller", tx);
        return { seller, ...tokens };
      },
    );

    return c.json({ seller, accessToken, refreshToken }, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    if (err instanceof StoreNameTakenError) {
      return c.json({ error: err.message }, 409);
    }
    // SellerExistsError, or a concurrent request winning the
    // sellers_user_id_unique race.
    if (
      err instanceof SellerExistsError ||
      isUniqueViolation(err, "sellers_user_id_unique")
    ) {
      return c.json({ error: "Seller profile already exists" }, 409);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PUT /users/seller — update seller profile
app.put("/users/seller", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const data = await parseJsonBody(c, sellerProfileSchema.partial());

    const fields: string[] = [];
    const params: unknown[] = [];

    if (data.store_name) { params.push(data.store_name); fields.push(`store_name = $${params.length}`); }
    if (data.store_description) { params.push(data.store_description); fields.push(`store_description = $${params.length}`); }

    if (fields.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    params.push(userId);
    const result = await query(
      `UPDATE sellers SET ${fields.join(", ")} WHERE user_id = $${params.length} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Seller profile not found" }, 404);
    }

    return c.json({ seller: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    if (isUniqueViolation(err, "sellers_store_name_key")) {
      return c.json({ error: "Store name already taken" }, 409);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /users/sellers/:id — public seller profile
app.get("/users/sellers/:id", uuidParams("id"), async (c) => {
  try {
    const { id } = c.req.param();

    const result = await query(
      `SELECT s.id, s.store_name, s.store_description, s.is_verified, s.created_at,
              COUNT(p.id) as product_count
       FROM sellers s
       LEFT JOIN products p ON s.id = p.seller_id AND p.is_active = true
       WHERE s.id = $1
       GROUP BY s.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Seller not found" }, 404);
    }

    return c.json({ seller: result.rows[0] });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

const port = Number(Deno.env.get("SERVICE_PORT") ?? 8004);
console.log(`Users service running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);