// lib/smc_flex.js — ENGINE SMC FLEKSIBEL (mandiri): bot & manual Scalping
// Alur dinamis, mengikuti struktur yang sedang berjalan:
//   1) Bias: H1 (fallback M15). Dealing range: buy hanya discount, sell hanya premium.
//   2) Jika harga menyentuh POI H1/M15 searah bias -> CHoCH M5 -> BOS M5 -> entry di FVG/OB displacement.
//   3) Jika tidak ada POI cocok: pakai CHoCH M5 + BOS M5 terbaru yang masih berjalan.
//   4) Jika entry sudah tertinggal: kontinuitas (BOS searah terbaru -> retest FVG).
//   5) Tanpa CHoCH dan BOS yang valid: diam (STANDBY). Tidak ada entry tanpa struktur.
// Entry: LIMIT retest FVG/OB, atau MARKET jika harga di dalam zona dan CHoCH M1 terkonfirmasi.
// v2: simpleZonePlan = zona M5 di-refine ke zona M1, SL tetap 30-50 pip (emas), invalidasi di tepi jauh zona M5.

export const CFG = {
  swingLen: 3,            // fractal M5/H1
  m1SwingLen: 2,
  atrPeriod: 14,
  poiMaxAtr: 2.0,         // POI maksimal 2 ATR dari harga
  touchLookback: 40,      // POI harus disentuh dalam 40 candle M5
  chochMaxAge: 40,        // CHoCH M5 berlaku 40 candle
  bosMaxAge: 30,          // BOS M5 berlaku 30 candle
  sdImpulseAtr: 1.5,
  sdBaseAtr: 0.85,
  slBufferAtr: 0.3,
  minSlPips: 20,
  maxRiskAtr: 4,
  maxLimitPips: 40,
  m1Lookback: 20,
  limitExpiryMs: 20 * 60e3,
  marketExpiryMs: 10 * 60e3,
  // Band TP (pip): risiko < lowMax -> 1:1.5 / 1:2.5 / 1:4 ; mid -> 1:1 / 1:2 / 1:3 ; di atas mid ditolak
  bands: {
    XAUUSD: { lowMax: 40, midMax: 50 },
    BTCUSD: { lowMax: 80, midMax: 100 },
  },
  defaultBand: { lowMax: 40, midMax: 50 },
};

// ─────────────── utilitas ───────────────
const toMs = t => { const n = Number(t); if (!Number.isFinite(n) || n <= 0) return Date.now(); return n < 1e12 ? n * 1000 : n; };
export const toDoc = bars => (bars || []).map(b => ({ time: toMs(b.t), open: b.o, high: b.h, low: b.l, close: b.c }));
const lastOf = a => (a && a.length ? a[a.length - 1] : undefined);
const R = (p, d) => Number(Number(p).toFixed(d));

export function atr(c, period = CFG.atrPeriod) {
  if (!c || c.length < period + 1) return 0;
  let a = 0;
  for (let i = 1; i <= period; i++) a += trOf(c, i);
  a /= period;
  for (let i = period + 1; i < c.length; i++) a = (a * (period - 1) + trOf(c, i)) / period;
  return a;
}
const trOf = (c, i) => Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));

