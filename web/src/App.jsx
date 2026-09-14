import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useStore, CLIENT_ID } from './store.js';
import { PRODUCT_NAME, PRODUCT_TAG } from './product.js';
import Pos from './views/Pos.jsx';
import Consumer from './views/Consumer.jsx';
import Ops from './views/Ops.jsx';
import Toasts from './components/Toasts.jsx';
import DemoNarration from './components/DemoNarration.jsx';

const TABS = [
  ['pos', '🧾', 'Merchant POS'],
  ['consumer', '📱', 'Paytm Near Me'],
  ['ops', '📡', 'Sync Ops'],
];

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const socketConnected = useStore((s) => s.socketConnected);
  const latencyMs = useStore((s) => s.latencyMs);
  const navOnline = useStore((s) => s.navOnline);
  const manualOffline = useStore((s) => s.manualOffline);
  const pending = useStore((s) => s.pending);
  const demoPending = useStore((s) => s.demoPending ?? 0);
  const soundOn = useStore((s) => s.soundOn);
  const queueTotal = pending + demoPending;
  const toggleSound = useStore((s) => s.toggleSound);
  const online = socketConnected && navOnline && !manualOffline;

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    const st = () => useStore.getState();

    socket.on('connect', () => useStore.setState({ socketConnected: true }));
    socket.on('disconnect', () => useStore.setState({ socketConnected: false }));
    socket.on('state', (s) => useStore.setState({ snap: s }));
    socket.on('demo:start', ({ total }) =>
      useStore.setState((prev) => ({ demo: { ...prev.demo, running: true, total } })));
    socket.on('demo:step', (step) => st().demoStep(step));
    socket.on('demo:stop', () => st().demoStopped());
    socket.on('demo:hook', (hook) => st().demoHook(hook));
    socket.on('receipt', (r) => {
      if (r.channel === 'ONLINE') st().toast('ai', `UPI auto-pay settled online: ₹${r.amount}`);
    });
    socket.on('offer:published', (o) => st().offerPublished(o));

    const ping = setInterval(() => {
      if (!socket.connected) return;
      const t0 = performance.now();
      socket.once('pong', () => useStore.setState({ latencyMs: Math.round(performance.now() - t0) }));
      socket.emit('ping');
    }, 2500);

    const onOnline = () => {
      useStore.setState({ navOnline: true });
      if (!useStore.getState().manualOffline) useStore.getState().flushAll();
    };
    const onOffline = () => useStore.setState({ navOnline: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    st().refreshPending();

    return () => {
      clearInterval(ping);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      socket.disconnect();
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-4 h-14 border-b border-slate-800/80 bg-slate-950/90 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center font-black text-slate-950 text-lg">
            S
          </div>
          <div className="leading-tight min-w-0">
            <div className="font-bold text-[15px] tracking-tight">
              {PRODUCT_NAME}
              <span className="ml-2 text-[10px] font-semibold text-sky-300/90 bg-sky-400/10 border border-sky-400/20 rounded px-1.5 py-0.5 align-middle">
                PAYTM BUILD FOR INDIA · TRACK 1
              </span>
            </div>
            <div className="text-[10.5px] text-slate-400 truncate">{PRODUCT_TAG}</div>
          </div>
        </div>

        <nav className="flex items-center gap-1 ml-4">
          {TABS.map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                view === id ? 'bg-sky-400/15 text-sky-200 border border-sky-400/30' : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="mr-1.5">{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {queueTotal > 0 && (
            <span className="text-[11px] font-semibold text-orange-300 bg-orange-400/10 border border-orange-400/30 rounded-full px-2.5 py-1">
              {queueTotal} queued offline
            </span>
          )}
          <span
            className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border ${
              online
                ? 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30'
                : 'text-orange-300 bg-orange-400/10 border-orange-400/30 pulse-soft'
            }`}
          >
            {socketConnected ? (online ? `● LIVE · ${latencyMs ?? '—'} ms` : '◌ OFFLINE') : '○ CONNECTING…'}
          </span>
          <button
            onClick={toggleSound}
            title="Soundbox audibles"
            className={`text-[13px] px-2.5 py-1.5 rounded-lg border ${
              soundOn ? 'border-slate-700 text-slate-200' : 'border-slate-800 text-slate-500'
            }`}
          >
            {soundOn ? '🔊' : '🔇'}
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto">
        {view === 'pos' && <Pos />}
        {view === 'consumer' && <Consumer />}
        {view === 'ops' && <Ops />}
      </main>

      <Toasts />
      <DemoNarration />
    </div>
  );
}
