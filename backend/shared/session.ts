import { query, type TxQuery } from "./db.ts";
import { generateTokens } from "./jwt.ts";

// Issues an access/refresh token pair and records the refresh token in
// `sessions`. Pass `run` to write the session inside a transaction.
export async function createSession(
  userId: string,
  role: string,
  run: TxQuery = query,
) {
  const tokens = await generateTokens(userId, role);
  await run(
    `INSERT INTO sessions (user_id, refresh_token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [userId, tokens.refreshToken],
  );
  return tokens;
}
