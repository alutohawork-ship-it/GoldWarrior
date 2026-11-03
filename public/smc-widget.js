(function (global) {
    const TF_MIN = { M1: 1, M5: 5, M15: 15, H1: 60, H4: 240 };
    const MODE_TF = {
        scalping: ['M1', 'M5'],
        intraday: ['M15', 'H1'],
        swing:    ['H1', 'H4']
    };

    const fmt = (n, d = 2) => (n == null || !isFinite(n) ? '-' : Number(n).toFixed(d));
    const round = (n, d = 2) => (n == null || !isFinite(n) ? null : Number(Number(n).toFixed(d)));

    // ================= Indikator =================
    function ema(values, period) {
        if (values.length < period) return null;
        const k = 2 / (period + 1);
        let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
        return e;
    }

    function rsi(closes, period = 14) {
        if (closes.length < period + 1) return null;
        let gain = 0, loss = 0;
        for (let i = 1; i <= period; i++) {
            const d = closes[i] - closes[i - 1];
            if (d >= 0) gain += d; else loss -= d;
        }
        gain /= period; loss /= period;
        for (let i = period + 1; i < closes.length; i++) {
            const d = closes[i] - closes[i - 1];
            gain = (gain * (period - 1) + Math.max(d, 0)) / period;
            loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
        }
        if (loss === 0) return 100;
        return 100 - 100 / (1 + gain / loss);
    }

    function atr(c, period = 14) {
        if (c.length < period + 1) return null;
        const trs = [];
        for (let i = 1; i < c.length; i++) {
            trs.push(Math.max(
                c[i].h - c[i].l,
                Math.abs(c[i].h - c[i - 1].c),
                Math.abs(c[i].l - c[i - 1].c)
            ));
        }
        let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
        for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
        return a;
    }

    // ================= Candle builder =================
    function aggregate(m1, minutes) {
        if (minutes === 1) return m1.map(c => ({ ...c }));
        const ms = minutes * 60000;
        const out = [];
        for (const c of m1) {
            const t = Math.floor(c.t / ms) * ms;
            const last = out[out.length - 1];
            if (last && last.t === t) {
                last.h = Math.max(last.h, c.h);
                last.l = Math.min(last.l, c.l);
                last.c = c.c;
            } else {
                out.push({ t, o: c.o, h: c.h, l: c.l, c: c.c });
            }
        }
        return out;
    }

    // ================= SMC =================
    function findSwings(c, k = 2) {
        const highs = [], lows = [];
        for (let i = k; i < c.length - k; i++) {
            let isH = true, isL = true;
            for (let j = 1; j <= k; j++) {
                if (!(c[i].h > c[i - j].h && c[i].h >= c[i + j].h)) isH = false;
                if (!(c[i].l < c[i - j].l && c[i].l <= c[i + j].l)) isL = false;
            }
            if (isH) highs.push({ i, price: c[i].h });
            if (isL) lows.push({ i, price: c[i].l });
        }
        return { highs, lows };
    }

    function analyzeStructure(c, k = 2) {
        const { highs, lows } = findSwings(c, k);
        let trend = 'NEUTRAL';
        const events = [];
        const obs = [];
        let hIdx = 0, lIdx = 0, lastHigh = null, lastLow = null;

        for (let i = 0; i < c.length; i++) {
            // Swing baru dianggap valid setelah k candle berikutnya terbentuk
            while (hIdx < highs.length && highs[hIdx].i + k <= i) { lastHigh = { ...highs[hIdx], broken: false }; hIdx++; }
            while (lIdx < lows.length && lows[lIdx].i + k <= i) { lastLow = { ...lows[lIdx], broken: false }; lIdx++; }

            // Break ke atas
            if (lastHigh && !lastHigh.broken && c[i].c > lastHigh.price) {
                events.push({ type: trend === 'BEARISH' ? 'CHoCH' : 'BOS', dir: 'BULLISH', level: lastHigh.price, i });
                trend = 'BULLISH';
                lastHigh.broken = true;
                // Bullish OB = candle bearish terakhir sebelum impuls naik
                for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
                    if (c[j].c < c[j].o) {
                        obs.push({ dir: 'BULLISH', top: c[j].h, bottom: c[j].l, i: j, breakIdx: i, mitigated: false, invalid: false });
                        break;
                    }
                }
            }

            // Break ke bawah
            if (lastLow && !lastLow.broken && c[i].c < lastLow.price) {
                events.push({ type: trend === 'BULLISH' ? 'CHoCH' : 'BOS', dir: 'BEARISH', level: lastLow.price, i });
                trend = 'BEARISH';
                lastLow.broken = true;
                // Bearish OB = candle bullish terakhir sebelum impuls turun
                for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
                    if (c[j].c > c[j].o) {
                        obs.push({ dir: 'BEARISH', top: c[j].h, bottom: c[j].l, i: j, breakIdx: i, mitigated: false, invalid: false });
                        break;
                    }
                }
            }
        }

        // Status OB: mitigated jika disentuh, invalid jika ditembus (close)
        for (const ob of obs) {
            for (let j = ob.breakIdx + 1; j < c.length; j++) {
                if (ob.dir === 'BULLISH') {
                    if (c[j].c < ob.bottom) { ob.invalid = true; break; }
                    if (c[j].l <= ob.top) ob.mitigated = true;
                } else {
                    if (c[j].c > ob.top) { ob.invalid = true; break; }
                    if (c[j].h >= ob.bottom) ob.mitigated = true;
                }
            }
        }

        return {
            trend,
            events,
            lastEvent: events[events.length - 1] || null,
            swingHigh: highs[highs.length - 1] || null,
            swingLow: lows[lows.length - 1] || null,
            bullOB: obs.filter(o => o.dir === 'BULLISH' && !o.invalid).pop() || null,
            bearOB: obs.filter(o => o.dir === 'BEARISH' && !o.invalid).pop() || null
        };
    }

    function findFVG(c, minSize = 0) {
        const out = [];
        for (let i = 2; i < c.length; i++) {
            if (c[i].l - c[i - 2].h > minSize) out.push({ dir: 'BULLISH', top: c[i].l, bottom: c[i - 2].h, i: i - 1 });
            if (c[i - 2].l - c[i].h > minSize) out.push({ dir: 'BEARISH', top: c[i - 2].l, bottom: c[i].h, i: i - 1 });
        }
        for (const g of out) {
            g.filled = false;
            for (let j = g.i + 2; j < c.length; j++) {
                if (g.dir === 'BULLISH' && c[j].l <= g.bottom) { g.filled = true; break; }
                if (g.dir === 'BEARISH' && c[j].h >= g.top) { g.filled = true; break; }
            }
        }
        return out.filter(g => !g.filled).slice(-3);
    }

    function analyzeTF(c) {
        const closes = c.map(x => x.c);
        const price = closes[closes.length - 1];
        const st = analyzeStructure(c);
        const rsiV = rsi(closes, 14);
        const ema20 = ema(closes, 20);
        const ema50 = ema(closes, 50);
        const atrV = atr(c, 14);
        const fvg = findFVG(c, atrV ? atrV * 0.1 : 0);

        // Premium / Discount
        let zone = 'UNKNOWN', zonePct = null;
        if (st.swingHigh && st.swingLow && st.swingHigh.price > st.swingLow.price) {
            zonePct = (price - st.swingLow.price) / (st.swingHigh.price - st.swingLow.price);
            zone = zonePct > 0.55 ? 'PREMIUM' : zonePct < 0.45 ? 'DISCOUNT' : 'EQUILIBRIUM';
        }

        // Skor (positif = bullish, negatif = bearish)
        let score = 0;
        if (st.trend === 'BULLISH') score += 2;
        if (st.trend === 'BEARISH') score -= 2;
        if (st.lastEvent?.type === 'CHoCH') score += st.lastEvent.dir === 'BULLISH' ? 1 : -1;
        if (ema20 != null) score += price > ema20 ? 1 : -1;
        if (ema50 != null) score += price > ema50 ? 1 : -1;
        if (rsiV != null) { if (rsiV > 55) score += 1; else if (rsiV < 45) score -= 1; }
        if (zone === 'DISCOUNT' && st.trend === 'BULLISH') score += 1;
        if (zone === 'PREMIUM' && st.trend === 'BEARISH') score -= 1;

        return { ready: true, candles: c.length, price, ...st, rsi: rsiV, ema20, ema50, atr: atrV, zone, zonePct, fvg, score };
    }

    function toRecommendation(score) {
        if (score >= 8) return 'STRONG_BUY';
        if (score >= 3) return 'BUY';
        if (score <= -8) return 'STRONG_SELL';
        if (score <= -3) return 'SELL';
        return 'NEUTRAL';
    }

    // ================= Widget =================
    const STYLE = `
    .smc-w{font-family:system-ui,sans-serif;background:#0f141c;color:#e6e9ef;border:1px solid #1f2a37;border-radius:12px;padding:16px;max-width:760px}
    .smc-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    .smc-title{font-size:13px;color:#8b98a9}
    .smc-price{font-size:26px;font-weight:700}
    .smc-w select{background:#1a2230;color:#e6e9ef;border:1px solid #2b3a4d;border-radius:8px;padding:6px 10px}
    .smc-rec{margin:12px 0 4px;padding:10px;border-radius:8px;text-align:center;font-weight:700;letter-spacing:1px;background:#2a3342}
    .smc-rec.buy{background:#0f5132;color:#7dffb3}.smc-rec.sell{background:#5c1a1a;color:#ff9b9b}
    .smc-status{font-size:12px;color:#8b98a9;margin-bottom:8px}
    .smc-w canvas{width:100%;height:220px;background:#0b1017;border-radius:8px;display:block}
    .smc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin-top:10px}
    .smc-card{background:#141b26;border-radius:8px;padding:10px;font-size:13px}
    .smc-card h4{margin:0 0 6px;font-size:14px}
    .smc-row{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dashed #1f2a37}
    .smc-row span:first-child{color:#8b98a9}
    .bull{color:#4ade80}.bear{color:#f87171}`;

    class SMCWidget {
        constructor(el, opts = {}) {
            this.el = typeof el === 'string' ? document.querySelector(el) : el;
            this.opts = {
                priceUrl: '/api/price',
                pollMs: 10000,
                mode: 'intraday',
                maxM1: 6000,          // ±4 hari data M1
                minCandles: 30,       // minimal candle per TF agar dianalisa
                storageKey: 'xau_m1_candles_v1',
                onUpdate: null,
                ...opts
            };
            this.m1 = this.load();
            this.lastPrice = this.m1.length ? this.m1[this.m1.length - 1].c : null;
            this.state = null;

            this.render();
            this.update();
            this.tick();
            this.timer = setInterval(() => this.tick(), this.opts.pollMs);
            window.addEventListener('resize', () => this.update());
        }

        load() {
            try { return JSON.parse(localStorage.getItem(this.opts.storageKey)) || []; }
            catch { return []; }
        }

        save() {
            try { localStorage.setItem(this.opts.storageKey, JSON.stringify(this.m1.slice(-this.opts.maxM1))); }
            catch (e) { console.warn('Gagal simpan candle:', e); }
        }

        async tick() {
            try {
                const r = await fetch(this.opts.priceUrl, { cache: 'no-store' });
                const d = await r.json();
                const p = parseFloat(d.price);
                if (!isFinite(p) || p <= 0) throw new Error('Harga tidak valid');
                this.addTick(p, Date.now());
                this.lastPrice = p;
                this.update();
            } catch (e) {
                this.$('status').textContent = '⚠️ Gagal mengambil harga, mencoba lagi...';
            }
        }

        addTick(p, t) {
            const start = Math.floor(t / 60000) * 60000;
            const last = this.m1[this.m1.length - 1];
            if (last && last.t === start) {
                last.h = Math.max(last.h, p);
                last.l = Math.min(last.l, p);
                last.c = p;
            } else {
                this.m1.push({ t: start, o: p, h: p, l: p, c: p });
                if (this.m1.length > this.opts.maxM1) this.m1.splice(0, this.m1.length - this.opts.maxM1);
            }
            this.save();
        }

        setMode(mode) {
            if (!MODE_TF[mode]) return;
            this.opts.mode = mode;
            this.$('mode').value = mode;
            this.update();
        }

        resetData() {
            this.m1 = [];
            localStorage.removeItem(this.opts.storageKey);
            this.update();
        }

        render() {
            if (!document.getElementById('smc-widget-style')) {
                const s = document.createElement('style');
                s.id = 'smc-widget-style';
                s.textContent = STYLE;
                document.head.appendChild(s);
            }
            this.el.innerHTML = `
            <div class="smc-w">
              <div class="smc-head">
                <div>
                  <div class="smc-title">XAU/USD · SMC Structure Analyzer</div>
                  <div class="smc-price" data-r="price">-</div>
                </div>
                <select data-r="mode">
                  <option value="scalping">Scalping (M1 + M5)</option>
                  <option value="intraday">Intraday (M15 + H1)</option>
                  <option value="swing">Swing (H1 + H4)</option>
                </select>
              </div>
              <div class="smc-rec" data-r="rec">MENGUMPULKAN DATA</div>
              <div class="smc-status" data-r="status"></div>
              <canvas data-r="chart"></canvas>
              <div class="smc-grid" data-r="tfs"></div>
            </div>`;
            this.$('mode').value = this.opts.mode;
            this.$('mode').onchange = e => this.setMode(e.target.value);
        }

        $(name) { return this.el.querySelector(`[data-r="${name}"]`); }

        update() {
            const [ltf, htf] = MODE_TF[this.opts.mode];
            const tfs = {};
            const series = {};
            for (const tf of [ltf, htf]) {
                const c = aggregate(this.m1, TF_MIN[tf]).slice(-300);
                series[tf] = c;
                tfs[tf] = c.length >= this.opts.minCandles ? analyzeTF(c) : { ready: false, candles: c.length };
            }

            const readyCount = Object.values(tfs).filter(t => t.ready).length;
            const dataQuality = readyCount === 2 ? 'FULL' : readyCount === 1 ? 'PARTIAL' : 'INSUFFICIENT';

            // Bobot: TF besar lebih kuat
            let score = 0;
            if (tfs[ltf].ready) score += tfs[ltf].score * 1.0;
            if (tfs[htf].ready) score += tfs[htf].score * 1.5;
            score = Math.round(score * 10) / 10;

            // Jika data tidak cukup, jangan beri sinyal
            const recommendation = dataQuality === 'INSUFFICIENT' ? 'NEUTRAL' : toRecommendation(score);

            this.state = { price: this.lastPrice, mode: this.opts.mode, ltf, htf, tfs, score, recommendation, dataQuality };

            this.paint(series[ltf], tfs[ltf]);
            if (typeof this.opts.onUpdate === 'function') this.opts.onUpdate(this.getAnalysis());
        }

        paint(ltfCandles, ltfRes) {
            const s = this.state;
            this.$('price').textContent = s.price ? `$${fmt(s.price)}` : '-';

            const rec = this.$('rec');
            rec.textContent = s.dataQuality === 'INSUFFICIENT'
                ? 'MENGUMPULKAN DATA'
                : `${s.recommendation.replace('_', ' ')} (skor ${s.score})`;
            rec.className = 'smc-rec' + (s.recommendation.includes('BUY') ? ' buy' : s.recommendation.includes('SELL') ? ' sell' : '');

            const prog = [s.ltf, s.htf]
                .map(tf => `${tf}: ${Math.min(s.tfs[tf].candles, this.opts.minCandles)}/${this.opts.minCandles} candle`)
                .join(' · ');
            this.$('status').textContent = `Data: ${s.dataQuality} · ${prog} · Total M1 tersimpan: ${this.m1.length}`;

            this.$('tfs').innerHTML = [s.ltf, s.htf].map(tf => this.cardHTML(tf, s.tfs[tf])).join('');
            this.draw(ltfCandles, ltfRes);
        }

        cardHTML(tf, r) {
            if (!r.ready) {
                return `<div class="smc-card"><h4>${tf}</h4>Mengumpulkan data... (${r.candles}/${this.opts.minCandles})</div>`;
            }
            const cls = r.trend === 'BULLISH' ? 'bull' : r.trend === 'BEARISH' ? 'bear' : '';
            const ev = r.lastEvent ? `${r.lastEvent.type} ${r.lastEvent.dir} @ ${fmt(r.lastEvent.level)}` : '-';
            const ob = o => o ? `${fmt(o.bottom)} - ${fmt(o.top)}${o.mitigated ? ' (mitigated)' : ''}` : '-';
            const fvg = r.fvg.length
                ? r.fvg.map(g => `<span class="${g.dir === 'BULLISH' ? 'bull' : 'bear'}">${fmt(g.bottom)}-${fmt(g.top)}</span>`).join(', ')
                : '-';
            const row = (k, v) => `<div class="smc-row"><span>${k}</span><span>${v}</span></div>`;
            return `<div class="smc-card"><h4>${tf} <span class="${cls}">${r.trend}</span></h4>
                ${row('Event terakhir', ev)}
                ${row('Swing High / Low', `${fmt(r.swingHigh?.price)} / ${fmt(r.swingLow?.price)}`)}
                ${row('Zona', `${r.zone}${r.zonePct != null ? ' (' + Math.round(r.zonePct * 100) + '%)' : ''}`)}
                ${row('Bullish OB', `<span class="bull">${ob(r.bullOB)}</span>`)}
                ${row('Bearish OB', `<span class="bear">${ob(r.bearOB)}</span>`)}
                ${row('FVG aktif', fvg)}
                ${row('EMA20 / EMA50', `${fmt(r.ema20)} / ${fmt(r.ema50)}`)}
                ${row('RSI 14 / ATR 14', `${fmt(r.rsi, 1)} / ${fmt(r.atr)}`)}
                ${row('Skor TF', r.score)}
            </div>`;
        }

        draw(c, r) {
            const cv = this.$('chart');
            const ctx = cv.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const w = cv.clientWidth || 600, h = 220;
            cv.width = w * dpr; cv.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            const data = (c || []).slice(-60);
            if (!data.length) {
                ctx.fillStyle = '#8b98a9';
                ctx.font = '13px system-ui';
                ctx.fillText('Menunggu data harga...', 12, 24);
                return;
            }
            const offset = c.length - data.length;
            let hi = Math.max(...data.map(x => x.h));
            let lo = Math.min(...data.map(x => x.l));
            const pad = (hi - lo) * 0.1 || 1;
            hi += pad; lo -= pad;
            const y = p => h - ((p - lo) / (hi - lo)) * h;
            const cw = w / data.length;

            const zone = (z, color) => {
                if (!z || z.top < lo || z.bottom > hi) return;
                const x0 = Math.max(0, (z.i - offset) * cw);
                ctx.fillStyle = color;
                ctx.fillRect(x0, y(z.top), w - x0, Math.max(1, y(z.bottom) - y(z.top)));
            };

            if (r?.ready) {
                zone(r.bullOB, 'rgba(74,222,128,0.18)');
                zone(r.bearOB, 'rgba(248,113,113,0.18)');
                r.fvg.forEach(g => zone(g, 'rgba(96,165,250,0.15)'));

                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                if (r.swingHigh) { ctx.strokeStyle = '#f87171'; ctx.beginPath(); ctx.moveTo(0, y(r.swingHigh.price)); ctx.lineTo(w, y(r.swingHigh.price)); ctx.stroke(); }
                if (r.swingLow)  { ctx.strokeStyle = '#4ade80'; ctx.beginPath(); ctx.moveTo(0, y(r.swingLow.price));  ctx.lineTo(w, y(r.swingLow.price));  ctx.stroke(); }
                ctx.setLineDash([]);
            }

            data.forEach((k, i) => {
                const x = i * cw + cw / 2;
                const up = k.c >= k.o;
                ctx.strokeStyle = ctx.fillStyle = up ? '#4ade80' : '#f87171';
                ctx.beginPath(); ctx.moveTo(x, y(k.h)); ctx.lineTo(x, y(k.l)); ctx.stroke();
                const top = y(Math.max(k.o, k.c)), bot = y(Math.min(k.o, k.c));
                ctx.fillRect(x - cw * 0.35, top, cw * 0.7, Math.max(1, bot - top));
            });

            const last = data[data.length - 1].c;
            ctx.strokeStyle = '#facc15';
            ctx.beginPath(); ctx.moveTo(0, y(last)); ctx.lineTo(w, y(last)); ctx.stroke();
            ctx.fillStyle = '#facc15';
            ctx.font = '11px system-ui';
            ctx.fillText(fmt(last), w - 60, y(last) - 4);
        }

        // Data yang dikirim ke backend /api/analyze
        getAnalysis() {
            const s = this.state;
            if (!s) return null;
            const ob = o => o ? { top: round(o.top), bottom: round(o.bottom), mitigated: o.mitigated } : null;
            const timeframes = {};
            for (const tf of [s.ltf, s.htf]) {
                const r = s.tfs[tf];
                if (!r.ready) continue;
                timeframes[tf] = {
                    trend: r.trend,
                    lastEvent: r.lastEvent ? `${r.lastEvent.type} ${r.lastEvent.dir} @ ${fmt(r.lastEvent.level)}` : null,
                    swingHigh: round(r.swingHigh?.price),
                    swingLow: round(r.swingLow?.price),
                    zone: r.zone,
                    zonePct: round(r.zonePct, 2),
                    bullOB: ob(r.bullOB),
                    bearOB: ob(r.bearOB),
                    fvg: r.fvg.map(g => ({ dir: g.dir, top: round(g.top), bottom: round(g.bottom) })),
                    ema20: round(r.ema20),
                    ema50: round(r.ema50),
                    rsi: round(r.rsi, 1),
                    atr: round(r.atr),
                    score: r.score
                };
            }
            return {
                price: round(s.price),
                mode: s.mode,
                entryTF: s.ltf,
                recommendation: s.recommendation,
                score: s.score,
                dataQuality: s.dataQuality,
                timeframes
            };
        }
    }

    global.SMCWidget = SMCWidget;
})(window);
