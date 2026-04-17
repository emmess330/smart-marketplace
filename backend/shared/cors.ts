import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";

export const corsConfig = cors({
  origin: "*",  // Allow all origins temporarily
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});