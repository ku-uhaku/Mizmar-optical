import { LABELS } from '../documents/default-templates';

/** Fake but realistic data so a template can be previewed (and checked for syntax errors) before it is saved. */
export function sampleContext(type: string, locale: 'fr' | 'en' | 'ar' = 'fr'): Record<string, unknown> {
  const labels = LABELS[locale];
  const base = {
    lang: locale, dir: locale === 'ar' ? 'rtl' : 'ltr', labels, company: 'Mizmar Optique', footer: labels.thanks, currency: 'MAD',
    store: { name: 'Mizmar Casablanca Maârif', address: '12 rue Exemple', city: 'Casablanca', phone: '+212 522 00 00 00', email: 'contact@example.ma' },
    legal: { legalName: 'Mizmar Optique SARL', ice: '000000000000000', rc: '123456', if: '1234567', patente: '12345678' },
    doc: { number: 'CASA-2026-000123', date: '05/10/2026', validUntil: '05/11/2026', promised: '12/10/2026' }, order: { number: 'CASA-CMD-2026-000045' },
    cashier: 'Nadia Tazi', customer: { name: 'Lina Chraibi', phone: '+212 600 00 00 00', email: 'lina@example.com' }, hasLens: true,
    lines: [{ description: 'Ray-Ban Clubmaster — Noir', qty: 1, unit: '1 650,00 MAD', discount: '', taxRate: '20%', total: '1 650,00 MAD' }, { description: 'Verres progressifs 1.6 + Anti-reflet', qty: 1, unit: '980,00 MAD', discount: '98,00 MAD', taxRate: '20%', total: '882,00 MAD' }],
    totals: { subtotal: '2 630,00 MAD', discount: '98,00 MAD', net: '2 110,00 MAD', tax: '422,00 MAD', total: '2 532,00 MAD', paid: '1 000,00 MAD', balanceDue: '1 532,00 MAD', gross: '4 000,00 MAD', net_: '3 730,40 MAD' },
    payments: [{ method: 'Espèces', amount: '1 000,00 MAD', date: '05/10/2026', last: true }],
    period: 'octobre 2026', employee: { name: 'Salma Idrissi', number: 'EMP-0002', position: 'Opticienne', cnss: '123456789' },
    frame: 'Ray-Ban Clubmaster — Noir', lens: 'Progressif 1.6', treatments: 'Anti-reflet', hasRx: true, rx: [{ eye: 'OD', sph: '-2.00', cyl: '-0.50', axis: '90', add: '', pd: '31.5' }, { eye: 'OG', sph: '-1.75', cyl: '-0.25', axis: '85', add: '', pd: '31.0' }], pdTotal: '62.5', fitting: '', priority: 'NORMAL', technician: 'Youssef Alaoui', notes: '', tasks: [{ name: 'Taillage' }, { name: 'Montage' }],
  };
  if (type === 'PAYSLIP') return { ...base, lines: [{ label: 'Salaire de base', amount: '8 000,00 MAD' }, { label: 'CNSS (part salariale)', amount: '-268,80 MAD' }], totals: { gross: '8 000,00 MAD', net: '6 500,00 MAD' } };
  return base;
}
