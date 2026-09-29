import { Pool, PostgresError } from "postgres";

const pool = new Pool({
  hostname: Deno.env.get("DB_HOST") || "localhost",
  port: Number(Deno.env.get("DB_PORT")) || 5432,
  database: Deno.env.get("DB_NAME") || "marketplace",
  user: Deno.env.get("DB_USER") || "marketplace_user",
  password: Deno.env.get("DB_PASSWORD") || "marketplace_pass",
}, 10);

export async function query(sql: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    const result = await client.queryObject(sql, params);
    return result;
  } finally {
    client.release();
  }
}

export type TxQuery = (sql: string, params?: unknown[]) => ReturnType<typeof query>;

// Runs `fn` on a single pooled connection inside BEGIN/COMMIT, rolling back
// if it throws. Use for multi-statement writes that must succeed or fail as one.
export async function withTransaction<T>(fn: (tx: TxQuery) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.queryObject("BEGIN");
    try {
      const result = await fn((sql, params) => client.queryObject(sql, params));
      await client.queryObject("COMMIT");
      return result;
    } catch (err) {
      await client.queryObject("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}

// True for a UNIQUE violation, optionally only on the named constraint.
export function isUniqueViolation(err: unknown, constraint?: string) {
  return err instanceof PostgresError && err.fields.code === "23505" &&
    (!constraint || err.fields.constraint === constraint);
}

export default pool;