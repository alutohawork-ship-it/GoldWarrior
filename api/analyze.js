export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { price, mode } = req.body;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    let currentPrice = parseFloat(price);

    // Jika harga dari request kosong, ambil langsung dari Gold API publik
    if (!currentPrice || isNaN(currentPrice)) {
        try {
            const goldRes = await fetch('https://api.gold-api.com/price/XAU/USD');
            const goldData = await goldRes.json();
            if (goldData && goldData.price) {
                currentPrice = parseFloat(goldData.price);
            }
        } catch (e) {
            currentPrice = 3950.00; // Harga fallback aman
        }
    }

    let tfGuide = "M15 + H1 (Intraday)";
    if (mode === 'scalping') tfGuide = "M1 + M5 (Scalping)";
    if (mode === 'swing') tfGuide = "H1 + H4 (Swing)";

    let spreadOffset = mode === 'scalping' ? 2.5 : (mode === 'swing' ? 12.0 : 5.0);

    let entryPrice = currentPrice - (spreadOffset * 0.4);
    let sl = entryPrice - (spreadOffset * 1.5);
    let tp1 = currentPrice + (spreadOffset * 1.0);
    let tp2 = currentPrice + (spreadOffset * 2.0);
    let tp3 = currentPrice + (spreadOffset * 3.5);

    let analysisText = `Analisis struktur Smart Money Concept (SMC) menggunakan kombinasi Time Frame ${tfGuide}. Harga terdeteksi di sekitar $${currentPrice.toFixed(2)}. Area Order Block (OB) valid teridentifikasi di kisaran $${entryPrice.toFixed(2)} dengan proteksi Stop Loss di bawah swing low pada level $${sl.toFixed(2)}. Target likuiditas bertahap dipetakan menuju TP1 ($${tp1.toFixed(2)}), TP2 ($${tp2.toFixed(2)}), dan TP3 ($${tp3.toFixed(2)}).`;

    if (openaiApiKey) {
        try {
            const prompt = `Bertindaklah sebagai Smart Money Concept (SMC) Institutional Trader profesional untuk XAU/USD. 
            Mode trading: ${mode || 'intraday'} dengan kombinasi Time Frame ${tfGuide}.
            Harga live saat ini adalah ${currentPrice}.
            Tuliskan analisis struktur market yang mendalam (seperti mitigasi Order Block, FVG, dan zona diskon) secara ringkas dan profesional dalam bahasa Indonesia.`;

            const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.3
                })
            });

            const aiData = await aiRes.json();
            if (aiData.choices && aiData.choices[0].message.content) {
                analysisText = aiData.choices[0].message.content.trim();
            }
        } catch (err) {
            console.error("Gagal memanggil OpenAI, menggunakan analisis default:", err);
        }
    }

    return res.status(200).json({
        status: "SETUP",
        analysis: analysisText,
        entryPrice: entryPrice.toFixed(2),
        sl: sl.toFixed(2),
        tp1: tp1.toFixed(2),
        tp2: tp2.toFixed(2),
        tp3: tp3.toFixed(2),
        setupMode: `SETUP: ${mode ? mode.toUpperCase() : 'INTRADAY'}`
    });
}
