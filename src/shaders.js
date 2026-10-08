'use strict';
/*
 * ISOGYRE — GLSL sources.
 *
 * The playfield shader evaluates the same complex wave sum as the gameplay code
 * (src/field.js) at every pixel, then colours it the way a petrographic microscope
 * would: retardation -> Michel-Lévy interference colour, under crossed polars.
 */
const Shaders = (() => {
  const MAX_SRC = 20, MAX_HAZ = 12, MAX_DAMP = 6, MAX_RING = 10, MAX_SHOCK = 8;

  const HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

  const FULLSCREEN_VS = `${HEADER}
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

  const HASH = `
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
vec3 hash32(vec2 p) {
  vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
  return fract(sin(q) * 43758.5453);
}
float hash12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float rnd(uint v) { return float(pcg(v)) * (1.0 / 4294967295.0); }
`;

  const ML = `
uniform sampler2D uLUT;
uniform float uMaxRet;
vec3 ml(float ret) { return texture(uLUT, vec2(clamp(ret / uMaxRet, 0.0, 1.0), 0.5)).rgb; }
`;

  // Shared by the playfield shader and the dust simulation. Must match src/field.js.
  const FIELD = `
#define MAX_SRC ${MAX_SRC}
#define MAX_HAZ ${MAX_HAZ}
#define MAX_DAMP ${MAX_DAMP}
#define MAX_RING ${MAX_RING}
uniform vec4 uSrc[MAX_SRC];    // x, y, amplitude, phase
uniform int uSrcN;
uniform vec4 uWave;            // k, R0, overtone weight, damage threshold
uniform vec4 uHaz[MAX_HAZ];
uniform int uHazN;
uniform vec4 uHazWave;         // k, R0, -, threshold
uniform vec4 uDamp[MAX_DAMP];  // x, y, radius, strength
uniform int uDampN;
uniform vec4 uRing[MAX_RING];  // x, y, radius, strength
uniform int uRingN;
uniform vec4 uShield;          // x, y, radius, active

vec4 fieldP(vec2 w) {
  vec2 U = vec2(0.0), U2 = vec2(0.0);
  for (int i = 0; i < MAX_SRC; i++) {
    if (i >= uSrcN) break;
    vec4 s = uSrc[i];
    float r = length(w - s.xy);
    float g = s.z * inversesqrt(1.0 + r * r / (uWave.y * uWave.y));
    float th = uWave.x * r + s.w;
    vec2 e = vec2(cos(th), sin(th));
    U += g * e;
    U2 += g * vec2(e.x * e.x - e.y * e.y, 2.0 * e.x * e.y);
  }
  return vec4(U, U2);
}
float dampAt(vec2 w) {
  float d = 1.0;
  for (int i = 0; i < MAX_DAMP; i++) {
    if (i >= uDampN) break;
    vec4 q = uDamp[i];
    float t = length(w - q.xy) / q.z;
    d *= 1.0 - q.w * (1.0 - smoothstep(0.55, 1.0, t));
  }
  return d;
}
vec2 fieldH(vec2 w) {
  vec2 U = vec2(0.0);
  for (int i = 0; i < MAX_HAZ; i++) {
    if (i >= uHazN) break;
    vec4 s = uHaz[i];
    float r = length(w - s.xy);
    float g = s.z * inversesqrt(1.0 + r * r / (uHazWave.y * uHazWave.y));
    float th = uHazWave.x * r + s.w;
    U += g * vec2(cos(th), sin(th));
  }
  return U;
}
float shieldNull(vec2 w) {
  float d = length(w - uShield.xy);
  return mix(1.0, smoothstep(uShield.z * 0.55, uShield.z, d), uShield.w);
}
`;

  /* ------------------------------------------------------------------ playfield */
  const FIELD_FS = `${HEADER}
in vec2 vUV;
out vec4 o;
uniform vec2 uCenter;     // target px, GL orientation
uniform float uScale;     // target px per world unit
uniform float uArenaR;
uniform float uTime;
uniform float uMotion;
uniform vec4 uGrain;      // seed, cell size, ret min, ret max
uniform vec4 uGrain2;     // brightness, twin probability, border width, -
uniform float uSweepRot;
uniform float uRetGain;
uniform vec3 uHazColor;
${ML}
${HASH}
${FIELD}

vec3 thinSection(vec2 w) {
  vec2 q = w / uGrain.y;
  vec2 iq = floor(q), fq = fract(q);
  float d1 = 8.0, d2 = 8.0;
  vec2 c1 = vec2(0.0);
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 off = hash22(iq + g + uGrain.x);
    vec2 r = g + off - fq;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; c1 = iq + g; }
    else if (d < d2) { d2 = d; }
  }
  float edge = sqrt(d2) - sqrt(d1);
  vec3 h = hash32(c1 + uGrain.x * 1.37);
  float ret = mix(uGrain.z, uGrain.w, h.x * h.x);
  float ext = h.y * 3.14159;
  if (h.z < uGrain2.y) {              // polysynthetic twinning
    vec2 dir = vec2(cos(ext * 1.7 + 0.4), sin(ext * 1.7 + 0.4));
    float st = dot(w, dir) / (uGrain.y * 0.28);
    ext += step(0.5, fract(st)) * 0.8;
  }
  // undulose extinction
  ext += 0.32 * sin(dot(w, vec2(0.011, 0.007)) * (0.5 + h.z) + h.x * 6.2831);
  float b = sin(2.0 * (ext - uSweepRot));
  b = pow(b * b, 1.6);
  ret *= 0.8 + 0.4 * smoothstep(0.0, 0.6, edge);   // grains thin toward their margins
  vec3 c = ml(ret) * (0.04 + 0.96 * b);
  float border = smoothstep(0.0, uGrain2.z, edge);
  return c * mix(0.1, 1.0, border) * uGrain2.x;
}

