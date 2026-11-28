export function sessionOf(ts, symbol) {
  const d = new Date(ts);
  const utcH = d.getUTCHours();
  const utcM = d.getUTCMinutes();
  const timeMin = utcH * 60 + utcM;

  // WIB offset = UTC+7
  const wibH = (utcH + 7) % 24;
  const wibStr = String(wibH).padStart(2, '0') + ':' + String(utcM).padStart(2, '0') + ' WIB';

  // Session definitions (UTC)
  const sessions = [
    { key: 'ASIA', start: 0, end: 480, liq: 0.6 },
    { key: 'LONDON_KZ', start: 480, end: 540, liq: 1.2 },
    { key: 'LONDON', start: 480, end: 960, liq: 1.0 },
    { key: 'NY_AM_KZ', start: 780, end: 840, liq: 1.3 },
    { key: 'NY', start: 780, end: 1020, liq: 1.1 },
    { key: 'CLOSE', start: 1020, end: 1440, liq: 0.5 },
  ];

  let sess = sessions.find(s => timeMin >= s.start && timeMin < s.end) || sessions[sessions.length - 1];

  return {
    key: sess.key,
    wib: wibStr,
    liq: sess.liq,
    mode: sess.liq >= 1.0 ? 'TREND' : (sess.liq >= 0.8 ? 'RANGE' : 'AVOID'),
    nextBoundaryMs: ts + (sess.end - timeMin) * 60000,
  };
}

export function asianRange(rows, symbol) {
  if (!Array.isArray(rows) || rows.length < 10) return null;
  const asia = rows.filter(c => {
    const h = new Date(c.t).getUTCHours();
    return h >= 0 && h < 8;
  });
  if (asia.length < 5) return null;
  const hi = Math.max(...asia.map(c => c.h));
  const lo = Math.min(...asia.map(c => c.l));
  return { hi, lo, mid: (hi + lo) / 2 };
}

export function asianSweep(rows, range, ctx) {
  if (!range || !Array.isArray(rows) || rows.length < 3) return null;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  
  if (last.l < range.lo && prev.l >= range.lo) {
    return { dir: 1, extreme: last.l, type: 'sweep_low' };
  }
  if (last.h > range.hi && prev.h <= range.hi) {
    return { dir: -1, extreme: last.h, type: 'sweep_high' };
  }
  return null;
}

export function sessionScore(sess, mode) {
  if (sess.mode === 'AVOID') return 3;
  if (sess.mode === 'RANGE' && mode === 'RANGE') return 12;
  if (sess.mode === 'TREND' && mode === 'TREND') return 13;
  if (sess.mode === 'TREND' && mode === 'SWEEP') return 10;
  return 7;
}

export function volatilityRegime(atrNow, atrBase, sess) {
  if (!atrNow || !atrBase || atrBase <= 0) return { regime: 'NORMAL', penalty: 0 };
  const ratio = atrNow / atrBase;
  if (ratio > 2.5) return { regime: 'SPIKE', penalty: 8 };
  if (ratio > 1.8) return { regime: 'HIGH', penalty: 4 };
  if (ratio < 0.5) return { regime: 'LOW', penalty: 3 };
  return { regime: 'NORMAL', penalty: 0 };
}
