/**
 * Idempotent seed: safe to run repeatedly (upserts by natural keys, `ensure` for keyless rows).
 *   pnpm db:seed
 */
import { config } from 'dotenv';
import path from 'node:path';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, DocumentType } from '../src/generated/prisma/client';
import { ALL_PERMISSIONS, SYSTEM_ROLES, parsePermission } from '@mizmar/shared';
import { DEFAULT_TEMPLATES } from '../src/modules/documents/default-templates';

config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const log = (m: string) => console.log(`  ✓ ${m}`);

/** Create a row only if none matches `where` (for tables without a natural unique key). */
async function ensure<T>(delegate: any, where: object, data: object): Promise<T> {
  return (await delegate.findFirst({ where })) ?? delegate.create({ data: { ...where, ...data } });
}

const DOC_PREFIX: Record<DocumentType, string> = {
  ORDER: 'CMD', QUOTE: 'DEV', INVOICE: 'FAC', CREDIT_NOTE: 'AVR', RECEIPT: 'REC', RETURN: 'RET', PURCHASE_ORDER: 'BC',
  GOODS_RECEIPT: 'BR', STOCK_TRANSFER: 'TRF', STOCK_ADJUSTMENT: 'AJU', INVENTORY_COUNT: 'INV', JOB_ORDER: 'ATL',
  APPOINTMENT: 'RDV', EXPENSE: 'DEP', PAYSLIP: 'PAIE', CUSTOMER: 'CLI',
};

async function seedAccess() {
  for (const key of ALL_PERMISSIONS) {
    const { module, action } = parsePermission(key);
    await prisma.permission.upsert({ where: { key }, update: { module, action }, create: { key, module, action } });
  }
  log(`${ALL_PERMISSIONS.length} permissions`);

  const perms = await prisma.permission.findMany();
  const byKey = new Map(perms.map((p) => [p.key, p.id]));
  for (const [code, def] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { code }, update: { name: def.name, description: def.description, isSystem: true },
      create: { code, name: def.name, description: def.description, isSystem: true },
    });
    const keys = def.permissions === '*' ? ALL_PERMISSIONS : def.permissions;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: keys.map((k) => ({ roleId: role.id, permissionId: byKey.get(k)! })) });
  }
  log(`${Object.keys(SYSTEM_ROLES).length} system roles`);
}

async function seedLocale() {
  const langs = [
    { code: 'fr', name: 'French', nativeName: 'Français', isRtl: false, isDefault: true, sortOrder: 1 },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', isRtl: true, isDefault: false, sortOrder: 2 },
    { code: 'en', name: 'English', nativeName: 'English', isRtl: false, isDefault: false, sortOrder: 3 },
  ];
  for (const l of langs) await prisma.language.upsert({ where: { code: l.code }, update: l, create: l });
  const cur = [
    { code: 'MAD', name: 'Dirham marocain', symbol: 'DH', exchangeRate: 1, isDefault: true },
    { code: 'EUR', name: 'Euro', symbol: '€', exchangeRate: 0.092, isDefault: false },
    { code: 'USD', name: 'US Dollar', symbol: '$', exchangeRate: 0.1, isDefault: false },
  ];
  for (const c of cur) await prisma.currency.upsert({ where: { code: c.code }, update: c, create: c });
  const taxes = [
    { code: 'VAT20', name: 'TVA 20%', rate: 20, isDefault: true }, { code: 'VAT14', name: 'TVA 14%', rate: 14, isDefault: false },
    { code: 'VAT10', name: 'TVA 10%', rate: 10, isDefault: false }, { code: 'VAT7', name: 'TVA 7%', rate: 7, isDefault: false },
    { code: 'VAT0', name: 'Exonéré', rate: 0, isDefault: false },
  ];
  for (const t of taxes) await prisma.taxRate.upsert({ where: { code: t.code }, update: {}, create: t });
  log('languages (fr/ar/en), currencies (MAD default), tax rates');
}

