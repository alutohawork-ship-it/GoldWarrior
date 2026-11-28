import { checkAccess, markTrialBotUsed } from './access.js';
import { planBot } from './bot-ict.js';
import { runBotSma } from './bot_3candle.js';
import { sessionOf, asianRange, asianSweep, sessionScore, volatilityRegime } from './session.js';
import { findPools, sweepVsBreak, doubleSweep, nearestDraw, slBeyondPool } from './liquidity.js';
import { resolveBias, counterGuard, adjustConviction, counterExpiry, nearestWall } from './framework-manual.js';
import { atrSanity, calcSL } from './risk-atr.js';
import { TP_PLAN, planTPs, repairTPs, coupleZone, buildChart } from './tp-final.js';
import { SCENARIOS, detectScenario, decideOrderType, cancelTolerance } from './scenarios.js';
import { buildReason } from './reason.js';
import { monitorLTFStructure, calculatePreciseSL, LTF_TF } from './ltf-dynamic.js';
import { renderSignalChart } from './chart-render.js';
import { ttBars } from './tt.js';
import { aiVision } from './ai.js';

const VERSION = 'v221-tt';
const HYBRID = process.env.HYBRID_VISION !== '0';
const VIS_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';
const VIS_KEY = process.env.OPENAI_API_KEY || '';

const DEC = { XAUUSD: 2, XAGUSD: 3, BTCUSD: 2, ETHUSD: 2, SOLUSD: 2, XRPUSD: 4, BNBUSD: 2, DXY: 2, US30: 2, NAS100: 2, SPX500: 2, GER40: 2, UK100: 2, JPN225: 0, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5, USDCHF: 5, NZDUSD: 5 };
const PIP = { XAUUSD: 0.1, BTCUSD: 1, DXY: 0.01, US30: 1, NAS100: 1 };
const PIP_DISPLAY = { BTCUSD: 0.1 };
const pipOf = (s, d) => PIP[s] ?? Math.pow(10, -(d - 1));
const pipScaleOf = s => PIP_DISPLAY[s] ?? 1;
const isGold = s => s === 'XAUUSD' || s === 'XAUUSDX';

const TFMS = { m1: 6e4, m5: 3e5, m15: 9e5, m30: 18e5, h1: 36e5, h4: 144e5, d1: 864e5 };
const TFIV = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' };

const TF_ROLE = {
  Scalping: { htf: 'm15', mtf: 'm5', ltf: 'm1' },
  Intraday: { htf: 'h4', mtf: 'm30', ltf: 'm5' },
  Swing: { htf: 'd1', mtf: 'h4', ltf: 'h1' },
};

const SL_REF = {
  Scalping: { atrTf: 'm1', swingTf: 'm5', win: 10 },
  Intraday: { atrTf: 'm30', swingTf: 'm30', win: 8 },
  Swing: { atrTf: 'h4', swingTf: 'h4', win: 8 },
};

const NEED = {
  Scalping: ['m1', 'm5', 'm15'],
  Intraday: ['m5', 'm30', 'h4'],
  Swing: ['h1', 'h4', 'd1'],
};

const MINB = { m1: 80, m5: 50, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };
const EXPMS = { Scalping: 30 * 6e4, Intraday: 480 * 6e4, Swing: 5760 * 6e4 };
const PROX = { Scalping: 50, Intraday: 80, Swing: 200 };
const MIN_ZONE_WIDTH = { Scalping: 20, Intraday: 20, Swing: 30 };
const RULES = {
  Scalping: { gMin: 30, gMax: 80, bMin: 0.004, bMax: 0.010 },
  Intraday: { gMin: 50, gMax: 150, bMin: 0.005, bMax: 0.014 },
  Swing: { gMin: 100, gMax: 350, bMin: 0.01, bMax: 0.025 },
};

const TP_MULT = [1, 1.5, 2.5];

const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = (v, f = 0) => (isNum(v) ? Number(v) : f);
const dw = d => (d === 1 ? 'bullish' : d === -1 ? 'bearish' : 'netral');
const buildTPs = (e, dir, r) => (!(r > 0) || !Number.isFinite(e)) ? [e, e, e] : TP_MULT.map(m => e + dir * r * m);

function normStyle(raw) {
  const k = String(raw || '').toLowerCase();
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday')) return 'Intraday';
  return 'Scalping';
}

async function tlRows(sym, tf, need) {
  try {
    const rows = await ttBars(sym, TFIV[tf], Math.max(need, 200));
    return rows.slice(-need);
  } catch {
    return [];
  }
}

function atr(rows, n = 14) {
  if (!Array.isArray(rows) || rows.length < n + 1) return 0;
  const tr = i => Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr(i);
  a /= n;
  for (let i = n + 1; i < rows.length; i++) a = (a * (n - 1) + tr(i)) / n;
  return a;
}

function internal(rows, lb = 60) {
  const o = { dir: 0, ev: '', fresh: false, displaced: false };
  if (!Array.isArray(rows) || rows.length < 25) return o;
  const a = rows.slice(-lb);
  const n = a.length;
  const at = atr(a) || 1;
  const hs = [], ls = [];
  for (let i = 2; i < n - 2; i++) {
    let ih = true, il = true;
    for (let j = i - 2; j <= i + 2; j++) { if (j === i) continue; if (a[j].h >= a[i].h) ih = false; if (a[j].l <= a[i].l) il = false; }
    if (ih) hs.push([i, a[i].h]);
    if (il) ls.push([i, a[i].l]);
  }
  let tr = 0, ev = '', bi = -1, disp = false, pi = 0, pj = 0;
  for (let i = 4; i < n; i++) {
    while (pi < hs.length && hs[pi][0] < i - 2) pi++;
    while (pj < ls.length && ls[pj][0] < i - 2) pj++;
    const ph = pi > 0 ? hs[pi - 1][1] : null;
    const pl = pj > 0 ? ls[pj - 1][1] : null;
    const c = a[i].c;
    const body = Math.abs(a[i].c - a[i].o);
    if (ph != null && c > ph) { ev = tr === -1 ? 'CHOCH_UP' : 'BOS_UP'; tr = 1; bi = i; disp = body >= 1.2 * at; }
    else if (pl != null && c < pl) { ev = tr === 1 ? 'CHOCH_DOWN' : 'BOS_DOWN'; tr = -1; bi = i; disp = body >= 1.2 * at; }
  }
  o.ev = ev; o.dir = tr; o.fresh = tr !== 0 && bi >= n - 12; o.displaced = disp;
  return o;
}

function gaps(rows, lb = 40) {
  const out = [];
  if (!Array.isArray(rows) || rows.length < 3) return out;
  const a = rows.slice(-lb);
  for (let i = 1; i < a.length - 1; i++) {
    if (a[i - 1].h < a[i + 1].l) out.push({ lo: a[i - 1].h, hi: a[i + 1].l, side: 'demand', kind: 'FVG bull' });
    if (a[i - 1].l > a[i + 1].h) out.push({ lo: a[i + 1].h, hi: a[i - 1].l, side: 'supply', kind: 'FVG bear' });
  }
  return out;
}

