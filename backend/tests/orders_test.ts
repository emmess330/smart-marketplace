import { assert, assertEquals } from "@std/assert";
import { query } from "../shared/db.ts";
import {
  amountRefunded,
  api,
  Fixtures,
  hasStripe,
  paymentIntentId,
  payWithTestCard,
  requireMigrations,
  serviceUrl,
  startServices,
  stripe,
  suiteOptions,
  type TestUser,
} from "./helpers.ts";

const ORDERS = serviceUrl("orders");
// The tests sign webhook events themselves, as Stripe would.
const WEBHOOK_SECRET = "whsec_test_suite_only";

async function signedWebhook(event: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const signature = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const res = await fetch(`${ORDERS}/orders/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${signature}` },
    body: payload,
  });
  return { status: res.status, body: await res.json() };
}

const succeededEvent = (paymentIntentId: string) => ({
  id: `evt_test_${crypto.randomUUID()}`,
  type: "payment_intent.succeeded",
  data: { object: { id: paymentIntentId, object: "payment_intent", status: "succeeded" } },
});
const ADDRESS = {
  full_name: "  Ada Lovelace ",
  line1: "12 Test Street",
  city: "London",
  postal_code: "N1 9GU",
  country: "gb",
};

Deno.test({ name: "orders service", ...suiteOptions }, async (t) => {
  await requireMigrations();
  const services = await startServices(["orders"], { env: { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } });
  const fx = new Fixtures();

  const stockOf = async (productId: string) =>
    ((await query("SELECT stock_quantity FROM products WHERE id = $1", [productId]))
      .rows[0] as { stock_quantity: number }).stock_quantity;
  const ordersFor = async (piId: string) =>
    (await query("SELECT id FROM orders WHERE stripe_payment_id = $1", [piId])).rows.length;
  const checkout = (user: TestUser, piId: string) =>
    api("POST", `${ORDERS}/orders/checkout`, { token: user.token, body: { stripe_payment_id: piId } });

  // Fills the cart and pays for it the way the checkout page does.
  const paidIntent = async (user: TestUser, productId: string, quantity = 1) => {
    await query("DELETE FROM cart_items WHERE user_id = $1", [user.id]);
    await api("POST", `${ORDERS}/cart`, { token: user.token, body: { product_id: productId, quantity } });
    const pi = await api("POST", `${ORDERS}/orders/create-payment-intent`, {
      token: user.token,
      body: { shipping_address: ADDRESS },
    });
    assertEquals(pi.status, 200, JSON.stringify(pi.body));
    const id = paymentIntentId(pi.body.clientSecret);
    await payWithTestCard(id);
    return id;
  };

  try {
    const seller = await fx.seller("shop");
    const buyer = await fx.user("buyer");
    const productId = await fx.product(seller.sellerId, { name: "Mug", price: 5, stock: 3 });

    await t.step("cart: add, view, update and remove items", async () => {
      const added = await api("POST", `${ORDERS}/cart`, {
        token: buyer.token,
        body: { product_id: productId, quantity: 2 },
      });
      assertEquals(added.status, 201);

      const cart = await api("GET", `${ORDERS}/cart`, { token: buyer.token });
      assertEquals(cart.status, 200);
      assertEquals(cart.body.total, 10);

      const itemId = added.body.cart_item.id;
      assertEquals((await api("PUT", `${ORDERS}/cart/${itemId}`, { token: buyer.token, body: { quantity: 3 } })).status, 200);
      assertEquals((await api("DELETE", `${ORDERS}/cart/${itemId}`, { token: buyer.token })).status, 200);
      assertEquals((await api("GET", `${ORDERS}/cart`, { token: buyer.token })).body.item_count, 0);
    });

    await t.step("cart: quantities beyond stock are rejected", async () => {
      const over = await api("POST", `${ORDERS}/cart`, {
        token: buyer.token,
        body: { product_id: productId, quantity: 4 },
      });
      assertEquals(over.status, 400);
      assertEquals(over.body.available, 3);
    });

    await t.step("cart: another user's item can't be removed", async () => {
      const added = await api("POST", `${ORDERS}/cart`, {
        token: buyer.token,
        body: { product_id: productId, quantity: 1 },
      });
      const stranger = await fx.user("stranger");
      assertEquals((await api("DELETE", `${ORDERS}/cart/${added.body.cart_item.id}`, { token: stranger.token })).status, 404);
      await query("DELETE FROM cart_items WHERE user_id = $1", [buyer.id]);
    });

    await t.step("create-payment-intent validates the address before any payment", async () => {
      await api("POST", `${ORDERS}/cart`, { token: buyer.token, body: { product_id: productId, quantity: 1 } });
      const post = (body: unknown) =>
        api("POST", `${ORDERS}/orders/create-payment-intent`, { token: buyer.token, body });
      assertEquals((await post({})).status, 400);
      assertEquals((await post({ shipping_address: { ...ADDRESS, city: "  " } })).status, 400);
      assertEquals((await post({ shipping_address: { ...ADDRESS, country: "GBR" } })).status, 400);
      await query("DELETE FROM cart_items WHERE user_id = $1", [buyer.id]);
    });

    await t.step("create-payment-intent rejects an empty cart", async () => {
      const res = await api("POST", `${ORDERS}/orders/create-payment-intent`, {
        token: buyer.token,
        body: { shipping_address: ADDRESS },
      });
      assertEquals(res.status, 400);
    });

    await t.step("seller analytics count only confirmed orders", async () => {
      const analyticsSeller = await fx.seller("analytics");
      const item = await fx.product(analyticsSeller.sellerId, { name: "Lens", price: 10, stock: 100 });
      await fx.order(buyer.id, [{ productId: item, quantity: 2, price: 10 }], { status: "confirmed" });
      await fx.order(buyer.id, [{ productId: item, quantity: 5, price: 10 }], { status: "pending" });
      await fx.order(buyer.id, [{ productId: item, quantity: 7, price: 10 }], { status: "payment_failed" });

      const res = await api("GET", `${ORDERS}/seller/analytics`, { token: analyticsSeller.token });
      assertEquals(res.status, 200);
      assertEquals(res.body.overview.total_units_sold, 2);
      assertEquals(res.body.overview.total_revenue, 20);
      const top = res.body.top_products.find((p: { id: string }) => p.id === item);
      assertEquals(top.units_sold, 2);
      assertEquals(top.revenue, 20);

      assertEquals((await api("GET", `${ORDERS}/seller/analytics`, { token: buyer.token })).status, 403);
    });

    await t.step("GET /orders returns only the caller's orders", async () => {
      const mine = await api("GET", `${ORDERS}/orders`, { token: buyer.token });
      assertEquals(mine.status, 200);
      assertEquals(mine.body.orders.length, 3);
      const stranger = await fx.user("no-orders");
      assertEquals((await api("GET", `${ORDERS}/orders`, { token: stranger.token })).body.orders.length, 0);
    });

    // ── Stripe test mode ──
    // Plenty of stock, so the payment steps don't run each other out.
    const stockedProduct = await fx.product(seller.sellerId, { name: "Stocked", price: 5, stock: 100 });
    const stripeStep = (name: string, fn: () => Promise<void>) =>
      t.step({ name: `stripe: ${name}`, ignore: !hasStripe, fn });

    let fulfilledPi = "";

    await stripeStep("paid checkout creates the order with the customer's address", async () => {
      const shopper = await fx.user("shopper");
      const stockBefore = await stockOf(stockedProduct);
      fulfilledPi = await paidIntent(shopper, stockedProduct);

      const res = await checkout(shopper, fulfilledPi);
      assertEquals(res.status, 201, JSON.stringify(res.body));
      assertEquals(res.body.order.status, "confirmed");
      assertEquals(res.body.order.shipping_address, {
        full_name: "Ada Lovelace",
        line1: "12 Test Street",
        city: "London",
        postal_code: "N1 9GU",
        country: "GB",
      });
      assertEquals(await stockOf(stockedProduct), stockBefore - 1);
      assertEquals((await api("GET", `${ORDERS}/cart`, { token: shopper.token })).body.item_count, 0);

      // Replaying a fulfilled payment returns the same order: no second
      // order, no refund.
      const replay = await checkout(shopper, fulfilledPi);
      assertEquals(replay.status, 200);
      assertEquals(replay.body.order.id, res.body.order.id);
      assertEquals(replay.body.already_created, true);
      assertEquals(await ordersFor(fulfilledPi), 1);
      assertEquals(await amountRefunded(fulfilledPi), 0);
    });

    await stripeStep("someone else's payment is rejected", async () => {
      const thief = await fx.user("thief");
      assertEquals((await checkout(thief, fulfilledPi)).status, 403);
    });

    await stripeStep("stock gone after payment → refunded, no order", async () => {
      const shopper = await fx.user("unlucky");
      const scarce = await fx.product(seller.sellerId, { name: "Scarce", price: 5, stock: 1 });
      const pi = await paidIntent(shopper, scarce);
      await query("UPDATE products SET stock_quantity = 0 WHERE id = $1", [scarce]);

      const res = await checkout(shopper, pi);
      assertEquals(res.status, 409);
      assertEquals(res.body.refunded, true);
      assertEquals(await amountRefunded(pi), 500);
      assertEquals(await ordersFor(pi), 0);

      // Once refunded, the payment can't be used even if stock comes back.
      await query("UPDATE products SET stock_quantity = 5 WHERE id = $1", [scarce]);
      const reuse = await checkout(shopper, pi);
      assertEquals(reuse.status, 409);
      assert(/refunded/.test(reuse.body.error));
    });

    await stripeStep("concurrent double-submit → one order, no refund", async () => {
      const shopper = await fx.user("double");
      const pi = await paidIntent(shopper, stockedProduct);
      const results = await Promise.all([checkout(shopper, pi), checkout(shopper, pi)]);
      assertEquals(results.map((r) => r.status).sort(), [200, 201]);
      assertEquals(await ordersFor(pi), 1);
      assertEquals(await amountRefunded(pi), 0);
    });

    await t.step("webhook: rejects unsigned and wrongly signed requests", async () => {
      const unsigned = await fetch(`${ORDERS}/orders/stripe/webhook`, { method: "POST", body: "{}" });
      await unsigned.body?.cancel();
      assertEquals(unsigned.status, 400);
      assertEquals((await signedWebhook(succeededEvent("pi_x"), "whsec_wrong")).status, 400);
      const other = await signedWebhook({ id: "evt_x", type: "customer.created", data: { object: {} } });
      assertEquals(other.status, 200);
      assertEquals(other.body.ignored, true);
    });

    await stripeStep("webhook: creates the order when the browser never calls checkout", async () => {
      const shopper = await fx.user("tab-closed");
      const stockBefore = await stockOf(stockedProduct);
      const pi = await paidIntent(shopper, stockedProduct, 2);
      // …buyer closes the tab: no checkout call. Stripe's webhook arrives.
      const hook = await signedWebhook(succeededEvent(pi));
      assertEquals(hook.status, 200);
      assertEquals(hook.body.fulfilment, "created");
      assertEquals(await ordersFor(pi), 1);
      assertEquals(await stockOf(stockedProduct), stockBefore - 2);
      assertEquals((await api("GET", `${ORDERS}/cart`, { token: shopper.token })).body.item_count, 0);
      const orders = await api("GET", `${ORDERS}/orders`, { token: shopper.token });
      assertEquals(orders.body.orders[0].shipping_address.full_name, "Ada Lovelace");

      // If the browser does call checkout late, it gets the same order.
      const late = await checkout(shopper, pi);
      assertEquals(late.status, 200);
      assertEquals(late.body.order.id, orders.body.orders[0].id);
      // Stripe redelivering the event changes nothing.
      assertEquals((await signedWebhook(succeededEvent(pi))).body.fulfilment, "existing");
      assertEquals(await ordersFor(pi), 1);
      assertEquals(await amountRefunded(pi), 0);
    });

    await stripeStep("webhook: after the browser's checkout, does nothing", async () => {
      const shopper = await fx.user("browser-first");
      const pi = await paidIntent(shopper, stockedProduct);
      assertEquals((await checkout(shopper, pi)).status, 201);
      assertEquals((await signedWebhook(succeededEvent(pi))).body.fulfilment, "existing");
      assertEquals(await ordersFor(pi), 1);
    });

    await stripeStep("webhook and checkout at the same moment → one order, no refund", async () => {
      const shopper = await fx.user("race");
      const pi = await paidIntent(shopper, stockedProduct);
      const [hook, browser] = await Promise.all([signedWebhook(succeededEvent(pi)), checkout(shopper, pi)]);
      assertEquals(hook.status, 200);
      assert([200, 201].includes(browser.status), `checkout status ${browser.status}`);
      assertEquals(await ordersFor(pi), 1);
      assertEquals(await amountRefunded(pi), 0);
    });

    await stripeStep("order matches what was paid, even if the cart changed afterwards", async () => {
      const shopper = await fx.user("cart-changed");
      const extra = await fx.product(seller.sellerId, { name: "Extra", price: 7, stock: 5 });
      const pi = await paidIntent(shopper, stockedProduct);
      // Added after paying (e.g. in another tab): not part of this order.
      await api("POST", `${ORDERS}/cart`, { token: shopper.token, body: { product_id: extra, quantity: 1 } });

      const res = await checkout(shopper, pi);
      assertEquals(res.status, 201);
      assertEquals(Number(res.body.order.total_amount), 5);
      assertEquals(res.body.items.map((i: { product_id: string }) => i.product_id), [stockedProduct]);
      const cart = await api("GET", `${ORDERS}/cart`, { token: shopper.token });
      assertEquals(cart.body.items.map((i: { product_id: string }) => i.product_id), [extra]);
    });

    await stripeStep("webhook: stock gone after payment → refunded, no order", async () => {
      const shopper = await fx.user("webhook-unlucky");
      const scarce = await fx.product(seller.sellerId, { name: "Last one", price: 5, stock: 1 });
      const pi = await paidIntent(shopper, scarce);
      await query("UPDATE products SET stock_quantity = 0 WHERE id = $1", [scarce]);
      const hook = await signedWebhook(succeededEvent(pi));
      assertEquals(hook.body.fulfilment, "refunded");
      assertEquals(await ordersFor(pi), 0);
      assertEquals(await amountRefunded(pi), 500);
    });

    await stripeStep("webhook: leaves payments this app didn't start alone", async () => {
      const outsider = await stripe("/payment_intents", {
        amount: "500",
        currency: "gbp",
        payment_method: "pm_card_visa",
        confirm: "true",
        "automatic_payment_methods[enabled]": "true",
        "automatic_payment_methods[allow_redirects]": "never",
      });
      const hook = await signedWebhook(succeededEvent(outsider.id));
      assertEquals(hook.status, 200);
      assertEquals(hook.body.fulfilment, "not_ours");
      assertEquals(await amountRefunded(outsider.id), 0);
    });

    await stripeStep("buyer submits a payment this app never started a checkout for → refunded", async () => {
      const shopper = await fx.user("no-address");
      await api("POST", `${ORDERS}/cart`, { token: shopper.token, body: { product_id: stockedProduct, quantity: 1 } });
      const bare = await stripe("/payment_intents", {
        amount: "500",
        currency: "gbp",
        "metadata[user_id]": shopper.id,
        payment_method: "pm_card_visa",
        confirm: "true",
        "automatic_payment_methods[enabled]": "true",
        "automatic_payment_methods[allow_redirects]": "never",
      });
      const res = await checkout(shopper, bare.id);
      assertEquals(res.status, 400);
      assertEquals(res.body.refunded, true);
      assertEquals(await ordersFor(bare.id), 0);
    });
  } finally {
    await fx.cleanup();
    await services.stop();
  }
});
