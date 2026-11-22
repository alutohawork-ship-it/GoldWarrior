// api/generate.js — v162 (simpleZonePlan M5 refine M1 + scalpStructPlan M1/M5 + smc_flex + pullbackPlan + scalpWatch + no old fallback on Scalping + standby cache fix + bars.live guard + prevSignal age/dist guard + bot M15/M5/M1 + XAUUSD dist override + standby checklist to AI)
import { checkAccess, markTrialBotUsed } from '../lib/access.js';
import { generateManualPlan, buildWatchlist, SYARAT_MASUK } from '../lib/manual_scalp.js';
import {
  scalpStructPlan,
  flexScalpPlan,
  pullbackPlan,
  simpleZonePlan,
  scalpWatch,
} from '../lib/smc_flex.js';
import { runBotSma as runBotFlex } from '../lib/bot_smc.js';
import { fetchMetaApiCandles } from '../lib/candles_metaapi.js';
import { fetchOandaCandles } from '../lib/candles_oanda.js';
// Sumber candle: 'tickerlayer' (default, lama), 'metaapi' (broker MT5 lewat MetaApi), atau 'oanda'
const CANDLE_SOURCE = process.env.CANDLE_SOURCE || 'tickerlayer';
function fetchCandlesBySource(symbol, interval, need) {
  if (CANDLE_SOURCE === 'metaapi') return fetchMetaApiCandles(symbol, interval, need);
  if (CANDLE_SOURCE === 'oanda') return fetchOandaCandles(symbol, interval, need);
  return fetchTickerLayerRows(symbol, interval, need);
}

export const config = { maxDuration: 60 };

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';
const VISION_TIMEOUT_MS = 50000;
const VISION_DEADLINE_MS = 54000;
const VISION_MAX_TOKENS = 1800;

const QWEN_BASE_URL = (process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const QWEN_KEYS = [process.env.QWEN_API_KEY, process.env.QWEN_API_KEY_2, process.env.OPENAI_API_KEY].filter(Boolean);
const QWEN_MODELS = [...new Set([process.env.QWEN_MODEL || 'deepseek-v4-flash', process.env.QWEN_MODEL_2 || 'gpt-6-luna', AI_VISION_MODEL].filter(Boolean))];
const QWEN_TIMEOUT_MS = 25000;
const QWEN_DEADLINE_MS = 30000;
const QWEN_MANUAL_DEADLINE_MS = Number(process.env.QWEN_MANUAL_DEADLINE_MS) > 0 ? Number(process.env.QWEN_MANUAL_DEADLINE_MS) : 12000;
const QWEN_MAX_TOKENS = 3000;
const QWEN_MANUAL_MODEL = process.env.QWEN_MANUAL_MODEL || 'deepseek-v4-flash';
// Pemisahan AI manual vs bot (opsional, via environment variable):
//   QWEN_MANUAL_API_KEY  : key khusus manual (dicoba lebih dulu, key lama jadi cadangan)
//   QWEN_MANUAL_MODEL    : model khusus manual (teks cerita + gate). QWEN_MANUAL_MODELS: daftar dipisah koma.
//   QWEN_BOT_MODELS      : daftar model khusus bot, dipisah koma
const envList = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const QWEN_MANUAL_KEYS = [...new Set([process.env.QWEN_MANUAL_API_KEY, ...QWEN_KEYS].filter(Boolean))];
const QWEN_MANUAL_MODELS = envList(process.env.QWEN_MANUAL_MODELS).length
  ? envList(process.env.QWEN_MANUAL_MODELS)
  : (process.env.QWEN_MANUAL_MODEL ? [process.env.QWEN_MANUAL_MODEL] : QWEN_MODELS);
const QWEN_BOT_MODELS = envList(process.env.QWEN_BOT_MODELS).length ? envList(process.env.QWEN_BOT_MODELS) : QWEN_MODELS;

const TL_KEY_NAMES = ['TICKERLAYER_API_KEY', ...Array.from({ length: 19 }, (_, i) => `TICKERLAYER_API_KEY_${i + 1}`)];
const API_KEYS = TL_KEY_NAMES.map(n => process.env[n] || '');
const TL_MAX_TRY = Math.max(1, Number(process.env.TICKERLAYER_MAX_TRY || 3));
const TL_TIMEOUT_MS = 6000;
const TL_DISABLED = process.env.TICKERLAYER_DISABLED === '1';
const CANDLE_CACHE_TTL_MS = 90 * 1000;

const DECIMALS = {
  DXY: 2, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5, USDCHF: 5, NZDUSD: 5,
  EURGBP: 5, EURJPY: 3, GBPJPY: 3, AUDJPY: 3, EURAUD: 5, GBPAUD: 5, AUDNZD: 5, CADJPY: 3, CHFJPY: 3, EURNZD: 5,
  XAUUSD: 2, XAGUSD: 3, XPTUSD: 2, XPDUSD: 2, XAUEUR: 2, XAGEUR: 3,
  BRENT: 2, WTI: 2, NATGAS: 3, COPPER: 4, COFFEE: 2, SUGAR: 2,
  US30: 2, NAS100: 2, SPX500: 2, GER40: 2, UK100: 2, JPN225: 0, FRA40: 2, AUS200: 2,
  BTCUSD: 2, ETHUSD: 2, SOLUSD: 2, XRPUSD: 4, BNBUSD: 2, ADAUSD: 4, DOGEUSD: 5, AVAXUSD: 3, LINKUSD: 3, DOTUSD: 4, MATICUSD: 4, UNIUSD: 3,
};
const CRYPTO_LIST = ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','ADAUSD','DOGEUSD','AVAXUSD','LINKUSD','DOTUSD','MATICUSD','UNIUSD'];
const GOLD_SYMBOLS = ['XAUUSD', 'XAUUSDX'];
const isGold = s => GOLD_SYMBOLS.includes(s);
const PIP_OVERRIDE = { XAUUSD: 0.1, XAUUSDX: 0.1, DXY: 0.01, US30: 1, NAS100: 1, BTCUSD: 1 };
const pipSizeOf = (symbol, dec) => PIP_OVERRIDE[symbol] ?? Math.pow(10, -(dec - 1));

const TL_SPAN = { '1m': { mult:1, span:'minute', minutes:1 }, '5m': { mult:5, span:'minute', minutes:5 }, '15m': { mult:15, span:'minute', minutes:15 }, '30m': { mult:30, span:'minute', minutes:30 }, '1h': { mult:1, span:'hour', minutes:60 }, '4h': { mult:4, span:'hour', minutes:240 }, '1d': { mult:1, span:'day', minutes:1440 } };
const TL_MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TL_ROUTE = { XAUUSD: ['commodities','XAUUSD'], XAUUSDX: ['commodities','XAUUSD'], XAGUSD: ['commodities','XAGUSD'], US30: ['indices','US30'], SPX500: ['indices','US500'], NAS100: ['indices','US100'] };

const TF_MS = { m1: 60000, m5: 300000, m15: 900000, m30: 1800000, h1: 3600000, h4: 14400000, d1: 86400000 };
const TF_IV = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' };
const TF_NEED = { d1: 60, h4: 80, h1: 100, m30: 100, m15: 200, m5: 200, m1: 200 };
const MIN_BARS = { m1: 60, m5: 40, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };

const MANUAL_TF_NEEDED = {
  'Scalping': ['m1', 'm5', 'm15', 'h1'],
  'Intraday': ['m15', 'h1', 'h4'],
  'Swing':    ['h4', 'd1'],
};
const BOT_TF_NEEDED = ['m1', 'm5', 'm15', 'h1'];
const MAX_DIST_PIP = { 'Scalping': 150, 'Intraday': 500, 'Swing': 2000 };
const MAX_DIST_OVERRIDE = { BTCUSD: 800, XAUUSD: 1000 };

const BOT_CFG = {
  storyTtlMs: 15000, storyTtlBotMs: 5 * 60e3, signalTtlMs: 15 * 60e3,
  flipCooldownMs: 5 * 60e3,        // sinyal berlawanan arah baru boleh menggantikan sinyal lama setelah 5 menit
  storyBudgetBotMs: 2500,          // respons bot tidak menunggu AI lebih dari 2,5 detik
  storyBudgetManualMs: 3000,
};
const MANUAL_STORY_TTL_MS = 180000;
const MANUAL_STANDBY_TTL_MS = 20000;
const GATE_TTL_MS = 10 * 60 * 1000;

const isoDate = d => d.toISOString().slice(0, 10);
function fail(res, reason, status = 200) { return res.status(status).json({ ok:false, reason, message:reason, msg:reason, error:reason }); }

async function httpJson(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, data, text };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout: layanan eksternal lama merespons');
    throw e;
  } finally { clearTimeout(timer); }
}

const MSG = {
  id: { noEmail:'Email tidak ditemukan.', notRegistered:'Email belum terdaftar.', expired:'Masa akses berakhir.', kvError:'Layanan akses bermasalah.', trialLimit:'Batas trial habis.', noPrice:'Harga live belum tersedia.', noCandles:'Data candle belum cukup.', noSetup:'Belum ada setup valid.', noKey:'OPENAI_API_KEY belum diatur.', badImage:'Gambar tidak valid.' },
  en: { noEmail:'Email not found.', notRegistered:'Email not registered.', expired:'Access expired.', kvError:'Access service issue.', trialLimit:'Trial limit reached.', noPrice:'Live price unavailable.', noCandles:'Insufficient candles.', noSetup:'No valid setup.', noKey:'OPENAI_API_KEY not set.', badImage:'Invalid image.' },
};
const msg = (lang, key) => ((MSG[lang] || MSG.id)[key] || key);
const markTrialAsUsed = markTrialBotUsed;

