'use strict';
/*
 * ISOGYRE — the crystals.
 *
 * Retardation ranges follow what each mineral actually looks like in a 30 µm thin
 * section under crossed polars: quartz in first-order greys and straw yellows,
 * muscovite in vivid second/third-order colours, calcite and zircon in pale
 * high-order creams. Garnet and fluorite are isotropic, so they stay black — and
 * are immune to interference.
 */
const SHAPES = {
  quartz: [[1, 0], [0.58, 0.4], [-0.58, 0.4], [-1, 0], [-0.58, -0.4], [0.58, -0.4]],
  calcite: [[0.95, 0.3], [-0.2, 0.66], [-0.95, -0.3], [0.2, -0.66]],
  mica: [[0.95, 0], [0.48, 0.8], [-0.48, 0.8], [-0.95, 0], [-0.48, -0.8], [0.48, -0.8]],
  needle: [[1, 0], [0.18, 0.15], [-1, 0], [-0.18, -0.15]],
  zircon: [[1, 0], [0.55, 0.36], [-0.55, 0.36], [-1, 0], [-0.55, -0.36], [0.55, -0.36]],
  fluorite: [[0.78, 0.5], [0.5, 0.78], [-0.5, 0.78], [-0.78, 0.5], [-0.78, -0.5], [-0.5, -0.78], [0.5, -0.78], [0.78, -0.5]],
};

const KIND = { BIREF: 0, GARNET: 1, FLUORITE: 2, OPAL: 3 };
const TEX = { NONE: 0, CLEAVAGE: 1, ZONED: 2, TWIN: 3 };

const _G = [0, 0];

/** Default pursuit: head for the player, shy away from bright fringes in proportion to `fear`. */
function aiChase(e, game, dt) {
  const p = game.player;
  let dx = p.x - e.x, dy = p.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  const def = e.def;
  let speed = def.speed * e.speedMul;
  let ax = dx * speed, ay = dy * speed;
  if (def.fear > 0 && !e.iso && Field.src.length > 1) {
    // Slip sideways, along the fringes, into the nearest dark line — but keep advancing.
    Field.gradI(e.x, e.y, _G);
    const gm = Math.hypot(_G[0], _G[1]) + 1e-6;
    const push = def.fear * speed * clamp(e.I / Field.T, 0, 1.6);
    const px = -(_G[0] / gm) * push, py = -(_G[1] / gm) * push;
    const along = px * dx + py * dy;
    const back = Math.max(along, -0.35 * speed);
    ax += px - along * dx + back * dx;
    ay += py - along * dy + back * dy;
  }
  // a little personality
  const wob = Math.sin(game.time * def.wobbleF + e.seed * 6.28) * def.wobble;
  ax += -dy * wob * speed;
  ay += dx * wob * speed;
  e.tx = ax; e.ty = ay;
}

/** Swarm: pursuit plus loose flocking among siblings of the same type. */
function aiFlock(e, game, dt) {
  aiChase(e, game, dt);
  let cx = 0, cy = 0, vx = 0, vy = 0, n = 0;
  for (const o of game.enemies) {
    if (o === e || o.type !== e.type) continue;
    const dx = o.x - e.x, dy = o.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 140 * 140) continue;
    cx += o.x; cy += o.y; vx += o.vx; vy += o.vy; n++;
  }
  if (n) {
    cx /= n; cy /= n; vx /= n; vy /= n;
    e.tx += (cx - e.x) * 0.5 + (vx - e.vx) * 0.35;
    e.ty += (cy - e.y) * 0.5 + (vy - e.vy) * 0.35;
  }
}

/** Opal: keeps its distance and circles, throwing ripples. */
function aiOrbit(e, game, dt) {
  const p = game.player;
  let dx = e.x - p.x, dy = e.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  const want = e.def.orbitR;
  const radial = clamp((want - d) / 120, -1, 1);
  const speed = e.def.speed * e.speedMul;
  e.tx = (dx * radial + -dy * e.spinDir * 0.8) * speed;
  e.ty = (dy * radial + dx * e.spinDir * 0.8) * speed;
  // stay inside the field of view
  const rr = Math.hypot(e.x, e.y);
  if (rr > CFG.ARENA_R * 0.82) { e.tx -= (e.x / rr) * speed; e.ty -= (e.y / rr) * speed; }
  e.timer -= dt;
  if (e.timer < 0.7 && !e.charging) { e.charging = true; game.sfx('opalCharge', e); }
  if (e.timer <= 0) {
    e.timer = e.def.period * Rng.range(0.85, 1.15);
    e.charging = false;
    game.emitRing(e.x, e.y, e.def.ringSpeed, e.def.ringMax, e.def.ringDmg);
  }
}

