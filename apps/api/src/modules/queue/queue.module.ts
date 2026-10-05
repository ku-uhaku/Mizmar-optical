import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import type { Env } from '../../config/env';
import { MailProcessor, NotificationProcessor, SmsProcessor } from './processors';

/** Plain options (not an ioredis instance) so BullMQ owns, and on shutdown closes, its connections. */
export function redisOptions(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

export const QUEUES = { MAIL: 'mail', SMS: 'sms', NOTIFICATION: 'notification' } as const;

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisOptions(config.get('REDIS_URL', { infer: true })),
        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 },
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.MAIL }, { name: QUEUES.SMS }, { name: QUEUES.NOTIFICATION }),
  ],
  providers: [MailProcessor, SmsProcessor, NotificationProcessor],
  exports: [BullModule],
})
export class QueueModule {}
