# Setu AI

**Offline-first merchant sync & AI micro-liquidation engine for Paytm**
*Paytm Build for India AI Hackathon — Track 1: Merchant Growth AI*

> “Setu” (सेतु) means **bridge** — this is the bridge between the physical counter and the digital storefront, so Indian micro-merchants never sell what they don't have, and never lose what they can't move.

---

## 1. The problem: “Ghost Inventory”

A kirana store, bakery or apparel shop sells on its counter **and** on digital channels (Paytm Near Me, WhatsApp catalog, delivery apps). Stock lives in two worlds and the sync is either:

- **manual** (updated at night) → 15–20% of online orders get cancelled because the item was sold off the shelf, or
- **deflated** (merchant under-reports stock 25–30%) → premature online stockouts destroy real demand, and
- **monolithic ERP** → too expensive and too slow for Tier-1…Tier-3 India, and it dies on flaky networks.

Add two more leaks: **dead stock / perishable capital decay** (8–12% of margin lost to slow movers and near-expiry goods) and **high counter friction** (cashiers lose sales to slow POS UIs).

## 2. What Setu AI does

| Pillar | Innovation | Paytm value add |
| --- | --- | --- |
| **Real-time sync** | Sub-50 ms WebSocket state propagation between POS and online catalogs; 90-second **optimistic reservation locks** with **counter-priority scan override** | Prevents online order cancellations on the Paytm Consumer App |
| **Offline resilience** | **IndexedDB** transaction journal (HMAC-SHA256 signed, vector-clocked) + **CRDT** (PN-counter) auto-reconciliation on reconnect | Zero store downtime on Paytm Smart POS during outages |
| **AI liquidation** | GBM **decay-risk model** (FastAPI microservice) maps margin-loss probability to automated action: geo flash deal on **Near Me** (1.5 km) or counter-side **bundle** hint | Boosts merchant GMV; instant **Paytm Soundbox** dual-language payment confirmations |

## 3. Live demo — 3 surfaces, one real stack

Open the preview (single URL, port **8080**):

1. **🧾 Merchant POS** — keyboard-first counter (keys `1`–`9`/`0` add items, `Enter` searches, `F2` charges, `F9` clears). Watch the live sync-latency badge, the offline queue, and the AI tray (flash deals + bundle hints). Click **⚡ Simulate outage**, sell a few items, restore — you'll watch the CRDT merge toast with its millisecond measurement.
2. **📱 Paytm Near Me** — simulated consumer app: AI flash banners with countdowns, live “1 left / held” stock badges, the 90-second reservation ring, UPI auto-pay success, and the graceful “just sold at the counter → instant alternative” flow.
3. **📡 Sync Ops** — KPI cards (cancellations prevented, offline revenue, margin recovered, conflicts auto-resolved), live event stream, active reservation locks with TTL bars, stock table with restock, the 500-event flood test, and a **▶ Run demo** button that plays the whole 8-step story (~60 s) against the real stack.

### Try the guided demo
`Sync Ops → ▶ Run demo`. It runs: baseline → AI decay scan (real model, real risk %) → consumer reserves the last milk unit (real 90 s TTL lock) → counter scan overrides (real policy, alternatives pushed) → network drop (3 sales journaled offline) → CRDT reconciliation (real merge, real ms) → flash deal sells online (real UPI-style checkout, Soundbox audible) → KPI rollup. Every number on screen comes from the running system.

## 4. Quickstart

```bash
# 1. Python AI microservice (venv)
python3 -m venv ai/.venv
ai/.venv/bin/pip install -r ai/requirements.txt     # model trains itself on boot if missing

# 2. Node + web deps and build the frontend
npm run setup      # installs server/ and web/ deps
npm run build      # vite build → web/dist (≈ 353 KB raw / 104 KB gzip)

# 3. Run everything (AI on 127.0.0.1:8001, app on 0.0.0.0:8080)
npm start
# → open http://localhost:8080
```

Verification scripts: `node scripts/smoke.mjs` (17 API/CRDT/lock checks) and `node scripts/demo-check.mjs` (full guided demo over WebSocket).

## 5. Architecture

```
Paytm Smart POS (Android webview)        Paytm Consumer App (“Near Me”)
  React · keyboard-first                  React (simulated in demo)
  IndexedDB journal ◂── HMAC + vclock      cart · reservation ring · UPI
        │  (write-ahead, offline-safe)             │
        ▼                                          ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Node.js + Express + Socket.io  (sub-50 ms event bus)    │
   │  · /api/sync/merge  — CRDT merge (PN-counters, idempotent│
   │    by event id, HMAC-verified, deterministic replay log) │
   │  · reservation locks — 90 s TTL, counter-priority        │
   │    override, graceful alternative suggestion             │
   │  · KPI metrics · event stream · demo driver              │
   └───────────────┬──────────────────────────────┬───────────┘
                   │  HTTP (server-to-server)     │  state fan-out
                   ▼                              ▼
     FastAPI decay engine (Python)      Socket.io broadcast
     sklearn GBM · P(margin loss)       POS / Near Me / Ops
     risk → discount policy (30/20/15%)
```

**Modules**