function zonesFromRows(rows, tfLabel, ctx, style, lb = 90) {
  if (!Array.isArray(rows) || rows.length < 12) return [];
  const a = rows.slice(-lb);
  const at = atr(a) || ctx.pip * 10;
  const minW = (MIN_ZONE_WIDTH[style] || 20) * ctx.pip;
  const raw = gaps(a, 60).map(g => ({ ...g, tf: tfLabel }));
  for (let i = 1; i < a.length - 1; i++) {
    const nx = a[i + 1];
    if (Math.abs(nx.c - nx.o) < 1.2 * at) continue;
    const up = nx.c > nx.o, pv = a[i];
    if (up && pv.c < pv.o) raw.push({ tf: tfLabel, kind: 'Demand OB', lo: pv.l, hi: pv.h, side: 'demand' });
    if (!up && pv.c > pv.o) raw.push({ tf: tfLabel, kind: 'Supply OB', lo: pv.l, hi: pv.h, side: 'supply' });
  }
  const dist = z => (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi);
  const kept = [];
  for (const z of raw.sort((x, y) => dist(x) - dist(y))) {
    if (!(z.hi > z.lo)) continue;
    if (z.hi - z.lo < minW) continue;
    if ((z.hi - z.lo) / ctx.price > 0.03) continue;
    if (kept.some(k => k.side === z.side && !(z.hi < k.lo || z.lo > k.hi))) continue;
    kept.push(z);
    if (kept.length >= 6) break;
  }
  return kept;
}

function dedupeZones(list) {
  const out = [];
  for (const z of [...list].sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))) {
    if (!(z.hi > z.lo)) continue;
    if (out.some(k => k.side === z.side && !(z.hi < k.lo || z.lo > k.hi))) continue;
    out.push(z);
  }
  return out;
}

function bounds(entry, ctx, style) {
  const r = RULES[style] || RULES.Scalping;
  return isGold(ctx.symbol) ? { min: r.gMin * ctx.pip, max: r.gMax * ctx.pip } : { min: entry * r.bMin, max: entry * r.bMax };
}

function swingLevel(rows, dir, win = 8) {
  if (!Array.isArray(rows) || rows.length < 5) return NaN;
  const n = rows.slice(-Math.min(win, rows.length));
  return dir === 1 ? Math.min(...n.map(c => c.l)) : Math.max(...n.map(c => c.h));
}

function scoreZone(z, ht, it, lt, ctx, style) {
  let score = 0;
  const width = (z.hi - z.lo) / ctx.pip;
  const minW = MIN_ZONE_WIDTH[style] || 20;
  if (width >= minW && width <= minW * 4) score += 25; else if (width >= minW) score += 15; else score += 5;
  const H = TF_ROLE[style].htf.toUpperCase(), M = TF_ROLE[style].mtf.toUpperCase();
  if (z.tf === H) score += 20; else if (z.tf === M) score += 15; else score += 10;
  const dir = z.side === 'demand' ? 1 : -1;
  if (ht.dir === dir) score += 15;
  if (it.dir === dir) score += 10;
  if (lt.dir === dir) score += 5;
  if (it.fresh && it.displaced && it.dir === dir) score += 8;
  if (lt.fresh && lt.dir === dir) score += 5;
  const inside = ctx.price >= z.lo && ctx.price <= z.hi;
  const d = inside ? 0 : (dir === 1 ? ctx.price - z.hi : z.lo - ctx.price) / ctx.pip;
  if (inside) score += 15; else if (d <= 10) score += 12; else if (d <= 20) score += 8; else if (d <= 50) score += 4;
  return { score, width, d, inside };
}

function chooseBestZone(ctx, ht, it, lt, zones, style) {
  const prox = PROX[style] || 50;
  const structDir = ht.dir !== 0 ? ht.dir : (it.dir !== 0 ? it.dir : lt.dir);
  const cand = zones.filter(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const d = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip;
    return inside || d <= prox * 2;
  });
  if (!cand.length) return null;
  return cand.map(z => {
    const s = scoreZone(z, ht, it, lt, ctx, style);
    const zoneDir = z.side === 'demand' ? 1 : -1;
    return { z, score: s.score + (zoneDir === structDir ? 15 : 0), width: s.width, d: s.d, inside: s.inside };
  }).sort((a, b) => b.score - a.score)[0];
}

function synthesizeZone(ctx, dir, style, rows) {
  const a = atr(rows) || ctx.pip * 10;
  const n = Array.isArray(rows) && rows.length >= 6 ? rows.slice(-15) : [];
  if (n.length < 4) return null;
  const sw = dir === 1 ? Math.min(...n.map(c => c.l)) : Math.max(...n.map(c => c.h));
  const w = Math.max(0.3 * a, ctx.pip * 15);
  const z = dir === 1
    ? { lo: sw, hi: sw + w, side: 'demand', kind: 'Swing Low', tf: TF_ROLE[style].ltf.toUpperCase(), isSynthetic: true }
    : { lo: sw - w, hi: sw, side: 'supply', kind: 'Swing High', tf: TF_ROLE[style].ltf.toUpperCase(), isSynthetic: true };
  return { z, score: 30, width: w / ctx.pip, d: Math.abs(ctx.price - (dir === 1 ? z.hi : z.lo)) / ctx.pip, inside: false, dir };
}

function findEntryZone(ctx, p, pool, ltfRows) {
  const prox = PROX[p._style] || 50;
  const validPool = pool.filter(z => (p.dir === 1 ? z.side === 'demand' : z.side === 'supply'));
  for (const z of validPool) {
    const zl = z.lo, zh = z.hi, w = zh - zl;
    const inside = ctx.price >= zl && ctx.price <= zh;
    const beyond = p.dir === 1 ? ctx.price < zl : ctx.price > zh;
    if (beyond) continue;
    let edge;
    if (inside) {
      edge = p.dir === 1 ? zl + w * 0.25 : zh - w * 0.25;
      edge = p.dir === 1 ? Math.min(edge, ctx.price) : Math.max(edge, ctx.price);
    } else {
      edge = p.dir === 1 ? zh + Math.min(2 * ctx.pip, 0.1 * w) : zl - Math.min(2 * ctx.pip, 0.1 * w);
    }
    const sideOk = p.dir === 1 ? edge <= ctx.price : edge >= ctx.price;
    const distPip = Math.abs(ctx.price - edge) / ctx.pip;
    if (sideOk && distPip <= prox) return { z, lim: edge, inside, distPip };
  }
  const synth = synthesizeZone(ctx, p.dir, p._style, ltfRows);
  if (synth) {
    const off = Math.max(5 * ctx.pip, Math.min(synth.d * ctx.pip, 15 * ctx.pip));
    const entry = ctx.price - p.dir * off;
    return { z: synth.z, lim: entry, inside: false, distPip: off / ctx.pip };
  }
  const off = 10 * ctx.pip, entry = ctx.price - p.dir * off, w2 = 15 * ctx.pip;
  const z = { lo: p.dir === 1 ? entry - w2 : entry, hi: p.dir === 1 ? entry : entry + w2, side: p.dir === 1 ? 'demand' : 'supply', kind: 'Fallback', tf: TF_ROLE[p._style].ltf.toUpperCase(), isSynthetic: true };
  return { z, lim: entry, inside: false, distPip: off / ctx.pip };
}

