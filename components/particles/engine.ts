// Picks a render engine. Both implement ParticleEngine (see shared.ts), so
// they can be swapped at run time with particle state carried across.

import { createCanvas2DEngine } from "./canvas2d";
import type { EngineInit, EngineKind, ParticleEngine } from "./shared";
import { createWebGPUEngine, webgpuAvailable } from "./webgpu";

export { FIELD, SIM, BASE_COUNT } from "./shared";
export type { EngineKind, EngineStats, ParticleEngine } from "./shared";
export { webgpuAvailable };

export async function createEngine(kind: EngineKind, init: EngineInit): Promise<ParticleEngine> {
  return kind === "webgpu" ? createWebGPUEngine(init) : createCanvas2DEngine(init);
}
