import { EDUCATION_ACTIVITIES, EDUCATION_HONORS } from "@/lib/data";
import { BulletList } from "./BulletList";

const entryHeader =
  "type-subtitle flex flex-col md:flex-row md:justify-between md:items-baseline gap-0.5 md:gap-4 text-ink";
const periodClass = "flex-shrink-0 md:ml-auto text-ink text-sm md:text-[1.5rem]";

export function Education() {
  return (
    <section className="section-container snap-start flex items-center justify-center p-5 md:p-16 lg:p-24 relative">
      <div className="max-w-[51.2rem] w-full flex flex-col md:flex-row items-center gap-4 md:gap-16 lg:gap-24">
        <div className="flex-1 text-left md:text-left flex flex-col gap-4 md:gap-6">
          <h1 className="type-title text-4xl md:text-6xl lg:text-7xl text-ink">Education</h1>
          <div className="flex flex-col gap-1.5 md:gap-2">
            <div className={entryHeader}>
              <span>University of California, Los Angeles</span>
              <span className={periodClass}>June 2020</span>
            </div>
            <p className="type-body-large text-ink">B.S. Computer Science &amp; Engineering</p>
            {EDUCATION_HONORS.map((honor) => (
              <p key={honor} className="type-body text-ink">
                {honor}
              </p>
            ))}
          </div>
          {EDUCATION_ACTIVITIES.map((activity) => (
            <div key={activity.organization} className="flex flex-col gap-1.5 md:gap-2">
              <div className={entryHeader}>
                <span>{activity.organization}</span>
                <span className={periodClass}>{activity.period}</span>
              </div>
              <p className="type-body-large text-ink">{activity.role}</p>
              <BulletList items={activity.achievements} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
