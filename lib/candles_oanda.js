// lib/candles_oanda.js — candle historis dari OANDA v20 (akun practice/demo atau live).
// Endpoint: GET {base}/v3/instruments/{instrument}/candles?granularity=M1&count=N&price=M
// Header: Authorization: Bearer <token>. Hanya candle yang sudah complete yang dipakai.
// Keluaran: array { t (ms), o, h, l, c } urut naik, sama dengan fetchTickerLayerRows / fetchMetaApiCandles.
// price: M = mid (default OANDA), B = bid (lebih dekat ke chart MT5). Pastikan dicek di akun kamu.

const GRAN = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D' };
const BASES = { practice: 'https://api-fxpractice.oanda.com', live: 'https://api-fxtrade.oanda.com' };

// XAUUSD -> XAU_USD. Pasangan 6 huruf dikonversi ke format BASE_QUOTE.
export function oandaInstrument(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s === 'XAUUSD' || s === 'XAUUSDX') return process.env.OANDA_XAU_INSTRUMENT || 'XAU_USD';
  if (/^[A-Z]{6}$/.test(s)) return `${s.slice(0, 3)}_${s.slice(3)}`;
  return s;
}

// OANDA bisa mengirim nanodetik (9 digit). Dipotong ke milidetik agar parsing JS konsisten.
function toMs(iso) {
  return Date.parse(String(iso).replace(/(\.\d{3})\d+Z$/, '$1Z'));
}

export async function fetchOandaCandles(symbol, interval, need, price = process.env.OANDA_PRICE || 'M') {
  const token = process.env.OANDA_TOKEN;
  if (!token) return [];
  const gran = GRAN[interval];
  if (!gran) return [];
  const env = (process.env.OANDA_ENV || 'practice').toLowerCase();
  const base = BASES[env] || BASES.practice;
  const count = Math.min(5000, Math.max(1, Math.ceil(need || 200)));
  const url = `${base}/v3/instruments/${encodeURIComponent(oandaInstrument(symbol))}/candles` +
    `?granularity=${gran}&count=${count}&price=${price}`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!r.ok) { console.warn('OANDA candles status', r.status, interval); return []; }
    const data = await r.json();
    const key = price === 'B' ? 'bid' : price === 'A' ? 'ask' : 'mid';
    const rows = (data.candles || [])
      .filter(c => c.complete !== false)
      .map(c => {
        const p = c[key] || c.mid || {};
        return { t: toMs(c.time), o: Number(p.o), h: Number(p.h), l: Number(p.l), c: Number(p.c) };
      })
      .filter(x => [x.t, x.o, x.h, x.l, x.c].every(Number.isFinite));
    rows.sort((a, b) => a.t - b.t);
    return rows.slice(-count);
  } catch (e) {
    console.warn('OANDA candles error', e.message);
    return [];
  }
}
