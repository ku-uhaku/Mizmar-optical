import { Injectable } from '@nestjs/common';
import { fromCents, toCents } from '@mizmar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import type { Column, ReportTable } from './report-table';
import type { Group, ReportQueryDto, StockQueryDto } from './reports.dto';

type Loc = 'fr' | 'en' | 'ar';
const L: Record<string, Record<Loc, string>> = {
  period: { fr: 'Période', en: 'Period', ar: 'الفترة' }, store: { fr: 'Magasin', en: 'Store', ar: 'المتجر' }, employee: { fr: 'Vendeur', en: 'Salesperson', ar: 'البائع' }, category: { fr: 'Catégorie', en: 'Category', ar: 'الفئة' },
  brand: { fr: 'Marque', en: 'Brand', ar: 'العلامة' }, product: { fr: 'Produit', en: 'Product', ar: 'المنتج' }, type: { fr: 'Type', en: 'Type', ar: 'النوع' }, channel: { fr: 'Canal', en: 'Channel', ar: 'القناة' },
  orders: { fr: 'Commandes', en: 'Orders', ar: 'الطلبات' }, units: { fr: 'Unités', en: 'Units', ar: 'الوحدات' }, gross: { fr: 'Brut', en: 'Gross', ar: 'الإجمالي' }, discount: { fr: 'Remises', en: 'Discounts', ar: 'التخفيضات' },
  revenue: { fr: 'CA TTC', en: 'Revenue (incl. VAT)', ar: 'رقم المعاملات شامل الضريبة' }, revenueEx: { fr: 'CA HT', en: 'Revenue (excl. VAT)', ar: 'رقم المعاملات دون ضريبة' }, tax: { fr: 'TVA', en: 'VAT', ar: 'الضريبة' },
  cost: { fr: 'Coût', en: 'Cost', ar: 'التكلفة' }, profit: { fr: 'Marge', en: 'Margin', ar: 'الهامش' }, margin: { fr: 'Marge %', en: 'Margin %', ar: 'الهامش %' }, basket: { fr: 'Panier moyen', en: 'Avg. basket', ar: 'متوسط السلة' },
  sku: { fr: 'SKU', en: 'SKU', ar: 'SKU' }, warehouse: { fr: 'Entrepôt', en: 'Warehouse', ar: 'المستودع' }, qty: { fr: 'Quantité', en: 'Quantity', ar: 'الكمية' }, costValue: { fr: 'Valeur au coût', en: 'Value at cost', ar: 'القيمة بالتكلفة' }, retailValue: { fr: 'Valeur de vente', en: 'Retail value', ar: 'قيمة البيع' },
  customer: { fr: 'Client', en: 'Customer', ar: 'الزبون' }, spent: { fr: 'Dépensé', en: 'Spent', ar: 'المنفق' }, lastOrder: { fr: 'Dernière commande', en: 'Last order', ar: 'آخر طلب' },
  expenses: { fr: 'Dépenses', en: 'Expenses', ar: 'المصاريف' }, payroll: { fr: 'Salaires', en: 'Payroll', ar: 'الأجور' }, operating: { fr: 'Résultat d’exploitation', en: 'Operating result', ar: 'النتيجة التشغيلية' },
  salesTitle: { fr: 'Ventes', en: 'Sales', ar: 'المبيعات' }, bestTitle: { fr: 'Meilleures ventes', en: 'Best sellers', ar: 'الأكثر مبيعًا' }, stockTitle: { fr: 'Valeur du stock', en: 'Stock value', ar: 'قيمة المخزون' },
  profitTitle: { fr: 'Rentabilité', en: 'Profitability', ar: 'الربحية' }, customersTitle: { fr: 'Meilleurs clients', en: 'Top customers', ar: 'أفضل الزبناء' },
  POS: { fr: 'Caisse', en: 'In store', ar: 'المتجر' }, ONLINE: { fr: 'En ligne', en: 'Online', ar: 'عبر الإنترنت' },
  FRAME: { fr: 'Lunettes de vue', en: 'Eyeglasses', ar: 'نظارات طبية' }, SUNGLASSES: { fr: 'Solaires', en: 'Sunglasses', ar: 'نظارات شمسية' }, CONTACT_LENS: { fr: 'Lentilles', en: 'Contact lenses', ar: 'عدسات لاصقة' }, LENS: { fr: 'Verres', en: 'Lenses', ar: 'عدسات' }, ACCESSORY: { fr: 'Accessoires', en: 'Accessories', ar: 'إكسسوارات' },
  none: { fr: 'Non renseigné', en: 'Unspecified', ar: 'غير محدد' },
};
export const t = (k: string, l: Loc) => L[k]?.[l] ?? k;

