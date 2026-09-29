import { assert, assertEquals } from "@std/assert";
import {
  api,
  Fixtures,
  requireMigrations,
  serviceUrl,
  startServices,
  suiteOptions,
} from "./helpers.ts";
import { query } from "../shared/db.ts";

const AUTH = serviceUrl("auth");
const USERS = serviceUrl("users");
const PRODUCTS = serviceUrl("products");
const PASSWORD = "correct-horse-battery";

const roleOf = (token: string) => JSON.parse(atob(token.split(".")[1])).role;

Deno.test({ name: "auth + users services", ...suiteOptions }, async (t) => {
  await requireMigrations();
  const services = await startServices(["auth", "users", "products"]);
  const fx = new Fixtures();
  const register = (name: string, extra: Record<string, unknown> = {}) =>
    api("POST", `${AUTH}/auth/register`, {
      body: { email: fx.email(name), password: PASSWORD, full_name: `Test ${fx.tag}`, ...extra },
    });
  const createProduct = (token: string) =>
    api("POST", `${PRODUCTS}/products`, { token, body: { name: `Test ${fx.tag}`, price: 1, stock_quantity: 1 } });

  try {
    await t.step("register, login and /auth/me", async () => {
      const reg = await register("basic");
      assertEquals(reg.status, 201);
      assertEquals(reg.body.user.role, "buyer");
      assertEquals(reg.body.seller, null);

      const login = await api("POST", `${AUTH}/auth/login`, {
        body: { email: fx.email("basic"), password: PASSWORD },
      });
      assertEquals(login.status, 200);
      const me = await api("GET", `${AUTH}/auth/me`, { token: login.body.accessToken });
      assertEquals(me.status, 200);
      assertEquals(me.body.user.email, fx.email("basic"));
    });

    await t.step("duplicate email → 409", async () => {
      assertEquals((await register("basic")).status, 409);
    });

    await t.step("wrong password → 401", async () => {
      const res = await api("POST", `${AUTH}/auth/login`, {
        body: { email: fx.email("basic"), password: "wrong-password" },
      });
      assertEquals(res.status, 401);
    });

    await t.step("/auth/me rejects a missing token and a refresh token", async () => {
      assertEquals((await api("GET", `${AUTH}/auth/me`)).status, 401);
      const login = await api("POST", `${AUTH}/auth/login`, {
        body: { email: fx.email("basic"), password: PASSWORD },
      });
      assertEquals((await api("GET", `${AUTH}/auth/me`, { token: login.body.refreshToken })).status, 401);
    });

    await t.step("concurrent registrations with one email → one 201, one 409", async () => {
      const results = await Promise.all([register("race"), register("race")]);
      assertEquals(results.map((r) => r.status).sort(), [201, 409]);
    });

    await t.step("registering as a seller creates the store atomically", async () => {
      const reg = await register("seller1", { role: "seller" });
      assertEquals(reg.status, 201);
      assertEquals(reg.body.seller.store_name, `Test ${fx.tag}'s Store`);
      assertEquals(roleOf(reg.body.accessToken), "seller");
      assertEquals((await createProduct(reg.body.accessToken)).status, 201);
    });

    await t.step("a clashing default store name gets a suffix", async () => {
      const reg = await register("seller2", { role: "seller" });
      assertEquals(reg.status, 201);
      assert(reg.body.seller.store_name.startsWith(`Test ${fx.tag}'s Store `));
    });

    await t.step("a taken explicit store name → 409 and no half-created user", async () => {
      const reg = await register("seller3", { role: "seller", store_name: `Test ${fx.tag}'s Store` });
      assertEquals(reg.status, 409);
      const users = await query("SELECT id FROM users WHERE email = $1", [fx.email("seller3")]);
      assertEquals(users.rows.length, 0);
    });

    await t.step("upgrading to seller returns a seller token", async () => {
      const buyer = await register("upgrade");
      assertEquals((await createProduct(buyer.body.accessToken)).status, 403);

      const up = await api("POST", `${USERS}/users/seller`, {
        token: buyer.body.accessToken,
        body: { store_name: `Test ${fx.tag} Upgraded` },
      });
      assertEquals(up.status, 201);
      assertEquals(roleOf(up.body.accessToken), "seller");
      // The old token still says buyer; the new one works without re-login.
      assertEquals((await createProduct(buyer.body.accessToken)).status, 403);
      assertEquals((await createProduct(up.body.accessToken)).status, 201);

      const again = await api("POST", `${USERS}/users/seller`, {
        token: up.body.accessToken,
        body: { store_name: `Test ${fx.tag} Again` },
      });
      assertEquals(again.status, 409);
    });

    await t.step("concurrent upgrades create exactly one store", async () => {
      const buyer = await register("upgrade-race");
      const results = await Promise.all([1, 2].map((i) =>
        api("POST", `${USERS}/users/seller`, {
          token: buyer.body.accessToken,
          body: { store_name: `Test ${fx.tag} Race ${i}` },
        })
      ));
      assertEquals(results.map((r) => r.status).sort(), [201, 409]);
      const stores = await query(
        "SELECT s.id FROM sellers s JOIN users u ON u.id = s.user_id WHERE u.email = $1",
        [fx.email("upgrade-race")],
      );
      assertEquals(stores.rows.length, 1);
    });

    const refresh = (refreshToken: unknown) =>
      api("POST", `${AUTH}/auth/refresh`, { body: { refreshToken } });

    await t.step("refresh: returns a working token pair and consumes the old refresh token", async () => {
      const reg = await register("refresh");
      const res = await refresh(reg.body.refreshToken);
      assertEquals(res.status, 200);
      assertEquals(res.body.user.email, fx.email("refresh"));
      assertEquals((await api("GET", `${AUTH}/auth/me`, { token: res.body.accessToken })).status, 200);

      // Rotation: the old refresh token no longer works; the new one does.
      assertEquals((await refresh(reg.body.refreshToken)).status, 401);
      assertEquals((await refresh(res.body.refreshToken)).status, 200);
    });

    await t.step("refresh: rejects access tokens, junk and missing tokens", async () => {
      const reg = await register("refresh-bad");
      assertEquals((await refresh(reg.body.accessToken)).status, 401);
      assertEquals((await refresh("not-a-token")).status, 401);
      assertEquals((await refresh(undefined)).status, 400);
    });

    await t.step("refresh: concurrent refreshes with one token → exactly one succeeds", async () => {
      const reg = await register("refresh-race");
      const results = await Promise.all([1, 2, 3].map(() => refresh(reg.body.refreshToken)));
      assertEquals(results.map((r) => r.status).sort(), [200, 401, 401]);
    });

    await t.step("refresh: fails after logout and after the session expires", async () => {
      const a = await register("refresh-logout");
      await api("POST", `${AUTH}/auth/logout`, { body: { refreshToken: a.body.refreshToken } });
      assertEquals((await refresh(a.body.refreshToken)).status, 401);

      const b = await register("refresh-expired");
      await query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE refresh_token = $1", [
        b.body.refreshToken,
      ]);
      assertEquals((await refresh(b.body.refreshToken)).status, 401);
    });

    await t.step("refresh: picks up role changes and refuses deactivated users", async () => {
      const reg = await register("refresh-role");
      await query("UPDATE users SET role = 'seller' WHERE email = $1", [fx.email("refresh-role")]);
      const res = await refresh(reg.body.refreshToken);
      assertEquals(roleOf(res.body.accessToken), "seller");

      await query("UPDATE users SET is_active = false WHERE email = $1", [fx.email("refresh-role")]);
      assertEquals((await refresh(res.body.refreshToken)).status, 401);
    });

    await t.step("renaming a store to a taken name → 409", async () => {
      const seller = await fx.seller("rename");
      const res = await api("PUT", `${USERS}/users/seller`, {
        token: seller.token,
        body: { store_name: `Test ${fx.tag} Upgraded` },
      });
      assertEquals(res.status, 409);
    });
  } finally {
    await fx.cleanup();
    await services.stop();
  }
});
