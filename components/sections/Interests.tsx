import { INTERESTS } from "@/lib/data";

export function Interests() {
  return (
    <section className="section-container snap-start flex items-center justify-center p-5 md:p-16 lg:p-24">
      <div className="max-w-[51.2rem] w-full flex flex-col gap-4 md:gap-6">
        <h1 className="type-title text-4xl md:text-6xl lg:text-7xl text-ink">Interests</h1>
        {/* Mobile: compact two-column list */}
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 list-none pl-0 md:hidden type-body text-ink">
          {INTERESTS.map((interest) => (
            <li key={interest.label} className="flex gap-2 items-start">
              <span className="flex-shrink-0">•</span>
              <span>{interest.label}</span>
            </li>
          ))}
        </ul>
        {/* Desktop: cards with descriptions */}
        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {INTERESTS.map((interest) => (
            <div key={interest.label} className="flex flex-col gap-2">
              <h3 className="type-subtitle text-ink text-base">{interest.label}</h3>
              <p className="type-body text-ink leading-relaxed">{interest.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