/** Zircon bell: drifts to a station and rings. Pairs are slightly detuned, so their fringes rotate. */
function aiBell(e, game, dt) {
  if (e.station == null) {
    e.station = Math.atan2(e.y, e.x);
    e.stationR = Rng.range(0.42, 0.62) * CFG.ARENA_R;
  }
  e.station += dt * 0.05 * e.spinDir;
  const sx = Math.cos(e.station) * e.stationR, sy = Math.sin(e.station) * e.stationR;
  const speed = e.def.speed * e.speedMul;
  let dx = sx - e.x, dy = sy - e.y;
  const d = Math.hypot(dx, dy);
  if (d > 4) { dx /= d; dy /= d; } else { dx = dy = 0; }
  const k = clamp(d / 60, 0, 1);
  e.tx = dx * speed * k;
  e.ty = dy * speed * k;
  e.phase += e.beat * dt;
}

const Bestiary = {
  quartz: {
    name: 'Quartz', hp: 1.0, speed: 56, tmul: 1.0, fear: 0.3, r: 20, size: 32, contact: 10, score: 10,
    kind: KIND.BIREF, tex: TEX.NONE, shape: 'quartz', ret: [200, 470], grad: 3.2, depth: 2, drop: 0.07,
    wobble: 0.15, wobbleF: 1.3, ai: aiChase,
  },
  calcite: {
    name: 'Calcite', hp: 1.25, speed: 74, tmul: 1.0, fear: 1.9, r: 18, size: 30, contact: 10, score: 20,
    kind: KIND.BIREF, tex: TEX.TWIN, shape: 'calcite', ret: [1750, 2500], grad: 7, depth: 2, drop: 0.09,
    wobble: 0.1, wobbleF: 2.0, ai: aiChase,
  },
  mica: {
    name: 'Muscovite', hp: 2.1, speed: 44, tmul: 1.08, fear: 0.4, r: 26, size: 38, contact: 14, score: 25,
    kind: KIND.BIREF, tex: TEX.CLEAVAGE, shape: 'mica', ret: [760, 1250], grad: 5, depth: 3, drop: 0.14,
    wobble: 0.08, wobbleF: 0.9, ai: aiChase, splits: 'flake',
  },
  flake: {
    name: 'Mica flake', hp: 0.55, speed: 86, tmul: 0.92, fear: 0.6, r: 14, size: 21, contact: 6, score: 6,
    kind: KIND.BIREF, tex: TEX.CLEAVAGE, shape: 'mica', ret: [820, 1200], grad: 6, depth: 1, drop: 0.04,
    wobble: 0.3, wobbleF: 2.4, ai: aiChase,
  },
  aragonite: {
    name: 'Aragonite', hp: 0.42, speed: 118, tmul: 0.86, fear: 0.5, r: 12, size: 25, contact: 6, score: 6,
    kind: KIND.BIREF, tex: TEX.NONE, shape: 'needle', ret: [1400, 2200], grad: 9, depth: 1, drop: 0.03,
    wobble: 0.25, wobbleF: 3.1, ai: aiFlock, alignSpin: true,
  },
  opal: {
    name: 'Opal', hp: 2.0, speed: 52, tmul: 1.15, fear: 0.8, r: 21, size: 29, contact: 8, score: 35,
    kind: KIND.OPAL, tex: TEX.NONE, shape: 'opal', ret: [0, 0], grad: 0, depth: 3, drop: 0.2,
    wobble: 0, wobbleF: 0, ai: aiOrbit, orbitR: 285, period: 4.4, ringSpeed: 220, ringMax: 560, ringDmg: 12,
  },
  zircon: {
    name: 'Zircon bell', hp: 3.4, speed: 30, tmul: 1.4, fear: 0.15, r: 22, size: 34, contact: 12, score: 50,
    kind: KIND.BIREF, tex: TEX.ZONED, shape: 'zircon', ret: [1300, 1900], grad: 4, depth: 3, drop: 0.25,
    wobble: 0, wobbleF: 0, ai: aiBell, bell: true,
  },
  garnet: {
    name: 'Garnet', hp: 3.0, speed: 52, tmul: 1, fear: 0, r: 21, size: 29, contact: 16, score: 40,
    kind: KIND.GARNET, tex: TEX.NONE, shape: 'garnet', ret: [0, 0], grad: 0, depth: 3, drop: 0.2,
    wobble: 0.12, wobbleF: 0.8, ai: aiChase, iso: true,
  },
  fluorite: {
    name: 'Fluorite', hp: 2.4, speed: 36, tmul: 1, fear: 0, r: 23, size: 31, contact: 12, score: 45,
    kind: KIND.FLUORITE, tex: TEX.NONE, shape: 'fluorite', ret: [0, 0], grad: 0, depth: 3, drop: 0.25,
    wobble: 0.1, wobbleF: 0.6, ai: aiChase, iso: true, dampR: 150, dampS: 0.86,
  },
};

function shapeFor(def, rnd) {
  switch (def.shape) {
    case 'garnet': return regularPoly(8, def.size, rnd() * TAU, 0.08, rnd);
    case 'opal': return regularPoly(12, def.size, rnd() * TAU, 0.18, rnd);
    case 'geode': return regularPoly(15, def.size, rnd() * TAU, 0.14, rnd);
    default: return makePoly(SHAPES[def.shape], def.size, 0.14, rnd);
  }
}
