'use strict';
/*
 * ISOGYRE — the Geode and its choir.
 *
 * Six zircon bells orbit the geode. They are a phased array: each bell's phase is
 * set to -k·|target − bell| so their waves arrive together at one point, which
 * trails the player. The core is shielded while any bell still rings.
 */
function aiNone(e) { e.tx = 0; e.ty = 0; }

function aiGeode(e, game) {
  const B = game.boss;
  if (!B) { e.tx = e.ty = 0; return; }
  const dx = B.wx - e.x, dy = B.wy - e.y;
  const d = Math.hypot(dx, dy);
  const sp = e.def.speed * (B.phase2 ? 1.4 : 1);
  e.tx = d > 4 ? (dx / d) * sp * clamp(d / 80, 0, 1) : 0;
  e.ty = d > 4 ? (dy / d) * sp * clamp(d / 80, 0, 1) : 0;
}

Bestiary.geode = {
  name: 'Geode', hp: 50, speed: 24, tmul: 1.0, fear: 0, r: 46, size: 60, contact: 22, score: 1500,
  kind: KIND.BIREF, tex: TEX.ZONED, shape: 'geode', ret: [820, 1150], grad: 1.2, depth: 4, drop: 1,
  wobble: 0, wobbleF: 0, ai: aiGeode,
};
Bestiary.choirbell = {
  name: 'Choir bell', hp: 2.8, speed: 0, tmul: 1.0, fear: 0, r: 20, size: 30, contact: 12, score: 60,
  kind: KIND.BIREF, tex: TEX.ZONED, shape: 'zircon', ret: [1400, 2000], grad: 4, depth: 2, drop: 0.3,
  wobble: 0, wobbleF: 0, ai: aiNone, bell: true,
};

