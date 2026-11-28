export function runBotSma({ m1, m5, m15 }, ctx) {
  if (!Array.isArray(m1) || m1.length < 20) return { ok: false };
  if (!Array.isArray(m5) || m5.length < 10) return { ok: false };

  // Simple 3-candle pattern
  const last3 = m1.slice(-3);
  const [c1, c2, c3] = last3;

  // Bullish engulfing
  if (c1.c < c1.o && c3.c > c3.o && c3.c > c1.o && c3.o < c1.c) {
    return {
      ok: true,
      dir: 1,
      entry: ctx.price,
      sl: Math.min(c1.l, c2.l, c3.l) - ctx.pip * 5,
      orderType: 'MARKET',
      tier: '3CANDLE',
      trigger: 'Bullish Engulfing M1',
      bias: 'M5 ' + (m5[m5.length - 1].c > m5[m5.length - 2].c ? 'bullish' : 'bearish'),
    };
  }

  // Bearish engulfing
  if (c1.c > c1.o && c3.c < c3.o && c3.c < c1.o && c3.o > c1.c) {
    return {
      ok: true,
      dir: -1,
      entry: ctx.price,
      sl: Math.max(c1.h, c2.h, c3.h) + ctx.pip * 5,
      orderType: 'MARKET',
      tier: '3CANDLE',
      trigger: 'Bearish Engulfing M1',
      bias: 'M5 ' + (m5[m5.length - 1].c > m5[m5.length - 2].c ? 'bullish' : 'bearish'),
    };
  }

  return { ok: false, reason: 'No pattern' };
}
