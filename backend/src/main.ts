import { Hono } from "hono/mod.ts";

const app = new Hono();

app.get("/", (c) => c.json({ status: "ok", message: "Marketplace API running" }));
app.get("/health", (c) => c.json({ status: "healthy", timestamp: new Date().toISOString() }));

console.log("Server running on http://localhost:8000");
Deno.serve({ port: 8000 }, app.fetch);