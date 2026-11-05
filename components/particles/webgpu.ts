// WebGPU engine: the same sim and look as canvas2d.ts, but the CPU only
// uploads ~200 bytes of uniforms per frame.
//
//   compute pass:  [live noise: regenerate the N×N field from 3D simplex noise]
//                  → sim: one invocation per particle, a line-for-line port of
//                    updateOriginal / updateSteer
//   render pass:   [debug field overlay] → one instanced draw of 4-vertex quads
//                  (tapered streak, square, or SDF circle per particle), 4× MSAA
//
// Particle state never leaves the GPU, except when exportState() reads it back
// so another engine can take over.

import { makeNoiseTexture, makePerm } from "./noise";
import {
  FIELD, FrameStats, SIM, STRIDE, buildTargets, resizeState, trackEnvironment, transition,
  type EngineInit, type ParticleEngine,
} from "./shared";

// Uniform block. Order must match `struct U` below (all f32, 4-byte packed).
const U_FIELDS = [
  "vw", "vh", "time", "t", "eased", "drift", "fromOff", "toOff",
  "count", "steer", "mouseX", "mouseY", "mouseOn", "texOffX", "texOffY", "texN",
  "texelPx", "attract", "arriveK", "settleRadius", "damping", "homing", "accel", "maxSpeed",
  "speedVar", "stagger", "sensorDist", "sensorAngle", "turnGain", "maxTurn", "alignMin", "streak",
  "streakTaper", "streakFade", "dpr", "inkR", "inkG", "inkB", "zTime", "features",
  "octaves", "lacunarity", "gain", "ridged", "sharpness", "normMin", "normMax", "pad0",
] as const;
type UKey = (typeof U_FIELDS)[number];
const U_INDEX = Object.fromEntries(U_FIELDS.map((k, i) => [k, i])) as Record<UKey, number>;

const WGSL_COMMON = /* wgsl */ `
struct U { ${U_FIELDS.map((k) => `${k}: f32`).join(", ")} }

// 72 bytes; layout matches STRIDE / P in shared.ts.
struct Particle {
  pos: vec2f, prev: vec2f, vel: vec2f,
  size: f32, opacity: f32, speed: f32, jitter: f32,
  driftOff: vec2f, driftSpd: vec2f,
  driftRadius: f32, stagger: f32, landed: f32, pad: f32,
}
`;

/** Bilinear sample (0..1) of the tiled, drifting field at a screen position (CSS px). */
const WGSL_SAMPLE = /* wgsl */ `
fn sampleField(px: f32, py: f32) -> f32 {
  let n = u.texN;
  let N = u32(n);
  var x = px / u.texelPx + u.texOffX;
  var y = py / u.texelPx + u.texOffY;
  x -= floor(x / n) * n;
  y -= floor(y / n) * n;
  let x0 = min(u32(x), N - 1u);
  let y0 = min(u32(y), N - 1u);
  let fx = x - f32(x0);
  let fy = y - f32(y0);
  let x1 = (x0 + 1u) % N;
  let y1 = (y0 + 1u) % N;
  let a = field[y0 * N + x0];
  let b = field[y0 * N + x1];
  let c = field[y1 * N + x0];
  let d = field[y1 * N + x1];
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}
`;

const WGSL_SIM = /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> ps: array<Particle>;
@group(0) @binding(2) var<storage, read> targets: array<vec4f>; // x, y, size, opacity
@group(0) @binding(3) var<storage, read> field: array<f32>;
${WGSL_SAMPLE}

