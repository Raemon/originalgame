'use strict';
/*
 * ISOGYRE — slides (waves). Each wave is a new thin section on the stage.
 * A group spawns `n` crystals; `delay` counts from the previous group;
 * `gate` waits for the field to be clear; `require` waits for a tutorial step.
 */
const CAMPAIGN = [
  {
    rock: 'Granite', tScale: 1.0, speedScale: 1.0, grain: { cell: 72, ret: [90, 950], twin: 0.3 }, anchors: 1,
    tips: ['move', 'throw', 'fringe', 'sweep'],
    groups: [
      { delay: 1.0, require: 'throw', type: 'quartz', n: 1, formation: 'random' },
      { delay: 6.0, type: 'quartz', n: 2, interval: 1.4 },
      { delay: 7.0, type: 'quartz', n: 3, interval: 0.9, formation: 'arc' },
      { delay: 8.0, type: 'quartz', n: 4, interval: 0.7, formation: 'arc' },
      { delay: 6.0, gate: true, type: 'quartz', n: 6, interval: 0.45, formation: 'ring' },
    ],
  },
  {
    rock: 'Quartzite', tScale: 1.0, speedScale: 1.0, grain: { cell: 58, ret: [120, 520], twin: 0.05 }, anchors: 1,
    tips: ['calcite'],
    groups: [
      { delay: 2.0, type: 'quartz', n: 4, interval: 0.8, formation: 'arc' },
      { delay: 5.0, type: 'calcite', n: 2, interval: 1.2 },
      { delay: 7.0, type: 'quartz', n: 5, interval: 0.5, formation: 'ring' },
      { delay: 7.0, type: 'calcite', n: 3, interval: 0.9, formation: 'arc' },
      { delay: 7.0, gate: true, type: 'quartz', n: 4, interval: 0.4, formation: 'arc' },
      { delay: 1.5, type: 'calcite', n: 4, interval: 0.6, formation: 'arc' },
    ],
  },
  {
    rock: 'Mica Schist', tScale: 1.15, speedScale: 1.04, grain: { cell: 64, ret: [300, 1500], twin: 0.1, stretch: 1 }, anchors: 2,
    tips: ['anchor2', 'recall', 'beams'],
    groups: [
      { delay: 2.5, type: 'mica', n: 2, interval: 1.5 },
      { delay: 6.0, type: 'quartz', n: 6, interval: 0.4, formation: 'ring' },
      { delay: 7.0, type: 'mica', n: 2, interval: 1.0, formation: 'arc' },
      { delay: 4.0, type: 'calcite', n: 4, interval: 0.6, formation: 'arc' },
      { delay: 7.0, gate: true, type: 'mica', n: 3, interval: 0.8, formation: 'ring' },
      { delay: 3.0, type: 'quartz', n: 6, interval: 0.35, formation: 'arc' },
    ],
  },
  {
    rock: 'Opaline Chert', tScale: 1.25, speedScale: 1.06, grain: { cell: 46, ret: [60, 480], twin: 0.0 }, anchors: 2,
    tips: ['null'],
    groups: [
      { delay: 2.0, type: 'opal', n: 1 },
      { delay: 4.0, type: 'quartz', n: 5, interval: 0.6, formation: 'arc' },
      { delay: 8.0, type: 'opal', n: 1 },
      { delay: 2.0, type: 'calcite', n: 4, interval: 0.7 },
      { delay: 8.0, type: 'mica', n: 2, interval: 1.0 },
      { delay: 6.0, gate: true, type: 'opal', n: 2, interval: 1.5, formation: 'pair' },
      { delay: 2.0, type: 'quartz', n: 8, interval: 0.3, formation: 'ring' },
    ],
  },
  {
    rock: 'Zircon Pegmatite', tScale: 1.35, speedScale: 1.08, grain: { cell: 96, ret: [100, 1200], twin: 0.45 }, anchors: 2,
    tips: ['bells'],
    groups: [
      { delay: 2.0, type: 'zircon', n: 2, formation: 'pair' },
      { delay: 3.0, type: 'quartz', n: 6, interval: 0.6, formation: 'ring' },
      { delay: 8.0, type: 'calcite', n: 4, interval: 0.6, formation: 'arc' },
      { delay: 6.0, type: 'mica', n: 2, interval: 1.0 },
      { delay: 4.0, gate: true, type: 'zircon', n: 2, formation: 'pair' },
      { delay: 1.0, type: 'opal', n: 1 },
      { delay: 5.0, type: 'quartz', n: 8, interval: 0.3, formation: 'ring' },
    ],
  },
  {
    rock: 'Garnet Amphibolite', tScale: 1.6, speedScale: 1.1, grain: { cell: 60, ret: [250, 1300], twin: 0.2, stretch: 1 }, anchors: 3,
    tips: ['anchor3', 'garnet'],
    groups: [
      { delay: 2.0, type: 'garnet', n: 1 },
      { delay: 4.0, type: 'quartz', n: 6, interval: 0.5, formation: 'arc' },
      { delay: 7.0, type: 'garnet', n: 2, interval: 1.2, formation: 'pair' },
      { delay: 3.0, type: 'mica', n: 2, interval: 0.8 },
      { delay: 7.0, type: 'calcite', n: 5, interval: 0.5, formation: 'ring' },
      { delay: 6.0, gate: true, type: 'garnet', n: 2, interval: 0.6 },
      { delay: 1.0, type: 'zircon', n: 2, formation: 'pair' },
      { delay: 4.0, type: 'quartz', n: 8, interval: 0.3, formation: 'ring' },
    ],
  },
  {
    rock: 'Fluorite Vein', tScale: 1.75, speedScale: 1.12, grain: { cell: 84, ret: [0, 300], twin: 0.0, vein: 1 }, anchors: 3,
    tips: ['fluorite'],
    groups: [
      { delay: 2.0, type: 'fluorite', n: 1 },
      { delay: 1.5, type: 'calcite', n: 5, interval: 0.4, formation: 'cluster' },
      { delay: 8.0, type: 'opal', n: 2, interval: 2.0, formation: 'pair' },
      { delay: 4.0, type: 'fluorite', n: 1 },
      { delay: 1.0, type: 'mica', n: 3, interval: 0.6, formation: 'cluster' },
      { delay: 8.0, gate: true, type: 'garnet', n: 2, interval: 1.0 },
      { delay: 1.0, type: 'quartz', n: 10, interval: 0.25, formation: 'ring' },
      { delay: 3.0, type: 'fluorite', n: 2, interval: 2.0, formation: 'pair' },
    ],
  },
  {
    rock: 'Aragonite Shell', tScale: 1.9, speedScale: 1.14, grain: { cell: 40, ret: [400, 1800], twin: 0.6 }, anchors: 3,
    tips: ['needles'],
    groups: [
      { delay: 2.0, type: 'aragonite', n: 9, interval: 0.12, formation: 'cluster' },
      { delay: 7.0, type: 'zircon', n: 2, formation: 'pair' },
      { delay: 3.0, type: 'aragonite', n: 10, interval: 0.1, formation: 'cluster' },
      { delay: 8.0, type: 'mica', n: 3, interval: 0.7, formation: 'arc' },
      { delay: 4.0, type: 'garnet', n: 1 },
      { delay: 5.0, gate: true, type: 'aragonite', n: 12, interval: 0.1, formation: 'cluster' },
      { delay: 1.5, type: 'aragonite', n: 12, interval: 0.1, formation: 'cluster' },
      { delay: 3.0, type: 'opal', n: 2, interval: 1.0, formation: 'pair' },
    ],
  },
  {
    rock: 'Eclogite', tScale: 2.2, speedScale: 1.16, grain: { cell: 66, ret: [200, 1700], twin: 0.25 }, anchors: 4,
    tips: ['anchor4'],
    groups: [
      { delay: 2.0, type: 'zircon', n: 2, formation: 'pair' },
      { delay: 1.0, type: 'garnet', n: 2, interval: 0.8 },
      { delay: 5.0, type: 'calcite', n: 6, interval: 0.4, formation: 'ring' },
      { delay: 6.0, type: 'fluorite', n: 1 },
      { delay: 1.0, type: 'mica', n: 3, interval: 0.5, formation: 'cluster' },
      { delay: 6.0, type: 'aragonite', n: 10, interval: 0.1, formation: 'cluster' },
      { delay: 6.0, gate: true, type: 'opal', n: 2, interval: 1.0, formation: 'pair' },
      { delay: 1.0, type: 'zircon', n: 2, formation: 'pair' },
      { delay: 3.0, type: 'garnet', n: 3, interval: 0.6, formation: 'arc' },
      { delay: 3.0, type: 'quartz', n: 12, interval: 0.2, formation: 'ring' },
    ],
  },
  {
    rock: 'Geode', tScale: 2.3, speedScale: 1.16, grain: { cell: 110, ret: [600, 2200], twin: 0.0, geode: 1 }, anchors: 4, boss: true,
    tips: ['boss'],
    groups: [],
  },
];

