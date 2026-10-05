import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { priceOrder, roundMoney, type PriceLineInput } from '@mizmar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types';
import { SettingsService } from '../settings/settings.service';
import type { SaleLineDto } from './sales.dto';

export interface PricedCartLine {
  variantId: string;
  productId: string;
  productType: string;
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  discount: number;
  taxRateId: string | null;
  taxRatePct: number;
  taxInclusive: boolean;
  taxAmount: number;
  lineTotal: number;
  gross: number;
  requiresStock: boolean;
  lens: null | {
    lensTypeId: string; lensTypeName: string; lensEntryId: string | null; lensEntryName: string | null; prescriptionId: string | null;
    prescriptionSnapshot: unknown; lensPrice: number; treatments: { treatmentId: string; name: string; price: number }[]; treatmentsPrice: number; notes?: string;
  };
}
export interface PricedCart { lines: PricedCartLine[]; subtotal: number; discountTotal: number; taxTotal: number; shippingTotal: number; total: number; hasLens: boolean }

const RX_EYES = ['od', 'os'] as const;
const inRange = (v: number | null, min: unknown, max: unknown) => v == null || ((min == null || v >= Number(min)) && (max == null || v <= Number(max)));

/**
 * Turns what the cashier asked for (variant ids, quantities, discounts, lens choices) into authoritative prices.
 * Client-supplied prices are never accepted: everything is re-read from the catalog here.
 */
