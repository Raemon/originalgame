'use strict';
/* ISOGYRE — DOM screens (title, accessory plates, pause, results), settings and touch layout. */

const UI = {
  game: null,
  audio: null,
  screens: {},

  init(game, audio) {
    this.game = game;
    this.audio = audio;
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.screens = {
      title: $('screen-title'), upgrade: $('screen-upgrade'), paused: $('screen-pause'),
      over: $('screen-over'), victory: $('screen-victory'),
    };
    const click = (id, fn) => {
      const el = $(id);
      if (el) el.addEventListener('click', (e) => { e.preventDefault(); this.unlockAudio(); this.audio.play('ui'); fn(); });
    };
    click('btn-start', () => this.start());
    click('btn-resume', () => game.resume());
    click('btn-restart', () => this.start());
    click('btn-quit', () => game.quitToTitle());
    click('btn-again', () => this.start());
    click('btn-over-title', () => game.quitToTitle());
    click('btn-endless', () => game.continueEndless());
    click('btn-victory-title', () => game.quitToTitle());
    click('btn-pause', () => game.pause());

    // settings
    const vol = $('set-volume'), motion = $('set-motion'), hints = $('set-hints'), quality = $('set-quality');
    const saved = Store.get('settings', null);
    if (saved) Object.assign(game.settings, saved);
    else game.settings.motion = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    vol.value = Math.round(game.settings.volume * 100);
    motion.checked = !game.settings.motion;
    hints.checked = game.settings.hints;
    quality.value = game.settings.quality;
    audio.setVolume(game.settings.volume);
    const persist = () => Store.set('settings', game.settings);
    vol.addEventListener('input', () => { game.settings.volume = vol.value / 100; audio.setVolume(game.settings.volume); persist(); });
    motion.addEventListener('change', () => { game.settings.motion = !motion.checked; persist(); });
    hints.addEventListener('change', () => { game.settings.hints = hints.checked; persist(); });
    quality.addEventListener('change', () => { game.settings.quality = quality.value; persist(); game.emit('quality'); });

    const fs = $('set-fullscreen');
    const canFs = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    fs.hidden = !canFs;
    fs.addEventListener('click', () => {
      const d = document;
      const el = d.documentElement;
      const on = d.fullscreenElement || d.webkitFullscreenElement;
      try {
        const r = on ? (d.exitFullscreen || d.webkitExitFullscreen).call(d) : (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        if (r && r.catch) r.catch(() => {});
      } catch (err) { /* refused by the host frame */ }
    });
    const syncFs = () => { fs.textContent = (document.fullscreenElement || document.webkitFullscreenElement) ? 'Leave full screen' : 'Full screen'; };
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);

    window.addEventListener('keydown', (e) => {
      if (game.state === 'upgrade' && ['1', '2', '3'].includes(e.key)) {
        const o = game.offers[Number(e.key) - 1];
        if (o) { this.audio.play('ui'); game.chooseUpgrade(o.id); }
      }
      if (e.key === 'm' || e.key === 'M') { audio.setMuted(!audio.muted); }
      if (e.key === 'Enter' && game.state === 'title' && document.activeElement === document.body) this.start();
    });

    this.drawStrip();
    game.on('state', (s) => this.show(s));
    game.on('inputMode', () => this.refreshTouch());
    this.show(game.state);
    this.updateBest();
  },

  unlockAudio() {
    this.audio.init();
    this.audio.resume();
  },

  start() {
    this.unlockAudio();
    Input.clearQueues();
    this.game.startRun();
  },

  show(state) {
    const g = this.game;
    for (const k in this.screens) this.screens[k].hidden = k !== state;
    const settings = this.$('settings');
    if (state === 'title') { this.screens.title.querySelector('.settings-slot').appendChild(settings); this.updateBest(); }
    if (state === 'paused') this.screens.paused.querySelector('.settings-slot').appendChild(settings);
    if (state === 'upgrade') this.renderOffers();
    if (state === 'over') this.renderStats('over-stats');
    if (state === 'victory') this.renderStats('victory-stats');
    document.body.classList.toggle('in-play', state === 'playing' || state === 'cleared' || state === 'dying');
    this.refreshTouch();
    const focusMap = { title: 'btn-start', paused: 'btn-resume', over: 'btn-again', victory: 'btn-endless' };
    if (focusMap[state] && g.inputMode !== 'touch') {
      const el = this.$(focusMap[state]);
      if (el) setTimeout(() => el.focus({ preventScroll: true }), 30);
    }
    Input.clearQueues();
  },

  updateBest() {
    const b = this.game.best;
    const el = this.$('best-line');
    if (!el) return;
    el.textContent = b.score > 0 ? `Best: ${b.score.toLocaleString('en-US')} points, slide ${b.wave}` : '';
  },

  renderStats(id) {
    const g = this.game;
    const el = this.$(id);
    const t = Math.floor(g.stats.time);
    const rows = [
      ['Score', g.score.toLocaleString('en-US')],
      ['Slide reached', String(g.waveIndex + 1).padStart(2, '0') + ' · ' + (g.dir ? g.dir.def.rock : '')],
      ['Crystals shattered', String(g.stats.shattered)],
      ['Longest chain', String(g.stats.maxCombo)],
      ['Time under the lens', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
    ];
    el.innerHTML = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      el.append(dt, dd);
    }
  },

  renderOffers() {
    const g = this.game;
    const wrap = this.$('offers');
    wrap.innerHTML = '';
    g.offers.forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'offer';
      b.type = 'button';
      const lvl = g.up[u.id] || 0;
      b.innerHTML = `
        <span class="frost"><span class="cat">IS-${String(Upgrades.indexOf(u) + 1).padStart(2, '0')}</span><span class="tag">${u.tag}</span><span class="key">${i + 1}</span></span>
        <span class="specimen"><canvas width="96" height="96" aria-hidden="true"></canvas></span>
        <span class="body"><span class="name">${u.name}${lvl ? ` <em>${['', 'II', 'III', 'IV'][lvl]}</em>` : ''}</span><span class="desc">${u.desc}</span></span>`;
      b.addEventListener('click', () => { this.audio.play('ui'); g.chooseUpgrade(u.id); });
      wrap.appendChild(b);
      this.drawPlate(b.querySelector('canvas'), Upgrades.indexOf(u));
      if (i === 0 && g.inputMode !== 'touch') setTimeout(() => b.focus({ preventScroll: true }), 30);
    });
  },

  /** The Michel-Lévy chart as a strip: the palette of the whole game, with its real scale. */
  drawStrip() {
    const cv = this.$('ml-strip');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const barH = Math.round(H * 0.5);
    const maxNm = 1800;
    const img = ctx.createImageData(W, barH);
    for (let x = 0; x < W; x++) {
      const c = Optics.linear((x / (W - 1)) * maxNm);
      for (let y = 0; y < barH; y++) {
        const i = (y * W + x) * 4;
        img.data[i] = Math.round(255 * Math.pow(clamp(c[0] * 1.1, 0, 1), 1 / 2.2));
        img.data[i + 1] = Math.round(255 * Math.pow(clamp(c[1] * 1.1, 0, 1), 1 / 2.2));
        img.data[i + 2] = Math.round(255 * Math.pow(clamp(c[2] * 1.1, 0, 1), 1 / 2.2));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(234, 228, 214, 0.6)';
    ctx.strokeStyle = 'rgba(234, 228, 214, 0.45)';
    ctx.lineWidth = 2;
    ctx.font = `500 ${Math.round(H * 0.26)}px ${FONTS.mono}`;
    ctx.textBaseline = 'top';
    const labels = ['0', '550', '1100', '1650 nm'];
    labels.forEach((lab, i) => {
      const nm = i * 550;
      const x = Math.min(W - 2, Math.max(1, (nm / maxNm) * W));
      ctx.beginPath(); ctx.moveTo(x, barH); ctx.lineTo(x, barH + H * 0.14); ctx.stroke();
      ctx.textAlign = i === 0 ? 'left' : 'center';
      ctx.fillText(lab, x, barH + H * 0.18);
    });
  },

  /** A small conoscopic interference figure, different for each plate. */
  drawPlate(cv, seed) {
    const ctx = cv.getContext('2d');
    const N = 96;
    const img = ctx.createImageData(N, N);
    const rnd = mulberry32(seed * 977 + 13);
    const sep = rnd() < 0.5 ? 0 : 0.18 + rnd() * 0.25;
    const scale = 900 + rnd() * 1800;
    const rot = rnd() * Math.PI;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = (x - N / 2) / (N / 2), v = (y - N / 2) / (N / 2);
        const r = Math.hypot(u, v);
        const i = (y * N + x) * 4;
        if (r > 1) { img.data[i + 3] = 0; continue; }
        const qx = u * Math.cos(rot) + v * Math.sin(rot), qy = -u * Math.sin(rot) + v * Math.cos(rot);
        const d1 = Math.hypot(qx + sep, qy), d2 = Math.hypot(qx - sep, qy);
        const ret = scale * d1 * d2;
        const psi = Math.atan2(qy, qx + sep) + Math.atan2(qy, qx - sep);
        const brush = Math.pow(Math.sin(psi), 2) * 0.95 + 0.05;
        const c = Optics.linear(ret);
        const toS = (c0) => Math.round(255 * Math.pow(clamp(c0 * brush * 1.25, 0, 1), 1 / 2.2));
        img.data[i] = toS(c[0]);
        img.data[i + 1] = toS(c[1]);
        img.data[i + 2] = toS(c[2]);
        img.data[i + 3] = Math.round(255 * clamp((1 - r) * 40, 0, 1));
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  /* ---------------- touch controls ---------------- */
  refreshTouch() {
    const g = this.game;
    document.body.classList.toggle('touch-mode', g.inputMode === 'touch');
    const el = this.$('touch');
    const playing = g.state === 'playing' || g.state === 'cleared';
    el.hidden = !(g.inputMode === 'touch' && playing);
    const f = this.$('btn-focus');
    if (f) f.hidden = !(g.stat && g.stat.bertrand);
  },

  layoutTouch(L) {
    const dial = this.$('dial');
    const btns = this.$('touch-buttons');
    const portrait = L.H > L.W * 1.05;
    const dr = portrait ? Math.min(64, (L.H - (L.cy + L.R + 60)) * 0.45) : Math.min(62, (L.W / 2 - L.R - 40) * 0.6);
    const size = Math.max(84, dr * 2);
    let dx, dy;
    if (portrait) { dx = L.W - size / 2 - 22; dy = L.H - size / 2 - 26; }
    else { dx = L.W - size / 2 - 18; dy = L.H - size / 2 - 22; }
    dial.style.width = dial.style.height = `${size}px`;
    dial.style.left = `${dx - size / 2}px`;
    dial.style.top = `${dy - size / 2}px`;
    btns.style.right = portrait ? `${size + 36}px` : '18px';
    btns.style.bottom = portrait ? '28px' : `${size + 34}px`;
    this.drawDial(size);
  },

  drawDial(size) {
    const cv = this.$('dial-canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr; cv.height = size * dpr;
    cv.style.width = cv.style.height = `${size}px`;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(12, 12, 16, 0.6)';
    ctx.beginPath(); ctx.arc(c, c, c - 1, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(234, 228, 214, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let d = 0; d < 360; d += 10) {
      const a = (d * Math.PI) / 180;
      const len = d % 30 === 0 ? 9 : 5;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * (c - 4), c + Math.sin(a) * (c - 4));
      ctx.lineTo(c + Math.cos(a) * (c - 4 - len), c + Math.sin(a) * (c - 4 - len));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(234, 228, 214, 0.75)';
    ctx.font = `600 10px ${FONTS.ui}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STAGE', c, c - 6);
    ctx.font = `500 9px ${FONTS.mono}`;
    ctx.fillStyle = 'rgba(234, 228, 214, 0.45)';
    ctx.fillText('↻ sweep', c, c + 8);
  },
};
