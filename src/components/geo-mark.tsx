import { useId } from "react";

/**
 * Brand mark: a graticule globe (meridian + parallels) with a location pin,
 * drawn in the portfolio's signature cyan → teal → violet gradient.
 */
export function GeoMark({ className }: { className?: string }) {
  const id = useId();
  const grad = `geo-grad-${id}`;
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient
          id={grad}
          x1="6"
          y1="8"
          x2="42"
          y2="40"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#22d3ee" />
          <stop offset="0.5" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      {/* Globe with graticule */}
      <circle cx="22" cy="24" r="15" stroke={`url(#${grad})`} strokeWidth="2.4" />
      <ellipse
        cx="22"
        cy="24"
        rx="6.5"
        ry="15"
        stroke={`url(#${grad})`}
        strokeWidth="1.5"
        opacity="0.7"
      />
      <path
        d="M8.6 18.5h26.8M7 24h30M8.6 29.5h26.8"
        stroke={`url(#${grad})`}
        strokeWidth="1.5"
        opacity="0.7"
        strokeLinecap="round"
      />
      {/* Location pin anchored on the globe */}
      <path
        d="M41 26.5c0 4.8-6 10.5-6 10.5s-6-5.7-6-10.5a6 6 0 1 1 12 0Z"
        fill={`url(#${grad})`}
        stroke="hsl(var(--background))"
        strokeWidth="1.6"
      />
      <circle cx="35" cy="26.5" r="2.2" fill="hsl(var(--background))" />
    </svg>
  );
}