void main() {
  vec2 w = (gl_FragCoord.xy - uCenter) / uScale;
  w.y = -w.y;
  float rr = length(w);

  vec3 col = thinSection(w);

  // ---- player channel: stationary interference of all your sources
  vec4 F = fieldP(w);
  float damp = dampAt(w);
  float I = (dot(F.xy, F.xy) + uWave.z * dot(F.zw, F.zw)) * damp;
  float x = I / uWave.w;
  // below threshold: steep, so harmless regions stay in first-order greys and black;
  // above it: logarithmic, climbing through the orders as waves pile up
  float ret = x < 1.0 ? uRetGain * pow(x, 2.2) : uRetGain * (1.0 + 1.3 * log2(x));
  vec3 fc = ml(ret);
  float lit = smoothstep(0.9, 1.02, x);
  fc *= mix(0.055, 1.0, lit);
  // travelling wavefronts — the instantaneous field, for life
  float ph = atan(F.y, F.x);
  fc *= 1.0 + 0.12 * uMotion * cos(ph - uTime * 2.3) * smoothstep(0.05, 0.7, x);
  // quiet zones of fluorite read as a cool, still shadow
  col *= mix(0.55, 1.0, damp);
  col += fc;

  // ---- hazard channel: the crystals' own interference, in monochrome laser red
  vec2 UH = fieldH(w);
  float nul = shieldNull(w);
  float hx = dot(UH, UH) / uHazWave.w * nul;
  float hph = atan(UH.y, UH.x);
  float flow = 0.55 + 0.45 * cos(hph - uTime * 4.5 * max(uMotion, 0.25));
  // a faint warning below the burn threshold; above it a bright contour and a streaming interior
  float edge = smoothstep(0.95, 1.04, hx) * (1.0 - 0.55 * smoothstep(1.12, 1.6, hx));
  float body = smoothstep(1.1, 1.6, hx) * (0.35 + 0.65 * flow * flow);
  float hb = 0.09 * smoothstep(0.35, 0.95, hx) + 1.25 * edge + 0.75 * body;
  vec3 hc = uHazColor * hb + vec3(1.0, 0.72, 0.6) * smoothstep(2.2, 4.0, hx) * 0.45;
  col = col * (1.0 - clamp(hx * 0.3, 0.0, 0.55)) + hc;

  // ---- ripples (opal pulses)
  float ring = 0.0;
  vec3 disp = vec3(0.0);
  for (int i = 0; i < MAX_RING; i++) {
    if (i >= uRingN) break;
    vec4 R = uRing[i];
    float dd = length(w - R.xy) - R.z;
    ring += exp(-dd * dd / 50.0) * R.w;
    disp += ml(420.0 - dd * 18.0) * exp(-dd * dd / 900.0) * R.w * 0.22;
  }
  ring *= nul;
  col += (uHazColor * ring * 1.7 + vec3(1.0, 0.85, 0.75) * pow(ring, 3.0) * 0.5) + disp * nul;

  // ---- the null (destructive interference around you)
  if (uShield.w > 0.001) {
    float sd = length(w - uShield.xy);
    float inner = smoothstep(uShield.z * 0.45, uShield.z, sd);
    col *= mix(1.0, 0.2 + 0.8 * inner, uShield.w);
    col += vec3(0.75, 0.82, 0.95) * exp(-pow((sd - uShield.z) / 2.2, 2.0)) * uShield.w * 0.7;
  }

  float inside = smoothstep(uArenaR + 3.0, uArenaR - 3.0, rr);
  o = vec4(col * inside, 1.0);
}`;

  /* ------------------------------------------------------------------ dust (Chladni) */
  const DUST_INIT_FS = `${HEADER}
