export const TP_PLAN = {
  Scalping: { mode: 'RISK_R', targets: [1, 1.5, 2.5], count: 3 },
  Intraday: { mode: 'RISK_R', targets: [1, 1.5, 2.5], count: 3 },
  Swing: { mode: 'RISK_R', targets: [1, 1.5, 2.5], count: 3 },
};

export function planTPs({ style, entry, dir, risk, pip, wall, draw, dp }) {
  const plan = TP_PLAN[style] || TP_PLAN.Scalping;
  
  if (plan.mode === 'RISK_R') {
    const tps = plan.targets.map(m => entry + dir * risk * m);
    const rr1 = risk > 0 ? (tps[0] - entry) / risk * dir : 1;
    const poorRR = rr1 < 0.8;
    return {
      tps,
      count: plan.count,
      mode: plan.mode,
      pips: tps.map(t => Math.abs(t - entry) / pip),
      rr1,
      poorRR,
      runwayPip: wall ? Math.abs(wall - entry) / pip : null,
    };
  }

  if (plan.mode === 'FIXED_PIP') {
    const tps = plan.targets.map(t => entry + dir * t * pip);
    return {
      tps,
      count: plan.count,
      mode: plan.mode,
      pips: plan.targets,
      rr1: plan.targets[0] * pip / risk,
      poorRR: false,
      runwayPip: null,
    };
  }

  return { tps: [], count: 0, mode: 'UNKNOWN', pips: [], rr1: 0, poorRR: true, runwayPip: null };
}

export function repairTPs(sig, f, pip) {
  if (!sig || typeof sig !== 'object') return sig;
  const dir = sig.signal === 'BUY' ? 1 : -1;
  const entry = Number(sig.entry);
  const sl = Number(sig.sl);
  const risk = Math.abs(entry - sl);
  
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || risk <= 0) return sig;

  const plan = TP_PLAN[sig.style] || TP_PLAN.Scalping;
  const tps = [sig.tp1, sig.tp2, sig.tp3].map((v, i) => {
    const num = Number(v);
    if (Number.isFinite(num) && num !== entry && num !== 0) return num;
    const base = plan.mode === 'PIP' ? plan.targets[i] * pip : risk * plan.targets[i];
    return entry + dir * base;
  });

  return {
    ...sig,
    tp1: f(tps[0]),
    tp2: f(tps[1]),
    tp3: f(tps[2]),
    tp4: null,
    tp5: null,
    tpCount: 3,
  };
}

export function coupleZone(zone, entry, dir, pip, atr) {
  if (!zone) return zone;
  const w = zone.hi - zone.lo;
  const minW = Math.max(10 * pip, atr * 0.3);
  if (w < minW) {
    const mid = (zone.hi + zone.lo) / 2;
    return { ...zone, lo: mid - minW / 2, hi: mid + minW / 2 };
  }
  return zone;
}

export function buildChart(sig, pip, dp, f, style) {
  return {
    tf: style === 'Scalping' ? 'M5' : style === 'Intraday' ? 'M30' : 'H4',
    range: {
      spanPips: sig.tp3 && sig.sl ? Math.abs(sig.tp3 - sig.sl) / pip : 0,
    },
  };
}
