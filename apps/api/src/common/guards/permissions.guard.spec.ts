import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS } from '../decorators';

const ctx = (user: unknown, required?: string[]) => {
  const reflector = { getAllAndOverride: jest.fn().mockImplementation((k) => (k === PERMISSIONS ? required : undefined)) } as unknown as Reflector;
  const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
  return { guard: new PermissionsGuard(reflector), context };
};

describe('PermissionsGuard', () => {
  it('allows routes with no required permission', () => {
    const { guard, context } = ctx({ permissions: [] }, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a user holding every required permission', () => {
    const { guard, context } = ctx({ isSuperAdmin: false, permissions: ['users:read', 'users:update'] }, ['users:read', 'users:update']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects and reports the missing permissions', () => {
    const { guard, context } = ctx({ isSuperAdmin: false, permissions: ['users:read'] }, ['users:read', 'users:delete']);
    try {
      guard.canActivate(context);
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({ code: 'MISSING_PERMISSION', details: { missing: ['users:delete'] } });
    }
  });

  it('lets a super admin bypass the check', () => {
    const { guard, context } = ctx({ isSuperAdmin: true, permissions: [] }, ['roles:delete']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects when there is no authenticated user', () => {
    const { guard, context } = ctx(undefined, ['users:read']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
