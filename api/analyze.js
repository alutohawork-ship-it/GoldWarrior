export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { price, mode: rawMode, widget } = req.body || {};
    const openaiApiKey = process.env.OPENAI_API_KEY;

    // ===== 1. Mode & parameter =====
    const MODES = {
        scalping: { tf: 'M1 + M5 (Scalping)', offset: 2.5 },
        intraday: { tf: 'M15 + H1 (Intraday)', offset: 5.0 },
        swing:    { tf: 'H1 + H4 (Swing)',     offset: 12.0 }
    };
    const mode = MODES[rawMode] ? rawMode : 'intraday';
    const { tf: tfGuide, offset: spreadOffset } = MODES[mode];

    // ===== 2. Harga: prioritas dari request/widget, cadangan dari Gold API =====
    let currentPrice = parseFloat(price ?? widget?.price);

    if (!isFinite(currentPrice) || currentPrice <= 0) {
        try {
            const goldRes = await fetch('https://api.gold-api.com/price/XAU', { cache: 'no-store' });
            const goldData = await goldRes.json();
            currentPrice = parseFloat(goldData?.price);
        } catch (e) {
            console.error('Gagal mengambil harga dari Gold API:', e);
        }
    }

    if (!isFinite(currentPrice) || currentPrice <= 0) {
        return res.status(503).json({
            error: 'Harga XAU/USD tidak tersedia. Analisa dibatalkan agar tidak memakai data palsu.'
        });
    }

    // ===== 3. Normalisasi data widget & bias =====
    const widgetData = normalizeWidget(widget);
    const insufficient = widgetData.dataQuality === 'INSUFFICIENT';
    const bias = insufficient ? 'WAIT' : detectBias(widgetData.recommendation);

    // ===== 4. Level default dari Order Block widget =====
    let setup = buildLevelsFromWidget(currentPrice, spreadOffset, bias, widgetData);
    let analysisText = buildDefaultAnalysis(currentPrice, tfGuide, widgetData, setup);
    let source = 'widget';

    // ===== 5. Analisa AI (hanya dari harga gold + data widget) =====
    if (openaiApiKey && !insufficient) {
        try {
            const prompt = `
Kamu adalah analis Smart Money Concept (SMC) untuk XAU/USD.

ATURAN PENTING:
- Gunakan HANYA data di bawah ini (harga gold + data analisa widget).
- JANGAN mengarang data lain (berita, volume, candle historis, level dari sumber lain).
- Arah setup harus sesuai bias widget (${bias}) atau "WAIT" jika menurutmu belum ada konfirmasi.
- Jika data widget lemah/netral, katakan dengan jujur dan sarankan WAIT.

DATA:
- Mode: ${mode} (Time Frame ${tfGuide})
- Harga live XAU/USD: ${currentPrice.toFixed(2)}
- Data widget: ${JSON.stringify(widgetData)}
- Level acuan sistem: ${JSON.stringify(roundSetup(setup))}

TUGAS:
Buat analisa ringkas & profesional dalam Bahasa Indonesia (maks 120 kata) yang menjelaskan:
trend tiap timeframe, BOS/CHoCH terakhir, posisi zona premium/discount, Order Block dan FVG yang relevan,
lalu area entry, SL, dan TP. Kamu boleh menyesuaikan level acuan, tetapi entry maksimal
${(spreadOffset * 2).toFixed(1)} poin dari harga live.

Balas HANYA dalam JSON dengan format:
{
  "direction": "BUY" | "SELL" | "WAIT",
  "entryPrice": number,
  "sl": number,
  "tp1": number,
  "tp2": number,
  "tp3": number,
  "analysis": "teks analisa"
}`;

            const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.2,
                    response_format: { type: 'json_object' }
                })
            });

            if (!aiRes.ok) throw new Error('OpenAI HTTP ' + aiRes.status);

            const aiData = await aiRes.json();
            const content = aiData?.choices?.[0]?.message?.content;

            if (content) {
                const ai = safeParse(content);

                if (ai && typeof ai.analysis === 'string' && ai.analysis.trim()) {
                    analysisText = ai.analysis.trim();
                    source = 'widget + AI';
                }

                if (ai?.direction === 'WAIT') {
                    setup = buildLevels(currentPrice, spreadOffset, 'WAIT');
                } else if (ai && ai.direction === bias) {
                    const aiSetup = {
                        direction: ai.direction,
                        entryPrice: Number(ai.entryPrice),
                        sl: Number(ai.sl),
                        tp1: Number(ai.tp1),
                        tp2: Number(ai.tp2),
                        tp3: Number(ai.tp3)
                    };
                    // Pakai level AI hanya jika logis, jika tidak tetap pakai level sistem
                    if (isValidSetup(aiSetup, currentPrice, spreadOffset)) {
                        setup = aiSetup;
                    }
                }
            }
        } catch (err) {
            console.error('Gagal memanggil OpenAI, memakai analisa default:', err);
        }
    }

    return res.status(200).json({
        status: setup.direction === 'WAIT' ? 'WAIT' : 'SETUP',
        direction: setup.direction,
        price: currentPrice.toFixed(2),
        analysis: analysisText,
        entryPrice: fmt(setup.entryPrice),
        sl: fmt(setup.sl),
        tp1: fmt(setup.tp1),
        tp2: fmt(setup.tp2),
        tp3: fmt(setup.tp3),
        setupMode: `SETUP: ${mode.toUpperCase()} (${setup.direction})`,
        recommendation: widgetData.recommendation,
        dataQuality: widgetData.dataQuality,
        source
    });
}

