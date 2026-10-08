'use strict';
/*
 * ISOGYRE — a simple autopilot. Used by the balance simulator (tools/sim.mjs) and the
 * smoke test; never by the real game loop. It kites away from crystals, hunts the ones
 * that keep their distance, keeps anchors in a short line roughly one wavelength apart,
 * sweeps, nulls ripples and red fringes, and throws anchors at isotropic crystals.
 *
 * `skill` (0..1) degrades it toward a distracted human: slower reactions, lazier sweeping,
 * imperfect nulls, sloppier dodging.
 */
const Bot = {
  throwCd: 0,
  thinkT: 0,
  cached: null,
  sweepOn: true,
  sweepT: 0,
  reset() { this.throwCd = 0; this.thinkT = 0; this.cached = null; this.sweepOn = true; this.sweepT = 0; },

  intent(game, dt, skill = 1) {
    const p = game.player;
    const it = { mx: 0, my: 0, sweep: 0, throwAt: null, recall: false, shield: false, focus: false, aim: null };
    if (!p.alive) return it;
    this.throwCd -= dt;
    // humans sweep in bursts
    this.sweepT -= dt;
    if (this.sweepT <= 0) {
      this.sweepOn = Rng.next() < 0.35 + 0.65 * skill;
      this.sweepT = 0.4 + Rng.next() * 1.2;
    }
    it.sweep = this.sweepOn ? 3.4 * dt : 0;
    // and react late
    this.thinkT -= dt;
    if (this.thinkT > 0 && this.cached) {
      it.mx = this.cached.mx; it.my = this.cached.my; it.shield = this.cached.shield;
      return it;
    }
    this.thinkT = (1 - skill) * 0.3;
    const plan = this.plan(game, dt, skill);
    Object.assign(it, plan, { sweep: it.sweep });
    this.cached = { mx: it.mx, my: it.my, shield: it.shield };
    return it;
  },

  plan(game, dt, skill) {
    const p = game.player;
    const st = game.stat;
    const out = { mx: 0, my: 0, throwAt: null, recall: false, shield: false };
    let fx = 0, fy = 0, nearest = 1e9;
    let prey = null;
    for (const e of game.enemies) {
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ranged = e.def.bell || e.type === 'opal' || (e.type === 'geode' && !e.invuln);
      if (ranged) {
        if (!prey || d < prey.d) prey = { e, d };
        if (d > 90) continue;
      }
      nearest = Math.min(nearest, d - e.r);
      const gap = Math.max(18, d - e.r - CFG.PLAYER_R);
      const w = (1600 * (e.def.contact / 10)) / (gap * gap);
      fx += (dx / d) * w;
      fy += (dy / d) * w;
    }
    // hunt crystals that keep their distance when nothing is close
    if (prey && nearest > 150) {
      const dx = prey.e.x - p.x, dy = prey.e.y - p.y, d = Math.hypot(dx, dy) || 1;
      const want = prey.e.type === 'geode' ? 160 : 120;
      const k = clamp((d - want) / 120, -1, 1) * 0.9;
      fx += (dx / d) * k; fy += (dy / d) * k;
    }
    const rr = Math.hypot(p.x, p.y);
    const comfort = prey ? 380 : 230;
    if (rr > comfort) { fx -= (p.x / rr) * (rr - comfort) / 90; fy -= (p.y / rr) * (rr - comfort) / 90; }

    // red fringes: walk downhill, null when it burns
    if (Field.haz.length) {
      const H = Field.hazard(p.x, p.y);
      if (H > Field.TH * 0.55) {
        const g = Field.gradH(p.x, p.y, [0, 0]);
        const gm = Math.hypot(g[0], g[1]) || 1;
        fx -= (g[0] / gm) * 1.6 * skill;
        fy -= (g[1] / gm) * 1.6 * skill;
      }
      if (H > Field.TH * 0.95 && p.energy > 10 && Rng.next() < 0.5 + 0.5 * skill) out.shield = true;
    }
    for (const g of game.rings) {
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (g.str > 0.25 && d > g.r - 6 && d - g.r < 42 + (1 - skill) * 40 && Rng.next() < 0.4 + 0.6 * skill) out.shield = true;
    }
    if (game.boss && game.boss.amp > 0.6) {
      const B = game.boss;
      const dx = p.x - B.tx, dy = p.y - B.ty, d = Math.hypot(dx, dy) || 1;
      if (d < 120) { fx += (dx / d) * 2.5 * skill; fy += (dy / d) * 2.5 * skill; }
    }
    let fm = Math.hypot(fx, fy);
    if (fm < 0.05) {
      const a = game.time * 0.5;
      fx = Math.cos(a) * 0.4; fy = Math.sin(a) * 0.4;
      fm = 0.4;
    }
    const speed = 0.6 + 0.4 * skill;
    out.mx = (fx / Math.max(fm, 1)) * speed;
    out.my = (fy / Math.max(fm, 1)) * speed;

    // anchors
    if (this.throwCd <= 0) {
      let target = null;
      for (const e of game.enemies) {
        if (!e.iso || e.spawnT > 0) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < 380 && (!target || d < target.d)) target = { e, d };
      }
      if (target && game.anchors.length >= 1) {
        out.throwAt = { x: target.e.x + target.e.vx * 0.15, y: target.e.y + target.e.vy * 0.15 };
        this.throwCd = 0.55 / skill;
      } else if (prey && prey.d > 200 && Rng.next() < 0.5) {
        // drop an anchor beside a distant ringer so the fringes reach it
        const a = Rng.range(0, TAU);
        out.throwAt = { x: prey.e.x + Math.cos(a) * 45, y: prey.e.y + Math.sin(a) * 45 };
        this.throwCd = 1.2 / skill;
      } else {
        const far = game.anchors.find((a) => Math.hypot(a.x - p.x, a.y - p.y) > 330);
        if (game.anchors.length < st.anchorsMax || far) {
          const n = game.anchors.length < st.anchorsMax ? game.anchors.length : 0;
          const base = Math.atan2(fy, fx) + Math.PI / 2;
          const side = n % 2 ? 1 : -1;
          const k = side * (Math.floor(n / 2) + 1);
          out.throwAt = { x: p.x + Math.cos(base) * k * 72, y: p.y + Math.sin(base) * k * 72 };
          this.throwCd = 0.6 / skill;
        }
      }
    }
    out.aim = out.throwAt;
    return out;
  },
};
