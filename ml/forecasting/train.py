import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
import pickle
import os

DB_URL = "postgresql://marketplace_user:marketplace_pass@localhost:5432/marketplace"

def get_engine():
    return create_engine(DB_URL)

def fetch_sales_data(seller_id=None):
    engine = get_engine()
    
    if seller_id:
        query = """
            SELECT 
                DATE(o.created_at) as ds,
                SUM(oi.quantity * oi.price_at_purchase) as y
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN products p ON oi.product_id = p.id
            WHERE o.status = 'confirmed' AND p.seller_id = :seller_id
            GROUP BY DATE(o.created_at)
            ORDER BY ds ASC
        """
        params = {"seller_id": seller_id}
    else:
        query = """
            SELECT 
                DATE(o.created_at) as ds,
                SUM(oi.quantity * oi.price_at_purchase) as y
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.status = 'confirmed'
            GROUP BY DATE(o.created_at)
            ORDER BY ds ASC
        """
        params = {}
    
    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn, params=params)
    
    return df

def generate_synthetic_data():
    """Generate synthetic sales data when real data is sparse"""
    dates = pd.date_range(end=pd.Timestamp.today(), periods=60, freq="D")
    
    np.random.seed(42)
    base = 100
    trend = np.linspace(0, 50, 60)
    seasonality = 20 * np.sin(np.linspace(0, 4 * np.pi, 60))
    noise = np.random.normal(0, 10, 60)
    values = base + trend + seasonality + noise
    values = np.maximum(values, 0)
    
    df = pd.DataFrame({
        "ds": dates,
        "y": values
    })
    return df

def train_forecast(seller_id=None):
    print("Fetching sales data...")
    df = fetch_sales_data(seller_id)
    
    if len(df) < 7:
        print(f"Only {len(df)} days of data — using synthetic data for demonstration")
        df = generate_synthetic_data()
    
    df["ds"] = pd.to_datetime(df["ds"])
    df["y"] = df["y"].astype(float)
    
    print(f"Training on {len(df)} days of data...")
    
    try:
        from prophet import Prophet
        
        model = Prophet(
            yearly_seasonality=False,
            weekly_seasonality=True,
            daily_seasonality=False,
            changepoint_prior_scale=0.05,
        )
        model.fit(df)
        
        future = model.make_future_dataframe(periods=30)
        forecast = model.predict(future)
        
        result = {
            "model": model,
            "forecast": forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]].tail(30),
            "historical": df,
            "method": "prophet"
        }
        
    except Exception as e:
        print(f"Prophet failed: {e} — using simple trend")
        
        # Simple linear trend fallback
        x = np.arange(len(df))
        coeffs = np.polyfit(x, df["y"].values, 1)
        
        future_x = np.arange(len(df), len(df) + 30)
        future_y = np.polyval(coeffs, future_x)
        future_dates = pd.date_range(
            start=df["ds"].max() + pd.Timedelta(days=1),
            periods=30
        )
        
        forecast = pd.DataFrame({
            "ds": future_dates,
            "yhat": np.maximum(future_y, 0),
            "yhat_lower": np.maximum(future_y * 0.8, 0),
            "yhat_upper": future_y * 1.2,
        })
        
        result = {
            "model": None,
            "forecast": forecast,
            "historical": df,
            "method": "linear_trend"
        }
    
    os.makedirs(".", exist_ok=True)
    filename = f"forecast_{seller_id}.pkl" if seller_id else "forecast_global.pkl"
    
    with open(filename, "wb") as f:
        pickle.dump(result, f)
    
    print(f"Forecast saved to {filename}")
    print(f"Method used: {result['method']}")
    print(f"Next 7 days forecast:")
    print(result["forecast"][["ds", "yhat"]].head(7).to_string(index=False))
    
    return result

if __name__ == "__main__":
    train_forecast()