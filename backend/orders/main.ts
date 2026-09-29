import { Hono } from "hono/mod.ts";
import { z } from "zod";
import { query, type TxQuery, withTransaction } from "../shared/db.ts";
import { authMiddleware, type AuthVariables } from "../shared/middleware.ts";
import { corsConfig } from "../shared/cors.ts";

const app = new Hono<{ Variables: AuthVariables }>();
app.use("*", corsConfig);

type StripePaymentIntent = {
  id: string;
  object: string;
  amount?: number;
  currency?: string;
  status: string;
  metadata?: Record<string, string>;
  latest_charge?: { amount_refunded?: number } | string | null;
};

type StripeWebhookEvent = {
  id: string;
  type: string;
  data?: {
    object?: unknown;
  };
};

const WEBHOOK_TOLERANCE_SECONDS = 300;

function getStripeSecretKey() {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey || stripeSecretKey.includes("your_key")) {
    return null;
  }

  return stripeSecretKey;
}

function paymentIntentStatusToOrderStatus(status: string) {
  switch (status) {
    case "succeeded":
      return "confirmed";
    case "processing":
      return "processing";
    case "requires_payment_method":
      return "payment_failed";
    case "canceled":
      return "cancelled";
    case "requires_action":
    case "requires_capture":
    case "requires_confirmation":
      return "pending";
    default:
      return "pending";
  }
}

function timingSafeEqual(a: string, b: string) {
  const maxLength = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;

  for (let i = 0; i < maxLength; i += 1) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return mismatch === 0;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string,
  endpointSecret: string,
) {
  const parts = signatureHeader.split(",");
  const timestamp = parts
    .map((part) => part.split("="))
    .find(([key]) => key === "t")?.[1];
  const signatures = parts
    .map((part) => part.split("="))
    .filter(([key]) => key === "v1")
    .map(([, value]) => value);

  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid Stripe-Signature header");
  }

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS
  ) {
    throw new Error("Stripe webhook timestamp is outside tolerance");
  }

  const expectedSignature = await hmacSha256Hex(
    endpointSecret,
    `${timestamp}.${payload}`,
  );

  if (
    !signatures.some((signature) =>
      timingSafeEqual(signature, expectedSignature)
    )
  ) {
    throw new Error("Stripe webhook signature verification failed");
  }
}

async function fetchPaymentIntent(paymentIntentId: string) {
  const stripeSecretKey = getStripeSecretKey();
  if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY not set or placeholder");
  }

  // Expand latest_charge so callers can see refunds: a refunded payment
  // intent keeps status "succeeded".
  const response = await fetch(
    `https://api.stripe.com/v1/payment_intents/${
      encodeURIComponent(paymentIntentId)
    }?expand[]=latest_charge`,
    {
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
      },
    },
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || "Unable to read Stripe payment intent",
    );
  }

  return data as StripePaymentIntent;
}

function amountRefunded(paymentIntent: StripePaymentIntent) {
  const charge = paymentIntent.latest_charge;
  return charge && typeof charge === "object"
    ? Number(charge.amount_refunded || 0)
    : 0;
}

// Fully refunds a payment intent. The idempotency key makes retries (and
// concurrent failed checkouts for the same payment) refund at most once.
async function refundPaymentIntent(paymentIntentId: string) {
  const stripeSecretKey = getStripeSecretKey();
  if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY not set or placeholder");
  }

  const params = new URLSearchParams();
  params.append("payment_intent", paymentIntentId);
  params.append("metadata[reason]", "checkout_failed");

  const response = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `checkout-refund-${paymentIntentId}`,
    },
    body: params,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Unable to refund payment intent");
  }

  return data as { id: string; status: string };
}

async function updateOrderStatusFromPaymentIntent(
  paymentIntent: StripePaymentIntent,
) {
  const orderStatus = paymentIntentStatusToOrderStatus(paymentIntent.status);
  const result = await query(
    `UPDATE orders
     SET status = $1
     WHERE stripe_payment_id = $2 AND status IS DISTINCT FROM $1
     RETURNING id, status`,
    [orderStatus, paymentIntent.id],
  );

  return {
    orderStatus,
    updatedOrders: result.rows,
  };
}

const addToCartSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().positive(),
});

const shippingAddressSchema = z.object({
  full_name: z.string().trim().min(2).max(255),
  line1: z.string().trim().min(1).max(255),
  line2: z.string().trim().max(255).optional(),
  city: z.string().trim().min(1).max(100),
  country: z.string().trim().length(2).toUpperCase(), // ISO 3166-1 alpha-2
  postal_code: z.string().trim().min(2).max(20),
});
type ShippingAddress = z.infer<typeof shippingAddressSchema>;

