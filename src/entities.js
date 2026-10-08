'use strict';
/* ISOGYRE — crystals, shards, ripples, pickups and the spawn director. */

Object.assign(Game.prototype, {
  /* ------------------------------------------------------------------ spawning */
  spawnEnemy(type, x, y, opts = {}) {
    const def = Bestiary[type];
    const rnd = () => Rng.next();
    const hpScale = (this.dir && this.dir.def.hpScale) || 1;
    const spScale = (this.dir && this.dir.def.speedScale) || 1;
    const poly = shapeFor(def, rnd);
    const ga = Rng.range(0, TAU);
    const e = {
      type, def, x, y, vx: 0, vy: 0, tx: 0, ty: 0, kx: 0, ky: 0,
      ang: Rng.range(0, TAU), spin: Rng.range(0.25, 0.9) * Rng.sign(),
      hp: def.hp * hpScale * (opts.hpMul || 1), maxHp: def.hp * hpScale * (opts.hpMul || 1),
      r: def.r, poly, iso: !!def.iso,
      ret: Rng.range(def.ret[0], def.ret[1]),
      gx: Math.cos(ga) * def.grad, gy: Math.sin(ga) * def.grad,
      optic: Rng.range(0, Math.PI),
      I: 0, hot: 0, flash: 0, age: 0, spawnT: 0.45, seed: Rng.next(),
      speedMul: spScale * (opts.speedMul || 1), spinDir: Rng.sign(),
      timer: def.period ? Rng.range(1.5, def.period) : 0, charging: false,
      phase: 0, beat: opts.beat || 0, bellAmp: 1, station: null, stationR: 0,
      demo: !!opts.demo, owner: opts.owner || null, invuln: false, dead: false,
    };
    if (opts.vx) { e.kx = opts.vx; e.ky = opts.vy; e.spawnT = 0.15; }
    this.enemies.push(e);
    return e;
  },

  pickSpawnAngle() {
    const p = this.player;
    const pr = Math.hypot(p.x, p.y);
    const pa = Math.atan2(p.y, p.x);
    for (let i = 0; i < 12; i++) {
      const a = Rng.range(0, TAU);
      if (pr < 150 || Math.abs(wrapAngle(a - pa)) > 1.1) return a;
    }
    return pa + Math.PI;
  },

  spawnGroup(g) {
    const base = this.pickSpawnAngle();
    const R = CFG.ARENA_R;
    const n = g.n;
    for (let i = 0; i < n; i++) {
      let ang = base, rad = R * 0.93;
      switch (g.formation) {
        case 'arc': ang = base + (i - (n - 1) / 2) * 0.24; break;
        case 'ring': ang = base + (i / n) * TAU; break;
        case 'pair': ang = base + (i % 2) * Math.PI * Rng.range(0.7, 1.0); break;
        case 'cluster': ang = base + Rng.range(-0.18, 0.18); rad = R * Rng.range(0.84, 0.95); break;
        case 'random': ang = i === 0 ? base : this.pickSpawnAngle(); break;
        default: ang = base + Rng.range(-0.5, 0.5);
      }
      const t = 0.85 + i * (g.interval || 0.5);
      const opts = {};
      if (g.type === 'zircon') opts.beat = (i % 2) ? Rng.sign() * Rng.range(0.7, 1.0) : 0;
      this.glints.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, t, total: t, type: g.type, opts });
    }
  },

  updateDirector(dt) {
    const D = this.dir;
    if (!D || this.state !== 'playing') return;
    D.t += dt;
    if (D.def.boss) {
      if (!this.boss && this.enemies.length === 0 && this.glints.length === 0) this.waveCleared();
      return;
    }
    if (D.gi < D.def.groups.length) {
      const g = D.def.groups[D.gi];
      const blocked = (g.gate && this.enemies.length + this.glints.length > 0) || (g.require && !this.isTipDone(g.require));
      if (!blocked) {
        D.wait -= dt;
        if (D.wait <= 0) {
          this.spawnGroup(g);
          D.gi++;
          if (D.gi < D.def.groups.length) D.wait = D.def.groups[D.gi].delay;
        }
      }
    } else if (this.enemies.length === 0 && this.glints.length === 0) {
      this.waveCleared();
    }
  },

  /* ------------------------------------------------------------------ crystals */
  updateEnemies(dt) {
    const p = this.player;
    const st = this.stat;
    const list = this.enemies;
    const T0 = Field.T;
    const waveT = (this.dir && this.dir.def.tScale) || 1;
    let heat = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      e.age += dt;
      e.spawnT -= dt;
      e.flash = Math.max(0, e.flash - dt * 5);
      e.hot = Math.max(0, e.hot - dt * 4);

      // resonance: time-averaged intensity above the crystal's threshold shatters it
      if (!e.iso) {
        e.I = Field.intensity(e.x, e.y);
        const T = T0 * e.def.tmul * waveT;
        if (e.I > T && e.spawnT <= 0 && !e.invuln) {
          // damage grows with amplitude above threshold, so N sources scale like N, not N²
          const dmg = st.dmgK * (Math.sqrt(e.I) - Math.sqrt(T)) * dt;
          e.hp -= dmg;
          e.hot = 1;
          heat += dmg;
        }
      }

      e.def.ai(e, this, dt);
      let slow = 1;
      if (st.tint && e.hot > 0.3) slow = Math.pow(0.6, st.tint);

      // separation from neighbours
      let sx = 0, sy = 0;
      for (let j = 0; j < list.length; j++) {
        if (j === i) continue;
        const o = list[j];
        const dx = e.x - o.x, dy = e.y - o.y;
        const rr = e.r + o.r + 6;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const f = (rr - d) / rr;
          sx += (dx / d) * f * 160;
          sy += (dy / d) * f * 160;
        }
      }
      const resp = e.owner ? 0 : 3.4;
      if (!e.owner) {
        e.vx = approach(e.vx, e.tx * slow + sx, resp, dt);
        e.vy = approach(e.vy, e.ty * slow + sy, resp, dt);
        e.x += (e.vx + e.kx) * dt;
        e.y += (e.vy + e.ky) * dt;
      }
      e.kx *= Math.exp(-4.5 * dt);
      e.ky *= Math.exp(-4.5 * dt);
      const lim = CFG.ARENA_R - e.r * 0.6;
      const rr = Math.hypot(e.x, e.y);
      if (rr > lim) { e.x *= lim / rr; e.y *= lim / rr; }

      if (e.def.alignSpin) {
        const va = Math.atan2(e.vy, e.vx);
        e.ang += wrapAngle(va - e.ang) * Math.min(1, dt * 6);
      } else {
        e.ang += e.spin * dt * (e.hot > 0.3 ? 2.5 : 1);
      }

      // contact
      if (p.alive && e.spawnT <= 0 && !e.demo) {
        const dx = e.x - p.x, dy = e.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < e.r + CFG.PLAYER_R) {
          if (this.hurtPlayer(e.def.contact, e.x, e.y)) {
            e.kx += (dx / (d || 1)) * 320;
            e.ky += (dy / (d || 1)) * 320;
          }
        }
      }
      if (e.hp <= 0) this.shatter(e);
    }
    if (heat > 0) this.sfx('crackle', heat);
    this.fieldHeat = approach(this.fieldHeat, heat / Math.max(dt, 1e-4), 6, dt);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
  },

  damageEnemy(e, dmg, srcX, srcY, push = 0) {
    if (e.dead || e.invuln) return;
    e.hp -= dmg;
    e.flash = 1;
    if (push && srcX != null) {
      const dx = e.x - srcX, dy = e.y - srcY, d = Math.hypot(dx, dy) || 1;
      e.kx += (dx / d) * push; e.ky += (dy / d) * push;
    }
    if (e.hp <= 0) this.shatter(e);
  },

  shatter(e) {
    if (e.dead) return;
    e.dead = true;
    const def = e.def;
    const st = this.stat;
    const depth = def.depth + (st.cleave ? 1 : 0);
    const pieces = fracture(e.poly, depth, def.size * def.size * 0.035, () => Rng.next());
    const cs = Math.cos(e.ang), sn = Math.sin(e.ang);
    const speed = (st.cleave ? 1.45 : 1) * (def.size > 30 ? 260 : 220);
    for (const piece of pieces) {
      const c = polyCentroid(piece);
      const wx = e.x + c[0] * cs - c[1] * sn;
      const wy = e.y + c[0] * sn + c[1] * cs;
      let ox = wx - e.x, oy = wy - e.y;
      const ol = Math.hypot(ox, oy) || 1;
      ox /= ol; oy /= ol;
      const v = speed * Rng.range(0.6, 1.3);
      this.shards.push({
        pts: piece, c0x: c[0], c0y: c[1], x: wx, y: wy,
        vx: e.vx * 0.3 + ox * v + Rng.range(-40, 40), vy: e.vy * 0.3 + oy * v + Rng.range(-40, 40),
        ang: e.ang, va: Rng.range(-7, 7), life: Rng.range(0.9, 1.5), max: 1.5,
        ret: e.ret, gx: e.gx, gy: e.gy, kind: def.kind, tex: def.tex, optic: e.optic,
        dmg: (st.cleave ? 0.7 : 0.3) * (1 + 0.4 * Math.max(0, st.cleave - 1)), live: !e.demo,
      });
    }
    const col = def.kind === KIND.GARNET ? [1, 0.35, 0.4] : def.kind === KIND.FLUORITE ? [0.7, 0.45, 1]
      : Optics.linear(e.ret + 300);
    this.burst(e.x, e.y, 10 + Math.floor(def.size * 0.4), 320, 0.9, col);
    this.addShock(e.x, e.y, def.size * 4.5, 7 + def.size * 0.12, 0.55);
    if (e.demo) { this.sfx('shatterSoft', e); return; }

    this.stats.shattered++;
    this.combo++;
    this.comboT = CFG.COMBO_T;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    this.addScore(def.score, e.x, e.y - def.size);
    this.player.energy = Math.min(100, this.player.energy + 5);
    this.shake = Math.min(1, this.shake + 0.08 + def.size * 0.004);
    this.sfx('shatter', e);

    if (st.echo) {
      if (this.echoes.length >= CFG.MAX_ECHO) this.echoes.shift();
      const life = CFG.ECHO_LIFE * (0.8 + 0.35 * st.echo);
      this.echoes.push({ x: e.x, y: e.y, p: Rng.range(0, TAU), life, max: life });
    }
    if (Rng.chance(def.drop)) {
      this.quanta.push({ x: e.x, y: e.y, vx: Rng.range(-60, 60), vy: Rng.range(-60, 60), life: 9, max: 9 });
    }
    if (def.splits) {
      for (let k = 0; k < 2; k++) {
        const a = Rng.range(0, TAU);
        this.spawnEnemy(def.splits, e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 10,
          { vx: Math.cos(a) * 240, vy: Math.sin(a) * 240 });
      }
    }
    if (e.owner && e.owner.onBellLost) e.owner.onBellLost(e);
  },

  /* ------------------------------------------------------------------ anchor contact */
  anchorImpact(a) {
    const R = CFG.ANCHOR_IMPACT;
    let hitAny = false;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - a.x, e.y - a.y);
      if (d > R + e.r) continue;
      hitAny = true;
      this.damageEnemy(e, e.iso ? 1.5 : 0.35, a.x, a.y, 260);
    }
    a.pulse = 1;
    this.burst(a.x, a.y, hitAny ? 16 : 7, hitAny ? 300 : 160, 0.5, [0.85, 0.9, 1.0]);
    this.addShock(a.x, a.y, hitAny ? 150 : 90, hitAny ? 12 : 6, 0.45);
    if (hitAny) this.shake = Math.min(1, this.shake + 0.2);
    this.sfx('land', hitAny);
  },

  anchorSweepHits(a, px, py) {
    const strike = 1 + 2 * Math.min(1, this.stat.stroke);
    for (const e of this.enemies) {
      if (e.dead || a.hit.has(e)) continue;
      const rr = e.r + 12;
      if (segDist2(e.x, e.y, px, py, a.x, a.y) < rr * rr) {
        a.hit.add(e);
        this.damageEnemy(e, (e.iso ? 1.0 : 0.45) * strike, a.x, a.y, 200);
        this.burst(e.x, e.y, 8, 220, 0.4, [0.9, 0.92, 1.0]);
        this.sfx('strike');
      }
    }
  },

  /* ------------------------------------------------------------------ ripples */
  emitRing(x, y, speed, max, dmg) {
    this.rings.push({ x, y, r: 6, speed, max, dmg, str: 1, hit: false });
    this.addShock(x, y, 60, 6, 0.3);
    this.sfx('ring');
  },

  updateRings(dt) {
    const p = this.player;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i];
      g.r += g.speed * dt;
      g.str = (1 - smoothstep(g.max * 0.72, g.max, g.r)) * smoothstep(0, 30, g.r);
      if (!g.hit && p.alive && !this.attract) {
        const d = Math.hypot(p.x - g.x, p.y - g.y);
        if (Math.abs(d - g.r) < 9 + CFG.PLAYER_R * 0.7 && g.str > 0.25) {
          g.hit = true;
          if (p.shieldOn) {
            this.usedNull = true;
            this.burst(p.x, p.y, 10, 200, 0.5, [0.75, 0.85, 1.0]);
            this.sfx('nullCatch');
          } else {
            this.hurtPlayer(g.dmg * g.str, g.x, g.y);
          }
        }
      }
      if (g.r >= g.max) this.rings.splice(i, 1);
    }
  },

  /* ------------------------------------------------------------------ transient effects */
  burst(x, y, n, speed, life, col) {
    const c = col || [1, 0.95, 0.85];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.25 + Math.random() * 0.75);
      this.sparks.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.5 + Math.random() * 0.6), max: life,
        size: 3 + Math.random() * 5, r: c[0], g: c[1], b: c[2],
      });
    }
    if (this.sparks.length > 1600) this.sparks.splice(0, this.sparks.length - 1600);
  },

  addShock(x, y, maxR, strength, dur) {
    if (!this.settings.motion) strength *= 0.35;
    this.shocks.push({ x, y, t: 0, dur, maxR, strength });
    if (this.shocks.length > Shaders.MAX_SHOCK) this.shocks.shift();
  },

  updateEffects(dt) {
    const p = this.player;
    // shards: tumble outward; live shards cut isotropic crystals
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const k = Math.exp(-1.8 * dt);
      s.vx *= k; s.vy *= k;
      s.ang += s.va * dt;
      if (s.live && s.vx * s.vx + s.vy * s.vy > 90 * 90) {
        for (const e of this.enemies) {
          if (!e.iso || e.dead) continue;
          const dx = e.x - s.x, dy = e.y - s.y;
          if (dx * dx + dy * dy < (e.r + 4) * (e.r + 4)) {
            this.damageEnemy(e, s.dmg, s.x, s.y, 60);
            s.live = false;
            this.burst(s.x, s.y, 4, 160, 0.35, [1, 0.6, 0.6]);
            this.sfx('shrapnel');
            break;
          }
        }
      }
      if (s.life <= 0) this.shards.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const k = Math.exp(-3.2 * dt);
      s.vx *= k; s.vy *= k;
      if (s.life <= 0) this.sparks.splice(i, 1);
    }
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const e = this.echoes[i];
      e.life -= dt;
      if (e.life <= 0) this.echoes.splice(i, 1);
    }
    for (let i = this.quanta.length - 1; i >= 0; i--) {
      const q = this.quanta[i];
      q.life -= dt;
      const dx = p.x - q.x, dy = p.y - q.y;
      const d = Math.hypot(dx, dy) || 1;
      if (p.alive && d < 120) {
        const pull = 900 * (1 - d / 120) + 120;
        q.vx += (dx / d) * pull * dt; q.vy += (dy / d) * pull * dt;
      }
      const k = Math.exp(-2.2 * dt);
      q.vx *= k; q.vy *= k;
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (p.alive && d < CFG.PLAYER_R + 12) {
        p.hp = Math.min(p.maxHp, p.hp + 8);
        p.energy = Math.min(100, p.energy + 12);
        this.addScore(5, q.x, q.y - 16, '+COHERENCE');
        this.burst(q.x, q.y, 10, 160, 0.5, [1, 0.95, 0.75]);
        this.sfx('quanta');
        this.quanta.splice(i, 1);
        continue;
      }
      if (q.life <= 0) this.quanta.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const q = this.popups[i];
      q.t += dt;
      if (q.t > q.life) this.popups.splice(i, 1);
    }
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const g = this.glints[i];
      g.t -= dt;
      if (g.t <= 0) {
        this.spawnEnemy(g.type, g.x, g.y, g.opts);
        this.glints.splice(i, 1);
      }
    }
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      if (s.t > s.dur) this.shocks.splice(i, 1);
    }
  },

  sfx(name, data) {
    if (this.audio && this.audio.ready) this.audio.play(name, data, this);
  },
});
