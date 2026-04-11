import { Pool } from "postgres";

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

export default pool;