// ================= Helper =================

function fmt(n) {
    return isFinite(n) ? Number(n).toFixed(2) : '-';
}

function safeParse(text) {
    try { return JSON.parse(text); } catch { return null; }
}

function roundSetup(s) {
    const r = n => (isFinite(n) ? Number(Number(n).toFixed(2)) : null);
    return {
        direction: s.direction,
        entryPrice: r(s.entryPrice),
        sl: r(s.sl),
        tp1: r(s.tp1),
        tp2: r(s.tp2),
        tp3: r(s.tp3)
    };
}

function normalizeWidget(widget) {
    if (!widget) return { recommendation: 'NEUTRAL', dataQuality: 'INSUFFICIENT', timeframes: {} };
    if (typeof widget === 'string') {
        return { recommendation: widget.toUpperCase().slice(0, 30), dataQuality: 'UNKNOWN', timeframes: {} };
    }

    const num = v => (v !== null && v !== '' && isFinite(Number(v)) ? Number(v) : null);
    const ob = o => (o && isFinite(o.top) && isFinite(o.bottom))
        ? { top: Number(o.top), bottom: Number(o.bottom), mitigated: !!o.mitigated }
        : null;

    const timeframes = {};
    for (const [name, tf] of Object.entries(widget.timeframes || {}).slice(0, 3)) {
        if (!tf || typeof tf !== 'object') continue;
        timeframes[String(name).slice(0, 5)] = {
            trend: String(tf.trend || 'NEUTRAL').slice(0, 10),
            lastEvent: tf.lastEvent ? String(tf.lastEvent).slice(0, 60) : null,
            swingHigh: num(tf.swingHigh),
            swingLow: num(tf.swingLow),
            zone: String(tf.zone || 'UNKNOWN').slice(0, 12),
            zonePct: num(tf.zonePct),
            bullOB: ob(tf.bullOB),
            bearOB: ob(tf.bearOB),
            fvg: (Array.isArray(tf.fvg) ? tf.fvg : []).slice(0, 3).map(g => ({
                dir: g?.dir === 'BEARISH' ? 'BEARISH' : 'BULLISH',
                top: num(g?.top),
                bottom: num(g?.bottom)
            })),
            ema20: num(tf.ema20),
            ema50: num(tf.ema50),
            rsi: num(tf.rsi),
            atr: num(tf.atr),
            score: num(tf.score)
        };
    }

    return {
        recommendation: String(widget.recommendation || 'NEUTRAL').toUpperCase().slice(0, 30),
        score: num(widget.score),
        dataQuality: String(widget.dataQuality || 'UNKNOWN').toUpperCase().slice(0, 15),
        entryTF: widget.entryTF ? String(widget.entryTF).slice(0, 5) : Object.keys(timeframes)[0],
        timeframes
    };
}

function detectBias(rec = '') {
    const r = String(rec).toUpperCase();
    if (r.includes('BUY')) return 'BUY';
    if (r.includes('SELL')) return 'SELL';
    return 'WAIT';
}