function rejectionAt(ctx, rows, dir) {
  if (!Array.isArray(rows) || rows.length < 3) return false;
  const c = rows[rows.length - 1], p = rows[rows.length - 2];
  const rng = c.h - c.l || ctx.pip;
  if (dir === 1) {
    const lowerWick = Math.min(c.o, c.c) - c.l;
    return lowerWick > 0.5 * rng || (c.c > c.o && p.c < p.o && c.c > p.o && c.o < p.c);
  }
  const upperWick = c.h - Math.max(c.o, c.c);
  return upperWick > 0.5 * rng || (c.c < c.o && p.c > p.o && c.c < p.o && c.o > p.c);
}

function estimateProbability(c) {
  if (c >= 75) return { min: 62, max: 75, label: Math.round(62 + (c - 75) / 25 * 13) + '%' };
  if (c >= 55) return { min: 52, max: 61, label: Math.round(52 + (c - 55) / 20 * 9) + '%' };
  return { min: 45, max: 51, label: Math.round(45 + c / 55 * 6) + '%' };
}

const riskMult = c => (c >= 75 ? 1.0 : c >= 55 ? 0.65 : 0.25);

function baseExpiry(style) {
  const m = {
    Scalping: { candles: 15, tf: 'M1', minutes: 15 },
    Intraday: { candles: 8, tf: 'M30', minutes: 240 },
    Swing: { candles: 12, tf: 'H1', minutes: 720 },
  };
  const e = m[style] || m.Scalping;
  return { ...e, id: 'Auto-cancel ' + e.candles + ' candle ' + e.tf + ' (' + e.minutes + ' mnt) atau SL tertembus lebih dulu.', en: 'Auto-cancel ' + e.candles + ' ' + e.tf + ' candles (' + e.minutes + ' min) or SL hit first.' };
}

function sigOf(p, ctx, style) {
  const f = ctx.f;
  const nf = v => (isNum(v) ? f(v) : null);
  const risk = Math.abs(p.entry - p.sl) || bounds(p.entry, ctx, style).min;
  const tps = Array.isArray(p.tps) && p.tps.length >= 3 ? p.tps.slice(0, 3) : buildTPs(p.entry, p.dir, risk);
  const c = p.conviction || 0;
  const prob = estimateProbability(c);
  const lvl = c >= 75 ? 'HIGH' : c >= 55 ? 'MEDIUM' : 'LOW';
  const s = {
    signal: p.dir === 1 ? 'BUY' : 'SELL',
    orderType: p.type, fill: p.type === 'MARKET' ? 'NOW' : 'LIMIT',
    status: p.type === 'MARKET' ? 'RUNNING' : 'PENDING',
    state: p.type === 'MARKET' ? 'CONFIRMED' : 'LIMIT_PLACED',
    entry: f(p.entry), sl: f(p.sl),
    tp1: nf(tps[0]), tp2: nf(tps[1]), tp3: nf(tps[2]), tp4: null, tp5: null,
    tpCount: 3, tpMode: p.tpMode || 'RISK_R',
    invalidLevel: isNum(p.invalidLevel) ? f(p.invalidLevel) : null,
    zone: p.zone ? { min: f(p.zone.lo), max: f(p.zone.hi), label: p.zone.kind } : null,
    zoneMode: 'range',
    entryPrice: f(p.entry),
    zoneLabel: p.zone ? p.zone.kind : '',
    rr: 1, riskPips: p.riskPips ?? ctx.dp(risk / ctx.pip), pipDisplayScale: ctx.pipScale ?? 1,
    setup: p.setupType ? p.setupType.type : 'Unknown',
    setupLabel: p.setupType ? p.setupType.id : '',
    scenario: p.scenario ? p.scenario.id : 'SC-08',
    scenarioName: p.scenario ? p.scenario.name : 'Struktur Belum Jelas',
    scenarioWhy: p.scenario ? p.scenario.why : '',
    orderReason: p.orderReason || '',
    conviction: c, convictionLevel: lvl, confidence: lvl,
    risk: c >= 75 ? 'LOW' : c >= 55 ? 'MEDIUM' : 'HIGH',
    probability: prob.label, probabilityRange: prob, riskMultiplier: riskMult(c),
    session: p.sess ? p.sess.key : null, sessionLiq: p.sess ? p.sess.liq : null,
    biasMode: p.biasMode || 'HTF_LEAD', expiry: p.expiry || null,
    cancelDistPips: p.cancelDistPips || 50,
    hybrid: !!p.hybrid,
    visionStatus: p.visionStatus || 'rule',
    forced: !!p.forced, symbol: ctx.symbol, style, role: 'main',
    createdAt: Date.now(), lastTickAt: Date.now(),
    filledAt: p.type === 'MARKET' ? Date.now() : null,
    expiresAt: p.expiresAt || Date.now() + (EXPMS[style] || 18e5),
    entryMode: p.type === 'MARKET' ? 'NOW' : 'PULLBACK', entryNote: p.note || null,
    tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null,
    checklist: [], reason: '', reasons: { id: '', en: '' },
  };
  s.chart = buildChart(s, ctx.pip, ctx.dp, f, style);
  return s;
}

function standby(ctx, style, why, steps = []) {
  return {
    signal: { signal: 'NONE', status: 'STANDBY', state: 'STANDBY', orderType: 'NONE', symbol: ctx.symbol, style, entry: null, sl: null, tp1: null, tp2: null, tp3: null, tp4: null, tp5: null, tpCount: 0, checklist: steps.map(s => s.tf + ': ' + s.text), reason: '', reasons: { id: '', en: '' } },
    facts: { symbol: ctx.symbol, style, status: 'STANDBY', why, steps, dec: ctx.dec, price: ctx.f(ctx.price) },
  };
}

const SYS_HYB = `Anda analis trading XAUUSD/BTCUSD membaca gambar chart 3 panel bertumpuk (HTF/MTF/LTF) dengan gridline harga ber-label, zona transparan, dan garis kolam likuiditas ber-label. Keluarkan SATU sinyal.
ATURAN:
Wajib pilih BUY atau SELL (dilarang HOLD/WAIT). Choppy/tipis → tetap pilih, conviction LOW.
NOW hanya bila momentum LTF SEARAH dan harga di titik reaksi; selain itu LIMIT di tepi zona (kuartil terjauh dari SL) agar SL dekat dan R:R layak.
Baca level entry & SL PRESISI dari label gridline/zona. SL tepat di balik tepi jauh zona/swing (jangan lebar melebihi zona), entry di tepi zona yang menguntungkan.
Klasifikasi setup: Supply & Demand | Reversal | Kontinuitas | Fakeout/Trap | Retest BOS | Ranging Edge | Struktur Belum Jelas.
Conviction 0-100: HTF&zona 0-30, struktur&likuiditas&setup 0-30, trigger&R:R 0-25, sesi&volatilitas 0-15. Jangan berlebihan.
Jika HTF dan MTF berlawanan → conviction kecil (counter-trend). Jika HTF stale/tanpa displacement → jangan klaim Kontinuitas.
TIDAK perlu mengeluarkan TP (sistem yang mengatur TP1/TP2/TP3).
Balas HANYA JSON: { "signal": "BUY|SELL", "orderType": "NOW|LIMIT", "entry":0, "sl":0, "zoneLow":0, "zoneHigh":0, "setup": "...", "conviction":0, "perPanel":[ "HTF: ...", "MTF: ...", "LTF: ..."], "reason": "2-3 kalimat ID", "reasonEn": "2-3 kalimat EN"}`;

