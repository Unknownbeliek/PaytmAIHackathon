import { useStore } from '../store.js';

export default function DemoNarration() {
  const demo = useStore((s) => s.demo);
  const stopDemo = useStore((s) => s.stopDemo);
  if (!demo.running && !demo.current) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[400px] max-w-[calc(100vw-2rem)] rounded-2xl border border-sky-400/30 bg-slate-950/95 backdrop-blur p-4 shadow-2xl shadow-sky-900/40">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black tracking-widest text-sky-300">
          🎬 GUIDED DEMO {demo.current ? `· STEP ${demo.current.i + 1}/${demo.total || '…'}` : ''}
        </span>
        {demo.running && (
          <button onClick={stopDemo} className="text-[10.5px] font-bold text-slate-400 hover:text-rose-300">
            Skip ✕
          </button>
        )}
      </div>
      {demo.current && (
        <div className="mt-2 slide-in" key={demo.current.i}>
          <div className="text-[13.5px] font-bold text-slate-100">{demo.current.title}</div>
          <p className="mt-1 text-[11.5px] text-slate-400 leading-relaxed">{demo.current.detail}</p>
        </div>
      )}
      {demo.history.length > 1 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {demo.history.map((h) => (
            <span
              key={h.i}
              className={`text-[9.5px] font-semibold rounded-full px-2 py-0.5 border ${
                h.i === demo.current?.i
                  ? 'text-sky-200 border-sky-400/50 bg-sky-400/10'
                  : 'text-slate-500 border-slate-800'
              }`}
            >
              {h.i + 1}. {h.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
