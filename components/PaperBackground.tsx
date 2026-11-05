import Image from "next/image";
import crumpledPaper from "@/assets/crumpled-paper.avif";

/** Crumpled-paper texture multiplied over the background (hidden in dark mode). */
export function PaperBackground() {
  return (
    <div
      className="fixed inset-0 pointer-events-none opacity-35 dark:opacity-0 transition-opacity duration-300"
      style={{ zIndex: 0, mixBlendMode: "multiply" }}
      aria-hidden="true"
    >
      <Image src={crumpledPaper} alt="" fill style={{ objectFit: "cover" }} />
    </div>
  );
}