function guardVision(v, ctx, style, b, live, sess) {
  if (!v || typeof v !== 'object') return null;
  const sg = String(v.signal || '').toUpperCase();
  if (sg !== 'BUY' && sg !== 'SELL') return null;
  const dir = sg === 'BUY' ? 1 : -1;
  let entry = Number(v.entry), sl = Number(v.sl);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(sl) || sl <= 0) return null;
  let ot = String(v.orderType || '').toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET';
  let zone = null;
  if (isNum(v.zoneLow) && isNum(v.zoneHigh)) {
    const lo = Math.min(Number(v.zoneLow), Number(v.zoneHigh));
    const hi = Math.max(Number(v.zoneLow), Number(v.zoneHigh));
    if (hi > lo) zone = { lo, hi };
  }
  if (zone && entry > zone.lo && entry < zone.hi) {
    const w = zone.hi - zone.lo;
    let edge = dir === 1 ? zone.lo + w * 0.25 : zone.hi - w * 0.25;
    edge = dir === 1 ? Math.min(edge, live) : Math.max(edge, live);
    if (Math.abs(live - edge) / ctx.pip >= 3) { entry = edge; ot = 'LIMIT'; }
  }
  const prox = PROX[style] || 50;
  if (ot === 'LIMIT') {
    const okSide = dir === 1 ? entry < live : entry > live;
    const dist = Math.abs(live - entry) / ctx.pip;
    if (!okSide) {
      if (dist <= 8) { ot = 'MARKET'; entry = live; }
      else { const d = Math.max(3, Math.min(dist, prox)); entry = dir === 1 ? live - d * ctx.pip : live + d * ctx.pip; }
    } else if (dist > prox * 2) {
      entry = dir === 1 ? live - prox * ctx.pip : live + prox * ctx.pip;
    }
  } else if (Math.abs(entry - live) / ctx.pip > 8) entry = live;
  if (dir === 1 ? sl >= entry : sl <= entry) sl = entry - dir * Math.max((b.min / ctx.pip) * 0.8, 25) * ctx.pip;
  let slDist = Math.abs(entry - sl) / ctx.pip;
  const sessCap = !sess ? 1 : (sess.liq <= 0.6 ? 0.6 : sess.liq < 1 ? 0.8 : 1.0);
  const minSL = Math.max(20, (b.min / ctx.pip) * 0.6);
  const maxSL = (b.max / ctx.pip) * 1.3 * sessCap;
  if (zone) {
    const farEdge = dir === 1 ? zone.lo : zone.hi;
    const minStruct = (Math.abs(entry - farEdge) + Math.max(2 * ctx.pip, 0.15 * (zone.hi - zone.lo))) / ctx.pip;
    if (slDist < minStruct) slDist = minStruct;
  }
  if (slDist < minSL) slDist = minSL;
  if (slDist > maxSL) slDist = maxSL;
  sl = entry - dir * slDist * ctx.pip;
  let conv = Math.round(Number(v.conviction));
  if (!Number.isFinite(conv)) conv = 50;
  conv = Math.max(0, Math.min(100, conv));
  return {
    dir, entry, sl, ot, conv,
    setup: String(v.setup || ''),
    zoneLow: zone ? zone.lo : (isNum(v.zoneLow) ? Number(v.zoneLow) : null),
    zoneHigh: zone ? zone.hi : (isNum(v.zoneHigh) ? Number(v.zoneHigh) : null),
    perPanel: Array.isArray(v.perPanel) ? v.perPanel.map(String).slice(0, 3) : [],
    reason: String(v.reason || ''), reasonEn: String(v.reasonEn || v.reason || ''),
  };
}

