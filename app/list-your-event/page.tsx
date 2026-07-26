import type { Metadata } from 'next';
import ListYourEventForm from './ListYourEventForm';

export const metadata: Metadata = {
  title: 'List your event — FriendPlace',
  description:
    'Community organisations, clubs, charities and local businesses — submit your event to appear on FriendPlace. Free while we finalise our organisation plans.',
};

/**
 * Public "List your event" page.
 *
 * Design intent
 *   - This is the desktop counterpart of the mobile app's "Host a new
 *     event" flow. Most organisations (RSL, Rotary, libraries, etc.)
 *     will fill this in on a PC.
 *   - Draft-first: every submission lands in Mission Control as
 *     pending until an admin reviews and publishes. That protects
 *     FriendPlace from spam / off-brand listings without slowing
 *     genuine orgs down.
 */
export default function ListYourEventPage() {
  return (
    <main
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '48px 24px 96px',
        fontFamily: 'Public Sans, system-ui, sans-serif',
      }}
    >
      {/* Warm hero — invites organisations in rather than gatekeeping. */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div
          style={{
            display: 'inline-block',
            padding: '4px 14px',
            borderRadius: 999,
            background: '#F0FDFA',
            color: '#0F766E',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          For organisations, clubs & venues
        </div>
        <h1
          style={{
            fontSize: 40,
            fontWeight: 900,
            color: '#0A2540',
            margin: '18px 0 12px',
            letterSpacing: '-0.02em',
          }}
        >
          List your event on FriendPlace ✨
        </h1>
        <p
          style={{
            fontSize: 17,
            color: '#475569',
            maxWidth: 560,
            margin: '0 auto',
            lineHeight: 1.6,
          }}
        >
          FriendPlace welcomes community organisations, clubs, charities and local
          businesses. Fill in the form below and we&rsquo;ll review your event
          and publish it once approved.
        </p>
        <div
          style={{
            display: 'inline-block',
            marginTop: 20,
            padding: '10px 18px',
            borderRadius: 12,
            background: '#FFFBEB',
            border: '1px solid #FDE68A',
            color: '#92400E',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          🎁 Enjoy a free 1-month trial with up to 5 event listings while we
          prepare our organisation plans.
        </div>
      </div>

      <ListYourEventForm />
    </main>
  );
}
