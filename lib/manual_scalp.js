// lib/manual_scalp.js — ENGINE MANUAL & SCALPING SMC (searah bias H1 + BOUNCE + TP band)
//   Counter-trend dan OCO dimatikan (CFG.allowCounter = false) agar sinyal tidak bentrok.
// Setiap arah dievaluasi terpisah: struktur M5 arah itu -> anchor -> OTE -> POI -> M1 CHoCH.
//   main    : searah bias H1 (boleh pending LIMIT, atau MARKET setelah konfirmasi)
//   counter : berlawanan bias H1 (nonaktif secara default, lihat CFG.allowCounter)
//   bounce  : MANUAL saja. Jika tidak ada struktur M5 di arah itu, entry LIMIT di zona
//             Supply/Demand fresh M5 terdekat (bounce scalp).
//   OCO     : manual saja. Dua LIMIT pending, salah satu terisi membatalkan yang lain.
//   TP band : manual scalping. Risk (invalidasi) menentukan rangkaian TP.
//             XAUUSD: <40 pip -> 1:1.5 / 1:2.5 / 1:4 ; 40–50 pip -> 1:1 / 1:2 / 1:3 ; >50 pip ditolak
//             BTCUSD: <80 pip -> 1:1.5 / 1:2.5 / 1:4 ; 80–100 pip -> 1:1 / 1:2 / 1:3 ; >100 pip ditolak
//   Bot     : RR tunggal dari pilihan RR, bukan TP band. Bounce dimatikan dari bot_sma.js.

export const CFG = {
  // SMC murni: sinyal hanya searah bias (H1, atau M5 jika H1 netral).
  // Counter-trend dimatikan karena membuat BUY dan SELL muncul bersamaan (bentrok).
  allowCounter: false,
  swingLen: 3,
  m1SwingLen: 2,
  atrPeriod: 14,
  structLookback: 90,
  m1EventLookback: 20,
  touchLookback: 30,
  oteFrom: 0.618,
  oteTo: 0.786,
  oteMid: 0.705,
  maxRetraceFib: 0.886,
  minConfluence: 2,
  nearMaxAtr: 1.5,
  obMaxAge: 100,
  obMitigationDepth: 0.5,
  fvgMinAtr: 0.2,
  fvgMaxAge: 50,
  sdImpulseAtr: 1.5,
  sdBaseAtr: 0.85,
  sdMaxWidthAtr: 1.0,
  slBufferAtr: 0.2,
  maxSlAtrM1: 2.0,
  maxSlAtrM1Loose: 3.0,
  minSlPips: 20,
  marketTolR: 0.1,
  blockMinR: 0.3,
  blockLookback: 60,
  bodyMin: 0.5,
  orderExpiryMs: 10 * 60e3,
  rrOptions: [0.5, 1, 1.5, 2],
  defaultRr: 1,
  bounceMaxDistPips: 100,
  tpBands: {
    XAUUSD: { lowMaxPips: 40, midMaxPips: 50, low: [1.5, 2.5, 4], mid: [1, 2, 3] },
    BTCUSD: { lowMaxPips: 80, midMaxPips: 100, low: [1.5, 2.5, 4], mid: [1, 2, 3] },
  },
  defaultBand: { lowMaxPips: 40, midMaxPips: 50, low: [1.5, 2.5, 4], mid: [1, 2, 3] },
  // Setup kontinuitas
  contLookbackM5: 10,      // BOS M5 harus terjadi dalam 10 candle terakhir
  contFvgFromBos: 3,       // FVG yang dipakai terbentuk mulai 3 candle sebelum BOS
  contMaxDistPips: 40,     // LIMIT retest maksimal 40 pip dari harga
  contSlBufferAtr5: 0.3,   // buffer SL di luar FVG dan likuiditas, dalam ATR M5
  contMaxRiskAtr5: 3,      // risiko SL maksimal 3 ATR M5
  contExpiryMs: 30 * 60e3, // LIMIT retest berlaku 30 menit (10 menit terlalu pendek untuk retest)
};

const toMs = t => {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n;
};
const toDoc = bars => (bars || []).map(b => ({ time: toMs(b.t), open: b.o, high: b.h, low: b.l, close: b.c }));
const lastOf = arr => (arr && arr.length ? arr[arr.length - 1] : undefined);
const roundTo = (p, dec) => Number(Number(p).toFixed(dec));

// ════════════════════════════════════════════════════════════════
// TP BAND (manual scalping)
// ════════════════════════════════════════════════════════════════
function bandOf(symbol) {
  return CFG.tpBands[symbol] || CFG.defaultBand;
}

export function pickTpBand(symbol, riskPips) {
  const b = bandOf(symbol);
  if (!(riskPips > 0)) return null;
  if (riskPips < b.lowMaxPips) return { name: 'LOW_RISK', mults: b.low, rr: b.low[0] };
  if (riskPips <= b.midMaxPips) return { name: 'MID_RISK', mults: b.mid, rr: b.mid[0] };
  return null;
}

export function maxBandPips(symbol) {
  return bandOf(symbol).midMaxPips;
}

