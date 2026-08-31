import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { accountRolePrompt, RoleOptions, roleLabel } from './role-labels.js';

describe('centralized role labels', () => {
  it('maps all internal roles to their public Chinese names', () => {
    expect(roleLabel('member')).toBe('普通成员');
    expect(roleLabel('normal_admin')).toBe('审批与普通采购人');
    expect(roleLabel('super_admin')).toBe('超级管理员');
    expect(roleLabel('hazardous_buyer')).toBe('审批与危险采购人');
  });

  it('keeps internal role values while showing labels in account create and edit controls', () => {
    const html = renderToStaticMarkup(<select><RoleOptions /></select>);
    expect(html).toContain('<option value="normal_admin">审批与普通采购人</option>');
    expect(html).toContain('<option value="hazardous_buyer">审批与危险采购人</option>');
    expect(accountRolePrompt).toContain('审批与普通采购人 (normal_admin)');
    expect(accountRolePrompt).not.toContain('普通管理员');
  });
});
