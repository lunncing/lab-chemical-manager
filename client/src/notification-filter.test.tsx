import { describe, expect, it } from 'vitest';
import type { NotificationItem } from './types.js';
import { filterNotifications, notificationCategoryOptions, notificationReadOptions } from './notification-filter.js';

const item = (id: number, category: string, readAt: string | null): NotificationItem => ({
  id,
  userId: 1,
  category,
  title: `消息 ${id}`,
  body: '内容',
  objectType: null,
  objectId: null,
  readAt,
  createdAt: '2026-08-29T00:00:00.000Z',
});

describe('notification filters', () => {
  it('combines notification category and read state against already-loaded messages', () => {
    const messages = [
      item(1, 'inventory_inbound', null),
      item(2, 'inventory_inbound', '2026-08-29T01:00:00.000Z'),
      item(3, 'approval', null),
      item(4, 'approval', '2026-08-29T02:00:00.000Z'),
    ];

    expect(filterNotifications(messages, 'inventory_inbound', 'unread').map(({ id }) => id)).toEqual([1]);
    expect(filterNotifications(messages, 'approval', 'read').map(({ id }) => id)).toEqual([4]);
    expect(filterNotifications(messages, '', 'read').map(({ id }) => id)).toEqual([2, 4]);
    expect(filterNotifications(messages, 'inventory_move', 'all')).toEqual([]);
  });

  it('provides all eight Chinese category labels and all read-state choices', () => {
    expect(notificationCategoryOptions).toEqual([
      { value: '', label: '全部类型' },
      { value: 'inventory_inbound', label: '药品入库' },
      { value: 'inventory_move', label: '药品调动' },
      { value: 'inventory_discard', label: '药品废弃' },
      { value: 'purchase_normal', label: '普通采购' },
      { value: 'purchase_urgent', label: '加急采购' },
      { value: 'approval', label: '审批结果' },
      { value: 'hazardous', label: '危险品' },
      { value: 'account', label: '账号' },
    ]);
    expect(notificationReadOptions).toEqual([
      { value: 'all', label: '全部消息' },
      { value: 'unread', label: '未读' },
      { value: 'read', label: '已读' },
    ]);
  });
});
