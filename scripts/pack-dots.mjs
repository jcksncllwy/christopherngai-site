// Packs dot-cloud JSON ({ meta: { width, height }, dots: [{ x, y, size, opacity }] })
// into a compact binary the particle field loads at runtime.
//
//   node scripts/pack-dots.mjs <src-dir-of-json> [out-dir=public/dots] [max=30000]
//
// Layout (little-endian):
//   u16 width, u16 height, u32 count,
//   then per dot: u16 x, u16 y  (0..65535 over 0..width / 0..height)
//                 u8 size       (0..255 over 0..2 px in source-image units)
//                 u8 opacity    (0..255 over 0..1)
// 6 bytes/dot: ~180 KB per 30k-dot image instead of ~1.8 MB of JSON.
import fs from "node:fs";
import path from "node:path";

const [src, out = "public/dots", maxArg = "30000"] = process.argv.slice(2);
if (!src) { console.error("usage: pack-dots.mjs <src-dir> [out-dir] [max]"); process.exit(1); }
const max = Number(maxArg);
fs.mkdirSync(out, { recursive: true });

for (const file of fs.readdirSync(src).filter((f) => f.endsWith(".json"))) {
  const { meta, dots } = JSON.parse(fs.readFileSync(path.join(src, file), "utf8"));
  // Only the first `max` dots are ever used (the field has 30k particles).
  const used = dots.slice(0, max);
  const buf = Buffer.alloc(8 + used.length * 6);
  buf.writeUInt16LE(meta.width, 0);
  buf.writeUInt16LE(meta.height, 2);
  buf.writeUInt32LE(used.length, 4);
  const q = (v, lo, hi, n) => Math.max(0, Math.min(n, Math.round(((v - lo) / (hi - lo)) * n)));
  used.forEach((d, i) => {
    const o = 8 + i * 6;
    buf.writeUInt16LE(q(d.x, 0, meta.width, 65535), o);
    buf.writeUInt16LE(q(d.y, 0, meta.height, 65535), o + 2);
    buf.writeUInt8(q(d.size, 0, 2, 255), o + 4);
    buf.writeUInt8(q(d.opacity, 0, 1, 255), o + 5);
  });
  const name = file.replace(/\.json$/, ".bin");
  fs.writeFileSync(path.join(out, name), buf);
  console.log(`${name}: ${used.length} dots, ${(buf.length / 1024).toFixed(0)} KB`);
}
