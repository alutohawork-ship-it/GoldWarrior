// lib/candles_metaapi.js — candle historis dari MetaApi (akun MT5 broker kamu).
// Endpoint (dari dokumentasi MetaApi, Read historical candles):
//   GET https://mt-market-data-client-api-v1.{region}.agiliumtrade.ai/users/current/accounts/{accountId}/historical-market-data/symbols/{symbol}/timeframes/{tf}/candles?limit=N
//   Header: auth-token. Tanpa startTime = candle terbaru. Maksimal 1000 candle per request.
// Keluaran: array { t (ms), o, h, l, c } urut naik, sama dengan fetchTickerLayerRows.

const REGION_DEFAULT = 'new-york';

// Nama simbol di broker bisa berbeda (XAUUSD, XAUUSD.m, GOLD, dst). Cek di Market Watch MT5.
export function metaApiSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s === 'XAUUSD' || s === 'XAUUSDX') return process.env.METAAPI_XAU_SYMBOL || 'XAUUSD';
  return s;
}

export async function fetchMetaApiCandles(symbol, interval, need) {
  const token = process.env.METAAPI_TOKEN, accountId = process.env.METAAPI_ACCOUNT_ID;
  if (!token || !accountId) return [];
  const region = process.env.METAAPI_REGION || REGION_DEFAULT;
  const limit = Math.min(1000, Math.max(1, Math.ceil(need || 200)));
  const url = `https://mt-market-data-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/` +
    `${encodeURIComponent(accountId)}/historical-market-data/symbols/${encodeURIComponent(metaApiSymbol(symbol))}` +
    `/timeframes/${interval}/candles?limit=${limit}`;
  try {
    const r = await fetch(url, { headers: { 'auth-token': token, Accept: 'application/json' } });
    if (!r.ok) { console.warn('MetaApi candles status', r.status, interval); return []; }
    const arr = await r.json();
    const rows = (Array.isArray(arr) ? arr : [])
      .map(c => ({ t: Date.parse(c.time), o: Number(c.open), h: Number(c.high), l: Number(c.low), c: Number(c.close) }))
      .filter(x => [x.t, x.o, x.h, x.l, x.c].every(Number.isFinite));
    rows.sort((a, b) => a.t - b.t);
    return rows.slice(-limit);
  } catch (e) {
    console.warn('MetaApi candles error', e.message);
    return [];
  }
}
