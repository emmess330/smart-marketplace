import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";

export const corsConfig = cors({
  origin: "http://localhost:3000",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});