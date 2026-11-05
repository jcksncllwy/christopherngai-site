import { EXPERIENCE } from "@/lib/data";
import { BulletList } from "./BulletList";

export function Experience() {
  const job = EXPERIENCE[0];
  return (
    <section className="section-container snap-start flex items-center justify-center p-5 md:p-16 lg:p-24 relative">
      <div className="max-w-[44.8rem] w-full max-h-[85vh] overflow-y-auto">
        <div className="text-left flex flex-col gap-3 md:gap-4">
          <h1 className="type-title text-4xl md:text-6xl lg:text-7xl text-ink">Experience</h1>
          <div className="flex flex-col gap-1.5 md:gap-2">
            <div className="type-subtitle flex flex-col md:flex-row md:justify-between md:items-baseline gap-0.5 md:gap-4 text-ink">
              <span>{job.company}</span>
              <span className="flex-shrink-0 md:ml-auto text-sm md:text-[1.5rem]">{job.period}</span>
            </div>
            <p className="type-body-large text-ink">{job.title}</p>
          </div>
          <p className="type-body text-ink">{job.summary}</p>
          <BulletList items={job.achievements} />
        </div>
      </div>
    </section>
  );
}
