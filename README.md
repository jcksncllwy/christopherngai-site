# christopherngai.com: reconstruction + particle experiments

This is a source reconstruction of christopherngai.com, plus an experimental
steering mode for the particle field.

## Where this came from

The live site ships only minified bundles. It publishes no source maps, and the
current site's repo isn't public. So this was **decompiled by hand** from the
production JS and CSS:

- **Faithful:** the component tree and JSX, and every Tailwind class string
  (they survive minification verbatim). Also the content, the logic,
  breakpoints, animations, theme handling, and the Tailwind v4 `@theme` tokens
  recovered from the compiled CSS.
- **Invented:** file layout, component and variable names, TypeScript types,
  and comments. Minification throws all of that away, so it will read like your
  code without being your code.
- **Deliberate changes**
  - Dot data loads at runtime from `public/dots/*.bin`. The format is 6 bytes
    per dot, about 1 MB in total. The original bundles about 10 MB of JSON into
    the JS chunk. Only the first 30k dots per image are kept, which matches the
    original (images with 34.5k–40k dots were already truncated to 30k
    particles).
  - The resume link points at the live site, because this copy is hosted
    elsewhere.
  - `next.config.ts` builds a static export, with an optional
    `NEXT_PUBLIC_BASE_PATH`.
  - `NEXT_PUBLIC_NOINDEX=1` sets robots to noindex, for preview copies.
  - `NEXT_PUBLIC_SOURCE_URL` adds a small "source" link (bottom-left) pointing
    at this repo.
  - On first load, particles use the original quick drop into the first image.
    The steering flight only plays on transitions between sections.

Stack: Next 16.1.6 (App Router, Turbopack) · React 19 · Tailwind 4 ·
framer-motion · lucide-react · next/font (Inter, Fraunces, Montserrat).

## Layout

```
app/
  layout.tsx           fonts, metadata, pre-paint theme script
  page.tsx             snap scroller, nav, arrows, particle layer
  globals.css          theme tokens, type scale, utilities
components/
  sections/            Intro, Experience, Projects, Education, Skills, Interests
  ContactLinks.tsx     top-right icon bar
  SectionNav.tsx       dot nav + progress bar
  ThemeToggle.tsx      light/dark (html.dark + localStorage "theme-dark")
  PaperBackground.tsx  crumpled-paper texture
  SectionSlide.tsx     per-section snap wrapper (horizontal desktop, vertical mobile)
  NavArrow.tsx
  particles/
    engine.ts          picks a render engine
    shared.ts          params, targets, packed particle state, frame stats
    canvas2d.ts        CPU sim + Canvas 2D rendering
    webgpu.ts          compute-shader sim + instanced rendering (WGSL inline)
    noise.ts           seeded 3D simplex + tileable ridged-noise texture
    scenes.ts          per-section image placement + .bin loader
    ParticleCanvas.tsx React wrapper (desktop only), engine switching + state handoff
    TuningPanel.tsx    live controls + perf stats (slider icon bottom-left, or press H)
hooks/                 useScrollProgress, useIsMobile
lib/data.ts            all page copy
scripts/pack-dots.mjs  JSON dot clouds -> .bin
```

## The particle field

`canvas2d.ts` and `webgpu.ts` implement the same two movement models (see
"Render engines" below). Switch between them in the tuning panel.

**original:** your existing behaviour. Each particle eases toward a target that
is lerped between the current scene's dot and the next one's by scroll
progress.

**steer** (default): an experiment in giving particles a natural-looking flight
path between images.

1. **Staggered attractor switch.** Partway through a transition, each particle
   flips its target from image A to image B. When it flips is set by your
   previously unused `flightStagger` (0.1–0.5 of the transition). From then on
   it flies under its own velocity, so the flight plays out over time instead of
   being tied to the scroll position.
2. **Physarum-style flight.** Speed eases toward a desired speed, and the
   heading only turns. Each frame a particle gets:
   - a capped *homing* turn toward its target, and
   - a *sensor* turn: it samples a ridged-noise texture ahead-left and
     ahead-right of its heading, and turns toward the brighter sample.

   The ridges act like trails, so particles bundle into veins as they travel.
3. **Alignment gate.** A particle stops listening to the field once it's
   pointed more than about 90° away from its target. Without this, particles
   orbit closed ridge loops forever.
4. **Landing.** Within `settleRadius` it blends into a critically damped
   "arrive" spring (`attract ≈ 4 × arriveK`), so it lands without overshooting.
