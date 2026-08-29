import { roles, type Role } from '../../shared/types.js';

const roleLabels: Record<Role, string> = {
  member: '普通成员',
  normal_admin: '审批与普通采购人',
  super_admin: '超级管理员',
  hazardous_buyer: '危险品采购人',
};

export function roleLabel(role: Role): string {
  return roleLabels[role];
}

export const accountRolePrompt = `角色：${roles.map((role) => `${roleLabel(role)} (${role})`).join(' / ')}`;

export function RoleOptions() {
  return <>{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</>;
}
