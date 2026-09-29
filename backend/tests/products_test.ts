import { assert, assertEquals } from "@std/assert";
import { api, Fixtures, serviceUrl, startServices, suiteOptions } from "./helpers.ts";

const PRODUCTS = serviceUrl("products");

Deno.test({ name: "products service", ...suiteOptions }, async (t) => {
  const services = await startServices(["products"]);
  const fx = new Fixtures();
  try {
    const seller = await fx.seller("owner");
    const other = await fx.seller("other");
    const buyer = await fx.user("buyer");
    const productId = await fx.product(seller.sellerId, { name: "Lamp", price: 12.5 });

    await t.step("GET /products lists products with pagination", async () => {
      const res = await api("GET", `${PRODUCTS}/products?seller_id=${seller.sellerId}`);
      assertEquals(res.status, 200);
      assertEquals(res.body.products.map((p: { id: string }) => p.id), [productId]);
      assertEquals(res.body.pagination.total, 1);
    });

    await t.step("GET /products/:id returns the product, 404 for an unknown id", async () => {
      const found = await api("GET", `${PRODUCTS}/products/${productId}`);
      assertEquals(found.status, 200);
      assertEquals(found.body.product.name, `Test ${fx.tag} Lamp`);
      assertEquals(found.body.product.store_name, `Test ${fx.tag} owner`);
      assertEquals((await api("GET", `${PRODUCTS}/products/${crypto.randomUUID()}`)).status, 404);
    });

    await t.step("POST /products: seller 201, buyer 403, invalid body 400", async () => {
      const body = { name: `Test ${fx.tag} Chair`, price: 30, stock_quantity: 2 };
      assertEquals((await api("POST", `${PRODUCTS}/products`, { token: seller.token, body })).status, 201);
      assertEquals((await api("POST", `${PRODUCTS}/products`, { token: buyer.token, body })).status, 403);
      assertEquals((await api("POST", `${PRODUCTS}/products`, { body })).status, 401);
      const invalid = await api("POST", `${PRODUCTS}/products`, {
        token: seller.token,
        body: { ...body, price: -1 },
      });
      assertEquals(invalid.status, 400);
    });

    await t.step("PUT /products/:id: only the owner can update", async () => {
      const denied = await api("PUT", `${PRODUCTS}/products/${productId}`, {
        token: other.token,
        body: { price: 1 },
      });
      assertEquals(denied.status, 404);
      const updated = await api("PUT", `${PRODUCTS}/products/${productId}`, {
        token: seller.token,
        body: { price: 15 },
      });
      assertEquals(updated.status, 200);
      assertEquals(Number(updated.body.product.price), 15);
    });

    await t.step("GET /seller/products lists only the caller's products", async () => {
      const res = await api("GET", `${PRODUCTS}/seller/products`, { token: other.token });
      assertEquals(res.status, 200);
      assertEquals(res.body.products.length, 0);
    });

    await t.step("DELETE /products/:id soft-deletes and hides the product", async () => {
      assertEquals((await api("DELETE", `${PRODUCTS}/products/${productId}`, { token: other.token })).status, 404);
      assertEquals((await api("DELETE", `${PRODUCTS}/products/${productId}`, { token: seller.token })).status, 200);
      assertEquals((await api("GET", `${PRODUCTS}/products/${productId}`)).status, 404);
    });

    await t.step("GET /categories", async () => {
      const res = await api("GET", `${PRODUCTS}/categories`);
      assertEquals(res.status, 200);
      assert(Array.isArray(res.body.categories));
    });
  } finally {
    await fx.cleanup();
    await services.stop();
  }
});