out vec4 o;
uniform float uArenaR;
uniform float uSeed;
${HASH}
void main() {
  uint id = uint(gl_FragCoord.y) * 4096u + uint(gl_FragCoord.x);
  uint s = uint(uSeed);
  float a = rnd(id * 3u + s) * 6.2831853;
  float r = sqrt(rnd(id * 5u + 7u + s)) * uArenaR * 0.99;
  o = vec4(cos(a) * r, sin(a) * r, 0.0, 0.0);
}`;

  const DUST_UPDATE_FS = `${HEADER}
out vec4 o;
uniform sampler2D uState;
uniform float uDt;
uniform float uArenaR;
uniform int uFrame;
uniform vec4 uDust;   // kick, drift, damping, respawn probability
${HASH}
${FIELD}
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 st = texelFetch(uState, ij, 0);
  vec2 p = st.xy, v = st.zw;
  uint id = uint(ij.y) * 4096u + uint(ij.x);
  uint fr = uint(uFrame);

  vec2 U = vec2(0.0), Ux = vec2(0.0), Uy = vec2(0.0);
  for (int i = 0; i < MAX_SRC; i++) {
    if (i >= uSrcN) break;
    vec4 s = uSrc[i];
    vec2 dv = p - s.xy;
    float r = max(length(dv), 1e-3);
    vec2 rh = dv / r;
    float q = 1.0 + r * r / (uWave.y * uWave.y);
    float g = s.z * inversesqrt(q);
    float dg = -g * r / (uWave.y * uWave.y * q);
    float th = uWave.x * r + s.w;
    vec2 e = vec2(cos(th), sin(th));
    U += g * e;
    vec2 dr = vec2(dg * e.x - g * uWave.x * e.y, dg * e.y + g * uWave.x * e.x);
    Ux += dr * rh.x;
    Uy += dr * rh.y;
    if (r < 42.0 && s.z > 0.2) v += rh * (42.0 - r) * 14.0 * uDt; // wake around sources
  }
  float damp = dampAt(p);
  float I = dot(U, U) * damp;
  vec2 gI = 2.0 * vec2(dot(U, Ux), dot(U, Uy)) * damp;
  vec2 UH = fieldH(p);
  float H = dot(UH, UH) * shieldNull(p) * 0.8;

  // Chladni: sand is thrown about where the medium vibrates and comes to rest on the nodes.
  vec2 kick = vec2(rnd(id * 2u + fr * 7919u), rnd(id * 2u + 1u + fr * 7919u)) * 2.0 - 1.0;
  v += kick * uDust.x * min(I + H, 3.5);
  v -= gI / (I + 0.4) * uDust.y * uDt;

  for (int i = 0; i < MAX_RING; i++) {
    if (i >= uRingN) break;
    vec4 R = uRing[i];
    vec2 dv = p - R.xy;
    float L = max(length(dv), 1.0);
    float dd = L - R.z;
    if (abs(dd) < 16.0) v += dv / L * 1600.0 * R.w * uDt;
  }

  v *= exp(-uDust.z * uDt);
  p += v * uDt;

  float rs = rnd(id * 7u + fr * 104729u);
  if (dot(p, p) > uArenaR * uArenaR || rs < uDust.w) {
    float a = rnd(id * 13u + fr * 31u) * 6.2831853;
    float rad = sqrt(rnd(id * 17u + fr * 3u + 11u)) * uArenaR * 0.99;
    p = vec2(cos(a), sin(a)) * rad;
    v = vec2(0.0);
  }
  o = vec4(p, v);
}`;

  const DUST_VS = `${HEADER}
