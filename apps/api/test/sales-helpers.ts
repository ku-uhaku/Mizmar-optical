import { INestApplication } from '@nestjs/common';
import { loginAs, uid } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

export type Client = Awaited<ReturnType<typeof loginAs>>;

/**
 * Shared fixture for the POS/sales suites: closes any session left over from earlier runs, makes sure each Casablanca user can
 * have their own drawer, and exposes small builders (products with stock, customers with prescriptions).
 */
export async function setupSales(app: INestApplication) {
  const prisma = app.get(PrismaService);
  await prisma.raw.cashSession.updateMany({ where: { status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });

  const cashier = await loginAs(app, 'cashier');
  const manager = await loginAs(app, 'manager');
  const technician = await loginAs(app, 'technician');
  const casa = cashier.user.stores[0].id;
  const admin = await loginAs(app, 'admin', casa);
  const stores = (await admin.get('/stores?limit=10')).body.data as { id: string; code: string }[];
  const rabat = stores.find((s) => s.code === 'RABAT')!.id;
  const rabatAdmin = await loginAs(app, 'admin', rabat);

  // one drawer per concurrent user: C1 (seeded), C2 (cashier + manager in tests), plus Rabat's C1
  for (const code of ['C1', 'C2']) await prisma.raw.cashRegister.upsert({ where: { storeId_code: { storeId: casa, code } }, update: { isActive: true }, create: { storeId: casa, code, name: `Caisse ${code}` } });
  const reg = async (storeId: string, code: string) => (await prisma.raw.cashRegister.findUniqueOrThrow({ where: { storeId_code: { storeId, code } } })).id;
  const registers = { c1: await reg(casa, 'C1'), c2: await reg(casa, 'C2'), rabat: await reg(rabat, 'C1') };

  const whs = (await admin.get('/warehouses')).body as { id: string; storeId: string }[];
  const warehouse = { casa: whs.find((w) => w.storeId === casa)!.id, rabat: whs.find((w) => w.storeId === rabat)!.id };
  const cfg = (await cashier.get('/pos/config')).body;
  const method = (code: string) => (cfg.paymentMethods as { id: string; code: string }[]).find((m) => m.code === code)!.id;
  const cod = (await admin.get('/pos/config')).body && (await prisma.raw.paymentMethodConfig.findUniqueOrThrow({ where: { code: 'cod' } })).id;

  const newProduct = async (o: { price?: number; stock?: number; type?: string; wh?: string; cost?: number; lens?: boolean; status?: string } = {}) => {
    const k = uid();
    const res = await admin.post('/products', {
      type: o.type ?? 'ACCESSORY', name: `Sale Item ${k}`, status: o.status ?? 'ACTIVE', isLensConfigurable: o.lens ?? false,
      variants: [{ sku: `SALE-${k}`.toUpperCase(), price: o.price ?? 100, cost: o.cost ?? 40, initialStock: o.stock === 0 ? [] : [{ warehouseId: o.wh ?? warehouse.casa, quantity: o.stock ?? 20 }] }],
    }).expect(201);
    return { product: res.body, variantId: res.body.variants[0].id as string, sku: res.body.variants[0].sku as string };
  };
  const stockOf = async (variantId: string, wh = warehouse.casa) => (await prisma.raw.stockLevel.findUnique({ where: { variantId_warehouseId: { variantId, warehouseId: wh } } }))?.quantity ?? 0;

  const phone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const newCustomer = async (over: Record<string, unknown> = {}) => (await admin.post('/customers', { firstName: 'Pos', lastName: `Cust${uid()}`, phone: phone(), ...over }).expect(201)).body;
  const rx = (o: Record<string, unknown> = {}) => ({ issuedAt: '2026-06-15', odSph: -2, odCyl: -0.5, odAxis: 90, osSph: -1.75, osCyl: -0.25, osAxis: 85, odPd: 31.5, osPd: 31, pdTotal: 62.5, ...o });
  const customerWithRx = async (rxOver: Record<string, unknown> = {}) => {
    const customer = await newCustomer();
    const rxRow = (await admin.post(`/customers/${customer.id}/prescriptions`, rx(rxOver)).expect(201)).body;
    return { customer, rx: rxRow };
  };

  const lensOptions = async () => (await cashier.get('/pos/lens-options')).body as { id: string; code: string; kind: string; requiresAdd: boolean; basePrice: number; treatments: { id: string; name: string; price: number }[]; entries: { id: string; name: string; price: number; sphMin: number | null; sphMax: number | null }[] }[];

  /** Opens the cashier's drawer on C1 (closing leftovers first) and returns the session. */
  const openCashier = async (float = 500) => (await cashier.post('/pos/sessions', { registerId: registers.c1, openingFloat: float }).expect(201)).body;
  const openManager = async (float = 300) => (await manager.post('/pos/sessions', { registerId: registers.c2, openingFloat: float }).expect(201)).body;
  const closeSession = (client: Client, id: string, counted: number) => client.post(`/pos/sessions/${id}/close`, { countedCash: counted });

  const prismaSvc = prisma;
  return { prisma: prismaSvc, cashier, manager, technician, admin, rabatAdmin, casa, rabat, registers, warehouse, method, cod, newProduct, stockOf, newCustomer, customerWithRx, lensOptions, openCashier, openManager, closeSession, rx };
}
