export function findPools(rows, ctx, d1) {
  if (!Array.isArray(rows) || rows.length < 20) return [];
  
  const pools = [];
  const n = rows.length;
  
  // Find swing highs/lows
  for (let i = 5; i < n - 5; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - 5; j <= i + 5; j++) {
      if (j === i) continue;
      if (rows[j].h >= rows[i].h) isHigh = false;
      if (rows[j].l <= rows[i].l) isLow = false;
    }
    
    if (isHigh) {
      pools.push({
        price: rows[i].h,
        type: 'swing_high',
        side: 'supply',
        strength: 5,
        state: 'VIRGIN',
        ahead: rows[i].h > ctx.price,
        distPip: (rows[i].h - ctx.price) / ctx.pip,
      });
    }
    if (isLow) {
      pools.push({
        price: rows[i].l,
        type: 'swing_low',
        side: 'demand',
        strength: 5,
        state: 'VIRGIN',
        ahead: rows[i].l < ctx.price,
        distPip: (ctx.price - rows[i].l) / ctx.pip,
      });
    }
  }
  
  return pools.sort((a, b) => a.distPip - b.distPip);
}

export function sweepVsBreak(price, side, ltfRows, ctx) {
  if (!Array.isArray(ltfRows) || ltfRows.length < 3) return { verdict: 'NONE' };
  
  const last = ltfRows[ltfRows.length - 1];
  const prev = ltfRows[ltfRows.length - 2];
  
  if (side === 'supply') {
    if (last.h > price && prev.h <= price && last.c < price) {
      return { verdict: 'SWEEP', dir: -1 };
    }
    if (last.h > price && last.c > price) {
      return { verdict: 'BREAK', dir: 1 };
    }
  } else {
    if (last.l < price && prev.l >= price && last.c > price) {
      return { verdict: 'SWEEP', dir: 1 };
    }
    if (last.l < price && last.c < price) {
      return { verdict: 'BREAK', dir: -1 };
    }
  }
  
  return { verdict: 'NONE' };
}

export function doubleSweep(pools, ltfRows, ctx) {
  if (!Array.isArray(ltfRows) || ltfRows.length < 10) return false;
  
  const last10 = ltfRows.slice(-10);
  let sweepCount = 0;
  
  pools.forEach(p => {
    last10.forEach(c => {
      if (p.side === 'supply' && c.h > p.price) sweepCount++;
      if (p.side === 'demand' && c.l < p.price) sweepCount++;
    });
  });
  
  return sweepCount >= 2;
}

export function nearestDraw(pools, dir, ctx) {
  const valid = pools.filter(p => p.ahead && p.strength >= 4);
  if (!valid.length) return null;
  return valid[0];
}

export function slBeyondPool(pools, dir, entry, ctx, atr) {
  const valid = pools.filter(p => {
    if (dir === 1) return p.side === 'demand' && p.price < entry;
    return p.side === 'supply' && p.price > entry;
  });
  
  if (!valid.length) return null;
  
  const nearest = valid.reduce((best, p) => {
    const dist = Math.abs(entry - p.price);
    const bestDist = Math.abs(entry - best.price);
    return dist < bestDist ? p : best;
  });
  
  const buffer = atr * 0.5;
  const level = dir === 1 ? nearest.price - buffer : nearest.price + buffer;
  
  return { pool: nearest, level };
}
