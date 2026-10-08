'use strict';
/* ISOGYRE — keyboard, mouse, touch and gamepad, folded into one intent per step. */

const Input = {
  keys: new Set(),
  mouse: { x: 0, y: 0, seen: false },
  wheel: 0,
  throwQ: [],
  recallQ: false,
  pauseQ: false,
  touch: {
    stickId: null, ox: 0, oy: 0, vx: 0, vy: 0,
    dialId: null, dialA: 0, dialDelta: 0,
    nullHeld: false, focusHeld: false,
  },
  pad: { index: -1, prevButtons: [] },
  game: null,
  els: {},

  init(root, game) {
    this.game = game;
    this.root = root;
    const E = (id) => document.getElementById(id);
    this.els = {
      touch: E('touch'), stick: E('stick'), knob: E('stick-knob'), dial: E('dial'),
      bNull: E('btn-null'), bRecall: E('btn-recall'), bFocus: E('btn-focus'),
    };

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (this.game.state === 'playing') this.pauseQ = true;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game.state === 'playing') this.pauseQ = true;
    });

    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // whatever pressed "Begin" decides the first set of hints and controls
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setMode('touch');
      else if (e.pointerType === 'mouse' && this.game.inputMode === 'touch') this.setMode('kb');
    }, true);
    root.addEventListener('wheel', (e) => {
      if (this.game.state !== 'playing' && this.game.state !== 'cleared') return;
      e.preventDefault();
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 33;
      else if (e.deltaMode === 2) d *= 400;
      this.wheel += clamp(d, -240, 240);
      this.setMode('kb');
    }, { passive: false });

    const canvasEl = E('hud');
    canvasEl.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    const hold = (el, key) => {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.touch[key] = true; this.setMode('touch'); el.classList.add('held'); });
      const up = () => { this.touch[key] = false; el.classList.remove('held'); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };
    hold(this.els.bNull, 'nullHeld');
    hold(this.els.bFocus, 'focusHeld');
    if (this.els.bRecall) {
      this.els.bRecall.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); this.recallQ = true; this.setMode('touch');
      });
    }
    if (this.els.dial) {
      this.els.dial.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.startDial(e);
      });
    }
  },

  setMode(m) {
    if (this.game.inputMode !== m) {
      this.game.inputMode = m;
      this.game.emit('inputMode', m);
    }
  },

  onKey(e, down) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const gameKeys = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const playing = this.game.state === 'playing' || this.game.state === 'cleared';
    if (playing && gameKeys.includes(k)) e.preventDefault();
    if (down) {
      if (!this.keys.has(k)) {
        if (k === 'Escape' || k === 'p') this.pauseQ = true;
        if ((k === 'r' || k === 'f') && playing) this.recallQ = true;
      }
      this.keys.add(k);
      if (playing) this.setMode('kb');
    } else {
      this.keys.delete(k);
    }
  },

  toWorld(sx, sy) {
    const L = this.game.layout;
    return { x: ((sx - L.cx) * CFG.ARENA_R) / L.R, y: ((sy - L.cy) * CFG.ARENA_R) / L.R };
  },

  rel(e) {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  },

  onPointerDown(e) {
    const g = this.game;
    const { x, y } = this.rel(e);
    if (e.pointerType === 'touch') {
      e.preventDefault();
      this.setMode('touch');
      const L = g.layout;
      const inside = Math.hypot(x - L.cx, y - L.cy) < L.R * 1.02;
      if (inside) {
        const w = this.toWorld(x, y);
        this.throwQ.push(w);
        this.mouse.x = x; this.mouse.y = y; this.mouse.seen = true;
      } else if (x < L.W * 0.5) {
        const t = this.touch;
        t.stickId = e.pointerId; t.ox = x; t.oy = y; t.vx = 0; t.vy = 0;
        this.showStick(x, y, x, y);
      } else {
        this.startDial(e);
      }
      return;
    }
    this.mouse.x = x; this.mouse.y = y; this.mouse.seen = true;
    if (g.state !== 'playing' && g.state !== 'cleared') return;
    this.setMode('kb');
    if (e.button === 0) this.throwQ.push(this.toWorld(x, y));
    else if (e.button === 2) this.recallQ = true;
  },

  startDial(e) {
    const t = this.touch;
    const c = this.dialCenter();
    t.dialId = e.pointerId;
    t.dialA = Math.atan2(e.clientY - c.y, e.clientX - c.x);
    this.setMode('touch');
  },

  dialCenter() {
    const el = this.els.dial;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },

  onPointerMove(e) {
    const t = this.touch;
    if (e.pointerId === t.stickId) {
      const { x, y } = this.rel(e);
      let dx = x - t.ox, dy = y - t.oy;
      const max = 56;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx *= max / d; dy *= max / d; }
      t.vx = dx / max; t.vy = dy / max;
      this.showStick(t.ox, t.oy, t.ox + dx, t.oy + dy);
      return;
    }
    if (e.pointerId === t.dialId) {
      const c = this.dialCenter();
      const a = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      t.dialDelta += wrapAngle(a - t.dialA);
      t.dialA = a;
      return;
    }
    if (e.pointerType !== 'touch') {
      const { x, y } = this.rel(e);
      this.mouse.x = x; this.mouse.y = y; this.mouse.seen = true;
    }
  },

  onPointerUp(e) {
    const t = this.touch;
    if (e.pointerId === t.stickId) {
      t.stickId = null; t.vx = 0; t.vy = 0;
      this.hideStick();
    }
    if (e.pointerId === t.dialId) t.dialId = null;
  },

  showStick(ox, oy, kx, ky) {
    const { stick, knob } = this.els;
    if (!stick) return;
    stick.style.transform = `translate(${ox - 60}px, ${oy - 60}px)`;
    stick.classList.add('on');
    knob.style.transform = `translate(${kx - ox}px, ${ky - oy}px)`;
  },

  hideStick() {
    if (this.els.stick) this.els.stick.classList.remove('on');
  },

  pollPad() {
    let pads = [];
    try {
      // a sandboxed or cross-origin frame may forbid the Gamepad API outright
      pads = (navigator.getGamepads && navigator.getGamepads()) || [];
    } catch (e) {
      this.noPads = true;
    }
    if (this.noPads) return null;
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) return null;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const val = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    const prev = this.pad.prevButtons;
    const edge = (i) => btn(i) && !prev[i];
    const out = {
      mx: dz(pad.axes[0] || 0), my: dz(pad.axes[1] || 0),
      ax: dz(pad.axes[2] || 0), ay: dz(pad.axes[3] || 0),
      throw: edge(0) || edge(2), recall: edge(1) || edge(3),
      shield: btn(5), focus: btn(4), sweep: val(7) - val(6),
      pause: edge(9), any: false,
    };
    out.any = out.mx || out.my || out.ax || out.ay || pad.buttons.some((b) => b.pressed);
    this.pad.prevButtons = pad.buttons.map((b) => b.pressed);
    return out;
  },

  /** Build the intent for one simulation step. */
  poll(dt) {
    const g = this.game;
    const k = this.keys;
    const it = { mx: 0, my: 0, sweep: 0, throwAt: null, recall: false, shield: false, focus: false, aim: null };
    if (k.has('a') || k.has('ArrowLeft')) it.mx -= 1;
    if (k.has('d') || k.has('ArrowRight')) it.mx += 1;
    if (k.has('w') || k.has('ArrowUp')) it.my -= 1;
    if (k.has('s') || k.has('ArrowDown')) it.my += 1;
    if (k.has('q')) it.sweep -= CFG.SWEEP_KEYS * dt;
    if (k.has('e')) it.sweep += CFG.SWEEP_KEYS * dt;
    it.shield = k.has(' ');
    it.focus = k.has('Shift');
    if (this.wheel) { it.sweep += this.wheel * CFG.SWEEP_WHEEL; this.wheel = 0; }
    if (this.mouse.seen) it.aim = this.toWorld(this.mouse.x, this.mouse.y);

    const t = this.touch;
    if (t.stickId != null) { it.mx += t.vx; it.my += t.vy; }
    if (t.dialDelta) { it.sweep += t.dialDelta * 1.6; t.dialDelta = 0; }
    if (t.nullHeld) it.shield = true;
    if (t.focusHeld) it.focus = true;

    const pad = this.pollPad();
    if (pad) {
      if (pad.any && g.state === 'playing') this.setMode('pad');
      it.mx += pad.mx; it.my += pad.my;
      it.sweep += pad.sweep * CFG.SWEEP_KEYS * dt;
      if (pad.shield) it.shield = true;
      if (pad.focus) it.focus = true;
      const p = g.player;
      if (pad.ax || pad.ay) {
        const m = Math.hypot(pad.ax, pad.ay);
        it.aim = { x: p.x + (pad.ax / Math.max(m, 1)) * 300 * Math.min(1, m), y: p.y + (pad.ay / Math.max(m, 1)) * 300 * Math.min(1, m) };
        this.padAim = it.aim;
      } else if (this.padAim && g.inputMode === 'pad') {
        it.aim = this.padAim;
      }
      if (pad.throw) this.throwQ.push(it.aim || { x: p.x + 160, y: p.y });
      if (pad.recall) this.recallQ = true;
      if (pad.pause) this.pauseQ = true;
    }

    if (this.throwQ.length) it.throwAt = this.throwQ.shift();
    if (this.recallQ) { it.recall = true; this.recallQ = false; }
    return it;
  },

  consumePause() {
    const p = this.pauseQ;
    this.pauseQ = false;
    return p;
  },

  clearQueues() {
    this.throwQ.length = 0;
    this.recallQ = false;
    this.wheel = 0;
  },
};
