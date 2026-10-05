import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CUSTOMER_ROUTE, PERMISSIONS, REQUIRES_MODULE } from '../decorators';
import { ModuleToggleService, PERMISSION_MODULE } from '../../modules/admin-config/modules-toggle.service';
import type { AuthUser } from '../types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly modules: ModuleToggleService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, [ctx.getHandler(), ctx.getClass()]);
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    // Storefront customers and staff share one login system, so the wall between them is enforced here, once, for every route:
    // a customer reaches only routes that opt in, and customer-only routes refuse staff.
    const mode = this.reflector.getAllAndOverride<'allow' | 'only' | undefined>(CUSTOMER_ROUTE, [ctx.getHandler(), ctx.getClass()]);
    if (user?.type === 'CUSTOMER' && !mode) throw new ForbiddenException({ code: 'CUSTOMER_FORBIDDEN', message: 'Not available for customer accounts' });
    if (mode === 'only' && (!user || user.type !== 'CUSTOMER' || !user.customerId)) throw new ForbiddenException({ code: 'CUSTOMER_ONLY', message: 'Sign in with a customer account' });
    // a switched-off module answers "disabled" before anything else (permissions of staff included)
    const explicit = this.reflector.getAllAndOverride<string | undefined>(REQUIRES_MODULE, [ctx.getHandler(), ctx.getClass()]);
    const key = explicit ?? (required?.length ? PERMISSION_MODULE[required[0].split(':')[0]] : undefined);
    if (key) await this.modules.assertEnabled(key, !!user);
    if (!required?.length) return true;
    if (!user) throw new ForbiddenException('Authentication required');
    if (user.isSuperAdmin) return true;
    const granted = new Set(user.permissions);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length) throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Insufficient permissions', details: { missing } });
    return true;
  }
}
