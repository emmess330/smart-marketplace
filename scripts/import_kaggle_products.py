import pandas as pd
from sqlalchemy import create_engine, text
from uuid import uuid4
import json
import re
import sys

# --- Configuration ---
DB_URL = "postgresql://marketplace_user:marketplace_pass@localhost:5432/marketplace"
CSV_PATH = "scripts/combined_dataset.csv"
SELLER_ID = "acfdc8ba-d956-4018-aad4-ec82a2c9e26c"

engine = create_engine(DB_URL)

def clean_price(price_str):
    if pd.isna(price_str):
        return 10.0
    cleaned = re.sub(r'[^\d.]', '', str(price_str))
    try:
        return float(cleaned)
    except:
        return 10.0

def format_images(images_value):
    if pd.isna(images_value) or not images_value:
        return '[]'
    urls = []
    if isinstance(images_value, list):
        for item in images_value:
            if isinstance(item, str):
                urls.extend([u.strip() for u in item.split(',') if u.strip()])
            else:
                urls.append(str(item).strip())
    else:
        urls = [u.strip() for u in str(images_value).split(',') if u.strip()]
    return json.dumps([{"url": url} for url in urls]) if urls else '[]'

def import_products():
    print("Reading CSV file...")
    try:
        df = pd.read_csv(CSV_PATH)
        print(f"Found {len(df)} rows.")
    except FileNotFoundError:
        print(f"Error: CSV not found at {CSV_PATH}")
        sys.exit(1)

    inserted = 0
    skipped = 0

    with engine.begin() as conn:  # auto-commits on exit, rolls back on exception

        # Cache categories to avoid repeated queries
        category_cache = {}

        def get_or_create_category(category_name):
            if pd.isna(category_name) or not category_name:
                return None
            clean_name = str(category_name).strip()
            if clean_name in category_cache:
                return category_cache[clean_name]

            result = conn.execute(
                text("SELECT id FROM categories WHERE name ILIKE :name"),
                {"name": clean_name}
            ).fetchone()

            if result:
                category_cache[clean_name] = str(result[0])
                return str(result[0])

            new_id = str(uuid4())
            slug = clean_name.lower().replace(' ', '-').replace('&', 'and')
            conn.execute(
                text("INSERT INTO categories (id, name, slug) VALUES (:id, :name, :slug)"),
                {"id": new_id, "name": clean_name, "slug": slug}
            )
            category_cache[clean_name] = new_id
            return new_id

        for idx, row in df.iterrows():
            try:
                name = str(row.get('title', '')).strip()[:500]
                if not name or name.lower() == 'nan':
                    skipped += 1
                    continue

                # Price
                price = 10.0
                for price_col in ('final_price', 'initial_price'):
                    val = row.get(price_col)
                    if val is not None and not pd.isna(val):
                        price = clean_price(val)
                        break

                # Description
                description = str(row.get('product_description', '')).strip()[:1000]
                if description.lower() == 'nan':
                    description = ''

                category_id = get_or_create_category(row.get('category'))
                images_json = format_images(row.get('images'))

                conn.execute(
                    text("""
                        INSERT INTO products
                            (id, seller_id, category_id, name, description, price, stock_quantity, images, is_active)
                        VALUES
                            (:id, :seller_id, :category_id, :name, :description, :price, :stock, CAST(:images AS jsonb), true)
                    """),
                    {
                        "id": str(uuid4()),
                        "seller_id": SELLER_ID,
                        "category_id": category_id,
                        "name": name,
                        "description": description,
                        "price": price,
                        "stock": 100,
                        "images": images_json,
                    }
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