| Path | Role |
| --- | --- |
| `web/src/views/Pos.jsx` | Keyboard-first merchant POS, offline queue, AI tray |
| `web/src/views/Consumer.jsx` | Paytm Near Me simulation: flash deals, 90 s lock ring, UPI flow, override alternative |
| `web/src/views/Ops.jsx` | KPIs, event stream, locks, stock, flood test, demo runner, NFR checklist |
| `web/src/lib/idb.js` · `vclock.js` · `hmac.js` · `sound.js` | IndexedDB journal, vector clocks, HMAC-SHA256 signing, Soundbox-style WebAudio + bilingual TTS |
| `server/src/crdt.js` | PN-counter CRDT store, event signing/verification, deterministic merge |
| `server/src/locks.js` | Optimistic reservation lock store (Redis `SET NX PX` semantics; swap in a Redis adapter for prod) |
| `server/src/index.js` | Event bus, merge orchestration, offer publication, KPIs, REST + Socket.io |
| `server/src/demo.js` | 8-step guided demo driver (runs on the real stack, no faked numbers) |
| `ai/app/model.py` · `synthetic.py` · `main.py` | GBM decay-risk model, synthetic 30-day training history, FastAPI `/scan` · `/train` |

## 6. The hard parts (substance over slop)

- **CRDT inventory, not polling.** Each SKU is a per-client **PN-counter** (G = restocks, P = sales); `stock = base + ΣG − ΣP`. PN-counters are commutative, associative and idempotent → any batch, any order, any number of replicas converges to the same state. Event ids give idempotent replay; vector clocks record causal history; the merged log is kept in deterministic `(ts, client, seq)` replay order.
- **Optimistic locks with a business policy on top.** A 90 s soft lock (`TTL`, extendable, auto-sweep) holds a unit for an online checkout. If a barcode scan hits the same SKU and the counter would take the last available unit, **counter wins**: the lock is released and the consumer gets an instant same-category alternative *before* payment — eliminating post-payment fulfilment failure, which is exactly the ghost-inventory cancellation we're killing.
- **HMAC-SHA256 on every event** (fixed field-order canonicalisation, `crypto.subtle` in the browser, `timingSafeEqual` on the server) → tampered events are rejected at merge time (covered by the smoke test).
- **The AI is a model, not a wrapper.** A GradientBoosting classifier (sklearn; drop-in for LightGBM in prod) trained on a 30-day synthetic hourly history scores `P(total margin loss by close)` from 10 features (hours-to-risk-deadline, shelf-life consumed, unsold fraction, velocity z-score, footfall, margin at risk, slow-mover lockup…). The **deadline for perishables is `min(store close, batch expiry)`** — that's why the 4:30 PM pastry trigger from the PRD works. Risk is then mapped to a deterministic action: ≥65% → 30% Near Me flash (1.5 km), ≥45% → 20%, ≥30% → 15% counter bundle, slow mover >45 days → bundle hint. The Node side has a transparent heuristic fallback so the demo never dies if Python hiccups.
- **Offline-first client.** Sales journal to IndexedDB *before* any network call; the POS renders from `server truth − local pending delta` so the shelf count is right even mid-outage; on reconnect the whole queue merges in one POST.

## 7. Non-functional requirements — measured, not claimed

| NFR (from PRD) | Demo evidence |
| --- | --- |
| Sync latency < 50 ms | Header badge measures real WS ping/pong round-trip, live (`LIVE · 2 ms` in sandbox) |
| 10,000 events offline in IndexedDB | Journal is a plain IDB object store; no per-event network, no pagination; 500+ events flush in one batch |
| 500-event merge < 1 s | **Sync Ops → 500-event queue**: typical measured merge **6–20 ms** (server `process.hrtime`) |
| Bundle < 1.5 MB | Vite build: **352.6 KB raw / 103.5 KB gzip** (312.5 KB JS + 40.1 KB CSS) |
| AES-256 + HMAC integrity | Every event HMAC-SHA256 signed end-to-end (reject-on-tamper tested); AES-GCM envelope for at-rest IDB is the documented prod upgrade (demo keeps the journal readable for inspection) |
| Sub-second reconciliation UX | Merge toast + KPI show real `tookMs` on every flush |

## 8. Business KPIs the system tracks live

- **Online cancellations prevented** — reservation overrides resolved pre-payment
- **Offline revenue captured (₹)** — counter sales during outages
- **Margin recovered (₹)** — liquidation units sold that would have been binned
- **Conflicts auto-resolved** — CRDT floor/policy conflicts handled without a human
- **Counter vs online sales mix** — channel attribution from merged events

## 9. Naming

The original working title “SyncGrid” describes a component, not a product. Recommended:

- **🏆 Setu AI** — “setu” = bridge (Hindi/Sanskrit), the exact metaphor: bridging the counter and the cloud. Short, Indian, ownable, and it pairs naturally with “Paytm Smart POS + Setu AI”.
- Runners-up: **TatkalSync** (tatkal = instant → the <50 ms story), **DukaanSync** (dukaan = the local shop → instantly readable for kirana merchants), **BazaarPulse** (live pulse of the bazaar), **ShelfSutra** (the formula for your shelves).

The product name is a single constant — `web/src/product.js` (`PRODUCT_NAME`) — so swapping to any of these is a one-line change.

## 10. Production hardening notes (what a v1.1 looks like)

- **Redis adapter** for the lock store (`SET lock:<sku> … NX PX 90000` + keyspace-expiry events); the in-process store in `locks.js` already implements that contract.
- **Postgres/Mongo persistence** for the merged event log (currently in-memory, capped at 400 entries for the demo) + nightly rebase.
- **AES-GCM envelope** over the IndexedDB journal (key from Android Keystore on the Smart POS).
- **LightGBM** + merchant-specific retraining via `/train` once 30 days of real POS/consumer history exists (the synthetic generator is the cold-start stand-in).
- Real **Paytm APIs**: Near Me offer feed, Merchant App order events, Soundbox TTS endpoint, UPI QR/auto-pay settlement webhooks — the event contracts in this repo are shaped so those drop into `index.js` handlers without touching the CRDT or lock layers.