uniform sampler2D uState;
uniform int uStateW;
uniform vec4 uW2C;
uniform float uPointSize;
${FIELD}
out float vB;
void main() {
  int id = gl_VertexID;
  vec4 st = texelFetch(uState, ivec2(id % uStateW, id / uStateW), 0);
  vec2 p = st.xy;
  // Sand reads brightest where it marks a node inside an active region:
  // the envelope E = Σ|a g| is large but the interference has cancelled to ~0.
  vec2 U = vec2(0.0);
  float E = 0.0;
  for (int i = 0; i < MAX_SRC; i++) {
    if (i >= uSrcN) break;
    vec4 s = uSrc[i];
    float r = length(p - s.xy);
    float g = s.z * inversesqrt(1.0 + r * r / (uWave.y * uWave.y));
    float th = uWave.x * r + s.w;
    U += g * vec2(cos(th), sin(th));
    E += abs(g);
  }
  float E2 = max(E * E, 1e-3);
  float node = clamp(1.0 - dot(U, U) / E2, 0.0, 1.0);
  float actv = smoothstep(0.7, 1.5, E);
  float spd = length(st.zw);
  vB = mix(0.035, 1.3, pow(node, 6.0) * actv) * mix(1.0, 0.25, smoothstep(4.0, 50.0, spd));
  gl_Position = vec4(uW2C.x * p.x + uW2C.y, uW2C.z * p.y + uW2C.w, 0.0, 1.0);
  gl_PointSize = uPointSize;
}`;

  const DUST_FS = `${HEADER}
in float vB;
out vec4 o;
uniform vec3 uDustColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = max(0.0, 1.0 - dot(c, c));
  o = vec4(uDustColor * vB * a, 0.0);
}`;

  /* ------------------------------------------------------------------ crystals & shards */
  const POLY_VS = `${HEADER}
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aLocal;
layout(location = 2) in vec4 aRet;   // base retardation, gradient x/y, stress
layout(location = 3) in vec4 aMisc;  // extinction brightness, flash, alpha, texture id
layout(location = 4) in vec2 aEK;    // radial edge coordinate, kind
uniform vec4 uW2C;
out vec2 vLocal;
out vec4 vRet;
out vec4 vMisc;
out float vEdge;
flat out int vKind;
void main() {
  vLocal = aLocal;
  vRet = aRet;
  vMisc = aMisc;
  vEdge = aEK.x;
  vKind = int(aEK.y + 0.5);
  gl_Position = vec4(uW2C.x * aPos.x + uW2C.y, uW2C.z * aPos.y + uW2C.w, 0.0, 1.0);
}`;

  const POLY_FS = `${HEADER}
