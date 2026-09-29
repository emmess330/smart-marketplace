// Shared test harness: starts services on dedicated test ports, creates
// tagged fixture data and removes it afterwards, and wraps HTTP/Stripe calls.
//
// Tests run against the database in backend/.env but only ever touch rows
// they created themselves (users with a per-run email tag, and everything
// hanging off them). Services are started on 18001-18007 so they don't clash
// with dev servers on 8001-8007, and point at a throwaway Elasticsearch index.
import { generateTokens } from "../shared/jwt.ts";
import { query } from "../shared/db.ts";

const BACKEND_DIR = new URL("../", import.meta.url).pathname;
const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const LOG_DIR = `${BACKEND_DIR}tests/.logs/`;
export const ML_DIR = `${REPO_ROOT}ml/`;
// Override with ML_PYTHON to test against a different environment.
const ML_PYTHON = Deno.env.get("ML_PYTHON") ?? `${ML_DIR}.venv/bin/python`;

export type ServiceName =
  | "auth"
  | "products"
  | "orders"
  | "users"
  | "search"
  | "recommender"
  | "forecasting";

const PORTS: Record<ServiceName, number> = {
  auth: 18001,
  products: 18002,
  orders: 18003,
  users: 18004,
  search: 18005,
  recommender: 18006,
  forecasting: 18007,
};

export const serviceUrl = (name: ServiceName) =>
  `http://127.0.0.1:${PORTS[name]}`;

const ES_URL = Deno.env.get("ES_HOST") ?? "http://localhost:9200";
export const TEST_ES_INDEX = `products_test_${crypto.randomUUID().slice(0, 8)}`;

// ── Optional dependencies: tests needing them are skipped when absent ──

// A real test-mode key — not live, and not the .env.example placeholder.
const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
export const hasStripe = stripeKey.startsWith("sk_test_") && !stripeKey.includes("your_key");

export const hasMl = (() => {
  try {
    return Deno.statSync(ML_PYTHON).isFile;
  } catch {
    return false;
  }
})();

export async function esAvailable() {
  try {
    const res = await fetch(ES_URL, { signal: AbortSignal.timeout(1000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

// Makes recent writes searchable immediately (ES is near-real-time).
export async function refreshTestIndex() {
  const res = await fetch(`${ES_URL}/${TEST_ES_INDEX}/_refresh`, { method: "POST" });
  await res.body?.cancel();
}

export async function deleteTestIndex() {
  const res = await fetch(`${ES_URL}/${TEST_ES_INDEX}`, { method: "DELETE" });
  await res.body?.cancel();
}

// ── Services ──

type Running = { name: ServiceName; child: Deno.ChildProcess; logs: Promise<unknown> };

// Rate limits high enough that ordinary tests never trip them;
// rate_limit_test.ts overrides these with tight ones.
const RELAXED_RATE_LIMITS = {
  RATE_LIMIT_LOGIN_FAILURES: "10000",
  RATE_LIMIT_LOGIN_PER_IP: "10000",
  RATE_LIMIT_REGISTER_PER_IP: "10000",
  RATE_LIMIT_REFRESH_PER_IP: "10000",
};

function spawn(
  name: ServiceName,
  esEnabled: boolean,
  extraEnv: Record<string, string>,
): Running {
  const env: Record<string, string> = {
    ...RELAXED_RATE_LIMITS,
    SERVICE_PORT: String(PORTS[name]),
    ES_INDEX: TEST_ES_INDEX,
    // Unless a test opts in, point services at a closed port so nothing is
    // ever written to a real Elasticsearch index.
    ES_HOST: esEnabled ? ES_URL : "http://127.0.0.1:1",
    ...extraEnv,
  };
  const command = name === "recommender" || name === "forecasting"
    ? new Deno.Command(ML_PYTHON, {
      args: ["-m", "uvicorn", "api:app", "--host", "127.0.0.1", "--port", String(PORTS[name])],
      cwd: `${ML_DIR}${name}`,
      env,
      stdout: "piped",
      stderr: "piped",
    })
    : new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-net", "--allow-env", "--allow-read", "--env-file=.env", `${name}/main.ts`],
      cwd: BACKEND_DIR,
      env,
      stdout: "piped",
      stderr: "piped",
    });

  const child = command.spawn();
  Deno.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = `${LOG_DIR}${name}.log`;
  Deno.writeTextFileSync(logPath, "");
  const sink = async (stream: ReadableStream<Uint8Array>) => {
    const file = await Deno.open(logPath, { append: true });
    await stream.pipeTo(file.writable);
  };
  const logs = Promise.all([sink(child.stdout), sink(child.stderr)]);
  return { name, child, logs };
}

async function waitForPort(svc: Running, timeoutMs: number) {
  let exited = false;
  svc.child.status.then(() => (exited = true));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) break;
    try {
      const conn = await Deno.connect({ hostname: "127.0.0.1", port: PORTS[svc.name] });
      conn.close();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(
    `${svc.name} did not start on port ${PORTS[svc.name]}` +
      ` (see backend/tests/.logs/${svc.name}.log)`,
  );
}

export async function startServices(
  names: ServiceName[],
  { elasticsearch = false, env = {} as Record<string, string> } = {},
) {
  for (const name of names) {
    try {
      const conn = await Deno.connect({ hostname: "127.0.0.1", port: PORTS[name] });
      conn.close();
      throw new Error(`Port ${PORTS[name]} (${name}) is already in use — is a previous test run still going?`);
    } catch (err) {
      if (!(err instanceof Deno.errors.ConnectionRefused)) throw err;
    }
  }

  const running = names.map((name) => spawn(name, elasticsearch, env));
  const stop = async () => {
    for (const svc of running) {
      try {
        svc.child.kill("SIGTERM");
      } catch { /* already exited */ }
      await svc.child.status;
      await svc.logs.catch(() => {});
    }
  };
  try {
    // Python services import pandas/prophet at startup, so allow them longer.
    await Promise.all(running.map((svc) =>
      waitForPort(svc, svc.name === "recommender" || svc.name === "forecasting" ? 90_000 : 30_000)
    ));
  } catch (err) {
    await stop();
    throw err;
  }
  return { stop };
}

// ── HTTP ──

export type ApiResponse = { status: number; body: Record<string, any> };

export async function api(
  method: string,
  url: string,
  { token, body, headers = {} }: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResponse> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, any> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch { /* non-JSON body */ }
  return { status: res.status, body: parsed };
}

// ── Stripe (test mode only) ──

export async function stripe(path: string, params?: Record<string, string>) {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key.startsWith("sk_test_")) throw new Error("Refusing to call Stripe without a test-mode key");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: params ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? new URLSearchParams(params) : undefined,
  });
  return await res.json();
}

