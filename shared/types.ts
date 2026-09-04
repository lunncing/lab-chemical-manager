export const roles = ['member', 'normal_admin', 'super_admin', 'hazardous_buyer'] as const;
export type Role = (typeof roles)[number];
export const notificationCategories = [
  'inventory_inbound', 'inventory_move', 'inventory_discard',
  'purchase_normal', 'purchase_urgent', 'approval', 'hazardous', 'account', 'proxy_inbound',
  'password_reset',
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
export type Cabinet = 'A' | 'B' | 'C1' | 'C2' | 'G1' | 'G2';
export type InboundRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type PurchaseType = 'normal' | 'urgent';
export type PurchaseStatus = 'pending_normal' | 'pending_super' | 'pending_hazardous' | 'approved' | 'purchased' | 'deferred' | 'deferred_hazardous' | 'rejected' | 'withdrawn';

export interface UserView {
  id: number; username: string; displayName: string; role: Role; active: boolean; demo: boolean; version: number;
}
