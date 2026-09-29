// Malformed input must be rejected with a 4xx, never reach the database as
// a 500 (e.g. Postgres "invalid input syntax for type uuid").
import { assertEquals } from "@std/assert";
import { api, Fixtures, serviceUrl, startServices, suiteOptions } from "./helpers.ts";

const AUTH = serviceUrl("auth");
const PRODUCTS = serviceUrl("products");
const ORDERS = serviceUrl("orders");
const USERS = serviceUrl("users");
const SEARCH = serviceUrl("search");

// Sends a raw (possibly invalid) JSON body.
async function rawPost(url: string, body: string, token?: string, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  });
  await res.body?.cancel();
  return res.status;
}

Deno.test({ name: "input validation", ...suiteOptions }, async (t) => {
  const services = await startServices(["auth", "products", "orders", "users", "search"]);
  const fx = new Fixtures();
  try {
    const seller = await fx.seller("validation");
    const buyer = await fx.user("buyer");
    const productId = await fx.product(seller.sellerId);

    await t.step("malformed ids in the path → 400", async () => {
      assertEquals((await api("GET", `${PRODUCTS}/products/not-a-uuid`)).status, 400);
      assertEquals((await api("PUT", `${PRODUCTS}/products/not-a-uuid`, { token: seller.token, body: { price: 1 } })).status, 400);
      assertEquals((await api("DELETE", `${PRODUCTS}/products/not-a-uuid`, { token: seller.token })).status, 400);
      assertEquals((await api("PUT", `${ORDERS}/cart/not-a-uuid`, { token: buyer.token, body: { quantity: 1 } })).status, 400);
      assertEquals((await api("DELETE", `${ORDERS}/cart/not-a-uuid`, { token: buyer.token })).status, 400);
      assertEquals((await api("GET", `${ORDERS}/orders/not-a-uuid`, { token: buyer.token })).status, 400);
      assertEquals((await api("GET", `${USERS}/users/sellers/not-a-uuid`)).status, 400);
    });

    await t.step("malformed ids in the query string → 400", async () => {
      assertEquals((await api("GET", `${PRODUCTS}/products?seller_id=not-a-uuid`)).status, 400);
    });

    await t.step("invalid JSON bodies → 400", async () => {
      assertEquals(await rawPost(`${AUTH}/auth/login`, "{not json"), 400);
      assertEquals(await rawPost(`${AUTH}/auth/register`, "{not json"), 400);
      assertEquals(await rawPost(`${AUTH}/auth/refresh`, "{not json"), 400);
      assertEquals(await rawPost(`${PRODUCTS}/products`, "{not json", seller.token), 400);
      assertEquals(await rawPost(`${ORDERS}/cart`, "{not json", buyer.token), 400);
      assertEquals(await rawPost(`${ORDERS}/orders/checkout`, "{not json", buyer.token), 400);
      assertEquals(await rawPost(`${ORDERS}/orders/create-payment-intent`, "{not json", buyer.token), 400);
      assertEquals(await rawPost(`${USERS}/users/me`, "{not json", buyer.token, "PUT"), 400);
    });

    await t.step("cart quantities must be positive integers", async () => {
      const added = await api("POST", `${ORDERS}/cart`, {
        token: buyer.token,
        body: { product_id: productId, quantity: 1 },
      });
      const itemId = added.body.cart_item.id;
      for (const quantity of [1.5, "2", 0, -1, null]) {
        const res = await api("PUT", `${ORDERS}/cart/${itemId}`, { token: buyer.token, body: { quantity } });
        assertEquals(res.status, 400, `quantity ${JSON.stringify(quantity)}`);
      }
    });

    await t.step("unknown category → 400, not a foreign-key 500", async () => {
      const res = await api("POST", `${PRODUCTS}/products`, {
        token: seller.token,
        body: { name: `Test ${fx.tag} Stray`, price: 1, stock_quantity: 1, category_id: crypto.randomUUID() },
      });
      assertEquals(res.status, 400);
    });

    await t.step("product pagination: invalid values → 400, oversized limit is capped", async () => {
      for (const qs of ["page=abc", "page=0", "page=-1", "limit=abc", "limit=0", "page=1.5"]) {
        assertEquals((await api("GET", `${PRODUCTS}/products?${qs}`)).status, 400, qs);
      }
      const big = await api("GET", `${PRODUCTS}/products?limit=100000&seller_id=${seller.sellerId}`);
      assertEquals(big.status, 200);
      assertEquals(big.body.pagination.limit, 100);
    });

    await t.step("search parameters: invalid values → 400", async () => {
      for (const qs of ["page=abc", "limit=0", "min_price=abc", "max_price=-5", "min_price=10&max_price=5", "page=100000"]) {
        assertEquals((await api("GET", `${SEARCH}/search?q=x&${qs}`)).status, 400, qs);
      }
    });
  } finally {
    await fx.cleanup();
    await services.stop();
  }
});
