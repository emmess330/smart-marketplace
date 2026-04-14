import { Hono } from "hono/mod.ts";
import { z } from "zod";
import { query } from "../shared/db.ts";
import { authMiddleware } from "../shared/middleware.ts";
import { corsConfig } from "../shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

const app = new Hono();
app.use("*", corsConfig);

const addToCartSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().positive(),
});

const checkoutSchema = z.object({
  shipping_address: z.object({
    full_name: z.string(),
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    country: z.string(),
    postal_code: z.string(),
  }),
  stripe_payment_id: z.string().optional(),
});

// ── CART ROUTES ──────────────────────────────────────────

// GET /cart — get current user's cart
app.get("/cart", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");

    const result = await query(
      `SELECT ci.id, ci.quantity, ci.created_at,
              p.id as product_id, p.name, p.price, p.images, p.stock_quantity,
              s.store_name
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       JOIN sellers s ON p.seller_id = s.id
       WHERE ci.user_id = $1 AND p.is_active = true
       ORDER BY ci.created_at DESC`,
      [userId]
    );

    const items = result.rows as Record<string, unknown>[];
    const total = items.reduce((sum, item) => {
      return sum + (Number(item.price) * Number(item.quantity));
    }, 0);

    return c.json({
      items,
      total: Math.round(total * 100) / 100,
      item_count: items.length,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /cart — add item to cart
app.post("/cart", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();
    const data = addToCartSchema.parse(body);

    // Check product exists and has stock
    const productResult = await query(
      "SELECT id, stock_quantity FROM products WHERE id = $1 AND is_active = true",
      [data.product_id]
    );

    if (productResult.rows.length === 0) {
      return c.json({ error: "Product not found" }, 404);
    }

    const product = productResult.rows[0] as Record<string, unknown>;
    if (Number(product.stock_quantity) < data.quantity) {
      return c.json({ error: "Insufficient stock" }, 400);
    }

    // Upsert — if already in cart, update quantity
    const result = await query(
      `INSERT INTO cart_items (user_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [userId, data.product_id, data.quantity]
    );

    return c.json({ cart_item: result.rows[0] }, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PUT /cart/:id — update quantity
app.put("/cart/:id", authMiddleware, async (c) => {
  try {
    const { id } = c.req.param();
    const userId = c.get("userId");
    const { quantity } = await c.req.json();

    if (!quantity || quantity < 1) {
      return c.json({ error: "Quantity must be at least 1" }, 400);
    }

    const result = await query(
      `UPDATE cart_items SET quantity = $1
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [quantity, id, userId]
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Cart item not found" }, 404);
    }

    return c.json({ cart_item: result.rows[0] });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /cart/:id — remove item from cart
app.delete("/cart/:id", authMiddleware, async (c) => {
  try {
    const { id } = c.req.param();
    const userId = c.get("userId");

    const result = await query(
      "DELETE FROM cart_items WHERE id = $1 AND user_id = $2 RETURNING id",
      [id, userId]
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Cart item not found" }, 404);
    }

    return c.json({ message: "Item removed from cart" });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /cart — clear entire cart
app.delete("/cart", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    await query("DELETE FROM cart_items WHERE user_id = $1", [userId]);
    return c.json({ message: "Cart cleared" });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ── ORDER ROUTES ─────────────────────────────────────────

// POST /orders/checkout — convert cart to order
app.post("/orders/checkout", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();
    const data = checkoutSchema.parse(body);

    // Get cart items
    const cartResult = await query(
      `SELECT ci.quantity, p.id as product_id, p.price, p.stock_quantity, p.name
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1 AND p.is_active = true`,
      [userId]
    );

    if (cartResult.rows.length === 0) {
      return c.json({ error: "Cart is empty" }, 400);
    }

    const cartItems = cartResult.rows as Record<string, unknown>[];

    // Verify stock for all items
    for (const item of cartItems) {
      if (Number(item.stock_quantity) < Number(item.quantity)) {
        return c.json({
          error: `Insufficient stock for ${item.name}`,
        }, 400);
      }
    }

    // Calculate total
    const total = cartItems.reduce((sum, item) => {
      return sum + (Number(item.price) * Number(item.quantity));
    }, 0);

    // Create order
    const orderResult = await query(
      `INSERT INTO orders (user_id, total_amount, shipping_address, stripe_payment_id, status)
       VALUES ($1, $2, $3, $4, 'confirmed')
       RETURNING *`,
      [
        userId,
        Math.round(total * 100) / 100,
        JSON.stringify(data.shipping_address),
        data.stripe_payment_id || null,
      ]
    );

    const order = orderResult.rows[0] as Record<string, unknown>;

    // Insert order items and decrement stock
    for (const item of cartItems) {
      await query(
        `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase)
         VALUES ($1, $2, $3, $4)`,
        [order.id, item.product_id, item.quantity, item.price]
      );

      await query(
        `UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    // Clear cart
    await query("DELETE FROM cart_items WHERE user_id = $1", [userId]);

    return c.json({ order, items: cartItems }, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.errors }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /orders — get current user's order history
app.get("/orders", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");

    const result = await query(
      `SELECT o.*, 
              json_agg(json_build_object(
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'price', oi.price_at_purchase,
                'name', p.name
              )) as items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [userId]
    );

    return c.json({ orders: result.rows });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /orders/:id — single order detail
app.get("/orders/:id", authMiddleware, async (c) => {
  try {
    const { id } = c.req.param();
    const userId = c.get("userId");

    const result = await query(
      `SELECT o.*,
              json_agg(json_build_object(
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'price', oi.price_at_purchase,
                'name', p.name,
                'images', p.images
              )) as items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE o.id = $1 AND o.user_id = $2
       GROUP BY o.id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return c.json({ error: "Order not found" }, 404);
    }

    return c.json({ order: result.rows[0] });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});


// GET /seller/analytics — seller sales overview
app.get("/seller/analytics", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const role = c.get("role");

    if (role !== "seller") {
      return c.json({ error: "Sellers only" }, 403);
    }

    const sellerResult = await query(
      "SELECT id FROM sellers WHERE user_id = $1",
      [userId]
    );

    if (sellerResult.rows.length === 0) {
      return c.json({ error: "Seller profile not found" }, 404);
    }

    const seller = sellerResult.rows[0] as Record<string, unknown>;
    const sellerId = seller.id;

    // Total revenue and orders
    const overviewResult = await query(
      `SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        COALESCE(SUM(oi.quantity * oi.price_at_purchase), 0) as total_revenue,
        COALESCE(SUM(oi.quantity), 0) as total_units_sold
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE p.seller_id = $1 AND o.status = 'confirmed'`,
      [sellerId]
    );

    // Daily revenue for last 30 days
    const dailyResult = await query(
      `SELECT 
        DATE(o.created_at) as date,
        COALESCE(SUM(oi.quantity * oi.price_at_purchase), 0) as revenue,
        COUNT(DISTINCT o.id) as orders
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE p.seller_id = $1 
         AND o.status = 'confirmed'
         AND o.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(o.created_at)
       ORDER BY date ASC`,
      [sellerId]
    );

    // Top products by revenue
    const topProductsResult = await query(
      `SELECT 
        p.id, p.name, p.price, p.stock_quantity,
        COALESCE(SUM(oi.quantity), 0) as units_sold,
        COALESCE(SUM(oi.quantity * oi.price_at_purchase), 0) as revenue
       FROM products p
       LEFT JOIN order_items oi ON p.id = oi.product_id
       LEFT JOIN orders o ON oi.order_id = o.id AND o.status = 'confirmed'
       WHERE p.seller_id = $1 AND p.is_active = true
       GROUP BY p.id, p.name, p.price, p.stock_quantity
       ORDER BY revenue DESC
       LIMIT 5`,
      [sellerId]
    );

    // Low stock alert
    const lowStockResult = await query(
      `SELECT id, name, stock_quantity
       FROM products
       WHERE seller_id = $1 AND is_active = true AND stock_quantity < 10
       ORDER BY stock_quantity ASC`,
      [sellerId]
    );

    const overview = overviewResult.rows[0] as Record<string, unknown>;

return c.json({
  overview: {
    total_orders: Number(overview.total_orders),
    total_revenue: Number(overview.total_revenue),
    total_units_sold: Number(overview.total_units_sold),
  },
  daily_revenue: (dailyResult.rows as Record<string, unknown>[]).map(row => ({
    date: row.date,
    revenue: Number(row.revenue),
    orders: Number(row.orders),
  })),
  top_products: (topProductsResult.rows as Record<string, unknown>[]).map(row => ({
    id: row.id,
    name: row.name,
    price: Number(row.price),
    stock_quantity: Number(row.stock_quantity),
    units_sold: Number(row.units_sold),
    revenue: Number(row.revenue),
  })),
  low_stock: lowStockResult.rows,
});
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});


app.post("/orders/create-payment-intent", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();
    const { amount } = body; // amount in cents

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("STRIPE_SECRET_KEY not set");
      return c.json({ error: "Payment not configured" }, 500);
    }

    const params = new URLSearchParams();
    params.append("amount", String(amount));
    params.append("currency", "gbp");
    params.append("metadata[user_id]", userId);

    const response = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Stripe error:", data);
      return c.json({ error: data.error?.message || "Payment failed" }, 400);
    }

    return c.json({ clientSecret: data.client_secret });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});
console.log("Orders service running on http://localhost:8003");
Deno.serve({ port: 8003 }, app.fetch);