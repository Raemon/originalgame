'use strict';
/*
 * ISOGYRE — heads-up display, drawn like the engravings on a polarising microscope:
 * a rotating stage goniometer (your phase), coherence and null gauges, a λ scale bar.
 */
const FONTS = {
  display: '"Bodoni Moda", "Bodoni 72", Didot, "Big Caslon", "Times New Roman", serif',
  ui: '"IBM Plex Sans Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};

const INK = (a) => `rgba(234, 228, 214, ${a})`;

class HUD {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.scoreShown = 0;
    this.hpShown = 1;
    this.colors = {
      coherence: 'rgba(240, 214, 140, 0.92)',
      null: 'rgba(128, 170, 238, 0.92)',
      red: 'rgb(255, 64, 52)',
      tint: Optics.css(551, 1.4),
    };
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
  }

  draw(g, dt) {
    const ctx = this.ctx;
    const L = g.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    const st = g.state;
    this.drawStage(g);
    if (st === 'title') return;
    const live = st === 'playing' || st === 'cleared' || st === 'dying' || st === 'paused';
    if (live) {
      this.drawThreads(g);
      this.drawGlints(g);
      this.drawBossTarget(g);
      this.drawPopups(g);
      this.drawScaleBar(g);
    }
    this.drawGauges(g, dt);
    if (g.layout.tall) this.drawTallAnchors(g);
    this.drawInfo(g, dt);
    if (live) {
      this.drawBanner(g);
      this.drawTip(g);
      if (st === 'playing' || st === 'cleared') this.drawReticle(g);
    }
  }

  w2s(g, x, y) {
    const L = g.layout;
    const k = L.R / CFG.ARENA_R;
    return [L.cx + x * k, L.cy + y * k];
  }

  /* --- rotating stage scale: the sweep, made visible --- */
  drawStage(g) {
    const ctx = this.ctx;
    const { cx, cy, R } = g.layout;
    const phaseDeg = ((g.sweep.s * RAD2DEG) % 360 + 360) % 360;
    const rot = (-phaseDeg * Math.PI) / 180;
    const r0 = R + 5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = 'round';
    const small = R < 260;
    const step = small ? 2 : 1;
    for (let d = 0; d < 360; d += step) {
      const a = rot + (d * Math.PI) / 180 - Math.PI / 2;
      const major = d % 10 === 0, mid = d % 5 === 0;
      const len = major ? 9 : mid ? 6 : 3;
      ctx.strokeStyle = INK(major ? 0.55 : mid ? 0.32 : 0.16);
      ctx.lineWidth = major ? 1.2 : 1;
      const c = Math.cos(a), s = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(c * r0, s * r0);
      ctx.lineTo(c * (r0 + len), s * (r0 + len));
      ctx.stroke();
    }
    ctx.fillStyle = INK(0.5);
    ctx.font = `500 ${small ? 9 : 10}px ${FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 30) {
      const a = rot + (d * Math.PI) / 180 - Math.PI / 2;
      ctx.fillText(String(d), Math.cos(a) * (r0 + 21), Math.sin(a) * (r0 + 21));
    }
    // fixed index (vernier) at the top
    ctx.fillStyle = INK(0.9);
    ctx.beginPath();
    ctx.moveTo(0, -r0 + 1);
    ctx.lineTo(-5, -r0 - 9);
    ctx.lineTo(5, -r0 - 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (g.state !== 'title') {
      ctx.fillStyle = INK(0.75);
      ctx.font = `500 11px ${FONTS.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`φ ${phaseDeg.toFixed(1).padStart(5, '0')}°`, cx, cy - r0 - 36);
    }
  }

  /* --- coherence (health) and null energy --- */
  drawGauges(g, dt) {
    if (g.state === 'title') return;
    const p = g.player;
    const hp = clamp(p.hp / p.maxHp, 0, 1);
    this.hpShown = approach(this.hpShown, hp, 6, dt);
    const low = hp < 0.3;
    const hpCol = low ? (Math.sin(g.realTime * 8) > 0 ? this.colors.red : 'rgb(150, 36, 28)') : this.colors.coherence;
    const nullCol = p.shieldOn ? INK(0.95) : p.focusOn ? this.colors.tint : this.colors.null;
    const nullLabel = g.stat.bertrand ? 'NULL · FOCUS' : 'NULL';
    const hpVal = String(Math.ceil(Math.max(0, p.hp)));
    const nVal = String(Math.floor(p.energy));
    const nAlpha = p.energy < 8 ? 0.4 : 1;
    if (g.layout.tall) {
      this.barGauge(g, -1, this.hpShown, hpCol, 'COHERENCE', hpVal, 1);
      this.barGauge(g, 1, clamp(p.energy / 100, 0, 1), nullCol, nullLabel, nVal, nAlpha);
    } else {
      this.arcGauge(g, -1, this.hpShown, hpCol, 'COHERENCE', hpVal, 1);
      this.arcGauge(g, 1, clamp(p.energy / 100, 0, 1), nullCol, nullLabel, nVal, nAlpha);
    }
  }

  arcGauge(g, side, frac, color, label, value, alpha) {
    const ctx = this.ctx;
    const { cx, cy, R } = g.layout;
    const rg = R + 46;
    const span = (38 * Math.PI) / 180;
    const center = side < 0 ? Math.PI : 0;
    const bottom = side < 0 ? center - span : center + span;
    const top = side < 0 ? center + span : center - span;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK(0.1);
    ctx.beginPath();
    ctx.arc(cx, cy, rg, center - span, center + span);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    if (side < 0) ctx.arc(cx, cy, rg, bottom, bottom + 2 * span * frac, false);
    else ctx.arc(cx, cy, rg, bottom, bottom - 2 * span * frac, true);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = INK(0.22);
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const a = center - span + (2 * span * i) / 10;
      const r2 = rg + (i % 5 === 0 ? 9 : 6);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (rg + 3), cy + Math.sin(a) * (rg + 3));
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    const la = top + (side < 0 ? 0.06 : -0.06);
    const lx = cx + Math.cos(la) * (rg + 2), ly = cy + Math.sin(la) * (rg + 2);
    this.label(lx, ly, label, value, side < 0 ? 'right' : 'left');
    ctx.restore();
  }

  barGauge(g, side, frac, color, label, value, alpha) {
    const ctx = this.ctx;
    const { W, cy, R } = g.layout;
    const y = cy + R + 50;
    const w = Math.min(150, W * 0.5 - 52);
    const x0 = side < 0 ? 18 : W - 18 - w;
    ctx.save();
    ctx.fillStyle = INK(0.1);
    ctx.fillRect(x0, y, w, 3);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    if (side < 0) ctx.fillRect(x0, y, w * frac, 3);
    else ctx.fillRect(x0 + w * (1 - frac), y, w * frac, 3);
    ctx.globalAlpha = 1;
    this.label(side < 0 ? x0 : x0 + w, y - 5, label, value, side < 0 ? 'left' : 'right');
    ctx.restore();
  }

  label(x, y, label, value, align) {
    const ctx = this.ctx;
    ctx.textAlign = align;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = INK(0.55);
    ctx.font = `600 10px ${FONTS.ui}`;
    ctx.letterSpacing = '0.14em';
    ctx.fillText(label, x, y);
    ctx.fillStyle = INK(0.85);
    ctx.font = `500 11px ${FONTS.mono}`;
    ctx.letterSpacing = '0px';
    ctx.fillText(value, x, y - 13);
  }

  /** Small anchor glyphs: filled = out on the field, ring = in hand. */
  drawAnchorGlyphs(g, x, y, align) {
    const ctx = this.ctx;
    const n = g.stat.anchorsMax;
    const placed = g.anchors.length;
    const step = 15;
    const x0 = align === 'center' ? x - ((n - 1) * step) / 2 : x + 5;
    for (let i = 0; i < n; i++) {
      const ax = x0 + i * step;
      ctx.beginPath();
      ctx.arc(ax, y, 5, 0, TAU);
      if (i < placed) {
        ctx.fillStyle = INK(0.85);
        ctx.fill();
        ctx.fillStyle = 'rgba(10, 10, 12, 0.9)';
        ctx.fillRect(ax - 0.6, y - 3.6, 1.2, 7.2);
        ctx.fillRect(ax - 3.6, y - 0.6, 7.2, 1.2);
      } else {
        ctx.strokeStyle = INK(0.55);
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
    }
  }

  /* --- array order: faint threads from you through each anchor --- */
  drawTallAnchors(g) {
    const { cx, cy, R } = g.layout;
    this.drawAnchorGlyphs(g, cx, cy + R + 44, 'center');
    const ctx = this.ctx;
    ctx.fillStyle = INK(0.45);
    ctx.font = `600 9px ${FONTS.ui}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = '0.16em';
    ctx.fillText('ANCHORS', cx, cy + R + 54);
    ctx.letterSpacing = '0px';
  }

  drawThreads(g) {
    if (!g.player.alive || !g.anchors.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = INK(0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    let [x0, y0] = this.w2s(g, g.player.x, g.player.y);
    ctx.moveTo(x0, y0);
    for (const a of g.anchors) {
      const [x, y] = this.w2s(g, a.x, a.y);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (g.anchors.length > 1) {
      ctx.fillStyle = INK(0.55);
      ctx.font = `500 9px ${FONTS.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      g.anchors.forEach((a, j) => {
        const [x, y] = this.w2s(g, a.x, a.y);
        ctx.fillText(String(j + 1), x + 15, y - 15);
      });
    }
    ctx.restore();
  }

  drawGlints(g) {
    const ctx = this.ctx;
    const { cx, cy, R } = g.layout;
    for (const gl of g.glints) {
      const a = Math.atan2(gl.y, gl.x);
      const u = 1 - gl.t / gl.total;
      ctx.fillStyle = `rgba(255, 236, 210, ${0.25 + u * 0.6})`;
      const r1 = R - 2, r2 = R - 12 - u * 6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - 0.025) * r1, cy + Math.sin(a - 0.025) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.lineTo(cx + Math.cos(a + 0.025) * r1, cy + Math.sin(a + 0.025) * r1);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawBossTarget(g) {
    const B = g.boss;
    if (!B || B.amp < 0.3) return;
    const ctx = this.ctx;
    const [x, y] = this.w2s(g, B.tx, B.ty);
    const charging = B.state === 'charge';
    const r = charging ? lerp(46, 14, clamp(B.t / 1.5, 0, 1)) : 14 + Math.sin(g.realTime * 20) * 2;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 70, 50, ${charging ? 0.85 : 0.6})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + g.realTime * 0.8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3));
      ctx.lineTo(x + Math.cos(a) * (r + 9), y + Math.sin(a) * (r + 9));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPopups(g) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const q of g.popups) {
      const [x, y] = this.w2s(g, q.x, q.y);
      const u = q.t / q.life;
      const a = u < 0.15 ? u / 0.15 : 1 - smoothstep(0.55, 1, u);
      ctx.fillStyle = INK(0.9 * a);
      ctx.font = q.big ? `500 15px ${FONTS.display}` : `500 11px ${FONTS.mono}`;
      ctx.letterSpacing = q.big ? '0.18em' : '0px';
      ctx.fillText(q.text, x, y - q.t * 26);
    }
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  drawScaleBar(g) {
    const ctx = this.ctx;
    const { cx, cy, R } = g.layout;
    const k = R / CFG.ARENA_R;
    const len = CFG.LAMBDA * k;
    const a = Math.PI * 0.25;
    const x = cx + Math.cos(a) * R * 0.78 - len / 2, y = cy + Math.sin(a) * R * 0.78;
    ctx.save();
    ctx.strokeStyle = INK(0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
    ctx.moveTo(x + len, y - 4); ctx.lineTo(x + len, y + 4);
    ctx.stroke();
    ctx.fillStyle = INK(0.6);
    ctx.font = `500 10px ${FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`λ ${CFG.LAMBDA} µm`, x + len / 2, y + 6);
    ctx.restore();
  }

  /* --- corner engravings: slide label, score --- */
  drawInfo(g, dt) {
    const ctx = this.ctx;
    const L = g.layout;
    const narrow = L.W < 720;
    this.scoreShown = approach(this.scoreShown, g.score, 10, dt);
    if (Math.abs(this.scoreShown - g.score) < 1) this.scoreShown = g.score;
    const pad = 18;
    ctx.save();
    ctx.textBaseline = 'top';
    // left block
    ctx.textAlign = 'left';
    ctx.fillStyle = INK(0.92);
    ctx.font = `600 ${narrow ? 15 : 18}px ${FONTS.display}`;
    ctx.letterSpacing = '0.32em';
    ctx.fillText('ISOGYRE', pad, pad);
    ctx.letterSpacing = '0.12em';
    const def = g.dir ? g.dir.def : null;
    if (def) {
      ctx.fillStyle = INK(0.75);
      ctx.font = `600 ${narrow ? 10 : 11}px ${FONTS.ui}`;
      ctx.fillText(`SLIDE ${String(g.waveIndex + 1).padStart(2, '0')} · ${def.rock.toUpperCase()}`, pad, pad + (narrow ? 22 : 28));
      ctx.fillStyle = INK(0.42);
      ctx.font = `500 10px ${FONTS.mono}`;
      ctx.letterSpacing = '0.04em';
      ctx.fillText('XPL · 10× / 0.25 POL', pad, pad + (narrow ? 37 : 45));
      const remaining = this.remaining(g);
      const y3 = pad + (narrow ? 51 : 60);
      if (!def.boss) ctx.fillText(`CRYSTALS ${String(remaining).padStart(2, '0')}`, pad, y3);
      if (!L.tall) {
        ctx.fillText('ANCHORS', pad, y3 + 15);
        this.drawAnchorGlyphs(g, pad + 58, y3 + 21, 'left');
      }
      if (g.boss) this.drawBossBlock(g, pad, y3 + (L.tall ? 0 : 36));
    }
    // right block
    ctx.textAlign = 'right';
    ctx.letterSpacing = '0.04em';
    ctx.fillStyle = INK(0.95);
    ctx.font = `500 ${narrow ? 22 : 30}px ${FONTS.display}`;
    ctx.fillText(Math.round(this.scoreShown).toLocaleString('en-US'), L.W - pad, pad - 4);
    const mult = 1 + Math.min(g.combo, 40) * 0.1;
    ctx.font = `500 11px ${FONTS.mono}`;
    if (g.combo > 1) {
      ctx.fillStyle = Optics.css(400 + Math.min(g.combo, 30) * 40, 1.4, clamp(g.comboT / 0.6, 0.3, 1));
      ctx.fillText(`×${mult.toFixed(1)}  CHAIN ${g.combo}`, L.W - pad, pad + (narrow ? 26 : 34));
    }
    ctx.fillStyle = INK(0.38);
    ctx.fillText(`BEST ${Math.max(g.best.score, g.score).toLocaleString('en-US')}`, L.W - pad, pad + (narrow ? 40 : 50));
    ctx.restore();
  }

  remaining(g) {
    let n = g.enemies.length + g.glints.length;
    const D = g.dir;
    if (D && !D.def.boss) for (let i = D.gi; i < D.def.groups.length; i++) n += D.def.groups[i].n;
    return n;
  }

  drawBossBlock(g, x, y) {
    const B = g.boss;
    const ctx = this.ctx;
    const c = B.core;
    const frac = clamp(c.hp / c.maxHp, 0, 1);
    const bells = B.bells.filter((b) => b && !b.dead).length;
    const w = 150;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = INK(0.8);
    ctx.font = `600 10px ${FONTS.ui}`;
    ctx.letterSpacing = '0.18em';
    ctx.fillText('THE GEODE', x, y);
    ctx.fillStyle = INK(0.1);
    ctx.fillRect(x, y + 16, w, 3);
    ctx.fillStyle = c.invuln ? INK(0.5) : this.colors.red;
    ctx.fillRect(x, y + 16, w * frac, 3);
    ctx.fillStyle = c.invuln ? INK(0.5) : this.colors.red;
    ctx.font = `500 10px ${FONTS.mono}`;
    ctx.letterSpacing = '0.04em';
    ctx.fillText(c.invuln ? `SHIELDED · ${bells} BELLS RINGING` : 'EXPOSED · STRIKE NOW', x, y + 25);
    ctx.restore();
  }

  drawBanner(g) {
    const b = g.banner;
    if (!b) return;
    const ctx = this.ctx;
    const { cx, cy, R } = g.layout;
    const u = b.t / b.dur;
    const a = u < 0.12 ? u / 0.12 : 1 - smoothstep(0.7, 1, u);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK(0.95 * a);
    const big = Math.min(40, R * 0.12);
    ctx.font = `500 ${big}px ${FONTS.display}`;
    ctx.letterSpacing = '0.3em';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 18;
    ctx.fillText(b.title, cx + big * 0.15, cy - R * 0.42);
    ctx.font = `600 ${Math.max(11, big * 0.32)}px ${FONTS.ui}`;
    ctx.letterSpacing = '0.32em';
    ctx.fillStyle = INK(0.7 * a);
    ctx.fillText(b.sub, cx, cy - R * 0.42 + big * 0.9);
    ctx.restore();
  }

  drawTip(g) {
    const tip = g.tip;
    if (!tip || tip.a < 0.01) return;
    const ctx = this.ctx;
    const { cx, cy, R, W } = g.layout;
    ctx.save();
    const fs = W < 520 ? 13 : 15;
    ctx.font = `500 ${fs}px ${FONTS.ui}`;
    ctx.letterSpacing = '0.02em';
    const maxW = Math.min(R * 1.5, W - 40);
    const lines = this.wrap(ctx, tip.text, maxW);
    const lh = fs * 1.35;
    const y0 = cy + R * 0.6;
    let wMax = 0;
    for (const l of lines) wMax = Math.max(wMax, ctx.measureText(l).width);
    const h = lines.length * lh + 16;
    ctx.globalAlpha = tip.a;
    ctx.fillStyle = 'rgba(6, 6, 9, 0.72)';
    this.roundRect(ctx, cx - wMax / 2 - 16, y0 - 8, wMax + 32, h, 4);
    ctx.fill();
    ctx.strokeStyle = INK(0.18);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = INK(0.95);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, cx, y0 + i * lh));
    ctx.restore();
  }

  drawReticle(g) {
    if (g.inputMode === 'touch') return;
    const ctx = this.ctx;
    const [x, y] = this.w2s(g, g.aim.x, g.aim.y);
    const L = g.layout;
    if (Math.hypot(x - L.cx, y - L.cy) > L.R + 30) return;
    ctx.save();
    ctx.strokeStyle = g.player.focusOn ? this.colors.tint : INK(0.85);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
      ctx.lineTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15);
      ctx.stroke();
    }
    // when every anchor is out, show which one a throw will move
    if (g.anchors.length >= g.stat.anchorsMax && g.anchors.length) {
      const [ax, ay] = this.w2s(g, g.anchors[0].x, g.anchors[0].y);
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = INK(0.22);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(ax, ay, 18, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  wrap(ctx, text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
