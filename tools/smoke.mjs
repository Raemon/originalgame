#!/usr/bin/env node
/*
 * Smoke test: boots the game in headless Chromium (software WebGL), plays it with the
 * autopilot at fast-forward, captures screenshots of the key screens and fails on any
 * console error.
 *
 *   node tools/smoke.mjs [url=http://localhost:8777/index.html] [outDir=./shots]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://localhost:8777/index.html';
const outDir = path.resolve(process.argv[3] || path.join(root, 'shots'));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
};
const frames = async (page, n) => {
  const start = await page.evaluate(() => window.__frames || 0);
  await page.waitForFunction((t) => (window.__frames || 0) >= t, start + n, { timeout: 60000 });
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(outDir, name + '.png') });
  console.log('  shot', name);
};
/** Advance the simulation `sec` seconds with the autopilot (no rendering in between). */
const play = (page, sec, skill = 1) => page.evaluate(([sec, skill]) => {
  const g = window.ISOGYRE.game;
  for (let i = 0; i < sec * 60; i++) {
    if (g.state === 'upgrade') g.chooseUpgrade(g.offers[0].id);
    const live = g.state === 'playing' || g.state === 'cleared';
    g.step(1 / 60, live ? Bot.intent(g, 1 / 60, skill) : null);
  }
  return { state: g.state, wave: g.waveIndex, enemies: g.enemies.length, hp: Math.round(g.player.hp) };
}, [sec, skill]);
const jump = (page, wave) => page.evaluate((w) => {
  const g = window.ISOGYRE.game;
  g.enemies.length = 0; g.glints.length = 0; g.rings.length = 0; g.boss = null;
  g.state = 'playing';
  g.beginWave(w);
  for (let k = 0; k < g.stat.anchorsMax; k++) g.throwAnchor(g.player.x + Math.cos(k * 2.1) * 90, g.player.y + Math.sin(k * 2.1) * 90);
  g.emit('state', g.state);
}, wave);

// ---------------- desktop ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'seed=3');
  await frames(page, 30);
  await shot(page, '01-title');
  await page.click('#btn-start');
  await page.addScriptTag({ path: path.join(root, 'src', 'bot.js') });
  await page.evaluate(() => { window.ISOGYRE.hold = true; window.ISOGYRE.game.dustBoost = 6; });
  console.log(' ', await play(page, 4));
  await frames(page, 4);
  await shot(page, '02-slide1-start');
  console.log(' ', await play(page, 18));
  await frames(page, 16);
  await shot(page, '03-slide1-fight');
  await jump(page, 4);
  console.log(' ', await play(page, 14, 0.7));
  await frames(page, 12);
  await shot(page, '04-slide5-bells');
  await jump(page, 6);
  console.log(' ', await play(page, 12, 0.7));
  await frames(page, 4);
  await shot(page, '05-slide7-fluorite');
  await jump(page, 7);
  console.log(' ', await play(page, 9, 0.7));
  await frames(page, 4);
  await shot(page, '06-slide8-aragonite');
  await jump(page, 9);
  console.log(' ', await play(page, 9, 0.7));
  await frames(page, 4);
  await shot(page, '07-boss');
  await page.evaluate(() => window.ISOGYRE.game.openUpgrade());
  await frames(page, 3);
  await shot(page, '08-upgrade');
  await page.keyboard.press('1');
  await frames(page, 2);
  await page.evaluate(() => window.ISOGYRE.game.pause());
  await frames(page, 2);
  await shot(page, '09-pause');
  await page.evaluate(() => { const g = window.ISOGYRE.game; g.resume(); g.player.hp = 0; });
  console.log(' ', await play(page, 3));
  await frames(page, 3);
  await shot(page, '10-gameover');
  await ctx.close();
}

// ---------------- phone ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'phone');
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'seed=5');
  await frames(page, 20);
  await shot(page, '11-phone-title');
  await page.tap('#btn-start');
  await page.addScriptTag({ path: path.join(root, 'src', 'bot.js') });
  await page.evaluate(() => { window.ISOGYRE.hold = true; window.ISOGYRE.game.dustBoost = 6; window.ISOGYRE.Input.setMode('touch'); });
  await jump(page, 2);
  console.log(' ', await play(page, 12, 0.7));
  await frames(page, 12);
  await shot(page, '12-phone-play');
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error('\nConsole errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nOK — no console errors. Screenshots in ' + outDir);
