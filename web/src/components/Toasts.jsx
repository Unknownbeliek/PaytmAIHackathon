import { useStore } from '../store.js';

const STYLES = {
  sync: 'border-emerald-400/40 bg-emerald-950/80 text-emerald-200',
  ai: 'border-amber-400/40 bg-amber-950/80 text-amber-200',
  warn: 'border-orange-400/40 bg-orange-950/80 text-orange-200',
  error: 'border-rose-400/40 bg-rose-950/80 text-rose-200',
  info: 'border-sky-400/40 bg-sky-950/80 text-sky-200',
};

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 w-[340px] max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <div key={t.id} className={`rounded-xl border px-3.5 py-2.5 text-[12px] font-medium shadow-xl backdrop-blur slide-in ${STYLES[t.kind] ?? STYLES.info}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
