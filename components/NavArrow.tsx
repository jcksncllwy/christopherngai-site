import { ChevronLeft, ChevronRight } from "lucide-react";

export function NavArrow({ direction, onClick }: { direction: "left" | "right"; onClick: () => void }) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`fixed ${direction === "left" ? "left-4" : "right-4"} top-1/2 -translate-y-1/2 z-10 p-2 rounded-full text-ink transition-colors duration-300 hover:bg-ink/10 cursor-pointer`}
      aria-label={direction === "left" ? "Previous section" : "Next section"}
    >
      <Icon size={28} strokeWidth={1.5} />
    </button>
  );
}
