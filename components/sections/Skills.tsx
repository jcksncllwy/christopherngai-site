import { SKILLS } from "@/lib/data";

export function Skills() {
  return (
    <section className="section-container snap-start flex items-center justify-center p-5 md:p-16 lg:p-24">
      <div className="max-w-[51.2rem] w-full max-h-[85vh] overflow-y-auto">
        <div className="text-left flex flex-col gap-4 md:gap-6">
          <h1 className="type-title text-4xl md:text-6xl lg:text-7xl text-ink">Skills</h1>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 lg:gap-8">
            {SKILLS.map((group) => (
              <div key={group.category} className="type-body flex flex-col gap-2">
                <h3 className="type-subtitle text-ink text-base">{group.category}</h3>
                <p className="type-body text-ink leading-relaxed">{group.items.join(", ")}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
