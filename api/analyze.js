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

    // ===== 2. Harga: prioritas dari widget/request, cadangan dari Gold API =====
    let currentPrice = parseFloat(price ?? widget?.price);

    if (!isFinite(currentPrice) || currentPrice <= 0) {
        try {
            const goldRes = await fetch('https://api.gold-api.com/price/XAU');
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

    // ===== 3. Normalisasi data widget =====
    const widgetData = normalizeWidget(widget);
    const bias = detectBias(widgetData.recommendation);

    // ===== 4. Level default berdasarkan bias widget =====
    let setup = buildLevels(currentPrice, spreadOffset, bias);

    let analysisText = buildDefaultAnalysis(currentPrice, tfGuide, widgetData, setup);

    // ===== 5. Analisa AI (hanya dari harga + widget) =====
    if (openaiApiKey) {
        try {
            const prompt = `
Kamu adalah analis Smart Money Concept (SMC) untuk XAU/USD.

ATURAN PENTING:
- Gunakan HANYA data di bawah ini (harga gold + data widget).
- JANGAN mengarang data lain (berita, volume, candle historis, level dari sumber lain).
- Jika data widget kurang/netral, katakan dengan jujur dan sarankan WAIT.

DATA:
- Mode: ${mode} (Time Frame ${tfGuide})
- Harga live XAU/USD: ${currentPrice.toFixed(2)}
- Data widget: ${JSON.stringify(widgetData)}
- Level acuan sistem: ${JSON.stringify(setup)}

TUGAS:
Buat analisa ringkas & profesional dalam Bahasa Indonesia (maks 120 kata) yang menjelaskan
bias market berdasarkan data widget, area entry (Order Block / zona diskon/premium), SL, dan TP.
Kamu boleh menyesuaikan level acuan maksimal ±${(spreadOffset * 2).toFixed(1)} poin dari harga live.

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

            const aiData = await aiRes.json();
            const content = aiData?.choices?.[0]?.message?.content;

            if (content) {
                const ai = JSON.parse(content);

                if (typeof ai.analysis === 'string' && ai.analysis.trim()) {
                    analysisText = ai.analysis.trim();
                }

                // Pakai level AI hanya jika logis
                const aiSetup = {
                    direction: ai.direction,
                    entryPrice: Number(ai.entryPrice),
                    sl: Number(ai.sl),
                    tp1: Number(ai.tp1),
                    tp2: Number(ai.tp2),
                    tp3: Number(ai.tp3)
                };
                if (isValidSetup(aiSetup, currentPrice, spreadOffset)) {
                    setup = aiSetup;
                } else if (ai.direction === 'WAIT') {
                    setup = buildLevels(currentPrice, spreadOffset, 'WAIT');
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
        source: 'gold-price + widget'
    });
}

// ================= Helper =================

function fmt(n) {
    return isFinite(n) ? Number(n).toFixed(2) : '-';
}

function normalizeWidget(widget) {
    if (!widget) return { recommendation: 'NEUTRAL' };
    if (typeof widget === 'string') {
        return { recommendation: widget.toUpperCase(), raw: widget.slice(0, 1000) };
    }
    // Batasi ukuran agar prompt tidak terlalu besar
    const safe = JSON.parse(JSON.stringify(widget).slice(0, 3000).replace(/,[^,]*$/, '}') || '{}');
    return {
        recommendation: String(safe.recommendation || safe.summary || 'NEUTRAL').toUpperCase(),
        ...safe
    };
}

function detectBias(rec = '') {
    const r = rec.toUpperCase().replace(/\s+/g, '_');
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

function buildDefaultAnalysis(price, tfGuide, widgetData, setup) {
    if (setup.direction === 'WAIT') {
        return `Analisa SMC pada Time Frame ${tfGuide}. Harga XAU/USD di sekitar $${price.toFixed(2)}. ` +
               `Sinyal widget: ${widgetData.recommendation}. Belum ada konfirmasi arah yang jelas, ` +
               `disarankan WAIT hingga terjadi Break of Structure (BOS) yang valid.`;
    }
    const zone = setup.direction === 'BUY' ? 'zona diskon (Bullish Order Block)' : 'zona premium (Bearish Order Block)';
    return `Analisa SMC pada Time Frame ${tfGuide}. Harga XAU/USD di sekitar $${price.toFixed(2)} ` +
           `dengan sinyal widget ${widgetData.recommendation}. Setup ${setup.direction} di ${zone} ` +
           `sekitar $${setup.entryPrice.toFixed(2)}, SL $${setup.sl.toFixed(2)}. ` +
           `Target likuiditas: TP1 $${setup.tp1.toFixed(2)}, TP2 $${setup.tp2.toFixed(2)}, TP3 $${setup.tp3.toFixed(2)}.`;
}
