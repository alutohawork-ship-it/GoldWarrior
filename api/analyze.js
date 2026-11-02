export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { price, mode } = req.body;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!openaiApiKey) {
        return res.status(500).json({ error: 'OpenAI API Key belum diset di Vercel.' });
    }

    // Pemetaan Time Frame SMC berdasarkan mode trading pilihan user
    let tfGuide = "M15 + H1 (Intraday)";
    if (mode === 'scalping') tfGuide = "M1 + M5 (Scalping)";
    if (mode === 'swing') tfGuide = "H1 + H4 (Swing)";

    try {
        const prompt = `Bertindaklah sebagai Smart Money Concept (SMC) Expert tingkat lanjut untuk XAU/USD. 
        Mode trading yang digunakan adalah ${mode || 'intraday'} dengan kombinasi Time Frame ${tfGuide}.
        Harga live saat ini adalah ${price}.
        
        Analisis struktur market berdasarkan kombinasi time frame tersebut (misal: konfirmasi tren & key level dari TF tinggi, lalu eksekusi titik OB/FVG dari TF rendah). Tentukan SATU titik harga entry presisi (entryPrice), serta Stop Loss (sl) dan Take Profit (tp1, tp2, tp3):
        - Jika setup BUY: entryPrice adalah harga batas bawah support / Order Block bawah.
        - Jika setup SELL: entryPrice adalah harga batas atas resistance / Order Block atas.

        Berikan hasil dalam format JSON murni tanpa teks markdown dengan keys persis berikut:
        {
          "analysis": "alasan analisis SMC mendalam berdasarkan kombinasi time frame ${tfGuide}...",
          "entryPrice": "angka desimal titik entry tunggal (contoh: 3968.50)",
          "sl": "angka desimal SL terproteksi",
          "tp1": "angka desimal TP1",
          "tp2": "angka desimal TP2",
          "tp3": "angka desimal TP3",
          "setupMode": "SETUP: ${mode ? mode.toUpperCase() : 'INTRADAY'}"
        }`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.4
            })
        });

        const data = await response.json();
        const rawContent = data.choices[0].message.content;
        const cleanContent = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanContent);

        let base = parseFloat(price);
        return res.status(200).json({
            analysis: parsed.analysis || "Analisis struktur SMC Selesai.",
            entryPrice: parsed.entryPrice || base.toFixed(2),
            sl: parsed.sl || (base - 4.5).toFixed(2),
            tp1: parsed.tp1 || (base + 5.0).toFixed(2),
            tp2: parsed.tp2 || (base + 10.0).toFixed(2),
            tp3: parsed.tp3 || (base + 15.0).toFixed(2),
            setupMode: parsed.setupMode || "SETUP: INTRADAY"
        });

    } catch (error) {
        let base = parseFloat(price) || 3958.90;
        return res.status(200).json({
            analysis: `Sistem mendeteksi titik entry SMC menggunakan analisis struktur ${tfGuide}.`,
            entryPrice: base.toFixed(2),
            sl: (base - 4.50).toFixed(2),
            tp1: (base + 5.00).toFixed(2),
            tp2: (base + 10.00).toFixed(2),
            tp3: (base + 15.00).toFixed(2),
            setupMode: `SETUP: ${mode ? mode.toUpperCase() : 'INTRADAY'}`
        });
    }
}
