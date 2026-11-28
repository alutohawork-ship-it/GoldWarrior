export function renderSignalChart({ dec, live, panels }) {
  // Simple SVG chart renderer
  const width = 800;
  const height = 600;
  const panelHeight = height / panels.length;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += '<rect width="100%" height="100%" fill="#0a0a0a"/>';

  panels.forEach((panel, idx) => {
    const y = idx * panelHeight;
    const rows = panel.rows || [];
    if (rows.length < 2) return;

    const prices = rows.flatMap(c => [c.h, c.l]);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;

    const xStep = width / rows.length;
    const candleW = Math.max(2, xStep * 0.7);

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const gy = y + (panelHeight * i) / 4;
      const price = maxP - (range * i) / 4;
      svg += `<line x1="0" y1="${gy}" x2="${width}" y2="${gy}" stroke="#1a1a1a" stroke-width="1"/>`;
      svg += `<text x="5" y="${gy - 2}" fill="#666" font-size="10">${price.toFixed(dec)}</text>`;
    }

    // Candles
    rows.forEach((c, i) => {
      const x = i * xStep;
      const isUp = c.c >= c.o;
      const color = isUp ? '#00C853' : '#FF3B30';
      
      const oY = y + panelHeight - ((c.o - minP) / range) * panelHeight;
      const cY = y + panelHeight - ((c.c - minP) / range) * panelHeight;
      const hY = y + panelHeight - ((c.h - minP) / range) * panelHeight;
      const lY = y + panelHeight - ((c.l - minP) / range) * panelHeight;

      // Wick
      svg += `<line x1="${x + candleW/2}" y1="${hY}" x2="${x + candleW/2}" y2="${lY}" stroke="${color}" stroke-width="1"/>`;
      // Body
      const bodyH = Math.max(1, Math.abs(cY - oY));
      svg += `<rect x="${x}" y="${Math.min(oY, cY)}" width="${candleW}" height="${bodyH}" fill="${color}"/>`;
    });

    // Zones
    (panel.zones || []).forEach(z => {
      const zY1 = y + panelHeight - ((z.hi - minP) / range) * panelHeight;
      const zY2 = y + panelHeight - ((z.lo - minP) / range) * panelHeight;
      const color = z.side === 'demand' ? 'rgba(0,200,83,0.2)' : 'rgba(255,59,48,0.2)';
      svg += `<rect x="0" y="${zY1}" width="${width}" height="${zY2 - zY1}" fill="${color}"/>`;
    });

    // Pools
    (panel.pools || []).forEach(p => {
      const pY = y + panelHeight - ((p.price - minP) / range) * panelHeight;
      svg += `<line x1="0" y1="${pY}" x2="${width}" y2="${pY}" stroke="#3b82f6" stroke-width="1" stroke-dasharray="4"/>`;
      svg += `<text x="${width - 60}" y="${pY - 2}" fill="#3b82f6" font-size="9">${p.label}</text>`;
    });

    // Panel label
    svg += `<text x="10" y="${y + 15}" fill="#fff" font-size="12" font-weight="bold">${panel.label}</text>`;
  });

  svg += '</svg>';

  // Convert to data URL
  const base64 = Buffer.from(svg).toString('base64');
  return 'data:image/svg+xml;base64,' + base64;
}
