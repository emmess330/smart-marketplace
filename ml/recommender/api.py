from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
import pickle
import numpy as np
import pandas as pd
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from db_config import get_db_url
from auth import TokenPayload, require_admin_key, require_auth

app = FastAPI(title="Recommendation Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = Path(__file__).with_name("model.pkl")

def get_engine():
    return create_engine(get_db_url())

model_data = None

def load_model():
    global model_data
    if MODEL_PATH.exists():
        with open(MODEL_PATH, "rb") as f:
            model_data = pickle.load(f)
        print("Model loaded successfully")
    else:
        print("No model found — run train.py first")

def get_popular_products(n=8):
    try:
        engine = get_engine()
        query = """
            SELECT p.id::text,
                   p.name,
                   p.description,
                   p.price,
                   p.stock_quantity,
                   p.images,
                   p.tags,
                   s.store_name,
                   c.name as category_name,
                   COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'confirmed'), 0) as units_sold
            FROM products p
            LEFT JOIN sellers s ON p.seller_id = s.id
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN order_items oi ON p.id = oi.product_id
            LEFT JOIN orders o ON oi.order_id = o.id
            WHERE p.is_active = true
            GROUP BY p.id, p.name, p.description, p.price, p.stock_quantity,
                     p.images, p.tags, s.store_name, c.name, p.created_at
            ORDER BY units_sold DESC, p.created_at DESC
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
            SELECT p.id::text,
                   p.name,
                   p.description,
                   p.price,
                   p.stock_quantity,
                   p.images,
                   p.tags,
                   s.store_name,
                   c.name as category_name
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

def normalize_scores(scores):
    if not scores:
        return {}
    values = np.array(list(scores.values()), dtype=float)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return {key: 0.0 for key in scores}
    min_score = float(finite.min())
    max_score = float(finite.max())
    if max_score <= min_score:
        return {key: 1.0 for key in scores}
    return {
        key: (float(value) - min_score) / (max_score - min_score)
        for key, value in scores.items()
    }

def get_user_history(user_id: str):
    if model_data is None:
        return []
    interactions = model_data.get("interactions_df")
    if interactions is None or interactions.empty:
        return []
    user_rows = interactions[interactions["user_id"].astype(str) == str(user_id)]
    return user_rows["product_id"].astype(str).tolist()

def collaborative_scores(user_id: str):
    user_index_raw = model_data.get("user_index") or {}
    product_index_raw = model_data.get("product_index") or {}
    user_index = {str(key): value for key, value in user_index_raw.items()}
    product_index = {str(key): value for key, value in product_index_raw.items()}
    user_factors = model_data.get("user_factors")
    item_factors = model_data.get("item_factors")

    if user_id not in user_index or user_factors is None or item_factors is None:
        return {}

    user_vector = user_factors[user_index[user_id]]
    raw_scores = item_factors @ user_vector
    index_to_product = {value: key for key, value in product_index.items()}
    return {
        str(index_to_product[i]): float(score)
        for i, score in enumerate(raw_scores)
        if i in index_to_product
    }

def content_profile_scores(purchased_ids):
    content_matrix = model_data.get("content_matrix")
    product_ids = [str(pid) for pid in model_data.get("content_product_ids", [])]
    if content_matrix is None or not product_ids or not purchased_ids:
        return {}

    purchased_set = {str(pid) for pid in purchased_ids}
    purchased_indices = [
        index for index, product_id in enumerate(product_ids)
        if product_id in purchased_set
    ]
    if not purchased_indices:
        return {}

    profile = np.asarray(content_matrix[purchased_indices].mean(axis=0))
    raw_scores = np.asarray(content_matrix @ profile.T).ravel()
    return {
        product_id: float(raw_scores[index])
        for index, product_id in enumerate(product_ids)
    }

def rank_hybrid_recommendations(user_id: str, n: int):
    purchased_ids = set(get_user_history(user_id))
    collab = normalize_scores(collaborative_scores(user_id))
    content = normalize_scores(content_profile_scores(purchased_ids))
    popularity = normalize_scores(model_data.get("popularity_scores", {}))

    candidate_ids = set(collab) | set(content) | set(popularity)
    candidate_ids -= purchased_ids
    if not candidate_ids:
        return [], "popular_new_user"

    has_collab = bool(collab)
    has_content = bool(content)
    if has_collab and has_content:
        weights = {"collab": 0.55, "content": 0.30, "popular": 0.15}
        method = "hybrid_collaborative_content"
    elif has_content:
        weights = {"collab": 0.0, "content": 0.75, "popular": 0.25}
        method = "content_profile"
    else:
        weights = {"collab": 0.0, "content": 0.0, "popular": 1.0}
        method = "popular_new_user"

    ranked = sorted(
        candidate_ids,
        key=lambda product_id: (
            weights["collab"] * collab.get(product_id, 0.0)
            + weights["content"] * content.get(product_id, 0.0)
            + weights["popular"] * popularity.get(product_id, 0.0)
        ),
        reverse=True,
    )
    return ranked[:n], method

@app.on_event("startup")
def startup():
    load_model()

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": model_data is not None,
        "has_collab_model": model_data is not None and model_data.get("collab_model") is not None,
        "has_content_model": model_data is not None and model_data.get("content_matrix") is not None,
        "method": model_data.get("method") if model_data else "popular",
    }

# One retrain at a time: concurrent runs would race on writing model.pkl.
_retrain_lock = threading.Lock()

@app.post("/recommend/retrain", dependencies=[Depends(require_admin_key)])
def retrain():
    if not _retrain_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Retrain already in progress")
    try:
        from train import train_and_save
        train_and_save()
        load_model()
        return {"message": "Model retrained successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _retrain_lock.release()

@app.get("/recommend/user/{user_id}")
def recommend_for_user(
    user_id: str, n: int = 8, payload: TokenPayload = Depends(require_auth)
):
    # Recommendations are derived from purchase history, so they're private.
    if user_id != payload.sub:
        raise HTTPException(
            status_code=403, detail="Cannot view another user's recommendations"
        )
    if model_data is None:
        return {
            "user_id": user_id,
            "recommendations": get_popular_products(n),
            "method": "popular"
        }

    try:
        recommended_ids, method = rank_hybrid_recommendations(str(user_id), n)
        products = get_product_details(recommended_ids)
        if len(products) < n:
            seen = set(get_user_history(str(user_id))) | {str(pid) for pid in recommended_ids}
            seen |= {str(product["id"]) for product in products}
            fill = [
                product for product in get_popular_products(n * 2)
                if str(product["id"]) not in seen
            ]
            products.extend(fill[: n - len(products)])

        return {
            "user_id": user_id,
            "recommendations": products,
            "method": method
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