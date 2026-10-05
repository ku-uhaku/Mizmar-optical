import { INestApplication } from '@nestjs/common';

/**
 * Boots the real app (same pipes / prefix / CORS / helmet as production).
 *
 * `env` overrides apply to THIS app only. ConfigModule reads the environment when AppModule is first imported, so a
 * non-empty override resets Jest's module registry and imports everything fresh; the previous values are restored once
 * the app has initialised.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<INestApplication> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  if (Object.keys(env).length) jest.resetModules();
  try {
    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../src/app.module');
    const { setupApp } = await import('../src/setup-app');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    return app;
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
