import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@mizmar/shared';
import type { AuthUser } from '../types';

export const IS_PUBLIC = 'isPublic';
/** Skip JWT auth (login, public storefront endpoints). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS = 'permissions';
/** Require ALL listed permissions, e.g. @Permissions('users:read'). */
export const Permissions = (...keys: PermissionKey[]) => SetMetadata(PERMISSIONS, keys);

export const SKIP_AUDIT = 'skipAudit';
export const SkipAudit = () => SetMetadata(SKIP_AUDIT, true);

export const CurrentUser = createParamDecorator((field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest().user as AuthUser;
  return field ? user?.[field] : user;
});

/** Active store resolved by StoreScopeGuard from the `x-store-id` header (or the user's default). */
export const CurrentStore = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().storeId as string | null;
});

export const CUSTOMER_ROUTE = 'customerRoute';
/** Storefront customers may call this route (they are refused everywhere else, whatever the route's permissions). */
export const AllowCustomer = () => SetMetadata(CUSTOMER_ROUTE, 'allow');
/** Only a signed-in storefront customer may call this route (staff are refused). */
export const CustomerOnly = () => SetMetadata(CUSTOMER_ROUTE, 'only');

export const OPTIONAL_AUTH = 'optionalAuth';
/** Public route that still identifies the caller when a valid bearer token is sent (guest checkout vs signed-in checkout). */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
