import { Controller, NotFoundException, Get, Header, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { toCsv, toHtml, toXlsx, type ReportTable } from './report-table';
import { ReportsService } from './reports.service';
import * as D from './reports.dto';

const NAMES = ['sales', 'best-sellers', 'stock-value', 'profit', 'top-customers'] as const;

@ApiTags('reports') @ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService, private readonly prisma: PrismaService) {}

  @Get('dashboard') @Permissions('reports:read') dashboard(@Query('storeId') storeId: string | undefined, @CurrentUser() u: AuthUser) { return this.svc.dashboard(u, storeId); }
  @Get('sales') @Permissions('reports:read') sales(@Query() q: D.ReportQueryDto, @CurrentUser() u: AuthUser) { return this.svc.sales(q, u); }
  @Get('best-sellers') @Permissions('reports:read') best(@Query() q: D.ReportQueryDto, @CurrentUser() u: AuthUser) { return this.svc.bestSellers(q, u); }
  @Get('stock-value') @Permissions('reports:read') stock(@Query() q: D.StockQueryDto, @CurrentUser() u: AuthUser) { return this.svc.stockValue(q, u); }
  @Get('profit') @Permissions('reports:read') profit(@Query() q: D.ReportQueryDto, @CurrentUser() u: AuthUser) { return this.svc.profit(q, u); }
  @Get('top-customers') @Permissions('reports:read') customers(@Query() q: D.ReportQueryDto, @CurrentUser() u: AuthUser) { return this.svc.topCustomers(q, u); }

  /** Excel (.xlsx), CSV, or a print-ready page (open it and "Print → Save as PDF"). The same query as the JSON report. */
  @Get('export/:name') @Permissions('reports:export') @Header('Cache-Control', 'no-store')
  async export(@Param('name') name: (typeof NAMES)[number], @Query() q: D.ExportQueryDto, @CurrentUser() u: AuthUser, @Res({ passthrough: true }) res: Response) {
    const locale = q.locale ?? 'fr';
    if (!NAMES.includes(name)) throw new NotFoundException('Unknown report');
    const table: ReportTable = name === 'sales' ? await this.svc.sales(q, u, locale) : name === 'best-sellers' ? await this.svc.bestSellers(q, u, locale) : name === 'stock-value' ? await this.svc.stockValue(q, u, locale) : name === 'profit' ? await this.svc.profit(q, u, locale) : await this.svc.topCustomers(q, u, locale);
    const stamp = `${name}${table.period ? `_${table.period.from}_${table.period.to}` : ''}`;
    const total = locale === 'fr' ? 'Total' : locale === 'ar' ? 'المجموع' : 'Total';
    if ((q.format ?? 'xlsx') === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${stamp}.csv"` });
      return new StreamableFile(Buffer.from(toCsv(table), 'utf8'));
    }
    if (q.format === 'html') {
      const branding = await this.prisma.db.brandingSetting.findFirst({ where: { key: 'default' } });
      const intl = locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-FR' : 'en-GB';
      res.set({ 'Content-Type': 'application/json; charset=utf-8' });
      return { html: toHtml(table, { locale, company: branding?.storeName ?? 'Mizmar Optique', totalLabel: total, money: (n) => new Intl.NumberFormat(intl, { style: 'currency', currency: 'MAD' }).format(n), num: (n) => new Intl.NumberFormat(intl).format(n) }), title: table.title };
    }
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${stamp}.xlsx"` });
    return new StreamableFile(await toXlsx(table, total));
  }
}