function buildLevels(price, off, direction) {
    if (direction === 'SELL') {
        const entry = price + off * 0.4;
        return {
            direction,
            entryPrice: entry,
            sl: entry + off * 1.5,
            tp1: price - off * 1.0,
            tp2: price - off * 2.0,
            tp3: price - off * 3.5
        };
    }
    if (direction === 'BUY') {
        const entry = price - off * 0.4;
        return {
            direction,
            entryPrice: entry,
            sl: entry - off * 1.5,
            tp1: price + off * 1.0,
            tp2: price + off * 2.0,
            tp3: price + off * 3.5
        };
    }
    return { direction: 'WAIT', entryPrice: NaN, sl: NaN, tp1: NaN, tp2: NaN, tp3: NaN };
}

function buildLevelsFromWidget(price, off, bias, w) {
    if (bias === 'WAIT') return buildLevels(price, off, 'WAIT');

    const tf = w.timeframes?.[w.entryTF];
    const atrVal = Number(tf?.atr);
    const buffer = isFinite(atrVal) && atrVal > 0 ? atrVal * 0.5 : off * 0.3;

    // BUY: entry di Bullish OB, SL di bawah OB, TP RR 1:1, 1:2, 1:3
    if (bias === 'BUY' && tf?.bullOB) {
        const entry = Math.min(price, tf.bullOB.top);
        if (price - entry <= off * 2) {
            const sl = tf.bullOB.bottom - buffer;
            const risk = entry - sl;
            if (risk > 0) {
                return { direction: 'BUY', entryPrice: entry, sl, tp1: entry + risk, tp2: entry + risk * 2, tp3: entry + risk * 3 };
            }
        }
    }

    // SELL: entry di Bearish OB, SL di atas OB, TP RR 1:1, 1:2, 1:3
    if (bias === 'SELL' && tf?.bearOB) {
        const entry = Math.max(price, tf.bearOB.bottom);
        if (entry - price <= off * 2) {
            const sl = tf.bearOB.top + buffer;
            const risk = sl - entry;
            if (risk > 0) {
                return { direction: 'SELL', entryPrice: entry, sl, tp1: entry - risk, tp2: entry - risk * 2, tp3: entry - risk * 3 };
            }
        }
    }

    // Tidak ada OB valid di dekat harga → pakai level berbasis offset
    return buildLevels(price, off, bias);
}

function isValidSetup(s, price, off) {
    if (!['BUY', 'SELL'].includes(s.direction)) return false;
    const nums = [s.entryPrice, s.sl, s.tp1, s.tp2, s.tp3];
    if (!nums.every(n => isFinite(n) && n > 0)) return false;

    // Entry tidak boleh terlalu jauh dari harga live
    if (Math.abs(s.entryPrice - price) > off * 2) return false;

    if (s.direction === 'BUY') {
        return s.sl < s.entryPrice && s.entryPrice < s.tp1 && s.tp1 < s.tp2 && s.tp2 < s.tp3;
    }
    return s.sl > s.entryPrice && s.entryPrice > s.tp1 && s.tp1 > s.tp2 && s.tp2 > s.tp3;
}

function buildDefaultAnalysis(price, tfGuide, w, setup) {
    const tfNames = Object.keys(w.timeframes || {});
    const structure = tfNames.map(name => {
        const t = w.timeframes[name];
        const ev = t.lastEvent ? `, ${t.lastEvent}` : '';
        return `${name} ${t.trend} (zona ${t.zone}${ev})`;
    }).join('; ');

    const head = `Analisa SMC pada Time Frame ${tfGuide}. Harga XAU/USD di sekitar $${price.toFixed(2)}. ` +
                 `Sinyal widget: ${w.recommendation}${w.score != null ? ` (skor ${w.score})` : ''}. ` +
                 (structure ? `Struktur: ${structure}. ` : '');

    if (w.dataQuality === 'INSUFFICIENT') {
        return head + 'Data candle widget belum cukup untuk membaca struktur market. Status WAIT sampai data terkumpul.';
    }

    if (setup.direction === 'WAIT') {
        return head + 'Belum ada konfirmasi arah yang jelas, disarankan WAIT hingga terjadi BOS/CHoCH yang valid.';
    }

    const zone = setup.direction === 'BUY'
        ? 'zona diskon (Bullish Order Block)'
        : 'zona premium (Bearish Order Block)';

    return head +
        `Setup ${setup.direction} di ${zone} sekitar $${setup.entryPrice.toFixed(2)}, SL $${setup.sl.toFixed(2)}. ` +
        `Target likuiditas: TP1 $${setup.tp1.toFixed(2)}, TP2 $${setup.tp2.toFixed(2)}, TP3 $${setup.tp3.toFixed(2)}.`;
}
