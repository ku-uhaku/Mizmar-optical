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

  private fmt(locale: Locale, currency = 'MAD') {
    const money = new Intl.NumberFormat(INTL[locale], { style: 'currency', currency });
    const date = new Intl.DateTimeFormat(INTL[locale], { dateStyle: 'medium' });
    const dateTime = new Intl.DateTimeFormat(INTL[locale], { dateStyle: 'short', timeStyle: 'short' });
    return { money: (v: unknown) => money.format(n(v)), moneyOrEmpty: (v: unknown) => (n(v) > 0.004 ? money.format(n(v)) : ''), date: (d?: Date | null) => (d ? date.format(d) : ''), dateTime: (d?: Date | null) => (d ? dateTime.format(d) : '') };
  }

  /** The store's own default template, else a global default, else the built-in. */
  private async template(type: 'RECEIPT' | 'INVOICE' | 'QUOTE', storeId: string) {
    const rows = await this.prisma.db.documentTemplate.findMany({ where: { type, isDefault: true, OR: [{ storeId }, { storeId: null }] } });
    // a template written for the old placeholder syntax ({{documentNumber}}) is ignored: it would print an empty document
    const usable = rows.filter((r) => /\{\{\s*doc\./.test(r.html));
    return (usable.find((r) => r.storeId === storeId) ?? usable[0])?.html ?? DEFAULT_TEMPLATES[type].html;
  }

  private async base(storeId: string, locale: Locale) {
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

  private customerCtx(c?: { firstName: string; lastName: string; phone: string | null; email: string | null } | null) {
    return c ? { name: `${c.firstName} ${c.lastName}`, phone: c.phone ?? '', email: c.email ?? '' } : { name: '', phone: '', email: '' };
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
