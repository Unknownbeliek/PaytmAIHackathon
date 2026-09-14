// Drives the guided demo and asserts each step fires with coherent server state.
import { io } from '/home/user/PaytmAIHackathon/web/node_modules/socket.io-client/build/esm/index.js';

const BASE = 'http://127.0.0.1:8080';
const socket = io(BASE, { transports: ['websocket'] });
const steps = [];
let started = false;
let failed = false;

socket.on('demo:start', ({ total }) => { started = true; console.log(`✓ demo:start (total=${total})`); });
socket.on('demo:step', (s) => {
  steps.push(s);
  console.log(`  step ${s.i + 1}/${s.total} [${s.id}] ${s.title}`);
  const hasText = typeof s.detail === 'string' && s.detail.length > 20;
  if (!hasText) { console.log('✗ step detail missing'); failed = true; }
});
socket.on('demo:stop', async () => {
  console.log('✓ demo:stop');
  const st = await (await fetch(`${BASE}/api/state`)).json();
  const m = st.metrics;
  const assert = (name, cond, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`); if (!cond) failed = true; };
  assert('8 steps fired', steps.length === 8, `(${steps.length})`);
  assert('counter override happened', m.cancellationsPrevented >= 1, `(${m.cancellationsPrevented})`);
  assert('offline revenue captured', m.offlineRevenue > 0, `(₹${m.offlineRevenue})`);
  assert('margin recovered', m.marginRecovered > 0, `(₹${m.marginRecovered})`);
  assert('events merged > 5', m.eventsMerged > 5, `(${m.eventsMerged})`);
  assert('online sale happened', m.salesOnline >= 1, `(${m.salesOnline})`);
  console.log(failed ? 'DEMO CHECK FAILED' : 'DEMO CHECK PASSED');
  socket.disconnect();
  process.exit(failed ? 1 : 0);
});

socket.on('connect', () => {
  fetch(`${BASE}/api/demo/start`, { method: 'POST' }).then(() => console.log('✓ demo started'));
});

setTimeout(() => {
  console.log(failed || !started ? 'DEMO CHECK TIMEOUT/FAILED' : 'waiting…');
  process.exit(1);
}, 120_000);
