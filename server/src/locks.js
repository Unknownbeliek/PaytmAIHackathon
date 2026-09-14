// Optimistic 90-second checkout reservation locks.
//
// Semantics mirror a Redis implementation (`SET lock:<sku> <payload> NX PX 90000`
// + keyspace expiration events). An in-process store is used in the demo sandbox;
// the same interface is what a RedisLockStore adapter would implement in prod.

import crypto from 'node:crypto';
import { CONFIG } from './config.js';
import { byId, alternativesFor } from './data.js';

export class LockStore {
  constructor(inv, { onEvent } = {}) {
    this.inv = inv;
    this.onEvent = onEvent;
    this.locks = new Map(); // lockId -> lock
    this.bySku = new Map(); // skuId -> lockId
    setInterval(() => this.sweep(), 5000).unref();
  }

  reservedQty(skuId) {
    const id = this.bySku.get(skuId);
    return id ? this.locks.get(id).qty : 0;
  }

  available(skuId) {
    return Math.max(0, this.inv.stockOf(skuId) - this.reservedQty(skuId));
  }

  acquire({ skuId, qty, sessionId, channel = 'PAYTM_CONSUMER_APP' }) {
    if (this.bySku.has(skuId)) {
      return { ok: false, code: 'ALREADY_RESERVED', alternatives: this.alternatives(skuId) };
    }
    const available = this.available(skuId);
    if (qty > available) {
      return { ok: false, code: 'UNAVAILABLE', available, alternatives: this.alternatives(skuId) };
    }
    const lockId = crypto.randomUUID();
    const lock = {
      lockId, skuId, qty, sessionId, channel,
      createdAt: Date.now(),
      expiresAt: Date.now() + CONFIG.RESERVATION_TTL_SECONDS * 1000,
    };
    this.locks.set(lockId, lock);
    this.bySku.set(skuId, lockId);
    this.onEvent?.('lock:acquired', lock);
    return { ok: true, lock, availableAfter: available - qty };
  }

  extend(lockId, ms = CONFIG.RESERVATION_TTL_SECONDS * 1000) {
    const lock = this.locks.get(lockId);
    if (!lock) return null;
    lock.expiresAt = Date.now() + ms;
    this.onEvent?.('lock:extended', lock);
    return lock;
  }

  release(lockId, reason = 'RELEASED') {
    const lock = this.locks.get(lockId);
    if (!lock) return null;
    this.locks.delete(lockId);
    if (this.bySku.get(lock.skuId) === lockId) this.bySku.delete(lock.skuId);
    this.onEvent?.('lock:released', { ...lock, reason });
    return lock;
  }

  /** Counter-priority scan override: physical counter beats a soft online reservation. */
  overrideForCounter(skuId, evQty, stockBefore) {
    const lockId = this.bySku.get(skuId);
    if (!lockId) return null;
    const lock = this.locks.get(lockId);
    if (!lock) return null;
    const counterTakesLastUnit = stockBefore - lock.qty < evQty;
    if (!counterTakesLastUnit) return null; // both channels still satisfiable
    this.release(lockId, 'COUNTER_OVERRIDE');
    const notice = {
      type: 'RESERVATION_OVERRIDE',
      skuId, qty: evQty,
      consumerSession: lock.sessionId,
      lockId,
      reason: 'Physical counter took precedence on the last unit.',
      alternatives: this.alternatives(skuId),
      at: Date.now(),
    };
    this.onEvent?.('lock:overridden', notice);
    return notice;
  }

  list() {
    const now = Date.now();
    return [...this.locks.values()]
      .filter((l) => l.expiresAt > now)
      .map((l) => ({ ...l, remainingMs: l.expiresAt - now, ttlMs: CONFIG.RESERVATION_TTL_SECONDS * 1000 }));
  }

  sweep() {
    const now = Date.now();
    for (const l of this.locks.values()) if (l.expiresAt <= now) this.release(l.lockId, 'TTL_EXPIRED');
  }

  alternatives(skuId) {
    const sku = byId[skuId];
    if (!sku) return [];
    return alternativesFor(sku, this.inv.allStock());
  }
}
