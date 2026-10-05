import ExcelJS from 'exceljs';

export interface Column { key: string; label: string; type: 'text' | 'money' | 'number' | 'percent' }
export interface ReportTable { name: string; title: string; period?: { from: string; to: string }; columns: Column[]; rows: Record<string, string | number | null>[]; totals?: Record<string, string | number | null> }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** CSV with a BOM (Excel opens UTF-8 correctly), RFC-4180 quoting, and formula-injection neutralised (a cell starting with = + - @ is prefixed). */
export function toCsv(t: ReportTable): string {
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [t.columns.map((c) => cell(c.label)).join(','), ...t.rows.map((r) => t.columns.map((c) => cell(r[c.key])).join(','))];
  if (t.totals) lines.push(t.columns.map((c) => cell(t.totals![c.key])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export async function toXlsx(t: ReportTable, totalLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mizmar Optique';
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), { views: [{ state: 'frozen', ySplit: t.period ? 3 : 1 }] });
  let r = 1;
  if (t.period) { ws.getCell(1, 1).value = t.title; ws.getCell(1, 1).font = { bold: true, size: 14 }; ws.getCell(2, 1).value = `${t.period.from} → ${t.period.to}`; r = 3; }
  const fmt = (c: Column) => (c.type === 'money' ? '#,##0.00' : c.type === 'percent' ? '0.0"%"' : c.type === 'number' ? '#,##0' : undefined);
  const head = ws.getRow(r);
  t.columns.forEach((c, i) => { const cell = head.getCell(i + 1); cell.value = c.label; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } }; cell.alignment = { horizontal: c.type === 'text' ? 'left' : 'right' }; });
  const put = (row: ExcelJS.Row, data: Record<string, string | number | null>) => t.columns.forEach((c, i) => { const cell = row.getCell(i + 1); const v = data[c.key]; cell.value = v as ExcelJS.CellValue; const f = fmt(c); if (f && typeof v === 'number') cell.numFmt = f; });
  t.rows.forEach((d, i) => put(ws.getRow(r + 1 + i), d));
  if (t.totals) { const row = ws.getRow(r + 1 + t.rows.length); put(row, { ...t.totals, [t.columns[0].key]: t.totals[t.columns[0].key] ?? totalLabel }); row.font = { bold: true }; row.border = { top: { style: 'thin' } }; }
  t.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(c.label.length + 2, ...t.rows.slice(0, 200).map((d) => String(d[c.key] ?? '').length + 2), 12)); });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toHtml(t: ReportTable, o: { locale: string; money: (n: number) => string; num: (n: number) => string; totalLabel: string; company: string }): string {
  const dir = o.locale === 'ar' ? 'rtl' : 'ltr';
  const val = (c: Column, v: unknown) => (v == null || v === '' ? '' : typeof v !== 'number' ? esc(v) : c.type === 'money' ? o.money(v) : c.type === 'percent' ? `${v.toFixed(1)} %` : o.num(v));
  const body = t.rows.map((r) => `<tr>${t.columns.map((c) => `<td class="${c.type}">${val(c, r[c.key])}</td>`).join('')}</tr>`).join('');
  const foot = t.totals ? `<tr class="t">${t.columns.map((c, i) => `<td class="${c.type}">${i === 0 && t.totals![c.key] == null ? esc(o.totalLabel) : val(c, t.totals![c.key])}</td>`).join('')}</tr>` : '';
  return `<!doctype html><html lang="${o.locale}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(t.title)}</title><style>
@page{size:A4 landscape;margin:12mm}body{font:12px/1.4 system-ui,sans-serif;color:#111}h1{margin:0;font-size:20px}.m{color:#666;margin:2px 0 14px}table{width:100%;border-collapse:collapse}th,td{padding:5px 8px;border-bottom:1px solid #ddd;text-align:start}th{background:#0f4c81;color:#fff}td.money,td.number,td.percent,th.money,th.number,th.percent{text-align:end;font-variant-numeric:tabular-nums}tr.t td{font-weight:700;border-top:2px solid #111}
</style></head><body><h1>${esc(t.title)}</h1><p class="m">${esc(o.company)}${t.period ? ` · ${t.period.from} → ${t.period.to}` : ''}</p><table><thead><tr>${t.columns.map((c) => `<th class="${c.type}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${body}${foot}</tbody></table></body></html>`;
}
