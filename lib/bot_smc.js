// lib/bot_smc.js — BOT SCALPER memakai RANTAI SMC yang SAMA dengan manual Scalping (smc_flex).
// Urutan: simpleZonePlan (zona M5 + refine M1) -> scalpStructPlan -> flexScalpPlan -> pullbackPlan.
// Bedanya dengan manual hanya di dua hal, supaya bot stabil dan bisa dikirim sebagai satu sinyal:
//   1. Harga acuan dan waktu = close M1 tertutup (bukan harga live). Entry stabil selama satu candle.
//   2. Hanya order utama yang dikirim (OCO diabaikan), karena kontrak bot satu sinyal.
// Kontrak output sama dengan runBotSma lama (dipakai generate.js -> runBot).
import { simpleZonePlan, scalpStructPlan, flexScalpPlan, pullbackPlan } from './smc_flex.js';

export function runBotSma(bars, { price, dec = 2, pip = 0.1, symbol = 'XAUUSD' }) {
  const m1 = bars.m1 || [], m5 = bars.m5 || [], m15 = bars.m15 || [], h1 = bars.h1 || [];
  const last = m1.length ? m1[m1.length - 1] : null;
  const refPx = last ? last.c : price;      // harga acuan: close M1 tertutup
  const candleT = last ? last.t : Date.now();
  const barsC = { m1, m5, m15, h1, live: null };
  const pctx = { price: refPx, dec, pip, now: candleT, symbol };

  // Urutan persis seperti runDocManual (Scalping)
  let out = simpleZonePlan(barsC, pctx, { tfs: ['M5'] });
  if (!out.ok) {
    const st = scalpStructPlan(barsC, pctx);
    out = st.ok ? st : { ...out, checks: [...(out.checks || []), ...(st.checks || [])] };
  }
  if (!out.ok) {
    const fx = flexScalpPlan(barsC, pctx);
    out = fx.ok ? fx : { ...out, checks: [...(out.checks || []), ...(fx.checks || [])] };
  }
  if (!out.ok) {
    const pb = pullbackPlan(barsC, pctx);
    out = pb.ok ? pb : { ...out, checks: [...(out.checks || []), ...(pb.checks || [])] };
  }

  const checks = Array.isArray(out.checks) ? out.checks : [];
  const rawBias = out.bias || (out.regime ? out.regime.replace('_', ' ') : 'netral');
  const srcPart = out.biasTf ? ` · ${out.biasTf}` : (out.regimeSrc ? ` · ${out.regimeSrc}` : '');
  const trendTxt = `${rawBias}${srcPart}`;

  if (!out.ok) {
    const reason = out.reason || (checks.length ? checks[checks.length - 1] : 'Belum ada setup valid.');
    return {
      ok: false, reason, dirTxt: '-', trigger: null,
      bias: out.bias || 'NETRAL', trendTxt, structTxt: out.regimeSrc || '-',
      checklist: checks.slice(-12), candleT,
    };
  }

  const o = out.order;
  const dir = o.side === 'buy' ? 1 : -1;
  return {
    ok: true, dir, dirTxt: dir === 1 ? 'BUY' : 'SELL',
    role: o.role || 'main', tier: 'SMC_CHAIN', bias: out.bias || 'NETRAL',
    trigger: o.reason, checklist: checks.slice(-12),
    trendTxt, structTxt: out.regimeSrc || '-',
    entry: o.entryPrice, sl: o.sl, tps: [o.tp1, o.tp2, o.tp3], rr: o.rr, tpMode: o.tpMode,
    orderType: o.orderType || 'LIMIT', riskPips: o.riskPips, invalidLevel: o.invalidLevel ?? null,
    confidence: o.confirmed ? 'HIGH' : 'MEDIUM',
    setup: `Bot SMC · ${o.reason}`, reason: null,
    zone: out.zone || null,
    expiresAt: Number.isFinite(Number(o.expiryTime)) ? Number(o.expiryTime) : candleT + 15 * 60e3,
    candleT,
  };
}