in vec2 vLocal;
in vec4 vRet;
in vec4 vMisc;
in float vEdge;
flat in int vKind;
out vec4 o;
uniform float uTime;
${ML}
void main() {
  float aa = max(fwidth(vEdge), 1e-4);
  float cover = 1.0 - smoothstep(1.0 - aa * 1.6, 1.0, vEdge);
  float rim = smoothstep(0.74, 0.98, vEdge);
  float ext = vMisc.x, flash = vMisc.y, alpha = vMisc.z, tex = vMisc.w;
  vec3 col;
  if (vKind == 0) {                      // birefringent crystal
    float ret = vRet.x + dot(vLocal, vRet.yz);
    if (tex > 0.5 && tex < 1.5) ret += 55.0 * sin(vLocal.y * 0.85);        // cleavage traces
    else if (tex > 1.5 && tex < 2.5) ret += 80.0 * sin(vEdge * 24.0);       // oscillatory zoning
    else if (tex > 2.5 && vLocal.y > 0.0) ext = 1.0 - ext;                  // simple twin
    ret += vRet.w * (1.0 - vEdge * 0.65) * 1200.0;                          // photoelastic stress
    col = ml(ret) * (0.3 + 0.95 * ext);
    col += rim * vec3(0.82, 0.86, 0.95) * 0.65;
    col += vRet.w * vRet.w * vec3(1.0, 0.95, 0.9) * 0.45 * (0.5 + 0.5 * sin(uTime * 45.0 + vLocal.x * 0.4));
  } else if (vKind == 1) {               // isotropic garnet: black under crossed polars, high relief
    col = vec3(0.012, 0.007, 0.01) + ml(120.0 + vEdge * 140.0) * 0.06;
    col += rim * vec3(0.95, 0.3, 0.38) * 0.9;
    col += smoothstep(0.93, 1.0, vEdge) * vec3(1.0, 0.82, 0.82) * 0.45;
    col += vRet.w * vec3(1.0, 0.5, 0.5) * 0.5;
  } else if (vKind == 2) {               // fluorite: dark, fluorescing violet
    float glow = 0.5 + 0.5 * sin(uTime * 2.2 + vLocal.x * 0.06 + vLocal.y * 0.04);
    col = vec3(0.03, 0.01, 0.07) + vec3(0.36, 0.12, 0.95) * (0.22 + 0.4 * glow) * (1.0 - vEdge * 0.5);
    col += rim * vec3(0.72, 0.48, 1.0) * 0.95;
    col += vRet.w * vec3(0.8, 0.6, 1.0) * 0.5;
  } else {                                // opal: play of colour
    vec2 q = vLocal * 0.12;
    float n = sin(q.x * 3.1 + uTime * 0.8) * sin(q.y * 2.7 - uTime * 0.55) + sin((q.x + q.y) * 1.9 + uTime * 1.1);
    float pc = fract(n * 0.8 + vEdge * 0.6);
    col = ml(380.0 + pc * 1300.0) * (0.25 + 0.95 * smoothstep(0.1, 0.9, abs(sin(n * 3.0))));
    col += vec3(0.06, 0.06, 0.08);
    col += rim * vec3(0.9, 0.86, 1.0) * 0.45;
    col += vRet.w * vec3(1.0) * 0.4;
  }
  col += flash * vec3(1.3, 1.2, 1.1);
  float a = cover * alpha;
  o = vec4(col * a, a);
}`;

  /* ------------------------------------------------------------------ conoscopic figures */
  const FIG_VS = `${HEADER}
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aInst;   // x, y, radius, rotation
layout(location = 2) in vec4 aParam;  // melatope separation, retardation scale, alpha, hurt flash
layout(location = 3) in vec4 aTint;   // rim colour, halo strength
uniform vec4 uW2C;
out vec2 vQ;
out vec4 vParam;
out vec4 vTint;
out float vRot;
void main() {
  vQ = aCorner * 1.45;
  vParam = aParam;
  vTint = aTint;
  vRot = aInst.w;
  vec2 p = aInst.xy + vQ * aInst.z;
  gl_Position = vec4(uW2C.x * p.x + uW2C.y, uW2C.z * p.y + uW2C.w, 0.0, 1.0);
}`;

  const FIG_FS = `${HEADER}
