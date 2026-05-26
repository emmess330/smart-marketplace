import sys
from pathlib import Path

import pandas as pd
import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize
import pickle
import json
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from db_config import get_db_url, print_db_hints

MODEL_PATH = Path(__file__).with_name("model.pkl")

def get_engine():
    return create_engine(get_db_url())

def fetch_interaction_data():
    engine = get_engine()
    
    orders_query = """
        SELECT o.user_id::text,
               oi.product_id::text,
               SUM(oi.quantity)::float as interaction_strength,
               MAX(o.created_at) as last_ordered_at
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status = 'confirmed'
        GROUP BY o.user_id, oi.product_id
    """
    
    products_query = """
        SELECT p.id::text,
               p.name,
               COALESCE(p.description, '') as description,
               p.price,
               p.stock_quantity,
               p.images,
               p.tags,
               c.name as category_name,
               s.store_name,
               p.created_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN sellers s ON p.seller_id = s.id
        WHERE p.is_active = true
    """
    
    try:
        with engine.connect() as conn:
            orders_df = pd.read_sql(text(orders_query), conn)
            products_df = pd.read_sql(text(products_query), conn)
    except Exception as e:
        print_db_hints(e)
        raise

    orders_df["user_id"] = orders_df.get("user_id", pd.Series(dtype=str)).astype(str)
    orders_df["product_id"] = orders_df.get("product_id", pd.Series(dtype=str)).astype(str)
    products_df["id"] = products_df.get("id", pd.Series(dtype=str)).astype(str)

    return orders_df, products_df

def build_interaction_matrix(orders_df):
    if orders_df.empty:
        return None, None, None
    
    # Create user-product interaction matrix
    # Aggregate multiple purchases of same product by same user
    interactions = orders_df.groupby(
        ["user_id", "product_id"]
    )["interaction_strength"].sum().reset_index()
    
    user_ids = interactions["user_id"].astype(str).unique().tolist()
    product_ids = interactions["product_id"].astype(str).unique().tolist()
    
    user_index = {uid: i for i, uid in enumerate(user_ids)}
    product_index = {pid: i for i, pid in enumerate(product_ids)}
    
    matrix = np.zeros((len(user_ids), len(product_ids)))
    
    for _, row in interactions.iterrows():
        u = user_index[str(row["user_id"])]
        p = product_index[str(row["product_id"])]
        matrix[u][p] = np.log1p(float(row["interaction_strength"]))
    
    return matrix, user_index, product_index

def train_collaborative_model(matrix):
    if matrix is None or matrix.shape[0] < 2 or matrix.shape[1] < 2:
        print("Not enough data for collaborative filtering")
        return None
    
    n_components = max(1, min(10, min(matrix.shape) - 1))
    
    if n_components < 1:
        print("Matrix too small for SVD")
        return None
    
    svd = TruncatedSVD(n_components=n_components, random_state=42)
    user_factors = svd.fit_transform(matrix)
    item_factors = svd.components_.T
    
    user_factors_norm = normalize(user_factors)
    item_factors_norm = normalize(item_factors)
    
    return svd, user_factors_norm, item_factors_norm

def parse_tags(raw_tags):
    if isinstance(raw_tags, list):
        return [str(tag) for tag in raw_tags]
    if isinstance(raw_tags, str):
        try:
            parsed = json.loads(raw_tags)
            if isinstance(parsed, list):
                return [str(tag) for tag in parsed]
        except json.JSONDecodeError:
            return [raw_tags]
    return []

def build_product_text(product):
    tags = parse_tags(product.get("tags"))
    parts = [
        product.get("name") or "",
        product.get("description") or "",
        product.get("category_name") or "",
        product.get("store_name") or "",
        " ".join(tags),
    ]
    return " ".join(str(part) for part in parts if part)

def build_content_model(products_df):
    """Build TF-IDF vectors for product metadata used by content and hybrid ranking."""
    if products_df.empty:
        return None, None, []

    product_text = products_df.apply(build_product_text, axis=1)
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=1)
    content_matrix = vectorizer.fit_transform(product_text)
    content_matrix = normalize(content_matrix)
    product_ids = products_df["id"].astype(str).tolist()

    return vectorizer, content_matrix, product_ids