// ─────────────── struktur pasar ───────────────
function swings(c, n) {
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

// Anchor leg: untuk buy = swing low sebelum break, plus high tertinggi sesudahnya
function anchorFor(c, side, idx, k) {
  if (side === 'buy') {
    let hi = -Infinity, hiI = idx;
    for (let j = idx; j <= k; j++) if (c[j].high > hi) { hi = c[j].high; hiI = j; }
    return { low: c[idx].low, lowIdx: idx, high: hi, highIdx: hiI };
  }
  let lo = Infinity, loI = idx;
  for (let j = idx; j <= k; j++) if (c[j].low < lo) { lo = c[j].low; loI = j; }
  return { high: c[idx].high, highIdx: idx, low: lo, lowIdx: loI };
}

export function structure(c, n = CFG.swingLen) {
  const { highs, lows } = swings(c, n);
  const events = [];
  let trend = 0, brokenHi = -1, brokenLo = -1;
  for (let k = 2 * n + 1; k < c.length; k++) {
    const hs = highs.filter(h => h.i + n < k), ls = lows.filter(l => l.i + n < k);
    const h1 = lastOf(hs), h0 = hs.length >= 2 ? hs[hs.length - 2] : undefined;
    const l1 = lastOf(ls), l0 = ls.length >= 2 ? ls[ls.length - 2] : undefined;
    if (h1 && h0 && l1 && l0) {
      if (h1.price > h0.price && l1.price > l0.price) trend = 1;
      else if (h1.price < h0.price && l1.price < l0.price) trend = -1;
    }
    const close = c[k].close;
    if (h1 && h1.i !== brokenHi && close > h1.price) {
      const lb = lastOf(ls.filter(l => l.i < h1.i));
      events.push({ k, side: 'buy', type: trend === -1 ? 'CHoCH_BULL' : 'BOS_BULL', level: h1.price, anchor: lb ? anchorFor(c, 'buy', lb.i, k) : null });
      brokenHi = h1.i; trend = 1;
    }
    if (l1 && l1.i !== brokenLo && close < l1.price) {
      const hb = lastOf(hs.filter(h => h.i < l1.i));
      events.push({ k, side: 'sell', type: trend === 1 ? 'CHoCH_BEAR' : 'BOS_BEAR', level: l1.price, anchor: hb ? anchorFor(c, 'sell', hb.i, k) : null });
      brokenLo = l1.i; trend = -1;
    }
  }
  return { trend, events };
}

// ─────────────── zona S&D (base + impulse) ───────────────
function sdZones(c, tf) {
  const out = [];
  const a = atr(c);
  if (!(a > 0) || c.length < 25) return out;
  for (let i = Math.max(20, c.length - 100); i < c.length - 1; i++) {
    const x = c[i];
    if (Math.abs(x.close - x.open) < CFG.sdImpulseAtr * a) continue;
    const bullImp = x.close > x.open;
    let baseStart = i, cnt = 0;
    for (let b = i - 1; b >= Math.max(1, i - 3); b--) {
      if (Math.abs(c[b].close - c[b].open) <= CFG.sdBaseAtr * a) { baseStart = b; cnt++; } else break;
    }
    if (!cnt) continue;
    const base = c.slice(baseStart, i);
    const top = Math.max(...base.map(v => v.high)), bottom = Math.min(...base.map(v => v.low));
    let touched = false, mitigated = false;
    for (let k = i + 1; k < c.length; k++) {
      if (bullImp) {
        if (c[k].low <= top) touched = true;
        if (c[k].close < bottom) { mitigated = true; break; }
      } else {
        if (c[k].high >= bottom) touched = true;
        if (c[k].close > top) { mitigated = true; break; }
      }
    }
    const strength = Math.abs(x.close - x.open) / a;
    if (!mitigated) out.push({ tf, type: bullImp ? 'demand' : 'supply', top, bottom, fresh: !touched, idx: i, strength, pattern: bullImp ? 'RBR/DBR' : 'RBD/DBD', id: `${tf}-${bullImp ? 'D' : 'S'}-${x.time}` });
  }
  return out;
}

// ─────────────── dealing range ───────────────
export function dealingRange(c, tf) {
  const s = structure(c);
  if (s.trend === 0) return null;
  const side = s.trend === 1 ? 'buy' : 'sell';
  const ev = lastOf(s.events.filter(e => e.side === side && e.anchor));
  if (!ev) return null;
  const a = ev.anchor;
  let lo, hi;
  if (side === 'buy') { lo = a.low; hi = -Infinity; for (let j = a.lowIdx; j < c.length; j++) hi = Math.max(hi, c[j].high); }
  else { hi = a.high; lo = Infinity; for (let j = a.highIdx; j < c.length; j++) lo = Math.min(lo, c[j].low); }
  if (!(hi > lo)) return null;
  return { side, tf, lo, hi, eq: (lo + hi) / 2 };
}

// ─────────────── helper M5 ───────────────
// POI H1/M15 searah bias, di sisi dealing range yang benar, terdekat dan fresh diutamakan
function htfPois(h1, m15, side, px, rng) {
  const want = side === 'buy' ? 'demand' : 'supply';
  const out = [];
  for (const [tf, c] of [['H1', h1], ['M15', m15]]) {
    if (c.length < 25) continue;
    const a = atr(c);
    if (!(a > 0)) continue;
    for (const z of sdZones(c, tf)) {
      if (z.type !== want) continue;
      if (rng && !(side === 'buy' ? z.top <= rng.eq : z.bottom >= rng.eq)) continue;
      const dist = side === 'buy' ? Math.max(0, px - z.top) : Math.max(0, z.bottom - px);
      if (dist > CFG.poiMaxAtr * a) continue;
      out.push({ ...z, dist });
    }
  }
  return out.sort((x, y) => (Number(y.fresh) - Number(x.fresh)) || (x.dist - y.dist));
}

function touchIdx(c5, side, z) {
  for (let j = Math.max(0, c5.length - CFG.touchLookback); j < c5.length; j++) {
    if (side === 'buy' ? c5[j].low <= z.top : c5[j].high >= z.bottom) return j;
  }
  return -1;
}

// CHoCH M5 terbaru searah (dan belum berbalik) -> BOS searah sesudahnya
function chochBos(c5, side, minIdx) {
  const s = structure(c5);
  const n = c5.length - 1;
  const cT = side === 'buy' ? 'CHoCH_BULL' : 'CHoCH_BEAR';
  const bT = side === 'buy' ? 'BOS_BULL' : 'BOS_BEAR';
  const opp = side === 'buy' ? 'sell' : 'buy';
  const choch = lastOf(s.events.filter(e => e.type === cT && e.anchor && e.k >= minIdx && n - e.k <= CFG.chochMaxAge));
  if (!choch) return { ok: false, reason: 'belum ada CHoCH M5 searah' };
  const after = s.events.filter(e => e.k > choch.k);
  if (after.some(e => e.side === opp)) return { ok: false, reason: 'struktur M5 berbalik setelah CHoCH' };
  const bos = after.find(e => e.type === bT && n - e.k <= CFG.bosMaxAge);
  if (!bos) return { ok: false, reason: 'CHoCH ada, menunggu BOS M5 searah' };
  return { ok: true, choch, bos };
}

// BOS searah terbaru (untuk kontinuitas bila entry awal sudah tertinggal)
function latestContinuation(c5, side) {
  const s = structure(c5);
  const n = c5.length - 1;
  const bT = side === 'buy' ? 'BOS_BULL' : 'BOS_BEAR';
  const opp = side === 'buy' ? 'sell' : 'buy';
  const bos = lastOf(s.events.filter(e => e.type === bT && n - e.k <= CFG.bosMaxAge));
  if (!bos) return null;
  if (s.events.some(e => e.k > bos.k && e.side === opp)) return null;
  return bos;
}

function fvgBetween(c5, side, from, to) {
  let best = null;
  for (let i = Math.max(2, from); i <= Math.min(to, c5.length - 1); i++) {
    const a = c5[i - 2], b = c5[i];
    let bottom, top;
    if (side === 'buy' && a.high < b.low) { bottom = a.high; top = b.low; }
    else if (side === 'sell' && a.low > b.high) { bottom = b.high; top = a.low; }
    else continue;
    let filled = false;
    for (let j = i + 1; j < c5.length; j++) {
      if (side === 'buy' ? c5[j].low <= bottom : c5[j].high >= top) { filled = true; break; }
    }
    if (!filled) best = { bottom, top, kind: 'FVG' };
  }
  return best;
}

function obBefore(c5, side, k, from) {
  for (let j = k - 1; j >= Math.max(0, from); j--) {
    const x = c5[j];
    const opposite = side === 'buy' ? x.close < x.open : x.close > x.open;
    if (!opposite) continue;
    for (let q = j + 1; q < c5.length; q++) {
      if (side === 'buy' ? c5[q].close < x.low : c5[q].close > x.high) return null;
    }
    return { bottom: x.low, top: x.high, kind: 'OB' };
  }
  return null;
}

function m1Confirm(c1, side) {
  const s = structure(c1, CFG.m1SwingLen);
  const want = side === 'buy' ? 'CHoCH_BULL' : 'CHoCH_BEAR';
  const ev = lastOf(s.events.filter(e => e.type === want && c1.length - 1 - e.k <= CFG.m1Lookback));
  if (!ev) return null;
  const cl = lastOf(c1), range = cl.high - cl.low;
  if (!(range > 0) || c1.length - 1 <= ev.k) return null;
  const body = Math.abs(cl.close - cl.open);
  const dirOk = side === 'buy' ? cl.close > cl.open : cl.close < cl.open;
  const breakOk = side === 'buy' ? cl.close > c1[ev.k].high : cl.close < c1[ev.k].low;
  return dirOk && breakOk && body >= 0.5 * range ? ev : null;
}

// Entry dari zona (FVG atau OB) yang terbentuk oleh displacement sequence
function entryFrom(c5, c1, side, seq, px, pip, dec) {
  const buy = side === 'buy';
  let z = fvgBetween(c5, side, seq.choch.k - 2, seq.bos.k);
  if (!z) z = obBefore(c5, side, seq.choch.k, seq.choch.k - 10);
  if (!z) return { ok: false, reason: 'tidak ada FVG/OB displacement' };
  if (buy ? px < z.bottom : px > z.top) return { ok: false, reason: `harga sudah menembus ${z.kind}, entry tertinggal` };
  const inside = buy ? px <= z.top : px >= z.bottom;
  if (inside) {
    if (!m1Confirm(c1, side)) return { ok: false, reason: `harga di ${z.kind}, menunggu konfirmasi M1` };
    return { ok: true, zone: z, kind: z.kind, orderType: 'MARKET', entry: R(px, dec), confirmed: true };
  }
  const mid = R((z.top + z.bottom) / 2, dec);
  if (Math.abs(mid - px) / pip > CFG.maxLimitPips) return { ok: false, reason: `LIMIT ${z.kind} lebih dari ${CFG.maxLimitPips} pip, tertinggal` };
  return { ok: true, zone: z, kind: z.kind, orderType: 'LIMIT', entry: mid, confirmed: false };
}

function bandFor(symbol, riskPips) {
  const b = CFG.bands[symbol] || CFG.defaultBand;
  if (riskPips <= 0) return null;
  if (riskPips < b.lowMax) return { name: 'LOW_RISK', mults: [1.5, 2.5, 4], rr: 1.5 };
  if (riskPips <= b.midMax) return { name: 'MID_RISK', mults: [1, 2, 3], rr: 1 };
  return null;
}

function orderFrom(side, seq, ent, atr5, pip, dec, symbol) {
  const buy = side === 'buy';
  const z = ent.zone, entry = R(ent.entry, dec);
  const buf = CFG.slBufferAtr * atr5, minRisk = CFG.minSlPips * pip, maxRisk = CFG.maxRiskAtr * atr5;
  const cands = [buy ? z.bottom - buf : z.top + buf, buy ? seq.choch.anchor.low - buf : seq.choch.anchor.high + buf];
  let best = null;
  for (const raw of cands) {
    let sl = R(raw, dec);
    if (buy ? sl >= entry : sl <= entry) continue;
    let risk = Math.abs(entry - sl);
    if (risk < minRisk) { sl = R(buy ? entry - minRisk : entry + minRisk, dec); risk = Math.abs(entry - sl); }
    if (risk > maxRisk) continue;
    if (!best || risk < best.risk) best = { sl, risk };
  }
  if (!best) return { ok: false, reason: 'SL tidak valid atau risiko melebihi batas' };
  const riskPips = best.risk / pip;
  const band = bandFor(symbol, riskPips);
  if (!band) return { ok: false, reason: `risiko ${R(riskPips, 1)} pip di luar batas TP` };
  const d = buy ? 1 : -1;
  return {
    ok: true, entry, sl: best.sl, risk: best.risk, riskPips, band,
    tps: band.mults.map(m => R(entry + d * best.risk * m, dec)),
    invalid: R(buy ? seq.choch.anchor.low : seq.choch.anchor.high, dec),
  };
}

// ─────────────── ENGINE UTAMA ───────────────
// bars: { m1, m5, m15, h1 } (candle sudah tertutup, format {t,o,h,l,c})
// ctx : { price, dec, pip, now, symbol }
export function flexScalpPlan(bars, ctx) {
  const { price: px, dec, pip, now, symbol } = ctx;
  const checks = [];
  const fail = (reason, extra = {}) => ({ ok: false, reason, checks, bias: 'NETRAL', regime: 'choppy', regimeSrc: '-', ...extra });

  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5), h1 = toDoc(bars.h1), m15 = toDoc(bars.m15);
  if (c5.length < 30 || c1.length < 20) return fail('Data M1/M5 belum cukup.');
  const atr5 = atr(c5), atr1 = atr(c1);
  if (!(atr5 > 0) || !(atr1 > 0)) return fail('ATR belum bisa dihitung.');

  // 1) Bias
  let biasTf = 'H1', biasC = h1, hb = structure(h1);
  if (hb.trend === 0 && m15.length >= 30) { biasTf = 'M15'; biasC = m15; hb = structure(m15); }
  if (hb.trend === 0) return fail('Bias H1 dan M15 belum searah.');
  const side = hb.trend === 1 ? 'buy' : 'sell';
  const bias = side === 'buy' ? 'bullish' : 'bearish';
  const regime = side === 'buy' ? 'trending_up' : 'trending_down';
  const regimeSrc = `${biasTf} MS (${side === 'buy' ? 'HH/HL' : 'LH/LL'})`;
  checks.push(`OK: bias ${biasTf} ${bias}.`);

  // 2) Dealing range
  const rng = dealingRange(biasC, biasTf);
  if (rng) {
    const where = side === 'buy' ? (px < rng.eq ? 'discount' : 'premium') : (px > rng.eq ? 'premium' : 'discount');
    checks.push(`OK: dealing range ${biasTf} ${R(rng.lo, dec)}–${R(rng.hi, dec)}, EQ ${R(rng.eq, dec)}, harga di ${where}.`);
  }
  const sideOk = p => !rng || (side === 'buy' ? p <= rng.eq : p >= rng.eq);

  const build = (seq, label, poiTag) => {
    const ent = entryFrom(c5, c1, side, seq, px, pip, dec);
    if (!ent.ok) return { ok: false, reason: ent.reason };
    if (!sideOk(ent.entry)) return { ok: false, reason: 'entry di area berlawanan dealing range' };
    const o = orderFrom(side, seq, ent, atr5, pip, dec, symbol);
    if (!o.ok) return { ok: false, reason: o.reason };
    const reason = `Flex · ${label} · CHoCH M5 · BOS M5 · ${ent.kind} ${ent.confirmed ? 'konfirmasi M1' : 'LIMIT retest'}`;
    return {
      ok: true, role: 'main', side, confirmed: ent.confirmed, regime, regimeSrc, bias, biasTf, checks,
      order: {
        side, role: 'main', orderType: ent.orderType, entryPrice: o.entry, sl: o.sl,
        tp1: o.tps[0], tp2: o.tps[1], tp3: o.tps[2], risk: R(o.risk, dec), riskPips: R(o.riskPips, 1),
        rr: o.band.rr, tpMode: o.band.name, invalidLevel: o.invalid,
        expiryTime: now + (ent.confirmed ? CFG.marketExpiryMs : CFG.limitExpiryMs),
        zoneId: `${poiTag}-${side}-${seq.choch.k}`, confirmed: ent.confirmed, reason,
      },
      zone: { id: `${poiTag}-${side}-${seq.choch.k}`, timeframe: 'M5', type: `${ent.kind} displacement`, top: ent.zone.top, bottom: ent.zone.bottom, fresh: true },
    };
  };

  // 3) POI H1/M15 yang disentuh -> CHoCH M5 -> BOS M5
  for (const z of htfPois(h1, m15, side, px, rng).slice(0, 3)) {
    const t = touchIdx(c5, side, z);
    if (t < 0) { checks.push(`BELUM: POI ${z.tf} ${z.type} belum disentuh.`); continue; }
    const seq = chochBos(c5, side, t - 3);
    if (!seq.ok) { checks.push(`BELUM: ${seq.reason}.`); continue; }
    const r = build(seq, `POI ${z.tf} ${z.type}`, 'POI');
    if (r.ok) { checks.push(`OK: POI ${z.tf} ${z.type} disentuh, CHoCH & BOS M5 valid.`); return r; }
    checks.push(`BELUM: ${r.reason}.`);
  }

  // 4) Struktur berjalan: CHoCH M5 + BOS M5 terbaru searah bias
  const seqRun = chochBos(c5, side, c5.length - 1 - CFG.chochMaxAge);
  if (seqRun.ok) {
    const r = build(seqRun, 'Struktur berjalan', 'RUN');
    if (r.ok) { checks.push('OK: mengikuti struktur M5 yang berjalan.'); return r; }
    checks.push(`BELUM: ${r.reason}.`);

    // 5) Kontinuitas: entry tertinggal -> BOS searah terbaru -> retest FVG
    const cont = latestContinuation(c5, side);
    if (cont && cont.k > seqRun.bos.k) {
      const seqC = { choch: seqRun.choch, bos: cont };
      const rc = build(seqC, 'Kontinuitas', 'CONT');
      if (rc.ok) { checks.push('OK: kontinuitas, BOS searah terbaru.'); return rc; }
      checks.push(`BELUM: kontinuitas, ${rc.reason}.`);
    }
  } else {
    checks.push(`BELUM: ${seqRun.reason}.`);
  }

  return fail('Belum ada struktur valid. Bot diam sampai CHoCH dan BOS M5 searah muncul.', { checks, bias, regime, regimeSrc, biasTf });
}

