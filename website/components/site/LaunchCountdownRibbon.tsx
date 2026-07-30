'use client';

/**
 * LaunchCountdownRibbon — public marketing ribbon that sits above the
 * hero on the FriendPlace home page.
 *
 * Design contract (locked with Garry, 30 Jul 2026):
 *   • Slim, full-width, above the hero — the first thing a visitor sees.
 *   • NOT dismissible during the countdown window — if we've announced
 *     publicly, everyone should see it. It's part of the anticipation.
 *   • When the countdown hits zero the ribbon SWAPS to the warm welcome
 *     ("The doors are open") + App Store & Google Play buttons.
 *     Never renders both states at once; never flashes.
 *   • Renders NOTHING when disabled (or when the settings doc is
 *     missing / unreachable) — never shows "0 days" or a broken widget.
 *   • Ticks every second in the visitor's local browser time so the
 *     countdown feels immediate.
 *
 * The initial state is passed in from the server component (so the
 * ribbon paints correctly on first render without a flash), and the
 * client hydrates a live ticker on top.
 */

import { useEffect, useMemo, useState } from 'react';

export type LaunchStatus = {
  enabled: boolean;
  launch_at: string | null;      // ISO UTC
  is_live: boolean;
  welcome_message: string;
  appstore_url: string;
  playstore_url: string;
};

export function LaunchCountdownRibbon({ initial }: { initial: LaunchStatus | null }) {
  const [status, setStatus] = useState<LaunchStatus | null>(initial);
  const [now, setNow] = useState<number>(() => Date.now());

  // Cheap re-hydrate: if the initial payload came from build-time
  // rendering we ask again on mount so we always show up-to-date info.
  // Uses NEXT_PUBLIC_API_URL so admin state changes propagate to
  // visitor browsers in real time — a relative /api/... fetch would
  // 404 against the Next.js server since the API is on the FastAPI
  // pod, not on the site itself. Also re-polls every 60s so a launch-
  // complete flip in MCGS reaches visitors within a minute.
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL || '';
    const url = `${base}/api/public/launch-status`;
    let cancelled = false;
    const refresh = () => fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (!cancelled && s) setStatus(s); })
      .catch(() => { /* keep last known state on failure */ });
    refresh();
    const iv = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Tick every second while the countdown is running.
  useEffect(() => {
    if (!status || !status.enabled || status.is_live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Derive the visible state from the current status + wall-clock. We
  // check locally so the ribbon can flip to "live" mid-session without
  // waiting for a refetch.
  const view = useMemo(() => {
    if (!status || !status.enabled) return null;
    const target = status.launch_at ? new Date(status.launch_at).getTime() : NaN;
    if (Number.isNaN(target)) return null;
    const diff = target - now;
    const live = status.is_live || diff <= 0;
    if (live) {
      return {
        mode: 'live' as const,
        message: status.welcome_message,
        appstore: status.appstore_url,
        playstore: status.playstore_url,
      };
    }
    const totalSeconds = Math.max(0, Math.floor(diff / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return { mode: 'counting' as const, days, hours, minutes };
  }, [status, now]);

  if (!view) return null;

  if (view.mode === 'live') {
    return (
      <div style={ribbon} role="region" aria-label="FriendPlace is live">
        <div style={inner}>
          <span style={welcomeText}>{view.message}</span>
          <div style={storeButtons}>
            {view.appstore && (
              <a
                href={view.appstore}
                target="_blank"
                rel="noopener noreferrer"
                style={storeBtn}
                aria-label="Download on the App Store"
              >
                {/* Apple logo: renders as the Apple mark on Apple devices,
                    styled small so the "empty box" fallback on other OSes
                    is essentially invisible. Kept for brand recognition
                    without dominating the button on non-Apple platforms. */}
                <span style={{ fontSize: 16, opacity: 0.92 }} aria-hidden></span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={storeBtnSmall}>Download on the</span>
                  <span style={storeBtnLarge}>App Store</span>
                </span>
              </a>
            )}
            {view.playstore && (
              <a
                href={view.playstore}
                target="_blank"
                rel="noopener noreferrer"
                style={storeBtn}
                aria-label="Get it on Google Play"
              >
                <span style={{ fontSize: 16 }} aria-hidden>▶</span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={storeBtnSmall}>Get it on</span>
                  <span style={storeBtnLarge}>Google Play</span>
                </span>
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={ribbon} role="region" aria-label="FriendPlace launch countdown">
      <div style={inner}>
        <span style={butterfly} aria-hidden>🦋</span>
        <span style={label}>FriendPlace launches in</span>
        <span style={countdownGroup} aria-live="polite">
          <TimeSegment value={view.days} label="Days" />
          <span style={dot} aria-hidden>·</span>
          <TimeSegment value={view.hours} label="Hours" />
          <span style={dot} aria-hidden>·</span>
          <TimeSegment value={view.minutes} label="Minutes" />
        </span>
        <span style={tagline}>Every friendship starts with a hello.</span>
      </div>
    </div>
  );
}

function TimeSegment({ value, label }: { value: number; label: string }) {
  return (
    <span style={segmentBox}>
      <span style={segmentValue}>{value}</span>
      <span style={segmentLabel}>{label}</span>
    </span>
  );
}

// ─── styles ────────────────────────────────────────────────────────────
const ribbon: React.CSSProperties = {
  background: 'linear-gradient(180deg, #05192C 0%, #0A2540 100%)',
  color: '#E8F4FF',
  borderBottom: '1px solid rgba(94, 234, 212, 0.24)',
  boxShadow: '0 1px 0 rgba(94, 234, 212, 0.12) inset',
  fontFeatureSettings: '"tnum"',
};
const inner: React.CSSProperties = {
  maxWidth: 1280,
  margin: '0 auto',
  padding: '12px 24px',
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  flexWrap: 'wrap',
  justifyContent: 'center',
};
const butterfly: React.CSSProperties = { fontSize: 20, filter: 'drop-shadow(0 0 6px rgba(94,234,212,0.55))' };
const label: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#B7DFF7', letterSpacing: '0.01em' };
const countdownGroup: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6 };
const segmentBox: React.CSSProperties = { display: 'inline-flex', alignItems: 'baseline', gap: 4 };
const segmentValue: React.CSSProperties = { fontSize: 20, fontWeight: 800, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' };
const segmentLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#5EEAD4', textTransform: 'uppercase', letterSpacing: '0.06em' };
const dot: React.CSSProperties = { color: 'rgba(94,234,212,0.5)', fontWeight: 700, margin: '0 2px' };
const tagline: React.CSSProperties = { fontSize: 13, color: '#8AB2CC', fontStyle: 'italic' };

// live state
const welcomeText: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.005em' };
const storeButtons: React.CSSProperties = { display: 'inline-flex', gap: 10, marginLeft: 4 };
const storeBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  background: '#000000', color: '#FFFFFF',
  padding: '6px 14px', borderRadius: 8, textDecoration: 'none',
  border: '1px solid rgba(255,255,255,0.16)',
};
const storeBtnSmall: React.CSSProperties = { fontSize: 9, letterSpacing: '0.04em', opacity: 0.85, textTransform: 'uppercase' };
const storeBtnLarge: React.CSSProperties = { fontSize: 14, fontWeight: 700, lineHeight: 1.1 };
