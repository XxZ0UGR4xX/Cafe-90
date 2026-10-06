import { z } from 'zod';

export const uuid = z.string().uuid();
export const slug = z.string().min(2).max(40).regex(/^[a-z0-9-]+$/);
export const money = z.number().finite().min(0).max(99_999_999);

export const LoginDto = z.object({
  tenant: slug,
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
export const PinLoginDto = z.object({
  tenant: slug,
  userCode: z.string().min(1).max(40),
  pin: z.string().regex(/^\d{4,6}$/),
});
export const MfaVerifyDto = z.object({ mfaToken: z.string().min(20).max(2000), code: z.string().min(6).max(20) });
export const MfaEnrollStartDto = z.object({ mfaToken: z.string().min(20).max(2000) });
export const MfaEnrollFinishDto = z.object({ mfaToken: z.string().min(20).max(2000), code: z.string().regex(/^\d{6}$/) });
export const MfaCodeDto = z.object({ code: z.string().regex(/^\d{6}$/) });
export const MfaDisableDto = z.object({ password: z.string().min(1).max(200), code: z.string().min(6).max(20) });
export const ChangePasswordDto = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

export const BranchDto = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(20).regex(/^[A-Z0-9_-]+$/),
  address: z.string().max(300).optional(),
  phone: z.string().max(30).optional(),
  status: z.enum(['OPEN', 'CLOSED', 'MAINTENANCE']).default('OPEN'),
  timezone: z.string().max(60).default('America/Mexico_City'),
});
export const BranchPatchDto = BranchDto.partial();

export const UserCreateDto = z.object({
  email: z.string().email().max(200),
  fullName: z.string().min(2).max(120),
  password: z.string().min(10).max(200),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  userCode: z.string().min(1).max(40).optional(),
  roles: z.array(z.object({ role: z.string(), branchIds: z.array(uuid).nullable() })).min(1),
});
export const UserPatchDto = z.object({
  fullName: z.string().min(2).max(120).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  password: z.string().min(10).max(200).optional(),
  roles: z.array(z.object({ role: z.string(), branchIds: z.array(uuid).nullable() })).min(1).optional(),
});

export const RoleDto = z.object({
  key: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().min(2).max(80),
  permissions: z.array(z.string()).max(300),
});

export const SettingDto = z.object({
  key: z.string().min(1).max(80),
  branchId: uuid.nullable().optional(),
  value: z.unknown(),
});

export type Page<T> = { items: T[]; nextCursor: string | null };
