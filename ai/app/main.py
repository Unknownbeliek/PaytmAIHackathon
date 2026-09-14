"""FastAPI entrypoint for the decay-risk / micro-liquidation engine."""
from __future__ import annotations

import os
import time
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .model import FEATURES, MODEL_VERSION, apply_policy, load_model, risk_score, train_model

app = FastAPI(title="Setu AI — Decay & Micro-Liquidation Engine", version=MODEL_VERSION)

state: dict = {"model": None, "info": None, "trained_at_boot": False}


@app.on_event("startup")
def _boot() -> None:
    model, info = load_model()
    state["model"], state["info"] = model, info
    state["trained_at_boot"] = info.get("trained_in_ms", 0) > 0


class SkuIn(BaseModel):
    sku_id: str
    category: str = "grocery"
    price: float = 0.0
    cost: float = 0.0
    stock: int = 0
    shelf_life_h: Optional[float] = None
    age_h: float = 0.0
    velocity_last_1h: float = 0.0
    velocity_avg_7d: float = 0.0
    unsold_frac: float = 0.0
    hours_to_close: float = 6.0
    footfall_idx: float = 0.55
    turn_days: float = 20.0
    margin_pct: float = 0.2
    weekend: bool = False


class ScanIn(BaseModel):
    skus: List[SkuIn]
    context: dict = Field(default_factory=dict)


class OfferOut(BaseModel):
    sku_id: str
    risk: float
    expected_margin_loss_pct: int
    recommended_discount_pct: int
    channel: str
    window_min: int
    confidence: float
    rationale: str


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_VERSION, "loaded": state["model"] is not None}


@app.get("/model/info")
def model_info():
    return state["info"] or {"version": MODEL_VERSION, "status": "training"}


@app.post("/scan", response_model=dict)
def scan(payload: ScanIn):
    """Score every SKU and attach the automated liquidation policy."""
    t0 = time.time()
    model = state["model"]
    results = []
    for sku in payload.skus:
        d = sku.model_dump()
        risk = risk_score(model, d) if model is not None else 0.0
        policy = apply_policy(risk, d)
        margin = max(0.0, (d.get("price", 0.0) - d.get("cost", 0.0)) / max(1e-9, d.get("price", 1.0)))
        results.append(OfferOut(
            sku_id=d["sku_id"],
            risk=round(risk, 4),
            expected_margin_loss_pct=int(round(risk * 100)),
            recommended_discount_pct=policy["recommended_discount_pct"],
            channel=policy["channel"],
            window_min=policy["window_min"],
            confidence=round(min(0.99, 0.55 + 0.4 * abs(risk - 0.5) * 2), 3),
            rationale=policy["rationale"],
        ).model_dump() | {"margin_pct_at_risk": round(margin, 3)})
    return {
        "model": MODEL_VERSION,
        "degraded": False,
        "took_ms": int((time.time() - t0) * 1000),
        "results": sorted(results, key=lambda r: r["risk"], reverse=True),
    }


@app.post("/train")
def retrain():
    """Retrain on the synthetic history and persist the artifact (used by /onboarding in prod)."""
    model, info = train_model()
    state["model"], state["info"] = model, info
    return {"ok": True, "info": info}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("AI_PORT", "8001")))
