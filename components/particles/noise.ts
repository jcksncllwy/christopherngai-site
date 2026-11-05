// 3D simplex noise (after Stefan Gustavson's public-domain reference) and a
// tileable ridged-noise texture built from it.

const GRAD3 = new Float32Array([
  1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1,
]);

export type Noise3 = (x: number, y: number, z: number) => number;

export function makeNoise3(seed = 1): Noise3 {
  const { perm, permMod12 } = makePerm(seed);

  const F3 = 1 / 3, G3 = 1 / 6;
  return function noise3(x: number, y: number, z: number) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt: number, g: number;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) { g = permMod12[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n += tt * tt * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) { g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n += tt * tt * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) { g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n += tt * tt * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) { g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n += tt * tt * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3); }
    return 32 * n; // ~[-1, 1]
  };
}

// N x N tileable ridged noise in [0, 1], precomputed once.
// Ridged = 1 - |fbm|: bright thin filaments on a dark ground, which give the
// sensors "veins" to latch onto (like physarum trails).
// Tiling uses the 4-corner blend trick so the texture can wrap and scroll.
export type NoiseTextureOptions = {
  features?: number;
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  ridged?: boolean;
  sharpness?: number;
};

/** Seeded permutation tables, shared with the WebGPU noise shader. */
export function makePerm(seed = 1) {
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
  return { perm, permMod12 };
}

export type NoiseTexture = { data: Float32Array<ArrayBuffer>; min: number; max: number };

const noiseCache = new Map<number, Noise3>();

/**
 * `z` slices through the 3D noise: z = 0 is the classic static texture, and
 * advancing z every frame gives the "live 3D noise" variant. `min`/`max` are
 * the raw range before normalizing (the GPU reuses them for its live slices).
 */
export function makeNoiseTexture(
  N = 256,
  seed = 1,
  { features = 5, octaves = 3, lacunarity = 2, gain = 0.5, ridged = true, sharpness = 3 }: NoiseTextureOptions = {},
  z = 0,
  out = new Float32Array(N * N),
): NoiseTexture {
  let noise3 = noiseCache.get(seed);
  if (!noise3) { noise3 = makeNoise3(seed); noiseCache.set(seed, noise3); }
  const n3 = noise3;
  const fbm = (x: number, y: number) => {
    let v = 0, amp = 1, f = features / N, norm = 0;
    for (let o = 0; o < octaves; o++) { v += n3(x * f, y * f, o * 17.3 + z) * amp; norm += amp; amp *= gain; f *= lacunarity; }
    return v / norm;
  };
  let mn = Infinity, mx = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const wx = x / N, wy = y / N;
      const v =
        fbm(x, y) * (1 - wx) * (1 - wy) + fbm(x - N, y) * wx * (1 - wy) +
        fbm(x, y - N) * (1 - wx) * wy + fbm(x - N, y - N) * wx * wy;
      const r = ridged ? 1 - Math.abs(v) : v;
      out[y * N + x] = r;
      if (r < mn) mn = r; if (r > mx) mx = r;
    }
  }
  // Normalize to [0,1]; sharpness > 1 thins the bright parts, < 1 fattens them.
  for (let i = 0; i < out.length; i++) out[i] = Math.pow((out[i] - mn) / (mx - mn), sharpness);
  return { data: out, min: mn, max: mx };
}