async function seedStores() {
  const defs = [
    { code: 'CASA', name: 'Mizmar Casablanca Maârif', slug: 'casablanca-maarif', city: 'Casablanca', address: '12 Rue Abou Hanifa, Maârif', phone: '+212 522 00 00 01', email: 'casa@mizmar.local', latitude: 33.5883, longitude: -7.6322, isDefault: true },
    { code: 'RABAT', name: 'Mizmar Rabat Agdal', slug: 'rabat-agdal', city: 'Rabat', address: '45 Avenue Fal Ould Oumeir, Agdal', phone: '+212 537 00 00 02', email: 'rabat@mizmar.local', latitude: 33.9916, longitude: -6.8498, isDefault: false },
  ];
  const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ open: '09:30', close: '19:30' }]]));
  const stores = [];
  for (const d of defs) {
    const store = await prisma.store.upsert({ where: { code: d.code }, update: {}, create: { ...d, region: d.city, openingHours: hours } });
    await prisma.warehouse.upsert({ where: { storeId_code: { storeId: store.id, code: 'MAIN' } }, update: {}, create: { storeId: store.id, code: 'MAIN', name: 'Magasin', isDefault: true } });
    await prisma.cashRegister.upsert({ where: { storeId_code: { storeId: store.id, code: 'C1' } }, update: {}, create: { storeId: store.id, code: 'C1', name: 'Caisse 1' } });
    for (const docType of Object.values(DocumentType)) {
      await prisma.documentSequence.upsert({
        where: { storeId_docType_periodKey: { storeId: store.id, docType, periodKey: 'all' } }, update: {},
        create: { storeId: store.id, docType, prefix: `${d.code}-${DOC_PREFIX[docType]}`, padding: 6, reset: 'YEARLY' },
      });
    }
    stores.push(store);
  }
  log('2 stores with warehouse, cash register and document numbering');
  return stores;
}

async function seedUsers(stores: { id: string; code: string }[]) {
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.code, r.id]));
  const make = async (email: string, password: string, firstName: string, lastName: string, roleCode: string, storeIds: string[], isSuperAdmin = false) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return false;
    await prisma.user.create({
      data: {
        email, passwordHash: await bcrypt.hash(password, 12), firstName, lastName, isSuperAdmin, status: 'ACTIVE', emailVerifiedAt: new Date(),
        roles: { create: [{ roleId: roles.get(roleCode)! }] }, stores: { create: storeIds.map((storeId, i) => ({ storeId, isDefault: i === 0 })) },
      },
    });
    return true;
  };
  const all = stores.map((s) => s.id);
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@mizmar.local';
  const adminPass = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  if (await make(adminEmail, adminPass, 'Super', 'Admin', 'super_admin', all, true)) {
    console.log(`\n  ★ Super admin created → ${adminEmail} / ${adminPass}  (change this password!)\n`);
  }
  const demoPass = 'Demo!2026pass';
  const casa = stores.find((s) => s.code === 'CASA')!.id;
  const demo: [string, string, string, string][] = [
    ['manager@mizmar.local', 'Karim', 'Benali', 'store_manager'], ['optician@mizmar.local', 'Salma', 'Idrissi', 'optician'],
    ['technician@mizmar.local', 'Youssef', 'Alaoui', 'technician'], ['cashier@mizmar.local', 'Nadia', 'Tazi', 'cashier'],
  ];
  for (const [email, f, l, role] of demo) await make(email, demoPass, f, l, role, [casa]);
  log(`users (demo staff password: ${demoPass})`);
}

