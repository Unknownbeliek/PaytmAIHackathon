// Vector clock client: per-client monotonic sequence, merged with the server's
// causal view after each reconciliation.

const KEY = 'setu:vclock';

export function loadVector() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function nextSeq(clientId) {
  const v = loadVector();
  v[clientId] = (v[clientId] ?? 0) + 1;
  localStorage.setItem(KEY, JSON.stringify(v));
  return v[clientId];
}

export function adoptServerVector(serverVector) {
  const cur = loadVector();
  for (const [client, n] of Object.entries(serverVector ?? {})) {
    cur[client] = Math.max(cur[client] ?? 0, n);
  }
  localStorage.setItem(KEY, JSON.stringify(cur));
  return cur;
}
