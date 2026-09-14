"""Synthetic historical sales generator.

Creates a 30-day hourly demand history for a realistic kirana/bakery/apparel mix so
the decay-risk model can be trained without a merchant's proprietary data. The same
generator shape is what a production onboarding flow would replace with Paytm POS
+ consumer-app order history.
"""
from __future__ import annotations

import numpy as np

# (name, category, base_daily_demand, shelf_life_h or None, turn_days, margin_pct)
CATALOG = [
    ("Toned Milk 1L",            "dairy",    9.0, 12,    1,   0.12),
    ("Full-Cream Milk 500ml",    "dairy",    7.0, 14,    1,   0.14),
    ("Buttermilk 1L",            "dairy",    4.0, 10,    1,   0.18),
    ("Whole-Grain Bread",        "bakery",   8.0, 8,     1,   0.32),
    ("Butter Croissant",         "bakery",   5.0, 6,     1,   0.35),
    ("Choco-Egg Tart",           "bakery",   6.0, 6,     1,   0.38),
    ("Cheese Sandwich",          "bakery",   7.0, 5,     1,   0.40),
    ("Eggs (12 pack)",           "staple",   4.0, None,  2,   0.10),
    ("Chai Leaves 250g",         "grocery",  2.2, None,  38,  0.20),
    ("Golden Biscuits 200g",     "grocery",  3.0, None,  22,  0.24),
    ("Masala Noodles (4 pack)",  "grocery",  3.4, None,  18,  0.26),
    ("Pure Ghee 1L",             "grocery",  1.1, None,  40,  0.15),
    ("Basmati Rice 10kg",        "grocery",  0.8, None,  30,  0.11),
    ("Cotton Kurta (M)",         "apparel",  0.25,None,  52,  0.35),
    ("Linen Shirt (Free size)",  "apparel",  0.18,None,  61,  0.38),
]

HOURS = list(range(9, 23))  # store open 9:00 -> 23:00
N_DAYS = 30


def _hour_curve(h: int, category: str) -> float:
    """Typical Indian micro-retail footfall: morning rush + evening peak."""
    if category in ("dairy", "bakery"):
        weights = {9: 1.6, 10: 1.3, 11: 1.0, 12: 0.8, 13: 0.6, 14: 0.5, 15: 0.6,
                   16: 0.8, 17: 1.1, 18: 1.5, 19: 1.6, 20: 1.4, 21: 1.0, 22: 0.5}
    elif category == "apparel":
        weights = {9: 0.3, 10: 0.4, 11: 0.5, 12: 0.4, 13: 0.5, 14: 0.6, 15: 0.7,
                   16: 0.9, 17: 1.2, 18: 1.3, 19: 1.2, 20: 1.0, 21: 0.8, 22: 0.4}
    else:
        weights = {9: 0.7, 10: 0.8, 11: 0.8, 12: 0.7, 13: 0.6, 14: 0.6, 15: 0.7,
                   16: 0.9, 17: 1.1, 18: 1.3, 19: 1.3, 20: 1.1, 21: 0.9, 22: 0.6}
    return weights.get(h, 0.6)


def generate(n_days: int = N_DAYS, seed: int = 42):
    """Return (X, y) where y = 1 if the item lost most of its margin that day
    (perishable left >35% unsold into the last 2 hours, or apparel margin lockup)."""
    rng = np.random.default_rng(seed)
    X_rows, y_rows = [], []

    for name, category, base, shelf_h, turn_days, margin in CATALOG:
        for day in range(n_days):
            weekend = (day % 7) in (5, 6)
            footfall = float(np.clip(rng.normal(0.55 + (0.2 if weekend else 0.0), 0.18), 0.05, 1.0))
            # opening stock: morning restock, merchants over-order (loss risk when demand is weak)
            avail = max(1, int(round(base * (1.30 + rng.normal(0, 0.15)))))
            unsold = avail
            price_change = float(rng.choice([0.0, 0.0, 0.0, -0.15, 0.10]))  # occasional re-pricing
            day_rows = []
            for h in HOURS:
                hours_to_close = (22.5 - h) / 13.5
                lambda_h = base * _hour_curve(h, category) * footfall * 0.12
                if price_change < 0:
                    lambda_h *= 1.35  # discount lifts demand
                lambda_h = max(0.02, lambda_h)
                sold = min(int(rng.poisson(lambda_h)), unsold)
                unsold -= sold

                age_frac = (23.5 - h) / shelf_h if shelf_h else 0.0
                velocity_z1 = float(np.clip((sold - base * _hour_curve(h, category) * footfall * 0.12) / 1.2, -2.5, 3.5))
                day_rows.append([
                    hours_to_close,                     # closeness to store close
                    min(age_frac, 1.5),                 # shelf-life consumed (0 for non-perishable)
                    float(shelf_h or 0.0) / 24.0,       # perishability
                    velocity_z1,                        # today's velocity vs expected
                    float(unsold) / max(1, avail),      # current unsold fraction
                    price_change,                       # current price vs list
                    margin,                              # margin at risk per unit
                    footfall,                            # localized footfall
                    1.0 if weekend else 0.0,
                    min(turn_days / 60.0, 1.5),          # working-capital lockup for slow movers
                ])

            # Day-level outcome: perishable day is a margin loss if >35% is still on
            # the shelf at close; apparel days lock up capital on weak slow-mover days.
            if shelf_h:
                day_loss = unsold / max(1, avail) > 0.35
            else:
                day_loss = category == "apparel" and turn_days > 45 and rng.random() < 0.18
            for i, row in enumerate(day_rows):
                X_rows.append(row)
                # risk window: only rows from 16:00 onward carry the loss label —
                # earlier rows are "too early to know", matching the model's use case.
                y_rows.append(1 if (day_loss and HOURS[i] >= 16) else 0)

    return np.asarray(X_rows, dtype=float), np.asarray(y_rows, dtype=int)
