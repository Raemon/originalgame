'use strict';
/*
 * ISOGYRE — game state and the main simulation step.
 * Entity behaviour lives in entities.js / boss.js (they extend Game.prototype).
 */
const CFG = {
  ARENA_R: 520,
  PLAYER_R: 13,
  PLAYER_FIG: 34,
  PLAYER_SPEED: 330,
  PLAYER_ACCEL: 2600,
  HP: 100,
  INV: 0.75,
  ANCHOR_FIG: 22,
  ANCHOR_IMPACT: 44,
  THROW_SPEED: 1500,
  RETURN_SPEED: 1350,
  LAMBDA: 66,
  R0: 135,
  T: 1.15,
  DMG_K: 2.6,
  LAMBDA_H: 90,
  R0H: 210,
  TH: 1.3,
  HAZ_DPS: 15,
  SHIELD_R: 66,
  SHIELD_DRAIN: 30,
  SHIELD_REGEN: 15,
  SHIELD_DELAY: 0.8,
  FOCUS_DRAIN: 22,
  SWEEP_KEYS: 5.2,
  SWEEP_WHEEL: 0.0045,
  ECHO_LIFE: 2.6,
  MAX_ECHO: 8,
  COMBO_T: 2.4,
  HAZ_COLOR: [1.0, 0.07, 0.045],
};

class Game {
  constructor(renderer, audio) {
    this.r = renderer;
    this.audio = audio;
    this.polys = new PolyBatch(8192);
    this.figs = new FigureBatch(64);
    this.sparkBatch = new SparkBatch(4096);
    const S = Shaders;
    this.arr = {
      src: new Float32Array(S.MAX_SRC * 4), haz: new Float32Array(S.MAX_HAZ * 4),
      damp: new Float32Array(S.MAX_DAMP * 4), ring: new Float32Array(S.MAX_RING * 4),
      shock: new Float32Array(S.MAX_SHOCK * 4),
    };
    this.srcPool = [];
    this.hazPool = [];
    this.settings = {
      volume: 0.7, motion: true, quality: 'auto', hints: true,
    };
    this.layout = { W: 800, H: 600, cx: 400, cy: 300, R: 260 };
    this.listeners = {};
    this.state = 'title';
    this.time = 0;
    this.realTime = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.shake = 0;
    this.fade = 1;
    this.inputMode = 'kb';
    this.best = Store.get('best', { score: 0, wave: 0 });
    this.newRun(true);
  }

  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
  emit(evt, data) { for (const fn of this.listeners[evt] || []) fn(data); }

  /* ------------------------------------------------------------------ run lifecycle */
  newRun(attract = false) {
    this.attract = attract;
    this.time = 0;
    this.waveIndex = 0;
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.player = {
      x: 0, y: 0, vx: 0, vy: 0, hp: CFG.HP, maxHp: CFG.HP, inv: 0, energy: 100, idle: 0,
      shieldOn: false, shieldVis: 0, focusOn: false, hurt: 0, sinceHit: 99, moved: 0, alive: true, burnT: 0,
    };
    this.anchors = [];
    this.enemies = [];
    this.shards = [];
    this.sparks = [];
    this.rings = [];
    this.echoes = [];
    this.quanta = [];
    this.popups = [];
    this.glints = [];
    this.shocks = [];
    this.boss = null;
    this.sweep = { s: 0, target: 0, vel: 0, total: 0 };
    this.up = {};
    this.recallCd = 0;
    this.stats = { shattered: 0, maxCombo: 0, time: 0, damage: 0 };
    this.dir = null;
    this.banner = null;
    this.tip = null;
    this.tipQueue = [];
    this.tipsDone = new Set();
    this.aim = { x: 120, y: -40 };
    this.fieldHeat = 0;
    this.grain = { seed: 11, cell: 70, ret: [90, 950], twin: 0.3 };
    this.recomputeStats();
    if (attract) this.setupAttract();
  }

  startRun() {
    this.newRun(false);
    this.state = 'playing';
    this.beginWave(0);
    this.emit('state', this.state);
  }

