import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC, OPTIONAL_AUTH } from '../decorators';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets)) return super.canActivate(ctx); // identify if a token is sent (handleRequest below)
    return this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ? true : super.canActivate(ctx);
  }

  /** On optional-auth routes a missing/expired token means "guest", not an error. */
  handleRequest<T>(err: unknown, user: T, _info: unknown, ctx: ExecutionContext): T {
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, [ctx.getHandler(), ctx.getClass()]);
    if (optional) return (user || undefined) as T;
    if (err || !user) throw err || new UnauthorizedException();
    return user;
  }
}
