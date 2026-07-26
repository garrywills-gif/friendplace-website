'use client';

import { AdminShell } from '@/components/admin/AdminShell';
import { SignalFeed } from '@/components/mcgs/SignalFeed';
import { GeorgePresenceCard } from '@/components/mcgs/GeorgePresenceCard';
import { GeorgeSuggestionCard } from '@/components/george/GeorgeSuggestionCard';
import { MorningBriefing } from '@/components/mcgs/MorningBriefing';
import { MiddayPulse } from '@/components/mcgs/MiddayPulse';
import { EndOfDay } from '@/components/mcgs/EndOfDay';

export default function BridgePage() {
  // Reach up to the AdminShell-mounted Ask George bar. It listens on
  // the global `mcgs:ask-george` custom event so any surface in MCGS
  // can open George without prop-drilling.
  const dispatchAsk = (message?: string) => {
    window.dispatchEvent(new CustomEvent('mcgs:ask-george', { detail: { message } }));
  };

  return (
    <AdminShell>
      <div style={container}>
        <header style={heroWrap}>
          <div>
            <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.01em', color: '#0F172A' }}>The Bridge</h1>
            <p style={{ fontSize: 15, color: '#64748B', marginTop: 4, marginBottom: 0 }}>
              What needs your attention today.
            </p>
          </div>
        </header>

        <div style={grid}>
          {/* Left / main column */}
          <div>
            <MorningBriefing onAsk={dispatchAsk} />

            <MiddayPulse onAsk={dispatchAsk} />

            <EndOfDay onAsk={dispatchAsk} />

            <SignalFeed />
          </div>

          {/* Right rail */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <GeorgePresenceCard onAsk={dispatchAsk} />

            <GeorgeSuggestionCard />

            {/* Health Pulse placeholder — Phase 4 will make this live. */}
            <div style={pulseCard}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>Health Pulse</span>
                <span style={{ fontSize: 10, color: '#94A3B8', background: '#F1F5F9', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>Phase 4</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {['Belonging', 'Kindness', 'Safety', 'Growth'].map(ring => (
                  <div key={ring} style={ringPlaceholder}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{ring}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#94A3B8', marginTop: 4 }}>—</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 10, lineHeight: 1.5 }}>
                Rings light up in Phase 4. Every score will show its components + why it moved.
              </div>
            </div>

            <div style={rhythmCard}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>
                Quiet Rhythm
              </div>
              <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>
                Morning Briefing · weekdays 7am · weekends 8:30am<br />
                Midday Pulse · exception-based<br />
                End-of-Day Wrap-up · considerate 6pm<br />
                <span style={{ color: '#94A3B8' }}>Scheduler wires up in Milestone C.</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}

const container: React.CSSProperties = { maxWidth: 1400, margin: '0 auto' };
const heroWrap: React.CSSProperties = { marginBottom: 20 };
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: 24,
};
const pulseCard: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 18,
  boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
};
const ringPlaceholder: React.CSSProperties = {
  padding: 12, background: '#F8FAFC', borderRadius: 10, border: '1px solid #F1F5F9',
};
const rhythmCard: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 18,
  boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
};
