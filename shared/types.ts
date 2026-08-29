export const roles = ['member', 'normal_admin', 'super_admin', 'hazardous_buyer'] as const;
export type Role = (typeof roles)[number];
export const notificationCategories = [
  'inventory_inbound', 'inventory_move', 'inventory_discard',
  'purchase_normal', 'purchase_urgent', 'approval', 'hazardous', 'account',
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
export type PurchaseType = 'normal' | 'urgent';
export type PurchaseStatus = 'pending_normal' | 'pending_super' | 'approved' | 'deferred' | 'rejected' | 'withdrawn';

export interface UserView {
  id: number; username: string; displayName: string; role: Role; active: boolean; demo: boolean; version: number;
}