Object.assign(Game.prototype, {
  spawnBoss() {
    const hpScale = (this.dir && this.dir.def.hpScale) || 1;
    const core = this.spawnEnemy('geode', 0, -CFG.ARENA_R * 0.5, { hpMul: 1 });
    core.maxHp = core.hp = Bestiary.geode.hp * hpScale;
    core.spawnT = 2.0;
    core.spin = 0.12;
    core.invuln = true;
    // amethyst lining: small crystals pointing into the hollow
    core.extra = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Rng.range(-0.1, 0.1);
      const r0 = 0.82 * core.def.size, r1 = Rng.range(0.32, 0.48) * core.def.size;
      const w = Rng.range(0.12, 0.2);
      core.extra.push({
        pts: [
          [Math.cos(a - w) * r0, Math.sin(a - w) * r0],
          [Math.cos(a) * r1, Math.sin(a) * r1],
          [Math.cos(a + w) * r0, Math.sin(a + w) * r0],
        ],
        ret: Rng.range(250, 520), kind: KIND.BIREF, tex: TEX.NONE,
      });
    }
    core.extra.push({ pts: regularPoly(9, core.def.size * 0.3, 0, 0.2, () => Rng.next()), ret: 0, kind: KIND.GARNET, tex: 0 });
    const B = {
      core, bells: new Array(6).fill(null), state: 'intro', t: 0, orbit: 0,
      tx: 0, ty: 0, amp: 0, phase2: false, wx: 0, wy: -60, wanderT: 0, addT: 6, ringT: 4, regrowI: 0,
      hpScale,
    };
    B.onBellLost = (bell) => {
      const i = B.bells.indexOf(bell);
      if (i >= 0) B.bells[i] = null;
    };
    this.boss = B;
    B.tx = this.player.x; B.ty = this.player.y;
    this.banner = { title: 'THE GEODE', sub: 'A CHOIR OF SIX ZIRCON BELLS', t: 0, dur: 3.6 };
    this.sfx('bossIntro');
  },

  bossSpawnBell(i) {
    const B = this.boss;
    const c = B.core;
    const a = B.orbit + (i / 6) * TAU;
    const bell = this.spawnEnemy('choirbell', c.x + Math.cos(a) * 120, c.y + Math.sin(a) * 120, { owner: B });
    bell.maxHp = bell.hp = Bestiary.choirbell.hp * B.hpScale;
    bell.spawnT = 0.6;
    bell.bellAmp = 0;
    B.bells[i] = bell;
  },

  updateBoss(dt) {
    const B = this.boss;
    const c = B.core;
    const p = this.player;
    if (c.dead) { this.bossDefeated(); return; }
    B.t += dt;
    B.phase2 = c.hp < c.maxHp * 0.5;
    B.orbit += dt * (B.phase2 ? 0.62 : 0.36);

    // wander
    B.wanderT -= dt;
    if (B.wanderT <= 0) {
      B.wanderT = Rng.range(3, 5);
      const a = Rng.range(0, TAU), r = Rng.range(0, 190);
      B.wx = Math.cos(a) * r; B.wy = Math.sin(a) * r;
    }

    const alive = B.bells.filter((b) => b && !b.dead);
    c.invuln = alive.length > 0 || B.state === 'intro';
    const setState = (s) => { B.state = s; B.t = 0; };
    const lagTo = (rate) => {
      B.tx = approach(B.tx, p.x, rate, dt);
      B.ty = approach(B.ty, p.y, rate, dt);
    };

    switch (B.state) {
      case 'intro':
        if (B.regrowI < 6 && B.t > 1.0 + B.regrowI * 0.32) { this.bossSpawnBell(B.regrowI); B.regrowI++; }
        B.amp = 0;
        if (B.t > 3.4) setState('idle');
        break;
      case 'idle':
        B.amp = approach(B.amp, 0.24, 4, dt);
        lagTo(3);
        if (B.t > (B.phase2 ? 1.6 : 2.3)) { setState('charge'); this.sfx('bossCharge'); }
        break;
      case 'charge':
        B.amp = lerp(0.24, 1.0, smoothstep(0, 1.5, B.t));
        lagTo(2.2);
        if (B.t > 1.5) { setState('fire'); this.sfx('bossFire'); this.shake = Math.min(1, this.shake + 0.3); }
        break;
      case 'fire':
        B.amp = 1.0;
        lagTo(B.phase2 ? 1.25 : 0.95);
        if (B.t > (B.phase2 ? 2.0 : 1.5)) setState('cool');
        break;
      case 'cool':
        B.amp = approach(B.amp, 0.24, 5, dt);
        lagTo(3);
        if (B.t > 0.8) setState('idle');
        break;
      case 'exposed':
        B.amp = 0;
        c.spin = approach(c.spin, 1.4, 2, dt);
        if (B.t > 9.5) { setState('regrow'); B.regrowI = 0; this.sfx('bossRegrow'); }
        break;
      case 'regrow':
        B.amp = 0;
        c.spin = approach(c.spin, 0.12, 2, dt);
        if (B.regrowI < 6 && B.t > B.regrowI * 0.55) {
          let slot = B.bells.findIndex((b) => !b || b.dead);
          if (slot >= 0) this.bossSpawnBell(slot);
          B.regrowI++;
        }
        if (B.regrowI >= 6 && B.t > 3.6) setState('idle');
        break;
      default:
        break;
    }
    if (alive.length === 0 && B.state !== 'intro' && B.state !== 'exposed' && B.state !== 'regrow') {
      setState('exposed');
      this.banner = { title: 'THE CORE IS EXPOSED', sub: 'STRIKE NOW', t: 0, dur: 2.0 };
      this.sfx('bossExpose');
      this.addShock(c.x, c.y, 380, 18, 0.9);
    }

    // the choir: orbit and phase every bell onto the target
    const kH = Field.kH;
    for (let i = 0; i < 6; i++) {
      const b = B.bells[i];
      if (!b || b.dead) continue;
      const a = B.orbit + (i / 6) * TAU;
      b.x = c.x + Math.cos(a) * 120;
      b.y = c.y + Math.sin(a) * 120;
      b.ang = a + Math.PI / 2;
      b.phase = -kH * Math.hypot(B.tx - b.x, B.ty - b.y);
      b.bellAmp = B.amp;
    }

    // reinforcements
    B.addT -= dt;
    if (B.addT <= 0 && B.state !== 'intro') {
      B.addT = B.phase2 ? 5.5 : 7.5;
      const type = Rng.pick(B.phase2 ? ['calcite', 'quartz', 'garnet', 'aragonite'] : ['quartz', 'calcite', 'quartz', 'mica']);
      const n = type === 'aragonite' ? 7 : type === 'garnet' || type === 'mica' ? 1 : 3;
      this.spawnGroup({ type, n, interval: 0.35, formation: type === 'aragonite' ? 'cluster' : 'arc' });
    }
    if (B.phase2) {
      B.ringT -= dt;
      if (B.ringT <= 0) { B.ringT = 4.6; this.emitRing(c.x, c.y, 210, 620, 12); }
    }
  },

  bossDefeated() {
    const B = this.boss;
    this.boss = null;
    for (const b of B.bells) if (b && !b.dead) this.shatter(b);
    for (const e of this.enemies.slice()) if (!e.dead) this.shatter(e);
    this.slowT = 1.4;
    this.shake = 1;
    this.addShock(B.core.x, B.core.y, 700, 34, 1.4);
    this.burst(B.core.x, B.core.y, 120, 700, 1.8);
    this.sfx('bossDeath');
  },
});