// ─────────────── BOT ───────────────
// Output sama dengan kontrak lama (dipakai generate.js → runBot)
export function runBotSma(bars, { price, dec = 2, pip = 0.1, symbol = 'XAUUSD' }) {
  // Bot hanya memakai struktur M15 + M5 + M1 (scalpStructPlan). Tanpa H1 dan tanpa cadangan lain.
  const p = botZonePlan(bars, { price, dec, pip, now: Date.now(), symbol });
  if (!p.ok) {
    return {
      ok: false, reason: p.reason, dirTxt: '-', trigger: null,
      bias: p.bias || 'NETRAL', trendTxt: p.biasTf ? `${p.biasTf} ${p.bias}` : '-',
      structTxt: p.regimeSrc || '-', checklist: (p.checks || []).slice(-12),
    };
  }
  const o = p.order;
  return {
    ok: true, dir: o.side === 'buy' ? 1 : -1, dirTxt: o.side === 'buy' ? 'BUY' : 'SELL',
    role: o.role, tier: 'ZONE_M5', bias: p.bias, trigger: o.reason, checklist: p.checks,
    trendTxt: `${p.biasTf} ${p.bias}`, structTxt: p.regimeSrc,
    entry: o.entryPrice, sl: o.sl, tps: [o.tp1, o.tp2, o.tp3], rr: o.rr, tpMode: o.tpMode,
    orderType: o.orderType, confidence: p.confirmed ? 'HIGH' : 'MEDIUM',
    setup: `Bot ZONE M5 · ${o.reason}`, reason: null,
  };
}

