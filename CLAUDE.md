# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Smart Marketplace — a polyglot microservices e-commerce app: a Next.js frontend, five independent Deno/Hono backend services, two Python/FastAPI ML services, PostgreSQL, and Elasticsearch. Built as a university project (CTEC3451); `docs/` contains report/viva materials, not developer docs — for setup and architecture, `README-IMPLEMENTATION.md` and `docs/system-architecture.md` are the authoritative references and are kept up to date.

## Architecture

Each backend concern is a **separate Deno process with its own port** — there is no API gateway. The frontend's `frontend/lib/api.ts` talks to each service directly by port, building base URLs from `window.location.hostname` (so it works over LAN, not just localhost).

| Service | Tech | Port | Path |
|---|---|---|---|
| Auth | Deno/Hono | 8001 | `backend/auth/main.ts` |
| Products | Deno/Hono | 8002 | `backend/products/main.ts` |
| Orders (cart, checkout, Stripe) | Deno/Hono | 8003 | `backend/orders/main.ts` |
| Users | Deno/Hono | 8004 | `backend/users/main.ts` |
| Search | Deno/Hono + Elasticsearch | 8005 | `backend/search/main.ts` |
| Recommender | Python/FastAPI | 8006 | `ml/recommender/api.py` |
| Forecasting | Python/FastAPI | 8007 | `ml/forecasting/api.py` |
| Frontend | Next.js (App Router) | 3000 | `frontend/` |

`backend/shared/` holds cross-service code: `db.ts` (a `postgres` connection pool via a `query()` helper), `jwt.ts` (HS256 sign/verify using `djwt`), `middleware.ts` (`authMiddleware` — reads `Authorization: Bearer`, sets `userId`/`role` on context), `cors.ts`. Every service imports these rather than duplicating them; each Hono app also self-registers `corsConfig` and calls `Deno.serve({ port })` directly — there's no shared bootstrap.

Data model (`database/migrations/001_init.sql`): `users` → `sellers` (1:1 extension, not a subtype column) → `products` → `cart_items` / `orders` → `order_items`. `sessions` stores refresh tokens. All PKs are `gen_random_uuid()`; `updated_at` is kept current by a Postgres trigger, not application code.

**Search sync**: the Products service pushes documents to Elasticsearch on create/update/(soft)delete via `syncProductToSearch()` in `backend/products/main.ts` — this is fire-and-forget (`try/catch` with a `console.warn`), so ES can drift from Postgres if indexing fails. There's no reconciliation job; if search results look stale, re-run `POST /search/index` on the Search service (requires `X-Admin-Key: $ADMIN_KEY` from `backend/.env`; it drops and rebuilds the index).

**Soft deletes**: products are never hard-deleted — `DELETE /products/:id` sets `is_active = false`. All product reads filter on `is_active = true`.

**ML services** load `DB_URL` via `ml/db_config.py`, which reads `backend/.env` (not a `ml/.env`) and normalizes `localhost` → `127.0.0.1` to avoid IPv6 resolution surprises. Models are trained offline (`train.py` in each service dir) and served from pickled files (`model.pkl`, `forecast_*.pkl`) loaded at API startup — there's no online/incremental training. Retrain and restart the API to pick up new data.

**Auth**: JWT access tokens (1h) + refresh tokens (7d), both HMAC-signed with `JWT_SECRET`. Stored in the frontend as cookies (`access_token`, `refresh_token`) via `js-cookie`, attached as `Authorization: Bearer` headers by `frontend/lib/api.ts`. There is no token-refresh interceptor currently — expired access tokens will 401 rather than silently refresh.

**Frontend state**: global client state (auth user, cart item count) lives in small Zustand stores (`frontend/lib/store.ts`), not React context. Server data fetching goes through the typed API clients in `frontend/lib/api.ts` (`authApi`, `productsApi`, `ordersApi`, `usersApi`, `searchApi`, `recommendApi`, `analyticsApi`, `forecastApi`) — add new backend calls there rather than calling `axios` directly from components.

Note: `backend/src/main.ts` (port 8000) is a legacy/smoke-test entry point separate from the five real services — don't confuse it with the actual API surface.

## Commands

There is no root-level build/test/lint runner — each part of the stack is developed independently.