// Confirms a payment intent with Stripe's test Visa card, as the browser would.
export async function payWithTestCard(paymentIntentId: string) {
  const confirmed = await stripe(`/payment_intents/${paymentIntentId}/confirm`, {
    payment_method: "pm_card_visa",
    return_url: "http://localhost:3000/orders",
  });
  if (confirmed.status !== "succeeded") {
    throw new Error(`Test payment failed: ${JSON.stringify(confirmed.error ?? confirmed.status)}`);
  }
}

export const paymentIntentId = (clientSecret: string) =>
  clientSecret.split("_secret_")[0];

export async function amountRefunded(paymentIntentId: string) {
  const pi = await stripe(`/payment_intents/${paymentIntentId}?expand[]=latest_charge`);
  return Number(pi.latest_charge?.amount_refunded ?? 0);
}

// ── Fixtures ──

export type TestUser = { id: string; email: string; token: string };
export type TestSeller = TestUser & { sellerId: string };

// Creates tagged test data and removes everything it created in cleanup().
export class Fixtures {
  readonly tag = crypto.randomUUID().slice(0, 8);

  email(name: string) {
    return `test-${this.tag}-${name}@example.test`;
  }

  async user(name: string, role: "buyer" | "seller" = "buyer"): Promise<TestUser> {
    const email = this.email(name);
    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, 'not-a-real-hash', $2, $3) RETURNING id`,
      [email, `Test ${name}`, role],
    );
    const id = (result.rows[0] as { id: string }).id;
    const { accessToken } = await generateTokens(id, role);
    return { id, email, token: accessToken };
  }

  async seller(name: string): Promise<TestSeller> {
    const user = await this.user(name, "seller");
    const result = await query(
      "INSERT INTO sellers (user_id, store_name) VALUES ($1, $2) RETURNING id",
      [user.id, `Test ${this.tag} ${name}`],
    );
    return { ...user, sellerId: (result.rows[0] as { id: string }).id };
  }

  async product(
    sellerId: string,
    { name = "Widget", price = 5, stock = 5 } = {},
  ): Promise<string> {
    const result = await query(
      `INSERT INTO products (seller_id, name, price, stock_quantity)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [sellerId, `Test ${this.tag} ${name}`, price, stock],
    );
    return (result.rows[0] as { id: string }).id;
  }

  // Inserts an order directly (no payment), for analytics/forecast tests.
  async order(
    buyerId: string,
    items: { productId: string; quantity: number; price: number }[],
    { status = "confirmed", daysAgo = 0 } = {},
  ) {
    const total = items.reduce((sum, i) => sum + i.quantity * i.price, 0);
    const result = await query(
      `INSERT INTO orders (user_id, status, total_amount, shipping_address, created_at)
       VALUES ($1, $2, $3, '{}', NOW() - make_interval(days => $4)) RETURNING id`,
      [buyerId, status, total, daysAgo],
    );
    const orderId = (result.rows[0] as { id: string }).id;
    for (const item of items) {
      await query(
        `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase)
         VALUES ($1, $2, $3, $4)`,
        [orderId, item.productId, item.quantity, item.price],
      );
    }
    return orderId;
  }

  async cleanup() {
    const pattern = `test-${this.tag}-%@example.test`;
    const sellers = await query(
      "SELECT s.id FROM sellers s JOIN users u ON u.id = s.user_id WHERE u.email LIKE $1",
      [pattern],
    );
    for (const row of sellers.rows as { id: string }[]) {
      try {
        Deno.removeSync(`${ML_DIR}forecasting/forecast_${row.id}.pkl`);
      } catch { /* no forecast was trained */ }
    }
    // Orders don't cascade from users; deleting users cascades to sellers,
    // products, cart items and sessions.
    await query(
      "DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)",
      [pattern],
    );
    await query("DELETE FROM users WHERE email LIKE $1", [pattern]);
  }
}

// Fails fast with a clear message if the schema is behind the code.
export async function requireMigrations() {
  const result = await query(
    `SELECT conname FROM pg_constraint
     WHERE conname IN ('orders_stripe_payment_id_unique', 'sellers_user_id_unique')`,
  );
  const pending = await query("SELECT to_regclass('pending_checkouts') IS NOT NULL AS present");
  if (result.rows.length < 2 || !(pending.rows[0] as { present: boolean }).present) {
    throw new Error("Database is missing migrations 003-005 — run ./database/apply-migrations.sh");
  }
}

// DB pool connections and service child processes outlive individual steps,
// so the resource/op sanitizers are disabled for suite-level tests.
export const suiteOptions = { sanitizeResources: false, sanitizeOps: false };
