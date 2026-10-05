import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { validateEnv, type Env } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { StoreScopeGuard } from './common/guards/store-scope.guard';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { StoresModule } from './modules/stores/stores.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AuditModule } from './modules/audit/audit.module';
import { QueueModule } from './modules/queue/queue.module';
import { StorageModule } from './modules/storage/storage.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { HealthController } from './modules/health/health.controller';

const AUTH_ROUTES = /\/auth\/(login|refresh|forgot-password|reset-password)/;

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env', '../../.env'] }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService<Env, true>) => {
        const ttl = c.get('THROTTLE_TTL', { infer: true }) * 1000;
        return [
          { name: 'default', ttl, limit: c.get('THROTTLE_LIMIT', { infer: true }) },
          // Stricter bucket, only evaluated on credential-style endpoints (brute-force protection).
          { name: 'auth', ttl, limit: c.get('THROTTLE_AUTH_LIMIT', { infer: true }), skipIf: (ctx) => !AUTH_ROUTES.test(ctx.switchToHttp().getRequest<Request>().path) },
        ];
      },
    }),
    PrismaModule,
    QueueModule,
    StorageModule,
    AuthModule,
    UsersModule,
    RbacModule,
    StoresModule,
    SettingsModule,
    AuditModule,
    StorefrontModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Order matters: rate limit -> authenticate -> resolve store -> authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: StoreScopeGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((req: Request, res: Response, next: NextFunction) => {
        req.traceId = (req.header('x-request-id') as string) || randomUUID();
        res.setHeader('x-request-id', req.traceId);
        next();
      })
      .forRoutes('*');
  }
}