@Injectable()
export class CartPricingService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  async price(lines: SaleLineDto[], ctx: { user: AuthUser | null; storeId: string; customerId?: string | null; trustedDiscounts?: boolean }): Promise<PricedCart> {
    const wantsDiscount = lines.some((l) => l.discount && l.discount.value > 0);
    // `trustedDiscounts` is set only by server code that computed the discount itself (online coupons); a till discount needs the permission
    if (wantsDiscount && !ctx.trustedDiscounts && !ctx.user?.isSuperAdmin && !ctx.user?.permissions.includes('pos:discount')) {
      throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Insufficient permissions', details: { missing: ['pos:discount'] } });
    }
    const variants = await this.prisma.db.productVariant.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.variantId))] }, isActive: true, product: { status: 'ACTIVE' } },
      include: { product: { select: { id: true, name: true, type: true, taxRateId: true, isLensConfigurable: true, requiresPrescription: true } } },
    });
    const vmap = new Map(variants.map((v) => [v.id, v]));
    const missing = lines.filter((l) => !vmap.has(l.variantId)).map((l) => l.variantId);
    if (missing.length) throw new BadRequestException({ code: 'UNKNOWN_VARIANT', message: 'Some items are unknown, inactive or not on sale', details: { variantIds: [...new Set(missing)] } });

    const defaultTax = await this.prisma.db.taxRate.findFirst({ where: { isDefault: true, isActive: true } });
    const taxIds = [...new Set(variants.map((v) => v.product.taxRateId).filter(Boolean) as string[])];
    const taxes = new Map((await this.prisma.db.taxRate.findMany({ where: { id: { in: taxIds } } })).map((t) => [t.id, t]));

    const needRx = await this.settings.value('prescription_required_for_lenses', true, ctx.storeId);
    const lensLines = lines.filter((l) => l.lens);
    const customer = ctx.customerId ? await this.prisma.db.customer.findFirst({ where: { id: ctx.customerId }, select: { id: true } }) : null;
    if (ctx.customerId && !customer) throw new BadRequestException('Unknown customer');
    if (lensLines.length && !customer) throw new BadRequestException({ code: 'CUSTOMER_REQUIRED', message: 'Prescription lenses need a customer on the order' });

    const out: PricedCartLine[] = [];
    const inputs: PriceLineInput[] = [];
    for (const l of lines) {
      const v = vmap.get(l.variantId)!;
      const tax = (v.product.taxRateId && taxes.get(v.product.taxRateId)) || defaultTax;
      const lens = l.lens ? await this.resolveLens(l, v, ctx.customerId!, needRx) : null;
      const taxRatePct = tax ? Number(tax.rate) : 0, taxInclusive = tax ? tax.isInclusive : true;
      inputs.push({ quantity: l.quantity, unitPrice: Number(v.price), lensPrice: lens?.lensPrice, treatmentsPrice: lens?.treatmentsPrice, discount: l.discount ?? null, taxRatePct, taxInclusive });
      const lensText = lens ? ` + ${lens.lensEntryName ?? lens.lensTypeName}${lens.treatments.length ? ` (${lens.treatments.map((t) => t.name).join(', ')})` : ''}` : '';
      out.push({
        variantId: v.id, productId: v.product.id, productType: v.product.type, sku: v.sku, description: `${v.product.name}${v.color ? ` — ${v.color}` : ''}${v.size ? ` ${v.size}` : ''}${lensText}`,
        quantity: l.quantity, unitPrice: Number(v.price), unitCost: v.cost == null ? null : Number(v.cost), discount: 0, taxRateId: tax?.id ?? null, taxRatePct, taxInclusive,
        taxAmount: 0, lineTotal: 0, gross: 0, requiresStock: true, lens,
      });
    }
    let priced: ReturnType<typeof priceOrder>;
    try {
      priced = priceOrder(inputs);
    } catch (e) {
      // the shared pricing maths rejects impossible input (e.g. a 101% discount): that is the caller's mistake, not a server fault
      if (e instanceof RangeError) throw new BadRequestException({ code: 'INVALID_PRICING', message: e.message });
      throw e;
    }
    priced.lines.forEach((p, i) => Object.assign(out[i], { discount: p.discount, taxAmount: p.tax, lineTotal: p.total, gross: p.gross }));
    return { lines: out, subtotal: priced.subtotal, discountTotal: priced.discountTotal, taxTotal: priced.taxTotal, shippingTotal: priced.shippingTotal, total: priced.total, hasLens: out.some((x) => x.lens) };
  }

  private async resolveLens(l: SaleLineDto, variant: { product: { type: string; isLensConfigurable: boolean } }, customerId: string, needRx: boolean) {
    const input = l.lens!;
    if (!['FRAME', 'SUNGLASSES'].includes(variant.product.type)) throw new BadRequestException('Lenses can only be fitted to frames and sunglasses');
    const lensType = await this.prisma.db.lensType.findFirst({ where: { id: input.lensTypeId, isActive: true }, include: { treatments: { where: { deletedAt: null }, include: { treatment: true } } } });
    if (!lensType) throw new BadRequestException('Unknown or inactive lens type');
    const entry = input.lensEntryId ? await this.prisma.db.lensCatalogEntry.findFirst({ where: { id: input.lensEntryId, isActive: true } }) : null;
    if (input.lensEntryId && (!entry || entry.lensTypeId !== lensType.id)) throw new BadRequestException('That lens does not belong to the chosen lens type');

    const offered = new Map(lensType.treatments.filter((t) => t.treatment.isActive && !t.treatment.deletedAt).map((t) => [t.treatmentId, t]));
    const treatments = (input.treatmentIds ?? []).map((id) => {
      const t = offered.get(id);
      if (!t) throw new BadRequestException({ code: 'TREATMENT_NOT_AVAILABLE', message: 'A selected treatment is not offered with this lens type', details: { treatmentId: id } });
      return { treatmentId: id, name: t.treatment.name, price: Number(t.priceOverride ?? t.treatment.price) };
    });

    let rx: Record<string, any> | null = null;
    if (input.prescriptionId) {
      rx = await this.prisma.db.prescription.findFirst({ where: { id: input.prescriptionId, customerId } });
      if (!rx) throw new BadRequestException({ code: 'PRESCRIPTION_NOT_FOUND', message: "That prescription does not belong to this customer" });
      if (rx.expiresAt && rx.expiresAt < new Date(new Date().toDateString())) throw new BadRequestException({ code: 'PRESCRIPTION_EXPIRED', message: 'This prescription has expired: renew it before ordering lenses' });
    } else if (needRx && lensType.kind !== 'PLANO') {
      throw new BadRequestException({ code: 'PRESCRIPTION_REQUIRED', message: 'A prescription is required for corrective lenses' });
    }
    // a customer's uploaded scan has no typed values: staff transcribe and verify it at the bench, so there is nothing to range-check yet
    const scanOnly = rx?.source === 'UPLOAD' && ['odSph', 'osSph', 'odCyl', 'osCyl', 'odAdd', 'osAdd'].every((k) => rx![k] == null);
    if (rx && !scanOnly) {
      if (lensType.requiresAdd && rx.odAdd == null && rx.osAdd == null) throw new BadRequestException({ code: 'ADDITION_REQUIRED', message: `${lensType.name} lenses need an addition (ADD) on the prescription` });
      if (entry) {
        for (const eye of RX_EYES) {
          const sph = rx[`${eye}Sph`] == null ? null : Number(rx[`${eye}Sph`]), cyl = rx[`${eye}Cyl`] == null ? null : Number(rx[`${eye}Cyl`]), add = rx[`${eye}Add`] == null ? null : Number(rx[`${eye}Add`]);
          if (!inRange(sph, entry.sphMin, entry.sphMax) || !inRange(cyl, entry.cylMin, entry.cylMax) || !inRange(add, entry.addMin, entry.addMax)) {
            throw new BadRequestException({ code: 'LENS_OUT_OF_RANGE', message: `${entry.name} cannot be made for the ${eye.toUpperCase()} measurements of this prescription`, details: { eye: eye.toUpperCase(), sph, cyl, add } });
          }
        }
      }
    }
    const snapshot = rx && Object.fromEntries(['issuedAt', 'prescriberName', 'odSph', 'odCyl', 'odAxis', 'odAdd', 'odPd', 'odPrism', 'odBase', 'osSph', 'osCyl', 'osAxis', 'osAdd', 'osPd', 'osPrism', 'osBase', 'pdTotal'].map((k) => [k, rx![k] instanceof Object && 'toNumber' in rx![k] ? Number(rx![k]) : rx![k]]));
    return {
      lensTypeId: lensType.id, lensTypeName: lensType.name, lensEntryId: entry?.id ?? null, lensEntryName: entry?.name ?? null, prescriptionId: rx?.id ?? null, prescriptionSnapshot: snapshot ?? null,
      lensPrice: roundMoney(Number(entry ? entry.price : lensType.basePrice)), treatments, treatmentsPrice: roundMoney(treatments.reduce((n, t) => n + t.price, 0)), notes: input.notes,
    };
  }
}
