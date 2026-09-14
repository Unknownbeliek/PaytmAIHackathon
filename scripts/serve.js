// One-command launcher: starts the FastAPI AI microservice (port 8001, loopback)
// and the Node sync/event server (port 8080, 0.0.0.0).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const py = path.join(root, 'ai', '.venv', 'bin', 'python');

const children = [];

function track(name, child) {
  children.push(child);
  child.on('exit', (code) => {
    console.log(`[serve] ${name} exited (${code ?? 'signal'}) — shutting down`);
    for (const c of children) { if (c !== child && !c.killed) c.kill('SIGTERM'); }
    process.exit(code ?? 1);
  });
  return child;
}

if (!existsSync(py)) {
  console.error('[serve] Python venv missing. Create it first:');
  console.error('  python3 -m venv ai/.venv && ai/.venv/bin/pip install -r ai/requirements.txt');
  process.exit(1);
}

console.log('[serve] starting AI decay engine (FastAPI) on 127.0.0.1:8001');
track('ai', spawn(py, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8001', '--log-level', 'warning'], {
  cwd: path.join(root, 'ai'), stdio: 'inherit',
}));

// Give the AI engine a head start so the first /scan never 404s.
setTimeout(() => {
  console.log('[serve] starting sync/event server on 0.0.0.0:8080');
  track('server', spawn(process.execPath, [path.join(root, 'server', 'src', 'index.js')], {
    cwd: path.join(root, 'server'), stdio: 'inherit',
  }));
}, 700);

process.on('SIGINT', () => { for (const c of children) c.kill('SIGINT'); process.exit(0); });
process.on('SIGTERM', () => { for (const c of children) c.kill('SIGTERM'); process.exit(0); });
