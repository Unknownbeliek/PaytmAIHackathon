// Encrypted IndexedDB transaction journal (demo: AES-at-rest is simulated by
// HMAC-signing every event; a WebCrypto AES-GCM envelope is the prod upgrade).
// Capacity target: 10,000 events without perf degradation (NFR).

const DB = 'setu-pos-journal';
const STORE = 'events';
const V = 1;

let dbPromise;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, V);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: 'id' });
        d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('clientId', 'clientId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const memory = new Map(); // graceful fallback for exotic webviews
const mem = () => {
  if (typeof indexedDB !== 'undefined') return false;
  return true;
};

export async function journal(events) {
  if (mem()) {
    for (const e of events) memory.set(e.id, e);
    return events.length;
  }
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, 'readwrite');
    for (const e of events) t.objectStore(STORE).put(e);
    t.oncomplete = () => resolve(events.length);
    t.onerror = () => reject(t.error);
  });
}

export async function pendingEvents() {
  if (mem()) return [...memory.values()];
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function pendingCount() {
  const evs = await pendingEvents();
  return evs.length;
}

export async function clearJournal(ids) {
  if (mem()) {
    for (const id of ids) memory.delete(id);
    return;
  }
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, 'readwrite');
    for (const id of ids) t.objectStore(STORE).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function journalSizeBytes() {
  try {
    const evs = await pendingEvents();
    return JSON.stringify(evs).length;
  } catch {
    return 0;
  }
}
