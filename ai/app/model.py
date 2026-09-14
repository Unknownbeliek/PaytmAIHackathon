"""Model training, persistence and the risk -> liquidation-action policy."""
from __future__ import annotations

import os
import pickle
import time

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score

from .synthetic import generate

FEATURES = [
    "hours_to_close",
    "age_frac",
    "perishability",
    "velocity_z1",
    "unsold_frac",
    "price_delta",
    "margin_pct",
    "footfall_idx",
    "weekend",
    "slow_mover",
]

MODEL_VERSION = "gbc-v1"
_MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
_MODEL_PATH = os.path.join(_MODEL_DIR, "decay_model.pkl")
_INFO_PATH = os.path.join(_MODEL_DIR, "model_info.json")


def train_model() -> tuple[GradientBoostingClassifier, dict]:
    import json

    X, y = generate()
    t0 = time.time()
    model = GradientBoostingClassifier(
        n_estimators=200, learning_rate=0.05, max_depth=3,
        subsample=0.9, random_state=42,
    )
    model.fit(X, y)
    auc = float(roc_auc_score(y, model.predict_proba(X)[:, 1]))
    info = {
        "version": MODEL_VERSION,
        "algorithm": "GradientBoostingClassifier (scikit-learn; drop-in for LightGBM in prod)",
        "features": FEATURES,
        "samples": int(X.shape[0]),
        "positive_rate": round(float(y.mean()), 4),
        "train_auc": round(auc, 4),
        "trained_in_ms": int((time.time() - t0) * 1000),
        "target": "P(total margin loss by store close)",
    }
    os.makedirs(_MODEL_DIR, exist_ok=True)
    with open(_MODEL_PATH, "wb") as f:
        pickle.dump(model, f)
    with open(_INFO_PATH, "w") as f:
        json.dump(info, f, indent=2)
    return model, info


def load_model():
    try:
        with open(_MODEL_PATH, "rb") as f:
            model = pickle.load(f)
        import json
        with open(_INFO_PATH) as f:
            return model, json.load(f)
    except FileNotFoundError:
        return train_model()


def risk_score(model, sku: dict) -> dict:
    """Score one live SKU from the /scan payload."""
    shelf_h = sku.get("shelf_life_h") or 0.0
    age_frac = min((sku.get("age_h", 0.0) / shelf_h) if shelf_h else 0.0, 1.5)
    v1 = float(sku.get("velocity_last_1h", 0.0))
    v7 = float(sku.get("velocity_avg_7d", 0.0) or 0.0)
    velocity_z1 = float(np.clip((v1 - v7) / max(0.25, v7), -2.5, 3.5)) if v7 else float(np.clip(v1 - 0.5, -2.5, 3.5))
    row = np.asarray([[
        min(1.0, float(sku.get("hours_to_close", 6.0)) / 13.5),  # match training's (22.5-h)/13.5 scale
        age_frac,
        min(shelf_h / 24.0, 1.5),
        velocity_z1,
        float(sku.get("unsold_frac", min(1.0, sku.get("stock", 0) / 12.0))),
        0.0,
        float(sku.get("margin_pct", 0.2)),
        float(sku.get("footfall_idx", 0.55)),
        1.0 if sku.get("weekend") else 0.0,
        min(float(sku.get("turn_days", 20.0)) / 60.0, 1.5),
    ]], dtype=float)
    prob = float(model.predict_proba(row)[0, 1])
    return prob


def apply_policy(risk: float, sku: dict) -> dict:
    """Deterministic risk -> automated action mapping (the 'so what' of the model)."""
    turn_days = float(sku.get("turn_days", 20.0))
    category = sku.get("category", "")
    perishable = (sku.get("shelf_life_h") or 0) > 0

    if risk >= 0.65:
        return {
            "recommended_discount_pct": 30, "channel": "near_me", "window_min": 240,
            "rationale": (
                f"{int(risk * 100)}% likelihood of full margin loss by close "
                f"({'perishable' if perishable else 'slow-mover'}). Auto-publish 30% flash "
                "to Paytm Near Me within 1.5 km."
            ),
        }
    if risk >= 0.45:
        return {
            "recommended_discount_pct": 20, "channel": "near_me", "window_min": 180,
            "rationale": f"{int(risk * 100)}% margin-loss risk — 20% geo flash sale to defuse decay.",
        }
    if risk >= 0.30:
        return {
            "recommended_discount_pct": 15, "channel": "counter_bundle", "window_min": 120,
            "rationale": f"Moderate decay risk ({int(risk * 100)}%) — suggest 15% bundle to cashier at counter.",
        }
    if turn_days > 45:
        return {
            "recommended_discount_pct": 15, "channel": "counter_bundle", "window_min": 1440,
            "rationale": f"Slow mover ({int(turn_days)}d turnover) — working-capital lockup; push paired bundle at checkout.",
        }
    return {
        "recommended_discount_pct": 0, "channel": "none", "window_min": 0,
        "rationale": "Healthy velocity — no action.",
    }
