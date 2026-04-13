import pickle
import numpy as np
import pandas as pd
import psycopg2

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "marketplace",
    "user": "marketplace_user",
    "password": "marketplace_pass"
}

def precision_at_k(recommended, relevant, k):
    recommended_k = recommended[:k]
    hits = len(set(recommended_k) & set(relevant))
    return hits / k if k > 0 else 0

def recall_at_k(recommended, relevant, k):
    recommended_k = recommended[:k]
    hits = len(set(recommended_k) & set(relevant))
    return hits / len(relevant) if relevant else 0

def evaluate_model():
    print("Loading model...")
    with open("model.pkl", "rb") as f:
        model_data = pickle.load(f)

    if model_data.get("collab_model") is None:
        print("No collaborative model to evaluate — need more interaction data")
        return

    print("\n--- Model Evaluation ---")
    
    user_factors = model_data["user_factors"]
    item_factors = model_data["item_factors"]
    user_index = model_data["user_index"]
    product_index = model_data["product_index"]
    
    print(f"Users in model: {len(user_index)}")
    print(f"Products in model: {len(product_index)}")
    print(f"Latent factors: {user_factors.shape[1]}")
    
    # Fetch ground truth
    conn = psycopg2.connect(**DB_CONFIG)
    orders_df = pd.read_sql("""
        SELECT o.user_id, oi.product_id
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status = 'confirmed'
    """, conn)
    conn.close()
    
    if orders_df.empty:
        print("No order data available for evaluation")
        return
    
    index_to_product = {v: k for k, v in product_index.items()}
    
    precisions, recalls = [], []
    k = 5
    
    for user_id, u_idx in list(user_index.items())[:20]:
        user_vector = user_factors[u_idx]
        scores = item_factors @ user_vector
        top_indices = np.argsort(scores)[::-1][:k]
        recommended = [index_to_product[i] for i in top_indices if i in index_to_product]
        
        relevant = orders_df[orders_df["user_id"] == user_id]["product_id"].tolist()
        
        if relevant:
            p = precision_at_k(recommended, relevant, k)
            r = recall_at_k(recommended, relevant, k)
            precisions.append(p)
            recalls.append(r)
    
    if precisions:
        print(f"\nPrecision@{k}: {np.mean(precisions):.4f}")
        print(f"Recall@{k}:    {np.mean(recalls):.4f}")
    else:
        print("\nNot enough data for precision/recall evaluation")
    
    print("\nContent-based recommendation check:")
    products_df = model_data["products_df"]
    if not products_df.empty:
        sample = products_df.iloc[0]
        print(f"Sample product: {sample['name']}")
        from train import get_content_recommendations
        similar = get_content_recommendations(sample["id"], products_df, 3)
        similar_names = products_df[products_df["id"].isin(similar)]["name"].tolist()
        print(f"Similar products: {similar_names}")
    
    print("\nEvaluation complete")

if __name__ == "__main__":
    evaluate_model()