async function runManual(ctx, d, style) {
  const role = TF_ROLE[style] || TF_ROLE.Scalping;
  const slRef = SL_REF[style] || SL_REF.Scalping;
  const plan = TP_PLAN[style] || TP_PLAN.Scalping;
  const prox = PROX[style] || 50;
  const cl = {};
  for (const tf of ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']) {
    cl[tf] = d[tf] || [];
  }
  const sess = sessionOf(Date.now(), ctx.symbol);
  const mtfRows = cl[role.mtf];
  const ltfRows = cl[role.ltf];
  const slRows = cl[slRef.atrTf] || ltfRows;
  const atrStruct = atr(mtfRows) || ctx.pip * 10;
  const atrSlNow = atr(slRows) || ctx.pip * 10;
  const atrUse = atrSanity(atrSlNow, atrStruct);
  const vol = volatilityRegime(atrSlNow, atrStruct, sess);
  const ht = internal(cl[role.htf]);
  const it = internal(cl[role.mtf]);
  const lt = internal(cl[role.ltf]);
  const H = role.htf.toUpperCase(), M = role.mtf.toUpperCase(), L = role.ltf.toUpperCase();
  const allZones = dedupeZones([
    ...zonesFromRows(cl[role.htf], H, ctx, style),
    ...zonesFromRows(cl[role.mtf], M, ctx, style),
    ...zonesFromRows(cl[role.ltf], L, ctx, style),
    ...gaps(ltfRows).map(g => ({ ...g, tf: L })),
  ]);
  const nearZones = allZones.filter(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const dd = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip;
    return inside || dd <= prox * 2;
  }).slice(0, 4);
  const pools = findPools(mtfRows, ctx, cl.d1);
  const whipsaw = doubleSweep(pools, ltfRows, ctx);
  const aheadPool = pools.filter(x => x.ahead).sort((a, b) => a.distPip - b.distPip)[0];
  const verdict = aheadPool ? sweepVsBreak(aheadPool.price, aheadPool.side, ltfRows, ctx) : { verdict: 'NONE' };
  const b = bounds(ctx.price, ctx, style);
  const htEff = (ht.fresh || ht.displaced) ? ht : { ...ht, weak: true };
  let bias = resolveBias({ ht: htEff, it, lt, zones: allZones, ctx, style, atrM15: atrStruct, slPips: b.min / ctx.pip });
  const guard = counterGuard(bias, b.min / ctx.pip);
  if (!guard.ok) bias = resolveBias({ ht: htEff, it, lt, zones: allZones, ctx, style, atrM15: atrStruct, slPips: b.min / ctx.pip, allowCounter: false });
  const aRange = asianRange(ltfRows, ctx.symbol);
  const sessSweep = (sess.key === 'LONDON_KZ' || sess.key === 'NY_AM_KZ') ? asianSweep(ltfRows, aRange, ctx) : null;
  let dir = bias.dir;
  if (sessSweep) dir = sessSweep.dir;
  else if (verdict.verdict === 'SWEEP' || verdict.verdict === 'BREAK') dir = verdict.dir;
  const pd = { lo: Math.min(...mtfRows.map(c => c.l)), hi: Math.max(...mtfRows.map(c => c.h)) };
  const rg = null;
  let rangeBound = NaN;
  let chosen = chooseBestZone(ctx, ht, it, lt, allZones.filter(z => z.side === (dir === 1 ? 'demand' : 'supply')), style);
  if (!chosen) chosen = synthesizeZone(ctx, dir, style, ltfRows);
  const steps = [];
  steps.push({ tf: 'Sesi', text: sess.key + ' (' + sess.wib + ') liq ' + sess.liq + 'x', textEn: sess.key + ' liq ' + sess.liq + 'x' });
  steps.push({ tf: H, text: dw(ht.dir) + ' ' + (ht.ev || '-') + (ht.fresh ? ' fresh' : ' stale') + (ht.displaced ? ' +displacement' : ' TANPA displacement'), textEn: dw(ht.dir) + ' ' + (ht.ev || '-') });
  steps.push({ tf: M, text: dw(it.dir) + ' ' + (it.ev || '-') + (it.fresh && it.displaced ? ' valid' : ''), textEn: dw(it.dir) + ' ' + (it.ev || '-') });
  steps.push({ tf: L, text: dw(lt.dir) + ' ' + (lt.ev || '-') + (lt.fresh ? ' fresh' : ''), textEn: dw(lt.dir) + ' ' + (lt.ev || '-') });
  if (whipsaw) steps.push({ tf: 'Whipsaw', text: 'Double sweep — kemungkinan news. Risk 0.25x.', textEn: 'Double sweep — news whipsaw.' });
  if (bias.mode === 'LTF_COUNTER') steps.push({ tf: 'LTF Dinamis', text: 'LTF memimpin counter-HTF, penalti -' + bias.penalty, textEn: 'LTF leads counter-HTF.' });
  const ltfMonRows0 = cl[LTF_TF[style] || role.ltf] || ltfRows;
  const healthOf = ddir => {
    const mon = monitorLTFStructure(ltfMonRows0, ddir, ctx, style);
    let h = mon.confidence;
    if (lt.dir === ddir) h += 15;
    if (it.dir === ddir) h += 10;
    if (ht.dir === ddir) h += 8;
    return { mon, h };
  };
  const hCur = healthOf(dir);
  const hOpp = healthOf(-dir);
  let forcedWeak = false;
  if (!hCur.mon.valid && hOpp.h > hCur.h) {
    dir = -dir;
    chosen = chooseBestZone(ctx, ht, it, lt, allZones.filter(z => z.side === (dir === 1 ? 'demand' : 'supply')), style) || synthesizeZone(ctx, dir, style, ltfRows);
    steps.push({ tf: 'Arah', text: 'Arah dibalik ke ' + (dir === 1 ? 'BUY' : 'SELL') + ': struktur LTF arah semula rusak (' + hCur.mon.reason + ').', textEn: 'Direction flipped: original LTF structure broken (' + hCur.mon.reason + ').' });
  } else if (!hCur.mon.valid) {
    forcedWeak = true;
    steps.push({ tf: 'Arah', text: 'Struktur LTF kedua arah lemah — sinyal tetap dipaksa (FORCED BINARY) dengan conviction dikunci LOW, risk 0.25x.', textEn: 'Both directions weak — forced binary signal locked LOW, 0.25x.' });
  }
  const mon0 = healthOf(dir).mon;
  const p = { dir, _style: style, entry: ctx.price, sl: ctx.price, type: 'LIMIT', zone: chosen ? chosen.z : null };
  const pool = [];
  if (chosen) pool.push(chosen.z);
  for (const z of nearZones) if (z.side === (dir === 1 ? 'demand' : 'supply') && !pool.some(k => k.lo === z.lo && k.hi === z.hi)) pool.push(z);
  const ez = findEntryZone(ctx, p, pool, ltfRows);
  p.entry = ez.lim; p.zone = ez.z;
  p.zone = coupleZone(p.zone, p.entry, p.dir, ctx.pip, atrUse);
  const struct = swingLevel(cl[slRef.swingTf] || ltfRows, p.dir, slRef.win);
  const slp = slBeyondPool(pools, p.dir, p.entry, ctx, atrUse);
  let rr = calcSL({ entry: p.entry, dir: p.dir, ctx, b, sess, atrUse, structLevel: sessSweep ? sessSweep.extreme : struct, poolLevel: slp ? slp.pool.price : NaN, rangeBound, tfKey: slRef.atrTf });
  p.sl = rr.sl; p.riskPips = rr.riskPips; p.slCapped = rr.capped;
  p.invalidLevel = slp ? slp.level : (sessSweep ? sessSweep.extreme : struct);
  let slReason = slp ? 'di luar kolam ' + slp.pool.type + ' + buffer' : (sessSweep ? 'di balik titik sweep' : 'di luar swing ' + slRef.swingTf.toUpperCase());
  const ltfMonRows = cl[LTF_TF[style] || role.ltf] || ltfRows;
  const psl = calculatePreciseSL(p.entry, p.dir, ltfMonRows, ctx, 1.5);
  if (psl && psl.distancePips >= 20 && psl.distancePips < rr.riskPips) {
    p.sl = psl.sl; p.riskPips = ctx.dp(psl.distancePips); p.slCapped = false; slReason = psl.reason;
  }
  const reject = rejectionAt(ctx, ltfRows, p.dir);
  const momentum = !!(lt.fresh && lt.dir === p.dir);
  const preNews = vol.regime === 'SPIKE';
  let scenario = detectScenario({ ht, it, lt, chosen, verdict: verdict.verdict, sweepSess: sessSweep, rg, biasMode: bias.mode, dir: p.dir, inside: ez.inside, distPip: ez.distPip, momentum, preNews, sess });
  const ord = decideOrderType(scenario, { inside: ez.inside, distPip: ez.distPip, reject, momentum, preNews, sess, ltfConfidence: mon0.confidence });
  p.type = ord.type;
  if (p.type === 'MARKET') p.entry = ctx.price;
  p.orderReason = ord.reason;
  p.scenario = scenario;
  p.cancelDistPips = cancelTolerance(p.riskPips, prox);
  const draw = nearestDraw(pools, p.dir, ctx);
  let fin = planTPs({ style, entry: p.entry, dir: p.dir, risk: rr.need, pip: ctx.pip, wall: bias.wall, draw, dp: ctx.dp });
  let rrPenalty = 0;
  const runwayTooTight = Number.isFinite(fin.runwayPip) && fin.runwayPip < rr.riskPips;
  if (!fin.tps || runwayTooTight) {
    if (!fin.tps) fin = { tps: buildTPs(p.entry, p.dir, rr.need), count: 3, mode: 'RISK_R', pips: [], rr1: 1, poorRR: true, runwayPip: null };
    else rrPenalty += 6;
  }
  p.tps = fin.tps; p.tpCount = 3; p.tpMode = fin.mode;
  p.tpCapped = fin.mode !== 'RISK_R' && fin.mode !== 'FIXED_PIP';
  if (fin.poorRR) rrPenalty += 8;
  if (rr.structMismatch) rrPenalty += 6;
  if (rr.atrOverflow) rrPenalty += 8;
  const riskNow0 = Math.abs(p.entry - p.sl);
  const tp1d0 = p.tps && p.tps[0] != null ? Math.abs(p.tps[0] - p.entry) : 0;
  if (riskNow0 > 0 && tp1d0 / riskNow0 < 0.8) {
    const dd = plan.mode === 'PIP' ? plan.targets.map(t => t * ctx.pip) : plan.targets.map(m => m * riskNow0);
    p.tps = dd.map(x => p.entry + p.dir * x);
    p.tpMode = 'RISK_R'; p.tpCapped = false;
    rrPenalty += 6;
    steps.push({ tf: 'R:R', text: 'TP dipaksa pola R penuh karena runway < 0.8R — cegah SL/TP bertolak belakang.', textEn: 'TPs forced to full R-multiple: runway < 0.8R.' });
  }
  let setupType = { type: scenario.name, id: scenario.why, en: scenario.why };
  let c1 = 0;
  if (ht.dir === p.dir) c1 += 20; else if (ht.dir === 0) c1 += 8; else c1 += 4;
  if (chosen && chosen.width >= 20 && chosen.width <= 80) c1 += 10; else if (chosen && chosen.width >= 15) c1 += 5;
  c1 = Math.min(30, c1);
  let c2 = 0;
  const stMap = { 'Kontinuitas Pullback': 22, 'Retest BOS': 22, 'Fakeout / Trap': 18, 'Reversal Sweep': 18, 'Ranging Edge': 16, 'Breakout Impulse': 20, 'LTF Momentum (counter-HTF)': 12, 'Struktur Belum Jelas': 6 };
  c2 += stMap[scenario.name] || 5;
  if (it.fresh && it.displaced && it.dir === p.dir) c2 += 4;
  if (verdict.verdict === 'SWEEP' && (sess.key === 'LONDON_KZ' || sess.key === 'NY_AM_KZ')) c2 += 4;
  if (pools.some(x => x.strength >= 5 && x.state === 'VIRGIN' && x.ahead)) c2 += 4;
  c2 = Math.min(30, c2);
  let c3 = 0;
  if (lt.dir === p.dir) c3 += 12;
  if (lt.fresh) c3 += 6;
  if (reject) c3 += 4;
  if (!rr.capped) c3 += 3;
  c3 = Math.min(25, c3);
  let c4 = sessionScore(sess, scenario.name === 'Fakeout / Trap' ? 'SWEEP' : (rg ? 'RANGE' : 'TREND'));
  c4 -= vol.penalty;
  c4 = Math.max(0, Math.min(15, c4));
  let conv = c1 + c2 + c3 + c4 - rrPenalty;
  const adj = adjustConviction(conv, bias, p.tps.filter(isNum), p.entry, p.dir);
  conv = adj.conviction;
  if (whipsaw || sess.mode === 'AVOID' || vol.regime === 'SPIKE') conv = Math.min(conv, 54);
  if (ht.dir === 0 && sess.key === 'ASIA') conv = Math.min(conv, 35);
  const htfWeak = !(ht.fresh || ht.displaced);
  const mixedStructure = htfWeak && it.dir !== 0 && lt.dir !== 0 && it.dir !== lt.dir;
  if (mixedStructure || scenario.name === 'Struktur Belum Jelas') {
    conv = Math.min(conv, 54);
    steps.push({ tf: 'Struktur', text: 'Struktur bercampur = choppy: conviction dibatasi LOW, risk 0.25x.', textEn: 'Mixed structure = choppy: capped LOW, 0.25x.' });
  } else if (it.dir !== 0 && it.dir !== p.dir) {
    conv -= 10;
    steps.push({ tf: 'Struktur', text: 'MTF (' + (it.ev || '-') + ') berlawanan arah sinyal = counter-trend: conviction -10.', textEn: 'MTF opposes = counter-trend: -10.' });
  }
  if (forcedWeak) conv = Math.min(conv, 45);
  p.conviction = Math.max(0, Math.min(100, Math.round(conv)));
  p.setupType = setupType;
  p.sess = sess;
  p.biasMode = bias.mode;
  
  // Hybrid Vision
  let hybrid = null;
  if (HYBRID && VIS_KEY) {
    const poolLines = pools.filter(x => x.strength >= 4 || x.ahead).sort((a, b) => b.strength - a.strength).slice(0, 4).map(x => ({ price: x.price, label: x.type }));
    let img = null;
    try {
      img = renderSignalChart({
        dec: ctx.dec, live: ctx.price,
        panels: [
          { label: H + ' HTF', rows: cl[role.htf].slice(-90), zones: nearZones.filter(z => z.tf === H), pools: [] },
          { label: M + ' MTF', rows: cl[role.mtf].slice(-90), zones: nearZones.filter(z => z.tf === M), pools: poolLines },
          { label: L + ' LTF', rows: cl[role.ltf].slice(-70), zones: nearZones.filter(z => z.tf === L), pools: [] },
        ],
      });
    } catch (e) {
      console.error('Chart render error:', e);
    }
    if (img) {
      const text = 'Aset ' + ctx.symbol + ', gaya ' + style + '. Harga live ' + ctx.f(ctx.price) + '. Sesi ' + sess.key + ' (' + sess.wib + ') liq ' + sess.liq + 'x. ATR ' + slRef.atrTf.toUpperCase() + ' ' + ctx.dp(atrUse / ctx.pip) + ' pip. Gambar: 3 panel bertumpuk HTF/MTF/LTF, gridline harga ber-label, zona = kotak transparan, kolam = garis putus ber-label. Tentukan SATU sinyal sesuai aturan.';
      let raw = await aiVision(SYS_HYB, text, img, 25000);
      hybrid = guardVision(raw, ctx, style, b, ctx.price, sess);
      if (!hybrid && raw) {
        const raw2 = await aiVision(SYS_HYB, text + '\nKOREKSI: jawaban sebelumnya melanggar guardrail (sisi order/SL/jarak). Perbaiki dan balas JSON lagi.', img, 20000);
        hybrid = guardVision(raw2, ctx, style, b, ctx.price, sess);
      }
    }
  }
  p.visionStatus = !HYBRID ? 'disabled' : (hybrid ? 'ok' : 'no-key');
  if (HYBRID && !hybrid) {
    steps.push({ tf: 'Vision', text: 'Hybrid vision tidak aktif — pakai rule-engine.', textEn: 'Hybrid vision inactive — rule-engine used.' });
  }
  if (hybrid) {
    p.dir = hybrid.dir;
    p.zone = coupleZone(hybrid.zoneLow != null && hybrid.zoneHigh != null ? { lo: Math.min(hybrid.zoneLow, hybrid.zoneHigh), hi: Math.max(hybrid.zoneLow, hybrid.zoneHigh), kind: 'Zona Vision', tf: M } : p.zone, hybrid.entry, p.dir, ctx.pip, atrUse);
    p.entry = hybrid.ot === 'MARKET' ? ctx.price : hybrid.entry;
    p.sl = hybrid.sl;
    p.type = hybrid.ot;
    if (p.type === 'MARKET' && lt.dir !== 0 && lt.dir !== p.dir && p.zone) {
      const w = p.zone.hi - p.zone.lo;
      let edge = p.dir === 1 ? p.zone.lo + w * 0.25 : p.zone.hi - w * 0.25;
      edge = p.dir === 1 ? Math.min(edge, ctx.price) : Math.max(edge, ctx.price);
      if (Math.abs(ctx.price - edge) / ctx.pip >= 3) {
        p.entry = edge; p.type = 'LIMIT';
        p.orderReason = 'LIMIT: momentum LTF berlawanan arah — tunggu retest tepi zona.';
      }
    }
    p.riskPips = ctx.dp(Math.abs(p.entry - p.sl) / ctx.pip);
    p.invalidLevel = p.sl;
    if (!p.orderReason) p.orderReason = hybrid.ot === 'MARKET' ? 'NOW: reaksi/momentum aktif terkonfirmasi vision.' : 'LIMIT: harga belum di zona terukur (vision).';
    slReason = 'level invalidasi vision di balik struktur';
    const wall = nearestWall(ctx, p.dir, allZones, role.htf, role.mtf);
    const draw2 = nearestDraw(pools, p.dir, ctx);
    let fin2 = planTPs({ style, entry: p.entry, dir: p.dir, risk: Math.abs(p.entry - p.sl), pip: ctx.pip, wall, draw: draw2, dp: ctx.dp });
    if (!fin2.tps) fin2 = { tps: buildTPs(p.entry, p.dir, Math.abs(p.entry - p.sl)), count: 3, mode: 'RISK_R', pips: [], rr1: 1, poorRR: false, runwayPip: null };
    p.tps = fin2.tps; p.tpCount = 3; p.tpMode = fin2.mode;
    p.tpCapped = fin2.mode !== 'RISK_R' && fin2.mode !== 'FIXED_PIP';
    const rk = Math.abs(p.entry - p.sl);
    const t1 = p.tps && p.tps[0] != null ? Math.abs(p.tps[0] - p.entry) : 0;
    if (rk > 0 && t1 / rk < 0.8) {
      const dd = plan.mode === 'PIP' ? plan.targets.map(t => t * ctx.pip) : plan.targets.map(m => m * rk);
      p.tps = dd.map(x => p.entry + p.dir * x);
      p.tpMode = 'RISK_R'; p.tpCapped = false;
    }
    let conv2 = hybrid.conv;
    const htfWeak2 = !(ht.fresh || ht.displaced);
    const mixed2 = htfWeak2 && it.dir !== 0 && lt.dir !== 0 && it.dir !== lt.dir;
    if (mixed2 || /struktur belum jelas/i.test(hybrid.setup)) conv2 = Math.min(conv2, 54);
    if (it.dir !== 0 && it.dir !== p.dir) conv2 -= 10;
    if (whipsaw || sess.mode === 'AVOID' || vol.regime === 'SPIKE') conv2 = Math.min(conv2, 54);
    if (ht.dir === 0 && sess.key === 'ASIA') conv2 = Math.min(conv2, 35);
    if (forcedWeak) conv2 = Math.min(conv2, 45);
    if (Number.isFinite(fin2.runwayPip) && fin2.runwayPip < p.riskPips) conv2 -= 6;
    p.conviction = Math.max(0, Math.min(100, Math.round(conv2)));
    scenario = { id: 'SC-01', name: hybrid.setup || 'Vision Setup', why: hybrid.setup || 'Vision decided' };
    p.scenario = scenario;
    setupType = { type: hybrid.setup || scenario.name, id: scenario.why, en: scenario.why };
    p.setupType = setupType;
    p.hybrid = true;
    p.vReason = hybrid.reason; p.vReasonEn = hybrid.reasonEn; p.perPanel = hybrid.perPanel;
    steps.push({ tf: 'Vision Hybrid', text: 'Sinyal diputus vision-model dari chart render: ' + (hybrid.setup || scenario.name) + '.', textEn: 'Vision-model decided from rendered chart.' });
  }
  p.expiry = bias.mode === 'LTF_COUNTER' && !p.hybrid ? counterExpiry(style) : baseExpiry(style);
  if (p.type === 'LIMIT') {
    const byTime = Date.now() + p.expiry.minutes * 60000;
    p.expiresAt = Math.min(byTime, sess.nextBoundaryMs);
    p.expiry.id += ' Atau harga menjauh >' + p.cancelDistPips + ' pip dari entry.';
  }
  const tfSummary = (p.hybrid && p.perPanel && p.perPanel.length) ? p.perPanel : [
    H + ' ' + dw(ht.dir) + ' ' + (ht.ev || '-') + (ht.fresh ? ' fresh' : ' stale') + (ht.displaced ? ' +displacement' : ' TANPA displacement'),
    M + ' ' + dw(it.dir) + ' ' + (it.ev || '-') + (it.fresh && it.displaced ? ' valid' : ''),
    L + ' ' + dw(lt.dir) + ' ' + (lt.ev || '-') + (lt.fresh ? ' fresh' : ''),
  ];
  steps.push({ tf: 'Entry', text: p.orderReason, textEn: p.orderReason });
  steps.push({ tf: 'SL', text: ctx.f(p.sl) + ' (' + p.riskPips + ' pip) — ' + slReason, textEn: slReason });
  steps.push({ tf: 'Conviction', text: p.conviction + '/100 → ' + (p.conviction >= 75 ? 'HIGH' : p.conviction >= 55 ? 'MEDIUM' : 'LOW') + ' · Risk ' + riskMult(p.conviction) + 'x · Prob ' + estimateProbability(p.conviction).label, textEn: p.conviction + '/100' });
  if (p.type === 'LIMIT') steps.push({ tf: 'Expiry', text: p.expiry.id, textEn: p.expiry.en });
  const s = sigOf(p, ctx, style);
  const f = {
    symbol: ctx.symbol, style, status: s.status, signal: s.signal, orderType: s.orderType,
    entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: null, tp5: null,
    tpCount: 3, tpMode: s.tpMode, riskPips: s.riskPips, invalidLevel: s.invalidLevel,
    setup: setupType.type, scenarioName: scenario.name, scenarioWhy: scenario.why, scenarioId: scenario.id,
    orderReason: p.orderReason, tfSummary,
    conviction: p.conviction, convictionLevel: s.convictionLevel, probability: s.probability, riskMultiplier: s.riskMultiplier,
    session: sess.key, sessionWib: sess.wib, sessionLiq: sess.liq, volRegime: vol.regime,
    premiumDiscount: pd ? ((ctx.price - pd.lo) / pd.range >= 0.5 ? 'premium' : 'discount') : null,
    slReason, cancelDistPips: p.cancelDistPips, biasMode: p.biasMode, whipsaw: !!whipsaw,
    liquidity: aheadPool ? aheadPool.type + ' ' + verdict.verdict : 'none',
    vReason: p.vReason || '', vReasonEn: p.vReasonEn || '',
    visionStatus: p.visionStatus,
    chart: s.chart, expiry: p.expiry, dec: ctx.dec, price: ctx.f(ctx.price),
  };
  return { signal: s, facts: f };
}

