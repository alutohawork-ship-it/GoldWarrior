export default async function handler(req, res) {
    try {
        const r = await fetch('https://api.gold-api.com/price/XAU', { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        const price = parseFloat(d?.price);
        if (!isFinite(price) || price <= 0) throw new Error('Harga tidak valid');

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ price, updatedAt: d.updatedAt || new Date().toISOString() });
    } catch (e) {
        console.error('Gagal ambil harga gold:', e);
        return res.status(503).json({ error: 'Harga tidak tersedia' });
    }
}
