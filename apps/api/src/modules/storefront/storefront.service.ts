import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type Cfg = Record<string, any>;

/** Read-only, unauthenticated data for the public website. Never expose cost, stock counts or internal fields here. */
@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

  async branding() {
    const [branding, settings, languages, currencies] = await Promise.all([
      this.prisma.db.brandingSetting.findFirst({ where: { key: 'default' } }),
      this.prisma.db.setting.findMany({ where: { isPublic: true, scope: 'GLOBAL' } }),
      this.prisma.db.language.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { code: true, name: true, nativeName: true, isRtl: true, isDefault: true } }),
      this.prisma.db.currency.findMany({ where: { isActive: true }, select: { code: true, symbol: true, decimals: true, isDefault: true } }),
    ]);
    if (!branding) throw new NotFoundException('Branding not configured');
    const { id, key, deletedAt, createdAt, updatedAt, legal, ...publicBranding } = branding; // `legal` (ICE, RC...) is for invoices only
    return { ...publicBranding, settings: Object.fromEntries(settings.map((s) => [`${s.group}.${s.key}`, s.value])), languages, currencies };
  }

  async menu(code: string) {
    const menu = await this.prisma.db.menu.findFirst({ where: { code } });
    if (!menu) throw new NotFoundException('Menu not found');
    const items = await this.prisma.db.menuItem.findMany({
      where: { menuId: menu.id, isActive: true }, orderBy: { sortOrder: 'asc' },
      select: { id: true, parentId: true, type: true, label: true, url: true, targetId: true, openInNewTab: true, translations: true },
    });
    const byParent = (parentId: string | null): any[] => items.filter((i) => i.parentId === parentId).map((i) => ({ ...i, children: byParent(i.id) }));
    return { code: menu.code, items: byParent(null) };
  }

  async page(slug: string) {
    const page = await this.prisma.db.cmsPage.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { slug: true, title: true, content: true, seoTitle: true, seoDescription: true, translations: true, updatedAt: true } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  footerPages() {
    return this.prisma.db.cmsPage.findMany({ where: { status: 'PUBLISHED', showInFooter: true }, select: { slug: true, title: true, translations: true }, orderBy: { title: 'asc' } });
  }

  stores() {
    return this.prisma.db.store.findMany({
      where: { isActive: true, showOnLocator: true }, orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, phone: true, email: true, address: true, city: true, latitude: true, longitude: true, openingHours: true, translations: true },
    });
  }

  /** Home page: active sections inside their schedule window, each hydrated with the data it needs. */
  async home() {
    const now = new Date();
    const sections = await this.prisma.db.homeSection.findMany({
      where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
      orderBy: { sortOrder: 'asc' },
    });
    return Promise.all(sections.map(async (s) => ({ id: s.id, type: s.type, title: s.title, subtitle: s.subtitle, translations: s.translations, config: s.config, data: await this.hydrate(s.type, (s.config ?? {}) as Cfg) })));
  }

  private async hydrate(type: string, cfg: Cfg): Promise<unknown> {
    const limit = Math.min(Number(cfg.limit) || 8, 24);
    const now = new Date();
    switch (type) {
      case 'HERO_BANNER':
      case 'BANNER_GRID':
        return this.prisma.db.banner.findMany({
          where: { placement: type === 'HERO_BANNER' ? 'HOME_HERO' : 'HOME_SECONDARY', isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
          orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, subtitle: true, imageUrl: true, mobileImageUrl: true, linkUrl: true, ctaLabel: true, translations: true },
        });
      case 'FEATURED_PRODUCTS':
      case 'NEW_ARRIVALS':
        return this.products({ ...(type === 'FEATURED_PRODUCTS' ? { isFeatured: true } : {}) }, limit, type === 'NEW_ARRIVALS');
      case 'BRANDS':
        return this.prisma.db.brand.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: limit, select: { id: true, name: true, slug: true, logoUrl: true } });
      case 'CATEGORIES':
        return this.prisma.db.category.findMany({ where: { isActive: true, parentId: null }, orderBy: { sortOrder: 'asc' }, take: limit, select: { id: true, name: true, slug: true, imageUrl: true, translations: true } });
      case 'TESTIMONIALS':
        return this.prisma.db.testimonial.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: limit, select: { id: true, authorName: true, authorTitle: true, avatarUrl: true, content: true, rating: true, translations: true } });
      case 'STORES':
        return this.stores();
      case 'PROMO': {
        const coupon = cfg.couponCode ? await this.prisma.db.coupon.findFirst({ where: { code: cfg.couponCode, isActive: true }, select: { code: true, description: true, type: true, value: true } }) : null;
        return coupon ? { ...coupon, value: Number(coupon.value) } : null;
      }
      default:
        return null;
    }
  }

  private async products(where: object, take: number, newest: boolean) {
    const rows = await this.prisma.db.product.findMany({
      where: { isPublished: true, status: 'ACTIVE', ...where }, take, orderBy: newest ? { createdAt: 'desc' } : [{ isFeatured: 'desc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, type: true, translations: true, brand: { select: { name: true } }, images: { take: 1, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], select: { url: true, alt: true } }, variants: { where: { isActive: true }, select: { price: true, compareAtPrice: true, colorHex: true } } },
    });
    return rows.map((p) => {
      const prices = p.variants.map((v) => Number(v.price));
      return { id: p.id, slug: p.slug, name: p.name, type: p.type, translations: p.translations, brand: p.brand?.name ?? null, image: p.images[0] ?? null, priceFrom: prices.length ? Math.min(...prices) : null, colors: p.variants.map((v) => v.colorHex).filter(Boolean) };
    });
  }

  /** Slugs for sitemap.xml. */
  async sitemap() {
    const [products, pages, categories] = await Promise.all([
      this.prisma.db.product.findMany({ where: { isPublished: true, status: 'ACTIVE' }, select: { slug: true, updatedAt: true } }),
      this.prisma.db.cmsPage.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, updatedAt: true } }),
      this.prisma.db.category.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    ]);
    return { products, pages, categories };
  }
}
