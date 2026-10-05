import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as D from './shop.dto';

@Injectable()
export class ShopContentService {
  constructor(private readonly prisma: PrismaService) {}

  async blog(dto: D.ListBlogDto) {
    const where = { status: 'PUBLISHED' as const, publishedAt: { lte: new Date() }, ...(dto.category && { category: { slug: dto.category } }), ...(dto.search?.trim() && { title: { contains: dto.search.trim(), mode: 'insensitive' as const } }) };
    const [total, rows] = await Promise.all([
      this.prisma.db.blogPost.count({ where }),
      this.prisma.db.blogPost.findMany({ where, orderBy: { publishedAt: 'desc' }, skip: (dto.page - 1) * dto.limit, take: dto.limit, select: { slug: true, title: true, excerpt: true, coverUrl: true, publishedAt: true, tags: true, translations: true, category: { select: { name: true, slug: true } } } }),
    ]);
    return { data: rows, meta: { page: dto.page, limit: dto.limit, total, totalPages: Math.max(1, Math.ceil(total / dto.limit)) } };
  }

  async blogPost(slug: string) {
    const p = await this.prisma.db.blogPost.findFirst({ where: { slug, status: 'PUBLISHED', publishedAt: { lte: new Date() } }, select: { slug: true, title: true, excerpt: true, content: true, coverUrl: true, publishedAt: true, tags: true, seoTitle: true, seoDescription: true, translations: true, category: { select: { name: true, slug: true } } } });
    if (!p) throw new NotFoundException('Post not found');
    return p;
  }

  blogCategories() { return this.prisma.db.blogCategory.findMany({ orderBy: { name: 'asc' }, select: { name: true, slug: true, translations: true } }); }

  async contact(dto: D.ContactMessageDto) {
    if (dto.website?.trim()) return { received: true }; // honeypot filled: a bot. Pretend success, store nothing.
    await this.prisma.raw.contactMessage.create({ data: { name: dto.name, email: dto.email.toLowerCase(), phone: dto.phone, subject: dto.subject, message: dto.message } });
    return { received: true };
  }

  async subscribe(dto: D.NewsletterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.raw.newsletterSubscriber.findUnique({ where: { email } });
    if (existing) await this.prisma.raw.newsletterSubscriber.update({ where: { id: existing.id }, data: { isActive: true, unsubscribedAt: null, deletedAt: null, locale: dto.locale ?? existing.locale } });
    else await this.prisma.raw.newsletterSubscriber.create({ data: { email, locale: dto.locale ?? 'fr' } });
    return { subscribed: true };
  }
}
