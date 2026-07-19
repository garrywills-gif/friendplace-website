'use client';

/**
 * The FriendPlace butterfly mark.
 *
 * A simple, warm, elegant SVG intended to become a brand element.
 * Two wing groups drawn separately so the CSS animation in
 * GeorgeButterfly can flap them without any JS. Teal → cyan gradient
 * to match the FriendPlace palette; body is a slightly deeper teal.
 *
 * Sized by `size` (px). Preserves aspect ratio.
 */

export function GeorgeButterflyMark({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="fp-wing-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="#5EEAD4" />
          <stop offset="55%" stopColor="#14B8A6" />
          <stop offset="100%" stopColor="#0EA5E9" />
        </linearGradient>
        <linearGradient id="fp-wing-b" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#5EEAD4" />
          <stop offset="55%" stopColor="#14B8A6" />
          <stop offset="100%" stopColor="#0EA5E9" />
        </linearGradient>
        <radialGradient id="fp-wing-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#FFFFFF" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Left wing */}
      <g>
        <path
          d="M31 32 C 22 12, 8 10, 3 22 C 0 30, 6 40, 14 46 C 22 50, 28 46, 31 40 Z"
          fill="url(#fp-wing-a)"
        />
        <ellipse cx="18" cy="26" rx="6" ry="5" fill="url(#fp-wing-glow)" />
      </g>

      {/* Right wing */}
      <g>
        <path
          d="M33 32 C 42 12, 56 10, 61 22 C 64 30, 58 40, 50 46 C 42 50, 36 46, 33 40 Z"
          fill="url(#fp-wing-b)"
        />
        <ellipse cx="46" cy="26" rx="6" ry="5" fill="url(#fp-wing-glow)" />
      </g>

      {/* Body */}
      <ellipse cx="32" cy="33" rx="2" ry="12" fill="#0F766E" />
      {/* Head */}
      <circle cx="32" cy="22" r="3" fill="#0F766E" />
      {/* Antennae */}
      <path d="M32 20 C 30 15, 28 14, 27 12" stroke="#0F766E" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M32 20 C 34 15, 36 14, 37 12" stroke="#0F766E" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <circle cx="27" cy="12" r="1.2" fill="#0F766E" />
      <circle cx="37" cy="12" r="1.2" fill="#0F766E" />
    </svg>
  );
}
