// HMAC-SHA256 signing for every journaled event (NFR: integrity + replay proof).
// Field order MUST mirror server/src/crdt.js canonicalEvent().

import { HMAC_SECRET } from '../product.js';

const enc = new TextEncoder();
const FIELDS = ['id', 'type', 'skuId', 'qty', 'channel', 'clientId', 'seq', 'ts', 'amount', 'offerId', 'origin'];

export async function signEvent(ev) {
  const data = JSON.stringify(FIELDS.map((f) => ev[f] ?? null));
  const key = await crypto.subtle.importKey('raw', enc.encode(HMAC_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
