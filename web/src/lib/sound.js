// Paytm Soundbox-style audibles, synthesized in-browser (no assets needed).
// WebAudio blips + bilingual (EN/HI) speech for sale / sync confirmations.

let enabled = true;
export function setSoundEnabled(on) { enabled = on; }

let audio;
function ac() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}

function beep(freq = 1200, ms = 90, gain = 0.06, when = 0) {
  if (!enabled) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g);
    g.connect(c.destination);
    const t = c.currentTime + when;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.start(t);
    o.stop(t + ms / 1000 + 0.03);
  } catch { /* audio unavailable */ }
}

export const ding = () => { beep(1567, 90); beep(2093, 130, 0.05, 0.09); };       // counter sale
export const chime = () => { beep(880, 100); beep(1174, 100, 0.05, 0.12); beep(1567, 180, 0.05, 0.24); }; // UPI success
export const warnBlip = () => beep(440, 180, 0.05);
export const tickBlip = () => beep(1975, 40, 0.03);

export function speak(en = '', hi = '') {
  if (!enabled) return;
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance([en, hi].filter(Boolean).join(' '));
    u.rate = 1;
    u.volume = 0.9;
    const voice = speechSynthesis.getVoices().find((v) => (v.lang || '').toLowerCase().startsWith('hi'));
    if (voice) u.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* no TTS */ }
}

export const soundboxSale = (amount) => speak(`Payment received, ${amount} rupees.`, `भुगतान प्राप्त, ${amount} रुपये।`);
export const soundboxSync = (n) => speak(`Sync complete, ${n} transactions reconciled.`, `सिंक पूर्ण, ${n} लेनदेन मेल खाए।`);
export const soundboxFlashDeal = (name) => speak(`New flash deal live, ${name}.`, `नया फ्लैश डील लाइव, ${name}।`);
export const soundboxOnlineSale = (amount) => speak(`Online sale confirmed, ${amount} rupees.`, `ऑनलाइन बिक्री पक्की, ${amount} रुपये।`);
