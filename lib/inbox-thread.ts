import type { InboxMessage } from './inbox-api';

/** The notification sender is shared; identify the person inside the form email. */
function correspondent(message: InboxMessage): string {
  const sender = (message.from_email || '').trim().toLowerCase();
  if (/^(?:no-?reply)@friendplace\.com\.au$/.test(sender)) {
    const content = message.text || (message.html || '').replace(/<[^>]*>/g, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
    const match = content.match(/From:\s*[^\n]*?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
    return match?.[1]?.toLowerCase() || '';
  }
  return sender;
}

export function selectedConversation(message: InboxMessage, thread: InboxMessage[]): InboxMessage[] {
  const person = correspondent(message);
  const subject = (s: string) => (s || '').replace(/^(?:(?:re|fw|fwd):\s*)+/i, '').trim().toLowerCase();
  const result = thread.filter(item => {
    if (item.id === message.id) return true;
    if (!person) return false; // Never group unidentified notification senders.
    if (item.mailbox && message.mailbox && item.mailbox.toLowerCase() !== message.mailbox.toLowerCase()) return false;
    if (subject(item.subject) !== subject(message.subject)) return false;
    return item.direction === 'outbound'
      ? (item.to_email || '').trim().toLowerCase() === person
      : correspondent(item) === person;
  });
  return result.some(item => item.id === message.id) ? result : [...result, message];
}