### Backend (Deno services)
Run from `backend/`, one process per service, each needs its own terminal:
```bash
deno run --allow-net --allow-env --allow-read --env-file=.env auth/main.ts
deno run --allow-net --allow-env --allow-read --env-file=.env products/main.ts
deno run --allow-net --allow-env --allow-read --env-file=.env orders/main.ts
deno run --allow-net --allow-env --allow-read --env-file=.env users/main.ts
deno run --allow-net --allow-env --allow-read --env-file=.env search/main.ts
```
Or with hot reload via `backend/deno.json` tasks (auth/products/orders/users only — no `dev:search` task defined):
```bash
deno task dev:auth
deno task dev:products
deno task dev:orders
deno task dev:users
```
Or all at once: `./backend/start-all.sh` (macOS: opens Terminal windows per service; Linux: backgrounds them, logs to `/tmp`).

Tests: `deno task test` (from `backend/`) runs the integration suite in `backend/tests/`. It spawns the services it needs on test ports 18001–18007 (via the `SERVICE_PORT` env var every service honours — not `PORT`, which `.env.example` sets for the legacy entry point) and uses a throwaway Elasticsearch index (`ES_INDEX`), so dev servers can stay up. Fixtures are tagged per run and deleted afterwards — follow the `Fixtures` helper in `tests/helpers.ts` rather than touching existing rows. Stripe/ML/Elasticsearch steps skip when those aren't available. No linter is configured for the backend.

### Frontend
Run from `frontend/`:
```bash
npm install
npm run dev      # next dev --webpack --hostname 0.0.0.0
npm run build     # next build --webpack
npm run lint       # next lint
```
No test suite is configured. Note `frontend/AGENTS.md` / `frontend/CLAUDE.md` warn that this is a bleeding-edge Next.js version (16.2.3 + React 19.2) whose APIs may diverge from training data — check `node_modules/next/dist/docs/` before relying on prior Next.js knowledge for anything nonstandard.

### ML services
Run from `ml/`, with a venv active:
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```
Then per service (each needs its own terminal, from that service's directory):
```bash
cd ml/recommender && python api.py    # port 8006
cd ml/forecasting && python api.py    # port 8007
```
Retrain models with `python train.py` in the respective directory before starting the API if `model.pkl`/`forecast_*.pkl` are missing or stale. The ML HTTP APIs are covered by `backend/tests/ml_test.ts`; there are no Python unit tests.

### Database
```bash
docker compose up -d postgres          # or postgres + elasticsearch + kibana
./database/apply-migrations.sh          # applies 001_init.sql then 002_seed.sql, reads DB_URL from backend/.env
```
Use `127.0.0.1` (not `localhost`) in `DB_URL` — `localhost` can resolve to `::1` and hit a different Postgres instance if more than one is installed. If migrations haven't been applied, ML scripts and API calls fail with `relation "order_items" does not exist`; if you see `role "marketplace_user" does not exist`, another Postgres instance (e.g. Homebrew) is likely bound to port 5432 instead of Docker's.

### Environment setup
```bash
cp .env.example backend/.env    # then set JWT_SECRET and Stripe test keys
```
Deno services load `backend/.env` via `--env-file=.env`; ML scripts load the same file via `ml/db_config.py`. `frontend/.env.local` is only for `NEXT_PUBLIC_*` values (e.g. Stripe publishable key) — never put secrets there.

### Data import
```bash
cd scripts && python import_kaggle_products.py
```
Reads `DB_URL` from `backend/.env`, attaches products to the first seller in the DB (creating a demo seller if none exists). Requires `pandas`/`sqlalchemy` (the `ml/.venv` env has these).

## Known rough edges worth knowing before you touch related code

- CORS is wide open (`origin: "*"`) across every backend and ML service — this is dev-only and called out as such in `README-IMPLEMENTATION.md` §9; don't tighten it without checking if that's actually in scope.
- Automated tests cover the backend and ML HTTP APIs only (`backend/tests/`); the frontend has none. `docs/test-plan.md` is the original manual test plan (report material), not the executable suite.
- `.env.example` at the repo root contains real-looking Stripe **test**-mode keys committed to the repo; these are sandbox keys, not production secrets, but treat any request to add real secrets to tracked files as something to flag.
