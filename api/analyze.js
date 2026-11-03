// api/analyze.js
const SYMBOL = 'XAU/USD';

const MODES = {
  scalping: { ltf: '1min',  htf: '5min', label: 'M1 + M5 (Scalping)' },
  intraday: { ltf: '15min', htf: '1h',   label: 'M15 + H1 (Intraday)' },
  swing:    { ltf: '1h',    htf: '4h',   label: 'H1 + H4 (Swing)' },
};

const round = (n) => Math.round(n * 100) / 100;

// ---------- Data ----------
async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchCandles(interval, apiKey, outputsize = 300) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(SYMBOL)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`Gagal ambil candle ${interval}: HTTP ${r.status}`);
  const j = await r.json();
  if (j.status === 'error' || !Array.isArray(j.values)) {
    throw new Error(`Data ${interval} tidak valid: ${j.message || 'unknown'}`);
  }
  return j.values
    .map(v => ({ time: v.datetime, open: +v.open, high: +v.high, low: +v.low, close: +v.close }))
    .filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time.localeCompare(b.time)); // urut lama -> baru
}

// ---------- Indikator & Struktur ----------
function calcATR(c, period = 14) {
  const trs = [];
  for (let i = 1; i < c.length; i++) {
    const pc = c[i - 1].close;
    trs.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - pc), Math.abs(c[i].low - pc)));
  }
  const last = trs.slice(-period);
  return last.reduce((a, b) => a + b, 0) / last.length;
}

// Fractal swing: high/low tertinggi/terendah di antara n candle kiri & kanan
function findSwings(c, n = 3) {
  const highs = [], lows = [];
  for (let i = n; i < c.length - n; i++) {
    let isH = true, isL = true;
    for (let j = i - n; j <= i + n; j++) {
      if (j === i) continue;
      if (c[j].high >= c[i].high) isH = false;
      if (c[j].low <= c[i].low) isL = false;
    }
    if (isH) highs.push({ index: i, price: c[i].high });
    if (isL) lows.push({ index: i, price: c[i].low });
  }
  return { highs, lows };
}

// BOS / CHoCH berdasarkan candle CLOSE yang menembus swing
function analyzeStructure(c, swings) {
  const breaks = [];
  const scan = (list, dir) => {
    for (const s of list) {
      for (let i = s.index + 1; i < c.length; i++) {
        const broke = dir === 'bullish' ? c[i].close > s.price : c[i].close < s.price;
        if (broke) { breaks.push({ dir, index: i, level: s.price }); break; }
      }
    }
  };
  scan(swings.highs, 'bullish');
  scan(swings.lows, 'bearish');
  breaks.sort((a, b) => a.index - b.index);

  const last = breaks.at(-1) || null;
  const prev = breaks.at(-2) || null;
  const breakType = last ? (prev && prev.dir !== last.dir ? 'CHoCH' : 'BOS') : null;

  const [h1, h2] = swings.highs.slice(-2);
  const [l1, l2] = swings.lows.slice(-2);
  let pattern = 'ranging';
  if (h2 && l2) {
    if (h2.price > h1.price && l2.price > l1.price) pattern = 'HH-HL (bullish)';
    else if (h2.price < h1.price && l2.price < l1.price) pattern = 'LH-LL (bearish)';
  }

  return {
    bias: last ? last.dir : 'neutral',
    lastBreak: last ? { type: breakType, dir: last.dir, level: round(last.level), time: c[last.index].time } : null,
    pattern,
  };
}

