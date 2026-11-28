export const SCENARIOS = {
  CONTINUATION: { id: 'SC-01', name: 'Kontinuitas Pullback', why: 'Pullback ke zona searah tren HTF' },
  RETEST_BOS: { id: 'SC-02', name: 'Retest BOS', why: 'Retest break of structure' },
  REVERSAL: { id: 'SC-03', name: 'Reversal Sweep', why: 'Sweep likuiditas + reversal' },
  FAKEOUT: { id: 'SC-04', name: 'Fakeout / Trap', why: 'Fake breakout / liquidity trap' },
  RANGE_EDGE: { id: 'SC-05', name: 'Ranging Edge', why: 'Edge of ranging market' },
  BREAKOUT: { id: 'SC-06', name: 'Breakout Impulse', why: 'Impulsive breakout' },
  UNCLEAR: { id: 'SC-08', name: 'Struktur Belum Jelas', why: 'Struktur pasar belum jelas' },
};

export function detectScenario({ ht, it, lt, chosen, verdict, sweepSess, rg, biasMode, dir, inside, distPip, momentum, preNews, sess }) {
  if (rg && sess.mode === 'RANGE') return SCENARIOS.RANGE_EDGE;
  if (verdict === 'SWEEP' || sweepSess) return SCENARIOS.REVERSAL;
  if (verdict === 'BREAK') return SCENARIOS.BREAKOUT;
  if (preNews) return SCENARIOS.FAKEOUT;
  if (ht.dir === dir && it.dir === dir && lt.dir === dir) return SCENARIOS.CONTINUATION;
  if (ht.dir === dir && it.fresh) return SCENARIOS.RETEST_BOS;
  if (biasMode === 'LTF_COUNTER') return SCENARIOS.REVERSAL;
  if (inside && distPip <= 20) return SCENARIOS.CONTINUATION;
  return SCENARIOS.UNCLEAR;
}

export function decideOrderType(scenario, { inside, distPip, reject, momentum, preNews, sess, ltfConfidence }) {
  if (momentum && inside && reject) {
    return { type: 'MARKET', reason: 'NOW: momentum LTF searah + rejection di zona' };
  }
  if (inside && distPip <= 10) {
    return { type: 'MARKET', reason: 'NOW: harga sudah di zona entry' };
  }
  return { type: 'LIMIT', reason: 'LIMIT: tunggu pullback ke tepi zona' };
}

export function cancelTolerance(riskPips, prox) {
  return Math.max(50, riskPips * 1.5, prox);
}
