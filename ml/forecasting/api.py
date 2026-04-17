from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
import pandas as pd
import pickle
import os
import subprocess
import sys

app = FastAPI(title="Forecasting Service")

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

def get_seller_id(user_id: str):
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT id FROM sellers WHERE user_id = :uid"),
            {"uid": user_id}
        )
        row = result.fetchone()
    return str(row[0]) if row else None

def load_forecast(seller_id=None):
    filename = f"forecast_{seller_id}.pkl" if seller_id else "forecast_global.pkl"
    if os.path.exists(filename):
        with open(filename, "rb") as f:
            return pickle.load(f)
    return None

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/forecast/train")
def train(seller_id: str = None):
    try:
        from train import train_forecast
        result = train_forecast(seller_id)
        forecast_df = result["forecast"]
        return {
            "message": "Forecast trained successfully",
            "method": result["method"],
            "periods": len(forecast_df),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/forecast/{user_id}")
def get_forecast(user_id: str):
    try:
        seller_id = get_seller_id(user_id)
        if not seller_id:
            raise HTTPException(status_code=404, detail="Seller not found")

        # Try seller-specific forecast first, fall back to global
        data = load_forecast(seller_id) or load_forecast()

        if data is None:
            # Auto-train if no forecast exists
            from train import train_forecast
            data = train_forecast()

        forecast_df = data["forecast"]
        historical_df = data["historical"]

        forecast_list = []
        for _, row in forecast_df.iterrows():
            forecast_list.append({
                "date": str(row["ds"])[:10],
                "predicted": round(float(row["yhat"]), 2),
                "lower": round(float(row["yhat_lower"]), 2),
                "upper": round(float(row["yhat_upper"]), 2),
            })

        historical_list = []
        for _, row in historical_df.tail(30).iterrows():
            historical_list.append({
                "date": str(row["ds"])[:10],
                "actual": round(float(row["y"]), 2),
            })

        return {
            "seller_id": seller_id,
            "method": data["method"],
            "forecast": forecast_list,
            "historical": historical_list,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Forecast error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)