in vec2 vQ;
in vec4 vParam;
in vec4 vTint;
in float vRot;
out vec4 o;
${ML}
void main() {
  float r = length(vQ);
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * vQ.x + s * vQ.y, -s * vQ.x + c * vQ.y);
  float sep = vParam.x;
  vec2 d1 = q - vec2(-sep, 0.0), d2 = q - vec2(sep, 0.0);
  // isochromes: rings (uniaxial) or Cassini ovals (biaxial)
  float ret = vParam.y * length(d1) * length(d2);
  // isogyres: the dark brushes where vibration directions line up with the polarisers
  float psi = atan(d1.y, d1.x) + atan(d2.y, d2.x);
  float brush = sin(psi);
  brush = mix(brush * brush, 1.0, 0.05);
  vec3 col = ml(ret) * brush * 1.9;
  col += vec3(1.0) * (exp(-dot(d1, d1) * 260.0) + exp(-dot(d2, d2) * 260.0)) * 0.55;
  float aa = max(fwidth(r), 1e-4);
  float disk = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  float rim = exp(-pow((r - 1.0) / 0.045, 2.0));
  float halo = exp(-pow(max(r - 1.0, 0.0) / 0.16, 2.0)) * (1.0 - disk) * vTint.w;
  col = col * disk + vTint.rgb * (rim * 0.9 + halo * 0.4);
  col += vParam.w * vec3(1.0, 0.25, 0.2) * disk;
  float a = clamp(disk + rim * 0.8 + halo * 0.4, 0.0, 1.0) * vParam.z;
  o = vec4(col * vParam.z, a);
}`;

  /* ------------------------------------------------------------------ sparks */
  const SPARK_VS = `${HEADER}
layout(location = 0) in vec3 aPS;    // x, y, size (world)
layout(location = 1) in vec4 aCol;   // linear rgb, intensity
uniform vec4 uW2C;
uniform float uPx;                   // target px per world unit
out vec4 vCol;
void main() {
  vCol = aCol;
  gl_Position = vec4(uW2C.x * aPS.x + uW2C.y, uW2C.z * aPS.y + uW2C.w, 0.0, 1.0);
  gl_PointSize = max(1.5, aPS.z * uPx);
}`;

  const SPARK_FS = `${HEADER}
in vec4 vCol;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  float a = exp(-d * 4.0) + exp(-d * 18.0) * 0.8;
  o = vec4(vCol.rgb * vCol.a * a, 0.0);
}`;

  /* ------------------------------------------------------------------ bloom */
  const BLOOM_PRE_FS = `${HEADER}
in vec2 vUV;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
void main() {
  vec3 c = texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uTex, vUV + uTexel * vec2(1.0, -1.0)).rgb
         + texture(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb
         + texture(uTex, vUV + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float k = max(soft, br - uThreshold) / max(br, 1e-4);
  o = vec4(min(c * k, vec3(24.0)), 1.0);
}`;

  const BLOOM_DOWN_FS = `${HEADER}
in vec2 vUV;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec3 s = texture(uTex, vUV).rgb * 4.0;
  s += texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2(1.0, -1.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2(1.0, 1.0)).rgb;
  o = vec4(s / 8.0, 1.0);
}`;

  const BLOOM_UP_FS = `${HEADER}
