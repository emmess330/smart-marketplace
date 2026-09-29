import { assert, assertEquals, assertRejects } from "@std/assert";
import { isUniqueViolation, query, withTransaction } from "../shared/db.ts";
import { Fixtures, requireMigrations, suiteOptions } from "./helpers.ts";

Deno.test({ name: "shared/db", ...suiteOptions }, async (t) => {
  await requireMigrations();
  const fx = new Fixtures();
  try {
    const seller = await fx.seller("db");
    const productId = await fx.product(seller.sellerId, { stock: 10 });
    const stock = async () =>
      ((await query("SELECT stock_quantity FROM products WHERE id = $1", [productId]))
        .rows[0] as { stock_quantity: number }).stock_quantity;

    await t.step("withTransaction commits on success", async () => {
      await withTransaction((tx) =>
        tx("UPDATE products SET stock_quantity = 7 WHERE id = $1", [productId])
      );
      assertEquals(await stock(), 7);
    });

    await t.step("withTransaction rolls back every statement when it throws", async () => {
      await assertRejects(() =>
        withTransaction(async (tx) => {
          await tx("UPDATE products SET stock_quantity = 0 WHERE id = $1", [productId]);
          throw new Error("boom");
        })
      );
      assertEquals(await stock(), 7);
    });

    await t.step("FOR UPDATE makes a second transaction wait for the first", async () => {
      const start = Date.now();
      let secondGotLockAfter = 0;
      const first = withTransaction(async (tx) => {
        await tx("SELECT id FROM products WHERE id = $1 FOR UPDATE", [productId]);
        await new Promise((r) => setTimeout(r, 500));
      });
      await new Promise((r) => setTimeout(r, 100));
      const second = withTransaction(async (tx) => {
        await tx("SELECT id FROM products WHERE id = $1 FOR UPDATE", [productId]);
        secondGotLockAfter = Date.now() - start;
      });
      await Promise.all([first, second]);
      assert(secondGotLockAfter >= 450, `second transaction got the lock after ${secondGotLockAfter}ms`);
    });

    await t.step("isUniqueViolation matches by constraint name", async () => {
      const err = await query(
        "INSERT INTO sellers (user_id, store_name) VALUES ($1, $2)",
        [seller.id, `Test ${fx.tag} duplicate`],
      ).catch((e) => e);
      assert(isUniqueViolation(err));
      assert(isUniqueViolation(err, "sellers_user_id_unique"));
      assert(!isUniqueViolation(err, "sellers_store_name_key"));
      assert(!isUniqueViolation(new Error("unique")));
    });
  } finally {
    await fx.cleanup();
  }
});
