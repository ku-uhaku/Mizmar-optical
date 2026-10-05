/** Built-in document templates. The dashboard can override them per store (DocumentTemplate); these are the fallback. */

const BASE_CSS = `
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#111;font-size:13px}
table{width:100%;border-collapse:collapse}th{text-align:start;font-weight:600}.r{text-align:end}.muted{color:#555}.b{font-weight:700}
.legal{margin-top:14px;font-size:11px;color:#555}@media print{.noprint{display:none}}`;

export const RECEIPT_HTML = `<!doctype html><html lang="{{lang}}" dir="{{dir}}"><head><meta charset="utf-8"><title>{{doc.number}}</title>
<style>${BASE_CSS}@page{size:80mm auto;margin:3mm}body{width:74mm;font-size:12px}h1{font-size:15px;margin:0 0 2px;text-align:center}.c{text-align:center}hr{border:0;border-top:1px dashed #888;margin:6px 0}td{padding:1px 0;vertical-align:top}</style></head><body>
<h1>{{store.name}}</h1>
<div class="c muted">{{store.address}}{{#if store.city}}, {{store.city}}{{/if}}<br>{{store.phone}}</div>
<hr>
<div>{{labels.receipt}} <span class="b">{{doc.number}}</span><br>{{doc.date}}{{#if cashier}} · {{cashier}}{{/if}}{{#if customer.name}}<br>{{customer.name}}{{/if}}</div>
<hr>
<table>{{#each lines}}<tr><td colspan="2">{{description}}</td></tr><tr><td class="muted">{{qty}} × {{unit}}{{#if discount}} (−{{discount}}){{/if}}</td><td class="r">{{total}}</td></tr>{{/each}}</table>
<hr>
<table>
{{#if totals.discount}}<tr><td>{{labels.discount}}</td><td class="r">−{{totals.discount}}</td></tr>{{/if}}
<tr class="b"><td>{{labels.total}}</td><td class="r">{{totals.total}}</td></tr>
<tr class="muted"><td>{{labels.includingTax}}</td><td class="r">{{totals.tax}}</td></tr>
</table>
<hr>
<table>{{#each payments}}<tr><td>{{method}}</td><td class="r">{{amount}}</td></tr>{{/each}}
<tr class="b"><td>{{labels.paid}}</td><td class="r">{{totals.paid}}</td></tr>
{{#if totals.balanceDue}}<tr class="b"><td>{{labels.balanceDue}}</td><td class="r">{{totals.balanceDue}}</td></tr>{{/if}}</table>
{{#if hasLens}}<hr><div class="muted">{{labels.lensNote}}</div>{{/if}}
<hr><div class="c muted">{{footer}}</div>
</body></html>`;

export const INVOICE_HTML = `<!doctype html><html lang="{{lang}}" dir="{{dir}}"><head><meta charset="utf-8"><title>{{doc.number}}</title>
<style>${BASE_CSS}@page{size:A4;margin:14mm}body{padding:4px}.top{display:flex;justify-content:space-between;gap:24px;margin-bottom:18px}h1{margin:0;font-size:22px}
.box{border:1px solid #ddd;border-radius:6px;padding:10px}th,td{padding:7px 6px;border-bottom:1px solid #e5e5e5}thead th{background:#f5f5f5;border-bottom:1px solid #ccc}.tot{width:46%;margin-inline-start:auto;margin-top:12px}.tot td{border:0;padding:3px 6px}</style></head><body>
<div class="top"><div><h1>{{company}}</h1><div class="muted">{{store.name}}<br>{{store.address}}{{#if store.city}}, {{store.city}}{{/if}}<br>{{store.phone}} {{store.email}}</div></div>
<div class="box"><div class="b" style="font-size:16px">{{labels.invoice}} {{doc.number}}</div><div class="muted">{{labels.date}}: {{doc.date}}{{#if order.number}}<br>{{labels.order}}: {{order.number}}{{/if}}</div></div></div>
{{#if customer.name}}<div class="box" style="margin-bottom:14px"><div class="muted">{{labels.billTo}}</div><div class="b">{{customer.name}}</div>{{customer.phone}} {{customer.email}}</div>{{/if}}
<table><thead><tr><th>{{labels.description}}</th><th class="r">{{labels.qty}}</th><th class="r">{{labels.unitPrice}}</th><th class="r">{{labels.discount}}</th><th class="r">{{labels.taxRate}}</th><th class="r">{{labels.total}}</th></tr></thead>
<tbody>{{#each lines}}<tr><td>{{description}}</td><td class="r">{{qty}}</td><td class="r">{{unit}}</td><td class="r">{{discount}}</td><td class="r">{{taxRate}}</td><td class="r">{{total}}</td></tr>{{/each}}</tbody></table>
<table class="tot">
<tr><td>{{labels.subtotal}}</td><td class="r">{{totals.subtotal}}</td></tr>
{{#if totals.discount}}<tr><td>{{labels.discount}}</td><td class="r">−{{totals.discount}}</td></tr>{{/if}}
<tr><td class="muted">{{labels.excludingTax}}</td><td class="r muted">{{totals.net}}</td></tr>
<tr><td class="muted">{{labels.tax}}</td><td class="r muted">{{totals.tax}}</td></tr>
<tr class="b"><td style="font-size:15px">{{labels.totalIncludingTax}}</td><td class="r" style="font-size:15px">{{totals.total}}</td></tr>
<tr><td>{{labels.paid}}</td><td class="r">{{totals.paid}}</td></tr>
{{#if totals.balanceDue}}<tr class="b"><td>{{labels.balanceDue}}</td><td class="r">{{totals.balanceDue}}</td></tr>{{/if}}</table>
{{#if payments}}<div class="muted" style="margin-top:10px">{{labels.payments}}: {{#each payments}}{{method}} {{amount}} ({{date}}){{#if last}}{{else}} · {{/if}}{{/each}}</div>{{/if}}
<div class="legal">{{#if legal.ice}}ICE: {{legal.ice}} · {{/if}}{{#if legal.rc}}RC: {{legal.rc}} · {{/if}}{{#if legal.if}}IF: {{legal.if}} · {{/if}}{{#if legal.patente}}{{labels.patente}}: {{legal.patente}}{{/if}}<br>{{footer}}</div>
</body></html>`;

