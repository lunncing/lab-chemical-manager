import type { PurchaseStatus, PurchaseType, Role, UserView } from '../../shared/types.js';
export type { UserView, Role };

export interface Person { id: number; username: string; displayName: string; }
export interface Chemical {
  id: number; name: string; specification: string; owner: Person; inboundOperator: Person; inboundAt: string;
  cabinet: 'A' | 'B'; shelf: number; status: 'active' | 'discarded'; discardReason: string | null;
  version: number; createdAt: string; updatedAt: string;
}
export interface Purchase {
  id: number; chemicalName: string; specification: string; purpose: string; hazardous: boolean; requestType: PurchaseType;
  applicant: Person; status: PurchaseStatus; approvalComment: string | null; version: number; createdAt: string; updatedAt: string;
}
export interface AuditLog { id: number; actor: Person; action: string; objectType: string; objectId: string; summary: string; details: unknown; createdAt: string; }
export interface NotificationItem { id: number; userId: number; category: string; title: string; body: string; objectType: string | null; objectId: string | null; readAt: string | null; createdAt: string; }
