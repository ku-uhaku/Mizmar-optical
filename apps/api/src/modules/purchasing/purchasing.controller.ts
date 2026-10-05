import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStore, CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { DocumentsService } from '../documents/documents.service';
import { DocumentQueryDto } from '../sales/sales.dto';
import { PayablesService } from './payables.service';
import { PurchasingService } from './purchasing.service';
import * as D from './purchasing.dto';

const loc = (q: DocumentQueryDto) => (q.locale ?? 'fr') as 'fr' | 'en' | 'ar';

@ApiTags('purchasing') @ApiBearerAuth()
@Controller()
export class PurchasingController {
  constructor(private readonly po: PurchasingService, private readonly payables: PayablesService, private readonly docs: DocumentsService) {}

  // ---- purchase orders
  @Get('purchase-orders') @Permissions('purchasing:read') list(@Query() q: D.ListPurchaseOrdersDto, @CurrentUser() u: AuthUser) { return this.po.list(q, u); }
  @Post('purchase-orders') @Permissions('purchasing:create') create(@Body() dto: D.CreatePurchaseOrderDto, @CurrentUser() u: AuthUser) { return this.po.create(dto, u); }
  @Get('purchase-orders/:id') @Permissions('purchasing:read') get(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.po.get(id, u); }
  @Patch('purchase-orders/:id') @Permissions('purchasing:update') update(@Param('id') id: string, @Body() dto: D.UpdatePurchaseOrderDto, @CurrentUser() u: AuthUser) { return this.po.update(id, dto, u); }
  @Delete('purchase-orders/:id') @HttpCode(204) @Permissions('purchasing:update') remove(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.po.remove(id, u); }
  @Post('purchase-orders/:id/send') @HttpCode(200) @Permissions('purchasing:approve') send(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.po.send(id, u); }
  @Post('purchase-orders/:id/cancel') @HttpCode(200) @Permissions('purchasing:approve') cancel(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.po.cancel(id, u); }
  @Post('purchase-orders/:id/receipts') @Permissions('purchasing:receive') receive(@Param('id') id: string, @Body() dto: D.ReceiveDto, @CurrentUser() u: AuthUser) { return this.po.receive(id, dto, u); }
  @Get('purchase-orders/:id/uninvoiced') @Permissions('purchasing:read') uninvoiced(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.po.uninvoiced(id, u); }
  @Get('purchase-orders/:id/document') @Permissions('purchasing:read') document(@Param('id') id: string, @Query() q: DocumentQueryDto, @CurrentUser() u: AuthUser) { return this.docs.purchaseOrder(id, u, loc(q)); }

  // ---- goods receipts
  @Get('goods-receipts') @Permissions('purchasing:read') receipts(@Query() q: D.ListReceiptsDto, @CurrentUser() u: AuthUser) { return this.po.listReceipts(q, u); }
  @Post('goods-receipts') @Permissions('purchasing:receive') direct(@Body() dto: D.DirectReceiptDto, @CurrentUser() u: AuthUser) { return this.po.directReceipt(dto, u); }
  @Get('goods-receipts/:id') @Permissions('purchasing:read') receipt(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.po.getReceipt(id, u); }
  @Post('goods-receipts/:id/void') @HttpCode(200) @Permissions('purchasing:approve') voidReceipt(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.po.voidReceipt(id, u); }

  // ---- supplier invoices & payments (accounting)
  @Get('supplier-invoices') @Permissions('finance:read') invoices(@Query() q: D.ListSupplierInvoicesDto, @CurrentUser() u: AuthUser) { return this.payables.list(q, u); }
  @Post('supplier-invoices') @Permissions('finance:create') createInvoice(@Body() dto: D.CreateSupplierInvoiceDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.payables.create(dto, u, s); }
  @Get('supplier-invoices/:id') @Permissions('finance:read') invoice(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.payables.get(id, u); }
  @Post('supplier-invoices/:id/payments') @Permissions('finance:approve') pay(@Param('id') id: string, @Body() dto: D.SupplierPaymentDto, @CurrentUser() u: AuthUser) { return this.payables.pay(id, dto, u); }
  @Post('supplier-invoices/:id/void') @HttpCode(200) @Permissions('finance:update') voidInvoice(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.payables.void(id, u); }
  @Get('suppliers/:id/statement') @Permissions('suppliers:read', 'finance:read') statement(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.payables.statement(id, u); }
  @Get('purchasing/summary') @Permissions('purchasing:read') summary(@Query() q: D.StoreFilterDto, @CurrentUser() u: AuthUser) { return this.payables.summary(u, q.storeId); }
}