async function seedCommerceConfig() {
  const methods = [
    { code: 'cash', name: 'Espèces', type: 'CASH', availableOnline: false, availableInPos: true, sortOrder: 1 },
    { code: 'card', name: 'Carte bancaire', type: 'CARD', availableOnline: false, availableInPos: true, sortOrder: 2 },
    { code: 'transfer', name: 'Virement', type: 'BANK_TRANSFER', availableOnline: true, availableInPos: true, sortOrder: 3 },
    { code: 'cheque', name: 'Chèque', type: 'CHEQUE', availableOnline: false, availableInPos: true, sortOrder: 4 },
    { code: 'cod', name: 'Paiement à la livraison', type: 'CASH_ON_DELIVERY', availableOnline: true, availableInPos: false, sortOrder: 5 },
    { code: 'insurance', name: 'Mutuelle / Assurance', type: 'INSURANCE', availableOnline: false, availableInPos: true, sortOrder: 6 },
  ] as const;
  for (const m of methods) await prisma.paymentMethodConfig.upsert({ where: { code: m.code }, update: {}, create: { ...m } });
  const ship = [
    { code: 'standard', name: 'Livraison standard', price: 35, freeOverAmount: 800, estimatedDaysMin: 2, estimatedDaysMax: 4, sortOrder: 1 },
    { code: 'express', name: 'Livraison express', price: 70, estimatedDaysMin: 1, estimatedDaysMax: 1, sortOrder: 2 },
    { code: 'pickup', name: 'Retrait en magasin', price: 0, sortOrder: 3 },
  ];
  for (const s of ship) await prisma.shippingMethod.upsert({ where: { code: s.code }, update: {}, create: s });
  await prisma.coupon.upsert({ where: { code: 'BIENVENUE10' }, update: {}, create: { code: 'BIENVENUE10', description: '10% de bienvenue', type: 'PERCENT', value: 10, minSubtotal: 300 } });

  const modules = ['pos', 'inventory', 'purchasing', 'workshop', 'appointments', 'hr', 'finance', 'reports', 'blog', 'storefront'];
  for (const moduleKey of modules) await prisma.moduleToggle.upsert({ where: { moduleKey }, update: {}, create: { moduleKey, isEnabled: true } });

  const settings: [string, string, unknown, boolean][] = [
    ['general', 'default_locale', 'fr', true], ['general', 'default_currency', 'MAD', true], ['general', 'timezone', 'Africa/Casablanca', true],
    ['general', 'units', 'metric', true], ['checkout', 'guest_checkout', true, true], ['checkout', 'prescription_required_for_lenses', true, true],
    ['inventory', 'low_stock_alerts', true, false], ['pos', 'require_open_session', true, false], ['pos', 'min_deposit_pct', 30, false], ['pos', 'allow_negative_stock', false, false], ['invoice', 'footer', 'Merci de votre confiance — Mizmar Optique', false],
  ];
  for (const [group, key, value, isPublic] of settings)
    await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: 'GLOBAL', scopeId: 'global', key } }, update: {}, create: { group, key, value: value as any, isPublic } });

  await prisma.brandingSetting.upsert({
    where: { key: 'default' }, update: {},
    create: {
      storeName: 'Mizmar Optique', tagline: "Votre vision, notre passion",
      colors: { light: { primary: '#0f4c81', secondary: '#1d9bf0', accent: '#f59e0b', background: '#ffffff', foreground: '#0f172a' }, dark: { primary: '#60a5fa', secondary: '#38bdf8', accent: '#fbbf24', background: '#0b1220', foreground: '#e2e8f0' } },
      fonts: { heading: 'Poppins', body: 'Inter' },
      social: { instagram: 'https://instagram.com/mizmar', facebook: 'https://facebook.com/mizmar', whatsapp: '+212600000000' },
      contact: { phone: '+212 522 00 00 01', email: 'contact@mizmar.local' },
      legal: { companyName: 'Mizmar Optique SARL', ice: '000000000000000', rc: '000000', if: '00000000', patente: '00000000' },
    },
  });
  log('payment/shipping methods, coupon, module toggles, settings, branding');
}

