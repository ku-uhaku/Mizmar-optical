import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertStoreAccess } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { SettingsService } from '../settings/settings.service';
import { SessionsService } from './sessions.service';
import type { HoldSaleDto } from './pos.dto';

const MAX_CART_BYTES = 64 * 1024;

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService, private readonly sessions: SessionsService) {}

  private storeId(user: AuthUser, active?: string | null) {
    const id = active ?? user.defaultStoreId;
    if (!id) throw new BadRequestException({ code: 'NO_STORE', message: 'No active store' });
    assertStoreAccess(user, id);
    return id;
  }

  /** Everything the till needs to start, in one call (works for a cashier who has no catalog/settings permissions). */
  async config(user: AuthUser, active?: string | null) {
    const storeId = this.storeId(user, active);
    const [store, registers, methods, tax, current, requireOpen, minDeposit, allowNeg, needRx] = await Promise.all([
      this.prisma.db.store.findFirst({ where: { id: storeId }, select: { id: true, name: true, currency: true, timezone: true } }),
      this.prisma.db.cashRegister.findMany({ where: { storeId, isActive: true }, orderBy: { code: 'asc' }, include: { sessions: { where: { status: 'OPEN', deletedAt: null }, select: { id: true, openedById: true, openedAt: true } } } }),
      this.prisma.db.paymentMethodConfig.findMany({ where: { isActive: true, availableInPos: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, name: true, type: true } }),
      this.prisma.db.taxRate.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true, name: true, rate: true, isInclusive: true } }),
      this.sessions.currentFor(user, storeId),
      this.settings.value('require_open_session', true, storeId), this.settings.value<number>('min_deposit_pct', 30, storeId), this.settings.value('allow_negative_stock', false, storeId), this.settings.value('prescription_required_for_lenses', true, storeId),
    ]);
    return {
      store, currentSession: current,
      registers: registers.map(({ sessions, ...r }) => ({ id: r.id, code: r.code, name: r.name, openSession: sessions[0] ?? null })),
      paymentMethods: methods, defaultTax: tax && { ...tax, rate: Number(tax.rate) },
      settings: { requireOpenSession: requireOpen, minDepositPct: minDeposit, allowNegativeStock: allowNeg, prescriptionRequiredForLenses: needRx },
    };
  }

  /** Lens types with the treatments and concrete lenses the cashier may offer, with effective prices. */
  async lensOptions() {
    const types = await this.prisma.db.lensType.findMany({
      where: { isActive: true }, orderBy: { sortOrder: 'asc' },
      include: {
        treatments: { where: { deletedAt: null, treatment: { isActive: true, deletedAt: null } }, include: { treatment: true } },
        entries: { where: { isActive: true, deletedAt: null }, orderBy: [{ refractiveIndex: 'asc' }, { price: 'asc' }] },
      },
    });
    return types.map((t) => ({
      id: t.id, code: t.code, name: t.name, kind: t.kind, requiresAdd: t.requiresAdd, basePrice: Number(t.basePrice),
      treatments: t.treatments.map((x) => ({ id: x.treatmentId, name: x.treatment.name, category: x.treatment.category, price: Number(x.priceOverride ?? x.treatment.price) })).sort((a, b) => a.name.localeCompare(b.name)),
      entries: t.entries.map((e) => ({ id: e.id, name: e.name, sku: e.sku, refractiveIndex: Number(e.refractiveIndex), price: Number(e.price), leadTimeDays: e.leadTimeDays, sphMin: e.sphMin == null ? null : Number(e.sphMin), sphMax: e.sphMax == null ? null : Number(e.sphMax), cylMin: e.cylMin == null ? null : Number(e.cylMin), cylMax: e.cylMax == null ? null : Number(e.cylMax), addMin: e.addMin == null ? null : Number(e.addMin), addMax: e.addMax == null ? null : Number(e.addMax) })),
    }));
  }

  // ---------------------------------------------------------------- parked sales
  listHeld(user: AuthUser, active?: string | null) {
    return this.prisma.db.posHeldSale.findMany({ where: { storeId: this.storeId(user, active) }, orderBy: { createdAt: 'desc' }, take: 50 });
  }
  async hold(dto: HoldSaleDto, user: AuthUser, active?: string | null) {
    const storeId = this.storeId(user, active);
    if (Buffer.byteLength(JSON.stringify(dto.cart)) > MAX_CART_BYTES) throw new BadRequestException('Cart is too large to park');
    if ((await this.prisma.db.posHeldSale.count({ where: { storeId } })) >= 50) throw new BadRequestException({ code: 'TOO_MANY_HELD', message: 'Too many parked sales: resume or delete some first' });
    return this.prisma.raw.posHeldSale.create({ data: { storeId, registerId: dto.registerId, cashierId: user.id, label: dto.label, cart: dto.cart as any } });
  }
  async dropHeld(id: string, user: AuthUser) {
    const h = await this.prisma.db.posHeldSale.findFirst({ where: { id } });
    if (!h) throw new NotFoundException('Parked sale not found');
    assertStoreAccess(user, h.storeId);
    if (h.cashierId !== user.id && !user.isSuperAdmin && !user.permissions.includes('pos:manage_register')) throw new ForbiddenException('This parked sale belongs to another cashier');
    await this.prisma.db.posHeldSale.delete({ where: { id } });
  }
}
