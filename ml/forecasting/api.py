from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
import pandas as pd
import pickle
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from db_config import get_db_url
from auth import TokenPayload, require_auth, require_seller

app = FastAPI(title="Forecasting Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_engine():
    return create_engine(get_db_url())

def get_seller_id(user_id: str):
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT id FROM sellers WHERE user_id = :uid"),
            {"uid": user_id}
        )
        row = result.fetchone()
    return str(row[0]) if row else None

def load_forecast(seller_id):
    from train import forecast_path
    path = forecast_path(seller_id)
    if not path.exists():
        return None
    with open(path, "rb") as f:
        data = pickle.load(f)
    # Pickles from before the synthetic flag existed can't say whether they
    # were fitted on real sales, so treat them as stale and retrain.
    return data if "synthetic" in data else None

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/forecast/train")
def train(seller_id: str = None, payload: TokenPayload = Depends(require_auth)):
    require_seller(payload)
    # Always train the caller's own forecast. Without a seller id this used
    # to train the global (marketplace-wide) model, which every seller then
    # saw as their own.
    own_seller_id = get_seller_id(payload.sub)
    if not own_seller_id:
        raise HTTPException(status_code=404, detail="Seller not found")
    if seller_id and seller_id != own_seller_id:
        raise HTTPException(
            status_code=403, detail="Cannot train a forecast for another seller"
        )
    try:
        from train import train_forecast
        result = train_forecast(own_seller_id)
        forecast_df = result["forecast"]
        return {
            "message": "Forecast trained successfully",
            "method": result["method"],
            "periods": len(forecast_df),
            "synthetic": result["synthetic"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/forecast/{user_id}")
def get_forecast(user_id: str, payload: TokenPayload = Depends(require_auth)):
    if user_id != payload.sub:
        raise HTTPException(status_code=403, detail="Cannot view another user's forecast")
    try:
        seller_id = get_seller_id(user_id)
        if not seller_id:
            raise HTTPException(status_code=404, detail="Seller not found")

        # Only ever the seller's own forecast — the global one is
        # marketplace-wide revenue and must not be shown to a seller.
        data = load_forecast(seller_id)
        if data is None:
            from train import train_forecast
            data = train_forecast(seller_id)

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
            # True when the seller has too little sales history and the
            # forecast was fitted on synthetic demo data.
            "synthetic": data["synthetic"],
            "data_days": data["data_days"],
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