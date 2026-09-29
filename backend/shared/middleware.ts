import { Context, Next } from "hono/mod.ts";
import { verifyToken } from "./jwt.ts";

// Context variables set by authMiddleware. Type the app with
// `new Hono<{ Variables: AuthVariables }>()` so c.get("userId") is typed.
export type AuthVariables = {
  userId: string;
  role: string;
};

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token);
    c.set("userId", payload.sub);
    c.set("role", payload.role);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}