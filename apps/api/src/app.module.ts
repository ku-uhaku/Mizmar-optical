import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
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
import { NumberingModule } from './modules/numbering/numbering.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductsModule } from './modules/products/products.module';
import { MediaModule } from './modules/media/media.module';
import { CustomersModule } from './modules/customers/customers.module';
import { PosModule } from './modules/pos/pos.module';
import { SalesModule } from './modules/sales/sales.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { WorkshopModule } from './modules/workshop/workshop.module';
import { ShopModule } from './modules/shop/shop.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { HrModule } from './modules/hr/hr.module';
import { FinanceModule } from './modules/finance/finance.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { HealthController } from './modules/health/health.controller';

/**
 * Strict brute-force bucket: only endpoints where an attacker can GUESS the secret (passwords, reset emails).
 * `refresh` is deliberately excluded: its token is 64 random bytes (unguessable) and every full page load calls it, so
 * a strict per-IP cap there would log out whole shops sharing one router. It falls under the general per-IP limit.
 */
const AUTH_ROUTES = /\/(auth\/(login|forgot-password|reset-password)|public\/auth\/register|public\/orders\/track|public\/appointments(\/(lookup|cancel))?$)/;

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
    NumberingModule,
    CatalogModule,
    InventoryModule,
    ProductsModule,
    MediaModule,
    CustomersModule,
    PosModule,
    DocumentsModule,
    SalesModule,
    PurchasingModule,
    WorkshopModule,
    ShopModule,
    AppointmentsModule,
    HrModule,
    FinanceModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Order matters: authenticate -> rate limit (per user, else per IP) -> resolve store -> authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
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
