import type { Cabinet, InboundRequestStatus, PurchaseStatus, PurchaseType, Role, UserView } from '../../shared/types.js';
export type { UserView, Role };

export interface Person { id: number; username: string; displayName: string; }
export type RegistrationInviteStatus = 'active' | 'used' | 'revoked' | 'expired';
export interface RegistrationInvite {
  id: number; codeHint: string; creator: Person; createdAt: string; expiresAt: string; status: RegistrationInviteStatus;
  usedBy: Person | null; usedAt: string | null; revokedAt: string | null; version: number;
}
export interface CreatedRegistrationInvite {
  id: number; code: string; codeHint: string; createdAt: string; expiresAt: string; version: number;
}
export interface Chemical {
  id: number; name: string; specification: string; owner: Person; inboundOperator: Person; inboundAt: string;
  cabinet: Cabinet; shelf: number; status: 'active' | 'discarded'; discardReason: string | null;
  version: number; createdAt: string; updatedAt: string;
}
export interface Purchase {
  id: number; chemicalName: string; specification: string; purpose: string; hazardous: boolean; requestType: PurchaseType;
  applicant: Person; status: PurchaseStatus; approvalComment: string | null; version: number; createdAt: string; updatedAt: string;
}
export interface PurchaseWeekInfo { weekStart: string; weekEnd: string; isCurrent: boolean; }
export interface PurchaseWeekSummary extends PurchaseWeekInfo { count: number; approvedCount: number; purchasedCount: number; }
export interface AuditLog { id: number; actor: Person; action: string; objectType: string; objectId: string; summary: string; details: unknown; createdAt: string; }
export interface NotificationItem { id: number; userId: number; category: string; title: string; body: string; objectType: string | null; objectId: string | null; readAt: string | null; createdAt: string; }
export type PasswordResetRequestStatus = 'pending' | 'approved' | 'rejected' | 'appealed' | 'consumed' | 'expired';
export interface PasswordResetRequest {
  id: number; user: Person; status: PasswordResetRequestStatus; appealReason: string | null; reviewer: Person | null;
  reviewComment: string | null; version: number; createdAt: string; updatedAt: string; expiresAt: string;
  reviewedAt: string | null; consumedAt: string | null;
}
export interface InboundRequest {
  id: number; requester: Person; targetUser: Person; name: string; specification: string; inboundAt: string;
  cabinet: Cabinet; shelf: number; status: InboundRequestStatus; decisionComment: string | null; chemicalId: number | null;
  version: number; createdAt: string; updatedAt: string; decidedAt: string | null; withdrawnAt: string | null;
}
