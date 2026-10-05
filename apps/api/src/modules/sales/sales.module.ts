import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PosModule } from '../pos/pos.module';
import { SettingsModule } from '../settings/settings.module';
import { CartPricingService } from './cart-pricing.service';
import { InvoicesService } from './invoices.service';
import { OrdersService } from './orders.service';
import { QuotesService } from './quotes.service';
import { ReturnsService } from './returns.service';
import { SalesController } from './sales.controller';

@Module({
  imports: [InventoryModule, PosModule, SettingsModule, DocumentsModule],
  controllers: [SalesController],
  providers: [CartPricingService, OrdersService, ReturnsService, QuotesService, InvoicesService],
  exports: [OrdersService, CartPricingService],
})
export class SalesModule {}
