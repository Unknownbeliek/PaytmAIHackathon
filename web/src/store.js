import { create } from 'zustand';
import {
  journal, pendingEvents, pendingCount, clearJournal,
} from './lib/idb.js';
import { nextSeq, adoptServerVector } from './lib/vclock.js';
import { signEvent } from './lib/hmac.js';
import {
  ding, chime, warnBlip, soundboxSale, soundboxSync, soundboxFlashDeal, setSoundEnabled,
} from './lib/sound.js';
import { CONSUMER_SESSION } from './product.js';

export const CLIENT_ID =
  localStorage.getItem('setu:clientId') ||
  (() => {
    const id = 'pos-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('setu:clientId', id);
    return id;
  })();

let toastSeq = 0;

const initialConsumer = {
  cart: [],           // [{skuId, qty}]
  stage: 'idle',      // idle | reserved | paying | paid | overridden
  lock: null,
  alternatives: [],
  receipt: null,
  reservedOfferId: null,
};

export const useStore = create((set, get) => ({
  view: 'pos',
  setView: (view) => set({ view }),

  socketConnected: false,
  latencyMs: null,
  navOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  manualOffline: false,

  snap: null,
  pending: 0,
  demoPending: 0,       // server-mirrored demo queue (kept out of the real journal)
  pendingDelta: {},     // skuId -> units sold offline, not yet reconciled
  lastMerge: null,

  cart: [],             // [{skuId, qty, price, bundlePct}]
  toasts: [],
  soundOn: true,
  toggleSound: () => {
    const on = !get().soundOn;
    setSoundEnabled(on);
    set({ soundOn: on });
  },

  consumer: { ...initialConsumer },
  demo: { running: false, total: 0, current: null, history: [] },

  // ------------------------------------------------------------------ toasts
  toast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },

  // ------------------------------------------------------------------- cart
  addToCart: (skuId, opts = {}) => {
    const { snap } = get();
    if (!snap) return;
    const item = snap.catalog.find((c) => c.id === skuId);
    if (!item) return;
    const stock = get().displayStock(skuId);
    if (stock <= 0) { get().toast('warn', `${item.name} is out of stock`); return; }
    const offer = snap.offers.find((o) => o.skuId === skuId);
    set((s) => {
      const line = s.cart.find((l) => l.skuId === skuId);
      if (line) {
        if (line.qty + 1 > stock) return { cart: s.cart };
        return { cart: s.cart.map((l) => (l.skuId === skuId ? { ...l, qty: l.qty + 1 } : l)) };
      }
      return {
        cart: [
          ...s.cart,
          { skuId, qty: 1, price: opts.price ?? item.price, bundlePct: opts.bundlePct ?? 0, offerId: opts.offerId ?? null },
        ],
      };
    });
    tickBlip();
  },
  setCartQty: (skuId, qty) =>
    set((s) => ({
      cart: qty <= 0 ? s.cart.filter((l) => l.skuId !== skuId) : s.cart.map((l) => (l.skuId === skuId ? { ...l, qty } : l)),
    })),
  clearCart: () => set({ cart: [] }),

  displayStock: (skuId) => {
    const { snap, pendingDelta } = get();
    if (!snap) return 0;
    return (snap.stock[skuId] ?? 0) - (pendingDelta[skuId] ?? 0);
  },

  // ------------------------------------------------------------ offline journal
  effectiveOnline: () => get().navOnline && !get().manualOffline,

  toggleManualOffline: () => {
    const manualOffline = !get().manualOffline;
    set({ manualOffline });
    if (!manualOffline) get().flushAll();
    else get().toast('warn', 'Network outage simulated — sales will queue in IndexedDB');
  },

  buildEvents: async (lines) => {
    const online = get().effectiveOnline();
    const events = [];
    for (const line of lines) {
      const seq = nextSeq(CLIENT_ID);
      const ev = {
        id: crypto.randomUUID(),
        type: 'SALE',
        skuId: line.skuId,
        qty: line.qty,
        channel: 'COUNTER',
        clientId: CLIENT_ID,
        seq,
        ts: Date.now(),
        amount: Math.round(line.price * line.qty),
        offerId: line.offerId ?? null,
        origin: online ? 'online' : 'offline',
      };
      ev.hmac = await signEvent(ev);
      events.push(ev);
    }
    return events;
  },

  completeSale: async () => {
    const { cart, buildEvents, flushAll, toast } = get();
    if (!cart.length) return;
    const events = await buildEvents(cart);
    await journal(events);
    const online = get().effectiveOnline();
    if (online) {
      await flushAll();
    } else {
      set((s) => {
        const d = { ...s.pendingDelta };
        for (const e of events) d[e.skuId] = (d[e.skuId] ?? 0) + e.qty;
        return { pending: s.pending + events.length, pendingDelta: d };
      });
      toast('warn', `OFFLINE — ${events.length} sale event(s) journaled locally, zero downtime`);
    }
    const total = cart.reduce((a, l) => a + l.price * l.qty, 0);
    ding();
    soundboxSale(total);
    set({ cart: [] });
  },

  flushAll: async () => {
    const { toast, lastMerge } = get();
    const pending = await pendingEvents();
    if (!pending.length) {
      set({ pending: 0, pendingDelta: {} });
      return;
    }
    if (!get().effectiveOnline()) { set({ pending: pending.length }); return; }
    try {
      const res = await fetch('/api/sync/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: CLIENT_ID, events: pending }),
      });
      if (!res.ok) throw new Error(`merge ${res.status}`);
      const j = await res.json();
      adoptServerVector(j.vectors);
      await clearJournal(pending.map((e) => e.id));
      set({ pending: 0, pendingDelta: {}, lastMerge: { tookMs: j.tookMs, n: j.merged, at: Date.now() } });
      if (j.merged > 0 && lastMerge?.at !== j.at) {
        toast('sync', `CRDT reconciled ${j.merged} event(s) in ${j.tookMs.toFixed(1)} ms — vector clocks converged`);
        soundboxSync(j.merged);
      }
    } catch {
      set({ pending: pending.length });
      toast('error', 'Flush failed — queue safe in IndexedDB, will retry');
    }
  },

  refreshPending: async () => {
    const n = await pendingCount();
    if (n !== get().pending) set({ pending: n });
  },

  // ------------------------------------------------------------- consumer app
  consumerAdd: (skuId) =>
    set((s) => {
      const line = s.consumer.cart.find((l) => l.skuId === skuId);
      return {
        consumer: {
          ...s.consumer,
          cart: line
            ? s.consumer.cart.map((l) => (l.skuId === skuId ? { ...l, qty: l.qty + 1 } : l))
            : [...s.consumer.cart, { skuId, qty: 1 }],
        },
      };
    }),
  consumerRemove: (skuId) =>
    set((s) => ({ consumer: { ...s.consumer, cart: s.consumer.cart.filter((l) => l.skuId !== skuId) } })),

  consumerReserve: async (skuId, qty = 1) => {
    const { snap, toast } = get();
    const item = snap.catalog.find((c) => c.id === skuId);
    const offer = snap.offers.find((o) => o.skuId === skuId);
    set({ consumer: { ...get().consumer, stage: 'paying', payTarget: { skuId, qty, offerId: offer?.offerId ?? null } } });
    const reserveRes = await fetch('/api/online/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skuId, qty, sessionId: CONSUMER_SESSION }),
    }).then((r) => r.json());
    if (!reserveRes.ok) {
      set({ consumer: { ...get().consumer, stage: 'overridden', lock: null, alternatives: reserveRes.alternatives ?? [] } });
      toast('warn', reserveRes.code === 'UNAVAILABLE' ? 'Just sold out — alternatives shown' : 'Already reserved elsewhere');
      warnBlip();
      return false;
    }
    set({ consumer: { ...get().consumer, stage: 'reserved', lock: reserveRes.lock } });
    toast('info', `Holding ${item?.name ?? skuId} for 90 seconds (soft lock)`);
    return true;
  },

  consumerPay: async () => {
    const c = get().consumer;
    const target = c.payTarget;
    if (!c.lock || !target) return;
    const { snap } = get();
    const item = snap.catalog.find((x) => x.id === target.skuId);
    const offer = snap.offers.find((o) => o.skuId === target.skuId);
    const payRes = await fetch('/api/online/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lockId: c.lock.lockId, skuId: target.skuId, qty: target.qty,
        sessionId: CONSUMER_SESSION, offerId: target.offerId ?? offer?.offerId ?? null,
      }),
    }).then((r) => r.json());
    if (!payRes.ok) {
      set({ consumer: { ...get().consumer, stage: 'overridden', lock: null, alternatives: payRes.alternatives ?? [] } });
      warnBlip();
      return;
    }
    chime();
    set({
      consumer: {
        ...get().consumer,
        stage: 'paid',
        lock: null,
        payTarget: null,
        receipt: { ...payRes.receipt, name: item?.name ?? target.skuId, emoji: item?.emoji ?? '🛒', offerId: target.offerId ?? offer?.offerId ?? null, origPrice: item?.price ?? 0 },
        cart: get().consumer.cart.filter((l) => l.skuId !== target.skuId),
      },
    });
  },

  consumerCancel: async () => {
    const lock = get().consumer.lock;
    if (lock) {
      await fetch('/api/online/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockId: lock.lockId }),
      }).catch(() => {});
    }
    set({ consumer: { ...get().consumer, stage: 'idle', lock: null, alternatives: [] } });
  },

  consumerSwap: (altSkuId) => {
    get().consumerRemove(altSkuId);
    get().consumerAdd(altSkuId);
    get().consumerReserve(altSkuId, 1);
  },
  consumerReset: () => set({ consumer: { ...initialConsumer } }),

  // ------------------------------------------------------------------- server
  aiScan: async () => {
    const { toast } = get();
    toast('info', 'AI decay scan running…');
    const r = await fetch('/api/ai/scan', { method: 'POST' }).then((x) => x.json());
    if (r.ok) {
      const live = r.results.filter((x) => x.channel === 'near_me' && x.recommended_discount_pct > 0).length;
      toast('ai', `Scan done (${r.model}) — ${live} flash deal(s) eligible for Near Me`);
    } else get().toast('error', 'AI scan failed');
  },

  floodTest: async (count = 500) => {
    const { toast } = get();
    toast('info', `Injecting ${count}-event offline queue…`);
    const r = await fetch('/api/demo/flood', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    }).then((x) => x.json());
    if (r.ok) toast('sync', `Flood test: ${r.count} events merged in ${r.tookMs} ms (NFR: < 1000 ms)`);
    else toast('error', 'Flood test failed');
  },

  runDemo: async () => {
    await fetch('/api/demo/start', { method: 'POST' }).catch(() => {});
    set({ demo: { ...get().demo, running: true, current: null, history: [] } });
  },
  stopDemo: async () => {
    await fetch('/api/demo/stop', { method: 'POST' }).catch(() => {});
    set({ demo: { ...get().demo, running: false } });
  },
  demoStep: (step) =>
    set((s) => ({
      demo: {
        running: true,
        total: step.total,
        current: step,
        history: [...s.demo.history.filter((h) => h.i < step.i), step],
      },
    })),
  demoStopped: () => set((s) => ({ demo: { ...s.demo, running: false } })),

  // ------------------------------------------------------------- demo hooks
  demoHook: (hook) => {
    const st = get();
    if (hook.name === 'offline') {
      set({ manualOffline: true });
      st.toast('warn', 'DEMO: broadband dropped — POS stays live, journaling to IndexedDB');
    } else if (hook.name === 'queue') {
      // Server-side mirror of the POS's offline journal (keeps the demo robust
      // across tabs); the POS shows the queue size on its status strip.
      set((s) => ({ demoPending: (s.demoPending ?? 0) + hook.count }));
    } else if (hook.name === 'online') {
      set({ manualOffline: false, demoPending: 0 });
      st.flushAll(); // also reconciles anything the cashier queued manually
      st.toast('sync', `DEMO: broadband restored — ${hook.merged ?? 0} offline event(s) CRDT-merged in ${hook.tookMs?.toFixed(1) ?? '—'} ms`);
    } else if (hook.name === 'override') {
      const c = st.consumer;
      if (c.lock && c.lock.skuId === hook.skuId) {
        set({ consumer: { ...c, stage: 'overridden', lock: null, alternatives: hook.alternatives ?? [] } });
      }
    }
  },

  offerPublished: (offer) => {
    const item = get().snap?.catalog.find((c) => c.id === offer.skuId);
    get().toast('ai', `⚡ Flash deal LIVE: ${item?.name ?? offer.skuId} −${offer.discountPct}% · ${offer.radiusKm} km radius`);
    soundboxFlashDeal(item?.name ?? offer.skuId);
  },
}));

export function useSnap() {
  return useStore((s) => s.snap);
}