5. **Speed variance.** Each particle's top speed is `maxSpeed × (1 ± speedVar)`,
   which stops strands moving in lockstep and banding.

Rendering is still Canvas 2D, but:

- **Batched by opacity.** Particles are bucketed into 16 alpha levels, so there
  are 16 fill colours per frame instead of 30k `fillStyle` + `fill()` calls.
- **Chunked paths.** Each bucket is filled in chunks of 32 shapes. One huge path
  of overlapping shapes rasterizes superlinearly slowly. Chunking made drawing
  about 10× faster with streaks, and about 2× faster with plain dots.
- **Squares for tiny dots.** Dots under about 1.25px are drawn as equal-area
  squares instead of `arc()`. They look identical and are much cheaper.
- **Streaks.** Fast particles are drawn as tapered quads stretched back along
  their last frame of motion, so streak length follows speed. The winding order
  matches `rect()`/`arc()` so overlapping shapes in one path don't punch holes
  under the nonzero fill rule.

Rough numbers in headless Chrome (software rendering, 1440×900, mid-transition):

| | sim step | draw |
|---|---|---|
| original movement, per-particle fills | ~1 ms | ~46 ms |
| original movement, batched | ~1 ms | ~11 ms |
| steer + streaks, batched + chunked | ~4 ms | ~20–28 ms |

Things that were tried and dropped:

- **Curl-noise offsets on a lerped path.** It read as a random cloud.
- **Live 3D noise (z = time)** was dropped on Canvas 2D, where it cost far more
  than the sim. It's back as a toggle, because on WebGPU it costs almost
  nothing.

## Render engines

The tuning panel (bottom-left icon, or `H`) switches engines at run time. The
running engine's particles are read back and handed to the new one, so the
switch doesn't restart the animation.

- **Canvas 2D (CPU)** (`canvas2d.ts`): the sim is a JS loop on the main
  thread, and every particle becomes path geometry for the 2D context to
  rasterize.
- **WebGPU** (`webgpu.ts`): the sim is a compute shader (one invocation per
  particle, ported line for line from the Canvas 2D engine). Particles are
  drawn in one instanced draw of 4-vertex quads (tapered streak, square, or SDF
  circle) with 4× MSAA. Particle state never leaves the GPU, so the CPU only
  uploads about 200 bytes of uniforms per frame.

`shared.ts` holds the parameters, scene → target mapping, the packed particle
state format and the stats helper. `engine.ts` picks an engine.

The panel also has:

- **particles:** 30k (the original) up to 1M. Extra particles reuse the scene's
  dots with a little jitter, and opacity is scaled by 30k / count so the image
  keeps its tone.
- **live 3D noise:** regenerates the steering field every frame as a slice
  through 3D simplex noise (z advances by `noiseSpeed`). On Canvas 2D this runs
  in JS on the main thread. On WebGPU it's a compute pass using the same
  permutation table, so z = 0 matches the CPU texture.
- **stats:** fps and frame interval, CPU time for sim, draw and live noise
  (Canvas 2D) or encoding (WebGPU), and GPU compute and render time from
  `timestamp-query` where the browser exposes it.

Headless Chrome on an M-series Mac, 1440×900. GPU columns are GPU execution time:

| | Canvas 2D: CPU per frame | WebGPU: GPU per frame |
|---|---|---|
| 30k, steer + streaks | ~3 ms sim + ~6 ms draw | ~0.07 ms compute + ~0.55 ms render |
| 30k + live 3D noise | +~70 ms noise | ~0.5 ms compute (noise + sim) |
| 1M + live 3D noise | ~100 ms sim + ~390 ms draw + ~56 ms noise | ~1.9 ms compute + ~8.7 ms render |

Known differences: the Canvas 2D engine quantizes opacity into 16 buckets and
unions overlapping shapes within a 32-shape chunk, so it reads slightly darker.
WebGPU blends every particle at its exact opacity. Live noise on the GPU is
normalized with the static texture's range instead of a per-frame min/max.

## Running

```bash
npm install
npm run dev                      # http://localhost:3000
npm run build                    # static export -> out/
# preview build as hosted at jacksoncallaway.com/for-chris:
NEXT_PUBLIC_BASE_PATH=/for-chris NEXT_PUBLIC_NOINDEX=1 \
  NEXT_PUBLIC_SOURCE_URL=https://github.com/jcksncllwy/christopherngai-site npm run build
```
