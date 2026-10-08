'use strict';
/*
 * ISOGYRE — accessory plates (upgrades). A polarising microscope has a slot for
 * accessory plates and lenses; between slides you insert one.
 */
const Upgrades = [
  {
    id: 'anchor', name: 'Spare Anchor', tag: 'SOURCE', max: 2, weight: 1.0,
    desc: 'One more anchor. Every extra source squares the peak brightness it can add.',
  },
  {
    id: 'lamp', name: 'Brighter Lamp', tag: 'AMPLITUDE', max: 3, weight: 1.2,
    desc: 'All your sources ring 18% louder. Fringes cut deeper and reach farther.',
  },
  {
    id: 'aperture', name: 'Wider Aperture', tag: 'REACH', max: 2, weight: 1.0,
    desc: 'Waves fade more slowly with distance: +35% reach for every fringe.',
  },
  {
    id: 'beat', name: 'Detuned Fork', tag: 'AUTO-SWEEP', max: 2, weight: 0.9,
    desc: 'Your anchors ring a hair sharp. The beat sweeps the pattern on its own.',
  },
  {
    id: 'echo', name: 'Afterglow', tag: 'CHAIN', max: 2, weight: 1.0,
    desc: 'A shattered crystal keeps ringing for a few seconds and adds its wave to yours.',
  },
  {
    id: 'cleave', name: 'Perfect Cleavage', tag: 'SHRAPNEL', max: 2, weight: 0.9,
    desc: 'Crystals burst into more, faster shards that cut garnet and fluorite.',
  },
  {
    id: 'tint', name: 'Sensitive Tint', tag: 'SLOW', max: 2, weight: 0.9,
    desc: 'Crystals caught in a bright fringe stall: 40% slower per plate.',
  },
  {
    id: 'qwp', name: 'Quarter-Wave Plate', tag: 'NULL', max: 2, weight: 0.9,
    desc: 'The null drains 35% slower, recharges faster and covers more ground.',
  },
  {
    id: 'anneal', name: 'Annealing', tag: 'HEAL', max: 2, weight: 0.8,
    desc: 'After three seconds unharmed, coherence slowly returns.',
  },
  {
    id: 'stroke', name: 'Return Stroke', tag: 'RECALL', max: 2, weight: 0.8,
    desc: 'Recalled anchors fly back faster and strike three times as hard.',
  },
  {
    id: 'stage', name: 'Mechanical Stage', tag: 'FORMATION', max: 1, weight: 0.6,
    desc: 'Anchors travel with you and keep their formation. Your pattern becomes portable.',
  },
  {
    id: 'overtone', name: 'Overtone', tag: 'HARMONIC', max: 2, weight: 0.8,
    desc: 'Adds the second harmonic: a finer lattice of fringes woven through your own.',
  },
  {
    id: 'bertrand', name: 'Bertrand Lens', tag: 'FOCUS', max: 1, weight: 0.7, minWave: 4,
    desc: 'Hold Shift (or FOCUS) to phase every source onto one point. Drains the null.',
  },
];

/** Pick `n` distinct offers, weighted, respecting caps. */
function rollUpgrades(levels, waveIndex, n = 3, forceFirst = null) {
  const pool = Upgrades.filter((u) => (levels[u.id] || 0) < u.max && (u.minWave || 0) <= waveIndex);
  const out = [];
  if (forceFirst) {
    const f = pool.find((u) => u.id === forceFirst);
    if (f) { out.push(f); pool.splice(pool.indexOf(f), 1); }
  }
  while (out.length < n && pool.length) {
    let total = 0;
    for (const u of pool) total += u.weight;
    let r = Rng.next() * total;
    let pick = pool[pool.length - 1];
    for (const u of pool) { r -= u.weight; if (r <= 0) { pick = u; break; } }
    out.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return out;
}
