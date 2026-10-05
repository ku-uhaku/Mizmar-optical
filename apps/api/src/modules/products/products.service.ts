import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { releaseUnique } from '../../common/utils/soft-delete';
import { uniqueSlug } from '../../common/utils/slug';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { StockService } from '../inventory/stock.service';
import { AddImageDto, CreateProductDto, CreateVariantDto, ListProductsDto, UpdateProductDto, UpdateVariantDto } from './products.dto';

const FRAME_TYPES = ['FRAME', 'SUNGLASSES'];

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService, private readonly stock: StockService) {}

  /** Warehouse filter limiting stock figures to the stores the caller may see (or just the active store). */
  private stockScope(user: AuthUser, storeId?: string | null) {
    const stores = storeId ? [storeId] : visibleStoreIds(user);
    return stores ? { warehouse: { storeId: { in: stores } } } : {};
  }

  // ------------------------------------------------------------------ list / get
  async list(dto: ListProductsDto, user: AuthUser, storeId?: string | null) {
    const s = dto.search?.trim();
    const where: Record<string, any> = {
      ...(dto.type && { type: dto.type }), ...(dto.brandId && { brandId: dto.brandId }), ...(dto.categoryId && { categoryId: dto.categoryId }),
      ...(dto.status && { status: dto.status }), ...(dto.gender && { gender: dto.gender }),
      ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }), ...(dto.isFeatured !== undefined && { isFeatured: dto.isFeatured }),
      ...((dto.shapeId || dto.materialId) && { frameSpec: { ...(dto.shapeId && { shapeId: dto.shapeId }), ...(dto.materialId && { materialId: dto.materialId }) } }),
      ...((dto.minPrice !== undefined || dto.maxPrice !== undefined) && { variants: { some: { deletedAt: null, price: { ...(dto.minPrice !== undefined && { gte: dto.minPrice }), ...(dto.maxPrice !== undefined && { lte: dto.maxPrice }) } } } }),
      ...(s && { OR: [...searchWhere(s, ['name', 'slug', 'shortDescription']).OR!, { brand: { name: { contains: s, mode: 'insensitive' } } }, { variants: { some: { OR: [{ sku: { contains: s, mode: 'insensitive' } }, { barcode: { contains: s } }] } } }] }),
    };
    const res = await paginate(this.prisma.db.product, dto, {
      where, sortable: ['name', 'createdAt', 'updatedAt'], defaultSort: 'createdAt',
      include: {
        brand: { select: { id: true, name: true } }, category: { select: { id: true, name: true } },
        images: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { url: true, alt: true } },
        variants: { where: { deletedAt: null }, select: { id: true, price: true, isActive: true } },
      },
    });
    const variantIds = res.data.flatMap((p: any) => p.variants.map((v: any) => v.id));
    const totals = variantIds.length
      ? await this.prisma.db.stockLevel.groupBy({ by: ['variantId'], where: { variantId: { in: variantIds }, ...this.stockScope(user, storeId) }, _sum: { quantity: true } })
      : [];
    const qty = new Map<string, number>(totals.map((t: any) => [t.variantId, t._sum.quantity ?? 0]));
    return {
      ...res,
      data: res.data.map((p: any) => {
        const prices = p.variants.map((v: any) => Number(v.price));
        const { variants, images, ...rest } = p;
        return { ...rest, image: images[0] ?? null, variantCount: variants.length, priceFrom: prices.length ? Math.min(...prices) : null, priceTo: prices.length ? Math.max(...prices) : null, stock: variants.reduce((n: number, v: any) => n + (qty.get(v.id) ?? 0), 0) };
      }),
    };
  }

  async get(id: string, user: AuthUser, storeId?: string | null) {
    const product = await this.prisma.db.product.findFirst({
      where: { id },
      include: {
        brand: { select: { id: true, name: true } }, category: { select: { id: true, name: true } },
        frameSpec: { include: { shape: { select: { id: true, name: true } }, material: { select: { id: true, name: true } } } },
        images: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        variants: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { sku: 'asc' }] },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    const levels = await this.prisma.db.stockLevel.findMany({
      where: { variantId: { in: product.variants.map((v) => v.id) }, ...this.stockScope(user, storeId) },
      include: { warehouse: { select: { id: true, code: true, name: true, storeId: true } } },
    });
    return { ...product, variants: product.variants.map((v) => ({ ...v, stock: levels.filter((l) => l.variantId === v.id).map((l) => ({ warehouse: l.warehouse, quantity: l.quantity, reserved: l.reserved, reorderPoint: l.reorderPoint })) })) };
  }

  /** POS / barcode scanner: exact barcode or SKU -> variant + product + stock in the active store. */
  async lookup(code: string, user: AuthUser, storeId?: string | null, includeInactive = false) {
    // POS-style scans only see sellable items; stock operations (adjust/transfer/count) must also reach drafts and archived items
    const variant = await this.prisma.db.productVariant.findFirst({
      where: { ...(includeInactive ? {} : { isActive: true }), OR: [{ barcode: code }, { sku: { equals: code, mode: 'insensitive' } }], product: { deletedAt: null, ...(includeInactive ? {} : { status: 'ACTIVE' as const }) } },
      include: { product: { select: { id: true, name: true, type: true, requiresPrescription: true, isLensConfigurable: true, brand: { select: { name: true } } } } },
    });
    if (!variant) throw new NotFoundException({ code: 'NOT_FOUND', message: 'No active product matches this code' });
    const levels = await this.prisma.db.stockLevel.findMany({ where: { variantId: variant.id, ...this.stockScope(user, storeId) }, include: { warehouse: { select: { id: true, code: true, name: true, storeId: true } } } });
    return { ...variant, stock: levels.map((l) => ({ warehouse: l.warehouse, quantity: l.quantity, reserved: l.reserved, available: l.quantity - l.reserved })) };
  }

  // ------------------------------------------------------------------ create / update / delete
  async create(dto: CreateProductDto, user: AuthUser) {
    const { variants = [], frameSpec, ...data } = dto;
    if (frameSpec && !FRAME_TYPES.includes(dto.type)) throw new BadRequestException('frameSpec only applies to frames and sunglasses');
    await this.assertRefs(dto.brandId, dto.categoryId, frameSpec);
    const skus = variants.map((v) => v.sku.toLowerCase());
    if (new Set(skus).size !== skus.length) throw new BadRequestException('Duplicate SKU in the same request');
    const warehouses = await this.loadWarehouses(variants.flatMap((v) => v.initialStock ?? []).map((s) => s.warehouseId), user);

    const slug = dto.slug ?? (await uniqueSlug(async (s) => !!(await this.prisma.raw.product.findFirst({ where: { slug: s } })), dto.name, 'product'));
    const id = await this.prisma.raw.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: { ...(data as any), slug, createdById: user.id, ...(frameSpec && { frameSpec: { create: frameSpec as any } }), variants: { create: variants.map(({ initialStock: _i, ...v }) => v as any) } },
        include: { variants: true },
      });
      for (const v of variants) {
        const created = product.variants.find((x) => x.sku === v.sku)!;
        for (const st of v.initialStock ?? []) await this.openingStock(tx, created.id, st.warehouseId, st.quantity, warehouses.get(st.warehouseId)!, v.cost, user.id);
      }
      return product.id;
    });
    return this.get(id, user);
  }

  async update(id: string, dto: UpdateProductDto, user: AuthUser) {
    const existing = await this.prisma.db.product.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');
    const { frameSpec, ...data } = dto;
    if (frameSpec && !FRAME_TYPES.includes(existing.type)) throw new BadRequestException('frameSpec only applies to frames and sunglasses');
    await this.assertRefs(dto.brandId, dto.categoryId, frameSpec);
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: data as any });
      if (frameSpec) await tx.frameSpec.upsert({ where: { productId: id }, create: { productId: id, ...(frameSpec as any) }, update: frameSpec as any });
    });
    return this.get(id, user);
  }

  async remove(id: string) {
    const product = await this.prisma.db.product.findFirst({ where: { id }, include: { variants: { where: { deletedAt: null } } } });
    if (!product) throw new NotFoundException('Product not found');
    await this.assertNoStock(product.variants.map((v) => v.id));
    await this.prisma.raw.$transaction([
      ...product.variants.map((v) => this.prisma.raw.productVariant.update({ where: { id: v.id }, data: { deletedAt: new Date(), sku: releaseUnique(v.sku, v.id), barcode: v.barcode ? releaseUnique(v.barcode, v.id) : null } })),
      this.prisma.raw.product.update({ where: { id }, data: { deletedAt: new Date(), isPublished: false, slug: releaseUnique(product.slug, id) } }),
    ]);
  }

  // ------------------------------------------------------------------ variants
  async addVariant(productId: string, dto: CreateVariantDto, user: AuthUser) {
    if (!(await this.prisma.db.product.findFirst({ where: { id: productId }, select: { id: true } }))) throw new NotFoundException('Product not found');
    const { initialStock = [], ...data } = dto;
    const warehouses = await this.loadWarehouses(initialStock.map((s) => s.warehouseId), user);
    const variant = await this.prisma.raw.$transaction(async (tx) => {
      const v = await tx.productVariant.create({ data: { ...(data as any), productId } });
      for (const st of initialStock) await this.openingStock(tx, v.id, st.warehouseId, st.quantity, warehouses.get(st.warehouseId)!, dto.cost, user.id);
      return v;
    });
    return variant;
  }

  async updateVariant(id: string, dto: UpdateVariantDto) {
    if (!(await this.prisma.db.productVariant.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException('Variant not found');
    return this.prisma.raw.productVariant.update({ where: { id }, data: dto as any });
  }

  async removeVariant(id: string) {
    const v = await this.prisma.db.productVariant.findFirst({ where: { id } });
    if (!v) throw new NotFoundException('Variant not found');
    await this.assertNoStock([id]);
    await this.prisma.raw.productVariant.update({ where: { id }, data: { deletedAt: new Date(), sku: releaseUnique(v.sku, id), barcode: v.barcode ? releaseUnique(v.barcode, id) : null } });
  }

  // ------------------------------------------------------------------ images
  async addImage(productId: string, dto: AddImageDto) {
    if (!(await this.prisma.db.product.findFirst({ where: { id: productId }, select: { id: true } }))) throw new NotFoundException('Product not found');
    if (dto.variantId && !(await this.prisma.db.productVariant.findFirst({ where: { id: dto.variantId, productId }, select: { id: true } }))) throw new BadRequestException('Variant does not belong to this product');
    const count = await this.prisma.db.productImage.count({ where: { productId } });
    return this.prisma.raw.$transaction(async (tx) => {
      const makePrimary = dto.isPrimary || count === 0;
      if (makePrimary) await tx.productImage.updateMany({ where: { productId }, data: { isPrimary: false } });
      return tx.productImage.create({ data: { productId, url: dto.url, alt: dto.alt, variantId: dto.variantId, isPrimary: makePrimary, sortOrder: count } });
    });
  }

  async setPrimaryImage(imageId: string) {
    const img = await this.prisma.db.productImage.findFirst({ where: { id: imageId } });
    if (!img) throw new NotFoundException('Image not found');
    await this.prisma.raw.$transaction([
      this.prisma.raw.productImage.updateMany({ where: { productId: img.productId }, data: { isPrimary: false } }),
      this.prisma.raw.productImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
    ]);
  }

  async removeImage(imageId: string) {
    const img = await this.prisma.db.productImage.findFirst({ where: { id: imageId } });
    if (!img) throw new NotFoundException('Image not found');
    await this.prisma.raw.productImage.update({ where: { id: imageId }, data: { deletedAt: new Date(), isPrimary: false } });
    if (img.isPrimary) {
      const next = await this.prisma.db.productImage.findFirst({ where: { productId: img.productId }, orderBy: { sortOrder: 'asc' } });
      if (next) await this.prisma.raw.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
  }

  async reorderImages(productId: string, ids: string[]) {
    const imgs = await this.prisma.db.productImage.findMany({ where: { productId }, select: { id: true } });
    if (ids.length !== imgs.length || !ids.every((i) => imgs.some((x) => x.id === i))) throw new BadRequestException('ids must list every image of the product exactly once');
    await this.prisma.raw.$transaction(ids.map((id, sortOrder) => this.prisma.raw.productImage.update({ where: { id }, data: { sortOrder } })));
  }

  // ------------------------------------------------------------------ helpers
  private async assertRefs(brandId?: string, categoryId?: string, frameSpec?: { shapeId?: string; materialId?: string }) {
    const checks: [string | undefined, Promise<unknown>, string][] = [
      [brandId, brandId ? this.prisma.db.brand.findFirst({ where: { id: brandId } }) : Promise.resolve(1), 'brand'],
      [categoryId, categoryId ? this.prisma.db.category.findFirst({ where: { id: categoryId } }) : Promise.resolve(1), 'category'],
      [frameSpec?.shapeId, frameSpec?.shapeId ? this.prisma.db.frameShape.findFirst({ where: { id: frameSpec.shapeId } }) : Promise.resolve(1), 'shape'],
      [frameSpec?.materialId, frameSpec?.materialId ? this.prisma.db.frameMaterial.findFirst({ where: { id: frameSpec.materialId } }) : Promise.resolve(1), 'material'],
    ];
    for (const [id, found, label] of checks) if (id && !(await found)) throw new BadRequestException(`Unknown ${label}`);
  }

  private async loadWarehouses(ids: string[], user: AuthUser) {
    const unique = [...new Set(ids)];
    const rows = await this.prisma.db.warehouse.findMany({ where: { id: { in: unique } } });
    if (rows.length !== unique.length) throw new BadRequestException('Unknown warehouse');
    rows.forEach((w) => assertStoreAccess(user, w.storeId));
    return new Map(rows.map((w) => [w.id, w]));
  }

  private openingStock(tx: Tx, variantId: string, warehouseId: string, quantity: number, wh: { storeId: string }, cost: number | undefined, actorId: string) {
    return this.stock.move(tx, { storeId: wh.storeId, variantId, warehouseId, type: 'INITIAL', quantity, unitCost: cost, note: 'Opening stock', actorId });
  }

  private async assertNoStock(variantIds: string[]) {
    const agg = await this.prisma.db.stockLevel.aggregate({ where: { variantId: { in: variantIds } }, _sum: { quantity: true } });
    if ((agg._sum.quantity ?? 0) > 0) throw new ConflictException({ code: 'HAS_STOCK', message: 'Remove or transfer the remaining stock first (or archive the product instead)' });
  }
}
