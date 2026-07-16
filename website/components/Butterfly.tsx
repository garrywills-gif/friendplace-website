/**
 * FriendPlace Butterfly — vector recreation of the EXACT two-tone
 * butterfly used in the mobile app (see /app/frontend/src/components/
 * ButterflyLogo.tsx).
 *
 * Composition:
 *   • Top-left wing:    deep teal        #0E7490
 *   • Top-right wing:   mint             #5EEAD4
 *   • Bottom-left wing: darker teal      #0F766E
 *   • Bottom-right wing:light mint       #99F6E4
 *   • Body + antennae: deep navy         #083344
 *
 * Rendered as inline SVG so it stays crisp at every viewport size and
 * can float/animate without image-drag or bandwidth hits. Uses the same
 * proportional geometry as the RN ButterflyLogo (46 % wing width,
 * 42 % body height, 22° / 32° rotations).
 *
 * For the tiny 24–32px header/footer marks we still render inline SVG
 * (see BrandMark component) so the whole site uses a single consistent
 * butterfly source, no PNG/SVG mismatch.
 */
export default function Butterfly({ size = 320 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="FriendPlace butterfly"
      role="img"
    >
      {/* Top-left wing — deep teal */}
      <g transform="translate(100, 100) rotate(-22)">
        <path
          d="M -46 -52 Q -92 -52 -92 -6 Q -92 32 -46 32 L 0 32 L 0 -52 Z"
          fill="#0E7490"
          transform="translate(-4, -6)"
        />
      </g>

      {/* Top-right wing — mint */}
      <g transform="translate(100, 100) rotate(22)">
        <path
          d="M 46 -52 Q 92 -52 92 -6 Q 92 32 46 32 L 0 32 L 0 -52 Z"
          fill="#5EEAD4"
          transform="translate(4, -6)"
        />
      </g>

      {/* Bottom-left wing — darker teal */}
      <g transform="translate(100, 100) rotate(32)">
        <ellipse
          cx="-24"
          cy="34"
          rx="34"
          ry="30"
          fill="#0F766E"
        />
      </g>

      {/* Bottom-right wing — light mint */}
      <g transform="translate(100, 100) rotate(-32)">
        <ellipse
          cx="24"
          cy="34"
          rx="34"
          ry="30"
          fill="#99F6E4"
        />
      </g>

      {/* Body — deep navy vertical capsule */}
      <rect
        x="94"
        y="44"
        width="12"
        height="84"
        rx="6"
        fill="#083344"
      />

      {/* Head — larger circle at top of body */}
      <circle
        cx="100"
        cy="42"
        r="11"
        fill="#083344"
      />

      {/* Left antenna */}
      <path
        d="M 92 22 Q 82 8 74 4"
        stroke="#083344"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Right antenna */}
      <path
        d="M 108 22 Q 118 8 126 4"
        stroke="#083344"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Tiny antenna tips */}
      <circle cx="74" cy="4" r="2.5" fill="#083344" />
      <circle cx="126" cy="4" r="2.5" fill="#083344" />
    </svg>
  );
}

/**
 * Small mono-colour mark used in nav / footer. Accepts a `color` so
 * we can show a mint mark against the dark footer OR a teal mark
 * against the cream header without loading a second asset.
 *
 * NOTE: uses the SAME silhouette as the full butterfly above so the
 * brand feels cohesive across contexts.
 */
export function BrandMark({ size = 32, color = '#14B8A6' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* All wings in the accent colour — small enough that two-tone
          gets muddy, so we go single-colour for max clarity. */}
      <g transform="translate(100, 100) rotate(-22)">
        <path d="M -46 -52 Q -92 -52 -92 -6 Q -92 32 -46 32 L 0 32 L 0 -52 Z" fill={color} transform="translate(-4, -6)" />
      </g>
      <g transform="translate(100, 100) rotate(22)">
        <path d="M 46 -52 Q 92 -52 92 -6 Q 92 32 46 32 L 0 32 L 0 -52 Z" fill={color} transform="translate(4, -6)" />
      </g>
      <g transform="translate(100, 100) rotate(32)">
        <ellipse cx="-24" cy="34" rx="34" ry="30" fill={color} opacity="0.75" />
      </g>
      <g transform="translate(100, 100) rotate(-32)">
        <ellipse cx="24" cy="34" rx="34" ry="30" fill={color} opacity="0.75" />
      </g>
      <rect x="94" y="44" width="12" height="84" rx="6" fill={color === '#14B8A6' ? '#0A2540' : color} />
      <circle cx="100" cy="42" r="11" fill={color === '#14B8A6' ? '#0A2540' : color} />
    </svg>
  );
}
