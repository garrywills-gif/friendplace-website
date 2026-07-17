import { StoryCard } from '@/components/admin/StoryCard';
import type { SuccessStory } from '@/lib/cms-api';

// Runtime revalidation — refreshes every 60s so newly-published stories
// appear on the site within a minute of Mission Control hitting Publish.
export const revalidate = 60;

async function fetchStories(): Promise<SuccessStory[]> {
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const res = await fetch(`${base}/api/public/stories`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.stories || []) as SuccessStory[];
  } catch {
    return [];
  }
}

export const metadata = {
  title: 'Success Stories — FriendPlace',
  description: 'Real stories from real people who found their people at FriendPlace.',
};

export default async function SuccessStoriesPage() {
  const stories = await fetchStories();

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px 96px', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{
          display: 'inline-block',
          fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 800,
          color: '#14B8A6', marginBottom: 12,
        }}>
          Success Stories
        </div>
        <h1 style={{
          fontSize: 40, fontWeight: 900, color: '#0A2540', margin: 0, letterSpacing: '-0.02em',
          lineHeight: 1.15,
        }}>
          Real people. Real belonging.
        </h1>
        <p style={{
          fontSize: 17, color: '#475569', maxWidth: 640, margin: '16px auto 0', lineHeight: 1.7,
        }}>
          These are the stories of the people who found their community through FriendPlace.
          Every story starts with someone choosing to reach out.
        </p>
      </div>

      {stories.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 64, borderRadius: 20,
          border: '2px dashed #E2E8F0', background: '#F8FAFC',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🦋</div>
          <p style={{ color: '#475569', fontSize: 16, margin: 0 }}>
            The first stories are being written. Come back soon.
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 24,
        }}>
          {stories.map(story => (
            <StoryCard key={story.id} story={story} variant="full" />
          ))}
        </div>
      )}
    </main>
  );
}
