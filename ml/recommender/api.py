from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
import pickle
import numpy as np
import pandas as pd
from typing import Optional
import os

app = FastAPI(title="Recommendation Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_URL = "postgresql://marketplace_user:marketplace_pass@localhost:5432/marketplace"

def get_engine():
    return create_engine(DB_URL)

model_data = None

def load_model():
    global model_data
    if os.path.exists("model.pkl"):
        with open("model.pkl", "rb") as f:
            model_data = pickle.load(f)
        print("Model loaded successfully")
    else:
        print("No model found — run train.py first")

def get_popular_products(n=8):
    try:
        engine = get_engine()
        query = """
            SELECT p.id::text, p.name, p.price, p.stock_quantity,
                   s.store_name, c.name as category_name
            FROM products p
            LEFT JOIN sellers s ON p.seller_id = s.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.is_active = true
            ORDER BY p.created_at DESC
            LIMIT :n
        """
        with engine.connect() as conn:
            df = pd.read_sql(text(query), conn, params={"n": n})
        return df.to_dict("records")
    except Exception as e:
        print(f"Error fetching popular products: {e}")
        return []

def get_product_details(product_ids):
    if not product_ids:
        return []
    try:
        engine = get_engine()
        str_ids = [str(pid) for pid in product_ids]
        query = """
            SELECT p.id::text, p.name, p.price, p.stock_quantity,
                   s.store_name, c.name as category_name
            FROM products p
            LEFT JOIN sellers s ON p.seller_id = s.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id::text = ANY(:ids) AND p.is_active = true
        """
        with engine.connect() as conn:
            df = pd.read_sql(text(query), conn, params={"ids": str_ids})
        id_order = {pid: i for i, pid in enumerate(str_ids)}
        records = df.to_dict("records")
        records.sort(key=lambda x: id_order.get(str(x["id"]), 999))
        return records
    except Exception as e:
        print(f"Error fetching product details: {e}")
        return []

@app.on_event("startup")
def startup():
    load_model()

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": model_data is not None,
        "has_collab_model": model_data is not None and model_data.get("collab_model") is not None
    }

@app.post("/recommend/retrain")
def retrain():
    try:
        from train import train_and_save
        train_and_save()
        load_model()
        return {"message": "Model retrained successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/recommend/user/{user_id}")
def recommend_for_user(user_id: str, n: int = 8):
    if model_data is None or model_data.get("collab_model") is None:
        return {
            "user_id": user_id,
            "recommendations": get_popular_products(n),
            "method": "popular"
        }

    user_index = model_data["user_index"]

    if user_id not in user_index:
        return {
            "user_id": user_id,
            "recommendations": get_popular_products(n),
            "method": "popular_new_user"
        }

    try:
        user_factors = model_data["user_factors"]
        item_factors = model_data["item_factors"]
        product_index = model_data["product_index"]

        u_idx = user_index[user_id]
        user_vector = user_factors[u_idx]

        scores = item_factors @ user_vector
        top_indices = np.argsort(scores)[::-1]

        index_to_product = {v: k for k, v in product_index.items()}
        recommended_ids = [
            index_to_product[i]
            for i in top_indices[:n*2]
            if i in index_to_product
        ][:n]

        products = get_product_details(recommended_ids)

        return {
            "user_id": user_id,
            "recommendations": products,
            "method": "collaborative_filtering"
        }
    except Exception as e:
        print(f"Error generating recommendations: {e}")
        return {
            "user_id": user_id,
            "recommendations": get_popular_products(n),
            "method": "popular_fallback"
        }

@app.get("/recommend/similar/{product_id}")
def similar_products(product_id: str, n: int = 6):
    if model_data is None:
        return {"product_id": product_id, "similar": [], "method": "no_model"}

    try:
        products_df = model_data["products_df"]

        from train import get_content_recommendations
        similar_ids = get_content_recommendations(product_id, products_df, n)
        similar_ids = [str(pid) for pid in similar_ids]
        products = get_product_details(similar_ids)

        return {
            "product_id": product_id,
            "similar": products,
            "method": "content_based"
        }
    except Exception as e:
        print(f"Error finding similar products: {e}")
        return {"product_id": product_id, "similar": [], "method": "error"}

@app.get("/recommend/popular")
def popular_products(n: int = 8):
    return {
        "recommendations": get_popular_products(n),
        "method": "popular"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8006)