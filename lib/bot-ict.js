export function planBot({ m15, m5, price, sym, tNow }) {
  if (!Array.isArray(m15) || m15.length < 20) return null;
  if (!Array.isArray(m5) || m5.length < 10) return null;

  // Simple ICT POI detection
  const n = m15.length;
  const last = m15[n - 1];
  
  // Find recent swing high/low
  let swingHigh = -Infinity, swingLow = Infinity;
  for (let i = n - 10; i < n; i++) {
    if (m15[i].h > swingHigh) swingHigh = m15[i].h;
    if (m15[i].l < swingLow) swingLow = m15[i].l;
  }

  const range = swingHigh - swingLow;
  if (range <= 0) return null;

  const mid = (swingHigh + swingLow) / 2;
  const fvg = findFVG(m15);

  let dir, entry, sl;

  if (price < mid && fvg && fvg.side === 'demand') {
    dir = 'BUY';
    entry = fvg.hi;
    sl = swingLow - range * 0.1;
  } else if (price > mid && fvg && fvg.side === 'supply') {
    dir = 'SELL';
    entry = fvg.lo;
    sl = swingHigh + range * 0.1;
  } else {
    return null;
  }

  return {
    status: 'limit',
    dir,
    entry,
    sl,
    tp1: dir === 'BUY' ? entry + (entry - sl) : entry - (sl - entry),
    reason: 'ICT POI + FVG',
  };
}

function findFVG(rows) {
  if (!Array.isArray(rows) || rows.length < 3) return null;
  
  for (let i = rows.length - 10; i < rows.length - 2; i++) {
    const prev = rows[i];
    const curr = rows[i + 1];
    const next = rows[i + 2];
    
    if (prev.h < next.l) {
      return { side: 'demand', lo: prev.h, hi: next.l };
    }
    if (prev.l > next.h) {
      return { side: 'supply', lo: next.h, hi: prev.l };
    }
  }
  
  return null;
}
