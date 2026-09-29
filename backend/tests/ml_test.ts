import { assert, assertEquals } from "@std/assert";
import { generateTokens } from "../shared/jwt.ts";
import {
  api,
  Fixtures,
  hasMl,
  ML_DIR,
  serviceUrl,
  startServices,
  suiteOptions,
} from "./helpers.ts";

const REC = serviceUrl("recommender");
const FORECAST = serviceUrl("forecasting");
const ADMIN_KEY = Deno.env.get("ADMIN_KEY") ?? "";
const MODEL_PATH = `${ML_DIR}recommender/model.pkl`;
const GLOBAL_FORECAST = `${ML_DIR}forecasting/forecast_global.pkl`;

const mtime = (path: string) => {
  try {
    return Deno.statSync(path).mtime?.getTime();
  } catch {
    return undefined;
  }
};

// Requires ml/.venv (see README-IMPLEMENTATION.md); skipped otherwise.
Deno.test({ name: "ML services", ignore: !hasMl, ...suiteOptions }, async (t) => {
  const services = await startServices(["recommender", "forecasting"]);
  const fx = new Fixtures();
  try {
    const buyer = await fx.user("buyer");
    const other = await fx.user("other");

    await t.step("recommender: popular and similar products are public", async () => {
      assertEquals((await api("GET", `${REC}/recommend/popular`)).status, 200);
      assertEquals((await api("GET", `${REC}/recommend/similar/${crypto.randomUUID()}`)).status, 200);
    });

    await t.step("recommender: personal recommendations are private", async () => {
      const url = `${REC}/recommend/user/${buyer.id}`;
      assertEquals((await api("GET", url)).status, 401);
      assertEquals((await api("GET", url, { token: other.token })).status, 403);
      const { refreshToken } = await generateTokens(buyer.id, "buyer");
      assertEquals((await api("GET", url, { token: refreshToken })).status, 401);
      const own = await api("GET", url, { token: buyer.token });
      assertEquals(own.status, 200);
      assert(Array.isArray(own.body.recommendations));
    });

    await t.step("recommender: retrain needs the admin key, not a login", async () => {
      const retrain = (headers: Record<string, string>, token?: string) =>
        api("POST", `${REC}/recommend/retrain`, { headers, token });
      const expected = ADMIN_KEY ? 401 : 503;
      assertEquals((await retrain({})).status, expected);
      assertEquals((await retrain({}, buyer.token)).status, expected);
      assertEquals((await retrain({ "X-Admin-Key": "wrong-key" })).status, expected);
    });

    await t.step({
      name: "recommender: concurrent retrains are rejected with 409 while one runs",
      ignore: !ADMIN_KEY,
      fn: async () => {
        // Retraining overwrites model.pkl; put the developer's model back after.
        const backup = mtime(MODEL_PATH) === undefined ? null : Deno.readFileSync(MODEL_PATH);
        try {
          // Training is quick on small data, so a late request may start a
          // second run after the first finishes; what must never happen is
          // two overlapping runs, or any other status.
          const statuses = (await Promise.all([1, 2, 3, 4, 5].map(() =>
            api("POST", `${REC}/recommend/retrain`, { headers: { "X-Admin-Key": ADMIN_KEY } })
          ))).map((r) => r.status);
          assert(statuses.every((s) => s === 200 || s === 409), `statuses: ${statuses}`);
          assert(statuses.includes(200) && statuses.includes(409), `statuses: ${statuses}`);
        } finally {
          if (backup) Deno.writeFileSync(MODEL_PATH, backup);
          else Deno.removeSync(MODEL_PATH);
        }
      },
    });

    const globalBefore = mtime(GLOBAL_FORECAST);

    await t.step("forecast: a seller with no sales gets a flagged synthetic forecast", async () => {
      const seller = await fx.seller("new");
      const res = await api("GET", `${FORECAST}/forecast/${seller.id}`, { token: seller.token });
      assertEquals(res.status, 200);
      assertEquals(res.body.synthetic, true);
      assertEquals(res.body.data_days, 0);
      assertEquals(res.body.historical, []);
      assertEquals(res.body.forecast.length, 30);
    });

    await t.step("forecast: a seller with sales history gets a forecast of their own sales", async () => {
      const seller = await fx.seller("established");
      const product = await fx.product(seller.sellerId, { price: 5, stock: 1000 });
      for (let day = 1; day <= 10; day += 1) {
        await fx.order(buyer.id, [{ productId: product, quantity: day, price: 5 }], { daysAgo: day });
      }
      const res = await api("GET", `${FORECAST}/forecast/${seller.id}`, { token: seller.token });
      assertEquals(res.status, 200);
      assertEquals(res.body.synthetic, false);
      assertEquals(res.body.data_days, 10);
      // Oldest first: 10 units × £5 ten days ago … 1 unit yesterday.
      assertEquals(
        res.body.historical.map((h: { actual: number }) => h.actual),
        [50, 45, 40, 35, 30, 25, 20, 15, 10, 5],
      );

      const trained = await api("POST", `${FORECAST}/forecast/train`, { token: seller.token });
      assertEquals(trained.status, 200);
      assertEquals(trained.body.synthetic, false);
    });

    await t.step("forecast: never trains or serves the marketplace-wide forecast", () => {
      assertEquals(mtime(GLOBAL_FORECAST), globalBefore);
    });

    await t.step("forecast: access is limited to the seller themselves", async () => {
      const seller = await fx.seller("private");
      const intruder = await fx.seller("intruder");
      assertEquals((await api("GET", `${FORECAST}/forecast/${seller.id}`)).status, 401);
      assertEquals((await api("GET", `${FORECAST}/forecast/${seller.id}`, { token: intruder.token })).status, 403);
      const trainOther = await api("POST", `${FORECAST}/forecast/train?seller_id=${seller.sellerId}`, {
        token: intruder.token,
      });
      assertEquals(trainOther.status, 403);
      assertEquals((await api("POST", `${FORECAST}/forecast/train`, { token: buyer.token })).status, 403);
    });
  } finally {
    await fx.cleanup();
    await services.stop();
  }
});
