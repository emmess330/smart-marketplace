-- Run as a PostgreSQL superuser (Homebrew example: your macOS user is often a superuser).
--
--   psql -d postgres -f database/scripts/create_local_marketplace_role.sql
--
-- Defaults match `.env.example`: user `marketplace_user`, password `marketplace_pass`,
-- database `marketplace`. Change this file if your `backend/.env` uses different values.

-- 1) Role (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'marketplace_user') THEN
    CREATE ROLE marketplace_user LOGIN PASSWORD 'marketplace_pass';
  ELSE
    ALTER ROLE marketplace_user WITH PASSWORD 'marketplace_pass';
  END IF;
END
$$;

-- 2) Database — if you see "already exists", skip this line and continue.
CREATE DATABASE marketplace OWNER marketplace_user;
