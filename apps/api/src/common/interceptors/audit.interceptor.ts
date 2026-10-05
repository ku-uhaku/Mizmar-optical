import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { SKIP_AUDIT } from '../decorators';

const SENSITIVE = /pass(word)?|token|secret|hash/i;
const redact = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : redact(val)]));
  return v;
};
const ACTION: Record<string, string> = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };

/**
 * Global audit trail for every successful mutating request (POST/PUT/PATCH/DELETE) by an
 * authenticated user. Auth events are logged explicitly by AuthService instead.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const action = ACTION[req.method];
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT, [ctx.getHandler(), ctx.getClass()]);
    if (!action || skip || !req.user) return next.handle();

    return next.handle().pipe(
      tap((result) => {
        const segments = req.path.replace(/^\/api\/v\d+\//, '').split('/').filter(Boolean);
        const entity = segments[0] ?? 'unknown';
        const entityId = (req.params as Record<string, string>).id ?? (result as any)?.id ?? segments[1];
        void this.prisma.raw.auditLog
          .create({
            data: {
              actorId: req.user!.id,
              storeId: req.storeId ?? null,
              entity,
              entityId: typeof entityId === 'string' ? entityId : null,
              action,
              after: redact(req.body) as object,
              ip: req.ip,
              userAgent: req.header('user-agent')?.slice(0, 255),
            },
          })
          .catch(() => undefined); // auditing must never break the request
      }),
    );
  }
}