// ════════════════════════════════════════════════════════════════
// PULLBACK LIMIT (manual Scalping & bot)
// Syarat: H1 searah (dan M15 tidak berlawanan). Impuls M5 searah (BOS terbaru, belum berbalik).
// Entry: LIMIT di zona retrace OTE 0.618–0.786 dari impuls, pada FVG M1/M3/M5 yang belum terisi
//        (jika tidak ada, LIMIT di tengah OTE). MARKET jika harga sudah di zona dan CHoCH M1 terkonfirmasi.
// SL di bawah awal impuls (buy) / di atas awal impuls (sell). Invalid jika harga menembus awal impuls.
// ════════════════════════════════════════════════════════════════
function aggDoc(c, n) {
  const out = [];
  for (let i = 0; i + n <= c.length; i += n) {
    const g = c.slice(i, i + n);
    out.push({ time: g[0].time, open: g[0].open, high: Math.max(...g.map(x => x.high)), low: Math.min(...g.map(x => x.low)), close: g[g.length - 1].close });
  }
  return out;
}

function unfilledFvgs(c, side, from) {
  const out = [];
  for (let i = Math.max(2, from); i < c.length; i++) {
    const a = c[i - 2], b = c[i];
    let bottom, top;
    if (side === 'buy' && a.high < b.low) { bottom = a.high; top = b.low; }
    else if (side === 'sell' && a.low > b.high) { bottom = b.high; top = a.low; }
    else continue;
    let filled = false;
    for (let j = i + 1; j < c.length; j++) {
      if (side === 'buy' ? c[j].low <= bottom : c[j].high >= top) { filled = true; break; }
    }
    if (!filled) out.push({ bottom, top, kind: 'FVG' });
  }
  return out;
}

// Dua kandidat kaki impuls M5 searah:
//  A) BOS terbaru (impuls besar)
//  B) kaki kecil: ekstrem terbaru dalam 30 candle M5 lalu ekstrem berlawanan sesudahnya (retrace dekat harga)
function legsForSide(c5, side, s5, n5) {
  const legs = [];
  const bT = side === 'buy' ? 'BOS_BULL' : 'BOS_BEAR';
  const imp = lastOf(s5.events.filter(e => e.type === bT && e.anchor && n5 - e.k <= CFG.bosMaxAge));
  if (imp && !s5.events.some(e => e.k > imp.k && e.side !== side)) {
    if (side === 'buy') {
      const awal = imp.anchor.lowIdx;
      let hi = -Infinity, ek = awal;
      for (let j = awal; j < c5.length; j++) if (c5[j].high > hi) { hi = c5[j].high; ek = j; }
      legs.push({ tag: 'BOS', lo: imp.anchor.low, hi, awalIdx: awal, ekIdx: ek });
    } else {
      const awal = imp.anchor.highIdx;
      let lo = Infinity, ek = awal;
      for (let j = awal; j < c5.length; j++) if (c5[j].low < lo) { lo = c5[j].low; ek = j; }
      legs.push({ tag: 'BOS', lo, hi: imp.anchor.high, awalIdx: awal, ekIdx: ek });
    }
  }
  // kaki kecil 30 candle terakhir
  const from = Math.max(0, c5.length - 30);
  if (side === 'buy') {
    let lo = Infinity, loIdx = -1;
    for (let j = from; j < c5.length; j++) if (c5[j].low < lo) { lo = c5[j].low; loIdx = j; }
    let hi = -Infinity, hiIdx = loIdx;
    for (let j = loIdx; j < c5.length; j++) if (c5[j].high > hi) { hi = c5[j].high; hiIdx = j; }
    if (loIdx >= 0 && hiIdx > loIdx) legs.push({ tag: 'MINOR', lo, hi, awalIdx: loIdx, ekIdx: hiIdx });
  } else {
    let hi = -Infinity, hiIdx = -1;
    for (let j = from; j < c5.length; j++) if (c5[j].high > hi) { hi = c5[j].high; hiIdx = j; }
    let lo = Infinity, loIdx = hiIdx;
    for (let j = hiIdx; j < c5.length; j++) if (c5[j].low < lo) { lo = c5[j].low; loIdx = j; }
    if (hiIdx >= 0 && loIdx > hiIdx) legs.push({ tag: 'MINOR', lo, hi, awalIdx: hiIdx, ekIdx: loIdx });
  }
  return legs;
}

export function pullbackPlan(bars, ctx) {
  const { price: px, dec, pip, now, symbol } = ctx;
  const R = v => Number(Number(v).toFixed(dec));
  const checks = [];
  const fail = (reason, extra = {}) => ({ ok: false, reason, checks, bias: 'NETRAL', regime: 'choppy', regimeSrc: '-', ...extra });

  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5), h1 = toDoc(bars.h1), m15 = toDoc(bars.m15);
  if (c1.length < 30 || c5.length < 30 || h1.length < 20) return fail('Data M1/M5/H1 belum cukup.');
  const c3 = aggDoc(c1, 3);
  const atr5 = atr(c5), atr1 = atr(c1);
  if (!(atr5 > 0) || !(atr1 > 0)) return fail('ATR belum bisa dihitung.');

  // 1) H1 searah, M15 tidak berlawanan
  const th = structure(h1).trend;
  const tm = m15.length >= 30 ? structure(m15).trend : 0;
  if (th === 0) return fail('H1 belum searah.');
  if (tm !== 0 && tm !== th) return fail('M15 berlawanan dengan H1.');
  const side = th === 1 ? 'buy' : 'sell';
  const bias = side === 'buy' ? 'bullish' : 'bearish';
  const regime = side === 'buy' ? 'trending_up' : 'trending_down';
  const regimeSrc = `H1 MS${tm === th ? ' + M15 searah' : ''} · PULLBACK`;
  checks.push(`OK: H1 ${bias}${tm === th ? ' dan M15 searah' : ''}.`);

  // 2) Dealing range
  const rng = dealingRange(m15.length >= 30 ? m15 : h1, m15.length >= 30 ? 'M15' : 'H1');

  // 3) Coba setiap kaki impuls; pakai yang pertama valid
  const s5 = structure(c5);
  const legs = legsForSide(c5, side, s5, c5.length - 1);
  if (!legs.length) return fail('belum ada impuls M5 searah (BOS terbaru atau kaki kecil).', { checks, bias, regime, regimeSrc });

  let lastReason = 'tidak ada kaki impuls yang valid.';
  for (const leg of legs) {
    const { lo, hi, awalIdx, ekIdx, tag } = leg;
    const L = hi - lo;
    if (!(L >= atr5)) { lastReason = `kaki ${tag} terlalu kecil (kurang dari 1 ATR).`; continue; }
    if (side === 'buy' ? px < lo : px > hi) { lastReason = `kaki ${tag} sudah tertembus harga.`; continue; }
    const depth = side === 'buy' ? (hi - px) / L : (px - lo) / L;
    if (depth > 0.886) { lastReason = `kaki ${tag}: pullback terlalu dalam (lebih dari 0.886).`; continue; }

    const zOte = side === 'buy'
      ? { bottom: hi - L * 0.786, top: hi - L * 0.618 }
      : { bottom: lo + L * 0.618, top: lo + L * 0.786 };
    const oteMid = (zOte.top + zOte.bottom) / 2;
    if (rng && (side === 'buy' ? oteMid > rng.eq : oteMid < rng.eq)) { lastReason = `kaki ${tag}: zona pullback di area berlawanan dealing range.`; continue; }

    // FVG M1/M3/M5 belum terisi di dalam OTE, pilih yang paling dekat mid OTE
    let zone = null;
    for (const [tf, c] of [['M1', c1], ['M3', c3], ['M5', c5]]) {
      const fromIdx = Math.max(0, c.length - (tf === 'M1' ? 60 : 40));
      for (const f of unfilledFvgs(c, side, fromIdx)) {
        if (f.top < zOte.bottom || f.bottom > zOte.top) continue;
        const cand = { tf, bottom: Math.max(f.bottom, zOte.bottom), top: Math.min(f.top, zOte.top), kind: `FVG ${tf}` };
        const d = Math.abs((cand.top + cand.bottom) / 2 - oteMid);
        if (!zone || d < zone.d) zone = { ...cand, d };
      }
    }
    if (!zone) zone = { tf: 'M5', bottom: zOte.bottom, top: zOte.top, kind: 'OTE', d: 0 };

    const mid = R((zone.top + zone.bottom) / 2);
    const above = side === 'buy' ? px > zone.top : px < zone.bottom;
    const below = side === 'buy' ? px < zone.bottom : px > zone.top;
    if (below) { lastReason = `kaki ${tag}: harga lewat zona OTE.`; continue; }
    let ent;
    if (above) ent = { zone, kind: zone.kind, orderType: 'LIMIT', entry: mid, confirmed: false };
    else if (m1Confirm(c1, side)) ent = { zone, kind: zone.kind, orderType: 'MARKET', entry: R(px), confirmed: true };
    else {
      if (side === 'buy' ? mid >= px : mid <= px) { lastReason = `kaki ${tag}: harga di zona, menunggu konfirmasi M1.`; continue; }
      ent = { zone, kind: zone.kind, orderType: 'LIMIT', entry: mid, confirmed: false };
    }
    const dist = Math.abs(ent.entry - px) / pip;
    if (dist > CFG.maxLimitPips) { lastReason = `kaki ${tag}: LIMIT ${R(dist)} pip dari harga, terlalu jauh.`; continue; }

    const anchorObj = side === 'buy' ? { low: lo, high: hi } : { high: hi, low: lo };
    const o = orderFrom(side, { choch: { anchor: anchorObj } }, ent, atr5, pip, dec, symbol);
    if (!o.ok) { lastReason = `kaki ${tag}: ${o.reason}`; continue; }

    checks.push(`OK: impuls ${tag} M5 ${R(lo)}–${R(hi)} (${R(L / pip)} pip).`);
    checks.push(`OK: zona pullback ${zone.kind} ${R(zone.bottom)}–${R(zone.top)}.`);
    checks.push(ent.confirmed ? 'OK: konfirmasi M1, eksekusi MARKET.' : `OK: LIMIT pullback di ${mid}.`);
    checks.push(`OK: SL ${o.sl}, risiko ${R(o.riskPips)} pip, band ${o.band.name}, TP1 ${o.tps[0]}.`);

    const id = `PB-${side}-${ekIdx}`;
    return {
      ok: true, role: 'pullback', side, confirmed: ent.confirmed, regime, regimeSrc, bias, biasTf: 'H1', checks,
      order: {
        side, role: 'pullback', orderType: ent.orderType,
        entryPrice: o.entry, sl: o.sl, tp1: o.tps[0], tp2: o.tps[1], tp3: o.tps[2],
        risk: R(o.risk), riskPips: R(o.riskPips), rr: o.band.rr, tpMode: o.band.name,
        invalidLevel: o.invalid,
        expiryTime: now + (ent.confirmed ? CFG.marketExpiryMs : CFG.limitExpiryMs),
        zoneId: id, confirmed: ent.confirmed,
        reason: `Pullback · Impuls ${tag} M5 · ${zone.kind} OTE 0.618–0.786 · ${ent.confirmed ? 'konfirmasi M1' : 'LIMIT'}`,
      },
      zone: { id, timeframe: zone.tf, type: `${zone.kind} pullback`, top: R(zone.top), bottom: R(zone.bottom), fresh: true },
    };
  }
  return fail(lastReason, { checks, bias, regime, regimeSrc });
}


