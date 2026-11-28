import crypto from 'crypto';

const BASE = (process.env.TT_REST_BASE || 'https://ttmarginal.fxopen.net').replace(/\/+$/, '');
const ID = process.env.TT_WEB_API_ID;
const KEY = process.env.TT_WEB_API_KEY;
const SECRET = process.env.TT_WEB_API_SECRET;

export function ttSign(ts) {
  return crypto.createHmac('sha256', SECRET)
    .update(String(ts) + ID + KEY).digest('base64');
}

async function ttGet(path, ms = 8000) {
  const ts = Date.now();
  const r = await fetch(BASE + path, {
    headers: {
      'X-ClientId': ID,
      'X-Timestamp': String(ts),
      'X-Signature': ttSign(ts),
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error('TT ' + r.status + ' ' + path);
  return r.json();
}

export async function ttBars(symbol, tfStr, count = 200) {
  const data = await ttGet(
    `/api/v2/quotehistory/${symbol}/${tfStr}/bars/ask?count=-${Math.min(count, 1000)}`
  );
  return (data.Bars || [])
    .map(b => ({ t: b.Timestamp, o: b.Open, h: b.High, l: b.Low, c: b.Close }))
    .filter(b => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
}

export async function ttSymbols() {
  return await ttGet('/api/v2/symbol');
}

export async function ttTick(symbol) {
  const data = await ttGet(`/api/v2/tick/${symbol}`);
  return Array.isArray(data) ? data[0] : data;
}
