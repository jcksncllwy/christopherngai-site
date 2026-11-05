// Everything both render engines share: tunable parameters, scene → target
// mapping, the packed particle-state format (used to hand particles from one
// engine to another without a visible jump), input/theme tracking, and frame
// stats.

import type { Scene } from "./scenes";

/** Particle count of the original site; every dot cloud has exactly this many dots. */
export const BASE_COUNT = 30000;

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
  sensorAngle: 0.19, // radians off heading for the left/right sensors (~11°)
  turnGain: 0.8, // radians of turn per unit brightness difference (L - R)
  maxTurn: 0.3, // radians/frame cap on the sensor turn
  alignMin: 0, // sensing off when cos(heading vs target dir) < this (0 = >90° off course)
  // Field
  texDrift: 0.15, // texels/frame the noise texture slides, so routes vary over time
  liveNoise: false, // regenerate the texture every frame as a slice through 3D noise
  noiseSpeed: 0.004, // z units/frame the live slice travels
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

export const INK_LIGHT = { r: 26, g: 26, b: 26 };
export const INK_DARK = { r: 245, g: 241, b: 232 };

// ---- Targets ---------------------------------------------------------------

/** Flat per-scene targets: [x, y, size, opacity] per particle. */
export type Targets = Float32Array<ArrayBuffer>;

