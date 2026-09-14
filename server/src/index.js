// Setu AI — sync/event server.
// Sub-50ms WebSocket event bus (Socket.io), optimistic reservation locks,
// CRDT merge endpoint, AI liquidation orchestration, demo scenario driver.

import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import { CONFIG } from './config.js';
import { CATALOG, byId } from './data.js';
import { CrdtStore, signEvent } from './crdt.js';
import { LockStore } from './locks.js';
import { aiScan, aiHealth, buildFeatures } from './ai.js';
import { startDemo, stopDemo } from './demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../web/dist');

const app = express();
app.use(express.json({ limit: '2mb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const inv = new CrdtStore();
CATALOG.forEach((s) => inv.setBase(s.id, s.stock));

let aiInfo = { health: { status: 'starting' }, model: null };
const offers = new Map(); // skuId -> offer
let bundles = [];         // counter-bundle recommendations from last scan
const metrics = {
  eventsMerged: 0, merges: 0,
  salesCounter: 0, salesOnline: 0,
  cancellationsPrevented: 0,
  conflictsAutoResolved: 0,
  offlineRevenue: 0,
  marginRecovered: 0,
};
const recent = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pushLog(kind, text, channel = null) {
  recent.unshift({ ts: Date.now(), kind, text, channel });
  if (recent.length > 80) recent.length = 80;
}

function getState() {
  return {
    merchant: CONFIG.MERCHANT,
    cfg: {
      reservationTtlSec: CONFIG.RESERVATION_TTL_SECONDS,
      closeHour: CONFIG.CLOSE_HOUR,
      radiusKm: CONFIG.MERCHANT.nearMeRadiusKm,
    },
    catalog: CATALOG,
    stock: inv.allStock(),
    reserved: Object.fromEntries(
      CATALOG.map((s) => [s.id, locks.reservedQty(s.id)]).filter(([, q]) => q > 0)
    ),
    locks: locks.list(),
    offers: [...offers.values()].filter((o) => o.status === 'live' && o.expiresAt > Date.now()),
    bundles,
    metrics,
    recent: recent.slice(0, 60),
    vectors: Object.fromEntries(inv.vectors),
    ai: aiInfo,
    serverTime: Date.now(),
  };
}

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setTimeout(() => {
    broadcastQueued = false;
    io.emit('state', getState());
  }, 120);
}

const locks = new LockStore(inv, {
  onEvent: (kind, payload) => {
    if (kind === 'lock:acquired') {
      const item = byId[payload.skuId];
      pushLog('lock', `Reservation held: ${item?.name ?? payload.skuId} (90s TTL, ${payload.sessionId})`);
    } else if (kind === 'lock:overridden') {
      pushLog('conflict', `Counter priority: ${byId[payload.skuId]?.name ?? payload.skuId} — online reservation released with instant alternatives`);
    } else if (kind === 'lock:released') {
      pushLog('lock', `Lock released: ${byId[payload.skuId]?.name ?? payload.skuId} (${payload.reason})`);
    }
    broadcast();
  },
});

// ---------------------------------------------------------------------------
// CRDT merge orchestration (shared by offline flush + online checkout)
// ---------------------------------------------------------------------------
function runMerge(events, clientId) {
  const result = inv.mergeBatch(events, {
    beforeApply: (ev, stockBefore) => {
      if (ev.type === 'SALE' && ev.channel === 'COUNTER') {
        const notice = locks.overrideForCounter(ev.skuId, ev.qty, stockBefore);
        if (notice) metrics.cancellationsPrevented += 1;
      }
    },
    afterApply: (ev) => {
      if (ev.type !== 'SALE') return;
      if (ev.channel === 'ONLINE') metrics.salesOnline += 1;
      else metrics.salesCounter += 1;
      if (ev.origin === 'offline') metrics.offlineRevenue += ev.amount ?? 0;
      if (ev.offerId) {
        const offer = [...offers.values()].find((o) => o.offerId === ev.offerId && o.status === 'live');
        if (offer) {
          offer.status = 'sold';
          offer.soldAt = Date.now();
          const item = byId[ev.skuId];
          metrics.marginRecovered += Math.max(0, offer.salePrice - item.cost) * ev.qty;
          pushLog('offer', `Flash deal sold: ${item?.name ?? ev.skuId} @ ₹${offer.salePrice} (−${offer.discountPct}%)`);
        }
      }
      if (inv.stockOf(ev.skuId) < 0) {
        metrics.conflictsAutoResolved += 1;
        pushLog('conflict', `CRDT floor conflict on ${ev.skuId} — auto-resolved, flagged for manager review`);
      }
      io.emit('receipt', {
        channel: ev.channel, origin: ev.origin, amount: ev.amount,
        skuId: ev.skuId, qty: ev.qty, at: Date.now(),
      });
    },
  });
  metrics.eventsMerged += result.merged;
  metrics.merges += 1;
  if (result.rejected.length) pushLog('conflict', `${result.rejected.length} event(s) rejected (HMAC invalid)`);
  if (result.merged > 0) pushLog('sync', `CRDT merge: ${result.merged} event(s) in ${result.tookMs.toFixed(1)} ms (${clientId})`);
  io.emit('sync:merged', { clientId, at: Date.now(), ...result });
  broadcast();
  return result;
}

function mkEvent(partial) {
  const ev = {
    id: crypto.randomUUID(),
    type: 'SALE', skuId: null, qty: 1, channel: 'COUNTER',
    clientId: 'pos', seq: 1, ts: Date.now(), amount: 0,
    offerId: null, origin: 'online',
    ...partial,
  };
  ev.hmac = signEvent(ev);
  return ev;
}

// ---------------------------------------------------------------------------
// AI scan + offer publication
// ---------------------------------------------------------------------------
async function scanAndPublish() {
  const skus = buildFeatures(CATALOG, inv.allStock(), inv);
  const scan = await aiScan(skus);
  aiInfo = { health: scan.degraded ? { status: 'fallback' } : { status: 'ok' }, model: scan.model, lastScanAt: Date.now() };
  let published = 0;
  for (const r of scan.results) {
    if (r.channel !== 'near_me' || r.recommended_discount_pct <= 0 || published >= 3) continue;
    const item = byId[r.sku_id];
    if (!item || inv.stockOf(item.id) - locks.reservedQty(item.id) <= 0) continue;
    const existing = offers.get(item.id);
    if (existing && existing.status === 'live') continue;
    const offer = {
      offerId: 'OFFER_' + crypto.randomUUID().slice(0, 8).toUpperCase(),
      skuId: item.id,
      discountPct: r.recommended_discount_pct,
      origPrice: item.price,
      salePrice: Math.round(item.price * (1 - r.recommended_discount_pct / 100)),
      qtyAvail: 5,
      channel: 'near_me',
      radiusKm: CONFIG.MERCHANT.nearMeRadiusKm,
      risk: r.risk,
      rationale: r.rationale,
      publishedAt: Date.now(),
      expiresAt: Date.now() + (r.window_min || 240) * 60000,
      status: 'live',
    };
    offers.set(item.id, offer);
    io.emit('offer:published', offer);
    pushLog('ai', `AI flash deal LIVE: ${item.name} −${offer.discountPct}% · ${offer.radiusKm} km radius (risk ${Math.round(r.risk * 100)}%)`);
    published += 1;
  }
  bundles = scan.results
    .filter((r) => r.channel === 'counter_bundle' && r.recommended_discount_pct > 0)
    .slice(0, 2)
    .map((r) => ({
      skuId: r.sku_id, name: byId[r.sku_id]?.name ?? r.sku_id,
      hi: byId[r.sku_id]?.hi ?? '',
      discountPct: r.recommended_discount_pct,
      rationale: r.rationale,
      pairWith: byId[r.sku_id]?.cat === 'apparel' ? 'SKU_CHAI_LEAF_250G' : 'SKU_BISCUIT_GOLDEN',
    }));
  pushLog('ai', `Decay scan complete (${scan.model}, degraded=${scan.degraded}): ${published} flash deal(s) published, ${bundles.length} bundle hint(s)`);
  broadcast();
  return scan;
}

/** Full day-reset: seed catalog, clean CRDT counters, locks, offers, KPIs. */
function resetDay() {
  inv.resetBases(Object.fromEntries(CATALOG.map((s) => [s.id, s.stock])));
  for (const l of locks.list()) locks.release(l.lockId, 'RESET');
  offers.clear();
  bundles = [];
  Object.assign(metrics, {
    eventsMerged: 0, merges: 0, salesCounter: 0, salesOnline: 0,
    cancellationsPrevented: 0, conflictsAutoResolved: 0, offlineRevenue: 0, marginRecovered: 0,
  });
  recent.length = 0;
  pushLog('demo', 'State reset — new trading day, CRDT counters at seed');
  broadcast();
  scanAndPublish().catch(() => {});
}

setInterval(() => {
  aiHealth().then((h) => {
    aiInfo.health = h;
    broadcast();
  });
}, 20000).unref();
setInterval(() => {
  for (const o of offers.values()) {
    if (o.status === 'live' && o.expiresAt <= Date.now()) {
      o.status = 'expired';
      io.emit('offer:expired', { skuId: o.skuId, offerId: o.offerId });
    }
  }
}, 15000).unref();

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/api/state', (_req, res) => res.json(getState()));

app.post('/api/sync/merge', (req, res) => {
  const { clientId, events } = req.body ?? {};
  if (!Array.isArray(events)) return res.status(400).json({ ok: false, error: 'events[] required' });
  const result = runMerge(events, clientId ?? 'unknown');
  res.json({ ok: true, ...result });
});

app.post('/api/online/reserve', (req, res) => {
  const { skuId, qty = 1, sessionId = 'consumer' } = req.body ?? {};
  const item = byId[skuId];
  if (!item) return res.status(404).json({ ok: false, error: 'unknown sku' });
  const r = locks.acquire({ skuId, qty, sessionId });
  res.json(r.ok ? { ok: true, lock: r.lock, availableAfter: r.availableAfter } : r);
});

app.post('/api/online/cancel', (req, res) => {
  const { lockId } = req.body ?? {};
  const lock = locks.release(lockId, 'CONSUMER_CANCELLED');
  res.json(lock ? { ok: true } : { ok: false, error: 'lock not found' });
});

app.post('/api/online/checkout', (req, res) => {
  const { lockId, skuId, qty = 1, sessionId, offerId = null } = req.body ?? {};
  const item = byId[skuId];
  if (!item) return res.status(404).json({ ok: false, error: 'unknown sku' });
  const existing = locks.list().find((l) => l.lockId === lockId);
  if (!existing || existing.sessionId !== sessionId || existing.skuId !== skuId) {
    return res.json({ ok: false, code: 'LOCK_GONE', alternatives: locks.alternatives(skuId) });
  }
  if (inv.stockOf(skuId) < qty) {
    locks.release(lockId, 'STOCK_GONE');
    return res.json({ ok: false, code: 'OVERRIDDEN', alternatives: locks.alternatives(skuId) });
  }
  const unit = existing && offerId ? (() => {
    const o = offers.get(skuId);
    return o && o.status === 'live' && o.offerId === offerId ? o.salePrice : item.price;
  })() : item.price;
  const ev = mkEvent({
    type: 'SALE', skuId, qty, channel: 'ONLINE',
    clientId: 'paytm-consumer-app', amount: unit * qty,
    offerId: offerId ?? null, origin: 'online',
  });
  const merge = runMerge([ev], 'paytm-consumer-app');
  locks.release(lockId, 'CHECKOUT_COMPLETE');
  res.json({
    ok: true,
    receipt: { skuId, qty, amount: unit * qty, at: Date.now(), discounted: unit < item.price },
    merge: { tookMs: merge.tookMs },
  });
});

app.post('/api/restock', (req, res) => {
  const { skuId, qty = 1 } = req.body ?? {};
  if (!byId[skuId] || !Number.isFinite(qty) || qty <= 0) return res.status(400).json({ ok: false });
  const ev = mkEvent({ type: 'RESTOCK', skuId, qty, channel: 'RESTOCK', clientId: 'ops-console' });
  pushLog('sync', `Restock: ${byId[skuId].name} +${qty}`);
  const result = runMerge([ev], 'ops-console');
  res.json({ ok: true, ...result });
});

app.post('/api/ai/scan', async (_req, res) => {
  const scan = await scanAndPublish();
  res.json({ ok: true, model: scan.model, degraded: scan.degraded, results: scan.results.slice(0, 6) });
});

app.get('/api/ai/status', (_req, res) => res.json(aiInfo));

// NFR proof: sub-second merge of a 500-event offline queue.
app.post('/api/demo/flood', (req, res) => {
  const count = Math.min(5000, Math.max(50, Number(req.body?.count ?? 500)));
  const baseline = inv.allStock();
  const clientId = 'flood-' + crypto.randomUUID().slice(0, 6);
  const events = [];
  let seq = 0;
  for (let i = 0; i < count; i++) {
    const item = CATALOG[i % CATALOG.length];
    const restock = i % 12 === 11;
    seq += 1;
    events.push(mkEvent({
      type: restock ? 'RESTOCK' : 'SALE',
      skuId: item.id,
      qty: 1,
      channel: restock ? 'RESTOCK' : 'COUNTER',
      clientId, seq,
      ts: Date.now() - (count - i) * 40, // 40 ms apart, as a slow offline journal would
      amount: restock ? 0 : item.price,
      origin: 'offline',
    }));
  }
  const result = runMerge(events, clientId);
  // Rebalance so the demo store keeps looking healthy after the flood.
  for (const [sku, base] of Object.entries(baseline)) {
    if (inv.stockOf(sku) < base) {
      const reb = mkEvent({ type: 'REBASE', skuId: sku, qty: base, channel: 'RESTOCK', clientId: 'ops-console' });
      runMerge([reb], 'ops-console');
    }
  }
  pushLog('demo', `Flood test: ${count}-event offline queue merged in ${result.tookMs.toFixed(1)} ms`);
  res.json({ ok: true, count, tookMs: +result.tookMs.toFixed(1), merged: result.merged });
});

app.post('/api/demo/reset', (_req, res) => { resetDay(); res.json({ ok: true }); });

app.post('/api/demo/start', (_req, res) => {
  const ctx = {
    io, inv, locks, metrics, recent, pushLog, sleep,
    runMerge, mkEvent, scanAndPublish, getState, resetDay,
    offers, // live Map — offers published mid-demo are visible to the runner
  };
  startDemo(ctx).catch((e) => pushLog('demo', `Demo runner error: ${e.message}`));
  res.json({ ok: true });
});
app.post('/api/demo/stop', (_req, res) => { stopDemo(); res.json({ ok: true }); });

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('hello', () => socket.emit('state', getState()));
  socket.on('ping', () => socket.emit('pong', { ts: Date.now() }));
});

// ---------------------------------------------------------------------------
// Static frontend (Vite build) + SPA fallback
// ---------------------------------------------------------------------------
if (!fs.existsSync(DIST)) {
  console.warn('[server] web/dist not found yet — run `npm run build` at the repo root.');
}
app.use(express.static(DIST));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
    return res.sendFile(path.join(DIST, 'index.html'), (err) => (err ? next() : undefined));
  }
  next();
});

server.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log(`[server] Setu AI sync/event server on http://0.0.0.0:${CONFIG.PORT} (AI at ${CONFIG.AI_URL})`);
  scanAndPublish().catch(() => {});
});
