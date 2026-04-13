import pandas as pd
import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import normalize
import pickle
import psycopg2
import json
from sqlalchemy import create_engine


DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "marketplace",
    "user": "marketplace_user",
    "password": "marketplace_pass"
}



DB_URL = "postgresql://marketplace_user:marketplace_pass@localhost:5432/marketplace"

def get_engine():
    return create_engine(DB_URL)

def fetch_interaction_data():
    engine = get_engine()
    
    orders_query = """
        SELECT oi.order_id, o.user_id, oi.product_id, 
               oi.quantity::float as interaction_strength
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status = 'confirmed'
    """
    
    products_query = """
        SELECT p.id, p.name, p.price, p.tags,
               c.name as category_name,
               s.store_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN sellers s ON p.seller_id = s.id
        WHERE p.is_active = true
    """
    
    with engine.connect() as conn:
        orders_df = pd.read_sql(orders_query, conn)
        products_df = pd.read_sql(products_query, conn)
    
    return orders_df, products_df

    return psycopg2.connect(**DB_CONFIG)

    conn = get_connection()
    
    # Get order-based interactions (strongest signal)
    orders_query = """
        SELECT oi.order_id, o.user_id, oi.product_id, 
               oi.quantity::float as interaction_strength
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status = 'confirmed'
    """
    
    # Get all products for content features
    products_query = """
        SELECT p.id, p.name, p.price, p.tags,
               c.name as category_name,
               s.store_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN sellers s ON p.seller_id = s.id
        WHERE p.is_active = true
    """
    
    orders_df = pd.read_sql(orders_query, conn)
    products_df = pd.read_sql(products_query, conn)
    conn.close()
    
    return orders_df, products_df

def build_interaction_matrix(orders_df):
    if orders_df.empty:
        return None, None, None
    
    # Create user-product interaction matrix
    # Aggregate multiple purchases of same product by same user
    interactions = orders_df.groupby(
        ["user_id", "product_id"]
    )["interaction_strength"].sum().reset_index()
    
    user_ids = interactions["user_id"].unique().tolist()
    product_ids = interactions["product_id"].unique().tolist()
    
    user_index = {uid: i for i, uid in enumerate(user_ids)}
    product_index = {pid: i for i, pid in enumerate(product_ids)}
    
    matrix = np.zeros((len(user_ids), len(product_ids)))
    
    for _, row in interactions.iterrows():
        u = user_index[row["user_id"]]
        p = product_index[row["product_id"]]
        matrix[u][p] = row["interaction_strength"]
    
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

    if matrix is None or matrix.shape[0] < 2:
        print("Not enough data for collaborative filtering")
        return None
    
    n_components = min(10, min(matrix.shape) - 1)
    svd = TruncatedSVD(n_components=n_components, random_state=42)
    user_factors = svd.fit_transform(matrix)
    item_factors = svd.components_.T
    
    # Normalize for cosine similarity
    user_factors_norm = normalize(user_factors)
    item_factors_norm = normalize(item_factors)
    
    return svd, user_factors_norm, item_factors_norm

def build_content_features(products_df):
    """Build content-based features from product metadata"""
    features = []
    
    for _, product in products_df.iterrows():
        tags = product["tags"] if isinstance(product["tags"], list) else []
        category = product["category_name"] or ""
        
        feature_vector = {
            "id": product["id"],
            "name": product["name"],
            "price_normalized": float(product["price"]) / 1000.0,
            "category": category,
            "tags": tags,
        }
        features.append(feature_vector)
    
    return features

def get_content_recommendations(product_id, products_df, n=5):
    # Convert product_id to string for comparison
    product_id = str(product_id)
    
    # Convert dataframe ids to strings for comparison
    products_df = products_df.copy()
    products_df["id_str"] = products_df["id"].astype(str)
    
    target = products_df[products_df["id_str"] == product_id]
    if target.empty:
        print(f"Product {product_id} not found in dataframe")
        print(f"Available ids: {products_df['id_str'].tolist()[:3]}")
        return []

    target = target.iloc[0]
    target_tags = set(target["tags"] if isinstance(target["tags"], list) else [])
    target_category = target["category_name"]

    scores = []
    for _, product in products_df.iterrows():
        if str(product["id"]) == product_id:
            continue

        score = 0
        if product["category_name"] == target_category:
            score += 2

        product_tags = set(product["tags"] if isinstance(product["tags"], list) else [])
        overlap = len(target_tags & product_tags)
        score += overlap

        price_ratio = float(product["price"]) / max(float(target["price"]), 0.01)
        if 0.5 <= price_ratio <= 1.5:
            score += 1

        scores.append((str(product["id"]), score))

    scores.sort(key=lambda x: x[1], reverse=True)
    return [pid for pid, score in scores[:n] if score > 0]

    """Simple content-based: find products in same category with similar tags"""
    target = products_df[products_df["id"] == product_id]
    if target.empty:
        return []
    
    target = target.iloc[0]
    target_tags = set(target["tags"] if isinstance(target["tags"], list) else [])
    target_category = target["category_name"]
    
    scores = []
    for _, product in products_df.iterrows():
        if product["id"] == product_id:
            continue
        
        score = 0
        # Category match
        if product["category_name"] == target_category:
            score += 2
        
        # Tag overlap
        product_tags = set(product["tags"] if isinstance(product["tags"], list) else [])
        overlap = len(target_tags & product_tags)
        score += overlap
        
        # Price similarity (within 50% of target price)
        price_ratio = float(product["price"]) / max(float(target["price"]), 0.01)
        if 0.5 <= price_ratio <= 1.5:
            score += 1
        
        scores.append((product["id"], score))
    
    scores.sort(key=lambda x: x[1], reverse=True)
    return [pid for pid, _ in scores[:n] if _ > 0]

def train_and_save():
    print("Fetching data from database...")
    orders_df, products_df = fetch_interaction_data()
    
    print(f"Found {len(orders_df)} order interactions")
    print(f"Found {len(products_df)} products")
    
    # Build interaction matrix
    matrix, user_index, product_index = build_interaction_matrix(orders_df)
    
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
    content_features = build_content_features(products_df)
    
    # Save everything
    model_data = {
        "collab_model": collab_model,
        "user_factors": user_factors,
        "item_factors": item_factors,
        "user_index": user_index,
        "product_index": product_index,
        "products_df": products_df,
        "content_features": content_features,
    }
    
    with open("model.pkl", "wb") as f:
        pickle.dump(model_data, f)
    
    print("Model saved to model.pkl")
    
    # Quick evaluation
    if matrix is not None and collab_model is not None:
        reconstructed = user_factors @ item_factors.T
        mse = np.mean((matrix - reconstructed * np.sqrt(np.sum(matrix**2))) ** 2)
        print(f"Reconstruction MSE: {mse:.4f}")
    
    return model_data

if __name__ == "__main__":
    train_and_save()