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
    engine.ts          the particle field (simulation + rendering)
    noise.ts           seeded 3D simplex + tileable ridged-noise texture
    scenes.ts          per-section image placement + .bin loader
    ParticleCanvas.tsx React wrapper (desktop only)
    TuningPanel.tsx    live controls (slider icon bottom-left, or press H)
hooks/                 useScrollProgress, useIsMobile
lib/data.ts            all page copy
scripts/pack-dots.mjs  JSON dot clouds -> .bin
```

## The particle field

`engine.ts` has two movement models. Switch between them in the tuning panel.

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
- **Live 3D noise (z = time).** About 3× the sim cost, with no visible
  aesthetic gain over a slowly drifting static texture.

## Running

```bash
npm install
npm run dev                      # http://localhost:3000
npm run build                    # static export -> out/
# preview build as hosted at jacksoncallaway.com/for-chris:
NEXT_PUBLIC_BASE_PATH=/for-chris NEXT_PUBLIC_NOINDEX=1 \
  NEXT_PUBLIC_SOURCE_URL=https://github.com/jcksncllwy/christopherngai-site npm run build
```