// ════════════════════════════════════════════════════════════════
// SCALP STRUKTUR (M15 bias, M5 + M1 zona). Target tetap untuk emas, ATR untuk BTC.
// Selalu mencari entry jika struktur searah berjalan. Zona yang sudah termitigasi diabaikan,
// hanya zona fresh di 60 candle terakhir M5/M1 dan FVG yang belum terisi.
// Jika tidak ada zona, pakai retrace 0.5–0.618 dari kaki impuls M5 terakhir.
// ════════════════════════════════════════════════════════════════
const SCALP_GOLD = { tpPips: [30, 45, 60] };                 // XAUUSD: TP 30 / 45 / 60 pip
const SCALP_ATR = { tpAtr: [1.5, 2.5, 4] };                  // BTC dan simbol lain: kelipatan ATR M5

export function scalpStructPlan(bars, ctx) {
  const { price: px, dec, pip, now, symbol } = ctx;
  const R = v => Number(Number(v).toFixed(dec));
  const checks = [];
  const fail = reason => ({ ok: false, reason, checks, bias: 'NETRAL', regime: 'choppy', regimeSrc: '-' });

  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5), m15 = toDoc(bars.m15);
  if (c1.length < 30 || c5.length < 30) return fail('Data M1/M5 belum cukup.');
  const atr5 = atr(c5), atr1 = atr(c1);
  if (!(atr5 > 0) || !(atr1 > 0)) return fail('ATR belum bisa dihitung.');
  const isGold = symbol === 'XAUUSD' || symbol === 'XAUUSDX';
  const tp1Dist = isGold ? SCALP_GOLD.tpPips[0] * pip : SCALP_ATR.tpAtr[0] * atr5;

  // 1) Arah FLEKSIBEL: BOS M1 searah (40 candle) didahulukan; jika tidak ada, pakai BOS M5 (40 candle M5).
  //    Zona entry tetap dicari dari M1 dan M5 pada langkah berikutnya.
  const s1 = structure(c1, CFG.m1SwingLen);
  const n1 = c1.length - 1;
  const s5 = structure(c5);
  const n5 = c5.length - 1;
  const lastOfSide = (s, n, side) => {
    const types = side === 'buy' ? ['BOS_BULL', 'CHoCH_BULL'] : ['BOS_BEAR', 'CHoCH_BEAR'];
    return lastOf(s.events.filter(e => types.includes(e.type) && n - e.k <= 40));
  };
  const hasBos = (s, n, side) => lastOf(s.events.filter(e => e.type === (side === 'buy' ? 'BOS_BULL' : 'BOS_BEAR') && n - e.k <= 40));
  const lastM1 = lastOf(s1.events.filter(e => n1 - e.k <= 40));
  const lastM5 = lastOf(s5.events.filter(e => n5 - e.k <= 40));
  let side = null, tf = null, cL = null, sL = null, nL = 0, bos = null, lastEv = null;
  if (lastM1 && hasBos(s1, n1, lastM1.side)) { side = lastM1.side; tf = 'M1'; cL = c1; sL = s1; nL = n1; lastEv = lastM1; }
  else if (lastM5 && hasBos(s5, n5, lastM5.side)) { side = lastM5.side; tf = 'M5'; cL = c5; sL = s5; nL = n5; lastEv = lastM5; }
  if (!side && ctx.force) {
    // Mode force: tanpa BOS, arah dari kemiringan 20 candle M1 terakhir
    const seg = c1.slice(-20);
    const slope = seg[seg.length - 1].close - seg[0].close;
    side = slope >= 0 ? 'buy' : 'sell';
    tf = 'M1'; cL = c1; sL = s1; nL = n1;
    lastEv = { type: 'FORCE_MOMENTUM', k: n1 };
    checks.push('INFO: tidak ada BOS, arah dari momentum 20 candle M1 (mode wajib sinyal).');
  }
  if (!side) return fail('belum ada BOS M1 atau M5 searah dalam 40 candle.');
  const bias = side === 'buy' ? 'bullish' : 'bearish';
  const biasTf = tf;
  const regime = side === 'buy' ? 'trending_up' : 'trending_down';
  const regimeSrc = `${tf} ${lastEv.type} · SCALP`;
  bos = hasBos(sL, nL, side) || { k: nL };
  checks.push(`OK: struktur ${tf} berjalan ${lastEv.type} ${nL - lastEv.k} candle lalu, arah ${bias}.`);
  checks.push(`OK: BOS ${tf} ${bias} ${nL - bos.k} candle lalu.`);
  if (m15.length >= 30) {
    const t15 = structure(m15).trend;
    if (t15 !== 0) checks.push(`INFO: M15 ${t15 === (side === 'buy' ? 1 : -1) ? 'searah' : 'berlawanan (konteks)'}.`);
  }

  // 3) Zona fresh M5/M1 di sisi pullback + FVG belum terisi (semua dibatasi jarak)
  const maxDist = isGold ? 40 * pip : 1.5 * atr5;
  const wantType = side === 'buy' ? 'demand' : 'supply';
  const onPullSide = (top, bottom) => (side === 'buy' ? top <= px : bottom >= px);
  const distOf = (top, bottom) => (side === 'buy' ? px - top : bottom - px);
  const cands = [];
  for (const [tf, c] of [['M5', c5], ['M1', c1]]) {
    for (const z of sdZones(c, tf)) {
      if (z.type !== wantType || c.length - 1 - z.idx > 60) continue;
      if (!onPullSide(z.top, z.bottom)) continue;
      const d = Math.max(0, distOf(z.top, z.bottom));
      if (d > maxDist) continue;
      cands.push({ top: z.top, bottom: z.bottom, tf, kind: `${wantType === 'demand' ? 'Demand' : 'Supply'} ${z.pattern}`, fresh: z.fresh, d, strength: z.strength });
    }
    for (const f of unfilledFvgs(c, side, c.length - 40)) {
      if (!onPullSide(f.top, f.bottom)) continue;
      const d = Math.max(0, distOf(f.top, f.bottom));
      if (d > maxDist) continue;
      const ca = atr(c) || 1;
      cands.push({ top: f.top, bottom: f.bottom, tf, kind: `FVG ${tf}`, fresh: true, d, strength: (f.top - f.bottom) / ca });
    }
  }
  const scoreOf = z => (z.fresh ? 2 : 0) + Math.min(z.strength || 0, 3) + (z.tf === 'M5' ? 0.5 : 0) - (z.d / maxDist);
  cands.sort((a, b) => scoreOf(b) - scoreOf(a));

  // Cadangan: retrace 0.5–0.618 dari kaki impuls M5 yang berjalan (kaki harus dekat harga)
  const legs = legsForSide(cL, side, sL, nL);
  for (const leg of legs) {
    const L = leg.hi - leg.lo;
    if (!(L >= atr1 * 2)) continue;
    const top = side === 'buy' ? leg.hi - L * 0.5 : leg.lo + L * 0.618;
    const bottom = side === 'buy' ? leg.hi - L * 0.618 : leg.lo + L * 0.5;
    const d = distOf(top, bottom);
    if (d > maxDist || !onPullSide(top, bottom)) continue;   // batas jarak juga berlaku untuk cadangan
    cands.push({ top, bottom, tf, kind: `OTE 0.5–0.618 (${leg.tag})`, fresh: true, d: Math.max(0, d), strength: 1 });
    break;
  }
  // Mode force (manual wajib sinyal): jika tidak ada zona/kaki, pakai retrace 0.5 dari range 40 candle M1
  if (!cands.length && ctx.force) {
    const rr40 = c1.slice(-40);
    const hiR = Math.max(...rr40.map(x => x.high)), loR = Math.min(...rr40.map(x => x.low));
    let lvl = side === 'buy' ? loR + (hiR - loR) * 0.5 : hiR - (hiR - loR) * 0.5;
    const fb = Math.max(atr1 * 0.2, pip);
    // level harus berada di sisi pullback (buy di bawah harga, sell di atas harga)
    const lvlSide = side === 'buy' ? (lvl >= px ? px - fb : lvl) : (lvl <= px ? px + fb : lvl);
    lvl = lvlSide;
    const top = side === 'buy' ? lvl + fb : lvl + fb;
    const bottom = side === 'buy' ? lvl - fb : lvl - fb;
    cands.push({ top, bottom, tf: 'M1', kind: 'Retrace 0.5 (force)', fresh: true, d: Math.abs(lvl - px), strength: 0 });
    checks.push('INFO: tidak ada zona dalam jarak, memakai retrace 0.5 range M1 40 candle.');
  }
  if (!cands.length) return fail(`belum ada zona ${wantType === 'demand' ? 'demand' : 'supply'} atau FVG fresh dalam ${R(maxDist / pip)} pip dari harga.`, { checks, bias, regime, regimeSrc });

  // 4) Pilih zona pertama yang valid untuk entry, SL, dan TP
  const buf = 0.3 * atr1;
  // Swing struktur M1 terakhir (12 candle): SL di luarnya, invalidasi di level swing
  const rec = c1.slice(-12);
  const swHi = Math.max(...rec.map(x => x.high));
  const swLo = Math.min(...rec.map(x => x.low));
  // ── PENGAMAN CANDLE BERJALAN ──
  // Struktur dihitung dari candle tertutup, jadi candle M1 yang sedang bergerak belum terlihat.
  // Jika candle berjalan sudah menembus swing melawan arah, atau bergerak kuat melawan arah,
  // jangan pasang limit sekarang (ini penyebab entry langsung kena SL).
  const live = bars.live || null;
  if (live && live.h > 0 && live.l > 0) {
    const last3 = c1.slice(-3);
    if (side === 'sell' && live.h > swHi) return fail('candle M1 berjalan menembus swing high, sell ditunda.', { checks, bias, regime, regimeSrc });
    if (side === 'buy' && live.l < swLo) return fail('candle M1 berjalan menembus swing low, buy ditunda.', { checks, bias, regime, regimeSrc });
    const lo3 = Math.min(...last3.map(x => x.low), live.l);
    const hi3 = Math.max(...last3.map(x => x.high), live.h);
    if (side === 'sell' && live.c - lo3 > 1.2 * atr1) return fail('momentum M1 naik kuat melawan sell, menunggu koreksi selesai.', { checks, bias, regime, regimeSrc });
    if (side === 'buy' && hi3 - live.c > 1.2 * atr1) return fail('momentum M1 turun kuat melawan buy, menunggu koreksi selesai.', { checks, bias, regime, regimeSrc });
    checks.push('OK: candle M1 berjalan tidak menembus struktur dan tidak melawan momentum.');
  }
  const minRisk = isGold ? 25 * pip : 0.5 * tp1Dist;
  const maxRisk = tp1Dist;   // RR TP1 minimal 1:1
  for (const z of cands) {
    const mid = R((z.top + z.bottom) / 2);
    const beyond = side === 'buy' ? px < z.bottom : px > z.top;
    if (beyond) { checks.push(`BELUM: ${z.kind} sudah tembus.`); continue; }
    const inside = side === 'buy' ? px <= z.top : px >= z.bottom;
    let orderType, entry, confirmed = false;
    if (inside) {
      if (m1Confirm(c1, side)) { orderType = 'MARKET'; entry = R(px); confirmed = true; }
      else {
        if (side === 'buy' ? mid >= px : mid <= px) { checks.push(`BELUM: ${z.kind} menunggu konfirmasi M1.`); continue; }
        orderType = 'LIMIT'; entry = mid;
      }
    } else { orderType = 'LIMIT'; entry = mid; }
    if (!ctx.force && Math.abs(entry - px) > maxDist * 1.5) { checks.push(`BELUM: ${z.kind} entry terlalu jauh dari harga.`); continue; }

    const dir = side === 'buy' ? 1 : -1;
    let sl = R(side === 'buy' ? Math.min(z.bottom, swLo) - buf : Math.max(z.top, swHi) + buf);
    let risk = Math.abs(entry - sl);
    if (risk > maxRisk) {
      if (!ctx.force) { checks.push(`BELUM: ${z.kind} SL ${R(risk / pip)} pip melebihi batas.`); continue; }
      sl = R(side === 'buy' ? entry - maxRisk : entry + maxRisk);   // mode force: SL dipotong ke batas
      risk = maxRisk;
    }
    if (risk < minRisk) {
      // SL tetap di luar struktur; jika terlalu dekat, geser lebih jauh (bukan dihitung dari entry saja)
      sl = R(side === 'buy' ? Math.min(sl, entry - minRisk) : Math.max(sl, entry + minRisk));
      risk = Math.abs(entry - sl);
    }
    if (side === 'buy' ? sl >= entry : sl <= entry) continue;

    const tps = isGold
      ? SCALP_GOLD.tpPips.map(p => R(entry + dir * p * pip))
      : SCALP_ATR.tpAtr.map(m => R(entry + dir * m * atr5));
    const rr = Math.abs(tps[0] - entry) / risk;
    checks.push(`OK: ${z.kind} ${z.tf} ${R(z.bottom)}–${R(z.top)}, ${orderType} ${entry}, SL ${sl}.`);
    checks.push(`OK: risiko ${R(risk / pip)} pip, TP1 ${tps[0]}, RR 1:${R(rr)}.`);

    const id = `SC-${side}-${z.tf}-${R(mid)}`;
    return {
      ok: true, role: 'scalp', side, confirmed, regime, regimeSrc, bias, biasTf, checks,
      order: {
        side, role: 'scalp', orderType, entryPrice: entry, sl,
        tp1: tps[0], tp2: tps[1], tp3: tps[2],
        risk: R(risk), riskPips: R(risk / pip), rr: R(rr), tpMode: isGold ? 'SCALP_PIP' : 'SCALP_ATR',
        invalidLevel: R(side === 'buy' ? Math.min(z.bottom, swLo) : Math.max(z.top, swHi)),
        expiryTime: now + (confirmed ? CFG.marketExpiryMs : CFG.limitExpiryMs),
        zoneId: id, confirmed,
        reason: `Scalp · ${tf} ${lastEv.type} · BOS ${tf} · ${z.kind} ${z.tf} · ${confirmed ? 'MARKET konfirmasi M1' : 'LIMIT'}`,
      },
      zone: { id, timeframe: z.tf, type: z.kind, top: R(z.top), bottom: R(z.bottom), fresh: z.fresh },
    };
  }
  return fail('zona entry belum memenuhi aturan jarak, SL, atau TP, menunggu harga kembali ke zona.', { checks, bias, regime, regimeSrc });
}

