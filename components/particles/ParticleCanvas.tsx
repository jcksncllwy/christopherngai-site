"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BASE_COUNT, createEngine, type EngineKind, type ParticleEngine } from "./engine";
import { loadScenes, type Scene } from "./scenes";
import { TuningPanel } from "./TuningPanel";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

type Props = {
  /** Fractional section index from the scroll container. */
  progress: number;
  isMobile: boolean;
};

export type EngineConfig = { kind: EngineKind; count: number };

/** Full-screen particle layer. Desktop only, like the original. */
export function ParticleCanvas({ progress, isMobile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  const engineRef = useRef<ParticleEngine | null>(null);
  const stateRef = useRef<Float32Array<ArrayBuffer> | null>(null); // handed from the old engine to the new one
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [config, setConfig] = useState<EngineConfig>({ kind: "canvas2d", count: BASE_COUNT });
  const [engine, setEngine] = useState<ParticleEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  // The animation loop reads progress from a ref, so scrolling never re-mounts it.
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (isMobile) return;
    let cancelled = false;
    loadScenes(BASE_PATH).then((s) => { if (!cancelled) setScenes(s); });
    return () => { cancelled = true; };
  }, [isMobile]);

  // Each config gets a fresh <canvas> (a canvas can't switch from a 2D to a
  // WebGPU context), keyed below, and a fresh engine.
  useEffect(() => {
    if (isMobile || !scenes || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let handle: ParticleEngine | null = null;
    let cancelled = false;
    createEngine(config.kind, { canvas, scenes, getProgress: () => progressRef.current, count: config.count, state: stateRef.current })
      .then((h) => {
        if (cancelled) { h.destroy(); return; }
        handle = h;
        engineRef.current = h;
        setEngine(h);
        setError(null);
      })
      .catch((e: unknown) => {
        console.error("[particles]", e);
        setError(e instanceof Error ? e.message : String(e));
        if (config.kind !== "canvas2d") setConfig({ kind: "canvas2d", count: config.count });
      });
    return () => {
      cancelled = true;
      handle?.destroy();
      engineRef.current = null;
      setEngine(null);
    };
  }, [isMobile, scenes, config]);

  /** Snapshot the running engine's particles, then swap. */
  const reconfigure = useCallback(async (next: EngineConfig) => {
    if (switching) return;
    setSwitching(true);
    try {
      const current = engineRef.current;
      if (current) stateRef.current = await current.exportState();
    } catch (e) {
      console.warn("[particles] state handoff failed, starting fresh", e);
      stateRef.current = null;
    }
    setConfig(next);
    setSwitching(false);
  }, [switching]);

  if (isMobile) return null;
  return (
    <>
      <canvas
        key={`${config.kind}-${config.count}`}
        ref={canvasRef}
        className="fixed inset-0 z-[35] pointer-events-none"
        aria-hidden="true"
      />
      <TuningPanel engine={engine} config={config} onConfig={reconfigure} busy={switching || (!engine && !error)} error={error} />
    </>
  );
}
