// Canvas 2D engine: the sim runs as a JS loop on the main thread and every
// particle becomes vector path geometry that the 2D context rasterizes.
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
// Rendering is batched by opacity, with fast particles drawn as tapered
// streaks along their last frame of motion. webgpu.ts is the same sim and look
// on the GPU.

import { makeNoiseTexture } from "./noise";
import {
  FIELD, FrameStats, P, SIM, STRIDE, buildTargets, resizeState, trackEnvironment, transition,
  type EngineInit, type ParticleEngine, type Targets,
} from "./shared";

const ALPHA_BUCKETS = 16;
// Subpaths per fill() call. One giant path of overlapping shapes is very slow
// to rasterize (cost grows superlinearly); small chunks are ~10x faster.
const DRAW_CHUNK = 32;

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

function unpack(s: Float32Array<ArrayBuffer>, count: number): Particle[] {
  const ps: Particle[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    ps[i] = {
      cx: s[o + P.cx], cy: s[o + P.cy], lx: s[o + P.lx], ly: s[o + P.ly],
      cSize: s[o + P.size], cOpacity: s[o + P.opacity],
      tx: 0, ty: 0, tSize: 1, tOpacity: 0,
      vx: s[o + P.vx], vy: s[o + P.vy],
      speed: s[o + P.speed], speedJitter: s[o + P.jitter],
      driftOffsetX: s[o + P.driftOffX], driftOffsetY: s[o + P.driftOffY],
      driftSpeedX: s[o + P.driftSpdX], driftSpeedY: s[o + P.driftSpdY], driftRadius: s[o + P.driftRadius],
      flightStagger: s[o + P.stagger], landed: s[o + P.landed] > 0.5,
    };
  }
  return ps;
}

function pack(ps: Particle[]): Float32Array<ArrayBuffer> {
  const s = new Float32Array(ps.length * STRIDE);
  ps.forEach((p, i) => {
    const o = i * STRIDE;
    s[o + P.cx] = p.cx; s[o + P.cy] = p.cy; s[o + P.lx] = p.lx; s[o + P.ly] = p.ly;
    s[o + P.vx] = p.vx; s[o + P.vy] = p.vy; s[o + P.size] = p.cSize; s[o + P.opacity] = p.cOpacity;
    s[o + P.speed] = p.speed; s[o + P.jitter] = p.speedJitter;
    s[o + P.driftOffX] = p.driftOffsetX; s[o + P.driftOffY] = p.driftOffsetY;
    s[o + P.driftSpdX] = p.driftSpeedX; s[o + P.driftSpdY] = p.driftSpeedY; s[o + P.driftRadius] = p.driftRadius;
    s[o + P.stagger] = p.flightStagger; s[o + P.landed] = p.landed ? 1 : 0;
  });
  return s;
}

