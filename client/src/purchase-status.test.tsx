import { describe, expect, it } from 'vitest';
import { purchaseStatusLabel, purchaseStatusOptions } from './purchase-status.js';

describe('purchase status labels', () => {
  it('maps all seven API status values to Chinese UI labels', () => {
    expect(purchaseStatusOptions).toEqual([
      { value: 'pending_normal', label: '待审批与普通采购人审批' },
      { value: 'pending_super', label: '待超级管理员审批' },
      { value: 'approved', label: '已通过' },
      { value: 'purchased', label: '已采购' },
      { value: 'deferred', label: '已推迟' },
      { value: 'rejected', label: '已驳回' },
      { value: 'withdrawn', label: '已撤销' },
    ]);
    expect(purchaseStatusOptions.map(({ value }) => purchaseStatusLabel(value))).toEqual([
      '待审批与普通采购人审批',
      '待超级管理员审批',
      '已通过',
      '已采购',
      '已推迟',
      '已驳回',
      '已撤销',
    ]);
  });

  it('falls back safely for an unknown status', () => {
    expect(purchaseStatusLabel('future_status')).toBe('future_status');
  });
});
