/** One full-viewport snap slide: horizontal on desktop, vertical on mobile. */
export function SectionSlide({ isMobile, children }: { isMobile: boolean; children: React.ReactNode }) {
  return (
    <div className={isMobile ? "h-screen w-full shrink-0 snap-center flex flex-col" : "min-w-full h-full shrink-0 snap-start"}>
      {isMobile ? <div className="pt-16 flex-1 flex items-center justify-center min-h-0">{children}</div> : children}
    </div>
  );
}
