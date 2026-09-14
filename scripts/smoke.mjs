// End-to-end smoke test against the running stack.
const BASE = 'http://127.0.0.1:8080';
const SECRET = 'setu-demo-hmac-v1';
const crypto = await import('node:crypto');

const FIELDS = ['id', 'type', 'skuId', 'qty', 'channel', 'clientId', 'seq', 'ts', 'amount', 'offerId', 'origin'];
const sign = (ev) =>
  crypto.createHmac('sha256', SECRET).update(JSON.stringify(FIELDS.map((f) => ev[f] ?? null))).digest('base64');
const mk = (p) => { const ev = { id: crypto.randomUUID(), type: 'SALE', skuId: null, qty: 1, channel: 'COUNTER', clientId: 't', seq: 1, ts: Date.now(), amount: 0, offerId: null, origin: 'offline', ...p }; ev.hmac = sign(ev); return ev; };
const j = (r) => r.json();
let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`); if (!cond) fails++; };

// 0. fresh day so the test is idempotent
await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
await new Promise((r) => setTimeout(r, 800));

// 1. state
const st = await fetch(`${BASE}/api/state`).then(j);
check('state: 14 SKUs', st.catalog.length === 14);
check('state: milk stock 12', st.stock['SKU_MILK_TONED_1L'] === 12, `(${st.stock['SKU_MILK_TONED_1L']})`);
check('state: offers published at boot', st.offers.length >= 1, `(${st.offers.map(o => o.skuId).join(',')})`);

// 2. CRDT merge: 3 offline counter sales
const evs = [
  mk({ skuId: 'SKU_BISCUIT_GOLDEN', qty: 2, amount: 110, clientId: 't1', seq: 1 }),
  mk({ skuId: 'SKU_EGGS_12PC', qty: 1, amount: 96, clientId: 't1', seq: 2 }),
  mk({ skuId: 'SKU_BISCUIT_GOLDEN', qty: 1, amount: 55, clientId: 't1', seq: 3 }),
];
const m1 = await fetch(`${BASE}/api/sync/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 't1', events: evs }) }).then(j);
check('merge: 3 merged', m1.merged === 3, `(${m1.merged})`);
check('merge: stock 24->21', st && (await fetch(`${BASE}/api/state`).then(j)).stock['SKU_BISCUIT_GOLDEN'] === 21);
// idempotency: replay same batch
const m2 = await fetch(`${BASE}/api/sync/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 't1', events: evs }) }).then(j);
check('merge: idempotent replay (0 merged, 3 dup)', m2.merged === 0 && m2.duplicates === 3, `(${m2.merged}/${m2.duplicates})`);
// tamper: bad hmac rejected
const bad = mk({ skuId: 'SKU_EGGS_12PC', qty: 1, amount: 96, clientId: 't1', seq: 4 });
bad.hmac = 'tampered';
const m3 = await fetch(`${BASE}/api/sync/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 't1', events: [bad] }) }).then(j);
check('merge: tampered HMAC rejected', m3.rejected.length === 1 && m3.rejected[0].reason === 'HMAC_INVALID');

// 3. reservation + counter override
const rebase = await fetch(`${BASE}/api/sync/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 't2', events: [mk({ type: 'REBASE', skuId: 'SKU_SANDWICH_CHEESE', qty: 1, channel: 'RESTOCK', clientId: 't2', seq: 1 })] }) }).then(j);
check('rebase: sandwich to 1', (await fetch(`${BASE}/api/state`).then(j)).stock['SKU_SANDWICH_CHEESE'] === 1);
const res = await fetch(`${BASE}/api/online/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skuId: 'SKU_SANDWICH_CHEESE', qty: 1, sessionId: 'c1' }) }).then(j);
check('reserve: lock ok', res.ok === true && res.lock);
const ov = await fetch(`${BASE}/api/sync/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 't2', events: [mk({ skuId: 'SKU_SANDWICH_CHEESE', qty: 1, amount: 80, channel: 'COUNTER', clientId: 't2', seq: 2 })] }) }).then(j);
const st2 = await fetch(`${BASE}/api/state`).then(j);
check('override: counter sale applied, lock gone', st2.stock['SKU_SANDWICH_CHEESE'] === 0 && st2.locks.length === 0);
check('override: KPI counted', st2.metrics.cancellationsPrevented === 1, `(${st2.metrics.cancellationsPrevented})`);
// consumer checkout after override must fail gracefully
const co = await fetch(`${BASE}/api/online/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lockId: res.lock.lockId, skuId: 'SKU_SANDWICH_CHEESE', qty: 1, sessionId: 'c1' }) }).then(j);
check('checkout: LOCK_GONE + alternatives', co.ok === false && Array.isArray(co.alternatives), `(${co.code}, alts=${co.alternatives?.length})`);

// 4. reserve + successful online checkout with flash offer (must have available stock)
const offer = st2.offers.find((o) => o.status === 'live' && (st2.stock[o.skuId] ?? 0) > (st2.reserved?.[o.skuId] ?? 0));
if (offer) {
  const r2 = await fetch(`${BASE}/api/online/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skuId: offer.skuId, qty: 1, sessionId: 'c2' }) }).then(j);
  const c2 = await fetch(`${BASE}/api/online/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lockId: r2.lock.lockId, skuId: offer.skuId, qty: 1, sessionId: 'c2', offerId: offer.offerId }) }).then(j);
  check('online checkout: ok + discounted amount', c2.ok === true && c2.receipt.amount === offer.salePrice, `(₹${c2.receipt?.amount} vs ₹${offer.salePrice})`);
  const st3 = await fetch(`${BASE}/api/state`).then(j);
  check('margin recovered: ₹' + st3.metrics.marginRecovered, st3.metrics.marginRecovered > 0);
} else {
  console.log('• (no live offer to test online checkout)');
}

// 5. flood: 500 events sub-second
const flood = await fetch(`${BASE}/api/demo/flood`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 500 }) }).then(j);
check('flood: 500 events < 1000 ms', flood.ok && flood.tookMs < 1000, `(${flood.tookMs} ms)`);

// 6. AI scan
const scan = await fetch(`${BASE}/api/ai/scan`, { method: 'POST' }).then(j);
check('AI scan: model gbc-v1', scan.model === 'gbc-v1' && !scan.degraded, `(${scan.model})`);
console.log('   top risks:', scan.results.slice(0, 3).map((r) => `${r.sku_id}:${Math.round(r.risk * 100)}%`).join(' '));

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
