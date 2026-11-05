"use client";

import { useEffect, useRef, useState } from "react";
import { createParticleField, type ParticleFieldHandle } from "./engine";
import { loadScenes } from "./scenes";
import { TuningPanel } from "./TuningPanel";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

type Props = {
  /** Fractional section index from the scroll container. */
  progress: number;
  isMobile: boolean;
};

/** Full-screen particle layer. Desktop only, like the original. */
export function ParticleCanvas({ progress, isMobile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  const [field, setField] = useState<ParticleFieldHandle | null>(null);

  // The animation loop reads progress from a ref, so scrolling never re-mounts it.
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (isMobile || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let handle: ParticleFieldHandle | null = null;
    let cancelled = false;
    loadScenes(BASE_PATH).then((scenes) => {
      if (cancelled) return;
      handle = createParticleField(canvas, scenes, () => progressRef.current);
      setField(handle);
    });
    return () => {
      cancelled = true;
      handle?.destroy();
      setField(null);
    };
  }, [isMobile]);

  if (isMobile) return null;
  return (
    <>
      <canvas ref={canvasRef} className="fixed inset-0 z-[35] pointer-events-none" aria-hidden="true" />
      <TuningPanel field={field} />
    </>
  );
}
