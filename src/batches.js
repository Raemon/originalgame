'use strict';
/* ISOGYRE — CPU-side vertex batches handed to the renderer every frame. */

class PolyBatch {
  constructor(cap = 4096) {
    this.data = new Float32Array(cap * 14);
    this.count = 0; // vertices
  }
  reset() { this.count = 0; }
  ensure(extra) {
    const need = (this.count + extra) * 14;
    if (need <= this.data.length) return;
    let n = this.data.length;
    while (n < need) n *= 2;
    const d = new Float32Array(n);
    d.set(this.data.subarray(0, this.count * 14));
    this.data = d;
  }
  /**
   * pts: convex polygon in "colour space" (crystal-local coordinates).
   * (c0x, c0y): pivot in colour space; placed at world (px, py) rotated by ang, scaled by sc.
   * o: { ret, gx, gy, stress, ext, flash, alpha, tex, kind }
   */
  add(pts, c0x, c0y, px, py, ang, sc, o) {
    const n = pts.length;
    if (n < 3) return;
    this.ensure(n * 3);
    const cs = Math.cos(ang) * sc, sn = Math.sin(ang) * sc;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= n; my /= n;
    const d = this.data;
    let i = this.count * 14;
    const put = (lx, ly, edge) => {
      const rx = lx - c0x, ry = ly - c0y;
      d[i++] = px + rx * cs - ry * sn;
      d[i++] = py + rx * sn + ry * cs;
      d[i++] = lx; d[i++] = ly;
      d[i++] = o.ret; d[i++] = o.gx; d[i++] = o.gy; d[i++] = o.stress;
      d[i++] = o.ext; d[i++] = o.flash; d[i++] = o.alpha; d[i++] = o.tex;
      d[i++] = edge; d[i++] = o.kind;
    };
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      put(mx, my, 0);
      put(a[0], a[1], 1);
      put(b[0], b[1], 1);
    }
    this.count += n * 3;
  }
}

class FigureBatch {
  constructor(cap = 64) {
    this.data = new Float32Array(cap * 12);
    this.count = 0;
  }
  reset() { this.count = 0; }
  /** x, y, radius, rotation, melatope separation (0 = uniaxial), retardation scale, alpha, hurt, tint[r,g,b], halo */
  add(x, y, r, rot, sep, retScale, alpha, hurt, tr, tg, tb, halo) {
    if ((this.count + 1) * 12 > this.data.length) {
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    const d = this.data;
    let i = this.count * 12;
    d[i++] = x; d[i++] = y; d[i++] = r; d[i++] = rot;
    d[i++] = sep; d[i++] = retScale; d[i++] = alpha; d[i++] = hurt;
    d[i++] = tr; d[i++] = tg; d[i++] = tb; d[i++] = halo;
    this.count++;
  }
}

class SparkBatch {
  constructor(cap = 2048) {
    this.data = new Float32Array(cap * 7);
    this.count = 0;
  }
  reset() { this.count = 0; }
  add(x, y, size, r, g, b, a) {
    if ((this.count + 1) * 7 > this.data.length) {
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    const d = this.data;
    let i = this.count * 7;
    d[i++] = x; d[i++] = y; d[i++] = size;
    d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = a;
    this.count++;
  }
}