export const QUOTE_HTML = INVOICE_HTML.replace(/\{\{labels\.invoice\}\}/g, '{{labels.quote}}')
  .replace('{{#if totals.balanceDue}}<tr class="b"><td>{{labels.balanceDue}}</td><td class="r">{{totals.balanceDue}}</td></tr>{{/if}}</table>', '</table>')
  .replace('<tr><td>{{labels.paid}}</td><td class="r">{{totals.paid}}</td></tr>\n', '')
  .replace('{{labels.date}}: {{doc.date}}', '{{labels.date}}: {{doc.date}}{{#if doc.validUntil}}<br>{{labels.validUntil}}: {{doc.validUntil}}{{/if}}');

export const DEFAULT_TEMPLATES = { RECEIPT: { name: 'Ticket 80mm', paperSize: 'THERMAL_80', html: RECEIPT_HTML }, INVOICE: { name: 'Facture A4', paperSize: 'A4', html: INVOICE_HTML }, QUOTE: { name: 'Devis A4', paperSize: 'A4', html: QUOTE_HTML } } as const;

type L = Record<string, string>;
export const LABELS: Record<'fr' | 'en' | 'ar', L> = {
  fr: { receipt: 'Ticket', invoice: 'Facture', quote: 'Devis', date: 'Date', order: 'Commande', billTo: 'Facturé à', description: 'Désignation', qty: 'Qté', unitPrice: 'Prix unit.', discount: 'Remise', taxRate: 'TVA', total: 'Total', subtotal: 'Sous-total', excludingTax: 'Total HT', tax: 'TVA', totalIncludingTax: 'Total TTC', includingTax: 'dont TVA', paid: 'Réglé', balanceDue: 'Reste à payer', payments: 'Paiements', patente: 'Patente', validUntil: "Valable jusqu'au", lensNote: 'Verres sur ordonnance : fabrication en cours, retrait à la livraison.', thanks: 'Merci de votre confiance' },
  en: { receipt: 'Receipt', invoice: 'Invoice', quote: 'Quote', date: 'Date', order: 'Order', billTo: 'Bill to', description: 'Description', qty: 'Qty', unitPrice: 'Unit price', discount: 'Discount', taxRate: 'VAT', total: 'Total', subtotal: 'Subtotal', excludingTax: 'Total excl. VAT', tax: 'VAT', totalIncludingTax: 'Total incl. VAT', includingTax: 'incl. VAT', paid: 'Paid', balanceDue: 'Balance due', payments: 'Payments', patente: 'Trade licence', validUntil: 'Valid until', lensNote: 'Prescription lenses: being made, collect on delivery.', thanks: 'Thank you for your business' },
  ar: { receipt: 'وصل', invoice: 'فاتورة', quote: 'عرض سعر', date: 'التاريخ', order: 'الطلب', billTo: 'الفاتورة إلى', description: 'البيان', qty: 'الكمية', unitPrice: 'سعر الوحدة', discount: 'التخفيض', taxRate: 'الضريبة', total: 'المجموع', subtotal: 'المجموع الجزئي', excludingTax: 'المجموع بدون ضريبة', tax: 'الضريبة', totalIncludingTax: 'المجموع بالضريبة', includingTax: 'منها الضريبة', paid: 'المدفوع', balanceDue: 'المتبقي', payments: 'المدفوعات', patente: 'الرخصة', validUntil: 'صالح حتى', lensNote: 'العدسات الطبية قيد التصنيع، تُسلَّم عند الجاهزية.', thanks: 'شكرًا لثقتكم' },
};
