#!/usr/bin/env node
/*
 * Headless balance simulator: runs the real game code (no rendering) with the autopilot
 * in src/bot.js and reports how long each slide takes and how much coherence it costs.
 *
 *   node tools/sim.mjs [runs=6] [skill=1] [waves=12]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'util.js', 'optics.js', 'shaders.js', 'batches.js', 'field.js', 'bestiary.js', 'upgrades.js',
  'waves.js', 'game.js', 'entities.js', 'boss.js', 'bot.js',
].map((f) => path.join(root, 'src', f));

const runs = Number(process.argv[2] || 6);
const skill = Number(process.argv[3] || 1);
const maxWaves = Number(process.argv[4] || 12);

const context = vm.createContext({ console, Math, Date, JSON, Object, Array, Set, Map, Float32Array, Number, String });
context.window = context;
for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: f });

const results = vm.runInContext(`
(function simulate(runs, skill, maxWaves) {
  const out = [];
  for (let r = 0; r < runs; r++) {
    Rng.seed(1000 + r * 77);
    Bot.reset();
    const g = new Game(null, null);
    const deaths = [];
    const origShatter = g.shatter.bind(g);
    g.shatter = (e) => {
      if (!e.dead && !e.demo) deaths.push({ type: e.type, age: e.age, d: Math.hypot(e.x - g.player.x, e.y - g.player.y), wave: g.waveIndex });
      origShatter(e);
    };
    g.startRun();
    const dt = 1 / 60;
    let t = 0, waveStart = 0, hpStart = g.player.hp, wave = g.waveIndex, dmg0 = 0;
    const log = [];
    let picks = [];
    while (t < 60 * 40) {
      if (g.state === 'upgrade') {
        const o = g.offers[Math.floor(Rng.next() * g.offers.length)];
        picks.push(o.id);
        g.chooseUpgrade(o.id);
      }
      if (g.state === 'victory') g.continueEndless();
      if (g.state === 'over') break;
      const live = g.state === 'playing' || g.state === 'cleared';
      const it = live ? Bot.intent(g, dt, skill) : null;
      g.step(dt, it);
      t += dt;
      if (g.waveIndex !== wave) {
        log.push({ wave: wave + 1, time: +(t - waveStart).toFixed(1), dmg: Math.round(g.stats.damage - dmg0), hp: Math.round(g.player.hp) });
        wave = g.waveIndex; waveStart = t; dmg0 = g.stats.damage;
        if (wave >= maxWaves) break;
      }
    }
    const byWave = {};
    for (const d of deaths) {
      const w = (byWave[d.wave] = byWave[d.wave] || { n: 0, age: 0, d: 0, close: 0 });
      w.n++; w.age += d.age; w.d += d.d; if (d.d < 160) w.close++;
    }
    const dstat = Object.entries(byWave).map(([w, v]) => 'S' + (+w + 1) + ':' + (v.age / v.n).toFixed(1) + 's@' + Math.round(v.d / v.n) + '(' + Math.round(100 * v.close / v.n) + '%<160)').join(' ');
    out.push({
      dstat,
      run: r, reached: g.waveIndex + 1, died: g.state === 'over' || g.state === 'dying', score: g.score,
      shattered: g.stats.shattered, maxCombo: g.stats.maxCombo, time: Math.round(t), log, picks,
      lastWave: { wave: wave + 1, time: +(t - waveStart).toFixed(1), dmg: Math.round(g.stats.damage - dmg0), enemies: g.enemies.length },
    });
  }
  return JSON.stringify(out);
})(${runs}, ${skill}, ${maxWaves})
`, context);

const data = JSON.parse(results);
for (const r of data) {
  console.log(`run ${r.run}: reached slide ${r.reached}${r.died ? ' (died)' : ''}  score ${r.score}  shattered ${r.shattered}  chain ${r.maxCombo}  ${r.time}s`);
  console.log('   ' + r.log.map((l) => `S${l.wave}:${l.time}s/-${l.dmg}`).join('  ') + `  | last S${r.lastWave.wave}: ${r.lastWave.time}s -${r.lastWave.dmg} (${r.lastWave.enemies} left)`);
  console.log('   picks: ' + r.picks.join(', '));
  console.log('   life@dist: ' + r.dstat);
}
const reached = data.map((r) => r.reached);
console.log(`\nskill ${skill}: mean slide reached ${(reached.reduce((a, b) => a + b, 0) / reached.length).toFixed(2)}; deaths ${data.filter((r) => r.died).length}/${data.length}`);
