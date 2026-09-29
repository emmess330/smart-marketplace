import { Hono } from "hono/mod.ts";
import { z } from "zod";
import { isUniqueViolation, query, withTransaction } from "../shared/db.ts";
import { authMiddleware, type AuthVariables } from "../shared/middleware.ts";
import { parseJsonBody, uuidParams } from "../shared/validation.ts";
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

// Cancels an unpaid payment intent so it can no longer be paid.
async function cancelPaymentIntent(paymentIntentId: string) {
  const stripeSecretKey = getStripeSecretKey();
  if (!stripeSecretKey) return;
  const response = await fetch(
    `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
    { method: "POST", headers: { "Authorization": `Bearer ${stripeSecretKey}` } },
  );
  await response.body?.cancel();
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

const updateCartSchema = z.object({
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

const createPaymentIntentSchema = z.object({
  shipping_address: shippingAddressSchema,
});

// Only the payment id is sent: what was bought, its price and the shipping
// address come from the snapshot saved when the payment intent was created,
// so none of it can be changed (or rejected) after the customer has paid.
const checkoutSchema = z.object({
  stripe_payment_id: z.string(),
});

// The shipping address is also copied into the intent's metadata, one key
// per field, so it's visible in the Stripe dashboard.
const SHIPPING_METADATA_PREFIX = "ship_";

type CartCheckoutItem = Record<string, unknown>;

async function getCheckoutCartItems(userId: string) {
  const cartResult = await query(
    `SELECT ci.quantity, p.id as product_id, p.price, p.stock_quantity, p.name
     FROM cart_items ci
     JOIN products p ON ci.product_id = p.id
     WHERE ci.user_id = $1 AND p.is_active = true
     ORDER BY p.id`,
    [userId],
  );

  return cartResult.rows as CartCheckoutItem[];
}

// A payment intent's snapshot row (pending_checkouts), see migration 005.
type SnapshotItem = { product_id: string; name: string; quantity: number; price: number };
type CheckoutSnapshot = {
  user_id: string;
  items: SnapshotItem[];
  total_amount: string;
  shipping_address: Record<string, unknown>;
};

// Thrown inside the fulfilment transaction when a paid order can't be
// created; it rolls back and the payment is refunded.
class CheckoutError extends Error {
  constructor(message: string, readonly status: 400 | 409) {
    super(message);
  }
}

type FulfilmentResult =
  | { kind: "created"; order: Record<string, unknown>; items: SnapshotItem[] }
  | { kind: "existing"; order: Record<string, unknown> }
  | { kind: "not_ours" }
  | { kind: "refunded"; reason: string; status: 400 | 409; refundStatus: string }
  | { kind: "refund_failed"; reason: string };

// Creates the order a succeeded payment intent paid for, from its snapshot.
// Both the browser's checkout request and Stripe's webhook call this; the
// first creates the order and later calls get that same order back. If the
// order can't be fulfilled (stock gone, product withdrawn) the payment is
// refunded. The caller must check the intent succeeded and wasn't refunded.
//
// With `refundUnknown: false` (the webhook), an intent with no snapshot is
// left alone rather than refunded: Stripe sends events for every payment on
// the account, and ones this app didn't start aren't ours to refund.
async function fulfilPaymentIntent(
  paymentIntent: StripePaymentIntent,
  { refundUnknown }: { refundUnknown: boolean },
): Promise<FulfilmentResult> {
  const existingOrder = async () =>
    (await query("SELECT * FROM orders WHERE stripe_payment_id = $1", [paymentIntent.id]))
      .rows[0] as Record<string, unknown> | undefined;

  try {
    return await withTransaction<FulfilmentResult>(async (tx) => {
      // Serialise fulfilment per payment, so whichever caller loses a race
      // sees the winner's order below instead of creating or refunding one.
      await tx("SELECT pg_advisory_xact_lock(hashtext($1))", [paymentIntent.id]);

      const existing = await tx("SELECT * FROM orders WHERE stripe_payment_id = $1", [paymentIntent.id]);
      if (existing.rows.length > 0) {
        return { kind: "existing", order: existing.rows[0] as Record<string, unknown> };
      }

      const snapshotResult = await tx(
        `SELECT user_id, items, total_amount, shipping_address
         FROM pending_checkouts WHERE stripe_payment_id = $1`,
        [paymentIntent.id],
      );
      if (snapshotResult.rows.length === 0) {
        if (!refundUnknown) return { kind: "not_ours" };
        throw new CheckoutError("No checkout was started for this payment", 400);
      }
      const snapshot = snapshotResult.rows[0] as CheckoutSnapshot;

      if (String(snapshot.user_id) !== paymentIntent.metadata?.user_id) {
        throw new CheckoutError("Payment does not match its checkout", 400);
      }
      if (
        Math.round(Number(snapshot.total_amount) * 100) !== paymentIntent.amount ||
        paymentIntent.currency?.toLowerCase() !== "gbp"
      ) {
        throw new CheckoutError("Payment amount does not match its checkout", 409);
      }

      // Lock the products (in id order, so concurrent fulfilments can't
      // deadlock) and re-check they're still for sale and in stock.
      const productIds = snapshot.items.map((item) => item.product_id);
      const productsResult = await tx(
        `SELECT id, name, stock_quantity, is_active FROM products
         WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [productIds],
      );
      const products = new Map(
        (productsResult.rows as { id: string; name: string; stock_quantity: number; is_active: boolean }[])
          .map((row) => [String(row.id), row]),
      );
      for (const item of snapshot.items) {
        const product = products.get(item.product_id);
        if (!product?.is_active) {
          throw new CheckoutError(`${item.name} is no longer available`, 409);
        }
        if (Number(product.stock_quantity) < item.quantity) {
          throw new CheckoutError(`Insufficient stock for ${product.name}`, 409);
        }
      }

      const orderResult = await tx(
        `INSERT INTO orders (user_id, total_amount, shipping_address, stripe_payment_id, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          snapshot.user_id,
          snapshot.total_amount,
          JSON.stringify(snapshot.shipping_address),
          paymentIntent.id,
          paymentIntentStatusToOrderStatus("succeeded"),
        ],
      );
      const order = orderResult.rows[0] as Record<string, unknown>;

      for (const item of snapshot.items) {
        await tx(
          `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase)
           VALUES ($1, $2, $3, $4)`,
          [order.id, item.product_id, item.quantity, item.price],
        );
        await tx(
          "UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2",
          [item.quantity, item.product_id],
        );
      }

      // Remove what was bought from the cart; anything added since stays.
      await tx(
        "DELETE FROM cart_items WHERE user_id = $1 AND product_id = ANY($2::uuid[])",
        [snapshot.user_id, productIds],
      );
      await tx("DELETE FROM pending_checkouts WHERE stripe_payment_id = $1", [paymentIntent.id]);

      return { kind: "created", order, items: snapshot.items };
    });
  } catch (err) {
    // The unique constraint on orders.stripe_payment_id backs up the lock.
    if (isUniqueViolation(err, "orders_stripe_payment_id_unique")) {
      const order = await existingOrder();
      if (order) return { kind: "existing", order };
    }
    if (!(err instanceof CheckoutError)) throw err;
    try {
      const refund = await refundPaymentIntent(paymentIntent.id);
      return { kind: "refunded", reason: err.message, status: err.status, refundStatus: refund.status };
    } catch (refundErr) {
      // Money taken, no order, refund failed: needs manual follow-up.
      console.error(
        `REFUND FAILED for payment intent ${paymentIntent.id} ` +
          `(user ${paymentIntent.metadata?.user_id}, reason: ${err.message}):`,
        refundErr,
      );
      return { kind: "refund_failed", reason: err.message };
    }
  }
}

function calculateCartTotal(cartItems: CartCheckoutItem[]) {
  const total = cartItems.reduce((sum, item) => {
    return sum + (Number(item.price) * Number(item.quantity));
  }, 0);

  return Math.round(total * 100) / 100;
}

// POST /orders/stripe/webhook — Stripe webhook for payment status changes.
// On payment_intent.succeeded it creates the order if the browser didn't
// (tab closed, redirect-based payment method). Replies 4xx only for requests
// that aren't valid Stripe events; processing errors reply 500 so Stripe
// retries the delivery.
app.post("/orders/stripe/webhook", async (c) => {
  const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!endpointSecret || endpointSecret.includes("your_key")) {
    console.error("STRIPE_WEBHOOK_SECRET not set or placeholder");
    return c.json({ error: "Stripe webhook not configured" }, 500);
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing Stripe-Signature header" }, 400);
  }

  let event: StripeWebhookEvent;
  try {
    const payload = await c.req.text();
    await verifyStripeWebhookSignature(payload, signature, endpointSecret);
    event = JSON.parse(payload) as StripeWebhookEvent;
  } catch (err) {
    console.error("Rejected Stripe webhook:", err);
    return c.json({ error: "Invalid Stripe webhook" }, 400);
  }

  try {
    const stripeObject = event.data?.object as StripePaymentIntent | undefined;
    if (
      !event.type.startsWith("payment_intent.") ||
      stripeObject?.object !== "payment_intent" ||
      !stripeObject.id
    ) {
      return c.json({ received: true, ignored: true });
    }

    if (event.type === "payment_intent.succeeded") {
      // Re-read the intent: events can arrive late or out of order, and
      // refunds only show on the expanded latest_charge.
      const paymentIntent = await fetchPaymentIntent(stripeObject.id);
      if (paymentIntent.status !== "succeeded" || amountRefunded(paymentIntent) > 0) {
        return c.json({ received: true, ignored: true, payment_status: paymentIntent.status });
      }

      const result = await fulfilPaymentIntent(paymentIntent, { refundUnknown: false });
      if (result.kind === "created") {
        console.log(`Webhook created order ${result.order.id} for ${paymentIntent.id}`);
      } else if (result.kind === "refunded") {
        console.warn(`Webhook refunded ${paymentIntent.id}: ${result.reason}`);
      } else if (result.kind === "refund_failed") {
        // Let Stripe redeliver, which retries the (idempotent) refund.
        return c.json({ error: "Refund failed" }, 500);
      }
      return c.json({ received: true, payment_intent: paymentIntent.id, fulfilment: result.kind });
    }

    const { orderStatus, updatedOrders } = await updateOrderStatusFromPaymentIntent(stripeObject);
    return c.json({
      received: true,
      payment_intent: stripeObject.id,
      payment_status: stripeObject.status,
      order_status: orderStatus,
      updated_orders: updatedOrders.length,
    });
  } catch (err) {
    console.error("Stripe webhook processing failed:", err);
    return c.json({ error: "Webhook processing failed" }, 500);
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
    const data = await parseJsonBody(c, addToCartSchema);

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
app.put("/cart/:id", authMiddleware, uuidParams("id"), async (c) => {
  try {
    const { id } = c.req.param();
    const userId = c.get("userId");
    const { quantity } = await parseJsonBody(c, updateCartSchema);

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
    if (err instanceof z.ZodError) {
      return c.json({ error: "Quantity must be a positive whole number", details: err.errors }, 400);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /cart/:id — remove item from cart
app.delete("/cart/:id", authMiddleware, uuidParams("id"), async (c) => {
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
    const data = await parseJsonBody(c, checkoutSchema);

    // Verify the payment itself; stock checks happen during fulfilment, where
    // a problem triggers a refund rather than leaving the customer charged.
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

    const result = await fulfilPaymentIntent(paymentIntent, { refundUnknown: true });
    switch (result.kind) {
      case "created":
        return c.json({ order: result.order, items: result.items }, 201);
      case "existing":
        // Already created, e.g. by the webhook, or this is a retried request.
        return c.json({ order: result.order, already_created: true }, 200);
      case "refunded":
        return c.json({
          error: result.reason,
          refunded: true,
          refund_status: result.refundStatus,
        }, result.status);
      case "refund_failed":
        return c.json({
          error: `${result.reason}. Your payment could not be refunded ` +
            "automatically; please contact support.",
          refunded: false,
        }, 502);
      case "not_ours":
        // Unreachable: refundUnknown is set.
        return c.json({ error: "No checkout was started for this payment" }, 400);
    }
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
app.get("/orders/:id", authMiddleware, uuidParams("id"), async (c) => {
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
    const { shipping_address } = await parseJsonBody(c, createPaymentIntentSchema);
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

    // Snapshot what this payment is for; the order is created from it.
    try {
      await query(
        `INSERT INTO pending_checkouts
           (stripe_payment_id, user_id, items, total_amount, shipping_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          data.id,
          userId,
          JSON.stringify(cartItems.map((item) => ({
            product_id: String(item.product_id),
            name: String(item.name),
            quantity: Number(item.quantity),
            price: Number(item.price),
          }))),
          totalAmount,
          JSON.stringify(shipping_address),
        ],
      );
    } catch (err) {
      // Without a snapshot the payment couldn't be fulfilled, so make sure it
      // can't be paid.
      await cancelPaymentIntent(data.id).catch(() => {});
      throw err;
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
