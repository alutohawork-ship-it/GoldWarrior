// public/app.js — logika halaman uji coba sinyal. Bagian logika (fungsi export) bisa diuji di Node.
// Bagian DOM hanya berjalan di browser.

export const API_PATH = '/api/generate';

// Body request. Bot memakai auto=true (tanpa gaya). Manual memakai gaya.
// prevSignal hanya dikirim untuk sinyal yang masih aktif (PENDING/RUNNING), supaya server bisa menahannya.
export function buildRequest({ symbol = 'XAUUSD', mode = 'bot', style = 'Scalping', lang = 'id', prevSignal = null, forceNew = false } = {}) {
  const body = { symbol: String(symbol || 'XAUUSD').trim().toUpperCase(), lang: lang === 'en' ? 'en' : 'id' };
  if (mode === 'bot') body.auto = true; else body.style = style;
  if (prevSignal && (prevSignal.status === 'PENDING' || prevSignal.status === 'RUNNING')) body.prevSignal = prevSignal;
  if (forceNew) body.forceNew = true;
  return body;
}

// Sinyal yang harus dikirim kembali pada polling berikutnya (null bila tidak ada sinyal aktif).
export function nextPrevSignal(resp) {
  const s = resp && resp.ok && resp.signal;
  return s && (s.status === 'PENDING' || s.status === 'RUNNING') ? s : null;
}

export function checklistTone(line) {
  const t = String(line || '').trim().toUpperCase();
  if (t.startsWith('BELUM')) return 'bad';
  if (t.startsWith('OK')) return 'ok';
  return 'info';
}

export function fmtNum(v) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
  return String(v);
}

export function fmtTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Date(n).toLocaleTimeString('id-ID', { hour12: false });
}

export function describeError(resp, httpStatus) {
  if (resp && resp.reason) return resp.reason;
  if (httpStatus && httpStatus !== 200) return `HTTP ${httpStatus}`;
  return 'Respons tidak dikenal';
}

// Statistik kestabilan: mengukur seberapa sering sinyal yang sama berganti angka (indikator kedip).
export function newStats() {
  return { polls: 0, sameSignal: 0, entryChanges: 0, slChanges: 0, sticky: 0, last: null };
}

export function updateStats(stats, resp) {
  const s = resp && resp.signal;
  stats.polls++;
  if (!s || s.status === 'STANDBY') { stats.last = null; return stats; }
  if (s.sticky) stats.sticky++;
  const last = stats.last;
  if (last && last.signal === s.signal) {
    stats.sameSignal++;
    if (last.entry !== s.entry) stats.entryChanges++;
    if (last.sl !== s.sl) stats.slChanges++;
  }
  stats.last = { signal: s.signal, entry: s.entry, sl: s.sl };
  return stats;
}

export function describeStats(stats) {
  return `Polling ${stats.polls} · sinyal sama ${stats.sameSignal} · sticky ${stats.sticky} · ` +
    `entry berubah ${stats.entryChanges} · SL berubah ${stats.slChanges}`;
}

// ───────────── DOM (hanya di browser) ─────────────
const isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';
if (isBrowser) initApp();

