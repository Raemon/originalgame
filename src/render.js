'use strict';
/*
 * ISOGYRE — renderer.
 *
 * Pass order each frame:
 *   1. dust simulation step (GPU ping-pong)       — Chladni sand settling on nodal lines
 *   2. playfield                                  — thin section + interference field + hazards
 *   3. dust points, crystals/shards, figures, sparks
 *   4. bloom (dual-filter)                         5. composite through the eyepiece
 */
class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.canvas = canvas;
    this.floatRT = !!gl.getExtension('EXT_color_buffer_float');
    this.halfRT = this.floatRT || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');

    const S = Shaders;
    const P = (vs, fs, label) => GLK.program(gl, vs, fs, label);
    this.p = {
      field: P(S.FULLSCREEN_VS, S.FIELD_FS, 'field'),
      poly: P(S.POLY_VS, S.POLY_FS, 'poly'),
      fig: P(S.FIG_VS, S.FIG_FS, 'figure'),
      spark: P(S.SPARK_VS, S.SPARK_FS, 'spark'),
      bloomPre: P(S.FULLSCREEN_VS, S.BLOOM_PRE_FS, 'bloomPre'),
      bloomDown: P(S.FULLSCREEN_VS, S.BLOOM_DOWN_FS, 'bloomDown'),
      bloomUp: P(S.FULLSCREEN_VS, S.BLOOM_UP_FS, 'bloomUp'),
      composite: P(S.FULLSCREEN_VS, S.COMPOSITE_FS, 'composite'),
    };
    if (this.floatRT) {
      this.p.dustInit = P(S.FULLSCREEN_VS, S.DUST_INIT_FS, 'dustInit');
      this.p.dustUpdate = P(S.FULLSCREEN_VS, S.DUST_UPDATE_FS, 'dustUpdate');
      this.p.dust = P(S.DUST_VS, S.DUST_FS, 'dust');
    }

    // Michel-Lévy lookup texture
    this.lut = GLK.texture(gl, Optics.LUT_SIZE, 1, {
      internal: gl.RGBA16F, format: gl.RGBA, type: gl.FLOAT, data: Optics.table,
    });

    this.emptyVAO = gl.createVertexArray();

    // crystals & shards: interleaved dynamic vertex buffer (14 floats per vertex)
    this.polyVAO = gl.createVertexArray();
    this.polyBuf = gl.createBuffer();
    gl.bindVertexArray(this.polyVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.polyBuf);
    const PS = 14 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, PS, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, PS, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, PS, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, PS, 32);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, PS, 48);

    // conoscopic figures: static quad + per-instance attributes (12 floats)
    this.figVAO = gl.createVertexArray();
    this.figCorner = gl.createBuffer();
    this.figBuf = gl.createBuffer();
    gl.bindVertexArray(this.figVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.figCorner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.figBuf);
    const FS = 12 * 4;
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FS, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FS, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, FS, 32); gl.vertexAttribDivisor(3, 1);

    // sparks: 7 floats per point
    this.sparkVAO = gl.createVertexArray();
    this.sparkBuf = gl.createBuffer();
    gl.bindVertexArray(this.sparkVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);

    this.w = 0; this.h = 0;
    this.rt = null;
    this.dust = null;
    this.dustFrame = 0;
    this.dustSize = 0;
  }

  /** (Re)create dust state textures; side² particles. */
  setDustSize(side) {
    const gl = this.gl;
    if (!this.floatRT) return;
    if (this.dust && this.dustSize === side) return;
    if (this.dust) { GLK.destroy(gl, this.dust[0]); GLK.destroy(gl, this.dust[1]); }
    const opts = { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST };
    const a = GLK.target(gl, side, side, opts), b = GLK.target(gl, side, side, opts);
    if (!a || !b) { this.dust = null; return; }
    this.dust = [a, b];
    this.dustSize = side;
    this.dustNeedsInit = true;
  }

  resize(w, h) {
    const gl = this.gl;
    if (w === this.w && h === this.h && this.rt) return;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    if (this.rt) {
      GLK.destroy(gl, this.rt.scene);
      for (const t of this.rt.bloom) GLK.destroy(gl, t);
    }
    const hdr = this.halfRT
      ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
      : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    let scene = GLK.target(gl, w, h, hdr);
    if (!scene) { this.halfRT = false; scene = GLK.target(gl, w, h, {}); }
    const fmt = this.halfRT ? hdr : {};
    const bloom = [];
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < 6 && bw >= 4 && bh >= 4; i++) {
      bloom.push(GLK.target(gl, bw, bh, fmt));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
    this.rt = { scene, bloom };
  }

  fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  fieldUniforms(s) {
    return {
      uSrc: s.src, uSrcN: s.srcN, uWave: s.wave,
      uHaz: s.haz, uHazN: s.hazN, uHazWave: s.hazWave,
      uDamp: s.damp, uDampN: s.dampN,
      uRing: s.ring, uRingN: s.ringN,
      uShield: s.shield,
    };
  }

  /** Render one frame. `s` is a plain description of the scene built by the game. */
  frame(s) {
    const gl = this.gl;
    const { w, h } = this;
    const v = s.view; // cx, cy (px, y-down), scale (px per world unit)
    const W2C = [2 * v.scale / w, 2 * v.cx / w - 1, -2 * v.scale / h, 1 - 2 * v.cy / h];
    const fieldU = this.fieldUniforms(s);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // 1 ─ dust simulation
    const dustOn = this.dust && s.dust.enabled;
    if (dustOn) {
      const side = this.dustSize;
      gl.viewport(0, 0, side, side);
      gl.disable(gl.BLEND);
      if (this.dustNeedsInit) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.dust[0].fb);
        GLK.use(this.p.dustInit, { uArenaR: s.arenaR, uSeed: Math.floor(Math.random() * 1e6) });
        this.fullscreen();
        this.dustNeedsInit = false;
      }
      const steps = s.dust.steps || 1;
      for (let i = 0; i < steps; i++) {
        const src = this.dust[0], dst = this.dust[1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        GLK.use(this.p.dustUpdate, {
          ...fieldU,
          uState: src.tex, uDt: s.dust.dt / steps, uArenaR: s.arenaR,
          uFrame: this.dustFrame++, uDust: s.dust.params,
        });
        this.fullscreen();
        this.dust = [dst, src];
      }
    }

    // 2 ─ playfield
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rt.scene.fb);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    GLK.use(this.p.field, {
      ...fieldU,
      uCenter: [v.cx, h - v.cy], uScale: v.scale, uArenaR: s.arenaR, uTime: s.time, uMotion: s.motion,
      uGrain: s.grain, uGrain2: s.grain2, uSweepRot: s.sweepRot, uRetGain: s.retGain,
      uHazColor: s.hazColor, uLUT: this.lut, uMaxRet: Optics.MAX_RET,
    });
    this.fullscreen();

    // 3 ─ dust points (additive)
    gl.enable(gl.BLEND);
    if (dustOn) {
      gl.blendFunc(gl.ONE, gl.ONE);
      GLK.use(this.p.dust, {
        ...fieldU,
        uState: this.dust[0].tex, uStateW: this.dustSize, uW2C: W2C,
        uPointSize: s.dust.pointSize, uDustColor: s.dust.color,
      });
      gl.bindVertexArray(this.emptyVAO);
      gl.drawArrays(gl.POINTS, 0, Math.min(s.dust.count || 1e9, this.dustSize * this.dustSize));
    }

    // crystals & shards (premultiplied alpha)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (s.polys.count > 0) {
      GLK.use(this.p.poly, { uW2C: W2C, uTime: s.time, uLUT: this.lut, uMaxRet: Optics.MAX_RET });
      gl.bindVertexArray(this.polyVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.polyBuf);
      gl.bufferData(gl.ARRAY_BUFFER, s.polys.data.subarray(0, s.polys.count * 14), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, s.polys.count);
    }

    // conoscopic figures
    if (s.figures.count > 0) {
      GLK.use(this.p.fig, { uW2C: W2C, uLUT: this.lut, uMaxRet: Optics.MAX_RET });
      gl.bindVertexArray(this.figVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.figBuf);
      gl.bufferData(gl.ARRAY_BUFFER, s.figures.data.subarray(0, s.figures.count * 12), gl.STREAM_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.figures.count);
    }

    // sparks (additive)
    if (s.sparks.count > 0) {
      gl.blendFunc(gl.ONE, gl.ONE);
      GLK.use(this.p.spark, { uW2C: W2C, uPx: v.scale });
      gl.bindVertexArray(this.sparkVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkBuf);
      gl.bufferData(gl.ARRAY_BUFFER, s.sparks.data.subarray(0, s.sparks.count * 7), gl.STREAM_DRAW);
      gl.drawArrays(gl.POINTS, 0, s.sparks.count);
    }
    gl.bindVertexArray(null);

    // 4 ─ bloom
    const B = this.rt.bloom;
    gl.disable(gl.BLEND);
    if (B.length) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, B[0].fb);
      gl.viewport(0, 0, B[0].w, B[0].h);
      GLK.use(this.p.bloomPre, {
        uTex: this.rt.scene.tex, uTexel: [1 / w, 1 / h], uThreshold: s.post.bloomThreshold, uKnee: 0.35,
      });
      this.fullscreen();
      for (let i = 1; i < B.length; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, B[i].fb);
        gl.viewport(0, 0, B[i].w, B[i].h);
        GLK.use(this.p.bloomDown, { uTex: B[i - 1].tex, uTexel: [1 / B[i - 1].w, 1 / B[i - 1].h] });
        this.fullscreen();
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = B.length - 1; i > 0; i--) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, B[i - 1].fb);
        gl.viewport(0, 0, B[i - 1].w, B[i - 1].h);
        GLK.use(this.p.bloomUp, { uTex: B[i].tex, uTexel: [0.5 / B[i].w, 0.5 / B[i].h], uGain: 1.0 });
        this.fullscreen();
      }
      gl.disable(gl.BLEND);
    }

    // 5 ─ composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    GLK.use(this.p.composite, {
      uScene: this.rt.scene.tex, uBloom: B.length ? B[0].tex : this.rt.scene.tex,
      uRes: [w, h], uFovC: [v.cx, h - v.cy], uFovR: s.arenaR * v.scale,
      uShock: s.shocks, uShockN: s.shockN,
      uBloomStr: B.length ? s.post.bloom : 0, uExposure: s.post.exposure, uTime: s.time,
      uHurt: s.post.hurt, uLowHp: s.post.lowHp, uGrainAmt: s.post.grain, uFade: s.post.fade,
      uAberr: s.post.aberration,
    });
    this.fullscreen();
  }
}