// ════════════════════════════════════════════════════════════════
// WATCHLIST SCALPING: zona M1 dan M5 saja, dalam batas jarak yang sama dengan engine.
// Dipakai untuk tampilan dan cerita AI (menggantikan buildWatchlist H1 untuk Scalping).
// ════════════════════════════════════════════════════════════════
export function scalpWatch(bars, ctx) {
  const { price: px, pip, dec, symbol } = ctx;
  const isGold = symbol === 'XAUUSD' || symbol === 'XAUUSDX';
  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5);
  const out = [];
  const step = Number(pip) > 0 ? Number(pip) : 0.1;
  for (const [tf, c] of [['M1', c1], ['M5', c5]]) {
    if (c.length < 25) continue;
    const a = atr(c) || 1;
    const maxDist = isGold ? 40 * step : 1.5 * a;
    for (const z of sdZones(c, tf)) {
      const dist = px > z.top ? px - z.top : px < z.bottom ? z.bottom - px : 0;
      if (dist > maxDist) continue;
      out.push({
        tf,
        tipe: `${z.type === 'supply' ? 'SELL (Supply' : 'BUY (Demand'} ${z.pattern})`,
        bawah: Number(Number(z.bottom).toFixed(dec)), atas: Number(Number(z.top).toFixed(dec)),
        jarak_pip: Math.round(dist / step), di_dalam: dist === 0,
        status: z.fresh ? 'fresh' : 'termitigasi sebagian',
      });
    }
  }
  out.sort((x, y) => (x.status === y.status ? x.jarak_pip - y.jarak_pip : x.status === 'fresh' ? -1 : 1));
  return out.slice(0, 4);
}


