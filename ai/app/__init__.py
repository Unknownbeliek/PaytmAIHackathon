"""Setu AI — Predictive Inventory Decay & Micro-Liquidation Engine.

Lightweight ML microservice (FastAPI) that scores each SKU for the probability of
total margin loss by store close, then maps risk to an automated liquidation action:
geo-targeted flash discount (Paytm Near Me) or counter-side bundle recommendation.
"""
