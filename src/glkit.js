'use strict';
/* ISOGYRE — a very small WebGL2 toolkit: programs with reflected uniforms, render targets. */

const GLK = (() => {
  function compile(gl, type, src, label) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join('\n');
      console.error(`[${label}] shader compile failed:\n${log}\n${numbered}`);
      throw new Error(`Shader compile failed (${label}): ${log}`);
    }
    return sh;
  }

  function program(gl, vsSrc, fsSrc, label = 'program') {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc, label + '.vs'));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + '.fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      console.error(`[${label}] link failed: ${log}`);
      throw new Error(`Program link failed (${label}): ${log}`);
    }
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(p, info.name);
      const u = { loc, type: info.type, size: info.size };
      if (info.type === gl.SAMPLER_2D) u.unit = unit++;
      uniforms[name] = u;
    }
    return { gl, prog: p, uniforms, label };
  }

  /** Set uniforms by name; silently ignores names the compiler optimised away. */
  function use(P, values) {
    const gl = P.gl;
    gl.useProgram(P.prog);
    if (values) set(P, values);
  }

  function set(P, values) {
    const gl = P.gl;
    for (const name in values) {
      const u = P.uniforms[name];
      if (!u) continue;
      const v = values[name];
      switch (u.type) {
        case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v); break;
        case gl.SAMPLER_2D:
          gl.activeTexture(gl.TEXTURE0 + u.unit);
          gl.bindTexture(gl.TEXTURE_2D, v);
          gl.uniform1i(u.loc, u.unit);
          break;
        default: break;
      }
    }
  }

  function texture(gl, w, h, opts = {}) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const internal = opts.internal || gl.RGBA8;
    const format = opts.format || gl.RGBA;
    const type = opts.type || gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, opts.data || null);
    const filter = opts.filter || gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrap || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrap || gl.CLAMP_TO_EDGE);
    return t;
  }

  function target(gl, w, h, opts = {}) {
    const tex = texture(gl, w, h, opts);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      return null;
    }
    return { tex, fb, w, h };
  }

  function destroy(gl, rt) {
    if (!rt) return;
    gl.deleteFramebuffer(rt.fb);
    gl.deleteTexture(rt.tex);
  }

  return { compile, program, use, set, texture, target, destroy };
})();
