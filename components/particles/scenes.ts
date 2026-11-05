// One scene per section: which dot cloud to form and where on screen.
// anchor is in viewport fractions; scale is a fraction of viewport height.

export type Dot = { x: number; y: number; size: number; opacity: number };
export type DotData = { meta: { width: number; height: number }; dots: Dot[] };

export type SceneConfig = {
  file: string;
  anchor: { x: number; y: number };
  scale: number;
  scaleBreakpoints?: { maxWidth: number; scale: number }[];
  rotation: number;
  driftScale?: number;
};

export type Scene = SceneConfig & { dotData: DotData | null };

export const SCENES: SceneConfig[] = [
  { file: "icarus", anchor: { x: 0.78, y: 0.46 }, scale: 0.55, scaleBreakpoints: [{ maxWidth: 1024, scale: 0.38 }, { maxWidth: 1280, scale: 0.45 }], rotation: 0 },
  { file: "dog_4", anchor: { x: 0.75, y: 0.84 }, scale: 0.23, scaleBreakpoints: [{ maxWidth: 1024, scale: 0.16 }, { maxWidth: 1280, scale: 0.19 }], rotation: 0 },
  { file: "dinner_2", anchor: { x: 0.17, y: 0.81 }, scale: 0.27, scaleBreakpoints: [{ maxWidth: 1024, scale: 0.19 }, { maxWidth: 1280, scale: 0.22 }], rotation: 0 },
  { file: "bear", anchor: { x: 0.67, y: 0.25 }, scale: 0.21, scaleBreakpoints: [{ maxWidth: 1024, scale: 0.15 }, { maxWidth: 1280, scale: 0.17 }], rotation: 0 },
  { file: "biking", anchor: { x: 0.83, y: 0.34 }, scale: 0.21, scaleBreakpoints: [{ maxWidth: 1024, scale: 0.15 }, { maxWidth: 1280, scale: 0.17 }], rotation: 0 },
  { file: "golf_3", anchor: { x: 0.86, y: 0.6 }, scale: 0.45, scaleBreakpoints: [{ maxWidth: 1024, scale: 0.31 }, { maxWidth: 1280, scale: 0.37 }], rotation: 0 },
];

/** Decodes the 6-bytes-per-dot format written by scripts/pack-dots.mjs. */
export function decodeDots(buf: ArrayBuffer): DotData {
  const view = new DataView(buf);
  const width = view.getUint16(0, true);
  const height = view.getUint16(2, true);
  const count = view.getUint32(4, true);
  const dots: Dot[] = new Array(count);
  for (let i = 0, o = 8; i < count; i++, o += 6) {
    dots[i] = {
      x: (view.getUint16(o, true) / 65535) * width,
      y: (view.getUint16(o + 2, true) / 65535) * height,
      size: (view.getUint8(o + 4) / 255) * 2,
      opacity: view.getUint8(o + 5) / 255,
    };
  }
  return { meta: { width, height }, dots };
}

export async function loadScenes(baseUrl: string): Promise<Scene[]> {
  return Promise.all(
    SCENES.map(async (scene) => {
      const res = await fetch(`${baseUrl}/dots/${scene.file}.bin`);
      return { ...scene, dotData: res.ok ? decodeDots(await res.arrayBuffer()) : null };
    }),
  );
}