/** Cheap deterministic hash in [0, 1), so extra particles keep their jitter across resizes. */
function hash01(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Maps a scene's dots into screen space. The first BASE_COUNT particles match
 * the original exactly. Beyond that (stress-testing), extra particles reuse
 * the scene's dots with a little jitter, so they stay part of the image, and
 * every particle's opacity is scaled down to keep the overall tone.
 */
export function buildTargets(scene: Scene, vw: number, vh: number, count: number): Targets {
  const out = new Float32Array(count * 4);
  const hidden = (i: number) => {
    out[i * 4] = Math.random() * vw * 1.4 - 0.2 * vw;
    out[i * 4 + 1] = Math.random() * vh * 1.4 - 0.2 * vh;
    out[i * 4 + 2] = 0.2 + 0.6 * Math.random();
    out[i * 4 + 3] = 0;
  };
  const { dotData, anchor, scale, scaleBreakpoints, rotation } = scene;
  if (!dotData || dotData.dots.length === 0) {
    for (let i = 0; i < count; i++) hidden(i);
    return out;
  }
  const rad = (rotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  let s = scale;
  if (scaleBreakpoints) {
    for (const bp of [...scaleBreakpoints].sort((a, b) => a.maxWidth - b.maxWidth)) {
      if (vw <= bp.maxWidth) { s = bp.scale; break; }
    }
  }
  const { meta, dots } = dotData;
  const drawH = s * vh;
  const drawW = drawH * (meta.width / meta.height);
  const cx = anchor.x * vw, cy = anchor.y * vh;
  const sx = drawW / meta.width, sy = drawH / meta.height;
  const n = dots.length;
  // More particles than the original: thin the ink so the image keeps its tone.
  const inkScale = Math.min(1, BASE_COUNT / count);
  for (let i = 0; i < count; i++) {
    if (i < BASE_COUNT && i >= n) { hidden(i); continue; }
    const d = dots[i % n];
    let lx = d.x * sx - drawW / 2, ly = d.y * sy - drawH / 2;
    if (i >= BASE_COUNT) { lx += (hash01(i * 2) - 0.5) * 3; ly += (hash01(i * 2 + 1) - 0.5) * 3; }
    out[i * 4] = cx + (lx * cos - ly * sin);
    out[i * 4 + 1] = cy + (lx * sin + ly * cos);
    out[i * 4 + 2] = d.size * sx;
    out[i * 4 + 3] = d.opacity * inkScale;
  }
  return out;
}

// ---- Packed particle state ---------------------------------------------------
// Layout matches the WGSL `Particle` struct in webgpu.ts (72 bytes, align 8).

export const STRIDE = 18;
export const P = {
  cx: 0, cy: 1, lx: 2, ly: 3, vx: 4, vy: 5,
  size: 6, opacity: 7, speed: 8, jitter: 9,
  driftOffX: 10, driftOffY: 11, driftSpdX: 12, driftSpdY: 13, driftRadius: 14,
  stagger: 15, landed: 16,
} as const;

/** Fresh particles above the screen, ready for the entrance drop. */
export function initialState(count: number, vw: number, vh: number): Float32Array<ArrayBuffer> {
  const s = new Float32Array(count * STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE, depth = Math.random();
    const cx = Math.random() * vw, cy = -50 - Math.random() * vh * 1.5;
    s[o + P.cx] = cx; s[o + P.cy] = cy; s[o + P.lx] = cx; s[o + P.ly] = cy;
    s[o + P.size] = 0.2 + 0.6 * Math.random();
    s[o + P.speed] = 0.08 + 0.07 * depth;
    s[o + P.jitter] = Math.random() * 2 - 1;
    s[o + P.driftOffX] = Math.random() * Math.PI * 2;
    s[o + P.driftOffY] = Math.random() * Math.PI * 2;
    s[o + P.driftSpdX] = 0.3 + 0.7 * Math.random();
    s[o + P.driftSpdY] = 0.3 + 0.7 * Math.random();
    s[o + P.driftRadius] = 0.2 + 0.4 * Math.random();
    s[o + P.stagger] = 0.4 * Math.random();
  }
  return s;
}

/** A state for `count` particles, carrying over as many as `prev` has. */
export function resizeState(prev: Float32Array<ArrayBuffer> | null, count: number, vw: number, vh: number): Float32Array<ArrayBuffer> {
  const s = initialState(count, vw, vh);
  if (prev) s.set(prev.subarray(0, Math.min(prev.length, s.length)));
  return s;
}

// ---- Engine contract ---------------------------------------------------------

export type EngineKind = "canvas2d" | "webgpu";

export type EngineStats = {
  fps: number; // from requestAnimationFrame intervals
  frameMs: number; // average rAF interval
  simMs: number; // CPU time in step() (for WebGPU: uniform upload + encoding)
  drawMs: number; // CPU time in draw() (Canvas 2D: path building + fill calls)
  noiseMs: number; // CPU time regenerating live noise (Canvas 2D only)
  gpuMs: number | null; // GPU execution time from timestamp queries, if supported
  gpuSimMs: number | null;
  gpuDrawMs: number | null;
};

export type EngineInfo = { kind: EngineKind; count: number; device: string };

export type ParticleEngine = {
  info: EngineInfo;
  stats: () => EngineStats;
  rebuildField: () => void;
  /** Snapshot of all particles, so the next engine can pick up where this one left off. */
  exportState: () => Promise<Float32Array<ArrayBuffer>>;
  destroy: () => void;
};

export type EngineInit = {
  canvas: HTMLCanvasElement;
  scenes: Scene[];
  getProgress: () => number;
  count: number;
  state: Float32Array<ArrayBuffer> | null;
};

/** Exponential moving averages for the stats readout. */
export class FrameStats {
  private last = 0;
  private s: EngineStats = { fps: 0, frameMs: 0, simMs: 0, drawMs: 0, noiseMs: 0, gpuMs: null, gpuSimMs: null, gpuDrawMs: null };
  private ema(key: "frameMs" | "simMs" | "drawMs" | "noiseMs", v: number) {
    const cur = this.s[key];
    this.s[key] = cur === 0 ? v : cur + (v - cur) * 0.08;
  }
  tick(now: number) {
    if (this.last) this.ema("frameMs", Math.min(now - this.last, 1000));
    this.last = now;
  }
  sim(ms: number) { this.ema("simMs", ms); }
  draw(ms: number) { this.ema("drawMs", ms); }
  noise(ms: number) { this.ema("noiseMs", ms); }
  gpu(simMs: number, drawMs: number) {
    const a = 0.08, s = this.s;
    s.gpuSimMs = s.gpuSimMs === null ? simMs : s.gpuSimMs + (simMs - s.gpuSimMs) * a;
    s.gpuDrawMs = s.gpuDrawMs === null ? drawMs : s.gpuDrawMs + (drawMs - s.gpuDrawMs) * a;
    s.gpuMs = s.gpuSimMs + s.gpuDrawMs;
  }
  read(): EngineStats {
    return { ...this.s, fps: this.s.frameMs > 0 ? 1000 / this.s.frameMs : 0 };
  }
}

/** Viewport, mouse and theme tracking shared by both engines. */
export function trackEnvironment(onResize: () => void) {
  const env = {
    vw: window.innerWidth,
    vh: window.innerHeight,
    mouse: null as { x: number; y: number } | null,
    ink: INK_LIGHT,
  };
  const updateInk = () => { env.ink = document.documentElement.classList.contains("dark") ? INK_DARK : INK_LIGHT; };
  updateInk();
  const themeObserver = new MutationObserver(updateInk);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const onMove = (e: MouseEvent) => { env.mouse = { x: e.clientX, y: e.clientY }; };
  const onLeave = () => { env.mouse = null; };
  const resize = () => { env.vw = window.innerWidth; env.vh = window.innerHeight; onResize(); };
  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", onMove);
  document.addEventListener("mouseleave", onLeave);
  return {
    env,
    dispose: () => {
      themeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    },
  };
}

/** Scroll progress → which two scenes are blending and how far. */
export function transition(progress: number, sceneCount: number, scenes: Scene[]) {
  const from = Math.max(0, Math.min(Math.floor(progress), sceneCount - 1));
  const to = Math.min(from + 1, sceneCount - 1);
  const t = Math.max(0, Math.min(1, progress - from));
  const eased = t * t * (3 - 2 * t); // smoothstep
  const driftA = scenes[from]?.driftScale ?? 1;
  const drift = driftA + ((scenes[to]?.driftScale ?? 1) - driftA) * t;
  return { from, to, t, eased, drift };
}