// FVG yang belum terisi penuh (zona menyusut sesuai bagian yang sudah dimitigasi)
function findFVGs(c, atr) {
  const out = [];
  for (let i = 2; i < c.length; i++) {
    const a = c[i - 2], b = c[i];

    if (b.low > a.high && b.low - a.high >= 0.1 * atr) {
      let top = b.low, bottom = a.high, filled = false;
      for (let k = i + 1; k < c.length; k++) {
        if (c[k].low <= bottom) { filled = true; break; }
        top = Math.min(top, c[k].low);
      }
      if (!filled && top > bottom) out.push({ type: 'bullish', kind: 'FVG', top, bottom, time: b.time });
    }

    if (b.high < a.low && a.low - b.high >= 0.1 * atr) {
      let top = a.low, bottom = b.high, filled = false;
      for (let k = i + 1; k < c.length; k++) {
        if (c[k].high >= top) { filled = true; break; }
        bottom = Math.max(bottom, c[k].high);
      }
      if (!filled && top > bottom) out.push({ type: 'bearish', kind: 'FVG', top, bottom, time: b.time });
    }
  }
  return out;
}

// Order Block = candle berlawanan terakhir sebelum displacement >= 1 ATR, belum tersentuh ulang
function findOrderBlocks(c, atr) {
  const out = [];
  for (let i = 1; i < c.length - 3; i++) {
    const ob = c[i];
    const next = c.slice(i + 1, i + 4);

    // Bullish OB
    if (ob.close < ob.open && next[0].close > next[0].open) {
      const maxClose = Math.max(...next.map(x => x.close));
      if (maxClose - ob.high >= atr) {
        let mitigated = false;
        for (let k = i + 2; k < c.length; k++) {
          if (c[k].low <= ob.high) { mitigated = true; break; }
        }
        if (!mitigated) out.push({ type: 'bullish', kind: 'OB', top: ob.high, bottom: ob.low, time: ob.time });
      }
    }

    // Bearish OB
    if (ob.close > ob.open && next[0].close < next[0].open) {
      const minClose = Math.min(...next.map(x => x.close));
      if (ob.low - minClose >= atr) {
        let mitigated = false;
        for (let k = i + 2; k < c.length; k++) {
          if (c[k].high >= ob.low) { mitigated = true; break; }
        }
        if (!mitigated) out.push({ type: 'bearish', kind: 'OB', top: ob.high, bottom: ob.low, time: ob.time });
      }
    }
  }
  return out;
}

// Liquidity = swing high/low yang belum di-sweep
function unsweptLevels(c, list, side) {
  return list
    .filter(s => {
      for (let k = s.index + 1; k < c.length; k++) {
        if (side === 'high' ? c[k].high > s.price : c[k].low < s.price) return false;
      }
      return true;
    })
    .map(s => s.price);
}

function dealingRange(c, swings) {
  const lastH = swings.highs.at(-1);
  const lastL = swings.lows.at(-1);
  const high = Math.max(...c.slice(lastH.index).map(x => x.high));
  const low = Math.min(...c.slice(lastL.index).map(x => x.low));
  return { high, low, eq: (high + low) / 2 };
}

