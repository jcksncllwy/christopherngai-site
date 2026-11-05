"use client";

import { useCallback, useRef } from "react";
import { ContactLinks } from "@/components/ContactLinks";
import { NavArrow } from "@/components/NavArrow";
import { PaperBackground } from "@/components/PaperBackground";
import { SectionNav } from "@/components/SectionNav";
import { SectionSlide } from "@/components/SectionSlide";
import { SourceLink } from "@/components/SourceLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ParticleCanvas } from "@/components/particles/ParticleCanvas";
import { Education } from "@/components/sections/Education";
import { Experience } from "@/components/sections/Experience";
import { Interests } from "@/components/sections/Interests";
import { Intro } from "@/components/sections/Intro";
import { Projects } from "@/components/sections/Projects";
import { Skills } from "@/components/sections/Skills";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useScrollProgress } from "@/hooks/useScrollProgress";
import { SECTIONS } from "@/lib/data";

const SECTION_COMPONENTS = [Intro, Experience, Projects, Education, Skills, Interests];

export default function Home() {
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Desktop scrolls horizontally, mobile vertically.
  const { progress } = useScrollProgress(scrollRef, isMobile, SECTIONS.length);
  const activeSection = Math.round(progress);

  const navigateTo = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      if (isMobile) el.scrollTo({ top: index * el.offsetHeight, behavior: "smooth" });
      else el.scrollTo({ left: index * el.offsetWidth, behavior: "smooth" });
    },
    [isMobile],
  );
  const goPrev = useCallback(() => activeSection > 0 && navigateTo(activeSection - 1), [activeSection, navigateTo]);
  const goNext = useCallback(
    () => activeSection < SECTIONS.length - 1 && navigateTo(activeSection + 1),
    [activeSection, navigateTo],
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-paper relative">
      <PaperBackground />
      <ThemeToggle />
      <SourceLink />
      <ContactLinks />
      <SectionNav activeSection={activeSection} isMobile={isMobile} onNavigate={navigateTo} />
      <ParticleCanvas progress={progress} isMobile={isMobile} />
      {!isMobile && activeSection > 0 && <NavArrow direction="left" onClick={goPrev} />}
      {!isMobile && activeSection < SECTIONS.length - 1 && <NavArrow direction="right" onClick={goNext} />}
      <div
        ref={scrollRef}
        className={`h-full w-full scrollbar-hide ${
          isMobile
            ? "overflow-y-auto overflow-x-hidden snap-y snap-mandatory pr-6"
            : "overflow-x-auto overflow-y-hidden snap-x snap-mandatory flex"
        }`}
      >
        {SECTION_COMPONENTS.map((Section, i) => (
          <SectionSlide key={SECTIONS[i].id} isMobile={isMobile}>
            <Section />
          </SectionSlide>
        ))}
      </div>
    </div>
  );
}
