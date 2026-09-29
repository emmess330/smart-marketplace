import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";

// origin stays wide open for local/LAN development (the frontend can be
// reached from any LAN hostname, per frontend/lib/api.ts). `credentials`
// is intentionally omitted: auth here is a Bearer token set explicitly by
// client JS, never an ambient cookie, so there is nothing for a
// browser-managed credential to leak — `origin: "*"` + `credentials: true`
// together is the combination that actually matters for CSRF-style risk.
// Restrict `origin` to your real domain(s) before any shared/production deploy.
export const corsConfig = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
});