in vec2 vUV;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uGain;
void main() {
  vec3 s = texture(uTex, vUV + uTexel * vec2(-2.0, 0.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2(2.0, 0.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2(0.0, -2.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2(0.0, 2.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
  s += texture(uTex, vUV + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
  s += texture(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;
  s += texture(uTex, vUV + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
  o = vec4(s / 12.0 * uGain, 1.0);
}`;

  /* ------------------------------------------------------------------ final composite */
  const COMPOSITE_FS = `${HEADER}
#define MAX_SHOCK ${MAX_SHOCK}
in vec2 vUV;
out vec4 o;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uRes;            // output px
uniform vec2 uFovC;           // field-of-view centre, output px, GL orientation
uniform float uFovR;          // field-of-view radius, output px
uniform vec4 uShock[MAX_SHOCK]; // x, y (px, GL), radius px, strength
uniform int uShockN;
uniform float uBloomStr;
uniform float uExposure;
uniform float uTime;
uniform float uHurt;
uniform float uLowHp;
uniform float uGrainAmt;
uniform float uFade;
uniform float uAberr;
${HASH}
void main() {
  vec2 px = vUV * uRes;
  vec2 off = vec2(0.0);
  for (int i = 0; i < MAX_SHOCK; i++) {
    if (i >= uShockN) break;
    vec4 S = uShock[i];
    vec2 d = px - S.xy;
    float L = max(length(d), 1.0);
    float t = (L - S.z) / max(6.0, S.z * 0.12);
    off += d / L * exp(-t * t) * S.w;
  }
  vec2 uv = (px - off) / uRes;
  vec2 fromC = px - uFovC;
  float rn = length(fromC) / uFovR;
  vec2 dir = fromC / max(length(fromC), 1.0);
  float ca = (smoothstep(0.5, 1.0, rn) * 2.4 + length(off) * 0.15) * uAberr;
  vec3 col;
  col.r = texture(uScene, uv + dir * ca / uRes).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - dir * ca / uRes).b;
  vec3 bloom = texture(uBloom, uv).rgb;

  float fs = 1.0 - smoothstep(1.0 - 1.2 / uFovR, 1.0 + 1.2 / uFovR, rn);
  col *= mix(0.72, 1.0, 1.0 - smoothstep(0.62, 1.0, rn));
  vec3 outside = vec3(0.0035, 0.0033, 0.004) + vec3(0.012, 0.013, 0.018) * exp(-pow((rn - 1.0) * 9.0, 2.0));
  col = mix(outside, col, fs);
  col += vec3(0.32, 0.36, 0.44) * exp(-pow((rn - 1.0) * uFovR / 1.8, 2.0)) * 0.22;
  col += bloom * uBloomStr * (0.22 + 0.78 * fs);
  col += vec3(0.95, 0.06, 0.05) * uHurt * smoothstep(0.35, 1.05, rn) * 0.75;

  col = vec3(1.0) - exp(-col * uExposure);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l) * vec3(1.0, 0.92, 0.9), uLowHp * 0.55);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (hash12(px + fract(uTime * 7.13) * 311.0) - 0.5) * uGrainAmt * (0.35 + 0.65 * fs);
  o = vec4(col * uFade, 1.0);
}`;

  return {
    MAX_SRC, MAX_HAZ, MAX_DAMP, MAX_RING, MAX_SHOCK,
    FULLSCREEN_VS, FIELD_FS, DUST_INIT_FS, DUST_UPDATE_FS, DUST_VS, DUST_FS,
    POLY_VS, POLY_FS, FIG_VS, FIG_FS, SPARK_VS, SPARK_FS,
    BLOOM_PRE_FS, BLOOM_DOWN_FS, BLOOM_UP_FS, COMPOSITE_FS,
  };
})();
