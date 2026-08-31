import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Register Your Interest | FriendPlace Australia',
  description: 'Register your interest in FriendPlace and be among the first Australians to join a community built for genuine friendship, local connection and belonging.',
  alternates: { canonical: '/register-interest' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Register Your Interest | FriendPlace Australia',
    description: 'Be among the first to join FriendPlace — an Australian community for genuine friendship and local connection.',
    url: '/register-interest',
    type: 'website',
  },
};

export default function RegisterInterestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
