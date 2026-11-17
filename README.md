# Smart Marketplace

**A full-stack e-commerce marketplace with personalised recommendations, scalable search and sales forecasting.**

Final-year project for my BSc (Hons) Computer Science at De Montfort University, Leicester (2026), awarded **100% for the software deliverable** (73% for the project module overall).

> Screenshots: _add 2–4 images here (home page, product page, search results, seller dashboard)._
> e.g. `![Home page](docs/screenshots/home.png)`

---

## What it does

- **Buyers** can register and sign in, browse and search products, view product details, manage a cart, check out with Stripe (test mode) and see their order history.
- **Sellers** can create and manage their product listings and see analytics for their products.
- **Search** uses Elasticsearch for fast full-text search and filtering.
- **Recommendations** ("you may also like") and **sales forecasting** come from separate Python machine-learning services, so the core shopping flow keeps working even if a model is unavailable.

## Tech stack

| Area | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Backend services | Deno + Hono (TypeScript): Auth, Products, Orders, Users, Search |
| Database | PostgreSQL (normalised schema, UUID keys, foreign keys, migrations) |
| Search | Elasticsearch |
| Machine learning | Python, FastAPI, pandas, scikit-learn (recommender + forecasting) |
| Payments | Stripe (test mode, with webhooks) |
| Security | JWT access/refresh tokens, bcrypt password hashing, input validation, rate limiting |
| Tooling | Docker Compose, Git, GitHub Actions |

## Architecture

```
Next.js frontend (3000)
   │  REST / JSON
   ├── Auth API        (Deno/Hono, 8001)
   ├── Products API    (Deno/Hono, 8002)
   ├── Orders API      (Deno/Hono, 8003) ── Stripe
   ├── Users API       (Deno/Hono, 8004)
   ├── Search API      (Deno/Hono, 8005) ── Elasticsearch
   ├── Recommender     (FastAPI, 8006)
   └── Forecasting     (FastAPI, 8007)
              │
         PostgreSQL
```

## Project structure

```
frontend/   Next.js app (pages, components, API client in lib/api.ts)
backend/    Deno/Hono microservices and shared modules (auth, DB, CORS)
ml/         Python FastAPI services for recommendations and forecasting
database/   SQL migrations, seed data and setup scripts
docs/       Project documentation
scripts/    Helper scripts for starting services
```

## Running it locally

Full step-by-step instructions are in **[README-IMPLEMENTATION.md](README-IMPLEMENTATION.md)**. In short:

```bash
cp .env.example backend/.env        # then set JWT_SECRET and Stripe test keys
docker compose up -d postgres       # database (Elasticsearch optional)
./database/apply-migrations.sh      # create tables and seed data
# start the Deno services, the Python ML services, then:
cd frontend && npm install && npm run dev
```

## What I learned

- Designing a system as separate services with clear API contracts, and keeping ML features from blocking the core purchase flow.
- Relational data modelling and migrations in PostgreSQL, and indexing data into Elasticsearch for search.
- Building responsive, component-based UIs in Next.js/React with TypeScript.
- Handling payments safely with Stripe, including webhooks for redirect-based payment methods.
- Security basics in practice: hashed passwords, token-based auth, validation and rate limiting.

## Possible improvements

More automated tests, cloud deployment with CI/CD, stricter production CORS settings, and better recommendations as more real interaction data is collected.

---

**Ahmedu Bangura** · [LinkedIn](https://www.linkedin.com/in/ahmedu-bangura-7379348a/)
