# Smart Marketplace — implementation guide

How to run and develop the **smart-marketplace** stack locally: PostgreSQL, optional Elasticsearch, Deno API services, Python ML services, and the Next.js frontend.

## Architecture (quick reference)

| Component | Technology | Port (default) |
|-----------|------------|------------------|
| Auth API | Deno (Hono) | **8001** |
| Products API | Deno (Hono) | **8002** |
| Orders API (cart, Stripe) | Deno (Hono) | **8003** |
| Users API | Deno (Hono) | **8004** |
| Search API (Elasticsearch) | Deno (Hono) | **8005** |
| Recommender | Python (FastAPI) | **8006** |
| Forecasting | Python (FastAPI) | **8007** |
| Frontend | Next.js | **3000** |
| Optional smoke API | Deno (`backend/src/main.ts`) | **8000** |

The frontend calls these bases from `frontend/lib/api.ts` (`localhost` with per-service ports).

## Prerequisites

- **Deno** 1.x+ ([install](https://deno.land/))
- **Node.js** 20+ and npm (for the frontend)
- **Python** 3.11+ (for ML services)
- **Docker** and Docker Compose (recommended for PostgreSQL and Elasticsearch)

## 1. Clone and environment

```bash
cd smart-marketplace
```

Copy environment variables for the backend:

```bash
cp .env.example backend/.env
```

Edit `backend/.env`: set `JWT_SECRET` to a long random string, and add **Stripe test** keys from the [Stripe dashboard](https://dashboard.stripe.com/test/apikeys) if you use checkout.

The repo root `.env.example` documents variables; the Deno services load **`backend/.env`** when you pass `--env-file=.env` (see commands below).

## 2. Database (PostgreSQL)

### Option A — Docker Compose (recommended)

From the repository root:

```bash
docker compose up -d postgres
```

This starts PostgreSQL with user/database/password matching `.env.example` (`marketplace_user` / `marketplace` / `marketplace_pass` on port **5432**).

### Option B — Local PostgreSQL (Homebrew / native install)

Use credentials that match **`backend/.env`** (defaults below mirror `.env.example`).

| Variable | Default |
|----------|---------|
| `DB_USER` | `marketplace_user` |
| `DB_PASSWORD` | `marketplace_pass` |
| `DB_NAME` | `marketplace` |
| `DB_URL` | `postgresql://marketplace_user:marketplace_pass@127.0.0.1:5432/marketplace` |

Use **`127.0.0.1`** in `DB_URL` (not `localhost`) so the client hits IPv4 consistently. `localhost` can resolve to `::1` first; you might accidentally talk to a different Postgres than you expect when two installs exist.

**One-shot SQL script (from repo root):**

```bash
# Adjust -U if your superuser is not your macOS login (sometimes `postgres` on Linux)
psql -d postgres -f database/scripts/create_local_marketplace_role.sql
```

If the database **already exists**, the `CREATE DATABASE` line in that file will error once — comment out that line and re-run, or ignore if the role was created.

**Equivalent manual SQL** (run in `psql` as a superuser):

```sql
CREATE USER marketplace_user WITH PASSWORD 'marketplace_pass';
CREATE DATABASE marketplace OWNER marketplace_user;
```

(`CREATE USER` fails if the role exists; use `ALTER USER ... PASSWORD` to change the password.)

**Using another existing Postgres user instead**

Edit **`backend/.env`** so `DB_URL` (and `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST`, `DB_PORT`) match that user and database. Example:

```env
DB_URL=postgresql://myuser:mypassword@127.0.0.1:5432/mydbname
```

Restart Deno services after changes. ML code loads the same file via `ml/db_config.py`.

### If you see `FATAL: role "marketplace_user" does not exist`

PostgreSQL is running, but not the instance that defines `marketplace_user`. Typical cases:

1. **Use Docker (simplest)** — stop any other server on port 5432 if it conflicts, then:
   ```bash
   docker compose up -d postgres
   ```
   Apply migrations (see below). ML scripts read **`DB_URL` from `backend/.env`** via `ml/db_config.py`.

2. **Homebrew / native Postgres** — follow **Option B** above (`database/scripts/create_local_marketplace_role.sql` or set `DB_URL` to an existing role).

3. **Port clash** — if Docker Postgres is mapped to another port, set `DB_URL` in `backend/.env` accordingly (and keep Deno `DB_*` vars in sync).

### Apply migrations

**Easiest** (loads `DB_URL` from `backend/.env` if present):

```bash
./database/apply-migrations.sh
```

Or run the SQL files in order yourself:

```bash
# Example using psql and Docker
docker exec -i marketplace_db psql -U marketplace_user -d marketplace < database/migrations/001_init.sql
docker exec -i marketplace_db psql -U marketplace_user -d marketplace < database/migrations/002_seed.sql
docker exec -i marketplace_db psql -U marketplace_user -d marketplace < database/migrations/003_orders_payment_unique.sql
```

Or with local `psql` (stop on first error for `001_init` and `003`):

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/001_init.sql
psql "$DB_URL" -f database/migrations/002_seed.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/003_orders_payment_unique.sql
```

Without `001_init.sql`, ML scripts and the app will fail with errors like `relation "order_items" does not exist`.

### Demo accounts (local development only)

`002_seed.sql` creates a demo seller so a fresh install has a seller account and sample products to browse: **`demo.seller@smart-marketplace.local`** / **`ChangeMe-DemoSeller-2024`**.

This account and password are for local development only. **Do not run `002_seed.sql` against any shared, staging, or production database** — rotate or delete this account first if you ever do.

## 3. Elasticsearch (search)

Search indexing and queries expect Elasticsearch (default `ES_HOST=http://localhost:9200`).

```bash
docker compose up -d elasticsearch
```

Optional: **Kibana** on port 5601 for debugging indices:

```bash
docker compose up -d kibana
```

After backends are running, populate the index once (example):

```bash
curl -X POST http://localhost:8005/search/index
```

## 4. Deno backend services

Working directory: **`backend/`**.

Install/cache dependencies on first run (Deno will fetch imports automatically). Start each service in a **separate terminal**, or use the PowerShell helper on Windows (update `$root` in the script to your machine path).

**macOS / Linux (example — run each line in its own terminal):**

```bash
cd backend
deno run --allow-net --allow-env --allow-read --env-file=.env auth/main.ts
```

```bash
deno run --allow-net --allow-env --allow-read --env-file=.env products/main.ts
```

```bash
deno run --allow-net --allow-env --allow-read --env-file=.env orders/main.ts
```

```bash
deno run --allow-net --allow-env --allow-read --env-file=.env users/main.ts
```

```bash
deno run --allow-net --allow-env --allow-read --env-file=.env search/main.ts
```

Convenience tasks from `backend/deno.json` (each still needs its own process):

```bash
deno task dev:auth
deno task dev:products
deno task dev:orders
deno task dev:users
```

> **Note:** Add a `dev:search` task locally if you want `deno task dev:search` mirroring the others.

**macOS / Linux:** from the repo root, `./backend/start-all.sh` (executable). On macOS it opens **new Terminal windows** per service; on Linux it runs services in the **background** and writes logs under `/tmp` (or `$TMPDIR`). Same prerequisites as below.

**Windows:** run `backend/start-all.ps1` (right-click → Run with PowerShell, or `pwsh -File backend/start-all.ps1`). It resolves the repo path from the script location—no need to edit paths. Ensure `backend/.env` exists and `ml/.venv` is created if you want the Python services to start; otherwise the script skips them with a warning.

If `permission denied`, run: `chmod +x backend/start-all.sh`

## 5. Python ML services

`ml/requirements.txt` lists **only what the recommender and forecasting APIs need** (FastAPI, uvicorn, SQLAlchemy, pandas, scikit-learn, Prophet, etc.). It does **not** include Jupyter/notebook stacks. An older full `pip freeze` pulled in **`pywinpty`** (Windows-only); on **macOS with Python 3.13** that fails to build. If you still have a broken venv, remove `ml/.venv` and reinstall:

```bash
cd ml
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -U pip
pip install -r requirements.txt
```

Train models if required (see `ml/recommender/train.py`, `ml/forecasting/train.py`), then:

**Terminal 1 — recommender (port 8006)**

```bash
cd ml/recommender
python api.py
```

**Terminal 2 — forecasting (port 8007)**

```bash
cd ml/forecasting
python api.py
```

## 6. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app assumes API hosts on the same machine (`localhost`); for LAN access, `frontend/lib/api.ts` builds bases from `window.location.hostname`.

Optional: create `frontend/.env.local` for public keys only, for example:

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

(Keep secret keys in `backend/.env` only.)

## 7. Typical startup order

1. **PostgreSQL** (and run migrations).
2. **Elasticsearch** (if using search).
3. All **Deno** services (8001–8005).
4. **Python** APIs (8006–8007), if you need recommendations/forecasting.
5. **Next.js** (3000).

Verify quickly:

- `GET http://localhost:8002/products` — product list  
- `GET http://localhost:8006/health` and `GET http://localhost:8007/health` — ML services  

## 8. Import Kaggle products (optional)

Data file: **`scripts/combined_dataset.csv`** (Kaggle “combined” export; rename if you only have `Combined_dataset.csv`).

The importer **`scripts/import_kaggle_products.py`** reads **`DB_URL`** from **`backend/.env`** and uses the first row from `SELECT id FROM sellers ORDER BY created_at LIMIT 1`. If **`sellers` is empty**, it **creates** a demo user + seller (`importseller@local.marketplace` — password printed in the console; change after login).

```bash
cd scripts
python import_kaggle_products.py
```

Use a Python environment that has **`pandas`** and **`sqlalchemy`** (e.g. activate `ml/.venv` first).

## 9. Production notes

- Restrict **CORS** in `backend/shared/cors.ts` (currently permissive for development).
- Do not commit real **Stripe** or **JWT** secrets.
- Use HTTPS and a reverse proxy or API gateway in production instead of exposing many ports.

## 10. Repository layout (implementation)

| Path | Role |
|------|------|
| `backend/auth`, `products`, `orders`, `users`, `search` | Hono microservices |
| `backend/shared` | DB pool, JWT, CORS, middleware |
| `database/migrations` | PostgreSQL schema and seed |
| `ml/recommender`, `ml/forecasting` | FastAPI + models |
| `frontend/app` | Next.js App Router pages |
| `frontend/lib/api.ts` | API client and port configuration |
| `docker-compose.yml` | Postgres, Elasticsearch, Kibana |