  recomputeStats() {
    const u = (id) => this.up[id] || 0;
    const def = this.dir ? this.dir.def : null;
    const baseAnchors = this.attract ? 2 : (def ? def.anchors : 1);
    this.stat = {
      anchorsMax: baseAnchors + u('anchor'),
      amp: 1 + 0.18 * u('lamp'),
      dmgK: CFG.DMG_K,
      beat: 1.5 * u('beat'),
      echo: u('echo'),
      cleave: u('cleave'),
      tint: u('tint'),
      qwp: u('qwp'),
      anneal: u('anneal'),
      stroke: u('stroke'),
      stage: u('stage'),
      bertrand: u('bertrand'),
    };
    Field.k = TAU / CFG.LAMBDA;
    Field.R0 = CFG.R0 * (1 + 0.35 * u('aperture'));
    Field.over = 0.42 * u('overtone');
    Field.T = CFG.T;
    Field.kH = TAU / CFG.LAMBDA_H;
    Field.R0H = CFG.R0H;
    Field.TH = CFG.TH;
    this.shieldR = CFG.SHIELD_R * (1 + 0.3 * this.stat.qwp);
  }

  beginWave(index) {
    this.waveIndex = index;
    const def = waveDef(index);
    this.dir = { def, gi: 0, wait: def.groups.length ? def.groups[0].delay : 0, t: 0 };
    this.recomputeStats();
    this.grain = {
      seed: 11 + index * 17.3,
      cell: def.grain.cell,
      ret: def.grain.ret,
      twin: def.grain.twin,
    };
    const name = def.rock.toUpperCase();
    this.banner = { title: `SLIDE ${String(index + 1).padStart(2, '0')}`, sub: name, t: 0, dur: 3.2 };
    if (!this.attract) {
      for (const t of def.tips || []) this.queueTip(t);
    }
    if (def.boss) this.spawnBoss();
    this.sfx('waveStart');
    this.emit('wave', index);
  }

  waveCleared() {
    if (this.state !== 'playing') return;
    const bonus = 100 * (this.waveIndex + 1);
    this.addScore(bonus, 0, -CFG.ARENA_R * 0.25, 'SLIDE CLEAR +' + bonus);
    this.state = 'cleared';
    this.clearT = 2.6;
    this.banner = { title: `SLIDE ${String(this.waveIndex + 1).padStart(2, '0')}`, sub: 'CLEARED', t: 0, dur: 2.4 };
    this.sfx('waveClear');
    this.saveBest();
    this.emit('state', this.state);
  }

  afterClear() {
    const wasBoss = this.dir && this.dir.def.boss;
    if (wasBoss && !this.endless) {
      this.state = 'victory';
      this.emit('state', this.state);
      return;
    }
    if (upgradeAfter(this.waveIndex)) this.openUpgrade();
    else this.nextWave();
  }

  nextWave() {
    this.state = 'playing';
    this.beginWave(this.waveIndex + 1);
    this.emit('state', this.state);
  }

  continueEndless() {
    this.endless = true;
    this.openUpgrade();
  }

  openUpgrade() {
    const force = this.waveIndex === 1 ? 'lamp' : null;
    this.offers = rollUpgrades(this.up, this.waveIndex, 3, force);
    if (!this.offers.length) { this.nextWave(); return; }
    this.state = 'upgrade';
    this.emit('state', this.state);
  }

