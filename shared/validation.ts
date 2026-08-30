import { z } from 'zod';
import { notificationCategories, roles } from './types.js';
import { cabinetIds, locationError } from './cabinets.js';

const cabinetSchema = z.enum(cabinetIds, { error: '柜号仅允许 A、B 或 C' });
const shelfSchema = z.number({ error: '柜层必须是整数' });

function validateLocation(value: { cabinet: unknown; shelf: unknown }, ctx: { addIssue(issue: { code: 'custom'; message: string; path: string[] }): void }) {
  const message = locationError(value.cabinet, value.shelf);
  if (message) ctx.addIssue({ code: 'custom', message, path: ['shelf'] });
}

export const loginSchema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) }).strict();
export const registrationSchema = z.object({
  username: z.string().min(3, '用户名至少需要 3 个字符').max(80, '用户名不能超过 80 个字符').regex(/^[a-zA-Z0-9._-]+$/, '用户名只能包含字母、数字、点、下划线和连字符'),
  displayName: z.string().trim().min(1, '姓名不能为空').max(100, '姓名不能超过 100 个字符'),
  password: z.string().min(10, '密码至少需要 10 个字符').max(200, '密码不能超过 200 个字符'),
  passwordConfirm: z.string().min(1, '请确认密码').max(200, '确认密码不能超过 200 个字符'),
  inviteCode: z.string({ error: '邀请码无效或已失效' }).trim().regex(/^LSF-[A-Za-z0-9_-]{32}$/, '邀请码无效或已失效'),
}).strict().refine((value) => value.password === value.passwordConfirm, { message: '两次输入的密码不一致', path: ['passwordConfirm'] });
export const userCreateSchema = z.object({
  username: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(100), role: z.enum(roles), password: z.string().min(10).max(200),
}).strict();
export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(), role: z.enum(roles).optional(),
  active: z.boolean().optional(), password: z.string().min(10).max(200).optional(), version: z.number().int().positive(),
}).strict();

export const chemicalCreateSchema = z.object({
  name: z.string().trim().min(1).max(200), specification: z.string().trim().min(1).max(200),
  inboundAt: z.iso.datetime(),
  cabinet: cabinetSchema, shelf: shelfSchema,
}).strict().superRefine(validateLocation);
export const moveSchema = z.object({ cabinet: cabinetSchema, shelf: shelfSchema, version: z.number().int().positive() }).strict().superRefine(validateLocation);
export const discardSchema = z.object({ confirmed: z.literal(true), reason: z.string().trim().max(500).optional(), version: z.number().int().positive() }).strict();
export const inboundRequestCreateSchema = z.object({
  targetUserId: z.number().int().positive(), name: z.string().trim().min(1).max(200), specification: z.string().trim().min(1).max(200),
  inboundAt: z.iso.datetime(), cabinet: cabinetSchema, shelf: shelfSchema,
}).strict().superRefine(validateLocation);
export const inboundRequestDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']), comment: z.string().trim().max(1000).optional(), version: z.number().int().positive(),
}).strict();

export const chemicalQuerySchema = z.object({
  cabinet: cabinetSchema.optional(),
  shelf: z.string().regex(/^[1-5]$/, '柜层仅允许 1–5').transform(Number).optional(),
  search: z.string().trim().max(200).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.cabinet !== undefined && value.shelf !== undefined) validateLocation(value as { cabinet: unknown; shelf: unknown }, ctx);
});

export const purchaseCreateSchema = z.object({
  chemicalName: z.string().trim().min(1).max(200), specification: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(1000), hazardous: z.boolean(), requestType: z.enum(['normal', 'urgent']),
}).strict();
export const purchaseUpdateSchema = purchaseCreateSchema.partial().extend({ version: z.number().int().positive() }).strict().refine(
  (value) => Object.keys(value).some((key) => key !== 'version'), { message: '至少修改一个申请字段' },
);
export const decisionSchema = z.object({ decision: z.enum(['approved', 'deferred', 'rejected']), comment: z.string().trim().max(1000).optional(), version: z.number().int().positive() }).strict()
  .superRefine((value, ctx) => { if ((value.decision === 'deferred' || value.decision === 'rejected') && !value.comment) ctx.addIssue({ code: 'custom', message: '推迟或驳回必须填写说明', path: ['comment'] }); });
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();
export const registrationInviteCreateSchema = z.object({}).strict();
export const preferencesSchema = z.object({ category: z.enum(notificationCategories), enabled: z.boolean() }).strict();