export async function handleCandles(body, lang, res, isBot, email) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const style = isBot ? 'scalperbot' : normStyle(body.style || body.mode);
  const price = Number(body.price ?? body.livePrice ?? 0);
  if (!(price > 0)) return res.status(200).json({ ok: false, reason: 'Harga live belum tersedia.' });
  const dec = DEC[symbol] ?? 2;
  const pipScale = pipScaleOf(symbol);
  const ctx = { symbol, dec, price, pip: pipOf(symbol, dec), pipScale, dp: v => Math.round(num(v) * pipScale), f: v => Number(num(v, price).toFixed(dec)) };
  const data = {};
  for (const tf of ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']) {
    data[tf] = (body.candles || {})[tf] || [];
  }
  const need = isBot ? ['m1', 'm5', 'm15'] : (NEED[style] || NEED.Scalping);
  await Promise.all(need.map(async tf => {
    if (data[tf].length >= (MINB[tf] || 25)) return;
    const rows = await tlRows(symbol, tf, 200);
    if (rows.length) { data[tf] = rows; return; }
  }));
  const enough = need.some(tf => (data[tf] || []).length >= Math.min(MINB[tf] || 25, 30));
  if (!enough) return res.status(200).json({ ok: false, reason: 'Data candle belum cukup.' });
  let out;
  try { out = isBot ? null : await runManual(ctx, data, style); }
  catch (e) { console.error('[engine] error:', e.message, e.stack); out = standby(ctx, style, 'Engine error: ' + e.message); }
  if (!out || !out.signal) out = standby(ctx, style, 'Menunggu setup valid.');
  const f = out.facts || { symbol, style, status: 'STANDBY', why: '', steps: [], dec, price: ctx.f(price) };
  const signal = { ...out.signal, reason: buildReason(f, lang === 'en'), reasons: { id: buildReason(f, false), en: buildReason(f, true) } };
  return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal, diag: { version: VERSION, status: signal.status, hybrid: !!signal.hybrid, vision: f.visionStatus || (signal.hybrid ? 'ok' : 'rule'), session: f.session || null, liquidity: f.liquidity || null, biasMode: f.biasMode || null, conviction: f.conviction || 0, setup: f.setup || null, scenario: f.scenarioName || null, tpCount: signal.tpCount || 0, store: 'MEM' } });
}

