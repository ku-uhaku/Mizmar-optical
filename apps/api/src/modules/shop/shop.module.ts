import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MediaModule } from '../media/media.module';
import { SalesModule } from '../sales/sales.module';
import { SettingsModule } from '../settings/settings.module';
import { AccountService } from './account.service';
import { ShopContentService } from './content.service';
import { PaymentProviders } from './payment-providers';
import { ShopCatalogService } from './shop-catalog.service';
import { ShopCheckoutService } from './shop-checkout.service';
import { CouponsController, CouponsService, ModerationController, ShippingMethodsController, ShippingMethodsService } from './shop-admin';
import { FulfillmentService } from './fulfillment.service';
import { AccountController, FulfillmentController, ShopController } from './shop.controller';

@Module({
  imports: [AuthModule, InventoryModule, MediaModule, SalesModule, SettingsModule],
  controllers: [ShopController, AccountController, FulfillmentController, CouponsController, ShippingMethodsController, ModerationController],
  providers: [ShopCatalogService, ShopCheckoutService, ShopContentService, AccountService, FulfillmentService, PaymentProviders, CouponsService, ShippingMethodsService],
  exports: [PaymentProviders, ShopCheckoutService],
})
export class ShopModule {}