function initApp() {
  const $ = id => document.getElementById(id);
  const els = {
    symbol: $('symbol'), mode: $('mode'), style: $('style'), lang: $('lang'), interval: $('interval'),
    toggle: $('toggle'), once: $('once'), reset: $('reset'), status: $('status'), err: $('err'),
    side: $('side'), badge: $('badge'), grid: $('grid'), reason: $('reason'), reasonSrc: $('reasonSrc'),
    checklist: $('checklist'), stats: $('stats'), log: $('log'),
  };
  let prev = null, timer = null, inFlight = false, stats = newStats();

  function kv(label, value) {
    const d = document.createElement('div'); d.className = 'kv';
    const s = document.createElement('span'); s.textContent = label;
    const b = document.createElement('b'); b.textContent = value;
    d.append(s, b);
    return d;
  }

  function renderEmpty() {
    els.side.textContent = '—'; els.side.className = 'side standby';
    els.badge.textContent = '—'; els.badge.className = 'badge';
    els.grid.replaceChildren();
    els.reason.textContent = '—'; els.reasonSrc.textContent = '';
    els.checklist.replaceChildren();
  }

  function renderSignal(resp) {
    const s = resp.signal || {};
    const standby = s.status === 'STANDBY' || s.signal === 'NONE';
    els.side.textContent = standby ? 'MENUNGGU' : s.signal;
    els.side.className = 'side ' + (standby ? 'standby' : (s.signal === 'BUY' ? 'buy' : 'sell'));
    els.badge.textContent = s.status || '—';
    els.badge.className = 'badge ' + String(s.status || '').toLowerCase();
    const cells = [
      kv('Entry', fmtNum(s.entry)), kv('SL', fmtNum(s.sl)),
      kv('TP1', fmtNum(s.tp1)), kv('TP2', fmtNum(s.tp2)), kv('TP3', fmtNum(s.tp3)),
      kv('Order', s.orderType && s.orderType !== 'NONE' ? s.orderType : '—'),
      kv('RR', s.rr != null ? `1:${s.rr}` : '—'), kv('Risiko (pip)', fmtNum(s.riskPips)),
      kv('Zona', s.zone ? `${fmtNum(s.zone.min)}–${fmtNum(s.zone.max)}` : '—'),
      kv('Dibuat', fmtTime(s.createdAt)), kv('Kadaluarsa', fmtTime(s.expiresAt)),
    ];
    if (s.nextCloseAt) cells.push(kv('Close M1 berikut', fmtTime(s.nextCloseAt)));
    els.grid.replaceChildren(...cells);
    els.reason.textContent = s.reason || (standby ? 'Menunggu setup valid.' : '(tanpa penjelasan)');
    els.reasonSrc.textContent = s.reasonSource ? `sumber: ${s.reasonSource}` : '';
    els.checklist.replaceChildren(...(s.checklist || []).map(line => {
      const li = document.createElement('li'); li.className = checklistTone(line); li.textContent = line; return li;
    }));
    els.stats.textContent = describeStats(stats);
  }

  function addLog(resp, ms, httpStatus) {
    const s = resp && resp.signal;
    const tr = document.createElement('tr');
    const cols = [
      fmtTime(Date.now()),
      s ? s.status : (resp && resp.ok === false ? 'ERROR' : '—'),
      s ? s.signal : '—',
      s ? fmtNum(s.entry) : '—',
      s && s.sticky ? 'ya' : '—',
      `${ms} ms${httpStatus && httpStatus !== 200 ? ' · HTTP ' + httpStatus : ''}`,
    ];
    for (const c of cols) { const td = document.createElement('td'); td.textContent = c; tr.append(td); }
    els.log.prepend(tr);
    while (els.log.children.length > 30) els.log.lastChild.remove();
  }

  async function poll() {
    if (inFlight) return;
    inFlight = true;
    const body = buildRequest({
      symbol: els.symbol.value, mode: els.mode.value, style: els.style.value,
      lang: els.lang.value, prevSignal: prev,
    });
    const t0 = performance.now();
    let resp = null, httpStatus = 0;
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch(API_PATH, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ac.signal,
      });
      httpStatus = r.status;
      resp = await r.json();
    } catch (e) {
      resp = { ok: false, reason: e.name === 'AbortError' ? 'Timeout (25 dtk)' : `Jaringan: ${e.message}` };
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
    const ms = Math.round(performance.now() - t0);
    if (!resp || !resp.ok) {
      els.err.textContent = describeError(resp, httpStatus);
    } else {
      els.err.textContent = '';
      updateStats(stats, resp);
      renderSignal(resp);
      prev = nextPrevSignal(resp);
    }
    els.status.textContent = `Terakhir ${fmtTime(Date.now())} · ${ms} ms · HTTP ${httpStatus || '—'}`;
    addLog(resp, ms, httpStatus);
  }

  function setRunning(on) {
    els.toggle.textContent = on ? 'Stop' : 'Mulai';
    els.toggle.className = on ? 'danger' : 'primary';
  }

  els.toggle.addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; setRunning(false); return; }
    const sec = Math.max(5, Number(els.interval.value) || 15);
    timer = setInterval(poll, sec * 1000);
    setRunning(true);
    poll();
  });
  els.once.addEventListener('click', poll);
  els.reset.addEventListener('click', () => {
    prev = null; stats = newStats();
    els.log.replaceChildren(); els.stats.textContent = '—'; els.err.textContent = '';
    renderEmpty();
  });
  for (const id of ['mode', 'style', 'symbol', 'lang']) {
    els[id].addEventListener('change', () => { prev = null; stats = newStats(); });
  }
  renderEmpty();
}
