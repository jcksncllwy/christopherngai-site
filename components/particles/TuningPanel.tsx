"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { BASE_COUNT, FIELD, SIM, webgpuAvailable, type EngineKind, type EngineStats, type ParticleEngine } from "./engine";
import type { EngineConfig } from "./ParticleCanvas";

type NumKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
type SliderSpec<T> = [key: NumKey<T>, min: number, max: number, step: number];

const GROUPS: { title: string; sim?: SliderSpec<typeof SIM>[]; field?: SliderSpec<typeof FIELD>[]; rebuild?: boolean }[] = [
  { title: "Flight", sim: [["homing", 0, 0.5, 0.005], ["accel", 0.01, 1, 0.01], ["maxSpeed", 1, 40, 0.5], ["speedVar", 0, 0.9, 0.01], ["stagger", 0, 1, 0.01]] },
  { title: "Streaks", sim: [["streak", 0, 4, 0.05], ["streakTaper", 0, 1, 0.05], ["streakFade", 0, 1, 0.05]] },
  { title: "Sensors", sim: [["sensorDist", 2, 120, 1], ["sensorAngle", 0.05, 1.5, 0.01], ["turnGain", 0, 15, 0.1], ["maxTurn", 0, 1, 0.01], ["alignMin", -1, 0.95, 0.05]] },
  { title: "Landing", sim: [["attract", 0.005, 0.5, 0.005], ["arriveK", 0.01, 0.3, 0.005], ["settleRadius", 0, 300, 1], ["damping", 0.8, 1, 0.005]] },
  { title: "Noise field", sim: [["texDrift", 0, 2, 0.01], ["noiseSpeed", 0, 0.05, 0.001]], field: [["texelPx", 0.5, 16, 0.5]] },
  {
    title: "Noise texture (applies on release)",
    rebuild: true,
    field: [["size", 64, 512, 64], ["features", 1, 20, 1], ["octaves", 1, 6, 1], ["lacunarity", 1.5, 3.5, 0.1], ["gain", 0.2, 0.9, 0.05], ["sharpness", 0.25, 8, 0.25]],
  },
];

function Slider<T extends Record<string, unknown>>({ obj, spec, onCommit }: { obj: T; spec: SliderSpec<T>; onCommit?: () => void }) {
  const [key, min, max, step] = spec;
  const [value, setValue] = useState(obj[key] as number);
  return (
    <label className="contents">
      <span>{String(key)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          setValue(v);
          if (!onCommit) (obj as Record<string, unknown>)[key as string] = v; // live
        }}
        onPointerUp={() => {
          if (!onCommit) return;
          (obj as Record<string, unknown>)[key as string] = value;
          onCommit();
        }}
        onKeyUp={() => {
          if (!onCommit) return;
          (obj as Record<string, unknown>)[key as string] = value;
          onCommit();
        }}
      />
      <span className="tabular-nums text-right">{value}</span>
    </label>
  );
}

function Check({ label, get, set }: { label: string; get: () => boolean; set: (v: boolean) => void }) {
  const [on, setOn] = useState(get);
  return (
    <label className="col-span-3 flex items-center gap-2">
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); set(e.target.checked); }} />
      {label}
    </label>
  );
}

const COUNTS = [BASE_COUNT, 100_000, 300_000, 1_000_000];
const ENGINES: { kind: EngineKind; label: string }[] = [
  { kind: "canvas2d", label: "Canvas 2D (CPU)" },
  { kind: "webgpu", label: "WebGPU" },
];

const ms = (v: number | null) => (v === null ? "n/a" : v < 10 ? `${v.toFixed(2)} ms` : `${v.toFixed(1)} ms`);

/** Live performance readout, polled from the engine 4× a second. */
function Stats({ engine }: { engine: ParticleEngine | null }) {
  const [s, setS] = useState<EngineStats | null>(null);
  useEffect(() => {
    if (!engine) { setS(null); return; }
    const id = setInterval(() => setS(engine.stats()), 250);
    return () => clearInterval(id);
  }, [engine]);
  if (!engine || !s) return <div className="col-span-3 opacity-60">starting…</div>;
  const gpu = engine.info.kind === "webgpu";
  const rows: [string, string, string?][] = [
    ["fps", `${s.fps.toFixed(1)}`, `${ms(s.frameMs)} / frame`],
    [gpu ? "CPU encode sim" : "CPU sim", ms(s.simMs), gpu ? "uniforms + compute pass" : "JS loop over particles"],
    [gpu ? "CPU encode draw" : "CPU draw", ms(s.drawMs), gpu ? "render pass + submit" : "path building + fill() calls"],
  ];
  if (!gpu) rows.push(["CPU live noise", SIM.liveNoise ? ms(s.noiseMs) : "off", "regenerating the texture"]);
  if (gpu) {
    rows.push(["GPU compute", ms(s.gpuSimMs), SIM.liveNoise ? "live noise + sim" : "sim"]);
    rows.push(["GPU render", ms(s.gpuDrawMs), "MSAA 4×"]);
  }
  return (
    <div className="col-span-3 grid grid-cols-[auto_auto_1fr] gap-x-2 rounded bg-ink/5 px-2 py-1 tabular-nums" data-stats>
      <span className="col-span-3 opacity-70">{engine.info.device} · {engine.info.count.toLocaleString()} particles</span>
      {rows.map(([k, v, note]) => (
        <div key={k} className="contents">
          <span className="opacity-70">{k}</span>
          <span className="text-right">{v}</span>
          <span className="opacity-50">{note}</span>
        </div>
      ))}
      {gpu && s.gpuMs === null && (
        <span className="col-span-3 opacity-50">GPU timings need the timestamp-query feature, which this browser doesn't expose.</span>
      )}
    </div>
  );
}

