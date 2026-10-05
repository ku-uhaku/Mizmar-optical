import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as D from './shop.dto';

const LOW_STOCK = 3;
export type StockStatus = 'IN_STOCK' | 'LOW' | 'OUT';
const status = (n: number): StockStatus => (n <= 0 ? 'OUT' : n <= LOW_STOCK ? 'LOW' : 'IN_STOCK');

/**
 * Read-only catalog for the public website. Exposes a stock STATUS, never counts, and never cost.
 * Everything goes through `prisma.db` so soft-deleted rows never leak.
 */
@Injectable()
export class ShopCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sellable quantity per variant (on hand minus reserved), summed over active warehouses of active stores, plus the stores that have any. */
  async availability(variantIds: string[]) {
    const out = new Map<string, { total: number; stores: Set<string> }>();
    if (!variantIds.length) return out;
    const levels = await this.prisma.db.stockLevel.findMany({ where: { variantId: { in: variantIds }, warehouse: { isActive: true, deletedAt: null, store: { isActive: true, deletedAt: null } } }, select: { variantId: true, quantity: true, reserved: true, warehouse: { select: { storeId: true } } } });
    for (const l of levels) {
      const e = out.get(l.variantId) ?? { total: 0, stores: new Set<string>() };
      const free = l.quantity - l.reserved;
      e.total += Math.max(0, free);
      if (free > 0) e.stores.add(l.warehouse.storeId);
      out.set(l.variantId, e);
    }
    return out;
  }

  private async categoryIds(slug: string) {
    const root = await this.prisma.db.category.findFirst({ where: { slug, isActive: true } });
    if (!root) return [];
    const all = await this.prisma.db.category.findMany({ where: { isActive: true }, select: { id: true, parentId: true } });
    const ids = new Set([root.id]);
    for (let grew = true; grew; ) { grew = false; for (const c of all) if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) { ids.add(c.id); grew = true; } }
    return [...ids];
  }

  private card(p: any, stock: Map<string, { total: number }>) {
    const vs = p.variants as { id: string; price: unknown; compareAtPrice: unknown; color: string | null; colorHex: string | null }[];
    const prices = vs.map((v) => Number(v.price));
    const compare = vs.map((v) => (v.compareAtPrice == null ? null : Number(v.compareAtPrice)));
    const left = vs.reduce((n, v) => n + (stock.get(v.id)?.total ?? 0), 0);
    const onSale = vs.some((v, i) => compare[i] != null && compare[i]! > prices[i]);
    return {
      id: p.id, slug: p.slug, name: p.name, type: p.type, translations: p.translations, brand: p.brand?.name ?? null, gender: p.gender, isLensConfigurable: p.isLensConfigurable,
      image: p.images[0] ?? null, priceFrom: prices.length ? Math.min(...prices) : null, onSale, stockStatus: status(left),
      colors: [...new Map(vs.filter((v) => v.color).map((v) => [v.color, { name: v.color, hex: v.colorHex }])).values()],
    };
  }

  private static readonly CARD = {
    brand: { select: { name: true } },
    images: { where: { deletedAt: null }, take: 1, orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], select: { url: true, alt: true } },
    variants: { where: { isActive: true, deletedAt: null }, select: { id: true, price: true, compareAtPrice: true, color: true, colorHex: true } },
  };

  async list(dto: D.ListShopProductsDto) {
    const s = dto.search?.trim();
    const catIds = dto.category ? await this.categoryIds(dto.category) : null;
    const variantWhere: Record<string, any> = {
      isActive: true, deletedAt: null,
      ...(dto.color && { color: { equals: dto.color, mode: 'insensitive' } }), ...(dto.size && { size: { startsWith: dto.size } }),
      ...((dto.minPrice !== undefined || dto.maxPrice !== undefined) && { price: { ...(dto.minPrice !== undefined && { gte: dto.minPrice }), ...(dto.maxPrice !== undefined && { lte: dto.maxPrice }) } }),
    };
    const where: Record<string, any> = {
      isPublished: true, status: 'ACTIVE', variants: { some: variantWhere },
      ...(dto.type && { type: dto.type }), ...(dto.gender && { gender: dto.gender }), ...(dto.featured && { isFeatured: true }),
      ...(dto.brand && { brand: { slug: dto.brand } }), ...(catIds && { categoryId: { in: catIds } }),
      ...((dto.shape || dto.material) && { frameSpec: { ...(dto.shape && { shape: { slug: dto.shape } }), ...(dto.material && { material: { slug: dto.material } }) } }),
      ...(s && { OR: [{ name: { contains: s, mode: 'insensitive' } }, { shortDescription: { contains: s, mode: 'insensitive' } }, { brand: { name: { contains: s, mode: 'insensitive' } } }, { tags: { has: s.toLowerCase() } }] }),
    };

    // "in stock" and price ordering both depend on figures that live outside the product row, so for those we rank the whole matching set first
    const rankedInMemory = dto.sort === 'price_asc' || dto.sort === 'price_desc' || dto.inStock;
    const orderBy = dto.sort === 'name' ? [{ name: 'asc' as const }] : [{ isFeatured: 'desc' as const }, { createdAt: 'desc' as const }];
    const { page, limit } = dto;
    if (!rankedInMemory) {
      const [total, rows] = await Promise.all([
        this.prisma.db.product.count({ where }),
        this.prisma.db.product.findMany({ where, orderBy: dto.sort === 'newest' ? [{ createdAt: 'desc' }] : orderBy, skip: (page - 1) * limit, take: limit, include: ShopCatalogService.CARD }),
      ]);
      const stock = await this.availability(rows.flatMap((p) => p.variants.map((v) => v.id)));
      return { data: rows.map((p) => this.card(p, stock)), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
    }
    const all = await this.prisma.db.product.findMany({ where, orderBy, take: 2000, include: ShopCatalogService.CARD });
    const stock = await this.availability(all.flatMap((p) => p.variants.map((v) => v.id)));
    let cards = all.map((p) => this.card(p, stock));
    if (dto.inStock) cards = cards.filter((c) => c.stockStatus !== 'OUT');
    if (dto.sort === 'price_asc') cards.sort((a, b) => (a.priceFrom ?? 0) - (b.priceFrom ?? 0));
    if (dto.sort === 'price_desc') cards.sort((a, b) => (b.priceFrom ?? 0) - (a.priceFrom ?? 0));
    const total = cards.length;
    return { data: cards.slice((page - 1) * limit, page * limit), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  /** Filter choices for the catalog sidebar. */
  async facets() {
    const published = { isPublished: true, status: 'ACTIVE' as const };
    const [brands, categories, shapes, materials, variants] = await Promise.all([
      this.prisma.db.brand.findMany({ where: { isActive: true, products: { some: published } }, orderBy: { name: 'asc' }, select: { name: true, slug: true, translations: true } }),
      this.prisma.db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { name: true, slug: true, parentId: true, translations: true } }),
      this.prisma.db.frameShape.findMany({ where: { isActive: true, specs: { some: { product: published } } }, orderBy: { sortOrder: 'asc' }, select: { name: true, slug: true, translations: true } }),
      this.prisma.db.frameMaterial.findMany({ where: { isActive: true, specs: { some: { product: published } } }, orderBy: { sortOrder: 'asc' }, select: { name: true, slug: true, translations: true } }),
      this.prisma.db.productVariant.findMany({ where: { isActive: true, product: published }, select: { price: true, color: true, colorHex: true, size: true } }),
    ]);
    const prices = variants.map((v) => Number(v.price));
    return {
      brands, categories, shapes, materials, genders: ['MEN', 'WOMEN', 'UNISEX', 'KIDS'],
      colors: [...new Map(variants.filter((v) => v.color).map((v) => [v.color!.toLowerCase(), { name: v.color, hex: v.colorHex }])).values()],
      sizes: [...new Set(variants.map((v) => v.size?.split('-')[0]).filter(Boolean) as string[])].sort((a, b) => Number(a) - Number(b)),
      price: { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 },
    };
  }

  async get(slug: string) {
    const p = await this.prisma.db.product.findFirst({
      where: { slug, isPublished: true, status: 'ACTIVE' },
      include: {
        brand: { select: { name: true, slug: true } }, category: { select: { name: true, slug: true } },
        images: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], select: { id: true, url: true, alt: true, variantId: true, isPrimary: true } },
        variants: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' }, select: { id: true, sku: true, name: true, color: true, colorHex: true, size: true, price: true, compareAtPrice: true } },
        frameSpec: { include: { shape: { select: { name: true, slug: true } }, material: { select: { name: true, slug: true } } } },
      },
    });
    if (!p || p.variants.length === 0) throw new NotFoundException('Product not found');
    const [stock, reviews, related, stores] = await Promise.all([
      this.availability(p.variants.map((v) => v.id)),
      this.prisma.db.review.findMany({ where: { productId: p.id, status: 'APPROVED' }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, authorName: true, rating: true, title: true, body: true, createdAt: true } }),
      this.prisma.db.product.findMany({
        where: { isPublished: true, status: 'ACTIVE', id: { not: p.id }, variants: { some: { isActive: true } }, OR: [...(p.brandId ? [{ brandId: p.brandId }] : []), ...(p.categoryId ? [{ categoryId: p.categoryId }] : [])] },
        take: 8, orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }], include: ShopCatalogService.CARD,
      }),
      this.prisma.db.store.findMany({ where: { isActive: true, showOnLocator: true }, select: { id: true, name: true } }),
    ]);
    const rstock = await this.availability(related.flatMap((r) => r.variants.map((v) => v.id)));
    const { frameSpec, variants, images, ...rest } = p;
    const ratings = await this.prisma.db.review.aggregate({ where: { productId: p.id, status: 'APPROVED' }, _avg: { rating: true }, _count: true });
    return {
      ...rest, images,
      variants: variants.map((v) => {
        const a = stock.get(v.id);
        return { ...v, price: Number(v.price), compareAtPrice: v.compareAtPrice == null ? null : Number(v.compareAtPrice), stockStatus: status(a?.total ?? 0), pickupStoreIds: [...(a?.stores ?? [])] };
      }),
      spec: frameSpec && { shape: frameSpec.shape, material: frameSpec.material, rimType: frameSpec.rimType, lensWidthMm: frameSpec.lensWidthMm, lensHeightMm: frameSpec.lensHeightMm, bridgeMm: frameSpec.bridgeMm, templeMm: frameSpec.templeMm, frameWidthMm: frameSpec.frameWidthMm, isPolarized: frameSpec.isPolarized, uvProtection: frameSpec.uvProtection },
      pickupStores: stores,
      rating: { average: ratings._avg.rating == null ? null : Math.round(ratings._avg.rating * 10) / 10, count: ratings._count },
      reviews, related: related.map((r) => this.card(r, rstock)),
    };
  }

  /** Lens types, their treatments and catalog lenses with customer-facing prices (no cost). */
  async lensOptions() {
    const types = await this.prisma.db.lensType.findMany({
      where: { isActive: true }, orderBy: { sortOrder: 'asc' },
      include: {
        treatments: { where: { deletedAt: null, treatment: { isActive: true, deletedAt: null } }, include: { treatment: true } },
        entries: { where: { isActive: true, deletedAt: null }, orderBy: [{ refractiveIndex: 'asc' }, { price: 'asc' }] },
      },
    });
    const n = (v: unknown) => (v == null ? null : Number(v));
    return types.map((t) => ({
      id: t.id, code: t.code, kind: t.kind, name: t.name, description: t.description, translations: t.translations, requiresAdd: t.requiresAdd, basePrice: Number(t.basePrice),
      treatments: t.treatments.map((x) => ({ id: x.treatmentId, name: x.treatment.name, category: x.treatment.category, description: x.treatment.description, translations: x.treatment.translations, price: Number(x.priceOverride ?? x.treatment.price) })),
      entries: t.entries.map((e) => ({ id: e.id, name: e.name, refractiveIndex: Number(e.refractiveIndex), material: e.material, price: Number(e.price), leadTimeDays: e.leadTimeDays, sphMin: n(e.sphMin), sphMax: n(e.sphMax), cylMin: n(e.cylMin), cylMax: n(e.cylMax), addMin: n(e.addMin), addMax: n(e.addMax) })),
    }));
  }
}
