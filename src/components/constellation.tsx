/**
 * Decorative constellation clusters — connected nodes echoing a GIS network
 * graph, matching the portfolio backdrop. Dark mode only, aria-hidden, and
 * pointer-transparent; sits between the starfield and the app content.
 */
export function Constellation() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 hidden overflow-hidden dark:block"
    >
      <svg
        className="absolute -right-10 top-8 h-72 w-96 opacity-[0.16]"
        viewBox="0 0 400 300"
        fill="none"
      >
        <g stroke="hsl(var(--accent))" strokeWidth="1">
          <path d="M40 220 L130 150 L235 185 L320 90 L360 130" />
          <path d="M130 150 L180 60 L320 90" />
          <path d="M235 185 L300 250 L360 130" />
        </g>
        <g fill="hsl(var(--accent))">
          {[
            [40, 220],
            [130, 150],
            [235, 185],
            [320, 90],
            [360, 130],
            [180, 60],
            [300, 250],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="3" />
          ))}
        </g>
      </svg>
      <svg
        className="absolute -left-8 bottom-16 h-64 w-80 opacity-[0.12]"
        viewBox="0 0 320 260"
        fill="none"
      >
        <g stroke="hsl(var(--halo))" strokeWidth="1">
          <path d="M20 40 L110 110 L60 210 L190 180 L110 110" />
          <path d="M190 180 L280 90 L110 110" />
        </g>
        <g fill="hsl(var(--halo))">
          {[
            [20, 40],
            [110, 110],
            [60, 210],
            [190, 180],
            [280, 90],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="3" />
          ))}
        </g>
      </svg>
    </div>
  );
}