// ── DATA CANDLE & CACHE ──
const tlCooldown = new Map();
const candleCache = new Map();

function setCandleCache(symbol, tf, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  candleCache.set(`${symbol}:${tf}`, { t: Date.now(), rows });
  if (candleCache.size > 400) candleCache.delete(candleCache.keys().next().value);
}

function getCandleCache(symbol, tf) {
  const hit = candleCache.get(`${symbol}:${tf}`);
  if (!hit) return [];
  if (Date.now() - hit.t > CANDLE_CACHE_TTL_MS) return [];
  return hit.rows;
}

async function tlGet(url) {
  if (TL_DISABLED) return null;
  const now = Date.now();
  const usable = API_KEYS.map((_, i) => i).filter(i => API_KEYS[i] && (tlCooldown.get(i) || 0) <= now).slice(0, TL_MAX_TRY);
  for (const i of usable) {
    try {
      const r = await httpJson(url, { headers: { 'x-api-key': API_KEYS[i] } }, TL_TIMEOUT_MS);
      if (r.status === 429) { tlCooldown.set(i, Date.now() + 60000); continue; }
      if (r.ok && r.data) return r.data;
    } catch (e) { console.warn(`TL key ${i}:`, e.message); }
  }
  return null;
}
function tlCandidate(symbol) {
  const s = symbol.toUpperCase().trim();
  if (TL_ROUTE[s]) { const [asset, sym] = TL_ROUTE[s]; return { asset, symbol: sym }; }
  if (CRYPTO_LIST.includes(s)) return { asset: 'crypto', symbol: s };
  return { asset: 'forex', symbol: s };
}
function toEpochMs(v) {
  if (typeof v === 'string' && Number.isNaN(Number(v))) return Date.parse(v) || 0;
  const n = Number(v); return n < 1e11 ? n * 1000 : n;
}
function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(c => ({ t: Number(c?.t ?? c?.time), o: Number(c?.o ?? c?.open), h: Number(c?.h ?? c?.high), l: Number(c?.l ?? c?.low), c: Number(c?.c ?? c?.close) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}
async function fetchTickerLayerRows(symbol, interval, need) {
  const tf = TL_SPAN[interval]; if (!tf) return [];
  const cand = tlCandidate(symbol);
  const now = Date.now();
  const windowMs = Math.max(need * 1.2 * tf.minutes * 60000, TL_MIN_WINDOW_MS) + 86400000;
  const startMs = now - windowMs;
  const url = `${TICKERLAYER_BASE_URL}/${cand.asset}/agg/${cand.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(startMs))}/${isoDate(new Date(now + 86400000))}?sort=desc&limit=5000`;
  const data = await tlGet(url);
  if (!data) return [];
  const raw = Array.isArray(data) ? data : (data.results || []);
  const rows = raw.map(bar => ({ t: toEpochMs(bar.t ?? bar.timestamp), o: bar.o ?? bar.open, h: bar.h ?? bar.high, l: bar.l ?? bar.low, c: bar.c ?? bar.close }));
  return cleanCandles(rows).slice(-Math.max(1, Math.ceil(need)));
}
function clientCandles(body, tf) {
  const c = body?.candles || {};
  const rows = c[tf] ?? body?.[tf];
  return Array.isArray(rows) ? cleanCandles(rows) : [];
}
const tsMs = t => (t < 1e12 ? t * 1000 : t);
function closedOnly(c, ms) {
  if (!c || !c.length) return c || [];
  return Date.now() < tsMs(c[c.length - 1].t) + ms ? c.slice(0, -1) : c;
}
function getFormingM1(m1) {
  if (!Array.isArray(m1) || !m1.length) return null;
  const forming = m1[m1.length - 1];
  return forming && Date.now() < tsMs(forming.t) + TF_MS.m1 ? forming : null;
}

function getKillzoneStatus(nowMs = Date.now()) {
  try {
    const ny = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const m = ny.getHours() * 60 + ny.getMinutes();
    if (m >= 120 && m <= 300) return { active: true, name: 'London KZ' };
    if (m >= 420 && m <= 600) return { active: true, name: 'New York KZ' };
    if (m >= 600 && m <= 660) return { active: true, name: 'Silver Bullet KZ' };
    return { active: false, name: 'di luar KZ' };
  } catch { return { active: true, name: 'sesi aktif' }; }
}

const safeNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function toSignal(plan, ctx, extra) {
  const f = v => Number(safeNum(v, 0).toFixed(ctx.dec));
  const isMarket = plan.orderType === 'MARKET';
  const tps = Array.isArray(plan.tps) && plan.tps.length >= 3 ? plan.tps : [plan.entry, plan.entry, plan.entry];
  return {
    signal: plan.dir === 1 ? 'BUY' : 'SELL',
    orderType: plan.orderType,
    fill: isMarket ? 'NOW' : 'LIMIT',
    status: isMarket ? 'RUNNING' : 'PENDING',
    entry: f(plan.entry), sl: f(plan.sl), tp1: f(tps[0]), tp2: f(tps[1]), tp3: f(tps[2]),
    invalidLevel: plan.invalidLevel != null ? f(plan.invalidLevel) : null,
    setup: plan.setup || '',
    confidence: extra.confidence || 'MEDIUM',
    risk: extra.risk || 'MEDIUM',
    zone: plan.zone ? { min: f(plan.zone.lower), max: f(plan.zone.upper), timeframe: plan.zone.timeframe || '' } : null,
    zoneLabel: plan.zone ? plan.zone.label : '',
    zoneNote: '',
    chartContext: `${plan.setup || 'Signal'}: ${isMarket ? 'NOW' : 'LIMIT'} ${f(plan.entry)}`,
    rr: Number(safeNum(plan.rr, 1).toFixed(2)),
    tpMode: plan.tpMode || null,
    riskPips: plan.riskPips != null ? Number(Number(plan.riskPips).toFixed(1)) : null,
    checklist: extra.checklist || [],
    scanSummary: extra.scanSummary || '',
    topDown: extra.topDown || null,
    state: isMarket ? 'CONFIRMED' : 'LIMIT_PLACED',
    score: null,
    reason: '', reasons: { id: '', en: '' }, aiReasoning: false, reasonSource: null,
  };
}
function standbyOut(facts, standbyReason, checklist, topDown) {
  return {
    signal: {
      signal: 'NONE', orderType: 'NONE', fill: 'NONE', status: 'STANDBY',
      entry: null, sl: null, tp1: null, tp2: null, tp3: null, invalidLevel: null,
      setup: 'STANDBY / SCANNING', confidence: 'NONE', risk: 'NONE',
      zone: null, zoneLabel: '', zoneNote: '', chartContext: '',
      checklist: checklist || [], scanSummary: (checklist || []).join('\n'),
      topDown: topDown || null, state: 'STANDBY', score: null,
      reason: '', reasons: { id: '', en: '' }, aiReasoning: false, reasonSource: null,
    },
    facts: { ...facts, status: 'STANDBY', standbyReason },
  };
}

// ── MANUAL ENGINE ──
const DOC_STYLE_LABEL = {
  'Scalping': 'Scalping SMC (Zona M5)', 'Intraday': 'Intraday', 'Swing': 'Swing S&D/OB',
};
const DOC_STYLE_TF = {
  'Scalping': { htf: 'M5 Struktur', zone: 'S&D / FVG M5', trig: 'M5' },
  'Intraday': { htf: 'H4',          zone: 'VWAP M15',     trig: 'M15' },
  'Swing':    { htf: 'D1',          zone: 'S&D/OB H4+D1', trig: 'H4' },
};

const gateCache = new Map();

function legView(l, ctx) {
  const f = v => Number(safeNum(v, 0).toFixed(ctx.dec));
  return {
    signal: l.side === 'buy' ? 'BUY' : 'SELL',
    role: l.role || 'main',
    orderType: l.orderType,
    entry: f(l.entryPrice), sl: f(l.sl),
    tp1: f(l.tp1), tp2: f(l.tp2), tp3: f(l.tp3),
    tpMode: l.tpMode || null,
    riskPips: l.riskPips != null ? Number(Number(l.riskPips).toFixed(1)) : null,
    invalidLevel: f(l.invalidLevel),
    reason: l.reason,
  };
}

async function runDocManual(ctx, d, styleName) {
  const tf = DOC_STYLE_TF[styleName] || DOC_STYLE_TF['Scalping'];
  const facts = {
    mode: 'manual', symbol: ctx.symbol, style: styleName, kz: ctx.kz.name, price: ctx.f(ctx.price),
    htfTf: tf.htf, zoneTf: tf.zone, trigTf: tf.trig, dec: ctx.dec,
  };
  const closed = {
    m1: closedOnly(d.m1, TF_MS.m1),
    m5: closedOnly(d.m5, TF_MS.m5), m15: closedOnly(d.m15, TF_MS.m15), m30: closedOnly(d.m30, TF_MS.m30),
    h1: closedOnly(d.h1, TF_MS.h1), h4: closedOnly(d.h4, TF_MS.h4), d1: closedOnly(d.d1, TF_MS.d1),
  };
  facts.watch = styleName === 'Scalping'
    ? scalpWatch({ m1: closed.m1, m5: closed.m5 }, { price: ctx.price, pip: ctx.pip, dec: ctx.dec, symbol: ctx.symbol })
    : buildWatchlist({ ...closed, price: ctx.price, pip: ctx.pip, styleName });
  facts.syarat = SYARAT_MASUK[styleName] || null;

  const live = getFormingM1(d.m1);
  const barsClosed = { m1: closed.m1, m5: closed.m5, m15: closed.m15, h1: closed.h1, live };
  let out = { ok: false, checks: [] };

  if (styleName === 'Scalping') {
    const pctx = { price: ctx.price, dec: ctx.dec, pip: ctx.pip, now: Date.now(), symbol: ctx.symbol };
    out = simpleZonePlan(barsClosed, pctx, { tfs: ['M5'] });
    if (!out.ok) {
      const st = scalpStructPlan(barsClosed, pctx);
      out = st.ok ? st : { ...out, checks: [...(out.checks || []), ...(st.checks || [])] };
    }
    if (!out.ok) {
      const fx = flexScalpPlan(barsClosed, pctx);
      out = fx.ok ? fx : { ...out, checks: [...(out.checks || []), ...(fx.checks || [])] };
    }
    if (!out.ok) {
      const pb = pullbackPlan(barsClosed, pctx);
      out = pb.ok ? pb : { ...out, checks: [...(out.checks || []), ...(pb.checks || [])] };
    }
  } else {
    out = generateManualPlan({
      ...closed, tickSize: 10 ** -ctx.dec, price: ctx.price, pip: ctx.pip, rr: ctx.rr, symbol: ctx.symbol,
    }, styleName);
  }

  const rawBias = out.bias || (out.regime ? out.regime.replace('_', ' ') : 'netral');
  const srcPart = out.biasTf ? ` · ${out.biasTf}` : (out.regimeSrc ? ` · ${out.regimeSrc}` : '');
  const regimeTxt = `${rawBias}${srcPart}`;
  facts.bias = regimeTxt;
  const checks = Array.isArray(out.checks) ? out.checks : [];

  if (!out.ok) {
    const why = out.reason || (checks.length ? checks[checks.length - 1] : 'Belum ada setup valid.');
    facts.standbyReason = why;
    facts.checklist = checks.slice(-6);
    return standbyOut(facts, why, checks, regimeTxt);
  }

  const o = out.order;
  const dir = o.side === 'buy' ? 1 : -1;
  const sideTxt = dir === 1 ? 'BUY' : 'SELL';
  const isCounter = o.role === 'counter';
  const isBounce = o.role === 'bounce';
  const z = out.zone;
  const plan = {
    dir, entry: o.entryPrice, sl: o.sl, orderType: o.orderType || 'LIMIT',
    tps: [o.tp1, o.tp2, o.tp3], rr: o.rr, tpMode: o.tpMode, riskPips: o.riskPips, invalidLevel: o.invalidLevel,
    setup: `Manual · ${DOC_STYLE_LABEL[styleName] || styleName} · ${o.reason}`,
    zone: z ? { lower: z.bottom, upper: z.top, timeframe: z.timeframe || '', label: `${z.timeframe} ${z.type}`, mid: (z.top + z.bottom) / 2 } : null,
  };

  const arahHtf = out.regime === 'trending_up' ? 'BUY' : out.regime === 'trending_down' ? 'SELL' : 'NETRAL';
  const refPx = closed.m1.length ? closed.m1[closed.m1.length - 1].c : ctx.price;
  const jarakPip = Math.round(Math.abs(refPx - o.entryPrice) / ctx.pip);
  const maxDist = MAX_DIST_OVERRIDE[ctx.symbol] ?? MAX_DIST_PIP[styleName] ?? 150;
  let gate;

  if (styleName === 'Scalping') {
    gate = { keputusan: 'AMBIL', alasan: 'Scalping zona/struktur valid', ai: false };
  } else if (isBounce) {
    gate = { keputusan: 'AMBIL', alasan: 'Bounce scalp di zona S&D fresh', ai: false };
  } else if (out.regime === 'choppy') {
    gate = { keputusan: 'TUNGGU', alasan: 'Market Structure HTF choppy/belum searah.', ai: false };
  } else if (!isCounter && arahHtf !== 'NETRAL' && arahHtf !== sideTxt) {
    gate = { keputusan: 'TUNGGU', alasan: `Arah setup ${sideTxt} berlawanan dengan bias HTF ${arahHtf}.`, ai: false };
  } else if (jarakPip > maxDist) {
    gate = { keputusan: 'TUNGGU', alasan: `Entry ${jarakPip} pip dari harga, melebihi batas ${maxDist} pip.`, ai: false };
  } else {
    const gKey = `${ctx.symbol}|${styleName}|${sideTxt}|${o.role}|${plan.orderType}|${ctx.f(o.entryPrice)}|${o.tpMode}|${out.oco ? 'oco' : ''}`;
    const hit = gateCache.get(gKey);
    if (hit && Date.now() - hit.t < hit.ttl) gate = hit.v;
    else {
      gate = await aiGateManual({
        gaya: styleName, simbol: ctx.symbol, arah_setup: sideTxt,
        role: o.role || 'main', oco: !!out.oco, tipe_order: plan.orderType,
        arah_htf: arahHtf, regime_htf: out.regime || 'neutral', regime_sumber: out.regimeSrc || null,
        alasan_aturan: o.reason,
        zona: z ? { jenis: `${z.timeframe} ${z.type}`, bawah: ctx.f(z.bottom), atas: ctx.f(z.top), fresh: !!z.fresh } : null,
        entry: ctx.f(o.entryPrice), harga_sekarang: ctx.f(ctx.price),
        jarak_entry_pip: jarakPip, batas_jarak_pip: maxDist,
      });
      gateCache.set(gKey, { t: Date.now(), ttl: gate.ai ? GATE_TTL_MS : 60e3, v: gate });
      if (gateCache.size > 200) gateCache.delete(gateCache.keys().next().value);
    }
  }

  if (gate.keputusan !== 'AMBIL') {
    const why = `Gate TUNGGU: ${gate.alasan}`;
    facts.standbyReason = why;
    facts.gateDecision = 'TUNGGU';
    return standbyOut(facts, why, checks, regimeTxt);
  }

  plan.setup = `${plan.setup}${gate.ai ? ' · AI AMBIL' : ''}`;
  const sig = toSignal(plan, ctx, {
    confidence: o.confirmed && z?.fresh ? 'HIGH' : 'MEDIUM', risk: 'MEDIUM',
    checklist: checks, topDown: regimeTxt,
  });
  sig.expiresAt = Number.isFinite(Number(o.expiryTime)) ? Number(o.expiryTime) : Date.now() + (VISION_EXPIRY_MS[styleName] || 30 * 60e3);
  sig.symbol = ctx.symbol;
  sig.style = styleName;
  sig.role = o.role || 'main';
  if (out.oco) {
    sig.oco = { rule: out.oco.rule, legs: out.oco.legs.map(l => legView(l, ctx)) };
  }

  facts.signal = sideTxt;
  facts.role = o.role || 'main';
  facts.orderType = plan.orderType;
  facts.entry = sig.entry;
  facts.sl = sig.sl;
  facts.tp = [sig.tp1, sig.tp2, sig.tp3];
  facts.rr = Number(o.rr).toFixed(2);
  facts.tpMode = o.tpMode;
  facts.riskPips = sig.riskPips;
  facts.trigger = o.reason;
  facts.confirmed = !!o.confirmed;
  if (sig.oco) facts.oco = sig.oco;
  if (plan.zone) facts.zone = { label: plan.zone.label, lower: sig.zone.min, upper: sig.zone.max };
  return { signal: sig, facts: { ...facts, status: sig.status } };
}

function runManual(ctx, d, styleName) {
  return runDocManual(ctx, d, styleName);
}

function legFields(l) {
  return {
    signal: l.signal, orderType: l.orderType,
    fill: l.orderType === 'MARKET' ? 'NOW' : 'LIMIT',
    entry: l.entry, sl: l.sl, tp1: l.tp1, tp2: l.tp2, tp3: l.tp3,
    tpMode: l.tpMode, riskPips: l.riskPips,
    invalidLevel: l.invalidLevel, role: l.role,
  };
}

function resolveOcoFill(prev, price) {
  const legs = prev.oco.legs;
  const aliveIdx = legs.map((_, i) => i).filter(i => {
    const l = legs[i];
    return l.signal === 'BUY'
      ? price > Math.max(l.sl, l.invalidLevel ?? -Infinity)
      : price < Math.min(l.sl, l.invalidLevel ?? Infinity);
  });
  if (!aliveIdx.length) return null;

  const filledIdx = aliveIdx.find(i => {
    const l = legs[i];
    return l.signal === 'BUY' ? price <= l.entry : price >= l.entry;
  });

  if (filledIdx !== undefined) {
    const l = legs[filledIdx];
    return {
      ...prev, ...legFields(l),
      status: 'RUNNING', state: 'FILLED',
      chartContext: `${l.signal} FILLED ${l.entry}`,
      oco: { ...prev.oco, filled: filledIdx, cancelled: legs.map((_, i) => i).filter(i => i !== filledIdx) },
    };
  }

  const primary = aliveIdx.includes(0) ? legs[0] : legs[aliveIdx[0]];
  return { ...prev, ...legFields(primary), oco: { ...prev.oco, alive: aliveIdx } };
}

function validPrevSignal(prev, symbol, styleName, price, pip) {
  if (!prev || typeof prev !== 'object') return null;
  if (!['PENDING', 'RUNNING'].includes(prev.status) || (prev.signal !== 'BUY' && prev.signal !== 'SELL')) return null;
  if (prev.symbol !== symbol || prev.style !== styleName) return null;
  const exp = Number(prev.expiresAt);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const maxDist = MAX_DIST_OVERRIDE[symbol] ?? MAX_DIST_PIP[styleName] ?? 150;
  if (prev.status === 'PENDING' && Math.abs(Number(prev.entry) - price) > maxDist * pip) return null;

  if (Array.isArray(prev.oco?.legs) && prev.oco.legs.length) return resolveOcoFill(prev, price);

  const sl = Number(prev.sl), tp1 = Number(prev.tp1), entry = Number(prev.entry);
  const inv = prev.invalidLevel != null ? Number(prev.invalidLevel) : null;
  if (![sl, tp1, entry].every(Number.isFinite)) return null;
  if (prev.signal === 'BUY' && (price <= sl || price >= tp1 || (inv !== null && price < inv))) return null;
  if (prev.signal === 'SELL' && (price >= sl || price <= tp1 || (inv !== null && price > inv))) return null;
  return prev;
}

// ── BOT ENGINE ──
function runBot(ctx, d) {
  const m1 = closedOnly(d.m1, TF_MS.m1);
  const m5 = closedOnly(d.m5, TF_MS.m5);
  const m15 = closedOnly(d.m15, TF_MS.m15);
  const live = getFormingM1(d.m1);
  const h1 = closedOnly(d.h1, TF_MS.h1);
  const bars = { m1, m5, m15, h1, live };
  const r = runBotFlex(bars, { price: ctx.price, dec: ctx.dec, pip: ctx.pip, symbol: ctx.symbol, prevCandleT: ctx.prevCandleT ?? null });
  const F = v => ctx.f(safeNum(v, ctx.price));

  const watch = scalpWatch({ m1: bars.m1, m5: bars.m5 }, { price: ctx.price, pip: ctx.pip, dec: ctx.dec, symbol: ctx.symbol });

  const facts = {
    mode: 'bot', symbol: ctx.symbol, style: 'Scalping', kz: ctx.kz.name, dec: ctx.dec,
    price: F(ctx.price), bias: r.bias || 'NETRAL', dirTxt: r.dirTxt || '-',
    trigger: r.trigger || null, checklist: Array.isArray(r.checklist) ? r.checklist : [],
    htf: r.trendTxt || '-', m1: r.structTxt || '-', zone: null,
    watch: [],   // bot EA tidak memakai zona
    tier: r.tier || 'EA_PULLBACK',
    status: r.ok ? 'SIGNAL' : 'STANDBY',
  };
  if (!r || !r.ok) return standbyOut(facts, r?.reason || 'Menunggu setup valid.', facts.checklist, facts.bias);

  const tpsArr = Array.isArray(r.tps) && r.tps.length >= 3 ? r.tps : [r.entry, r.entry, r.entry];
  const plan = {
    dir: r.dir, entry: safeNum(r.entry, ctx.price), sl: safeNum(r.sl, ctx.price),
    tps: tpsArr, rr: safeNum(r.rr, 1.5), tpMode: r.tpMode || 'RR',
    orderType: r.orderType || 'MARKET', setup: r.setup || 'Bot Signal',
    zone: r.zone ? { lower: r.zone.bottom, upper: r.zone.top, timeframe: r.zone.timeframe || '', label: `${r.zone.timeframe} ${r.zone.type}`, mid: (r.zone.top + r.zone.bottom) / 2 } : null,
  };
  const out = toSignal(plan, ctx, {
    confidence: r.confidence || 'HIGH',
    risk: ['LOOSE', 'MOMENTUM', 'PEMBALIKAN'].includes(r.tier) ? 'HIGH' : 'MEDIUM',
    checklist: facts.checklist, scanSummary: facts.checklist.join('\n'), topDown: facts.bias,
  });
  out.tier = r.tier || 'STRICT';
  out.candleT = r.candleT ?? null;
  out.symbol = ctx.symbol;
  out.style = 'Scalping';
  out.expiresAt = Number.isFinite(Number(r.expiresAt)) ? Number(r.expiresAt) : Date.now() + BOT_CFG.signalTtlMs;
  facts.tier = out.tier;
  facts.signal = r.dirTxt;
  facts.role = r.role || 'main';
  facts.orderType = plan.orderType;
  facts.status = out.status;
  facts.entry = F(plan.entry);
  facts.sl = F(plan.sl);
  facts.tp = tpsArr.map(F);
  facts.rr = Number(plan.rr).toFixed(2);
  facts.zone = plan.zone ? { label: plan.zone.label, lower: plan.zone.lower, upper: plan.zone.upper } : null;
  return { signal: out, facts };
}

// ── AI REASONING ──
const SYS_MANUAL = `Kamu adalah konsultan analis trading spesialis SMC (Market Structure, Fibonacci OTE, Order Block, FVG, Supply & Demand) yang menjelaskan hasil scan sistem secara faktual dan santai.
ATURAN MUTLAK ANTI-HALUSINASI:
1. DILARANG KERAS mengarang atau mengubah angka harga yang TIDAK ADA di dalam JSON input. Salin angka persis dari JSON.
2. DILARANG mengubah tipe order (jika orderType = "MARKET" sebut eksekusi sekarang; jika orderType = "LIMIT" sebut pending LIMIT).
3. Jika role = "counter": jelaskan bahwa ini counter-trend yang valid karena struktur M5 dan zona pantulan sendiri, dan targetnya mengarah ke zona utama.
4. Jika role = "bounce": jelaskan bahwa ini bounce scalp di zona Supply/Demand fresh, tanpa konfirmasi CHoCH M5, dan tunggu harga menyentuh zona.
5. Jika field oco ada: jelaskan dua limit (legs) beserta angkanya, dan bahwa jika salah satu terisi, yang lain dibatalkan.
6. Jika tpMode ada: sebutkan bahwa TP mengikuti band risk (riskPips) beserta rasio TP-nya.
7. Jika status = "RUNNING" atau "PENDING": sebutkan arah, bias H1 (bias), zona POI, serta angka persis entry, SL, dan TP. Jika confirmed = false, sebutkan bahwa konfirmasi M1 belum ada.
8. Jika status = "STANDBY": sebutkan alasan dari standbyReason, checklist yang OK dan yang BELUM, zona dari watch (jika ada), dan syarat dari syarat.
9. Pakai "saya" atau "kita". JANGAN pakai daftar/bullet atau tanda bintang (*). WAJIB tulis 4 sampai 6 kalimat lengkap.
Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}.`;

const SYS_BOT_EA = `Kamu adalah mentor trading yang menjelaskan keputusan bot scalper SMC (zona M5 dengan refine M1, struktur M1, CHoCH M1) dengan bahasa santai dan mengalir.
ATURAN MUTLAK:
1. DILARANG mengarang atau mengubah angka yang tidak ada di JSON input. Salin angka persis dari JSON.
2. JANGAN pakai bullet, daftar, atau tanda bintang. Tulis paragraf utuh, 4 sampai 6 kalimat.
3. Jelaskan alur bot: bias HTF (field "htf" dan "bias"), zona M5 (field "zone"), struktur M1 (field "m1"), dan pemicunya (field "trigger").
4. Jika STANDBY: sebutkan persis syarat yang BELUM terpenuhi dari "checklist" dan "standbyReason".
5. Jika RUNNING/PENDING: sebutkan arah, entry, SL, dan TP persis dari JSON. Jelaskan orderType: MARKET berarti eksekusi sekarang, LIMIT berarti pending di zona.
6. Jangan sebut EMA atau SMA. Bot ini tidak memakainya.
7. Pakai kata "saya" atau "kita".
Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}.`;

const SYS_BOT = `Kamu adalah mentor trading senior spesialis SMC (Market Structure, Order Block, FVG, Supply & Demand) yang sedang menjelaskan analisa bot scalper ke muridnya dengan gaya bercerita (story telling) yang santai, dinamis, dan mengalir.
ATURAN MUTLAK:
1. DILARANG KERAS mengarang atau mengubah angka harga yang tidak ada di JSON input. Salin angka persis dari JSON.
2. JANGAN gunakan bullet points, daftar angka, atau tanda bintang (*). Tulis dalam bentuk paragraf utuh yang mengalir (minimal 5-7 kalimat).
3. Buka cerita dengan kondisi HTF (H1/H4) berdasarkan field "bias" dan "htf". Sebutkan time framenya, apakah sedang tren naik, turun, atau ranging. Apakah terjadi BOS, MSS, atau CHoCH?
4. Lanjut ke M5/M1 berdasarkan field "checklist" dan "m1": Jelaskan rencana scalping-nya. Apakah bot menunggu harga retracement ke area POI utama, ke area Fibonacci OTE, atau ke Supply/Demand utama? Jika ada field "watch", sebutkan zona Supply/Demand yang sedang dipantau beserta harga batas bawah dan atasnya.
5. Berikan skenario dinamis: Jika harga reversal, apa rencananya? Jika lanjut tren (continuation), targetnya ke mana? Sebutkan syarat konfirmasi struktur yang jelas (misal: tunggu candle close di atas/bawah level X).
6. Jika bot sedang STANDBY (belum entry): Jelaskan dengan santai apa yang sedang ditunggu berdasarkan field "checklist" dan "watch". Misal: "Bot kita sedang sabar menunggu, karena POI di OTE baru terkumpul 1 dari 2 syarat, dan kita memantau zona Supply di harga X..."
7. Jika bot sedang RUNNING/PENDING: Jelaskan arah, tier (STRICT/LOOSE/MOMENTUM/KONTINUITAS/PEMBALIKAN), trigger, entry, SL, dan TP persis dari JSON. Jika tier PEMBALIKAN, tegaskan bahwa arahnya melawan bias H1 dan hanya valid karena struktur sweep dan CHoCH M5.
8. Gunakan kata "saya" atau "kita". 
Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}.`;

const NUM_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

function parseNum(tok) {
  let s = String(tok);
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return Number(s);
}

function collectNums(v, out = []) {
  if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  else if (typeof v === 'string') {
    for (const t of v.match(NUM_RE) || []) { const n = parseNum(t); if (Number.isFinite(n)) out.push(n); }
  } else if (Array.isArray(v)) v.forEach(x => collectNums(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => collectNums(x, out));
  return out;
}

function findUnknownPrice(text, facts) {
  try {
    if (!text || typeof text !== 'string') return null;
    const price = Number(facts?.price);
    if (!(price > 0)) return null;
    const allowed = collectNums(facts);
    const dec = Number.isFinite(facts?.dec) ? facts.dec : 2;
    const tol = dec >= 2 ? 0.5 * Math.pow(10, -(dec - 1)) : 0.6 * Math.pow(10, -dec);   // AI sering membulatkan 1 desimal
    for (const t of text.match(NUM_RE) || []) {
      const n = parseNum(t);
      if (!Number.isFinite(n)) continue;
      if (Math.abs(n - price) / price >= 0.05) continue;
      if (!allowed.some(a => Math.abs(a - n) <= tol)) return t;
    }
    return null;
  } catch { return null; }
}

function extractContent(data) {
  const c = data?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => p?.text || '').join('');
  return '';
}
function stripThink(s) {
  return String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
function parseJsonLoose(text) {
  const s = String(text || '').replace(/```json|```/gi, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function qwenJson(sys, userObj, maxTokens = QWEN_MAX_TOKENS, deadlineMs = QWEN_DEADLINE_MS, models = QWEN_MODELS, keys = QWEN_KEYS) {
  if (!keys.length) return { json: null, error: 'API key AI belum diatur (QWEN_API_KEY / OPENAI_API_KEY)' };
  const user = JSON.stringify(userObj);
  const deadline = Date.now() + deadlineMs;
  let lastErr = 'semua model gagal';
  for (const m of models) {
    for (const k of keys.slice(0, 2)) {
      const left = deadline - Date.now();
      if (left < 2500) return { json: null, error: `timeout AI (sisa ${left} ms)` };
      try {
        const r = await httpJson(`${QWEN_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: m, max_tokens: maxTokens, temperature: 0.1,
            messages: [
              { role: 'system', content: sys + '\nBalas hanya objek JSON tanpa penjelasan dan tanpa markdown.' },
              { role: 'user', content: user },
            ],
          }),
        }, Math.min(QWEN_TIMEOUT_MS, left));
        if (!r.ok) {
          lastErr = `${m} HTTP ${r.status}: ${(r.data?.error?.message || r.text || '').slice(0, 160)}`;
          console.warn('qwenJson:', lastErr);
          continue;
        }
        const raw = stripThink(extractContent(r.data));
        const parsed = parseJsonLoose(raw);
        if (parsed && parsed.id && parsed.en) return { json: parsed, error: '' };
        const finish = r.data?.choices?.[0]?.finish_reason || '-';
        lastErr = raw
          ? `${m}: respons bukan JSON {id,en}. Potongan: ${raw.slice(0, 120)}`
          : `${m}: respons kosong (finish_reason=${finish})`;
        console.warn('qwenJson:', lastErr);
      } catch (e) {
        lastErr = `${m}: ${e.message}`;
        console.warn('qwenJson:', lastErr);
      }
    }
  }
  return { json: null, error: lastErr };
}

function fbZone(f, id) {
  if (!f.zone) return id ? `area ${f.zoneTf || f.trigTf}` : `${f.zoneTf || f.trigTf} area`;
  return id ? `zona ${f.zone.label} di ${f.zone.lower}–${f.zone.upper}` : `${f.zone.label} zone at ${f.zone.lower}–${f.zone.upper}`;
}

function fbWatch(f, id) {
  const list = (f.watch || []).map(w => `${w.tf} ${w.tipe} ${w.bawah}–${w.atas} (${w.status}, ${w.di_dalam ? 'harga di dalam' : w.jarak_pip + ' pip'})`).join('; ');
  if (!list) return id ? 'Belum ada zona POI fresh di dekat harga.' : 'No fresh POI zone near price yet.';
  return id ? `Zona yang sedang saya pantau: ${list}.` : `Zones currently watched: ${list}.`;
}

function fallbackStory(f, lang) {
  const id = lang === 'id';
  if (f.mode === 'manual') {
    if (f.status === 'STANDBY') {
      const checkTxt = (f.checklist || []).slice(0, 4).join(' ');
      return id
        ? `Saya masih menunggu setup valid di ${f.symbol}. Bias saat ini ${f.bias}. ${f.standbyReason || ''} ${checkTxt} ${fbWatch(f, true)}`
        : `I am still waiting for a valid setup on ${f.symbol}. Current bias is ${f.bias}. ${f.standbyReason || ''} ${checkTxt} ${fbWatch(f, false)}`;
    }
    const now = f.orderType === 'MARKET';
    const bandTxt = f.tpMode && f.tpMode !== 'RR' && f.tpMode !== 'SWING_INTRADAY'
      ? ` (TP band ${f.tpMode === 'LOW_RISK' ? '1:1.5/1:2.5/1:4' : '1:1/1:2/1:3'}, risk ${f.riskPips} pip)`
      : '';
    const roleTxt = f.role === 'bounce' ? 'Bounce scalp' : f.role === 'counter' ? 'Counter-trend' : 'Main';
    return id
      ? `${roleTxt} ${f.signal} valid di ${f.symbol} dengan bias ${f.bias} pada ${fbZone(f, true)} (${f.trigger}). ${now ? `Eksekusi MARKET sekarang di ${f.entry}` : `Pasang pending LIMIT di ${f.entry}`}, SL di ${f.sl}, dan target TP di ${f.tp[0]}, ${f.tp[1]}, serta ${f.tp[2]}${bandTxt}.`
      : `${roleTxt} ${f.signal} valid on ${f.symbol} aligned with ${f.bias} bias at ${fbZone(f, false)} (${f.trigger}). ${now ? `Execute MARKET now at ${f.entry}` : `Place pending LIMIT at ${f.entry}`}, SL at ${f.sl}, and targets at ${f.tp[0]}, ${f.tp[1]}, and ${f.tp[2]}${bandTxt}.`;
  }
  if (f.signal === 'BUY' || f.signal === 'SELL') {
    const now = f.orderType === 'MARKET';
    return id
      ? `Sinyal ${f.dirTxt} bot aktif melalui ${f.trigger}. ${now ? `Eksekusi MARKET di ${f.entry}` : `Pasang LIMIT di ${f.entry}`}, SL di ${f.sl}, dan TP di ${f.tp[0]}, ${f.tp[1]}, ${f.tp[2]}. ${fbWatch(f, true)}`
      : `Bot ${f.dirTxt} signal triggered via ${f.trigger}. ${now ? `Execute MARKET at ${f.entry}` : `Place LIMIT at ${f.entry}`}, SL at ${f.sl}, and TP at ${f.tp[0]}, ${f.tp[1]}, ${f.tp[2]}. ${fbWatch(f, false)}`;
  }
  const checkTxt = (f.checklist || []).slice(0, 3).join(' ');
  return id
    ? `Bot sedang memantau ${f.symbol} M1. Bias HTF ${f.bias}. Status: ${f.m1 || '-'}. ${f.standbyReason || ''} ${checkTxt} ${fbWatch(f, true)}`
    : `Bot is scanning ${f.symbol} M1. HTF bias ${f.bias}. Status: ${f.m1 || '-'}. ${f.standbyReason || ''} ${checkTxt} ${fbWatch(f, false)}`;
}

function isUsableStory(s, facts) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 40) return false;
  if (t.split(/\s+/).length < 6) return false;
  if (facts?.symbol && t.toUpperCase() === String(facts.symbol).toUpperCase()) return false;
  return true;
}

const storyCache = new Map();
const aiStickyCache = new Map();
const AI_STICKY_MS = 3 * 60 * 1000;
const sv = v => (v == null ? '' : String(v));
function setupKey(f) {
  return [f.mode, f.symbol, f.style, f.status, f.signal, f.entry, f.sl, f.trigger, f.tier, f.bias, f.standbyReason].map(sv).join('|');
}

async function getStory(facts, cacheKey, ttl = BOT_CFG.storyTtlMs) {
  if (cacheKey) {
    const hit = storyCache.get(cacheKey);
    if (hit && Date.now() - hit.t < hit.ttl) return hit.v;
  }
  const key = setupKey(facts);
  let story = null, aiError = '';
  try {
    const deadlineMs = facts.mode === 'manual' ? QWEN_MANUAL_DEADLINE_MS : QWEN_DEADLINE_MS;
    const isBotStory = facts.mode === 'bot';
    const { json, error } = await qwenJson(
      isBotStory ? SYS_BOT_EA : SYS_MANUAL, facts, QWEN_MAX_TOKENS, deadlineMs,
      isBotStory ? QWEN_BOT_MODELS : QWEN_MANUAL_MODELS,
      isBotStory ? QWEN_KEYS : QWEN_MANUAL_KEYS,
    );
    if (!json) aiError = error || 'AI tidak memberi jawaban';
    else if (!isUsableStory(json.id, facts) || !isUsableStory(json.en, facts)) {
      aiError = 'jawaban AI terlalu pendek atau hanya nama simbol';
    } else {
      const badNum = findUnknownPrice(json.id, facts) || findUnknownPrice(json.en, facts);
      if (badNum) aiError = `angka ${badNum} di jawaban AI tidak ada di data`;
      else story = { id: String(json.id), en: String(json.en), ai: true };
    }
  } catch (e) { aiError = e.message; }

  if (story) {
    aiStickyCache.set(key, { t: Date.now(), story });
    if (aiStickyCache.size > 300) aiStickyCache.delete(aiStickyCache.keys().next().value);
  } else if (facts.status !== 'STANDBY') {
    const st = aiStickyCache.get(key);
    if (st && Date.now() - st.t < AI_STICKY_MS) story = { ...st.story, sticky: true, aiError };
  }
  if (!story) {
    console.warn('getStory fallback:', aiError);
    story = { id: fallbackStory(facts, 'id'), en: fallbackStory(facts, 'en'), ai: false, aiError };
  }
  if (cacheKey) {
    const effTtl = facts.status === 'STANDBY' && facts.mode === 'manual'
      ? Math.min(ttl, MANUAL_STANDBY_TTL_MS)
      : (story.ai ? ttl : Math.min(ttl, 60000));
    storyCache.set(cacheKey, { t: Date.now(), ttl: effTtl, v: story });
    if (storyCache.size > 300) storyCache.delete(storyCache.keys().next().value);
  }
  return story;
}

// Penjelasan AI TIDAK menahan respons sinyal. Jika AI belum selesai dalam anggaran waktu,
// teks aturan dikirim dulu dan AI tetap berjalan di belakang; hasilnya di-cache untuk polling berikutnya.
const storyPending = new Map();
async function getStoryFast(facts, cacheKey, ttl, budgetMs) {
  if (cacheKey) {
    const hit = storyCache.get(cacheKey);
    if (hit && Date.now() - hit.t < hit.ttl) return hit.v;
  }
  let p = cacheKey ? storyPending.get(cacheKey) : null;
  if (!p) {
    p = getStory(facts, cacheKey, ttl).finally(() => { if (cacheKey) storyPending.delete(cacheKey); });
    if (cacheKey) storyPending.set(cacheKey, p);
  }
  let timer;
  const budget = new Promise(res => { timer = setTimeout(() => res(null), budgetMs); });
  const got = await Promise.race([p, budget]);
  clearTimeout(timer);
  if (got) return got;
  return { id: fallbackStory(facts, 'id'), en: fallbackStory(facts, 'en'), ai: false, aiError: 'AI masih berjalan', pending: true };
}

const SYS_GATE_MANUAL = `Kamu adalah filter veto untuk kandidat setup MANUAL SMC.
Kamu DILARANG membuat setup baru dan DILARANG mengubah angka entry, SL, TP, atau tipe order.
Jawab "TUNGGU" HANYA jika terbukti ada salah satu kontradiksi berikut:
1. arah_setup berlawanan dengan arah_htf, KECUALI role = "counter" atau role = "bounce". Counter-trend dan bounce sudah divalidasi struktur/zona sendiri, jadi jangan tolak karena arah.
2. regime_htf = "choppy".
3. jarak_entry_pip > batas_jarak_pip.
4. alasan_aturan kosong.
Jika tidak ada satupun dari 4 pelanggaran di atas, WAJIB jawab "AMBIL".
Jangan terlalu kaku pada syarat POI jika struktur M5 atau zona bounce sudah valid. Prioritaskan arah dan momentum.
FORMAT OUTPUT (hanya JSON, tanpa markdown):
{"keputusan":"AMBIL" atau "TUNGGU","alasan":"..."}`;

async function aiGateManual(input) {
  const fallback = { keputusan: 'AMBIL', alasan: 'Sesuai validasi aturan SMC', ai: false };
  if (!QWEN_MANUAL_KEYS.length) return fallback;
  const deadline = Date.now() + QWEN_MANUAL_DEADLINE_MS;
  for (const k of QWEN_MANUAL_KEYS.slice(0, 2)) {
    const left = deadline - Date.now();
    if (left < 1500) return fallback;
    try {
      const r = await httpJson(`${QWEN_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: QWEN_MANUAL_MODEL, max_tokens: 800, temperature: 0,
          messages: [{ role: 'system', content: SYS_GATE_MANUAL }, { role: 'user', content: JSON.stringify(input) }],
        }),
      }, Math.min(QWEN_MANUAL_DEADLINE_MS, left));
      if (!r.ok) continue;
      const parsed = parseJsonLoose(stripThink(extractContent(r.data)));
      if (parsed && ['AMBIL', 'TUNGGU'].includes(parsed.keputusan)) {
        return { keputusan: parsed.keputusan, alasan: String(parsed.alasan || '').slice(0, 200), ai: true };
      }
    } catch (e) { console.warn('aiGateManual:', e.message); }
  }
  return fallback;
}

// ── VISION ──
const VISION_BASE = `Kamu adalah analis trading spesialis SUPPLY & DEMAND (RBR/DBR/RBD/DBD), Order Block, dan Market Structure.
ATURAN MUTLAK:
1. Analisis SETIAP GAMBAR di array "perImageAnalyses" (maks 2 kalimat pendek per gambar: struktur tren + zona S&D/OB terdekat).
2. Top-down: struktur tren dari TF tertinggi menentukan arah utama, zona S&D dari TF menengah, Order Block dari TF terendah.
3. Pilih SATU zona S&D/OB terbaik yang searah struktur tren dan terdekat dengan harga sekarang.
4. WAJIB MENGHASILKAN SIGNAL BUY atau SELL. Jawab "NONE" HANYA jika gambar bukan chart atau tidak terbaca.
5. Entry: LIMIT di proximal atau 50% body OB jika harga belum menyentuh zona. MARKET hanya jika harga sudah berada di dalam zona OB dan ada penolakan (wick / engulfing / CHoCH mikro).
6. SL di luar distal zona + buffer kecil. BUY: sl < entry. SELL: sl > entry.
7. Semua level (entry, sl, tp, zoneLow, zoneHigh) WAJIB dibaca persis dari skala sumbu kanan chart.
8. reason maksimal 3 kalimat diawali nama pair, sebutkan angka persis seperti di field JSON.

Balas HANYA JSON valid tanpa kode blok:
{"signal":"BUY|SELL","orderType":"MARKET|LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"setup":"","confidence":"HIGH|MEDIUM|LOW","risk":"LOW|MEDIUM|HIGH","perImageAnalyses":["Gambar 1: ..."],"reason":"XAUUSD: ...","topDown":"...","zone":"Demand","pair":"XAUUSD","zoneLow":0,"zoneHigh":0}`;

function buildVisionSystem(style) {
  const map = {
    'Scalping': 'STYLE: SCALPING S&D/OB (M15 Bias & S&D -> M5 OB -> M1 Konfirmasi). Cari zona S&D/OB terdekat searah struktur M15.',
    'Intraday': 'STYLE: INTRADAY S&D/OB (H4 Bias -> H1 S&D -> M15 OB). Arah dari H4, zona H1/M15.',
    'Swing': 'STYLE: SWING S&D/OB (Weekly/Daily Bias -> H4 OB). Arah dari Daily/Weekly, zona H4/Daily.',
  };
  return `${VISION_BASE}\n\n${map[style] || map['Scalping']}`;
}

const PAIR_ALIAS = {
  GOLD: 'XAUUSD', XAUUSDX: 'XAUUSD', SILVER: 'XAGUSD', XAGUSDX: 'XAGUSD',
  BTCUSDT: 'BTCUSD', ETHUSDT: 'ETHUSD', SOLUSDT: 'SOLUSD', XRPUSDT: 'XRPUSD', BNBUSDT: 'BNBUSD', ADAUSDT: 'ADAUSD', DOGEUSDT: 'DOGEUSD',
  US500: 'SPX500', SPX: 'SPX500', SP500: 'SPX500', US100: 'NAS100', NDX: 'NAS100', NASDAQ: 'NAS100', NASDAQ100: 'NAS100',
  DJI: 'US30', DOW: 'US30', DOWJONES: 'US30', DE40: 'GER40', DAX: 'GER40', GER30: 'GER40', DE30: 'GER40',
  JP225: 'JPN225', NIKKEI: 'JPN225', NI225: 'JPN225', FTSE: 'UK100', FTSE100: 'UK100', CAC40: 'FRA40',
  USOIL: 'WTI', CRUDEOIL: 'WTI', UKOIL: 'BRENT', BRENTOIL: 'BRENT', DOLLARINDEX: 'DXY', USDX: 'DXY',
};
function normPair(raw) {
  let k = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!k) return null;
  if (PAIR_ALIAS[k]) k = PAIR_ALIAS[k];
  return k;
}
function pairSpec(pair, price) {
  const sym = normPair(pair);
  let dec = sym ? DECIMALS[sym] : undefined;
  if (dec === undefined) {
    if (sym && /^[A-Z]{6}$/.test(sym)) dec = sym.includes('JPY') ? 3 : 5;
    else dec = price < 10 ? 5 : price < 500 ? 3 : 2;
  }
  const pip = pipSizeOf(sym || '', dec);
  return { sym: sym || 'VISION', dec, pip };
}
function fmtPriceText(text, entry, dec) {
  return String(text || '').replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+/g, tok => {
    const v = Number(tok.replace(/,/g, ''));
    if (!Number.isFinite(v) || !(entry > 0)) return tok;
    return Math.abs(v - entry) / entry < 0.05 ? v.toFixed(dec) : tok;
  });
}
const VISION_EXPIRY_MS = { 'Scalping': 30 * 60e3, 'Intraday': 8 * 3600e3, 'Swing': 4 * 86400e3 };

function checkVisionSignal(j) {
  if (!j || typeof j !== 'object') return 'Respons AI tidak bisa dibaca.';
  const sig = String(j.signal || 'NONE').toUpperCase();
  if (sig === 'NONE') return String(j.reason || 'Tidak ada setup valid pada gambar.');
  if (sig !== 'BUY' && sig !== 'SELL') return 'Sinyal AI tidak dikenali.';
  const e = Number(j.entry), s = Number(j.sl);
  if (![e, s].every(Number.isFinite) || e <= 0 || s <= 0) return 'Entry/SL tidak lengkap.';
  if (!(sig === 'BUY' ? s < e : s > e)) return 'Level SL tidak konsisten dengan arah sinyal.';
  if (Math.abs(e - s) / e > 0.05) return 'Level SL tidak sesuai skala harga chart.';
  return null;
}
function buildVisionSignal(j, style, lang, imgCount) {
  const sig = String(j.signal).toUpperCase();
  const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT';
  const lvl = (v, allowed, dflt) => (allowed.includes(String(v || '').toUpperCase()) ? String(v).toUpperCase() : dflt);
  const rawEntry = Number(j.entry), rawSl = Number(j.sl);
  const { sym, dec, pip } = pairSpec(j.pair, rawEntry);
  const f = v => Number(Number(v).toFixed(dec));
  const dir = sig === 'BUY' ? 1 : -1;
  const entry = f(rawEntry);
  let risk = Math.abs(rawEntry - rawSl);
  if (!(risk > 0)) risk = pip * 10;
  const sl = f(entry - dir * risk);
  const [tp1, tp2, tp3] = [1.5, 2.25, 3].map(k => f(entry + dir * risk * k));
  let zLo = Number(j.zoneLow), zHi = Number(j.zoneHigh);
  const zOk = Number.isFinite(zLo) && Number.isFinite(zHi) && zLo > 0 && zHi > zLo && Math.abs(zLo - entry) / entry < 0.05 && Math.abs(zHi - entry) / entry < 0.05;
  if (!zOk) { zLo = Math.min(entry, entry - dir * risk * 0.5); zHi = Math.max(entry, entry - dir * risk * 0.5); }
  zLo = f(zLo); zHi = f(zHi);
  const zoneName = String(j.zone || (dir === 1 ? 'Demand' : 'Supply')).replace(/[0-9.,\s\-–]+$/g, '').trim() || (dir === 1 ? 'Demand' : 'Supply');
  const fix = t => fmtPriceText(t, entry, dec);
  const perImg = Array.isArray(j.perImageAnalyses) && j.perImageAnalyses.length ? j.perImageAnalyses.map(item => `• ${fix(String(item).trim())}`).join('\n') : '';
  let summary = fix(String(j.reason || '').trim()) || 'Analisis AI dari chart.';
  if (!summary.toUpperCase().includes(sym)) summary = `${sym}: ${summary}`;
  const fullReason = perImg ? `[${sym} · Analisa ${imgCount} Gambar]\n${perImg}\n\n[Setup]\n${summary}` : summary;
  const now = Date.now();
  const pips = v => Number((Math.abs(v - entry) / pip).toFixed(1));
  return {
    signal: sig, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW', status: isLimit ? 'PENDING' : 'RUNNING',
    state: isLimit ? 'LIMIT_PLACED' : 'CONFIRMED',
    symbol: sym, pair: sym, dec, pip, style,
    entry, sl, tp1, tp2, tp3, rr: 3,
    slPips: pips(sl), tp1Pips: pips(tp1), tp2Pips: pips(tp2), tp3Pips: pips(tp3),
    setup: fix(String(j.setup || `Vision ${style}`)),
    confidence: lvl(j.confidence, ['HIGH', 'MEDIUM', 'LOW'], 'MEDIUM'), risk: lvl(j.risk, ['LOW', 'MEDIUM', 'HIGH'], 'MEDIUM'),
    reason: fullReason, reasons: { id: fullReason, en: fullReason },
    chartContext: `${sym} ${sig} ${isLimit ? 'LIMIT' : 'MARKET'} ${entry.toFixed(dec)}`,
    zone: { min: zLo, max: zHi, label: `${zoneName} ${zLo.toFixed(dec)}–${zHi.toFixed(dec)}` },
    zoneLabel: `${zoneName} ${zLo.toFixed(dec)}–${zHi.toFixed(dec)}`, zoneNote: '',
    topDown: j.topDown ? fix(String(j.topDown)) : null,
    createdAt: now, time: now, ts: now, expiresAt: now + (VISION_EXPIRY_MS[style] || VISION_EXPIRY_MS['Scalping']),
    source: 'VISION_AI', aiReasoning: true, reasonSource: 'AI',
  };
}
async function runVisionAnalysis(images, style, lang) {
  if (!OPENAI_API_KEY) return { ok: false, reason: msg(lang, 'noKey') };
  const imgs = images.filter(s => typeof s === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(s));
  if (!imgs.length) return { ok: false, reason: msg(lang, 'badImage') };
  const userContent = [
    { type: 'text', text: `Jumlah gambar: ${imgs.length}. Style: ${style}. Analisa tiap gambar.` },
    ...imgs.flatMap((url, i) => [{ type: 'text', text: `Gambar ${i + 1}/${imgs.length}:` }, { type: 'image_url', image_url: { url } }]),
  ];
  const deadline = Date.now() + VISION_DEADLINE_MS;
  const FORCE_TXT = { type: 'text', text: 'PENTING: jawaban NONE tidak diterima. Pilih zona S&D/OB terdekat dari harga, lalu berikan BUY atau SELL lengkap dengan entry dan SL dari skala chart.' };
  const callAI = (v, force = false) => {
    const left = deadline - Date.now();
    if (left < 8000) throw new Error('Timeout: layanan eksternal lama merespons');
    const body = { model: AI_VISION_MODEL, messages: [{ role: 'system', content: buildVisionSystem(style) }, { role: 'user', content: force ? [...userContent, FORCE_TXT] : userContent }] };
    if (v === 'new') body.max_completion_tokens = VISION_MAX_TOKENS; else { body.max_tokens = VISION_MAX_TOKENS; body.temperature = 0.1; }
    return httpJson(`${OPENAI_BASE_URL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, Math.min(VISION_TIMEOUT_MS, left));
  };
  let r;
  try {
    r = await callAI('new'); if (!r.ok && r.status === 400) r = await callAI('legacy');
  } catch (e) {
    if (/Timeout/i.test(e.message)) return { ok: false, reason: 'AI terlalu lama membaca gambar. Coba lagi.' };
    return { ok: false, reason: `AI gagal: ${e.message}` };
  }
  if (!r.ok) { const detail = r.data?.error?.message || (typeof r.data?.error === 'string' ? r.data.error : '') || r.text.slice(0, 160); return { ok: false, reason: `AI gagal (HTTP ${r.status}): ${detail}` }; }
  let parsed = parseJsonLoose(extractContent(r.data));
  const isNone = p => !p || String(p.signal || 'NONE').toUpperCase() === 'NONE' || checkVisionSignal(p);
  if (isNone(parsed) && deadline - Date.now() > 22000) {
    try {
      const r2 = await callAI('new', true);
      if (r2.ok) { const p2 = parseJsonLoose(extractContent(r2.data)); if (!isNone(p2)) parsed = p2; }
    } catch (e) { console.warn('vision retry:', e.message); }
  }
  const bad = checkVisionSignal(parsed); if (bad) return { ok: false, reason: bad };
  return { ok: true, signal: buildVisionSignal(parsed, style, lang, imgs.length) };
}
async function handleVision(body, lang, res) {
  const images = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (!images.length) return fail(res, msg(lang, 'badImage'));
  const style = normStyle(body.style || body.mode);
  const out = await runVisionAnalysis(images, style, lang);
  if (!out.ok) return fail(res, out.reason);
  const sg = out.signal;
  return res.status(200).json({ ok: true, mode: 'vision', symbol: sg.symbol, pair: sg.pair, dec: sg.dec, pip: sg.pip, visionSymbol: 'VISION', price: sg.entry, style, signal: sg });
}

// ── UTAMA ──
function normStyle(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday')) return 'Intraday';
  return 'Scalping';
}
function manualTfs(styleName) {
  return MANUAL_TF_NEEDED[styleName] || MANUAL_TF_NEEDED['Scalping'];
}

async function handleCandles(body, lang, res, { email, isAutoBot }) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const styleName = isAutoBot ? 'Scalping' : normStyle(body.style || body.mode || 'Scalping');
  let price = Number(body.price ?? body.livePrice ?? body.currentPrice ?? 0);

  const rrChoice = [0.5, 1, 1.5, 2].includes(Number(body.rr)) ? Number(body.rr) : 1;
  const dec = DECIMALS[symbol] ?? 2;
  const ctx = {
    symbol, lang, dec, price, pip: pipSizeOf(symbol, dec), gold: isGold(symbol),
    kz: getKillzoneStatus(), rr: rrChoice, debug: !!body.debug,
    f: v => Number(safeNum(v, price).toFixed(dec)),
  };

  const allTfs = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1'];
  const candleMap = {};
  const src = {};
  for (const tf of allTfs) {
    const incoming = clientCandles(body, tf);
    if (incoming.length) {
      candleMap[tf] = incoming;
      src[tf] = 'client';
      setCandleCache(symbol, tf, incoming);
    } else {
      candleMap[tf] = [];
    }
  }

  const need = isAutoBot ? BOT_TF_NEEDED : manualTfs(styleName);
  try {
    await Promise.all(need.map(async tf => {
      if (candleMap[tf] && candleMap[tf].length >= (MIN_BARS[tf] || 25)) return;
      try {
        const rows = await fetchCandlesBySource(symbol, TF_IV[tf], TF_NEED[tf] || 200);
        if (rows.length) {
          candleMap[tf] = rows;
          src[tf] = 'TL';
          setCandleCache(symbol, tf, rows);
          return;
        }
      } catch (e) {
        console.warn(`TL ${symbol} ${tf}:`, e.message);
      }
      const cached = getCandleCache(symbol, tf);
      if (cached.length && (!candleMap[tf] || cached.length > candleMap[tf].length)) {
        candleMap[tf] = cached;
        src[tf] = 'cache';
      }
    }));
  } catch (e) { console.warn('fallback TL parallel:', e.message); }

  // Harga tidak dikirim client: pakai close M1 tertutup terakhir (stabil selama satu candle)
  if (!(price > 0)) {
    const m1Closed = closedOnly(candleMap.m1 || [], TF_MS.m1);
    if (m1Closed.length) price = Number(m1Closed[m1Closed.length - 1].c.toFixed(dec));
  }
  if (!(price > 0)) return fail(res, msg(lang, 'noPrice'));
  ctx.price = price;
  const data = { price };
  for (const tf of allTfs) {
    if (!candleMap[tf] || !candleMap[tf].length) {
      const cached = getCandleCache(symbol, tf);
      if (cached.length) { candleMap[tf] = cached; src[tf] = 'cache'; }
    }
    data[tf] = candleMap[tf] || [];
  }
  if (!data.m5.length && !data.m15.length && !data.m1.length) {
    console.warn(`DIAG ${isAutoBot ? 'BOT' : 'MANUAL'} ${symbol} ${styleName} noCandles src=${JSON.stringify(src)}`);
    return fail(res, msg(lang, 'noCandles'));
  }

  let out;
  try {
    ctx.prevCandleT = Number.isFinite(Number(body.prevSignal?.candleT)) ? Number(body.prevSignal.candleT) : null;
    out = isAutoBot ? runBot(ctx, data) : await runManual(ctx, data, styleName);
  } catch (e) {
    console.error('engine error:', e);
    out = standbyOut({ mode: isAutoBot ? 'bot' : 'manual', symbol, style: styleName, status: 'STANDBY', dec }, `Analisa sementara gagal (${e.message}). Akan dicoba lagi.`, [], null);
  }

  if (!out || !out.signal) {
    out = standbyOut({ mode: isAutoBot ? 'bot' : 'manual', symbol, style: styleName, status: 'STANDBY', dec }, 'Menunggu data/setup valid.', [], null);
  }

  if (isAutoBot && out.signal.status !== 'STANDBY') {
    try { await markTrialAsUsed(email); } catch (e) { console.warn('markTrialAsUsed:', e.message); }
  }

  // ── DIAGNOSA: dikirim di respons (diag) dan dicatat di log Vercel agar alasan STANDBY tidak hilang ──
  const diagFacts = out.facts || {};
  const diag = {
    who: isAutoBot ? 'BOT' : 'MANUAL',
    at: new Date().toISOString(),
    status: out.signal.status,
    reason: diagFacts.standbyReason || null,
    checks: (Array.isArray(out.signal.checklist) ? out.signal.checklist : []).slice(-8),
    bars: Object.fromEntries(['m1', 'm5', 'm15', 'h1'].map(t => [t, (data[t] || []).length])),
    src,
    liveM1: !!getFormingM1(data.m1),
    sticky: false,
  };
  console.log(`DIAG ${diag.who} ${symbol} ${styleName} ${diag.status} | ${diag.reason || '-'} | bars=${JSON.stringify(diag.bars)} src=${JSON.stringify(src)} live=${diag.liveM1}`);

  const prev = validPrevSignal(body.prevSignal, symbol, styleName, price, ctx.pip);
  // Bot: sticky hanya saat hasil baru STANDBY/berlawanan arah.
  // Manual: sinyal lama dikunci selama masih valid (belum kena SL/TP1/invalid/expired), kecuali client kirim forceNew.
  // Bot: sinyal aktif dipertahankan selama masih valid.
  //   STANDBY           -> pertahankan sinyal lama
  //   arah sama         -> pertahankan (objek identik, tidak berkedip)
  //   arah berlawanan   -> ganti hanya jika sinyal lama sudah lebih dari flipCooldownMs
  // Manual: dikunci selama masih valid, kecuali client kirim forceNew.
  let keepPrev = false;
  if (prev) {
    if (!isAutoBot) keepPrev = !body.forceNew;
    else if (out.signal.status === 'STANDBY' || out.signal.signal === prev.signal) keepPrev = true;
    else keepPrev = Date.now() - Number(prev.createdAt || 0) < BOT_CFG.flipCooldownMs;
  }
  if (keepPrev) {
    const last = data.m1 && data.m1.length ? data.m1[data.m1.length - 1] : null;
    const nextCloseAt = isAutoBot && last ? tsMs(last.t) + TF_MS.m1 : undefined;
    return res.status(200).json({ ok: true, mode: isAutoBot ? 'bot' : 'candles', symbol, style: styleName, price, signal: { ...prev, sticky: true, nextCloseAt }, diag: { ...diag, sticky: true } });
  }

  if (out.signal.status !== 'STANDBY') {
    out.signal.createdAt = Date.now();
  }

  if (isAutoBot) {
    const last = data.m1 && data.m1.length ? data.m1[data.m1.length - 1] : null;
    out.signal.nextCloseAt = last ? tsMs(last.t) + TF_MS.m1 : null;
  }

  const f = out.facts || { mode: isAutoBot ? 'bot' : 'manual', symbol, style: styleName, status: out.signal.status, dec };
  const cacheKey = isAutoBot
    ? `${symbol}|${styleName}|${f.status}|${f.signal || ''}|${f.trigger || ''}|${f.bias || ''}|${f.tier || ''}`
    : `M|${symbol}|${styleName}|${f.status}|${f.signal || ''}|${f.entry || ''}|${String(f.standbyReason || '').slice(0, 60)}`;
  const story = await getStoryFast(f, cacheKey, isAutoBot ? BOT_CFG.storyTtlBotMs : MANUAL_STORY_TTL_MS, isAutoBot ? BOT_CFG.storyBudgetBotMs : BOT_CFG.storyBudgetManualMs);
  const signal = {
    ...out.signal,
    reason: lang === 'en' ? story.en : story.id,
    reasons: { id: story.id, en: story.en },
    reasonSource: story.ai ? 'AI' : 'RULES',
    aiReasoning: !!story.ai,
    ...(ctx.debug ? { aiError: story.aiError || null } : {}),
  };
  return res.status(200).json({ ok: true, mode: isAutoBot ? 'bot' : 'candles', symbol, style: styleName, price, signal, diag });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  try {
    let body = req.body || {};
    if (typeof body === 'string') try { body = JSON.parse(body); } catch { return fail(res, 'Body tidak valid (JSON).'); }

    const lang = body.lang === 'en' ? 'en' : 'id';
    const email = String(body.email || body.value || '').trim().toLowerCase();
    const isAutoBot = !!(body.auto || body.bot || body.mode === 'bot' || body.source === 'bot');
    const isVision = body.symbol === 'VISION' || body.mode === 'vision' || (Array.isArray(body.images) && body.images.length > 0);

    const access = await checkAccess(email, isAutoBot);
    if (!access.ok) return fail(res, msg(lang, access.key));

    if (isVision) return await handleVision(body, lang, res);
    return await handleCandles(body, lang, res, { email, isAutoBot });
  } catch (err) {
    console.error('Fatal API Error:', err);
    if (!res.headersSent) return fail(res, `Server error: ${err.message || 'unknown'}`, 500);
  }
}
