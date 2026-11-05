// 30k-particle field that morphs between dot-cloud images as the page scrolls.
//
// Two movement models:
//   "original" — each particle eases toward a target lerped between scene A
//                and scene B by scroll progress (the original site).
//   "steer"    — each particle flips its attractor from A to B at its own point
//                in the transition, then flies there as a physarum-style agent:
//                a capped homing turn toward the target plus a turn toward the
//                brighter of two look-ahead samples of a ridged-noise field.
//                Near the target it blends into a critically damped spring so
//                it lands cleanly.
//
// On page load every particle uses the "original" easing until it has landed
// once (a quick drop into the first image); steering only kicks in for
// transitions after that.
//
// Rendering is Canvas 2D, batched by opacity, with fast particles drawn as
// tapered streaks along their last frame of motion.

import { makeNoiseTexture } from "./noise";
import type { Scene } from "./scenes";

export const PARTICLE_COUNT = 30000;

export type Mode = "original" | "steer";

/** Steering + rendering parameters (units: px and px/frame; frame-locked). Mutable for live tuning. */
export const SIM = {
  mode: "steer" as Mode,
  // Landing
  attract: 0.2, // how hard velocity tracks the "arrive" velocity (~4 * arriveK = critically damped)
  arriveK: 0.05, // desired speed = distance * arriveK (slows on approach)...
  settleRadius: 40, // ...and sensing fades out inside this distance so particles can land
  damping: 1,
  // Flight
  homing: 0.07, // max radians/frame of turn toward the target (below ~0.05 particles orbit)
  accel: 0.15, // how fast speed eases toward the desired speed
  maxSpeed: 14, // top speed...
  speedVar: 0.3, // ...per particle: maxSpeed * (1 ± speedVar)
  stagger: 1, // spread of when particles switch attractor during a transition
  // Sensors
  sensorDist: 28, // look-ahead distance
  sensorAngle: 0.55, // radians off heading for the left/right sensors (~32°)
  turnGain: 6, // radians of turn per unit brightness difference (L - R)
  maxTurn: 0.3, // radians/frame cap on the sensor turn
  alignMin: 0, // sensing off when cos(heading vs target dir) < this (0 = >90° off course)
  // Field
  texDrift: 0.15, // texels/frame the noise texture slides, so routes vary over time
  showField: false, // debug: draw the noise field under the particles
  // Streaks
  streak: 1, // streak length in frames of motion (1 = exactly bridges the per-frame gap, 0 = dots)
  streakTaper: 0.7, // 0 = uniform width, 1 = tail tapers to a point
  streakFade: 0.3, // 0 = streaks keep full opacity, 1 = true motion blur (ink spread over the streak)
};

/** Noise-field parameters. Everything except texelPx needs rebuildField(). */
export const FIELD = {
  size: 256, // texture resolution (texels per side); it tiles
  texelPx: 4, // screen px per texel (live)
  features: 5, // base-octave features across one tile (higher = busier)
  octaves: 3, // fBm layers of detail
  lacunarity: 2, // frequency multiplier per octave
  gain: 0.5, // amplitude multiplier per octave (roughness)
  ridged: true, // 1 - |n|: thin bright veins. false = soft blobs
  sharpness: 3, // contrast exponent; higher = thinner, more isolated ridges
  seed: 7,
};

const INK_LIGHT = { r: 26, g: 26, b: 26 };
const INK_DARK = { r: 245, g: 241, b: 232 };
const ALPHA_BUCKETS = 16;
// Subpaths per fill() call. One giant path of overlapping shapes is very slow
// to rasterize (cost grows superlinearly); small chunks are ~10x faster.
const DRAW_CHUNK = 32;

type Target = { x: number; y: number; size: number; opacity: number };

type Particle = {
  cx: number; cy: number; // current position
  lx: number; ly: number; // position last frame (for streaks)
  cSize: number; cOpacity: number;
  tx: number; ty: number; tSize: number; tOpacity: number; // current target
  vx: number; vy: number;
  speed: number; // "original" mode: easing rate at rest
  speedJitter: number; // -1..1, scales top speed by SIM.speedVar
  driftOffsetX: number; driftOffsetY: number; driftSpeedX: number; driftSpeedY: number; driftRadius: number;
  flightStagger: number; // 0..0.4: when this particle switches attractor
  landed: boolean; // has reached a target once (until then: quick-drop easing)
};