fn repel(p: ptr<function, Particle>) {
  if (u.mouseOn < 0.5) { return; }
  let m = (*p).pos - vec2f(u.mouseX, u.mouseY);
  let dist = length(m);
  if (dist < 70.0 && dist > 0.0) {
    (*p).vel += m / dist * ((1.0 - dist / 70.0) * 0.075);
  }
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(u.count)) { return; }
  var p = ps[i];
  let A = targets[u32(u.fromOff) + i];
  let B = targets[u32(u.toOff) + i];
  let d = vec2f(
    sin(u.time * p.driftSpd.x + p.driftOff.x),
    cos(u.time * p.driftSpd.y + p.driftOff.y),
  ) * p.driftRadius * u.drift;
  p.prev = p.pos;

  if (u.steer > 0.5 && p.landed > 0.5) {
    // ---- steer: physarum-style flight + damped landing
    let switchAt = 0.1 + p.stagger * u.stagger;
    let T = select(A, B, u.t >= switchAt);
    let g = T.xy + d - p.pos;
    let dist = max(length(g), 1e-6);
    let dir = g / dist;
    let topSpeed = u.maxSpeed * (1.0 + u.speedVar * p.jitter);
    let desired = min(topSpeed, dist * u.arriveK);
    var far = 0.0;
    if (dist > u.settleRadius) {
      far = select(1.0, min(1.0, (dist - u.settleRadius) / u.settleRadius), u.settleRadius > 0.0);
    }
    var v = p.vel + (dir * desired - p.vel) * u.attract;
    if (far > 0.0) {
      let sp = length(p.vel);
      var h = dir;
      if (sp > 0.05) { h = p.vel / sp; }
      let al = dot(h, dir);
      let crs = h.x * dir.y - h.y * dir.x;
      var turn = clamp(atan2(crs, al), -u.homing, u.homing);
      let gate = clamp((al - u.alignMin) / (1.0 - u.alignMin), 0.0, 1.0);
      if (gate > 0.0) {
        let ca = cos(u.sensorAngle);
        let sa = sin(u.sensorAngle);
        let sd = u.sensorDist;
        let L = sampleField(p.pos.x + (h.x * ca - h.y * sa) * sd, p.pos.y + (h.x * sa + h.y * ca) * sd);
        let R = sampleField(p.pos.x + (h.x * ca + h.y * sa) * sd, p.pos.y + (-h.x * sa + h.y * ca) * sd);
        turn += clamp((L - R) * u.turnGain, -u.maxTurn, u.maxTurn) * gate;
      }
      let c = cos(turn);
      let s = sin(turn);
      let nh = vec2f(h.x * c - h.y * s, h.x * s + h.y * c);
      let flightSpeed = desired * (0.25 + 0.75 * max(0.0, al));
      let nsp = sp + (flightSpeed - sp) * u.accel;
      v += (nh * nsp - v) * far;
    }
    p.vel = v;
    repel(&p);
    p.vel *= u.damping;
    p.pos += p.vel;
    p.size += (T.z - p.size) * 0.1;
    p.opacity += (T.w - p.opacity) * 0.1;
  } else {
    // ---- original: ease toward a scroll-lerped target
    let T = mix(A, B, u.eased);
    repel(&p);
    p.vel *= 0.9;
    let k = select(p.speed, 0.12, u.t > 0.005);
    p.pos += (T.xy + d - p.pos) * k + p.vel;
    p.size += (T.z - p.size) * k;
    p.opacity += (T.w - p.opacity) * k;
    if (p.landed < 0.5 && all(abs(T.xy + d - p.pos) < vec2f(2.0))) {
      p.landed = 1.0;
      p.vel = vec2f(0.0);
    }
  }
  ps[i] = p;
}
`;

// 3D simplex noise, a port of noise.ts (same permutation table, so z = 0
// matches the CPU texture), sliced at z = zTime and tiled with the same
// 4-corner blend.
const WGSL_NOISE = /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> fieldOut: array<f32>;
@group(0) @binding(2) var<storage, read> perm: array<u32>; // [0..512) perm, [512..1024) perm % 12

var<private> GRAD3: array<vec3f, 12> = array<vec3f, 12>(
  vec3f(1, 1, 0), vec3f(-1, 1, 0), vec3f(1, -1, 0), vec3f(-1, -1, 0),
  vec3f(1, 0, 1), vec3f(-1, 0, 1), vec3f(1, 0, -1), vec3f(-1, 0, -1),
  vec3f(0, 1, 1), vec3f(0, -1, 1), vec3f(0, 1, -1), vec3f(0, -1, -1),
);

fn P(i: i32) -> i32 { return i32(perm[u32(i)]); }
fn PM(i: i32) -> i32 { return i32(perm[512u + u32(i)]); }

fn corner(p: vec3f, gi: i32) -> f32 {
  var t = 0.6 - dot(p, p);
  if (t <= 0.0) { return 0.0; }
  t *= t;
  return t * t * dot(GRAD3[gi], p);
}

fn noise3(x: f32, y: f32, z: f32) -> f32 {
  let F3 = 1.0 / 3.0;
  let G3 = 1.0 / 6.0;
  let s = (x + y + z) * F3;
  let i = floor(x + s);
  let j = floor(y + s);
  let k = floor(z + s);
  let t = (i + j + k) * G3;
  let p0 = vec3f(x - (i - t), y - (j - t), z - (k - t));
  var o1: vec3i;
  var o2: vec3i;
  if (p0.x >= p0.y) {
    if (p0.y >= p0.z) { o1 = vec3i(1, 0, 0); o2 = vec3i(1, 1, 0); }
    else if (p0.x >= p0.z) { o1 = vec3i(1, 0, 0); o2 = vec3i(1, 0, 1); }
    else { o1 = vec3i(0, 0, 1); o2 = vec3i(1, 0, 1); }
  } else {
    if (p0.y < p0.z) { o1 = vec3i(0, 0, 1); o2 = vec3i(0, 1, 1); }
    else if (p0.x < p0.z) { o1 = vec3i(0, 1, 0); o2 = vec3i(0, 1, 1); }
    else { o1 = vec3i(0, 1, 0); o2 = vec3i(1, 1, 0); }
  }
  let p1 = p0 - vec3f(o1) + G3;
  let p2 = p0 - vec3f(o2) + 2.0 * G3;
  let p3 = p0 - 1.0 + 3.0 * G3;
  let ii = i32(i) & 255;
  let jj = i32(j) & 255;
  let kk = i32(k) & 255;
  var n = corner(p0, PM(ii + P(jj + P(kk))));
  n += corner(p1, PM(ii + o1.x + P(jj + o1.y + P(kk + o1.z))));
  n += corner(p2, PM(ii + o2.x + P(jj + o2.y + P(kk + o2.z))));
  n += corner(p3, PM(ii + 1 + P(jj + 1 + P(kk + 1))));
  return 32.0 * n;
}

fn fbm(x: f32, y: f32) -> f32 {
  var v = 0.0;
  var amp = 1.0;
  var f = u.features / u.texN;
  var norm = 0.0;
  let octaves = i32(u.octaves);
  for (var o = 0; o < octaves; o++) {
    v += noise3(x * f, y * f, f32(o) * 17.3 + u.zTime) * amp;
    norm += amp;
    amp *= u.gain;
    f *= u.lacunarity;
  }
  return v / norm;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = u32(u.texN);
  if (gid.x >= N || gid.y >= N) { return; }
  let n = u.texN;
  let x = f32(gid.x);
  let y = f32(gid.y);
  let wx = x / n;
  let wy = y / n;
  let v = fbm(x, y) * (1.0 - wx) * (1.0 - wy) + fbm(x - n, y) * wx * (1.0 - wy)
        + fbm(x, y - n) * (1.0 - wx) * wy + fbm(x - n, y - n) * wx * wy;
  let r = select(v, 1.0 - abs(v), u.ridged > 0.5);
  // Normalized with the static texture's range (a per-frame min/max would need a reduction pass).
  let t = clamp((r - u.normMin) / max(u.normMax - u.normMin, 1e-6), 0.0, 1.0);
  fieldOut[gid.y * N + gid.x] = pow(t, u.sharpness);
}
`;

