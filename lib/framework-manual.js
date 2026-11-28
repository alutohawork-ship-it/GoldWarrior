export function resolveBias({ ht, it, lt, zones, ctx, style, atrM15, slPips, allowCounter = true }) {
  let dir = ht.dir !== 0 ? ht.dir : (it.dir !== 0 ? it.dir : lt.dir);
  let mode = 'HTF_LEAD';
  let penalty = 0;

  if (ht.dir === 0 && it.dir !== 0) {
    dir = it.dir;
    mode = 'MTF_LEAD';
    penalty += 10;
  }

  if (lt.dir !== 0 && lt.dir !== dir && allowCounter) {
    const ltStrength = lt.fresh ? 15 : 5;
    const htStrength = ht.fresh ? 20 : (ht.dir !== 0 ? 10 : 0);
    
    if (ltStrength > htStrength) {
      dir = lt.dir;
      mode = 'LTF_COUNTER';
      penalty += 15;
    }
  }

  return { dir, mode, penalty };
}

export function counterGuard(bias, slPips) {
  if (bias.mode === 'LTF_COUNTER' && bias.penalty > 20) {
    return { ok: false, reason: 'Counter-trend penalty too high' };
  }
  return { ok: true };
}

export function adjustConviction(conv, bias, tps, entry, dir) {
  let adj = conv;
  if (bias.mode === 'LTF_COUNTER') adj -= 10;
  if (bias.penalty > 0) adj -= bias.penalty * 0.5;
  return { conviction: Math.max(0, Math.min(100, Math.round(adj))) };
}

export function counterExpiry(style) {
  const m = {
    Scalping: { candles: 8, tf: 'M1', minutes: 8 },
    Intraday: { candles: 6, tf: 'M30', minutes: 180 },
    Swing: { candles: 8, tf: 'H1', minutes: 480 },
  };
  const e = m[style] || m.Scalping;
  return { ...e, id: 'Counter-trend: ' + e.candles + ' ' + e.tf + ' candles', en: e.id };
}

export function nearestWall(ctx, dir, zones, htf, mtf) {
  const valid = zones.filter(z => z.tf === htf || z.tf === mtf);
  if (!valid.length) return null;
  
  const sorted = valid.sort((a, b) => {
    const da = dir === 1 ? a.hi - ctx.price : ctx.price - a.lo;
    const db = dir === 1 ? b.hi - ctx.price : ctx.price - b.lo;
    return da - db;
  });
  
  return sorted[0] ? (dir === 1 ? sorted[0].hi : sorted[0].lo) : null;
}
