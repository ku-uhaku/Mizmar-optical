import { ForbiddenException, ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { CUSTOMER_ROUTE, PERMISSIONS, REQUIRES_MODULE } from '../decorators';
import type { ModuleToggleService } from '../../modules/admin-config/modules-toggle.service';

const ctx = (user: unknown, required?: string[], extra: Record<string, unknown> = {}, off: string[] = []) => {
  const meta: Record<string, unknown> = { [PERMISSIONS]: required, ...extra };
  const reflector = { getAllAndOverride: jest.fn().mockImplementation((k: string) => meta[k]) } as unknown as Reflector;
  const modules = { assertEnabled: async (key: string, signedIn: boolean) => { if (off.includes(key)) throw signedIn ? new ForbiddenException({ code: 'MODULE_DISABLED' }) : new NotFoundException({ code: 'MODULE_DISABLED' }); } } as unknown as ModuleToggleService;
  const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
  return { guard: new PermissionsGuard(reflector, modules), context };
};

describe('PermissionsGuard', () => {
  it('allows routes with no required permission', async () => {
    const { guard, context } = ctx({ permissions: [] }, undefined);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows a user holding every required permission', async () => {
    const { guard, context } = ctx({ isSuperAdmin: false, permissions: ['users:read', 'users:update'] }, ['users:read', 'users:update']);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects and reports the missing permissions', async () => {
    const { guard, context } = ctx({ isSuperAdmin: false, permissions: ['users:read'] }, ['users:read', 'users:delete']);
    const err = await guard.canActivate(context).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'MISSING_PERMISSION', details: { missing: ['users:delete'] } });
  });

  it('lets a super admin bypass the check', async () => {
    const { guard, context } = ctx({ isSuperAdmin: true, permissions: [] }, ['roles:delete']);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects when there is no authenticated user', async () => {
    const { guard, context } = ctx(undefined, ['users:read']);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses customer accounts on routes that do not opt in, and staff on customer-only routes', async () => {
    await expect(ctx({ type: 'CUSTOMER', customerId: 'c1', permissions: [] }, undefined).guard.canActivate(ctx({ type: 'CUSTOMER' }, undefined).context)).rejects.toMatchObject({ response: { code: 'CUSTOMER_FORBIDDEN' } });
    const ok = ctx({ type: 'CUSTOMER', customerId: 'c1', permissions: [] }, undefined, { [CUSTOMER_ROUTE]: 'only' });
    await expect(ok.guard.canActivate(ok.context)).resolves.toBe(true);
    const staff = ctx({ type: 'STAFF', permissions: [] }, undefined, { [CUSTOMER_ROUTE]: 'only' });
    await expect(staff.guard.canActivate(staff.context)).rejects.toMatchObject({ response: { code: 'CUSTOMER_ONLY' } });
  });

  it('a switched-off module is refused before permissions, even for a super admin; guests get 404', async () => {
    const admin = ctx({ isSuperAdmin: true, permissions: [] }, ['hr:read'], {}, ['hr']);
    await expect(admin.guard.canActivate(admin.context)).rejects.toMatchObject({ response: { code: 'MODULE_DISABLED' } });
    const guest = ctx(undefined, undefined, { [REQUIRES_MODULE]: 'blog' }, ['blog']);
    await expect(guest.guard.canActivate(guest.context)).rejects.toBeInstanceOf(NotFoundException);
    const supplier = ctx({ isSuperAdmin: true, permissions: [] }, ['suppliers:read'], {}, ['purchasing']); // suppliers belong to purchasing
    await expect(supplier.guard.canActivate(supplier.context)).rejects.toBeInstanceOf(ForbiddenException);
    const fine = ctx({ isSuperAdmin: true, permissions: [] }, ['users:read'], {}, ['hr']);
    await expect(fine.guard.canActivate(fine.context)).resolves.toBe(true);
  });
});
