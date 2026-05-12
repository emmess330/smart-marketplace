# Smart Marketplace

Full-stack e-commerce marketplace with microservices backend, Next.js frontend, and ML services.

## Architecture

| Service | Port | Runtime | Description |
|---------|------|---------|-------------|
| Gateway | 8000 | Deno + Hono | Health check endpoint |
| Auth | 8001 | Deno + Hono | Registration, login, JWT tokens |
| Products | 8002 | Deno + Hono | Product CRUD, categories |
| Orders | 8003 | Deno + Hono | Cart, checkout, seller analytics |
| Users | 8004 | Deno + Hono | User/seller profiles |
| Search | 8005 | Deno + Hono | Elasticsearch-powered search (optional) |
| Recommender | 8006 | Python + FastAPI | ML recommendations (optional) |
| Forecasting | 8007 | Python + FastAPI | Sales forecasting (optional) |
| Frontend | 3000 | Next.js 16 | PWA storefront |

## Cursor Cloud specific instructions

### Starting services

1. **PostgreSQL**: `docker compose up -d postgres` (must be running first; all backends depend on it)
2. **DB migrations** (first run only): `docker exec -i marketplace_db psql -U marketplace_user -d marketplace < database/migrations/001_init.sql && docker exec -i marketplace_db psql -U marketplace_user -d marketplace < database/migrations/002_seed.sql`
3. **Backend services** (each in its own terminal, from `/workspace/backend`):
   - `deno run --allow-net --allow-env --allow-read src/main.ts` (gateway :8000)
   - `deno run --allow-net --allow-env --allow-read auth/main.ts` (auth :8001)
   - `deno run --allow-net --allow-env --allow-read products/main.ts` (products :8002)
   - `deno run --allow-net --allow-env --allow-read orders/main.ts` (orders :8003)
   - `deno run --allow-net --allow-env --allow-read users/main.ts` (users :8004)
4. **Frontend**: `cd frontend && npm run dev`
5. **ML services** (optional, each in its own terminal):
   - `cd ml/recommender && python3 api.py` (recommender :8006)
   - `cd ml/forecasting && python3 api.py` (forecasting :8007)

### Important caveats

- Docker runs inside a Firecracker VM; requires `fuse-overlayfs` storage driver and `iptables-legacy`. The Docker daemon must be started manually: `sudo dockerd &`.
- Deno is installed at `~/.deno/bin/deno`. Ensure `$DENO_INSTALL/bin` is on PATH.
- Python user packages are at `~/.local/bin` — ensure it's on PATH for `uvicorn`.
- The `next lint` script in `package.json` does not work with Next.js 16 (treated as directory argument). Use `npx eslint .` from `/workspace/frontend` instead.
- `next build` has a pre-existing TypeScript error in `app/search/SearchContent.tsx:239` (Property 'url' does not exist on type 'never'). This is not a blocker for dev mode.
- The `.env.example` at root has default DB credentials matching `docker-compose.yml`. Copy to `.env` for reference, but backend services use env var defaults that match already.
- The frontend connects to each backend microservice directly by port (no reverse proxy). The API base URL auto-detects hostname from `window.location`.
- Elasticsearch and Kibana are optional Docker services defined in `docker-compose.yml`. The Search service (port 8005) requires Elasticsearch to be running. Start with `docker compose up -d elasticsearch` if needed.
- Prophet (ML forecasting) requires `cmdstanpy` which needs a newer Rust toolchain than the default. Install core Python deps without pinned versions if the full `ml/requirements.txt` fails.
