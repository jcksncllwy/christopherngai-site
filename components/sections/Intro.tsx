"use client";

import { motion, type Variants } from "framer-motion";

const container: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.2 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

export function Intro() {
  return (
    <section className="section-container snap-start flex items-center justify-center p-5 md:p-16 lg:p-24 relative">
      <motion.div
        className="max-w-[51.2rem] lg:max-w-[38rem] xl:max-w-[51.2rem] w-full flex flex-col md:flex-row items-center gap-4 md:gap-16 lg:gap-24"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        <div className="flex-1 text-left md:text-left flex flex-col gap-4 md:gap-6">
          <div className="flex-1 text-left md:text-left flex flex-col gap-3 md:gap-4">
            <motion.h1 className="type-title text-4xl md:text-6xl lg:text-7xl text-ink" variants={item}>
              Christopher Ngai
            </motion.h1>
            <motion.p className="type-subtitle tracking-[0.3em] uppercase text-ink" variants={item}>
              Staff Software Engineer
            </motion.p>
          </div>
          <motion.p className="type-body text-ink" variants={item}>
            Full-stack engineer with 6+ years of experience building and scaling products from the ground up.
            Collaborates cross-functionally with product, design, and customers to turn ambiguous problems into
            meaningful product experiences with a focus on rapid iteration, strong UX, and measurable impact.
          </motion.p>
        </div>
      </motion.div>
    </section>
  );
}
