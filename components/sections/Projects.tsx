import { PROJECTS } from "@/lib/data";
import { BulletList } from "./BulletList";

export function Projects() {
  const project = PROJECTS[0];
  return (
    <section className="section-container snap-start flex items-center justify-center p-5 md:p-16 lg:p-24">
      <div className="max-w-[44.8rem] w-full max-h-[85vh] overflow-y-auto">
        <div className="text-left flex flex-col gap-3 md:gap-4">
          <h1 className="type-title text-4xl md:text-6xl lg:text-7xl text-ink">Projects</h1>
          <div className="flex flex-col gap-1.5 md:gap-2">
            <div className="type-subtitle flex flex-col md:flex-row md:justify-between md:items-baseline gap-0.5 md:gap-4 text-ink">
              <span>
                {project.name}, {project.tagline}
              </span>
              <span className="flex-shrink-0 md:ml-auto text-sm md:text-[1.5rem]">{project.period}</span>
            </div>
            <p className="type-body-large text-ink">{project.role}</p>
          </div>
          <p className="type-body text-ink">{project.summary}</p>
          <BulletList items={project.achievements} />
        </div>
      </div>
    </section>
  );
}
