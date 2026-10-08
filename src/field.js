'use strict';
/*
 * ISOGYRE — the wave field, evaluated on the CPU for gameplay.
 *
 * Every source j contributes a cylindrical wave  a_j · g(r) · e^{i(k r + φ_j)},
 * g(r) = (1 + (r/R0)²)^(-1/2): flat near the source, ~R0/r far away. The time-averaged intensity I = |Σ|² is what shatters
 * crystals: alone, a source never exceeds the threshold, so damage only exists
 * where two or more waves arrive in phase. This mirrors FIELD in src/shaders.js.
 */
const Field = {
  // player channel
  k: TAU / 66,
  R0: 150,
  over: 0,          // overtone (second harmonic) weight
  T: 1.15,          // damage threshold
  src: [],          // {x, y, a, p}
  damp: [],         // {x, y, r, s}
  // hazard channel (crystals that ring)
  kH: TAU / 90,
  R0H: 190,
  TH: 1.3,
  haz: [],          // {x, y, a, p}

  intensity(x, y) {
    let ur = 0, ui = 0, vr = 0, vi = 0;
    const k = this.k, R0 = this.R0, over = this.over;
    for (let i = 0, n = this.src.length; i < n; i++) {
      const s = this.src[i];
      const dx = x - s.x, dy = y - s.y;
      const r = Math.sqrt(dx * dx + dy * dy);
      const g = s.a / Math.sqrt(1 + (r * r) / (R0 * R0));
      const th = k * r + s.p;
      const c = Math.cos(th), sn = Math.sin(th);
      ur += g * c; ui += g * sn;
      if (over > 0) { vr += g * (c * c - sn * sn); vi += g * 2 * c * sn; }
    }
    let I = ur * ur + ui * ui + over * (vr * vr + vi * vi);
    if (this.damp.length) I *= this.dampAt(x, y);
    return I;
  },

  dampAt(x, y) {
    let d = 1;
    for (const q of this.damp) {
      const t = Math.hypot(x - q.x, y - q.y) / q.r;
      d *= 1 - q.s * (1 - smoothstep(0.55, 1.0, t));
    }
    return d;
  },

  hazard(x, y) {
    let ur = 0, ui = 0;
    const k = this.kH, R0 = this.R0H;
    for (let i = 0, n = this.haz.length; i < n; i++) {
      const s = this.haz[i];
      const dx = x - s.x, dy = y - s.y;
      const r = Math.sqrt(dx * dx + dy * dy);
      const g = s.a / Math.sqrt(1 + (r * r) / (R0 * R0));
      const th = k * r + s.p;
      ur += g * Math.cos(th); ui += g * Math.sin(th);
    }
    return ur * ur + ui * ui;
  },

  /** Central-difference gradient of intensity (out = [gx, gy]). */
  gradI(x, y, out, h = 3) {
    out[0] = (this.intensity(x + h, y) - this.intensity(x - h, y)) / (2 * h);
    out[1] = (this.intensity(x, y + h) - this.intensity(x, y - h)) / (2 * h);
    return out;
  },

  gradH(x, y, out, h = 3) {
    out[0] = (this.hazard(x + h, y) - this.hazard(x - h, y)) / (2 * h);
    out[1] = (this.hazard(x, y + h) - this.hazard(x, y - h)) / (2 * h);
    return out;
  },

  /** Phases that make every source arrive in phase at (tx, ty): a focused beam. */
  focusPhase(sx, sy, tx, ty, k) {
    return -k * Math.hypot(tx - sx, ty - sy);
  },
};
