export function atrSanity(atrNow, atrBase) {
  if (!atrNow || !atrBase || atrBase <= 0) return atrNow || atrBase || 1;
  const ratio = atrNow / atrBase;
  if (ratio > 3) return atrBase * 2;
  if (ratio < 0.3) return atrBase * 0.5;
  return atrNow;
}

export function calcSL({ entry, dir, ctx, b, sess, atrUse, structLevel, poolLevel, rangeBound, tfKey }) {
  const pip = ctx.pip;
  const minSL = Math.max(20, (b.min / pip) * 0.6);
  const maxSL = (b.max / pip) * 1.3;
  
  let slDist = minSL;
  let reason = 'default';
  let capped = false;

  if (Number.isFinite(structLevel) && structLevel > 0) {
    slDist = Math.abs(entry - structLevel) / pip;
    reason = 'swing ' + tfKey;
  }

  if (Number.isFinite(poolLevel) && poolLevel > 0) {
    const poolDist = Math.abs(entry - poolLevel) / pip;
    if (poolDist > slDist * 0.8) {
      slDist = poolDist;
      reason = 'pool';
    }
  }

  if (Number.isFinite(rangeBound) && rangeBound > 0) {
    const rangeDist = Math.abs(entry - rangeBound) / pip;
    if (rangeDist < slDist) {
      slDist = rangeDist;
      reason = 'range bound';
    }
  }

  // ATR-based
  const atrDist = atrUse / pip * 1.5;
  if (atrDist > slDist) {
    slDist = atrDist;
    reason = 'ATR';
  }

  // Clamp
  if (slDist < minSL) {
    slDist = minSL;
    capped = true;
  }
  if (slDist > maxSL) {
    slDist = maxSL;
    capped = true;
  }

  const sl = entry - dir * slDist * pip;
  const riskPips = slDist;

  return { sl, riskPips, capped, reason };
}