type PanelProps = {
  engine: ParticleEngine | null;
  config: EngineConfig;
  onConfig: (c: EngineConfig) => void;
  busy: boolean;
  error: string | null;
};

/** Live controls for the particle sim. Toggle with the icon or the H key. */
export function TuningPanel({ engine, config, onConfig, busy, error }: PanelProps) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState(FIELD.seed);
  const [gpuOk, setGpuOk] = useState(false);
  useEffect(() => setGpuOk(webgpuAvailable()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "h" || e.key === "H") && !(e.target instanceof HTMLInputElement)) setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rebuild = () => engine?.rebuildField();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 left-4 z-50 p-2 rounded-full text-ink/40 hover:text-ink transition-colors duration-300 cursor-pointer"
        aria-label={open ? "Hide particle controls" : "Show particle controls"}
        aria-expanded={open}
      >
        <SlidersHorizontal size={18} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="fixed left-4 bottom-14 z-50 w-[26rem] max-h-[calc(100vh-5rem)] overflow-y-auto rounded-md bg-paper/90 backdrop-blur-sm p-3 text-xs text-ink font-mono shadow-sm ring-1 ring-ink/10">
          <div className="grid grid-cols-[auto_1fr_3.5em] gap-x-2 gap-y-1 items-center">
            <b className="col-span-3 font-bold">Render engine</b>
            <div className="col-span-3 grid grid-cols-2 gap-1" role="radiogroup" aria-label="Render engine">
              {ENGINES.map(({ kind, label }) => {
                const disabled = busy || (kind === "webgpu" && !gpuOk);
                const active = config.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={disabled}
                    onClick={() => !active && onConfig({ ...config, kind })}
                    className={`rounded border px-2 py-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-ink bg-ink text-paper" : "border-ink/30 hover:bg-ink/10"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {!gpuOk && <span className="col-span-3 opacity-60">This browser doesn&apos;t support WebGPU.</span>}
            {error && <span className="col-span-3 text-red-600">WebGPU failed: {error}</span>}
            <label className="col-span-3 flex items-center gap-2">
              particles
              <select
                className="rounded border border-ink/30 bg-transparent px-1"
                value={config.count}
                disabled={busy}
                onChange={(e) => onConfig({ ...config, count: Number(e.target.value) })}
              >
                {COUNTS.map((n) => <option key={n} value={n}>{n.toLocaleString()}{n === BASE_COUNT ? " (original)" : ""}</option>)}
              </select>
              {busy && <span className="opacity-60">switching…</span>}
            </label>
            <Stats engine={engine} />
            <Check label="steering sim (off = original movement)" get={() => SIM.mode === "steer"} set={(v) => { SIM.mode = v ? "steer" : "original"; }} />
            <Check label="show noise field" get={() => SIM.showField} set={(v) => { SIM.showField = v; }} />
            <Check label="live 3D noise (regenerate field every frame)" get={() => SIM.liveNoise} set={(v) => { SIM.liveNoise = v; }} />
            {GROUPS.map((g) => (
              <div key={g.title} className="contents">
                <b className="col-span-3 mt-2 font-bold">{g.title}</b>
                {g.sim?.map((spec) => <Slider key={spec[0]} obj={SIM} spec={spec} />)}
                {g.field?.map((spec) => <Slider key={spec[0]} obj={FIELD} spec={spec} onCommit={g.rebuild ? rebuild : undefined} />)}
              </div>
            ))}
            <Check label="ridged (veins) vs plain (blobs)" get={() => FIELD.ridged} set={(v) => { FIELD.ridged = v; rebuild(); }} />
            <button
              type="button"
              className="col-span-3 mt-1 rounded border border-ink/30 px-2 py-0.5 hover:bg-ink/10 cursor-pointer"
              onClick={() => { FIELD.seed = (Math.random() * 1e6) | 0; setSeed(FIELD.seed); rebuild(); }}
            >
              new noise seed ({seed})
            </button>
          </div>
        </div>
      )}
    </>
  );
}
