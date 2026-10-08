'use strict';
/* ISOGYRE — shared math, randomness, polygon geometry and storage helpers. */

const TAU = Math.PI * 2;
const RAD2DEG = 180 / Math.PI;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. */
const approach = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gameplay RNG (seedable for tests). Visual-only randomness uses Math.random. */
const Rng = {
  f: mulberry32((Date.now() ^ 0x5eed) >>> 0),
  seed(s) { this.f = mulberry32(s >>> 0); },
  next() { return this.f(); },
  range(a, b) { return a + (b - a) * this.f(); },
  int(a, b) { return Math.floor(a + (b - a + 1) * this.f()); },
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; },
  sign() { return this.f() < 0.5 ? -1 : 1; },
  chance(p) { return this.f() < p; },
};


/* ---------- Polygons (convex, CCW or CW — we only need consistent winding) ---------- */

function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}

function polyCentroid(pts) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p[0]; sy += p[1]; }
    return [sx / pts.length, sy / pts.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Split a convex polygon by the line through (px,py) with direction (dx,dy). */
function splitPolygon(pts, px, py, dx, dy) {
  const left = [], right = [];
  const side = (p) => (p[0] - px) * dy - (p[1] - py) * dx;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const sa = side(a), sb = side(b);
    if (sa <= 0) left.push(a);
    if (sa >= 0) right.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      left.push(m);
      right.push(m);
    }
  }
  return [left, right];
}

/** Recursively fracture a convex polygon into shards. */
function fracture(pts, depth, minArea, rnd = Math.random) {
  if (depth <= 0 || Math.abs(polyArea(pts)) < minArea) return [pts];
  const c = polyCentroid(pts);
  const ang = rnd() * Math.PI;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const j = (rnd() - 0.5) * 0.5;
  // jitter the cut point a little so the shards are uneven
  let ex = 0, ey = 0;
  for (const p of pts) { ex = Math.max(ex, Math.abs(p[0] - c[0])); ey = Math.max(ey, Math.abs(p[1] - c[1])); }
  const px = c[0] - dy * j * ex, py = c[1] + dx * j * ey;
  const [l, r] = splitPolygon(pts, px, py, dx, dy);
  const out = [];
  if (l.length >= 3) out.push(...fracture(l, depth - 1, minArea, rnd));
  if (r.length >= 3) out.push(...fracture(r, depth - 1, minArea, rnd));
  return out.length ? out : [pts];
}

function makePoly(def, scale, jitter, rnd = Math.random) {
  return def.map(([x, y]) => [
    x * scale * (1 + (rnd() - 0.5) * jitter),
    y * scale * (1 + (rnd() - 0.5) * jitter),
  ]);
}

function regularPoly(n, r, phase = 0, jitter = 0, rnd = Math.random) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    const rr = r * (1 + (rnd() - 0.5) * jitter);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}

/** Distance from point P to segment AB, squared. */
function segDist2(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  const qx = ax + abx * t - px, qy = ay + aby * t - py;
  return qx * qx + qy * qy;
}

/* ---------- Storage (may throw in sandboxed / private contexts) ---------- */
const Store = {
  get(key, fallback) {
    try {
      const v = window.localStorage.getItem('isogyre.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try { window.localStorage.setItem('isogyre.' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  },
};

const QueryFlags = (() => {
  const out = {};
  try {
    const q = new URLSearchParams(window.location.search);
    for (const [k, v] of q.entries()) out[k] = v === '' ? true : v;
  } catch (e) { /* ignore */ }
  return out;
})();
