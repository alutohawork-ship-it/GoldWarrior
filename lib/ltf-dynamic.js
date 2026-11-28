export const LTF_TF = {
  Scalping: 'm1',
  Intraday: 'm5',
  Swing: 'h1',
};

export function monitorLTFStructure(rows, dir, ctx, style) {
  if (!Array.isArray(rows) || rows.length < 10) {
    return { valid: false, confidence: 0, reason: 'data insufficient' };
  }

  const n = rows.length;
  const last = rows[n - 1];
  const prev = rows[n - 2];

  // Simple structure check
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (let i = 2; i < n; i++) {
    if (rows[i].h > rows[i-1].h && rows[i-1].h > rows[i-2].h) hh++;
    if (rows[i].l > rows[i-1].l && rows[i-1].l > rows[i-2].l) hl++;
    if (rows[i].h < rows[i-1].h && rows[i-1].h < rows[i-2].h) lh++;
    if (rows[i].l < rows[i-1].l && rows[i-1].l < rows[i-2].l) ll++;
  }

  const bullish = hh + hl;
  const bearish = lh + ll;

  if (dir === 1) {
    const valid = bullish > bearish;
    const confidence = Math.min(100, Math.round((bullish / (bullish + bearish + 1)) * 100));
    return { valid, confidence, reason: valid ? 'HH/HL intact' : 'Structure broken' };
  } else {
    const valid = bearish > bullish;
    const confidence = Math.min(100, Math.round((bearish / (bullish + bearish + 1)) * 100));
    return { valid, confidence, reason: valid ? 'LH/LL intact' : 'Structure broken' };
  }
}

export function calculatePreciseSL(entry, dir, rows, ctx, mult = 1.5) {
  if (!Array.isArray(rows) || rows.length < 5) return null;
  
  const n = rows.length;
  const atr = rows.slice(-14).reduce((sum, c, i, arr) => {
    if (i === 0) return 0;
    const tr = Math.max(c.h - c.l, Math.abs(c.h - arr[i-1].c), Math.abs(c.l - arr[i-1].c));
    return sum + tr;
  }, 0) / 14;

  if (!atr || atr <= 0) return null;

  const slDist = atr * mult;
  const sl = entry - dir * slDist;
  const distancePips = slDist / ctx.pip;

  return {
    sl,
    distancePips,
    reason: 'ATR-based SL (' + mult + 'x)',
  };
}
