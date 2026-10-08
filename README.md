# Isogyre

*A game of interference.*

You cannot shoot. You are a wave source. Throw **anchors**, other sources tuned to you, and the space between you fills with an interference pattern. Where the waves arrive in phase, **bright fringes** shatter the crystals drifting in from the edge of the slide. Where they cancel, **dark lines** are safe, for the crystals and for you. Every attack in the game is an interference pattern, yours or theirs.

The whole game is drawn as a **live cross‑polarised light micrograph**, the view a geologist gets through a polarising microscope. Every colour on screen is computed from the physics of birefringence. There are no sprites, textures or audio samples.

Play: open `index.html`, or `dist/isogyre.html`, a single self-contained file. You need a browser with WebGL 2.

---

## What is new here

### Mechanics

| Idea | How it plays |
| --- | --- |
| **Your weapon is a stationary interference pattern** | Damage only exists where waves add up. Alone, your wave never crosses the damage threshold; it takes two sources to hurt anything. You aim by moving your body and placing anchors, not by pointing. |
| **Phase sweep** | Scrolling (or Q/E, or turning the touch "stage" dial) advances the phase of anchor *n* by *n·φ*. The fringe pattern slides across the field like a comb, and you rake it through crystals. |
| **Arrays are strategy** | Spread anchors out and you get a fine web of spokes for area denial. Put them in a line about one wavelength apart and you get a **phased array**: narrow, long beams that the sweep steers like a lighthouse. The order you threw them in matters, and faint threads show it. |
| **Throw / cycle / recall** | When every anchor is out, a throw relocates the *oldest* one. Recalled anchors fly home and strike everything on the way back. |
| **Enemies understand the field** | Calcite reads the intensity gradient and slips sideways into the dark valleys between your fringes. Garnet and fluorite are isotropic, as they are in nature, so interference cannot touch them; you have to hit them physically with anchors or shrapnel. Fluorite projects a quiet zone that damps your field around it. |
| **Their attacks are interference too** | Zircon bells ring in detuned pairs. Their **red fringes** rotate at the beat frequency, a bullet pattern that falls straight out of the physics. Stand in the dark between them. |
| **Null = destructive interference** | Hold Space to emit an anti-phase wave that cancels incoming ripples and red fringes around you. It draws on a shared energy pool. |
| **The boss is a phased array** | Six bells orbit the Geode, each phased (−k·distance) so their waves converge on a point that trails you. You see the focal spot hunting you. |

### Graphics

- **Michel‑Lévy colour.** Between crossed polarisers, a retardation Γ transmits T(λ) = sin²(πΓ/λ) of each wavelength. `src/optics.js` integrates that against the CIE 1931 colour-matching functions to build the interference colour chart petrographers use, and the whole game is coloured from it. Field intensity becomes retardation, so stronger interference climbs through first-order greys and straw yellows into second-order blues and magentas, then third-order pastels.
- **The playfield shader** evaluates the full complex wave sum at every pixel, every frame. Fringes are not pre-drawn; they are the field. The gameplay code evaluates the same formula on the CPU (`src/field.js`), so what you see is exactly what hurts.
- **Chladni sand.** Up to 65k GPU particles are thrown about wherever the medium vibrates and come to rest in the dark valleys. Sand traces the safe lines for you, as it does on a vibrating plate.
- **Crystals** are birefringent wedges, so colour bands run across them. They blink through extinction every 90° as they spin, photoelastic stress fringes bloom inside them as they take damage, and they break into shards along random cleavage planes.
- **Avatars are conoscopic interference figures.** You are a uniaxial figure, a black isogyre cross over rainbow isochromes. Anchors are biaxial figures, Cassini ovals with curved brushes.
- **A thin-section mosaic** of Voronoi grains with twinning and undulose extinction sits beneath everything. It twinkles through extinction as you sweep, the way grains do when a geologist turns the microscope stage.
- **The HUD is the microscope.** The stage goniometer rotates with your phase, there is a λ scale bar in µm, objective markings, and upgrade cards drawn as glass slides with frosted labels.

## Controls

| | Keyboard and mouse | Touch | Gamepad |
| --- | --- | --- | --- |
| Move | W A S D / arrows | drag on the left side | left stick |
| Throw anchor | click the field | tap the field | aim with right stick, A |
| Sweep fringes | mouse wheel, or Q / E | turn the STAGE dial | triggers |
| Recall anchors | right-click or R | RECALL | B |
| Null | hold Space | hold NULL | RB |
| Focus (Bertrand lens, once unlocked) | hold Shift | hold FOCUS | LB |
| Pause | Esc / P | II | Start |

M mutes. The tutorial hints can be switched off in settings, which also hold volume, quality and a reduced-motion mode that removes screen shake and travelling ripples.

## Structure

Ten slides (waves), each a different rock: Granite, Quartzite, Mica Schist, Opaline Chert, Zircon Pegmatite, Garnet Amphibolite, Fluorite Vein, Aragonite Shell, Eclogite, and the Geode boss. Between slides you pick one of three **accessory plates** (upgrades), named after real polarising-microscope accessories: Quarter-Wave Plate, Sensitive Tint, Bertrand Lens, and others. After the Geode the stage keeps turning into an endless run of procedurally composed slides.

## Development

No dependencies and no build step to play. Plain classic scripts, so `index.html` works from `file://`.

```
index.html          page shell, screens, settings
src/optics.js       Michel-Lévy chart from CIE colour matching
src/shaders.js      all GLSL: playfield, dust, crystals, figures, bloom, composite
src/render.js       WebGL 2 renderer (render targets, passes)
src/field.js        CPU wave field (mirrors the shader)
src/game.js         state machine, player, anchors, sweep, sources
src/entities.js     crystals, shards, ripples, pickups, spawn director
src/bestiary.js     crystal species and their behaviour
src/boss.js         the Geode and its phased-array choir
src/waves.js        the ten slides, endless generator, tutorial text
src/upgrades.js     accessory plates
src/scene.js        game state -> renderer frame description
src/hud.js          microscope-engraving HUD (2D canvas)
src/ui.js, input.js, audio.js, main.js
src/bot.js          autopilot used by the tools below
```

```sh
node tools/build.mjs          # -> dist/isogyre.html (single file) and dist/fragment.html
node tools/sim.mjs 6 1 12     # headless balance run: 6 runs, bot skill 1.0, 12 slides
python3 -m http.server 8777 & node tools/smoke.mjs   # Playwright smoke test + screenshots
```

The simulator runs the real game code in a Node VM with the autopilot. It reports per-slide duration, damage taken, and how far from the player crystals shatter, which is how the difficulty curve was tuned. The smoke test plays the game in headless Chromium, captures screenshots of every screen on desktop and phone, and fails on any console error.

Fonts: Bodoni Moda and IBM Plex, loaded from Google Fonts with system fallbacks. Sound is synthesised live with Web Audio. Every source you place hums a note of a pentatonic chord, and sweeping detunes each hum by exactly the sweep rate, so you hear the beat you are making.