export function createCanvas2DEngine({ canvas, scenes, getProgress, count, state }: EngineInit): ParticleEngine {
  const ctx = canvas.getContext("2d")!;
  let time = 0, raf = 0;
  let targetsByScene: Targets[] = [];
  const stats = new FrameStats();

  // ---- Noise field ---------------------------------------------------------
  let texN = 0;
  let tex: Float32Array<ArrayBuffer> = new Float32Array(0);
  let texOffX = 0, texOffY = 0, texZ = 0;
  let fieldPattern: CanvasPattern | null = null; // debug overlay, built lazily
  const rebuildField = () => {
    texN = FIELD.size | 0;
    tex = makeNoiseTexture(texN, FIELD.seed | 0, FIELD).data;
    texZ = 0;
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
    const { vw, vh } = env;
    targetsByScene = scenes.map((s) => buildTargets(s, vw, vh, count));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = vw * dpr; canvas.height = vh * dpr;
    canvas.style.width = `${vw}px`; canvas.style.height = `${vh}px`;
  };
  const { env, dispose } = trackEnvironment(layout);
  layout();
  const particles = unpack(resizeState(state, count, env.vw, env.vh), count);

  // Mouse repulsion (70px radius), shared by both modes.
  const repel = (p: Particle) => {
    const mouse = env.mouse;
    if (!mouse) return;
    const mx = p.cx - mouse.x, my = p.cy - mouse.y, dist = Math.sqrt(mx * mx + my * my);
    if (dist < 70 && dist > 0) {
      const f = (1 - dist / 70) * 0.075;
      p.vx += (mx / dist) * f; p.vy += (my / dist) * f;
    }
  };

  // ---- "original": ease toward a scroll-lerped target -------------------
  const updateOriginal = (p: Particle, A: Targets, B: Targets, i: number, eased: number, t: number, dx: number, dy: number) => {
    const o = i * 4;
    p.tx = A[o] + (B[o] - A[o]) * eased;
    p.ty = A[o + 1] + (B[o + 1] - A[o + 1]) * eased;
    p.tSize = A[o + 2] + (B[o + 2] - A[o + 2]) * eased;
    p.tOpacity = A[o + 3] + (B[o + 3] - A[o + 3]) * eased;
    repel(p);
    p.vx *= 0.9; p.vy *= 0.9;
    const k = t > 0.005 ? 0.12 : p.speed;
    p.cx += (p.tx + dx - p.cx) * k + p.vx;
    p.cy += (p.ty + dy - p.cy) * k + p.vy;
    p.cSize += (p.tSize - p.cSize) * k;
    p.cOpacity += (p.tOpacity - p.cOpacity) * k;
  };

  // ---- "steer": physarum-style flight + damped landing --------------------
  const updateSteer = (p: Particle, A: Targets, B: Targets, i: number, t: number, dx: number, dy: number) => {
    const switchAt = 0.1 + p.flightStagger * SIM.stagger; // 0.1..0.5 of the transition
    const T = t >= switchAt ? B : A, o = i * 4;
    p.tx = T[o]; p.ty = T[o + 1]; p.tSize = T[o + 2]; p.tOpacity = T[o + 3];

    const gx = p.tx + dx - p.cx, gy = p.ty + dy - p.cy; // to attractor (+ idle wobble)
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

  /** Returns the ms spent regenerating live noise, which is reported separately. */
  const step = (): number => {
    let noiseMs = 0;
    time += 0.016;
    texOffX += SIM.texDrift; texOffY += SIM.texDrift * 0.37;
    if (SIM.liveNoise) {
      // The approach that tanked: regenerate the whole texture on the CPU every
      // frame (N² texels × octaves × 4 tiling corners of simplex noise).
      const t0 = performance.now();
      texZ += SIM.noiseSpeed;
      makeNoiseTexture(texN, FIELD.seed | 0, FIELD, texZ, tex);
      fieldPattern = null;
      noiseMs = performance.now() - t0;
    }
    const { from, to, t, eased, drift } = transition(getProgress(), targetsByScene.length, scenes);
    const A = targetsByScene[from], B = targetsByScene[to];
    if (!A || !B) return noiseMs;
    const steer = SIM.mode === "steer";

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const dx = Math.sin(time * p.driftSpeedX + p.driftOffsetX) * p.driftRadius * drift;
      const dy = Math.cos(time * p.driftSpeedY + p.driftOffsetY) * p.driftRadius * drift;
      p.lx = p.cx; p.ly = p.cy;
      if (steer && p.landed) updateSteer(p, A, B, i, t, dx, dy);
      else {
        updateOriginal(p, A, B, i, eased, t, dx, dy);
        if (!p.landed && Math.abs(p.tx + dx - p.cx) < 2 && Math.abs(p.ty + dy - p.cy) < 2) {
          p.landed = true;
          p.vx = 0; p.vy = 0; // steering starts from rest (vx/vy only held mouse push until now)
        }
      }
    }
    return noiseMs;
  };

  // ---- Rendering -----------------------------------------------------------
  const bucketStart = new Int32Array(ALPHA_BUCKETS + 1);
  const order = new Int32Array(count);
  const bucketOf = new Int8Array(count);

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
    ctx.fillRect(texOffX, texOffY, env.vw / FIELD.texelPx, env.vh / FIELD.texelPx);
    ctx.restore();
  };

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const ink = env.ink;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, env.vw, env.vh);
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

  const frame = (now: number) => {
    stats.tick(now);
    const t0 = performance.now();
    const noiseMs = step();
    const t1 = performance.now();
    draw();
    stats.noise(noiseMs);
    stats.sim(t1 - t0 - noiseMs);
    stats.draw(performance.now() - t1);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    info: { kind: "canvas2d", count, device: "CPU (main thread) + Canvas 2D" },
    stats: () => stats.read(),
    rebuildField,
    exportState: async () => pack(particles),
    destroy: () => {
      cancelAnimationFrame(raf);
      dispose();
    },
  };
}
