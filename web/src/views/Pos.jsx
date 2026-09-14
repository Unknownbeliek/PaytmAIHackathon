import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(1, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function Pos() {
  const snap = useStore((s) => s.snap);
  const cart = useStore((s) => s.cart);
  const navOnline = useStore((s) => s.navOnline);
  const manualOffline = useStore((s) => s.manualOffline);
  const pending = useStore((s) => s.pending);
  const demoPending = useStore((s) => s.demoPending ?? 0);
  const queueTotal = pending + demoPending;
  const lastMerge = useStore((s) => s.lastMerge);
  const addToCart = useStore((s) => s.addToCart);
  const setCartQty = useStore((s) => s.setCartQty);
  const clearCart = useStore((s) => s.clearCart);
  const completeSale = useStore((s) => s.completeSale);
  const displayStock = useStore((s) => s.displayStock);
  const aiScan = useStore((s) => s.aiScan);
  const toggleManualOffline = useStore((s) => s.toggleManualOffline);
  const toast = useStore((s) => s.toast);
  const view = useStore((s) => s.view);

  const [search, setSearch] = useState('');
  const searchRef = useRef(null);
  const online = navOnline && !manualOffline;
  const now = useNow(1000);

  // Keyboard-first: number keys add items, F2 charges, F9 clears.
  useEffect(() => {
    if (!snap || view !== 'pos') return;
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[1-9]$/.test(e.key)) {
        addToCart(snap.catalog[Number(e.key) - 1].id);
      } else if (e.key === '0') {
        addToCart(snap.catalog[9].id);
      } else if (e.key === 'F2') {
        e.preventDefault();
        completeSale();
      } else if (e.key === 'F9') {
        clearCart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap, view, addToCart, completeSale, clearCart]);

  useEffect(() => {
    if (view === 'pos') searchRef.current?.focus();
  }, [view]);

  if (!snap) {
    return <div className="h-full grid place-items-center text-slate-500">Loading POS…</div>;
  }

  const submitSearch = (e) => {
    e.preventDefault();
    const q = search.trim().toLowerCase();
    if (!q) return;
    const hit =
      snap.catalog.find((c) => c.id.toLowerCase() === q) ??
      snap.catalog.find((c) => c.id.toLowerCase().includes(q)) ??
      snap.catalog.find((c) => c.name.toLowerCase().includes(q) || c.hi.includes(search.trim()));
    if (hit) {
      addToCart(hit.id);
      toast('info', `Scanned: ${hit.name}`);
    } else {
      toast('warn', `No item matches “${search.trim()}”`);
    }
    setSearch('');
  };

  const cartTotal = cart.reduce((a, l) => a + l.price * l.qty, 0);

  return (
    <div className="h-full flex flex-col xl:flex-row gap-3 p-3">
      {/* ------------------------------------------------------- items + scan */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <form onSubmit={submitSearch} className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">▮▯▮</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Scan barcode / type SKU or item name, then Enter…"
              className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pl-11 pr-3 py-2.5 text-[14px] placeholder:text-slate-500 focus:outline-none focus:border-sky-400/60"
            />
          </div>
          <button
            type="button"
            onClick={toggleManualOffline}
            className={`px-3 py-2 rounded-xl text-[12px] font-semibold border ${
              online
                ? 'border-slate-700 text-slate-300 hover:border-orange-400/50 hover:text-orange-300'
                : 'border-orange-400/60 text-orange-300 bg-orange-400/10'
            }`}
          >
            {online ? '⚡ Simulate outage' : '📶 Restore network'}
          </button>
        </form>

        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-2.5">
            {snap.catalog.map((item, i) => {
              const stock = displayStock(item.id);
              const offer = snap.offers.find((o) => o.skuId === item.id);
              const reserved = (snap.reserved?.[item.id] ?? 0) > 0;
              const key = i < 9 ? i + 1 : i === 9 ? '0' : null;
              return (
                <button
                  key={item.id}
                  onClick={() => addToCart(item.id)}
                  disabled={stock <= 0}
                  className={`text-left rounded-xl border p-2.5 transition-all relative group ${
                    stock <= 0
                      ? 'border-slate-800/60 bg-slate-900/30 opacity-45 cursor-not-allowed'
                      : 'border-slate-800 bg-slate-900/70 hover:border-sky-400/50 hover:-translate-y-px'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-2xl leading-none mt-0.5">{item.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium truncate">{item.name}</div>
                      <div className="text-[10.5px] text-slate-500 truncate">{item.hi}</div>
                    </div>
                    {key && (
                      <span className="text-[9.5px] font-mono text-slate-600 border border-slate-800 rounded px-1">{key}</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-bold text-slate-100">₹{item.price}</span>
                    {offer && (
                      <span className="text-[9.5px] font-bold text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded px-1 py-px">
                        ⚡ −{offer.discountPct}% flash
                      </span>
                    )}
                    {reserved && (
                      <span className="text-[9.5px] font-bold text-purple-300 bg-purple-400/10 border border-purple-400/30 rounded px-1 py-px">
                        🔒 online hold
                      </span>
                    )}
                    <span
                      className={`ml-auto text-[10px] font-semibold ${
                        stock <= 0 ? 'text-rose-400' : stock <= 2 ? 'text-orange-300' : 'text-slate-500'
                      }`}
                    >
                      {stock <= 0 ? 'OUT' : `${stock} in stock`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ---------------------------------------------------------- AI tray */}
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold tracking-wide text-amber-300">🤖 AI TRAY</span>
            <button
              onClick={aiScan}
              className="text-[11px] font-semibold text-amber-200 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 rounded-lg px-2.5 py-1"
            >
              ▶ Run decay scan
            </button>
            <span className="text-[10.5px] text-slate-500">model: {snap.ai?.model ?? '…'} · {snap.ai?.health?.status ?? 'starting'}</span>
            {snap.offers.map((o) => {
              const item = snap.catalog.find((c) => c.id === o.skuId);
              return (
                <span key={o.offerId} className="text-[11px] font-semibold text-amber-200 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-1 slide-in">
                  ⚡ {item?.name} −{o.discountPct}% → ₹{o.salePrice} · {fmtCountdown(o.expiresAt - now)}
                </span>
              );
            })}
            {snap.bundles?.map((b) => (
              <button
                key={b.skuId}
                onClick={() => {
                  const item = snap.catalog.find((c) => c.id === b.skuId);
                  if (item) addToCart(item.id, { price: Math.round(item.price * (1 - b.discountPct / 100)), bundlePct: b.discountPct });
                }}
                className="text-[11px] font-semibold text-emerald-200 bg-emerald-400/10 hover:bg-emerald-400/20 border border-emerald-400/30 rounded-lg px-2.5 py-1"
                title={b.rationale}
              >
                🧺 Bundle at counter: {b.name} −{b.discountPct}% [tap to apply]
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ cart */}
      <div className="w-full xl:w-[360px] shrink-0 flex flex-col rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800">
          <span className="text-[12px] font-bold tracking-widest text-slate-300">CART</span>
          <div className="flex items-center gap-2">
            {lastMerge && (
              <span className="text-[10px] text-emerald-300/90 font-mono">CRDT {lastMerge.tookMs.toFixed(1)} ms</span>
            )}
            <button onClick={clearCart} className="text-[11px] text-slate-500 hover:text-rose-300">clear</button>
          </div>
        </div>

        {!online && (
          <div className="mx-3 mt-2.5 rounded-lg border border-orange-400/40 bg-orange-400/10 px-3 py-2 text-[11.5px] text-orange-200 font-medium pulse-soft">
            ⚠ OFFLINE MODE — {queueTotal > 0 ? `${queueTotal} event(s) in the local queue` : 'sales will journal locally'}. Counter stays live, zero downtime.
          </div>
        )}

        <div className="flex-1 min-h-[180px] overflow-auto px-3 py-2 space-y-1.5">
          {cart.length === 0 && (
            <div className="h-full grid place-items-center text-[12px] text-slate-600 text-center leading-relaxed">
              Cart is empty.
              <br />
              Tap an item or use keys <kbd className="text-slate-400">1</kbd>–<kbd className="text-slate-400">9</kbd>
            </div>
          )}
          {cart.map((line) => {
            const item = snap.catalog.find((c) => c.id === line.skuId);
            return (
              <div key={line.skuId} className="flex items-center gap-2 rounded-lg bg-slate-950/50 border border-slate-800/70 px-2.5 py-2 slide-in">
                <span className="text-lg">{item?.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium truncate">{item?.name}</div>
                  <div className="text-[10.5px] text-slate-500">
                    ₹{line.price}
                    {line.bundlePct > 0 && <span className="text-emerald-300"> · bundle −{line.bundlePct}%</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setCartQty(line.skuId, line.qty - 1)} className="w-6 h-6 rounded bg-slate-800 text-slate-300 text-sm leading-none">−</button>
                  <span className="w-5 text-center text-[12.5px] font-semibold">{line.qty}</span>
                  <button onClick={() => setCartQty(line.skuId, line.qty + 1)} className="w-6 h-6 rounded bg-slate-800 text-slate-300 text-sm leading-none">+</button>
                </div>
                <span className="w-14 text-right text-[12.5px] font-bold">₹{Math.round(line.price * line.qty)}</span>
              </div>
            );
          })}
        </div>

        <div className="border-t border-slate-800 p-3 space-y-2">
          <div className="flex justify-between text-[12px] text-slate-400">
            <span>{cart.reduce((a, l) => a + l.qty, 0)} item(s)</span>
            <span className="text-[16px] font-black text-slate-100">₹{cartTotal}</span>
          </div>
          <button
            onClick={completeSale}
            disabled={cart.length === 0}
            className={`w-full py-3.5 rounded-xl text-[15px] font-black tracking-wide transition-colors ${
              cart.length === 0
                ? 'bg-slate-800/60 text-slate-600 cursor-not-allowed'
                : online
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  : 'bg-orange-500 hover:bg-orange-400 text-slate-950'
            }`}
          >
            {online ? 'CHARGE · UPI / CASH' : 'CHARGE · QUEUE OFFLINE'}
            <span className="block text-[10px] font-semibold opacity-70">F2</span>
          </button>
          <div className="text-[10px] text-slate-600 text-center">
            <kbd>1-9/0</kbd> add item · <kbd>Enter</kbd> search · <kbd>F2</kbd> charge · <kbd>F9</kbd> clear
          </div>
        </div>
      </div>
    </div>
  );
}
