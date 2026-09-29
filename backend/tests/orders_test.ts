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
const ADDRESS = {
  full_name: "  Ada Lovelace ",
  line1: "12 Test Street",
  city: "London",
  postal_code: "N1 9GU",
  country: "gb",
};

Deno.test({ name: "orders service", ...suiteOptions }, async (t) => {
  await requireMigrations();
  const services = await startServices(["orders"]);
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
    const stripeStep = (name: string, fn: () => Promise<void>) =>
      t.step({ name: `stripe: ${name}`, ignore: !hasStripe, fn });

    let fulfilledPi = "";

    await stripeStep("paid checkout creates the order with the customer's address", async () => {
      const shopper = await fx.user("shopper");
      const stockBefore = await stockOf(productId);
      fulfilledPi = await paidIntent(shopper, productId);

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
      assertEquals(await stockOf(productId), stockBefore - 1);
      assertEquals((await api("GET", `${ORDERS}/cart`, { token: shopper.token })).body.item_count, 0);

      // Replaying a fulfilled payment is rejected and must not refund it.
      const replay = await checkout(shopper, fulfilledPi);
      assertEquals(replay.status, 409);
      assert(!replay.body.refunded);
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
      const pi = await paidIntent(shopper, productId);
      const results = await Promise.all([checkout(shopper, pi), checkout(shopper, pi)]);
      assertEquals(results.map((r) => r.status).sort(), [201, 409]);
      assertEquals(await ordersFor(pi), 1);
      assertEquals(await amountRefunded(pi), 0);
    });

    await stripeStep("paid intent without a shipping address → refunded", async () => {
      const shopper = await fx.user("no-address");
      await api("POST", `${ORDERS}/cart`, { token: shopper.token, body: { product_id: productId, quantity: 1 } });
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
