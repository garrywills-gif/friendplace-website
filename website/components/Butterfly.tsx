/**
 * Slim FriendPlace butterfly — the same silhouette as the mobile app's
 * v5 icon, redrawn inline as SVG so it stays razor-crisp at every
 * viewport size + can be recoloured via CSS `currentColor`.
 *
 * Symmetric on the vertical axis: matches the app-icon rebuild that
 * fixed the earlier cropping/asymmetry issue.
 */
export default function Butterfly({ size = 32, color }: { size?: number; color?: string }) {
  const c = color || 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Body */}
      <path
        d="M32 12c1 0 1.6.7 1.6 1.6v36.8c0 .9-.6 1.6-1.6 1.6s-1.6-.7-1.6-1.6V13.6c0-.9.7-1.6 1.6-1.6z"
        fill={c}
      />
      {/* Left upper wing */}
      <path
        d="M30.4 22.4c0-6.5-5.5-11.5-11.9-10.7C10.6 12.6 6.2 20 8.3 27.5c1.5 5.5 6.4 9.7 12.1 10.4 4.7.6 9.2-1.4 10-4.7 0-3.9 0-6.4 0-10.8z"
        fill={c}
      />
      {/* Right upper wing */}
      <path
        d="M33.6 22.4c0-6.5 5.5-11.5 11.9-10.7 7.9.9 12.3 8.3 10.2 15.8-1.5 5.5-6.4 9.7-12.1 10.4-4.7.6-9.2-1.4-10-4.7 0-3.9 0-6.4 0-10.8z"
        fill={c}
      />
      {/* Left lower wing */}
      <path
        d="M30.4 34c0 5.1-3.9 9.9-9.5 10.5-6 .6-10.7-3.6-10.9-9.4-.1-4.7 3-9 7.4-10.1 4-1 7.9.2 10 3 1.5 2 3 3.7 3 6z"
        fill={c}
        opacity="0.85"
      />
      {/* Right lower wing */}
      <path
        d="M33.6 34c0 5.1 3.9 9.9 9.5 10.5 6 .6 10.7-3.6 10.9-9.4.1-4.7-3-9-7.4-10.1-4-1-7.9.2-10 3-1.5 2-3 3.7-3 6z"
        fill={c}
        opacity="0.85"
      />
      {/* Antennae */}
      <path d="M30.4 12c-1.5-2-4-3.4-6.4-3" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M33.6 12c1.5-2 4-3.4 6.4-3" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