// ---------- Penentuan Setup ----------
function buildSetup({ price, bias, zones, atr, range, liquidity }) {
  if (bias === 'neutral') {
    return { noTrade: true, reason: 'Struktur HTF belum jelas (belum ada BOS/CHoCH yang valid).' };
  }

  const isBuy = bias === 'bullish';

  // Zona searah bias, di sisi yang benar dari harga, dan berada di Discount (BUY) / Premium (SELL)
  const candidates = zones
    .filter(z => z.type === bias)
    .filter(z => (isBuy ? z.bottom < price : z.top > price))
    .filter(z => (isBuy ? z.top <= range.eq : z.bottom >= range.eq))
    .sort((a, b) => (isBuy ? b.top - a.top : a.bottom - b.bottom)); // terdekat dulu

  if (!candidates.length) {
    return {
      noTrade: true,
      reason: isBuy
        ? 'Bias bullish, tetapi tidak ada OB/FVG bullish yang valid di area Discount. Tunggu retracement.'
        : 'Bias bearish, tetapi tidak ada OB/FVG bearish yang valid di area Premium. Tunggu retracement.',
    };
  }

  const zone = candidates[0];
  const confluence = candidates.some(z =>
    z !== zone && z.kind !== zone.kind && z.bottom <= zone.top && z.top >= zone.bottom
  );

  // Entry di proximal line zona; jika harga sudah di dalam zona -> market order
  const entry = isBuy ? Math.min(zone.top, price) : Math.max(zone.bottom, price);
  const priceInsideZone = isBuy ? zone.top >= price : zone.bottom <= price;
  const buffer = 0.3 * atr;
  const sl = isBuy ? zone.bottom - buffer : zone.top + buffer;
  const risk = Math.abs(entry - sl);

  if (risk > 3 * atr) {
    return { noTrade: true, reason: `Zona terlalu lebar (risk ${round(risk)} > 3x ATR ${round(atr)}). Setup tidak efisien.` };
  }

  // TP: utamakan liquidity yang belum diambil (minimal 1R), lalu lengkapi dengan kelipatan R
  const liq = (isBuy ? liquidity.highs : liquidity.lows)
    .filter(p => (isBuy ? p >= entry + risk : p <= entry - risk));
  const rLevels = [1.5, 2.5, 4, 6].map(m => (isBuy ? entry + risk * m : entry - risk * m));
  const sorted = [...liq, ...rLevels].sort((a, b) => (isBuy ? a - b : b - a));

  const tps = [];
  for (const lv of sorted) {
    if (!tps.length || Math.abs(lv - tps.at(-1)) >= 0.5 * risk) tps.push(lv);
    if (tps.length === 3) break;
  }

  return {
    noTrade: false,
    direction: isBuy ? 'BUY' : 'SELL',
    orderType: priceInsideZone ? `${isBuy ? 'BUY' : 'SELL'} MARKET` : `${isBuy ? 'BUY' : 'SELL'} LIMIT`,
    zone: { kind: zone.kind, top: round(zone.top), bottom: round(zone.bottom), time: zone.time, confluence },
    entry: round(entry),
    sl: round(sl),
    tp1: round(tps[0]),
    tp2: round(tps[1]),
    tp3: round(tps[2]),
    rr: tps.map(t => round(Math.abs(t - entry) / risk)),
  };
}

// ---------- Narasi AI (hanya menjelaskan, tidak menentukan angka) ----------
async function writeNarrative(apiKey, ctx) {
  const prompt = `Kamu adalah analis Smart Money Concept untuk XAU/USD.
Tulis penjelasan analisis dalam Bahasa Indonesia (maks. 6 kalimat) HANYA berdasarkan data JSON berikut.
ATURAN KERAS:
- Jangan mengubah, membulatkan ulang, atau menambah angka/level apa pun yang tidak ada di data.
- Jangan menyebut OB/FVG/liquidity yang tidak ada di data.
- Jika status NO_TRADE, jelaskan alasannya dan apa yang perlu ditunggu.
- Sebutkan bias HTF, jenis break (BOS/CHoCH), zona entry, posisi premium/discount, dan target liquidity.
- Jika LTF belum searah HTF, sebutkan perlu konfirmasi CHoCH di LTF saat harga masuk zona.

DATA:
${JSON.stringify(ctx, null, 2)}

Balas JSON: {"analysis": "..."}`;

  const r = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  }, 15000);

  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
  const data = await r.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  if (typeof parsed.analysis !== 'string' || !parsed.analysis.trim()) throw new Error('Narasi kosong');
  return parsed.analysis.trim();
}

