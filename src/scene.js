'use strict';
/* ISOGYRE — translate game state into the renderer's frame description. */

Object.assign(Game.prototype, {
  buildScene(renderer, frameDt) {
    const L = this.layout;
    const k = renderer.w / L.W; // device px per CSS px
    let shx = 0, shy = 0;
    if (this.settings.motion && this.shake > 0.001) {
      const m = this.shake * this.shake * 9;
      shx = (Math.random() * 2 - 1) * m;
      shy = (Math.random() * 2 - 1) * m;
    }
    const view = { cx: (L.cx + shx) * k, cy: (L.cy + shy) * k, scale: (L.R * k) / CFG.ARENA_R };
    const A = this.arr;
    const p = this.player;

    const src = Field.src;
    const srcN = Math.min(src.length, Shaders.MAX_SRC);
    for (let i = 0; i < srcN; i++) {
      const s = src[i];
      A.src[i * 4] = s.x; A.src[i * 4 + 1] = s.y; A.src[i * 4 + 2] = s.a; A.src[i * 4 + 3] = s.p;
    }
    const haz = Field.haz;
    const hazN = Math.min(haz.length, Shaders.MAX_HAZ);
    for (let i = 0; i < hazN; i++) {
      const s = haz[i];
      A.haz[i * 4] = s.x; A.haz[i * 4 + 1] = s.y; A.haz[i * 4 + 2] = s.a; A.haz[i * 4 + 3] = s.p;
    }
    const damp = Field.damp;
    const dampN = Math.min(damp.length, Shaders.MAX_DAMP);
    for (let i = 0; i < dampN; i++) {
      const q = damp[i];
      A.damp[i * 4] = q.x; A.damp[i * 4 + 1] = q.y; A.damp[i * 4 + 2] = q.r; A.damp[i * 4 + 3] = q.s;
    }
    const ringN = Math.min(this.rings.length, Shaders.MAX_RING);
    for (let i = 0; i < ringN; i++) {
      const g = this.rings[this.rings.length - ringN + i];
      A.ring[i * 4] = g.x; A.ring[i * 4 + 1] = g.y; A.ring[i * 4 + 2] = g.r; A.ring[i * 4 + 3] = g.str;
    }

    /* crystals and shards */
    const P = this.polys;
    P.reset();
    for (const e of this.enemies) this.pushEnemy(P, e);
    for (const s of this.shards) {
      const f = clamp(s.life / s.max, 0, 1);
      P.add(s.pts, s.c0x, s.c0y, s.x, s.y, s.ang, 1, {
        ret: s.ret, gx: s.gx, gy: s.gy, stress: 0.1, ext: Math.pow(Math.sin(2 * (s.ang + s.optic)), 2),
        flash: 0, alpha: Math.min(1, f * 1.6), tex: s.tex, kind: s.kind,
      });
    }

    /* conoscopic figures: you, your anchors, echoes, light quanta */
    const F = this.figs;
    F.reset();
    const sw = this.sweep.s;
    for (const q of this.quanta) {
      const blink = q.life < 2 ? (Math.sin(this.realTime * 18) > 0 ? 1 : 0.35) : 1;
      F.add(q.x, q.y, 8.5 + Math.sin(this.realTime * 6 + q.x) * 1.2, this.realTime * 1.5, 0, 950, blink, 0,
        1.0, 0.92, 0.7, 1.6);
    }
    for (const e of this.echoes) {
      const f = clamp(e.life / 0.6, 0, 1) * clamp((e.max - e.life) / 0.15, 0, 1);
      F.add(e.x, e.y, 12 * (0.6 + 0.4 * f), e.p + sw * 0.25, 0, 1400, f * 0.85, 0, 1.0, 0.82, 0.62, 1.2);
    }
    for (let j = 0; j < this.anchors.length; j++) {
      const a = this.anchors[j];
      const r = CFG.ANCHOR_FIG * (1 + a.pulse * 0.4) * (a.state === 'fly' ? 0.85 : 1);
      F.add(a.x, a.y, r, a.rot + (j + 1) * sw * 0.25, 0.36, 3200, a.state === 'return' ? 0.7 : 1, 0,
        0.78, 0.86, 1.0, 0.9);
    }
    if (p.alive) {
      const blink = p.inv > 0 ? (Math.sin(this.realTime * 42) > 0 ? 1 : 0.45) : 1;
      F.add(p.x, p.y, CFG.PLAYER_FIG, sw * 0.25 + this.time * 0.05, 0, 2600, blink, p.hurt,
        1.0, 0.94, 0.82, 1.6);
    }

    /* sparks, plus spawn glints */
    const SB = this.sparkBatch;
    SB.reset();
    for (const s of this.sparks) {
      const f = clamp(s.life / s.max, 0, 1);
      SB.add(s.x, s.y, s.size * (0.4 + 0.6 * f), s.r, s.g, s.b, f * 1.7);
    }
    for (const g of this.glints) {
      const u = 1 - g.t / g.total;
      const c = Bestiary[g.type].kind === KIND.BIREF ? Optics.linear((Bestiary[g.type].ret[0] + Bestiary[g.type].ret[1]) / 2 + 200) : [1, 0.5, 0.6];
      const tw = 0.6 + 0.4 * Math.sin(this.realTime * 22 + g.x);
      SB.add(g.x, g.y, 6 + u * 22, c[0], c[1], c[2], (0.4 + u * 1.8) * tw);
    }

    /* screen-space refraction from shockwaves */
    let shockN = 0;
    for (const s of this.shocks) {
      if (shockN >= Shaders.MAX_SHOCK) break;
      const u = clamp(s.t / s.dur, 0, 1);
      const i = shockN * 4;
      A.shock[i] = view.cx + s.x * view.scale;
      A.shock[i + 1] = renderer.h - (view.cy + s.y * view.scale);
      A.shock[i + 2] = s.maxR * easeOutCubic(u) * view.scale;
      A.shock[i + 3] = s.strength * (1 - u) * (1 - u) * k;
      shockN++;
    }

    const lowHp = p.alive && !this.attract ? smoothstep(0.4, 0.12, p.hp / p.maxHp) : 0;
    const motion = this.settings.motion ? 1 : 0;
    const q = this.quality || { dustPoint: 1.6 };
    return {
      time: this.time, motion, view, arenaR: CFG.ARENA_R,
      src: A.src, srcN, wave: [Field.k, Field.R0, Field.over, Field.T * this.tScale()],
      haz: A.haz, hazN, hazWave: [Field.kH, Field.R0H, 0, Field.TH],
      damp: A.damp, dampN, ring: A.ring, ringN,
      shield: [p.x, p.y, this.shieldR, p.alive ? p.shieldVis : 0],
      grain: [this.grain.seed, this.grain.cell, this.grain.ret[0], this.grain.ret[1]],
      grain2: [this.state === 'title' ? 0.03 : 0.0125, this.grain.twin, 0.08, 0],
      sweepRot: sw * 0.125, retGain: 400, hazColor: CFG.HAZ_COLOR,
      polys: P, figures: F, sparks: SB,
      shocks: A.shock, shockN,
      dust: {
        enabled: q.dust !== false,
        dt: Math.min(frameDt, 1 / 30) * (this.state === 'paused' ? 0 : 1) * (this.dustBoost || 1),
        steps: this.dustBoost || 1,
        params: [7, 2600, 9.0, 0.0006], pointSize: Math.max(1.0, q.dustPoint * Math.min(k, 2) * 0.85),
        color: [0.22, 0.21, 0.19],
        // keep sand density constant per screen area: a phone's small eyepiece gets fewer grains
        count: Math.min(q.dustCount, Math.max(8000, Math.round(65536 * Math.pow(L.R / 340, 2)))),
      },
      post: {
        bloom: 0.55, bloomThreshold: 1.0, exposure: 1.4,
        hurt: p.hurt * (motion ? 0.9 : 0.5), lowHp, grain: 0.018, fade: this.fade,
        aberration: motion ? 1 : 0.4,
      },
    };
  },

  pushEnemy(P, e) {
    const def = e.def;
    const spawnK = clamp(1 - e.spawnT / 0.45, 0, 1);
    const sc = e.spawnT > 0 ? 0.35 + 0.65 * easeOutCubic(spawnK) : 1;
    let flash = e.flash;
    if (e.charging) flash = Math.max(flash, 0.5 * (1 - e.timer / 0.7));
    const o = {
      ret: e.ret, gx: e.gx, gy: e.gy,
      stress: clamp(1 - e.hp / e.maxHp, 0, 1) * 0.8 + e.hot * 0.1,
      ext: Math.pow(Math.sin(2 * (e.ang + e.optic)), 2),
      flash, alpha: spawnK, tex: def.tex, kind: def.kind,
    };
    if (e.type === 'geode') {
      if (!e.shellPts) e.shellPts = regularPoly(15, def.size * 1.24, 0.3, 0.06, Math.random);
      if (e.invuln) {
        P.add(e.shellPts, 0, 0, e.x, e.y, -e.ang * 0.5, sc, { ...o, kind: KIND.GARNET, stress: 0, alpha: 0.55 * spawnK, flash: 0 });
      }
    }
    P.add(e.poly, 0, 0, e.x, e.y, e.ang, sc, o);
    if (e.extra) {
      for (const x of e.extra) {
        P.add(x.pts, 0, 0, e.x, e.y, e.ang, sc, { ...o, ret: x.ret, kind: x.kind, tex: x.tex, stress: o.stress * 0.6 });
      }
    }
  },
});
