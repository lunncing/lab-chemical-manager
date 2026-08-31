import { notificationCategories, type NotificationCategory } from '../../shared/types.js';
import type { NotificationItem } from './types.js';

export type NotificationCategoryFilter = '' | NotificationCategory;
export type NotificationReadFilter = 'all' | 'unread' | 'read';

const categoryLabels: Record<NotificationCategory, string> = {
  inventory_inbound: '药品入库',
  inventory_move: '药品调动',
  inventory_discard: '药品废弃',
  purchase_normal: '普通采购',
  purchase_urgent: '加急采购',
  approval: '审批结果',
  hazardous: '危险品',
  account: '账号',
  proxy_inbound: '代入库',
  password_reset: '密码修改',
};

export const notificationCategoryOptions = [
  { value: '', label: '全部类型' },
  ...notificationCategories.map((value) => ({ value, label: categoryLabels[value] })),
];

export const notificationReadOptions: Array<{ value: NotificationReadFilter; label: string }> = [
  { value: 'all', label: '全部消息' },
  { value: 'unread', label: '未读' },
  { value: 'read', label: '已读' },
];

export function notificationCategoryName(value: string) {
  return categoryLabels[value as NotificationCategory] ?? value;
}

export function filterNotifications(items: NotificationItem[], category: NotificationCategoryFilter, readState: NotificationReadFilter) {
  return items.filter((item) => {
    if (category && item.category !== category) return false;
    if (readState === 'unread') return !item.readAt;
    if (readState === 'read') return Boolean(item.readAt);
    return true;
  });
}
