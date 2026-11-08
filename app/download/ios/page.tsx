import { redirect } from 'next/navigation';

// Keep the QR-printed FriendPlace address stable while forwarding visitors
// directly to the confirmed Australian App Store listing.
export default function IOSDownloadPage() {
  redirect('https://apps.apple.com/au/app/id6796969555');
}