const ENDLESS_ROCKS = [
  'Gabbro', 'Basalt', 'Diorite', 'Gneiss', 'Marble', 'Peridotite', 'Andesite', 'Rhyolite',
  'Syenite', 'Anorthosite', 'Kimberlite', 'Dunite', 'Hornfels', 'Serpentinite', 'Trachyte',
  'Phyllite', 'Migmatite', 'Charnockite', 'Tonalite', 'Norite', 'Lherzolite', 'Blueschist',
];

/** Procedural slide for endless mode (index >= CAMPAIGN.length). */
function endlessWave(index) {
  const n = index - CAMPAIGN.length + 1;
  const rnd = mulberry32(9001 + index * 7919);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const costs = [
    ['quartz', 1, 'ring'], ['calcite', 1.5, 'arc'], ['mica', 2.6, 'cluster'], ['aragonite', 0.55, 'cluster'],
    ['opal', 4, 'pair'], ['zircon', 4, 'pair'], ['garnet', 3.5, 'arc'], ['fluorite', 4.5, 'random'],
  ];
  let budget = 34 + n * 9;
  const groups = [];
  let k = 0;
  while (budget > 0) {
    const [type, cost, formation] = pick(costs);
    let count;
    if (type === 'aragonite') count = 8 + Math.floor(rnd() * 6);
    else if (type === 'zircon' || type === 'opal') count = 2;
    else count = 2 + Math.floor(rnd() * (type === 'quartz' ? 9 : 4));
    budget -= cost * count;
    groups.push({
      delay: k === 0 ? 2 : 2.5 + rnd() * 4,
      gate: k > 0 && k % 4 === 0,
      type, n: count, interval: type === 'aragonite' ? 0.1 : 0.35 + rnd() * 0.4, formation,
    });
    k++;
  }
  return {
    rock: pick(ENDLESS_ROCKS),
    grain: { cell: 40 + rnd() * 70, ret: [rnd() * 300, 600 + rnd() * 1600], twin: rnd() * 0.6, stretch: rnd() < 0.3 ? 1 : 0 },
    anchors: 4, groups, endless: true, hpScale: 1 + 0.08 * n, speedScale: 1.16 + Math.min(0.3, 0.02 * n),
    tScale: 2.3 + 0.1 * n, boss: (index + 1) % 10 === 0,
  };
}

