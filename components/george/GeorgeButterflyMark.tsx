'use client';

/**
 * The FriendPlace butterfly mark — the ONE canonical butterfly.
 *
 * Renders the master marketing butterfly image at
 * `/brand-assets/butterfly.png` — the single source of truth for the
 * FriendPlace butterfly across mobile, marketing, Mission Control,
 * George, emails, flyers, empty states, loading and celebration
 * screens. If the master artwork ever changes, update that PNG (and
 * `/app/frontend/assets/brand/friendplace-butterfly.png` for the
 * mobile side) and every surface picks it up automatically.
 *
 * Kept as a component so callers pass a `size` prop and animation can
 * be layered on by the parent (e.g. `GeorgeButterfly` wraps this in
 * an animated transform).
 */
export function GeorgeButterflyMark({ size = 48 }: { size?: number }) {
  return (
    <img
      src="/brand-assets/butterfly.png"
      alt=""
      width={size}
      height={size}
      draggable={false}
      style={{
        display: 'block',
        width: size,
        height: size,
        objectFit: 'contain',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  );
}
