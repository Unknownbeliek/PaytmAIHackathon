import { useEffect, useState } from 'react';
import { useStore } from '../store.js';

function useNow(intervalMs = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function CountdownRing({ expiresAt, now, totalMs }) {
  const remaining = Math.max(0, expiresAt - now);
  const frac = totalMs ? remaining / totalMs : 0;
  const R = 30;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative w-[84px] h-[84px]">
      <svg width="84" height="84" className="-rotate-90">
        <circle cx="42" cy="42" r={R} fill="none" stroke="#1e293b" strokeWidth="6" />
        <circle
          cx="42" cy="42" r={R} fill="none"
          stroke={remaining < 15000 ? '#fb7185' : '#38bdf8'}
          strokeWidth="6" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 0.5s linear, stroke 0.3s' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[19px] font-black text-slate-100">
        {Math.ceil(remaining / 1000)}
      </div>
    </div>
  );
}

export default function Consumer() {
  const snap = useStore((s) => s.snap);
  const consumer = useStore((s) => s.consumer);
  const consumerAdd = useStore((s) => s.consumerAdd);
  const consumerRemove = useStore((s) => s.consumerRemove);
  const consumerReserve = useStore((s) => s.consumerReserve);
  const consumerPay = useStore((s) => s.consumerPay);
  const consumerCancel = useStore((s) => s.consumerCancel);
  const consumerSwap = useStore((s) => s.consumerSwap);
  const consumerReset = useStore((s) => s.consumerReset);
  const displayStock = useStore((s) => s.displayStock);
  const toast = useStore((s) => s.toast);
  const now = useNow(500);

  if (!snap) return <div className="h-full grid place-items-center text-slate-500">Loading Near Me…</div>;

  const cartTotal = consumer.cart.reduce((a, l) => {
    const item = snap.catalog.find((c) => c.id === l.skuId);
    const offer = snap.offers.find((o) => o.skuId === l.skuId);
    return a + (offer ? offer.salePrice : item?.price ?? 0) * l.qty;
  }, 0);

  const offerItems = snap.offers.slice(0, 2);

  return (
    <div className="h-full grid place-items-center p-4 bg-[radial-gradient(ellipse_at_top,rgba(0,186,242,0.07),transparent_60%)]">
      <div className="w-full max-w-[390px] h-[min(760px,100%)] rounded-[2.2rem] border border-slate-700/70 bg-slate-950 shadow-2xl shadow-sky-900/30 overflow-hidden flex flex-col relative">
        {/* status bar */}
        <div className="flex items-center justify-between px-5 pt-3 pb-1.5 text-[11px] text-slate-400">
          <span className="font-semibold text-slate-300">
            {String(new Date(now).getHours()).padStart(2, '0')}:{String(new Date(now).getMinutes()).padStart(2, '0')}
          </span>
          <span className="font-bold text-sky-400 tracking-tight">paytm</span>
          <span>📶 🔋</span>
        </div>

        {/* merchant header */}
        <div className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-800/80">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-600/30 border border-amber-400/30 grid place-items-center text-2xl">🏪</div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold truncate">{snap.merchant.name}</div>
            <div className="text-[10.5px] text-slate-400 truncate">
              ⭐ 4.6 · 0.8 km · {snap.merchant.locality.split(',')[0]}
            </div>
            <div className="text-[9.5px] text-sky-300/90 font-semibold">✓ Paytm Preferred · live stock via Setu AI sync</div>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-3">
          {/* AI flash deals */}
          {offerItems.length > 0 && (
            <div className="space-y-2">
              {offerItems.map((o) => {
                const item = snap.catalog.find((c) => c.id === o.skuId);
                const left = Math.max(0, o.expiresAt - now);
                return (
                  <div key={o.offerId} className="rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-500/15 to-orange-500/10 p-3 slide-in">
                    <div className="flex items-center gap-2">
                      <span className="text-[9.5px] font-black tracking-widest text-amber-300 bg-amber-400/15 border border-amber-400/30 rounded px-1.5 py-0.5">
                        ⚡ AI FLASH DEAL
                      </span>
                      <span className="text-[10px] text-amber-200/80">within {o.radiusKm} km · {Math.ceil(left / 60000)} min left</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <span className="text-2xl">{item?.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold truncate">{item?.name}</div>
                        <div className="text-[11px] text-amber-200">
                          ₹{o.salePrice} <span className="line-through text-slate-500">₹{o.origPrice}</span>
                          <span className="ml-1.5 text-amber-300 font-bold">−{o.discountPct}%</span>
                        </div>
                      </div>
                      <button
                        onClick={() => consumerReserve(o.skuId, 1)}
                        disabled={consumer.stage === 'reserved' || consumer.stage === 'paying'}
                        className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-[12px] font-black disabled:opacity-40"
                      >
                        GRAB
                      </button>
                    </div>
                    <div className="mt-1 text-[9.5px] text-amber-200/60 leading-snug">{o.rationale}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* products */}
          <div className="grid grid-cols-2 gap-2">
            {snap.catalog.map((item) => {
              const stock = displayStock(item.id);
              const reserved = (snap.reserved?.[item.id] ?? 0) > 0;
              const offer = snap.offers.find((o) => o.skuId === item.id);
              const inCart = consumer.cart.find((l) => l.skuId === item.id);
              return (
                <div key={item.id} className={`rounded-xl border p-2.5 ${stock <= 0 ? 'border-slate-800/60 opacity-50' : 'border-slate-800 bg-slate-900/50'}`}>
                  <div className="flex items-start justify-between">
                    <span className="text-2xl">{item.emoji}</span>
                    {reserved ? (
                      <span className="text-[8.5px] font-bold text-purple-300 bg-purple-400/10 border border-purple-400/30 rounded px-1 py-px">🔒 HELD</span>
                    ) : stock <= 2 ? (
                      <span className="text-[8.5px] font-bold text-orange-300 bg-orange-400/10 border border-orange-400/30 rounded px-1 py-px">{stock} LEFT</span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[11.5px] font-medium leading-tight h-8 overflow-hidden">{item.name}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[12.5px] font-bold">₹{offer ? offer.salePrice : item.price}</span>
                    {offer && <span className="text-[10px] line-through text-slate-500">₹{item.price}</span>}
                  </div>
                  <button
                    onClick={() => (inCart ? consumerRemove(item.id) : consumerAdd(item.id))}
                    disabled={stock <= 0}
                    className={`mt-1.5 w-full py-1 rounded-lg text-[11px] font-bold disabled:opacity-40 ${
                      inCart ? 'bg-sky-400/20 text-sky-200 border border-sky-400/40' : 'bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25'
                    }`}
                  >
                    {inCart ? `IN CART ×${inCart.qty} — REMOVE` : 'ADD'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* cart bar */}
        <div className="border-t border-slate-800 px-4 py-3 flex items-center gap-3 bg-slate-950/80">
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] text-slate-500">
              {consumer.cart.length === 0 ? 'Your cart is empty' : consumer.cart.map((l) => snap.catalog.find((c) => c.id === l.skuId)?.name).join(', ')}
            </div>
            <div className="text-[15px] font-black">₹{cartTotal}</div>
          </div>
          <button
            onClick={() => {
              if (!consumer.cart.length) return toast('info', 'Add an item first');
              const first = consumer.cart[0];
              consumerReserve(first.skuId, first.qty);
            }}
            disabled={consumer.stage === 'reserved' || consumer.stage === 'paying' || consumer.cart.length === 0}
            className="px-4 py-2.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 text-[13px] font-black disabled:opacity-40"
          >
            Checkout on Paytm ⚡
          </button>
        </div>

        {/* ------------------------------------------------ overlays */}
        {consumer.stage === 'reserved' && consumer.lock && (
          <div className="absolute inset-0 z-20 bg-slate-950/85 backdrop-blur-sm grid place-items-center p-6">
            <div className="w-full rounded-2xl border border-sky-400/30 bg-slate-900 p-5 text-center slide-in">
              <CountdownRing expiresAt={consumer.lock.expiresAt} now={now} totalMs={snap.cfg.reservationTtlSec * 1000} />
              <div className="mt-3 text-[14px] font-bold">Holding your item</div>
              <div className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                90-second optimistic reservation lock.
                <br />
                Counter-first priority: a physical scan can still take it — you'll be offered instant alternatives.
              </div>
              <button
                onClick={consumerPay}
                className="mt-4 w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[13.5px] font-black"
              >
                Pay ₹{cartTotal || snap.catalog.find((c) => c.id === consumer.lock.skuId)?.price} · UPI auto-pay ⚡
              </button>
              <button onClick={consumerCancel} className="mt-2 w-full py-2 rounded-xl border border-slate-700 text-slate-400 text-[12px] hover:text-slate-200">
                Cancel
              </button>
            </div>
          </div>
        )}

        {consumer.stage === 'paying' && (
          <div className="absolute inset-0 z-20 bg-slate-950/85 backdrop-blur-sm grid place-items-center">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto rounded-full border-4 border-sky-400/30 border-t-sky-400 animate-spin" />
              <div className="mt-3 text-[13px] text-slate-300">Acquiring reservation lock…</div>
            </div>
          </div>
        )}

        {consumer.stage === 'paid' && consumer.receipt && (
          <div className="absolute inset-0 z-20 bg-slate-950/90 backdrop-blur-sm grid place-items-center p-6">
            <div className="w-full rounded-2xl border border-emerald-400/30 bg-slate-900 p-6 text-center slide-in">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 border border-emerald-400/40 grid place-items-center text-3xl">✓</div>
              <div className="mt-3 text-[16px] font-black text-emerald-300">Payment received</div>
              <div className="mt-1 text-[11px] text-slate-400">UPI auto-pay · settled instantly</div>
              <div className="mt-4 rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-left space-y-1">
                <div className="flex justify-between text-[12.5px]">
                  <span>{consumer.receipt.emoji} {consumer.receipt.name}</span>
                  <span className="font-bold">₹{consumer.receipt.amount}</span>
                </div>
                {consumer.receipt.amount < consumer.receipt.origPrice && (
                  <div className="flex justify-between text-[11px] text-emerald-300">
                    <span>AI flash deal saved you</span>
                    <span>₹{consumer.receipt.origPrice - consumer.receipt.amount}</span>
                  </div>
                )}
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>Soundbox confirmed · dual-language</span>
                  <span>🔊</span>
                </div>
              </div>
              <button onClick={consumerReset} className="mt-4 w-full py-2.5 rounded-xl bg-sky-400 text-slate-950 text-[13px] font-black hover:bg-sky-300">
                Done
              </button>
            </div>
          </div>
        )}

        {consumer.stage === 'overridden' && (
          <div className="absolute inset-0 z-20 bg-slate-950/90 backdrop-blur-sm grid place-items-center p-6">
            <div className="w-full rounded-2xl border border-amber-400/40 bg-slate-900 p-5 slide-in">
              <div className="text-[14px] font-black text-amber-300">⚡ That item just sold at the counter</div>
              <p className="mt-1.5 text-[11.5px] text-slate-400 leading-relaxed">
                The physical counter took precedence on the last unit (counter-first policy). No payment was taken — here are
                instant same-category alternatives, no re-search needed.
              </p>
              <div className="mt-3 space-y-2">
                {consumer.alternatives.map((a) => (
                  <div key={a.skuId} className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <span className="text-xl">{a.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium truncate">{a.name}</div>
                      <div className="text-[10.5px] text-slate-500">₹{a.price} · {a.stock} in stock</div>
                    </div>
                    <button onClick={() => consumerSwap(a.skuId)} className="px-3 py-1.5 rounded-lg bg-sky-400 text-slate-950 text-[11px] font-black hover:bg-sky-300">
                      Switch & continue
                    </button>
                  </div>
                ))}
                {consumer.alternatives.length === 0 && (
                  <div className="text-[11.5px] text-slate-500 text-center py-2">No alternatives in this category right now.</div>
                )}
              </div>
              <button onClick={consumerReset} className="mt-3 w-full py-2 rounded-xl border border-slate-700 text-slate-400 text-[12px] hover:text-slate-200">
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="hidden lg:block max-w-[220px] text-[11px] text-slate-500 leading-relaxed">
        <div className="font-bold text-slate-400 mb-1.5">SIMULATED SURFACE</div>
        This is the Paytm Consumer App “Near Me” view as Setu AI renders it: live CRDT stock, AI flash deals, and the
        90-second reservation flow.
      </div>
    </div>
  );
}
