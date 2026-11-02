export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { price, ohlc } = req.body;
    const openaiApiKey = process.env.OPENAI_API_KEY; // Diambil aman dari Vercel/Netlify Environment Variables

    if (!openaiApiKey) {
        return res.status(500).json({ error: 'OpenAI API Key belum dikonfigurasi di server.' });
    }

    try {
        const prompt = `Bertindaklah sebagai Smart Money Concept (SMC) Expert untuk XAU/USD. 
        Data saat ini:
        - Harga Live: ${price}
        - Data OHLC Terkini: ${JSON.stringify(ohlc)}
        
        Berikan analisis teknikal singkat dalam format JSON murni tanpa markdown lain yang berisi:
        - "analysis": Alasan eksekusi, pembacaan struktur harga berdasarkan data OHLC, dan tips menghindari floating.
        - "sl": Angka Stop Loss aman dengan buffer ATR.
        - "tp1": Target TP 1 level psikologis.
        - "tp2": Target TP 2 level psikologis.
        - "tp3": Target TP 3 level psikologis.
        - "setupMode": "SETUP: DIRECT ENTRY" atau "SETUP: WAIT PULLBACK".
        Berikan hanya format JSON valid.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7
            })
        });

        const data = await response.json();
        const contentText = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        const content = JSON.parse(contentText);

        return res.status(200).json(content);
    } catch (error) {
        return res.status(500).json({ error: 'Gagal memproses OpenAI API: ' + error.message });
    }
}