const WGSL_RENDER = /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> ps: array<Particle>;
@group(0) @binding(3) var<storage, read> field: array<f32>;
${WGSL_SAMPLE}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f, // device-px offset from a round dot's center
  @location(1) @interpolate(flat) radius: f32, // device px; 0 = no circle mask
  @location(2) @interpolate(flat) alpha: f32,
}

fn toClip(p: vec2f) -> vec4f {
  return vec4f(p.x / u.vw * 2.0 - 1.0, 1.0 - p.y / u.vh * 2.0, 0.0, 1.0);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  out.pos = vec4f(2.0, 2.0, 0.0, 1.0); // off-screen (culled) unless set below
  out.local = vec2f(0.0);
  out.radius = 0.0;
  out.alpha = 0.0;
  let p = ps[ii];
  // Triangle-strip corners: (0,0) (1,0) (0,1) (1,1). x = side, y = head/tail.
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u));
  let side = corner.x * 2.0 - 1.0;
  var o = p.opacity;
  let r = max(0.3, p.size);
  let m = (p.pos - p.prev) * u.streak;
  let len = length(m);
  if (u.streakFade > 0.0 && u.streak > 0.0 && len > 2.0 * r) {
    // Motion blur: the same ink spread over a longer shape reads lighter.
    o *= 1.0 - u.streakFade * (1.0 - (2.0 * r) / (2.0 * r + len));
  }
  if (o < 0.005) { return out; }
  let px = 1.0 / u.dpr; // one device pixel, in CSS px

  if (len > 2.0 * r) {
    // Streak: tapered quad from the head back along this frame's motion.
    let dir = m / len;
    let nrm = vec2f(-dir.y, dir.x);
    var hw = r;
    var tw = r * (1.0 - u.streakTaper);
    // Thinner than a device pixel: widen to 1px and fade by the lost coverage.
    if (2.0 * hw < px) {
      let k = 2.0 * hw / px;
      o *= k;
      hw = px * 0.5;
      tw /= k;
    }
    let head = corner.y < 0.5;
    let base = select(p.pos - m, p.pos, head);
    let w = select(tw, hw, head);
    out.pos = toClip(base + nrm * w * side);
  } else {
    var half: f32;
    if (r < 1.25) {
      half = r * 1.7725 * 0.5; // equal-area square, like the Canvas 2D engine
      if (2.0 * half < px) {
        let k = 2.0 * half / px;
        o *= k * k;
        half = px * 0.5;
      }
    } else {
      half = r + px; // pad a pixel for the antialiased edge
      out.radius = r * u.dpr;
    }
    let off = vec2f(side, corner.y * 2.0 - 1.0) * half;
    out.local = off * u.dpr;
    out.pos = toClip(p.pos + off);
  }
  out.alpha = o;
  return out;
}