def build_popularity_scores(orders_df, products_df):
    product_ids = products_df["id"].astype(str).tolist()
    if not product_ids:
        return {}

    created_rank = {
        product_id: score
        for product_id, score in zip(
            product_ids,
            np.linspace(1.0, 0.1, num=len(product_ids), endpoint=True),
        )
    }

    if orders_df.empty:
        return created_rank

    sales = orders_df.groupby("product_id")["interaction_strength"].sum()
    max_sales = float(sales.max()) if not sales.empty else 0.0

    scores = {}
    for product_id in product_ids:
        sale_score = float(sales.get(product_id, 0.0)) / max_sales if max_sales else 0.0
        scores[product_id] = 0.8 * sale_score + 0.2 * created_rank.get(product_id, 0.0)
    return scores

def get_content_recommendations(product_id, products_df, n=5):
    product_id = str(product_id)

    products_df = products_df.copy()
    products_df["id_str"] = products_df["id"].astype(str)

    vectorizer, content_matrix, product_ids = build_content_model(products_df)
    if content_matrix is None or product_id not in product_ids:
        return []

    target_idx = product_ids.index(product_id)
    content_scores = (content_matrix @ content_matrix[target_idx].T).toarray().ravel()

    target_price = float(products_df.loc[products_df["id_str"] == product_id, "price"].iloc[0] or 0)
    price_scores = []
    for _, product in products_df.iterrows():
        price = float(product["price"] or 0)
        if target_price <= 0 or price <= 0:
            price_scores.append(0.0)
        else:
            price_scores.append(max(0.0, 1.0 - abs(np.log(price / target_price))))

    scores = 0.85 * content_scores + 0.15 * np.array(price_scores)
    scores[target_idx] = -1

    top_indices = np.argsort(scores)[::-1]
    return [product_ids[i] for i in top_indices[:n] if scores[i] > 0]

def train_and_save():
    print("Fetching data from database...")
    orders_df, products_df = fetch_interaction_data()
    
    print(f"Found {len(orders_df)} order interactions")
    print(f"Found {len(products_df)} products")
    
    # Build interaction matrix
    matrix, user_index, product_index = build_interaction_matrix(orders_df)
    user_index = user_index or {}
    product_index = product_index or {}
    
    # Train collaborative filtering model
    collab_model = None
    user_factors = None
    item_factors = None
    
    if matrix is not None and matrix.shape[0] >= 2:
        print("Training collaborative filtering model...")
        result = train_collaborative_model(matrix)
        if result:
            collab_model, user_factors, item_factors = result
            print(f"Model trained: {matrix.shape[0]} users, {matrix.shape[1]} products")
    else:
        print("Insufficient interaction data — using content-based only")
    
    # Build content features
    print("Building content features...")
    content_vectorizer, content_matrix, content_product_ids = build_content_model(products_df)
    popularity_scores = build_popularity_scores(orders_df, products_df)
    
    # Save everything
    model_data = {
        "collab_model": collab_model,
        "user_factors": user_factors,
        "item_factors": item_factors,
        "user_index": user_index,
        "product_index": product_index,
        "products_df": products_df,
        "interactions_df": orders_df,
        "content_vectorizer": content_vectorizer,
        "content_matrix": content_matrix,
        "content_product_ids": content_product_ids,
        "popularity_scores": popularity_scores,
        "method": "hybrid_collaborative_content",
    }
    
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model_data, f)
    
    print(f"Model saved to {MODEL_PATH}")
    
    # Quick evaluation
    if matrix is not None and collab_model is not None:
        reconstructed = user_factors @ item_factors.T
        mse = np.mean((matrix - reconstructed * np.sqrt(np.sum(matrix**2))) ** 2)
        print(f"Reconstruction MSE: {mse:.4f}")
    
    return model_data

if __name__ == "__main__":
    train_and_save()