async function seedCatalog() {
  const brands = ['Ray-Ban', 'Oakley', 'Persol', 'Gucci', 'Essilor', 'Acuvue'];
  const brandMap: Record<string, string> = {};
  for (const [i, name] of brands.entries()) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    brandMap[name] = (await prisma.brand.upsert({ where: { slug }, update: {}, create: { name, slug, sortOrder: i, isFeatured: i < 4 } })).id;
  }
  const cats = [['Lunettes de vue', 'lunettes-de-vue'], ['Lunettes de soleil', 'lunettes-de-soleil'], ['Lentilles de contact', 'lentilles-de-contact'], ['Verres', 'verres'], ['Accessoires', 'accessoires']];
  const catMap: Record<string, string> = {};
  for (const [i, [name, slug]] of cats.entries()) catMap[slug] = (await prisma.category.upsert({ where: { slug }, update: {}, create: { name, slug, sortOrder: i } })).id;

  const shapes = ['Ronde', 'Carrée', 'Rectangulaire', 'Aviateur', 'Papillon', 'Ovale'];
  const shapeMap: Record<string, string> = {};
  for (const [i, name] of shapes.entries()) shapeMap[name] = (await prisma.frameShape.upsert({ where: { slug: name.toLowerCase() }, update: {}, create: { name, slug: name.toLowerCase(), sortOrder: i } })).id;
  const materials = ['Acétate', 'Métal', 'Titane', 'Plastique'];
  const matMap: Record<string, string> = {};
  for (const [i, name] of materials.entries()) matMap[name] = (await prisma.frameMaterial.upsert({ where: { slug: name.toLowerCase() }, update: {}, create: { name, slug: name.toLowerCase(), sortOrder: i } })).id;

  const lensTypes = [
    { code: 'single_vision', kind: 'SINGLE_VISION', name: 'Unifocal', basePrice: 200, requiresAdd: false }, { code: 'bifocal', kind: 'BIFOCAL', name: 'Bifocal', basePrice: 450, requiresAdd: true },
    { code: 'progressive', kind: 'PROGRESSIVE', name: 'Progressif', basePrice: 800, requiresAdd: true }, { code: 'office', kind: 'OFFICE', name: 'Bureau / Occupationnel', basePrice: 600, requiresAdd: true },
    { code: 'plano', kind: 'PLANO', name: 'Sans correction', basePrice: 0, requiresAdd: false },
  ] as const;
  const lensMap: Record<string, string> = {};
  for (const [i, l] of lensTypes.entries()) lensMap[l.code] = (await prisma.lensType.upsert({ where: { code: l.code }, update: {}, create: { ...l, sortOrder: i } })).id;
  const treatments = [
    { code: 'anti_reflective', category: 'ANTI_REFLECTIVE', name: 'Anti-reflet', price: 150 }, { code: 'blue_light', category: 'BLUE_LIGHT', name: 'Anti-lumière bleue', price: 200 },
    { code: 'photochromic', category: 'PHOTOCHROMIC', name: 'Photochromique', price: 350 }, { code: 'polarized', category: 'POLARIZED', name: 'Polarisé', price: 300 },
    { code: 'hard_coat', category: 'HARD_COAT', name: 'Anti-rayures', price: 80 }, { code: 'uv', category: 'UV', name: 'Protection UV400', price: 0 },
  ] as const;
  const trMap: Record<string, string> = {};
  for (const [i, t] of treatments.entries()) trMap[t.code] = (await prisma.lensTreatment.upsert({ where: { code: t.code }, update: {}, create: { ...t, sortOrder: i } })).id;
  for (const lt of ['single_vision', 'bifocal', 'progressive', 'office'])
    for (const tr of Object.keys(trMap))
      await prisma.lensTypeTreatment.upsert({ where: { lensTypeId_treatmentId: { lensTypeId: lensMap[lt], treatmentId: trMap[tr] } }, update: {}, create: { lensTypeId: lensMap[lt], treatmentId: trMap[tr] } });

  const entries = [
    ['LNS-SV-150', 'single_vision', 'Unifocal 1.50', 1.5, 200, 80], ['LNS-SV-160', 'single_vision', 'Unifocal 1.60 aminci', 1.6, 380, 150],
    ['LNS-PR-160', 'progressive', 'Progressif 1.60', 1.6, 950, 420], ['LNS-PR-167', 'progressive', 'Progressif 1.67 ultra-fin', 1.67, 1400, 650],
  ] as const;
  for (const [sku, lt, name, idx, price, cost] of entries)
    await prisma.lensCatalogEntry.upsert({ where: { sku }, update: {}, create: { sku, name, lensTypeId: lensMap[lt], refractiveIndex: idx, price, cost, sphMin: -8, sphMax: 6, cylMin: -4, cylMax: 0, diameterMm: 70, leadTimeDays: 5 } });

  const products = [
    { slug: 'ray-ban-rb5154-clubmaster', name: 'Ray-Ban Clubmaster RB5154', type: 'FRAME', brand: 'Ray-Ban', cat: 'lunettes-de-vue', gender: 'UNISEX', shape: 'Papillon', mat: 'Acétate', price: 1450, cost: 780, colors: [['Noir', '#111111', '01'], ['Écaille', '#7b4a2d', '02']] },
    { slug: 'persol-po3019-vue', name: 'Persol PO3019V', type: 'FRAME', brand: 'Persol', cat: 'lunettes-de-vue', gender: 'MEN', shape: 'Carrée', mat: 'Acétate', price: 2100, cost: 1150, colors: [['Havane', '#8b5a2b', '01'], ['Noir', '#111111', '02']] },
    { slug: 'gucci-gg0061o', name: 'Gucci GG0061O', type: 'FRAME', brand: 'Gucci', cat: 'lunettes-de-vue', gender: 'WOMEN', shape: 'Ronde', mat: 'Métal', price: 2900, cost: 1600, colors: [['Or', '#c9a227', '01']] },
    { slug: 'ray-ban-aviator-rb3025', name: 'Ray-Ban Aviator RB3025', type: 'SUNGLASSES', brand: 'Ray-Ban', cat: 'lunettes-de-soleil', gender: 'UNISEX', shape: 'Aviateur', mat: 'Métal', price: 1650, cost: 900, colors: [['Or / Vert G-15', '#c9a227', '01'], ['Argent / Bleu', '#c0c0c0', '02']] },
    { slug: 'oakley-holbrook-oo9102', name: 'Oakley Holbrook OO9102', type: 'SUNGLASSES', brand: 'Oakley', cat: 'lunettes-de-soleil', gender: 'MEN', shape: 'Carrée', mat: 'Plastique', price: 1500, cost: 820, colors: [['Noir mat', '#1c1c1c', '01']] },
    { slug: 'acuvue-oasys-6', name: 'Acuvue Oasys (boîte de 6)', type: 'CONTACT_LENS', brand: 'Acuvue', cat: 'lentilles-de-contact', gender: undefined, shape: undefined, mat: undefined, price: 280, cost: 160, colors: [['-2.00', '', '200']] },
  ] as const;
  const warehouses = await prisma.warehouse.findMany({ where: { code: 'MAIN' } });
  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { slug: p.slug }, update: {},
      create: { slug: p.slug, name: p.name, type: p.type as any, brandId: brandMap[p.brand], categoryId: catMap[p.cat], gender: p.gender as any, status: 'ACTIVE', isPublished: true, isFeatured: true, isLensConfigurable: p.type === 'FRAME', requiresPrescription: p.type === 'CONTACT_LENS', description: `${p.name} — modèle de démonstration.` },
    });
    if (p.shape) await prisma.frameSpec.upsert({ where: { productId: product.id }, update: {}, create: { productId: product.id, shapeId: shapeMap[p.shape], materialId: matMap[p.mat!], lensWidthMm: 52, bridgeMm: 18, templeMm: 145, rimType: 'FULL_RIM' } });
    for (const [color, hex, code] of p.colors) {
      const sku = `${p.slug.toUpperCase().slice(0, 14).replace(/-/g, '')}-${code}`;
      const variant = await prisma.productVariant.upsert({
        where: { sku }, update: {},
        create: { productId: product.id, sku, barcode: `61${String(Math.abs(hash(sku))).padStart(11, '0').slice(0, 11)}`, color, colorHex: hex || null, size: p.type === 'CONTACT_LENS' ? 'BC 8.4 / Ø 14.3' : '52-18-145', price: p.price, cost: p.cost },
      });
      for (const w of warehouses) {
        await prisma.stockLevel.upsert({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: w.id } }, update: {}, create: { variantId: variant.id, warehouseId: w.id, quantity: 8, reorderPoint: 3, reorderQty: 10 } });
        // every stock level is backed by the ledger: the opening quantity is an INITIAL movement
        await ensure(prisma.stockMovement, { variantId: variant.id, warehouseId: w.id, type: 'INITIAL' }, { storeId: w.storeId, quantity: 8, balanceAfter: 8, unitCost: p.cost, note: 'Opening stock (seed)' });
      }
    }
  }
  log('brands, categories, shapes/materials, lens types/treatments/catalog, 6 demo products with stock');
}

