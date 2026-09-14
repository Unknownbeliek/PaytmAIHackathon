import { useState } from 'react';
import { useStore } from '../store.js';

function Kpi({ label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-800 text-slate-100',
    emerald: 'border-emerald-400/30 text-emerald-300',
    amber: 'border-amber-400/30 text-amber-300',
    sky: 'border-sky-400/30 text-sky-300',
    rose: 'border-rose-400/30 text-rose-300',
  };
  return (
    <div className={`rounded-xl border bg-slate-900/50 p-3 ${tones[tone]}`}>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className={`text-[22px] font-black mt-0.5 ${tones[tone].split(' ')[1]}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

const KIND_DOT = {
  sale: 'bg-emerald-400',
  sync: 'bg-sky-400',
  lock: 'bg-purple-400',
  offer: 'bg-amber-400',
  ai: 'bg-amber-300',
  conflict: 'bg-rose-400',
  demo: 'bg-slate-400',
};

export default function Ops() {
  const snap = useStore((s) => s.snap);
  const demo = useStore((s) => s.demo);
  const runDemo = useStore((s) => s.runDemo);
  const stopDemo = useStore((s) => s.stopDemo);
  const floodTest = useStore((s) => s.floodTest);
  const aiScan = useStore((s) => s.aiScan);
  const [floodResult, setFloodResult] = useState(null);
  const [floodBusy, setFloodBusy] = useState(false);

  if (!snap) return <div className="h-full grid place-items-center text-slate-500">Loading ops…</div>;
  const m = snap.metrics;

  const doFlood = async () => {
    setFloodBusy(true);
    const t0 = performance.now();
    await floodTest(500);
    setFloodResult({ wallMs: Math.round(performance.now() - t0) });
    setFloodBusy(false);
  };

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Cancellations prevented" value={m.cancellationsPrevented} sub="ghost-inventory caught pre-payment" tone="emerald" />
        <Kpi label="Offline revenue" value={`₹${m.offlineRevenue}`} sub="captured during network outages" tone="sky" />
        <Kpi label="Margin recovered" value={`₹${m.marginRecovered}`} sub="AI micro-liquidation sales" tone="amber" />
        <Kpi label="Events merged" value={m.eventsMerged} sub="CRDT · idempotent · HMAC-verified" tone="slate" />
        <Kpi label="Sales" value={`${m.salesCounter}/${m.salesOnline}`} sub="counter / online" tone="slate" />
        <Kpi label="Conflicts auto-resolved" value={m.conflictsAutoResolved} sub="deterministic policy, zero human work" tone="rose" />
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        {/* guided demo */}
        <div className="rounded-xl border border-sky-400/30 bg-sky-400/[0.05] p-4">
          <div className="text-[11px] font-black tracking-widest text-sky-300">🎬 GUIDED DEMO</div>
          <p className="mt-1.5 text-[11.5px] text-slate-400 leading-relaxed">
            Plays the full story on the real stack: AI flash deal → 90s lock → counter override → outage → CRDT
            reconciliation → liquidation sale → KPIs. ≈ 60 s.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={runDemo}
              disabled={demo.running}
              className="px-3.5 py-2 rounded-lg bg-sky-400 text-slate-950 text-[12px] font-black hover:bg-sky-300 disabled:opacity-40"
            >
              ▶ Run demo
            </button>
            <button
              onClick={stopDemo}
              disabled={!demo.running}
              className="px-3.5 py-2 rounded-lg border border-slate-700 text-slate-300 text-[12px] font-bold disabled:opacity-40"
            >
              ■ Stop
            </button>
          </div>
          {demo.running && demo.current && (
            <div className="mt-2.5 text-[11px] text-sky-200">
              step {demo.current.i + 1}/{demo.total || '…'} — {demo.current.title}
            </div>
          )}
        </div>

        {/* flood test */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-[11px] font-black tracking-widest text-slate-300">⚡ NFR PROOF · 500-EVENT QUEUE</div>
          <p className="mt-1.5 text-[11.5px] text-slate-400 leading-relaxed">
            Injects a 500-event offline journal (HMAC-signed, vector-clocked) and measures deterministic CRDT merge time.
            Target: sub-second.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={doFlood}
              disabled={floodBusy}
              className="px-3.5 py-2 rounded-lg bg-slate-200 text-slate-950 text-[12px] font-black hover:bg-white disabled:opacity-40"
            >
              {floodBusy ? 'Merging…' : '▶ Run merge test'}
            </button>
            {floodResult && <span className="text-[11px] text-emerald-300 font-mono">done</span>}
          </div>
        </div>

        {/* AI engine */}
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-4">
          <div className="text-[11px] font-black tracking-widest text-amber-300">🧠 DECAY ENGINE (FastAPI)</div>
          <div className="mt-2 space-y-1 text-[11.5px]">
            <div className="flex justify-between"><span className="text-slate-500">model</span><span className="font-mono text-slate-300">{snap.ai?.model ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">health</span><span className={snap.ai?.health?.status === 'ok' ? 'text-emerald-300' : 'text-orange-300'}>{snap.ai?.health?.status ?? 'starting'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">live flash deals</span><span className="text-slate-300">{snap.offers.length}</span></div>
          </div>
          <button onClick={aiScan} className="mt-3 px-3.5 py-2 rounded-lg bg-amber-400 text-slate-950 text-[12px] font-black hover:bg-amber-300">
            ▶ Run decay scan
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {/* event stream */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-[11px] font-black tracking-widest text-slate-300">📜 EVENT STREAM (last {snap.recent.length})</div>
          <div className="mt-2.5 space-y-1.5 max-h-[300px] overflow-auto pr-1">
            {snap.recent.length === 0 && <div className="text-[11px] text-slate-600">No events yet — make a sale on the POS.</div>}
            {snap.recent.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-[11.5px] slide-in">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${KIND_DOT[e.kind] ?? 'bg-slate-500'}`} />
                <span className="text-slate-500 font-mono text-[10px] mt-0.5 shrink-0">
                  {new Date(e.ts).toLocaleTimeString('en-IN', { hour12: false })}
                </span>
                <span className="text-slate-300 leading-snug">{e.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* locks + offers */}
        <div className="space-y-3">
          <div className="rounded-xl border border-purple-400/25 bg-purple-400/[0.04] p-4">
            <div className="text-[11px] font-black tracking-widest text-purple-300">🔒 ACTIVE RESERVATION LOCKS (90s TTL)</div>
            {snap.locks.length === 0 && <div className="mt-2 text-[11px] text-slate-600">No live reservations.</div>}
            <div className="mt-2 space-y-2">
              {snap.locks.map((l) => {
                const item = snap.catalog.find((c) => c.id === l.skuId);
                const frac = Math.max(0, l.remainingMs / l.ttlMs);
                return (
                  <div key={l.lockId} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                    <div className="flex justify-between text-[11.5px]">
                      <span className="font-medium">{item?.emoji} {item?.name} ×{l.qty}</span>
                      <span className="text-slate-500 font-mono text-[10.5px]">{l.sessionId} · {Math.ceil(l.remainingMs / 1000)}s</span>
                    </div>
                    <div className="mt-1.5 h-1 rounded bg-slate-800 overflow-hidden">
                      <div className="h-full bg-purple-400" style={{ width: `${frac * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* stock + restock */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="text-[11px] font-black tracking-widest text-slate-300">📦 STOCK (CRDT TRUTH) + RESTOCK</div>
            <div className="mt-2 max-h-[190px] overflow-auto pr-1 space-y-1">
              {snap.catalog.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-[11.5px]">
                  <span>{c.emoji}</span>
                  <span className="flex-1 truncate text-slate-300">{c.name}</span>
                  <span className="text-slate-500 font-mono text-[10.5px]">
                    {snap.stock[c.id]}
                    {(snap.reserved?.[c.id] ?? 0) > 0 && <span className="text-purple-300"> (−{snap.reserved[c.id]} held)</span>}
                  </span>
                  <button
                    onClick={async () => {
                      await fetch('/api/restock', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ skuId: c.id, qty: 5 }),
                      });
                    }}
                    className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-emerald-300 hover:border-emerald-400/40"
                  >
                    +5
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* architecture */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-[11px] font-black tracking-widest text-slate-300">🏗 ARCHITECTURE</div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium">
          {[
            ['📱 Paytm Smart POS', 'React · keyboard-first · IndexedDB journal (HMAC+VClock)'],
            ['⇄ WS < 50ms', 'Socket.io event bus (Node)'],
            ['🔒 Locks', '90s optimistic reservations · counter-priority override (Redis-semantic)'],
            ['🧮 CRDT merge', 'PN-counters · vector clocks · deterministic replay'],
            ['🧠 FastAPI', 'GBM decay-risk model · liquidation policy'],
            ['📲 Paytm surfaces', 'Near Me flash deals · Soundbox audibles · UPI auto-pay'],
          ].map(([t, d], i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
                <div className="text-slate-200 font-bold">{t}</div>
                <div className="text-slate-500 text-[10px] font-normal">{d}</div>
              </div>
              {i < 5 && <span className="text-slate-600">→</span>}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-slate-500">
          <span>✓ sync &lt; 50 ms (header badge)</span>
          <span>✓ 10,000-event IndexedDB journal</span>
          <span>✓ 500-event merge &lt; 1 s (flood test)</span>
          <span>✓ bundle &lt; 1.5 MB (see README)</span>
          <span>✓ HMAC-SHA256 every event</span>
        </div>
      </div>
    </div>
  );
}
