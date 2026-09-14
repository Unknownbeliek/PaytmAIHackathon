// Client for the FastAPI decay engine, with a deterministic in-process fallback so
// the demo never dies if the Python side is still booting or crashes.

import { CONFIG } from './config.js';

function currentHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

/** Units sold per SKU in the trailing 60 minutes, from the merged event log. */
function salesLastHour(inv) {
  const out = {};
  const cutoff = Date.now() - 3600_000;
  for (const ev of inv.log) {
    if (ev.type !== 'SALE' || ev.ts < cutoff) continue;
    out[ev.skuId] = (out[ev.skuId] ?? 0) + ev.qty;
  }
  return out;
}

export function buildFeatures(catalog, stockMap, inv) {
  const h = currentHour();
  const sold1h = salesLastHour(inv);
  return catalog.map((s) => {
    // For perishables the risk deadline is the EARLIER of store close and batch expiry.
    const toClose = Math.max(0.2, CONFIG.CLOSE_HOUR - h);
    const toExpiry = s.shelfLifeH ? Math.max(0, s.shelfLifeH - s.ageH) : Infinity;
    return {
      sku_id: s.id,
      category: s.cat,
      price: s.price,
      cost: s.cost,
      stock: stockMap[s.id] ?? 0,
      shelf_life_h: s.shelfLifeH ?? null,
      age_h: s.ageH,
      velocity_last_1h: sold1h[s.id] ?? 0,
      velocity_avg_7d: +(s.vel.reduce((a, b) => a + b, 0) / 24).toFixed(3),
      unsold_frac: Math.min(1, (stockMap[s.id] ?? 0) / 12),
      hours_to_close: Math.max(0.2, Math.min(toClose, toExpiry)),
      footfall_idx: 0.55,
      turn_days: s.turnDays,
      margin_pct: +((s.price - s.cost) / s.price).toFixed(3),
      weekend: [0, 6].includes(new Date().getDay()),
    };
  });
}

function heuristicFallback(skus) {
  // Same contract as /scan — a transparent formula if the model is unreachable.
  const results = skus.map((s) => {
    const shelf = s.shelf_life_h ?? 0;
    const ageFrac = shelf ? Math.min(s.age_h / shelf, 1.5) : 0;
    const slow = Math.min(s.turn_days / 60, 1.5);
    const risk = Math.max(0, Math.min(0.97,
      0.55 * ageFrac + 0.35 * Math.max(0, 1 - s.velocity_last_1h / Math.max(0.3, s.velocity_avg_7d * 4)) + 0.25 * slow * (s.shelf_life_h ? 0.2 : 1)
    ));
    const p = risk >= 0.65 ? 30 : risk >= 0.45 ? 20 : risk >= 0.3 ? 15 : s.turn_days > 45 ? 15 : 0;
    return {
      sku_id: s.sku_id,
      risk: +risk.toFixed(3),
      expected_margin_loss_pct: Math.round(risk * 100),
      recommended_discount_pct: p,
      channel: p === 0 ? 'none' : (s.shelf_life_h && p >= 20 ? 'near_me' : 'counter_bundle'),
      window_min: p >= 30 ? 240 : p >= 20 ? 180 : 120,
      confidence: 0.5,
      rationale: 'Heuristic fallback (model service unreachable).',
      margin_pct_at_risk: s.margin_pct,
    };
  });
  return { model: 'heuristic-fallback', degraded: true, took_ms: 1, results: results.sort((a, b) => b.risk - a.risk) };
}

export async function aiScan(skus) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${CONFIG.AI_URL}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skus, context: { merchant: CONFIG.MERCHANT.id } }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`AI /scan ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.results)) throw new Error('bad AI payload');
    return json;
  } catch {
    return heuristicFallback(skus);
  }
}

export async function aiHealth() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${CONFIG.AI_URL}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok ? await res.json() : { status: 'unreachable' };
  } catch {
    return { status: 'unreachable' };
  }
}