function hash(s: string) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

async function seedPeopleAndOps(stores: { id: string; code: string }[]) {
  const casa = stores.find((s) => s.code === 'CASA')!.id;
  const customers = [
    { code: 'CLI-0001', firstName: 'Fatima', lastName: 'Zahraoui', phone: '+212600111222', email: 'fatima.z@example.com', gender: 'FEMALE' as const },
    { code: 'CLI-0002', firstName: 'Omar', lastName: 'El Fassi', phone: '+212600333444', email: 'omar.f@example.com', gender: 'MALE' as const },
    { code: 'CLI-0003', firstName: 'Lina', lastName: 'Chraibi', phone: '+212600555666', email: 'lina.c@example.com', gender: 'FEMALE' as const },
  ];
  for (const [i, c] of customers.entries()) {
    const cust = await prisma.customer.upsert({ where: { code: c.code }, update: {}, create: { ...c, preferredStoreId: casa, marketingOptIn: true } });
    await ensure(prisma.prescription, { customerId: cust.id, issuedAt: new Date('2026-06-15') }, {
      storeId: casa, source: 'STORE', prescriberName: 'Dr. Bennani', expiresAt: new Date('2028-06-15'),
      odSph: -1.5 - i * 0.5, odCyl: -0.5, odAxis: 90, odPd: 31.5, osSph: -1.25 - i * 0.5, osCyl: -0.75, osAxis: 85, osPd: 31, pdTotal: 62.5, ...(i === 2 ? { odAdd: 1.5, osAdd: 1.5 } : {}),
    });
  }
  for (const [name, code] of [['CNOPS', 'CNOPS'], ['CNSS', 'CNSS'], ['AXA Assurance', 'AXA'], ['Saham Assurance', 'SAHAM']]) await prisma.insuranceProvider.upsert({ where: { code }, update: {}, create: { name, code, defaultCoveragePct: 70 } });

  await prisma.supplier.upsert({ where: { code: 'SUP-LUXOTTICA' }, update: {}, create: { code: 'SUP-LUXOTTICA', name: 'Luxottica Maroc', city: 'Casablanca', paymentTermsDays: 60 } });
  await prisma.supplier.upsert({ where: { code: 'SUP-LABOVUE' }, update: {}, create: { code: 'SUP-LABOVUE', name: 'LaboVue (laboratoire de verres)', city: 'Casablanca', isLensLab: true, paymentTermsDays: 30 } });

  for (const [code, name, durationMin, price] of [['eye_exam', 'Examen de la vue', 30, 0], ['contact_fitting', 'Adaptation lentilles', 45, 200], ['frame_fitting', 'Essayage & conseil', 20, 0]] as const)
    await prisma.appointmentType.upsert({ where: { code }, update: {}, create: { code, name, durationMin, price } });
  for (const [code, name, isPaid, annualDays] of [['annual', 'Congé annuel', true, 18], ['sick', 'Congé maladie', true, null], ['unpaid', 'Congé sans solde', false, null]] as const)
    await prisma.leaveType.upsert({ where: { code }, update: {}, create: { code, name, isPaid, annualDays } });
  for (const [code, name] of [['rent', 'Loyer'], ['utilities', 'Eau / Électricité / Internet'], ['marketing', 'Marketing'], ['supplies', 'Fournitures'], ['salaries', 'Salaires']])
    await prisma.expenseCategory.upsert({ where: { code }, update: {}, create: { code, name } });
  await ensure(prisma.bankAccount, { name: 'Caisse principale' }, { isCashAccount: true });
  await ensure(prisma.bankAccount, { name: 'Compte bancaire principal' }, { bankName: 'Attijariwafa bank' });
  log('customers + prescriptions, insurers, suppliers, appointment/leave types, expense categories, accounts');
}

