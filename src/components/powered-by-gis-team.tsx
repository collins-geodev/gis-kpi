import { cn } from "@/lib/utils";

/**
 * "Powered by the GIS Team" marquee (spec §15).
 * - Scrolls horizontally, glows softly, breathes between scale 0.98–1.02.
 * - Pauses on hover/focus (CSS), disabled entirely under reduced-motion (CSS).
 * - The animated track is aria-hidden and duplicated for a seamless loop; a
 *   single sr-only label carries the accessible text (no repetition for AT).
 */
export function PoweredByGisTeam({
  className,
  repeat = 6,
}: {
  className?: string;
  repeat?: number;
}) {
  const chips = Array.from({ length: repeat });
  return (
    <div
      className={cn(
        "gis-marquee flex items-center border-t border-border/40 bg-background/60 py-1.5 backdrop-blur",
        className,
      )}
    >
      <span className="sr-only">Powered by the GIS Team</span>
      <div className="gis-marquee__track" aria-hidden="true">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex">
            {chips.map((_, i) => (
              <span key={i} className="gis-marquee__chip">
                <span aria-hidden>◈</span> Powered by the GIS Team
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