export async function handleVision(body, lang, res) {
  const imgs = (Array.isArray(body.images) ? body.images : []).filter(s => typeof s === 'string' && s.startsWith('data:image/')).slice(0, 3);
  if (!imgs.length) return res.status(200).json({ ok: false, reason: 'Gambar tidak valid.' });
  if (!VIS_KEY) return res.status(200).json({ ok: false, reason: 'OPENAI_API_KEY belum diatur.' });
  const style = normStyle(body.style);
  const SYS_VIS = 'Kamu analis S&D/OB dari gambar chart. Baca level PERSIS dari skala harga. Wajib BUY atau SELL kecuali gambar bukan chart. Prioritaskan LIMIT pullback; MARKET hanya bila harga sudah di zona dan ada penolakan. Sebutkan zona TF tinggi dan rendah pada perImageAnalyses. SL di luar distal zona/swing. Balas HANYA JSON: { "signal": "BUY", "orderType": "LIMIT", "entry":0, "sl":0, "tp1":0, "tp2":0, "tp3":0, "zoneLow":0, "zoneHigh":0, "zone": "Demand", "pair": " ", "decimals":2, "perImageAnalyses":[], "perImageAnalysesEn":[], "reason": " ", "reasonEn": " "}';
  const content = [{ type: 'text', text: 'Jumlah gambar: ' + imgs.length + '. Style: ' + style + '.' }, ...imgs.flatMap((u, i) => [{ type: 'text', text: 'Gambar ' + (i + 1) + ':' }, { type: 'image_url', image_url: { url: u } }])];
  let r = null;
  try {
    r = await aiVision(SYS_VIS, 'Analisis chart ini', imgs[0], 50000);
  } catch (e) { return res.status(200).json({ ok: false, reason: 'AI timeout: ' + e.message }); }
  if (!r) return res.status(200).json({ ok: false, reason: 'AI gagal.' });
  const sg = String(r?.signal || '').toUpperCase();
  const e0 = Number(r?.entry), s0 = Number(r?.sl);
  if (!r || (sg !== 'BUY' && sg !== 'SELL') || !(e0 > 0) || !(s0 > 0)) return res.status(200).json({ ok: false, reason: 'AI tidak memberi setup valid.' });
  const sym = String(r.pair || 'CHART').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CHART';
  const dec = Number.isInteger(r.decimals) ? r.decimals : (DEC[sym] ?? 2);
  const pip = pipOf(sym, dec);
  const f = v => Number(Number(v).toFixed(dec));
  const dir = sg === 'BUY' ? 1 : -1;
  const entry = f(e0);
  const risk = Math.abs(e0 - s0) || pip * 10;
  const sl = f(entry - dir * risk);
  const tps = buildTPs(entry, dir, risk).map(f);
  const zl = f(Number(r.zoneLow) || Math.min(entry, entry - dir * risk * 0.5));
  const zh = f(Number(r.zoneHigh) || Math.max(entry, entry - dir * risk * 0.5));
  const pi = Array.isArray(r.perImageAnalyses) ? r.perImageAnalyses.map(String) : [];
  const pe = Array.isArray(r.perImageAnalysesEn) ? r.perImageAnalysesEn.map(String) : pi;
  const rid = '[' + sym + ' · Analisa ' + imgs.length + ' Gambar]\n' + pi.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (r.reason || '');
  const ren = '[' + sym + ' · ' + imgs.length + '-Image Analysis]\n' + pe.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (r.reasonEn || r.reason || '');
  const isLimit = String(r.orderType || '').toUpperCase() === 'LIMIT';
  const out = {
    signal: sg, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW',
    status: isLimit ? 'PENDING' : 'RUNNING', entryMode: isLimit ? 'PULLBACK' : 'NOW',
    symbol: sym, pair: sym, dec, pip, style, entry, sl,
    tp1: tps[0], tp2: tps[1], tp3: tps[2], tp4: null, tp5: null, tpCount: 3,
    zoneMode: 'range', entryPrice: entry,
    riskPips: Math.round((risk / pip) * pipScaleOf(sym)), pipDisplayScale: pipScaleOf(sym),
    tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null,
    zone: { min: zl, max: zh, label: (r.zone || 'Zona') + ' ' + zl + '–' + zh },
    reason: lang === 'en' ? ren : rid, reasons: { id: rid, en: ren },
    reasonSource: 'AI', aiReasoning: true,
    createdAt: Date.now(), lastTickAt: Date.now(), filledAt: isLimit ? null : Date.now(),
    expiresAt: Date.now() + (EXPMS[style] || 18e5), source: 'VISION_AI',
  };
  return res.status(200).json({ ok: true, mode: 'vision', symbol: sym, pair: sym, dec, pip, price: entry, style, signal: out });
}