async function seedContent() {
  const tpls: [string, string, string, string][] = [
    ['password_reset', 'fr', 'Réinitialisation de votre mot de passe', '<p>Bonjour {{firstName}},</p><p>Cliquez ici pour choisir un nouveau mot de passe : <a href="{{resetUrl}}">{{resetUrl}}</a> (valable 1 h).</p>'],
    ['password_reset', 'en', 'Reset your password', '<p>Hello {{firstName}},</p><p>Choose a new password here: <a href="{{resetUrl}}">{{resetUrl}}</a> (valid for 1 hour).</p>'],
    ['order_confirmation', 'fr', 'Confirmation de commande {{orderNumber}}', '<p>Merci {{firstName}} ! Votre commande {{orderNumber}} a bien été reçue.</p>'],
    ['job_ready', 'fr', 'Vos lunettes sont prêtes', '<p>Bonjour {{firstName}}, vos lunettes sont prêtes à être retirées chez {{storeName}}.</p>'],
    ['appointment_confirmation', 'fr', 'Rendez-vous confirmé', '<p>Votre rendez-vous du {{date}} à {{time}} chez {{storeName}} est confirmé.</p>'],
  ];
  for (const [code, locale, subject, body] of tpls) await prisma.emailTemplate.upsert({ where: { code_locale: { code, locale } }, update: {}, create: { code, locale, subject, body } });
  for (const channel of ['SMS', 'WHATSAPP'] as const)
    await prisma.smsTemplate.upsert({ where: { code_locale_channel: { code: 'job_ready', locale: 'fr', channel } }, update: {}, create: { code: 'job_ready', locale: 'fr', channel, body: 'Mizmar Optique : vos lunettes sont prêtes ! Retrait chez {{storeName}}.' } });
  // real, printable templates (receipt 80mm, invoice A4, quote A4). Old placeholder rows from the first seed are upgraded in place.
  for (const type of ['INVOICE', 'RECEIPT', 'QUOTE'] as const) {
    const t = DEFAULT_TEMPLATES[type];
    const existing = await prisma.documentTemplate.findFirst({ where: { type, isDefault: true, storeId: null } });
    if (!existing) await prisma.documentTemplate.create({ data: { type, isDefault: true, name: t.name, paperSize: t.paperSize, html: t.html } });
    else if (!/\{\{\s*doc\./.test(existing.html)) await prisma.documentTemplate.update({ where: { id: existing.id }, data: { name: t.name, paperSize: t.paperSize, html: t.html } });
  }

  const header = await prisma.menu.upsert({ where: { code: 'header' }, update: {}, create: { code: 'header', name: 'Menu principal' } });
  const footer = await prisma.menu.upsert({ where: { code: 'footer' }, update: {}, create: { code: 'footer', name: 'Pied de page' } });
  const items: [string, string, string, string][] = [
    [header.id, 'Lunettes de vue', '/catalogue/lunettes-de-vue', '1'], [header.id, 'Lunettes de soleil', '/catalogue/lunettes-de-soleil', '2'],
    [header.id, 'Lentilles', '/catalogue/lentilles-de-contact', '3'], [header.id, 'Rendez-vous', '/rendez-vous', '4'], [header.id, 'Magasins', '/magasins', '5'], [header.id, 'Blog', '/blog', '6'],
    [footer.id, 'À propos', '/pages/a-propos', '1'], [footer.id, 'FAQ', '/pages/faq', '2'], [footer.id, 'Contact', '/contact', '3'], [footer.id, 'Conditions générales', '/pages/conditions-generales', '4'],
  ];
  for (const [menuId, label, url, order] of items) await ensure(prisma.menuItem, { menuId, label }, { url, sortOrder: Number(order) });

  for (const [slug, title, content, footerFlag] of [
    ['a-propos', 'À propos', '<p>Mizmar Optique vous accompagne depuis des années avec des montures sélectionnées et un atelier intégré.</p>', true],
    ['faq', 'Questions fréquentes', '<h3>Combien de temps pour fabriquer mes lunettes ?</h3><p>Entre 2 et 7 jours selon les verres.</p>', true],
    ['conditions-generales', 'Conditions générales de vente', '<p>Conditions générales de vente (modèle).</p>', true],
    ['politique-de-confidentialite', 'Politique de confidentialité', '<p>Politique de confidentialité (modèle).</p>', true],
    ['livraison-retours', 'Livraison & retours', '<p>Livraison sous 2 à 4 jours. Retours sous 14 jours (hors verres correcteurs sur mesure).</p>', true],
  ] as const) await prisma.cmsPage.upsert({ where: { slug }, update: {}, create: { slug, title, content, status: 'PUBLISHED', publishedAt: new Date(), showInFooter: footerFlag } });

  await ensure(prisma.banner, { placement: 'HOME_HERO', title: 'Nouvelle collection 2026' }, { subtitle: 'Les montures de la saison', imageUrl: '/placeholders/hero-1.jpg', linkUrl: '/catalogue/lunettes-de-vue', ctaLabel: 'Découvrir' });
  for (const [authorName, content] of [['Sara M.', 'Accueil chaleureux et conseils précis, mes lunettes étaient prêtes en 3 jours.'], ['Hamza B.', 'Large choix de montures et prix très corrects.'], ['Imane L.', "Examen de la vue complet et rapide, je recommande."]])
    await ensure(prisma.testimonial, { authorName }, { content, rating: 5 });
  const sections = [
    ['HERO_BANNER', 'Hero', {}], ['CATEGORIES', 'Nos univers', {}], ['FEATURED_PRODUCTS', 'Sélection du moment', { limit: 8 }],
    ['PROMO', 'Offre de bienvenue', { couponCode: 'BIENVENUE10' }], ['BRANDS', 'Nos marques', { limit: 12 }], ['TESTIMONIALS', 'Ils nous font confiance', { limit: 3 }], ['STORES', 'Nos magasins', {}], ['NEWSLETTER', 'Newsletter', {}],
  ] as const;
  for (const [i, [type, title, cfg]] of sections.entries()) await ensure(prisma.homeSection, { type: type as any, title }, { config: cfg, sortOrder: i, isActive: true });
  log('email/SMS/document templates, menus, CMS pages, banner, testimonials, home sections');
}

async function main() {
  console.log('Seeding Mizmar Optical…');
  await seedAccess();
  await seedLocale();
  const stores = await seedStores();
  await seedUsers(stores);
  await seedCommerceConfig();
  await seedCatalog();
  await seedPeopleAndOps(stores);
  await seedContent();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
