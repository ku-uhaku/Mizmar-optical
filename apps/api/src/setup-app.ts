import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import type { Env } from './config/env';
import { Prisma } from './generated/prisma/client';

// Money / lens powers are Decimal(12,2)/(5,2): safe as JS numbers, and far friendlier to API clients than strings.
(Prisma.Decimal.prototype as any).toJSON = function (this: { toNumber(): number }) { return this.toNumber(); };

/** Shared by main.ts and the e2e tests so tests exercise the real pipeline. */
export function setupApp(app: INestApplication) {
  const config = app.get(ConfigService<Env, true>);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(compression());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }).split(',').map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('Mizmar Optical API')
    .setDescription('Optical store ERP + storefront backend')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addGlobalParameters({ name: 'x-store-id', in: 'header', required: false, description: 'Active store (must be one of the user\'s stores)' })
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc), { swaggerOptions: { persistAuthorization: true } });
}
