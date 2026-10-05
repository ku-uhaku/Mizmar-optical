import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertStoreAccess } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { SettingsService } from '../settings/settings.service';
import { DEFAULT_TEMPLATES, LABELS } from './default-templates';
import { renderHtml } from './template-engine';

type Locale = 'fr' | 'en' | 'ar';
const INTL: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB', ar: 'ar-MA' };
const n = (v: unknown) => Number(v ?? 0);

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  fmt(locale: Locale, currency = 'MAD') {
    const money = new Intl.NumberFormat(INTL[locale], { style: 'currency', currency });
    const date = new Intl.DateTimeFormat(INTL[locale], { dateStyle: 'medium' });
    const dateTime = new Intl.DateTimeFormat(INTL[locale], { dateStyle: 'short', timeStyle: 'short' });
    return { money: (v: unknown) => money.format(n(v)), moneyOrEmpty: (v: unknown) => (n(v) > 0.004 ? money.format(n(v)) : ''), date: (d?: Date | null) => (d ? date.format(d) : ''), dateTime: (d?: Date | null) => (d ? dateTime.format(d) : '') };
  }

  /** The store's own default template, else a global default, else the built-in. */
  async template(type: 'RECEIPT' | 'INVOICE' | 'QUOTE' | 'PURCHASE_ORDER' | 'JOB_ORDER', storeId: string) {
    const rows = await this.prisma.db.documentTemplate.findMany({ where: { type, isDefault: true, OR: [{ storeId }, { storeId: null }] } });
    // a template written for the old placeholder syntax ({{documentNumber}}) is ignored: it would print an empty document
    const usable = rows.filter((r) => /\{\{\s*doc\./.test(r.html));
    return (usable.find((r) => r.storeId === storeId) ?? usable[0])?.html ?? DEFAULT_TEMPLATES[type].html;
  }

  async base(storeId: string, locale: Locale) {
    const [store, branding, footer] = await Promise.all([
      this.prisma.db.store.findFirst({ where: { id: storeId } }),
      this.prisma.db.brandingSetting.findFirst({ where: { key: 'default' } }),
      this.settings.value<string | null>('footer', null, storeId),
    ]);
    if (!store) throw new NotFoundException('Store not found');
    const legal = (branding?.legal ?? {}) as Record<string, string>;
    return {
      lang: locale, dir: locale === 'ar' ? 'rtl' : 'ltr', labels: LABELS[locale], company: branding?.storeName ?? store.name, footer: footer ?? LABELS[locale].thanks,
      store: { name: store.name, address: store.address ?? '', city: store.city ?? '', phone: store.phone ?? '', email: store.email ?? '' }, legal, currency: store.currency,
    };
  }

  customerCtx(c?: { firstName: string; lastName: string; phone: string | null; email: string | null } | null) {
    return c ? { name: `${c.firstName} ${c.lastName}`, phone: c.phone ?? '', email: c.email ?? '' } : { name: '', phone: '', email: '' };
  }

  // ------------------------------------------------------------------ purchase order
  async purchaseOrder(id: string, user: AuthUser, locale: Locale = 'fr') {
    const po = await this.prisma.db.purchaseOrder.findFirst({ where: { id }, include: { supplier: true, lines: { where: { deletedAt: null }, orderBy: { id: 'asc' } } } });
    if (!po) throw new NotFoundException('Purchase order not found');
    assertStoreAccess(user, po.storeId);
    const base = await this.base(po.storeId, locale), f = this.fmt(locale, base.currency);
    const ctx = {
      ...base, doc: { number: po.number, date: f.date(po.orderedAt ?? po.createdAt), validUntil: f.date(po.expectedAt) }, order: { number: '' }, payments: [],
      customer: { name: po.supplier.name, phone: po.supplier.phone ?? '', email: po.supplier.email ?? '' },
      lines: po.lines.map((l) => ({ description: l.description, qty: l.qtyOrdered, unit: f.money(l.unitCost), discount: '', taxRate: `${n(l.taxRatePct)}%`, total: f.money(l.lineTotal) })),
      totals: { subtotal: f.money(po.subtotal), discount: '', net: f.money(po.subtotal), tax: f.money(po.taxTotal), total: f.money(po.total), paid: '', balanceDue: '' },
    };
    return { number: po.number, locale, html: renderHtml(await this.template('PURCHASE_ORDER', po.storeId), ctx) };
  }

  // ------------------------------------------------------------------ workshop job ticket
  async jobTicket(id: string, user: AuthUser, locale: Locale = 'fr') {
    const j = await this.prisma.db.jobOrder.findFirst({
      where: { id },
      include: { customer: true, technician: true, order: { select: { number: true } }, prescription: true, tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }, frameVariant: { select: { sku: true, color: true, size: true, product: { select: { name: true } } } } },
    });
    if (!j) throw new NotFoundException('Job not found');
    assertStoreAccess(user, j.storeId);
    const base = await this.base(j.storeId, locale), f = this.fmt(locale, base.currency);
    const [lensType, entry] = await Promise.all([
      j.lensTypeId ? this.prisma.db.lensType.findFirst({ where: { id: j.lensTypeId } }) : null,
      j.lensEntryId ? this.prisma.db.lensCatalogEntry.findFirst({ where: { id: j.lensEntryId } }) : null,
    ]);
    const rx = j.prescription, num = (v: unknown, signed = false) => (v == null ? '' : `${signed && Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}`);
    const rows = rx ? [
      { eye: 'OD', sph: num(rx.odSph, true), cyl: num(rx.odCyl, true), axis: rx.odAxis ?? '', add: num(rx.odAdd, true), pd: num(rx.odPd) },
      { eye: 'OG', sph: num(rx.osSph, true), cyl: num(rx.osCyl, true), axis: rx.osAxis ?? '', add: num(rx.osAdd, true), pd: num(rx.osPd) },
    ] : [];
    const fit = (j.fitting ?? {}) as Record<string, unknown>;
    const ctx = {
      ...base, doc: { number: j.number, date: f.date(j.createdAt), promised: f.date(j.promisedAt) }, order: { number: j.order?.number ?? '' }, customer: this.customerCtx(j.customer),
      frame: j.frameVariant ? [j.frameVariant.product.name, j.frameVariant.color, j.frameVariant.size].filter(Boolean).join(' — ') : (j.frameDescription ?? ''),
      lens: [lensType?.name, entry?.name].filter(Boolean).join(' · '), treatments: ((j.treatments ?? []) as { name: string }[]).map((t) => t.name).join(', '),
      hasRx: rows.length > 0, rx: rows, pdTotal: num(rx?.pdTotal), fitting: Object.entries(fit).map(([k, v]) => `${k}: ${v}`).join(' · '),
      priority: j.priority, technician: j.technician ? `${j.technician.firstName} ${j.technician.lastName}` : '', notes: j.notes ?? '', tasks: j.tasks.map((t) => ({ name: t.name })),
    };
    return { number: j.number, locale, html: renderHtml(await this.template('JOB_ORDER', j.storeId), ctx) };
  }

  // ------------------------------------------------------------------ receipt
  async receipt(orderId: string, user: AuthUser, locale: Locale = 'fr') {
    const o = await this.prisma.db.order.findFirst({
      where: { id: orderId },
      include: { customer: true, lines: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' }, include: { lensConfig: { select: { id: true } } } }, payments: { where: { deletedAt: null, status: 'CAPTURED' }, orderBy: { paidAt: 'asc' }, include: { method: { select: { name: true } } } } },
    });
    if (!o) throw new NotFoundException('Order not found');
    assertStoreAccess(user, o.storeId);
    const cashier = o.cashierId ? await this.prisma.db.user.findFirst({ where: { id: o.cashierId }, select: { firstName: true, lastName: true } }) : null;
    const base = await this.base(o.storeId, locale), f = this.fmt(locale, base.currency);
    const ctx = {
      ...base, doc: { number: o.number, date: f.dateTime(o.placedAt ?? o.createdAt) }, cashier: cashier ? `${cashier.firstName} ${cashier.lastName}` : '', customer: this.customerCtx(o.customer),
      hasLens: o.lines.some((l) => l.lensConfig),
      lines: o.lines.map((l) => ({ description: l.description, qty: l.quantity, unit: f.money((n(l.lineTotal) + n(l.discount)) / l.quantity), discount: f.moneyOrEmpty(l.discount), total: f.money(l.lineTotal) })),
      totals: { subtotal: f.money(o.subtotal), discount: f.moneyOrEmpty(o.discountTotal), tax: f.money(o.taxTotal), total: f.money(o.total), paid: f.money(o.paidTotal), balanceDue: f.moneyOrEmpty(o.balanceDue) },
      payments: o.payments.map((p) => ({ method: p.kind === 'REFUND' ? `${p.method.name} (−)` : p.method.name, amount: p.kind === 'REFUND' ? `−${f.money(p.amount)}` : f.money(p.amount), date: f.date(p.paidAt) })),
    };
    return { number: o.number, locale, html: renderHtml(await this.template('RECEIPT', o.storeId), ctx) };
  }

  // ------------------------------------------------------------------ invoice
  async invoice(invoiceId: string, user: AuthUser, locale: Locale = 'fr') {
    const inv = await this.prisma.db.invoice.findFirst({
      where: { id: invoiceId },
      include: { customer: true, order: { select: { number: true, balanceDue: true, paidTotal: true, payments: { where: { deletedAt: null, status: 'CAPTURED', kind: { in: ['PAYMENT', 'DEPOSIT'] } }, orderBy: { paidAt: 'asc' }, include: { method: { select: { name: true } } } } } }, lines: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    assertStoreAccess(user, inv.storeId);
    const snap = (inv.billingSnapshot ?? {}) as { store?: Record<string, string>; customer?: { firstName: string; lastName: string; phone: string | null; email: string | null } | null; company?: string; legal?: Record<string, string> | null };
    const base = await this.base(inv.storeId, locale), f = this.fmt(locale, base.currency);
    const payments = inv.order?.payments ?? [];
    const ctx = {
      ...base, company: snap.company ?? base.company, legal: snap.legal ?? base.legal, store: { ...base.store, ...(snap.store ?? {}) },
      doc: { number: inv.number, date: f.date(inv.issuedAt ?? inv.createdAt) }, order: { number: inv.order?.number ?? '' }, customer: this.customerCtx(snap.customer ?? inv.customer),
      lines: inv.lines.map((l) => ({ description: l.description, qty: l.quantity, unit: f.money(l.unitPrice), discount: f.moneyOrEmpty(l.discount), taxRate: `${n(l.taxRatePct)}%`, total: f.money(l.lineTotal) })),
      totals: { subtotal: f.money(inv.subtotal), discount: f.moneyOrEmpty(inv.discountTotal), net: f.money(n(inv.total) - n(inv.taxTotal)), tax: f.money(inv.taxTotal), total: f.money(inv.total), paid: f.money(inv.paidTotal), balanceDue: f.moneyOrEmpty(inv.order?.balanceDue) },
      payments: payments.map((p, i) => ({ method: p.method.name, amount: f.money(p.amount), date: f.date(p.paidAt), last: i === payments.length - 1 })),
    };
    return { number: inv.number, locale, html: renderHtml(await this.template('INVOICE', inv.storeId), ctx) };
  }

  // ------------------------------------------------------------------ quote
  async quote(quoteId: string, user: AuthUser, locale: Locale = 'fr') {
    const q = await this.prisma.db.quote.findFirst({ where: { id: quoteId }, include: { customer: true, lines: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } } });
    if (!q) throw new NotFoundException('Quote not found');
    assertStoreAccess(user, q.storeId);
    const base = await this.base(q.storeId, locale), f = this.fmt(locale, base.currency);
    const ctx = {
      ...base, doc: { number: q.number, date: f.date(q.createdAt), validUntil: f.date(q.validUntil) }, order: { number: '' }, customer: this.customerCtx(q.customer), payments: [],
      lines: q.lines.map((l) => ({ description: l.description, qty: l.quantity, unit: f.money((n(l.lineTotal) + n(l.discount)) / l.quantity), discount: f.moneyOrEmpty(l.discount), taxRate: `${n(l.taxRatePct)}%`, total: f.money(l.lineTotal) })),
      totals: { subtotal: f.money(q.subtotal), discount: f.moneyOrEmpty(q.discountTotal), net: f.money(n(q.total) - n(q.taxTotal)), tax: f.money(q.taxTotal), total: f.money(q.total), paid: '', balanceDue: '' },
    };
    return { number: q.number, locale, html: renderHtml(await this.template('QUOTE', q.storeId), ctx) };
  }
}
