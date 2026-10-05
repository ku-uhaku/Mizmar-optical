import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Resolves the active store for the request. A client may pick one with `x-store-id`;
 * it must be one the user belongs to (super admins may pick any). Otherwise the user's
 * default store is used. Services then scope store-bound data with `@CurrentStore()`.
 */
@Injectable()
export class StoreScopeGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user) return true; // public route
    const requested = req.header('x-store-id');
    if (requested) {
      if (!user.isSuperAdmin && !user.storeIds.includes(requested)) {
        throw new ForbiddenException({ code: 'STORE_FORBIDDEN', message: 'You do not have access to this store' });
      }
      req.storeId = requested;
    } else {
      req.storeId = user.defaultStoreId;
    }
    return true;
  }
}