// ════════════════════════════════════════════════════════════════
// INDIKATOR
// ════════════════════════════════════════════════════════════════
export function calcATR(c, period = CFG.atrPeriod) {
  const out = new Array(c.length).fill(null);
  if (!c || c.length < period + 1) return out;
  const tr = c.map((x, i) => (i === 0
    ? x.high - x.low
    : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
  let atr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = atr;
  for (let i = period + 1; i < c.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}
const atrLast = c => lastOf(calcATR(c)) || 0;

export function calcEMA(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// MARKET STRUCTURE
// ════════════════════════════════════════════════════════════════
export function getSwings(c, n = CFG.swingLen) {
  const highs = [], lows = [];
  for (let i = n; i < c.length - n; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= n; j++) {
      if (!(c[i].high > c[i - j].high && c[i].high >= c[i + j].high)) isH = false;
      if (!(c[i].low < c[i - j].low && c[i].low <= c[i + j].low)) isL = false;
    }
    if (isH) highs.push({ i, price: c[i].high });
    if (isL) lows.push({ i, price: c[i].low });
  }
  return { highs, lows };
}

function anchorOf(c, side, swingIdx, k) {
  if (side === 'buy') {
    let hi = -Infinity, hiI = swingIdx;
    for (let j = swingIdx; j <= k; j++) if (c[j].high > hi) { hi = c[j].high; hiI = j; }
    return { low: c[swingIdx].low, lowIdx: swingIdx, high: hi, highIdx: hiI };
  }
  let lo = Infinity, loI = swingIdx;
  for (let j = swingIdx; j <= k; j++) if (c[j].low < lo) { lo = c[j].low; loI = j; }
  return { high: c[swingIdx].high, highIdx: swingIdx, low: lo, lowIdx: loI };
}

export function structureEvents(c, n = CFG.swingLen) {
  const { highs, lows } = getSwings(c, n);
  const events = [];
  let trend = 0, brokenHi = -1, brokenLo = -1;
  for (let k = 2 * n + 1; k < c.length; k++) {
    const hs = highs.filter(h => h.i + n < k);
    const ls = lows.filter(l => l.i + n < k);
    const h1 = lastOf(hs), h0 = hs.length >= 2 ? hs[hs.length - 2] : undefined;
    const l1 = lastOf(ls), l0 = ls.length >= 2 ? ls[ls.length - 2] : undefined;
    if (h1 && h0 && l1 && l0) {
      if (h1.price > h0.price && l1.price > l0.price) trend = 1;
      else if (h1.price < h0.price && l1.price < l0.price) trend = -1;
    }
    const close = c[k].close;
    if (h1 && h1.i !== brokenHi && close > h1.price) {
      const lb = lastOf(ls.filter(l => l.i < h1.i));
      events.push({
        k, side: 'buy', type: trend === -1 ? 'CHoCH_BULL' : 'BOS_BULL',
        level: h1.price, anchor: lb ? anchorOf(c, 'buy', lb.i, k) : null,
      });
      brokenHi = h1.i;
      trend = 1;
    }
    if (l1 && l1.i !== brokenLo && close < l1.price) {
      const hb = lastOf(hs.filter(h => h.i < l1.i));
      events.push({
        k, side: 'sell', type: trend === 1 ? 'CHoCH_BEAR' : 'BOS_BEAR',
        level: l1.price, anchor: hb ? anchorOf(c, 'sell', hb.i, k) : null,
      });
      brokenLo = l1.i;
      trend = -1;
    }
  }
  return { trend, events, highs, lows };
}

function recentEvent(s, c, lookback) {
  const ev = lastOf(s.events);
  return ev && ev.k >= c.length - 1 - lookback ? ev : null;
}

function recentSideEvent(s, c, lookback, side) {
  const types = side === 'buy' ? ['BOS_BULL', 'CHoCH_BULL'] : ['BOS_BEAR', 'CHoCH_BEAR'];
  const ev = lastOf(s.events.filter(e => types.includes(e.type)));
  return ev && ev.k >= c.length - 1 - lookback && ev.anchor ? ev : null;
}

export function detectRegime(c) {
  const s = structureEvents(c, 3);
  if (s.trend === 1) return 'trending_up';
  if (s.trend === -1) return 'trending_down';
  if (!c || c.length < 60) return 'neutral';
  const ema = calcEMA(c.map(x => x.close), 50);
  const i = c.length - 1, atr = atrLast(c);
  if (ema[i] == null || ema[i - 5] == null) return 'neutral';
  const slope = ema[i] - ema[i - 5];
  if (Math.abs(slope) > atr * 0.15) return slope > 0 ? 'trending_up' : 'trending_down';
  return 'choppy';
}

// ════════════════════════════════════════════════════════════════
// SUPPLY & DEMAND (RBR/DBR/RBD/DBD)
// ════════════════════════════════════════════════════════════════
export function detectSDAndOB(c, timeframe, opts = {}) {
  const { lookback = 100, impulseMult = CFG.sdImpulseAtr, baseMult = CFG.sdBaseAtr } = opts;
  const zones = [];
  if (!c || c.length < 22) return zones;
  const atrArr = calcATR(c);
  const start = Math.max(20, c.length - lookback);
  for (let i = start; i < c.length - 1; i++) {
    const atr = atrArr[i];
    if (!atr) continue;
    const out = c[i];
    if (Math.abs(out.close - out.open) < impulseMult * atr) continue;
    const isBullImp = out.close > out.open;
    let baseStart = i, baseCount = 0;
    for (let b = i - 1; b >= Math.max(1, i - 3); b--) {
      if (Math.abs(c[b].close - c[b].open) <= baseMult * atr) { baseStart = b; baseCount++; }
      else break;
    }
    if (baseCount === 0) continue;
    const legIn = c[baseStart - 1];
    if (!legIn) continue;
    const isBullIn = legIn.close > legIn.open;
    const pattern = isBullImp ? (isBullIn ? 'RBR' : 'DBR') : (isBullIn ? 'RBD' : 'DBD');
    const base = c.slice(baseStart, i);
    zones.push({
      id: `${timeframe}-${isBullImp ? 'demand' : 'supply'}-${pattern}-${out.time}`,
      type: isBullImp ? 'demand' : 'supply',
      pattern, timeframe,
      top: Math.max(...base.map(x => x.high)),
      bottom: Math.min(...base.map(x => x.low)),
      createdIndex: i, fresh: true, mitigated: false,
    });
  }
  return zones;
}

export function updateZoneState(zone, c) {
  let touched = false;
  for (let k = zone.createdIndex + 1; k < c.length; k++) {
    const x = c[k];
    if (zone.type === 'supply') {
      if (x.high >= zone.bottom) touched = true;
      if (x.close > zone.top) return { ...zone, fresh: false, mitigated: true };
    } else {
      if (x.low <= zone.top) touched = true;
      if (x.close < zone.bottom) return { ...zone, fresh: false, mitigated: true };
    }
  }
  return { ...zone, fresh: !touched, mitigated: false };
}

// ════════════════════════════════════════════════════════════════
// ORDER BLOCK & FVG
// ════════════════════════════════════════════════════════════════
function findOB(c5, anc, side) {
  let idx = -1;
  if (side === 'buy') {
    for (let j = anc.highIdx - 1; j >= anc.lowIdx; j--) {
      if (c5[j].close < c5[j].open) { idx = j; break; }
    }
  } else {
    for (let j = anc.lowIdx - 1; j >= anc.highIdx; j--) {
      if (c5[j].close > c5[j].open) { idx = j; break; }
    }
  }
  if (idx < 0 || c5.length - 1 - idx > CFG.obMaxAge) return null;
  const ob = c5[idx];
  const span = ob.high - ob.low;
  if (!(span > 0)) return null;
  let depth = 0;
  for (let j = idx + 1; j < c5.length; j++) {
    const pen = side === 'buy' ? (ob.high - c5[j].low) / span : (c5[j].high - ob.low) / span;
    if (pen > depth) depth = pen;
  }
  if (depth > CFG.obMitigationDepth) return null;
  return {
    id: `M5-OB-${side}-${ob.time}`, kind: 'OB',
    label: `OB ${side === 'buy' ? 'bullish' : 'bearish'}`,
    top: ob.high, bottom: ob.low, fresh: depth === 0,
  };
}

function findFVGs(c5, side, fromIdx, atr) {
  const out = [];
  const start = Math.max(2, c5.length - 1 - CFG.fvgMaxAge, fromIdx);
  for (let i = start; i < c5.length; i++) {
    const a = c5[i - 2], b = c5[i];
    let top, bottom;
    if (side === 'buy' && a.high < b.low) { bottom = a.high; top = b.low; }
    else if (side === 'sell' && a.low > b.high) { bottom = b.high; top = a.low; }
    else continue;
    if (top - bottom < CFG.fvgMinAtr * atr) continue;
    let filled = false;
    for (let j = i + 1; j < c5.length; j++) {
      if (side === 'buy' ? c5[j].low <= bottom : c5[j].high >= top) { filled = true; break; }
    }
    if (!filled) {
      out.push({
        id: `M5-FVG-${side}-${b.time}`, kind: 'FVG',
        label: `FVG ${side === 'buy' ? 'bullish' : 'bearish'}`,
        top, bottom, fresh: true,
      });
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// KONFIRMASI M1
// ════════════════════════════════════════════════════════════════
export function m1ChochConfirm(c1, side, lookback = CFG.m1EventLookback, minIdx = 0) {
  const s = structureEvents(c1, CFG.m1SwingLen);
  const ev = recentEvent(s, c1, lookback);
  const want = side === 'buy' ? 'CHoCH_BULL' : 'CHoCH_BEAR';
  if (!ev || ev.type !== want || ev.k < minIdx) {
    return { ok: false, reason: 'belum ada CHoCH M1 searah setelah harga menyentuh POI', ev: null };
  }
  const cl = lastOf(c1);
  const range = cl.high - cl.low;
  if (!(range > 0) || c1.length - 1 <= ev.k) {
    return { ok: false, reason: 'menunggu candle konfirmasi M1 setelah CHoCH', ev: null };
  }
  const body = Math.abs(cl.close - cl.open);
  const dirOk = side === 'buy' ? cl.close > cl.open : cl.close < cl.open;
  const breakOk = side === 'buy' ? cl.close > c1[ev.k].high : cl.close < c1[ev.k].low;
  if (!(dirOk && breakOk && body >= CFG.bodyMin * range)) {
    return { ok: false, reason: 'candle konfirmasi M1 belum valid (arah, close, atau body < 50%)', ev: null };
  }
  return { ok: true, ev, type: want };
}

// ════════════════════════════════════════════════════════════════
// TARGET & ORDER
// ════════════════════════════════════════════════════════════════
export function buildTargets(side, entry, sl, mults = [1.5, 2.25, 3]) {
  const risk = Math.abs(entry - sl);
  const d = side === 'buy' ? 1 : -1;
  return {
    risk,
    tp1: entry + d * risk * mults[0],
    tp2: entry + d * risk * mults[1],
    tp3: entry + d * risk * mults[2],
  };
}

function buildOrder(side, entry, sl, mults, orderType, expiryTime, reason, rr, dec) {
  const t = buildTargets(side, entry, sl, mults);
  return {
    side, role: 'main', orderType,
    entryPrice: roundTo(entry, dec), sl: roundTo(sl, dec),
    tp1: roundTo(t.tp1, dec), tp2: roundTo(t.tp2, dec), tp3: roundTo(t.tp3, dec),
    risk: roundTo(t.risk, dec), rr, tpMode: 'SWING_INTRADAY', expiryTime,
    invalidLevel: null, zoneId: null, confirmed: true, reason,
  };
}

// ════════════════════════════════════════════════════════════════
// BOUNCE SETUP: entry di zona S&D fresh tanpa syarat struktur M5
// ════════════════════════════════════════════════════════════════
function evaluateBounce({ c1, c5, px, pip, dec, atr1, atr5, side, strict, rr, now, symbol, checks }) {
  const buy = side === 'buy';
  const R2 = v => roundTo(v, dec);

  const sdZones = detectSDAndOB(c5, 'M5')
    .map(z => updateZoneState(z, c5))
    .filter(z => !z.mitigated && z.fresh && z.type === (buy ? 'demand' : 'supply'));

  const candidates = sdZones.filter(z => (buy ? z.top < px : z.bottom > px));
  if (!candidates.length) {
    checks.push(`BELUM: tidak ada zona ${buy ? 'demand' : 'supply'} fresh M5 di ${buy ? 'bawah' : 'atas'} harga.`);
    return { ok: false, reason: `tidak ada ${buy ? 'demand' : 'supply'} fresh untuk bounce.`, checks };
  }

  candidates.sort((a, b) => {
    const da = buy ? px - a.top : a.bottom - px;
    const db = buy ? px - b.top : b.bottom - px;
    return da - db;
  });
  const z = candidates[0];
  const dist = buy ? (px - z.top) / pip : (z.bottom - px) / pip;
  if (dist > CFG.bounceMaxDistPips) {
    checks.push(`BELUM: zona ${buy ? 'demand' : 'supply'} terdekat ${R2(dist)} pip, terlalu jauh.`);
    return { ok: false, reason: 'bounce POI terlalu jauh.', checks };
  }

  const entry = R2(buy ? z.top : z.bottom);
  const buf = CFG.slBufferAtr * atr1;
  const sl = R2(buy ? z.bottom - buf : z.top + buf);
  if (buy ? sl >= entry : sl <= entry) {
    checks.push('BELUM: SL bounce tidak valid terhadap entry.');
    return { ok: false, reason: 'SL bounce tidak valid.', checks };
  }
  const risk = Math.abs(entry - sl);
  const riskPips = risk / pip;

  let tpMults, useRr, tpMode;
  if (strict) {
    useRr = CFG.rrOptions.includes(Number(rr)) ? Number(rr) : CFG.defaultRr;
    tpMults = [useRr, useRr + 0.5, useRr + 1];
    tpMode = 'RR';
  } else {
    const band = pickTpBand(symbol, riskPips);
    if (!band) {
      checks.push(`BELUM: risiko ${R2(riskPips)} pip di luar batas TP band.`);
      return { ok: false, reason: 'risk too high untuk bounce.', checks };
    }
    tpMults = band.mults; useRr = band.rr; tpMode = band.name;
  }

  const d = buy ? 1 : -1;
  const tp1 = R2(entry + d * risk * tpMults[0]);
  const tp2 = R2(entry + d * risk * tpMults[1]);
  const tp3 = R2(entry + d * risk * tpMults[2]);

  checks.push(`OK: Bounce ${buy ? 'BUY di Demand' : 'SELL di Supply'} ${z.pattern} (fresh, ${R2(dist)} pip dari harga).`);
  checks.push(`OK: LIMIT ${entry}, SL ${sl}, risiko ${R2(riskPips)} pip.`);
  checks.push(`INFO: Bounce scalp, tanpa CHoCH M5, menunggu harga menyentuh zona.`);

  const order = {
    side, role: 'bounce', orderType: 'LIMIT',
    entryPrice: entry, sl, tp1, tp2, tp3,
    risk: R2(risk), riskPips: R2(riskPips), rr: useRr, tpMode,
    expiryTime: now + CFG.orderExpiryMs,
    invalidLevel: R2(buy ? z.bottom : z.top),
    zoneId: z.id,
    confirmed: false,
    reason: `Bounce ${buy ? 'Demand' : 'Supply'} ${z.pattern} · ${R2(dist)} pip dari harga`,
  };
  return {
    ok: true, side, role: 'bounce', confirmed: false,
    order,
    zone: { id: z.id, timeframe: 'M5', type: `${z.type} ${z.pattern}`, top: z.top, bottom: z.bottom, fresh: true },
    checks,
  };
}

// ════════════════════════════════════════════════════════════════
// EVALUASI SATU ARAH (main/counter/bounce)
// ════════════════════════════════════════════════════════════════
function evaluateSide({ c1, c5, s5, px, pip, dec, atr1, atr5, side, role, strict, rr, now, symbol,
  minPoi = CFG.minConfluence, ignorePoi = false, allowBounce = false }) {
  const buy = side === 'buy';
  const R2 = v => roundTo(v, dec);
  const checks = [];
  const bad = reason => { checks.push(`BELUM: ${reason}`); return { ok: false, reason, checks }; };

  // A) Struktur M5 arah ini
  const ev5 = recentSideEvent(s5, c5, CFG.structLookback, side);
  if (!ev5) {
    // Manual: fallback ke bounce setup di zona S&D fresh
    if (allowBounce) {
      const b = evaluateBounce({ c1, c5, px, pip, dec, atr1, atr5, side, strict, rr, now, symbol, checks });
      if (b.ok) return b;
      return { ok: false, reason: b.reason, checks };
    }
    return bad(`belum ada BOS/CHoCH M5 ${buy ? 'bullish' : 'bearish'} dalam ${CFG.structLookback} candle.`);
  }
  const anc = ev5.anchor;
  const R = anc.high - anc.low;
  if (!(R > 0)) return bad('anchor leg tidak valid.');
  checks.push(`OK: ${ev5.type} M5, anchor ${R2(anc.low)}–${R2(anc.high)}.`);

  // B) OTE & invalidasi
  const lvl = f => (buy ? anc.high - R * f : anc.low + R * f);
  const oteHi = Math.max(lvl(CFG.oteFrom), lvl(CFG.oteTo));
  const oteLo = Math.min(lvl(CFG.oteFrom), lvl(CFG.oteTo));
  const deep = lvl(CFG.maxRetraceFib);
  const invalid = buy ? anc.low : anc.high;
  if (buy ? (px < anc.low || px < deep) : (px > anc.high || px > deep)) {
    return bad('harga menembus invalidasi swing atau retrace 0.886.');
  }
  checks.push(`OK: OTE ${R2(oteLo)}–${R2(oteHi)}, invalidasi ${R2(invalid)}.`);

  // C) Kumpulkan POI
  const ov = z => z.bottom <= oteHi && z.top >= oteLo;
  const cands = [];
  const ob = findOB(c5, anc, side);
  if (ob) cands.push(ob);
  for (const f of findFVGs(c5, side, buy ? anc.lowIdx : anc.highIdx, atr5)) cands.push(f);
  const sdZones = detectSDAndOB(c5, 'M5')
    .map(z => updateZoneState(z, c5))
    .filter(z => !z.mitigated && z.type === (buy ? 'demand' : 'supply') && (z.top - z.bottom) <= CFG.sdMaxWidthAtr * atr5);
  for (const z of sdZones) {
    cands.push({
      id: z.id, kind: 'SD',
      label: `${buy ? 'Demand' : 'Supply'} ${z.pattern}`,
      top: z.top, bottom: z.bottom, fresh: z.fresh,
    });
  }
  for (const z of cands) z.dist = ov(z) ? 0 : (z.top < oteLo ? oteLo - z.top : z.bottom - oteHi);
  const kinds = new Set(cands.filter(z => z.dist === 0).map(z => z.kind));

  let pool;
  if (ignorePoi) {
    // Mode Momentum (Bot Tier C): abaikan POI, pakai OTE sebagai zona
    pool = [{ id: 'OTE', kind: 'OTE', label: 'OTE Area', top: oteHi, bottom: oteLo, fresh: true, dist: 0 }];
  } else if (strict) {
    if (kinds.size < minPoi) return bad(`POI di OTE hanya ${kinds.size} dari 3 jenis, minimal ${minPoi}.`);
    pool = cands.filter(z => z.dist === 0);
  } else {
    pool = cands.filter(z => z.dist <= CFG.nearMaxAtr * atr5);
    if (!pool.length) {
      if (minPoi <= 1) {
        pool = [{ id: 'OTE', kind: 'OTE', label: 'OTE Area', top: oteHi, bottom: oteLo, fresh: true, dist: 0 }];
      } else {
        return bad(`tidak ada POI dalam ${CFG.nearMaxAtr} ATR M5 dari OTE.`);
      }
    }
  }
  const mid705 = lvl(CFG.oteMid);
  pool.sort((a, b) => a.dist - b.dist
    || Math.abs((a.top + a.bottom) / 2 - mid705) - Math.abs((b.top + b.bottom) / 2 - mid705));

  // D) Sentuhan POI di M1
  const touchOf = poi => {
    for (let j = Math.max(0, c1.length - CFG.touchLookback); j < c1.length; j++) {
      if (buy ? c1[j].low <= poi.top : c1[j].high >= poi.bottom) return j;
    }
    return -1;
  };

  // E) Coba satu POI
  const tryPoi = poi => {
    const touchIdx = touchOf(poi);
    if (strict && touchIdx < 0) return { ok: false, reason: 'harga belum menyentuh POI di M1.' };

    const conf = touchIdx >= 0
      ? m1ChochConfirm(c1, side, CFG.m1EventLookback, touchIdx)
      : { ok: false, reason: 'harga belum menyentuh POI di M1' };
    const confirmed = !!conf.ok;
    if (strict && !confirmed) return { ok: false, reason: conf.reason };

    const buf = CFG.slBufferAtr * atr1;
    const midPoi = (poi.top + poi.bottom) / 2;
    const evC = confirmed ? c1[conf.ev.k] : null;
    const rawSl = confirmed
      ? (buy ? Math.min(evC.low, poi.bottom) - buf : Math.max(evC.high, poi.top) + buf)
      : (buy ? poi.bottom - buf : poi.top + buf);

    const options = [];
    if (confirmed) {
      const entryMid = R2(midPoi);
      const refRisk = Math.abs(entryMid - rawSl);
      const market = strict
        ? true
        : (buy ? px <= entryMid + CFG.marketTolR * refRisk : px >= entryMid - CFG.marketTolR * refRisk);
      options.push({ orderType: market ? 'MARKET' : 'LIMIT', entry: R2(market ? px : entryMid) });
    } else {
      const levels = buy ? [poi.top, midPoi, poi.bottom] : [poi.bottom, midPoi, poi.top];
      for (const lv of levels) {
        const p = R2(lv);
        if (buy ? p < px : p > px) options.push({ orderType: 'LIMIT', entry: p });
      }
      if (!options.length) return { ok: false, reason: 'POI sudah dilewati harga, tidak ada level LIMIT yang valid.' };
    }

    let lastErr = 'tidak ada level entry yang memenuhi aturan SL dan TP.';
    for (const opt of options) {
      const entry = opt.entry;
      if (buy ? rawSl >= entry : rawSl <= entry) { lastErr = 'SL tidak valid terhadap entry.'; continue; }

      let sl = R2(rawSl);
      let risk = Math.abs(entry - sl);
      const minRisk = CFG.minSlPips * pip;
      if (risk < minRisk) {
        sl = R2(buy ? entry - minRisk : entry + minRisk);
        risk = Math.abs(entry - sl);
      }
      // Batas risiko = max(kelipatan ATR M1, SL minimum). Sebelumnya SL minimum 20 pip bisa
      // lebih besar dari batas ATR saat M1 tenang, sehingga setup selalu ditolak.
      const maxRisk = Math.max((strict ? CFG.maxSlAtrM1 : CFG.maxSlAtrM1Loose) * atr1, minRisk);
      if (risk > maxRisk) { lastErr = `SL ${R2(risk)} melebihi batas ATR M1 (${R2(maxRisk)}).`; continue; }

      const riskPips = risk / pip;
      let tpMults, useRr, tpMode;
      if (!strict) {
        const band = pickTpBand(symbol, riskPips);
        if (!band) {
          lastErr = `risk ${R2(riskPips)} pip di luar batas TP band (maks ${maxBandPips(symbol)} pip).`;
          continue;
        }
        tpMults = band.mults;
        useRr = band.rr;
        tpMode = band.name;
      } else {
        useRr = CFG.rrOptions.includes(Number(rr)) ? Number(rr) : CFG.defaultRr;
        tpMults = [useRr, useRr + 0.5, useRr + 1];
        tpMode = 'RR';
      }

      const d = buy ? 1 : -1;
      const tp1 = R2(entry + d * risk * tpMults[0]);
      const tp2 = R2(entry + d * risk * tpMults[1]);
      const tp3 = R2(entry + d * risk * tpMults[2]);

      if (strict) {
        const sw = getSwings(c5, CFG.swingLen);
        const from5 = c5.length - CFG.blockLookback;
        const levels = (buy ? sw.highs : sw.lows).filter(s => s.i >= from5).map(s => s.price);
        const blocker = levels.find(p => (buy
          ? p > entry + CFG.blockMinR * risk && p < tp1
          : p < entry - CFG.blockMinR * risk && p > tp1));
        if (blocker !== undefined) { lastErr = `swing likuiditas di ${R2(blocker)} menghalangi TP 1:${useRr}.`; continue; }
      }

      return {
        ok: true, poi, confirmed, conf,
        orderType: opt.orderType, entry, sl, risk, riskPips, useRr, tpMode, tp1, tp2, tp3,
      };
    }
    return { ok: false, reason: lastErr };
  };

  // F) Pilih POI pertama yang berhasil
  let picked = null;
  let lastReason = 'tidak ada POI yang valid.';
  for (const poi of pool) {
    const r = tryPoi(poi);
    if (r.ok) { picked = r; break; }
    lastReason = r.reason;
  }
  if (!picked) return bad(lastReason);

  const { poi, confirmed, conf, orderType, entry, sl, risk, riskPips, useRr, tpMode, tp1, tp2, tp3 } = picked;
  const poiNote = poi.dist === 0
    ? `di dalam OTE (${kinds.size}/3 jenis)`
    : `POI terdekat, ${R2(poi.dist)} dari OTE`;
  checks.push(`OK: POI ${poi.label}, ${poiNote}.`);
  checks.push(confirmed
    ? `OK: ${conf.type} M1 + candle konfirmasi.`
    : `INFO: pending LIMIT, ${conf.reason}.`);
  checks.push(`OK: SL ${sl}, risiko ${R2(risk)}.`);
  checks.push(`OK: ${tpMode === 'RR' ? `RR 1:${useRr}` : `band ${tpMode} (${R2(riskPips)} pip)`}, TP1 ${tp1}.`);

  const order = {
    side, role, orderType,
    entryPrice: entry, sl, tp1, tp2, tp3,
    risk: R2(risk), riskPips: R2(riskPips), rr: useRr, tpMode,
    expiryTime: now + CFG.orderExpiryMs,
    invalidLevel: R2(invalid),
    zoneId: poi.id,
    confirmed,
    reason: `${role === 'main' ? 'Searah bias' : 'Counter-trend'} · ${confirmed ? conf.type : 'Pending konfirmasi M1'} · ${poi.label} · ${poiNote} · ${orderType}`,
  };
  return {
    ok: true, role, side, confirmed, order,
    zone: { id: poi.id, timeframe: 'M5', type: poi.label, top: poi.top, bottom: poi.bottom, fresh: !!poi.fresh },
    checks,
  };
}

// ════════════════════════════════════════════════════════════════
// SCALPING SMC: bias -> dua arah (+bounce) -> pilih atau OCO
// ════════════════════════════════════════════════════════════════
export function runScalpSMC(bars, ctx, { strict = false, allowCounter = CFG.allowCounter, useOco = !strict,
  minPoi = CFG.minConfluence, ignorePoi = false, allowBounce } = {}) {
  if (allowBounce === undefined) allowBounce = !strict; // Manual: true, Bot: false

  const checks = [];
  let regime = 'choppy', regimeSrc = 'H1 MS';
  const fail = reason => ({ ok: false, regime, regimeSrc, reason, checks });
  const { dec, pip, now, price: px, symbol } = ctx;

  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5), ch1 = toDoc(bars.h1);
  if (c5.length < 30 || c1.length < 20 || ch1.length < 20) return fail('Data candle belum cukup (H1/M5/M1).');
  const atr5 = atrLast(c5), atr1 = atrLast(c1);
  if (!(atr5 > 0) || !(atr1 > 0)) return fail('ATR belum bisa dihitung.');

  const s5 = structureEvents(c5, CFG.swingLen);
  const hb = structureEvents(ch1, CFG.swingLen);

  let mainSide = null, biasSrc = 'H1 MS';
  if (hb.trend !== 0) mainSide = hb.trend === 1 ? 'buy' : 'sell';
  else if (!strict && s5.trend !== 0) {
    mainSide = s5.trend === 1 ? 'buy' : 'sell';
    biasSrc = 'M5 MS (H1 netral)';
  }
  if (!mainSide) {
    checks.push('BELUM: bias H1 dan M5 belum searah.');
    return fail('Bias belum searah.');
  }
  regime = mainSide === 'buy' ? 'trending_up' : 'trending_down';
  regimeSrc = `${biasSrc} (${mainSide === 'buy' ? 'HH/HL' : 'LH/LL'})`;
  checks.push(`OK: bias utama ${mainSide === 'buy' ? 'BUY' : 'SELL'} (${biasSrc}).`);

  const counterSide = mainSide === 'buy' ? 'sell' : 'buy';
  const tagOf = s => (s === 'buy' ? 'BUY' : 'SELL');
  const args = { c1, c5, s5, px, pip, dec, atr1, atr5, strict, rr: ctx.rr, now, symbol, allowBounce };

  const main = evaluateSide({ ...args, side: mainSide, role: 'main', minPoi, ignorePoi });
  checks.push(...main.checks.map(c => `[${tagOf(mainSide)} utama] ${c}`));

  let counter = { ok: false, reason: 'counter-trend dinonaktifkan', checks: [] };
  if (allowCounter) {
    counter = evaluateSide({ ...args, side: counterSide, role: 'counter', minPoi, ignorePoi });
    checks.push(...counter.checks.map(c => `[${tagOf(counterSide)} counter] ${c}`));
  }

  const M = main.ok ? main : null;
  const C = counter.ok ? counter : null;
  if (!M && !C) return fail(main.reason || counter.reason || 'Belum ada setup valid di kedua arah.');

  const success = (p, extra = {}) => ({
    ok: true,
    regime,
    regimeSrc: p.role === 'counter' ? `${regimeSrc} · COUNTER-TREND`
             : p.role === 'bounce'  ? `${regimeSrc} · BOUNCE SCALP`
             : regimeSrc,
    order: p.order,
    zone: p.zone,
    checks,
    ...extra,
  });

  if (useOco && M && C && !M.confirmed && !C.confirmed) {
    checks.push('OK: OCO aktif. Dua limit pending, salah satu terisi maka yang lain dibatalkan.');
    return success(M, { oco: { rule: 'first_fill_cancels_other', legs: [M.order, C.order] } });
  }

  const pick = [M && M.confirmed ? M : null, C && C.confirmed ? C : null, M, C].find(Boolean);
  return success(pick);
}

// ════════════════════════════════════════════════════════════════
// INTRADAY (VWAP) & SWING
// ════════════════════════════════════════════════════════════════
function calcVWAPSession(c) {
  let pv = 0, v = 0, day = null;
  const out = [];
  for (const x of c) {
    const d = new Date(x.time).toISOString().slice(0, 10);
    if (d !== day) { pv = 0; v = 0; day = d; }
    pv += (x.high + x.low + x.close) / 3;
    v += 1;
    out.push(pv / v);
  }
  return out;
}

function nextSessionEnd(now) {
  const d = new Date(now);
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 21, 0, 0));
  if (e.getTime() <= now) e.setUTCDate(e.getUTCDate() + 1);
  return e.getTime();
}

function intradayPlan(bars, ctx) {
  const c15 = toDoc(bars.m15), cH4 = toDoc(bars.h4);
  const atr15 = atrLast(c15);
  if (!c15.length || !(atr15 > 0)) return { ok: false, reason: 'Data M15 belum cukup untuk VWAP/ATR.', checks: [] };
  const regime = detectRegime(cH4);
  const vwap = lastOf(calcVWAPSession(c15));
  const last = lastOf(c15);
  const side = regime === 'trending_up' ? 'buy'
    : regime === 'trending_down' ? 'sell'
    : regime === 'choppy' ? null
    : (last.close > vwap ? 'buy' : 'sell');
  if (!side || !vwap) return { ok: false, regime, reason: 'Belum ada pullback ke VWAP sesi atau regime H4 choppy.', checks: [] };
  const d = side === 'buy' ? 1 : -1;
  const entry = vwap + d * atr15 * 0.1;
  if (side === 'buy' ? entry >= last.close : entry <= last.close) {
    return { ok: false, regime, reason: 'Harga sudah melewati entry VWAP.', checks: [] };
  }
  const sessionEnd = nextSessionEnd(ctx.now);
  const order = buildOrder(side, entry, vwap - d * atr15, [1.5, 2.25, 3], 'LIMIT', sessionEnd, 'vwap_pullback', 2, ctx.dec);
  return { ok: true, order, regime, regimeSrc: `H4 ${regime}`, zone: null, checks: [] };
}

function swingPlan(bars, ctx) {
  const cH4 = toDoc(bars.h4), cD1 = toDoc(bars.d1);
  const atr4 = atrLast(cH4);
  if (!cH4.length || !(atr4 > 0)) return { ok: false, reason: 'Data H4 belum cukup untuk ATR.', checks: [] };
  const regime = detectRegime(cD1);
  const want = regime === 'trending_up' ? 'demand' : regime === 'trending_down' ? 'supply' : null;
  if (!want) return { ok: false, regime, reason: 'Regime D1 belum searah.', checks: [] };
  const zones = [
    ...detectSDAndOB(cH4, 'H4').map(z => updateZoneState(z, cH4)),
    ...detectSDAndOB(cD1, 'D1').map(z => updateZoneState(z, cD1)),
  ];
  const last = lastOf(cH4);
  for (const z of zones) {
    if (z.mitigated || z.type !== want) continue;
    const buy = z.type === 'demand';
    const dist = buy ? last.close - z.top : z.bottom - last.close;
    if (!(dist >= 0 && dist <= 6 * atr4)) continue;
    const entry = buy ? z.top : z.bottom;
    const sl = buy ? z.bottom - 0.5 * atr4 : z.top + 0.5 * atr4;
    return {
      ok: true, regime, regimeSrc: `D1 ${regime}`,
      order: buildOrder(buy ? 'buy' : 'sell', entry, sl, [1.5, 2.25, 3], 'LIMIT', ctx.now + 4 * 86400e3, `htf_${z.type}_${z.pattern}`, 3, ctx.dec),
      zone: { id: z.id, timeframe: z.timeframe, type: `${z.type} ${z.pattern}`, top: z.top, bottom: z.bottom, fresh: !!z.fresh },
      checks: [],
    };
  }
  return { ok: false, regime, reason: 'Belum ada zona S&D/OB H4/D1 searah D1 yang dekat dengan harga.', checks: [] };
}

// ════════════════════════════════════════════════════════════════
// SETUP KONTINUITAS
// BOS M5 yang baru terjadi searah bias H1 -> LIMIT di tengah FVG retest yang belum tersentuh.
// SL di luar FVG dan swing likuiditas terdekat + buffer. Jika FVG tidak ada atau tidak layak,
// ok:false dan engine kembali ke setup POI.
// ════════════════════════════════════════════════════════════════
function findFreshFvgs(c, side, fromIdx) {
  const out = [];
  for (let i = Math.max(2, fromIdx); i < c.length; i++) {
    const a = c[i - 2], b = c[i];
    let bottom, top;
    if (side === 'buy' && a.high < b.low) { bottom = a.high; top = b.low; }
    else if (side === 'sell' && a.low > b.high) { bottom = b.high; top = a.low; }
    else continue;
    let touched = false;
    for (let j = i + 1; j < c.length; j++) {
      if (side === 'buy' ? c[j].low <= top : c[j].high >= bottom) { touched = true; break; }
    }
    if (!touched) out.push({ idx: i, bottom, top });
  }
  return out;
}

export function continuityPlan(bars, ctx) {
  const { now, price: px, dec, pip, symbol } = ctx;
  const R2 = v => roundTo(v, dec);
  const checks = [];
  const no = reason => { checks.push(`BELUM kontinuitas: ${reason}`); return { ok: false, reason, checks }; };

  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5), ch1 = toDoc(bars.h1);
  if (c5.length < 30 || ch1.length < 20) return no('data belum cukup');
  const atr5 = atrLast(c5), atr1 = atrLast(c1);
  if (!(atr5 > 0)) return no('ATR M5 belum bisa dihitung');

  const hb = structureEvents(ch1, CFG.swingLen);
  if (hb.trend === 0) return no('bias H1 belum searah');
  const side = hb.trend === 1 ? 'buy' : 'sell';
  const dir = side === 'buy' ? 1 : -1;

  const s5 = structureEvents(c5, CFG.swingLen);
  const bosType = side === 'buy' ? 'BOS_BULL' : 'BOS_BEAR';
  const bos = lastOf(s5.events.filter(e => e.type === bosType));
  const lastEv = lastOf(s5.events);
  const age = bos ? c5.length - 1 - bos.k : Infinity;
  if (!bos || age > CFG.contLookbackM5) return no(`belum ada BOS ${side === 'buy' ? 'bullish' : 'bearish'} M5 dalam ${CFG.contLookbackM5} candle terakhir`);
  if (lastEv && lastEv.k > bos.k && lastEv.side !== side) return no('struktur M5 sudah berbalik setelah BOS');
  checks.push(`OK: BOS ${side === 'buy' ? 'bullish' : 'bearish'} M5 ${age} candle lalu, searah bias H1.`);

  // FVG segar di sisi retest (sell: di atas harga, buy: di bawah harga)
  const fvgs = findFreshFvgs(c5, side, Math.max(2, bos.k - CFG.contFvgFromBos));
  const cand = fvgs.filter(f => (side === 'sell' ? f.bottom > px : f.top < px));
  if (!cand.length) return no('tidak ada FVG fresh di sisi retest, kembali ke POI');
  cand.sort((a, b) => (side === 'sell' ? a.bottom - b.bottom : b.top - a.top));
  const f = cand[0];
  const entry = R2((f.top + f.bottom) / 2);
  const distPips = Math.abs(entry - px) / pip;
  if (distPips > CFG.contMaxDistPips) return no(`FVG retest ${R2(distPips)} pip dari harga, di luar batas ${CFG.contMaxDistPips} pip, kembali ke POI`);

  // SL di luar swing likuiditas terdekat di sisi invalidasi
  const sw = getSwings(c5, CFG.swingLen);
  const from = c5.length - 60;
  const liq = (side === 'sell' ? sw.highs : sw.lows)
    .filter(p => p.i >= from && (side === 'sell' ? p.price > f.top : p.price < f.bottom))
    .map(p => p.price);
  const edge = side === 'sell'
    ? (liq.length ? Math.min(...liq) : f.top)
    : (liq.length ? Math.max(...liq) : f.bottom);
  const buf = CFG.contSlBufferAtr5 * atr5;
  let sl = R2(side === 'sell' ? edge + buf : edge - buf);
  let risk = Math.abs(entry - sl);
  const minRisk = CFG.minSlPips * pip;
  if (risk < minRisk) { sl = R2(side === 'sell' ? entry + minRisk : entry - minRisk); risk = Math.abs(entry - sl); }
  if (side === 'sell' ? sl <= entry : sl >= entry) return no('SL tidak valid terhadap entry');
  if (risk > CFG.contMaxRiskAtr5 * atr5) return no(`risiko ${R2(risk)} melebihi ${CFG.contMaxRiskAtr5} ATR M5`);
  const riskPips = risk / pip;
  const band = pickTpBand(symbol, riskPips);
  if (!band) return no(`risiko ${R2(riskPips)} pip di luar batas TP band`);
  const t = band.mults.map(m => R2(entry + dir * risk * m));

  checks.push(`OK: FVG retest ${side === 'sell' ? 'bearish' : 'bullish'} ${R2(f.bottom)}–${R2(f.top)}, LIMIT ${entry}, SL ${sl} di luar likuiditas.`);
  checks.push(`OK: risiko ${R2(riskPips)} pip, band ${band.name}, TP1 ${t[0]}.`);

  const order = {
    side, role: 'continuity', orderType: 'LIMIT',
    entryPrice: entry, sl, tp1: t[0], tp2: t[1], tp3: t[2],
    risk: R2(risk), riskPips: R2(riskPips), rr: band.rr, tpMode: band.name,
    expiryTime: now + CFG.contExpiryMs,
    invalidLevel: R2(side === 'sell' ? f.top : f.bottom),
    zoneId: `KONT-FVG-${side}-${f.idx}`,
    confirmed: false,
    reason: `Kontinuitas · BOS ${side === 'sell' ? 'bearish' : 'bullish'} M5 · FVG retest · LIMIT`,
  };
  return {
    ok: true, role: 'continuity', side, confirmed: false, order,
    zone: { id: order.zoneId, timeframe: 'M5', type: `FVG ${side === 'sell' ? 'bearish' : 'bullish'} retest`, top: f.top, bottom: f.bottom, fresh: true },
    regime: side === 'sell' ? 'trending_down' : 'trending_up',
    regimeSrc: 'H1 MS · KONTINUITAS',
    checks,
  };
}

// ════════════════════════════════════════════════════════════════
// TITIK MASUK SEMUA GAYA MANUAL
// ════════════════════════════════════════════════════════════════
export function generateManualPlan(input, styleName) {
  const {
    m1, m5, m15, h1, h4, d1,
    tickSize = 0.01, now = Date.now(), price: livePrice = 0,
    pip = 0.1, rr = CFG.defaultRr, symbol = 'XAUUSD',
  } = input;
  const dec = Math.max(0, Math.round(-Math.log10(tickSize)));
  const ctx = { price: Number(livePrice) || 0, pip, dec, now, rr, symbol };

  if (styleName === 'Scalping') {
    const cont = continuityPlan({ m1, m5, h1 }, ctx);
    if (cont.ok) return cont;
    const poi = runScalpSMC({ m1, m5, h1 }, ctx, { strict: false, minPoi: 2, ignorePoi: false, allowBounce: true });
    return { ...poi, checks: [...cont.checks, ...(poi.checks || [])] };
  }
  if (styleName === 'Intraday') return intradayPlan({ m15, h4 }, ctx);
  if (styleName === 'Swing') return swingPlan({ h4, d1 });
  return { ok: false, reason: `Gaya tidak dikenal: ${styleName}`, checks: [] };
}

export const SYARAT_MASUK = {
  Scalping: 'Bias H1 (HH/HL atau LH/LL) sebagai arah utama, atau M5 jika H1 netral. Setiap arah dicek sendiri: BOS/CHoCH M5 arah itu, OTE 0.618–0.786, POI (OB/FVG/S&D). Jika arah itu tidak punya struktur, sistem fallback ke BOUNCE: LIMIT di zona Supply/Demand fresh M5 terdekat. OCO aktif jika dua limit pending valid. Setelah sentuhan POI dan CHoCH M1 dengan candle konfirmasi, entry MARKET jika harga di area entry. SL di luar POI + buffer 0.2 ATR M1. TP band: XAUUSD risk <40 pip = 1:1.5 / 1:2.5 / 1:4; 40–50 pip = 1:1 / 1:2 / 1:3; >50 pip ditolak. BTCUSD memakai batas 80 dan 100 pip.',
  Intraday: 'Regime H4 searah, pullback ke VWAP sesi M15, limit terisi di VWAP (RR 1:1.5 s/d 1:3)',
  Swing: 'Harga mendekati zona S&D/OB H4/D1 searah regime D1, limit terisi di OB H4 (RR 1:3)',
};

export function buildWatchlist({ m5, m15, h1, h4, d1, price, pip, styleName }) {
  const sets = {
    Scalping: [['H1', h1, 3], ['M5', m5, 2.5]],
    Intraday: [['H1', h1, 3], ['M15', m15, 2]],
    Swing: [['H4', h4, 3], ['D1', d1, 3]],
  }[styleName] || [];
  const step = Number(pip) > 0 ? Number(pip) : 0.1;
  const out = [];
  for (const [tf, bars, maxAtr] of sets) {
    const c = toDoc(bars);
    if (c.length < 25) continue;
    const atr = atrLast(c);
    if (!(atr > 0)) continue;
    const zones = detectSDAndOB(c, tf).map(z => updateZoneState(z, c)).filter(z => !z.mitigated);
    for (const z of zones) {
      const dist = price > z.top ? price - z.top : price < z.bottom ? z.bottom - price : 0;
      if (dist > maxAtr * atr) continue;
      out.push({
        tf,
        tipe: `${z.type === 'supply' ? 'SELL (Supply' : 'BUY (Demand'} ${z.pattern})`,
        bawah: z.bottom, atas: z.top,
        jarak_pip: Math.round(dist / step),
        di_dalam: dist === 0,
        status: z.fresh ? 'fresh' : 'termitigasi sebagian',
      });
    }
  }
  out.sort((a, b) => (a.status === b.status ? a.jarak_pip - b.jarak_pip : a.status === 'fresh' ? -1 : 1));
  return out.slice(0, 4);
}