// ════════════════════════════════════════════════════════════════
// SCALP SIMPLE (manual): zona fresh M5 (opsional M1).
//   demand (atau FVG bullish) di bawah harga  -> BUY LIMIT
//   supply (atau FVG bearish) di atas harga   -> SELL LIMIT
//   harga di dalam zona + CHoCH M1            -> MARKET
// REFINE: zona M5 dipersempit ke zona M1 (S&D fresh / FVG belum terisi) di dalamnya.
//   Entry LIMIT di tengah zona M1; jika tidak ada zona M1, entry di tengah zona M5.
// SL emas: tetap 30-50 pip (dihitung dari tepi jauh zona M1 + buffer, lalu di-clamp).
// Invalidasi: tepi jauh zona M5 (limit dibatalkan bila harga menembusnya sebelum terisi).
// TP: 1R, 1.5R, 2R dari risiko ke SL.
// ════════════════════════════════════════════════════════════════
const GOLD_SL_MIN_PIPS = 30;
const GOLD_SL_MAX_PIPS = 50;
const SIMPLE_GOLD_MAX_PIPS = Infinity;   // tanpa batas jarak: selalu pakai zona fresh terdekat

// Cari zona M1 (S&D fresh atau FVG belum terisi) di dalam zona M5, di sisi pullback harga
function refineToM1(c1, z, side, px) {
  const want = side === 'buy' ? 'demand' : 'supply';
  const found = [];
  for (const s of sdZones(c1, 'M1')) {
    if (s.type !== want || !s.fresh) continue;
    if (s.top < z.bottom || s.bottom > z.top) continue;
    found.push({ top: Math.min(s.top, z.top), bottom: Math.max(s.bottom, z.bottom), kind: `${want} M1` });
  }
  for (const f of unfilledFvgs(c1, side, c1.length - 60)) {
    if (f.top < z.bottom || f.bottom > z.top) continue;
    found.push({ top: Math.min(f.top, z.top), bottom: Math.max(f.bottom, z.bottom), kind: 'FVG M1' });
  }
  const onSide = found.filter(r => r.top > r.bottom && (side === 'buy' ? r.top <= px : r.bottom >= px));
  onSide.sort((a, b) => Math.abs((a.top + a.bottom) / 2 - px) - Math.abs((b.top + b.bottom) / 2 - px));
  return onSide[0] || null;
}