@fragment
fn fs(f: VOut) -> @location(0) vec4f {
  var a = f.alpha;
  if (f.radius > 0.0) { a *= clamp(f.radius - length(f.local) + 0.5, 0.0, 1.0); }
  return vec4f(vec3f(u.inkR, u.inkG, u.inkB) * a, a); // premultiplied
}

// Debug overlay: the field under the particles.
@vertex
fn vsField(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fsField(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let css = fc.xy / u.dpr;
  let a = sampleField(css.x, css.y) * 127.0 / 255.0;
  return vec4f(vec3f(200.0, 90.0, 40.0) / 255.0 * a, a);
}
`;

export function webgpuAvailable() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function createWebGPUEngine({ canvas, scenes, getProgress, count, state }: EngineInit): Promise<ParticleEngine> {
  if (!webgpuAvailable()) throw new Error("WebGPU is not available in this browser");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No WebGPU adapter");
  const canTime = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({
    requiredFeatures: canTime ? ["timestamp-query"] : [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  let lost = false;
  device.lost.then((info) => { lost = true; if (info.reason !== "destroyed") console.warn("[particles] WebGPU device lost:", info.message); });

  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  const stats = new FrameStats();
  const info = adapter.info;
  const deviceName = `WebGPU · ${[info?.vendor, info?.architecture].filter(Boolean).join(" ") || info?.description || "GPU"}`;

  // ---- Buffers -------------------------------------------------------------
  const uniforms = new Float32Array(U_FIELDS.length);
  const uniformBuf = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const setU = (k: UKey, v: number) => { uniforms[U_INDEX[k]] = v; };

  const particleBytes = count * STRIDE * 4;
  const particleBuf = device.createBuffer({
    size: particleBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const targetBuf = device.createBuffer({
    size: Math.max(16, scenes.length * count * 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const permBuf = device.createBuffer({ size: 1024 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  let fieldBuf: GPUBuffer | null = null;
  let staticField = new Float32Array(0);
  let normMin = 0, normMax = 1;

  // ---- Pipelines -------------------------------------------------------------
  const C = GPUShaderStage.COMPUTE, V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
  const simLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: C, buffer: { type: "uniform" } },
      { binding: 1, visibility: C, buffer: { type: "storage" } },
      { binding: 2, visibility: C, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: C, buffer: { type: "read-only-storage" } },
    ],
  });
  const noiseLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: C, buffer: { type: "uniform" } },
      { binding: 1, visibility: C, buffer: { type: "storage" } },
      { binding: 2, visibility: C, buffer: { type: "read-only-storage" } },
    ],
  });
  const renderLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: V | F, buffer: { type: "uniform" } },
      { binding: 1, visibility: V, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: F, buffer: { type: "read-only-storage" } },
    ],
  });

  const simPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [simLayout] }),
    compute: { module: device.createShaderModule({ code: WGSL_SIM, label: "sim" }), entryPoint: "main" },
  });
  const noisePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [noiseLayout] }),
    compute: { module: device.createShaderModule({ code: WGSL_NOISE, label: "noise" }), entryPoint: "main" },
  });
  const renderModule = device.createShaderModule({ code: WGSL_RENDER, label: "render" });
  const SAMPLES = 4;
  const blend: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };
  const renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderLayout] });
  const particlePipeline = device.createRenderPipeline({
    layout: renderPipelineLayout,
    vertex: { module: renderModule, entryPoint: "vs" },
    fragment: { module: renderModule, entryPoint: "fs", targets: [{ format, blend }] },
    primitive: { topology: "triangle-strip" },
    multisample: { count: SAMPLES },
  });
  const fieldPipeline = device.createRenderPipeline({
    layout: renderPipelineLayout,
    vertex: { module: renderModule, entryPoint: "vsField" },
    fragment: { module: renderModule, entryPoint: "fsField", targets: [{ format, blend }] },
    primitive: { topology: "triangle-list" },
    multisample: { count: SAMPLES },
  });

  let simBG: GPUBindGroup, noiseBG: GPUBindGroup, renderBG: GPUBindGroup;
  const makeBindGroups = () => {
    simBG = device.createBindGroup({
      layout: simLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: particleBuf } },
        { binding: 2, resource: { buffer: targetBuf } },
        { binding: 3, resource: { buffer: fieldBuf! } },
      ],
    });
    noiseBG = device.createBindGroup({
      layout: noiseLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: fieldBuf! } },
        { binding: 2, resource: { buffer: permBuf } },
      ],
    });
    renderBG = device.createBindGroup({
      layout: renderLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: particleBuf } },
        { binding: 3, resource: { buffer: fieldBuf! } },
      ],
    });
  };

  // ---- Noise field -----------------------------------------------------------
  let texN = 0, texOffX = 0, texOffY = 0, texZ = 0, wasLive = false;
  const rebuildField = () => {
    const N = FIELD.size | 0;
    // The static texture is built on the CPU exactly as in the Canvas 2D engine;
    // its raw range also normalizes the GPU's live slices.
    const tex = makeNoiseTexture(N, FIELD.seed | 0, FIELD);
    staticField = tex.data; normMin = tex.min; normMax = tex.max;
    if (N !== texN || !fieldBuf) {
      fieldBuf?.destroy();
      fieldBuf = device.createBuffer({ size: N * N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      texN = N;
      makeBindGroups();
    }
    const { perm, permMod12 } = makePerm(FIELD.seed | 0);
    const permU32 = new Uint32Array(1024);
    permU32.set(perm, 0); permU32.set(permMod12, 512);
    device.queue.writeBuffer(permBuf, 0, permU32);
    device.queue.writeBuffer(fieldBuf, 0, staticField);
    texZ = 0;
  };

  // ---- Layout / state ----------------------------------------------------------
  const layout = () => {
    const { vw, vh } = env;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(vw * dpr)); canvas.height = Math.max(1, Math.round(vh * dpr));
    canvas.style.width = `${vw}px`; canvas.style.height = `${vh}px`;
    scenes.forEach((s, k) => device.queue.writeBuffer(targetBuf, k * count * 16, buildTargets(s, vw, vh, count)));
  };
  const { env, dispose } = trackEnvironment(layout);
  layout();
  rebuildField();
  device.queue.writeBuffer(particleBuf, 0, resizeState(state, count, env.vw, env.vh));

  let msaa: GPUTexture | null = null;
  const msaaView = () => {
    if (!msaa || msaa.width !== canvas.width || msaa.height !== canvas.height) {
      msaa?.destroy();
      msaa = device.createTexture({ size: [canvas.width, canvas.height], format, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    return msaa.createView();
  };

  // ---- GPU timing (timestamp queries) ------------------------------------------
  const querySet = canTime ? device.createQuerySet({ type: "timestamp", count: 4 }) : null;
  const resolveBuf = canTime ? device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const readPool: GPUBuffer[] = canTime
    ? [0, 1, 2].map(() => device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }))
    : [];
  const busy = new Set<GPUBuffer>();

  // ---- Frame -------------------------------------------------------------------
  let time = 0, raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (lost) return;
    stats.tick(now);
    const t0 = performance.now();

    time += 0.016;
    texOffX = (texOffX + SIM.texDrift) % texN;
    texOffY = (texOffY + SIM.texDrift * 0.37) % texN;
    const live = SIM.liveNoise;
    if (live) texZ += SIM.noiseSpeed;
    else if (wasLive) { device.queue.writeBuffer(fieldBuf!, 0, staticField); texZ = 0; }
    wasLive = live;

    const { from, to, t, eased, drift } = transition(getProgress(), scenes.length, scenes);
    const dpr = window.devicePixelRatio || 1;
    const mouse = env.mouse, ink = env.ink;
    setU("vw", env.vw); setU("vh", env.vh); setU("time", time); setU("t", t); setU("eased", eased); setU("drift", drift);
    setU("fromOff", from * count); setU("toOff", to * count); setU("count", count);
    setU("steer", SIM.mode === "steer" ? 1 : 0);
    setU("mouseX", mouse?.x ?? 0); setU("mouseY", mouse?.y ?? 0); setU("mouseOn", mouse ? 1 : 0);
    setU("texOffX", texOffX); setU("texOffY", texOffY); setU("texN", texN); setU("texelPx", FIELD.texelPx);
    for (const k of ["attract", "arriveK", "settleRadius", "damping", "homing", "accel", "maxSpeed", "speedVar", "stagger",
      "sensorDist", "sensorAngle", "turnGain", "maxTurn", "alignMin", "streak", "streakTaper", "streakFade"] as const) setU(k, SIM[k]);
    setU("dpr", dpr); setU("inkR", ink.r / 255); setU("inkG", ink.g / 255); setU("inkB", ink.b / 255);
    setU("zTime", texZ); setU("features", FIELD.features); setU("octaves", FIELD.octaves); setU("lacunarity", FIELD.lacunarity);
    setU("gain", FIELD.gain); setU("ridged", FIELD.ridged ? 1 : 0); setU("sharpness", FIELD.sharpness);
    setU("normMin", normMin); setU("normMax", normMax);
    device.queue.writeBuffer(uniformBuf, 0, uniforms);

    const enc = device.createCommandEncoder();
    const cpass = enc.beginComputePass(querySet ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    if (live) {
      cpass.setPipeline(noisePipeline);
      cpass.setBindGroup(0, noiseBG);
      cpass.dispatchWorkgroups(Math.ceil(texN / 8), Math.ceil(texN / 8));
    }
    cpass.setPipeline(simPipeline);
    cpass.setBindGroup(0, simBG);
    cpass.dispatchWorkgroups(Math.ceil(count / 256));
    cpass.end();
    const t1 = performance.now();

    const rpass = enc.beginRenderPass({
      colorAttachments: [{
        view: msaaView(),
        resolveTarget: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "discard",
      }],
      ...(querySet ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } } : {}),
    });
    rpass.setBindGroup(0, renderBG);
    if (SIM.showField) {
      rpass.setPipeline(fieldPipeline);
      rpass.draw(3);
    }
    rpass.setPipeline(particlePipeline);
    rpass.draw(4, count);
    rpass.end();

    let readBuf: GPUBuffer | undefined;
    if (querySet && resolveBuf) {
      enc.resolveQuerySet(querySet, 0, 4, resolveBuf, 0);
      readBuf = readPool.find((b) => !busy.has(b));
      if (readBuf) enc.copyBufferToBuffer(resolveBuf, 0, readBuf, 0, 32);
    }
    device.queue.submit([enc.finish()]);
    const t2 = performance.now();
    stats.sim(t1 - t0);
    stats.draw(t2 - t1);

    if (readBuf) {
      const b = readBuf;
      busy.add(b);
      b.mapAsync(GPUMapMode.READ).then(() => {
        const ts = new BigUint64Array(b.getMappedRange().slice(0));
        b.unmap();
        busy.delete(b);
        const simNs = Number(ts[1] - ts[0]), drawNs = Number(ts[3] - ts[2]);
        if (simNs >= 0 && drawNs >= 0 && simNs < 1e9 && drawNs < 1e9) stats.gpu(simNs / 1e6, drawNs / 1e6);
      }, () => busy.delete(b));
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    info: { kind: "webgpu", count, device: deviceName },
    stats: () => stats.read(),
    rebuildField,
    exportState: async () => {
      const staging = device.createBuffer({ size: particleBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(particleBuf, 0, staging, 0, particleBytes);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      staging.destroy();
      return out;
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      dispose();
      context.unconfigure();
      device.destroy();
    },
  };
}
