import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Meet George & Georgia | FriendPlace',
  description: 'Meet George and Georgia, the welcoming FriendPlace hosts helping adults discover local people, groups, events and genuine friendship in Australia.',
  alternates: { canonical: '/meet' },
  openGraph: {
    title: 'Meet George & Georgia | FriendPlace',
    description: 'Meet the welcoming hosts who help make FriendPlace feel friendly, simple and human from the first hello.',
    url: '/meet',
    type: 'website',
  },
};

export default function MeetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