export function simpleZonePlan(bars, ctx, opts = {}) {
  const { price: px, dec, pip, now, symbol } = ctx;
  const tfs = opts.tfs || ['M5', 'M1'];
  const botMode = !!opts.bot;
  const twoWay = !botMode && opts.twoWay !== false;   // manual: BUY area + SELL area (OCO)
  const R = v => Number(Number(v).toFixed(dec));
  const isGold = symbol === 'XAUUSD' || symbol === 'XAUUSDX';
  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5);
  const checks = [];
  const fail = reason => ({ ok: false, reason, checks, bias: 'NETRAL', regime: 'choppy', regimeSrc: '-' });
  if (c1.length < 30 || c5.length < 30) return fail('Data M1/M5 belum cukup.');
  const atr5 = atr(c5), atr1 = atr(c1);
  if (!(atr5 > 0) || !(atr1 > 0)) return fail('ATR belum bisa dihitung.');

  // 1) Kumpulkan zona fresh M5 dan M1 (S&D dan FVG belum terisi), 60 candle terakhir
  const zones = [];
  for (const [tf, c] of [['M5', c5], ['M1', c1]].filter(([t]) => tfs.includes(t))) {
    for (const z of sdZones(c, tf)) {
      if (c.length - 1 - z.idx > 60 || !z.fresh) continue;
      zones.push({ top: z.top, bottom: z.bottom, side: z.type === 'demand' ? 'buy' : 'sell', tf, kind: `${z.type} ${z.pattern}` });
    }
    for (const f of unfilledFvgs(c, 'buy', c.length - 40)) zones.push({ top: f.top, bottom: f.bottom, side: 'buy', tf, kind: `FVG bullish ${tf}` });
    for (const f of unfilledFvgs(c, 'sell', c.length - 40)) zones.push({ top: f.top, bottom: f.bottom, side: 'sell', tf, kind: `FVG bearish ${tf}` });
  }
  if (!zones.length) return fail('belum ada zona fresh di M5 atau M1.');

  // 2) Zona yang masih bisa dimasuki (demand di bawah harga atau supply di atas harga, atau harga di dalamnya), terdekat dulu
  const dist = z => (px > z.top ? px - z.top : px < z.bottom ? z.bottom - px : 0);
  const usable = zones.filter(z => (z.side === 'buy' ? px >= z.bottom : px <= z.top));
  usable.sort((a, b) => dist(a) - dist(b) || (a.tf === 'M5' ? -1 : 1));
  if (!usable.length) return fail('harga sudah menembus semua zona fresh.');

  checks.push(`INFO: zona terdekat ${usable[0].tf} ${usable[0].kind} ${R(usable[0].bottom)}–${R(usable[0].top)}, jarak ${Math.round(dist(usable[0]) / pip)} pip dari harga.`);
  const maxPips = isGold ? (opts.maxPips || SIMPLE_GOLD_MAX_PIPS) : null;

  // Bangun satu leg (entry, SL, TP, invalidasi) dari satu zona. limitOnly: paksa LIMIT (untuk leg kedua OCO).
  const makeLeg = (z, limitOnly = false) => {
    const side = z.side;
    const dir = side === 'buy' ? 1 : -1;
    const inside = px >= z.bottom && px <= z.top;
    const mid = R((z.top + z.bottom) / 2);
    let orderType, entry, rf = null;
    if (botMode) {
      // Validasi M1 untuk bot: zona M5 tersentuh 10 candle M1 terakhir, ada struktur M1 searah 15 candle,
      // dan candle M1 terakhir searah (tanpa syarat body kuat)
      const recent = c1.slice(-10);
      const touched = recent.some(x => x.high >= z.bottom && x.low <= z.top);
      const m1s = structure(c1, CFG.m1SwingLen);
      const wantEv = side === 'buy' ? ['BOS_BULL', 'CHoCH_BULL'] : ['BOS_BEAR', 'CHoCH_BEAR'];
      const m1ev = lastOf(m1s.events.filter(e => wantEv.includes(e.type) && c1.length - 1 - e.k <= 15));
      const lastC = c1[c1.length - 1];
      const dirOk = side === 'buy' ? lastC.close > lastC.open : lastC.close < lastC.open;
      if (!(touched && m1ev && dirOk)) { checks.push(`BELUM: ${z.kind} ${z.tf}, menunggu validasi M1 (sentuh zona, struktur searah, candle searah).`); return null; }
      orderType = 'MARKET'; entry = R(px);
    } else if (!limitOnly && inside && m1Confirm(c1, side)) { orderType = 'MARKET'; entry = R(px); }   // MARKET hanya dengan CHoCH M1
    else {
      orderType = 'LIMIT';
      // Refine: zona M5 dipersempit ke zona M1 di dalamnya
      rf = z.tf === 'M5' ? refineToM1(c1, z, side, px) : null;
      if (rf) entry = R((rf.top + rf.bottom) / 2);
      else if (side === 'buy') entry = mid < px ? mid : R(z.bottom);
      else entry = mid > px ? mid : R(z.top);
    }
    if (maxPips && Math.abs(entry - px) / pip > maxPips) { checks.push(`BELUM: ${z.kind} lebih dari ${maxPips} pip.`); return null; }

    // SL dari tepi jauh zona (M1 hasil refine jika ada, jika tidak zona itu sendiri)
    const base = rf || z;
    const buf = 0.2 * atr1;
    let sl = R(side === 'buy' ? base.bottom - buf : base.top + buf);
    let risk = Math.abs(entry - sl);
    if (isGold && !botMode) {
      risk = Math.min(Math.max(risk, GOLD_SL_MIN_PIPS * pip), GOLD_SL_MAX_PIPS * pip);   // clamp 30-50 pip
      sl = R(side === 'buy' ? entry - risk : entry + risk);
      risk = Math.abs(entry - sl);
    } else {
      const minRisk = isGold ? 25 * pip : 0.5 * atr5;
      if (risk < minRisk) { sl = R(side === 'buy' ? entry - minRisk : entry + minRisk); risk = Math.abs(entry - sl); }
    }
    if (side === 'buy' ? sl >= entry : sl <= entry) return null;

    const tps = [1, 1.5, 2].map(m => R(entry + dir * risk * m));   // TP: 1R, 1.5R, 2R
    const invalid = R(side === 'buy' ? z.bottom : z.top);          // tepi jauh zona M5
    const id = `SZ-${side}-${z.tf}-${mid}`;
    return { z, rf, side, orderType, entry, sl, risk, tps, invalid, id };
  };

  const orderOf = L => ({
    side: L.side, role: 'zone', orderType: L.orderType, entryPrice: L.entry, sl: L.sl,
    tp1: L.tps[0], tp2: L.tps[1], tp3: L.tps[2],
    risk: R(L.risk), riskPips: R(L.risk / pip), rr: 1, tpMode: 'RISK_R',
    invalidLevel: L.invalid, expiryTime: now + (L.orderType === 'MARKET' ? CFG.marketExpiryMs : CFG.limitExpiryMs),
    zoneId: L.id, confirmed: L.orderType === 'MARKET',
    reason: `Zona ${L.z.tf} · ${L.z.kind}${L.rf ? ` · refine ${L.rf.kind}` : ''} · ${L.orderType === 'MARKET' ? 'MARKET (harga di zona)' : L.rf ? 'LIMIT di zona M1' : 'LIMIT di tengah zona'}`,
  });
  const legText = L => `${L.side === 'buy' ? 'BUY' : 'SELL'} ${L.orderType} ${L.entry} (zona ${L.z.tf} ${R(L.z.bottom)}–${R(L.z.top)}), SL ${L.sl}, TP1 ${L.tps[0]}`;

  // 3) Leg utama = zona terdekat yang valid
  let primary = null;
  for (const z of usable.slice(0, 5)) {
    const L = makeLeg(z);
    if (L) { primary = L; break; }
  }
  if (!primary) return fail('zona fresh ada tetapi tidak memenuhi jarak.');

  // 4) Dua arah: leg kedua di zona berlawanan terdekat (OCO: satu terisi, yang lain dibatalkan)
  let oco = null;
  if (twoWay && primary.orderType === 'LIMIT') {
    for (const oz of usable.filter(u => u.side !== primary.side).slice(0, 5)) {
      const opp = makeLeg(oz, true);
      if (!opp || opp.orderType !== 'LIMIT') continue;
      const sidesOk = primary.side === 'buy' ? (primary.entry < px && opp.entry > px) : (primary.entry > px && opp.entry < px);
      if (!sidesOk) continue;
      oco = {
        rule: 'OCO: BUY area dan SELL area dipasang bersamaan. Jika salah satu terisi, yang lain dibatalkan.',
        legs: [orderOf(primary), orderOf(opp)],
      };
      checks.push(`OK: dua arah OCO. Leg 1 ${legText(primary)}.`);
      checks.push(`OK: Leg 2 ${legText(opp)}.`);
      break;
    }
    if (!oco) checks.push('INFO: zona berlawanan belum ada yang valid, hanya satu arah.');
  }
  if (!oco) checks.push(`OK: ${legText(primary)}.`);

  const z = primary.z;
  return {
    ok: true, role: 'zone', side: primary.side, confirmed: primary.orderType === 'MARKET',
    regime: primary.side === 'buy' ? 'trending_up' : 'trending_down',
    regimeSrc: `${z.tf} ${z.kind}`, bias: oco ? 'dua arah (buy area + sell area)' : (primary.side === 'buy' ? 'bullish' : 'bearish'), biasTf: z.tf, checks,
    order: orderOf(primary),
    ...(oco ? { oco } : {}),
    zone: { id: primary.id, timeframe: z.tf, type: z.kind, top: R(z.top), bottom: R(z.bottom), fresh: true },
  };
}

// Bot: zona M5 saja, eksekusi MARKET langsung saat harga di zona dan CHoCH M1 terkonfirmasi.
export function botZonePlan(bars, ctx) {
  return simpleZonePlan(bars, ctx, { tfs: ['M5'], bot: true });
}
