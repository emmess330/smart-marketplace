import type { TxQuery } from "./db.ts";

export class StoreNameTakenError extends Error {
  constructor() {
    super("Store name already taken");
  }
}

// Creates the seller row and marks the user as a seller. Call inside a
// transaction so the role and the store are never out of step. With
// `uniquifyName`, a taken name gets a short suffix instead of failing (used
// for the default name generated at registration).
export async function createSellerProfile(
  tx: TxQuery,
  userId: string,
  storeName: string,
  storeDescription: string | null,
  uniquifyName = false,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const name = attempt === 0
      ? storeName
      : `${storeName} ${crypto.randomUUID().slice(0, 4)}`;
    const result = await tx(
      `INSERT INTO sellers (user_id, store_name, store_description)
       VALUES ($1, $2, $3)
       ON CONFLICT (store_name) DO NOTHING
       RETURNING *`,
      [userId, name, storeDescription],
    );
    if (result.rows.length > 0) {
      await tx("UPDATE users SET role = 'seller' WHERE id = $1", [userId]);
      return result.rows[0] as Record<string, unknown>;
    }
    if (!uniquifyName) break;
  }
  throw new StoreNameTakenError();
}
