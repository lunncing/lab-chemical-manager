import { z } from 'zod';
import { notificationCategories, roles } from './types.js';

export const loginSchema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) }).strict();
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
  cabinet: z.enum(['A', 'B']), shelf: z.number().int().min(1).max(5),
}).strict();
export const moveSchema = z.object({ cabinet: z.enum(['A', 'B']), shelf: z.number().int().min(1).max(5), version: z.number().int().positive() }).strict();
export const discardSchema = z.object({ confirmed: z.literal(true), reason: z.string().trim().max(500).optional(), version: z.number().int().positive() }).strict();
export const inboundRequestCreateSchema = z.object({
  targetUserId: z.number().int().positive(), name: z.string().trim().min(1).max(200), specification: z.string().trim().min(1).max(200),
  inboundAt: z.iso.datetime(), cabinet: z.enum(['A', 'B']), shelf: z.number().int().min(1).max(5),
}).strict();
export const inboundRequestDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']), comment: z.string().trim().max(1000).optional(), version: z.number().int().positive(),
}).strict();

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
export const preferencesSchema = z.object({ category: z.enum(notificationCategories), enabled: z.boolean() }).strict();
