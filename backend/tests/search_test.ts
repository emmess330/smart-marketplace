import { assert, assertEquals } from "@std/assert";
import {
  api,
  deleteTestIndex,
  esAvailable,
  Fixtures,
  refreshTestIndex,
  serviceUrl,
  startServices,
  suiteOptions,
} from "./helpers.ts";

const SEARCH = serviceUrl("search");
const PRODUCTS = serviceUrl("products");
const ADMIN_KEY = Deno.env.get("ADMIN_KEY") ?? "";

Deno.test({ name: "search service", ...suiteOptions }, async (t) => {
  const elasticsearch = await esAvailable();
  // Both services write to a throwaway index (TEST_ES_INDEX), never "products".
  const services = await startServices(["search", "products"], { elasticsearch });
  const fx = new Fixtures();
  const reindex = (key?: string) =>
    api("POST", `${SEARCH}/search/index`, { headers: key === undefined ? {} : { "X-Admin-Key": key } });
  const search = async (q: string) => {
    await refreshTestIndex();
    const res = await api("GET", `${SEARCH}/search?q=${encodeURIComponent(q)}`);
    assertEquals(res.status, 200);
    return res.body.products.map((p: { id: string }) => p.id) as string[];
  };

  try {
    await t.step("reindex requires the admin key", async () => {
      const expected = ADMIN_KEY ? 401 : 503; // 503 = disabled when ADMIN_KEY is unset
      assertEquals((await reindex()).status, expected);
      assertEquals((await reindex("wrong-key")).status, expected);
    });

    const esStep = (name: string, fn: () => Promise<void>) =>
      t.step({ name: `elasticsearch: ${name}`, ignore: !elasticsearch || !ADMIN_KEY, fn });

    const seller = await fx.seller("search");
    // A made-up word so the only match is this fixture.
    const keyword = `zorblax${fx.tag}`;
    const productId = await fx.product(seller.sellerId, { name: `${keyword} Kettle` });

    await esStep("reindex with the admin key indexes products", async () => {
      const res = await reindex(ADMIN_KEY);
      assertEquals(res.status, 200, JSON.stringify(res.body));
      assert(!res.body.errors);
      assertEquals(await search(keyword), [productId]);
    });

    await esStep("a misspelled query falls back to typo-tolerant matching", async () => {
      const typo = keyword.slice(0, 3) + keyword.slice(4); // drop one letter
      assertEquals(await search(typo), [productId]);
      const suggest = await api("GET", `${SEARCH}/search/suggest?q=${typo}`);
      assert(suggest.body.suggestions.some((s: { id: string }) => s.id === productId));
    });

    await esStep("suggest returns matching names", async () => {
      const res = await api("GET", `${SEARCH}/search/suggest?q=${keyword}`);
      assertEquals(res.status, 200);
      assert(res.body.suggestions.some((s: { id: string }) => s.id === productId));
    });

    await esStep("product create, update and delete stay in sync with search", async () => {
      const created = await api("POST", `${PRODUCTS}/products`, {
        token: seller.token,
        body: { name: `${keyword}sync Toaster`, price: 20, stock_quantity: 1 },
      });
      const id = created.body.product.id;
      assertEquals(await search(`${keyword}sync`), [id]);

      await api("PUT", `${PRODUCTS}/products/${id}`, {
        token: seller.token,
        body: { name: `${keyword}renamed Toaster` },
      });
      assertEquals(await search(`${keyword}renamed`), [id]);

      await api("DELETE", `${PRODUCTS}/products/${id}`, { token: seller.token });
      assertEquals(await search(`${keyword}renamed`), []);
    });
  } finally {
    await fx.cleanup();
    await services.stop();
    if (elasticsearch) await deleteTestIndex();
  }
});