const createPaymentIntentSchema = z.object({
  shipping_address: shippingAddressSchema,
});

// The shipping address is not accepted here: it was validated when the
// payment intent was created and is read back from the intent's metadata,
// so it can't be rejected (or changed) after the customer has paid.
const checkoutSchema = z.object({
  stripe_payment_id: z.string(),
});

// Stored as one metadata key per field (Stripe caps each value at 500 chars).
const SHIPPING_METADATA_PREFIX = "ship_";

function shippingAddressFromMetadata(metadata: Record<string, string> = {}) {
  const fields = Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => key.startsWith(SHIPPING_METADATA_PREFIX))
      .map(([key, value]) => [key.slice(SHIPPING_METADATA_PREFIX.length), value]),
  );
  return shippingAddressSchema.safeParse(fields);
}

type CartCheckoutItem = Record<string, unknown>;

// With `lockProducts`, the product rows are locked (FOR UPDATE) until the
// surrounding transaction ends, so concurrent checkouts can't both pass the
// stock check. Ordering by product id keeps lock acquisition deadlock-free.
async function getCheckoutCartItems(
  userId: string,
  run: TxQuery = query,
  lockProducts = false,
) {
  const cartResult = await run(
    `SELECT ci.quantity, p.id as product_id, p.price, p.stock_quantity, p.name
     FROM cart_items ci
     JOIN products p ON ci.product_id = p.id
     WHERE ci.user_id = $1 AND p.is_active = true
     ORDER BY p.id${lockProducts ? " FOR UPDATE OF p" : ""}`,
    [userId],
  );

  return cartResult.rows as CartCheckoutItem[];
}

// Thrown inside the checkout transaction to roll back and return a 4xx.
// `refundable` marks failures where the customer has paid but no order can
// be created, so the payment must be returned.
class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
    readonly refundable = false,
  ) {
    super(message);
  }
}

function calculateCartTotal(cartItems: CartCheckoutItem[]) {
  const total = cartItems.reduce((sum, item) => {
    return sum + (Number(item.price) * Number(item.quantity));
  }, 0);

  return Math.round(total * 100) / 100;
}