function randomHiddenTarget(w: number, h: number): Target {
  return { x: Math.random() * w * 1.4 - 0.2 * w, y: Math.random() * h * 1.4 - 0.2 * h, size: 0.2 + 0.6 * Math.random(), opacity: 0 };
}

/** Maps a scene's dots into screen space. Extra particles get invisible random targets. */
function buildTargets(scene: Scene, vw: number, vh: number): Target[] {
  const targets: Target[] = [];
  const { dotData, anchor, scale, scaleBreakpoints, rotation } = scene;
  const rad = (rotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  let s = scale;
  if (scaleBreakpoints) {
    for (const bp of [...scaleBreakpoints].sort((a, b) => a.maxWidth - b.maxWidth)) {
      if (vw <= bp.maxWidth) { s = bp.scale; break; }
    }
  }
  if (!dotData) {
    for (let i = 0; i < PARTICLE_COUNT; i++) targets.push(randomHiddenTarget(vw, vh));
    return targets;
  }
  const { meta, dots } = dotData;
  const drawH = s * vh;
  const drawW = drawH * (meta.width / meta.height);
  const cx = anchor.x * vw, cy = anchor.y * vh;
  const sx = drawW / meta.width, sy = drawH / meta.height;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    if (i < dots.length) {
      const d = dots[i];
      const lx = d.x * sx - drawW / 2, ly = d.y * sy - drawH / 2;
      targets.push({ x: cx + (lx * cos - ly * sin), y: cy + (lx * sin + ly * cos), size: d.size * sx, opacity: d.opacity });
    } else {
      targets.push(randomHiddenTarget(vw, vh));
    }
  }
  return targets;
}

function createParticles(vw: number, vh: number): Particle[] {
  const ps: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const depth = Math.random();
    const cx = Math.random() * vw, cy = -50 - Math.random() * vh * 1.5; // start above the screen
    ps.push({
      cx, cy, lx: cx, ly: cy,
      cSize: 0.2 + 0.6 * Math.random(), cOpacity: 0,
      tx: 0, ty: 0, tSize: 1, tOpacity: 0,
      vx: 0, vy: 0,
      speed: 0.08 + 0.07 * depth,
      speedJitter: Math.random() * 2 - 1,
      driftOffsetX: Math.random() * Math.PI * 2,
      driftOffsetY: Math.random() * Math.PI * 2,
      driftSpeedX: 0.3 + 0.7 * Math.random(),
      driftSpeedY: 0.3 + 0.7 * Math.random(),
      driftRadius: 0.2 + 0.4 * Math.random(),
      flightStagger: 0.4 * Math.random(),
      landed: false,
    });
  }
  return ps;
}

export type ParticleFieldHandle = {
  destroy: () => void;
  rebuildField: () => void;
  step: () => void;
  draw: () => void;
};

/**
 * Starts the animation on `canvas`. `getProgress()` returns a float in
 * [0, scenes.length - 1]: integer = resting on that scene, fraction = mid-transition.
 */
