export function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="type-body text-ink flex flex-col gap-2 md:gap-3 list-none pl-0">
      {items.map((item) => (
        <li key={item} className="flex gap-2 md:gap-3 items-start">
          <span className="text-ink flex-shrink-0">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
