import json
import re
import secrets
import sys
from pathlib import Path
from uuid import uuid4

import bcrypt
import pandas as pd
from sqlalchemy import create_engine, text

# --- Configuration ---
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
CSV_PATH = SCRIPT_DIR / "combined_dataset.csv"


def _load_db_url() -> str:
    env_file = REPO_ROOT / "backend" / ".env"
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("DB_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return "postgresql://marketplace_user:marketplace_pass@127.0.0.1:5432/marketplace"


DB_URL = _load_db_url()
# Name the psycopg2 driver: SQLAlchemy 2.1 made plain postgresql:// URLs use
# psycopg (v3), which isn't installed (same fix as ml/db_config.py).
engine = create_engine(
    DB_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
    if DB_URL.startswith("postgresql://") else DB_URL
)

# Demo seller created only when `sellers` is empty. Password is generated fresh
# per run (never committed to source) and printed once — save it, it isn't
# stored anywhere else.
DEMO_SELLER_EMAIL = "importseller@local.marketplace"
DEMO_STORE_NAME = "Kaggle Import Store"


def _generate_demo_password_hash() -> tuple[str, str]:
    password = secrets.token_urlsafe(18)
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
    return password, password_hash


def clean_price(price_str):
    if pd.isna(price_str):
        return 10.0
    cleaned = re.sub(r"[^\d.]", "", str(price_str))
    try:
        return float(cleaned)
    except Exception:
        return 10.0


def format_images(images_value):
    if pd.isna(images_value) or not images_value:
        return "[]"
    urls = []
    if isinstance(images_value, list):
        for item in images_value:
            if isinstance(item, str):
                urls.extend([u.strip() for u in item.split(",") if u.strip()])
            else:
                urls.append(str(item).strip())
    else:
        urls = [u.strip() for u in str(images_value).split(",") if u.strip()]
    return json.dumps([{"url": url} for url in urls]) if urls else "[]"


def ensure_seller_id(conn) -> str:
    """Use first seller, or create a demo user + seller row if the table is empty."""
    row = conn.execute(text("SELECT id FROM sellers ORDER BY created_at LIMIT 1")).fetchone()
    if row:
        return str(row[0])

    existing_user = conn.execute(
        text("SELECT id FROM users WHERE email = :e"),
        {"e": DEMO_SELLER_EMAIL},
    ).fetchone()

    if existing_user:
        uid = str(existing_user[0])
        srow = conn.execute(
            text("SELECT id FROM sellers WHERE user_id = :uid"),
            {"uid": uid},
        ).fetchone()
        if srow:
            return str(srow[0])
        sid = str(uuid4())
        conn.execute(
            text(
                "INSERT INTO sellers (id, user_id, store_name) VALUES (:id, :uid, :name)"
            ),
            {"id": sid, "uid": uid, "name": DEMO_STORE_NAME},
        )
        print(f"Created seller row for existing user {DEMO_SELLER_EMAIL}.")
        return sid

    uid = str(uuid4())
    sid = str(uuid4())
    password, password_hash = _generate_demo_password_hash()
    conn.execute(
        text(
            """
            INSERT INTO users (id, email, password_hash, full_name, role)
            VALUES (:id, :email, :hash, :fname, 'seller')
            """
        ),
        {
            "id": uid,
            "email": DEMO_SELLER_EMAIL,
            "hash": password_hash,
            "fname": "Kaggle Import",
        },
    )
    conn.execute(
        text(
            "INSERT INTO sellers (id, user_id, store_name) VALUES (:id, :uid, :name)"
        ),
        {"id": sid, "uid": uid, "name": DEMO_STORE_NAME},
    )
    print(
        f"Created demo seller: {DEMO_SELLER_EMAIL} / password {password} "
        "(generated for this run only — not stored anywhere; save it now and change it after login)."
    )
    return sid


def import_products():
    print(f"Database: {DB_URL.split('@')[-1] if '@' in DB_URL else DB_URL}")
    print(f"CSV: {CSV_PATH}")

    with engine.begin() as conn:
        seller_id = ensure_seller_id(conn)
    print(f"Using seller_id: {seller_id}")

    print("Reading CSV file...")
    try:
        df = pd.read_csv(CSV_PATH)
        print(f"Found {len(df)} rows.")
    except FileNotFoundError:
        print(f"Error: CSV not found at {CSV_PATH}", file=sys.stderr)
        sys.exit(1)

    inserted = 0
    skipped = 0

    with engine.begin() as conn:

        category_cache = {}

        def get_or_create_category(category_name):
            if pd.isna(category_name) or not category_name:
                return None
            clean_name = str(category_name).strip()
            if clean_name in category_cache:
                return category_cache[clean_name]

            result = conn.execute(
                text("SELECT id FROM categories WHERE name ILIKE :name"),
                {"name": clean_name},
            ).fetchone()

            if result:
                category_cache[clean_name] = str(result[0])
                return str(result[0])

            new_id = str(uuid4())
            slug = clean_name.lower().replace(" ", "-").replace("&", "and")
            conn.execute(
                text("INSERT INTO categories (id, name, slug) VALUES (:id, :name, :slug)"),
                {"id": new_id, "name": clean_name, "slug": slug},
            )
            category_cache[clean_name] = new_id
            return new_id

        for idx, row in df.iterrows():
            try:
                name = str(row.get("title", "")).strip()[:500]
                if not name or name.lower() == "nan":
                    skipped += 1
                    continue

                price = 10.0
                for price_col in ("final_price", "initial_price"):
                    val = row.get(price_col)
                    if val is not None and not pd.isna(val):
                        price = clean_price(val)
                        break

                description = str(row.get("product_description", "")).strip()[:1000]
                if description.lower() == "nan":
                    description = ""

                category_id = get_or_create_category(row.get("category"))
                images_json = format_images(row.get("images"))

                conn.execute(
                    text(
                        """
                        INSERT INTO products
                            (id, seller_id, category_id, name, description, price, stock_quantity, images, is_active)
                        VALUES
                            (:id, :seller_id, :category_id, :name, :description, :price, :stock, CAST(:images AS jsonb), true)
                    """
                    ),
                    {
                        "id": str(uuid4()),
                        "seller_id": seller_id,
                        "category_id": category_id,
                        "name": name,
                        "description": description,
                        "price": price,
                        "stock": 100,
                        "images": images_json,
                    },
                )
                inserted += 1
                if inserted % 50 == 0:
                    print(f"  Inserted {inserted} products...")

            except Exception as e:
                print(f"  Skipping row {idx} ('{row.get('title', '?')}'): {e}")
                skipped += 1
                continue

    print(f"\nDone! Inserted {inserted}, skipped {skipped}.")


if __name__ == "__main__":
    import_products()
