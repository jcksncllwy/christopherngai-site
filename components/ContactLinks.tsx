"use client";

import { useState } from "react";
import { FileText, Mail, MapPin } from "lucide-react";
import { EMAIL, LOCATION } from "@/lib/data";

// The live site serves the resume from /public. This copy is hosted elsewhere,
// so it links to the original.
const RESUME_URL = "https://www.christopherngai.com/Christopher_Ngai_Resume.pdf";

const iconLink = "p-2 rounded-full text-ink hover:bg-ink/10 transition-colors cursor-pointer";

export function ContactLinks() {
  // Tap-to-show for the location tooltip on touch devices (hover on desktop).
  const [showLocation, setShowLocation] = useState(false);

  return (
    <div
      className="fixed top-0 left-0 right-0 md:left-auto z-30 flex flex-row items-center justify-evenly md:justify-end gap-4 md:gap-2 md:pr-6 md:pt-6 py-3 px-4 md:backdrop-blur-sm md:border-none"
      aria-label="Contact links"
    >
      <a href={`mailto:${EMAIL}`} className={iconLink} aria-label={`Email: ${EMAIL}`}>
        <Mail size={22} strokeWidth={1.5} />
      </a>
      <span
        className="group relative p-2 rounded-full text-ink hover:bg-ink/10 transition-colors duration-200 cursor-default"
        aria-label={`Location: ${LOCATION}`}
        onClick={() => setShowLocation((v) => !v)}
        onBlur={() => setShowLocation(false)}
        tabIndex={0}
      >
        <MapPin size={22} strokeWidth={1.5} />
        <span
          className={`absolute top-[calc(100%+0.25rem)] left-1/2 -translate-x-1/2 px-2 py-1 text-xs text-ink bg-paper-dark rounded transition-opacity duration-150 whitespace-nowrap pointer-events-none
            md:opacity-0 md:group-hover:opacity-100
            ${showLocation ? "opacity-100" : "opacity-0"}`}
        >
          {LOCATION}
        </span>
      </span>
      <a href="https://linkedin.com/in/ctngai" target="_blank" rel="noopener noreferrer" className={iconLink} aria-label="LinkedIn profile">
        <svg width={18} height={18} viewBox="0 0 310 310" fill="currentColor" aria-hidden>
          <path d="M72.16,99.73H9.927c-2.762,0-5,2.239-5,5v199.928c0,2.762,2.238,5,5,5H72.16c2.762,0,5-2.238,5-5V104.73C77.16,101.969,74.922,99.73,72.16,99.73z" />
          <path d="M41.066,0.341C18.422,0.341,0,18.743,0,41.362C0,63.991,18.422,82.4,41.066,82.4c22.626,0,41.033-18.41,41.033-41.038C82.1,18.743,63.692,0.341,41.066,0.341z" />
          <path d="M230.454,94.761c-24.995,0-43.472,10.745-54.679,22.954V104.73c0-2.761-2.238-5-5-5h-59.599c-2.762,0-5,2.239-5,5v199.928c0,2.762,2.238,5,5,5h62.097c2.762,0,5-2.238,5-5v-98.918c0-33.333,9.054-46.319,32.29-46.319c25.306,0,27.317,20.818,27.317,48.034v97.204c0,2.762,2.238,5,5,5H305c2.762,0,5-2.238,5-5V194.995C310,145.43,300.549,94.761,230.454,94.761z" />
        </svg>
      </a>
      <a href="https://github.com/cngai" target="_blank" rel="noopener noreferrer" className={iconLink} aria-label="GitHub profile">
        <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
        </svg>
      </a>
      <a href={RESUME_URL} target="_blank" rel="noopener noreferrer" className={iconLink} aria-label="Resume">
        <FileText size={22} strokeWidth={1.5} />
      </a>
    </div>
  );
}
