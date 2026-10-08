'use strict';
/*
 * ISOGYRE — synthesised sound. No samples: glass partials, filtered noise and a
 * generative pentatonic score. Every source you place hums a note of the chord, and
 * sweeping the phase detunes each hum by exactly the sweep rate, so you hear the
 * beat you are making.
 */
const PENTA = [0, 3, 5, 7, 10];
const noteFreq = (i) => 110 * Math.pow(2, (12 * Math.floor(i / 5) + PENTA[((i % 5) + 5) % 5]) / 12);

class AudioEngine {
  constructor() {
    this.ready = false;
    this.volume = 0.7;
    this.muted = false;
    this.voices = [];
    this.crackleBudget = 0;
    this.musicT = 0;
    this.chordI = 0;
    this.pluckT = 2;
    this.lastShatter = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8);
    const rv = ctx.createGain();
    rv.gain.value = 0.42;
    this.reverb.connect(rv);
    rv.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // drone bus for source hums
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 900;
    this.droneFilter.Q.value = 0.7;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.sfxBus);
    const ds = ctx.createGain();
    ds.gain.value = 0.5;
    this.droneGain.connect(ds);
    ds.connect(this.reverb);

    // hazard bells: two oscillators whose difference is the bells' beat
    this.bellG = ctx.createGain();
    this.bellG.gain.value = 0;
    const bf = ctx.createBiquadFilter();
    bf.type = 'lowpass';
    bf.frequency.value = 1400;
    this.bellG.connect(bf);
    bf.connect(this.sfxBus);
    this.bellA = ctx.createOscillator();
    this.bellB = ctx.createOscillator();
    this.bellA.type = this.bellB.type = 'triangle';
    this.bellA.frequency.value = 196;
    this.bellB.frequency.value = 196.8;
    this.bellA.connect(this.bellG);
    this.bellB.connect(this.bellG);
    this.bellA.start();
    this.bellB.start();

    // null hiss
    this.nullG = ctx.createGain();
    this.nullG.gain.value = 0;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 650;
    const ns = ctx.createBufferSource();
    ns.buffer = this.noiseBuf;
    ns.loop = true;
    ns.connect(nf);
    nf.connect(this.nullG);
    this.nullG.connect(this.sfxBus);
    ns.start();

    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    this.setVolume(this.volume);
  }

  impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * Math.pow(1 - t, 3.2) * (i < 80 ? i / 80 : 1);
      }
    }
    return buf;
  }

  /* ---------------- primitives ---------------- */
  out(node, opts) {
    let n = node;
    if (opts.pan != null && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(opts.pan, -1, 1);
      n.connect(p);
      n = p;
    }
    n.connect(opts.bus || this.sfxBus);
    if (opts.verb) {
      const s = this.ctx.createGain();
      s.gain.value = opts.verb;
      n.connect(s);
      s.connect(this.reverb);
    }
  }

  tone(type, freq, t0, dur, gain, opts = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + (opts.glide || dur));
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const att = opts.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let src = o;
    if (opts.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(opts.lp, t0);
      if (opts.lpTo) f.frequency.exponentialRampToValueAtTime(opts.lpTo, t0 + dur);
      f.Q.value = opts.q || 0.7;
      o.connect(f);
      src = f;
    }
    src.connect(g);
    this.out(g, opts);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise(t0, dur, gain, type, freq, opts = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = opts.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    f.Q.value = opts.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + (opts.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f);
    f.connect(g);
    this.out(g, opts);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.05);
  }

  glass(f0, t0, gain, size = 1, opts = {}) {
    const partials = [1, 2.76, 5.4, 8.93, 13.3];
    const gains = [1, 0.55, 0.32, 0.16, 0.08];
    const decs = [1.3, 0.7, 0.4, 0.24, 0.15];
    for (let i = 0; i < partials.length; i++) {
      this.tone('sine', f0 * partials[i] * (1 + (Math.random() - 0.5) * 0.004), t0, decs[i] * size, gain * gains[i], {
        ...opts, verb: opts.verb != null ? opts.verb : 0.35,
      });
    }
  }

  /* ---------------- events ---------------- */
  play(name, data, game) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.005;
    const pan = (x) => (x == null ? 0 : clamp(x / CFG.ARENA_R, -1, 1) * 0.6);
    switch (name) {
      case 'throw':
        this.noise(t, 0.2, 0.08, 'bandpass', 700, { to: 3200, q: 2.5 });
        this.tone('sine', 520, t, 0.12, 0.04, { to: 780 });
        break;
      case 'land': {
        const hit = !!data;
        this.tone('sine', 1318, t, 0.35, 0.05, { verb: 0.4 });
        this.tone('sine', 2637, t, 0.2, 0.025, { verb: 0.4 });
        if (hit) {
          this.tone('sine', 110, t, 0.18, 0.22, { to: 55 });
          this.noise(t, 0.12, 0.08, 'lowpass', 900);
        }
        break;
      }
      case 'recall':
        this.noise(t, 0.26, 0.07, 'bandpass', 3200, { to: 600, q: 2.5 });
        break;
      case 'dock':
        this.tone('sine', 880, t, 0.14, 0.035, { to: 660 });
        break;
      case 'strike':
        this.noise(t, 0.05, 0.08, 'highpass', 2500);
        this.tone('sine', 1760, t, 0.12, 0.04);
        break;
      case 'shatter':
      case 'shatterSoft': {
        const e = data;
        const soft = name === 'shatterSoft';
        const now = this.ctx.currentTime;
        const crowd = now - this.lastShatter < 0.05;
        this.lastShatter = now;
        const combo = game ? Math.min(game.combo, 12) : 0;
        const big = e && e.def.size > 30;
        const idx = (big ? 8 : 11) + (soft ? Math.floor(Math.random() * 5) : combo);
        const gain = (soft ? 0.03 : 0.085) * (crowd ? 0.5 : 1);
        this.glass(noteFreq(idx), t, gain, big ? 1.4 : 1, { pan: pan(e && e.x) });
        this.noise(t, 0.16, gain * 1.2, 'highpass', 4500, { pan: pan(e && e.x) });
        if (big && !soft) this.tone('sine', noteFreq(idx - 10), t, 0.5, 0.08, { verb: 0.5 });
        break;
      }
      case 'crackle': {
        this.crackleBudget += data * 30;
        let n = 0;
        while (this.crackleBudget > 1 && n < 2) {
          this.crackleBudget -= 1;
          n++;
          this.noise(t + Math.random() * 0.02, 0.025, 0.02 + Math.random() * 0.02, 'bandpass', 2500 + Math.random() * 5000, { q: 4 });
        }
        this.crackleBudget = Math.min(this.crackleBudget, 4);
        break;
      }
      case 'hurt':
        this.tone('sine', 190, t, 0.32, 0.25, { to: 50 });
        this.noise(t, 0.22, 0.12, 'lowpass', 500);
        this.tone('sawtooth', 233, t, 0.25, 0.03, { lp: 1200 });
        this.tone('sawtooth', 247, t, 0.25, 0.03, { lp: 1200 });
        break;
      case 'burn':
        this.noise(t, 0.09, 0.05, 'bandpass', 1300, { q: 3 });
        break;
      case 'nullOn':
        this.tone('sine', 620, t, 0.22, 0.05, { to: 180 });
        this.nullG.gain.setTargetAtTime(0.06, t, 0.03);
        break;
      case 'nullOff':
        this.nullG.gain.setTargetAtTime(0, t, 0.05);
        break;
      case 'nullCatch':
        this.tone('sine', 220, t, 0.3, 0.12, { to: 110 });
        this.glass(noteFreq(15), t, 0.025, 0.6);
        break;
      case 'ring':
        this.tone('sine', 440, t, 0.6, 0.06, { to: 150, attack: 0.03, verb: 0.6 });
        break;
      case 'opalCharge':
        this.tone('sine', 300, t, 0.6, 0.025, { to: 640, attack: 0.3, verb: 0.3 });
        break;
      case 'quanta':
        [12, 14, 16].forEach((n, i) => this.tone('sine', noteFreq(n), t + i * 0.06, 0.3, 0.045, { verb: 0.5 }));
        break;
      case 'shrapnel':
        this.tone('sine', 2600 + Math.random() * 600, t, 0.08, 0.025);
        break;
      case 'waveStart':
        [5, 8, 10, 12].forEach((n, i) => this.tone('triangle', noteFreq(n), t + i * 0.08, 1.6, 0.025, { attack: 0.3, lp: 1800, verb: 0.6 }));
        break;
      case 'waveClear':
        [10, 11, 12, 13, 14, 15].forEach((n, i) => this.glass(noteFreq(n), t + i * 0.07, 0.03, 0.8));
        break;
      case 'upgrade':
        [10, 12, 14, 17].forEach((n) => this.glass(noteFreq(n), t, 0.025, 1.2));
        break;
      case 'ui':
        this.tone('sine', 1400, t, 0.05, 0.03);
        break;
      case 'bossIntro':
        this.tone('sawtooth', 55, t, 3.5, 0.06, { attack: 1.2, lp: 300, verb: 0.6 });
        this.tone('sawtooth', 82.4, t + 0.4, 3.2, 0.05, { attack: 1.2, lp: 300, verb: 0.6 });
        break;
      case 'bossCharge':
        this.tone('sawtooth', 110, t, 1.55, 0.05, { to: 220, attack: 0.4, lp: 220, lpTo: 2600, q: 6 });
        break;
      case 'bossFire':
        [0, 7, 12].forEach((s) => this.tone('sawtooth', 110 * Math.pow(2, s / 12), t, 1.4, 0.04, { lp: 1600, attack: 0.02, verb: 0.4 }));
        this.noise(t, 0.6, 0.08, 'lowpass', 1200);
        break;
      case 'bossExpose':
        [10, 13, 15, 17].forEach((n, i) => this.glass(noteFreq(n), t + i * 0.04, 0.04, 1.4));
        this.noise(t, 0.8, 0.08, 'highpass', 3000);
        break;
      case 'bossRegrow':
        [15, 13, 12, 10].forEach((n, i) => this.glass(noteFreq(n), t + i * 0.12, 0.025, 0.8));
        break;
      case 'bossDeath':
        for (let i = 0; i < 10; i++) this.glass(noteFreq(5 + i * 1.5), t + i * 0.05, 0.05, 1.8);
        this.noise(t, 2.2, 0.15, 'lowpass', 4000, { to: 200 });
        this.tone('sine', 80, t, 2.0, 0.3, { to: 30 });
        break;
      case 'death':
        [12, 10, 8, 5].forEach((n, i) => this.tone('sine', noteFreq(n), t + i * 0.18, 1.2, 0.06, { to: noteFreq(n) * 0.5, verb: 0.7 }));
        this.noise(t, 1.6, 0.12, 'lowpass', 2500, { to: 120 });
        break;
      default:
        break;
    }
  }

  /* ---------------- continuous layers ---------------- */
  update(game, dt) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const playing = game.state === 'playing' || game.state === 'cleared' || game.state === 'title';
    const n = playing ? Field.src.length : 0;
    // one hum per source: player A3, anchors climbing the pentatonic
    const notes = [5, 8, 10, 11, 13, 14, 15, 16, 17, 18];
    while (this.voices.length < Math.min(n, 8)) {
      const i = this.voices.length;
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = 'sine'; b.type = 'sine';
      const f = noteFreq(notes[i]);
      a.frequency.value = f;
      b.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0;
      a.connect(g); b.connect(g);
      g.connect(this.droneFilter);
      a.start(); b.start();
      this.voices.push({ a, b, g, f, on: false });
    }
    const sweepHz = clamp(game.sweep.vel / TAU, -14, 14);
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      const on = i < n;
      v.g.gain.setTargetAtTime(on ? (i === 0 ? 0.5 : 0.38) : 0, t, on ? 0.15 : 0.3);
      // beat = phase rate: anchor j is advanced (j)·sweep, so its hum is detuned by j·sweepHz
      v.b.frequency.setTargetAtTime(v.f + i * sweepHz, t, 0.05);
    }
    const heat = clamp(game.fieldHeat / 2, 0, 1);
    const level = game.state === 'title' ? 0.012 : 0.02 + heat * 0.02;
    this.droneGain.gain.setTargetAtTime(n > 1 ? level : n ? level * 0.5 : 0, t, 0.2);
    this.droneFilter.frequency.setTargetAtTime(700 + heat * 2600, t, 0.15);

    // hazard bells
    let bellAmp = 0, beat = 0, nb = 0;
    for (const e of game.enemies) {
      if (!e.def.bell) continue;
      nb++;
      bellAmp = Math.max(bellAmp, e.bellAmp || 0);
      beat += Math.abs(e.beat || 0);
    }
    const bossFocus = game.boss ? game.boss.amp : 0;
    const bg = nb >= 2 && playing ? 0.018 + bossFocus * 0.03 : 0;
    this.bellG.gain.setTargetAtTime(bg * bellAmp, t, 0.2);
    const bHz = game.boss ? 1 + bossFocus * 7 : beat / Math.max(1, nb - 1) / TAU;
    this.bellB.frequency.setTargetAtTime(196 + bHz, t, 0.1);
    if (game.state !== 'playing' && game.state !== 'cleared') this.nullG.gain.setTargetAtTime(0, t, 0.05);

    this.updateMusic(game, dt);
  }

  updateMusic(game, dt) {
    const t = this.ctx.currentTime;
    this.musicT -= dt;
    const chords = [
      [-5, 2, 5, 7], [-7, 0, 3, 6], [-3, 4, 6, 9], [-6, 1, 3, 8], [-4, 1, 4, 7],
    ];
    if (this.musicT <= 0) {
      this.musicT = 9;
      const chord = chords[this.chordI++ % chords.length];
      for (const n of chord) {
        this.tone('triangle', noteFreq(n + 5), t, 10, 0.022, { attack: 2.5, lp: 900, bus: this.musicBus, verb: 0.7 });
      }
    }
    this.pluckT -= dt;
    if (this.pluckT <= 0) {
      const busy = game.state === 'playing' ? 1 : 0.6;
      this.pluckT = (0.9 + Math.random() * 1.7) / busy;
      const n = 10 + Math.floor(Math.random() * 8);
      this.tone('sine', noteFreq(n), t, 1.6, 0.018, { bus: this.musicBus, verb: 0.9 });
      this.tone('sine', noteFreq(n) * 2, t, 0.6, 0.006, { bus: this.musicBus, verb: 0.9 });
    }
  }
}
