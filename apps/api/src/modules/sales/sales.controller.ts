import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStore, CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { DocumentsService } from '../documents/documents.service';
import { InvoicesService } from './invoices.service';
import { OrdersService } from './orders.service';
import { QuotesService } from './quotes.service';
import { ReturnsService } from './returns.service';
import * as D from './sales.dto';

const loc = (q: D.DocumentQueryDto) => (q.locale ?? 'fr') as 'fr' | 'en' | 'ar';

@ApiTags('sales') @ApiBearerAuth()
@Controller()
export class SalesController {
  constructor(
    private readonly orders: OrdersService, private readonly returns: ReturnsService, private readonly quotes: QuotesService,
    private readonly invoices: InvoicesService, private readonly docs: DocumentsService,
  ) {}

  // ---- checkout & orders
  @Post('pos/price') @HttpCode(200) @Permissions('pos:access')
  price(@Body() dto: D.PriceCartDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.orders.preview(dto.lines, dto.customerId, u, s); }

  @Post('pos/checkout') @Permissions('pos:access', 'orders:create', 'payments:create')
  checkout(@Body() dto: D.CheckoutDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.orders.checkout(dto, u, s); }

  @Get('orders') @Permissions('orders:read') listOrders(@Query() q: D.ListOrdersDto, @CurrentUser() u: AuthUser) { return this.orders.list(q, u); }
  @Get('customers/:customerId/orders') @Permissions('orders:read')
  customerOrders(@Param('customerId') customerId: string, @Query() q: D.ListOrdersDto, @CurrentUser() u: AuthUser) { return this.orders.list({ ...q, customerId }, u); }
  @Get('orders/:id') @Permissions('orders:read') getOrder(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.orders.get(id, u); }
  @Post('orders/:id/payments') @Permissions('payments:create')
  pay(@Param('id') id: string, @Body() dto: D.AddPaymentDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.orders.addPayment(id, dto, u, s); }
  @Post('orders/:id/deliver') @HttpCode(200) @Permissions('orders:update') deliver(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.orders.deliver(id, u); }
  @Post('orders/:id/cancel') @HttpCode(200) @Permissions('orders:cancel') cancel(@Param('id') id: string, @Body() dto: D.CancelOrderDto, @CurrentUser() u: AuthUser) { return this.returns.cancel(id, dto, u); }
  @Post('orders/:id/returns') @Permissions('returns:create') createReturn(@Param('id') id: string, @Body() dto: D.CreateReturnDto, @CurrentUser() u: AuthUser) { return this.returns.create(id, dto, u); }
  @Get('returns/:id') @Permissions('returns:read') getReturn(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.returns.get(id, u); }
  @Get('orders/:id/receipt') @Permissions('orders:read') receipt(@Param('id') id: string, @Query() q: D.DocumentQueryDto, @CurrentUser() u: AuthUser) { return this.docs.receipt(id, u, loc(q)); }

  // ---- invoices
  @Get('invoices') @Permissions('invoices:read') listInvoices(@Query() q: D.ListInvoicesDto, @CurrentUser() u: AuthUser) { return this.invoices.list(q, u); }
  @Get('invoices/:id') @Permissions('invoices:read') getInvoice(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.invoices.get(id, u); }
  @Get('invoices/:id/document') @Permissions('invoices:read') invoiceDoc(@Param('id') id: string, @Query() q: D.DocumentQueryDto, @CurrentUser() u: AuthUser) { return this.docs.invoice(id, u, loc(q)); }

  // ---- quotes
  @Get('quotes') @Permissions('quotes:read') listQuotes(@Query() q: D.ListQuotesDto, @CurrentUser() u: AuthUser) { return this.quotes.list(q, u); }
  @Post('quotes') @Permissions('quotes:create') createQuote(@Body() dto: D.CreateQuoteDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.quotes.create(dto, u, s); }
  @Get('quotes/:id') @Permissions('quotes:read') getQuote(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.quotes.get(id, u); }
  @Patch('quotes/:id') @Permissions('quotes:update') updateQuote(@Param('id') id: string, @Body() dto: D.UpdateQuoteDto, @CurrentUser() u: AuthUser) { return this.quotes.update(id, dto, u); }
  @Delete('quotes/:id') @HttpCode(204) @Permissions('quotes:delete') removeQuote(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.quotes.remove(id, u); }
  @Post('quotes/:id/send') @HttpCode(200) @Permissions('quotes:update') send(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.quotes.transition(id, 'SENT', u); }
  @Post('quotes/:id/accept') @HttpCode(200) @Permissions('quotes:update') accept(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.quotes.transition(id, 'ACCEPTED', u); }
  @Post('quotes/:id/reject') @HttpCode(200) @Permissions('quotes:update') reject(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.quotes.transition(id, 'REJECTED', u); }
  @Get('quotes/:id/cart') @Permissions('quotes:read') quoteCart(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.quotes.cart(id, u); }
  @Get('quotes/:id/document') @Permissions('quotes:read') quoteDoc(@Param('id') id: string, @Query() q: D.DocumentQueryDto, @CurrentUser() u: AuthUser) { return this.docs.quote(id, u, loc(q)); }
}