  chooseUpgrade(id) {
    if (this.state !== 'upgrade') return;
    this.up[id] = (this.up[id] || 0) + 1;
    this.recomputeStats();
    this.sfx('upgrade');
    this.nextWave();
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'cleared') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.emit('state', this.state);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState || 'playing';
    this.emit('state', this.state);
  }

  quitToTitle() {
    this.newRun(true);
    this.state = 'title';
    this.emit('state', this.state);
  }

  gameOver() {
    this.state = 'dying';
    this.dyingT = 1.8;
    this.slowT = 1.2;
    const p = this.player;
    p.alive = false;
    this.burst(p.x, p.y, 70, 900, 1.6);
    this.addShock(p.x, p.y, 420, 26, 1.1);
    this.shake = 1;
    this.sfx('death');
    this.saveBest();
    this.emit('state', this.state);
  }

  saveBest() {
    if (this.attract) return;
    const b = this.best;
    if (this.score > b.score || this.waveIndex + 1 > b.wave) {
      this.best = { score: Math.max(b.score, this.score), wave: Math.max(b.wave, this.waveIndex + 1) };
      Store.set('best', this.best);
    }
  }

  /** How much tougher this slide's crystals are than the first slide's. */
  tScale() {
    return (this.dir && this.dir.def.tScale) || 1;
  }

  /* ------------------------------------------------------------------ tutorial */
  queueTip(id) {
    if (!this.settings.hints && id !== 'boss') return;
    if (this.tipsDone.has(id)) return;
    this.tipQueue.push(id);
  }

  completeTip(id) {
    this.tipsDone.add(id);
    if (this.tip && this.tip.id === id) this.tip.closing = true;
    const i = this.tipQueue.indexOf(id);
    if (i >= 0) this.tipQueue.splice(i, 1);
  }

  isTipDone(id) {
    return this.tipsDone.has(id) || !this.settings.hints;
  }

  tipText(id) {
    const t = TIPS[id];
    if (!t) return '';
    return t.all || t[this.inputMode] || t.kb;
  }

  /** Tips about an action are skipped if the player has already done it. */
  tipSatisfied(id) {
    switch (id) {
      case 'move': return this.player.moved > 140;
      case 'throw': return this.anchors.some((a) => a.state === 'set');
      case 'sweep': return Math.abs(this.sweep.total) > TAU * 1.2;
      case 'recall': return !!this.usedRecall;
      default: return false;
    }
  }

  updateTips(dt) {
    for (let i = this.tipQueue.length - 1; i >= 0; i--) {
      const id = this.tipQueue[i];
      if (this.tipSatisfied(id)) { this.tipQueue.splice(i, 1); this.tipsDone.add(id); }
    }
    if (!this.tip && this.tipQueue.length && !(this.banner && this.banner.t < 1.6)) {
      const id = this.tipQueue.shift();
      this.tip = { id, text: this.tipText(id), t: 0, closing: false, a: 0 };
    }
    const tip = this.tip;
    if (!tip) return;
    tip.t += dt;
    tip.text = this.tipText(tip.id);
    const p = this.player;
    // completion conditions
    switch (tip.id) {
      case 'move': if (p.moved > 140) this.completeTip('move'); break;
      case 'throw': if (this.anchors.some((a) => a.state === 'set')) this.completeTip('throw'); break;
      case 'fringe': if (tip.t > 6.5 || (this.stats.shattered > 0 && tip.t > 3)) this.completeTip('fringe'); break;
      case 'sweep': if (Math.abs(this.sweep.total) > TAU * 1.2 && tip.t > 2) this.completeTip('sweep'); break;
      case 'recall': if (this.usedRecall && tip.t > 1.5) this.completeTip('recall'); if (tip.t > 11) this.completeTip('recall'); break;
      case 'null': if ((this.usedNull && tip.t > 2) || tip.t > 11) this.completeTip('null'); break;
      default: if (tip.t > Math.max(5.5, tip.text.length * 0.065)) this.completeTip(tip.id);
    }
    tip.a = approach(tip.a, tip.closing ? 0 : 1, 6, dt);
    if (tip.closing && tip.a < 0.02) {
      this.tipsDone.add(tip.id);
      this.tip = null;
    }
  }

  /* ------------------------------------------------------------------ main step */
  step(dt, intent) {
    this.realTime += dt;
    if (this.slowT > 0) { this.slowT -= dt; this.timeScale = approach(this.timeScale, 0.25, 12, dt); }
    else this.timeScale = approach(this.timeScale, 1, 6, dt);
    const sdt = dt * this.timeScale;

    switch (this.state) {
      case 'title':
        this.time += sdt;
        this.updateAttract(sdt);
        break;
      case 'playing':
        this.time += sdt;
        this.stats.time += sdt;
        this.updatePlay(sdt, intent);
        this.updateDirector(sdt);
        break;
      case 'cleared':
        this.time += sdt;
        this.updatePlay(sdt, intent);
        this.clearT -= dt;
        if (this.clearT <= 0) this.afterClear();
        break;
      case 'dying':
        this.time += sdt;
        this.updatePlay(sdt, null);
        this.dyingT -= dt;
        if (this.dyingT <= 0) { this.state = 'over'; this.emit('state', this.state); }
        break;
      case 'over':
      case 'victory':
      case 'upgrade':
        // keep the slide alive behind the menu
        this.time += sdt * 0.5;
        this.updateEffects(sdt * 0.5);
        this.computeSources(sdt * 0.5, null);
        break;
      default:
        break;
    }
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  updatePlay(dt, it) {
    const p = this.player;
    it = it || NULL_INTENT;
    if (p.alive) {
      this.updatePlayer(dt, it);
      this.updateSweep(dt, it);
      if (it.throwAt) this.throwAnchor(it.throwAt.x, it.throwAt.y);
      if (it.recall) this.recallAnchors();
      if (it.aim) { this.aim.x = it.aim.x; this.aim.y = it.aim.y; }
    }
    this.recallCd -= dt;
    this.updateAnchors(dt);
    this.computeSources(dt, it);
    this.updateEnemies(dt);
    if (this.boss) this.updateBoss(dt);
    this.updateRings(dt);
    if (p.alive) this.updateHazardDamage(dt);
    this.updateEffects(dt);
    this.updateTips(dt);
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    if (p.alive && p.hp <= 0 && !this.attract) this.gameOver();
  }

  updatePlayer(dt, it) {
    const p = this.player;
    let mx = it.mx, my = it.my;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const tx = mx * CFG.PLAYER_SPEED, ty = my * CFG.PLAYER_SPEED;
    let dvx = tx - p.vx, dvy = ty - p.vy;
    const dl = Math.hypot(dvx, dvy), acc = CFG.PLAYER_ACCEL * dt;
    if (dl > acc) { dvx *= acc / dl; dvy *= acc / dl; }
    p.vx += dvx; p.vy += dvy;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const lim = CFG.ARENA_R - CFG.PLAYER_R - 6;
    const rr = Math.hypot(p.x, p.y);
    if (rr > lim) {
      const nx = p.x / rr, ny = p.y / rr;
      p.x = nx * lim; p.y = ny * lim;
      const vn = p.vx * nx + p.vy * ny;
      if (vn > 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
    }
    p.moved += Math.hypot(p.vx, p.vy) * dt;
    p.inv -= dt;
    p.hurt = Math.max(0, p.hurt - dt * 2.5);
    p.sinceHit += dt;

    // null (destructive interference) and focus share one energy pool
    const st = this.stat;
    const wantNull = it.shield && p.energy > (p.shieldOn ? 0.5 : 8);
    const wantFocus = st.bertrand > 0 && it.focus && !wantNull && p.energy > (p.focusOn ? 0.5 : 8);
    if (wantNull && !p.shieldOn) this.sfx('nullOn');
    if (!wantNull && p.shieldOn) this.sfx('nullOff');
    p.shieldOn = wantNull;
    p.focusOn = wantFocus;
    if (wantNull || wantFocus) {
      const drain = wantNull ? CFG.SHIELD_DRAIN * Math.pow(0.65, st.qwp) : CFG.FOCUS_DRAIN;
      p.energy = Math.max(0, p.energy - drain * dt);
      p.idle = 0;
    } else {
      p.idle += dt;
      if (p.idle > CFG.SHIELD_DELAY) p.energy = Math.min(100, p.energy + CFG.SHIELD_REGEN * (1 + 0.3 * st.qwp) * dt);
    }
    p.shieldVis = approach(p.shieldVis, wantNull ? 1 : 0, 16, dt);
    if (st.anneal && p.sinceHit > 3 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 1.6 * st.anneal * dt);
  }

  updateSweep(dt, it) {
    const sw = this.sweep;
    sw.target += it.sweep + this.stat.beat * dt;
    const prev = sw.s;
    sw.s = approach(sw.s, sw.target, CFG.SWEEP_SMOOTH || 16, dt);
    const d = sw.s - prev;
    sw.vel = approach(sw.vel, d / Math.max(dt, 1e-4), 10, dt);
    sw.total += d;
  }

  /* ------------------------------------------------------------------ anchors */
  throwAnchor(tx, ty) {
    const p = this.player;
    const lim = CFG.ARENA_R - 26;
    const rr = Math.hypot(tx, ty);
    if (rr > lim) { tx *= lim / rr; ty *= lim / rr; }
    let a;
    if (this.anchors.length < this.stat.anchorsMax) {
      a = { x: p.x, y: p.y, amp: 0.4, rot: Rng.range(0, TAU), hit: new Set(), ox: 0, oy: 0, pulse: 0 };
    } else {
      a = this.anchors.shift();
    }
    a.fromX = a.x; a.fromY = a.y;
    a.tx = tx; a.ty = ty; a.t = 0;
    a.dur = clamp(Math.hypot(tx - a.x, ty - a.y) / CFG.THROW_SPEED, 0.1, 0.42);
    a.state = 'fly';
    a.hit.clear();
    this.anchors.push(a);
    this.sfx('throw');
  }

  recallAnchors() {
    if (this.recallCd > 0 || !this.anchors.length) return;
    let any = false;
    for (const a of this.anchors) {
      if (a.state !== 'return') { a.state = 'return'; a.hit.clear(); any = true; }
    }
    if (any) { this.recallCd = 0.35; this.usedRecall = true; this.sfx('recall'); }
  }

  updateAnchors(dt) {
    const p = this.player;
    const st = this.stat;
    for (let i = this.anchors.length - 1; i >= 0; i--) {
      const a = this.anchors[i];
      a.rot += dt * 0.5;
      a.pulse = Math.max(0, a.pulse - dt * 3);
      if (a.state === 'fly') {
        a.t += dt;
        const u = clamp(a.t / a.dur, 0, 1);
        const e = easeOutCubic(u);
        a.x = lerp(a.fromX, a.tx, e);
        a.y = lerp(a.fromY, a.ty, e);
        a.amp = approach(a.amp, 1, 10, dt);
        if (u >= 1) {
          a.state = 'set';
          a.ox = a.x - p.x; a.oy = a.y - p.y;
          this.anchorImpact(a);
        }
      } else if (a.state === 'set') {
        a.amp = approach(a.amp, 1, 6, dt);
        if (st.stage && p.alive) {
          let tx = p.x + a.ox, ty = p.y + a.oy;
          const lim = CFG.ARENA_R - 26, rr = Math.hypot(tx, ty);
          if (rr > lim) { tx *= lim / rr; ty *= lim / rr; }
          a.x = approach(a.x, tx, 9, dt);
          a.y = approach(a.y, ty, 9, dt);
        }
      } else if (a.state === 'return') {
        const speed = CFG.RETURN_SPEED * (1 + 0.5 * st.stroke);
        const dx = p.x - a.x, dy = p.y - a.y;
        const d = Math.hypot(dx, dy);
        const step = speed * dt;
        const px = a.x, py = a.y;
        if (d <= step + 8) {
          this.anchors.splice(i, 1);
          this.sfx('dock');
          continue;
        }
        a.x += (dx / d) * step;
        a.y += (dy / d) * step;
        this.anchorSweepHits(a, px, py);
      }
    }
  }

  /* ------------------------------------------------------------------ the field */
  computeSources(dt, it) {
    const p = this.player;
    const st = this.stat;
    const s = this.sweep.s;
    const src = Field.src;
    src.length = 0;
    let n = 0;
    const take = () => {
      let o = this.srcPool[n];
      if (!o) { o = { x: 0, y: 0, a: 0, p: 0 }; this.srcPool[n] = o; }
      n++;
      src.push(o);
      return o;
    };
    if (p.alive || this.attract) {
      const o = take();
      o.x = p.x; o.y = p.y; o.a = st.amp; o.p = 0;
    }
    for (let j = 0; j < this.anchors.length; j++) {
      const a = this.anchors[j];
      const o = take();
      o.x = a.x; o.y = a.y; o.a = st.amp * a.amp * (a.state === 'return' ? 0.55 : 1); o.p = (j + 1) * s;
    }
    for (const e of this.echoes) {
      if (n >= Shaders.MAX_SRC) break;
      const o = take();
      const f = clamp(e.life / 0.6, 0, 1) * clamp((e.max - e.life) / 0.15, 0, 1);
      o.x = e.x; o.y = e.y; o.a = st.amp * 0.85 * f; o.p = e.p + s * 0.5;
    }
    // Bertrand lens: phase every source onto the aim point
    if (p.focusOn) {
      for (const o of src) o.p = Field.focusPhase(o.x, o.y, this.aim.x, this.aim.y, Field.k);
    }

    // hazard channel
    const haz = Field.haz;
    haz.length = 0;
    let m = 0;
    const takeH = () => {
      let o = this.hazPool[m];
      if (!o) { o = { x: 0, y: 0, a: 0, p: 0 }; this.hazPool[m] = o; }
      m++;
      haz.push(o);
      return o;
    };
    for (const e of this.enemies) {
      if (!e.def.bell || m >= Shaders.MAX_HAZ) continue;
      const o = takeH();
      o.x = e.x; o.y = e.y;
      o.a = e.bellAmp * clamp(e.age / 1.2, 0, 1);
      o.p = e.phase;
    }

    // fluorite quiet zones
    const damp = Field.damp;
    damp.length = 0;
    for (const e of this.enemies) {
      if (!e.def.dampR || damp.length >= Shaders.MAX_DAMP) continue;
      damp.push({ x: e.x, y: e.y, r: e.def.dampR * clamp(e.age / 0.8, 0.05, 1), s: e.def.dampS });
    }
  }

  updateHazardDamage(dt) {
    const p = this.player;
    if (this.attract) return;
    if (!Field.haz.length) return;
    let H = Field.hazard(p.x, p.y);
    if (p.shieldOn) {
      if (H > Field.TH * 0.6) this.usedNull = true;
      H = 0;
    }
    const x = H / Field.TH;
    if (x > 1) {
      const dps = CFG.HAZ_DPS * clamp(x - 1, 0, 2.2);
      p.hp -= dps * dt;
      this.stats.damage += dps * dt;
      p.hurt = Math.max(p.hurt, 0.45);
      p.sinceHit = 0;
      p.burnT -= dt;
      if (p.burnT <= 0) { p.burnT = 0.12; this.sfx('burn'); }
    }
  }

  hurtPlayer(amount, sx, sy) {
    const p = this.player;
    if (this.attract || p.inv > 0 || !p.alive) return false;
    p.hp -= amount;
    this.stats.damage += amount;
    p.inv = CFG.INV;
    p.hurt = 1;
    p.sinceHit = 0;
    this.shake = Math.min(1, this.shake + 0.45);
    if (sx != null) {
      const dx = p.x - sx, dy = p.y - sy, d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * 260; p.vy += (dy / d) * 260;
    }
    this.burst(p.x, p.y, 14, 380, 0.6, [1.0, 0.25, 0.2]);
    this.combo = 0;
    this.sfx('hurt');
    return true;
  }

  addScore(base, x, y, label) {
    const mult = 1 + Math.min(this.combo, 40) * 0.1;
    const v = Math.round(base * mult);
    this.score += v;
    if (x != null) this.popups.push({ x, y, text: label || ('+' + v), t: 0, life: label ? 2.2 : 1.0, big: !!label });
    return v;
  }

  /* ------------------------------------------------------------------ attract mode */
  setupAttract() {
    this.dir = null;
    this.player.x = 0; this.player.y = 0;
    this.anchors = [];
    for (let i = 0; i < 2; i++) {
      this.anchors.push({ x: 0, y: 0, amp: 1, rot: i, hit: new Set(), state: 'set', ox: 0, oy: 0, pulse: 0 });
    }
    this.demoSpawn = 1.5;
    this.grain = { seed: 7.7, cell: 76, ret: [120, 1100], twin: 0.35 };
  }

  updateAttract(dt) {
    const t = this.time;
    const p = this.player;
    p.x = Math.sin(t * 0.21) * 120;
    p.y = Math.sin(t * 0.17 + 1) * 90;
    p.vx = p.vy = 0;
    p.hp = p.maxHp;
    const R = 150 + 40 * Math.sin(t * 0.13);
    this.anchors.forEach((a, i) => {
      const ang = t * 0.11 + i * 2.2;
      a.x = p.x + Math.cos(ang) * R * (i ? 0.75 : 1);
      a.y = p.y + Math.sin(ang) * R * (i ? 0.75 : 1);
      a.state = 'set';
      a.rot += dt * 0.5;
    });
    this.updateSweep(dt, { sweep: dt * 1.4 });
    this.computeSources(dt, null);
    this.demoSpawn -= dt;
    if (this.demoSpawn <= 0 && this.enemies.length < 14) {
      this.demoSpawn = Rng.range(0.6, 1.6);
      const type = Rng.pick(['quartz', 'quartz', 'calcite', 'mica', 'aragonite', 'zircon']);
      const ang = Rng.range(0, TAU);
      this.spawnEnemy(type, Math.cos(ang) * CFG.ARENA_R * 0.92, Math.sin(ang) * CFG.ARENA_R * 0.92, { demo: true });
    }
    this.updateEnemies(dt);
    this.updateRings(dt);
    this.updateEffects(dt);
  }
}

const NULL_INTENT = { mx: 0, my: 0, sweep: 0, throwAt: null, recall: false, shield: false, focus: false, aim: null };
