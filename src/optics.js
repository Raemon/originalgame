'use strict';
/*
 * ISOGYRE — physical colour model.
 *
 * Between crossed polarisers a birefringent plate of retardation Γ (nm) transmits
 * T(λ) = sin²(πΓ/λ) of each wavelength. Integrating that spectrum against the CIE 1931
 * colour-matching functions gives the Michel-Lévy interference colour chart used by
 * petrographers. Everything in the game — the wave field, crystals, avatars — is
 * coloured by looking up this chart.
 */
const Optics = (() => {
  const LUT_SIZE = 1024;
  const MAX_RET = 3200; // nm, ~5.5 orders

  // Wyman, Sloan & Shirley (2013) multi-lobe fit of the CIE 1931 2° observer.
  function lobe(x, mu, s1, s2) {
    const t = (x - mu) / (x < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  }
  function cmf(l) {
    return [
      1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
      0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
      1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
    ];
  }
  function xyzToLinearSRGB(X, Y, Z) {
    return [
      3.2406 * X - 1.5372 * Y - 0.4986 * Z,
      -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
      0.0557 * X - 0.204 * Y + 1.057 * Z,
    ];
  }

  let table = null; // Float32Array RGBA, linear sRGB

  function build() {
    const samples = [];
    for (let l = 380; l <= 780; l += 2.5) samples.push([l, cmf(l)]);
    let W = [0, 0, 0];
    for (const [, c] of samples) { W[0] += c[0]; W[1] += c[1]; W[2] += c[2]; }
    const white = xyzToLinearSRGB(W[0], W[1], W[2]);
    const out = new Float32Array(LUT_SIZE * 4);
    for (let i = 0; i < LUT_SIZE; i++) {
      const ret = (i / (LUT_SIZE - 1)) * MAX_RET;
      let X = 0, Y = 0, Z = 0;
      for (const [l, c] of samples) {
        const s = Math.sin((Math.PI * ret) / l);
        const t = s * s;
        X += t * c[0]; Y += t * c[1]; Z += t * c[2];
      }
      let [r, g, b] = xyzToLinearSRGB(X, Y, Z);
      r /= white[0]; g /= white[1]; b /= white[2];
      // Photomicrographs are more saturated than the raw integral; boost around luminance.
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const S = 1.45;
      r = lum + (r - lum) * S; g = lum + (g - lum) * S; b = lum + (b - lum) * S;
      // Soft gamut map: pull negative channels back toward luminance.
      const mn = Math.min(r, g, b);
      if (mn < 0) {
        const k = lum / Math.max(1e-5, lum - mn);
        r = lum + (r - lum) * k; g = lum + (g - lum) * k; b = lum + (b - lum) * k;
      }
      out[i * 4 + 0] = Math.max(0, r);
      out[i * 4 + 1] = Math.max(0, g);
      out[i * 4 + 2] = Math.max(0, b);
      out[i * 4 + 3] = 1;
    }
    table = out;
    return out;
  }

  /** Linear RGB for a retardation in nm. */
  function linear(ret) {
    if (!table) build();
    const x = clamp(ret / MAX_RET, 0, 1) * (LUT_SIZE - 1);
    const i = Math.floor(x), f = x - i, j = Math.min(LUT_SIZE - 1, i + 1);
    return [
      lerp(table[i * 4], table[j * 4], f),
      lerp(table[i * 4 + 1], table[j * 4 + 1], f),
      lerp(table[i * 4 + 2], table[j * 4 + 2], f),
    ];
  }

  const toSRGB = (c) => {
    c = clamp(c, 0, 1);
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };

  /** CSS colour string for a retardation, optionally scaled in brightness. */
  function css(ret, gain = 1, alpha = 1) {
    const [r, g, b] = linear(ret);
    const R = Math.round(toSRGB(r * gain) * 255);
    const G = Math.round(toSRGB(g * gain) * 255);
    const B = Math.round(toSRGB(b * gain) * 255);
    return alpha >= 1 ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${alpha})`;
  }

  return { LUT_SIZE, MAX_RET, build, linear, css, get table() { return table || build(); } };
})();