// POST /orders/stripe/webhook — Stripe webhook for payment status changes
app.post("/orders/stripe/webhook", async (c) => {
  try {
    const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!endpointSecret || endpointSecret.includes("your_key")) {
      console.error("STRIPE_WEBHOOK_SECRET not set or placeholder");
      return c.json({ error: "Stripe webhook not configured" }, 500);
    }

    const signature = c.req.header("stripe-signature");
    if (!signature) {
      return c.json({ error: "Missing Stripe-Signature header" }, 400);
    }

    const payload = await c.req.text();
    await verifyStripeWebhookSignature(payload, signature, endpointSecret);

    const event = JSON.parse(payload) as StripeWebhookEvent;
    const stripeObject = event.data?.object as StripePaymentIntent | undefined;

    if (
      !event.type.startsWith("payment_intent.") ||
      stripeObject?.object !== "payment_intent" ||
      !stripeObject.id
    ) {
      return c.json({ received: true, ignored: true });
    }

    const { orderStatus, updatedOrders } =
      await updateOrderStatusFromPaymentIntent(
        stripeObject,
      );

    if (updatedOrders.length === 0) {
      console.warn(
        `No order found for Stripe payment intent ${stripeObject.id}`,
      );
    }

    return c.json({
      received: true,
      payment_intent: stripeObject.id,
      payment_status: stripeObject.status,
      order_status: orderStatus,
      updated_orders: updatedOrders.length,
    });
  } catch (err) {
    console.error("Stripe webhook error:", err);
    return c.json({ error: "Invalid Stripe webhook" }, 400);
  }
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
      [userId],
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
      `SELECT p.id, p.name, p.stock_quantity, COALESCE(ci.quantity, 0) as cart_quantity
       FROM products p
       LEFT JOIN cart_items ci ON ci.product_id = p.id AND ci.user_id = $2
       WHERE p.id = $1 AND p.is_active = true`,
      [data.product_id, userId],
    );

    if (productResult.rows.length === 0) {
      return c.json({ error: "Product not found" }, 404);
    }

    const product = productResult.rows[0] as Record<string, unknown>;
    const nextQuantity = Number(product.cart_quantity) + data.quantity;
    if (Number(product.stock_quantity) < nextQuantity) {
      return c.json({
        error: `Insufficient stock for ${product.name}`,
        available: Number(product.stock_quantity),
      }, 400);
    }

    // Upsert — if already in cart, update quantity
    const result = await query(
      `INSERT INTO cart_items (user_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [userId, data.product_id, data.quantity],
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

    const cartItemResult = await query(
      `SELECT ci.id, p.name, p.stock_quantity
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.id = $1 AND ci.user_id = $2 AND p.is_active = true`,
      [id, userId],
    );

    if (cartItemResult.rows.length === 0) {
      return c.json({ error: "Cart item not found" }, 404);
    }

    const cartItem = cartItemResult.rows[0] as Record<string, unknown>;
    if (quantity > Number(cartItem.stock_quantity)) {
      return c.json({
        error: `Insufficient stock for ${cartItem.name}`,
        available: Number(cartItem.stock_quantity),
      }, 400);
    }

    const result = await query(
      `UPDATE cart_items SET quantity = $1
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [quantity, id, userId],
    );

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
      [id, userId],
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

    // Verify the payment itself first. Cart and stock checks happen inside
    // the transaction below, where a mismatch triggers a refund — checking
    // them here would reject a paid checkout without returning the money.
    const paymentIntent = await fetchPaymentIntent(data.stripe_payment_id);

    if (paymentIntent.metadata?.user_id !== String(userId)) {
      return c.json(
        { error: "Payment intent does not belong to this user" },
        403,
      );
    }

    if (paymentIntent.currency?.toLowerCase() !== "gbp") {
      return c.json({ error: "Payment intent currency is not GBP" }, 400);
    }

    if (paymentIntent.status !== "succeeded") {
      return c.json(
        {
          error: "Payment has not succeeded",
          payment_status: paymentIntent.status,
        },
        402,
      );
    }

    if (amountRefunded(paymentIntent) > 0) {
      return c.json({ error: "This payment has been refunded" }, 409);
    }

    const orderStatus = paymentIntentStatusToOrderStatus(paymentIntent.status);

    // Everything below runs in one transaction: either the order, its items,
    // the stock decrements and the cart clear all happen, or none do.
    let result: { order: Record<string, unknown>; items: CartCheckoutItem[] };
    try {
      result = await withTransaction(async (tx) => {
        // Serialise checkouts for the same payment, so a request that loses a
        // race sees the winner's order below instead of refunding it.
        await tx("SELECT pg_advisory_xact_lock(hashtext($1))", [
          data.stripe_payment_id,
        ]);

        const alreadyUsed = await tx(
          "SELECT id FROM orders WHERE stripe_payment_id = $1",
          [data.stripe_payment_id],
        );
        if (alreadyUsed.rows.length > 0) {
          throw new CheckoutError(
            "This payment has already been applied to an order",
            409,
          );
        }

        const shipping = shippingAddressFromMetadata(paymentIntent.metadata);
        if (!shipping.success) {
          throw new CheckoutError(
            "Payment has no valid shipping address",
            400,
            true,
          );
        }
        const shippingAddress: ShippingAddress = shipping.data;

        // Re-read the cart with product rows locked. The cart or stock may have
        // changed since the payment intent was created.
        const lockedItems = await getCheckoutCartItems(userId, tx, true);
        if (lockedItems.length === 0) {
          throw new CheckoutError("Cart is empty", 409, true);
        }
        for (const item of lockedItems) {
          if (Number(item.stock_quantity) < Number(item.quantity)) {
            throw new CheckoutError(
              `Insufficient stock for ${item.name}`,
              409,
              true,
            );
          }
        }
        const lockedTotal = calculateCartTotal(lockedItems);
        if (Math.round(lockedTotal * 100) !== paymentIntent.amount) {
          throw new CheckoutError(
            "Cart changed during checkout and no longer matches the payment",
            409,
            true,
          );
        }

        const orderResult = await tx(
          `INSERT INTO orders (user_id, total_amount, shipping_address, stripe_payment_id, status)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            userId,
            lockedTotal,
            JSON.stringify(shippingAddress),
            data.stripe_payment_id,
            orderStatus,
          ],
        );
        const order = orderResult.rows[0] as Record<string, unknown>;

        for (const item of lockedItems) {
          await tx(
            `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase)
             VALUES ($1, $2, $3, $4)`,
            [order.id, item.product_id, item.quantity, item.price],
          );

          await tx(
            `UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2`,
            [item.quantity, item.product_id],
          );
        }

        await tx("DELETE FROM cart_items WHERE user_id = $1", [userId]);

        return { order, items: lockedItems };
      });
    } catch (err) {
      if (err instanceof CheckoutError) {
        if (!err.refundable) {
          return c.json({ error: err.message }, err.status);
        }
        try {
          const refund = await refundPaymentIntent(data.stripe_payment_id);
          return c.json({
            error: err.message,
            refunded: true,
            refund_status: refund.status,
          }, err.status);
        } catch (refundErr) {
          // Money taken, no order, refund failed: needs manual follow-up.
          console.error(
            `REFUND FAILED for payment intent ${data.stripe_payment_id} ` +
              `(user ${userId}, reason: ${err.message}):`,
            refundErr,
          );
          return c.json({
            error: `${err.message}. Your payment could not be refunded ` +
              "automatically; please contact support.",
            refunded: false,
          }, 502);
        }
      }
      // Unique constraint on stripe_payment_id is the authoritative guard
      // backstop behind the advisory lock + lookup in the transaction.
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
        return c.json(
          { error: "This payment has already been applied to an order" },
          409,
        );
      }
      throw err;
    }

    return c.json(result, 201);
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
      [userId],
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
      [id, userId],
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
      [userId],
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
      [sellerId],
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
      [sellerId],
    );

    // Top products by revenue
    const topProductsResult = await query(
      `SELECT 
        p.id, p.name, p.price, p.stock_quantity,
        COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'confirmed'), 0) as units_sold,
        COALESCE(SUM(oi.quantity * oi.price_at_purchase) FILTER (WHERE o.status = 'confirmed'), 0) as revenue
       FROM products p
       LEFT JOIN order_items oi ON p.id = oi.product_id
       LEFT JOIN orders o ON oi.order_id = o.id
       WHERE p.seller_id = $1 AND p.is_active = true
       GROUP BY p.id, p.name, p.price, p.stock_quantity
       ORDER BY revenue DESC
       LIMIT 5`,
      [sellerId],
    );

    // Low stock alert
    const lowStockResult = await query(
      `SELECT id, name, stock_quantity
       FROM products
       WHERE seller_id = $1 AND is_active = true AND stock_quantity < 10
       ORDER BY stock_quantity ASC`,
      [sellerId],
    );

    const overview = overviewResult.rows[0] as Record<string, unknown>;

    return c.json({
      overview: {
        total_orders: Number(overview.total_orders),
        total_revenue: Number(overview.total_revenue),
        total_units_sold: Number(overview.total_units_sold),
      },
      daily_revenue: (dailyResult.rows as Record<string, unknown>[]).map(
        (row) => ({
          date: row.date,
          revenue: Number(row.revenue),
          orders: Number(row.orders),
        }),
      ),
      top_products: (topProductsResult.rows as Record<string, unknown>[]).map(
        (row) => ({
          id: row.id,
          name: row.name,
          price: Number(row.price),
          stock_quantity: Number(row.stock_quantity),
          units_sold: Number(row.units_sold),
          revenue: Number(row.revenue),
        }),
      ),
      low_stock: lowStockResult.rows,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/orders/create-payment-intent", authMiddleware, async (c) => {
  try {
    const userId = String(c.get("userId"));
    const { shipping_address } = createPaymentIntentSchema.parse(
      await c.req.json(),
    );
    const cartItems = await getCheckoutCartItems(userId);

    if (cartItems.length === 0) {
      return c.json({ error: "Cart is empty" }, 400);
    }

    for (const item of cartItems) {
      if (Number(item.stock_quantity) < Number(item.quantity)) {
        return c.json({
          error: `Insufficient stock for ${item.name}`,
        }, 400);
      }
    }

    const totalAmount = calculateCartTotal(cartItems);
    const amount = Math.round(totalAmount * 100); // pence for GBP

    if (!Number.isFinite(amount) || amount < 30) {
      return c.json(
        {
          error:
            "Invalid amount: must be at least 30 pence (£0.30) for GBP card payments.",
        },
        400,
      );
    }

    const stripeSecretKey = getStripeSecretKey();
    if (!stripeSecretKey) {
      console.error("STRIPE_SECRET_KEY not set or placeholder");
      return c.json(
        {
          error:
            "Payment not configured: set STRIPE_SECRET_KEY in backend/.env",
        },
        500,
      );
    }

    const params = new URLSearchParams();
    params.append("amount", String(Math.round(amount)));
    params.append("currency", "gbp");
    params.append("automatic_payment_methods[enabled]", "true");
    params.append("metadata[user_id]", userId);
    for (const [field, value] of Object.entries(shipping_address)) {
      if (value !== undefined && value !== "") {
        params.append(`metadata[${SHIPPING_METADATA_PREFIX}${field}]`, value);
      }
    }

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

    return c.json({
      clientSecret: data.client_secret,
      amount,
      total_amount: totalAmount,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Invalid shipping address", details: err.errors }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});
const port = Number(Deno.env.get("SERVICE_PORT") ?? 8003);
console.log(`Orders service running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