export function createParticleField(
  canvas: HTMLCanvasElement,
  scenes: Scene[],
  getProgress: () => number,
): ParticleFieldHandle {
  const ctx = canvas.getContext("2d")!;
  let vw = 0, vh = 0, time = 0, raf = 0;
  let targetsByScene: Target[][] = [];
  let mouse: { x: number; y: number } | null = null;
  let ink = INK_LIGHT;

  // ---- Noise field ---------------------------------------------------------
  let texN = 0;
  let tex: Float32Array = new Float32Array(0);
  let texOffX = 0, texOffY = 0;
  let fieldPattern: CanvasPattern | null = null; // debug overlay, built lazily
  const rebuildField = () => {
    texN = FIELD.size | 0;
    tex = makeNoiseTexture(texN, FIELD.seed | 0, FIELD);
    fieldPattern = null;
  };
  /** Bilinear sample (0..1) of the tiled, drifting texture at a screen position. */
  const sampleField = (px: number, py: number) => {
    let u = px / FIELD.texelPx + texOffX, v = py / FIELD.texelPx + texOffY;
    u -= Math.floor(u / texN) * texN; v -= Math.floor(v / texN) * texN;
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
    const x1 = (x0 + 1) % texN, y1 = (y0 + 1) % texN;
    const r0 = y0 * texN, r1 = y1 * texN;
    const a = tex[r0 + x0], b = tex[r0 + x1], c = tex[r1 + x0], d = tex[r1 + x1];
    const top = a + (b - a) * fx;
    return top + (c + (d - c) * fx - top) * fy;
  };
  rebuildField();

  // ---- Setup -------------------------------------------------------------
  const layout = () => {
    vw = window.innerWidth; vh = window.innerHeight;
    targetsByScene = scenes.map((s) => buildTargets(s, vw, vh));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = vw * dpr; canvas.height = vh * dpr;
    canvas.style.width = `${vw}px`; canvas.style.height = `${vh}px`;
  };
  layout();
  const particles = createParticles(vw, vh);

  const updateInk = () => { ink = document.documentElement.classList.contains("dark") ? INK_DARK : INK_LIGHT; };
  updateInk();
  const themeObserver = new MutationObserver(updateInk);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const onMove = (e: MouseEvent) => { mouse = { x: e.clientX, y: e.clientY }; };
  const onLeave = () => { mouse = null; };
  window.addEventListener("resize", layout);
  window.addEventListener("mousemove", onMove);
  document.addEventListener("mouseleave", onLeave);

  // Mouse repulsion (70px radius), shared by both modes.
  const repel = (p: Particle) => {
    if (!mouse) return;
    const mx = p.cx - mouse.x, my = p.cy - mouse.y, dist = Math.sqrt(mx * mx + my * my);
    if (dist < 70 && dist > 0) {
      const f = (1 - dist / 70) * 0.075;
      p.vx += (mx / dist) * f; p.vy += (my / dist) * f;
    }
  };

  // ---- "original": ease toward a scroll-lerped target -------------------
  const updateOriginal = (p: Particle, a: Target, b: Target, eased: number, t: number, dx: number, dy: number) => {
    p.tx = a.x + (b.x - a.x) * eased;
    p.ty = a.y + (b.y - a.y) * eased;
    p.tSize = a.size + (b.size - a.size) * eased;
    p.tOpacity = a.opacity + (b.opacity - a.opacity) * eased;
    repel(p);
    p.vx *= 0.9; p.vy *= 0.9;
    const k = t > 0.005 ? 0.12 : p.speed;
    p.cx += (p.tx + dx - p.cx) * k + p.vx;
    p.cy += (p.ty + dy - p.cy) * k + p.vy;
    p.cSize += (p.tSize - p.cSize) * k;
    p.cOpacity += (p.tOpacity - p.cOpacity) * k;
  };

  // ---- "steer": physarum-style flight + damped landing --------------------
  const updateSteer = (p: Particle, a: Target, b: Target, t: number, dx: number, dy: number) => {
    const switchAt = 0.1 + p.flightStagger * SIM.stagger; // 0.1..0.5 of the transition
    const T = t >= switchAt ? b : a;
    p.tx = T.x; p.ty = T.y; p.tSize = T.size; p.tOpacity = T.opacity;

    const gx = T.x + dx - p.cx, gy = T.y + dy - p.cy; // to attractor (+ idle wobble)
    const d = Math.sqrt(gx * gx + gy * gy) || 1e-6;
    const ux = gx / d, uy = gy / d;
    const topSpeed = SIM.maxSpeed * (1 + SIM.speedVar * p.speedJitter);
    const desiredSpeed = Math.min(topSpeed, d * SIM.arriveK);
    // far: 0 inside settleRadius, 1 beyond 2 * settleRadius. Blends landing -> flight.
    const far = d <= SIM.settleRadius ? 0 : Math.min(1, (d - SIM.settleRadius) / SIM.settleRadius);

    // Landing: critically damped "arrive" spring.
    let vx = p.vx + (ux * desiredSpeed - p.vx) * SIM.attract;
    let vy = p.vy + (uy * desiredSpeed - p.vy) * SIM.attract;

    if (far > 0) {
      // Flight: speed eases toward desiredSpeed; heading only *turns*.
      const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const hx = sp > 0.05 ? p.vx / sp : ux, hy = sp > 0.05 ? p.vy / sp : uy;
      const align = hx * ux + hy * uy; // cos(heading vs target dir)
      const cross = hx * uy - hy * ux; // sign = which side the target is on
      let turn = Math.max(-SIM.homing, Math.min(SIM.homing, Math.atan2(cross, align)));

      // Alignment gate: only follow the field while heading roughly toward
      // the target, so nobody orbits a closed ridge loop forever.
      const gate = Math.min(1, Math.max(0, (align - SIM.alignMin) / (1 - SIM.alignMin)));
      if (gate > 0) {
        const ca = Math.cos(SIM.sensorAngle), sa = Math.sin(SIM.sensorAngle), sd = SIM.sensorDist;
        const L = sampleField(p.cx + (hx * ca - hy * sa) * sd, p.cy + (hx * sa + hy * ca) * sd);
        const R = sampleField(p.cx + (hx * ca + hy * sa) * sd, p.cy + (-hx * sa + hy * ca) * sd);
        turn += Math.max(-SIM.maxTurn, Math.min(SIM.maxTurn, (L - R) * SIM.turnGain)) * gate;
      }
      const c = Math.cos(turn), s = Math.sin(turn);
      const nhx = hx * c - hy * s, nhy = hx * s + hy * c;
      // Slow down while pointed away from the target: tight turnarounds, no wide overshoot loops.
      const flightSpeed = desiredSpeed * (0.25 + 0.75 * Math.max(0, align));
      const nsp = sp + (flightSpeed - sp) * SIM.accel;
      vx += (nhx * nsp - vx) * far;
      vy += (nhy * nsp - vy) * far;
    }
    p.vx = vx; p.vy = vy;

    repel(p);
    p.vx *= SIM.damping; p.vy *= SIM.damping;
    p.cx += p.vx; p.cy += p.vy;
    p.cSize += (p.tSize - p.cSize) * 0.1;
    p.cOpacity += (p.tOpacity - p.cOpacity) * 0.1;
  };

  const step = () => {
    time += 0.016;
    texOffX += SIM.texDrift; texOffY += SIM.texDrift * 0.37;
    const progress = getProgress();
    const from = Math.floor(progress);
    const to = Math.min(from + 1, targetsByScene.length - 1);
    const t = progress - from;
    const A = targetsByScene[from], B = targetsByScene[to];
    if (!A || !B) return;
    const eased = t * t * (3 - 2 * t); // smoothstep
    const driftA = scenes[from]?.driftScale ?? 1;
    const drift = driftA + ((scenes[to]?.driftScale ?? 1) - driftA) * t;
    const steer = SIM.mode === "steer";

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i], a = A[i], b = B[i];
      if (!a || !b) continue;
      const dx = Math.sin(time * p.driftSpeedX + p.driftOffsetX) * p.driftRadius * drift;
      const dy = Math.cos(time * p.driftSpeedY + p.driftOffsetY) * p.driftRadius * drift;
      p.lx = p.cx; p.ly = p.cy;
      if (steer && p.landed) updateSteer(p, a, b, t, dx, dy);
      else {
        updateOriginal(p, a, b, eased, t, dx, dy);
        if (!p.landed && Math.abs(p.tx + dx - p.cx) < 2 && Math.abs(p.ty + dy - p.cy) < 2) {
          p.landed = true;
          p.vx = 0; p.vy = 0; // steering starts from rest (vx/vy only held mouse push until now)
        }
      }
    }
  };

  // ---- Rendering -----------------------------------------------------------
  const bucketStart = new Int32Array(ALPHA_BUCKETS + 1);
  const order = new Int32Array(PARTICLE_COUNT);
  const bucketOf = new Int8Array(PARTICLE_COUNT);

  const drawField = () => {
    if (!fieldPattern) {
      const off = document.createElement("canvas");
      off.width = off.height = texN;
      const octx = off.getContext("2d")!;
      const img = octx.createImageData(texN, texN);
      for (let i = 0; i < tex.length; i++) {
        img.data[i * 4] = 200; img.data[i * 4 + 1] = 90; img.data[i * 4 + 2] = 40;
        img.data[i * 4 + 3] = tex[i] * 127;
      }
      octx.putImageData(img, 0, 0);
      fieldPattern = ctx.createPattern(off, "repeat");
    }
    ctx.save();
    ctx.scale(FIELD.texelPx, FIELD.texelPx);
    ctx.translate(-texOffX, -texOffY);
    ctx.fillStyle = fieldPattern!;
    ctx.fillRect(texOffX, texOffY, vw / FIELD.texelPx, vh / FIELD.texelPx);
    ctx.restore();
  };

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    if (SIM.showField) drawField();

    // Counting-sort particles into opacity buckets: one fillStyle per bucket
    // instead of one per particle.
    bucketStart.fill(0);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let o = p.cOpacity;
      if (SIM.streakFade > 0 && SIM.streak > 0) {
        // Motion blur: the same ink spread over a longer shape reads lighter.
        const r = Math.max(0.3, p.cSize), mx = p.cx - p.lx, my = p.cy - p.ly;
        const len = Math.sqrt(mx * mx + my * my) * SIM.streak;
        if (len > 2 * r) o *= 1 - SIM.streakFade * (1 - (2 * r) / (2 * r + len));
      }
      const bk = o < 0.005 ? -1 : Math.min(ALPHA_BUCKETS - 1, (o * ALPHA_BUCKETS) | 0);
      bucketOf[i] = bk;
      if (bk >= 0) bucketStart[bk + 1]++;
    }
    for (let k = 1; k <= ALPHA_BUCKETS; k++) bucketStart[k] += bucketStart[k - 1];
    const cursor = bucketStart.slice(0, ALPHA_BUCKETS);
    for (let i = 0; i < particles.length; i++) {
      const bk = bucketOf[i];
      if (bk >= 0) order[cursor[bk]++] = i;
    }

    for (let k = 0; k < ALPHA_BUCKETS; k++) {
      const start = bucketStart[k], end = bucketStart[k + 1];
      if (start === end) continue;
      ctx.fillStyle = `rgba(${ink.r},${ink.g},${ink.b},${(k + 0.5) / ALPHA_BUCKETS})`;
      ctx.beginPath();
      for (let j = start; j < end; j++) {
        if (j > start && (j - start) % DRAW_CHUNK === 0) { ctx.fill(); ctx.beginPath(); }
        const p = particles[order[j]], r = Math.max(0.3, p.cSize);
        const mx = (p.cx - p.lx) * SIM.streak, my = (p.cy - p.ly) * SIM.streak;
        const len2 = mx * mx + my * my;
        if (len2 > 4 * r * r) {
          // Streak: tapered quad from the head back along this frame's motion.
          // Vertex order matches the winding of rect()/arc() so overlapping
          // shapes in one path don't cancel under the nonzero fill rule.
          const len = Math.sqrt(len2), nx = -my / len, ny = mx / len;
          const hw = r, tw = r * (1 - SIM.streakTaper);
          const tx = p.cx - mx, ty = p.cy - my;
          ctx.moveTo(p.cx - nx * hw, p.cy - ny * hw);
          ctx.lineTo(p.cx + nx * hw, p.cy + ny * hw);
          ctx.lineTo(tx + nx * tw, ty + ny * tw);
          ctx.lineTo(tx - nx * tw, ty - ny * tw);
          ctx.closePath();
        } else if (r < 1.25) {
          // Tiny dots: an equal-area square looks the same and is much cheaper than arc().
          const side = r * 1.7725; // sqrt(pi) * r
          ctx.rect(p.cx - side / 2, p.cy - side / 2, side, side);
        } else {
          ctx.moveTo(p.cx + r, p.cy);
          ctx.arc(p.cx, p.cy, r, 0, 2 * Math.PI);
        }
      }
      ctx.fill();
    }
  };

  const frame = () => { step(); draw(); raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);

  return {
    destroy: () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      window.removeEventListener("resize", layout);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    },
    rebuildField,
    step,
    draw,
  };
}
