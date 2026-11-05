"use client";

import { motion } from "framer-motion";
import { SECTIONS } from "@/lib/data";

type Props = {
  activeSection: number;
  isMobile: boolean;
  onNavigate: (index: number) => void;
};

/** Dot navigation + progress bar (bottom/left on desktop, right/top on mobile). */
export function SectionNav({ activeSection, isMobile, onNavigate }: Props) {
  const fraction = `${((activeSection + 1) / SECTIONS.length) * 100}%`;
  return (
    <>
      <nav
        className={`fixed z-40 flex gap-2 ${
          isMobile ? "right-4 top-1/2 -translate-y-1/2 flex-col" : "bottom-8 left-1/2 -translate-x-1/2 flex-row"
        }`}
        aria-label="Section navigation"
      >
        {SECTIONS.map((section, i) => (
          <button
            key={section.id}
            onClick={() => onNavigate(i)}
            className="group relative p-2 cursor-pointer"
            aria-label={`Go to ${section.label}`}
            aria-current={activeSection === i ? "true" : undefined}
          >
            <motion.span
              className={`block w-2 h-2 rounded-full transition-colors duration-300 ${
                activeSection === i ? "bg-ink" : "bg-ink/25 group-hover:bg-ink/50"
              }`}
              animate={{ scale: activeSection === i ? 1.25 : 1 }}
              transition={{ duration: 0.2 }}
            />
            {!isMobile && (
              <span className="absolute bottom-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2 px-2 py-1 text-xs text-ink bg-paper-dark rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                {section.label}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div
        className={`fixed z-30 bg-ink/10 ${
          isMobile ? "top-0 left-0 right-0 h-0.5" : "top-0 left-0 bottom-0 w-0.5"
        }`}
      >
        <motion.div
          className={`bg-ink ${isMobile ? "h-full" : "w-full"}`}
          initial={false}
          animate={isMobile ? { width: fraction, height: "100%" } : { height: fraction, width: "100%" }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </>
  );
}
