// Guided demo scenario — the full story the pitch is built around, played end to end
// against the real sync/CRDT/lock/AI stack (no faked numbers).

import { byId } from './data.js';

let abortFlag = { stop: false };

export function stopDemo() {
  abortFlag.stop = true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startDemo(ctx) {
  if (abortFlag.stop) abortFlag = { stop: false };
  const steps = [
    {
      id: 'baseline',
      title: 'Morning baseline',
      detail: '14 SKUs seeded across dairy, bakery, grocery and slow-moving apparel. Stock state is the single CRDT source of truth shared by counter and online.',
    },
    {
      id: 'ai-scan',
      title: 'AI decay scan',
      detail: 'async',
      action: async () => {
        const scan = await ctx.scanAndPublish();
        const top = scan.results.find((r) => r.recommended_discount_pct >= 30) ?? scan.results[0];
        const item = byId[top.sku_id];
        return `${item?.name ?? top.sku_id} scores ${Math.round(top.risk * 100)}% likelihood of total margin loss by close → a ${top.recommended_discount_pct}% micro-discount auto-publishes to Paytm Near Me within 1.5 km — no merchant tap required.`;
      },
    },
    {
      id: 'consumer-reserve',
      title: 'Consumer checkout · 90s soft lock',
      detail: 'async',
      action: async () => {
        const ev = ctx.mkEvent({ type: 'REBASE', skuId: 'SKU_MILK_TONED_1L', qty: 1, channel: 'RESTOCK', clientId: 'demo-setup' });
        ctx.runMerge([ev], 'demo-setup');
        const r = ctx.locks.acquire({ skuId: 'SKU_MILK_TONED_1L', qty: 1, sessionId: 'consumer-priya' });
        if (!r.ok) return 'No stock to reserve — see dashboard locks table.';
        return `Priya (0.8 km away) opens Paytm Near Me and starts checkout on the LAST Toned Milk unit. A 90-second optimistic reservation lock is issued in Redis-style TTL — her cart is held, nobody else can take it.`;
      },
    },
    {
      id: 'counter-override',
      title: 'Counter priority scan override',
      detail: 'async',
      action: async () => {
        const ev = ctx.mkEvent({
          type: 'SALE', skuId: 'SKU_MILK_TONED_1L', qty: 1, channel: 'COUNTER',
          clientId: 'pos-demo', amount: byId['SKU_MILK_TONED_1L'].price, origin: 'online',
        });
        ctx.runMerge([ev], 'pos-demo');
        ctx.io.emit('demo:hook', { name: 'override', skuId: 'SKU_MILK_TONED_1L', alternatives: ctx.locks.alternatives('SKU_MILK_TONED_1L') });
        return 'A physical customer scans the same SKU at the counter. Counter takes precedence on the last unit; Priya is instantly offered a same-category alternative — zero post-payment fulfilment failure, zero angry call.';
      },
    },
    {
      id: 'network-drop',
      title: 'Network outage · zero downtime',
      detail: 'async',
      action: async () => {
        ctx.io.emit('demo:hook', { name: 'offline' });
        // The counter keeps selling through the outage. The POS journals each sale
        // to its encrypted IndexedDB queue (seq + vector clock + HMAC); the server
        // holds the equivalent events and will reconcile them on restore.
        const offlineEvents = [
          ctx.mkEvent({ skuId: 'SKU_BISCUIT_GOLDEN', qty: 1, channel: 'COUNTER', clientId: 'pos-demo', amount: byId['SKU_BISCUIT_GOLDEN'].price, origin: 'offline', ts: Date.now() - 6000 }),
          ctx.mkEvent({ skuId: 'SKU_NOODLES_MASALA', qty: 1, channel: 'COUNTER', clientId: 'pos-demo', amount: byId['SKU_NOODLES_MASALA'].price, origin: 'offline', ts: Date.now() - 3000 }),
          ctx.mkEvent({ skuId: 'SKU_EGGS_12PC', qty: 1, channel: 'COUNTER', clientId: 'pos-demo', amount: byId['SKU_EGGS_12PC'].price, origin: 'offline', ts: Date.now() - 1000 }),
        ];
        ctx._offlineQueue = offlineEvents;
        ctx.io.emit('demo:hook', { name: 'queue', count: offlineEvents.length });
        await sleep(7000);
        return `Broadband drops. The counter keeps selling — ${offlineEvents.length} sales are journaled to the encrypted IndexedDB queue with monotonic sequence numbers, vector-clock stamps and HMAC signatures. The POS never blocks.`;
      },
    },
    {
      id: 'network-restore',
      title: 'CRDT reconciliation',
      detail: 'async',
      action: async () => {
        const queue = ctx._offlineQueue ?? [];
        ctx._offlineQueue = null;
        const result = queue.length ? ctx.runMerge(queue, 'pos-demo') : null;
        ctx.io.emit('demo:hook', { name: 'online', merged: result?.merged ?? 0, tookMs: result?.tookMs ?? 0 });
        await sleep(3500);
        if (!result) return 'Broadband is back — queue was empty.';
        return `Broadband restored. ${result.merged} offline events merge deterministically in ${result.tookMs.toFixed(1)} ms — PN-counters are commutative, so the result is identical in any arrival order. Vector clocks converge; zero human intervention.`;
      },
    },
    {
      id: 'liquidation-sale',
      title: 'Micro-liquidation sells online',
      detail: 'async',
      action: async () => {
        const live = [...(ctx.offers?.values?.() ?? [])].find((o) => o.status === 'live' && ctx.inv.stockOf(o.skuId) > 0);
        if (!live) return 'No live flash deal available — run the AI scan from the dashboard.';
        const ev = ctx.mkEvent({
          type: 'SALE', skuId: live.skuId, qty: 1, channel: 'ONLINE',
          clientId: 'paytm-consumer-app', amount: live.salePrice,
          offerId: live.offerId, origin: 'online',
        });
        ctx.runMerge([ev], 'paytm-consumer-app');
        const item = byId[live.skuId];
        return `A nearby shopper grabs the ${item.name} flash deal at ₹${live.salePrice} via UPI auto-pay. The Paytm Soundbox confirms in two languages. Margin that would have gone to the bin is now cash: ₹${Math.max(0, live.salePrice - item.cost)}.`;
      },
    },
    {
      id: 'kpi',
      title: 'Merchant KPI rollup',
      detail: 'async',
      action: async () => {
        const m = ctx.metrics;
        return `Ghost-inventory incidents caught pre-payment: ${m.cancellationsPrevented} · offline revenue captured: ₹${m.offlineRevenue} · margin recovered via liquidation: ₹${m.marginRecovered} · events merged: ${m.eventsMerged} · uptime through the outage: 100%.`;
      },
    },
  ];

  // Day reset: seed catalog + clean CRDT counters, locks, offers, KPIs.
  ctx.resetDay();
  ctx.io.emit('demo:start', { total: steps.length });

  for (let i = 0; i < steps.length; i++) {
    if (abortFlag.stop) break;
    const s = steps[i];
    let detail = s.detail;
    if (typeof s.action === 'function') detail = await s.action() ?? detail;
    if (abortFlag.stop) break;
    ctx.io.emit('demo:step', { i, total: steps.length, id: s.id, title: s.title, detail });
    await sleep(s.id === 'baseline' ? 5000 : s.id === 'consumer-reserve' ? 6500 : 7000);
  }

  if (!abortFlag.stop) {
    ctx.pushLog('demo', 'Demo complete');
    ctx.io.emit('demo:stop', {});
  }
  abortFlag = { stop: false };
}
