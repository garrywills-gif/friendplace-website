import type { Metadata } from 'next';

// The admin section MUST never be indexed regardless of the
// site-wide FRIENDPLACE_INDEXABLE flag — override the parent metadata
// with a hard noindex here.
export const metadata: Metadata = {
  title: 'Admin — FriendPlace',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
