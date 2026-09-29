import { Hono } from "hono/mod.ts";
import { z } from "zod";
import { isForeignKeyViolation, query } from "../shared/db.ts";
import { imageUrls } from "../shared/productImages.ts";
import { optionalUuid, paginationSchema, parseJsonBody, uuidParams } from "../shared/validation.ts";
import { authMiddleware, type AuthVariables } from "../shared/middleware.ts";
import { corsConfig } from "../shared/cors.ts";

const app = new Hono<{ Variables: AuthVariables }>();
app.use("*", corsConfig);

const ES_URL = Deno.env.get("ES_HOST") || "http://localhost:9200";
const SEARCH_INDEX = Deno.env.get("ES_INDEX") ?? "products";

const listQuerySchema = paginationSchema(20).extend({
  category: z.string().optional(),
  seller_id: optionalUuid,
});

const productSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  price: z.number().positive(),
  stock_quantity: z.number().int().min(0),
  category_id: z.string().uuid().optional(),
  images: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

async function esRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${ES_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Elasticsearch ${method} ${path} failed with ${res.status}`,
    );
  }
}

function normalizeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getSearchDocument(productId: string) {
  const result = await query(
    `SELECT p.id, p.name, p.description, p.price, p.stock_quantity,
            p.tags, p.images, p.is_active, p.created_at, p.seller_id,
            s.store_name, c.name as category_name
     FROM products p
     LEFT JOIN sellers s ON p.seller_id = s.id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.id = $1 AND p.is_active = true`,
    [productId],
  );

  if (result.rows.length === 0) return null;

  const product = result.rows[0] as Record<string, unknown>;
  return {
    id: product.id,
    name: product.name,
    description: product.description || "",
    price: Number(product.price),
    stock_quantity: Number(product.stock_quantity),
    category_name: product.category_name || "",
    store_name: product.store_name || "",
    seller_id: product.seller_id,
    tags: normalizeArray(product.tags),
    images: imageUrls(product.images),
    is_active: product.is_active,
    created_at: product.created_at,
  };
}

async function syncProductToSearch(productId: string) {
  try {
    const document = await getSearchDocument(productId);
    if (!document) {
      await esRequest("DELETE", `/${SEARCH_INDEX}/_doc/${productId}`);
      return;
    }

    await esRequest("PUT", `/${SEARCH_INDEX}/_doc/${productId}`, document);
  } catch (err) {
    console.warn(`Search sync skipped for product ${productId}:`, err);
  }
}

// GET /products — public, paginated list (with optional seller filter)
app.get("/products", async (c) => {
  try {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "Invalid query", details: parsed.error.errors }, 400);
    }
    const { page, limit, category, seller_id: sellerId } = parsed.data;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT p.*, s.store_name, c.name as category_name
      FROM products p
      LEFT JOIN sellers s ON p.seller_id = s.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = true
    `;
    const params: unknown[] = [];

    if (category) {
      params.push(category);
      sql += ` AND c.slug = $${params.length}`;
    }

    if (sellerId) {
      params.push(sellerId);
      sql += ` AND p.seller_id = $${params.length}`;
    }

    sql += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${
      params.length + 2
    }`;
    params.push(limit, offset);

    const result = await query(sql, params);

    let countSql = `
      SELECT COUNT(*) FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = true
    `;
    const countParams: unknown[] = [];
    if (category) {
      countParams.push(category);
      countSql += ` AND c.slug = $${countParams.length}`;
    }
    if (sellerId) {
      countParams.push(sellerId);
      countSql += ` AND p.seller_id = $${countParams.length}`;
    }
    const countResult = await query(countSql, countParams);
    const total = Number(
      (countResult.rows[0] as Record<string, unknown>).count,
    );

    return c.json({
      products: result.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /products/:id — public, single product
app.get("/products/:id", uuidParams("id"), async (c) => {
  try {
    const { id } = c.req.param();

    const result = await query(
      `SELECT p.*, s.store_name, c.name as category_name
   FROM products p
   LEFT JOIN sellers s ON p.seller_id = s.id
   LEFT JOIN categories c ON p.category_id = c.id
   WHERE p.id = $1 AND p.is_active = true`,
      [id],
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Product not found" }, 404);
    }

    return c.json({ product: result.rows[0] });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /products — protected, sellers only
app.post("/products", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const role = c.get("role");

    if (role !== "seller") {
      return c.json({ error: "Only sellers can create products" }, 403);
    }

    // Get seller record for this user
    const sellerResult = await query(
      "SELECT id FROM sellers WHERE user_id = $1",
      [userId],
    );

    if (sellerResult.rows.length === 0) {
      return c.json({ error: "Seller profile not found" }, 404);
    }

    const seller = sellerResult.rows[0] as Record<string, unknown>;
    const data = await parseJsonBody(c, productSchema);

    const result = await query(
      `INSERT INTO products (seller_id, category_id, name, description, price, stock_quantity, images, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        seller.id,
        data.category_id || null,
        data.name,
        data.description || null,
        data.price,
        data.stock_quantity,
        JSON.stringify(data.images),
        JSON.stringify(data.tags),
      ],
    );

    const product = result.rows[0] as Record<string, unknown>;
    await syncProductToSearch(String(product.id));

    return c.json({ product: result.rows[0] }, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    if (isForeignKeyViolation(err)) {
      return c.json({ error: "Unknown category_id" }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PUT /products/:id — protected, seller who owns it only
app.put("/products/:id", authMiddleware, uuidParams("id"), async (c) => {
  try {
    const { id } = c.req.param();
    const userId = c.get("userId");

    const sellerResult = await query(
      "SELECT id FROM sellers WHERE user_id = $1",
      [userId],
    );

    if (sellerResult.rows.length === 0) {
      return c.json({ error: "Seller profile not found" }, 404);
    }

    const seller = sellerResult.rows[0] as Record<string, unknown>;

    const existing = await query(
      "SELECT id FROM products WHERE id = $1 AND seller_id = $2",
      [id, seller.id],
    );

    if (existing.rows.length === 0) {
      return c.json({ error: "Product not found or not yours" }, 404);
    }

    const data = await parseJsonBody(c, productSchema.partial());

    const fields: string[] = [];
    const params: unknown[] = [];

    if (data.name !== undefined) {
      params.push(data.name);
      fields.push(`name = $${params.length}`);
    }
    if (data.description !== undefined) {
      params.push(data.description);
      fields.push(`description = $${params.length}`);
    }
    if (data.price !== undefined) {
      params.push(data.price);
      fields.push(`price = $${params.length}`);
    }
    if (data.stock_quantity !== undefined) {
      params.push(data.stock_quantity);
      fields.push(`stock_quantity = $${params.length}`);
    }
    if (data.category_id !== undefined) {
      params.push(data.category_id);
      fields.push(`category_id = $${params.length}`);
    }
    if (data.images !== undefined) {
      params.push(JSON.stringify(data.images));
      fields.push(`images = $${params.length}`);
    }
    if (data.tags !== undefined) {
      params.push(JSON.stringify(data.tags));
      fields.push(`tags = $${params.length}`);
    }

    if (fields.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    params.push(id);
    const result = await query(
      `UPDATE products SET ${
        fields.join(", ")
      } WHERE id = $${params.length} RETURNING *`,
      params,
    );

    await syncProductToSearch(id);

    return c.json({ product: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    if (isForeignKeyViolation(err)) {
      return c.json({ error: "Unknown category_id" }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /products/:id — protected, seller who owns it only
app.delete("/products/:id", authMiddleware, uuidParams("id"), async (c) => {
  try {
    const { id } = c.req.param();
    const userId = c.get("userId");

    const sellerResult = await query(
      "SELECT id FROM sellers WHERE user_id = $1",
      [userId],
    );

    if (sellerResult.rows.length === 0) {
      return c.json({ error: "Seller profile not found" }, 404);
    }

    const seller = sellerResult.rows[0] as Record<string, unknown>;

    // Soft delete — set is_active to false
    const result = await query(
      `UPDATE products SET is_active = false
       WHERE id = $1 AND seller_id = $2 RETURNING id`,
      [id, seller.id],
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Product not found or not yours" }, 404);
    }

    await syncProductToSearch(id);

    return c.json({ message: "Product deleted" });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /categories — public
app.get("/categories", async (c) => {
  try {
    const result = await query("SELECT * FROM categories ORDER BY name");
    return c.json({ categories: result.rows });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /seller/products – get products for authenticated seller
app.get("/seller/products", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const role = c.get("role");
    if (role !== "seller") {
      return c.json({ error: "Sellers only" }, 403);
    }
    const sellerResult = await query(
      "SELECT id FROM sellers WHERE user_id = $1",
      [userId],
    );
    if (sellerResult.rows.length === 0) {
      return c.json({ error: "Seller profile not found" }, 404);
    }
    const sellerId = (sellerResult.rows[0] as Record<string, unknown>).id;
    const result = await query(
      `SELECT p.*, c.name as category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.seller_id = $1 AND p.is_active = true
       ORDER BY p.created_at DESC`,
      [sellerId],
    );
    return c.json({ products: result.rows });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

const port = Number(Deno.env.get("SERVICE_PORT") ?? 8002);
console.log(`Products service running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
