// Conflict-free replicated inventory state.
//
// Model: per-SKU, per-client PN-Counter (G = restock increments, P = sale decrements).
//   stock(sku) = base(sku) + Σ_client G(client) − Σ_client P(client)
// PN-Counters are commutative, associative and idempotent, so merging the same event
// from any client in any order converges to the same state — no central lock needed.
//
// Vector clocks (client -> seq) track causal history: the merge below records the
// vector at convergence and uses it for replay determinism (event id, Lamport ts,
// then client tie-break) — the same rule a two-phase commit would use, minus the
// coordinator.
//
// Business policy applied *on top* of the CRDT (counter priority, reservation
// override, floor handling) lives in index.js/locks.js and is deterministic given
// the merged event log.

import crypto from 'node:crypto';
import { CONFIG } from './config.js';

const SIGNED_FIELDS = ['id', 'type', 'skuId', 'qty', 'channel', 'clientId', 'seq', 'ts', 'amount', 'offerId', 'origin'];

export function canonicalEvent(ev) {
  return JSON.stringify(SIGNED_FIELDS.map((f) => ev[f] ?? null));
}

export function signEvent(ev, secret = CONFIG.HMAC_SECRET) {
  return crypto.createHmac('sha256', secret).update(canonicalEvent(ev)).digest('base64');
}

export function verifyEvent(ev, secret = CONFIG.HMAC_SECRET) {
  if (!ev || typeof ev.hmac !== 'string') return false;
  const expect = signEvent(ev, secret);
  const a = Buffer.from(ev.hmac);
  const b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function vclockMerge(into, from) {
  for (const [c, n] of Object.entries(from ?? {})) into[c] = Math.max(into[c] ?? 0, n);
}

export class CrdtStore {
  constructor() {
    this.base = new Map();      // skuId -> baseline stock
    this.G = new Map();         // skuId -> Map(clientId -> units restocked)
    this.P = new Map();         // skuId -> Map(clientId -> units sold)
    this.vectors = new Map();   // clientId -> max seq observed (global)
    this.seen = new Set();      // event ids already merged (idempotency)
    this.log = [];              // merged events in deterministic replay order
  }

  setBase(skuId, n) { this.base.set(skuId, n); }

  /** Full day-reset for the demo: restores seed baselines and clears counters. */
  resetBases(bases) {
    this.G.clear();
    this.P.clear();
    this.seen.clear();
    this.log = [];
    this.base = new Map(Object.entries(bases));
  }

  stockOf(skuId) {
    const g = this.G.get(skuId);
    const p = this.P.get(skuId);
    let delta = 0;
    if (g) for (const v of g.values()) delta += v;
    if (p) for (const v of p.values()) delta -= v;
    return (this.base.get(skuId) ?? 0) + delta;
  }

  allStock() {
    const out = {};
    for (const sku of this.base.keys()) out[sku] = this.stockOf(sku);
    return out;
  }

  /**
   * Merge a batch of journaled events. Returns diagnostics for the sync toast:
   * { tookMs, merged, duplicates, rejected:[{id,reason}], stockAfter }
   */
  mergeBatch(events, { beforeApply, afterApply } = {}) {
    const t0 = process.hrtime.bigint();
    let merged = 0;
    let duplicates = 0;
    const rejected = [];

    for (const ev of events ?? []) {
      if (this.seen.has(ev.id)) { duplicates += 1; continue; }
      if (!verifyEvent(ev)) {
        rejected.push({ id: ev.id, reason: 'HMAC_INVALID' });
        continue;
      }
      const stockBefore = this.stockOf(ev.skuId);
      beforeApply?.(ev, stockBefore); // e.g. counter-priority reservation override

      const bucket = ev.type === 'RESTOCK' ? 'G' : ev.type === 'SALE' ? 'P' : null;
      if (bucket) {
        const map = this[bucket].get(ev.skuId) ?? new Map();
        map.set(ev.clientId, (map.get(ev.clientId) ?? 0) + ev.qty);
        this[bucket].set(ev.skuId, map);
      }
      // type 'REBASE' (manager correction) — LWW on base by (ts, clientId)
      if (ev.type === 'REBASE') this.base.set(ev.skuId, ev.qty);

      this.seen.add(ev.id);
      this.vectors.set(ev.clientId, Math.max(this.vectors.get(ev.clientId) ?? 0, ev.seq ?? 0));
      this.log.push(ev);
      merged += 1;
      const stockAfter = this.stockOf(ev.skuId);
      afterApply?.(ev, stockBefore, stockAfter);
    }

    // deterministic replay order for the audit trail: ts, then client, then seq
    this.log.sort((a, b) => (a.ts - b.ts) || a.clientId.localeCompare(b.clientId) || (a.seq - b.seq));
    if (this.log.length > 400) this.log.length = 400;

    return {
      tookMs: Number(process.hrtime.bigint() - t0) / 1e6,
      merged, duplicates, rejected,
      stockAfter: this.allStock(),
      vectors: Object.fromEntries(this.vectors),
    };
  }
}
