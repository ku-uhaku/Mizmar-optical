import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types';
import { AuthService } from '../auth/auth.service';
import { MediaService } from '../media/media.service';
import { StockService } from '../inventory/stock.service';
import { OrdersService } from '../sales/orders.service';
import { cancelJobsForOrder } from '../workshop/workshop.jobs';
import { ShopCatalogService } from './shop-catalog.service';
import { ShopCheckoutService } from './shop-checkout.service';
import * as D from './shop.dto';

const cid = (u: AuthUser) => u.customerId!;

/** Everything a signed-in storefront customer can do with their own data. Every query is scoped by the customer id from the token. */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly media: MediaService, private readonly checkout: ShopCheckoutService,
    private readonly catalog: ShopCatalogService, private readonly stock: StockService, private readonly orders: OrdersService,
  ) {}

  // ------------------------------------------------------------------ registration & profile
  async register(dto: D.RegisterDto, meta: { ip?: string; userAgent?: string }) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.db.user.findFirst({ where: { email } })) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'An account with this email already exists' });
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const userId = await this.prisma.raw.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, passwordHash, firstName: dto.firstName.trim(), lastName: dto.lastName.trim(), phone: dto.phone, type: 'CUSTOMER', status: 'ACTIVE', locale: dto.locale ?? 'fr' } });
      await tx.customer.create({ data: { userId: user.id, firstName: user.firstName, lastName: user.lastName, email, phone: dto.phone, source: 'ONLINE', marketingOptIn: dto.marketingOptIn ?? false } });
      return user.id;
    }).catch((e) => { if (e?.code === 'P2002') throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'An account with this email already exists' }); throw e; });
    return this.auth.startSession(userId, meta);
  }

  async profile(u: AuthUser) {
    const c = await this.prisma.db.customer.findFirstOrThrow({ where: { id: cid(u) }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, marketingOptIn: true, loyaltyPoints: true } });
    return { ...c, locale: u.locale };
  }

  async updateProfile(u: AuthUser, dto: D.UpdateProfileDto) {
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: cid(u) }, data: { firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone, marketingOptIn: dto.marketingOptIn } });
      await tx.user.update({ where: { id: u.id }, data: { firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone, locale: dto.locale } });
    });
    return this.profile({ ...u, locale: dto.locale ?? u.locale });
  }

  async changePassword(u: AuthUser, dto: D.ChangePasswordDto) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' });
    await this.prisma.raw.$transaction([
      this.prisma.raw.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) } }),
      this.prisma.raw.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } }), // sign out everywhere else
    ]);
  }

  // ------------------------------------------------------------------ addresses
  addresses(u: AuthUser) { return this.prisma.db.customerAddress.findMany({ where: { customerId: cid(u) }, orderBy: [{ isDefaultShipping: 'desc' }, { createdAt: 'desc' }] }); }

  async addAddress(u: AuthUser, dto: D.AddressDto) {
    if ((await this.prisma.db.customerAddress.count({ where: { customerId: cid(u) } })) >= 10) throw new BadRequestException({ code: 'TOO_MANY_ADDRESSES', message: 'You can save up to 10 addresses' });
    return this.prisma.raw.$transaction(async (tx) => {
      const first = (await tx.customerAddress.count({ where: { customerId: cid(u), deletedAt: null } })) === 0;
      const makeDefault = dto.isDefaultShipping || first;
      if (makeDefault) await tx.customerAddress.updateMany({ where: { customerId: cid(u) }, data: { isDefaultShipping: false } });
      return tx.customerAddress.create({ data: { ...dto, isDefaultShipping: makeDefault, customerId: cid(u), country: 'MA' } });
    });
  }

  private async mustAddress(u: AuthUser, id: string) {
    const a = await this.prisma.db.customerAddress.findFirst({ where: { id, customerId: cid(u) } });
    if (!a) throw new NotFoundException('Address not found');
    return a;
  }

  async updateAddress(u: AuthUser, id: string, dto: D.AddressDto) {
    await this.mustAddress(u, id);
    return this.prisma.raw.$transaction(async (tx) => {
      if (dto.isDefaultShipping) await tx.customerAddress.updateMany({ where: { customerId: cid(u) }, data: { isDefaultShipping: false } });
      return tx.customerAddress.update({ where: { id }, data: dto });
    });
  }

  async removeAddress(u: AuthUser, id: string) {
    await this.mustAddress(u, id);
    await this.prisma.raw.customerAddress.update({ where: { id }, data: { deletedAt: new Date(), isDefaultShipping: false } });
  }

  // ------------------------------------------------------------------ wishlist
  async wishlist(u: AuthUser) {
    const rows = await this.prisma.db.wishlistItem.findMany({ where: { customerId: cid(u), product: { isPublished: true, status: 'ACTIVE' } }, orderBy: { createdAt: 'desc' }, include: { product: { select: { slug: true } } } });
    if (!rows.length) return [];
    const page = await this.catalog.list(Object.assign(new D.ListShopProductsDto(), { page: 1, limit: 100, sortOrder: 'desc' }));
    const wanted = new Set(rows.map((r) => r.product.slug));
    // reuse the card shape from the public list, restricted to wishlisted slugs
    const cards = page.data.filter((c) => wanted.has(c.slug));
    const missing = rows.filter((r) => !cards.some((c) => c.slug === r.product.slug));
    for (const m of missing) { try { const p = await this.catalog.get(m.product.slug); cards.push({ id: p.id, slug: p.slug, name: p.name, type: p.type, translations: p.translations, brand: p.brand?.name ?? null, gender: p.gender, isLensConfigurable: p.isLensConfigurable, image: p.images[0] ?? null, priceFrom: Math.min(...p.variants.map((v) => v.price)), onSale: false, stockStatus: 'IN_STOCK', colors: [] } as never); } catch { /* unpublished meanwhile */ } }
    return rows.map((r) => cards.find((c) => c.slug === r.product.slug)).filter(Boolean);
  }

  async addWishlist(u: AuthUser, productId: string) {
    if (!(await this.prisma.db.product.findFirst({ where: { id: productId, isPublished: true, status: 'ACTIVE' } }))) throw new NotFoundException('Product not found');
    const existing = await this.prisma.raw.wishlistItem.findUnique({ where: { customerId_productId: { customerId: cid(u), productId } } });
    if (existing) await this.prisma.raw.wishlistItem.update({ where: { id: existing.id }, data: { deletedAt: null } }); // restore a removed one
    else await this.prisma.raw.wishlistItem.create({ data: { customerId: cid(u), productId } });
  }

  async removeWishlist(u: AuthUser, productId: string) {
    await this.prisma.raw.wishlistItem.updateMany({ where: { customerId: cid(u), productId }, data: { deletedAt: new Date() } });
  }

  async wishlistIds(u: AuthUser) { return (await this.prisma.db.wishlistItem.findMany({ where: { customerId: cid(u) }, select: { productId: true } })).map((r) => r.productId); }

  // ------------------------------------------------------------------ prescriptions
  prescriptions(u: AuthUser) { return this.prisma.db.prescription.findMany({ where: { customerId: cid(u), isActive: true }, orderBy: { issuedAt: 'desc' } }); }

  async addPrescription(u: AuthUser, dto: D.SelfPrescriptionDto) {
    const hasValues = ['odSph', 'osSph', 'odCyl', 'osCyl', 'odAdd', 'osAdd'].some((k) => (dto as any)[k] != null);
    if (!hasValues && !dto.attachmentUrl) throw new BadRequestException({ code: 'PRESCRIPTION_EMPTY', message: 'Enter your measurements or upload a scan of your prescription' });
    if (dto.attachmentUrl && !(await this.prisma.raw.mediaAsset.findFirst({ where: { url: dto.attachmentUrl, uploadedById: u.id, folder: 'prescriptions' } }))) throw new BadRequestException({ code: 'INVALID_ATTACHMENT', message: 'Upload the file through the prescription upload first' });
    const { storeId: _s, source: _src, ...data } = dto as any;
    return this.prisma.raw.prescription.create({ data: { ...data, customerId: cid(u), source: hasValues ? 'SELF' : 'UPLOAD', createdById: u.id } });
  }

  upload(u: AuthUser, file: Express.Multer.File | undefined) { return this.media.upload(file, 'prescriptions', undefined, u.id).then((m) => ({ url: m.url })); }

  async removePrescription(u: AuthUser, id: string) {
    const rx = await this.prisma.db.prescription.findFirst({ where: { id, customerId: cid(u) } });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (rx.verifiedAt) throw new ConflictException({ code: 'VERIFIED', message: 'A prescription checked by our opticians cannot be deleted' });
    await this.prisma.raw.prescription.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  // ------------------------------------------------------------------ orders
  async myOrders(u: AuthUser) {
    const rows = await this.prisma.db.order.findMany({ where: { customerId: cid(u) }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, number: true, channel: true, status: true, paymentStatus: true, total: true, placedAt: true, fulfillment: true } });
    return rows.map((o) => ({ ...o, total: Number(o.total) }));
  }

  async myOrder(u: AuthUser, number: string) {
    const o = await this.prisma.db.order.findFirst({ where: { number, customerId: cid(u) }, select: { id: true } });
    if (!o) throw new NotFoundException('Order not found');
    return this.checkout.summary(o.id);
  }

  /** A customer may cancel while nothing irreversible happened: unpaid, not shipped, no pair cut yet. Stock returns to the shelf. */
  async cancelOrder(u: AuthUser, number: string, dto: D.CancelOnlineOrderDto) {
    const order = await this.prisma.db.order.findFirst({ where: { number, customerId: cid(u), channel: 'ONLINE' }, include: { lines: { where: { deletedAt: null } } } });
    if (!order) throw new NotFoundException('Order not found');
    if (!['PENDING', 'CONFIRMED'].includes(order.status) || Number(order.paidTotal) > 0) throw new ConflictException({ code: 'CANNOT_CANCEL', message: 'This order can no longer be cancelled online: contact the store' });
    const wh = await this.orders.defaultWarehouse(order.storeId);
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (!['PENDING', 'CONFIRMED'].includes(fresh.status)) throw new ConflictException({ code: 'CANNOT_CANCEL', message: 'This order can no longer be cancelled online: contact the store' });
      const started = await tx.jobOrder.count({ where: { orderId: order.id, deletedAt: null, status: { notIn: ['PENDING', 'LENSES_ORDERED', 'CANCELLED'] } } });
      if (started) throw new ConflictException({ code: 'CANNOT_CANCEL', message: 'The workshop already started on your glasses: contact the store' });
      for (const l of order.lines) if (l.variantId) await this.stock.move(tx, { storeId: order.storeId, variantId: l.variantId, warehouseId: wh.id, type: 'SALE_RETURN', quantity: l.quantity, unitCost: l.unitCost == null ? undefined : Number(l.unitCost), refType: 'Order', refId: order.id, note: `${order.number} cancelled by customer` });
      await cancelJobsForOrder(tx, order.id, null as never, 'Order cancelled by the customer');
      await tx.shipment.updateMany({ where: { orderId: order.id }, data: { deletedAt: new Date() } });
      await tx.invoice.updateMany({ where: { orderId: order.id, status: { not: 'VOID' } }, data: { status: 'VOID' } });
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: dto.reason ?? 'Cancelled by the customer', balanceDue: 0 } });
    });
    return this.checkout.summary(order.id);
  }

  // ------------------------------------------------------------------ reviews
  async review(u: AuthUser, dto: D.ReviewDto) {
    if (!(await this.prisma.db.product.findFirst({ where: { id: dto.productId, isPublished: true } }))) throw new NotFoundException('Product not found');
    if (await this.prisma.db.review.findFirst({ where: { productId: dto.productId, customerId: cid(u) } })) throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'You already reviewed this product' });
    const c = await this.prisma.db.customer.findFirstOrThrow({ where: { id: cid(u) } });
    await this.prisma.raw.review.create({ data: { productId: dto.productId, customerId: c.id, authorName: `${c.firstName} ${c.lastName.charAt(0)}.`, rating: dto.rating, title: dto.title, body: dto.body, status: 'PENDING' } });
    return { message: 'Thank you! Your review will appear once it has been approved.' };
  }
}