interface SaleLine { orderId: string; at: Date; storeId: string; channel: string; cashierId: string | null; productId: string | null; productName: string; type: string | null; brandId: string | null; categoryId: string | null; units: number; gross: number; discount: number; revenue: number; tax: number; cost: number }
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const endOfDay = (s: string) => new Date(`${s}T23:59:59.999Z`);
const weekStart = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private stores(user: AuthUser, storeId?: string): string[] | null { return storeId ? (assertStoreAccess(user, storeId), [storeId]) : (visibleStoreIds(user) ?? null); }

  /**
   * Every sold line in the period, net of returns, in integer cents. Revenue is what the customer paid (VAT included) after discounts and
   * refunds; cost is the item's recorded unit cost × units kept. Lens-lab cost is not part of an item's unit cost, so margins on prescription
   * orders are slightly generous. Delivery fees are not part of any line.
   */
  private async saleLines(from: string, to: string, stores: string[] | null): Promise<SaleLine[]> {
    const orders = await this.prisma.db.order.findMany({
      where: { ...(stores && { storeId: { in: stores } }), status: { notIn: ['CANCELLED', 'DRAFT'] }, placedAt: { gte: day(from), lte: endOfDay(to) } },
      select: { id: true, placedAt: true, storeId: true, channel: true, cashierId: true, lines: { where: { deletedAt: null }, select: { quantity: true, unitCost: true, discount: true, taxAmount: true, lineTotal: true, unitPrice: true, description: true, variant: { select: { productId: true, product: { select: { name: true, type: true, brandId: true, categoryId: true } } } }, returnLines: { where: { deletedAt: null, return: { status: { not: 'REJECTED' } } }, select: { quantity: true, refundAmount: true } } } } },
      take: 100_000,
    });
    const out: SaleLine[] = [];
    for (const o of orders) for (const l of o.lines) {
      const total = toCents(Number(l.lineTotal)), refunded = l.returnLines.reduce((n, r) => n + toCents(Number(r.refundAmount)), 0), keptUnits = l.quantity - l.returnLines.reduce((n, r) => n + r.quantity, 0);
      const revenue = Math.max(0, total - refunded);
      const tax = total > 0 ? Math.round((toCents(Number(l.taxAmount)) * revenue) / total) : 0;
      const p = l.variant?.product;
      out.push({
        orderId: o.id, at: o.placedAt ?? new Date(), storeId: o.storeId, channel: o.channel, cashierId: o.cashierId, productId: l.variant?.productId ?? null, productName: p?.name ?? l.description, type: p?.type ?? null, brandId: p?.brandId ?? null, categoryId: p?.categoryId ?? null,
        units: Math.max(0, keptUnits), gross: total + toCents(Number(l.discount)), discount: toCents(Number(l.discount)), revenue, tax, cost: l.unitCost == null ? 0 : toCents(Number(l.unitCost)) * Math.max(0, keptUnits),
      });
    }
    return out;
  }

  private async names(kind: 'store' | 'user' | 'category' | 'brand', ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    if (kind === 'store') return new Map((await this.prisma.db.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    if (kind === 'user') return new Map((await this.prisma.raw.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })).map((x) => [x.id, `${x.firstName} ${x.lastName}`]));
    if (kind === 'category') return new Map((await this.prisma.db.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    return new Map((await this.prisma.db.brand.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  }

  async sales(dto: ReportQueryDto, user: AuthUser, locale: Loc = 'fr'): Promise<ReportTable> {
    const g: Group = dto.groupBy ?? 'day';
    const lines = await this.saleLines(dto.from, dto.to, this.stores(user, dto.storeId));
    const key = (l: SaleLine): string => ({ day: l.at.toISOString().slice(0, 10), week: weekStart(l.at), month: l.at.toISOString().slice(0, 7), store: l.storeId, employee: l.cashierId ?? '-', category: l.categoryId ?? '-', brand: l.brandId ?? '-', product: l.productId ?? l.productName, type: l.type ?? '-', channel: l.channel })[g];
    const groups = new Map<string, { orders: Set<string>; units: number; gross: number; discount: number; revenue: number; tax: number; cost: number; label: string }>();
    for (const l of lines) {
      const k = key(l);
      const x = groups.get(k) ?? { orders: new Set(), units: 0, gross: 0, discount: 0, revenue: 0, tax: 0, cost: 0, label: l.productName };
      x.orders.add(l.orderId); x.units += l.units; x.gross += l.gross; x.discount += l.discount; x.revenue += l.revenue; x.tax += l.tax; x.cost += l.cost;
      groups.set(k, x);
    }
    const keys = [...groups.keys()];
    const nameMap = g === 'store' ? await this.names('store', keys) : g === 'employee' ? await this.names('user', keys.filter((k) => k !== '-')) : g === 'category' ? await this.names('category', keys.filter((k) => k !== '-')) : g === 'brand' ? await this.names('brand', keys.filter((k) => k !== '-')) : new Map<string, string>();
    const label = (k: string) => (g === 'product' ? groups.get(k)!.label : k === '-' ? t('none', locale) : g === 'type' || g === 'channel' ? t(k, locale) : (nameMap.get(k) ?? k));
    const mk = (x: NonNullable<ReturnType<typeof groups.get>>) => {
      const revEx = x.revenue - x.tax;
      return { orders: x.orders.size, units: x.units, gross: fromCents(x.gross), discount: fromCents(x.discount), revenue: fromCents(x.revenue), revenueEx: fromCents(revEx), tax: fromCents(x.tax), cost: fromCents(x.cost), profit: fromCents(revEx - x.cost), margin: revEx > 0 ? Math.round(((revEx - x.cost) / revEx) * 1000) / 10 : 0 };
    };
    const time = g === 'day' || g === 'week' || g === 'month';
    const rows = keys.sort((a, b) => (time ? a.localeCompare(b) : groups.get(b)!.revenue - groups.get(a)!.revenue)).map((k) => ({ key: label(k), ...mk(groups.get(k)!) }));
    const tot = { orders: new Set(lines.map((l) => l.orderId)).size, ...(() => { const all = { orders: new Set<string>(), units: 0, gross: 0, discount: 0, revenue: 0, tax: 0, cost: 0, label: '' }; lines.forEach((l) => { all.units += l.units; all.gross += l.gross; all.discount += l.discount; all.revenue += l.revenue; all.tax += l.tax; all.cost += l.cost; }); const { orders: _o, ...m } = mk({ ...all, orders: new Set(['x']) }); return m; })() };
    const cols: Column[] = [
      { key: 'key', label: t(time ? 'period' : g, locale), type: 'text' }, { key: 'orders', label: t('orders', locale), type: 'number' }, { key: 'units', label: t('units', locale), type: 'number' }, { key: 'gross', label: t('gross', locale), type: 'money' }, { key: 'discount', label: t('discount', locale), type: 'money' },
      { key: 'revenue', label: t('revenue', locale), type: 'money' }, { key: 'tax', label: t('tax', locale), type: 'money' }, { key: 'revenueEx', label: t('revenueEx', locale), type: 'money' }, { key: 'cost', label: t('cost', locale), type: 'money' }, { key: 'profit', label: t('profit', locale), type: 'money' }, { key: 'margin', label: t('margin', locale), type: 'percent' },
    ];
    return { name: 'sales', title: `${t('salesTitle', locale)} — ${t(time ? 'period' : g, locale)}`, period: { from: dto.from, to: dto.to }, columns: cols, rows, totals: { key: null, ...tot } };
  }

  async bestSellers(dto: ReportQueryDto, user: AuthUser, locale: Loc = 'fr'): Promise<ReportTable> {
    const lines = await this.saleLines(dto.from, dto.to, this.stores(user, dto.storeId));
    const by = new Map<string, { name: string; units: number; revenue: number; tax: number; cost: number }>();
    for (const l of lines) { const k = l.productId ?? l.productName; const x = by.get(k) ?? { name: l.productName, units: 0, revenue: 0, tax: 0, cost: 0 }; x.units += l.units; x.revenue += l.revenue; x.tax += l.tax; x.cost += l.cost; by.set(k, x); }
    const sorted = [...by.values()].filter((x) => x.units > 0).sort((a, b) => (dto.by === 'units' ? b.units - a.units : b.revenue - a.revenue)).slice(0, dto.limit ?? 20);
    const rows = sorted.map((x, i) => ({ rank: i + 1, product: x.name, units: x.units, revenue: fromCents(x.revenue), profit: fromCents(x.revenue - x.tax - x.cost) }));
    return { name: 'best-sellers', title: t('bestTitle', locale), period: { from: dto.from, to: dto.to }, columns: [{ key: 'rank', label: '#', type: 'number' }, { key: 'product', label: t('product', locale), type: 'text' }, { key: 'units', label: t('units', locale), type: 'number' }, { key: 'revenue', label: t('revenue', locale), type: 'money' }, { key: 'profit', label: t('profit', locale), type: 'money' }], rows };
  }

  async stockValue(dto: StockQueryDto, user: AuthUser, locale: Loc = 'fr'): Promise<ReportTable> {
    const stores = this.stores(user, dto.storeId);
    const levels = await this.prisma.db.stockLevel.findMany({ where: { quantity: { gt: 0 }, warehouse: { isActive: true, ...(stores && { storeId: { in: stores } }) } }, select: { quantity: true, warehouse: { select: { name: true, store: { select: { name: true } } } }, variant: { select: { cost: true, price: true, product: { select: { type: true } } } } }, take: 100_000 });
    const by = new Map<string, { warehouse: string; type: string; qty: number; cost: number; retail: number }>();
    for (const l of levels) {
      const w = `${l.warehouse.store.name} — ${l.warehouse.name}`, type = l.variant.product.type, k = `${w}|${type}`;
      const x = by.get(k) ?? { warehouse: w, type, qty: 0, cost: 0, retail: 0 };
      x.qty += l.quantity; x.cost += toCents(Number(l.variant.cost ?? 0)) * l.quantity; x.retail += toCents(Number(l.variant.price)) * l.quantity;
      by.set(k, x);
    }
    const rows = [...by.values()].sort((a, b) => a.warehouse.localeCompare(b.warehouse) || b.cost - a.cost).map((x) => ({ warehouse: x.warehouse, type: t(x.type, locale), qty: x.qty, costValue: fromCents(x.cost), retailValue: fromCents(x.retail) }));
    const all = [...by.values()].reduce((a, x) => ({ qty: a.qty + x.qty, cost: a.cost + x.cost, retail: a.retail + x.retail }), { qty: 0, cost: 0, retail: 0 });
    return { name: 'stock-value', title: t('stockTitle', locale), columns: [{ key: 'warehouse', label: t('warehouse', locale), type: 'text' }, { key: 'type', label: t('type', locale), type: 'text' }, { key: 'qty', label: t('qty', locale), type: 'number' }, { key: 'costValue', label: t('costValue', locale), type: 'money' }, { key: 'retailValue', label: t('retailValue', locale), type: 'money' }], rows, totals: { warehouse: null, type: null, qty: all.qty, costValue: fromCents(all.cost), retailValue: fromCents(all.retail) } };
  }

  /** Month by month: revenue (excl. VAT) − cost of goods − expenses (excl. VAT) − payroll cost. */
  async profit(dto: ReportQueryDto, user: AuthUser, locale: Loc = 'fr'): Promise<ReportTable> {
    const stores = this.stores(user, dto.storeId);
    const scope = stores ? { storeId: { in: stores } } : {};
    const lines = await this.saleLines(dto.from, dto.to, stores);
    const month = (d: Date) => d.toISOString().slice(0, 7);
    const m = new Map<string, { revenue: number; cost: number; expenses: number; payroll: number }>();
    const slot = (k: string) => { const x = m.get(k) ?? { revenue: 0, cost: 0, expenses: 0, payroll: 0 }; m.set(k, x); return x; };
    for (const l of lines) { const x = slot(month(l.at)); x.revenue += l.revenue - l.tax; x.cost += l.cost; }
    const exp = await this.prisma.db.expense.findMany({ where: { ...scope, status: { in: ['APPROVED', 'PAID'] }, incurredAt: { gte: day(dto.from), lte: endOfDay(dto.to) } }, select: { incurredAt: true, amount: true, taxAmount: true } });
    for (const e of exp) slot(month(e.incurredAt)).expenses += toCents(Number(e.amount)) - toCents(Number(e.taxAmount));
    const runs = await this.prisma.db.payrollRun.findMany({ where: { status: { in: ['APPROVED', 'PAID'] }, periodStart: { gte: day(dto.from), lte: endOfDay(dto.to) } }, select: { periodKey: true, totalGross: true } });
    for (const r of runs) slot(r.periodKey).payroll += toCents(Number(r.totalGross));
    const rows = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, x]) => ({ period: k, revenueEx: fromCents(x.revenue), cost: fromCents(x.cost), profit: fromCents(x.revenue - x.cost), expenses: fromCents(x.expenses), payroll: fromCents(x.payroll), operating: fromCents(x.revenue - x.cost - x.expenses - x.payroll) }));
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + toCents(f(r)), 0);
    return {
      name: 'profit', title: t('profitTitle', locale), period: { from: dto.from, to: dto.to },
      columns: [{ key: 'period', label: t('period', locale), type: 'text' }, { key: 'revenueEx', label: t('revenueEx', locale), type: 'money' }, { key: 'cost', label: t('cost', locale), type: 'money' }, { key: 'profit', label: t('profit', locale), type: 'money' }, { key: 'expenses', label: t('expenses', locale), type: 'money' }, { key: 'payroll', label: t('payroll', locale), type: 'money' }, { key: 'operating', label: t('operating', locale), type: 'money' }],
      rows, totals: { period: null, revenueEx: fromCents(sum((r) => r.revenueEx)), cost: fromCents(sum((r) => r.cost)), profit: fromCents(sum((r) => r.profit)), expenses: fromCents(sum((r) => r.expenses)), payroll: fromCents(sum((r) => r.payroll)), operating: fromCents(sum((r) => r.operating)) },
    };
  }

  async topCustomers(dto: ReportQueryDto, user: AuthUser, locale: Loc = 'fr'): Promise<ReportTable> {
    const stores = this.stores(user, dto.storeId);
    const orders = await this.prisma.db.order.findMany({ where: { ...(stores && { storeId: { in: stores } }), customerId: { not: null }, status: { notIn: ['CANCELLED', 'DRAFT'] }, placedAt: { gte: day(dto.from), lte: endOfDay(dto.to) } }, select: { customerId: true, total: true, placedAt: true }, take: 100_000 });
    const by = new Map<string, { orders: number; spent: number; last: Date }>();
    for (const o of orders) { const x = by.get(o.customerId!) ?? { orders: 0, spent: 0, last: o.placedAt! }; x.orders++; x.spent += toCents(Number(o.total)); if (o.placedAt && o.placedAt > x.last) x.last = o.placedAt; by.set(o.customerId!, x); }
    const top = [...by.entries()].sort((a, b) => b[1].spent - a[1].spent).slice(0, dto.limit ?? 20);
    const cs = new Map((await this.prisma.db.customer.findMany({ where: { id: { in: top.map(([id]) => id) } }, select: { id: true, firstName: true, lastName: true } })).map((c) => [c.id, `${c.firstName} ${c.lastName}`]));
    return { name: 'top-customers', title: t('customersTitle', locale), period: { from: dto.from, to: dto.to }, columns: [{ key: 'customer', label: t('customer', locale), type: 'text' }, { key: 'orders', label: t('orders', locale), type: 'number' }, { key: 'spent', label: t('spent', locale), type: 'money' }, { key: 'lastOrder', label: t('lastOrder', locale), type: 'text' }], rows: top.map(([id, x]) => ({ customer: cs.get(id) ?? '—', orders: x.orders, spent: fromCents(x.spent), lastOrder: x.last.toISOString().slice(0, 10) })) };
  }

  // ------------------------------------------------------------------ dashboard
  async dashboard(user: AuthUser, storeId?: string) {
    const stores = this.stores(user, storeId);
    const scope = stores ? { storeId: { in: stores } } : {};
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = iso(now), monthStart = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), weekFrom = weekStart(now), since = iso(new Date(now.getTime() - 29 * 86_400_000));
    const lines = await this.saleLines(since > monthStart ? monthStart : since, today, stores);
    const net = (ls: SaleLine[]) => ls.reduce((n, l) => n + l.revenue, 0);
    const within = (from: string) => lines.filter((l) => iso(l.at) >= from);
    const orderCount = (ls: SaleLine[]) => new Set(ls.map((l) => l.orderId)).size;
    const mtd = lines.filter((l) => iso(l.at) >= monthStart), week = within(weekFrom), tod = within(today);
    const series = new Map<string, number>();
    for (let i = 29; i >= 0; i--) series.set(iso(new Date(now.getTime() - i * 86_400_000)), 0);
    for (const l of lines) { const k = iso(l.at); if (series.has(k)) series.set(k, series.get(k)! + l.revenue); }
    const top = new Map<string, { name: string; units: number; revenue: number }>();
    for (const l of mtd) { const k = l.productId ?? l.productName; const x = top.get(k) ?? { name: l.productName, units: 0, revenue: 0 }; x.units += l.units; x.revenue += l.revenue; top.set(k, x); }
    const [lowStock, openJobs, lateJobs, apptToday, unpaid, newCustomers, onlinePending, pendingLeave] = await Promise.all([
      this.prisma.db.stockLevel.findMany({ where: { reorderPoint: { gt: 0 }, warehouse: { isActive: true, ...(stores && { storeId: { in: stores } }) } }, select: { quantity: true, reorderPoint: true } }).then((rows) => rows.filter((r) => r.quantity <= r.reorderPoint).length),
      this.prisma.db.jobOrder.count({ where: { ...scope, status: { notIn: ['DELIVERED', 'CANCELLED'] } } }),
      this.prisma.db.jobOrder.count({ where: { ...scope, promisedAt: { lt: now }, status: { notIn: ['READY', 'DELIVERED', 'CANCELLED'] } } }),
      this.prisma.db.appointment.count({ where: { ...scope, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] }, startsAt: { gte: day(today), lt: new Date(day(today).getTime() + 86_400_000) } } }),
      this.prisma.db.supplierInvoice.count({ where: { ...scope, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } } }),
      this.prisma.db.customer.count({ where: { createdAt: { gte: day(monthStart) } } }),
      this.prisma.db.order.count({ where: { ...scope, channel: 'ONLINE', status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING'] } } }),
      this.prisma.db.leaveRequest.count({ where: { status: 'PENDING' } }),
    ]);
    return {
      sales: { today: fromCents(net(tod)), week: fromCents(net(week)), month: fromCents(net(mtd)), ordersToday: orderCount(tod), ordersMonth: orderCount(mtd), averageBasket: orderCount(mtd) ? fromCents(Math.round(net(mtd) / orderCount(mtd))) : 0 },
      series: [...series.entries()].map(([date, v]) => ({ date, revenue: fromCents(v) })),
      topProducts: [...top.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((x) => ({ ...x, revenue: fromCents(x.revenue) })),
      alerts: { lowStock, openJobs, lateJobs, appointmentsToday: apptToday, unpaidSupplierInvoices: unpaid, newCustomersMonth: newCustomers, onlineToProcess: onlinePending, pendingLeave },
    };
  }
}