function templateNarrative(ctx) {
  const s = ctx.setup;
  if (s.noTrade) return `NO TRADE. ${s.reason}`;
  return `Bias ${ctx.mode.label.split(' (')[0]} HTF ${ctx.htf.bias} (${ctx.htf.lastBreak?.type} di ${ctx.htf.lastBreak?.level}). ` +
    `Entry ${s.orderType} di ${s.zone.kind} ${s.zone.bottom}–${s.zone.top}${s.zone.confluence ? ' (konfluensi OB+FVG)' : ''}. ` +
    `SL ${s.sl} di balik zona. TP ${s.tp1} / ${s.tp2} / ${s.tp3} (RR ${s.rr.join(' / ')}).`;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const modeKey = MODES[req.body?.mode] ? req.body.mode : 'intraday';
  const tf = MODES[modeKey];
  const tdKey = process.env.TWELVEDATA_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!tdKey) return res.status(500).json({ error: 'TWELVEDATA_API_KEY belum diset di Vercel.' });

  try {
    const [ltfAll, htfAll] = await Promise.all([
      fetchCandles(tf.ltf, tdKey),
      fetchCandles(tf.htf, tdKey),
    ]);

    const livePrice = ltfAll.at(-1).close;
    // Candle terakhir masih berjalan -> struktur hanya dihitung dari candle yang sudah close
    const ltf = ltfAll.slice(0, -1);
    const htf = htfAll.slice(0, -1);

    const clientPrice = parseFloat(req.body?.price);
    const priceWarning =
      Number.isFinite(clientPrice) && Math.abs(clientPrice - livePrice) / livePrice > 0.003
        ? `Harga dari client (${clientPrice}) berbeda dari data feed (${livePrice}). Analisis memakai harga feed.`
        : null;

    const atrL = calcATR(ltf);
    const swH = findSwings(htf, 3);
    const swL = findSwings(ltf, 3);
    if (swH.highs.length < 2 || swH.lows.length < 2) {
      throw new Error('Data HTF tidak cukup untuk membaca struktur.');
    }

    const htfStruct = analyzeStructure(htf, swH);
    const ltfStruct = analyzeStructure(ltf, swL);
    const range = dealingRange(htf, swH);
    const zones = [...findOrderBlocks(ltf, atrL), ...findFVGs(ltf, atrL)];
    const liquidity = {
      highs: [...unsweptLevels(htf, swH.highs, 'high'), ...unsweptLevels(ltf, swL.highs, 'high')],
      lows:  [...unsweptLevels(htf, swH.lows, 'low'),   ...unsweptLevels(ltf, swL.lows, 'low')],
    };

    const setup = buildSetup({ price: livePrice, bias: htfStruct.bias, zones, atr: atrL, range, liquidity });

    const ctx = {
      mode: { key: modeKey, label: tf.label },
      livePrice: round(livePrice),
      atrLTF: round(atrL),
      htf: htfStruct,
      ltf: ltfStruct,
      ltfAlignedWithHtf: ltfStruct.bias === htfStruct.bias,
      dealingRange: { high: round(range.high), low: round(range.low), equilibrium: round(range.eq) },
      pricePosition: livePrice > range.eq ? 'Premium' : 'Discount',
      setup,
    };

    let analysis;
    try {
      analysis = openaiKey ? await writeNarrative(openaiKey, ctx) : templateNarrative(ctx);
    } catch (e) {
      console.error('Narasi AI gagal, pakai template:', e.message);
      analysis = templateNarrative(ctx);
    }

    return res.status(200).json({
      status: setup.noTrade ? 'NO_TRADE' : 'SETUP',
      analysis,
      direction: setup.direction || null,
      orderType: setup.orderType || null,
      entryPrice: setup.entry ?? null,
      sl: setup.sl ?? null,
      tp1: setup.tp1 ?? null,
      tp2: setup.tp2 ?? null,
      tp3: setup.tp3 ?? null,
      rr: setup.rr || null,
      needsLtfConfirmation: !setup.noTrade && !ctx.ltfAlignedWithHtf,
      livePrice: ctx.livePrice,
      priceWarning,
      setupMode: `SETUP: ${modeKey.toUpperCase()}`,
      meta: { htf: htfStruct, ltf: ltfStruct, dealingRange: ctx.dealingRange, zone: setup.zone || null },
    });
  } catch (err) {
    console.error('Analisis gagal:', err);
    // Jangan pernah kirim sinyal palsu saat gagal
    return res.status(502).json({ error: `Analisis gagal: ${err.message}` });
  }
}
