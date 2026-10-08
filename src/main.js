'use strict';
/* ISOGYRE — boot, layout, adaptive quality and the frame loop. */

(function boot() {
  const app = document.getElementById('app');
  const glCanvas = document.getElementById('gl');
  const hudCanvas = document.getElementById('hud');

  let renderer;
  try {
    renderer = new Renderer(glCanvas);
  } catch (err) {
    console.error(err);
    document.getElementById('nogl').hidden = false;
    document.getElementById('screen-title').hidden = true;
    return;
  }

  if (QueryFlags.seed) Rng.seed(Number(QueryFlags.seed));
  const audio = new AudioEngine();
  const game = new Game(renderer, audio);
  const hud = new HUD(hudCanvas);
  UI.init(game, audio);
  Input.init(app, game);

  const QUALITY = {
    high: { scale: 1.0, dust: 256, dustPoint: 1.6 },
    medium: { scale: 0.8, dust: 200, dustPoint: 1.7 },
    low: { scale: 0.62, dust: 140, dustPoint: 1.9 },
  };
  let autoLevel = 'high';
  const perf = { acc: 0, n: 0, window: 0, settle: 3 };

  function qualityLevel() {
    return game.settings.quality === 'auto' ? autoLevel : game.settings.quality;
  }

  function applyQuality() {
    const q = QUALITY[qualityLevel()] || QUALITY.high;
    game.quality = { dust: true, dustPoint: q.dustPoint, dustCount: q.dust * q.dust };
    renderer.setDustSize(q.dust);
    layout();
  }

  function layout() {
    const W = Math.max(1, app.clientWidth), H = Math.max(1, app.clientHeight);
    const touch = game.inputMode === 'touch' || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    let cx = W / 2, cy = H / 2, R;
    if (W >= H * 1.05) {
      R = Math.min(H * 0.425, W * 0.5 - 72);
      if (touch) R = Math.min(R, W * 0.5 - 150);
      cy = H / 2 + 6;
    } else {
      // tall: the eyepiece fills the width, gauges and touch controls go underneath
      R = Math.min(W * 0.5 - 38, H * 0.34);
      cy = Math.min(H / 2, 96 + R + 30);
      if (game.state === 'title') { R = Math.min(R, H * 0.25); cy = R + 64; }
    }
    R = Math.max(R, 80);
    const tall = !(W >= H * 1.05);
    // on the title screen of a wide display, slide the eyepiece right of the title card
    if (game.state === 'title' && W > 900 && W >= H * 1.15) {
      R = Math.min(R, H * 0.41, W * 0.27);
      cx = W - R - Math.max(70, W * 0.07);
    }
    game.layoutTarget = { W, H, cx, cy, R, tall };
    if (!game.layout || game.layout.W !== W || game.layout.H !== H || snapLayout) game.layout = { W, H, cx, cy, R, tall };
    snapLayout = false;
    const q = QUALITY[qualityLevel()] || QUALITY.high;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let scale = dpr * q.scale;
    const maxPx = 3.2e6;
    if (W * H * scale * scale > maxPx) scale = Math.sqrt(maxPx / (W * H));
    renderer.resize(Math.round(W * scale), Math.round(H * scale));
    hud.resize(W, H, dpr);
    UI.layoutTouch(game.layout);
  }

  let snapLayout = true;
  window.addEventListener('resize', () => { snapLayout = true; layout(); });
  game.on('state', () => layout());
  game.on('quality', applyQuality);
  game.on('inputMode', layout);
  applyQuality();

  // canvas text needs the web fonts; don't wait forever if offline
  if (document.fonts && document.fonts.load) {
    Promise.race([
      Promise.all([
        document.fonts.load(`600 18px ${FONTS.display}`),
        document.fonts.load(`600 11px ${FONTS.ui}`),
        document.fonts.load(`500 11px ${FONTS.mono}`),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]).then(() => UI.layoutTouch(game.layout)).catch(() => {});
  }

  const STEP = 1 / 60;
  let last = performance.now();
  let acc = 0;
  let frames = 0;

  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (Input.consumePause()) {
      if (game.state === 'playing' || game.state === 'cleared') game.pause();
      else if (game.state === 'paused') game.resume();
    }
    acc += dt;
    let steps = 0;
    if (window.ISOGYRE && window.ISOGYRE.hold) acc = 0; // tests drive the simulation themselves
    while (acc >= STEP && steps < 5) {
      const it = Input.poll(STEP);
      game.step(STEP, it);
      acc -= STEP;
      steps++;
    }
    if (steps >= 5) acc = 0;
    // ease the eyepiece between title and play positions
    const LT = game.layoutTarget, LC = game.layout;
    if (LT && LC) {
      const r = game.settings.motion ? 5 : 40;
      LC.cx = approach(LC.cx, LT.cx, r, dt);
      LC.cy = approach(LC.cy, LT.cy, r, dt);
      LC.R = approach(LC.R, LT.R, r, dt);
    }
    audio.update(game, dt);
    renderer.frame(game.buildScene(renderer, dt));
    hud.draw(game, dt);
    frames++;
    window.__frames = frames;

    // adaptive quality: step down if frames are consistently slow
    if (game.settings.quality === 'auto' && !document.hidden) {
      perf.settle -= dt;
      if (perf.settle <= 0) {
        perf.acc += dt; perf.n++;
        perf.window += dt;
        if (perf.window > 2.5) {
          const avg = perf.acc / perf.n;
          if (avg > 1 / 42 && autoLevel !== 'low') {
            autoLevel = autoLevel === 'high' ? 'medium' : 'low';
            applyQuality();
            perf.settle = 2;
          }
          perf.acc = 0; perf.n = 0; perf.window = 0;
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Test and tooling hooks
  window.ISOGYRE = { game, renderer, hud, audio, Field, CFG, Input, layout };
})();
