import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../../common/utils/template';

export interface MailJob { to: string; template: string; locale?: string; data?: Record<string, unknown>; notificationId?: string }
export interface SmsJob { to: string; template: string; locale?: string; channel?: 'SMS' | 'WHATSAPP'; data?: Record<string, unknown>; notificationId?: string }
export interface NotificationJob { userId?: string; customerId?: string; type: string; title?: string; body: string; data?: Record<string, unknown> }

/** Flags a queued Notification row as delivered (delivery is logged until a provider is configured). */
async function markNotification(prisma: PrismaService, id?: string) {
  if (id) await prisma.raw.notification.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } });
}

/**
 * Phase 1 processors prove the queue wiring. Templates come from the dashboard-editable
 * EmailTemplate / SmsTemplate tables; delivery is logged until SMTP / SMS providers are configured.
 */
@Processor('mail')
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger('Mail');
  constructor(private readonly prisma: PrismaService) { super(); }

  async process(job: Job<MailJob>) {
    const { to, template, locale = 'fr', data } = job.data;
    const tpl = await this.prisma.db.emailTemplate.findFirst({ where: { code: template, locale, isActive: true } });
    const subject = renderTemplate(tpl?.subject ?? template, data);
    const body = renderTemplate(tpl?.body ?? JSON.stringify(data ?? {}), data);
    this.logger.log(`[dev] email to=${to} subject="${subject}"\n${body}`);
    await markNotification(this.prisma, job.data.notificationId);
    return { delivered: false, logged: true };
  }
}

@Processor('sms')
export class SmsProcessor extends WorkerHost {
  private readonly logger = new Logger('Sms');
  constructor(private readonly prisma: PrismaService) { super(); }

  async process(job: Job<SmsJob>) {
    const { to, template, locale = 'fr', channel = 'SMS', data } = job.data;
    const tpl = await this.prisma.db.smsTemplate.findFirst({ where: { code: template, locale, channel, isActive: true } });
    this.logger.log(`[dev] ${channel} to=${to}: ${renderTemplate(tpl?.body ?? template, data)}`);
    await markNotification(this.prisma, job.data.notificationId);
    return { delivered: false, logged: true };
  }
}

@Processor('notification')
export class NotificationProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) { super(); }

  async process(job: Job<NotificationJob>) {
    const n = job.data;
    await this.prisma.raw.notification.create({
      data: { userId: n.userId, customerId: n.customerId, channel: 'IN_APP', type: n.type, title: n.title, body: n.body, data: n.data as object, status: 'SENT', sentAt: new Date(), jobId: job.id },
    });
  }
}
