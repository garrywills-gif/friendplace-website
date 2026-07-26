/**
 * George Platform — API client.
 *
 * George is a shared platform. Mission Control, the FriendPlace
 * website and the mobile app all talk to him through this module.
 *
 * The endpoints happen to live under `/api/mcgs/george/*` today
 * (Mission Control owned the router first), but the client here is
 * neutral — nothing about the shape of this module is admin-specific.
 */

export type {
  EventDraft,
  EventDraftSource,
  EventTurn,
  EventSession,
  EventApprovalResult,
} from './mcgs-api';

export { eventCreationApi } from './mcgs-api';

export type ConversationOutcome = 'published' | 'submitted_for_review';