function waveDef(index) {
  return index < CAMPAIGN.length ? CAMPAIGN[index] : endlessWave(index);
}

/** After which (0-based) waves the player picks an accessory plate. */
function upgradeAfter(index) {
  if (index < CAMPAIGN.length) return index === 1 || index === 3 || index === 5 || index === 7 || index === 8;
  return (index - CAMPAIGN.length) % 2 === 1;
}

/* ---------------- tutorial tips ---------------- */
const TIPS = {
  move: { kb: 'Move with W A S D or the arrow keys.', touch: 'Drag on the left side to move.', pad: 'Move with the left stick.' },
  throw: {
    kb: 'Click the field to throw an anchor. Your wave alone is harmless; it takes two to interfere.',
    touch: 'Tap the field to throw an anchor. Your wave alone is harmless; it takes two to interfere.',
    pad: 'Aim with the right stick, press A to throw an anchor. One wave alone is harmless.',
  },
  fringe: { all: 'Bright fringes shatter crystals. Dark lines are safe, for them and for you.' },
  sweep: {
    kb: 'Scroll, or hold Q / E, to sweep the fringes across the field.',
    touch: 'Turn the stage dial to sweep the fringes across the field.',
    pad: 'Hold the triggers to sweep the fringes across the field.',
  },
  calcite: { all: 'Calcite slips along the dark lines. Sweep the fringes onto it.' },
  anchor2: { all: 'A second anchor. Three sources: brighter peaks, longer reach.' },
  recall: {
    kb: 'Right-click recalls your anchors. They strike every crystal on the way back.',
    touch: 'Tap RECALL to pull your anchors back. They strike every crystal on the way back.',
    pad: 'Press B to recall your anchors. They strike every crystal on the way back.',
  },
  beams: { all: 'Anchors set about one λ apart, in a line, throw long steerable beams.' },
  null: {
    kb: 'Opal throws ripples. Hold Space to null them with destructive interference.',
    touch: 'Opal throws ripples. Hold NULL to cancel them with destructive interference.',
    pad: 'Opal throws ripples. Hold RB to cancel them with destructive interference.',
  },
  bells: { all: 'Zircon bells interfere too. Their red fringes burn. Keep to the dark, or shatter a bell.' },
  anchor3: { all: 'A third anchor.' },
  garnet: { all: 'Garnet is isotropic: no fringe can touch it. Hit it with a thrown anchor, a recall, or flying shards.' },
  fluorite: { all: 'Fluorite damps the field around it. Break it with anchors to expose what it shelters.' },
  needles: { all: 'Aragonite needles swarm. Keep the fringes moving.' },
  anchor4: { all: 'A fourth anchor. Four in a line make a lighthouse.' },
  boss: { all: 'The geode’s bells focus on you. Keep moving, null the beam, shatter the bells.' },
};
